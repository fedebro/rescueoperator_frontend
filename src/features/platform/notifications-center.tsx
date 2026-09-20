'use client';
/** SLOT (owner: platform agent) — bell + unread badge + notifications centre (categories, priorities, actions). */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import {
  AlertOctagon,
  AlertTriangle,
  Bell,
  BellOff,
  Building2,
  CheckCheck,
  ChevronRight,
  Coins,
  Info,
  Settings2,
  Siren,
  Trophy,
  Truck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { SyncSnapshot } from '@/contracts';
import { platformApi } from '@/lib/api/depth';
import { qk } from '@/lib/api/query-keys';
import { useErrorMessage } from '@/lib/api/error-message';
import { track } from '@/lib/analytics';
import { serverNow } from '@/lib/clock';
import { cn } from '@/lib/utils';
import { useI18nText } from '@/i18n/use-i18n-text';
import { useIsDesktop } from '@/hooks/use-media-query';
import { useServerNow } from '@/hooks/use-server-now';
import { useUiStore } from '@/stores/ui';
import { toast } from '@/stores/toast';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { Switch } from '@/components/ui/switch';
import { useCareerId, useSnapshot } from '@/features/game/hooks';
import {
  CATEGORIES,
  filterNotifications,
  markAllRead,
  markRead,
  resolveAction,
  sameText,
  unreadByCategory,
  unreadCount,
  withUnread,
  type Category,
  type Notification,
  type NotificationFilter,
  type Priority,
} from './notifications-model';

const CATEGORY_ICON: Record<Category, LucideIcon> = {
  OPERATIONS: Siren,
  FLEET: Truck,
  PERSONNEL: Users,
  FACILITIES: Building2,
  ECONOMY: Coins,
  PROGRESSION: Trophy,
  SYSTEM: Settings2,
};
/** Priority is always icon + label; the colour only reinforces it. */
const PRIORITY: Record<Priority, { icon: LucideIcon; className: string; bar: string }> = {
  CRITICAL: { icon: AlertOctagon, className: 'bg-danger/15 text-danger', bar: 'bg-danger' },
  IMPORTANT: { icon: AlertTriangle, className: 'bg-warning/15 text-warning', bar: 'bg-warning' },
  INFO: { icon: Info, className: 'bg-surface-3 text-muted', bar: 'bg-border-strong' },
};

/**
 * Runs the direct action of a notification: incidents and vehicles are selected on the operations map (and the camera
 * flies there), the other kinds open their screen. Shared by the centre and by the CRITICAL toasts.
 */
export function useNotificationAction(): (n: Notification) => boolean {
  const router = useRouter();
  const careerId = useCareerId();
  const qc = useQueryClient();
  return React.useCallback(
    (n) => {
      const target = resolveAction(n.action);
      if (target.type === 'none') return false;
      if (target.type === 'navigate') {
        router.push(target.href);
        return true;
      }
      const snapshot = qc.getQueryData<SyncSnapshot>(qk.sync(careerId));
      const entity =
        target.kind === 'incident'
          ? snapshot?.incidents.find((i) => i.id === target.id)
          : snapshot?.vehicles.find((v) => v.id === target.id);
      if (!entity) {
        // The incident is already closed / the vehicle was sold: fall back to the list of that area.
        router.push(target.kind === 'incident' ? '/game/incidents' : '/game/fleet');
        return true;
      }
      router.push('/game');
      useUiStore.getState().select({ kind: target.kind, id: target.id }, { focus: entity.position });
      return true;
    },
    [router, qc, careerId],
  );
}

/** Optimistic read / read-all over the list cache and the snapshot badge, rolled back on failure. */
export function useNotificationMutations() {
  const careerId = useCareerId();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const listKey = qk.notifications(careerId);
  const syncKey = qk.sync(careerId);

  const apply = (
    nextList: (list: Notification[]) => Notification[],
    nextUnread: (current: number) => number,
  ) => {
    const previousList = qc.getQueryData<Notification[]>(listKey);
    const previousSnapshot = qc.getQueryData<SyncSnapshot>(syncKey);
    if (previousList) qc.setQueryData<Notification[]>(listKey, nextList(previousList));
    if (previousSnapshot)
      qc.setQueryData<SyncSnapshot>(
        syncKey,
        withUnread(previousSnapshot, nextUnread(previousSnapshot.unreadNotifications)),
      );
    return { previousList, previousSnapshot };
  };
  const rollback = (ctx: ReturnType<typeof apply> | undefined, error: unknown) => {
    if (ctx?.previousList) qc.setQueryData(listKey, ctx.previousList);
    if (ctx?.previousSnapshot)
      qc.setQueryData<SyncSnapshot>(syncKey, (current) =>
        current ? withUnread(current, ctx.previousSnapshot!.unreadNotifications) : current,
      );
    toast({ tone: 'danger', title: errorMessage(error) });
  };

  const readOne = useMutation({
    mutationFn: (id: string) => platformApi.readNotification(careerId, id),
    onMutate: (id) => {
      const at = new Date(serverNow()).toISOString();
      return apply(
        (list) => markRead(list, id, at),
        (current) => current - 1,
      );
    },
    onError: (error, _id, ctx) => rollback(ctx, error),
  });
  const readAll = useMutation({
    mutationFn: () => platformApi.readAllNotifications(careerId),
    onMutate: () => {
      const at = new Date(serverNow()).toISOString();
      return apply(
        (list) => markAllRead(list, at),
        () => 0,
      );
    },
    onError: (error, _v, ctx) => rollback(ctx, error),
    onSettled: () => void qc.invalidateQueries({ queryKey: listKey }),
  });
  return { readOne, readAll };
}

function PriorityBadge({ priority }: { priority: Priority }) {
  const t = useTranslations('notificationCenter');
  const { icon: Icon, className } = PRIORITY[priority];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] leading-4 font-semibold',
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {t(`priority.${priority}`)}
    </span>
  );
}

function NotificationRow({
  notification: n,
  now,
  onActivate,
}: {
  notification: Notification;
  now: number;
  onActivate: (n: Notification) => void;
}) {
  const t = useTranslations('notificationCenter');
  const tx = useI18nText();
  const format = useFormatter();
  const CategoryIcon = CATEGORY_ICON[n.category];
  const unread = n.readAt === null;
  const hasAction = resolveAction(n.action).type !== 'none';
  const title = tx(n.title);
  const body = sameText(n.title, n.body) ? '' : tx(n.body);
  // Clock skew must never produce "in 3 seconds" for something that already happened.
  const created = Math.min(Date.parse(n.createdAt), now);
  return (
    <li>
      <button
        type="button"
        onClick={() => onActivate(n)}
        data-testid="notification-item"
        data-unread={unread}
        data-category={n.category}
        data-priority={n.priority}
        className={cn(
          'hover:bg-surface-2 relative flex min-h-16 w-full items-start gap-3 px-4 py-3 text-left',
          unread && 'bg-surface-2/60',
        )}
      >
        <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', PRIORITY[n.priority].bar)} />
        <span
          aria-hidden
          className="bg-surface-3 text-muted mt-0.5 grid size-9 shrink-0 place-items-center rounded-md"
        >
          <CategoryIcon className="size-4.5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <PriorityBadge priority={n.priority} />
            <span className="text-muted text-[11px] font-semibold">{t(`category.${n.category}`)}</span>
            {unread ? (
              <span className="text-skyline inline-flex items-center gap-1 text-[11px] font-bold">
                <span aria-hidden className="bg-skyline size-1.5 rounded-full" />
                {t('unread')}
              </span>
            ) : null}
          </span>
          <span className={cn('text-sm', unread ? 'text-fg font-semibold' : 'text-muted')}>{title}</span>
          {body ? <span className="text-muted text-xs">{body}</span> : null}
          <span className="text-muted text-[11px]">
            <time dateTime={n.createdAt}>{format.relativeTime(created, now)}</time>
            {hasAction ? <span> · {t(`action.${n.action.kind}`)}</span> : null}
          </span>
        </span>
        {hasAction ? <ChevronRight className="text-muted mt-2 size-4 shrink-0" aria-hidden /> : null}
      </button>
    </li>
  );
}

function FilterChip({
  active,
  onClick,
  icon: Icon,
  label,
  count,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  icon?: LucideIcon;
  label: string;
  count?: number;
  testId: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold lg:h-8',
        active
          ? 'border-skyline bg-surface-3 text-fg'
          : 'border-border text-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
      {label}
      {count ? <span className="tabular text-skyline">{count}</span> : null}
    </button>
  );
}

function NotificationsPanel({ onNavigate }: { onNavigate: () => void }) {
  const t = useTranslations('notificationCenter');
  const tg = useTranslations('game');
  const careerId = useCareerId();
  const now = useServerNow(30_000);
  const runAction = useNotificationAction();
  const { readOne, readAll } = useNotificationMutations();
  const [filter, setFilter] = React.useState<NotificationFilter>({ category: 'ALL', unreadOnly: false });
  const unreadSwitchId = React.useId();
  const query = useQuery({
    queryKey: qk.notifications(careerId),
    queryFn: () => platformApi.notifications(careerId),
    staleTime: 0,
  });

  const all = query.data ?? [];
  const visible = filterNotifications(all, filter);
  const perCategory = unreadByCategory(all);
  const unread = unreadCount(all);

  const activate = (n: Notification) => {
    if (n.readAt === null) readOne.mutate(n.id);
    track('notification_opened', {
      notificationId: n.id,
      category: n.category,
      priority: n.priority,
      action: n.action.kind,
    });
    if (runAction(n)) onNavigate();
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="notifications-panel">
      <div className="border-border flex shrink-0 flex-col gap-2 border-b px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={unreadSwitchId} className="flex min-h-11 items-center gap-2 text-sm lg:min-h-0">
            <Switch
              id={unreadSwitchId}
              checked={filter.unreadOnly}
              onCheckedChange={(unreadOnly) => setFilter((f) => ({ ...f, unreadOnly }))}
              data-testid="notifications-unread-only"
            />
            {t('unreadOnly')}
          </label>
          <Button
            variant="outline"
            size="sm"
            className="h-11 lg:h-8"
            disabled={unread === 0}
            loading={readAll.isPending}
            onClick={() => {
              track('notifications_read_all', { count: unread });
              readAll.mutate();
            }}
            data-testid="notifications-read-all"
          >
            <CheckCheck className="size-4" aria-hidden />
            {t('readAll')}
          </Button>
        </div>
        <div
          role="group"
          aria-label={t('filterLabel')}
          className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1"
        >
          <FilterChip
            active={filter.category === 'ALL'}
            onClick={() => setFilter((f) => ({ ...f, category: 'ALL' }))}
            label={t('category.ALL')}
            testId="notifications-filter-ALL"
          />
          {CATEGORIES.map((c) => (
            <FilterChip
              key={c}
              active={filter.category === c}
              onClick={() => setFilter((f) => ({ ...f, category: c }))}
              icon={CATEGORY_ICON[c]}
              label={t(`category.${c}`)}
              count={perCategory[c]}
              testId={`notifications-filter-${c}`}
            />
          ))}
        </div>
      </div>
      <div className="scroll-y min-h-0 flex-1" aria-busy={query.isLoading}>
        {query.isLoading ? (
          <div className="flex flex-col gap-2 p-4" data-testid="notifications-loading">
            <span className="sr-only">{t('loading')}</span>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : query.isError ? (
          <EmptyState
            icon={<AlertTriangle className="size-5" />}
            title={t('errorTitle')}
            description={t('errorBody')}
            action={
              <Button variant="secondary" onClick={() => void query.refetch()} loading={query.isFetching}>
                {tg('retry')}
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<BellOff className="size-5" />}
            title={all.length === 0 ? t('emptyTitle') : t('emptyFilteredTitle')}
            description={all.length === 0 ? t('emptyBody') : t('emptyFilteredBody')}
          />
        ) : (
          <ul className="divide-border divide-y" aria-label={t('listLabel')}>
            {visible.map((n) => (
              <NotificationRow key={n.id} notification={n} now={now} onActivate={activate} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function NotificationsButton() {
  const t = useTranslations('game.notifications');
  const tc = useTranslations('common');
  const tn = useTranslations('notificationCenter');
  const isDesktop = useIsDesktop();
  const unread = useSnapshot().unreadNotifications;
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('open', { count: unread })}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="notifications-button"
        className="text-muted hover:bg-surface-3 hover:text-fg relative grid size-11 shrink-0 place-items-center rounded-md lg:size-10"
      >
        <Bell className="size-5" aria-hidden />
        {unread > 0 ? (
          <span
            aria-hidden
            data-testid="notifications-badge"
            className="tabular bg-brand absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>
      {/* The badge is decorative; changes of the count are announced here, politely. */}
      <span className="sr-only" role="status">
        {unread > 0 ? tn('unreadAnnouncement', { count: unread }) : ''}
      </span>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title={t('title')}
        closeLabel={tc('close')}
        // Phones get a full-screen sheet; desktop keeps the side drawer next to the map.
        className={isDesktop ? 'w-[min(440px,92vw)]' : 'inset-0 w-full border-l-0'}
      >
        {open ? <NotificationsPanel onNavigate={() => setOpen(false)} /> : null}
      </Drawer>
    </>
  );
}
