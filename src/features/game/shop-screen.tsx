'use client';
import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { AlertTriangle, Anchor, ArrowRight, Building2, Lock, Plane, Truck, Users } from 'lucide-react';
import {
  ServiceFamily as ServiceFamilySchema,
  VehicleCrewGapDto,
  type FacilityDto,
  type ServiceFamily,
} from '@/contracts';
import type { CatalogDto } from '@/lib/api/types';
import { api } from '@/lib/api/client';
import { gameApi } from '@/lib/api/endpoints';
import { isApiError } from '@/lib/api/errors';
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
import { useFixItToast, type FixIt } from '@/features/facilities/error-fix';
import { BoatHomeCard } from '@/features/water/nautical';
import { NAUTICAL_SITES_HREF, nauticalBases } from '@/features/water/water';
import { FamiliesOverview } from '@/features/families/families-overview';
import { useFamilies } from '@/features/families/use-families';
import { CoachMark } from '@/features/coaching/coach-mark';
import { SectionHelpButton, SectionPrimer } from '@/features/coaching/section-primer';
import { pickIdleSuggestion } from '@/features/coaching/idle-suggestion';
import { useIdleSuggestionCopy } from '@/features/coaching/idle-suggestion-copy';
import { useCareerId, useCatalog, useSnapshot } from './hooks';

/** The shop's domain tab from the URL (`?domain=WATER` from the Base nautica, the incident panel…). */
const domainParam = (value: string | null): DomainFilter =>
  value && (DOMAIN_FILTERS as readonly string[]).includes(value) ? (value as DomainFilter) : 'ALL';
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

/**
 * Per vehicle type: the specialist (candidate-market-only) roles its crew needs that the career can genuinely not
 * hire right now (owns zero, no current candidate either) — `personnel.service.ts#vehicleCrewGaps`. Purely a
 * heads-up for the shop card; it never blocks a purchase (the player may reasonably want to buy ahead of the hire).
 */
function useVehicleCrewGaps(careerId: string) {
  return useQuery({
    queryKey: ['career', careerId, 'personnel', 'crew-gaps'] as const,
    queryFn: () =>
      api.get(`/careers/${careerId}/personnel/vehicle-crew-gaps`, { schema: z.array(VehicleCrewGapDto) }),
  });
}

export function VehicleOffer({
  type,
  onBuy,
  busy,
  host,
  familyLevel,
  missingCrewRoles,
  rejection,
}: {
  type: VehicleType;
  onBuy: (type: VehicleType, facility: FacilityDto) => void;
  busy: boolean;
  host: HostState;
  familyLevel: number;
  missingCrewRoles?: readonly string[];
  /** The last refusal of the server for this model, with its fix-it link (never a generic "not enough room"). */
  rejection?: FixIt | null;
}) {
  const t = useTranslations('game.shop');
  const tf = useTranslations('families.shop');
  const tn = useTranslations('nautical.shop');
  const td = useTranslations('game.facility');
  const tc = useTranslations('common');
  const tx = useI18nText();
  const name = useCatalogName();
  const { career, facilities } = useSnapshot();
  // Boats live only in a Base nautica (D-23): their blocked reasons point there, not to a new fire station.
  const boat = type.domain === 'WATER';
  const fullBase = boat ? nauticalBases(facilities).find((f) => f.status === 'OPERATIONAL') : undefined;
  const blockedText =
    host.kind === 'NO_FACILITY'
      ? boat
        ? tn('noFacility')
        : tf('reason.noFacility', {
            types: type.compatibleFacilityTypes
              .slice(0, 2)
              .map((code) => name('facility', code))
              .join(', '),
          })
      : boat
        ? tn('noBerth')
        : tf('reason.noCapacity', { domain: td(`domain.${type.domain}`) });
  const blockedLink =
    host.kind === 'NO_FACILITY'
      ? boat
        ? { href: NAUTICAL_SITES_HREF, label: tn('buyBase') }
        : { href: `/game/facilities?new=${type.family}`, label: tf('newFacility') }
      : boat && fullBase
        ? { href: `/game/facilities?id=${fullBase.id}`, label: tn('pier') }
        : { href: `/game/facilities?new=${type.family}`, label: tf('manageFacilities') };
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
          <p className="truncate text-sm font-semibold" title={tx(type.name)}>
            {tx(type.name)}
          </p>
          <p className="text-muted line-clamp-2 text-xs" title={tx(type.description)}>
            {tx(type.description)}
          </p>
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
      <dl className="text-subtle grid grid-cols-3 gap-2 text-xs">
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
      {missingCrewRoles && missingCrewRoles.length > 0 ? (
        <p
          className="border-warning/40 bg-warning/10 text-warning flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs"
          data-testid="crew-gap-warning"
          data-roles={missingCrewRoles.join(',')}
        >
          <Users className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {t('crewGapWarning', { roles: missingCrewRoles.map((code) => name('role', code)).join(', ') })}{' '}
            <Link
              href="/game/personnel?tab=recruitment"
              className="font-semibold underline underline-offset-4"
            >
              {t('crewGapWarningLink')}
            </Link>
          </span>
        </p>
      ) : null}
      {!type.unlocked ? (
        <p
          className="border-border-strong text-muted flex min-h-10 items-center justify-between gap-2 rounded-md border border-dashed px-3 py-1.5 text-xs"
          data-testid="locked-reason"
          data-reason={type.lockedReason ?? undefined}
          title={
            type.lockedReason === 'NOT_UNLOCKED'
              ? tf('reason.familyLocked', { level: familyLevel })
              : tc('requiresLevel', { level: type.requiredLevel })
          }
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
            className="text-subtle -mb-1 flex items-center gap-1.5 truncate text-xs"
            data-testid="delivery-target"
            title={`${t('deliverTo')}: ${host.facility.name}`}
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
          title={blockedText}
        >
          <span className="flex items-start gap-1.5">
            {boat ? (
              <Anchor className="text-info mt-0.5 size-3.5 shrink-0" aria-hidden />
            ) : (
              <Building2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            )}
            <span>{blockedText}</span>
          </span>
          <span className="flex items-center justify-between gap-2">
            <Link
              href={blockedLink.href}
              className="text-skyline inline-flex min-h-11 items-center font-semibold underline-offset-4 hover:underline lg:min-h-0"
              data-testid="blocked-fix"
            >
              {blockedLink.label}
            </Link>
            <CreditAmount value={type.price} label={tc('credits')} size="sm" tone="plain" />
          </span>
        </div>
      )}
      {rejection ? (
        <div
          className="border-danger/40 bg-danger/10 flex flex-col gap-1 rounded-md border px-3 py-2 text-xs"
          role="alert"
          data-testid="buy-rejection"
          data-code={rejection.code}
          data-reason={rejection.reason ?? undefined}
        >
          <span className="text-fg flex items-start gap-1.5">
            <AlertTriangle className="text-danger mt-0.5 size-3.5 shrink-0" aria-hidden />
            {rejection.message}
          </span>
          {rejection.fix ? (
            <Link
              href={rejection.fix.href}
              className="text-skyline inline-flex min-h-11 items-center gap-1 self-start font-semibold hover:underline lg:min-h-0"
              data-testid="buy-rejection-fix"
            >
              {rejection.fix.label}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : null}
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
  const params = useSearchParams();
  const parsed = ServiceFamilySchema.safeParse(params.get('family'));
  const initialFamily = parsed.success && parsed.data !== 'UNG' ? parsed.data : 'FIRE';
  const initialDomain = domainParam(params.get('domain'));
  return (
    <ShopContent
      key={`${initialFamily}:${initialDomain}`}
      initialFamily={initialFamily}
      initialDomain={initialDomain}
    />
  );
}

function ShopContent({
  initialFamily,
  initialDomain,
}: {
  initialFamily: ServiceFamily;
  initialDomain: DomainFilter;
}) {
  const careerId = useCareerId();
  const t = useTranslations('game.shop');
  const tf = useTranslations('families.shop');
  const tc = useTranslations('common');
  const tco = useTranslations('coaching');
  const tsh = useTranslations('coaching.sections.shop');
  const tlf = useTranslations('coaching.marks.lockedFamily');
  const catalog = useCatalog();
  const { facilities, career } = useSnapshot();
  const families = useFamilies();
  const crewGaps = useVehicleCrewGaps(careerId).data ?? [];
  const name = useCatalogName();
  const [family, setFamily] = React.useState<ServiceFamily>(initialFamily);
  const [domain, setDomain] = React.useState<DomainFilter>(initialDomain);
  const [facilityId, setFacilityId] = React.useState<string | undefined>(undefined);
  // The last refusal per model (NEEDS_NAUTICAL_BASE, no free berth…): shown in its card with the fix-it link.
  const [rejections, setRejections] = React.useState<Record<string, FixIt>>({});
  const fixItToast = useFixItToast();

  const buy = useMutation({
    mutationFn: ({
      type,
      facility,
      completesTutorial,
    }: {
      type: VehicleType;
      facility: FacilityDto;
      completesTutorial: boolean;
    }) =>
      gameApi
        .buyVehicle(careerId, { vehicleTypeCode: type.code, facilityId: facility.id })
        .then((vehicle) => ({ vehicle, completesTutorial })),
    onSuccess: ({ vehicle, completesTutorial }, { type }) => {
      track('vehicle_purchased', { type: type.code, family: type.family, domain: type.domain });
      toast({
        tone: 'success',
        title: t('bought', { callSign: vehicle.callSign }),
        description: t('boughtHint'),
      });
      // A distinct, non-blocking announcement so the end of the guided tutorial is unmistakable — it must never
      // be a modal here: the very next thing a tutorial player often does is buy again and hit the credits dialog.
      if (completesTutorial) {
        track('tutorial_completed', {});
        toast({
          tone: 'success',
          title: t('tutorialComplete.title'),
          description: t('tutorialComplete.body'),
          durationMs: 8000,
        });
        void gameApi.tutorialAdvance(careerId, 'DONE').catch(() => undefined);
      }
    },
    onError: (e, { type, facility }) => {
      if (isApiError(e, 'INSUFFICIENT_CREDITS')) requestCredits(type.price);
      else {
        const mapped = fixItToast(e, { facilityId: facility.id, family: type.family });
        setRejections((r) => ({ ...r, [type.code]: mapped }));
      }
    },
  });
  const onBuy = (type: VehicleType, facility: FacilityDto) => {
    setRejections(({ [type.code]: _dropped, ...rest }) => rest);
    if (compareAmount(career.credits, type.price) < 0) requestCredits(type.price);
    else
      buy.mutate({
        type,
        facility,
        completesTutorial: career.tutorial.step === 'BUY_VEHICLE' && !career.tutorial.completed,
      });
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
  const familyInfo = families.find((f) => f.code === family);
  const familyLevel = familyInfo?.requiredLevel ?? 1;
  const shopContent = {
    sectionKey: `shop:${family}`,
    title: tsh('title', { family: name('family', family) }),
    body: tsh('body'),
    tips: [tsh('tip1'), tsh('tip2')],
  };
  const hasLockedOffer = types.some((v) => v.lockedReason === 'NOT_UNLOCKED');
  // Nothing to show in this family/domain filter: suggest a concrete alternative from the player's real state.
  const idleSuggestion =
    types.length === 0
      ? pickIdleSuggestion({
          vehicleTypes: catalog?.vehicleTypes,
          families,
          credits: career.credits,
          level: career.level,
        })
      : null;
  const idleCopy = useIdleSuggestionCopy(idleSuggestion);
  const idleAction = idleCopy ? (
    <Button asChild variant="secondary">
      <Link href={idleCopy.href}>{idleCopy.label}</Link>
    </Button>
  ) : undefined;
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
        // Phones: its own full-width row, the label on one line and the facility truncated (03 §2.6).
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
          {hosts.length > 0 ? (
            <>
              <span className="text-muted shrink-0 text-xs font-semibold whitespace-nowrap">
                {t('deliverTo')}
              </span>
              <Select
                label={t('deliverTo')}
                value={preferred?.id}
                onValueChange={setFacilityId}
                options={hosts.map((f) => ({ value: f.id, label: `${f.name} — ${freeOf(f)}` }))}
                className="h-11 min-w-0 flex-1 sm:max-w-72 sm:flex-none lg:h-10 [&>span:first-child]:truncate"
              />
            </>
          ) : null}
          <SectionHelpButton content={shopContent} label={tco('help.buttonLabel')} closeLabel={tc('close')} />
        </div>
      }
    >
      {familyInfo?.unlocked ? <SectionPrimer content={shopContent} /> : null}
      <CoachMark
        id="lockedFamily"
        when={hasLockedOffer}
        selector='[data-testid="locked-reason"]'
        title={tlf('title')}
        body={tlf('body')}
      />
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
                {Icon ? <Icon className="size-4" aria-hidden /> : null}
                {/* Phones: icon + count for the domains, so the four tabs fit without a hidden scroll. */}
                <span className={Icon ? 'max-sm:sr-only' : undefined}>{tf(`domain.${d}`)}</span>
                <span className="text-subtle tabular text-xs">{count}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
      {/* Water tab (studio 05 §2.7): where boats live and which of the player's bases can take one now. */}
      {domain === 'WATER' && familyTypes.some((v) => v.domain === 'WATER') ? <BoatHomeCard /> : null}
      {!catalog ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-52" />
          ))}
        </div>
      ) : types.length === 0 ? (
        <EmptyState title={t('empty')} description={idleCopy?.text} action={idleAction} />
      ) : (
        // minmax(0, …): the implicit single column sized to the longest card pushed the cards off a phone's edge.
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {types.map((type) => (
            <VehicleOffer
              key={type.code}
              type={type}
              onBuy={onBuy}
              busy={buy.isPending && buy.variables?.type.code === type.code}
              host={resolveHost(type, facilities, preferred?.id)}
              familyLevel={familyLevel}
              missingCrewRoles={crewGaps.find((g) => g.vehicleTypeCode === type.code)?.missingRoles}
              rejection={rejections[type.code] ?? null}
            />
          ))}
        </ul>
      )}
    </PageBody>
  );
}
