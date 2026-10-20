import type { CareerSummary, IncidentDto, IncidentOutcomeDto } from '@/contracts';

/**
 * Primo turno (D-148, study 2026-10-20): the first 5 missions of a new career. Pure helpers shared by the outcome card, the
 * tutorial bubbles and the tests. The server owns the rules; the client only reads `career.firstShift` and
 * `incident.firstShift`.
 */
export type FirstShift = NonNullable<CareerSummary['firstShift']>;
export type IncidentFirstShift = NonNullable<IncidentDto['firstShift']>;
export type FirstShiftLesson = IncidentFirstShift['lesson'];

/** Lessons the tutorial bubbles accompany (missions 1–4); mission 5 is played without guidance. */
export const GUIDED_LESSONS: FirstShiftLesson[] = ['RESPOND', 'CHOOSE_VEHICLE', 'MULTI_VEHICLE', 'REDIRECT'];

/**
 * Remembers which incidents were first-shift calls (their lesson and mission), so the outcome that arrives once the incident
 * has left the world can still be told apart — also for the 5th one, after which `career.firstShift` may already be null.
 * Module-level on purpose: it must outlive the components that saw the incident.
 */
const known = new Map<string, IncidentFirstShift>();

export function rememberFirstShiftIncidents(incidents: Pick<IncidentDto, 'id' | 'firstShift'>[]): void {
  for (const i of incidents) if (i.firstShift) known.set(i.id, i.firstShift);
}

export function firstShiftOf(incidentId: string): IncidentFirstShift | null {
  return known.get(incidentId) ?? null;
}

/** Test helper. */
export function forgetFirstShiftIncidents(): void {
  known.clear();
}

/**
 * True when an outcome belongs to the first shift: its incident was a first-shift call, or the shift is still running (one
 * call at a time: every outcome is one of its missions).
 */
export function isFirstShiftOutcome(
  outcome: Pick<IncidentOutcomeDto, 'incidentId'>,
  career: Pick<CareerSummary, 'firstShift'>,
): boolean {
  return known.has(outcome.incidentId) || !!career.firstShift;
}

/** Whole seconds left until `at` (ISO), never negative; null without a time. */
export function secondsUntil(at: string | null | undefined, now: number): number | null {
  if (!at) return null;
  return Math.max(0, Math.ceil((Date.parse(at) - now) / 1000));
}

/** Which first-shift lesson is open right now (the call waiting or being worked), if any. */
export function currentLessonIncident(incidents: IncidentDto[]): IncidentDto | null {
  return (
    incidents
      .filter(
        (i) => i.firstShift && ['PENDING_RESPONSE', 'RESPONDING', 'ON_SCENE', 'RESOLVING'].includes(i.status),
      )
      .sort((a, b) => (b.firstShift?.mission ?? 0) - (a.firstShift?.mission ?? 0))[0] ?? null
  );
}

/** The one-line bubbles of the guided missions 1–4 (message keys `firstShift.bubble.<id>`). */
export type BubbleId =
  | 'openCall'
  | 'sendRecommended'
  | 'watchStory'
  | 'tickVehicle'
  | 'sendChosen'
  | 'redirectHere'
  | 'needSecond'
  | 'buySecond'
  | 'delivering'
  | 'backToCall'
  | 'sendBoth';
export type BubbleAction = 'OPEN_CALL' | 'GO_SHOP' | 'BACK_TO_CALL';

export interface Bubble {
  id: BubbleId;
  /** CSS selector of the control it stands next to; absent = docked (with its action button). */
  selector?: string;
  action?: BubbleAction;
}

export interface LessonContext {
  lesson: FirstShiftLesson;
  incident: Pick<IncidentDto, 'id' | 'status'>;
  /** The call is open in the inspector. */
  selected: boolean;
  /** Where the player is. */
  page: 'MAP' | 'SHOP' | 'OTHER';
  /** Own vehicles that could go now / are being delivered / are on their way home. */
  available: number;
  delivering: number;
  returning: number;
  /** Fire engines owned (delivered or not): the MULTI_VEHICLE lesson buys the second one. */
  owned: number;
  /** A vehicle is ticked in the dispatch list (the CHOOSE_VEHICLE lesson). */
  ticked: boolean;
}

const SEND = '[data-tutorial="send-recommended"]';
const CHAIN = '[data-testid="chain-resend"], [data-testid="chain-redirect"]';

/**
 * Which bubble the guided lesson shows now — derived from the real state only (the call, the fleet, the page, the selection),
 * never from a "next" button: every bubble points at the one thing to do and moves on when it is done.
 */
export function lessonBubble(ctx: LessonContext): Bubble | null {
  const { lesson, incident } = ctx;
  if (lesson === 'FREE') return null;
  const card = `[data-testid="incident-card"][data-incident-id="${incident.id}"]`;
  if (incident.status !== 'PENDING_RESPONSE')
    return lesson === 'RESPOND' && (incident.status === 'RESPONDING' || incident.status === 'ON_SCENE')
      ? { id: 'watchStory', selector: '[data-testid="live-story"], [data-testid="live-strip"]' }
      : null;

  if (lesson === 'MULTI_VEHICLE') {
    if (ctx.owned < 2) {
      if (ctx.page === 'SHOP')
        return {
          id: 'buySecond',
          selector: '[data-testid="vehicle-offer"][data-code="FIRE_APS"] [data-tutorial="buy-vehicle"]',
        };
      if (ctx.page !== 'MAP' || !ctx.selected)
        return ctx.page === 'MAP'
          ? { id: 'openCall', selector: card }
          : { id: 'openCall', action: 'OPEN_CALL' };
      return { id: 'needSecond', selector: '[data-tutorial="nav-shop"]', action: 'GO_SHOP' };
    }
    if (ctx.page === 'SHOP' || ctx.page === 'OTHER') return { id: 'backToCall', action: 'BACK_TO_CALL' };
    if (!ctx.selected) return { id: 'openCall', selector: card };
    if (ctx.delivering > 0) return { id: 'delivering', selector: '[data-testid="inspector-footer"]' };
    if (ctx.available >= 2) return { id: 'sendBoth', selector: SEND };
    if (ctx.returning > 0) return { id: 'redirectHere', selector: CHAIN };
    return ctx.available > 0 ? { id: 'sendRecommended', selector: SEND } : null;
  }

  if (ctx.page !== 'MAP') return { id: 'openCall', action: 'OPEN_CALL' };
  if (!ctx.selected) return { id: 'openCall', selector: card };
  if (lesson === 'REDIRECT' && ctx.returning > 0) return { id: 'redirectHere', selector: CHAIN };
  if (ctx.available === 0) return ctx.returning > 0 ? { id: 'redirectHere', selector: CHAIN } : null;
  if (lesson === 'CHOOSE_VEHICLE')
    return ctx.ticked
      ? { id: 'sendChosen', selector: `[data-testid="send-selected"], ${SEND}` }
      : { id: 'tickVehicle', selector: '[data-testid="dispatch-option"][data-busy="false"] label' };
  return { id: 'sendRecommended', selector: SEND };
}
