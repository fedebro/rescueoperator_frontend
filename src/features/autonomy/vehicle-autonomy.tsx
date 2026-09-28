'use client';
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Clock, Fuel, HelpCircle, Lightbulb, PackageCheck, Plane, RotateCcw } from 'lucide-react';
import type { VehicleAutonomyDto, VehicleDto } from '@/contracts';
import { gameApi } from '@/lib/api/endpoints';
import { useErrorMessage } from '@/lib/api/error-message';
import { track } from '@/lib/analytics';
import { toast } from '@/stores/toast';
import { Button, IconButton } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { SectionTitle } from '@/components/ui/misc';
import { markCoachSeen, useCoachingEnabled, useCoachSeen } from '@/features/coaching/store';
import { useCareerId, usePatchSnapshot, useSnapshot } from '@/features/game/hooks';
import { useMajorStore } from '@/features/major/store';
import { useUiStore } from '@/stores/ui';
import { useI18nText } from '@/i18n/use-i18n-text';
import { incidentScene } from '@/features/water/water';
import { canRequestResupply, isAutonomyTracked } from './autonomy';
import { FuelGauge, MissionsLeftLine, StockGauge } from './gauge';

/** "Seen" keys of the explanation cards (per career, see features/coaching/store.ts). */
export const EXPLAIN_KEYS = {
  stock: 'explain:autonomy-stock',
  fuel: 'explain:autonomy-fuel',
  /** Flight endurance (phase 3): the first time an aircraft's autonomy shows, in minutes of flight. */
  flight: 'explain:autonomy-flight',
} as const;

/**
 * The explanation card of a half the first time it is unlocked (study §3.5: level 2 onboard stock, level 3–4 fuel,
 * "con una scheda di spiegazione"): one card at a time, stock first. Silent when coaching is off; the "?" of the section
 * reopens both on demand.
 */
function AutonomyExplainCard({ autonomy }: { autonomy: VehicleAutonomyDto }) {
  const t = useTranslations('autonomy.explain');
  const careerId = useCareerId();
  const enabled = useCoachingEnabled();
  const stockSeen = useCoachSeen(careerId, EXPLAIN_KEYS.stock);
  const fuelSeen = useCoachSeen(careerId, EXPLAIN_KEYS.fuel);
  const flightSeen = useCoachSeen(careerId, EXPLAIN_KEYS.flight);
  const flight = autonomy.fuel?.unit === 'MIN';
  const which =
    autonomy.unlocked.stock && autonomy.items.length > 0 && !stockSeen
      ? 'stock'
      : autonomy.unlocked.fuel && autonomy.fuel !== null && flight && !flightSeen
        ? 'flight'
        : autonomy.unlocked.fuel && autonomy.fuel !== null && !flight && !fuelSeen
          ? 'fuel'
          : null;
  if (!enabled || which === null) return null;
  const dismiss = () => {
    markCoachSeen(careerId, EXPLAIN_KEYS[which]);
    track('coaching_primer_dismissed', { kind: `autonomy-${which}` });
  };
  return (
    <div
      role="note"
      className="border-border-strong bg-surface-2 flex flex-col gap-1.5 rounded-lg border p-3 text-sm"
      data-testid="autonomy-explain"
      data-kind={which}
    >
      <p className="font-display flex items-center gap-2 font-bold">
        <Lightbulb className="text-skyline size-4 shrink-0" aria-hidden />
        {which === 'stock' ? t('stockTitle') : which === 'flight' ? t('flightTitle') : t('fuelTitle')}
      </p>
      <p className="text-muted text-xs leading-relaxed">
        {which === 'stock' ? t('stockBody') : which === 'flight' ? t('flightBody') : t('fuelBody')}
      </p>
      <Button
        variant="secondary"
        size="sm"
        className="h-11 self-end lg:h-8"
        onClick={dismiss}
        data-testid="autonomy-explain-dismiss"
      >
        {t('dismiss')}
      </Button>
    </div>
  );
}

/** "?" next to the section title: both explanations on demand, whatever the coaching state (an explicit request). */
function AutonomyHelpButton({ autonomy }: { autonomy: VehicleAutonomyDto }) {
  const t = useTranslations('autonomy');
  const tc = useTranslations('common');
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <IconButton
        label={t('help')}
        size="sm"
        className="-my-2 size-11 lg:size-8"
        onClick={() => setOpen(true)}
        data-testid="autonomy-help"
      >
        <HelpCircle className="size-4" aria-hidden />
      </IconButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t('title')} closeLabel={tc('close')}>
          <div className="flex flex-col gap-4 text-sm" data-testid="autonomy-help-dialog">
            {autonomy.unlocked.stock ? (
              <section>
                <h3 className="font-display mb-1 font-bold">{t('explain.stockTitle')}</h3>
                <p className="text-muted">{t('explain.stockBody')}</p>
              </section>
            ) : null}
            {autonomy.unlocked.fuel && autonomy.fuel?.unit === 'MIN' ? (
              <section data-testid="autonomy-help-flight">
                <h3 className="font-display mb-1 font-bold">{t('explain.flightTitle')}</h3>
                <p className="text-muted">{t('explain.flightBody')}</p>
              </section>
            ) : autonomy.unlocked.fuel ? (
              <section>
                <h3 className="font-display mb-1 font-bold">{t('explain.fuelTitle')}</h3>
                <p className="text-muted">{t('explain.fuelBody')}</p>
              </section>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Vehicle inspector (study §3.4): the "~N missions" line, two compact gauges — fuel (tank) and onboard stock (box, per-item
 * detail on demand) —, the RESTOCKING countdown, a pending manual request, and the "Rientra a rifornire" action. Hidden
 * entirely below the unlock levels (nothing tracked yet).
 */
export function VehicleAutonomySection({ vehicle }: { vehicle: VehicleDto }) {
  const t = useTranslations('autonomy');
  const careerId = useCareerId();
  const errorMessage = useErrorMessage();
  const patch = usePatchSnapshot();
  const autonomy = vehicle.autonomy;
  const resupply = useMutation({
    mutationFn: () => gameApi.resupplyVehicle(careerId, vehicle.id),
    onSuccess: (result) => {
      track('vehicle_resupply_requested', { status: result.mode, typeCode: vehicle.typeCode });
      patch((s) => ({
        ...s,
        vehicles: s.vehicles.map((v) => (v.id === result.vehicle.id ? result.vehicle : v)),
      }));
      toast({
        tone: result.mode === 'ALREADY_FULL' || result.mode === 'ALREADY_RESUPPLYING' ? 'info' : 'success',
        title: t(`resupplyResult.${result.mode}`, { callSign: vehicle.callSign }),
        durationMs: 3500,
      });
    },
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });
  if (!isAutonomyTracked(autonomy)) return null;
  const restocking = vehicle.status === 'RESTOCKING';
  return (
    <section
      className="flex flex-col gap-3"
      data-testid="vehicle-autonomy"
      aria-labelledby={`autonomy-${vehicle.id}`}
    >
      <SectionTitle className="mb-0" action={<AutonomyHelpButton autonomy={autonomy} />}>
        <span id={`autonomy-${vehicle.id}`}>{t('title')}</span>
      </SectionTitle>
      <MissionsLeftLine autonomy={autonomy} />
      <div className="border-border bg-surface-2 flex flex-col gap-2 rounded-md border px-3 py-2">
        {autonomy.fuel ? <FuelGauge fuel={autonomy.fuel} /> : null}
        {autonomy.items.length > 0 ? <StockGauge items={autonomy.items} /> : null}
      </div>
      {/* The data first, its one-time explanation right under it. */}
      <AutonomyExplainCard autonomy={autonomy} />
      {restocking ? (
        <p
          className="text-info flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
          role="status"
          data-testid="restocking"
        >
          <PackageCheck className="size-4 shrink-0" aria-hidden />
          <span className="font-semibold">{t('resupplying')}</span>
          {vehicle.busyUntil ? (
            <Countdown
              to={vehicle.busyUntil}
              doneLabel="…"
              className="text-muted"
              prefix={<span className="text-subtle text-xs">{t('readyIn')}</span>}
            />
          ) : null}
        </p>
      ) : null}
      <FlightResumeNote vehicle={vehicle} />
      {autonomy.resupplyRequested && !restocking ? (
        <p
          className="text-muted flex items-center gap-2 text-sm"
          role="status"
          data-testid="resupply-requested"
        >
          <Clock className="size-4 shrink-0" aria-hidden />
          {t('resupplyRequested')}
        </p>
      ) : null}
      {canRequestResupply(vehicle) ? (
        <div className="flex flex-col gap-1">
          <Button
            variant="secondary"
            className="h-11 w-full"
            onClick={() => resupply.mutate()}
            loading={resupply.isPending}
            data-testid="return-to-resupply"
          >
            {vehicle.status === 'RETURNING' ? (
              <RotateCcw className="size-4" aria-hidden />
            ) : (
              <Fuel className="size-4" aria-hidden />
            )}
            {t('returnToResupply')}
          </Button>
          <p className="text-subtle text-xs">{t('returnToResupplyHint')}</p>
        </div>
      ) : null}
    </section>
  );
}

/**
 * An aircraft turned back at "bingo" flies back to its incident on its own once refuelled (`flight.resumeAfterRefuel`):
 * said here while it heads home and refuels, with the way to that incident.
 */
function FlightResumeNote({ vehicle }: { vehicle: VehicleDto }) {
  const t = useTranslations('autonomy.bingo');
  const tx = useI18nText();
  const incidentId = useMajorStore((s) => s.flightResume[vehicle.id]);
  const { incidents } = useSnapshot();
  const select = useUiStore((s) => s.select);
  const incident = incidentId ? incidents.find((i) => i.id === incidentId) : undefined;
  if (!incident || !['RETURNING', 'RESTOCKING', 'AVAILABLE'].includes(vehicle.status)) return null;
  return (
    <button
      type="button"
      onClick={() => select({ kind: 'incident', id: incident.id }, { focus: incidentScene(incident) })}
      className="border-info/40 bg-info/10 flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm"
      data-testid="flight-resume"
    >
      <Plane className="text-info size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="text-info block text-xs font-semibold">{t('willResume')}</span>
        <span className="block truncate font-semibold">{tx(incident.title)}</span>
      </span>
    </button>
  );
}
