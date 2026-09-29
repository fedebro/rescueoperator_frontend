'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronDown, LifeBuoy, MapPin, Stethoscope, TriangleAlert, X } from 'lucide-react';
import type { IncidentDto, PatientDto, VehicleDto } from '@/contracts';
import { useUiStore } from '@/stores/ui';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { GameIcon, capabilityIconName } from '@/design/icons';
import { Countdown } from '@/components/ui/countdown';
import { Skeleton } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { SectionHelpButton, SectionPrimer } from '@/features/coaching/section-primer';
import { useSnapshot, useVehicleTypeLookup } from '@/features/game/hooks';
import {
  MEDICAL_CAPABILITIES,
  canBeTransported,
  hasCapability,
  isInWater,
  isJustAshore,
  useHospitals,
  useIsWaterUnit,
  usePatients,
} from './hooks';
import { StabilityGauge } from './stability-gauge';
import { SendVehicleList, TransportPanel } from './transport-panel';
import { FieldPostBanner } from './mass-casualty';
import { MedicalChip, PATIENT_STATUS_VISUALS, TRIAGE_VISUALS, WATER_VISUAL } from './visuals';

const PHASE_BY_STATUS: Partial<
  Record<PatientDto['status'], 'assessing' | 'treating' | 'packaging' | 'toHospital' | 'handoff'>
> = {
  ASSESSED: 'assessing',
  TREATING: 'treating',
  STABILIZED: 'packaging',
  IN_TRANSPORT: 'toHospital',
  HANDOFF: 'handoff',
};

/**
 * Water patients: a patient still in the water — waiting for a unit on the water, aboard one on its way to the meeting point
 * (tap its call sign), or left to the Coast Guard — with the time left before they are ashore.
 */
function PatientWaterBanner({ patient }: { patient: PatientDto }) {
  const t = useTranslations('medical.water');
  const { vehicles } = useSnapshot();
  const select = useUiStore((s) => s.select);
  const recovery = patient.recovery ?? null;
  const state =
    recovery?.by === 'VEHICLE' ? 'ABOARD' : recovery?.by === 'COAST_GUARD' ? 'COAST_GUARD' : 'WAITING';
  const carrier = state === 'ABOARD' ? vehicles.find((v) => v.id === recovery?.vehicleId) : undefined;
  return (
    <div
      className="border-info/40 bg-info/10 flex items-start gap-2 rounded-md border p-2.5 text-xs"
      data-testid="patient-water"
      data-recovery={state}
    >
      <LifeBuoy className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-fg text-sm font-semibold">
          {state === 'ABOARD'
            ? carrier
              ? t.rich('aboard', {
                  callSign: carrier.callSign,
                  vehicle: (chunks) => (
                    <button
                      type="button"
                      className="text-skyline underline-offset-2 hover:underline"
                      onClick={() => select({ kind: 'vehicle', id: carrier.id })}
                      data-testid="patient-water-vehicle"
                    >
                      {chunks}
                    </button>
                  ),
                })
              : t('aboardUnknown')
            : state === 'COAST_GUARD'
              ? t('coastGuard')
              : t('waiting')}
        </p>
        {state === 'WAITING' ? <p className="text-muted leading-relaxed">{t('waitingHint')}</p> : null}
        {state !== 'WAITING' && recovery?.etaAt ? (
          <p className="text-muted" data-testid="patient-water-eta">
            {t('ashoreIn')}{' '}
            <Countdown to={recovery.etaAt} doneLabel={t('ashoreSoon')} className="text-fg font-semibold" />
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Water patients: brought ashore to the meeting point, and by whom. */
function PatientAshoreLine({ patient }: { patient: PatientDto }) {
  const t = useTranslations('medical.water');
  const { vehicles } = useSnapshot();
  const recovery = patient.recovery;
  const carrier = recovery?.vehicleId ? vehicles.find((v) => v.id === recovery.vehicleId) : undefined;
  const by =
    recovery?.by === 'COAST_GUARD'
      ? t('ashoreByCoastGuard')
      : carrier
        ? t('ashoreBy', { callSign: carrier.callSign })
        : null;
  return (
    <p
      className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs"
      data-testid="patient-ashore"
      data-recovered-by={recovery?.by ?? ''}
    >
      <MapPin className="text-success size-3.5 shrink-0" aria-hidden />
      <span className="text-fg font-semibold">{t('ashore')}</span>
      {by ? (
        <>
          {' '}
          <span className="text-subtle" aria-hidden>
            ·
          </span>{' '}
          <span className="text-muted">{by}</span>
        </>
      ) : null}
    </p>
  );
}

function PatientCard({
  patient,
  index,
  incident,
}: {
  patient: PatientDto;
  index: number;
  incident: IncidentDto;
}) {
  const t = useTranslations('medical');
  const tw = useTranslations('medical.water');
  const ts = useTranslations('status.patient');
  const name = useCatalogName();
  const { vehicles } = useSnapshot();
  const select = useUiStore((s) => s.select);
  const onTheMove = patient.status === 'IN_TRANSPORT' || patient.status === 'HANDOFF';
  const hospitals = useHospitals(patient.hospitalId !== null).data ?? [];
  const hospital = hospitals.find((h) => h.id === patient.hospitalId);
  const vehicle = vehicles.find((v) => v.id === patient.assignedVehicleId);
  const phase = PHASE_BY_STATUS[patient.status];
  const unmet = patient.needs.filter((n) => !n.met);
  const label = t('patients.label', { n: index + 1 });
  // Water patients: in the water only the units on the water reach them; once ashore, by whom they were brought.
  const inWater = isInWater(patient);
  const broughtAshore = isJustAshore(patient);

  return (
    <li
      className="border-border bg-surface-1 flex flex-col gap-2.5 rounded-md border p-3"
      data-testid="patient-card"
      data-patient-id={patient.id}
      data-patient-status={patient.status}
      data-patient-location={patient.location ?? 'ASHORE'}
      data-triage={patient.triage ?? ''}
      aria-label={label}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-auto min-w-0">
          <span className="block truncate text-sm font-semibold">{label}</span>
          <span className="text-muted block truncate text-xs">
            {patient.profileCode ? name('patientProfile', patient.profileCode) : t('patients.profileUnknown')}
          </span>
        </span>
        {patient.triage ? (
          <MedicalChip
            visual={TRIAGE_VISUALS[patient.triage]}
            label={name('triage', patient.triage)}
            data-testid="triage-chip"
          />
        ) : (
          <MedicalChip visual={PATIENT_STATUS_VISUALS.UNASSESSED} label={t('patients.triageUnknown')} />
        )}
        {patient.triage ? (
          <MedicalChip visual={PATIENT_STATUS_VISUALS[patient.status]} label={ts(patient.status)} />
        ) : null}
      </div>

      {inWater ? <PatientWaterBanner patient={patient} /> : null}
      {broughtAshore ? <PatientAshoreLine patient={patient} /> : null}

      {patient.stability && patient.status !== 'ADMITTED' && patient.status !== 'RELEASED_ON_SCENE' ? (
        <StabilityGauge stability={patient.stability} />
      ) : null}

      {patient.needs.length > 0 && !onTheMove ? (
        <div className="flex flex-col gap-1" data-testid="patient-needs">
          <span className="text-subtle text-xs font-semibold tracking-wide uppercase">
            {/* In the water: what the units on the water bring. */}
            {inWater ? tw('needsTitle') : t('needs.title')}
          </span>
          <ul className="flex flex-wrap gap-1.5">
            {patient.needs.map((need) => {
              const capability = name('capability', need.capability);
              return (
                <li key={need.capability}>
                  <Badge tone={need.met ? 'success' : 'warning'} data-need-met={need.met}>
                    <GameIcon name={capabilityIconName(need.capability)} size={13} />
                    {need.met ? t('needs.met', { capability }) : t('needs.unmet', { capability })}
                    {need.met ? (
                      <Check className="size-3" aria-hidden />
                    ) : (
                      <X className="size-3" aria-hidden />
                    )}
                  </Badge>
                </li>
              );
            })}
          </ul>
          {unmet.length > 0 && patient.status !== 'AWAITING_TRANSPORT' ? (
            <p className="text-muted flex items-start gap-1.5 text-xs">
              <TriangleAlert className="text-warning mt-0.5 size-3.5 shrink-0" aria-hidden />
              {inWater ? tw('unmetHint') : t('needs.unmetHint')}
            </p>
          ) : null}
        </div>
      ) : null}

      {patient.transportRequired === false && patient.status !== 'RELEASED_ON_SCENE' ? (
        <p className="text-muted text-xs">{t('patients.transportNotRequired')}</p>
      ) : null}

      {vehicle || hospital || (onTheMove && !patient.assignedVehicleId) || phase ? (
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-xs">
          {onTheMove ? (
            <>
              <dt className="text-subtle">{t('patients.vehicle')}</dt>
              <dd className="min-w-0">
                {vehicle ? (
                  <button
                    type="button"
                    className="text-skyline max-w-full truncate font-semibold underline-offset-2 hover:underline"
                    onClick={() => select({ kind: 'vehicle', id: vehicle.id })}
                  >
                    {vehicle.callSign}
                  </button>
                ) : (
                  <span className="font-semibold">{t('patients.externalAmbulance')}</span>
                )}
              </dd>
            </>
          ) : null}
          {hospital ? (
            <>
              <dt className="text-subtle">{t('patients.hospital')}</dt>
              <dd className="min-w-0">
                <button
                  type="button"
                  className="text-skyline max-w-full truncate text-left font-semibold underline-offset-2 hover:underline"
                  aria-label={t('patients.openHospital', { hospital: hospital.name })}
                  onClick={() => select({ kind: 'hospital', id: hospital.id }, { focus: hospital.position })}
                >
                  {hospital.name}
                </button>
              </dd>
            </>
          ) : null}
          {phase && patient.busyUntil ? (
            <>
              <dt className="text-subtle">{t(`phase.${phase}`)}</dt>
              <dd>
                <Countdown to={patient.busyUntil} doneLabel={t('phase.done')} className="font-semibold" />
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {patient.status === 'AWAITING_TRANSPORT' ? (
        inWater ? (
          // Nobody leaves for hospital from the water: the transport starts at the meeting point, once ashore.
          <p
            className="text-muted flex items-start gap-1.5 text-xs"
            data-testid="patient-transport-after-recovery"
          >
            <MapPin className="text-info mt-0.5 size-3.5 shrink-0" aria-hidden />
            {tw('transportAfterRecovery')}
          </p>
        ) : (
          <TransportPanel patient={patient} incident={incident} />
        )
      ) : null}
    </li>
  );
}

/**
 * Water patients, nobody assessed yet and all of them in the water: who brings them ashore — a water unit on scene or on its
 * way, the Coast Guard at its time — or, with nobody, the call to send a boat (a quick dispatch once the incident is RESOLVING,
 * when the dispatch panel is gone).
 */
function PatientsInWaterNote({ incident, patients }: { incident: IncidentDto; patients: PatientDto[] }) {
  const t = useTranslations('medical.water');
  const { vehicles } = useSnapshot();
  const typeOf = useVehicleTypeLookup();
  const isWaterUnit = useIsWaterUnit();
  const unitComing = vehicles.some(
    (v) =>
      v.incidentId === incident.id &&
      ['PREPARING', 'EN_ROUTE', 'ON_SCENE'].includes(v.status) &&
      isWaterUnit(v),
  );
  const coastGuardAt =
    patients.find((p) => isInWater(p) && p.recovery?.by === 'COAST_GUARD')?.recovery?.etaAt ?? null;
  const isBoat = React.useCallback((v: VehicleDto) => typeOf(v.typeCode)?.domain === 'WATER', [typeOf]);
  return (
    <div
      className="border-border bg-surface-2 flex flex-col gap-2 rounded-md border p-3"
      data-testid="patients-unassessed"
      data-in-water="true"
    >
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <LifeBuoy className="text-info size-4 shrink-0" aria-hidden />
        {t('sectionTitle')}
      </p>
      {coastGuardAt ? (
        <p className="text-muted text-xs" data-testid="patients-water-coast-guard">
          {t.rich('sectionCoastGuard', {
            countdown: () => (
              <Countdown to={coastGuardAt} doneLabel={t('ashoreSoon')} className="text-fg font-semibold" />
            ),
          })}
        </p>
      ) : null}
      {unitComing ? (
        <p className="text-muted text-xs" data-testid="patients-water-unit">
          {t('sectionUnit')}
        </p>
      ) : !coastGuardAt ? (
        <p className="text-muted text-xs" data-testid="patients-water-none">
          {t('sectionNoUnit')}
        </p>
      ) : null}
      {!unitComing && !coastGuardAt && incident.status === 'RESOLVING' ? (
        <SendVehicleList
          incident={incident}
          filter={isBoat}
          emptyLabel={t('noBoat')}
          sentLabel={(callSign) => t('boatSent', { callSign })}
          testId="send-water-unit"
        />
      ) : null}
    </div>
  );
}

/** Most urgent first: what the collapsed header shows as the one-glance summary. */
const TRIAGE_ORDER: Record<NonNullable<PatientDto['triage']>, number> = {
  RED: 0,
  ORANGE: 1,
  BLUE: 2,
  GREEN: 3,
  WHITE: 4,
};

/**
 * SLOT (owner: medical agent) — patients list + hospital choice inside the incident inspector.
 * Collapsed by default with the count and the most urgent triage in its header ("Pazienti · 1 paziente", 03 §2.4),
 * so the dispatch list stays in reach; it opens by itself when a patient waits for the hospital decision, and while somebody
 * is still in the water or was just brought ashore (water patients: "1 in acqua" in the header).
 */
export function IncidentPatients({ incident }: { incident: IncidentDto }) {
  const t = useTranslations('medical.patients');
  const tm = useTranslations('coaching.sections.medical');
  const tco = useTranslations('coaching');
  const tc = useTranslations('common');
  const name = useCatalogName();
  const { vehicles } = useSnapshot();
  const patients = usePatients(incident);
  // null = automatic (open only while a transport decision is pending or somebody is in the water); a tap makes it the
  // player's choice.
  const [open, setOpen] = React.useState<boolean | null>(null);
  const bodyId = React.useId();
  const medicalContent = {
    sectionKey: 'medical',
    title: tm('title'),
    body: tm('body'),
    tips: [tm('tip1'), tm('tip2')],
  };
  if (incident.patientCount === 0) return null;

  const list = patients.data ?? [];
  const inWater = list.filter(isInWater).length;
  const awaitingTransport = list.some(canBeTransported);
  // Brought ashore and still cared for at the meeting point: their landing must not fold what the player is watching.
  const justAshore = list.some(isJustAshore);
  const expanded = open ?? (awaitingTransport || inWater > 0 || justAshore);
  const allUnassessed = list.length > 0 && list.every((p) => p.status === 'UNASSESSED');
  // Nobody assessed yet because they are all still in the water: the water note replaces "Triage in corso".
  const unassessedInWater = allUnassessed && list.every(isInWater);
  const worst = list
    .filter((p) => p.triage)
    .sort((a, b) => TRIAGE_ORDER[a.triage!] - TRIAGE_ORDER[b.triage!])[0]?.triage;
  const medicalAssigned = vehicles.some(
    (v) =>
      v.incidentId === incident.id &&
      ['PREPARING', 'EN_ROUTE', 'ON_SCENE'].includes(v.status) &&
      hasCapability(v, MEDICAL_CAPABILITIES),
  );

  return (
    <section
      className="border-border flex flex-col gap-2 border-b px-4 py-1"
      aria-label={t('title')}
      data-testid="incident-patients"
      data-expanded={expanded}
    >
      <div className="flex items-center gap-1">
        <h2 className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setOpen(!expanded)}
            aria-expanded={expanded}
            aria-controls={bodyId}
            className="flex min-h-11 w-full items-center gap-2 text-left"
            data-testid="patients-toggle"
          >
            {/* The summary wraps onto a second line when it does not fit (a long triage label + "1 in acqua"). */}
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 py-1">
              <span className="text-subtle text-xs font-bold tracking-[0.08em] uppercase">{t('title')}</span>
              <span className="text-muted text-xs whitespace-nowrap">
                {t('count', { count: incident.patientCount })}
              </span>
              {worst ? (
                <MedicalChip visual={TRIAGE_VISUALS[worst]} label={name('triage', worst)} />
              ) : !expanded && (allUnassessed || list.length === 0) ? (
                <span className="text-subtle truncate text-xs">{t('triageUnknown')}</span>
              ) : null}
              {inWater > 0 ? (
                <MedicalChip
                  visual={WATER_VISUAL}
                  label={t('inWater', { count: inWater })}
                  data-testid="patients-in-water"
                />
              ) : null}
            </span>
            <ChevronDown
              className={cn(
                'text-muted ml-auto size-4 shrink-0 transition-transform',
                expanded && 'rotate-180',
              )}
              aria-hidden
            />
            <span className="sr-only">{expanded ? t('collapse') : t('expand')}</span>
          </button>
        </h2>
        {/* The patients primer, on demand (it only shows once by itself). */}
        <SectionHelpButton
          content={medicalContent}
          label={tco('help.buttonLabel')}
          closeLabel={tc('close')}
        />
      </div>
      {expanded ? (
        <div id={bodyId} className="flex flex-col gap-2 pb-3">
          <SectionPrimer content={medicalContent} />
          {/* Mass-casualty care: a field post (EMS_PMA) on scene treats 4 at once and releases the lighter codes. */}
          <FieldPostBanner incident={incident} />
          {patients.isLoading ? (
            <Skeleton className="h-20" />
          ) : patients.isError && list.length === 0 ? (
            <p className="text-danger text-sm">{t('loadError')}</p>
          ) : (
            <>
              {unassessedInWater ? (
                <PatientsInWaterNote incident={incident} patients={list} />
              ) : allUnassessed ? (
                <div
                  className="border-border bg-surface-2 flex flex-col gap-2 rounded-md border p-3"
                  data-testid="patients-unassessed"
                >
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <Stethoscope className="text-info size-4 shrink-0" aria-hidden />
                    {t('unassessedTitle')}
                  </p>
                  <p className="text-muted text-xs">
                    {medicalAssigned ? t('unassessedHint') : t('unassessedNoMedical')}
                  </p>
                  {!medicalAssigned && incident.status === 'RESOLVING' ? (
                    <SendVehicleList incident={incident} capabilities={MEDICAL_CAPABILITIES} />
                  ) : null}
                </div>
              ) : null}
              <ul className="flex flex-col gap-2">
                {list.map((patient, index) => (
                  <PatientCard key={patient.id} patient={patient} index={index} incident={incident} />
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
