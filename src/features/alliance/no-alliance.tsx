'use client';
import * as React from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Handshake, Lock, Mail, Search } from 'lucide-react';
import type { AllianceCardDto, AllianceHomeDto, SupportedLocale } from '@/contracts';
import { allianceApi, type AllianceSearchParams } from '@/lib/api/alliance';
import { qk } from '@/lib/api/query-keys';
import { LOCALES, LOCALE_NAMES } from '@/i18n/config';
import { useSnapshot } from '@/features/game/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, EmptyState, SectionTitle, Skeleton } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TimeAgo } from '@/components/ui/time-ago';
import { AllianceCardRow, AllianceDetailDialog, type JoinIntent } from './alliance-card';
import { Emblem } from './emblem';
import { FoundForm } from './found-form';
import { useAllianceMutation } from './hooks';

/** Below the join level: one row that says when the section unlocks (study 09 §2.1). */
export function LockedRow({ level, required }: { level: number; required: number }) {
  const t = useTranslations('alliance.locked');
  return (
    <Card className="flex items-center gap-3" data-testid="alliance-locked">
      <Lock className="text-subtle size-5 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">{t('title', { level: required })}</p>
        <p className="text-muted text-sm">{t('body', { level: required, current: level })}</p>
      </div>
    </Card>
  );
}

function useAllianceSearch(params: AllianceSearchParams, enabled: boolean) {
  const key = JSON.stringify({
    q: params.q ?? '',
    language: params.language ?? '',
    joinPolicy: params.joinPolicy ?? '',
    hasSlots: !!params.hasSlots,
  });
  return useInfiniteQuery({
    queryKey: qk.allianceSearch(key),
    queryFn: ({ pageParam }) => allianceApi.search({ ...params, cursor: pageParam, limit: 20 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.meta.hasMore ? (last.meta.nextCursor ?? null) : null),
    staleTime: 15_000,
    enabled,
  });
}

/** "Trova un'alleanza": list, filters, search, the card with Entra / Chiedi di entrare (study 02 §5, 09 §2.1). */
export function FindAlliances({ home, onJoined }: { home: AllianceHomeDto; onJoined: () => void }) {
  const t = useTranslations('alliance.find');
  const tp = useTranslations('alliance.policy');
  const [q, setQ] = React.useState('');
  const [language, setLanguage] = React.useState<string>('all');
  const [openOnly, setOpenOnly] = React.useState(false);
  const [hasSlots, setHasSlots] = React.useState(false);
  const [selected, setSelected] = React.useState<AllianceCardDto | null>(null);
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);
  const search = useAllianceSearch(
    {
      q: debounced || undefined,
      language: language === 'all' ? undefined : (language as SupportedLocale),
      joinPolicy: openOnly ? 'OPEN' : undefined,
      hasSlots,
    },
    true,
  );
  const rows = search.data?.pages.flatMap((p) => p.data) ?? [];
  const join = useAllianceMutation(
    (careerId, intent: JoinIntent) => allianceApi.join(careerId, { allianceId: intent.allianceId }),
    {
      successToast: (result) => (result.outcome === 'JOINED' ? t('joined') : t('requested')),
      onSuccess: (result) => {
        setSelected(null);
        if (result.outcome === 'JOINED') onJoined();
      },
    },
  );
  const withdraw = useAllianceMutation(
    (careerId, requestId: string) => allianceApi.withdrawRequest(careerId, requestId),
    {
      successToast: t('withdrawn'),
      onSuccess: () => setSelected(null),
    },
  );
  // The dialog shows the freshest relation (a request just made, a pending invite): re-read from the list when it changes.
  const current = selected ? (rows.find((r) => r.id === selected.id) ?? selected) : null;
  void home;
  return (
    <div className="flex flex-col gap-3" data-testid="alliance-find">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          leading={<Search className="size-4" aria-hidden />}
          placeholder={t('search')}
          aria-label={t('search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="sm:flex-1"
          data-testid="alliance-search"
        />
        <Select
          label={t('language')}
          value={language}
          onValueChange={setLanguage}
          options={[
            { value: 'all', label: t('anyLanguage') },
            ...LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] })),
          ]}
          className="sm:w-44"
        />
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <Switch
            checked={openOnly}
            onCheckedChange={setOpenOnly}
            aria-label={t('openOnly')}
            data-testid="filter-open"
          />
          {t('openOnly')}
        </label>
        <label className="flex items-center gap-2">
          <Switch
            checked={hasSlots}
            onCheckedChange={setHasSlots}
            aria-label={t('hasSlots')}
            data-testid="filter-slots"
          />
          {t('hasSlots')}
        </label>
        <span className="text-subtle ml-auto text-xs">{t('sortedByActivity')}</span>
      </div>
      {search.isPending ? (
        <Skeleton className="h-40" />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Handshake className="size-6" />} title={t('empty')} description={t('emptyHint')} />
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t('listLabel')} data-testid="alliance-list">
          {rows.map((a) => (
            <AllianceCardRow
              key={a.id}
              alliance={a}
              onOpen={() => setSelected(a)}
              trailing={
                a.viewer?.blockedReason === 'REQUEST_PENDING' ? (
                  <span className="text-subtle shrink-0 text-xs">{t('requestedShort')}</span>
                ) : a.joinPolicy !== 'INVITE' && a.viewer?.canJoin ? (
                  <Button
                    size="sm"
                    variant={a.joinPolicy === 'OPEN' ? 'primary' : 'secondary'}
                    onClick={() =>
                      join.mutate({ kind: a.joinPolicy === 'REQUEST' ? 'request' : 'join', allianceId: a.id })
                    }
                    loading={join.isPending && join.variables?.allianceId === a.id}
                    data-testid="alliance-quick-join"
                  >
                    {a.joinPolicy === 'OPEN' ? t('join') : t('request')}
                  </Button>
                ) : (
                  <span className="text-subtle shrink-0 text-xs">{tp(a.joinPolicy)}</span>
                )
              }
            />
          ))}
        </ul>
      )}
      {search.hasNextPage ? (
        <Button
          variant="outline"
          onClick={() => void search.fetchNextPage()}
          loading={search.isFetchingNextPage}
          className="self-center"
        >
          {t('loadMore')}
        </Button>
      ) : null}
      <AllianceDetailDialog
        alliance={current}
        open={current !== null}
        onOpenChange={(open) => !open && setSelected(null)}
        onJoin={(intent) => join.mutate(intent)}
        onWithdraw={(id) => withdraw.mutate(id)}
        pending={join.isPending || withdraw.isPending}
      />
    </div>
  );
}

/** Invites received and the own pending requests, on top of the no-alliance screen (study 09 §2.1). */
function InvitesAndRequests({ home, onJoined }: { home: AllianceHomeDto; onJoined: () => void }) {
  const t = useTranslations('alliance');
  const accept = useAllianceMutation(
    (careerId, inviteId: string) => allianceApi.join(careerId, { inviteId }),
    {
      successToast: t('find.joined'),
      onSuccess: onJoined,
    },
  );
  const decline = useAllianceMutation(
    (careerId, inviteId: string) => allianceApi.revokeInvite(careerId, inviteId),
    {
      successToast: t('invites.declined'),
    },
  );
  const withdraw = useAllianceMutation(
    (careerId, requestId: string) => allianceApi.withdrawRequest(careerId, requestId),
    {
      successToast: t('find.withdrawn'),
    },
  );
  if (home.invites.length === 0 && home.joinRequests.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {home.invites.length > 0 ? (
        <Card>
          <SectionTitle>{t('invites.received')}</SectionTitle>
          <ul className="flex flex-col gap-2" data-testid="alliance-invites-received">
            {home.invites.map((invite) => {
              const full = invite.alliance.members >= invite.alliance.memberSlots;
              return (
                <AllianceCardRow
                  key={invite.id}
                  alliance={invite.alliance}
                  trailing={
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => decline.mutate(invite.id)}
                          loading={decline.isPending && decline.variables === invite.id}
                        >
                          {t('invites.decline')}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => accept.mutate(invite.id)}
                          disabled={full || !invite.alliance.viewer?.canJoin}
                          loading={accept.isPending && accept.variables === invite.id}
                          data-testid="invite-accept"
                        >
                          {t('invites.accept')}
                        </Button>
                      </div>
                      <span className="text-subtle text-xs">
                        {full ? (
                          t('invites.full')
                        ) : (
                          <>
                            {t('invites.from', { name: invite.invitedBy.directorName ?? '…' })} ·{' '}
                            {t('invites.expires')} <TimeAgo at={invite.expiresAt} />
                          </>
                        )}
                      </span>
                    </div>
                  }
                />
              );
            })}
          </ul>
        </Card>
      ) : null}
      {home.joinRequests.length > 0 ? (
        <Card>
          <SectionTitle>{t('requests.mine')}</SectionTitle>
          <ul className="flex flex-col gap-2" data-testid="alliance-my-requests">
            {home.joinRequests.map((r) => (
              <li
                key={r.id}
                className="border-border bg-surface-2 flex items-center gap-3 rounded-md border p-3"
              >
                <Emblem emblem={r.alliance.emblem} size={36} />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-semibold">
                    {r.alliance.name} <span className="tabular text-muted text-xs">[{r.alliance.tag}]</span>
                  </p>
                  <p className="text-muted text-xs">
                    {t('requests.mineBody')} {t('invites.expires')} <TimeAgo at={r.expiresAt} />
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => withdraw.mutate(r.id)}
                  loading={withdraw.isPending}
                  data-testid="request-withdraw"
                >
                  {t('find.withdraw')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

/** The "no alliance" state: invites on top, then Trova / Fonda; below the join level only the locked row. */
export function NoAllianceScreen({
  home,
  onJoined,
  initialTab,
}: {
  home: AllianceHomeDto;
  onJoined: () => void;
  initialTab?: 'find' | 'found';
}) {
  const t = useTranslations('alliance');
  const { career } = useSnapshot();
  const [tab, setTab] = React.useState<'find' | 'found'>(initialTab ?? 'find');
  const found = useAllianceMutation(
    (careerId, body: Parameters<typeof allianceApi.found>[1]) => allianceApi.found(careerId, body),
    {
      successToast: t('found.success'),
      onSuccess: onJoined,
    },
  );
  if (career.level < home.config.joinLevel)
    return <LockedRow level={career.level} required={home.config.joinLevel} />;
  return (
    <div className="flex flex-col gap-4" data-testid="alliance-none">
      {home.cooldownUntil ? (
        <Card className="flex items-center gap-3" data-testid="alliance-cooldown">
          <Mail className="text-subtle size-5 shrink-0" aria-hidden />
          <div className="text-sm">
            <p className="font-semibold">{t('cooldown.title')}</p>
            <p className="text-muted">
              {t('cooldown.body', { hours: home.config.cooldownHours })} <TimeAgo at={home.cooldownUntil} />.
            </p>
          </div>
        </Card>
      ) : null}
      <InvitesAndRequests home={home} onJoined={onJoined} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'find' | 'found')}>
        <TabsList aria-label={t('tabsLabel')}>
          <TabsTrigger value="find" data-testid="tab-find">
            {t('find.title')}
          </TabsTrigger>
          <TabsTrigger value="found" data-testid="tab-found">
            {t('found.title')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="find" className="pt-3">
          <FindAlliances home={home} onJoined={onJoined} />
        </TabsContent>
        <TabsContent value="found" className="pt-3">
          <FoundForm
            config={home.config}
            level={career.level}
            credits={career.credits}
            onSubmit={(body) => found.mutate(body)}
            pending={found.isPending}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
