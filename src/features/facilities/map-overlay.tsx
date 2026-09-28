'use client';
import * as React from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import { useTranslations } from 'next-intl';
import { Anchor, Building2, Crosshair, MapPinPlus, X } from 'lucide-react';
import type { SiteDto } from '@/contracts';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui';
import { FamilyBadge } from '@/design/icons';
import { geoJsonSource, registerClickableLayer } from '@/features/map/game-layers';
import { GAME_LABEL_FONT } from '@/features/map/style';
import { IconButton } from '@/components/ui/button';
import { InspectorHeaderButton, SHEET_HEADER } from '@/features/game/inspector-parts';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { NauticalSiteBadge } from '@/features/water/nautical';
import { SiteDetails, SiteOriginBadge, siteFamily, useFamilyLabel } from './site-details';
import { useSites } from './use-sites';

/** `NAUTICAL` = only the nautical sites (D-23), highlighted when the player is about to buy a Base nautica or a boat. */
type FamilyFilter = 'ALL' | 'NAUTICAL' | ReturnType<typeof siteFamily>;

const SOURCE = 'rc-sites';
/** The names in a source of their own: glyphs that cannot load take the labels down, never the sites. */
const SOURCE_LABELS = 'rc-sites-labels';
const LAYER_ICON = 'rc-sites-icon';
const LAYER_LABEL = 'rc-sites-label';

/** Candidate sites as map features. Owned sites are left out: the facility standing on them is already drawn. */
export function siteFeatures(sites: readonly SiteDto[], selectedId: string | null): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: sites
      .filter((s) => !s.owned)
      .map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: s.position },
        properties: {
          kind: 'site',
          id: s.id,
          name: s.name,
          // `site:<selected>[:N]` images are generated on demand (features/map/images.ts); N = a nautical site.
          image: `site:${s.id === selectedId ? 1 : 0}${s.nautical ? ':N' : ''}`,
          sort: s.id === selectedId ? 2 : s.nautical ? 1 : 0,
          nautical: s.nautical ? 1 : 0,
        },
      })),
  };
}

/**
 * "New facility" mode of the operations map (layer key `sites`): candidate sites become selectable pins
 * (selection kind `site` → `SiteInspector` in the desktop side panel / mobile bottom sheet).
 * The WebGL layers render no DOM; the only DOM is the banner floating over the map while the mode is on. The mode is
 * entered from the Sedi page ("Scegli sulla mappa", or "Mostra sulla mappa" on one site): acquiring a facility is a
 * management action, it no longer has a permanent button on the operations map (03 §2.2).
 */
export function SitesMapOverlay({ map }: { map: MlMap }) {
  const t = useTranslations('facilities.map');
  const tn = useTranslations('nautical.site');
  const on = useUiStore((s) => s.mapLayers.sites);
  const setMapLayer = useUiStore((s) => s.setMapLayer);
  const selection = useUiStore((s) => s.selection);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const focusOn = useUiStore((s) => s.focusOn);
  // The filter lives in the store: the shop's water tab and the facilities page open the mode on the nautical sites.
  const familyFilter = useUiStore((s) => s.sitesFilter) as FamilyFilter;
  const setFamilyFilter = useUiStore((s) => s.setSitesFilter);
  const sites = useSites(on, familyFilter === 'NAUTICAL' ? 'NAUTICAL' : 'ALL');
  const selectedId = selection?.kind === 'site' ? selection.id : null;
  const familyLabel = useFamilyLabel();
  const candidates = React.useMemo(() => (sites.data ?? []).filter((s) => !s.owned), [sites.data]);
  const families = React.useMemo(
    () => [...new Set(candidates.filter((s) => !s.nautical).map(siteFamily))],
    [candidates],
  );
  const hasNautical = familyFilter === 'NAUTICAL' || candidates.some((s) => s.nautical);
  const filtered = React.useMemo(
    () =>
      candidates.filter(
        (s) =>
          familyFilter === 'ALL' ||
          (familyFilter === 'NAUTICAL' ? !!s.nautical : !s.nautical && siteFamily(s) === familyFilter),
      ),
    [candidates, familyFilter],
  );

  React.useEffect(() => {
    if (!on) return;
    map.addSource(SOURCE, { type: 'geojson', data: siteFeatures([], null) });
    map.addSource(SOURCE_LABELS, { type: 'geojson', data: siteFeatures([], null) });
    map.addLayer({
      id: LAYER_ICON,
      type: 'symbol',
      source: SOURCE,
      layout: {
        'icon-image': ['get', 'image'],
        'icon-anchor': 'bottom',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.55, 14, 0.9],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-sort-key': ['get', 'sort'],
      },
    });
    map.addLayer({
      id: LAYER_LABEL,
      type: 'symbol',
      source: SOURCE_LABELS,
      minzoom: 13,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': GAME_LABEL_FONT,
        'text-size': 10.5,
        'text-anchor': 'top',
        'text-offset': [0, 0.3],
        'text-max-width': 9,
        'text-optional': true,
      },
      paint: { 'text-color': '#CFE3FF', 'text-halo-color': '#0A1220', 'text-halo-width': 1.4 },
    });
    const unregister = registerClickableLayer(LAYER_ICON);
    const enter = () => (map.getCanvas().style.cursor = 'pointer');
    const leave = () => (map.getCanvas().style.cursor = '');
    map.on('mouseenter', LAYER_ICON, enter);
    map.on('mouseleave', LAYER_ICON, leave);
    return () => {
      unregister();
      map.off('mouseenter', LAYER_ICON, enter);
      map.off('mouseleave', LAYER_ICON, leave);
      // The map may already be gone (route change): removing layers from a removed map throws.
      try {
        if (map.getLayer(LAYER_LABEL)) map.removeLayer(LAYER_LABEL);
        if (map.getLayer(LAYER_ICON)) map.removeLayer(LAYER_ICON);
        if (map.getSource(SOURCE)) map.removeSource(SOURCE);
        if (map.getSource(SOURCE_LABELS)) map.removeSource(SOURCE_LABELS);
      } catch {
        /* style already destroyed */
      }
    };
  }, [map, on]);

  React.useEffect(() => {
    if (!on) return;
    const features = siteFeatures(filtered, selectedId);
    for (const id of [SOURCE, SOURCE_LABELS]) geoJsonSource(map, id)?.setData(features);
  }, [map, on, filtered, selectedId]);

  // The selection ring of non-snapshot entities follows the last focus request (operations-map): give it the site.
  const selectedSite = selectedId ? sites.data?.find((s) => s.id === selectedId) : undefined;
  const lng = selectedSite?.position[0];
  const lat = selectedSite?.position[1];
  React.useEffect(() => {
    if (lng !== undefined && lat !== undefined) focusOn([lng, lat], map.getZoom());
  }, [lng, lat, focusOn, map]);

  const exit = () => {
    if (selectedId) clearSelection();
    setMapLayer('sites', false);
    setFamilyFilter('ALL');
  };
  const chips: FamilyFilter[] = ['ALL', ...(hasNautical ? (['NAUTICAL'] as const) : []), ...families];
  return (
    // One row below the map-layers control (`top-3` + its 44px height): both are top-left slots owned by different
    // features, and at 375px they used to sit on top of each other.
    <div className="pointer-events-none absolute top-[3.75rem] left-3 z-10 flex max-w-[calc(100%-4.5rem)]">
      {on ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <div
            className="border-border-strong bg-surface-1/95 shadow-panel pointer-events-auto flex items-center gap-2 rounded-md border py-1.5 pr-1.5 pl-3 text-xs backdrop-blur"
            role="status"
            data-testid="new-facility-banner"
          >
            <MapPinPlus className="text-info size-4 shrink-0" aria-hidden />
            <span className="min-w-0">
              <span className="block font-semibold">
                {familyFilter === 'NAUTICAL' ? tn('mapTitle') : t('modeTitle')}
              </span>
              <span className="text-muted block truncate">
                {sites.isLoading
                  ? t('loading')
                  : familyFilter === 'NAUTICAL'
                    ? tn('mapHint', { count: filtered.length })
                    : t('modeHint', { count: filtered.length })}
              </span>
            </span>
            <IconButton
              label={t('exit')}
              size="sm"
              className="size-11"
              onClick={exit}
              data-testid="new-facility-exit"
            >
              <X className="size-5" aria-hidden />
            </IconButton>
          </div>
          {/* In nautical mode the way back to every site stays one tap away (Tutti · Nautici). */}
          {chips.length > 2 || familyFilter === 'NAUTICAL' ? (
            <div
              role="group"
              aria-label={t('filterByFamily')}
              className="pointer-events-auto flex gap-1.5 overflow-x-auto"
              data-testid="new-facility-family-filter"
            >
              {chips.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={familyFilter === f}
                  onClick={() => setFamilyFilter(f)}
                  className={cn(
                    'border-border-strong bg-surface-1/95 shadow-panel flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold backdrop-blur lg:h-8',
                    familyFilter === f ? 'border-focus text-fg' : 'text-muted hover:bg-surface-3',
                  )}
                  data-testid="new-facility-family-chip"
                  data-family={f}
                >
                  {f === 'ALL' ? null : f === 'NAUTICAL' ? (
                    <Anchor className="text-info size-4" aria-hidden />
                  ) : (
                    <FamilyBadge family={f} size={16} />
                  )}
                  {f === 'ALL' ? t('allFamilies') : f === 'NAUTICAL' ? tn('filter') : familyLabel(f)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Inspector of a candidate site: real vs generated, compatible facility types with price / gates, acquire. */
export function SiteInspector({ id }: { id: string }) {
  const t = useTranslations('facilities.map');
  const tn = useTranslations('nautical.site');
  const ti = useTranslations('game.inspector');
  const familyLabel = useFamilyLabel();
  const nauticalMode = useUiStore((s) => s.sitesFilter) === 'NAUTICAL';
  const sites = useSites(true, nauticalMode ? 'NAUTICAL' : 'ALL');
  const site = sites.data?.find((s) => s.id === id);
  const clear = useUiStore((s) => s.clearSelection);
  const select = useUiStore((s) => s.select);
  const focusOn = useUiStore((s) => s.focusOn);
  const setMapLayer = useUiStore((s) => s.setMapLayer);
  if (!site) {
    return (
      <div className="p-4" data-testid="site-inspector">
        {sites.isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <EmptyState icon={<Building2 className="size-5" />} title={t('siteGone')} />
        )}
      </div>
    );
  }
  const family = siteFamily(site);
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="site-inspector" data-site-id={site.id}>
      <header className="border-border shrink-0 border-b px-4 pb-2.5 md:pt-3" {...SHEET_HEADER}>
        <div className="flex items-start gap-3">
          {site.nautical ? (
            <span
              className="bg-info/15 text-info mt-1 grid size-10 shrink-0 place-items-center rounded-md"
              title={tn('badge')}
            >
              <Anchor className="size-6" aria-hidden />
            </span>
          ) : (
            <FamilyBadge family={family} size={40} title={familyLabel(family)} className="mt-1" />
          )}
          <div className="min-w-0 flex-1 pt-0.5">
            <h2
              className="font-display line-clamp-2 text-lg leading-tight font-bold"
              data-testid="inspector-title"
            >
              {site.name}
            </h2>
            <p className="text-muted mt-0.5 text-xs">
              {site.nautical ? tn('candidate') : t('candidateSite')}
            </p>
          </div>
          <InspectorHeaderButton
            label={ti('centerOnMap')}
            onClick={() => focusOn(site.position, 15)}
            className="-my-1"
          >
            <Crosshair className="size-5" aria-hidden />
          </InspectorHeaderButton>
          <InspectorHeaderButton
            label={ti('close')}
            onClick={clear}
            data-testid="inspector-close"
            className="-my-1 -mr-2"
          >
            <X className="size-5" aria-hidden />
          </InspectorHeaderButton>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {site.nautical ? <NauticalSiteBadge site={site} /> : <SiteOriginBadge site={site} />}
        </div>
      </header>
      <div className="scroll-y min-h-0 flex-1 p-4" data-sheet-scroll>
        <SiteDetails
          site={site}
          onAcquired={(facilityId) => {
            // The site became a facility: leave the mode and show what was just bought.
            setMapLayer('sites', false);
            useUiStore.getState().setSitesFilter('ALL');
            select({ kind: 'facility', id: facilityId }, { focus: site.position });
          }}
        />
      </div>
    </div>
  );
}
