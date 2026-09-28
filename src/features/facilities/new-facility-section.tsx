'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Anchor, ChevronRight, Map as MapIcon, MapPinPlus } from 'lucide-react';
import type { SiteDto } from '@/contracts';
import { track } from '@/lib/analytics';
import { compareAmount, formatDistance } from '@/lib/format';
import { haversineMeters } from '@/lib/geo';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui';
import { FamilyBadge } from '@/design/icons';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, SectionTitle, Skeleton } from '@/components/ui/misc';
import { CreditAmount } from '@/components/ui/credit-amount';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useSnapshot } from '@/features/game/hooks';
import { NauticalSiteBadge } from '@/features/water/nautical';
import { SiteDetails, SiteOriginBadge, siteFamily, useFamilyLabel } from './site-details';
import { useSites } from './use-sites';

/** `NAUTICAL` = the nautical sites (harbour, seafront, lake), where only a Base nautica can be bought (D-23). */
type FamilyFilter = 'ALL' | 'NAUTICAL' | ReturnType<typeof siteFamily>;

/** Cheapest option of a site that the player could buy now, else the cheapest one at all. */
export function entryOption(site: SiteDto): SiteDto['options'][number] | undefined {
  const byPrice = [...site.options].sort((a, b) => compareAmount(a.price, b.price));
  return byPrice.find((o) => o.available) ?? byPrice[0];
}

/** Anchor of the section: the Sedi page's "Nuova sede" header button scrolls here. */
export const NEW_FACILITY_ANCHOR = 'new-facility';

/**
 * "New facility" from the facilities page: nearby candidate sites as a list (the map flow is one tap away).
 * Desktop and mobile share the list; the detail opens in a Dialog (a bottom sheet on phones).
 */
export function NewFacilitySection({ initialFamily }: { initialFamily?: string | null }) {
  const t = useTranslations('facilities.newFacility');
  const tn = useTranslations('nautical.site');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const familyLabel = useFamilyLabel();
  const { facilities } = useSnapshot();
  const sites = useSites();
  const select = useUiStore((s) => s.select);
  const setMapLayer = useUiStore((s) => s.setMapLayer);
  const setSitesFilter = useUiStore((s) => s.setSitesFilter);
  // null = the player has not chosen yet: the family requested by the URL (if any site offers it) applies.
  const [picked, setPicked] = React.useState<FamilyFilter | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const sectionRef = React.useRef<HTMLDivElement>(null);

  const all = React.useMemo(() => (sites.data ?? []).filter((s) => !s.owned), [sites.data]);
  // Nautical sites have their own chip; the family chips list the family sites only.
  const families = React.useMemo(() => [...new Set(all.filter((s) => !s.nautical).map(siteFamily))], [all]);
  // `?new=<FAMILY>` (unlock celebration, shop "no compatible facility") and `?new=NAUTICAL` (a Base nautica: shop water
  // tab, the incident panel, a refused boat) land here with the filter applied.
  React.useEffect(() => {
    if (!initialFamily) return;
    sectionRef.current?.scrollIntoView({ block: 'start' });
  }, [initialFamily]);
  const effective: FamilyFilter =
    picked ??
    (initialFamily === 'NAUTICAL' ? 'NAUTICAL' : families.find((f) => f === initialFamily)) ??
    'ALL';
  // The nautical filter asks the server for the nautical sites only (`kind=NAUTICAL`): never crowded out by the rest.
  const nautical = useSites(effective === 'NAUTICAL', 'NAUTICAL');
  const nauticalRows = React.useMemo(() => (nautical.data ?? []).filter((s) => !s.owned), [nautical.data]);

  const distanceOf = (s: SiteDto) =>
    facilities.length ? Math.min(...facilities.map((f) => haversineMeters(f.position, s.position))) : 0;
  const rows = (effective === 'NAUTICAL' ? nauticalRows : all)
    .filter(
      (s) => effective === 'ALL' || effective === 'NAUTICAL' || (!s.nautical && siteFamily(s) === effective),
    )
    .sort((a, b) => distanceOf(a) - distanceOf(b));
  const opened = [...all, ...nauticalRows].find((s) => s.id === openId) ?? null;
  const loading = effective === 'NAUTICAL' ? nautical.isLoading : sites.isLoading;

  const showOnMap = (site?: SiteDto) => {
    track('new_facility_mode_opened', { source: 'facilities_page' });
    setSitesFilter(effective === 'NAUTICAL' || site?.nautical ? 'NAUTICAL' : 'ALL');
    setMapLayer('sites', true);
    if (site) select({ kind: 'site', id: site.id }, { focus: site.position });
    router.push('/game');
  };

  return (
    <Card data-testid="new-facility-section">
      <div
        ref={sectionRef}
        id={NEW_FACILITY_ANCHOR}
        className="flex scroll-mt-4 flex-wrap items-center justify-between gap-2"
      >
        <SectionTitle className="mb-0">
          <span className="flex items-center gap-2">
            <MapPinPlus className="size-4" aria-hidden />
            {t('title')}
          </span>
        </SectionTitle>
        <Button
          variant="secondary"
          size="sm"
          className="h-11 lg:h-8"
          onClick={() => showOnMap()}
          data-testid="sites-on-map"
        >
          <MapIcon className="size-4" aria-hidden />
          {t('chooseOnMap')}
        </Button>
      </div>
      <p className="text-muted mt-1 text-sm">{t('subtitle')}</p>
      <div role="group" aria-label={t('filter')} className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
        {/* Nautical second: always in view on a phone, where the family chips scroll sideways. */}
        {(['ALL', 'NAUTICAL', ...families] as FamilyFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={effective === f}
            onClick={() => setPicked(f)}
            className={cn(
              'flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold lg:h-9',
              effective === f
                ? 'border-focus bg-surface-3 text-fg'
                : 'border-border text-muted hover:bg-surface-3',
            )}
            data-testid="site-filter"
            data-filter={f}
          >
            {f === 'ALL' ? null : f === 'NAUTICAL' ? (
              <Anchor className="text-info size-4" aria-hidden />
            ) : (
              <FamilyBadge family={f} size={18} />
            )}
            {f === 'ALL' ? t('all') : f === 'NAUTICAL' ? tn('filter') : familyLabel(f)}
          </button>
        ))}
      </div>
      {effective === 'NAUTICAL' ? (
        <p className="text-muted mt-2 flex items-start gap-1.5 text-xs" data-testid="nautical-sites-hint">
          <Anchor className="text-info mt-0.5 size-3.5 shrink-0" aria-hidden />
          {tn('listHint')}
        </p>
      ) : null}
      {loading ? (
        <Skeleton className="mt-3 h-40" />
      ) : rows.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ul className="mt-3 grid gap-2 lg:grid-cols-2">
          {rows.map((s) => {
            const option = entryOption(s);
            const buyable = s.options.some((o) => o.available);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(s.id)}
                  className={cn(
                    'bg-surface-2 hover:bg-surface-3 border-border flex w-full items-center gap-3 rounded-md border p-3 text-left',
                    buyable ? '' : 'opacity-75',
                  )}
                  data-testid="site-row"
                  data-site-id={s.id}
                  data-family={siteFamily(s)}
                  data-nautical={!!s.nautical}
                  data-buyable={buyable}
                >
                  {s.nautical ? (
                    <span
                      className="bg-info/15 text-info grid size-9 shrink-0 place-items-center rounded-md"
                      title={tn('badge')}
                    >
                      <Anchor className="size-5" aria-hidden />
                    </span>
                  ) : (
                    <FamilyBadge family={siteFamily(s)} size={36} title={familyLabel(siteFamily(s))} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold" title={s.name}>
                      {s.name}
                    </span>
                    <span
                      className="text-muted block truncate text-xs"
                      title={`${formatDistance(distanceOf(s), locale)} · ${s.address ?? '—'}`}
                    >
                      {formatDistance(distanceOf(s), locale)} · {s.address ?? '—'}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      {s.nautical ? <NauticalSiteBadge site={s} /> : <SiteOriginBadge site={s} />}
                      {option ? (
                        <span className="text-subtle flex items-center gap-1 text-xs">
                          {buyable ? t('from') : t('lockedFrom')}
                          <CreditAmount value={option.price} label={tc('credits')} size="sm" tone="plain" />
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <ChevronRight className="text-subtle size-4 shrink-0" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={!!opened} onOpenChange={(o) => (o ? undefined : setOpenId(null))}>
        {opened ? (
          <DialogContent
            title={opened.name}
            description={t('dialogHint')}
            closeLabel={tc('close')}
            data-testid="site-dialog"
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {opened.nautical ? <NauticalSiteBadge site={opened} /> : <SiteOriginBadge site={opened} />}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-11 lg:h-8"
                onClick={() => showOnMap(opened)}
              >
                <MapIcon className="size-4" aria-hidden />
                {t('showOnMap')}
              </Button>
            </div>
            <SiteDetails
              site={opened}
              onAcquired={(facilityId) => {
                setOpenId(null);
                router.replace(`/game/facilities?id=${facilityId}`);
              }}
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </Card>
  );
}
