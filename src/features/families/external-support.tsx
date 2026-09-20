'use client';
import { useLocale, useTranslations } from 'next-intl';
import { Ban, CheckCircle2, Coins, Construction, Hammer, LifeBuoy, PhoneCall } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { IncidentDto } from '@/contracts';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCatalogName, useI18nText } from '@/i18n/use-i18n-text';
import { GameIcon, catalogIconName } from '@/design/icons';
import { Badge } from '@/components/ui/badge';
import { Countdown } from '@/components/ui/countdown';
import { SectionTitle } from '@/components/ui/misc';
import { useCatalog, useSnapshot } from '@/features/game/hooks';

type Unit = NonNullable<IncidentDto['externalSupport']>[number];

/** Icon + label + tone per unit status: the state is never conveyed by colour alone. */
const UNIT_STATUS: Record<Unit['status'], { icon: LucideIcon; className: string }> = {
  REQUESTED: { icon: PhoneCall, className: 'text-warning border-warning/40 bg-warning/10' },
  WORKING: { icon: Hammer, className: 'text-info border-info/40 bg-info/10' },
  DONE: { icon: CheckCircle2, className: 'text-success border-success/40 bg-success/10' },
  CANCELLED: { icon: Ban, className: 'text-muted border-border-strong bg-surface-3' },
};

function UnitRow({ unit }: { unit: Unit }) {
  const t = useTranslations('families.support');
  const tx = useI18nText();
  const catalog = useCatalog();
  const type = catalog?.ungUnitTypes?.find((u) => u.code === unit.unitTypeCode);
  const visual = UNIT_STATUS[unit.status];
  const StatusIcon = visual.icon;
  return (
    <li
      className="border-border bg-surface-2 flex flex-col gap-2 rounded-md border p-3"
      data-testid="external-unit"
      data-unit-status={unit.status}
    >
      <div className="flex items-center gap-2.5">
        <span className="bg-surface-3 text-muted grid size-9 shrink-0 place-items-center rounded-md">
          <GameIcon name={catalogIconName(type?.icon ?? 'ung-generic')} size={20} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{tx(type?.name ?? unit.name)}</span>
        <span
          className={cn(
            'inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-semibold',
            visual.className,
          )}
        >
          <StatusIcon className="size-3" aria-hidden />
          {t(`status.${unit.status}`)}
        </span>
      </div>
      <div className="text-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {unit.status === 'REQUESTED' ? (
          <Countdown to={unit.arriveAt} doneLabel="…" prefix={<span>{t('arrivesIn')}</span>} />
        ) : unit.status === 'WORKING' ? (
          <Countdown to={unit.completeAt} doneLabel="…" prefix={<span>{t('doneIn')}</span>} />
        ) : null}
        {unit.keepsRoadClosed && unit.status !== 'DONE' && unit.status !== 'CANCELLED' ? (
          <Badge tone="warning" data-testid="road-closed">
            <Construction className="size-3" aria-hidden />
            {t('roadClosed')}
          </Badge>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Two jobs inside the incident inspector:
 *  - before/while the player works: tells which families of a mixed incident are still locked → covered by external
 *    support, so the player only dispatches for the services they manage;
 *  - while the incident is RESOLVING: the "external support" phase — system units (UNG) finishing the job. The reward
 *    was already paid (`rewardedAt`); units are never dispatchable nor speed-up targets.
 */
export function IncidentExternalSupport({ incident }: { incident: IncidentDto }) {
  const t = useTranslations('families');
  const name = useCatalogName();
  const locale = useLocale();
  const { career } = useSnapshot();
  const external = (incident.externalFamilies ?? []).filter((f) => f !== 'UNG');
  const units = incident.externalSupport ?? [];
  const resolving = incident.status === 'RESOLVING';
  if (!resolving && external.length === 0) return null;
  const familyNames = new Intl.ListFormat(locale, { type: 'conjunction' }).format(
    external.map((f) => name('family', f)),
  );
  return (
    <section
      className="border-border flex flex-col gap-3 border-b p-4"
      aria-label={t('support.title')}
      data-testid="external-support"
      data-phase={resolving ? 'RESOLVING' : 'NOTICE'}
    >
      {resolving ? (
        <>
          <SectionTitle className="mb-0">{t('support.title')}</SectionTitle>
          <p className="text-muted text-sm">{t('support.intro')}</p>
          {incident.rewardedAt ? (
            <p
              className="border-success/40 bg-success/10 text-success flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold"
              data-testid="reward-paid"
            >
              <Coins className="size-4 shrink-0" aria-hidden />
              {t('support.rewardPaid', { time: formatTime(incident.rewardedAt, locale, career.timezone) })}
            </p>
          ) : null}
          {units.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {units.map((u) => (
                <UnitRow key={u.id} unit={u} />
              ))}
            </ul>
          ) : (
            <p className="text-subtle text-xs">{t('support.empty')}</p>
          )}
        </>
      ) : null}
      {external.length > 0 ? (
        <p
          className="border-info/40 bg-info/10 text-fg flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed"
          data-testid="external-families-notice"
        >
          <LifeBuoy className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t('external.notice', { count: external.length, families: familyNames })}</span>
        </p>
      ) : null}
    </section>
  );
}
