'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MapPin, ShieldAlert, WifiOff, RefreshCw } from 'lucide-react';
import { amountRatio } from '@/lib/format';
import { cn } from '@/lib/utils';
import { isAdminUser, useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';
import { useIsDesktop } from '@/hooks/use-media-query';
import { Logo } from '@/components/brand/logo';
import { CreditAmount } from '@/components/ui/credit-amount';
import { Tooltip } from '@/components/ui/tooltip';
import { ADMIN_ICON, BOTTOM_ITEMS, MORE_ITEMS, SIDEBAR_ITEMS, isActive, type NavBadge } from './nav';
import { useMoreBadge, useNavBadges, useVisibleNav } from './use-nav';
import { useSnapshot } from './hooks';
import { DutyToggle } from './duty-toggle';
import { WorldWidget } from '@/features/world/world-widget';
import { NotificationsButton } from '@/features/platform/notifications-center';
import { MajorStrip } from '@/features/major/strip';
import { PersistentMapHost } from './persistent-map';

/** Progress towards the next level as a ring around the level number (the top bar's compact variant, 03 §2.1). */
function LevelRing({ level, ratio }: { level: number; ratio: number }) {
  const r = 12.5;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative grid size-8 shrink-0 place-items-center">
      <svg viewBox="0 0 32 32" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="16" cy="16" r={r} fill="none" stroke="var(--rc-surface-3)" strokeWidth="3" />
        <circle
          cx="16"
          cy="16"
          r={r}
          fill="none"
          stroke="var(--rc-xp)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <span className="tabular text-fg relative text-xs font-bold">{level}</span>
    </span>
  );
}

function LevelMeter({ compact }: { compact?: boolean }) {
  const { career } = useSnapshot();
  const t = useTranslations('game.topbar');
  const span = BigInt(career.xpForNextLevel) - BigInt(career.xpForCurrentLevel);
  const ratio = amountRatio(BigInt(career.xp) - BigInt(career.xpForCurrentLevel), span);
  return (
    <Link
      href="/game/progression"
      className="hover:bg-surface-3 flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-md px-1.5 py-1 lg:min-h-0"
      aria-label={t('levelAria', { level: career.level, percent: Math.round(ratio * 100) })}
      data-testid="level-meter"
      data-level={career.level}
    >
      <LevelRing level={career.level} ratio={ratio} />
      {compact ? null : (
        <span className="flex w-24 flex-col gap-1">
          <span className="text-subtle text-xs leading-none font-bold tracking-wider uppercase">
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

/**
 * Phones (03 §2.1): level ring · credits · weather · bell — nothing else, so it fits 360 px without clipping. The
 * incident / vehicle counters are gone (the sheet's summary row says it, once); the duty switch lives in that row too.
 */
export function TopBar() {
  const { career } = useSnapshot();
  const tc = useTranslations('common');
  const t = useTranslations('game.topbar');
  const desktop = useIsDesktop();
  const user = useAuthStore((s) => s.user);
  return (
    <header className="pt-safe border-border bg-surface-1 z-30 shrink-0 border-b" data-testid="topbar">
      <div className="flex h-[var(--rc-topbar-h)] items-center gap-1.5 px-2 lg:gap-4 lg:px-4">
        <Link href="/game" className="hidden shrink-0 lg:block" aria-label="Rescue Control">
          <Logo variant="horizontal" className="w-32" />
        </Link>
        <span className="text-fg hidden min-w-0 items-center gap-1.5 text-sm font-semibold lg:inline-flex">
          <MapPin className="text-skyline size-4 shrink-0" aria-hidden />
          <span className="truncate">{career.locationName}</span>
        </span>
        <LevelMeter compact={!desktop} />
        <Link
          href="/game/economy"
          className="hover:bg-surface-3 inline-flex min-h-11 min-w-0 items-center rounded-md px-1.5 py-1 lg:min-h-0"
          data-testid="credits"
        >
          <CreditAmount value={career.credits} label={tc('credits')} />
        </Link>
        <div className="ml-auto flex shrink-0 items-center gap-1 lg:gap-2">
          <WorldWidget />
          {/* Desktop only: below 1024 px the duty switch lives in the sheet's summary row (one place, 03 §2.9). */}
          {desktop ? <DutyToggle compact /> : null}
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

/** The count bubble on a navigation icon. Visual only: the link's description (sr-only) carries the words. */
function NavBadgeBubble({ count, testId }: { count: number; testId: string }) {
  return (
    <span
      className="tabular bg-brand absolute -top-1.5 -right-2.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-xs leading-none font-bold text-white"
      aria-hidden
      data-testid={testId}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

const BADGE_TEST_ID: Record<NavBadge | 'more', string> = {
  pendingIncidents: 'nav-pending-badge',
  alliance: 'nav-badge-alliance',
  more: 'nav-badge-more',
};

/** The words of a badge (its `aria-describedby` text): what the number counts. */
function useBadgeText(): (kind: NavBadge | 'more', count: number) => string {
  const ta = useTranslations('platform.a11y');
  return React.useCallback(
    (kind, count) =>
      kind === 'pendingIncidents'
        ? ta('pendingIncidents', { count })
        : kind === 'alliance'
          ? ta('allianceUnread', { count })
          : ta('moreUnread', { count }),
    [ta],
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations('game.nav');
  const items = useVisibleNav(SIDEBAR_ITEMS);
  const badges = useNavBadges();
  const badgeText = useBadgeText();
  const describedBy = React.useId();
  return (
    <nav
      aria-label={t('label')}
      className="scroll-y border-border bg-surface-1 z-20 hidden w-[var(--rc-sidebar-w)] shrink-0 flex-col items-center gap-1 border-r py-2 lg:flex"
    >
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        const count = item.badge ? badges[item.badge] : 0;
        const badgeId = `${describedBy}-${item.labelKey}`;
        return (
          <React.Fragment key={item.href}>
            <Tooltip content={t(item.labelKey)} side="right">
              <Link
                href={item.href}
                aria-label={t(item.labelKey)}
                aria-current={active ? 'page' : undefined}
                aria-describedby={count > 0 ? badgeId : undefined}
                data-tutorial={item.tutorialId}
                data-nav={item.labelKey}
                className={cn(
                  'text-muted hover:bg-surface-3 hover:text-fg relative grid size-11 place-items-center rounded-md transition-colors',
                  active && 'bg-surface-3 text-fg',
                )}
              >
                {active ? (
                  <span aria-hidden className="bg-brand absolute top-2 bottom-2 -left-2 w-1 rounded-r" />
                ) : null}
                <span className="relative">
                  <item.icon className="size-5" aria-hidden />
                  {count > 0 && item.badge ? (
                    <NavBadgeBubble count={count} testId={BADGE_TEST_ID[item.badge]} />
                  ) : null}
                </span>
              </Link>
            </Tooltip>
            {count > 0 && item.badge ? (
              <span id={badgeId} className="sr-only">
                {badgeText(item.badge, count)}
              </span>
            ) : null}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations('game.nav');
  const badges = useNavBadges();
  const moreBadge = useMoreBadge();
  const badgeText = useBadgeText();
  const describedBy = React.useId();
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
            (item.href === '/game/more' && MORE_ITEMS.some((m) => pathname.startsWith(m.href)));
          // The waiting-incidents badge sits on "Mappa": that is where the list (the sheet) is. "Altro" sums the badges
          // of the entries it hides (the alliance's unread): the counter is seen without opening the page (D-123).
          const kind: NavBadge | 'more' | null =
            item.href === '/game/more' ? 'more' : item.badge ? item.badge : null;
          const count = kind === 'more' ? moreBadge : kind ? badges[kind] : 0;
          const badgeId = `${describedBy}-${item.labelKey}`;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                // The count is a description, not part of the name: the link stays "Mappa" / "Altro".
                aria-describedby={count > 0 ? badgeId : undefined}
                data-tutorial={item.tutorialId}
                data-nav={item.labelKey}
                className={cn(
                  'relative flex h-full flex-col items-center justify-center gap-0.5 text-xs font-semibold',
                  active ? 'text-fg' : 'text-muted',
                )}
              >
                {active ? <span aria-hidden className="bg-brand absolute top-0 h-0.5 w-8 rounded-b" /> : null}
                <span className="relative">
                  <item.icon className="size-5" aria-hidden />
                  {count > 0 && kind ? <NavBadgeBubble count={count} testId={BADGE_TEST_ID[kind]} /> : null}
                </span>
                {t(item.labelKey)}
              </Link>
              {count > 0 && kind ? (
                <span id={badgeId} className="sr-only">
                  {badgeText(kind, count)}
                </span>
              ) : null}
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
  const visible = settled === connection && connection !== 'online' && connection !== 'connecting';
  const Icon = connection === 'offline' ? WifiOff : connection === 'polling' ? ShieldAlert : RefreshCw;
  // The live region is ALWAYS in the DOM (screen readers only announce changes inside a region they already know);
  // losing the connection is announced assertively, degraded modes politely.
  return (
    <div
      role="status"
      aria-live={connection === 'offline' ? 'assertive' : 'polite'}
      aria-atomic="true"
      className="shrink-0"
    >
      {visible ? (
        <div
          data-testid="connection-banner"
          className={cn(
            'z-30 flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-semibold',
            connection === 'offline' ? 'bg-danger/20 text-danger' : 'bg-warning/15 text-warning',
          )}
        >
          <Icon className={cn('size-3.5', connection === 'reconnecting' && 'animate-spin')} aria-hidden />
          {t(connection)}
        </div>
      ) : null}
    </div>
  );
}

/** Frame shared by every /game screen: desktop = top bar + icon sidebar + content; mobile = top bar + content + bottom nav. */
export function GameShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useTranslations('game.nav');
  return (
    // `overflow: clip`, not hidden: a hidden overflow can still be scrolled by a focus or a scrollIntoView (a card of the
    // sheet below the fold) — the whole frame would slide up with no way back. Clipped, it never moves.
    <div className="h-dvh-safe bg-bg shell-clip flex flex-col" data-testid="game-shell">
      <TopBar />
      <ConnectionBanner />
      {/* A running major incident, one tap away from every page but the map (D-24). */}
      <MajorStrip />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        {/* tabIndex -1: the skip link moves FOCUS here, not only the scroll position. */}
        <main id="main" tabIndex={-1} className="shell-clip relative min-w-0 flex-1 outline-none">
          {/* The map screen has no visible title: every page still starts with an h1 (PageBody renders the others). */}
          {pathname === '/game' ? <h1 className="sr-only">{t('operations')}</h1> : null}
          {/* One operations map for the whole session: the map screen shows it, the other pages leave it parked. */}
          <PersistentMapHost>{children}</PersistentMapHost>
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
  help,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  /** The section's "?" (SectionHelpButton): on the title's own line, never a row of its own on a phone. */
  help?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="scroll-y absolute inset-0">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="font-display text-2xl font-extrabold">{title}</h1>
              {help}
            </div>
            {subtitle ? <p className="text-muted mt-1 text-sm">{subtitle}</p> : null}
          </div>
          {actions}
        </div>
        {children}
      </div>
    </div>
  );
}
