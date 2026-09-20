'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight, Warehouse, Wrench } from 'lucide-react';
import type { VehicleDto } from '@/contracts';
import type { MaintenanceStatus } from './api';
import { useI18nText } from '@/i18n/use-i18n-text';
import { useIsDesktop } from '@/hooks/use-media-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Card, EmptyState, ProgressBar, SectionTitle, Skeleton } from '@/components/ui/misc';
import { StatusChip } from '@/components/ui/status-chip';
import { useSnapshot, useVehicleTypeLookup } from '@/features/game/hooks';
import { useMaintenance } from './api';
import { CareSummary, QuoteList, WorkOrderRow } from './maintenance';
import { DueChip, HealthBandChip, RiskChip, healthTone } from './visuals';

interface Row {
  vehicle: VehicleDto;
  status: MaintenanceStatus;
}
const DUE_RANK = { OVERDUE: 0, DUE: 1, UPCOMING: 2, NOT_DUE: 3 } as const;
const RISK_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

/** Workshop: fleet sorted by what needs attention first + the workshop queue of every facility. */
export function WorkshopTab() {
  const t = useTranslations('logistics.workshop');
  const tc = useTranslations('common');
  const ts = useTranslations('status.vehicle');
  const tx = useI18nText();
  const desktop = useIsDesktop();
  const { vehicles, facilities } = useSnapshot();
  const typeOf = useVehicleTypeLookup();
  const maintenance = useMaintenance();
  const [openId, setOpenId] = React.useState<string | null>(null);

  const rows: Row[] = React.useMemo(
    () =>
      (maintenance.data?.vehicles ?? [])
        .flatMap((status) => {
          const vehicle = vehicles.find((v) => v.id === status.vehicleId);
          return vehicle ? [{ vehicle, status }] : [];
        })
        .sort(
          (a, b) =>
            DUE_RANK[a.status.due] - DUE_RANK[b.status.due] ||
            a.status.health - b.status.health ||
            a.vehicle.callSign.localeCompare(b.vehicle.callSign),
        ),
    [maintenance.data, vehicles],
  );
  const open = rows.find((r) => r.vehicle.id === openId) ?? null;
  const orders = (maintenance.data?.orders ?? []).filter(
    (o) => o.status === 'QUEUED' || o.status === 'IN_PROGRESS',
  );
  const facilityName = (id: string) => facilities.find((f) => f.id === id)?.name ?? '—';
  const typeName = (v: VehicleDto) => {
    const type = typeOf(v.typeCode);
    return type ? tx(type.name) : v.typeCode;
  };

  if (maintenance.isLoading) return <Skeleton className="h-48" />;
  if (rows.length === 0) return <EmptyState icon={<Wrench className="size-5" />} title={t('empty')} />;

  const columns: Column<Row>[] = [
    {
      id: 'vehicle',
      header: t('col.vehicle'),
      width: 'minmax(150px,2fr)',
      cell: (r) => (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate font-semibold">{r.vehicle.callSign}</span>
        </span>
      ),
      sortValue: (r) => r.vehicle.callSign,
    },
    {
      id: 'facility',
      header: t('col.facility'),
      width: 'minmax(130px,1.5fr)',
      cell: (r) => <span className="text-muted truncate">{facilityName(r.vehicle.facilityId)}</span>,
      sortValue: (r) => facilityName(r.vehicle.facilityId),
    },
    {
      id: 'status',
      header: t('col.status'),
      width: '150px',
      cell: (r) => <StatusChip status={r.vehicle.status} label={ts(r.vehicle.status)} />,
      sortValue: (r) => r.vehicle.status,
    },
    {
      id: 'health',
      header: t('col.health'),
      width: '130px',
      cell: (r) => (
        <span className="flex w-full items-center gap-2">
          <ProgressBar
            value={r.status.health / 100}
            label={t('health')}
            tone={healthTone(r.status.healthBand)}
            className="flex-1"
          />
          <span className="tabular w-9 text-right">{Math.round(r.status.health)}%</span>
        </span>
      ),
      sortValue: (r) => r.status.health,
    },
    {
      id: 'band',
      header: t('col.band'),
      width: '130px',
      cell: (r) => <HealthBandChip band={r.status.healthBand} />,
      sortValue: (r) => r.status.health,
    },
    {
      id: 'wear',
      header: t('col.wear'),
      width: '80px',
      align: 'right',
      cell: (r) => <span className="tabular">{Math.round(r.status.wear)}%</span>,
      sortValue: (r) => r.status.wear,
    },
    {
      id: 'km',
      header: t('col.km'),
      width: '80px',
      align: 'right',
      cell: (r) => <span className="tabular">{Math.round(r.status.km)}</span>,
      sortValue: (r) => r.status.km,
    },
    {
      id: 'missions',
      header: t('col.missions'),
      width: '90px',
      align: 'right',
      cell: (r) => <span className="tabular">{r.status.missions}</span>,
      sortValue: (r) => r.status.missions,
    },
    {
      id: 'due',
      header: t('col.due'),
      width: '140px',
      cell: (r) => <DueChip due={r.status.due} />,
      sortValue: (r) => DUE_RANK[r.status.due],
    },
    {
      id: 'risk',
      header: t('col.risk'),
      width: '140px',
      cell: (r) => <RiskChip risk={r.status.failureRisk} />,
      sortValue: (r) => RISK_RANK[r.status.failureRisk],
    },
  ];

  return (
    <div className="flex flex-col gap-5" data-testid="workshop-tab">
      <section>
        <SectionTitle>{t('fleet')}</SectionTitle>
        {desktop ? (
          <DataTable
            caption={t('fleet')}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.vehicle.id}
            density="compact"
            onRowClick={(r) => setOpenId(r.vehicle.id)}
            selectedKey={openId}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li key={r.vehicle.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(r.vehicle.id)}
                  className="border-border bg-surface-2 hover:bg-surface-3 flex w-full flex-col gap-2 rounded-md border p-3 text-left"
                  data-testid="workshop-vehicle"
                  data-vehicle-id={r.vehicle.id}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{r.vehicle.callSign}</span>
                      <span className="text-muted block truncate text-xs">
                        {typeName(r.vehicle)} · {facilityName(r.vehicle.facilityId)}
                      </span>
                    </span>
                    <StatusChip status={r.vehicle.status} label={ts(r.vehicle.status)} />
                    <ChevronRight className="text-subtle size-4 shrink-0" aria-hidden />
                  </span>
                  <span className="flex w-full items-center gap-2">
                    <ProgressBar
                      value={r.status.health / 100}
                      label={t('health')}
                      tone={healthTone(r.status.healthBand)}
                      className="flex-1"
                    />
                    <span className="tabular text-xs font-semibold">{Math.round(r.status.health)}%</span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    <HealthBandChip band={r.status.healthBand} />
                    <DueChip due={r.status.due} />
                    <RiskChip risk={r.status.failureRisk} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle>{t('queue')}</SectionTitle>
        <div className="grid gap-3 md:grid-cols-2">
          {(maintenance.data?.workshops ?? []).map((w) => {
            const mine = orders.filter(
              (o) => vehicles.find((v) => v.id === o.vehicleId)?.facilityId === w.facilityId,
            );
            return (
              <Card key={w.facilityId} className="flex flex-col gap-3" data-testid="workshop-facility">
                <div className="flex items-center gap-2">
                  <Warehouse className="text-muted size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {facilityName(w.facilityId)}
                  </span>
                  {w.slots === 0 ? (
                    <Badge tone="warning">{t('external')}</Badge>
                  ) : (
                    <Badge tone={w.busy >= w.slots ? 'warning' : 'info'} data-testid="workshop-slots">
                      {t('slots', { busy: w.busy, slots: w.slots })}
                    </Badge>
                  )}
                </div>
                {w.slots === 0 ? <p className="text-subtle text-xs">{t('externalHint')}</p> : null}
                {mine.length === 0 ? (
                  <p className="text-subtle text-xs">{t('queueEmpty')}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {mine.map((o) => (
                      <li key={o.id}>
                        <WorkOrderRow
                          order={o}
                          label={vehicles.find((v) => v.id === o.vehicleId)?.callSign}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      <Dialog
        open={open !== null}
        onOpenChange={(o) => {
          if (!o) setOpenId(null);
        }}
      >
        {open ? (
          <DialogContent
            title={open.vehicle.callSign}
            description={`${typeName(open.vehicle)} · ${facilityName(open.vehicle.facilityId)}`}
            closeLabel={tc('close')}
            data-testid="workshop-dialog"
          >
            <div className="flex flex-col gap-4">
              <CareSummary status={open.status} />
              <div>
                <SectionTitle>{t('quotes')}</SectionTitle>
                {orders.some((o) => o.vehicleId === open.vehicle.id) ? (
                  <WorkOrderRow order={orders.find((o) => o.vehicleId === open.vehicle.id)!} />
                ) : open.vehicle.status !== 'AVAILABLE' ? (
                  <p className="text-subtle text-xs">{t('notAvailable')}</p>
                ) : (
                  <QuoteList
                    vehicle={open.vehicle}
                    quotes={open.status.quotes}
                    onStarted={() => setOpenId(null)}
                  />
                )}
              </div>
              <Button variant="ghost" onClick={() => setOpenId(null)}>
                {tc('close')}
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
