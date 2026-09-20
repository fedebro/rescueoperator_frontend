'use client';
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Lock, Package, ShoppingCart } from 'lucide-react';
import type { FacilityDto, VehicleDto } from '@/contracts';
import { qk } from '@/lib/api/query-keys';
import { formatDateTime } from '@/lib/format';
import { useI18nText } from '@/i18n/use-i18n-text';
import { Button } from '@/components/ui/button';
import { Card, SectionTitle, Skeleton } from '@/components/ui/misc';
import { Timeline, type TimelineItem } from '@/components/ui/timeline';
import { useCareerId, useSnapshot } from '@/features/game/hooks';
import { useFeatureGate, useInventory, useMaintenance, useVehicleHistory } from './api';
import { CareSummary, QuoteList, WorkOrderRow } from './maintenance';
import { OrderDialog } from './order-dialog';
import { RecoverySteps, recoveryStepOf } from './recovery-steps';
import { LowStockAlert, StockLines } from './stock';

function LockedRow({ level }: { level: number }) {
  const tc = useTranslations('common');
  return (
    <p className="text-subtle flex items-center gap-1.5 text-xs" data-testid="feature-locked">
      <Lock className="size-3.5" aria-hidden />
      {tc('requiresLevel', { level })}
    </p>
  );
}

const HISTORY_TONE: Record<string, TimelineItem['tone']> = {
  BROKE_DOWN: 'danger',
  RECOVERY_STARTED: 'warning',
  RECOVERED: 'info',
  SERVICE_DONE: 'success',
  REPAIR_DONE: 'success',
  FREE_EMERGENCY_REPAIR_DONE: 'success',
};
const HISTORY_PREVIEW = 5;

function VehicleHistory({ vehicle }: { vehicle: VehicleDto }) {
  const t = useTranslations('logistics.history');
  const tx = useI18nText();
  const locale = useLocale();
  const { career } = useSnapshot();
  const [all, setAll] = React.useState(false);
  const history = useVehicleHistory(vehicle.id);
  const entries = history.data ?? [];
  if (history.isLoading) return <Skeleton className="h-16" />;
  if (entries.length === 0) return <p className="text-subtle text-xs">{t('empty')}</p>;
  return (
    <div data-testid="vehicle-history">
      <Timeline
        label={t('title')}
        items={(all ? entries : entries.slice(0, HISTORY_PREVIEW)).map((e, i) => ({
          id: `${e.at}-${e.kind}-${i}`,
          time: formatDateTime(e.at, locale, career.timezone),
          title: tx(e.text),
          tone: HISTORY_TONE[e.kind] ?? 'neutral',
        }))}
      />
      {entries.length > HISTORY_PREVIEW ? (
        <Button variant="ghost" size="sm" className="mt-1" onClick={() => setAll((v) => !v)}>
          {all ? t('showLess') : t('showAll', { count: entries.length })}
        </Button>
      ) : null}
    </div>
  );
}

/** SLOT (owner: logistics agent) — health / wear / due state / quotes / recovery / history in the vehicle inspector. */
export function VehicleMaintenanceSection({ vehicle }: { vehicle: VehicleDto }) {
  const t = useTranslations('logistics.workshop');
  const th = useTranslations('logistics.history');
  const careerId = useCareerId();
  const qc = useQueryClient();
  const gate = useFeatureGate('MAINTENANCE');
  const broken = recoveryStepOf(vehicle, null) !== null || vehicle.status === 'MAINTENANCE';
  // A breakdown can (in theory) reach a career below the feature level: its recovery is always shown.
  const enabled = gate.unlocked || broken;
  const maintenance = useMaintenance(enabled);
  const status = maintenance.data?.vehicles.find((v) => v.vehicleId === vehicle.id);
  const order =
    maintenance.data?.orders.find(
      (o) => o.vehicleId === vehicle.id && (o.status === 'QUEUED' || o.status === 'IN_PROGRESS'),
    ) ?? null;

  // The vehicle lives in the realtime snapshot, its maintenance sheet does not: refresh it when the vehicle changes.
  const signature = `${vehicle.status}|${vehicle.health}`;
  const previous = React.useRef(signature);
  React.useEffect(() => {
    if (previous.current === signature) return;
    previous.current = signature;
    void qc.invalidateQueries({ queryKey: qk.maintenance(careerId) });
  }, [signature, qc, careerId]);

  return (
    <section data-testid="vehicle-maintenance" className="flex flex-col gap-3">
      <SectionTitle>{t('sectionTitle')}</SectionTitle>
      {!enabled ? (
        <LockedRow level={gate.requiredLevel} />
      ) : maintenance.isLoading || !status ? (
        <Skeleton className="h-24" />
      ) : (
        <>
          <CareSummary status={status} />
          <RecoverySteps vehicle={vehicle} order={order} />
          {order && recoveryStepOf(vehicle, order) === null ? <WorkOrderRow order={order} /> : null}
          {!order && vehicle.status === 'AVAILABLE' && gate.unlocked ? (
            <QuoteList vehicle={vehicle} quotes={status.quotes} />
          ) : null}
          <div>
            <SectionTitle>{th('title')}</SectionTitle>
            <VehicleHistory vehicle={vehicle} />
          </div>
        </>
      )}
    </section>
  );
}

/** SLOT (owner: logistics agent) — stock of a facility with low-stock alerts and quick ordering (facility page). */
export function FacilityStockSection({ facility }: { facility: FacilityDto }) {
  const t = useTranslations('logistics.stock');
  const gate = useFeatureGate('INVENTORY');
  const inventory = useInventory(gate.unlocked);
  const [ordering, setOrdering] = React.useState(false);
  const lines = (inventory.data?.lines ?? []).filter((l) => l.facilityId === facility.id);
  const inbound = (inventory.data?.orders ?? []).filter(
    (o) => o.facilityId === facility.id && o.status === 'IN_DELIVERY',
  ).length;
  return (
    <Card data-testid="facility-stock" className="flex flex-col gap-3">
      <SectionTitle
        action={
          gate.unlocked && lines.length > 0 ? (
            <Button size="sm" onClick={() => setOrdering(true)} data-testid="open-order">
              <ShoppingCart className="size-3.5" aria-hidden />
              {t('order')}
            </Button>
          ) : null
        }
      >
        {t('title')}
      </SectionTitle>
      {!gate.unlocked ? (
        <LockedRow level={gate.requiredLevel} />
      ) : inventory.isLoading ? (
        <Skeleton className="h-24" />
      ) : lines.length === 0 ? (
        <p className="text-subtle flex items-center gap-1.5 text-xs">
          <Package className="size-3.5" aria-hidden />
          {t('noneHere')}
        </p>
      ) : (
        <>
          <LowStockAlert count={lines.filter((l) => l.low).length} />
          {inbound > 0 ? (
            <p className="text-muted text-xs">{t('inboundOrders', { count: inbound })}</p>
          ) : null}
          <StockLines lines={lines} />
          <OrderDialog open={ordering} onOpenChange={setOrdering} facilityId={facility.id} />
        </>
      )}
    </Card>
  );
}
