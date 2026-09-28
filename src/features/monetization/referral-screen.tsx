'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Ban,
  CheckCircle2,
  Copy,
  Gift,
  Mail,
  MessageCircle,
  Send,
  Share2,
  UserCheck,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import type { z } from 'zod';
import type { ReferralDto } from '@/contracts';
import { monetizationApi } from '@/lib/api/depth';
import { qk } from '@/lib/api/query-keys';
import { useErrorMessage } from '@/lib/api/error-message';
import { track } from '@/lib/analytics';
import { formatAmount, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { useIsDesktop } from '@/hooks/use-media-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditAmount } from '@/components/ui/credit-amount';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Card, EmptyState, ProgressBar, SectionTitle, Skeleton } from '@/components/ui/misc';
import { useCareerId } from '@/features/game/hooks';
import { PageBody } from '@/features/game/shell';
import { useMonetizationPageGuard } from './gate';
import { copyText, nativeShare, shareIntentUrl, type ShareChannel, type SharePayload } from './share';

type Referral = z.infer<typeof ReferralDto>;
type Invited = Referral['invited'][number];
type InviteStatus = Invited['status'];

const STATUS_VISUAL: Record<InviteStatus, { icon: LucideIcon; className: string }> = {
  REGISTERED: { icon: UserPlus, className: 'text-info border-info/40 bg-info/10' },
  ACTIVATED: { icon: UserCheck, className: 'text-success border-success/40 bg-success/10' },
  REWARDED: { icon: Gift, className: 'text-credits border-credits/40 bg-credits/10' },
  INVALIDATED: { icon: Ban, className: 'text-muted border-border-strong bg-surface-3' },
};
const isInviteStatus = (s: string): s is InviteStatus => s in STATUS_VISUAL;

export function InviteStatusChip({ status }: { status: InviteStatus }) {
  const t = useTranslations('monetization.referral.status');
  const { icon: Icon, className } = STATUS_VISUAL[status];
  return (
    <span
      data-status={status}
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-semibold whitespace-nowrap',
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {t(status)}
    </span>
  );
}

const CHANNELS: { channel: ShareChannel; icon: LucideIcon }[] = [
  { channel: 'whatsapp', icon: MessageCircle },
  { channel: 'telegram', icon: Send },
  { channel: 'email', icon: Mail },
];

/** Fallback share sheet (also reachable when the native sheet exists but was unsupported for this payload). */
function ShareSheet({
  payload,
  open,
  onOpenChange,
  onCopy,
}: {
  payload: SharePayload;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCopy: () => void;
}) {
  const t = useTranslations('monetization.referral.share');
  const tc = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('title')}
        description={t('subtitle')}
        closeLabel={tc('close')}
        data-testid="share-sheet"
      >
        <ul className="flex flex-col gap-2">
          <li>
            <Button variant="secondary" size="lg" className="w-full justify-start" onClick={onCopy}>
              <Copy className="size-5" aria-hidden />
              {t('copy')}
            </Button>
          </li>
          {CHANNELS.map(({ channel, icon: Icon }) => (
            <li key={channel}>
              <Button asChild variant="secondary" size="lg" className="w-full justify-start">
                <a
                  href={shareIntentUrl(channel, payload)}
                  target="_blank"
                  rel="noreferrer"
                  data-channel={channel}
                  onClick={() => track('referral_shared', { channel })}
                >
                  <Icon className="size-5" aria-hidden />
                  {t(channel)}
                </a>
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export function InviteCard({ referral }: { referral: Referral }) {
  const t = useTranslations('monetization.referral');
  const locale = useLocale();
  const [sheet, setSheet] = React.useState(false);
  const payload: SharePayload = {
    title: t('share.messageTitle'),
    text: t('share.message', { credits: formatAmount(referral.rewardInvited, locale) }),
    url: referral.inviteUrl,
  };
  const copy = async (value: string, kind: 'link' | 'code') => {
    const ok = await copyText(value);
    toast(
      ok
        ? { tone: 'success', title: t(kind === 'link' ? 'linkCopied' : 'codeCopied') }
        : { tone: 'warning', title: t('copyFailed') },
    );
    if (ok) track('referral_shared', { channel: `copy_${kind}` });
  };
  const share = async () => {
    const outcome = await nativeShare(payload);
    if (outcome === 'shared') track('referral_shared', { channel: 'native' });
    else if (outcome === 'unsupported') setSheet(true);
  };
  return (
    <Card className="flex flex-col gap-3" data-testid="invite-card">
      <SectionTitle>{t('yourCode')}</SectionTitle>
      <div className="flex flex-wrap items-center gap-2">
        <code
          className="border-border-strong bg-surface-2 tabular rounded-md border px-3 py-2 font-mono text-xl font-semibold tracking-[0.2em]"
          data-testid="referral-code"
        >
          {referral.code}
        </code>
        <Button variant="ghost" size="sm" onClick={() => void copy(referral.code, 'code')}>
          <Copy className="size-4" aria-hidden />
          {t('copyCode')}
        </Button>
      </div>
      <p className="text-muted text-sm break-all" data-testid="invite-url">
        {referral.inviteUrl}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button size="lg" onClick={() => void share()} data-testid="share-invite">
          <Share2 className="size-5" aria-hidden />
          {t('shareCta')}
        </Button>
        <Button
          size="lg"
          variant="secondary"
          onClick={() => void copy(referral.inviteUrl, 'link')}
          data-testid="copy-invite"
        >
          <Copy className="size-5" aria-hidden />
          {t('copyLink')}
        </Button>
      </div>
      <ShareSheet
        payload={payload}
        open={sheet}
        onOpenChange={setSheet}
        onCopy={() => {
          setSheet(false);
          void copy(referral.inviteUrl, 'link');
        }}
      />
    </Card>
  );
}

export function NetworkProgressCard({ referral }: { referral: Referral }) {
  const t = useTranslations('monetization.referral');
  const tc = useTranslations('common');
  const done = referral.activated >= referral.required;
  return (
    <Card className="flex flex-col gap-3" data-testid="network-progress">
      <SectionTitle
        action={
          referral.rewardClaimed ? (
            <Badge tone="success" data-testid="reward-claimed">
              <CheckCircle2 className="size-3" aria-hidden />
              {t('rewardClaimed')}
            </Badge>
          ) : null
        }
      >
        {t('progressTitle')}
      </SectionTitle>
      <p className="font-display tabular text-3xl font-extrabold" data-testid="network-count">
        {referral.activated}/{referral.required}
      </p>
      <ProgressBar
        value={referral.required === 0 ? 1 : referral.activated / referral.required}
        label={t('progressLabel', { activated: referral.activated, required: referral.required })}
        tone={done ? 'success' : 'brand'}
      />
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Gift className="text-credits size-4" aria-hidden />
        {t('rewardReferrer')} <CreditAmount value={referral.rewardReferrer} sign label={tc('credits')} />
      </p>
      <p className="text-muted text-sm">
        {referral.rewardClaimed ? t('rewardClaimedHint') : done ? t('rewardPending') : t('progressHint')}
      </p>
    </Card>
  );
}

export function MyInvitationCard({ referral }: { referral: Referral }) {
  const t = useTranslations('monetization.referral.mine');
  const tc = useTranslations('common');
  const invitation = referral.myInvitation;
  if (!invitation) return null;
  const { missionsRequired, distinctDaysRequired } = referral.activation;
  const validated = invitation.status === 'ACTIVATED' || invitation.status === 'REWARDED';
  return (
    <Card className="flex flex-col gap-3" data-testid="my-invitation">
      <SectionTitle
        action={isInviteStatus(invitation.status) ? <InviteStatusChip status={invitation.status} /> : null}
      >
        {t('title')}
      </SectionTitle>
      <p className="text-sm">{t('invitedBy', { name: invitation.referrerName })}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="tabular mb-1 text-sm">
            {t('missions', { done: invitation.missionsDone, required: missionsRequired })}
          </p>
          <ProgressBar
            value={invitation.missionsDone / Math.max(1, missionsRequired)}
            label={t('missions', { done: invitation.missionsDone, required: missionsRequired })}
            tone="info"
          />
        </div>
        <div>
          <p className="tabular mb-1 text-sm">
            {t('days', { done: invitation.daysDone, required: distinctDaysRequired })}
          </p>
          <ProgressBar
            value={invitation.daysDone / Math.max(1, distinctDaysRequired)}
            label={t('days', { done: invitation.daysDone, required: distinctDaysRequired })}
            tone="info"
          />
        </div>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Gift className="text-credits size-4" aria-hidden />
        {validated ? t('bonusReceived') : t('bonus')}
        <CreditAmount value={referral.rewardInvited} sign label={tc('credits')} />
      </p>
    </Card>
  );
}

export function InvitedList({ invited }: { invited: Invited[] }) {
  const t = useTranslations('monetization.referral');
  const locale = useLocale();
  const desktop = useIsDesktop();
  if (invited.length === 0)
    return (
      <EmptyState
        icon={<UserPlus className="size-6" />}
        title={t('invitedEmpty')}
        description={t('invitedEmptyHint')}
      />
    );
  const columns: Column<Invited>[] = [
    { id: 'name', header: t('col.director'), width: 'minmax(180px,2fr)', cell: (r) => r.directorName },
    {
      id: 'status',
      header: t('col.status'),
      width: '170px',
      cell: (r) => <InviteStatusChip status={r.status} />,
    },
    {
      id: 'joined',
      header: t('col.joined'),
      width: '180px',
      cell: (r) => <span className="tabular text-muted">{formatDateTime(r.joinedAt, locale)}</span>,
      sortValue: (r) => r.joinedAt,
    },
  ];
  return desktop ? (
    <DataTable
      caption={t('invitedTitle')}
      columns={columns}
      rows={invited}
      rowKey={(r) => `${r.directorName}|${r.joinedAt}`}
      density="dense"
      maxHeight={320}
    />
  ) : (
    <ul className="flex flex-col gap-2">
      {invited.map((r) => (
        <li
          key={`${r.directorName}|${r.joinedAt}`}
          className="border-border bg-surface-2 flex items-center gap-3 rounded-md border p-3"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{r.directorName}</span>
            <span className="tabular text-subtle block text-xs">{formatDateTime(r.joinedAt, locale)}</span>
          </span>
          <InviteStatusChip status={r.status} />
        </li>
      ))}
    </ul>
  );
}

/** `/game/network` — "Costruisci la tua rete": invite two Directors, both sides are rewarded on activation. */
export function ReferralScreen() {
  const allowed = useMonetizationPageGuard('referrals');
  return allowed ? <ReferralContent /> : null;
}

function ReferralContent() {
  const t = useTranslations('monetization.referral');
  const careerId = useCareerId();
  const errorMessage = useErrorMessage();
  const query = useQuery({
    queryKey: qk.referrals(careerId),
    queryFn: () => monetizationApi.referrals(careerId),
  });
  React.useEffect(() => {
    track('referral_panel_viewed');
  }, []);
  const referral = query.data;
  return (
    <PageBody title={t('title')} subtitle={t('subtitle')}>
      {query.isLoading ? (
        <Skeleton className="h-64" />
      ) : !referral ? (
        <EmptyState title={errorMessage(query.error)} />
      ) : (
        <>
          <MyInvitationCard referral={referral} />
          <div className="grid gap-4 md:grid-cols-2">
            <InviteCard referral={referral} />
            <NetworkProgressCard referral={referral} />
          </div>
          <Card>
            <SectionTitle>{t('rulesTitle')}</SectionTitle>
            <ol className="text-muted flex list-decimal flex-col gap-1.5 pl-5 text-sm">
              <li>{t('rules.share')}</li>
              <li>
                {t('rules.activation', {
                  missions: referral.activation.missionsRequired,
                  days: referral.activation.distinctDaysRequired,
                })}
              </li>
              <li>{t('rules.reward', { required: referral.required })}</li>
              <li>{t('rules.fair')}</li>
            </ol>
          </Card>
          <section aria-labelledby="invited-title">
            <SectionTitle className="mt-2">
              <span id="invited-title">{t('invitedTitle')}</span>
            </SectionTitle>
            <InvitedList invited={referral.invited} />
          </section>
        </>
      )}
    </PageBody>
  );
}
