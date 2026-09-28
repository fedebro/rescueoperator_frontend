import { describe, expect, it } from 'vitest';
import { snapshot } from '@/test/fixtures';
import {
  filterNotifications,
  isSevereIncidentNotification,
  markAllRead,
  markRead,
  resolveAction,
  sameText,
  unreadByCategory,
  unreadCount,
  withUnread,
  type Notification,
} from './notifications-model';

const n = (patch: Partial<Notification>): Notification => ({
  id: 'ntf_01J8Z0000000000000000000AA',
  category: 'SYSTEM',
  priority: 'INFO',
  title: { key: 'notifications.qa.SYSTEM' },
  body: { key: 'notifications.qa.SYSTEM' },
  createdAt: '2026-03-01T09:00:00.000Z',
  readAt: null,
  action: { kind: 'NONE', targetId: null },
  ...patch,
});
const list = [
  n({ id: 'ntf_1', category: 'FLEET' }),
  n({ id: 'ntf_2', category: 'FLEET', readAt: '2026-03-01T09:05:00.000Z' }),
  n({ id: 'ntf_3', category: 'ECONOMY', priority: 'CRITICAL' }),
];

describe('notifications model', () => {
  it('filters by category and unread-only', () => {
    expect(filterNotifications(list, { category: 'ALL', unreadOnly: false })).toHaveLength(3);
    expect(filterNotifications(list, { category: 'FLEET', unreadOnly: false }).map((x) => x.id)).toEqual([
      'ntf_1',
      'ntf_2',
    ]);
    expect(filterNotifications(list, { category: 'FLEET', unreadOnly: true }).map((x) => x.id)).toEqual([
      'ntf_1',
    ]);
    expect(filterNotifications(list, { category: 'PERSONNEL', unreadOnly: false })).toEqual([]);
  });

  it('counts unread overall and per category', () => {
    expect(unreadCount(list)).toBe(2);
    expect(unreadByCategory(list)).toEqual({ FLEET: 1, ECONOMY: 1 });
  });

  it('marks one / all as read optimistically without touching what was already read', () => {
    const at = '2026-03-01T10:00:00.000Z';
    const one = markRead(list, 'ntf_1', at);
    expect(one[0]!.readAt).toBe(at);
    expect(one[1]).toBe(list[1]);
    expect(markRead(list, 'ntf_2', at)).toBe(list); // already read → same reference, no re-render
    expect(markRead(list, 'missing', at)).toBe(list);
    const all = markAllRead(list, at);
    expect(unreadCount(all)).toBe(0);
    expect(all[1]!.readAt).toBe('2026-03-01T09:05:00.000Z');
  });

  it('keeps the snapshot badge in step and never negative', () => {
    const s = snapshot({ unreadNotifications: 1 });
    expect(withUnread(s, 0).unreadNotifications).toBe(0);
    expect(withUnread(s, -3).unreadNotifications).toBe(0);
    expect(withUnread(s, 1)).toBe(s);
  });

  it('detects a body that only repeats the title', () => {
    expect(sameText({ key: 'a', params: { x: 1 } }, { key: 'a', params: { x: 1 } })).toBe(true);
    expect(sameText({ key: 'a' }, { key: 'a', params: {} })).toBe(true);
    expect(sameText({ key: 'a', params: { x: 1 } }, { key: 'a', params: { x: 2 } })).toBe(false);
    expect(sameText({ key: 'a' }, { key: 'b' })).toBe(false);
  });

  it('recognises the severe-incident notification of the backend (centre and badge only, no second toast)', () => {
    const severe = n({
      category: 'OPERATIONS',
      priority: 'CRITICAL',
      title: { key: 'notification.SEVERE_INCIDENT.title', params: { fallback: 'Emergenza grave' } },
      body: { key: 'notification.SEVERE_INCIDENT.body', params: { severity: 9, address: 'Via Roma' } },
      action: { kind: 'OPEN_INCIDENT', targetId: 'inc_1' },
    });
    expect(isSevereIncidentNotification(severe)).toBe(true);
    expect(resolveAction(severe.action)).toEqual({ type: 'select', kind: 'incident', id: 'inc_1' });
    expect(isSevereIncidentNotification(n({}))).toBe(false);
  });

  it('resolves every action kind', () => {
    expect(resolveAction({ kind: 'OPEN_INCIDENT', targetId: 'inc_1' })).toEqual({
      type: 'select',
      kind: 'incident',
      id: 'inc_1',
    });
    expect(resolveAction({ kind: 'OPEN_VEHICLE', targetId: 'veh_1' })).toEqual({
      type: 'select',
      kind: 'vehicle',
      id: 'veh_1',
    });
    expect(resolveAction({ kind: 'OPEN_FACILITY', targetId: 'fac_1' })).toEqual({
      type: 'navigate',
      href: '/game/facilities?id=fac_1',
    });
    expect(resolveAction({ kind: 'OPEN_PERSONNEL', targetId: 'per_1' })).toEqual({
      type: 'navigate',
      href: '/game/personnel?id=per_1',
    });
    expect(resolveAction({ kind: 'OPEN_SHOP', targetId: null })).toEqual({
      type: 'navigate',
      href: '/game/shop',
    });
    expect(resolveAction({ kind: 'OPEN_PROGRESSION', targetId: null })).toEqual({
      type: 'navigate',
      href: '/game/progression',
    });
    expect(resolveAction({ kind: 'OPEN_INCIDENT', targetId: null })).toEqual({
      type: 'navigate',
      href: '/game/incidents',
    });
    expect(resolveAction({ kind: 'NONE', targetId: null })).toEqual({ type: 'none' });
  });
});
