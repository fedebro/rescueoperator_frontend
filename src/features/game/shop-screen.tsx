'use client';
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Anchor, Building2, Lock, Plane, Truck } from 'lucide-react';
import { ServiceFamily as ServiceFamilySchema, type FacilityDto, type ServiceFamily } from '@/contracts';
import type { CatalogDto } from '@/lib/api/types';
import { gameApi } from '@/lib/api/endpoints';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/error-message';
import { compareAmount, formatClock } from '@/lib/format';
import { toast } from '@/stores/toast';
import { useCatalogName, useI18nText } from '@/i18n/use-i18n-text';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { GameIcon, capabilityIconName, vehicleIconName } from '@/design/icons';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditAmount } from '@/components/ui/credit-amount';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { requestCredits } from '@/features/monetization/insufficient-credits';
import { FamiliesOverview } from '@/features/families/families-overview';
import { useFamilies } from '@/features/families/use-families';
import { useCareerId, useCatalog, useSnapshot } from './hooks';
import { PageBody } from './shell';

type VehicleType = CatalogDto['vehicleTypes'][number];
type DomainFilter = 'ALL' | 'GROUND' | 'AIR' | 'WATER';
const DOMAIN_FILTERS: readonly DomainFilter[] = ['ALL', 'GROUND', 'AIR', 'WATER'];
const DOMAIN_ICON = { GROUND: Truck, AIR: Plane, WATER: Anchor } as const;

/** Where a vehicle of this type can be delivered, and why not when it cannot. */
export type HostState =
  | { kind: 'OK'; facility: FacilityDto; alternatives: number }
  | { kind: 'NO_FACILITY' }
  | { kind: 'NO_CAPACITY' };

/**
 * Delivery facility of a vehicle type: OPERATIONAL, of a compatible type, with enough free points in the vehicle's
 * domain. The facility the player prefers wins when it qualifies; otherwise the first one that does.
 */
export function resolveHost(
  type: Pick<VehicleType, 'compatibleFacilityTypes' | 'domain' | 'capacityPoints'>,
  facilities: readonly FacilityDto[],
  preferredId?: string,
): HostState {
  const compatible = facilities.filter(
    (f) => f.status === 'OPERATIONAL' && type.compatibleFacilityTypes.includes(f.typeCode),
  );
  if (compatible.length === 0) return { kind: 'NO_FACILITY' };
  const withRoom = compatible.filter((f) => {
    const c = f.capacities.find((x) => x.domain === type.domain);
    return !!c && c.total - c.used >= type.capacityPoints;
  });
  if (withRoom.length === 0) return { kind: 'NO_CAPACITY' };
  return {
    kind: 'OK',
    facility: withRoom.find((f) => f.id === preferredId) ?? withRoom[0]!,
    alternatives: withRoom.length - 1,
  };
}

function VehicleOffer({
  type,
  onBuy,
  busy,
  host,
  familyLevel,
}: {
  type: VehicleType;
  onBuy: (type: VehicleType, facility: FacilityDto) => void;
  busy: boolean;
  host: HostState;
  familyLevel: number;
}) {
  const t = useTranslations('game.shop');
  const tf = useTranslations('families.shop');
  const td = useTranslations('game.facility');
  const tc = useTranslations('common');
  const tx = useI18nText();
  const name = useCatalogName();
  const { career } = useSnapshot();
  const affordable = compareAmount(career.credits, type.price) >= 0;
  const canHost = host.kind === 'OK';
  const DomainIcon = DOMAIN_ICON[type.domain];
  return (
    <li
      className={cn(
        'bg-surface-2 flex flex-col gap-3 rounded-md border p-3',
        type.unlocked ? 'border-border' : 'border-border/60 opacity-75',
      )}
      data-testid="vehicle-offer"
      data-code={type.code}
      data-unlocked={type.unlocked}
      data-domain={type.domain}
    >
      <div className="flex items-start gap-3">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-md text-white"
          style={{ background: `var(--rc-family-${type.family.toLowerCase()})` }}
        >
          <GameIcon name={vehicleIconName(type.icon)} size={26} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{tx(type.name)}</p>
          <p className="text-muted line-clamp-2 text-xs">{tx(type.description)}</p>
        </div>
        <Badge tone={type.domain === 'GROUND' ? 'neutral' : 'info'}>
          <DomainIcon className="size-3" aria-hidden />
          {tf(`domain.${type.domain}`)}
        </Badge>
      </div>
      {type.movement === 'AIR' ? (
        <p
          className="border-info/40 bg-info/10 text-fg flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs"
          data-testid="air-note"
        >
          <Plane className="text-info mt-0.5 size-3.5 shrink-0" aria-hidden />
          {tf('airNote', { speed: type.airSpeedKmh ?? 0 })}
        </p>
      ) : type.movement === 'ROAD_TRAILER' ? (
        <p className="border-border bg-surface-3 text-muted flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs">
          <Truck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {type.domain === 'WATER' ? tf('trailerNoteWater') : tf('trailerNote')}
        </p>
      ) : null}
      <ul className="flex flex-wrap gap-1">
        {type.capabilities.map((c) => (
          <li key={c.code}>
            <Badge title={tx({ key: `catalog.capability.${c.code}` })}>
              <GameIcon name={capabilityIconName(c.code)} size={12} />
              <span className="sr-only">{tx({ key: `catalog.capability.${c.code}` })}</span>
              {c.value}
            </Badge>
          </li>
        ))}
      </ul>
      <dl className="text-subtle grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <dt>{t('crew')}</dt>
          <dd className="tabular text-fg">
            {type.crewMin}–{type.crewOptimal}
          </dd>
        </div>
        <div>
          <dt>{t('space')}</dt>
          <dd className="tabular text-fg">
            {type.capacityPoints} · {td(`domain.${type.domain}`)}
          </dd>
        </div>
        <div>
          <dt>{t('delivery')}</dt>
          <dd className="tabular text-fg">{formatClock(type.deliverySeconds)}</dd>
        </div>
      </dl>
      {!type.unlocked ? (
        <p
          className="border-border-strong text-muted flex min-h-10 items-center justify-between gap-2 rounded-md border border-dashed px-3 py-1.5 text-xs"
          data-testid="locked-reason"
          data-reason={type.lockedReason ?? undefined}
        >
          <span className="flex items-center gap-1.5">
            <Lock className="size-3.5 shrink-0" aria-hidden />
            {type.lockedReason === 'NOT_UNLOCKED'
              ? tf('reason.familyLocked', { level: familyLevel })
              : tc('requiresLevel', { level: type.requiredLevel })}
          </span>
          <CreditAmount value={type.price} label={tc('credits')} size="sm" tone="plain" />
        </p>
      ) : host.kind === 'OK' ? (
        <>
          <p
            className="text-subtle -mb-1 flex items-center gap-1.5 truncate text-[11px]"
            data-testid="delivery-target"
          >
            <Building2 className="size-3 shrink-0" aria-hidden />
            <span className="truncate">
              {t('deliverTo')}: <span className="text-muted font-semibold">{host.facility.name}</span>
            </span>
          </p>
          <Button
            variant={affordable ? 'primary' : 'outline'}
            className="justify-between"
            loading={busy}
            onClick={() => onBuy(type, host.facility)}
            data-testid="buy-vehicle"
            data-tutorial={affordable && canHost ? 'buy-vehicle' : undefined}
          >
            <span>{t('buy')}</span>
            <CreditAmount value={type.price} label={tc('credits')} tone={affordable ? 'plain' : 'credits'} />
          </Button>
        </>
      ) : (
        <div
          className="border-border-strong text-muted flex flex-col gap-1.5 rounded-md border border-dashed px-3 py-2 text-xs"
          data-testid="blocked-reason"
          data-reason={host.kind}
        >
          <span className="flex items-start gap-1.5">
            <Building2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {host.kind === 'NO_FACILITY'
                ? tf('reason.noFacility', {
                    types: type.compatibleFacilityTypes
                      .slice(0, 2)
                      .map((code) => name('facility', code))
                      .join(', '),
                  })
                : tf('reason.noCapacity', { domain: td(`domain.${type.domain}`) })}
            </span>
          </span>
          <span className="flex items-center justify-between gap-2">
            <Link
              href={`/game/facilities?new=${type.family}`}
              className="text-skyline font-semibold underline-offset-4 hover:underline"
            >
              {host.kind === 'NO_FACILITY' ? tf('newFacility') : tf('manageFacilities')}
            </Link>
            <CreditAmount value={type.price} label={tc('credits')} size="sm" tone="plain" />
          </span>
        </div>
      )}
    </li>
  );
}

/** `useSearchParams` needs a Suspense boundary above it (static prerender of the route shell). */
export function ShopScreen() {
  return (
    <React.Suspense fallback={null}>
      <ShopRoute />
    </React.Suspense>
  );
}

/** `?family=EMS` (unlock celebration, deep links) preselects the family; a new value remounts the content. */
function ShopRoute() {
  const requested = useSearchParams().get('family');
  const parsed = ServiceFamilySchema.safeParse(requested);
  const initialFamily = parsed.success && parsed.data !== 'UNG' ? parsed.data : 'FIRE';
  return <ShopContent key={initialFamily} initialFamily={initialFamily} />;
}

function ShopContent({ initialFamily }: { initialFamily: ServiceFamily }) {
  const careerId = useCareerId();
  const t = useTranslations('game.shop');
  const tf = useTranslations('families.shop');
  const errorMessage = useErrorMessage();
  const catalog = useCatalog();
  const { facilities, career } = useSnapshot();
  const families = useFamilies();
  const [family, setFamily] = React.useState<ServiceFamily>(initialFamily);
  const [domain, setDomain] = React.useState<DomainFilter>('ALL');
  const [facilityId, setFacilityId] = React.useState<string | undefined>(undefined);

  const buy = useMutation({
    mutationFn: ({ type, facility }: { type: VehicleType; facility: FacilityDto }) =>
      gameApi.buyVehicle(careerId, { vehicleTypeCode: type.code, facilityId: facility.id }),
    onSuccess: (vehicle, { type }) => {
      track('vehicle_purchased', { type: type.code, family: type.family, domain: type.domain });
      toast({
        tone: 'success',
        title: t('bought', { callSign: vehicle.callSign }),
        description: t('boughtHint'),
      });
      if (!career.tutorial.completed) void gameApi.tutorialAdvance(careerId, 'DONE').catch(() => undefined);
    },
    onError: (e, { type }) => {
      if (isApiError(e, 'INSUFFICIENT_CREDITS')) requestCredits(type.price);
      else toast({ tone: 'danger', title: errorMessage(e) });
    },
  });
  const onBuy = (type: VehicleType, facility: FacilityDto) => {
    if (compareAmount(career.credits, type.price) < 0) requestCredits(type.price);
    else buy.mutate({ type, facility });
  };

  const familyTypes = (catalog?.vehicleTypes ?? []).filter((v) => v.family === family);
  const types = familyTypes
    .filter((v) => domain === 'ALL' || v.domain === domain)
    .sort(
      (a, b) =>
        Number(b.unlocked) - Number(a.unlocked) ||
        a.requiredLevel - b.requiredLevel ||
        compareAmount(a.price, b.price),
    );
  // Only facilities that can host at least one model of the selected family are worth offering as a destination.
  const hosts = facilities.filter(
    (f) =>
      f.status === 'OPERATIONAL' && familyTypes.some((v) => v.compatibleFacilityTypes.includes(f.typeCode)),
  );
  const preferred = hosts.find((f) => f.id === facilityId) ?? hosts[0];
  const familyLevel = families.find((f) => f.code === family)?.requiredLevel ?? 1;
  const freeOf = (f: FacilityDto) =>
    (['GROUND', 'AIR', 'WATER'] as const)
      .map((d) => {
        const c = f.capacities.find((x) => x.domain === d);
        return c && c.total > 0 ? `${tf(`domain.${d}`)} ${c.total - c.used}/${c.total}` : null;
      })
      .filter(Boolean)
      .join(' · ');

  return (
    <PageBody
      title={t('title')}
      subtitle={t('subtitle')}
      actions={
        hosts.length > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-muted text-xs font-semibold">{t('deliverTo')}</span>
            <Select
              label={t('deliverTo')}
              value={preferred?.id}
              onValueChange={setFacilityId}
              options={hosts.map((f) => ({ value: f.id, label: `${f.name} — ${freeOf(f)}` }))}
              className="max-w-72"
            />
          </div>
        ) : null
      }
    >
      <FamiliesOverview
        value={family}
        onChange={(next) => {
          setFamily(next);
          // a domain that does not exist in the next family would show an empty list
          setDomain('ALL');
        }}
      />
      <Tabs value={domain} onValueChange={(v) => setDomain(v as DomainFilter)}>
        <TabsList aria-label={tf('domainFilter')}>
          {DOMAIN_FILTERS.map((d) => {
            const Icon = d === 'ALL' ? null : DOMAIN_ICON[d];
            const count = d === 'ALL' ? familyTypes.length : familyTypes.filter((v) => v.domain === d).length;
            return (
              <TabsTrigger key={d} value={d} className="gap-1.5" data-testid={`domain-filter-${d}`}>
                {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
                {tf(`domain.${d}`)}
                <span className="text-subtle tabular text-[11px]">{count}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
      {!catalog ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-52" />
          ))}
        </div>
      ) : types.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {types.map((type) => (
            <VehicleOffer
              key={type.code}
              type={type}
              onBuy={onBuy}
              busy={buy.isPending && buy.variables?.type.code === type.code}
              host={resolveHost(type, facilities, preferred?.id)}
              familyLevel={familyLevel}
            />
          ))}
        </ul>
      )}
    </PageBody>
  );
}
