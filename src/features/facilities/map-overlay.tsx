'use client';
import * as React from 'react';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import { useTranslations } from 'next-intl';
import { Building2, Crosshair, MapPinPlus, X } from 'lucide-react';
import type { SiteDto } from '@/contracts';
import { track } from '@/lib/analytics';
import { useUiStore } from '@/stores/ui';
import { FamilyBadge } from '@/design/icons';
import { registerClickableLayer } from '@/features/map/game-layers';
import { GAME_LABEL_FONT } from '@/features/map/style';
import { Button, IconButton } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { SiteDetails, SiteOriginBadge, siteFamily, useFamilyLabel } from './site-details';
import { useSites } from './use-sites';

const SOURCE = 'rc-sites';
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
          // `site:<selected>` images are generated on demand (features/map/images.ts).
          image: `site:${s.id === selectedId ? 1 : 0}`,
          sort: s.id === selectedId ? 1 : 0,
        },
      })),
  };
}

/**
 * "New facility" mode of the operations map (layer key `sites`): candidate sites become selectable pins
 * (selection kind `site` → `SiteInspector` in the desktop side panel / mobile bottom sheet).
 * The WebGL layers render no DOM; the only DOM is the mode toggle / banner floating over the map.
 */
export function SitesMapOverlay({ map }: { map: MlMap }) {
  const t = useTranslations('facilities.map');
  const on = useUiStore((s) => s.mapLayers.sites);
  const setMapLayer = useUiStore((s) => s.setMapLayer);
  const selection = useUiStore((s) => s.selection);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const focusOn = useUiStore((s) => s.focusOn);
  const sites = useSites(on);
  const selectedId = selection?.kind === 'site' ? selection.id : null;

  React.useEffect(() => {
    if (!on) return;
    map.addSource(SOURCE, { type: 'geojson', data: siteFeatures([], null) });
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
      source: SOURCE,
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
      } catch {
        /* style already destroyed */
      }
    };
  }, [map, on]);

  React.useEffect(() => {
    if (!on) return;
    (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(siteFeatures(sites.data ?? [], selectedId));
  }, [map, on, sites.data, selectedId]);

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
  };
  const available = (sites.data ?? []).filter((s) => !s.owned).length;
  return (
    <div className="pointer-events-none absolute top-3 left-3 z-10 flex max-w-[calc(100%-4.5rem)]">
      {on ? (
        <div
          className="border-border-strong bg-surface-1/95 shadow-panel pointer-events-auto flex items-center gap-2 rounded-md border py-1.5 pr-1.5 pl-3 text-xs backdrop-blur"
          role="status"
          data-testid="new-facility-banner"
        >
          <MapPinPlus className="text-info size-4 shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="block font-semibold">{t('modeTitle')}</span>
            <span className="text-muted block truncate">
              {sites.isLoading ? t('loading') : t('modeHint', { count: available })}
            </span>
          </span>
          <IconButton label={t('exit')} size="sm" onClick={exit} data-testid="new-facility-exit">
            <X className="size-4" aria-hidden />
          </IconButton>
        </div>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          className="shadow-panel pointer-events-auto"
          onClick={() => {
            track('new_facility_mode_opened', { source: 'map' });
            setMapLayer('sites', true);
          }}
          data-testid="new-facility-mode"
        >
          <MapPinPlus className="size-4" aria-hidden />
          {t('newFacility')}
        </Button>
      )}
    </div>
  );
}

/** Inspector of a candidate site: real vs generated, compatible facility types with price / gates, acquire. */
export function SiteInspector({ id }: { id: string }) {
  const t = useTranslations('facilities.map');
  const ti = useTranslations('game.inspector');
  const familyLabel = useFamilyLabel();
  const sites = useSites();
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
    <div className="flex h-full min-h-0 flex-col" data-testid="site-inspector" data-site-id={site.id}>
      <header className="border-border shrink-0 border-b px-4 pt-1 pb-3 lg:pt-4">
        <div className="flex items-start gap-3">
          <FamilyBadge family={family} size={40} title={familyLabel(family)} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg leading-tight font-bold" data-testid="inspector-title">
              {site.name}
            </h2>
            <p className="text-muted mt-0.5 text-xs">{t('candidateSite')}</p>
          </div>
          <IconButton label={ti('centerOnMap')} size="sm" onClick={() => focusOn(site.position, 15)}>
            <Crosshair className="size-4" aria-hidden />
          </IconButton>
          <IconButton label={ti('close')} size="sm" onClick={clear} data-testid="inspector-close">
            <X className="size-4" aria-hidden />
          </IconButton>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <SiteOriginBadge site={site} />
        </div>
      </header>
      <div className="scroll-y min-h-0 flex-1 p-4">
        <SiteDetails
          site={site}
          onAcquired={(facilityId) => {
            // The site became a facility: leave the mode and show what was just bought.
            setMapLayer('sites', false);
            select({ kind: 'facility', id: facilityId }, { focus: site.position });
          }}
        />
      </div>
    </div>
  );
}
