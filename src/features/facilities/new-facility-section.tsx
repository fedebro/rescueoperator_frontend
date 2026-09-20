'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronRight, Map as MapIcon, MapPinPlus } from 'lucide-react';
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
import { SiteDetails, SiteOriginBadge, siteFamily, useFamilyLabel } from './site-details';
import { useSites } from './use-sites';

type FamilyFilter = 'ALL' | ReturnType<typeof siteFamily>;

/** Cheapest option of a site that the player could buy now, else the cheapest one at all. */
export function entryOption(site: SiteDto): SiteDto['options'][number] | undefined {
  const byPrice = [...site.options].sort((a, b) => compareAmount(a.price, b.price));
  return byPrice.find((o) => o.available) ?? byPrice[0];
}

/**
 * "New facility" from the facilities page: nearby candidate sites as a list (the map flow is one tap away).
 * Desktop and mobile share the list; the detail opens in a Dialog (a bottom sheet on phones).
 */
export function NewFacilitySection({ initialFamily }: { initialFamily?: string | null }) {
  const t = useTranslations('facilities.newFacility');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const familyLabel = useFamilyLabel();
  const { facilities } = useSnapshot();
  const sites = useSites();
  const select = useUiStore((s) => s.select);
  const setMapLayer = useUiStore((s) => s.setMapLayer);
  // null = the player has not chosen yet: the family requested by the URL (if any site offers it) applies.
  const [picked, setPicked] = React.useState<FamilyFilter | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const sectionRef = React.useRef<HTMLDivElement>(null);

  const all = React.useMemo(() => (sites.data ?? []).filter((s) => !s.owned), [sites.data]);
  const families = React.useMemo(() => [...new Set(all.map(siteFamily))], [all]);
  // `?new=<FAMILY>` (unlock celebration, shop "no compatible facility") lands here with the filter applied.
  React.useEffect(() => {
    if (!initialFamily) return;
    sectionRef.current?.scrollIntoView({ block: 'start' });
  }, [initialFamily]);
  const effective: FamilyFilter = picked ?? families.find((f) => f === initialFamily) ?? 'ALL';

  const distanceOf = (s: SiteDto) =>
    facilities.length ? Math.min(...facilities.map((f) => haversineMeters(f.position, s.position))) : 0;
  const rows = all
    .filter((s) => effective === 'ALL' || siteFamily(s) === effective)
    .sort((a, b) => distanceOf(a) - distanceOf(b));
  const opened = all.find((s) => s.id === openId) ?? null;

  const showOnMap = (site?: SiteDto) => {
    track('new_facility_mode_opened', { source: 'facilities_page' });
    setMapLayer('sites', true);
    if (site) select({ kind: 'site', id: site.id }, { focus: site.position });
    router.push('/game');
  };

  return (
    <Card data-testid="new-facility-section">
      <div ref={sectionRef} className="flex scroll-mt-4 flex-wrap items-center justify-between gap-2">
        <SectionTitle className="mb-0">
          <span className="flex items-center gap-2">
            <MapPinPlus className="size-4" aria-hidden />
            {t('title')}
          </span>
        </SectionTitle>
        <Button variant="secondary" size="sm" onClick={() => showOnMap()} data-testid="sites-on-map">
          <MapIcon className="size-4" aria-hidden />
          {t('chooseOnMap')}
        </Button>
      </div>
      <p className="text-muted mt-1 text-sm">{t('subtitle')}</p>
      <div role="group" aria-label={t('filter')} className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
        {(['ALL', ...families] as FamilyFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={effective === f}
            onClick={() => setPicked(f)}
            className={cn(
              'flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold',
              effective === f
                ? 'border-focus bg-surface-3 text-fg'
                : 'border-border text-muted hover:bg-surface-3',
            )}
          >
            {f === 'ALL' ? null : <FamilyBadge family={f} size={18} />}
            {f === 'ALL' ? t('all') : familyLabel(f)}
          </button>
        ))}
      </div>
      {sites.isLoading ? (
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
                  data-buyable={buyable}
                >
                  <FamilyBadge family={siteFamily(s)} size={36} title={familyLabel(siteFamily(s))} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{s.name}</span>
                    <span className="text-muted block truncate text-xs">
                      {formatDistance(distanceOf(s), locale)} · {s.address ?? '—'}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      <SiteOriginBadge site={s} />
                      {option ? (
                        <span className="text-subtle flex items-center gap-1 text-[11px]">
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
              <SiteOriginBadge site={opened} />
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => showOnMap(opened)}>
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
