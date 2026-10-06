'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ClipboardList, Settings, ShieldCheck, UserPlus } from 'lucide-react';
import type { AllianceHomeDto, MyAllianceDto } from '@/contracts';
import { LOCALE_NAMES } from '@/i18n/config';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, ProgressBar, SectionTitle, Stat } from '@/components/ui/misc';
import { TimeAgo } from '@/components/ui/time-ago';
import { PolicyBadge } from './alliance-card';
import { Emblem } from './emblem';
import { FeatureOff } from './feature-off';
import { useAllianceMembers } from './hooks';
import { OperationSection } from './operation-card';
import { ObjectivesSection, XpSection } from './progress-cards';

/**
 * Panoramica (study 09 §2.2): emblem, level and progress, who is on duty, pinned announcements / objectives / aid /
 * operation (each behind its flag), the disbanding notice, and the shortcuts (invite, settings, log, rules).
 */
export function OverviewTab({
  home,
  alliance,
  onInvite,
  onSettings,
  onLog,
  onRules,
  onMember,
}: {
  home: AllianceHomeDto;
  alliance: MyAllianceDto;
  onInvite: () => void;
  onSettings: () => void;
  onLog: () => void;
  onRules: () => void;
  onMember: (careerId: string) => void;
}) {
  const t = useTranslations('alliance');
  const locale = useLocale();
  const members = useAllianceMembers();
  const onDuty = (members.data ?? []).filter((m) => m.presence === 'ON_DUTY');
  const p = alliance.progress;
  const ratio =
    p.xpForNextLevel === null
      ? 1
      : (p.xp - p.xpForCurrentLevel) / Math.max(1, p.xpForNextLevel - p.xpForCurrentLevel);
  const flags = home.config.flags;
  return (
    <div className="flex flex-col gap-4" data-testid="alliance-overview">
      <Card className="flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <Emblem
            emblem={alliance.emblem}
            frame={alliance.frame}
            size={72}
            title={t('overview.emblemAria', { name: alliance.name })}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display truncate text-xl font-bold">{alliance.name}</h2>
              <span className="tabular text-muted">[{alliance.tag}]</span>
              <PolicyBadge policy={alliance.joinPolicy} />
              {alliance.status === 'DISBANDING' ? (
                <Badge tone="warning">{t('status.DISBANDING')}</Badge>
              ) : null}
            </div>
            <p className="text-muted mt-1 text-sm">{alliance.description || t('card.noDescription')}</p>
            <p className="text-subtle mt-1 text-xs">
              {LOCALE_NAMES[alliance.language]} ·{' '}
              {t('overview.since', { date: formatDateTime(alliance.me.joinedAt, locale) })} ·{' '}
              {t(`role.${alliance.me.role}`)}
            </p>
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-semibold">{t('overview.level', { level: p.level })}</span>
            <span className="tabular text-muted text-xs">
              {p.xpForNextLevel === null
                ? t('overview.maxLevel')
                : t('overview.xp', { xp: p.xp, next: p.xpForNextLevel })}
            </span>
          </div>
          <ProgressBar value={ratio} label={t('overview.level', { level: p.level })} tone="xp" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label={t('overview.members')}
            value={
              <span className="tabular">
                {alliance.members} / {alliance.memberSlots}
              </span>
            }
          />
          <Stat
            label={t('overview.onDuty')}
            value={<span className="tabular">{alliance.counts.onDuty}</span>}
          />
          <Stat
            label={t('overview.deputies')}
            value={
              <span className="tabular">
                {alliance.deputies} / {p.deputySlots}
              </span>
            }
          />
          <Stat
            label={t('overview.coordinator')}
            value={
              alliance.coordinator.careerId ? (
                <button
                  type="button"
                  className="hover:text-fg truncate text-left underline-offset-2 hover:underline"
                  onClick={() => onMember(alliance.coordinator.careerId!)}
                >
                  {alliance.coordinator.directorName}
                </button>
              ) : (
                <span className="text-subtle">—</span>
              )
            }
          />
        </div>
        {alliance.disbandAt ? (
          <div
            className="bg-warning/15 text-warning rounded-md p-3 text-sm"
            role="status"
            data-testid="alliance-disbanding"
          >
            <p className="font-semibold">
              {t('overview.disbanding')} <TimeAgo at={alliance.disbandAt} />
            </p>
            <p className="text-xs">
              {alliance.me.role === 'COORDINATOR'
                ? t('overview.disbandingCoordinator')
                : t('overview.disbandingBody')}
            </p>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {alliance.me.canInvite ? (
            <Button variant="secondary" size="sm" onClick={onInvite} data-testid="overview-invite">
              <UserPlus className="size-4" aria-hidden />
              {t('overview.inviteCta')}
            </Button>
          ) : null}
          {alliance.me.isHighRole ? (
            <>
              {alliance.me.role === 'COORDINATOR' ? (
                <Button variant="outline" size="sm" onClick={onSettings} data-testid="overview-settings">
                  <Settings className="size-4" aria-hidden />
                  {t('overview.settings')}
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={onLog} data-testid="overview-log">
                <ClipboardList className="size-4" aria-hidden />
                {t('overview.log')}
              </Button>
            </>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onRules} data-testid="overview-rules">
            <ShieldCheck className="size-4" aria-hidden />
            {t('overview.rules')}
          </Button>
        </div>
      </Card>
      <Card>
        <SectionTitle>{t('overview.whoIsOn')}</SectionTitle>
        {onDuty.length === 0 ? (
          <p className="text-muted text-sm">{t('overview.nobodyOn')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2" data-testid="overview-on-duty">
            {onDuty.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="bg-surface-2 border-border hover:bg-surface-3 rounded-full border px-3 py-1 text-sm"
                  onClick={() => onMember(m.careerId)}
                >
                  <span className="bg-success mr-1.5 inline-block size-2 rounded-full" aria-hidden />
                  {m.directorName}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <SectionTitle>{t('overview.pinned')}</SectionTitle>
        {flags.board ? (
          <p className="text-muted text-sm">{t('overview.noPinned')}</p>
        ) : (
          <FeatureOff part="board" />
        )}
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle>{t('overview.objectives')}</SectionTitle>
          {flags.objectives ? <ObjectivesSection onMember={onMember} /> : <FeatureOff part="objectives" />}
        </Card>
        <Card>
          <SectionTitle>{t('overview.aid')}</SectionTitle>
          {flags.aid ? (
            <p className="text-muted text-sm">{t('overview.noAid')}</p>
          ) : (
            <FeatureOff part="aid" />
          )}
        </Card>
      </div>
      <Card>
        <SectionTitle>{t('overview.operation')}</SectionTitle>
        {flags.operations ? <OperationSection /> : <FeatureOff part="operations" />}
      </Card>
      <Card>
        <SectionTitle>{t('overview.xp')}</SectionTitle>
        <XpSection />
      </Card>
    </div>
  );
}
