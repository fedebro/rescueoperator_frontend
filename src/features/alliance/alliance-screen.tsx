'use client';
import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Handshake, Settings } from 'lucide-react';
import {
  ALLIANCE_TABS,
  AllianceNotificationTarget,
  type AllianceTab,
  type PublicAllianceInviteDto,
} from '@/contracts';
import { allianceApi } from '@/lib/api/alliance';
import { track } from '@/lib/analytics';
import { useQuery } from '@tanstack/react-query';
import { qk } from '@/lib/api/query-keys';
import { useCareerId, useSnapshot } from '@/features/game/hooks';
import { PageBody } from '@/features/game/shell';
import { Button, IconButton } from '@/components/ui/button';
import { Card, EmptyState, Skeleton } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Emblem } from './emblem';
import { FeatureOff } from './feature-off';
import { useAllianceHome, useAllianceMutation } from './hooks';
import { NoAllianceScreen } from './no-alliance';
import { OverviewTab } from './overview-tab';
import { MembersTab } from './members-tab';
import { DirectorCardDialog } from './director-card';
import { AllianceLogDialog, AllianceSettingsSheet } from './settings-sheet';
import { CommunityRulesDialog } from './community-rules';
import { RankingTab } from './ranking-tab';
import { BoardTab } from './board-tab';
import { AidTab } from './aid-tab';
import { BlockConfirmDialog, ReportDialog, type ReportTarget } from './report-dialog';

const TAB_KEY = 'rc-alliance-tab';
const INVITE_KEY = 'rc-alliance-invite';

/** The `?focus=` of a notification or a push (`AllianceNotificationTarget`) → the tab to open (and the item, next phases). */
export function focusToTab(
  focus: string | null | undefined,
): { tab: AllianceTab; itemId: string | null } | null {
  if (!focus || !AllianceNotificationTarget.safeParse(focus).success) return null;
  if ((ALLIANCE_TABS as readonly string[]).includes(focus))
    return { tab: focus as AllianceTab, itemId: null };
  const [kind, id] = focus.split(':') as [string, string];
  return { tab: kind === 'post' ? 'board' : kind === 'aid' ? 'aid' : 'overview', itemId: id ?? null };
}

/** A code typed on the public landing before signing in waits here until the section opens. */
export function rememberAllianceInvite(code: string): void {
  try {
    localStorage.setItem(INVITE_KEY, code.toUpperCase());
  } catch {
    /* storage unavailable */
  }
}
function takeRememberedInvite(): string | null {
  try {
    const code = localStorage.getItem(INVITE_KEY);
    if (code) localStorage.removeItem(INVITE_KEY);
    return code;
  } catch {
    return null;
  }
}
function readTab(): AllianceTab {
  try {
    const saved = localStorage.getItem(TAB_KEY);
    return saved && (ALLIANCE_TABS as readonly string[]).includes(saved)
      ? (saved as AllianceTab)
      : 'overview';
  } catch {
    return 'overview';
  }
}

/** An invite link opened by a signed-in player: the card of the alliance with "Entra" (the join needs the code). */
function InviteCodeCard({ code, onDone }: { code: string; onDone: () => void }) {
  const t = useTranslations('alliance.invites');
  const tc = useTranslations('common');
  const invite = useQuery({
    queryKey: qk.publicAllianceInvite(code),
    queryFn: () => allianceApi.publicInvite(code),
    retry: false,
  });
  const join = useAllianceMutation(
    (careerId, inviteCode: string) => allianceApi.join(careerId, { inviteCode }),
    {
      successToast: t('joinedToast'),
      onSuccess: onDone,
    },
  );
  const data: PublicAllianceInviteDto | undefined = invite.data;
  if (invite.isPending) return <Skeleton className="h-24" />;
  if (!data || !data.valid || !data.alliance)
    return (
      <Card className="flex items-center justify-between gap-3" data-testid="invite-card-invalid">
        <p className="text-muted text-sm">{t('linkInvalid')}</p>
        <Button variant="ghost" size="sm" onClick={onDone}>
          {tc('close')}
        </Button>
      </Card>
    );
  const a = data.alliance;
  const full = a.members >= a.memberSlots;
  return (
    <Card className="flex flex-wrap items-center gap-3" data-testid="invite-card">
      <Emblem emblem={a.emblem} size={44} />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">{t('linkTitle', { name: a.name, tag: a.tag })}</p>
        <p className="text-muted text-xs">
          {data.invitedBy ? t('from', { name: data.invitedBy }) : null} ·{' '}
          {t('seats', { count: a.members, slots: a.memberSlots })}
          {full ? ` · ${t('full')}` : ''}
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={onDone}>
        {tc('cancel')}
      </Button>
      <Button
        size="sm"
        onClick={() => join.mutate(code)}
        disabled={full}
        loading={join.isPending}
        data-testid="invite-card-join"
      >
        {t('accept')}
      </Button>
    </Card>
  );
}

/**
 * Deep links are one-shot instructions: `?focus=` (notifications, pushes) picks the tab, `?invite=` shows the card. The
 * body is keyed on them, so its initial state reads them once; the URL is then cleaned.
 */
function AllianceScreenParams() {
  const params = useSearchParams();
  const focus = params.get('focus');
  const invite = params.get('invite');
  return <AllianceScreenBody key={`${focus ?? ''}|${invite ?? ''}`} focus={focus} invite={invite} />;
}

function AllianceScreenBody({ focus, invite }: { focus: string | null; invite: string | null }) {
  const t = useTranslations('alliance');
  const router = useRouter();
  const pathname = usePathname();
  const { career } = useSnapshot();
  const home = useAllianceHome();
  const [tab, setTab] = React.useState<AllianceTab>(() => {
    const target = focusToTab(focus)?.tab;
    return target && target !== 'chat' ? target : readTab() === 'chat' ? 'overview' : readTab();
  });
  const [member, setMember] = React.useState<string | null>(null);
  const [settings, setSettings] = React.useState(false);
  const [log, setLog] = React.useState(false);
  const [rules, setRules] = React.useState(false);
  const careerId = useCareerId();
  const [report, setReport] = React.useState<ReportTarget | null>(null);
  const [block, setBlock] = React.useState<{ careerId: string; directorName: string } | null>(null);
  const focusItem = React.useMemo(() => focusToTab(focus)?.itemId ?? null, [focus]);
  const [inviteCode, setInviteCode] = React.useState<string | null>(
    () => invite?.toUpperCase() ?? takeRememberedInvite(),
  );
  const invitesRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!focus && !invite) return;
    router.replace(pathname, { scroll: false });
    const target = focusToTab(focus);
    if (target)
      track('alliance_focus_opened', { kind: target.itemId ? focus!.split(':')[0]! : 'tab', success: true });
    // `operation:<aop_…>` (a notification, a push): the shared board is its own page.
    if (focus?.startsWith('operation:')) router.push('/game/alliance/operation');
  }, [focus, invite, pathname, router]);
  const selectTab = (next: AllianceTab) => {
    if (next === 'chat') {
      router.push('/game/alliance/chat');
      return;
    }
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* storage unavailable */
    }
  };

  if (home.isPending) return <Skeleton className="h-48" />;
  if (home.isError || !home.data)
    return (
      <EmptyState
        title={t('loadFailed')}
        action={
          <Button variant="secondary" onClick={() => void home.refetch()} loading={home.isFetching}>
            {t('retry')}
          </Button>
        }
      />
    );
  const data = home.data;
  if (!data.config.flags.alliances)
    return (
      <div data-testid="alliance-off">
        <EmptyState
          icon={<Handshake className="size-6" />}
          title={t('off.title')}
          description={t('off.body')}
        />
      </div>
    );
  const refresh = () => void home.refetch();

  if (!data.alliance)
    return (
      <>
        {inviteCode && career.level >= data.config.joinLevel ? (
          <InviteCodeCard
            code={inviteCode}
            onDone={() => {
              setInviteCode(null);
              refresh();
            }}
          />
        ) : null}
        <NoAllianceScreen home={data} onJoined={refresh} />
        <CommunityRulesDialog open={rules} onOpenChange={setRules} />
      </>
    );

  const alliance = data.alliance;
  const flags = data.config.flags;
  return (
    <div className="flex flex-col gap-3" data-testid="alliance-section" data-alliance-id={alliance.id}>
      {inviteCode ? <InviteCodeCard code={inviteCode} onDone={() => setInviteCode(null)} /> : null}
      <Tabs value={tab} onValueChange={(v) => selectTab(v as AllianceTab)}>
        <TabsList aria-label={t('tabsLabel')} className="-mx-4 px-4 lg:mx-0 lg:px-1">
          {ALLIANCE_TABS.map((key) => (
            <TabsTrigger key={key} value={key} data-testid={`alliance-tab-${key}`}>
              {t(`tabs.${key}`)}
              {(key === 'board' && alliance.unread.board > 0) ||
              (key === 'chat' && alliance.unread.chat > 0) ? (
                <span
                  className="tabular bg-brand grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] leading-none font-bold text-white"
                  data-testid={`alliance-tab-unread-${key}`}
                >
                  {key === 'board' ? alliance.unread.board : alliance.unread.chat}
                </span>
              ) : null}
              {key === 'members' && alliance.pendingJoinRequests > 0 ? (
                <span
                  className="tabular bg-brand grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] leading-none font-bold text-white"
                  aria-label={t('requests.pendingAria', { count: alliance.pendingJoinRequests })}
                >
                  {alliance.pendingJoinRequests}
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview" className="pt-3">
          <OverviewTab
            home={data}
            alliance={alliance}
            onInvite={() => {
              selectTab('members');
              requestAnimationFrame(() =>
                invitesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
              );
            }}
            onSettings={() => setSettings(true)}
            onLog={() => setLog(true)}
            onRules={() => setRules(true)}
            onMember={setMember}
          />
        </TabsContent>
        <TabsContent value="board" className="pt-3">
          {flags.board ? (
            <BoardTab
              home={data}
              alliance={alliance}
              careerId={careerId}
              onOpenMember={setMember}
              onReport={setReport}
              onBlock={setBlock}
              onRules={() => setRules(true)}
              focusPostId={focusItem}
            />
          ) : (
            <FeatureOff part="board" />
          )}
        </TabsContent>
        <TabsContent value="chat" className="pt-3">
          {flags.chat ? null : <FeatureOff part="chat" />}
        </TabsContent>
        <TabsContent value="aid" className="pt-3">
          {flags.aid ? <AidTab home={data} focusRequestId={focusItem} /> : <FeatureOff part="aid" />}
        </TabsContent>
        <TabsContent value="members" className="pt-3">
          <MembersTab alliance={alliance} onOpenMember={setMember} onLeft={refresh} invitesRef={invitesRef} />
        </TabsContent>
        <TabsContent value="ranking" className="pt-3">
          {flags.ranking ? <RankingTab /> : <FeatureOff part="ranking" />}
        </TabsContent>
      </Tabs>
      <DirectorCardDialog
        careerId={member}
        onOpenChange={(open) => !open && setMember(null)}
        canInviteFrom={alliance.me.canInvite}
      />
      {settings && alliance.me.role === 'COORDINATOR' ? (
        <AllianceSettingsSheet alliance={alliance} config={data.config} open onOpenChange={setSettings} />
      ) : null}
      {alliance.me.isHighRole ? <AllianceLogDialog open={log} onOpenChange={setLog} /> : null}
      <CommunityRulesDialog open={rules} onOpenChange={setRules} />
      <ReportDialog target={report} onOpenChange={(o) => !o && setReport(null)} />
      <BlockConfirmDialog target={block} onOpenChange={(o) => !o && setBlock(null)} />
    </div>
  );
}

/** `/game/alliance` — the alliance section (study 09 §2): no-alliance state or the six tabs. */
export function AllianceScreen() {
  const t = useTranslations('alliance');
  const home = useAllianceHome();
  const alliance = home.data?.alliance ?? null;
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const subtitle = alliance
    ? `${alliance.name} · [${alliance.tag}] · ${t(`role.${alliance.me.role}`)}`
    : undefined;
  return (
    <PageBody
      title={t('title')}
      subtitle={subtitle}
      actions={
        alliance?.me.role === 'COORDINATOR' ? (
          <IconButton
            label={t('overview.settings')}
            onClick={() => setSettingsOpen(true)}
            data-testid="alliance-settings-button"
          >
            <Settings className="size-5" aria-hidden />
          </IconButton>
        ) : undefined
      }
    >
      {/* `useSearchParams` needs a Suspense boundary (static prerender of the route shell). */}
      <React.Suspense fallback={<Skeleton className="h-48" />}>
        <AllianceScreenParams />
      </React.Suspense>
      {settingsOpen && alliance && home.data && alliance.me.role === 'COORDINATOR' ? (
        <AllianceSettingsSheet
          alliance={alliance}
          config={home.data.config}
          open
          onOpenChange={setSettingsOpen}
        />
      ) : null}
    </PageBody>
  );
}
