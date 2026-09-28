import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import type * as SoundModule from '@/lib/sound';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { gameApi } from '@/lib/api/endpoints';
import { ApiClientError } from '@/lib/api/errors';
import { qk } from '@/lib/api/query-keys';
import { useToastStore } from '@/stores/toast';
import { CAREER_ID, INCIDENT_ID, VEHICLE_ID, incident, snapshot, vehicle } from '@/test/fixtures';
import { loadMessagesSync } from '@/test/messages';
import { CareerProvider } from './hooks';
import {
  QUICK_DISPATCH_MIN_UNDO_MS,
  QUICK_DISPATCH_UNDO_MS,
  shouldRecallInstead,
  undoToastMs,
  useQuickDispatch,
} from './quick-dispatch';

vi.mock('@/lib/api/endpoints', () => ({
  gameApi: {
    sync: vi.fn(),
    dispatchOptions: vi.fn(),
    dispatch: vi.fn(),
    cancelDispatch: vi.fn(),
    recallVehicle: vi.fn(),
  },
}));
vi.mock('@/lib/sound', async (importOriginal) => ({
  ...(await importOriginal<typeof SoundModule>()),
  playSound: vi.fn(),
}));

describe('the undo toast of a quick dispatch', () => {
  const now = Date.parse('2026-01-01T10:00:00.000Z');
  const inMs = (ms: number) => new Date(now + ms).toISOString();

  it('lives until the free undo closes: never over 5 s, never under 2.5 s', () => {
    expect(undoToastMs(inMs(6000), now)).toBe(QUICK_DISPATCH_UNDO_MS);
    expect(undoToastMs(inMs(3200), now)).toBe(3200);
    expect(undoToastMs(inMs(800), now)).toBe(QUICK_DISPATCH_MIN_UNDO_MS);
    expect(undoToastMs(inMs(-2000), now)).toBe(QUICK_DISPATCH_MIN_UNDO_MS);
  });

  it('keeps the classic 5 s when there is no free undo at all', () => {
    expect(undoToastMs(null, now)).toBe(QUICK_DISPATCH_UNDO_MS);
    expect(undoToastMs(undefined, now)).toBe(QUICK_DISPATCH_UNDO_MS);
  });

  it('recalls instead only when the server says the free undo is over or gone', () => {
    for (const code of ['CANCEL_WINDOW_EXPIRED', 'DISPATCH_NOT_CANCELLABLE', 'NOT_FOUND'] as const)
      expect(shouldRecallInstead(new ApiClientError({ code, message: code, status: 409 }))).toBe(true);
    expect(shouldRecallInstead(new ApiClientError({ code: 'CONFLICT', message: 'x', status: 409 }))).toBe(
      false,
    );
    expect(shouldRecallInstead(new Error('network'))).toBe(false);
  });
});

describe('useQuickDispatch', () => {
  const messages = loadMessagesSync('it');
  const DISPATCH_ID = 'dsp_01J8Z0000000000000000000AA';
  const pending = incident({ expiresAt: '2026-01-01T10:10:00.000Z' });

  function setup() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(qk.sync(CAREER_ID), snapshot({ incidents: [pending] }));
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <QueryClientProvider client={qc}>
          <CareerProvider value={CAREER_ID}>{children}</CareerProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
    const hook = renderHook(() => useQuickDispatch(), { wrapper });
    return { hook, qc };
  }
  const lastToast = () => useToastStore.getState().toasts.at(-1)!;

  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.mocked(gameApi.dispatchOptions).mockResolvedValue({
      options: [
        {
          vehicleId: VEHICLE_ID,
          etaSeconds: 120,
          distanceMeters: 900,
          dispatchable: true,
          blockedReason: null,
          warnings: [],
          contributes: [],
          recommended: true,
        },
      ],
      recommendedVehicleIds: [VEHICLE_ID],
      recommendationCoversRequired: true,
    } as never);
    vi.mocked(gameApi.dispatch).mockResolvedValue({
      dispatchId: DISPATCH_ID,
      incident: incident({ status: 'RESPONDING', expiresAt: null }),
      vehicles: [vehicle({ status: 'PREPARING', incidentId: INCIDENT_ID })],
      cancellableUntil: new Date(Date.now() + 6000).toISOString(),
    } as never);
  });
  afterEach(() => vi.clearAllMocks());

  it('"Annulla" is the free cancel: the call back with its original deadline, nothing recalled', async () => {
    const { hook, qc } = setup();
    await act(() => hook.result.current.send(pending));
    const sent = lastToast();
    expect(sent.title).toBe('1 mezzo inviato');
    expect(sent.action?.label).toBe('Annulla');
    expect(sent.durationMs).toBeLessThanOrEqual(QUICK_DISPATCH_UNDO_MS);
    vi.mocked(gameApi.cancelDispatch).mockResolvedValue({
      dispatchId: DISPATCH_ID,
      incident: pending,
      vehicles: [vehicle()],
    } as never);
    await act(async () => {
      sent.action!.onClick();
      await vi.waitFor(() => expect(lastToast().title).toBe('Invio annullato'));
    });
    expect(gameApi.cancelDispatch).toHaveBeenCalledWith(CAREER_ID, DISPATCH_ID);
    expect(gameApi.recallVehicle).not.toHaveBeenCalled();
    const after = qc.getQueryData<ReturnType<typeof snapshot>>(qk.sync(CAREER_ID))!;
    expect(after.incidents[0]).toMatchObject({ status: 'PENDING_RESPONSE', expiresAt: pending.expiresAt });
    expect(after.vehicles[0]!.status).toBe('AVAILABLE');
  });

  it('too late for the free cancel: the vehicles are recalled, and the toast says so', async () => {
    const { hook } = setup();
    await act(() => hook.result.current.send(pending));
    const sent = lastToast();
    vi.mocked(gameApi.cancelDispatch).mockRejectedValue(
      new ApiClientError({ code: 'CANCEL_WINDOW_EXPIRED', message: 'late', status: 409 }),
    );
    vi.mocked(gameApi.recallVehicle).mockResolvedValue(vehicle({ status: 'RETURNING' }) as never);
    await act(async () => {
      sent.action!.onClick();
      await vi.waitFor(() =>
        expect(lastToast().title).toBe('Troppo tardi per annullare gratis: mezzi richiamati'),
      );
    });
    expect(gameApi.recallVehicle).toHaveBeenCalledWith(CAREER_ID, VEHICLE_ID);
    expect(lastToast().tone).toBe('warning');
  });

  it('no free undo offered (a patrol car leaves at once): the action is a recall from the start', async () => {
    vi.mocked(gameApi.dispatch).mockResolvedValue({
      dispatchId: DISPATCH_ID,
      incident: incident({ status: 'RESPONDING' }),
      vehicles: [vehicle({ status: 'EN_ROUTE', incidentId: INCIDENT_ID })],
      cancellableUntil: null,
    } as never);
    const { hook } = setup();
    await act(() => hook.result.current.send(pending));
    const sent = lastToast();
    expect(sent.action?.label).toBe('Richiama');
    expect(sent.durationMs).toBe(QUICK_DISPATCH_UNDO_MS);
    vi.mocked(gameApi.recallVehicle).mockResolvedValue(vehicle({ status: 'RETURNING' }) as never);
    await act(async () => {
      sent.action!.onClick();
      await vi.waitFor(() => expect(lastToast().title).toBe('Invio annullato: mezzi richiamati'));
    });
    expect(gameApi.cancelDispatch).not.toHaveBeenCalled();
  });
});
