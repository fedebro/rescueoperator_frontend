import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { renderWithIntl } from '@/test/render';
import { resetClockForTests } from '@/lib/clock';
import { KEYBOARD_MIN_PX, readVisualViewport, useVisualViewport } from '@/hooks/use-visual-viewport';
import { KeyboardAwareScreen } from './keyboard-aware-screen';
import { Textarea } from './textarea';
import { TimeAgo, formatRelative, relativeTime } from './time-ago';
import { VirtualList, type VirtualListHandle } from './virtual-list';

function Composer({ max = 20 }: { max?: number }) {
  const [v, setV] = React.useState('');
  return (
    <Textarea
      aria-label="Messaggio"
      value={v}
      onChange={(e) => setV(e.target.value)}
      maxLength={max}
      counter
      autoGrow
    />
  );
}

describe('Textarea', () => {
  it('counts characters, links the counter to the field and stops at the limit', async () => {
    render(<Composer max={10} />);
    const field = screen.getByRole('textbox', { name: 'Messaggio' });
    expect(screen.getByTestId('textarea-counter')).toHaveTextContent('0 / 10');
    expect(field).toHaveAttribute('aria-describedby', screen.getByTestId('textarea-counter').id);
    expect(field).toHaveAttribute('maxlength', '10');
    await userEvent.type(field, 'ciao a tutti quanti');
    expect(field).toHaveValue('ciao a tut');
    expect(screen.getByTestId('textarea-counter')).toHaveTextContent('10 / 10');
    expect(screen.getByTestId('textarea-counter')).toHaveClass('text-warning');
  });
  it('is 16 px on touch screens and never marks a value within the limit invalid', () => {
    render(<Composer />);
    const field = screen.getByRole('textbox', { name: 'Messaggio' });
    expect(field.className).toContain('pointer-coarse:text-base');
    expect(field).not.toHaveAttribute('aria-invalid');
  });
});

describe('relativeTime', () => {
  const MIN = 60_000;
  it('says now, minutes, hours, days, then gives up to the date', () => {
    expect(relativeTime(10_000)).toEqual({ value: 0, unit: 'second' });
    expect(relativeTime(5 * MIN)).toEqual({ value: -5, unit: 'minute' });
    expect(relativeTime(3 * 60 * MIN)).toEqual({ value: -3, unit: 'hour' });
    expect(relativeTime(26 * 60 * MIN)).toEqual({ value: -1, unit: 'day' });
    expect(relativeTime(8 * 24 * 60 * MIN)).toBeNull();
    // The future (an invite expiring in 2 hours) reads the other way round.
    expect(relativeTime(-2 * 60 * MIN)).toEqual({ value: 2, unit: 'hour' });
  });
  it('formats in the viewer language and falls back to the full date', () => {
    const now = Date.parse('2026-10-06T12:00:00.000Z');
    expect(formatRelative('2026-10-06T11:55:00.000Z', now, 'it')).toBe('5 minuti fa');
    expect(formatRelative('2026-10-06T11:59:50.000Z', now, 'it')).toBe('ora');
    expect(formatRelative('2026-10-05T11:00:00.000Z', now, 'it')).toBe('ieri');
    expect(formatRelative('2026-10-06T11:55:00.000Z', now, 'en')).toBe('5 minutes ago');
    expect(formatRelative('2026-09-01T10:00:00.000Z', now, 'it', 'Europe/Rome')).toMatch(/2026/);
  });
});

describe('TimeAgo', () => {
  beforeEach(() => {
    resetClockForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());
  it('renders a <time> with the machine instant, the words, and refreshes', () => {
    renderWithIntl(<TimeAgo at="2026-10-06T11:59:40.000Z" intervalMs={1000} />);
    const time = screen.getByText('ora');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2026-10-06T11:59:40.000Z');
    expect(time).toHaveAttribute('title');
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText('1 minuto fa')).toBeInTheDocument();
  });
});

/** A stand-in for `window.visualViewport`. */
class FakeViewport extends EventTarget {
  width = 390;
  height = 844;
  offsetTop = 0;
  offsetLeft = 0;
  resize(height: number, offsetTop = 0) {
    this.height = height;
    this.offsetTop = offsetTop;
    this.dispatchEvent(new Event('resize'));
  }
}

function setViewport(vv: FakeViewport | null, innerHeight = 844) {
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true, writable: true });
}

describe('useVisualViewport / KeyboardAwareScreen', () => {
  afterEach(() => setViewport(null, 768));
  it('reads the visual viewport and tells a keyboard from a toolbar', () => {
    const vv = new FakeViewport();
    setViewport(vv);
    expect(readVisualViewport()).toMatchObject({
      height: 844,
      bottomInset: 0,
      keyboardOpen: false,
      supported: true,
    });
    vv.height = 844 - 80; // a browser bar sliding in
    expect(readVisualViewport()).toMatchObject({ bottomInset: 80, keyboardOpen: false });
    vv.height = 844 - 336; // a keyboard
    expect(readVisualViewport()).toMatchObject({ bottomInset: 336, keyboardOpen: true });
    expect(KEYBOARD_MIN_PX).toBeGreaterThan(80);
  });
  it('falls back to the layout viewport when the API is missing', () => {
    setViewport(null, 700);
    expect(readVisualViewport()).toMatchObject({ height: 700, supported: false, keyboardOpen: false });
  });
  it('sizes the screen to the visible area and lifts the footer above the keyboard', () => {
    const vv = new FakeViewport();
    setViewport(vv);
    function Probe() {
      const v = useVisualViewport();
      return <span data-testid="probe">{v.keyboardOpen ? 'open' : 'closed'}</span>;
    }
    render(
      <KeyboardAwareScreen header={<h1>Chat</h1>} footer={<input aria-label="Scrivi" />}>
        <Probe />
      </KeyboardAwareScreen>,
    );
    const screenEl = screen.getByTestId('keyboard-aware-screen');
    expect(screenEl).toHaveStyle({ height: '844px' });
    expect(screenEl).toHaveAttribute('data-keyboard', 'closed');
    expect(screenEl.querySelector('footer')).toHaveClass('pb-safe');
    act(() => vv.resize(508, 40));
    expect(screenEl).toHaveStyle({ height: '508px', transform: 'translateY(40px)' });
    expect(screenEl).toHaveAttribute('data-keyboard', 'open');
    expect(screen.getByTestId('probe')).toHaveTextContent('open');
    // No home-indicator padding while the keys are there: the composer touches the keyboard.
    expect(screenEl.querySelector('footer')).not.toHaveClass('pb-safe');
    act(() => vv.resize(844, 0));
    expect(screenEl).toHaveAttribute('data-keyboard', 'closed');
  });
});

/**
 * jsdom has no layout. The virtualizer sizes its container and its rows through `offsetHeight` and follows the scroll
 * position through `scroll` events: the container is 600 px tall, every row 40 px, and `scrollTo` moves + notifies.
 */
function mockLayout() {
  const isList = (el: HTMLElement) => el.dataset.testid === 'virtual-list';
  const positions = new WeakMap<Element, number>();
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.index !== undefined ? 40 : isList(this) ? 600 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(360);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return isList(this) ? 600 : 40;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (!isList(this)) return 0;
    const inner = this.querySelector<HTMLElement>(':scope > div[style]');
    return Number(inner?.style.height.replace('px', '') ?? 0);
  });
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockImplementation(function (this: HTMLElement) {
    return positions.get(this) ?? 0;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(function (
    this: HTMLElement,
    v: number,
  ) {
    positions.set(this, v);
  });
  Element.prototype.scrollTo = function (this: Element, a?: ScrollToOptions | number, b?: number) {
    const top = typeof a === 'object' ? (a?.top ?? 0) : (b ?? 0);
    positions.set(this, top);
    this.dispatchEvent(new Event('scroll'));
  } as Element['scrollTo'];
}

const lines = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => `m${from + i}`);

describe('VirtualList', () => {
  beforeEach(mockLayout);
  afterEach(() => vi.restoreAllMocks());

  it('renders only a window of a long list', () => {
    const items = lines(0, 500);
    render(
      <div style={{ position: 'relative', height: 600 }}>
        <VirtualList items={items} getKey={(s) => s} renderItem={(s) => <p>{s}</p>} estimateSize={40} />
      </div>,
    );
    const rendered = screen.getAllByRole('listitem').length;
    expect(rendered).toBeGreaterThan(10);
    expect(rendered).toBeLessThan(60);
    expect(screen.getByText('m0')).toBeInTheDocument();
    expect(screen.queryByText('m400')).toBeNull();
  });

  it('reverse mode: asks for earlier items near the top, once per page, and keeps the earlier edge busy', async () => {
    const onLoadMore = vi.fn();
    const items = lines(100, 200);
    const { rerender } = render(
      <div style={{ position: 'relative', height: 600 }}>
        <VirtualList
          items={items}
          getKey={(s) => s}
          renderItem={(s) => <p>{s}</p>}
          estimateSize={40}
          reverse
          hasMore
          onLoadMore={onLoadMore}
          loader={<span>…</span>}
        />
      </div>,
    );
    const list = screen.getByTestId('virtual-list');
    // The opening scroll to the end has to settle first: nothing is asked for while the list is still being positioned.
    expect(onLoadMore).not.toHaveBeenCalled();
    await act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
    list.scrollTop = 3000;
    fireEvent.scroll(list);
    expect(onLoadMore).not.toHaveBeenCalled();
    list.scrollTop = 100;
    fireEvent.scroll(list);
    fireEvent.scroll(list);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    rerender(
      <div style={{ position: 'relative', height: 600 }}>
        <VirtualList
          items={items}
          getKey={(s) => s}
          renderItem={(s) => <p>{s}</p>}
          estimateSize={40}
          reverse
          hasMore
          loadingMore
          onLoadMore={onLoadMore}
          loader={<span>…</span>}
        />
      </div>,
    );
    expect(list).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('…')).toBeInTheDocument();
  });

  it('reverse mode: reports new items below when the viewer is not at the end, follows when they are', async () => {
    const onNewBelow = vi.fn();
    const onEndStateChange = vi.fn();
    const handle = React.createRef<VirtualListHandle>();
    const view = (items: string[]) => (
      <div style={{ position: 'relative', height: 600 }}>
        <VirtualList
          ref={handle}
          items={items}
          getKey={(s) => s}
          renderItem={(s) => <p>{s}</p>}
          estimateSize={40}
          reverse
          onNewBelow={onNewBelow}
          onEndStateChange={onEndStateChange}
        />
      </div>
    );
    const { rerender } = render(view(lines(0, 100)));
    const list = screen.getByTestId('virtual-list');
    // The opening landing settles on the next frame; scroll events before that belong to the core's positioning.
    await act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
    // Opened at the end.
    expect(handle.current?.isAtEnd()).toBe(true);
    // Scroll up: away from the end.
    list.scrollTop = 0;
    fireEvent.scroll(list);
    expect(onEndStateChange).toHaveBeenLastCalledWith(false);
    rerender(view(lines(0, 103)));
    expect(onNewBelow).toHaveBeenCalledWith(3);
    // Back at the end: appends are followed, not reported.
    act(() => handle.current?.scrollToEnd());
    fireEvent.scroll(list);
    expect(onEndStateChange).toHaveBeenLastCalledWith(true);
    onNewBelow.mockClear();
    rerender(view(lines(0, 105)));
    expect(onNewBelow).not.toHaveBeenCalled();
    // A prepend (earlier page) never counts as "new below".
    rerender(view(lines(-50, 105)));
    expect(onNewBelow).not.toHaveBeenCalled();
  });
});
