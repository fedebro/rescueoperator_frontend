import { setupWorker } from 'msw/browser';
import { env } from '@/lib/env';
import { mockBus } from './bus';
import { MockEngine, localStorageAdapter } from './engine';
import { createHandlers } from './handlers';

let started: Promise<MockEngine> | null = null;

/** Starts the MSW worker + the simulation loop once per page. */
export function startMockBackend(): Promise<MockEngine> {
  if (started) return started;
  started = (async () => {
    const override =
      typeof localStorage !== 'undefined' ? Number(localStorage.getItem('rc-mock-speed')) : NaN;
    const engine = new MockEngine({
      storage: localStorageAdapter(),
      speed: override > 0 ? override : env.mockSpeed,
      emit: (e) => mockBus.emit(e),
    });
    const worker = setupWorker(...createHandlers(engine, env.apiUrl));
    await worker.start({
      onUnhandledRequest: 'bypass',
      quiet: true,
      serviceWorker: { url: '/mockServiceWorker.js' },
    });
    // `engine.paused` freezes the wall-clock driver only: explicit QA steps can still advance the simulation.
    setInterval(() => {
      if (!engine.paused) engine.process();
    }, 250);
    (window as unknown as { __rcMock?: MockEngine }).__rcMock = engine;
    return engine;
  })();
  return started;
}
