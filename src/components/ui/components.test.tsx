import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { renderWithIntl } from '@/test/render';
import { resetClockForTests, observeServerTime } from '@/lib/clock';
import { useUiStore } from '@/stores/ui';
import { soundEnabled } from '@/stores/settings';
import { BottomSheet, resolveSnap, snapHeights, type SheetSnap } from './bottom-sheet';
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
  it('computes three snap heights and resolves the nearest one, biased by velocity', () => {
    const h = snapHeights(800, 112);
    expect(h).toEqual({ peek: 112, half: 384, full: 800 });
    expect(resolveSnap(130, 0, h)).toBe('peek');
    expect(resolveSnap(420, 0, h)).toBe('half');
    expect(resolveSnap(420, 1.5, h)).toBe('full');
    expect(resolveSnap(420, -2, h)).toBe('peek');
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
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(sheet).toHaveAttribute('data-snap', 'full');
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(sheet).toHaveAttribute('data-snap', 'peek');
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
  it('sound defaults: on for desktop, explicit choice always wins', () => {
    expect(soundEnabled(null)).toBe(true); // jsdom: no coarse pointer
    expect(soundEnabled(false)).toBe(false);
    expect(soundEnabled(true)).toBe(true);
  });
});
