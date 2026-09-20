'use client';
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Send, Sparkles, Truck } from 'lucide-react';
import type { IncidentDto } from '@/contracts';
import { gameApi } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/query-keys';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/error-message';
import { formatClock, formatDistance } from '@/lib/format';
import { playSound } from '@/lib/sound';
import { soundEnabled, useSettingsStore } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { useCatalogName, useI18nText } from '@/i18n/use-i18n-text';
import { cn } from '@/lib/utils';
import { GameIcon, TopdownGlyph, capabilityIconName, vehicleClassOf } from '@/design/icons';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CapabilityBar } from '@/components/ui/capability-bar';
import { Checkbox } from '@/components/ui/switch';
import { EmptyState, SectionTitle, Skeleton } from '@/components/ui/misc';
import { StatusChip } from '@/components/ui/status-chip';
import { DispatchCrewBlocked, DispatchCrewPreview } from '@/features/personnel/slots';
import { useCareerId, useCatalog, useSnapshot, useVehicleTypeLookup } from './hooks';

export function RequirementBars({
  incident,
  planned,
}: {
  incident: IncidentDto;
  planned?: Map<string, number>;
}) {
  const t = useTranslations('game.requirements');
  const tx = useI18nText();
  const catalog = useCatalog();
  const nameOf = (code: string) =>
    tx(catalog?.capabilities.find((c) => c.code === code)?.name ?? { key: `catalog.capability.${code}` });
  const legend = {
    onScene: t('onScene'),
    enRoute: t('enRoute'),
    planned: t('planned'),
    required: t('required'),
  };
  return (
    <div className="flex flex-col gap-3">
      {incident.requirements.map((r) => (
        <CapabilityBar
          key={r.capability}
          label={nameOf(r.capability)}
          icon={<GameIcon name={capabilityIconName(r.capability)} size={16} />}
          required={r.required}
          onScene={r.onScene}
          enRoute={r.enRoute}
          planned={planned?.get(r.capability) ?? 0}
          level={r.level}
          levelLabel={t(`level.${r.level}`)}
          legend={legend}
        />
      ))}
      <ul className="text-subtle flex flex-wrap gap-x-4 gap-y-1 text-[11px]" aria-hidden>
        <li className="flex items-center gap-1">
          <span className="bg-success h-2 w-4 rounded-sm" />
          {legend.onScene}
        </li>
        <li className="flex items-center gap-1">
          <span
            className="h-2 w-4 rounded-sm"
            style={{
              backgroundImage:
                'repeating-linear-gradient(135deg, var(--rc-warning) 0 3px, transparent 3px 5px)',
            }}
          />
          {legend.enRoute}
        </li>
        <li className="flex items-center gap-1">
          <span className="border-info h-2 w-4 rounded-sm border border-dashed" />
          {legend.planned}
        </li>
        <li className="flex items-center gap-1">
          <span className="bg-fg h-3 w-0.5" />
          {legend.required}
        </li>
      </ul>
    </div>
  );
}

/** Assisted but fully editable dispatch: one tap sends the recommended set, no confirmation step (Spec 05 §13). */
export function DispatchPanel({ incident }: { incident: IncidentDto }) {
  const careerId = useCareerId();
  const t = useTranslations('game.dispatch');
  const ts = useTranslations('status.vehicle');
  const tw = useTranslations('game.dispatch.warning');
  const itemName = useCatalogName();
  /**
   * Warning codes are opaque strings; the stock ones carry the item code after a colon
   * (`STOCK_LOW:FIRE_FOAM`). An unknown code falls back to itself rather than throwing, so a server that learns a new
   * warning never breaks an old client.
   */
  const warningText = (code: string): string => {
    const [key, param] = code.split(':');
    if (param && tw.has(key as never))
      return (tw as unknown as (k: string, v: Record<string, string>) => string)(key!, {
        item: itemName('item', param),
      });
    return tw.has(code as never) ? tw(code as never) : code;
  };
  const tx = useI18nText();
  const locale = useLocale();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const { vehicles } = useSnapshot();
  const typeOf = useVehicleTypeLookup();
  // Options depend on which vehicles are free: refetch whenever the fleet's status signature changes.
  const signature = vehicles.map((v) => `${v.id}:${v.status}`).join('|');
  const options = useQuery({
    queryKey: [...qk.dispatchOptions(careerId, incident.id), signature],
    queryFn: () => gameApi.dispatchOptions(careerId, incident.id),
    staleTime: 5_000,
    placeholderData: (prev) => prev,
  });
  const [manual, setManual] = React.useState<Set<string> | null>(null);

  const data = options.data;
  const recommended = React.useMemo(() => new Set(data?.recommendedVehicleIds ?? []), [data]);
  const dispatchable = React.useMemo(
    () => new Set((data?.options ?? []).filter((o) => o.dispatchable).map((o) => o.vehicleId)),
    [data],
  );
  const selected = React.useMemo(
    () => new Set([...(manual ?? recommended)].filter((id) => dispatchable.has(id))),
    [manual, recommended, dispatchable],
  );
  const planned = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const o of data?.options ?? [])
      if (selected.has(o.vehicleId))
        for (const c of o.contributes) m.set(c.code, (m.get(c.code) ?? 0) + c.value);
    return m;
  }, [data, selected]);
  const insufficient = incident.requirements.some(
    (r) => r.level === 'REQUIRED' && r.onScene + r.enRoute + (planned.get(r.capability) ?? 0) < r.required,
  );

  const mutation = useMutation({
    mutationFn: (ids: string[]) => gameApi.dispatch(careerId, incident.id, ids),
    onSuccess: (_r, ids) => {
      playSound('dispatch', soundEnabled(useSettingsStore.getState().sound));
      toast({ tone: 'success', title: t('sent', { count: ids.length }), durationMs: 3000 });
      setManual(null);
      if (incident.isTutorial) void gameApi.tutorialAdvance(careerId, 'WATCH_ARRIVAL').catch(() => undefined);
      void qc.invalidateQueries({ queryKey: qk.dispatchOptions(careerId, incident.id) });
    },
    onError: (e) => {
      toast({ tone: 'danger', title: errorMessage(e) });
      if (isApiError(e, 'VEHICLE_NOT_AVAILABLE')) {
        setManual(null);
        void options.refetch();
      }
    },
  });

  const toggle = (id: string) =>
    setManual((prev) => {
      const next = new Set(prev ?? recommended);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const sameAsRecommended =
    selected.size === recommended.size && [...selected].every((id) => recommended.has(id));

  if (!data)
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-10" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="dispatch-panel">
      {dispatchable.size === 0 ? (
        <div>
          <SectionTitle>{t('requirements')}</SectionTitle>
          <RequirementBars incident={incident} planned={planned} />
        </div>
      ) : null}
      {/* Vehicles that only lack a crew explain why and how to fix it, even when nothing else can leave. */}
      {dispatchable.size === 0 ? <DispatchCrewBlocked options={data.options} /> : null}
      {dispatchable.size === 0 && incident.assignedVehicleIds.length > 0 ? (
        <p className="text-subtle text-center text-xs">{t('noneAvailableHint')}</p>
      ) : dispatchable.size === 0 ? (
        <EmptyState
          icon={<Truck className="size-5" />}
          title={t('noneAvailableTitle')}
          description={t('noneAvailableHint')}
          action={
            <Button asChild variant="secondary">
              <Link href="/game/shop">{t('goToShop')}</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <Button
              size="lg"
              className="w-full"
              onClick={() => mutation.mutate([...recommended])}
              loading={mutation.isPending}
              disabled={recommended.size === 0}
              data-tutorial="send-recommended"
              data-testid="send-recommended"
            >
              <Sparkles className="size-5" aria-hidden />
              {t('sendRecommended', { count: recommended.size })}
            </Button>
            {!sameAsRecommended ? (
              <Button
                size="lg"
                variant="secondary"
                className="w-full"
                onClick={() => mutation.mutate([...selected])}
                loading={mutation.isPending}
                disabled={selected.size === 0}
                data-testid="send-selected"
              >
                <Send className="size-4" aria-hidden />
                {t('sendSelected', { count: selected.size })}
              </Button>
            ) : null}
            {!data.recommendationCoversRequired && sameAsRecommended ? (
              <p className="text-warning flex items-start gap-2 text-xs">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {t('recommendationPartial')}
              </p>
            ) : null}
            {insufficient && !sameAsRecommended && selected.size > 0 ? (
              <p
                role="status"
                className="text-warning flex items-start gap-2 text-xs"
                data-testid="insufficient-warning"
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {t('insufficient')}
              </p>
            ) : null}
          </div>

          <div>
            <SectionTitle>{t('requirements')}</SectionTitle>
            <RequirementBars incident={incident} planned={planned} />
          </div>

          <div>
            <SectionTitle>{t('options')}</SectionTitle>
            <ul className="flex flex-col gap-1.5">
              {data.options.map((o) => {
                const vehicle = vehicles.find((v) => v.id === o.vehicleId);
                if (!vehicle) return null;
                const type = typeOf(vehicle.typeCode);
                const checked = selected.has(o.vehicleId);
                const id = `opt-${o.vehicleId}`;
                return (
                  <li
                    key={o.vehicleId}
                    className={cn(
                      'bg-surface-2 rounded-md border p-2.5',
                      checked ? 'border-focus' : 'border-border',
                      !o.dispatchable && 'opacity-60',
                    )}
                    data-testid="dispatch-option"
                  >
                    <div className="flex items-center gap-2.5">
                      <Checkbox
                        id={id}
                        checked={checked}
                        disabled={!o.dispatchable}
                        onCheckedChange={() => toggle(o.vehicleId)}
                        aria-label={t('selectVehicle', { callSign: vehicle.callSign })}
                      />
                      <TopdownGlyph
                        vehicleClass={vehicleClassOf(type?.icon)}
                        family={vehicle.family}
                        size={28}
                      />
                      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                        <span className="flex items-center gap-1.5">
                          <span className="text-fg truncate text-sm font-semibold">{vehicle.callSign}</span>
                          {o.recommended ? <Badge tone="brand">{t('recommended')}</Badge> : null}
                        </span>
                        <span className="text-muted block truncate text-xs">
                          {type ? tx(type.name) : vehicle.typeCode}
                        </span>
                      </label>
                      {o.dispatchable ? (
                        <span className="text-right">
                          <span className="tabular text-fg block text-sm font-semibold">
                            {formatClock(o.etaSeconds)}
                          </span>
                          <span className="tabular text-subtle block text-[11px]">
                            {formatDistance(o.distanceMeters, locale)}
                          </span>
                        </span>
                      ) : (
                        <StatusChip status={vehicle.status} label={ts(vehicle.status)} />
                      )}
                    </div>
                    {o.contributes.length > 0 || o.warnings.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1 pl-[30px]">
                        {o.contributes.map((c) => (
                          <Badge key={c.code} tone="neutral">
                            <GameIcon name={capabilityIconName(c.code)} size={12} />
                            {c.value}
                          </Badge>
                        ))}
                        {o.warnings.map((w) => (
                          <Badge key={w} tone="warning">
                            <AlertTriangle className="size-3" aria-hidden />
                            {warningText(w)}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    <DispatchCrewPreview option={o} />
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
