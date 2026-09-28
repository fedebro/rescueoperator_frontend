'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import { CloudSun, Crosshair, Eraser, PenLine, Siren, Trash2, Undo2 } from 'lucide-react';
import { WeatherCode } from '@/contracts';
import { CLOSURE_REASON_KEYS, adminApi, closureReasonKey, type AdminClosureRow } from '@/lib/api/admin';
import { qk } from '@/lib/api/query-keys';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { useLatest } from '@/hooks/use-latest';
import { formatDateTime } from '@/lib/format';
import { BaseMap } from '@/features/map/base-map';
import { geoJsonSource } from '@/features/map/game-layers';
import { Button } from '@/components/ui/button';
import type { Column } from '@/components/ui/data-table';
import { Field, Input } from '@/components/ui/input';
import { Card, EmptyState, SectionTitle } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { useReasonedAction } from './confirm-with-reason';
import { addVertex, canClose, formatCoordinates, parseCoordinates, type Vertex } from './polygon-draw';
import { SpawnIncidentDialog } from './spawn-incident';
import {
  AdminTable,
  DateCell,
  Heading,
  NoPermission,
  QueryState,
  StateBadge,
  Textarea,
  useCan,
} from './shared';

/** Pescara: the playable area of the vertical slice; the map recentres on the chosen career. */
const DEFAULT_CENTER: [number, number] = [14.2156, 42.4618];
type Mode = 'idle' | 'draw' | 'spawn';
type ReasonCode = (typeof CLOSURE_REASON_KEYS)[number];

const SRC_CLOSURES = 'admin-closures';
const SRC_DRAFT = 'admin-draft';
const polygonFeature = (ring: Vertex[], id: string): GeoJSON.Feature => ({
  type: 'Feature',
  properties: { id },
  geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]!]] },
});
function draftCollection(vertices: Vertex[], closed: boolean): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = vertices.map((v, i) => ({
    type: 'Feature',
    properties: { index: i + 1 },
    geometry: { type: 'Point', coordinates: v },
  }));
  if (closed && canClose(vertices)) features.push(polygonFeature(vertices, 'draft'));
  else if (vertices.length >= 2)
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: vertices },
    });
  return { type: 'FeatureCollection', features };
}

export function AdminWorld() {
  const t = useTranslations('admin.world');
  const can = useCan();
  const editable = can('world.edit');
  const closures = useQuery({
    queryKey: qk.admin('closures'),
    queryFn: adminApi.closures,
    refetchInterval: 30_000,
  });
  const careers = useQuery({ queryKey: qk.admin('careers', ''), queryFn: () => adminApi.careers({}) });

  const [mode, setMode] = React.useState<Mode>('idle');
  const [vertices, setVertices] = React.useState<Vertex[]>([]);
  const [closed, setClosed] = React.useState(false);
  const [careerId, setCareerId] = React.useState<string>();
  const [spawnAt, setSpawnAt] = React.useState<[number, number] | null>(null);
  const mapRef = React.useRef<MlMap | null>(null);
  const [mapReady, setMapReady] = React.useState(false);

  const career = useQuery({
    queryKey: qk.admin('career', careerId),
    queryFn: () => adminApi.career(careerId!),
    enabled: !!careerId,
  });
  const center = career.data?.summary.center;
  React.useEffect(() => {
    if (center && mapRef.current) mapRef.current.easeTo({ center, zoom: 12.5, duration: 600 });
  }, [center]);

  const finish = React.useCallback(() => {
    setClosed(true);
    setMode('idle');
  }, []);
  const clear = () => {
    setVertices([]);
    setClosed(false);
  };
  const state = useLatest({ mode, vertices, finish });

  const onReady = React.useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
      map.addSource(SRC_CLOSURES, { type: 'geojson', data: empty });
      map.addSource(SRC_DRAFT, { type: 'geojson', data: empty });
      map.addLayer({
        id: 'admin-closures-fill',
        type: 'fill',
        source: SRC_CLOSURES,
        paint: { 'fill-color': '#F59E0B', 'fill-opacity': 0.25 },
      });
      map.addLayer({
        id: 'admin-closures-line',
        type: 'line',
        source: SRC_CLOSURES,
        paint: { 'line-color': '#F59E0B', 'line-width': 2, 'line-dasharray': [2, 1.5] },
      });
      map.addLayer({
        id: 'admin-draft-fill',
        type: 'fill',
        source: SRC_DRAFT,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#E5202A', 'fill-opacity': 0.3 },
      });
      map.addLayer({
        id: 'admin-draft-line',
        type: 'line',
        source: SRC_DRAFT,
        filter: ['!=', ['geometry-type'], 'Point'],
        paint: { 'line-color': '#E5202A', 'line-width': 2.5 },
      });
      map.addLayer({
        id: 'admin-draft-vertices',
        type: 'circle',
        source: SRC_DRAFT,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 6,
          'circle-color': '#FFFFFF',
          'circle-stroke-color': '#E5202A',
          'circle-stroke-width': 2.5,
        },
      });
      const onClick = (e: MapMouseEvent) => {
        const at: Vertex = [e.lngLat.lng, e.lngLat.lat];
        if (state.current.mode === 'draw') setVertices((v) => addVertex(v, at));
        if (state.current.mode === 'spawn') setSpawnAt(at);
      };
      const onDoubleClick = (e: MapMouseEvent) => {
        if (state.current.mode !== 'draw') return;
        e.preventDefault(); // no zoom while closing the polygon
        if (canClose(state.current.vertices)) state.current.finish();
      };
      map.on('click', onClick);
      map.on('dblclick', onDoubleClick);
      setMapReady(true);
      return () => {
        map.off('click', onClick);
        map.off('dblclick', onDoubleClick);
        mapRef.current = null;
      };
    },
    [state],
  );

  // React state → map sources.
  React.useEffect(() => {
    if (!mapReady) return;
    if (mapRef.current) geoJsonSource(mapRef.current, SRC_DRAFT)?.setData(draftCollection(vertices, closed));
  }, [mapReady, vertices, closed]);
  React.useEffect(() => {
    if (!mapReady) return;
    if (mapRef.current)
      geoJsonSource(mapRef.current, SRC_CLOSURES)?.setData({
        type: 'FeatureCollection',
        features: (closures.data ?? []).map((c) => polygonFeature(c.polygon, c.id)),
      });
  }, [mapReady, closures.data]);
  React.useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = mode === 'idle' ? '' : 'crosshair';
  }, [mode, mapReady]);

  // Enter closes the polygon, Escape leaves the current tool, Backspace removes the last vertex — while a tool is active.
  React.useEffect(() => {
    if (mode === 'idle') return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === 'Escape') setMode('idle');
      if (mode !== 'draw') return;
      if (e.key === 'Enter' && canClose(state.current.vertices)) finish();
      if (e.key === 'Backspace') setVertices((v) => v.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, finish, state]);

  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')}>
        {editable ? null : <NoPermission />}
      </Heading>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
        <section className="flex min-w-0 flex-col gap-2">
          {editable ? (
            <div role="toolbar" aria-label={t('tools')} className="flex flex-wrap gap-2">
              <Button
                variant={mode === 'draw' ? 'primary' : 'secondary'}
                aria-pressed={mode === 'draw'}
                onClick={() => {
                  if (closed) clear();
                  setMode(mode === 'draw' ? 'idle' : 'draw');
                }}
              >
                <PenLine className="size-4" aria-hidden />
                {t('draw')}
              </Button>
              <Button
                variant="secondary"
                disabled={vertices.length === 0 || closed}
                onClick={() => setVertices((v) => v.slice(0, -1))}
              >
                <Undo2 className="size-4" aria-hidden />
                {t('undo')}
              </Button>
              <Button variant="secondary" disabled={!canClose(vertices) || closed} onClick={finish}>
                {t('close')}
              </Button>
              <Button variant="ghost" disabled={vertices.length === 0} onClick={clear}>
                <Eraser className="size-4" aria-hidden />
                {t('clear')}
              </Button>
              {can('careers.spawnIncident') ? (
                <Button
                  variant={mode === 'spawn' ? 'primary' : 'secondary'}
                  aria-pressed={mode === 'spawn'}
                  disabled={!careerId}
                  onClick={() => setMode(mode === 'spawn' ? 'idle' : 'spawn')}
                >
                  <Crosshair className="size-4" aria-hidden />
                  {t('spawnTool')}
                </Button>
              ) : null}
            </div>
          ) : null}
          <p className="text-subtle text-xs" aria-live="polite">
            {mode === 'draw'
              ? t('drawHint', { count: vertices.length })
              : mode === 'spawn'
                ? t('spawnHint')
                : closed
                  ? t('closedHint', { count: vertices.length })
                  : t('idleHint')}
          </p>
          <div className="border-border h-[22rem] overflow-hidden rounded-md border lg:h-[32rem]">
            <BaseMap center={DEFAULT_CENTER} zoom={12} onReady={onReady} label={t('mapLabel')} />
          </div>
          <Select
            label={t('careerLabel')}
            value={careerId}
            onValueChange={setCareerId}
            placeholder={t('careerPlaceholder')}
            className="w-full sm:w-96"
            options={(careers.data ?? []).map((c) => ({
              value: c.id,
              label: `${c.directorName} · ${c.locationName}`,
            }))}
          />
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          {editable ? (
            <ClosureForm
              vertices={vertices}
              closed={closed}
              onPaste={(next) => {
                setVertices(next);
                setClosed(true);
                setMode('idle');
                const map = mapRef.current;
                if (map && next[0]) map.easeTo({ center: next[0], duration: 400 });
              }}
              onCreated={clear}
            />
          ) : null}
          <WeatherOverrideCard editable={editable} />
        </div>
      </div>

      <section>
        <SectionTitle>{t('closures', { count: closures.data?.length ?? 0 })}</SectionTitle>
        <QueryState loading={closures.isLoading} error={closures.error}>
          <ClosuresTable rows={closures.data ?? []} editable={editable} />
        </QueryState>
      </section>

      {spawnAt && careerId ? (
        <SpawnIncidentDialog
          open
          careerId={careerId}
          position={spawnAt}
          onOpenChange={(open) => {
            if (open) return;
            setSpawnAt(null);
            setMode('idle');
          }}
        />
      ) : null}
    </>
  );
}

function ClosureForm({
  vertices,
  closed,
  onPaste,
  onCreated,
}: {
  vertices: Vertex[];
  closed: boolean;
  onPaste: (vertices: Vertex[]) => void;
  onCreated: () => void;
}) {
  const t = useTranslations('admin.world');
  const [text, setText] = React.useState('');
  const [pasteError, setPasteError] = React.useState(false);
  const [reasonCode, setReasonCode] = React.useState<ReasonCode>('ROADWORKS');
  const [minutes, setMinutes] = React.useState('30');
  const [multiplier, setMultiplier] = React.useState('3');
  const minutesValue = Number(minutes);
  const multiplierValue = Number(multiplier);
  const minutesOk = Number.isInteger(minutesValue) && minutesValue >= 1 && minutesValue <= 7 * 24 * 60;
  const multiplierOk = Number.isFinite(multiplierValue) && multiplierValue >= 1 && multiplierValue <= 10;
  const ready = closed && canClose(vertices) && minutesOk && multiplierOk;

  const create = useReasonedAction<null>({
    run: (_v, reason) =>
      adminApi.createClosure({
        polygon: vertices,
        reasonKey: closureReasonKey(reasonCode),
        durationSeconds: minutesValue * 60,
        multiplier: multiplierValue,
        reason,
      }),
    success: t('closureCreated'),
    invalidate: [qk.admin('closures')],
    onDone: () => {
      setText('');
      onCreated();
    },
  });

  return (
    <Card className="flex flex-col gap-4">
      <SectionTitle className="mb-0">{t('newClosure')}</SectionTitle>
      <Field
        label={t('coordinates')}
        htmlFor="admin-closure-coordinates"
        hint={t('coordinatesHint')}
        error={pasteError ? t('coordinatesInvalid') : null}
      >
        <Textarea
          id="admin-closure-coordinates"
          rows={4}
          className="font-mono"
          value={closed && !text ? formatCoordinates(vertices) : text}
          onChange={(e) => {
            setText(e.target.value);
            setPasteError(false);
          }}
          invalid={pasteError}
          spellCheck={false}
        />
      </Field>
      <Button
        variant="secondary"
        className="self-start"
        disabled={!text.trim()}
        onClick={() => {
          const parsed = parseCoordinates(text);
          setPasteError(!parsed);
          if (parsed) {
            onPaste(parsed);
            setText('');
          }
        }}
      >
        {t('useCoordinates')}
      </Button>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={t('reasonKey')} htmlFor="admin-closure-reason">
          <Select
            id="admin-closure-reason"
            label={t('reasonKey')}
            value={reasonCode}
            onValueChange={(v) => setReasonCode(v as ReasonCode)}
            className="w-full min-w-0"
            options={CLOSURE_REASON_KEYS.map((code) => ({ value: code, label: t(`reasons.${code}`) }))}
          />
        </Field>
        <Field
          label={t('duration')}
          htmlFor="admin-closure-duration"
          error={minutesOk ? null : t('durationInvalid')}
        >
          <Input
            id="admin-closure-duration"
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            invalid={!minutesOk}
            className="h-10 text-base lg:text-sm"
          />
        </Field>
        <Field
          label={t('multiplier')}
          htmlFor="admin-closure-multiplier"
          error={multiplierOk ? null : t('multiplierInvalid')}
        >
          <Input
            id="admin-closure-multiplier"
            inputMode="decimal"
            value={multiplier}
            onChange={(e) => setMultiplier(e.target.value.replace(',', '.'))}
            invalid={!multiplierOk}
            className="h-10 text-base lg:text-sm"
          />
        </Field>
      </div>
      <Button
        disabled={!ready}
        onClick={() =>
          create.ask(null, {
            title: t('createTitle'),
            description: t('createBody', {
              vertices: vertices.length,
              minutes: minutesValue,
              multiplier: multiplierValue,
            }),
            confirmLabel: t('create'),
          })
        }
      >
        {t('create')}
      </Button>
      {!closed ? <p className="text-subtle text-xs">{t('needPolygon')}</p> : null}
      {create.dialog}
    </Card>
  );
}

function ClosuresTable({ rows, editable }: { rows: AdminClosureRow[]; editable: boolean }) {
  const t = useTranslations('admin.world');
  const remove = useReasonedAction<AdminClosureRow>({
    run: (row, reason) => adminApi.deleteClosure(row.id, reason),
    success: t('closureDeleted'),
    invalidate: [qk.admin('closures')],
  });
  const reasonLabel = (key: string) => {
    const code = CLOSURE_REASON_KEYS.find((c) => closureReasonKey(c) === key);
    return code ? t(`reasons.${code}`) : key;
  };
  const columns: Column<AdminClosureRow>[] = [
    {
      id: 'reason',
      header: t('reasonKey'),
      width: 'minmax(180px,2fr)',
      cell: (c) => reasonLabel(c.reasonKey),
    },
    {
      id: 'multiplier',
      header: t('multiplier'),
      width: '130px',
      align: 'right',
      cell: (c) => `× ${c.multiplier}`,
    },
    { id: 'vertices', header: t('vertices'), width: '100px', align: 'right', cell: (c) => c.polygon.length },
    { id: 'ends', header: t('endsAt'), width: '170px', cell: (c) => <DateCell iso={c.endsAt} /> },
    { id: 'by', header: t('createdBy'), width: 'minmax(200px,2fr)', cell: (c) => c.createdBy },
    {
      id: 'id',
      header: 'ID',
      width: 'minmax(220px,1.5fr)',
      cell: (c) => <code className="text-muted text-xs select-all">{c.id}</code>,
    },
  ];
  return (
    <>
      <AdminTable
        caption={t('closuresCaption')}
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        titleColumn="reason"
        cardTitle={(c) => reasonLabel(c.reasonKey)}
        maxHeight={280}
        actionsWidth="130px"
        actions={
          editable
            ? (c) => (
                <Button
                  size="sm"
                  variant="danger"
                  className="h-7"
                  onClick={() =>
                    remove.ask(c, {
                      title: t('deleteTitle'),
                      description: t('deleteBody'),
                      targetId: c.id,
                      confirmLabel: t('delete'),
                    })
                  }
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  {t('delete')}
                </Button>
              )
            : undefined
        }
        empty={<EmptyState title={t('noClosures')} />}
      />
      {remove.dialog}
    </>
  );
}

function WeatherOverrideCard({ editable }: { editable: boolean }) {
  const t = useTranslations('admin.world');
  const locale = useLocale();
  const name = useCatalogName();
  const q = useQuery({
    queryKey: qk.admin('weatherOverride'),
    queryFn: adminApi.weatherOverride,
    refetchInterval: 30_000,
  });
  const [code, setCode] = React.useState<(typeof WeatherCode.options)[number]>('HEAVY_RAIN');
  const [minutes, setMinutes] = React.useState('30');
  const minutesValue = Number(minutes);
  const minutesOk = Number.isInteger(minutesValue) && minutesValue >= 1 && minutesValue <= 7 * 24 * 60;
  const set = useReasonedAction<null>({
    run: (_v, reason) => adminApi.setWeatherOverride({ code, durationSeconds: minutesValue * 60, reason }),
    success: t('weatherSet'),
    invalidate: [qk.admin('weatherOverride')],
  });
  const clear = useReasonedAction<null>({
    run: (_v, reason) => adminApi.clearWeatherOverride(reason),
    success: t('weatherCleared'),
    invalidate: [qk.admin('weatherOverride')],
  });
  const current = q.data;
  return (
    <Card className="flex flex-col gap-4">
      <SectionTitle className="mb-0">{t('weather')}</SectionTitle>
      <div aria-live="polite">
        {current ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <StateBadge tone="warning" icon={CloudSun} label={t('weatherActive')} />
            <span className="font-semibold">{name('weather', current.code)}</span>
            <span className="text-muted">{t('until', { time: formatDateTime(current.endsAt, locale) })}</span>
          </p>
        ) : (
          <p className="text-subtle text-sm">{t('weatherNone')}</p>
        )}
      </div>
      {editable ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('weatherCode')} htmlFor="admin-weather-code">
              <Select
                id="admin-weather-code"
                label={t('weatherCode')}
                value={code}
                onValueChange={(v) => setCode(v as typeof code)}
                className="w-full min-w-0"
                options={WeatherCode.options.map((c) => ({ value: c, label: name('weather', c) }))}
              />
            </Field>
            <Field
              label={t('duration')}
              htmlFor="admin-weather-duration"
              error={minutesOk ? null : t('durationInvalid')}
            >
              <Input
                id="admin-weather-duration"
                inputMode="numeric"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                invalid={!minutesOk}
                className="h-10 text-base lg:text-sm"
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!minutesOk}
              onClick={() =>
                set.ask(null, {
                  title: t('weatherSetTitle'),
                  description: t('weatherSetBody', { weather: name('weather', code), minutes: minutesValue }),
                  confirmLabel: t('weatherApply'),
                })
              }
            >
              <Siren className="size-4" aria-hidden />
              {t('weatherApply')}
            </Button>
            <Button
              variant="secondary"
              disabled={!current}
              onClick={() =>
                clear.ask(null, {
                  title: t('weatherClearTitle'),
                  description: t('weatherClearBody'),
                  confirmLabel: t('weatherClear'),
                  tone: 'primary',
                })
              }
            >
              {t('weatherClear')}
            </Button>
          </div>
        </>
      ) : null}
      {set.dialog}
      {clear.dialog}
    </Card>
  );
}
