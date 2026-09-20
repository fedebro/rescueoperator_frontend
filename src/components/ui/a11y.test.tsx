import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { toast, useToastStore } from '@/stores/toast';
import { BottomSheet, type SheetSnap } from './bottom-sheet';
import { DataTable, type Column } from './data-table';
import { Drawer } from './drawer';
import { SectionTitle } from './misc';
import { Toaster } from './toaster';

describe('Toaster live regions', () => {
  it('keeps two persistent regions and routes danger toasts to the assertive one', () => {
    useToastStore.setState({ toasts: [] });
    render(<Toaster closeLabel="Chiudi" />);
    const alert = screen.getByRole('alert');
    const status = screen.getByRole('status');
    expect(alert).toBeEmptyDOMElement(); // present BEFORE any toast: insertions are what gets announced
    expect(status).toBeEmptyDOMElement();
    act(() => {
      toast({ tone: 'danger', title: 'Mezzo in avaria' });
      toast({ tone: 'success', title: 'Consegnato' });
    });
    expect(within(alert).getByText('Mezzo in avaria')).toBeInTheDocument();
    expect(within(status).getByText('Consegnato')).toBeInTheDocument();
    // The cards themselves carry no live role (no double announcement).
    for (const card of screen.getAllByTestId('toast')) expect(card).not.toHaveAttribute('role');
    fireEvent.click(within(alert).getByRole('button', { name: 'Chiudi' }));
    expect(alert).toBeEmptyDOMElement();
  });
});

describe('DataTable keyboard model', () => {
  interface Row {
    id: string;
    n: number;
  }
  const rows: Row[] = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, n: 8 - i }));
  const columns: Column<Row>[] = [
    { id: 'id', header: 'Id', cell: (r) => r.id },
    { id: 'n', header: 'Numero', cell: (r) => r.n, sortValue: (r) => r.n },
  ];

  // jsdom has no layout: give the scroll container a size so the virtualizer has a viewport.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(480);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });
  afterEach(() => vi.restoreAllMocks());

  it('is a single tab stop with arrow / Home / End navigation and Enter activation', async () => {
    const onRowClick = vi.fn();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    render(
      <DataTable
        caption="Prova"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );
    const body = screen.getAllByRole('row').slice(1);
    expect(body.filter((r) => r.tabIndex === 0)).toHaveLength(1);
    expect(body[0]).toHaveAttribute('tabindex', '0');
    body[0]!.focus();
    fireEvent.keyDown(body[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(body[1]);
    expect(body[1]).toHaveAttribute('tabindex', '0');
    expect(body[0]).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(body[1]!, { key: 'End' });
    expect(document.activeElement).toBe(body[7]);
    fireEvent.keyDown(body[7]!, { key: 'Home' });
    expect(document.activeElement).toBe(body[0]);
    fireEvent.keyDown(body[0]!, { key: 'Enter' });
    fireEvent.keyDown(body[0]!, { key: ' ' });
    expect(onRowClick).toHaveBeenCalledTimes(2);
    expect(onRowClick).toHaveBeenLastCalledWith(rows[0]);
  });

  it('exposes aria-sort on sortable headers only and cycles none → ascending → descending → none', () => {
    render(<DataTable caption="Prova" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const [id, numero] = screen.getAllByRole('columnheader');
    expect(id).not.toHaveAttribute('aria-sort');
    expect(numero).toHaveAttribute('aria-sort', 'none');
    const button = within(numero!).getByRole('button', { name: 'Numero' });
    fireEvent.click(button);
    expect(numero).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('r7');
    fireEvent.click(button);
    expect(numero).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(button);
    expect(numero).toHaveAttribute('aria-sort', 'none');
  });
});

describe('BottomSheet keyboard', () => {
  function Harness() {
    const [snap, setSnap] = React.useState<SheetSnap>('half');
    return (
      <BottomSheet snap={snap} onSnapChange={setSnap} handleLabel="Pannello">
        <p>contenuto</p>
      </BottomSheet>
    );
  }
  it('arrows move one snap, Home/End jump, Escape collapses', () => {
    render(<Harness />);
    const sheet = screen.getByRole('region', { name: 'Pannello' });
    const handle = screen.getByTestId('sheet-handle');
    expect(handle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(sheet).toHaveAttribute('data-snap', 'full');
    fireEvent.keyDown(handle, { key: 'Escape' });
    expect(sheet).toHaveAttribute('data-snap', 'peek');
    expect(handle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(sheet).toHaveAttribute('data-snap', 'full');
    fireEvent.keyDown(handle, { key: 'End' });
    expect(sheet).toHaveAttribute('data-snap', 'peek');
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(sheet).toHaveAttribute('data-snap', 'half');
  });
});

describe('Drawer focus management', () => {
  function Harness() {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          apri
        </button>
        <Drawer open={open} onOpenChange={setOpen} title="Pannello laterale" closeLabel="Chiudi">
          <button type="button">dentro</button>
        </Drawer>
      </>
    );
  }
  it('moves focus inside, closes on Escape and restores focus to what opened it (no Radix Trigger involved)', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'apri' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Pannello laterale' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe('heading order', () => {
  it('SectionTitle is an h2 under the page h1 by default, h3 inside a titled panel', () => {
    render(
      <>
        <SectionTitle>Preferenze</SectionTitle>
        <SectionTitle level={3}>Dettagli</SectionTitle>
      </>,
    );
    expect(screen.getByRole('heading', { name: 'Preferenze', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dettagli', level: 3 })).toBeInTheDocument();
  });
});
