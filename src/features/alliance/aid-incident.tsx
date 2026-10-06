'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { HeartHandshake, Share2, Truck } from 'lucide-react';
import type { IncidentAlliedColumnDto, IncidentDto, MajorIncidentDto, VehicleDto } from '@/contracts';
import { aidApi } from '@/lib/api/alliance';
import { cn } from '@/lib/utils';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { useSnapshot } from '@/features/game/hooks';
import { allianceOf } from './snapshot';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { SectionTitle } from '@/components/ui/misc';
import { TimeAgo } from '@/components/ui/time-ago';
import { useAllianceHome, useAllianceMutation } from './hooks';

/** Pure: does the incident still miss something a column could bring (05 §2.1)? Own units on scene + en route + allied count. */
export function realGap(incident: Pick<IncidentDto, 'requirements'>): boolean {
  return incident.requirements.some(
    (r) =>
      (r.level === 'REQUIRED' || r.level === 'RECOMMENDED') &&
      !r.external &&
      r.required - r.onScene - r.enRoute - (r.allied ?? 0) > 0,
  );
}

/** "Condivisa" — the incident is shared with the alliance (an OPEN aid request). */
export function SharedBadge({
  incident,
  compact,
}: {
  incident: Pick<IncidentDto, 'visibility'>;
  compact?: boolean;
}) {
  const t = useTranslations('alliance.aid');
  if (incident.visibility !== 'ALLIANCE') return null;
  return (
    <Badge tone="info" className={cn(compact && 'shrink-0')} data-testid="incident-shared">
      <Share2 className="size-3" aria-hidden />
      {t('shared')}
    </Badge>
  );
}

/** "Unità alleate" rows (09 §4.1): tag + name of the ally, vehicles, countdown, then "Sul posto". Nothing is drawn on the map. */
export function AlliedUnits({ columns, title }: { columns: IncidentAlliedColumnDto[]; title?: string }) {
  const t = useTranslations('alliance.aid');
  const ts = useTranslations('alliance.aid.columnStatus');
  const name = useCatalogName();
  if (columns.length === 0) return null;
  return (
    <div data-testid="allied-units">
      <SectionTitle>{title ?? t('alliedUnits')}</SectionTitle>
      <ul className="flex flex-col gap-1.5">
        {columns.map((c) => (
          <li
            key={c.columnId}
            className="border-border bg-surface-2 flex flex-col gap-1 rounded-md border p-2.5 text-sm"
            data-testid="allied-column"
            data-status={c.status}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Truck
                className={cn('size-4 shrink-0', c.status === 'ON_SCENE' ? 'text-success' : 'text-info')}
                aria-hidden
              />
              <span className="font-semibold">
                <span className="tabular text-muted">[{c.helper.tag}]</span> {c.helper.directorName}
              </span>
              <span
                className={cn(
                  'text-xs font-semibold',
                  c.status === 'ON_SCENE' ? 'text-success' : 'text-muted',
                )}
              >
                {ts(c.status)}
              </span>
              {c.status === 'EN_ROUTE' ? (
                <Countdown to={c.arriveAt} doneLabel={t('arriving')} className="text-info ml-auto text-xs" />
              ) : c.onSceneAt ? (
                <TimeAgo at={c.onSceneAt} className="text-subtle ml-auto text-xs" />
              ) : null}
            </div>
            <p className="text-muted flex flex-wrap gap-x-2 text-xs">
              <span>{c.vehicles.map((v) => v.callSign).join(', ')}</span>
              {c.capabilities.map((cap) => (
                <span key={cap.capability}>
                  {name('capability', cap.capability)} <span className="tabular">+{cap.value}</span>
                </span>
              ))}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The requester's side inside the incident inspector (study 09 §4.1): "Chiedi aiuto all'alleanza" only with a real gap,
 * otherwise a line that says why it is not needed; the request's state and "Ritira"; the allied units coming.
 */
export function AidIncidentSection({ incident }: { incident: IncidentDto }) {
  const t = useTranslations('alliance.aid');
  const snapshot = useSnapshot();
  const alliance = allianceOf(snapshot);
  const home = useAllianceHome();
  const request = useAllianceMutation(
    (careerId, incidentId: string) => aidApi.requestForIncident(careerId, incidentId),
    { successToast: t('requested') },
  );
  const cancel = useAllianceMutation((careerId, requestId: string) => aidApi.cancel(careerId, requestId), {
    successToast: t('cancelled'),
  });
  if (!alliance || snapshot.featureFlags.alliance_aid !== true || incident.isTutorial) return null;
  const closed = ['RESOLVED', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(incident.status);
  const shared = incident.visibility === 'ALLIANCE' && incident.aidRequestId;
  const gap = realGap(incident);
  const allied = incident.allied ?? [];
  if (closed && allied.length === 0) return null;
  return (
    <div className="flex flex-col gap-3" data-testid="aid-incident-section">
      {!closed ? (
        <div className="border-border bg-surface-2 flex flex-wrap items-center gap-2 rounded-md border p-3">
          <HeartHandshake className="text-brand size-5 shrink-0" aria-hidden />
          {shared ? (
            <>
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-semibold">{t('sharedTitle')}</span>
                <span className="text-muted block text-xs">{gap ? t('sharedBody') : t('sharedCovered')}</span>
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => cancel.mutate(incident.aidRequestId!)}
                loading={cancel.isPending}
                data-testid="aid-withdraw"
              >
                {t('withdraw')}
              </Button>
            </>
          ) : gap ? (
            <>
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-semibold">{t('askTitle')}</span>
                <span className="text-muted block text-xs">{t('askBody', { tag: alliance.tag })}</span>
              </span>
              <Button
                size="sm"
                onClick={() => request.mutate(incident.id)}
                loading={request.isPending}
                disabled={home.data?.config.flags.aid === false}
                data-testid="aid-request-button"
              >
                {t('ask')}
              </Button>
            </>
          ) : (
            <span className="text-muted min-w-0 flex-1 text-xs" data-testid="aid-no-gap">
              {t('noGap')}
            </span>
          )}
        </div>
      ) : null}
      <AlliedUnits columns={allied} />
    </div>
  );
}

/** The same for a major incident's coordination view (05 §7): next to "Rinforzi", with the gold-medal warning. */
export function AidMajorSection({ major }: { major: MajorIncidentDto }) {
  const t = useTranslations('alliance.aid');
  const snapshot = useSnapshot();
  const alliance = allianceOf(snapshot);
  const request = useAllianceMutation(
    (careerId, majorId: string) => aidApi.requestForMajor(careerId, majorId),
    { successToast: t('requested') },
  );
  const cancel = useAllianceMutation((careerId, requestId: string) => aidApi.cancel(careerId, requestId), {
    successToast: t('cancelled'),
  });
  if (!alliance || snapshot.featureFlags.alliance_aid !== true) return null;
  const columns = major.alliedColumns ?? [];
  const members = snapshot.incidents.filter((i) => i.major?.id === major.id);
  const gap = members.some(realGap);
  const active = major.status === 'ACTIVE';
  const shared = members.some((i) => i.visibility === 'ALLIANCE') && major.aidRequestId;
  return (
    <section className="flex flex-col gap-2" aria-labelledby="major-aid" data-testid="major-aid">
      <SectionTitle className="mb-0">
        <span id="major-aid">{t('majorTitle')}</span>
      </SectionTitle>
      {active ? (
        <div className="border-border bg-surface-2 flex flex-col gap-2 rounded-md border p-3">
          <p className="text-warning text-xs" data-testid="major-aid-gold-warning">
            {t('goldWarning')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {shared ? (
              <>
                <span className="min-w-0 flex-1 text-sm font-semibold">{t('sharedTitle')}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => cancel.mutate(major.aidRequestId!)}
                  loading={cancel.isPending}
                  data-testid="major-aid-withdraw"
                >
                  {t('withdraw')}
                </Button>
              </>
            ) : (
              <>
                <span className="text-muted min-w-0 flex-1 text-xs">
                  {gap ? t('askBody', { tag: alliance.tag }) : t('noGap')}
                </span>
                <Button
                  size="sm"
                  onClick={() => request.mutate(major.id)}
                  loading={request.isPending}
                  disabled={!gap}
                  data-testid="major-aid-request"
                >
                  {t('ask')}
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}
      {columns.length > 0 ? <AlliedUnits columns={columns} title={t('alliedColumns')} /> : null}
    </section>
  );
}

/** Fleet / inspector line of a vehicle lent to an ally: "In supporto a [TAG] Marta · rientro tra 12:40" (09 §4.3). */
export function AlliedSupportLine({ vehicle, className }: { vehicle: VehicleDto; className?: string }) {
  const t = useTranslations('alliance.aid');
  const s = vehicle.alliedSupport;
  if (vehicle.status !== 'ALLIED_SUPPORT' || !s) return null;
  const back = s.returnAt ?? null;
  return (
    <span
      className={cn('text-info flex flex-wrap items-center gap-x-1.5 text-xs', className)}
      data-testid="allied-support-line"
    >
      <span>{t('supportTo', { tag: s.requester.tag, name: s.requester.directorName ?? '' })}</span>
      {back ? (
        <Countdown to={back} doneLabel="…" prefix={<span className="text-muted">{t('returnIn')}</span>} />
      ) : s.status === 'EN_ROUTE' ? (
        <Countdown
          to={s.arriveAt}
          doneLabel="…"
          prefix={<span className="text-muted">{t('arrivesIn')}</span>}
        />
      ) : (
        <span className="text-muted">{t('onSceneThere')}</span>
      )}
    </span>
  );
}
