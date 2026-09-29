import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { invalidateFresh } from './invalidate';

/**
 * A fake server whose answers the test releases by hand: each request reads the state as of the moment it is made, like a REST
 * read that starts before a change and completes after it.
 */
function slowServer() {
  let state = 1;
  const inFlight: Array<() => void> = [];
  const queryFn = vi.fn(() => {
    const seen = state;
    return new Promise<number>((resolve) => inFlight.push(() => resolve(seen)));
  });
  return {
    queryFn,
    change: () => {
      state += 1;
    },
    answerAll: () => inFlight.splice(0).forEach((answer) => answer()),
  };
}

const clients: QueryClient[] = [];
const newClient = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(qc);
  return qc;
};
afterEach(() => clients.splice(0).forEach((qc) => qc.clear()));
/** Lets the promise callbacks queued by TanStack run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('invalidateFresh', () => {
  it('a change during the first read of a shown query: read once more when it lands, the screen gets the new state', async () => {
    const qc = newClient();
    const server = slowServer();
    const unsubscribe = new QueryObserver(qc, { queryKey: ['patients'], queryFn: server.queryFn }).subscribe(
      () => {},
    );
    await vi.waitFor(() => expect(server.queryFn).toHaveBeenCalledTimes(1)); // the first read, of state 1, in flight

    server.change(); // state 2…
    void invalidateFresh(qc, ['patients']); // …and its event, while that read is still in flight
    server.answerAll();

    await vi.waitFor(() => expect(server.queryFn).toHaveBeenCalledTimes(2));
    server.answerAll();
    await vi.waitFor(() => expect(qc.getQueryData(['patients'])).toBe(2));
    unsubscribe();
  });

  it('why it exists: a plain invalidation there is folded into the read in flight, and the old state stays', async () => {
    const qc = newClient();
    const server = slowServer();
    const unsubscribe = new QueryObserver(qc, { queryKey: ['patients'], queryFn: server.queryFn }).subscribe(
      () => {},
    );
    await vi.waitFor(() => expect(server.queryFn).toHaveBeenCalledTimes(1));

    server.change();
    void qc.invalidateQueries({ queryKey: ['patients'] });
    server.answerAll();
    await settle();

    expect(server.queryFn).toHaveBeenCalledTimes(1);
    expect(qc.getQueryData(['patients'])).toBe(1);
    unsubscribe();
  });

  it('a query with data: refetched as usual (the read in flight is replaced), the newest answer wins', async () => {
    const qc = newClient();
    const server = slowServer();
    const unsubscribe = new QueryObserver(qc, { queryKey: ['patients'], queryFn: server.queryFn }).subscribe(
      () => {},
    );
    await vi.waitFor(() => expect(server.queryFn).toHaveBeenCalledTimes(1));
    server.answerAll();
    await vi.waitFor(() => expect(qc.getQueryData(['patients'])).toBe(1));

    server.change();
    void invalidateFresh(qc, ['patients']);
    server.change();
    void invalidateFresh(qc, ['patients']);
    server.answerAll();
    await settle();

    expect(server.queryFn).toHaveBeenCalledTimes(3);
    expect(qc.getQueryData(['patients'])).toBe(3);
    unsubscribe();
  });

  it('whoever awaits the first read still gets its answer, never an error', async () => {
    const qc = newClient();
    const server = slowServer();
    const unsubscribe = new QueryObserver(qc, { queryKey: ['patients'], queryFn: server.queryFn }).subscribe(
      () => {},
    );
    const first = qc.fetchQuery({ queryKey: ['patients'], queryFn: server.queryFn });
    await vi.waitFor(() => expect(server.queryFn).toHaveBeenCalledTimes(1));

    server.change();
    void invalidateFresh(qc, ['patients']);
    server.answerAll();

    await expect(first).resolves.toBe(1);
    await vi.waitFor(() => expect(server.queryFn).toHaveBeenCalledTimes(2));
    server.answerAll();
    await vi.waitFor(() => expect(qc.getQueryData(['patients'])).toBe(2));
    unsubscribe();
  });

  it('leaves alone a prefetch nobody shows yet (read again when a screen shows it)', async () => {
    const qc = newClient();
    const server = slowServer();
    const prefetch = qc.prefetchQuery({ queryKey: ['patients'], queryFn: server.queryFn });
    await vi.waitFor(() => expect(server.queryFn).toHaveBeenCalledTimes(1));

    server.change();
    void invalidateFresh(qc, ['patients']);
    server.answerAll();
    await prefetch;
    await settle();

    expect(server.queryFn).toHaveBeenCalledTimes(1);
    expect(qc.getQueryData(['patients'])).toBe(1);
  });
});
