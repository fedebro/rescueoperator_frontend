'use client';
import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertTriangle,
  Car,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudRainWind,
  Construction,
  Moon,
  Snowflake,
  Sun,
  Sunrise,
  ThermometerSun,
  Wind,
  type LucideIcon,
} from 'lucide-react';
import type { SyncSnapshot } from '@/contracts';
import { formatPercent, formatTime } from '@/lib/format';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { useIsDesktop } from '@/hooks/use-media-query';
import { useServerNow } from '@/hooks/use-server-now';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { useUiStore } from '@/stores/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { SectionPrimer } from '@/features/coaching/section-primer';
import { useWorld } from './use-world';
import { useWorldUi } from './world-ui';
import { Popover } from './popover';

type World = SyncSnapshot['world'];

export const WEATHER_ICON: Record<World['weather']['code'], LucideIcon> = {
  CLEAR: Sun,
  CLOUDY: Cloud,
  RAIN: CloudRain,
  HEAVY_RAIN: CloudRainWind,
  STORM: CloudLightning,
  HIGH_WIND: Wind,
  FOG: CloudFog,
  SNOW: Snowflake,
  EXTREME_HEAT: ThermometerSun,
};
const PHASE_ICON: Record<World['dayPhase'], LucideIcon> = { DAY: Sun, TWILIGHT: Sunrise, NIGHT: Moon };
const TRAFFIC_TONE: Record<World['trafficLevel'], string> = {
  FREE_FLOW: 'text-success',
  LIGHT: 'text-success',
  MODERATE: 'text-warning',
  HEAVY: 'text-warning',
  SEVERE: 'text-danger',
};

/** Share of extra road travel time caused by traffic + weather (0 when the contract field is missing). */
export const travelDelay = (world: World): number => Math.max(0, (world.trafficMultiplier ?? 1) - 1);

/** Top bar widget: weather · local time · traffic. Desktop = inline + popover, phone = icon button + sheet. */
export function WorldWidget() {
  const t = useTranslations('world.widget');
  const tw = useTranslations('game.world');
  const locale = useLocale();
  const desktop = useIsDesktop();
  const world = useWorld();
  const now = useServerNow(15_000);
  const [open, setOpen] = React.useState(false);

  const WeatherIcon = WEATHER_ICON[world.weather.code];
  const PhaseIcon = PHASE_ICON[world.dayPhase];
  const time = formatTime(new Date(now).toISOString(), locale, world.timezone);
  const weatherLabel = tw(`weather.${world.weather.code}`);
  const temperature =
    world.weather.temperatureC === null
      ? t('noData')
      : t('temperature', { value: world.weather.temperatureC });
  const trafficLabel = t(`traffic.level.${world.trafficLevel}`);
  const summary = t('open', { weather: weatherLabel, temperature, time, traffic: trafficLabel });

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) track('world_details_opened', { weather: world.weather.code, traffic: world.trafficLevel });
  };
  const details = <WorldDetails world={world} time={time} onNavigate={() => setOpen(false)} />;

  // Phones: icon only (the top bar has no room for text); everything else is one tap away in the sheet.
  if (!desktop)
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          aria-label={summary}
          aria-haspopup="dialog"
          data-testid="world-widget"
          data-weather={world.weather.code}
          data-traffic={world.trafficLevel}
          data-phase={world.dayPhase}
          className="text-fg hover:bg-surface-3 relative grid size-10 shrink-0 place-items-center rounded-md"
        >
          <WeatherIcon className="size-5" aria-hidden />
          {world.closures.length > 0 || world.trafficLevel === 'SEVERE' ? (
            <AlertTriangle className="text-warning absolute -top-0.5 -right-0.5 size-3.5" aria-hidden />
          ) : null}
        </button>
        <DialogContent title={t('title')} closeLabel={t('close')} data-testid="world-details">
          {details}
        </DialogContent>
      </Dialog>
    );

  return (
    <Popover
      id="world-details"
      open={open}
      onOpenChange={onOpenChange}
      label={t('title')}
      className="w-[340px]"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-label={summary}
          data-testid="world-widget"
          data-weather={world.weather.code}
          data-traffic={world.trafficLevel}
          data-phase={world.dayPhase}
          className="border-border bg-surface-2 hover:bg-surface-3 text-fg flex h-10 shrink-0 items-center gap-3 rounded-md border px-2.5 text-xs font-semibold"
        >
          <span className="flex items-center gap-1.5" data-testid="world-weather">
            <WeatherIcon className="size-4.5" aria-hidden />
            <span className="hidden xl:inline">{weatherLabel}</span>
            <span className="tabular">{temperature}</span>
            {world.weather.degraded ? <AlertTriangle className="text-warning size-3.5" aria-hidden /> : null}
          </span>
          <span className="flex items-center gap-1.5" data-testid="world-time">
            <PhaseIcon className="text-muted size-4" aria-hidden />
            <time className="tabular" suppressHydrationWarning>
              {time}
            </time>
          </span>
          <span className="flex items-center gap-1.5" data-testid="world-traffic">
            <Car className={cn('size-4.5', TRAFFIC_TONE[world.trafficLevel])} aria-hidden />
            <span>{trafficLabel}</span>
          </span>
          {world.closures.length > 0 ? (
            <span className="text-warning flex items-center gap-1" data-testid="world-closures-count">
              <Construction className="size-4" aria-hidden />
              <span className="tabular">{world.closures.length}</span>
            </span>
          ) : null}
        </button>
      )}
    >
      <h2 className="font-display mb-3 text-base font-bold">{t('title')}</h2>
      <div data-testid="world-details">{details}</div>
    </Popover>
  );
}

function Row({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="flex gap-3">
      <span aria-hidden className="bg-surface-3 text-fg grid size-9 shrink-0 place-items-center rounded-md">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-subtle text-[11px] font-bold tracking-[0.08em] uppercase">{title}</h3>
        {children}
      </div>
    </section>
  );
}

/** The detail content shared by the desktop popover and the mobile sheet. */
export function WorldDetails({
  world,
  time,
  onNavigate,
}: {
  world: World;
  time: string;
  onNavigate?: () => void;
}) {
  const t = useTranslations('world.widget');
  const tw = useTranslations('game.world');
  const twc = useTranslations('coaching.sections.world');
  const locale = useLocale();
  const name = useCatalogName();
  const router = useRouter();
  const pathname = usePathname();
  const setMapLayer = useUiStore((s) => s.setMapLayer);
  const showClosure = useWorldUi((s) => s.showClosure);
  const WeatherIcon = WEATHER_ICON[world.weather.code];
  const PhaseIcon = PHASE_ICON[world.dayPhase];
  const delay = travelDelay(world);
  const worldContent = {
    sectionKey: 'world',
    title: twc('title'),
    body: twc('body'),
    tips: [twc('tip1'), twc('tip2')],
  };

  const showClosures = () => {
    setMapLayer('closures', true);
    showClosure(world.closures[0]?.id ?? null);
    onNavigate?.();
    if (pathname !== '/game') router.push('/game');
  };

  return (
    <div className="flex flex-col gap-4 text-sm">
      <SectionPrimer content={worldContent} />
      <Row icon={<WeatherIcon className="size-5" />} title={t('weather')}>
        <p className="font-semibold">
          {tw(`weather.${world.weather.code}`)}
          {world.weather.temperatureC !== null ? (
            <span className="tabular"> · {t('temperature', { value: world.weather.temperatureC })}</span>
          ) : null}
        </p>
        <p className="text-muted text-xs">
          {world.weather.windKmh === null ? t('noData') : t('wind', { value: world.weather.windKmh })}
          {world.weatherSource === 'simulated' || world.weatherSource === 'live'
            ? ` · ${t(`source.${world.weatherSource}`)}`
            : null}
        </p>
        {world.weather.degraded ? (
          <p className="text-warning mt-1 flex items-start gap-1.5 text-xs" data-testid="weather-degraded">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              <strong>{t('degraded')}.</strong> {t('degradedHint')}
            </span>
          </p>
        ) : null}
      </Row>

      <Row icon={<PhaseIcon className="size-5" />} title={t('localTime')}>
        <p className="font-semibold">
          <time className="tabular" suppressHydrationWarning>
            {time}
          </time>{' '}
          · {tw(`phase.${world.dayPhase}`)}
        </p>
        <p className="text-muted text-xs">
          {[
            world.hourBand ? name('hourBand', world.hourBand) : null,
            world.weekdayType ? name('weekdayType', world.weekdayType) : null,
            world.season ? name('season', world.season) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </Row>

      <Row
        icon={<Car className={cn('size-5', TRAFFIC_TONE[world.trafficLevel])} />}
        title={t('traffic.title')}
      >
        <p className="font-semibold">{t(`traffic.level.${world.trafficLevel}`)}</p>
        <p className="text-muted text-xs" data-testid="world-travel-effect">
          {delay < 0.005
            ? t('travelEffectNone')
            : t('travelEffectSlower', { percent: formatPercent(delay, locale) })}
        </p>
      </Row>

      <Row icon={<Construction className="size-5" />} title={t('closuresTitle')}>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">{t('closures', { count: world.closures.length })}</p>
          {world.closures.length > 0 ? <Badge tone="warning">{t('closuresEffect')}</Badge> : null}
        </div>
        {world.closures.length > 0 ? (
          <Button variant="link" size="sm" className="mt-1 h-8" onClick={showClosures}>
            {t('showClosures')}
          </Button>
        ) : null}
      </Row>
    </div>
  );
}
