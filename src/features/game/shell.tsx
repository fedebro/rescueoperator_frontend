'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  Bell,
  CloudSun,
  Moon,
  Sun,
  Sunrise,
  Truck,
  Siren,
  MapPin,
  ShieldAlert,
  WifiOff,
  RefreshCw,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { gameApi } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/query-keys';
import { amountRatio, formatDateTime, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { isAdminUser, useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';
import { useI18nText } from '@/i18n/use-i18n-text';
import { Logo } from '@/components/brand/logo';
import { CreditAmount } from '@/components/ui/credit-amount';
import { Tooltip } from '@/components/ui/tooltip';
import { IconButton } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/misc';
import { useServerNow } from '@/hooks/use-server-now';
import { ADMIN_ICON, BOTTOM_ITEMS, SIDEBAR_ITEMS, isActive } from './nav';
import { useCareerId, useSnapshot, usePatchSnapshot } from './hooks';
import { DutyToggle } from './duty-toggle';

function LevelMeter({ compact }: { compact?: boolean }) {
  const { career } = useSnapshot();
  const t = useTranslations('game.topbar');
  const span = BigInt(career.xpForNextLevel) - BigInt(career.xpForCurrentLevel);
  const ratio = amountRatio(BigInt(career.xp) - BigInt(career.xpForCurrentLevel), span);
  return (
    <Link
      href="/game/progression"
      className="hover:bg-surface-3 flex items-center gap-2 rounded-md px-1.5 py-1"
      aria-label={t('levelAria', { level: career.level, percent: Math.round(ratio * 100) })}
      data-testid="level-meter"
    >
      <span className="tabular border-xp text-fg grid size-7 place-items-center rounded-full border-2 text-xs font-bold">
        {career.level}
      </span>
      {compact ? null : (
        <span className="flex w-24 flex-col gap-1">
          <span className="text-subtle text-[10px] leading-none font-bold tracking-wider uppercase">
            {t('level')}
          </span>
          <span aria-hidden className="bg-surface-3 h-1.5 overflow-hidden rounded-full">
            <span
              className="bg-xp block h-full rounded-full transition-[width] duration-500"
              style={{ width: `${ratio * 100}%` }}
            />
          </span>
        </span>
      )}
    </Link>
  );
}

function Counter({
  icon,
  value,
  label,
  tone,
  testId,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  tone?: 'danger' | 'success';
  testId?: string;
}) {
  return (
    <Tooltip content={label}>
      <span
        className={cn(
          'tabular border-border bg-surface-2 inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-sm font-semibold',
          tone === 'danger' && value > 0 ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-fg',
        )}
        aria-label={`${label}: ${value}`}
        data-testid={testId}
      >
        <span aria-hidden>{icon}</span>
        {value}
      </span>
    </Tooltip>
  );
}

function WorldClock() {
  const { world, career } = useSnapshot();
  const locale = useLocale();
  const t = useTranslations('game.world');
  const now = useServerNow(15_000);
  const PhaseIcon = world.dayPhase === 'DAY' ? Sun : world.dayPhase === 'NIGHT' ? Moon : Sunrise;
  return (
    <span
      className="text-muted hidden items-center gap-2 text-xs xl:inline-flex"
      aria-label={`${t(`weather.${world.weather.code}`)}, ${t(`phase.${world.dayPhase}`)}`}
    >
      <CloudSun className="size-4" aria-hidden />
      <span>
        {t(`weather.${world.weather.code}`)}
        {world.weather.temperatureC !== null ? ` · ${Math.round(world.weather.temperatureC)}°` : ''}
      </span>
      <PhaseIcon className="size-4" aria-hidden />
      <time className="tabular text-fg" suppressHydrationWarning>
        {formatTime(new Date(now).toISOString(), locale, career.timezone)}
      </time>
    </span>
  );
}

function NotificationsButton() {
  const careerId = useCareerId();
  const { unreadNotifications } = useSnapshot();
  const t = useTranslations('game.notifications');
  const tc = useTranslations('common');
  const tx = useI18nText();
  const locale = useLocale();
  const qc = useQueryClient();
  const patch = usePatchSnapshot();
  const [open, setOpen] = React.useState(false);
  const list = useQuery({
    queryKey: qk.notifications(careerId),
    queryFn: () => gameApi.notifications(careerId),
    enabled: open,
  });
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next && unreadNotifications > 0) {
      patch((s) => ({ ...s, unreadNotifications: 0 }));
      void gameApi
        .readAllNotifications(careerId)
        .then(() => qc.invalidateQueries({ queryKey: qk.notifications(careerId) }))
        .catch(() => undefined);
    }
  };
  return (
    <>
      <IconButton
        label={t('open', { count: unreadNotifications })}
        onClick={() => onOpenChange(true)}
        className="relative"
        data-testid="notifications-button"
      >
        <Bell className="size-5" aria-hidden />
        {unreadNotifications > 0 ? (
          <span
            aria-hidden
            className="tabular bg-brand absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold text-white"
          >
            {unreadNotifications > 9 ? '9+' : unreadNotifications}
          </span>
        ) : null}
      </IconButton>
      <Drawer open={open} onOpenChange={onOpenChange} title={t('title')} closeLabel={tc('close')}>
        {list.isError || (list.data && list.data.length === 0) ? (
          <EmptyState icon={<Bell className="size-5" />} title={t('empty')} />
        ) : null}
        <ul className="divide-border divide-y">
          {(list.data ?? []).map((n) => (
            <li key={n.id} className="flex gap-3 px-4 py-3">
              <span
                aria-hidden
                className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-surface-4' : 'bg-brand')}
              />
              <div className="min-w-0">
                <p className="text-fg text-sm">{tx(n.title)}</p>
                <time className="text-subtle text-[11px]">{formatDateTime(n.createdAt, locale)}</time>
              </div>
            </li>
          ))}
        </ul>
      </Drawer>
    </>
  );
}

export function TopBar() {
  const { career, incidents, vehicles } = useSnapshot();
  const t = useTranslations('game.topbar');
  const tc = useTranslations('common');
  const user = useAuthStore((s) => s.user);
  const available = vehicles.filter((v) => v.status === 'AVAILABLE').length;
  return (
    <header className="pt-safe border-border bg-surface-1 z-30 shrink-0 border-b" data-testid="topbar">
      <div className="flex h-[var(--rc-topbar-h)] items-center gap-2 px-3 lg:gap-4 lg:px-4">
        <Link href="/game" className="hidden shrink-0 lg:block" aria-label="Rescue Control">
          <Logo variant="horizontal" className="w-32" />
        </Link>
        <span className="text-fg hidden min-w-0 items-center gap-1.5 text-sm font-semibold lg:inline-flex">
          <MapPin className="text-skyline size-4 shrink-0" aria-hidden />
          <span className="truncate">{career.locationName}</span>
        </span>
        <LevelMeter />
        <Link
          href="/game/economy"
          className="hover:bg-surface-3 rounded-md px-1.5 py-1"
          data-testid="credits"
        >
          <CreditAmount value={career.credits} label={tc('credits')} />
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <Counter
            icon={<Siren className="size-4" />}
            value={incidents.length}
            label={t('activeIncidents')}
            tone="danger"
            testId="active-incidents"
          />
          <Counter
            icon={<Truck className="size-4" />}
            value={available}
            label={t('availableVehicles')}
            tone="success"
            testId="available-vehicles"
          />
          <WorldClock />
          <span className="hidden lg:block">
            <DutyToggle compact />
          </span>
          <NotificationsButton />
          {isAdminUser(user) ? (
            <Tooltip content={t('admin')}>
              <Link
                href="/admin"
                aria-label={t('admin')}
                className="text-muted hover:bg-surface-3 hover:text-fg hidden size-10 place-items-center rounded-md lg:grid"
              >
                <ADMIN_ICON className="size-5" aria-hidden />
              </Link>
            </Tooltip>
          ) : null}
          <Tooltip content={career.directorName}>
            <Link
              href="/game/settings"
              aria-label={t('profile', { name: career.directorName })}
              className="border-border-strong bg-surface-3 text-fg hidden size-9 place-items-center rounded-full border text-sm font-bold lg:grid"
            >
              {career.directorName.slice(0, 1).toUpperCase()}
            </Link>
          </Tooltip>
        </div>
      </div>
    </header>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations('game.nav');
  return (
    <nav
      aria-label={t('label')}
      className="border-border bg-surface-1 z-20 hidden w-[var(--rc-sidebar-w)] shrink-0 flex-col items-center gap-1 border-r py-2 lg:flex"
    >
      {SIDEBAR_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Tooltip key={item.href} content={t(item.labelKey)} side="right">
            <Link
              href={item.href}
              aria-label={t(item.labelKey)}
              aria-current={active ? 'page' : undefined}
              data-tutorial={item.tutorialId}
              className={cn(
                'text-muted hover:bg-surface-3 hover:text-fg relative grid size-11 place-items-center rounded-md transition-colors',
                active && 'bg-surface-3 text-fg',
              )}
            >
              {active ? (
                <span aria-hidden className="bg-brand absolute top-2 bottom-2 -left-2 w-1 rounded-r" />
              ) : null}
              <item.icon className="size-5" aria-hidden />
            </Link>
          </Tooltip>
        );
      })}
    </nav>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations('game.nav');
  const pending = useSnapshot().incidents.filter((i) => i.status === 'PENDING_RESPONSE').length;
  return (
    <nav
      aria-label={t('label')}
      className="pb-safe border-border bg-surface-1 z-50 shrink-0 border-t lg:hidden"
      data-testid="bottom-nav"
    >
      <ul className="grid h-[var(--rc-bottomnav-h)] grid-cols-5">
        {BOTTOM_ITEMS.map((item) => {
          const active =
            isActive(pathname, item.href) ||
            (item.href === '/game/more' &&
              ['/game/facilities', '/game/progression', '/game/economy', '/game/settings'].some((h) =>
                pathname.startsWith(h),
              ));
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                data-tutorial={item.tutorialId}
                className={cn(
                  'relative flex h-full flex-col items-center justify-center gap-0.5 text-[10px] font-semibold',
                  active ? 'text-fg' : 'text-subtle',
                )}
              >
                {active ? <span aria-hidden className="bg-brand absolute top-0 h-0.5 w-8 rounded-b" /> : null}
                <span className="relative">
                  <item.icon className="size-5" aria-hidden />
                  {item.href === '/game/incidents' && pending > 0 ? (
                    <span
                      className="tabular bg-brand absolute -top-1.5 -right-2.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold text-white"
                      aria-label={String(pending)}
                    >
                      {pending}
                    </span>
                  ) : null}
                </span>
                {t(item.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Reconnect / offline / degraded (polling) banner. Hidden while everything is healthy. */
export function ConnectionBanner() {
  const connection = useUiStore((s) => s.connection);
  const t = useTranslations('game.connection');
  // Avoid flashing the banner during the first connection or a sub-second blip: a state is shown only once it has lasted.
  const [settled, setSettled] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (connection === 'online' || connection === 'connecting') return;
    const timer = setTimeout(() => setSettled(connection), connection === 'offline' ? 0 : 1500);
    return () => clearTimeout(timer);
  }, [connection]);
  if (settled !== connection || connection === 'online' || connection === 'connecting') return null;
  const Icon = connection === 'offline' ? WifiOff : connection === 'polling' ? ShieldAlert : RefreshCw;
  return (
    <div
      role="status"
      data-testid="connection-banner"
      className={cn(
        'z-30 flex shrink-0 items-center justify-center gap-2 px-3 py-1.5 text-xs font-semibold',
        connection === 'offline' ? 'bg-danger/20 text-danger' : 'bg-warning/15 text-warning',
      )}
    >
      <Icon className={cn('size-3.5', connection === 'reconnecting' && 'animate-spin')} aria-hidden />
      {t(connection)}
    </div>
  );
}

/** Frame shared by every /game screen: desktop = top bar + icon sidebar + content; mobile = top bar + content + bottom nav. */
export function GameShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-dvh-safe bg-bg flex flex-col overflow-hidden">
      <TopBar />
      <ConnectionBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main id="main" className="relative min-w-0 flex-1">
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}

/** Scrollable page body used by the non-map screens. */
export function PageBody({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="scroll-y absolute inset-0">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-extrabold">{title}</h1>
            {subtitle ? <p className="text-muted mt-1 text-sm">{subtitle}</p> : null}
          </div>
          {actions}
        </div>
        {children}
      </div>
    </div>
  );
}
