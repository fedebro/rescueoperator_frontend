'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Truck } from 'lucide-react';
import type { AidColumnOptionsDto, AidColumnVehicleOptionDto } from '@/contracts';
import { aidApi } from '@/lib/api/alliance';
import { formatAmount, formatClock } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCatalogName, useI18nText } from '@/i18n/use-i18n-text';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/switch';
import { CreditAmount } from '@/components/ui/credit-amount';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { EmptyState, Skeleton, Stat } from '@/components/ui/misc';
import { GapList } from './aid-request-card';
import { useAllianceMutation, useColumnOptions } from './hooks';

/** Pure: what a selection of vehicles brings against the gaps — per-capability, capped at what is missing (05 §6.2). */
export function columnEstimate(options: AidColumnOptionsDto, selected: readonly string[]) {
  const missing = new Map(options.request.gaps.map((g) => [g.capability, g.missing] as const));
  const brought = new Map<string, number>();
  for (const v of options.vehicles.filter((x) => selected.includes(x.vehicleId)))
    for (const c of v.capabilities) brought.set(c.capability, (brought.get(c.capability) ?? 0) + c.value);
  const totalMissing = [...missing.values()].reduce((s, m) => s + m, 0);
  const useful = [...missing].reduce((s, [cap, m]) => s + Math.min(m, brought.get(cap) ?? 0), 0);
  const share = totalMissing > 0 ? useful / totalMissing : 0;
  const slowest = options.vehicles
    .filter((x) => selected.includes(x.vehicleId))
    .reduce((m, v) => Math.max(m, v.etaSeconds), 0);
  return {
    share,
    useful,
    totalMissing,
    etaSeconds: slowest,
    credits: Math.round(Number(options.fund.credits) * share * options.pairFactor),
    xp: Math.round(Number(options.fund.xp) * share * options.pairFactor),
  };
}

/** "La tua copertura scende a …" bands of the helper's own territory (05 §3.2). */
export function coverageBand(pct: number | null): 'OK' | 'LOW' | 'CRITICAL' | null {
  if (pct === null) return null;
  return pct >= 60 ? 'OK' : pct >= 35 ? 'LOW' : 'CRITICAL';
}

function VehicleRow({
  v,
  checked,
  onChange,
  disabled,
}: {
  v: AidColumnVehicleOptionDto;
  checked: boolean;
  onChange: (c: boolean) => void;
  disabled: boolean;
}) {
  const t = useTranslations('alliance.aid.composer');
  const name = useCatalogName();
  const blocked = v.blockedReason !== null;
  return (
    <li
      className={cn('flex items-center gap-3 py-2', blocked && 'opacity-60')}
      data-testid="column-vehicle"
      data-vehicle-id={v.vehicleId}
      data-blocked={v.blockedReason ?? ''}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(c) => onChange(c === true)}
        disabled={blocked || (disabled && !checked)}
        aria-label={v.callSign}
        data-testid="column-vehicle-check"
      />
      <div className="min-w-0 flex-1 text-sm">
        <p className="flex flex-wrap items-center gap-x-2">
          <span className="font-semibold">{v.callSign}</span>
          <span className="text-muted text-xs">{name('vehicle', v.typeCode)}</span>
          <span className="text-subtle text-xs">{v.facilityName}</span>
        </p>
        <p className="text-muted flex flex-wrap gap-x-2 text-xs">
          {v.capabilities
            .filter((c) => c.useful > 0)
            .map((c) => (
              <span key={c.capability}>
                {name('capability', c.capability)} <span className="tabular text-success">+{c.useful}</span>
              </span>
            ))}
        </p>
      </div>
      <span className={cn('tabular shrink-0 text-xs font-semibold', blocked ? 'text-danger' : 'text-info')}>
        {blocked ? t(`blocked.${v.blockedReason}`) : t('eta', { time: formatClock(v.etaSeconds) })}
      </span>
    </li>
  );
}

/**
 * Comporre la colonna (study 09 §4.2, 05 §3.2): my useful vehicles with contribution and arrival; the total coverage, the
 * estimated reward, the warning on my own coverage; "Invia la colonna". The same shape as the dispatch panel.
 */
export function ColumnComposer({
  requestId,
  onOpenChange,
  onSent,
}: {
  requestId: string | null;
  onOpenChange: (open: boolean) => void;
  onSent?: () => void;
}) {
  const t = useTranslations('alliance.aid.composer');
  const ta = useTranslations('alliance.aid');
  const tc = useTranslations('common');
  const tx = useI18nText();
  const locale = useLocale();
  const options = useColumnOptions(requestId);
  const [selected, setSelected] = React.useState<string[]>([]);
  const send = useAllianceMutation(
    (careerId, body: { requestId: string; vehicleIds: string[] }) =>
      aidApi.sendColumn(careerId, body.requestId, { vehicleIds: body.vehicleIds }),
    {
      successToast: t('sent'),
      onSuccess: () => {
        onOpenChange(false);
        onSent?.();
      },
    },
  );
  const data = options.data;
  const estimate = data ? columnEstimate(data, selected) : null;
  const band = data ? coverageBand(data.ownCoverage.ifAllSentPct) : null;
  const max = data?.maxVehicles ?? 4;
  const close = (open: boolean) => {
    if (!open) setSelected([]);
    onOpenChange(open);
  };
  return (
    <Dialog open={requestId !== null} onOpenChange={close}>
      <DialogContent
        title={t('title')}
        closeLabel={tc('close')}
        aria-describedby={undefined}
        className="md:w-[min(640px,92vw)]"
      >
        <div className="scroll-y flex min-h-0 flex-col gap-3 px-4 pb-2" data-testid="column-composer">
          {options.isPending || !data ? (
            <Skeleton className="h-40" />
          ) : (
            <>
              <div className="border-border bg-surface-2 rounded-md border p-3 text-sm">
                <p className="font-semibold">
                  {tx(data.request.incident.title)} · {data.request.requester.directorName}
                </p>
                <p className="text-muted text-xs">{data.request.incident.municipality ?? ''}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-subtle text-xs">{ta('missing')}</span>
                  <GapList gaps={data.request.gaps} />
                </div>
              </div>
              {data.blockedReason ? (
                <p
                  className="text-warning text-sm font-semibold"
                  role="status"
                  data-testid="composer-blocked"
                >
                  {ta(`blocked.${data.blockedReason}`)}
                </p>
              ) : null}
              {data.vehicles.length === 0 ? (
                <EmptyState title={t('noVehicles')} description={t('noVehiclesHint')} />
              ) : (
                <ul
                  className="divide-border divide-y"
                  aria-label={t('vehicles')}
                  data-testid="column-vehicles"
                >
                  {data.vehicles.map((v) => (
                    <VehicleRow
                      key={v.vehicleId}
                      v={v}
                      checked={selected.includes(v.vehicleId)}
                      disabled={selected.length >= max}
                      onChange={(c) =>
                        setSelected((s) =>
                          c ? [...s, v.vehicleId].slice(0, max) : s.filter((id) => id !== v.vehicleId),
                        )
                      }
                    />
                  ))}
                </ul>
              )}
              <p className="text-subtle text-xs">{t('maxVehicles', { max })}</p>
              {estimate ? (
                <div
                  className="border-border grid grid-cols-3 gap-3 rounded-md border p-3"
                  data-testid="column-summary"
                >
                  <Stat
                    label={t('coverage')}
                    value={<span className="tabular">{Math.round(estimate.share * 100)}%</span>}
                  />
                  <Stat
                    label={t('arrival')}
                    value={
                      <span className="tabular">
                        {selected.length ? formatClock(estimate.etaSeconds) : '—'}
                      </span>
                    }
                  />
                  <Stat
                    label={t('reward')}
                    value={
                      selected.length ? (
                        <CreditAmount value={String(estimate.credits)} label={t('reward')} />
                      ) : (
                        <span>—</span>
                      )
                    }
                  />
                </div>
              ) : null}
              <p className="text-subtle text-xs">
                {t('rewardHint', {
                  credits: formatAmount(data.fund.credits, locale),
                  used: data.dailyRewarded.used,
                  cap: data.dailyRewarded.cap,
                })}
                {data.pairFactor < 1 ? ` ${t('pairFactor', { factor: data.pairFactor })}` : ''}
              </p>
              {band && band !== 'OK' ? (
                <p
                  className={cn(
                    'flex items-center gap-2 text-sm font-semibold',
                    band === 'CRITICAL' ? 'text-danger' : 'text-warning',
                  )}
                  role="status"
                  data-testid="column-coverage-warning"
                >
                  <AlertTriangle className="size-4 shrink-0" aria-hidden />
                  {t('coverageWarning', {
                    band: ta(`coverage.${band}`),
                    pct: data.ownCoverage.ifAllSentPct ?? 0,
                  })}
                </p>
              ) : null}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>
            {tc('cancel')}
          </Button>
          <Button
            onClick={() => requestId && send.mutate({ requestId, vehicleIds: selected })}
            disabled={selected.length === 0 || !!data?.blockedReason}
            loading={send.isPending}
            data-testid="column-send"
          >
            <Truck className="size-4" aria-hidden />
            {t('send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
