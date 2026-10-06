import type { z } from 'zod';
import type { NotificationCategory, NotificationDto, NotificationPriority, SyncSnapshot } from '@/contracts';

export type Notification = z.infer<typeof NotificationDto>;
export type Category = z.infer<typeof NotificationCategory>;
export type Priority = z.infer<typeof NotificationPriority>;

export const CATEGORIES: readonly Category[] = [
  'OPERATIONS',
  'FLEET',
  'PERSONNEL',
  'FACILITIES',
  'ECONOMY',
  'PROGRESSION',
  'ALLIANCE',
  'SYSTEM',
];

export interface NotificationFilter {
  category: Category | 'ALL';
  unreadOnly: boolean;
}

export function filterNotifications(
  list: readonly Notification[],
  filter: NotificationFilter,
): Notification[] {
  return list.filter(
    (n) =>
      (filter.category === 'ALL' || n.category === filter.category) &&
      (!filter.unreadOnly || n.readAt === null),
  );
}

export const unreadCount = (list: readonly Notification[]): number =>
  list.reduce((sum, n) => sum + (n.readAt === null ? 1 : 0), 0);

/** Unread notifications per category (the filter chips show it). */
export function unreadByCategory(list: readonly Notification[]): Partial<Record<Category, number>> {
  const out: Partial<Record<Category, number>> = {};
  for (const n of list) if (n.readAt === null) out[n.category] = (out[n.category] ?? 0) + 1;
  return out;
}

/** Optimistic "read one": returns the same array when nothing changes so React Query does not re-render. */
export function markRead(list: readonly Notification[], id: string, atIso: string): Notification[] {
  let changed = false;
  const next = list.map((n) => {
    if (n.id !== id || n.readAt !== null) return n;
    changed = true;
    return { ...n, readAt: atIso };
  });
  return changed ? next : (list as Notification[]);
}

export function markAllRead(list: readonly Notification[], atIso: string): Notification[] {
  return list.map((n) => (n.readAt === null ? { ...n, readAt: atIso } : n));
}

/** Keeps the top-bar badge (snapshot) in step with an optimistic read. Never goes below zero. */
export function withUnread(snapshot: SyncSnapshot, unread: number): SyncSnapshot {
  const value = Math.max(0, unread);
  return snapshot.unreadNotifications === value ? snapshot : { ...snapshot, unreadNotifications: value };
}

/** The body is often a copy of the title (the engine defaults it): showing it twice is noise. */
export function sameText(
  a: { key: string; params?: Record<string, unknown> | undefined },
  b: { key: string; params?: Record<string, unknown> | undefined },
): boolean {
  return a.key === b.key && JSON.stringify(a.params ?? {}) === JSON.stringify(b.params ?? {});
}

/**
 * The backend's "Emergenza grave" (`notification.SEVERE_INCIDENT.*`, from the configured severity up): the call itself is
 * announced by the new-incident toast, so this one only goes to the centre and the badge.
 */
export const isSevereIncidentNotification = (n: Pick<Notification, 'title'>): boolean =>
  n.title.key === 'notification.SEVERE_INCIDENT.title';

export type ActionTarget =
  | { type: 'select'; kind: 'incident' | 'vehicle'; id: string }
  | { type: 'navigate'; href: string }
  | { type: 'none' };

/** Where a notification action leads. Missing targets degrade to the list screen of that area. */
export function resolveAction(action: Notification['action']): ActionTarget {
  const id = action.targetId;
  switch (action.kind) {
    case 'OPEN_INCIDENT':
      return id ? { type: 'select', kind: 'incident', id } : { type: 'navigate', href: '/game/incidents' };
    case 'OPEN_VEHICLE':
      return id ? { type: 'select', kind: 'vehicle', id } : { type: 'navigate', href: '/game/fleet' };
    case 'OPEN_FACILITY':
      return {
        type: 'navigate',
        href: id ? `/game/facilities?id=${encodeURIComponent(id)}` : '/game/facilities',
      };
    case 'OPEN_PERSONNEL':
      return {
        type: 'navigate',
        href: id ? `/game/personnel?id=${encodeURIComponent(id)}` : '/game/personnel',
      };
    case 'OPEN_SHOP':
      return { type: 'navigate', href: '/game/shop' };
    case 'OPEN_PROGRESSION':
      return { type: 'navigate', href: '/game/progression' };
    // Alliances (D-102…D-123): `targetId` = a tab or `post:…` / `aid:…` / `operation:…` (the section opens the right place).
    case 'OPEN_ALLIANCE':
      return {
        type: 'navigate',
        href: id ? `/game/alliance?focus=${encodeURIComponent(id)}` : '/game/alliance',
      };
    default:
      return { type: 'none' };
  }
}
