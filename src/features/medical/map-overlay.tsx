'use client';
import * as React from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import type { z } from 'zod';
import { useTranslations } from 'next-intl';
import { Check, Crosshair, Hospital, Minus, X } from 'lucide-react';
import type { HospitalDto } from '@/contracts';
import { useUiStore } from '@/stores/ui';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { geoJsonSource, registerClickableLayer } from '@/features/map/game-layers';
import { GAME_LABEL_FONT } from '@/features/map/style';
import { IconButton } from '@/components/ui/button';
import { InspectorHeaderButton, SHEET_HEADER } from '@/features/game/inspector-parts';
import { EmptyState, SectionTitle, Skeleton } from '@/components/ui/misc';
import { useSnapshot } from '@/features/game/hooks';
import { incidentScene } from '@/features/water/water';
import { isInWater, useActivePatients, useHospitals } from './hooks';
import { LOAD_VISUALS, MedicalChip, PATIENT_STATUS_VISUALS } from './visuals';

type HospitalData = z.infer<typeof HospitalDto>;

const SOURCE = 'rc-hospitals';
/** The names in a source of their own: glyphs that cannot load take the labels down, never the hospitals. */
const SOURCE_LABELS = 'rc-hospitals-labels';
const LAYER_ICON = 'rc-hospitals-icon';
const LAYER_LABEL = 'rc-hospitals-label';
const IMAGE = 'medical:hospital';
/**
 * Hospital marker drawn here (the shared image pipeline is read-only for this area): a white "H" on a blue tile.
 * Deliberately NOT a cross — never a red cross on white (AGENT_BRIEF, branding rules).
 */
const MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 32 32"><rect x="3" y="3" width="26" height="26" rx="7" fill="#0A1220" stroke="#8EC5FF" stroke-width="2.5"/><rect x="6.5" y="6.5" width="19" height="19" rx="4.5" fill="#1F5FB8"/><path d="M12 10.5v11M20 10.5v11M12 16h8" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>`;

export function hospitalFeatures(hospitals: readonly HospitalData[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: hospitals.map((h) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: h.position },
      properties: { kind: 'hospital', id: h.id, name: h.name, load: h.load },
    })),
  };
}

function ensureMarkerImage(map: MlMap): void {
  if (map.hasImage(IMAGE)) return;
  // Transparent placeholder first (the layer can be added right away), swapped when the SVG is decoded.
  map.addImage(IMAGE, { width: 1, height: 1, data: new Uint8Array(4) });
  const img = new Image(64, 64);
  img.onload = () => {
    try {
      if (map.hasImage(IMAGE)) map.removeImage(IMAGE);
      map.addImage(IMAGE, img, { pixelRatio: 2 });
    } catch {
      /* the map was removed while the image was decoding */
    }
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(MARKER_SVG)}`;
}

const TRANSPORT_STATUSES = new Set(['AWAITING_TRANSPORT', 'IN_TRANSPORT', 'HANDOFF']);

/**
 * SLOT (owner: medical agent) — hospitals layer (selection kind `hospital`). Renders no DOM.
 * Visible when the player turns the `hospitals` layer on, and automatically while a patient needs or is under transport
 * (or a hospital is selected), so the destination is always on the map when it matters.
 */
export function HospitalsMapOverlay({ map }: { map: MlMap }) {
  const layerOn = useUiStore((s) => s.mapLayers.hospitals);
  const selection = useUiStore((s) => s.selection);
  const focusOn = useUiStore((s) => s.focusOn);
  const { vehicles } = useSnapshot();
  const patients = useActivePatients();
  // Somebody still in the water awaits no hospital yet (water patients): the transport starts once ashore.
  const transporting =
    patients.some((p) => TRANSPORT_STATUSES.has(p.status) && !isInWater(p)) ||
    vehicles.some((v) => v.status === 'TRANSPORTING' || v.status === 'AT_HOSPITAL');
  const selectedId = selection?.kind === 'hospital' ? selection.id : null;
  const on = layerOn || transporting || selectedId !== null;
  const hospitals = useHospitals(on);

  React.useEffect(() => {
    if (!on) return;
    ensureMarkerImage(map);
    map.addSource(SOURCE, { type: 'geojson', data: hospitalFeatures([]) });
    map.addSource(SOURCE_LABELS, { type: 'geojson', data: hospitalFeatures([]) });
    map.addLayer({
      id: LAYER_ICON,
      type: 'symbol',
      source: SOURCE,
      layout: {
        'icon-image': IMAGE,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 1],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
    map.addLayer({
      id: LAYER_LABEL,
      type: 'symbol',
      source: SOURCE_LABELS,
      minzoom: 10.5,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': GAME_LABEL_FONT,
        'text-size': 10.5,
        'text-anchor': 'top',
        'text-offset': [0, 1.5],
        'text-max-width': 10,
        'text-optional': true,
      },
      paint: { 'text-color': '#CFE3FF', 'text-halo-color': '#0A1220', 'text-halo-width': 1.4 },
    });
    const unregister = registerClickableLayer(LAYER_ICON);
    const enter = () => (map.getCanvas().style.cursor = 'pointer');
    const leave = () => (map.getCanvas().style.cursor = '');
    map.on('mouseenter', LAYER_ICON, enter);
    map.on('mouseleave', LAYER_ICON, leave);
    map.getContainer().setAttribute('data-hospitals-layer', 'on');
    return () => {
      unregister();
      map.off('mouseenter', LAYER_ICON, enter);
      map.off('mouseleave', LAYER_ICON, leave);
      // The map may already be gone (route change): removing layers from a removed map throws.
      try {
        map.getContainer().removeAttribute('data-hospitals-layer');
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
    const features = hospitalFeatures(hospitals.data ?? []);
    for (const id of [SOURCE, SOURCE_LABELS]) geoJsonSource(map, id)?.setData(features);
    map.getContainer().setAttribute('data-hospitals-count', String(hospitals.data?.length ?? 0));
  }, [map, on, hospitals.data]);

  // The selection ring of non-snapshot entities follows the last focus request (operations-map): give it the hospital.
  const selected = selectedId ? hospitals.data?.find((h) => h.id === selectedId) : undefined;
  const lng = selected?.position[0];
  const lat = selected?.position[1];
  React.useEffect(() => {
    if (lng !== undefined && lat !== undefined) focusOn([lng, lat], map.getZoom());
  }, [lng, lat, focusOn, map]);

  return null;
}

/** SLOT (owner: medical agent) — inspector shown when a hospital is selected on the map. */
export function HospitalInspector({ id }: { id: string }) {
  const t = useTranslations('medical.hospital');
  const tp = useTranslations('medical.patients');
  const ti = useTranslations('game.inspector');
  const tl = useTranslations('status.hospitalLoad');
  const ts = useTranslations('status.patient');
  const name = useCatalogName();
  const clear = useUiStore((s) => s.clearSelection);
  const focusOn = useUiStore((s) => s.focusOn);
  const select = useUiStore((s) => s.select);
  const { vehicles, incidents } = useSnapshot();
  const hospitals = useHospitals();
  const patients = useActivePatients();
  const hospital = hospitals.data?.find((h) => h.id === id);

  if (hospitals.isLoading) return <Skeleton className="m-4 h-40" />;
  if (!hospital)
    return (
      <EmptyState
        icon={<Hospital className="size-5" />}
        title={hospitals.isError ? t('loadError') : t('notFound')}
        action={
          <IconButton label={ti('close')} onClick={clear}>
            <X className="size-4" aria-hidden />
          </IconButton>
        }
      />
    );

  const incoming = patients.filter(
    (p) => p.hospitalId === id && (p.status === 'IN_TRANSPORT' || p.status === 'HANDOFF'),
  );
  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col"
      data-testid="hospital-inspector"
      data-hospital-id={id}
    >
      <header className="border-border shrink-0 border-b px-4 pb-2.5 md:pt-3" {...SHEET_HEADER}>
        <div className="flex items-start gap-3">
          <span className="bg-surface-3 text-info mt-1 grid size-10 shrink-0 place-items-center rounded-md">
            <Hospital className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2
              className="font-display line-clamp-2 text-lg leading-tight font-bold"
              data-testid="inspector-title"
            >
              {hospital.name}
            </h2>
            <p className="text-muted mt-0.5 text-xs">{t('subtitle')}</p>
          </div>
          <InspectorHeaderButton
            label={ti('centerOnMap')}
            onClick={() => focusOn(hospital.position, 13)}
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
      </header>
      <div className="scroll-y flex min-h-0 flex-1 flex-col gap-5 p-4" data-sheet-scroll>
        <div>
          <SectionTitle>{t('load')}</SectionTitle>
          <MedicalChip
            visual={LOAD_VISUALS[hospital.load]}
            label={tl(hospital.load)}
            data-testid="hospital-load"
            data-load={hospital.load}
          />
        </div>
        <div>
          <SectionTitle>{t('capabilities')}</SectionTitle>
          <ul className="flex flex-col gap-1.5" data-testid="hospital-capabilities">
            {hospital.capabilities.map((code) => (
              <li key={code} className="flex items-start gap-2 text-sm">
                <Check className="text-success mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  <span className="font-semibold">{name('hospitalCapability', code)}</span>
                  <span className="text-muted block text-xs">
                    {name('hospitalCapability', code, 'description')}
                  </span>
                </span>
              </li>
            ))}
            <li className="flex items-center gap-2 text-sm" data-helipad={hospital.hasHelipad}>
              {hospital.hasHelipad ? (
                <Check className="text-success size-4 shrink-0" aria-hidden />
              ) : (
                <Minus className="text-subtle size-4 shrink-0" aria-hidden />
              )}
              <span className={hospital.hasHelipad ? 'font-semibold' : 'text-muted'}>
                {hospital.hasHelipad ? t('helipadYes') : t('helipadNo')}
              </span>
            </li>
          </ul>
        </div>
        <div>
          <SectionTitle>{t('incoming')}</SectionTitle>
          {incoming.length === 0 ? (
            <p className="text-muted text-sm">{t('incomingNone')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5" data-testid="hospital-incoming">
              {incoming.map((p) => {
                const vehicle = vehicles.find((v) => v.id === p.assignedVehicleId);
                const incident = incidents.find((i) => i.id === p.incidentId);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="border-border bg-surface-2 hover:bg-surface-3 flex min-h-11 w-full flex-wrap items-center gap-2 rounded-md border px-2.5 py-2 text-left"
                      onClick={() =>
                        vehicle
                          ? select({ kind: 'vehicle', id: vehicle.id })
                          : incident
                            ? select(
                                { kind: 'incident', id: incident.id },
                                { focus: incidentScene(incident) },
                              )
                            : undefined
                      }
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {vehicle?.callSign ?? tp('externalAmbulance')}
                      </span>
                      <MedicalChip visual={PATIENT_STATUS_VISUALS[p.status]} label={ts(p.status)} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
