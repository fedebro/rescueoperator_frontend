'use client';
import * as React from 'react';
import type { FeatureCollection } from 'geojson';
import type { GeoJSONSource, Map as MlMap, MapLayerMouseEvent } from 'maplibre-gl';
import { useTranslations } from 'next-intl';
import { Layers } from 'lucide-react';
import type { LngLat } from '@/lib/geo';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { useIsDesktop } from '@/hooks/use-media-query';
import { useI18nText } from '@/i18n/use-i18n-text';
import { useUiStore } from '@/stores/ui';
import { GAME_LABEL_FONT } from '@/features/map/style';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { coverageFeatures, hatchImage } from './coverage-geo';
import { LayersPanel } from './layers-panel';
import { Popover } from './popover';
import { useCoverage, useReducedMotion, useWorld } from './use-world';
import { useWorldUi } from './world-ui';

export const WORLD_SRC = { coverage: 'rc-world-coverage', closures: 'rc-world-closures' } as const;
export const WORLD_LAYER = {
  tint: 'rc-world-tint',
  coverageFill: 'rc-world-coverage-fill',
  coverageUnreachable: 'rc-world-coverage-unreachable',
  coverageLine: 'rc-world-coverage-line',
  coverageLabel: 'rc-world-coverage-label',
  closureFill: 'rc-world-closures-fill',
  closureHatch: 'rc-world-closures-hatch',
  closureLine: 'rc-world-closures-line',
  closureLabel: 'rc-world-closures-label',
} as const;
const IMAGE = { closure: 'rc-world-hatch-closure', unreachable: 'rc-world-hatch-unreachable' } as const;
const COVERAGE_LAYERS = [
  WORLD_LAYER.coverageFill,
  WORLD_LAYER.coverageUnreachable,
  WORLD_LAYER.coverageLine,
  WORLD_LAYER.coverageLabel,
];
const CLOSURE_LAYERS = [
  WORLD_LAYER.closureFill,
  WORLD_LAYER.closureHatch,
  WORLD_LAYER.closureLine,
  WORLD_LAYER.closureLabel,
];

/** Subtle tint over the BASEMAP only (it sits below every game layer, so incidents and vehicles keep their contrast). */
const TINT: Record<'DAY' | 'TWILIGHT' | 'NIGHT', { color: string; opacity: number }> = {
  DAY: { color: '#0A1220', opacity: 0 },
  TWILIGHT: { color: '#2A1436', opacity: 0.2 },
  NIGHT: { color: '#02040C', opacity: 0.38 },
};
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** The map may already be gone when React runs our cleanup (the base map unmounts first): never throw from here. */
function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    /* map removed */
  }
}
const setVisibility = (map: MlMap, layers: readonly string[], visible: boolean) =>
  safely(() => {
    for (const id of layers)
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  });
const setSourceData = (map: MlMap, source: string, data: FeatureCollection) =>
  safely(() => (map.getSource(source) as GeoJSONSource | undefined)?.setData(data));

/** Closures layer, day/night tint and the coverage layer (H3 cells drawn client-side). Renders no DOM. */
export function WorldMapOverlay({ map }: { map: MlMap }) {
  const t = useTranslations('world.layers');
  const tx = useI18nText();
  const world = useWorld();
  const reduced = useReducedMotion();
  const layers = useUiStore((s) => s.mapLayers);
  const family = useUiStore((s) => s.coverageFamily);
  const showClosure = useWorldUi((s) => s.showClosure);
  const setCoverageCells = useWorldUi((s) => s.setCoverageCells);
  const coverage = useCoverage(layers.coverage).data;

  // Sources and layers live as long as the overlay. This effect is declared FIRST, so within a commit it runs before
  // the data/visibility effects below: they can rely on the layers being there (and are no-ops otherwise).
  React.useEffect(() => {
    // Everything of this overlay goes UNDER the first game layer (routes): the world is context, never the subject.
    const beforeId = map
      .getStyle()
      .layers.find((l) => l.id.startsWith('rc-') && !l.id.startsWith('rc-world'))?.id;
    if (!map.hasImage(IMAGE.closure))
      map.addImage(IMAGE.closure, hatchImage([242, 85, 74, 235]), { pixelRatio: 2 });
    if (!map.hasImage(IMAGE.unreachable))
      map.addImage(IMAGE.unreachable, hatchImage([132, 146, 166, 200]), { pixelRatio: 2 });
    map.addLayer(
      {
        id: WORLD_LAYER.tint,
        type: 'background',
        paint: { 'background-color': TINT.DAY.color, 'background-opacity': 0 },
      },
      beforeId,
    );
    map.addSource(WORLD_SRC.coverage, { type: 'geojson', data: EMPTY });
    map.addSource(WORLD_SRC.closures, { type: 'geojson', data: EMPTY });
    const hidden = { visibility: 'none' } as const;
    map.addLayer(
      {
        id: WORLD_LAYER.coverageFill,
        type: 'fill',
        source: WORLD_SRC.coverage,
        filter: ['>=', ['get', 'bin'], 0],
        layout: hidden,
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.32 },
      },
      beforeId,
    );
    map.addLayer(
      {
        id: WORLD_LAYER.coverageUnreachable,
        type: 'fill',
        source: WORLD_SRC.coverage,
        filter: ['<', ['get', 'bin'], 0],
        layout: hidden,
        paint: { 'fill-pattern': IMAGE.unreachable, 'fill-opacity': 0.55 },
      },
      beforeId,
    );
    map.addLayer(
      {
        id: WORLD_LAYER.coverageLine,
        type: 'line',
        source: WORLD_SRC.coverage,
        layout: hidden,
        paint: { 'line-color': ['get', 'color'], 'line-width': 1, 'line-opacity': 0.55 },
      },
      beforeId,
    );
    map.addLayer(
      {
        id: WORLD_LAYER.coverageLabel,
        type: 'symbol',
        source: WORLD_SRC.coverage,
        minzoom: 11.5,
        layout: {
          ...hidden,
          'text-field': ['get', 'label'],
          'text-font': GAME_LABEL_FONT,
          'text-size': ['interpolate', ['linear'], ['zoom'], 11.5, 10, 15, 15],
          'text-allow-overlap': false,
        },
        paint: { 'text-color': '#FFFFFF', 'text-halo-color': '#0A1220', 'text-halo-width': 1.4 },
      },
      beforeId,
    );
    map.addLayer(
      {
        id: WORLD_LAYER.closureFill,
        type: 'fill',
        source: WORLD_SRC.closures,
        layout: hidden,
        paint: {
          'fill-color': '#F2554A',
          'fill-opacity': ['case', ['==', ['get', 'kind'], 'FULL'], 0.28, 0.14],
        },
      },
      beforeId,
    );
    map.addLayer(
      {
        id: WORLD_LAYER.closureHatch,
        type: 'fill',
        source: WORLD_SRC.closures,
        layout: hidden,
        paint: { 'fill-pattern': IMAGE.closure },
      },
      beforeId,
    );
    map.addLayer(
      {
        id: WORLD_LAYER.closureLine,
        type: 'line',
        source: WORLD_SRC.closures,
        layout: hidden,
        paint: {
          'line-color': '#F2554A',
          'line-width': ['case', ['==', ['get', 'highlighted'], 1], 4, 2],
          // Full closure = solid outline, partial = dashed: the kind is readable without colour.
          'line-dasharray': [
            'case',
            ['==', ['get', 'kind'], 'FULL'],
            ['literal', [1, 0]],
            ['literal', [2, 1.5]],
          ],
        },
      },
      beforeId,
    );
    map.addLayer(
      {
        id: WORLD_LAYER.closureLabel,
        type: 'symbol',
        source: WORLD_SRC.closures,
        minzoom: 12,
        layout: {
          ...hidden,
          'text-field': ['get', 'label'],
          'text-font': GAME_LABEL_FONT,
          'text-size': 11,
          'text-letter-spacing': 0.06,
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#FFD9D6', 'text-halo-color': '#3A0D0A', 'text-halo-width': 1.6 },
      },
      beforeId,
    );

    const onClosureClick = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === 'string') showClosure(id);
    };
    const pointer = () => (map.getCanvas().style.cursor = 'pointer');
    const noPointer = () => (map.getCanvas().style.cursor = '');
    map.on('click', WORLD_LAYER.closureFill, onClosureClick);
    map.on('mouseenter', WORLD_LAYER.closureFill, pointer);
    map.on('mouseleave', WORLD_LAYER.closureFill, noPointer);
    return () => {
      safely(() => {
        map.off('click', WORLD_LAYER.closureFill, onClosureClick);
        map.off('mouseenter', WORLD_LAYER.closureFill, pointer);
        map.off('mouseleave', WORLD_LAYER.closureFill, noPointer);
        for (const id of Object.values(WORLD_LAYER)) if (map.getLayer(id)) map.removeLayer(id);
        for (const id of Object.values(WORLD_SRC)) if (map.getSource(id)) map.removeSource(id);
        for (const id of Object.values(IMAGE)) if (map.hasImage(id)) map.removeImage(id);
      });
    };
  }, [map, showClosure]);

  // Day / night tint follows the world context; the change is animated unless motion is reduced.
  React.useEffect(() => {
    const tint = TINT[world.dayPhase];
    safely(() => {
      const transition = { duration: reduced ? 0 : 2500, delay: 0 };
      map.setPaintProperty(WORLD_LAYER.tint, 'background-opacity-transition', transition);
      map.setPaintProperty(WORLD_LAYER.tint, 'background-color-transition', transition);
      map.setPaintProperty(WORLD_LAYER.tint, 'background-color', tint.color);
      map.setPaintProperty(WORLD_LAYER.tint, 'background-opacity', tint.opacity);
      map.getContainer().dataset.dayPhase = world.dayPhase;
    });
  }, [map, world.dayPhase, reduced]);

  // Closures.
  const highlighted = useWorldUi((s) => s.highlightedClosureId);
  React.useEffect(() => {
    setSourceData(map, WORLD_SRC.closures, {
      type: 'FeatureCollection',
      features: world.closures
        .filter((c) => c.polygon.length >= 3)
        .map((c) => {
          const ring = c.polygon as LngLat[];
          const first = ring[0]!;
          const last = ring.at(-1)!;
          const closed = first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
          const kind = c.kind ?? 'FULL';
          return {
            type: 'Feature' as const,
            geometry: { type: 'Polygon' as const, coordinates: [closed] },
            properties: {
              id: c.id,
              kind,
              label: t(`closures.mapLabel.${kind}`),
              reason: tx(c.reason),
              highlighted: c.id === highlighted ? 1 : 0,
            },
          };
        }),
    });
  }, [map, world.closures, highlighted, t, tx]);
  React.useEffect(() => {
    setVisibility(map, CLOSURE_LAYERS, layers.closures);
  }, [map, layers.closures]);

  // Coverage: h3-js is only downloaded when the player actually opens the layer.
  React.useEffect(() => {
    setVisibility(map, COVERAGE_LAYERS, layers.coverage);
    if (!layers.coverage || !coverage) {
      setCoverageCells(0);
      return;
    }
    let cancelled = false;
    void import('h3-js').then(({ cellToBoundary }) => {
      if (cancelled) return;
      const data = coverageFeatures(coverage, family, (h3) => cellToBoundary(h3, true) as LngLat[]);
      setSourceData(map, WORLD_SRC.coverage, data);
      setCoverageCells(data.features.length);
    });
    return () => {
      cancelled = true;
    };
  }, [map, layers.coverage, coverage, family, setCoverageCells]);

  return null;
}

/** Floating map control: toggles the optional layers, picks the coverage family, lists the active closures. */
export function MapLayersControl() {
  const t = useTranslations('world.layers');
  const desktop = useIsDesktop();
  const open = useWorldUi((s) => s.layersOpen);
  const setOpen = useWorldUi((s) => s.setLayersOpen);
  const cells = useWorldUi((s) => s.coverageCells);
  const layers = useUiStore((s) => s.mapLayers);
  const active = Object.values(layers).filter(Boolean).length;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) track('map_layers_opened', { active });
  };
  const button = (
    props: React.ButtonHTMLAttributes<HTMLButtonElement> & { ref?: React.Ref<HTMLButtonElement> },
  ) => (
    <button
      type="button"
      {...props}
      aria-label={t('open')}
      data-testid="map-layers-button"
      className={cn(
        'border-border-strong bg-surface-1/95 text-fg hover:bg-surface-3 shadow-panel flex h-11 items-center gap-2 rounded-md border px-3 text-sm font-semibold backdrop-blur',
      )}
    >
      <Layers className="size-5" aria-hidden />
      <span className="hidden sm:inline">{t('button')}</span>
      <span className="bg-surface-3 text-muted tabular rounded-sm px-1.5 text-xs" aria-hidden>
        {active}
      </span>
    </button>
  );

  return (
    // Top-left: the zoom control is top-right, the attribution bottom-right and the mobile sheet covers the bottom.
    <div
      className="absolute top-3 left-3 z-10"
      data-testid="map-layers"
      data-hospitals={layers.hospitals}
      data-closures={layers.closures}
      data-coverage={layers.coverage}
      data-sites={layers.sites}
      data-coverage-cells={cells}
    >
      {desktop ? (
        <Popover
          id="map-layers-panel"
          open={open}
          onOpenChange={onOpenChange}
          label={t('title')}
          align="start"
          className="scroll-y max-h-[min(640px,calc(100dvh-180px))] w-[340px]"
          trigger={button}
        >
          <h2 className="font-display mb-3 text-base font-bold">{t('title')}</h2>
          <LayersPanel />
        </Popover>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          {button({ onClick: () => onOpenChange(true), 'aria-haspopup': 'dialog' })}
          <DialogContent title={t('title')} closeLabel={t('close')}>
            <LayersPanel />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
