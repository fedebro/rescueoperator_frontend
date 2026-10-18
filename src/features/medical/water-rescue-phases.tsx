'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { TriangleAlert } from 'lucide-react';
import type { IncidentDto, PatientDto, VehicleDto } from '@/contracts';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useServerNow } from '@/hooks/use-server-now';
import { useSnapshot, useVehicleTypeLookup } from '@/features/game/hooks';
import { rescuePhases, someoneBeingLanded, type RescuePhase } from '@/features/water/rescue-phases';
import { MEDICAL_CAPABILITIES, TRANSPORT_CAPABILITY, hasCapability } from './hooks';
import { SendVehicleList } from './transport-panel';

const ACTIVE = ['PREPARING', 'EN_ROUTE', 'ON_SCENE'];

/** A land unit that can take over the people landed at the meeting point: on the ground, with care or transport. */
export function useIsLandMedicalUnit(): (vehicle: VehicleDto) => boolean {
  const typeOf = useVehicleTypeLookup();
  return React.useCallback(
    (vehicle) =>
      typeOf(vehicle.typeCode)?.domain === 'GROUND' &&
      hasCapability(vehicle, [...MEDICAL_CAPABILITIES, TRANSPORT_CAPABILITY]),
    [typeOf],
  );
}

function PhaseStep({ phase, index }: { phase: RescuePhase; index: number }) {
  const t = useTranslations('medical.water.phases');
  const locale = useLocale();
  const { vehicles, career } = useSnapshot();
  const count = phase.patients.length;
  const callSigns = phase.vehicleIds
    .map((id) => vehicles.find((v) => v.id === id)?.callSign)
    .filter((c): c is string => !!c);
  const detail =
    count === 0
      ? null
      : phase.key === 'HEADING_ASHORE' && phase.etaAt
        ? t('eta', { time: formatTime(phase.etaAt, locale, career.timezone) })
        : phase.key === 'IN_WATER' && phase.etaAt
          ? t('coastGuardEta', { time: formatTime(phase.etaAt, locale, career.timezone) })
          : phase.key === 'ASHORE' && callSigns.length === 0
            ? t('waitingLandUnit')
            : null;
  return (
    <li
      className={cn(
        'border-border flex min-w-[6.5rem] flex-1 flex-col gap-0.5 rounded-md border px-2 py-1.5',
        count > 0 ? 'bg-info/10 border-info/40' : 'bg-surface-2 opacity-60',
      )}
      data-testid="rescue-phase"
      data-phase={phase.key}
      data-count={count}
    >
      <span className="text-subtle text-[11px] font-bold tracking-[0.06em] uppercase">
        {index + 1}. {t(phase.key)}
      </span>
      <span className="text-fg text-sm font-semibold" data-testid="rescue-phase-count">
        {t('count', { count })}
      </span>
      {callSigns.length > 0 ? (
        <span className="text-muted truncate text-xs" data-testid="rescue-phase-vehicles">
          {callSigns.join(', ')}
        </span>
      ) : null}
      {detail ? (
        <span className="text-muted text-xs" data-testid="rescue-phase-detail">
          {detail}
        </span>
      ) : null}
    </li>
  );
}

/**
 * Water rescue with a meeting point (analisi/studio-2026-10-18-mare/01 §3.1 and §3.3): the phase strip — In mare → A bordo →
 * Verso riva (arrivo hh:mm) → A riva, in attesa del mezzo di terra → In ospedale — with the patients in each phase and the unit
 * that has them; and, when a boat is about to land people where no land medical unit is or is coming, a warning (with a quick
 * send once the dispatch panel is gone).
 */
export function WaterRescuePhases({ incident, patients }: { incident: IncidentDto; patients: PatientDto[] }) {
  const t = useTranslations('medical.water.phases');
  const { vehicles } = useSnapshot();
  const isLandMedical = useIsLandMedicalUnit();
  // A patient goes from "a bordo" to "verso riva" at `departsAt` without any new DTO: the strip follows the clock.
  const now = useServerNow(1000, someoneBeingLanded(patients));
  const strip = rescuePhases(patients, now);
  if (!strip) return null;
  const landUnitThere = vehicles.some(
    (v) => v.incidentId === incident.id && ACTIVE.includes(v.status) && isLandMedical(v),
  );
  const warn = someoneBeingLanded(patients) && !landUnitThere;
  return (
    <div className="flex flex-col gap-2" data-testid="rescue-phases">
      <ol className="flex flex-wrap gap-1.5" aria-label={t('title')}>
        {strip.phases.map((phase, index) => (
          <PhaseStep key={phase.key} phase={phase} index={index} />
        ))}
      </ol>
      {strip.others.length > 0 ? (
        <p className="text-muted text-xs" data-testid="rescue-phases-others">
          {t('others', { count: strip.others.length })}
        </p>
      ) : null}
      {warn ? (
        <div
          role="status"
          className="border-warning/40 bg-warning/10 flex flex-col gap-2 rounded-md border p-2.5 text-xs"
          data-testid="rescue-landing-warning"
        >
          <p className="text-warning flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t('noLandUnit')}
          </p>
          {incident.status === 'RESOLVING' ? (
            <SendVehicleList incident={incident} filter={isLandMedical} testId="send-land-medical" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
