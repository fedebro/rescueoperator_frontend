'use client';
import * as React from 'react';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, Check, Clock3, MapPin, Search, TrendingUp, Users, Warehouse } from 'lucide-react';
import type { LocationSummary as Location, StarterSite as Site } from '@/lib/api/types';
import { onboardingApi } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/query-keys';
import { useErrorMessage } from '@/lib/api/error-message';
import { boundsOf } from '@/lib/geo';
import { useAuthStore } from '@/stores/auth';
import { useLatest } from '@/hooks/use-latest';
import { useSessionGate } from '@/hooks/use-session';
import { BaseMap } from '@/features/map/base-map';
import { GAME_LABEL_FONT } from '@/features/map/style';
import { LanguageSelect } from '@/features/settings/language-select';
import { Logo } from '@/components/brand/logo';
import { BrandSplash } from '@/components/brand/splash';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { EmptyState, ProgressBar, Skeleton } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setV(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return v;
}

function SitesMap({
  location,
  sites,
  selectedId,
  onSelect,
}: {
  location: Location;
  sites: Site[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations('onboarding');
  const mapRef = React.useRef<MlMap | null>(null);
  const [ready, setReady] = React.useState(false);
  const onSelectRef = useLatest(onSelect);
  const onReady = React.useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      map.addSource('sites', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'sites-ring',
        type: 'circle',
        source: 'sites',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'selected'], 1], 60, 0],
          'circle-color': 'rgba(229,32,42,0.10)',
          'circle-stroke-color': 'rgba(229,32,42,0.55)',
          'circle-stroke-width': 1.5,
        },
      });
      map.addLayer({
        id: 'sites-icon',
        type: 'symbol',
        source: 'sites',
        layout: {
          'icon-image': ['concat', 'site:', ['to-string', ['get', 'selected']]],
          'icon-anchor': 'bottom',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'symbol-sort-key': ['get', 'selected'],
        },
      });
      map.addLayer({
        id: 'sites-label',
        type: 'symbol',
        source: 'sites',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': GAME_LABEL_FONT,
          'text-size': 11,
          'text-anchor': 'top',
          'text-offset': [0, 0.4],
          'text-max-width': 12,
          'text-optional': true,
        },
        paint: { 'text-color': '#E8EDF5', 'text-halo-color': '#0A1220', 'text-halo-width': 1.6 },
      });
      map.on('click', 'sites-icon', (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) onSelectRef.current(id);
      });
      setReady(true);
      return () => {
        mapRef.current = null;
      };
    },
    [onSelectRef],
  );
  React.useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('sites') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: sites.map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: s.position },
        properties: { id: s.id, name: s.name, selected: s.id === selectedId ? 1 : 0 },
      })),
    });
  }, [ready, sites, selectedId]);
  React.useEffect(() => {
    const map = mapRef.current;
    const b = boundsOf(sites.map((s) => s.position));
    if (ready && map && b)
      map.fitBounds(b, {
        padding: { top: 90, bottom: 60, left: 90, right: 90 },
        maxZoom: 13.5,
        duration: 500,
      });
  }, [ready, sites]);
  return <BaseMap label={t('mapLabel')} center={location.center} zoom={12} onReady={onReady} />;
}

function SiteCard({ site, selected, onSelect }: { site: Site; selected: boolean; onSelect: () => void }) {
  const t = useTranslations('onboarding.site');
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      data-testid="site-card"
      data-profile={site.profile}
      className={cn(
        'bg-surface-2 hover:bg-surface-3 flex w-full flex-col gap-3 rounded-md border p-3.5 text-left transition-colors',
        selected ? 'border-brand ring-brand ring-1' : 'border-border',
      )}
    >
      <span className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{site.name}</span>
          <span className="text-muted block truncate text-xs">{site.address}</span>
        </span>
        {selected ? (
          <span className="bg-brand grid size-5 shrink-0 place-items-center rounded-full text-white">
            <Check className="size-3.5" aria-hidden />
          </span>
        ) : null}
      </span>
      <span className="flex flex-wrap gap-1.5">
        <Badge tone="brand">{t(`profile.${site.profile}`)}</Badge>
        {site.real ? <Badge tone="info">{t('real')}</Badge> : <Badge>{t('generated')}</Badge>}
      </span>
      <span className="flex flex-col gap-1">
        <span className="flex items-center justify-between text-xs">
          <span className="text-muted flex items-center gap-1.5">
            <Users className="size-3.5" aria-hidden />
            {t('coverage')}
          </span>
          <span className="tabular font-semibold">{Math.round(site.coveragePopulationPct)}%</span>
        </span>
        <ProgressBar value={site.coveragePopulationPct / 100} label={t('coverage')} tone="success" />
      </span>
      <span className="text-subtle grid grid-cols-3 gap-2 text-[11px]">
        <span>
          <span className="flex items-center gap-1">
            <Clock3 className="size-3" aria-hidden />
            {t('response')}
          </span>
          <span className="tabular text-fg block text-sm font-semibold">
            {site.avgResponseMinutes.toFixed(1)}′
          </span>
        </span>
        <span>
          <span className="flex items-center gap-1">
            <Warehouse className="size-3" aria-hidden />
            {t('capacity')}
          </span>
          <span className="tabular text-fg block text-sm font-semibold">{site.capacityPoints}</span>
        </span>
        <span>
          <span className="flex items-center gap-1">
            <TrendingUp className="size-3" aria-hidden />
            {t('expansion')}
          </span>
          <span className="text-fg block text-sm font-semibold">
            {t(`potential.${site.expansionPotential}`)}
          </span>
        </span>
      </span>
      <span className="text-muted text-xs">{t(`hint.${site.profile}`)}</span>
    </button>
  );
}

export function OnboardingScreen() {
  const gateStatus = useSessionGate('needs-no-career');
  const allowed = gateStatus === 'ok';
  const t = useTranslations('onboarding');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [query, setQuery] = React.useState('');
  const [location, setLocation] = React.useState<Location | null>(null);
  const [pickedSiteId, setSiteId] = React.useState<string | null>(null);
  const debounced = useDebounced(query.trim(), 250);

  const search = useQuery({
    queryKey: qk.locationSearch(debounced),
    queryFn: ({ signal }) => onboardingApi.searchLocations(debounced, signal),
    enabled: allowed && debounced.length >= 2 && !location,
  });
  const sites = useQuery({
    queryKey: qk.starterSites(location?.id ?? ''),
    queryFn: () => onboardingApi.starterSites(location!.id),
    enabled: !!location,
  });
  // Default to the balanced site until the player picks one.
  const siteId =
    pickedSiteId ?? sites.data?.find((s) => s.profile === 'BALANCED')?.id ?? sites.data?.[0]?.id ?? null;

  const create = useMutation({
    mutationFn: () => onboardingApi.createCareer({ locationId: location!.id, siteId: siteId! }),
    onSuccess: (career) => {
      if (user) setUser({ ...user, activeCareerId: career.id });
      router.replace('/game');
    },
  });

  if (!allowed) return <BrandSplash />;
  if (create.isPending || create.isSuccess) {
    return (
      <div
        className="h-dvh-safe bg-bg grid place-items-center p-6"
        role="status"
        data-testid="creating-career"
      >
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <Logo variant="icon" className="w-20" />
          <p className="font-display text-2xl font-extrabold">{t('creating.title')}</p>
          <p className="text-muted text-sm">{t('creating.body', { location: location?.name ?? '' })}</p>
          <span aria-hidden className="bg-surface-3 h-1 w-40 overflow-hidden rounded-full">
            <span className="bg-brand block h-full w-1/2 animate-pulse rounded-full" />
          </span>
        </div>
      </div>
    );
  }

  return (
    <main className="h-dvh-safe pt-safe bg-bg flex flex-col lg:flex-row">
      <section className="border-border order-2 flex min-h-0 flex-1 flex-col lg:order-1 lg:w-[440px] lg:flex-none lg:border-r">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 px-4">
          {location ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setLocation(null);
                setSiteId(null);
              }}
            >
              <ArrowLeft className="size-4" aria-hidden />
              {tc('back')}
            </Button>
          ) : (
            <Logo variant="horizontal" className="w-36" />
          )}
          <LanguageSelect compact />
        </header>
        <div className="scroll-y min-h-0 flex-1 px-4 pb-4">
          {!location ? (
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-skyline text-[11px] font-bold tracking-wider uppercase">
                  {t('step', { current: 1, total: 2 })}
                </p>
                <h1 className="font-display mt-1 text-2xl font-extrabold">
                  {t('location.title', { name: user?.directorName ?? '' })}
                </h1>
                <p className="text-muted mt-1 text-sm">{t('location.subtitle')}</p>
              </div>
              <Input
                type="search"
                inputMode="search"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('location.placeholder')}
                aria-label={t('location.placeholder')}
                leading={<Search className="size-4" />}
                data-testid="location-search"
              />
              {debounced.length < 2 ? (
                <p className="text-subtle text-xs">{t('location.hint')}</p>
              ) : search.isLoading ? (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-14" />
                  <Skeleton className="h-14" />
                </div>
              ) : search.isError ? (
                <p role="alert" className="text-danger text-sm">
                  {errorMessage(search.error)}
                </p>
              ) : (search.data ?? []).length === 0 ? (
                <EmptyState
                  icon={<MapPin className="size-5" />}
                  title={t('location.empty')}
                  description={t('location.emptyHint')}
                />
              ) : (
                <ul className="flex flex-col gap-2" aria-label={t('location.results')}>
                  {(search.data ?? []).map((l) => (
                    <li key={l.id}>
                      <button
                        type="button"
                        disabled={!l.playable}
                        onClick={() => setLocation(l)}
                        data-testid="location-result"
                        data-playable={l.playable}
                        className="border-border bg-surface-2 hover:bg-surface-3 disabled:hover:bg-surface-2 flex w-full items-center gap-3 rounded-md border p-3 text-left disabled:cursor-not-allowed disabled:opacity-55"
                      >
                        <MapPin className="text-skyline size-5 shrink-0" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {l.name}
                            {l.province ? <span className="text-muted"> ({l.province})</span> : null}
                          </span>
                          <span className="text-muted block truncate text-xs">
                            {[
                              l.region,
                              l.population
                                ? t('location.population', {
                                    count: new Intl.NumberFormat(locale).format(l.population),
                                  })
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        {l.playable ? (
                          <Badge tone="success">{t('location.playable')}</Badge>
                        ) : (
                          <Badge>{t('location.comingSoon')}</Badge>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-skyline text-[11px] font-bold tracking-wider uppercase">
                  {t('step', { current: 2, total: 2 })}
                </p>
                <h1 className="font-display mt-1 text-2xl font-extrabold">
                  {t('sites.title', { location: location.name })}
                </h1>
                <p className="text-muted mt-1 text-sm">{t('sites.subtitle')}</p>
              </div>
              {sites.isLoading ? (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-40" />
                  <Skeleton className="h-40" />
                </div>
              ) : sites.isError ? (
                <p role="alert" className="text-danger text-sm">
                  {errorMessage(sites.error)}
                </p>
              ) : (
                <div
                  role="radiogroup"
                  aria-label={t('sites.title', { location: location.name })}
                  className="flex flex-col gap-2"
                >
                  {(sites.data ?? []).map((s) => (
                    <SiteCard
                      key={s.id}
                      site={s}
                      selected={s.id === siteId}
                      onSelect={() => setSiteId(s.id)}
                    />
                  ))}
                </div>
              )}
              {create.isError ? (
                <p role="alert" className="text-danger text-sm">
                  {errorMessage(create.error)}
                </p>
              ) : null}
            </div>
          )}
        </div>
        {location ? (
          <div className="pb-safe border-border bg-surface-1 shrink-0 border-t p-3">
            <Button size="xl" disabled={!siteId} onClick={() => create.mutate()} data-testid="start-career">
              {t('sites.submit')}
            </Button>
          </div>
        ) : null}
      </section>
      <section
        className={cn(
          'order-1 shrink-0 lg:order-2 lg:h-auto lg:flex-1',
          location ? 'h-[36dvh]' : 'hidden h-0 lg:block',
        )}
        aria-hidden={!location}
      >
        {location ? (
          <SitesMap location={location} sites={sites.data ?? []} selectedId={siteId} onSelect={setSiteId} />
        ) : (
          <div className="bg-surface-1 relative hidden h-full place-items-center overflow-hidden lg:grid">
            <Logo variant="stacked" className="w-[min(420px,60%)] opacity-90" />
          </div>
        )}
      </section>
    </main>
  );
}
