'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Anchor, ArrowRightLeft, Hammer, LifeBuoy, Map as MapIcon, ShipWheel, Waves } from 'lucide-react';
import type { FacilityDto, SiteDto, VehicleDto } from '@/contracts';
import { facilitiesApi } from '@/lib/api/depth';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { useUiStore } from '@/stores/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { CreditAmount } from '@/components/ui/credit-amount';
import {
  useCareerId,
  useCatalog,
  usePatchSnapshot,
  useSnapshot,
  useVehicleTypeLookup,
} from '@/features/game/hooks';
import { useFixItToast } from '@/features/facilities/error-fix';
import {
  NAUTICAL_BASE,
  NAUTICAL_SITES_HREF,
  PIER_UPGRADE,
  freeBerths,
  grandfatheredBoats,
  isNauticalBase,
  nauticalBases,
  transferTargetForBoat,
} from './water';

/** `(typeCode) => is it a boat` from the catalog (a WATER-domain vehicle type). */
export function useIsBoat(): (typeCode: string) => boolean {
  const typeOf = useVehicleTypeLookup();
  return React.useCallback((code: string) => typeOf(code)?.domain === 'WATER', [typeOf]);
}

/** Opens the operations map in "new facility" mode on the nautical sites (D-23: where a Base nautica can be bought). */
export function useShowNauticalSites(): () => void {
  const router = useRouter();
  const setMapLayer = useUiStore((s) => s.setMapLayer);
  const setSitesFilter = useUiStore((s) => s.setSitesFilter);
  return React.useCallback(() => {
    track('new_facility_mode_opened', { source: 'nautical' });
    setSitesFilter('NAUTICAL');
    setMapLayer('sites', true);
    router.push('/game');
  }, [router, setMapLayer, setSitesFilter]);
}

/** The Base nautica of the catalog: price, level, berths at purchase and with the full pier. */
export function useNauticalBaseOffer() {
  const catalog = useCatalog();
  const type = catalog?.facilityTypes.find((f) => f.code === NAUTICAL_BASE);
  const pier = catalog?.facilityUpgrades?.find((u) => u.code === PIER_UPGRADE);
  if (!type) return null;
  const berths = type.baseCapacity.WATER ?? 0;
  const pierLevels = type.upgradeCaps?.[PIER_UPGRADE] ?? 0;
  return {
    price: type.price,
    requiredLevel: type.requiredLevel,
    berths,
    maxBerths: berths + pierLevels * (pier?.effect.delta ?? 1),
    unlocked: type.unlocked,
  };
}

/**
 * Shop, water tab (studio 05 §2.7): WHERE boats live (only in a Base nautica) and WHICH of the player's bases can take
 * one now — with the way to buy the first base or to lengthen the pier when every berth is taken.
 */
export function BoatHomeCard({ className }: { className?: string }) {
  const t = useTranslations('nautical.shop');
  const tc = useTranslations('common');
  const { facilities, vehicles } = useSnapshot();
  const offer = useNauticalBaseOffer();
  const isBoat = useIsBoat();
  const showSites = useShowNauticalSites();
  const bases = nauticalBases(facilities);
  const legacy = grandfatheredBoats(vehicles, facilities, isBoat);
  return (
    <section
      className={cn('border-info/40 bg-info/10 flex flex-col gap-3 rounded-md border p-3', className)}
      aria-label={t('title')}
      data-testid="boat-home"
      data-bases={bases.length}
    >
      <div className="flex items-start gap-2.5">
        <Anchor className="text-info mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t('title')}</p>
          <p className="text-muted text-xs leading-relaxed">{t('body')}</p>
        </div>
      </div>
      {bases.length === 0 ? (
        <p
          className="text-fg flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs"
          data-testid="boat-home-none"
        >
          {t('none')}
          {offer ? (
            <span className="text-muted inline-flex items-center gap-1">
              <CreditAmount value={offer.price} label={tc('credits')} size="sm" tone="plain" />
              {t('fromLevel', { level: offer.requiredLevel })}
            </span>
          ) : null}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label={t('bases')}>
          {bases.map((f) => {
            const water = f.capacities.find((c) => c.domain === 'WATER');
            const free = freeBerths(f);
            return (
              <li key={f.id}>
                <Link
                  href={`/game/facilities?id=${f.id}`}
                  className="border-border bg-surface-2 hover:bg-surface-3 flex min-h-11 items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs"
                  data-testid="boat-home-base"
                  data-free={free}
                  data-status={f.status}
                >
                  <ShipWheel className="text-info size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-semibold" title={f.name}>
                    {f.name}
                  </span>
                  {f.status !== 'OPERATIONAL' ? (
                    <span className="text-warning flex shrink-0 items-center gap-1">
                      <Hammer className="size-3.5" aria-hidden />
                      {f.operationalAt ? <Countdown to={f.operationalAt} doneLabel="…" /> : t('building')}
                    </span>
                  ) : (
                    <span className={cn('shrink-0', free > 0 ? 'text-success' : 'text-warning')}>
                      {t('berths', { free, total: water?.total ?? 0 })}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {legacy.length > 0 ? (
        <p className="text-muted flex items-start gap-1.5 text-xs" data-testid="boat-home-legacy">
          <LifeBuoy className="text-info mt-0.5 size-3.5 shrink-0" aria-hidden />
          {bases.length > 0
            ? t('legacyMove', { count: legacy.length })
            : t('legacyKeep', { count: legacy.length })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          asChild
          variant={bases.length === 0 ? 'primary' : 'secondary'}
          size="sm"
          className="h-11 lg:h-9"
        >
          <Link href={NAUTICAL_SITES_HREF} data-testid="boat-home-buy-base">
            <Anchor className="size-4" aria-hidden />
            {bases.length === 0 ? t('buyBase') : t('buyAnotherBase')}
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-11 lg:h-9"
          onClick={showSites}
          data-testid="boat-home-map"
        >
          <MapIcon className="size-4" aria-hidden />
          {t('showSites')}
        </Button>
      </div>
    </section>
  );
}

/** "Sito nautico · Mare Adriatico": the badge of a site where a Base nautica can be bought. */
export function NauticalSiteBadge({ site }: { site: Pick<SiteDto, 'nautical'> }) {
  const t = useTranslations('nautical.site');
  if (!site.nautical) return null;
  return (
    <Badge tone="info" data-testid="nautical-site-badge" data-water-body={site.nautical.waterBody}>
      <Anchor className="size-3" aria-hidden />
      {site.nautical.waterBodyName ? t('badgeNamed', { name: site.nautical.waterBodyName }) : t('badge')}
    </Badge>
  );
}

/** The purchase conditions of a Base nautica, spelled out on a nautical site (price, level, berths, who it hosts). */
export function NauticalConditions({ site }: { site: SiteDto }) {
  const t = useTranslations('nautical.site');
  const tc = useTranslations('common');
  const offer = useNauticalBaseOffer();
  const { career } = useSnapshot();
  if (!site.nautical || !offer) return null;
  const levelOk = career.level >= offer.requiredLevel;
  return (
    <section
      className="border-info/40 bg-info/10 flex flex-col gap-1.5 rounded-md border p-3 text-xs"
      aria-label={t('conditionsTitle')}
      data-testid="nautical-conditions"
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Anchor className="text-info size-4 shrink-0" aria-hidden />
        {t('conditionsTitle')}
      </p>
      <ul className="text-muted flex flex-col gap-1 pl-6">
        <li className="flex items-center gap-1">
          {t('price')} <CreditAmount value={offer.price} label={tc('credits')} size="sm" tone="plain" />
        </li>
        <li
          className={levelOk ? undefined : 'text-warning font-semibold'}
          data-testid="nautical-conditions-level"
        >
          {t('level', { level: offer.requiredLevel })}
        </li>
        <li>{t('berths', { count: offer.berths, max: offer.maxBerths })}</li>
        <li>{t('hosts')}</li>
        <li className="flex items-center gap-1">
          <Waves className="text-info size-3.5 shrink-0" aria-hidden />
          {site.nautical.waterBodyName
            ? t('water', { name: site.nautical.waterBodyName })
            : t('berthOnWater')}
        </li>
      </ul>
    </section>
  );
}

/** Facility page of a Base nautica: its water, its berths and how its boats reach the incidents. */
export function NauticalFacilityCard({ facility }: { facility: FacilityDto }) {
  const t = useTranslations('nautical.facility');
  if (!isNauticalBase(facility)) return null;
  const water = facility.capacities.find((c) => c.domain === 'WATER');
  return (
    <div
      className="border-info/40 bg-info/10 flex flex-col gap-2 rounded-md border p-3 text-xs"
      data-testid="nautical-facility"
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Anchor className="text-info size-4 shrink-0" aria-hidden />
        {facility.nautical?.waterBodyName
          ? t('water', { name: facility.nautical.waterBodyName })
          : t('title')}
      </p>
      <p className="text-muted">{t('berths', { used: water?.used ?? 0, total: water?.total ?? 0 })}</p>
      <p className="text-muted leading-relaxed">{t('howItWorks')}</p>
      <Button asChild variant="secondary" size="sm" className="h-11 self-start lg:h-8">
        <Link href="/game/shop?domain=WATER" data-testid="nautical-facility-shop">
          <ShipWheel className="size-4" aria-hidden />
          {t('buyBoat')}
        </Link>
      </Button>
    </div>
  );
}

/**
 * A boat still kept at a fire station (grandfathered, D-68 / studio 05 §2.4) moves to the Base nautica for free: the
 * button does it in one tap once a base with a free berth is operational; before that, a hint says how.
 */
export function FreeBoatTransfer({ vehicle }: { vehicle: VehicleDto }) {
  const careerId = useCareerId();
  const t = useTranslations('nautical.transfer');
  const fixItToast = useFixItToast();
  const patch = usePatchSnapshot();
  const { facilities } = useSnapshot();
  const type = useVehicleTypeLookup()(vehicle.typeCode);
  const facility = facilities.find((f) => f.id === vehicle.facilityId);
  const target =
    type?.domain === 'WATER'
      ? transferTargetForBoat(facilities, type.capacityPoints, vehicle.facilityId)
      : null;
  const move = useMutation({
    mutationFn: (facilityId: string) => facilitiesApi.transferVehicle(careerId, vehicle.id, facilityId),
    onSuccess: (result, facilityId) => {
      track('vehicle_transferred', { type: vehicle.typeCode, free: true });
      patch((s) => ({
        ...s,
        vehicles: s.vehicles.map((v) => (v.id === result.vehicle.id ? result.vehicle : v)),
        facilities: s.facilities.map((f) => result.facilities.find((x) => x.id === f.id) ?? f),
      }));
      toast({
        tone: 'success',
        title: t('done', {
          callSign: vehicle.callSign,
          facility: facilities.find((f) => f.id === facilityId)?.name ?? '',
        }),
      });
    },
    // A berth taken meanwhile, the base not ready…: the refusal says where the fix is.
    onError: (e, facilityId) => fixItToast(e, { facilityId, family: vehicle.family }),
  });
  if (type?.domain !== 'WATER' || !facility || isNauticalBase(facility)) return null;
  const hasBase = nauticalBases(facilities).length > 0;
  return (
    <div
      className="border-info/40 bg-info/10 flex flex-col gap-2 rounded-md border p-3"
      data-testid="free-boat-transfer"
      data-state={target ? 'READY' : hasBase ? 'NO_BERTH' : 'NO_BASE'}
    >
      <p className="flex items-start gap-2 text-xs">
        <LifeBuoy className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{target ? t('hint', { facility: target.name }) : hasBase ? t('noBerth') : t('noBase')}</span>
      </p>
      {target ? (
        <Button
          className="w-full"
          disabled={vehicle.status !== 'AVAILABLE'}
          loading={move.isPending}
          onClick={() => move.mutate(target.id)}
          data-testid="free-boat-transfer-button"
        >
          <ArrowRightLeft className="size-4" aria-hidden />
          {t('offer')}
        </Button>
      ) : !hasBase ? (
        <Link
          href={NAUTICAL_SITES_HREF}
          className="text-skyline inline-flex min-h-11 items-center gap-1 self-start text-sm font-semibold hover:underline lg:min-h-0"
        >
          <Anchor className="size-4" aria-hidden />
          {t('buyBase')}
        </Link>
      ) : null}
      {target && vehicle.status !== 'AVAILABLE' ? (
        <p className="text-subtle text-xs">{t('onlyAvailable')}</p>
      ) : null}
    </div>
  );
}

/** Fleet: a boat still kept at a fire station — "movable for free" once a Base nautica has a free berth. */
export function LegacyBoatChip({ vehicle, className }: { vehicle: VehicleDto; className?: string }) {
  const t = useTranslations('nautical.fleet');
  const { facilities } = useSnapshot();
  const type = useVehicleTypeLookup()(vehicle.typeCode);
  const facility = facilities.find((f) => f.id === vehicle.facilityId);
  if (type?.domain !== 'WATER' || !facility || isNauticalBase(facility)) return null;
  const target = transferTargetForBoat(facilities, type.capacityPoints, vehicle.facilityId);
  return (
    <Badge tone="info" className={className} data-testid="legacy-boat" data-movable={!!target}>
      <LifeBuoy className="size-3" aria-hidden />
      {target ? t('movable') : t('legacy')}
    </Badge>
  );
}
