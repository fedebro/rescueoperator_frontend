'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Construction, Crosshair, Hexagon, Hospital, Layers, MapPinned, RefreshCw } from 'lucide-react';
import type { ServiceFamily, SyncSnapshot } from '@/contracts';
import { boundsOf, type LngLat } from '@/lib/geo';
import { formatPercent } from '@/lib/format';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { useCatalogName, useI18nText } from '@/i18n/use-i18n-text';
import { useUiStore, type MapLayerKey } from '@/stores/ui';
import { FamilyBadge } from '@/design/icons';
import { Badge } from '@/components/ui/badge';
import { Countdown } from '@/components/ui/countdown';
import { Skeleton } from '@/components/ui/misc';
import { Switch } from '@/components/ui/switch';
import { useIsDesktop } from '@/hooks/use-media-query';
import { DEFAULT_RINGS, UNREACHABLE_BIN, legendBins, type CoverageDto } from './coverage-geo';
import { useSnapshot } from '@/features/game/hooks';
import { useCoverage, useWorld } from './use-world';
import { useWorldUi } from './world-ui';

type Closure = SyncSnapshot['world']['closures'][number];

const LAYER_ROWS: { key: MapLayerKey; icon: React.ReactNode }[] = [
  { key: 'hospitals', icon: <Hospital className="size-5" aria-hidden /> },
  { key: 'closures', icon: <Construction className="size-5" aria-hidden /> },
  { key: 'coverage', icon: <Hexagon className="size-5" aria-hidden /> },
  { key: 'sites', icon: <MapPinned className="size-5" aria-hidden /> },
];

/** Content of the map layers control (desktop popover / mobile sheet). */
export function LayersPanel() {
  const t = useTranslations('world.layers');
  const layers = useUiStore((s) => s.mapLayers);
  const setMapLayer = useUiStore((s) => s.setMapLayer);

  return (
    <div className="flex flex-col gap-4" data-testid="map-layers-panel">
      <ul className="flex flex-col gap-1">
        {LAYER_ROWS.map(({ key, icon }) => {
          const id = `map-layer-${key}`;
          return (
            <li key={key} className="flex min-h-12 items-center gap-3">
              <span className="text-muted shrink-0">{icon}</span>
              <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                <span className="block text-sm font-semibold">{t(`layer.${key}`)}</span>
                <span className="text-muted block text-xs">{t(`hint.${key}`)}</span>
              </label>
              <Switch
                id={id}
                checked={layers[key]}
                onCheckedChange={(on) => {
                  setMapLayer(key, on);
                  track('map_layer_toggled', { layer: key, on });
                }}
                data-testid={`layer-toggle-${key}`}
              />
            </li>
          );
        })}
      </ul>
      {layers.coverage ? <CoverageSection /> : null}
      <ClosuresSection />
    </div>
  );
}

/* ───────────────────────────── coverage ───────────────────────────── */

function CoverageSection() {
  const t = useTranslations('world.layers.coverage');
  const locale = useLocale();
  const name = useCatalogName();
  const family = useUiStore((s) => s.coverageFamily);
  const setFamily = useUiStore((s) => s.setCoverageFamily);
  const { data: coverage, isLoading } = useCoverage(true);
  const { career } = useSnapshot();

  if (isLoading || !coverage) return <Skeleton className="h-40" />;
  // Locked services would only add noise: the picker lists what the player can run (or already runs).
  const families = coverage.byFamily.filter(
    (f) => f.active === true || career.unlockedFamilies.includes(f.family),
  );
  const selected = coverage.byFamily.find((f) => f.family === family);
  const pct = selected ? selected.pct : coverage.overallPct;
  const thresholdSeconds = selected?.thresholdSeconds ?? coverage.targetSeconds;
  const choose = (next: string | null) => {
    setFamily(next);
    track('coverage_family_selected', { family: next ?? 'ALL' });
  };

  return (
    <section className="border-border flex flex-col gap-3 border-t pt-3" data-testid="coverage-section">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-subtle text-[11px] font-bold tracking-[0.08em] uppercase">{t('title')}</h3>
        <span className="tabular text-sm font-semibold" data-testid="coverage-pct">
          {formatPercent(pct / 100, locale)}
        </span>
      </div>
      <div role="group" aria-label={t('family')} className="flex flex-wrap gap-1.5">
        <FamilyChip pressed={family === null} onClick={() => choose(null)} testId="coverage-family-ALL">
          <Layers className="size-4" aria-hidden />
          {t('all')}
        </FamilyChip>
        {families.map((f) => (
          <FamilyChip
            key={f.family}
            pressed={family === f.family}
            onClick={() => choose(f.family)}
            testId={`coverage-family-${f.family}`}
          >
            <FamilyBadge family={f.family as ServiceFamily} size={18} />
            {name('family', f.family, 'short')}
            {f.active === false ? <span className="text-subtle font-normal">· {t('inactive')}</span> : null}
          </FamilyChip>
        ))}
      </div>
      <p className="text-muted text-xs">
        {t('threshold', { minutes: Math.round(thresholdSeconds / 60) })}
        {coverage.method ? ` · ${t(`method.${coverage.method}`)}` : null}
      </p>
      {coverage.stale ? (
        <p className="text-warning flex items-center gap-1.5 text-xs" data-testid="coverage-stale">
          <RefreshCw className="size-3.5" aria-hidden />
          {t('stale')}
        </p>
      ) : null}
      <CoverageLegend coverage={coverage} />
    </section>
  );
}

function FamilyChip({
  pressed,
  onClick,
  children,
  testId,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold',
        pressed
          ? 'border-skyline bg-skyline/15 text-fg'
          : 'border-border-strong text-muted hover:bg-surface-3 hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

/** Numeric legend: every swatch is paired with its minutes, the unreachable one is hatched. */
export function CoverageLegend({ coverage }: { coverage: Pick<CoverageDto, 'isochroneSeconds'> }) {
  const t = useTranslations('world.layers.coverage');
  const bins = legendBins(coverage.isochroneSeconds?.length ? coverage.isochroneSeconds : DEFAULT_RINGS);
  return (
    <div>
      <p className="text-subtle mb-1.5 text-[11px] font-semibold">{t('legend')}</p>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5" data-testid="coverage-legend">
        {bins.map((b) => (
          <li key={b.bin} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="border-border-strong size-4 shrink-0 rounded-sm border"
              style={
                b.bin === UNREACHABLE_BIN
                  ? {
                      backgroundImage: `repeating-linear-gradient(45deg, ${b.color} 0 2px, transparent 2px 5px)`,
                    }
                  : { backgroundColor: b.color }
              }
            />
            <span className="tabular">
              {b.from === null
                ? t('unreachable')
                : b.to === null
                  ? t('over', { from: b.from })
                  : b.from === 0
                    ? t('upTo', { to: b.to })
                    : t('range', { from: b.from, to: b.to })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────────────────────── closures ───────────────────────────── */

function ClosuresSection() {
  const t = useTranslations('world.layers.closures');
  const world = useWorld();
  return (
    <section className="border-border flex flex-col gap-2 border-t pt-3" data-testid="closures-section">
      <h3 className="text-subtle text-[11px] font-bold tracking-[0.08em] uppercase">{t('title')}</h3>
      {world.closures.length === 0 ? (
        <p className="text-muted text-sm">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {world.closures.map((c) => (
            <ClosureRow key={c.id} closure={c} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ClosureRow({ closure }: { closure: Closure }) {
  const t = useTranslations('world.layers.closures');
  const locale = useLocale();
  const tx = useI18nText();
  const desktop = useIsDesktop();
  const focusOn = useUiStore((s) => s.focusOn);
  const setMapLayer = useUiStore((s) => s.setMapLayer);
  const highlighted = useWorldUi((s) => s.highlightedClosureId === closure.id);
  const showClosure = useWorldUi((s) => s.showClosure);
  const setLayersOpen = useWorldUi((s) => s.setLayersOpen);
  const reason = tx(closure.reason);
  const kind = closure.kind ?? 'FULL';

  const center = () => {
    const box = boundsOf(closure.polygon as LngLat[]);
    if (!box) return;
    setMapLayer('closures', true);
    showClosure(closure.id);
    focusOn([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], 15);
    // On phones the panel is a modal sheet over the map: get out of the way.
    if (!desktop) setLayersOpen(false);
  };

  return (
    <li
      className={cn(
        'bg-surface-2 flex items-start gap-2 rounded-md border p-2.5',
        highlighted ? 'border-danger' : 'border-border',
      )}
      data-testid="closure-row"
      data-highlighted={highlighted}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{reason}</p>
        <div className="text-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <Badge tone={kind === 'FULL' ? 'danger' : 'warning'}>
            <Construction className="size-3" aria-hidden />
            {t(`kind.${kind}`)}
          </Badge>
          {closure.multiplier && closure.multiplier > 1 ? (
            <span className="tabular">
              {t('effect', { percent: formatPercent(closure.multiplier - 1, locale) })}
            </span>
          ) : null}
          {closure.endsAt ? (
            <Countdown to={closure.endsAt} prefix={<span>{t('endsIn')}</span>} doneLabel={t('reopening')} />
          ) : (
            <span>{t('noEnd')}</span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={center}
        aria-label={t('center', { reason })}
        className="text-muted hover:bg-surface-3 hover:text-fg grid size-10 shrink-0 place-items-center rounded-md"
      >
        <Crosshair className="size-5" aria-hidden />
      </button>
    </li>
  );
}
