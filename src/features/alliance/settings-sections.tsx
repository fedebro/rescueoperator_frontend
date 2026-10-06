'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Download, ShieldCheck, UserX } from 'lucide-react';
import { accountApi, allianceApi, moderationApi } from '@/lib/api/alliance';
import { useErrorMessage } from '@/lib/api/error-message';
import { qk } from '@/lib/api/query-keys';
import { formatDateTime } from '@/lib/format';
import { track } from '@/lib/analytics';
import { toast } from '@/stores/toast';
import { useCareerId } from '@/features/game/hooks';
import { Button } from '@/components/ui/button';
import { Card, SectionTitle, Skeleton } from '@/components/ui/misc';
import { Switch } from '@/components/ui/switch';
import { CommunityRulesDialog } from './community-rules';
import { useBlocks, useCommunityRules } from './hooks';

function Row({ title, hint, control }: { title: string; hint?: string; control: React.ReactNode }) {
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

/** Impostazioni → Riservatezza (study 09 §7): show when I am on duty (allies only); accept direct invites. */
export function PrivacySettings() {
  const t = useTranslations('alliance.privacy');
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const profile = useQuery({ queryKey: qk.profile, queryFn: allianceApi.profile, staleTime: 60_000 });
  const update = useMutation({
    mutationFn: allianceApi.updateProfile,
    onSuccess: (data, variables) => {
      qc.setQueryData(qk.profile, data);
      void qc.invalidateQueries({ queryKey: qk.allianceRoot(careerId) });
      track('settings_changed', {
        setting: Object.keys(variables)[0] ?? 'profile',
        value: Object.values(variables)[0] ?? false,
      });
    },
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });
  const careerId = useCareerId();
  const [rules, setRules] = React.useState(false);
  const communityRules = useCommunityRules();
  const locale = useLocale();
  return (
    <Card className="divide-border divide-y" data-testid="privacy-settings">
      <SectionTitle>{t('title')}</SectionTitle>
      {!profile.data ? (
        <Skeleton className="h-16" />
      ) : (
        <>
          <Row
            title={t('showOnDuty')}
            hint={t('showOnDutyHint')}
            control={
              <Switch
                checked={profile.data.showOnDuty}
                onCheckedChange={(value) => update.mutate({ showOnDuty: value })}
                aria-label={t('showOnDuty')}
                data-testid="privacy-show-on-duty"
              />
            }
          />
          <Row
            title={t('acceptDirectInvites')}
            hint={t('acceptDirectInvitesHint')}
            control={
              <Switch
                checked={profile.data.acceptDirectInvites}
                onCheckedChange={(value) => update.mutate({ acceptDirectInvites: value })}
                aria-label={t('acceptDirectInvites')}
                data-testid="privacy-direct-invites"
              />
            }
          />
        </>
      )}
      <Row
        title={t('rules')}
        hint={
          communityRules.data?.accepted && communityRules.data.acceptedAt
            ? t('rulesAccepted', { date: formatDateTime(communityRules.data.acceptedAt, locale) })
            : t('rulesHint')
        }
        control={
          <Button
            variant="outline"
            size="sm"
            className="h-11 lg:h-8"
            onClick={() => setRules(true)}
            data-testid="open-community-rules"
          >
            <ShieldCheck className="size-4" aria-hidden />
            {t('rulesOpen')}
          </Button>
        }
      />
      <CommunityRulesDialog open={rules} onOpenChange={setRules} />
    </Card>
  );
}

/** Impostazioni → Persone bloccate (study 04 §2.3): the list, with "Sblocca". The blocked never learn it. */
export function BlockedPeopleSettings() {
  const t = useTranslations('alliance.blocked');
  const careerId = useCareerId();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const blocks = useBlocks();
  const unblock = useMutation({
    mutationFn: (blockId: string) => moderationApi.unblock(careerId, blockId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.blocks(careerId) });
      void qc.invalidateQueries({ queryKey: qk.allianceRoot(careerId) });
      toast({ tone: 'success', title: t('unblocked'), durationMs: 3000 });
    },
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });
  const locale = useLocale();
  return (
    <Card data-testid="blocked-settings">
      <SectionTitle>{t('title')}</SectionTitle>
      <p className="text-muted mb-2 text-xs">{t('hint')}</p>
      {!blocks.data ? (
        <Skeleton className="h-10" />
      ) : blocks.data.length === 0 ? (
        <p className="text-subtle text-sm">{t('empty')}</p>
      ) : (
        <ul className="divide-border divide-y" data-testid="blocked-list">
          {blocks.data.map((b) => (
            <li key={b.id} className="flex items-center gap-3 py-2.5">
              <UserX className="text-subtle size-4 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-semibold">{b.directorName}</p>
                <p className="text-subtle text-xs">
                  {t('since', { date: formatDateTime(b.createdAt, locale) })}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-11 lg:h-8"
                onClick={() => unblock.mutate(b.id)}
                loading={unblock.isPending && unblock.variables === b.id}
                data-testid="unblock"
              >
                {t('unblock')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Impostazioni → Account: export my data (study 04 §6, account.ts). The deletion lives next to "Esci" in the screen. */
export function ExportDataButton() {
  const t = useTranslations('alliance.account');
  const errorMessage = useErrorMessage();
  const exportData = useMutation({
    mutationFn: accountApi.export,
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rescue-control-export-${data.exportedAt.slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast({ tone: 'success', title: t('exported'), durationMs: 4000 });
    },
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });
  return (
    <Button
      variant="outline"
      size="lg"
      onClick={() => exportData.mutate()}
      loading={exportData.isPending}
      data-testid="export-data"
    >
      <Download className="size-4" aria-hidden />
      {t('export')}
    </Button>
  );
}
