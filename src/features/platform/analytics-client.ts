import { API_PREFIX } from '@/contracts';
import { isValidEventName, sanitizeProps, type AnalyticsProps } from '@/lib/analytics';

/** One queued event, already in the wire format of `AnalyticsEventBody.events[]`. */
export interface QueuedEvent {
  name: string;
  at: string;
  props?: AnalyticsProps;
}

export type SendMode = 'normal' | 'unload';
export type SendFn = (events: QueuedEvent[], mode: SendMode) => Promise<void>;

export interface AnalyticsClientOptions {
  send: SendFn;
  /** Consent AND feature flag. Evaluated on every `track` and every flush: when false nothing is queued or sent. */
  isEnabled: () => boolean;
  /** Props merged into every event (session id, layout, locale…) — sanitised like any other prop. */
  context?: () => Record<string, unknown>;
  now?: () => number;
  flushIntervalMs?: number;
  /** Contract limit of `AnalyticsEventBody.events`. */
  maxBatch?: number;
  /** Memory cap: when exceeded the OLDEST events are dropped (recent behaviour is worth more than history). */
  maxQueue?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export const ANALYTICS_DEFAULTS = {
  flushIntervalMs: 10_000,
  maxBatch: 50,
  maxQueue: 500,
  baseBackoffMs: 5_000,
  maxBackoffMs: 5 * 60_000,
} as const;

/**
 * In-memory batching queue behind `track()`. Nothing is persisted: events that cannot be delivered before the tab
 * dies are lost on purpose (no analytics data at rest on the device).
 */
export class AnalyticsClient {
  private queue: QueuedEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private sending = false;
  private failures = 0;
  private retryAt = 0;
  private readonly o: Required<Omit<AnalyticsClientOptions, 'context'>> &
    Pick<AnalyticsClientOptions, 'context'>;

  constructor(options: AnalyticsClientOptions) {
    this.o = { now: Date.now, ...ANALYTICS_DEFAULTS, ...options };
  }

  get size(): number {
    return this.queue.length;
  }
  /** Milliseconds to wait after `failures` consecutive failed flushes. */
  backoffMs(failures: number): number {
    if (failures <= 0) return 0;
    return Math.min(this.o.maxBackoffMs, this.o.baseBackoffMs * 2 ** (failures - 1));
  }

  track = (name: string, props?: Record<string, unknown>): void => {
    if (!this.o.isEnabled()) return;
    if (!isValidEventName(name)) return;
    const merged = sanitizeProps({ ...this.o.context?.(), ...props });
    this.queue.push({ name, at: new Date(this.o.now()).toISOString(), ...(merged ? { props: merged } : {}) });
    if (this.queue.length > this.o.maxQueue) this.queue.splice(0, this.queue.length - this.o.maxQueue);
    // A full batch does not wait for the timer.
    if (this.queue.length >= this.o.maxBatch) void this.flush();
  };

  /** Consent withdrawn / flag turned off: forget everything that was not sent yet. */
  clear(): void {
    this.queue = [];
    this.failures = 0;
    this.retryAt = 0;
  }

  async flush(mode: SendMode = 'normal'): Promise<void> {
    if (!this.o.isEnabled()) {
      this.clear();
      return;
    }
    if (this.sending || this.queue.length === 0) return;
    // During a backoff window only an unload flush (last chance) is attempted.
    if (mode === 'normal' && this.o.now() < this.retryAt) return;
    const batch = this.queue.splice(0, this.o.maxBatch);
    this.sending = true;
    try {
      await this.o.send(batch, mode);
      this.failures = 0;
      this.retryAt = 0;
    } catch {
      this.failures += 1;
      this.retryAt = this.o.now() + this.backoffMs(this.failures);
      // Put the batch back in front (order preserved), then enforce the cap again.
      this.queue = [...batch, ...this.queue];
      if (this.queue.length > this.o.maxQueue) this.queue.splice(0, this.queue.length - this.o.maxQueue);
    } finally {
      this.sending = false;
    }
    if (mode === 'normal' && this.failures === 0 && this.queue.length >= this.o.maxBatch) await this.flush();
  }

  /** Starts the periodic flush and the page-lifecycle flushes. Returns the cleanup. */
  start(): () => void {
    if (typeof window === 'undefined') return () => undefined;
    this.timer = setInterval(() => void this.flush(), this.o.flushIntervalMs);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void this.flush('unload');
    };
    const onPageHide = () => void this.flush('unload');
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }
}

/* ───────────────────────────── transport ───────────────────────────── */

export interface TransportDeps {
  apiUrl: string;
  getAccessToken: () => string | null;
  /** Normal path: the API client (bearer, refresh on 401, error envelope). */
  post: (events: QueuedEvent[], authenticated: boolean) => Promise<void>;
  fetchFn?: typeof fetch;
  beacon?: (url: string, data: BodyInit) => boolean;
}

/**
 * `normal` → the API client. `unload` (tab hidden / page hide) → a request that survives the page:
 * `fetch(..., { keepalive: true })` when a session exists (a beacon cannot carry the Authorization header),
 * otherwise `navigator.sendBeacon`; each falls back to the other.
 */
export function createTransport(deps: TransportDeps): SendFn {
  const endpoint = `${deps.apiUrl.replace(/\/$/, '')}${API_PREFIX}/analytics/events`;
  return async (events, mode) => {
    const token = deps.getAccessToken();
    if (mode === 'normal') return deps.post(events, token !== null);
    const body = JSON.stringify({ events });
    const viaBeacon = (): boolean =>
      deps.beacon?.(endpoint, new Blob([body], { type: 'application/json' })) === true;
    const viaKeepalive = async (): Promise<void> => {
      const fetchFn = deps.fetchFn ?? fetch;
      const res = await fetchFn(endpoint, {
        method: 'POST',
        keepalive: true,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body,
      });
      if (!res.ok) throw new Error(`analytics flush failed: ${res.status}`);
    };
    if (token) {
      try {
        return await viaKeepalive();
      } catch (e) {
        if (viaBeacon()) return;
        throw e;
      }
    }
    if (viaBeacon()) return;
    return viaKeepalive();
  };
}
