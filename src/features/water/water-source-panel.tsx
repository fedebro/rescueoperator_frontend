'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, Droplets, Sparkles, Waves } from 'lucide-react';
import type { IncidentDto, VehicleDto, WaterSourceOption } from '@/contracts';
import { waterApi } from '@/lib/api/depth';
import { qk } from '@/lib/api/query-keys';
import { useErrorMessage } from '@/lib/api/error-message';
import { formatClock, formatDistance } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { useIsDesktop } from '@/hooks/use-media-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { SectionTitle, Skeleton } from '@/components/ui/misc';
import { useCareerId, useSnapshot, useVehicleTypeLookup } from '@/features/game/hooks';

/** An aircraft that carries water: the only kind of vehicle that refills at a lake, a river or the sea. */
export const isWaterBomber = (
  vehicle: VehicleDto,
  type: { movement?: string | undefined } | undefined,
): boolean =>
  type?.movement === 'AIR' && vehicle.capabilities.some((c) => c.code === 'WATER_SUPPLY' && c.value > 0);

/** Readable name: the map's own name when it has one, otherwise the kind plus the municipality. */
export function useWaterSourceName(): (
  option: Pick<WaterSourceOption, 'name' | 'kind' | 'locality'>,
) => string {
  const t = useTranslations('water');
  return (option) => {
    if (option.name) return option.name;
    if (option.locality)
      return t(option.kind === 'COAST' ? 'seaNear' : 'waterNear', { locality: option.locality });
    return t(option.kind === 'COAST' ? 'sea' : 'water');
  };
}

function OptionSummary({ option }: { option: WaterSourceOption }) {
  const t = useTranslations('water');
  const locale = useLocale();
  const name = useWaterSourceName();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="min-w-0 truncate text-sm font-semibold">{name(option)}</span>
        {option.recommended ? (
          <Badge tone="info">
            <Sparkles className="size-3" aria-hidden />
            {t('nearest')}
          </Badge>
        ) : null}
      </div>
      <dl className="text-muted flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
        <div className="flex gap-1">
          <dt>{t('distance')}</dt>
          <dd className="tabular text-fg font-semibold">{formatDistance(option.distanceMeters, locale)}</dd>
        </div>
        <div className="flex gap-1">
          <dt>{t('run')}</dt>
          <dd className="tabular text-fg font-semibold">{formatClock(option.runSeconds)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Manual choice: the same radio group the hospital picker uses. */
function OptionsRadioGroup({
  options,
  value,
  onChange,
}: {
  options: WaterSourceOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const t = useTranslations('water');
  const name = useWaterSourceName();
  return (
    <div role="radiogroup" aria-label={t('chooseTitle')} className="flex flex-col gap-2">
      {options.map((option) => {
        const checked = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={t('select', { source: name(option) })}
            onClick={() => onChange(option.id)}
            data-testid="water-source-option"
            data-water-source-id={option.id}
            className={cn(
              'flex min-h-14 items-start gap-2.5 rounded-md border p-2.5 text-left',
              checked ? 'border-info bg-info/10' : 'border-border bg-surface-2 hover:bg-surface-3',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border',
                checked ? 'border-info' : 'border-border-strong',
              )}
            >
              {checked ? <span className="bg-info size-2 rounded-full" /> : null}
            </span>
            <OptionSummary option={option} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Where the water bombers of this incident take on water. The nearest source is used automatically and needs no tap:
 * the panel only exists so the player can send them somewhere else when more than one body of water is within reach.
 */
export function WaterSourcePanel({ incident }: { incident: IncidentDto }) {
  const t = useTranslations('water');
  const tc = useTranslations('common');
  const careerId = useCareerId();
  const isDesktop = useIsDesktop();
  const { vehicles } = useSnapshot();
  const typeOf = useVehicleTypeLookup();
  const errorMessage = useErrorMessage();
  const name = useWaterSourceName();
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);

  const bombers = vehicles.filter(
    (v) => v.incidentId === incident.id && isWaterBomber(v, typeOf(v.typeCode)),
  );
  const sources = useQuery({
    queryKey: qk.waterSources(careerId, incident.id),
    queryFn: () => waterApi.sources(careerId, incident.id),
    enabled: bombers.length > 0,
    staleTime: 60_000,
  });

  const choose = useMutation({
    mutationFn: (waterSourceId: string) => waterApi.choose(careerId, incident.id, waterSourceId),
    onSuccess: (result, waterSourceId) => {
      qc.setQueryData(qk.waterSources(careerId, incident.id), result);
      const picked = result.options.find((o) => o.id === waterSourceId);
      if (picked) toast({ tone: 'success', title: t('chosen', { source: name(picked) }), durationMs: 3000 });
      setOpen(false);
    },
    onError: (e) => {
      toast({ tone: 'danger', title: errorMessage(e) });
      void sources.refetch();
    },
  });

  if (bombers.length === 0) return null;
  if (sources.isLoading)
    return (
      <div aria-busy="true" aria-label={t('loading')}>
        <Skeleton className="h-16" />
      </div>
    );
  const options = sources.data?.options ?? [];
  const active = options.find((o) => o.selected) ?? options.find((o) => o.recommended) ?? options[0];
  if (!active) {
    return (
      <div data-testid="water-source-panel">
        <SectionTitle>{t('title')}</SectionTitle>
        <p className="text-muted text-xs">{t('none')}</p>
      </div>
    );
  }
  const pickedId = active.id;

  const chooser = (
    <OptionsRadioGroup options={options} value={pickedId} onChange={(id) => choose.mutate(id)} />
  );

  return (
    <div className="flex flex-col gap-2" data-testid="water-source-panel">
      <SectionTitle>{t('title')}</SectionTitle>
      <div className="border-border bg-surface-2 flex flex-col gap-3 rounded-md border p-3">
        <p className="text-muted flex items-start gap-1.5 text-xs">
          <Waves className="text-info mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t('hint', { count: bombers.length })}
        </p>
        <div className="flex items-start gap-2">
          <Droplets className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
          <OptionSummary option={active} />
        </div>
        {options.length > 1 ? (
          <Button
            variant="outline"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            data-testid="choose-other-water-source"
          >
            {open && isDesktop ? (
              <ChevronUp className="size-4" aria-hidden />
            ) : (
              <ChevronDown className="size-4" aria-hidden />
            )}
            {open && isDesktop ? t('hideOptions') : t('chooseOther')}
          </Button>
        ) : null}
        {open && isDesktop ? chooser : null}
        {!isDesktop ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent title={t('chooseTitle')} closeLabel={tc('close')}>
              {chooser}
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    </div>
  );
}
