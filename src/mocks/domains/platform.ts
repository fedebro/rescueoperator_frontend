import type { z } from 'zod';
import { AnalyticsEventBody, type NotificationDto as NotificationSchema } from '@/contracts';
import { MockError, text, type MockCareer, type MockEngine } from '../engine';

type Notification = z.infer<typeof NotificationSchema>;
export type StoredAnalyticsEvent = z.infer<typeof AnalyticsEventBody>['events'][number] & {
  /** Public id of the signed-in user, or null for an anonymous batch. Never an email. */
  userId: string | null;
  receivedAt: string;
};

/** How many analytics events the mock keeps (the admin area may read `engine.state.ext.analytics`). */
export const ANALYTICS_RETENTION = 200;

export const unreadOf = (career: MockCareer): number =>
  career.notifications.reduce((sum, n) => sum + (n.readAt === null ? 1 : 0), 0);

export function listNotifications(career: MockCareer): Notification[] {
  return career.notifications;
}

/** Idempotent: reading an already-read notification keeps its first `readAt`. */
export function readNotification(engine: MockEngine, career: MockCareer, id: string): Notification {
  const n = career.notifications.find((x) => x.id === id);
  if (!n) throw new MockError(404, 'NOT_FOUND', 'Notification not found');
  if (n.readAt === null) {
    n.readAt = new Date(engine.now()).toISOString();
    engine.save();
  }
  return n;
}

export function readAllNotifications(engine: MockEngine, career: MockCareer): number {
  const at = new Date(engine.now()).toISOString();
  let changed = 0;
  for (const n of career.notifications)
    if (n.readAt === null) {
      n.readAt = at;
      changed += 1;
    }
  if (changed > 0) engine.save();
  return changed;
}

export function analyticsLog(engine: MockEngine): StoredAnalyticsEvent[] {
  return (engine.state.ext.analytics ??= []) as StoredAnalyticsEvent[];
}

/** Validates a batch with the contract schema and keeps the most recent events. Returns how many were accepted. */
export function ingestAnalytics(engine: MockEngine, body: unknown, userId: string | null): number {
  const parsed = AnalyticsEventBody.safeParse(body);
  if (!parsed.success)
    throw new MockError(400, 'VALIDATION_ERROR', 'Invalid analytics batch', {
      issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  if (engine.state.featureFlags.analytics === false) return 0; // flag off: accepted and discarded
  const receivedAt = new Date(engine.now()).toISOString();
  const log = analyticsLog(engine);
  for (const e of parsed.data.events) log.push({ ...e, userId, receivedAt });
  if (log.length > ANALYTICS_RETENTION) log.splice(0, log.length - ANALYTICS_RETENTION);
  engine.save();
  return parsed.data.events.length;
}

const QA_ACTION: Record<Notification['category'], Notification['action']['kind']> = {
  OPERATIONS: 'OPEN_INCIDENT',
  FLEET: 'OPEN_VEHICLE',
  PERSONNEL: 'OPEN_PERSONNEL',
  FACILITIES: 'OPEN_FACILITY',
  ECONOMY: 'OPEN_SHOP',
  PROGRESSION: 'OPEN_PROGRESSION',
  SYSTEM: 'NONE',
};

/** Simulation of the `platform` area: notifications read state, analytics ingestion, QA helpers. */
export function installPlatform(engine: MockEngine): void {
  /**
   * QA: creates a notification of the given category/priority with the natural action of that category, targeting a
   * real entity of the career when one exists. Returns its id.
   */
  engine.qa.notify = ((
    category: Notification['category'] = 'SYSTEM',
    priority: Notification['priority'] = 'INFO',
  ) => {
    const career = engine.qa.career();
    const kind = QA_ACTION[category];
    const targetId =
      kind === 'OPEN_INCIDENT'
        ? (career.incidents[0]?.id ?? null)
        : kind === 'OPEN_VEHICLE'
          ? (career.vehicles[0]?.id ?? null)
          : kind === 'OPEN_FACILITY'
            ? (career.facilities[0]?.id ?? null)
            : null;
    engine.notify(career, {
      category,
      priority,
      title: text(`notifications.qa.${category}`),
      body: text(`notifications.qaBody.${priority}`),
      action: { kind, targetId },
    });
    engine.save();
    return career.notifications[0]!.id;
  }) as never;
  /**
   * QA: a silent world — off duty, every open incident cancelled, everything read. Tests of the notifications centre
   * need exact unread counts, which random incidents (and their "expired" notifications) would break.
   */
  engine.qa.quiet = (() => {
    const career = engine.qa.career();
    engine.setDuty(career, false);
    for (const incident of [...career.incidents]) engine.close(career, incident, 'CANCELLED', engine.now());
    readAllNotifications(engine, career);
    engine.save();
  }) as never;
  /** QA: the analytics events received so far (newest last). */
  engine.qa.analyticsEvents = (() => analyticsLog(engine)) as never;
}
