'use client';
import * as React from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Anchor, ArrowRight, LifeBuoy, MapPin, Truck, Waves } from 'lucide-react';
import type { IncidentDto } from '@/contracts';
import type { DispatchOptionsResult } from '@/lib/api/types';
import { formatDistance } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui';
import { useI18nText } from '@/i18n/use-i18n-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCatalog, useSnapshot, useVehicleTypeLookup } from '@/features/game/hooks';
import {
  BOAT_SHOP_HREF,
  NAUTICAL_SITES_HREF,
  incidentScene,
  isWaterIncident,
  meetingPointOf,
  nauticalBases,
  waterKindOf,
} from './water';

/** "Al largo di Viale della Riviera, Pescara" for a water incident (server `placeText`), the address otherwise. */
export function useIncidentPlace(): (incident: Pick<IncidentDto, 'address' | 'placeText'>) => string {
  const tx = useI18nText();
  return React.useCallback(
    (incident) => (incident.placeText ? tx(incident.placeText) : incident.address),
    [tx],
  );
}

/** "In mare / Sul lago / Sul fiume" with an anchor: the water badge of an incident (null on land). */
export function WaterBodyBadge({
  incident,
  compact,
  className,
}: {
  incident: Pick<IncidentDto, 'domain' | 'waterBody'>;
  /** Icon only (queue cards): the label stays for screen readers and as a tooltip. */
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations('nautical');
  if (!isWaterIncident(incident)) return null;
  const kind = waterKindOf(incident) ?? 'UNKNOWN';
  const label = t(`body.${kind}`);
  return (
    <Badge
      tone="info"
      className={cn(compact && 'px-1', className)}
      title={label}
      data-testid="water-badge"
      data-water-body={kind}
    >
      <Anchor className="size-3 shrink-0" aria-hidden />
      <span className={compact ? 'sr-only' : undefined}>{label}</span>
    </Badge>
  );
}

/** Does the career own a boat at all (any status but out of service)? */
function useBoatCount(): number {
  const { vehicles } = useSnapshot();
  const typeOf = useVehicleTypeLookup();
  return vehicles.filter((v) => v.status !== 'OUT_OF_SERVICE' && typeOf(v.typeCode)?.domain === 'WATER')
    .length;
}

/**
 * The water part of an incident, at the top of its dispatch tab (D-68, studio 05 §2.7):
 *  - who does what: the scene on the water (boats, aircraft) and the meeting point on the shore (land units), each one
 *    tap away on the map;
 *  - the Coast Guard when it covers the water part — what it covers, the reduced reward — and, when the player has no
 *    boat, "Serve un mezzo acquatico — interviene la Guardia Costiera" with a direct link to buy a Base nautica;
 *  - without the Coast Guard (rivers, lakes) and without a boat: the incident needs one, same link.
 */
export function IncidentWaterNotice({ incident }: { incident: IncidentDto }) {
  const t = useTranslations('nautical');
  const tx = useI18nText();
  const catalog = useCatalog();
  const { facilities } = useSnapshot();
  const focusOn = useUiStore((s) => s.focusOn);
  const boats = useBoatCount();
  const meeting = meetingPointOf(incident);
  if (!isWaterIncident(incident) || !meeting) return null;
  const hasBase = nauticalBases(facilities).length > 0;
  const support = incident.waterSupport ?? null;
  const needsBoat = boats === 0;
  const capabilityName = (code: string) =>
    tx(catalog?.capabilities?.find((c) => c.code === code)?.name ?? { key: `catalog.capability.${code}` });
  const cta = !hasBase
    ? { href: NAUTICAL_SITES_HREF, label: t('coastGuard.buyBase'), testId: 'water-buy-base' }
    : needsBoat
      ? { href: BOAT_SHOP_HREF, label: t('coastGuard.buyBoat'), testId: 'water-buy-boat' }
      : null;
  const state = support ? 'COAST_GUARD' : needsBoat ? 'NEEDS_BOAT' : 'OWN_BOATS';
  return (
    <section
      className="border-border flex flex-col gap-2 border-b px-4 py-3"
      aria-label={t('section')}
      data-testid="water-notice"
      data-state={state}
    >
      <div className="-mx-2 flex flex-wrap items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-11 gap-1.5 px-2 lg:h-8"
          onClick={() => focusOn(incidentScene(incident), 15)}
          data-testid="water-focus-scene"
        >
          <Waves className="text-info size-4" aria-hidden />
          {t('focusScene')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-11 gap-1.5 px-2 lg:h-8"
          onClick={() => focusOn(meeting, 16)}
          data-testid="water-focus-meeting"
        >
          <MapPin className="text-info size-4" aria-hidden />
          {t('focusMeeting')}
        </Button>
      </div>
      {support || needsBoat ? (
        <div
          className={cn(
            'flex flex-col gap-1.5 rounded-md border px-3 py-2.5 text-sm',
            support ? 'border-info/40 bg-info/10' : 'border-warning/40 bg-warning/10',
          )}
          role="status"
          data-testid="coast-guard-notice"
        >
          <p className="flex items-start gap-2 font-semibold">
            <LifeBuoy
              className={cn('mt-0.5 size-4 shrink-0', support ? 'text-info' : 'text-warning')}
              aria-hidden
            />
            <span>
              {support
                ? needsBoat
                  ? t('coastGuard.title')
                  : t('coastGuard.titleCovered')
                : t('coastGuard.titleNoCoastGuard')}
            </span>
          </p>
          {support ? (
            <>
              <p className="text-muted text-xs" data-testid="coast-guard-covers">
                {t('coastGuard.covers', {
                  provider: tx(support.name),
                  list: support.capabilities.map(capabilityName).join(', '),
                })}{' '}
                {t('coastGuard.shore')}
              </p>
              <p className="text-warning text-xs font-semibold" data-testid="coast-guard-reward">
                {t('coastGuard.reward', { percent: Math.round(support.rewardShare * 100) })}
              </p>
            </>
          ) : (
            <p className="text-muted text-xs">{t('coastGuard.noCoastGuard')}</p>
          )}
          {cta ? (
            <Link
              href={cta.href}
              className="text-skyline inline-flex min-h-11 items-center gap-1 self-start text-sm font-semibold hover:underline lg:min-h-0"
              data-testid={cta.testId}
            >
              <Anchor className="size-4" aria-hidden />
              {cta.label}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : (
        <p className="text-muted text-xs" data-testid="water-roles">
          {t('roles')}
        </p>
      )}
    </section>
  );
}

type Option = DispatchOptionsResult['options'][number];

/**
 * Where a vehicle would go at a water incident and, for a boat, how: "In acqua · Parte dall’ormeggio" or
 * "Su carrello · varo: Marina di Pescara"; land units "Al punto di raccolta".
 */
export function DispatchWaterRoute({ option, className }: { option: Option; className?: string }) {
  const t = useTranslations('nautical.dispatch');
  const locale = useLocale();
  if (!option.destination) return null;
  const route = option.boatRoute;
  const toScene = option.destination === 'SCENE';
  const Icon = toScene ? (route && route.kind !== 'DIRECT' ? Truck : Waves) : MapPin;
  const how = route
    ? route.kind === 'DIRECT'
      ? t('route.DIRECT')
      : route.kind === 'TRAILER'
        ? t('route.TRAILER', { place: route.launchPoint?.name ?? t('launchPoint') })
        : t('route.BANK')
    : null;
  const legs =
    route && route.kind !== 'DIRECT'
      ? t('legs', {
          road: formatDistance(route.roadMeters, locale),
          water: formatDistance(route.waterMeters, locale),
        })
      : null;
  return (
    <p
      className={cn('text-info flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs', className)}
      data-testid="dispatch-water-route"
      data-destination={option.destination}
      data-boat-route={route?.kind ?? undefined}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="font-semibold">{toScene ? t('toScene') : t('toMeetingPoint')}</span>
      {how ? (
        <>
          {' '}
          <span className="text-subtle" aria-hidden>
            ·
          </span>{' '}
          <span>{how}</span>
        </>
      ) : null}
      {legs ? (
        <>
          {' '}
          <span className="text-subtle">({legs})</span>
        </>
      ) : null}
    </p>
  );
}
