import type { QueryClient } from '@tanstack/react-query';
import type {
  AllianceHomeDto,
  AllianceMemberDto,
  AllianceMessageDto,
  AllianceSyncDelta,
  SyncSnapshot,
  AllianceChannelDto,
} from '@/contracts';

/** The shape TanStack keeps for an infinite query of pages `{ data, meta }`. */
interface InfinitePages<T> {
  pages: { data: T[]; meta: { nextCursor?: string | null; hasMore?: boolean } }[];
  pageParams: unknown[];
}
import { observeServerTime } from '@/lib/clock';
import { invalidateFresh } from '@/lib/api/invalidate';
import { qk } from '@/lib/api/query-keys';
import {
  parseAllianceEnvelope,
  patchSnapshotAlliance,
  reduceAllianceEvent,
  type AllianceEffect,
  type AllianceScope,
  type LooseAllianceEnvelope,
} from './alliance-reconcile';

export interface AllianceControllerOptions {
  careerId: string;
  queryClient: QueryClient;
  /** `GET …/alliance/sync[?since]`: without `since` just the current sequence (the first thing the controller asks). */
  fetchDelta: (since?: number) => Promise<AllianceSyncDelta>;
  /** Side effects beyond the cache (a toast, a sound). Phase 1: none are needed, the hook is here for the next phases. */
  onEffect?: (effect: AllianceEffect, envelope: LooseAllianceEnvelope) => void;
  retryDelayMs?: number;
}

/** Which cache roots an alliance scope maps to. */
export function allianceScopeKeys(careerId: string, scope: AllianceScope): readonly (readonly unknown[])[] {
  switch (scope) {
    case 'home':
      return [qk.allianceHome(careerId)];
    case 'members':
      return [qk.allianceMembers(careerId)];
    case 'requests':
      return [qk.allianceJoinRequests(careerId)];
    case 'invites':
      return [qk.allianceInvites(careerId)];
    case 'log':
      return [qk.allianceLog(careerId)];
    case 'board':
      return [qk.allianceBoard(careerId)];
    case 'chat':
      return [qk.allianceChat(careerId)];
    case 'aid':
      return [qk.allianceAid(careerId)];
    case 'progress':
      return [qk.allianceProgress(careerId), qk.allianceRanking];
    case 'operation':
      return [qk.allianceOperation(careerId)];
    case 'all':
      return [qk.allianceRoot(careerId)];
  }
}

/** Applies reducer effects to the TanStack cache: patches where the data is cached, invalidations elsewhere. */
export function applyAllianceEffects(
  qc: QueryClient,
  careerId: string,
  effects: readonly AllianceEffect[],
): void {
  for (const effect of effects) {
    switch (effect.type) {
      case 'home': {
        const key = qk.allianceHome(careerId);
        const home = qc.getQueryData<AllianceHomeDto>(key);
        if (home) qc.setQueryData(key, effect.update(home));
        else void invalidateFresh(qc, key);
        break;
      }
      case 'members': {
        const key = qk.allianceMembers(careerId);
        const members = qc.getQueryData<AllianceMemberDto[]>(key);
        if (members) qc.setQueryData(key, effect.update(members));
        break;
      }
      case 'snapshot': {
        const key = qk.sync(careerId);
        const snapshot = qc.getQueryData<SyncSnapshot>(key);
        if (snapshot) {
          const next = patchSnapshotAlliance(snapshot, effect.update);
          if (next !== snapshot) qc.setQueryData(key, next);
        }
        break;
      }
      case 'invalidate':
        for (const key of allianceScopeKeys(careerId, effect.scope)) void invalidateFresh(qc, key);
        break;
      case 'left': {
        const key = qk.sync(careerId);
        const snapshot = qc.getQueryData<SyncSnapshot>(key);
        if (snapshot && snapshot.alliance) qc.setQueryData(key, { ...snapshot, alliance: null });
        void invalidateFresh(qc, qk.allianceRoot(careerId));
        break;
      }
      case 'message.created': {
        // Appended to the cached first page of its channel (newest first), so the open chat shows it at once; a page that
        // is not cached is simply read when the screen asks for it.
        const key = qk.allianceMessages(careerId, effect.message.channelId);
        const cached = qc.getQueryData<InfinitePages<AllianceMessageDto>>(key);
        if (
          cached &&
          cached.pages[0] &&
          !cached.pages.some((page) => page.data.some((m) => m.id === effect.message.id))
        )
          qc.setQueryData(key, {
            ...cached,
            pages: cached.pages.map((page, i) =>
              i === 0 ? { ...page, data: [effect.message, ...page.data] } : page,
            ),
          });
        void invalidateFresh(qc, qk.allianceChannels(careerId));
        break;
      }
      case 'message.removed': {
        const key = qk.allianceMessages(careerId, effect.channelId);
        const cached = qc.getQueryData<InfinitePages<AllianceMessageDto>>(key);
        if (cached)
          qc.setQueryData(key, {
            ...cached,
            pages: cached.pages.map((page) => ({
              ...page,
              data: page.data.map((m) =>
                m.id === effect.messageId ? { ...m, removed: true, text: null, deletableUntil: null } : m,
              ),
            })),
          });
        break;
      }
      case 'channel.updated': {
        const key = qk.allianceChannels(careerId);
        const cached = qc.getQueryData<AllianceChannelDto[]>(key);
        if (cached) {
          const known = cached.find((c) => c.id === effect.channel.id);
          const next = { ...effect.channel, unread: known?.unread ?? 0 };
          qc.setQueryData(key, known ? cached.map((c) => (c.id === next.id ? next : c)) : [...cached, next]);
        } else void invalidateFresh(qc, qk.allianceChannels(careerId));
        break;
      }
      case 'post.created':
      case 'post.updated':
      case 'post.removed':
        // The board re-reads itself (posts, pinned, replies previews and the opened reply lists live under one key).
        void invalidateFresh(qc, qk.allianceBoard(careerId));
        break;
      case 'aid.updated':
      case 'column.updated':
        // Requests, columns and the composer's options all live under the aid key; the incident snapshot ("Unità
        // alleate", the ALLIED_SUPPORT vehicles) comes through the career stream on its own.
        void invalidateFresh(qc, qk.allianceAid(careerId));
        break;
      case 'member.changed':
        break;
    }
  }
}

/**
 * The alliance stream's client (brief §2): a second subscription on the game socket (event `alliance`), one sequence per
 * alliance, replay through `GET …/alliance/sync?since=` on a gap or a reconnection. Events of another alliance (the career
 * left or joined since) are ignored; `reset()` forgets the sequence when the career's alliance changes.
 */
export class AllianceRealtimeController {
  /** Last sequence applied; null = not learnt yet (the first sync tells it). */
  private seq: number | null = null;
  private buffer: unknown[] = [];
  private syncing: Promise<void> | null = null;
  private closed = false;

  constructor(private readonly opts: AllianceControllerOptions) {}

  start(): void {
    void this.resync();
  }

  stop(): void {
    this.closed = true;
    this.buffer = [];
  }

  /** The career joined / left an alliance: start over from the server's current sequence. */
  reset(): void {
    this.seq = null;
    this.buffer = [];
    void this.resync();
  }

  get sequence(): number | null {
    return this.seq;
  }

  private myAllianceId(): string | null {
    return (
      this.opts.queryClient.getQueryData<SyncSnapshot>(qk.sync(this.opts.careerId))?.alliance?.id ?? null
    );
  }

  handle(raw: unknown): void {
    if (this.closed) return;
    const envelope = parseAllianceEnvelope(raw);
    if (!envelope) {
      if (process.env.NODE_ENV !== 'production')
        console.warn('[alliance-realtime] invalid envelope dropped', raw);
      return;
    }
    observeServerTime(envelope.serverTime);
    if (this.syncing || this.seq === null) {
      this.buffer.push(raw);
      return;
    }
    const mine = this.myAllianceId();
    if (mine !== null && envelope.allianceId !== mine) return;
    if (envelope.seq <= this.seq) return; // duplicate
    if (envelope.seq > this.seq + 1) {
      this.buffer.push(raw);
      void this.resync();
      return;
    }
    this.apply(envelope);
  }

  private apply(envelope: LooseAllianceEnvelope): void {
    this.seq = envelope.seq;
    const effects = reduceAllianceEvent(envelope, { careerId: this.opts.careerId });
    applyAllianceEffects(this.opts.queryClient, this.opts.careerId, effects);
    if (this.opts.onEffect) for (const effect of effects) this.opts.onEffect(effect, envelope);
  }

  resync(): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = (async () => {
      let ok = false;
      try {
        const delta = await this.opts.fetchDelta(this.seq ?? undefined);
        if (this.closed) return;
        if (delta.resyncRequired) {
          // The gap cannot be replayed: everything of the section is re-read, the sequence restarts from the server's.
          this.seq = delta.seq;
          void invalidateFresh(this.opts.queryClient, qk.allianceRoot(this.opts.careerId));
        } else {
          if (this.seq === null) this.seq = delta.seq;
          for (const raw of delta.events) {
            const envelope = parseAllianceEnvelope(raw);
            if (envelope && envelope.seq > (this.seq ?? -1)) this.apply(envelope);
          }
          if (delta.seq > (this.seq ?? -1)) this.seq = delta.seq;
        }
        ok = true;
      } catch {
        /* keep what we have; retry below while something is pending */
      } finally {
        this.syncing = null;
        if (ok) {
          const pending = this.buffer;
          this.buffer = [];
          for (const raw of pending) this.handle(raw);
        } else if (!this.closed) {
          this.buffer = this.buffer.slice(-200);
          setTimeout(() => {
            if (!this.closed && (this.buffer.length > 0 || this.seq === null)) void this.resync();
          }, this.opts.retryDelayMs ?? 3000);
        }
      }
    })();
    return this.syncing;
  }
}
