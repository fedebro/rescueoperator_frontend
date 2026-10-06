import type { QueryClient } from '@tanstack/react-query';
import type { SyncDelta, SyncSnapshot } from '@/contracts';
import { observeServerTime } from '@/lib/clock';
import { qk } from '@/lib/api/query-keys';
import { applyEvent, parseEnvelope, type Effect } from './reconcile';
import type { RealtimeTransport, TransportHandlers, TransportStatus } from './transport';

export type ConnectionState = 'connecting' | 'online' | 'reconnecting' | 'polling' | 'offline';

export interface ControllerOptions {
  careerId: string;
  queryClient: QueryClient;
  connect: (handlers: TransportHandlers) => RealtimeTransport;
  /** Fetches a fresh snapshot (GET /sync). */
  fetchSnapshot: () => Promise<SyncSnapshot>;
  /** Fetches the events missed since `seq` (GET /sync?since=). Omitted → every recovery is a full snapshot. */
  fetchDelta?: (since: number) => Promise<SyncDelta>;
  onEffect: (effect: Effect) => void;
  onConnection: (state: ConnectionState) => void;
  /** The alliance stream shares the socket (brief §2): its raw envelopes go to the alliance controller. */
  onAllianceEvent?: (raw: unknown) => void;
  /** Every (re)connection after the first, besides the career resync (the alliance controller resyncs too). */
  onReconnected?: () => void;
  pollIntervalMs?: number;
  retryDelayMs?: number;
}

/**
 * Glue between the realtime channel and the TanStack Query cache.
 * - validated envelopes are applied to the cached snapshot (pure reducer)
 * - a `seq` gap, or any reconnection, triggers a recovery; events received meanwhile are buffered and replayed
 * - recovery prefers `GET /sync?since=<seq>`: the missed events run through the same reducer, so the toasts, the
 *   outcome dialog and the sounds of what happened while the tab was away still fire. Only when the server says
 *   `resyncRequired` (gap too large, or events already pruned) is the whole snapshot replaced — which is silent.
 * - when the socket cannot connect the controller polls every 10 s until the socket comes back
 */
export class RealtimeController {
  private transport: RealtimeTransport | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private resyncing: Promise<void> | null = null;
  private buffer: unknown[] = [];
  private closed = false;
  private readonly onOnline = () => {
    if (this.pollTimer) void this.resync();
  };
  private readonly onOffline = () => this.opts.onConnection('offline');

  constructor(private readonly opts: ControllerOptions) {}

  start(): void {
    this.transport = this.opts.connect({
      onEvent: (raw) => this.handle(raw),
      onStatus: (status) => this.handleStatus(status),
      onReconnect: () => {
        void this.resync();
        this.opts.onReconnected?.();
      },
      onAllianceEvent: this.opts.onAllianceEvent,
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
    }
  }

  stop(): void {
    this.closed = true;
    this.transport?.close();
    this.stopPolling();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
    }
  }

  private handleStatus(status: TransportStatus): void {
    if (this.closed) return;
    if (status === 'online') {
      this.stopPolling();
      this.opts.onConnection('online');
    } else if (status === 'failed') {
      this.startPolling();
      this.opts.onConnection('polling');
    } else
      this.opts.onConnection(
        typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : status,
      );
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => void this.resync(), this.opts.pollIntervalMs ?? 10_000);
  }
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  handle(raw: unknown): void {
    if (this.closed) return;
    const envelope = parseEnvelope(raw);
    if (!envelope) {
      if (process.env.NODE_ENV !== 'production') console.warn('[realtime] invalid envelope dropped', raw);
      return;
    }
    observeServerTime(envelope.serverTime);
    if (this.resyncing) {
      this.buffer.push(raw);
      return;
    }
    const key = qk.sync(this.opts.careerId);
    const snapshot = this.opts.queryClient.getQueryData<SyncSnapshot>(key);
    if (!snapshot) {
      this.buffer.push(raw);
      return;
    }
    const result = applyEvent(snapshot, envelope);
    if (result.kind === 'applied') {
      this.opts.queryClient.setQueryData(key, result.snapshot);
      for (const effect of result.effects) this.opts.onEffect(effect);
    } else if (result.kind === 'gap') {
      this.buffer.push(raw);
      void this.resync();
    }
  }

  /** Applies one recovered envelope to the cached snapshot. Duplicates are dropped; a gap cannot happen here. */
  private applyRecovered(raw: unknown): void {
    const key = qk.sync(this.opts.careerId);
    const envelope = parseEnvelope(raw);
    const snapshot = this.opts.queryClient.getQueryData<SyncSnapshot>(key);
    if (!envelope || !snapshot) return;
    const result = applyEvent(snapshot, envelope);
    if (result.kind !== 'applied') return;
    this.opts.queryClient.setQueryData(key, result.snapshot);
    for (const effect of result.effects) this.opts.onEffect(effect);
  }

  resync(): Promise<void> {
    if (this.resyncing) return this.resyncing;
    this.resyncing = (async () => {
      let ok = false;
      try {
        const key = qk.sync(this.opts.careerId);
        const current = this.opts.queryClient.getQueryData<SyncSnapshot>(key);
        if (this.opts.fetchDelta && current) {
          const delta = await this.opts.fetchDelta(current.seq);
          if (this.closed) return;
          if (delta.resyncRequired && delta.snapshot) this.opts.queryClient.setQueryData(key, delta.snapshot);
          else for (const event of delta.events) this.applyRecovered(event);
        } else {
          const snapshot = await this.opts.fetchSnapshot();
          if (this.closed) return;
          this.opts.queryClient.setQueryData(key, snapshot);
        }
        ok = true;
      } catch {
        /* keep the stale snapshot and retry below */
      } finally {
        this.resyncing = null;
        if (ok) {
          const pending = this.buffer;
          this.buffer = [];
          for (const raw of pending) this.handle(raw); // seqs already in the snapshot are dropped as duplicates
        } else if (!this.closed) {
          this.buffer = this.buffer.slice(-200);
          setTimeout(() => {
            if (!this.closed && this.buffer.length > 0) void this.resync();
          }, this.opts.retryDelayMs ?? 3000);
        }
      }
    })();
    return this.resyncing;
  }
}
