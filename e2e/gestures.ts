import type { Page } from '@playwright/test';

export interface Point {
  x: number;
  y: number;
}
export interface DragOptions {
  /** Total duration of the movement (ms): short = a flick, long = a slow drag. */
  durationMs?: number;
  steps?: number;
}

/** Chromium can inject REAL touch input (touch-action, native scrolling, pointer events): the Pixel 7 project. */
export const hasCdp = (page: Page): boolean => page.context().browser()?.browserType().name() === 'chromium';

/**
 * One-finger drag. Chromium: genuine touch events through the DevTools protocol, so the browser's own touch-action and
 * scrolling take part exactly as on a phone. WebKit (no DevTools protocol in Playwright): synthetic touch pointer events
 * on the element under the start point — enough for the sheet's gesture logic, not for native scrolling.
 */
export async function touchDrag(page: Page, from: Point, to: Point, opts: DragOptions = {}): Promise<void> {
  const steps = opts.steps ?? 12;
  const durationMs = opts.durationMs ?? 400;
  if (hasCdp(page)) {
    const cdp = await page.context().newCDPSession(page);
    const point = (p: Point) => [{ x: Math.round(p.x), y: Math.round(p.y), id: 1 }];
    // Each event carries its own timestamp: a DevTools round trip takes far longer than a finger's frame, and the
    // sheet measures the release velocity from the events' own times — this keeps a flick a flick.
    const t0 = Date.now() / 1000;
    const at = (i: number) => t0 + (i * durationMs) / steps / 1000;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: point(from),
      timestamp: at(0),
    });
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: point({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }),
        timestamp: at(i),
      });
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
      timestamp: at(steps) + 0.004,
    });
    await cdp.detach();
    // Let the sheet settle before the next gesture.
    await page.waitForTimeout(350);
    return;
  }
  await page.evaluate(
    async ({ from, to, steps, durationMs }) => {
      const target = document.elementFromPoint(from.x, from.y);
      if (!target) throw new Error('nothing under the start point');
      const fire = (type: string, p: { x: number; y: number }) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: 7,
            pointerType: 'touch',
            isPrimary: true,
            clientX: p.x,
            clientY: p.y,
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
          }),
        );
      fire('pointerdown', from);
      for (let i = 1; i <= steps; i++) {
        await new Promise((r) => setTimeout(r, durationMs / steps));
        const t = i / steps;
        fire('pointermove', { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
      }
      fire('pointerup', to);
    },
    { from, to, steps, durationMs },
  );
  await page.waitForTimeout(350);
}

/** A fast, short flick (≈ 1 px/ms, well above the sheet's flick threshold). */
export const flick = (page: Page, from: Point, dy: number): Promise<void> =>
  touchDrag(page, from, { x: from.x, y: from.y + dy }, { durationMs: 70, steps: 5 });
