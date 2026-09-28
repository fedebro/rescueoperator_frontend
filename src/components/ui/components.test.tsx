import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { renderWithIntl } from '@/test/render';
import { resetClockForTests, observeServerTime } from '@/lib/clock';
import { useUiStore } from '@/stores/ui';
import { soundEnabled } from '@/stores/settings';
import {
  BottomSheet,
  SHEET_GESTURE,
  nextTapSnap,
  releaseVelocity,
  resolveSnap,
  snapHeights,
  type SheetSnap,
} from './bottom-sheet';
import { Button, IconButton } from './button';
import { CapabilityBar } from './capability-bar';
import { Countdown } from './countdown';
import { CreditAmount } from './credit-amount';
import { DataTable } from './data-table';
import { OtpInput } from './otp-input';
import { SeverityBadge } from './severity-badge';
import { StatusChip } from './status-chip';

function Otp({ onComplete }: { onComplete?: (v: string) => void }) {
  const [v, setV] = React.useState('');
  return <OtpInput label="Codice" value={v} onChange={setV} onComplete={onComplete} />;
}

describe('OtpInput', () => {
  it('types digit by digit, ignores letters and completes', async () => {
    const onComplete = vi.fn();
    render(<Otp onComplete={onComplete} />);
    await userEvent.click(screen.getByTestId('otp-0'));
    await userEvent.keyboard('12a345');
    expect(onComplete).not.toHaveBeenCalled();
    await userEvent.keyboard('6');
    expect(onComplete).toHaveBeenCalledWith('123456');
    expect(screen.getByTestId('otp-5')).toHaveValue('6');
  });
  it('supports paste with separators and backspace navigation', async () => {
    const onComplete = vi.fn();
    render(<Otp onComplete={onComplete} />);
    await userEvent.click(screen.getByTestId('otp-0'));
    await userEvent.paste('123 456');
    expect(onComplete).toHaveBeenCalledWith('123456');
    await userEvent.keyboard('{Backspace}{Backspace}');
    expect(screen.getByTestId('otp-5')).toHaveValue('');
    expect(screen.getByTestId('otp-4')).toHaveValue('');
    expect(screen.getByTestId('otp-3')).toHaveValue('4');
  });
  it('labels every box for assistive tech', () => {
    render(<Otp />);
    expect(screen.getByRole('group', { name: 'Codice' })).toBeInTheDocument();
    expect(screen.getByLabelText('Codice 3/6')).toBeInTheDocument();
  });
});

describe('status is never colour alone', () => {
  it('SeverityBadge exposes the number visually and to screen readers', () => {
    render(<SeverityBadge severity={8} label="Gravità" escalating />);
    const badge = screen.getByRole('img', { name: 'Gravità 8/10' });
    expect(badge).toHaveTextContent('8');
    expect(badge).toHaveTextContent('▲');
  });
  it('StatusChip always renders a text label and an icon', () => {
    const { container } = render(<StatusChip status="EN_ROUTE" label="In viaggio" />);
    expect(screen.getByText('In viaggio')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
    render(<StatusChip status="SOMETHING_NEW" label="Nuovo stato" />);
    expect(screen.getByText('Nuovo stato')).toBeInTheDocument();
  });
  it('CapabilityBar describes required / on scene / en route in its accessible name', () => {
    const legend = {
      onScene: 'Sul posto',
      enRoute: 'In viaggio',
      planned: 'Selezionati',
      required: 'Necessario',
    };
    render(
      <CapabilityBar
        label="Spegnimento"
        required={90}
        onScene={75}
        enRoute={35}
        planned={10}
        level="REQUIRED"
        levelLabel="Necessario"
        legend={legend}
      />,
    );
    expect(
      screen.getByRole('img', {
        name: 'Spegnimento: Sul posto 75, In viaggio 35, Selezionati 10, Necessario 90',
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('capability-bar')).toHaveAttribute('data-covered', 'false');
  });
});

describe('buttons', () => {
  it('IconButton requires and exposes an accessible name; loading disables', async () => {
    const onClick = vi.fn();
    render(
      <>
        <IconButton label="Chiudi" onClick={onClick}>
          x
        </IconButton>
        <Button loading onClick={onClick}>
          Invia
        </Button>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Invia' })).toBeDisabled();
  });
});

describe('CreditAmount & Countdown', () => {
  it('formats credits with the locale and a sign', () => {
    renderWithIntl(<CreditAmount value="-12500" sign label="Crediti" />);
    expect(screen.getByLabelText('−12.500 Crediti')).toBeInTheDocument();
  });
  it('counts down against the SERVER clock, not the device clock', () => {
    vi.useFakeTimers();
    try {
      resetClockForTests();
      const target = new Date(Date.now() + 120_000).toISOString();
      observeServerTime(new Date(Date.now() + 60_000).toISOString()); // the server is one minute ahead
      render(<Countdown to={target} doneLabel="ora" />);
      expect(screen.getByTestId('countdown')).toHaveTextContent('1:00');
      act(() => {
        vi.advanceTimersByTime(61_000);
      });
      expect(screen.getByTestId('countdown')).toHaveTextContent('ora');
    } finally {
      vi.useRealTimers();
      resetClockForTests();
    }
  });
});

describe('BottomSheet', () => {
  it('computes three snap heights (half ≈ 55%) and resolves a slow release to the nearest one', () => {
    const h = snapHeights(800, 112);
    expect(h).toEqual({ peek: 112, half: 440, full: 800 });
    expect(resolveSnap(130, 0, h)).toBe('peek');
    expect(resolveSnap(420, 0, h)).toBe('half');
    expect(resolveSnap(700, 0.2, h)).toBe('full'); // slower than a flick: still the nearest
  });
  it('a flick moves exactly one snap from where the sheet is — never skipping half', () => {
    const h = snapHeights(800, 112);
    const fast = SHEET_GESTURE.flickVelocity + 0.5;
    expect(resolveSnap(444, fast, h)).toBe('full'); // 4 px above half = "at half": one step up
    expect(resolveSnap(444, -fast, h)).toBe('peek'); // … and one step down
    expect(resolveSnap(400, fast, h)).toBe('half'); // below half, flicked up: half first
    expect(resolveSnap(150, fast, h)).toBe('half'); // from near peek: half, not full
    expect(resolveSnap(760, -fast, h)).toBe('half'); // from near full: half, never straight to peek
    expect(resolveSnap(600, fast, h)).toBe('full'); // a long drag that already passed half can go on
    expect(resolveSnap(300, -fast, h)).toBe('peek');
  });
  it('two-snap screens (landscape phones) only know peek and full', () => {
    const h = snapHeights(300, 150);
    expect(resolveSnap(200, 0, h, ['peek', 'full'])).toBe('peek');
    expect(resolveSnap(200, 1, h, ['peek', 'full'])).toBe('full');
    expect(nextTapSnap('peek', ['peek', 'full'])).toBe('full');
    expect(nextTapSnap('full', ['peek', 'full'])).toBe('peek');
  });
  it('the tap cycle is peek → half → full → half', () => {
    expect(nextTapSnap('peek')).toBe('half');
    expect(nextTapSnap('half')).toBe('full');
    expect(nextTapSnap('full')).toBe('half');
  });
  it('averages the release velocity over the last window, and a finger that rested has no velocity', () => {
    // Only the samples of the last 90 ms count: 60 px upwards in 80 ms = 0.75 px/ms (the slow start is ignored).
    const samples = [
      { t: 0, y: 500 },
      { t: 200, y: 490 },
      { t: 220, y: 450 },
      { t: 260, y: 420 },
      { t: 300, y: 390 },
    ];
    expect(releaseVelocity(samples, 300)).toBeCloseTo(60 / 80, 5);
    expect(releaseVelocity(samples, 600)).toBe(0);
    expect(releaseVelocity([{ t: 0, y: 10 }], 5)).toBe(0);
  });
  it('cycles snaps from the handle and with the arrow keys', async () => {
    const Harness = () => {
      const [s, set] = React.useState<SheetSnap>('peek');
      return (
        <BottomSheet snap={s} onSnapChange={set} handleLabel="Pannello">
          <p>contenuto</p>
        </BottomSheet>
      );
    };
    render(<Harness />);
    const handle = screen.getByRole('button', { name: 'Pannello' });
    const sheet = screen.getByRole('region', { name: 'Pannello' });
    expect(sheet).toHaveAttribute('data-snap', 'peek');
    await userEvent.click(handle);
    expect(sheet).toHaveAttribute('data-snap', 'half');
    await userEvent.click(handle);
    expect(sheet).toHaveAttribute('data-snap', 'full');
    // From full a tap goes back to half, never straight down to peek.
    await userEvent.click(handle);
    expect(sheet).toHaveAttribute('data-snap', 'half');
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(sheet).toHaveAttribute('data-snap', 'full');
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(sheet).toHaveAttribute('data-snap', 'peek');
  });
  it('a tap on the strip header cycles too, a tap on a button inside it does not', async () => {
    const onButton = vi.fn();
    const Harness = () => {
      const [s, set] = React.useState<SheetSnap>('peek');
      return (
        <BottomSheet
          snap={s}
          onSnapChange={set}
          handleLabel="Pannello"
          header={
            <div>
              <span>3 emergenze</span>
              <button type="button" onClick={onButton}>
                In servizio
              </button>
            </div>
          }
        >
          <p>contenuto</p>
        </BottomSheet>
      );
    };
    render(<Harness />);
    const sheet = screen.getByRole('region', { name: 'Pannello' });
    await userEvent.click(screen.getByText('3 emergenze'));
    expect(sheet).toHaveAttribute('data-snap', 'half');
    await userEvent.click(screen.getByRole('button', { name: 'In servizio' }));
    expect(onButton).toHaveBeenCalledTimes(1);
    expect(sheet).toHaveAttribute('data-snap', 'half');
  });
  it('shows the collapse button only in full, and it goes back to half', async () => {
    const Harness = () => {
      const [s, set] = React.useState<SheetSnap>('full');
      return (
        <BottomSheet snap={s} onSnapChange={set} handleLabel="Pannello" collapseLabel="Riduci">
          <p>contenuto</p>
        </BottomSheet>
      );
    };
    render(<Harness />);
    const sheet = screen.getByRole('region', { name: 'Pannello' });
    await userEvent.click(screen.getByTestId('sheet-collapse'));
    expect(sheet).toHaveAttribute('data-snap', 'half');
    expect(screen.queryByTestId('sheet-collapse')).not.toBeInTheDocument();
  });
});

describe('DataTable', () => {
  it('virtualizes large data sets and sorts by column', async () => {
    // jsdom has no layout: give the scroll container a height so the virtualizer has a viewport.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(480);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
    const rows = Array.from({ length: 5000 }, (_, i) => ({ id: `r${i}`, n: (i * 7919) % 5000 }));
    render(
      <DataTable
        caption="Numeri"
        rows={rows}
        rowKey={(r) => r.id}
        columns={[{ id: 'n', header: 'N', cell: (r) => `n${r.n}`, sortValue: (r) => r.n }]}
      />,
    );
    expect(screen.getByRole('table', { name: 'Numeri' })).toHaveAttribute('aria-rowcount', '5001');
    expect(screen.getAllByRole('row').length).toBeLessThan(80);
    await userEvent.click(screen.getByRole('button', { name: 'N' }));
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('n0');
    expect(screen.getByRole('columnheader', { name: 'N' })).toHaveAttribute('aria-sort', 'ascending');
    vi.restoreAllMocks();
  });
});

describe('stores', () => {
  it('keeps a single selection and opens the sheet to half on select', () => {
    const s = useUiStore.getState();
    s.select({ kind: 'incident', id: 'a' }, { focus: [14, 42] });
    expect(useUiStore.getState().selection).toEqual({ kind: 'incident', id: 'a' });
    expect(useUiStore.getState().sheetSnap).toBe('half');
    expect(useUiStore.getState().focusRequest?.center).toEqual([14, 42]);
    useUiStore.getState().select({ kind: 'vehicle', id: 'v' });
    expect(useUiStore.getState().selection).toEqual({ kind: 'vehicle', id: 'v' });
    useUiStore.getState().clearSelection();
    expect(useUiStore.getState()).toMatchObject({ selection: null, sheetSnap: 'peek' });
  });
  it('closing the inspector returns the sheet to the height the list had, however many inspectors were opened', () => {
    const ui = useUiStore.getState();
    ui.setSheetSnap('full');
    ui.select({ kind: 'incident', id: 'a' });
    expect(useUiStore.getState()).toMatchObject({ sheetSnap: 'half', sheetRestore: 'full' });
    useUiStore.getState().setSheetSnap('peek'); // the player lowers the inspector
    useUiStore.getState().select({ kind: 'vehicle', id: 'v' }); // then opens an assigned vehicle
    expect(useUiStore.getState()).toMatchObject({ sheetSnap: 'half', sheetRestore: 'full' });
    useUiStore.getState().clearSelection();
    expect(useUiStore.getState()).toMatchObject({ selection: null, sheetSnap: 'full', sheetRestore: null });
    // A tap on the empty map lowers the sheet but keeps the selection.
    useUiStore.getState().select({ kind: 'incident', id: 'b' });
    useUiStore.getState().lowerSheet();
    expect(useUiStore.getState()).toMatchObject({
      selection: { kind: 'incident', id: 'b' },
      sheetSnap: 'peek',
    });
    useUiStore.getState().showQueue('peek');
    expect(useUiStore.getState()).toMatchObject({ selection: null, sheetSnap: 'peek', sheetRestore: null });
  });
  it('sound defaults: on for desktop, explicit choice always wins', () => {
    expect(soundEnabled(null)).toBe(true); // jsdom: no coarse pointer
    expect(soundEnabled(false)).toBe(false);
    expect(soundEnabled(true)).toBe(true);
  });
});
