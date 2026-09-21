'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, ChevronRight, Lock, LogOut, Trash2 } from 'lucide-react';
import type { LedgerEntryDto } from '@/lib/api/types';
import type { UnlockDto } from '@/contracts';
import { authApi, gameApi } from '@/lib/api/endpoints';
import { setAccessToken, setSessionHint } from '@/lib/api/client';
import { qk } from '@/lib/api/query-keys';
import { useErrorMessage } from '@/lib/api/error-message';
import { amountRatio, formatAmount, formatDateTime } from '@/lib/format';
import { useAuthStore } from '@/stores/auth';
import { useSettingsStore } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { useIsDesktop } from '@/hooks/use-media-query';
import { useI18nText } from '@/i18n/use-i18n-text';
import { FamilyBadge } from '@/design/icons';
import { LanguageSelect } from '@/features/settings/language-select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditAmount } from '@/components/ui/credit-amount';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Card, EmptyState, ProgressBar, SectionTitle, Skeleton, Stat } from '@/components/ui/misc';
import { Switch } from '@/components/ui/switch';
import { StipendCard } from '@/features/world/stipend-card';
import { MilestonesCard, ReputationCard } from '@/features/world/progression-extras';
import { MORE_ITEMS } from './nav';
import { useVisibleNav } from './use-nav';
import { DutyToggle } from './duty-toggle';
import { PrivacyAndAppSettings, SoundSettings } from '@/features/platform/settings-sections';
import { track } from '@/lib/analytics';
import { SectionHelpButton, SectionPrimer } from '@/features/coaching/section-primer';
import { useCareerId, useSnapshot } from './hooks';
import { PageBody } from './shell';

/* ───────────────────────────── progression ───────────────────────────── */
export function ProgressionScreen() {
  const careerId = useCareerId();
  const t = useTranslations('game.progression');
  const tc = useTranslations('common');
  const tp = useTranslations('coaching.sections.progression');
  const tco = useTranslations('coaching');
  const tx = useI18nText();
  const locale = useLocale();
  const { career } = useSnapshot();
  const progressionContent = {
    sectionKey: 'progression',
    title: tp('title'),
    body: tp('body'),
    tips: [tp('tip1'), tp('tip2')],
  };
  const progression = useQuery({
    queryKey: [...qk.progression(careerId), career.xp],
    queryFn: () => gameApi.progression(careerId),
  }).data;
  const unlocks = useQuery({
    queryKey: [...qk.unlocks(careerId), career.level],
    queryFn: () => gameApi.unlocks(careerId),
  }).data;
  const span = BigInt(career.xpForNextLevel) - BigInt(career.xpForCurrentLevel);
  const into = BigInt(career.xp) - BigInt(career.xpForCurrentLevel);
  const byLevel = React.useMemo(() => {
    const m = new Map<number, UnlockDto[]>();
    for (const u of unlocks ?? []) m.set(u.requiredLevel, [...(m.get(u.requiredLevel) ?? []), u]);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [unlocks]);
  return (
    <PageBody
      title={t('title')}
      subtitle={t('subtitle')}
      actions={
        <SectionHelpButton
          content={progressionContent}
          label={tco('help.buttonLabel')}
          closeLabel={tc('close')}
        />
      }
    >
      <SectionPrimer content={progressionContent} />
      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <span
            className="tabular border-xp grid size-16 shrink-0 place-items-center rounded-full border-4 text-2xl font-bold"
            aria-label={t('level', { level: career.level })}
          >
            {career.level}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-bold">{t('level', { level: career.level })}</p>
            <ProgressBar value={amountRatio(into, span)} label={t('xpProgress')} tone="xp" className="mt-2" />
            <p className="tabular text-muted mt-1 text-xs">
              {formatAmount(into, locale)} / {formatAmount(span, locale)} XP ·{' '}
              {t('toNext', { xp: formatAmount(span - into, locale) })}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label={t('totalXp')} value={formatAmount(career.xp, locale)} />
          <Stat label={t('reputation')} value={`${Math.round(career.reputation)}/100`} />
          <Stat label={t('resolved')} value={progression?.incidentsResolved ?? '—'} />
          <Stat label={t('failed')} value={progression?.incidentsFailed ?? '—'} />
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <ReputationCard />
        <MilestonesCard />
      </div>
      <Card>
        <SectionTitle>{t('unlocks')}</SectionTitle>
        {!unlocks ? (
          <Skeleton className="h-40" />
        ) : (
          <ol className="flex flex-col gap-3">
            {byLevel.map(([level, items]) => {
              const reached = level <= career.level;
              return (
                <li key={level} className="flex gap-3" data-testid="unlock-level" data-reached={reached}>
                  <span
                    className={`tabular grid size-9 shrink-0 place-items-center rounded-full border-2 text-sm font-bold ${reached ? 'border-success text-success' : 'border-border-strong text-subtle'}`}
                  >
                    {level}
                  </span>
                  <ul className="flex min-w-0 flex-1 flex-wrap gap-1.5 pt-1">
                    {items.map((u) => (
                      <li key={`${u.kind}-${u.code}`}>
                        <Badge
                          tone={u.kind === 'FAMILY' ? (reached ? 'success' : 'info') : 'neutral'}
                          className="h-6"
                        >
                          {reached ? (
                            <CheckCircle2 className="size-3" aria-label={tc('unlocked')} />
                          ) : (
                            <Lock className="size-3" aria-label={tc('locked')} />
                          )}
                          {u.kind === 'FAMILY' && u.family ? (
                            <FamilyBadge family={u.family} size={14} />
                          ) : null}
                          {tx(u.name)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </PageBody>
  );
}

/* ───────────────────────────── economy ───────────────────────────── */
export function EconomyScreen() {
  const careerId = useCareerId();
  const t = useTranslations('game.economy');
  const tc = useTranslations('common');
  const tx = useI18nText();
  const locale = useLocale();
  const desktop = useIsDesktop();
  const { career } = useSnapshot();
  const balance = useQuery({
    queryKey: [...qk.balance(careerId), career.credits],
    queryFn: () => gameApi.balance(careerId),
  }).data;
  const ledger = useInfiniteQuery({
    queryKey: [...qk.ledger(careerId), career.credits],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => gameApi.ledger(careerId, pageParam),
    getNextPageParam: (last) => (last.meta.hasMore ? (last.meta.nextCursor ?? null) : null),
  });
  const rows = ledger.data?.pages.flatMap((p) => p.data) ?? [];
  const columns: Column<LedgerEntryDto>[] = [
    {
      id: 'date',
      header: t('col.date'),
      width: '170px',
      cell: (r) => <span className="tabular text-muted">{formatDateTime(r.createdAt, locale)}</span>,
      sortValue: (r) => r.createdAt,
    },
    { id: 'desc', header: t('col.description'), width: 'minmax(220px,3fr)', cell: (r) => tx(r.description) },
    {
      id: 'amount',
      header: t('col.amount'),
      width: '130px',
      align: 'right',
      cell: (r) => <CreditAmount value={r.amount} sign label={tc('credits')} />,
      sortValue: (r) => BigInt(r.amount),
    },
    {
      id: 'balance',
      header: t('col.balance'),
      width: '130px',
      align: 'right',
      cell: (r) => formatAmount(r.balanceAfter, locale),
    },
  ];
  return (
    <PageBody title={t('title')} subtitle={t('subtitle')}>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <SectionTitle>{t('balance')}</SectionTitle>
          <CreditAmount value={career.credits} label={tc('credits')} size="lg" className="text-3xl" />
          <div className="grid grid-cols-2 gap-3">
            <Stat label={t('earned')} value={balance ? formatAmount(balance.lifetimeEarned, locale) : '—'} />
            <Stat label={t('spent')} value={balance ? formatAmount(balance.lifetimeSpent, locale) : '—'} />
          </div>
        </Card>
        <StipendCard />
      </div>
      <SectionTitle className="mt-2">{t('ledger')}</SectionTitle>
      {ledger.isLoading ? (
        <Skeleton className="h-40" />
      ) : desktop ? (
        <DataTable
          caption={t('ledger')}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          density="dense"
          maxHeight={420}
          empty={<EmptyState title={t('ledgerEmpty')} />}
        />
      ) : rows.length === 0 ? (
        <EmptyState title={t('ledgerEmpty')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="border-border bg-surface-2 flex items-center gap-3 rounded-md border p-3"
              data-testid="ledger-row"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{tx(r.description)}</span>
                <span className="tabular text-subtle block text-[11px]">
                  {formatDateTime(r.createdAt, locale)}
                </span>
              </span>
              <CreditAmount value={r.amount} sign label={tc('credits')} />
            </li>
          ))}
        </ul>
      )}
      {ledger.hasNextPage ? (
        <Button
          variant="secondary"
          onClick={() => void ledger.fetchNextPage()}
          loading={ledger.isFetchingNextPage}
        >
          {t('loadMore')}
        </Button>
      ) : null}
    </PageBody>
  );
}

/* ───────────────────────────── settings ───────────────────────────── */
function SettingRow({ title, hint, control }: { title: string; hint?: string; control: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        {hint ? <p className="text-muted text-xs">{hint}</p> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

export function SettingsScreen() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const tk = useTranslations('coaching');
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clear);
  const settings = useSettingsStore();
  const sessions = useQuery({ queryKey: qk.sessions, queryFn: authApi.sessions });
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const signOut = () => {
    setAccessToken(null);
    setSessionHint(false);
    clearAuth();
    qc.clear();
    router.replace('/auth');
  };
  const logout = useMutation({ mutationFn: authApi.logout, onSettled: signOut });
  const revoke = useMutation({
    mutationFn: authApi.revokeSession,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.sessions }),
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });
  const remove = useMutation({
    mutationFn: authApi.requestDeletion,
    onSuccess: () => {
      toast({ tone: 'info', title: t('deleteRequested') });
      signOut();
    },
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });

  return (
    <PageBody title={t('title')}>
      <Card>
        <SectionTitle>{t('account')}</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label={t('directorName')} value={<span className="font-sans">{user?.directorName}</span>} />
          <Stat label={t('email')} value={<span className="font-sans text-sm">{user?.email}</span>} />
        </div>
      </Card>
      <Card className="divide-border divide-y">
        <SectionTitle>{t('preferences')}</SectionTitle>
        <SettingRow title={t('language')} control={<LanguageSelect />} />
        <SettingRow
          title={t('reducedMotion')}
          hint={t('reducedMotionHint')}
          control={
            <Switch
              checked={settings.reducedMotion}
              onCheckedChange={(value) => {
                settings.setReducedMotion(value);
                track('settings_changed', { setting: 'reducedMotion', value });
              }}
              aria-label={t('reducedMotion')}
              data-testid="reduced-motion-toggle"
            />
          }
        />
        <SettingRow
          title={tk('toggle.label')}
          hint={tk('toggle.hint')}
          control={
            <Switch
              checked={settings.tutorialHints}
              onCheckedChange={(value) => {
                settings.setTutorialHints(value);
                track('settings_changed', { setting: 'tutorialHints', value });
              }}
              aria-label={tk('toggle.label')}
              data-testid="coaching-toggle"
            />
          }
        />
      </Card>
      <SoundSettings />
      <PrivacyAndAppSettings />
      <Card>
        <SectionTitle>{t('duty')}</SectionTitle>
        <DutyToggle />
      </Card>
      <Card>
        <SectionTitle>{t('sessions')}</SectionTitle>
        {!sessions.data ? (
          <Skeleton className="h-16" />
        ) : (
          <ul className="divide-border divide-y">
            {sessions.data.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{s.userAgent ?? t('unknownDevice')}</p>
                  <p className="text-subtle text-[11px]">
                    {t('lastUsed', { date: formatDateTime(s.lastUsedAt, locale) })}
                  </p>
                </div>
                {s.current ? (
                  <Badge tone="success">{t('thisDevice')}</Badge>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => revoke.mutate(s.id)}
                    loading={revoke.isPending && revoke.variables === s.id}
                  >
                    {t('revoke')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="secondary"
          size="lg"
          onClick={() => logout.mutate()}
          loading={logout.isPending}
          data-testid="logout"
        >
          <LogOut className="size-4" aria-hidden />
          {t('logout')}
        </Button>
        <Button variant="danger" size="lg" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="size-4" aria-hidden />
          {t('deleteAccount')}
        </Button>
      </div>
      <p className="text-subtle text-xs">
        {tc('disclaimer')} · {tc('attribution')}
      </p>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent title={t('deleteTitle')} description={t('deleteBody')} closeLabel={tc('close')}>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              {tc('cancel')}
            </Button>
            <Button variant="danger" onClick={() => remove.mutate()} loading={remove.isPending}>
              {t('deleteConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}

/* ───────────────────────────── more (mobile hub) ───────────────────────────── */
export function MoreScreen() {
  const t = useTranslations('game.nav');
  const { career } = useSnapshot();
  const items = useVisibleNav(MORE_ITEMS);
  return (
    <PageBody title={t('more')} subtitle={`${career.directorName} · ${career.locationName}`}>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="border-border bg-surface-2 flex h-14 items-center gap-3 rounded-md border px-4 text-sm font-semibold"
            >
              <item.icon className="text-muted size-5" aria-hidden />
              <span className="flex-1">{t(item.labelKey)}</span>
              <ChevronRight className="text-subtle size-4" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <DutyToggle />
    </PageBody>
  );
}
