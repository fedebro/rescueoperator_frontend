import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IncidentOutcomeDto, SyncSnapshot } from '@/contracts';
import { qk } from '@/lib/api/query-keys';
import { gameApi } from '@/lib/api/endpoints';
import { renderWithIntl } from '@/test/render';
import { CAREER_ID, incident, snapshot } from '@/test/fixtures';
import { CareerProvider } from './hooks';
import {
  forgetFirstShiftIncidents,
  isFirstShiftOutcome,
  lessonBubble,
  rememberFirstShiftIncidents,
  secondsUntil,
  type LessonContext,
} from './first-shift';
import { FirstShiftOutcome } from './first-shift-outcome';
import { OutcomeModal } from './outcome-modal';

const T = Date.parse('2026-01-01T10:00:00.000Z');
const base = (patch: Partial<LessonContext> = {}): LessonContext => ({
  lesson: 'RESPOND',
  incident: { id: 'inc_1', status: 'PENDING_RESPONSE' },
  selected: false,
  page: 'MAP',
  available: 1,
  delivering: 0,
  returning: 0,
  owned: 1,
  ticked: false,
  ...patch,
});

afterEach(() => {
  forgetFirstShiftIncidents();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('lesson bubbles (missions 1–4): one line next to the right control, from the real state', () => {
  it('RESPOND: open the call → send the recommended → watch the story', () => {
    expect(lessonBubble(base())).toMatchObject({
      id: 'openCall',
      selector: expect.stringContaining('inc_1'),
    });
    expect(lessonBubble(base({ selected: true }))).toMatchObject({ id: 'sendRecommended' });
    expect(lessonBubble(base({ incident: { id: 'inc_1', status: 'RESPONDING' } }))?.id).toBe('watchStory');
    expect(lessonBubble(base({ page: 'OTHER' }))).toEqual({ id: 'openCall', action: 'OPEN_CALL' });
  });

  it('CHOOSE_VEHICLE: tick the vehicle, then send it; a vehicle still coming home is redirected', () => {
    const c = base({ lesson: 'CHOOSE_VEHICLE', selected: true });
    expect(lessonBubble(c)?.id).toBe('tickVehicle');
    expect(lessonBubble({ ...c, ticked: true })?.id).toBe('sendChosen');
    expect(lessonBubble({ ...c, available: 0, returning: 1 })?.id).toBe('redirectHere');
    expect(lessonBubble({ ...c, incident: { id: 'inc_1', status: 'RESPONDING' } })).toBeNull();
  });

  it('MULTI_VEHICLE: open the call → to the shop → buy the second engine → back to the call → send both', () => {
    const c = base({ lesson: 'MULTI_VEHICLE' });
    expect(lessonBubble(c)?.id).toBe('openCall');
    expect(lessonBubble({ ...c, selected: true })).toMatchObject({ id: 'needSecond', action: 'GO_SHOP' });
    expect(lessonBubble({ ...c, page: 'SHOP' })).toMatchObject({
      id: 'buySecond',
      selector: expect.stringContaining('FIRE_APS'),
    });
    expect(lessonBubble({ ...c, page: 'SHOP', owned: 2, delivering: 1 })).toMatchObject({
      id: 'backToCall',
      action: 'BACK_TO_CALL',
    });
    expect(lessonBubble({ ...c, owned: 2, delivering: 1, selected: true })?.id).toBe('delivering');
    expect(lessonBubble({ ...c, owned: 2, available: 2, selected: true })?.id).toBe('sendBoth');
  });

  it('REDIRECT: «Reindirizza qui» on the engine on its way home; FREE: no bubbles', () => {
    expect(
      lessonBubble(base({ lesson: 'REDIRECT', selected: true, available: 0, returning: 2 })),
    ).toMatchObject({ id: 'redirectHere', selector: expect.stringContaining('chain-') });
    expect(lessonBubble(base({ lesson: 'FREE', selected: true }))).toBeNull();
  });

  it('first-shift outcomes are told apart, also once the shift is over', () => {
    rememberFirstShiftIncidents([
      { id: 'inc_5', firstShift: { mission: 5, lesson: 'FREE', arrivalCapSeconds: 30 } },
    ]);
    expect(isFirstShiftOutcome({ incidentId: 'inc_5' }, { firstShift: null })).toBe(true);
    expect(isFirstShiftOutcome({ incidentId: 'inc_x' }, { firstShift: null })).toBe(false);
    expect(
      isFirstShiftOutcome(
        { incidentId: 'inc_x' },
        { firstShift: { mission: 2, completed: 1, guided: true, nextCallAt: null } },
      ),
    ).toBe(true);
    expect(secondsUntil(new Date(T + 7_200).toISOString(), T)).toBe(8);
    expect(secondsUntil(null, T)).toBeNull();
  });
});

const outcome = (patch: Partial<IncidentOutcomeDto> = {}): IncidentOutcomeDto => ({
  incidentId: 'inc_1',
  result: 'SUCCESS',
  stars: 3,
  responseSeconds: 12,
  durationSeconds: 40,
  grossCredits: '120',
  costs: [],
  netCredits: '120',
  xp: '10',
  reputationDelta: 2,
  notes: [],
  ...patch,
});

function renderOutcome(snap: SyncSnapshot) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(qk.sync(CAREER_ID), snap);
  renderWithIntl(
    <QueryClientProvider client={qc}>
      <CareerProvider value={CAREER_ID}>
        <OutcomeModal />
        <FirstShiftOutcome />
      </CareerProvider>
    </QueryClientProvider>,
  );
  return qc;
}

describe('first-shift outcome: short, celebrated, nothing to close', () => {
  it('shows the card with the countdown to the next call instead of the dialog, and acknowledges at once', async () => {
    vi.useFakeTimers({ now: T });
    const ack = vi.spyOn(gameApi, 'ackOutcome').mockResolvedValue(undefined as never);
    const snap = snapshot();
    rememberFirstShiftIncidents([
      incident({ id: 'inc_1', firstShift: { mission: 1, lesson: 'RESPOND', arrivalCapSeconds: 20 } }),
    ]);
    renderOutcome({
      ...snap,
      career: {
        ...snap.career,
        firstShift: { mission: 2, completed: 1, guided: true, nextCallAt: new Date(T + 8_000).toISOString() },
      },
      pendingOutcomes: [outcome()],
    });
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.queryByTestId('outcome-modal')).toBeNull();
    const card = screen.getByTestId('first-shift-outcome');
    expect(card).toHaveAttribute('data-mission', '1');
    expect(screen.getByTestId('first-shift-outcome-title')).toHaveTextContent('Missione 1 completata!');
    expect(screen.getByTestId('first-shift-next-call')).toHaveTextContent(/Nuova chiamata tra \d s…/);
    expect(card).toHaveTextContent('Hai risposto subito');
    expect(ack).toHaveBeenCalledWith(CAREER_ID, 'inc_1');
  });

  it('keeps the dialog for outcomes outside the first shift', () => {
    renderOutcome(snapshot({ pendingOutcomes: [outcome({ incidentId: 'inc_9' })] }));
    expect(screen.getByTestId('outcome-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('first-shift-outcome')).toBeNull();
  });
});
