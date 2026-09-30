'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  Ambulance,
  Check,
  ChevronDown,
  ChevronUp,
  Lock,
  Send,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { z } from 'zod';
import type { HospitalDto, HospitalOption, IncidentDto, PatientDto, VehicleDto } from '@/contracts';
import { gameApi } from '@/lib/api/endpoints';
import { medicalApi } from '@/lib/api/depth';
import { qk } from '@/lib/api/query-keys';
import { useErrorMessage } from '@/lib/api/error-message';
import { track } from '@/lib/analytics';
import { formatClock } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { useI18nText } from '@/i18n/use-i18n-text';
import { useIsDesktop } from '@/hooks/use-media-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/misc';
import { CoachMark } from '@/features/coaching/coach-mark';
import { useCareerId, usePatchSnapshot, useSnapshot, useVehicleTypeLookup } from '@/features/game/hooks';
import {
  TRANSPORT_CAPABILITY,
  canBeTransported,
  hasCapability,
  useHospitalChoice,
  useHospitals,
  usePatients,
} from './hooks';
import { LOAD_VISUALS, MedicalChip } from './visuals';
import {
  BoardingPicker,
  MULTI_PATIENT_CAPACITY,
  coPassengerCandidates,
  isFieldPostType,
  isMultiPatient,
} from './mass-casualty';

type Option = z.infer<typeof HospitalOption>;
type Hospital = z.infer<typeof HospitalDto>;

/** One hospital option: name, ETA, handoff, compatibility and load (icon + label each), then the reasons. */
function OptionSummary({ option, hospital }: { option: Option; hospital: Hospital | undefined }) {
  const t = useTranslations('medical.transport');
  const tl = useTranslations('status.hospitalLoad');
  const tx = useI18nText();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="min-w-0 truncate text-sm font-semibold">{hospital?.name ?? option.hospitalId}</span>
        {option.recommended ? (
          <Badge tone="info">
            <Sparkles className="size-3" aria-hidden />
            {t('recommended')}
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <MedicalChip visual={LOAD_VISUALS[option.load]} label={tl(option.load)} data-load={option.load} />
        <Badge tone={option.compatible ? 'success' : 'warning'}>
          {option.compatible ? (
            <Check className="size-3" aria-hidden />
          ) : (
            <TriangleAlert className="size-3" aria-hidden />
          )}
          {option.compatible ? t('compatible') : t('notCompatible')}
        </Badge>
      </div>
      <dl className="text-muted flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
        <div className="flex gap-1">
          <dt>{t('travel')}</dt>
          <dd className="tabular text-fg font-semibold">{formatClock(option.etaSeconds)}</dd>
        </div>
        <div className="flex gap-1">
          <dt>{t('handoff')}</dt>
          <dd className="tabular text-fg font-semibold">{formatClock(option.expectedHandoffSeconds)}</dd>
        </div>
      </dl>
      {option.reasons.length > 0 ? (
        <ul className="text-muted flex flex-col gap-0.5 text-xs" data-testid="hospital-reasons">
          {option.reasons.map((reason) => (
            <li key={reason.key} className="flex items-start gap-1">
              <span aria-hidden className="bg-subtle mt-1.5 size-1 shrink-0 rounded-full" />
              {tx(reason)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Manual choice: a radio group of every option (closed hospitals cannot be picked). */
function OptionsRadioGroup({
  options,
  hospitals,
  value,
  onChange,
}: {
  options: Option[];
  hospitals: Hospital[];
  value: string;
  onChange: (hospitalId: string) => void;
}) {
  const t = useTranslations('medical.transport');
  return (
    <div role="radiogroup" aria-label={t('chooseTitle')} className="flex flex-col gap-2">
      {options.map((option) => {
        const hospital = hospitals.find((h) => h.id === option.hospitalId);
        const checked = option.hospitalId === value;
        return (
          <button
            key={option.hospitalId}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={t('select', { hospital: hospital?.name ?? option.hospitalId })}
            disabled={option.load === 'CLOSED'}
            onClick={() => onChange(option.hospitalId)}
            data-testid="hospital-option"
            data-hospital-id={option.hospitalId}
            className={cn(
              'flex min-h-14 items-start gap-2.5 rounded-md border p-2.5 text-left disabled:opacity-50',
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
            <OptionSummary option={option} hospital={hospital} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Quick dispatch of a transport-capable vehicle (or, with `filter`, of any vehicle it accepts — the boats that bring the
 * people in the water ashore): the core dispatch panel is hidden once the incident is RESOLVING.
 */
export function SendVehicleList({
  incident,
  capabilities = [],
  filter,
  emptyLabel,
  sentLabel,
  testId = 'send-transport-vehicle',
}: {
  incident: IncidentDto;
  /** The player's vehicles with one of these capabilities… */
  capabilities?: readonly string[];
  /** …or those this predicate accepts. */
  filter?: (vehicle: VehicleDto) => boolean;
  /** Shown when none is available (default: no ambulance). */
  emptyLabel?: string;
  /** The toast once sent (default: sent for the transport). */
  sentLabel?: (callSign: string) => string;
  testId?: string;
}) {
  const t = useTranslations('medical.transport');
  const tc = useTranslations('common');
  const careerId = useCareerId();
  const { vehicles } = useSnapshot();
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const options = useQuery({
    queryKey: qk.dispatchOptions(careerId, incident.id),
    queryFn: () => gameApi.dispatchOptions(careerId, incident.id),
  });
  const send = useMutation({
    mutationFn: (vehicleId: string) => gameApi.dispatch(careerId, incident.id, [vehicleId]),
    onSuccess: (_result, vehicleId) => {
      const callSign = vehicles.find((v) => v.id === vehicleId)?.callSign ?? '';
      toast({
        tone: 'success',
        title: sentLabel ? sentLabel(callSign) : t('sent', { callSign }),
        durationMs: 3000,
      });
      track('dispatch_sent', { incidentId: incident.id, vehicles: 1 });
      void qc.invalidateQueries({ queryKey: qk.dispatchOptions(careerId, incident.id) });
    },
    onError: (e) => {
      toast({ tone: 'danger', title: errorMessage(e) });
      void options.refetch();
    },
  });
  if (options.isLoading) return <Skeleton className="h-10" />;
  const accepts = filter ?? ((vehicle: VehicleDto) => hasCapability(vehicle, capabilities));
  const candidates = (options.data?.options ?? [])
    .filter((o) => o.dispatchable)
    .flatMap((o) => {
      const vehicle = vehicles.find((v) => v.id === o.vehicleId);
      return vehicle && accepts(vehicle) ? [{ option: o, vehicle }] : [];
    })
    .slice(0, 3);
  if (candidates.length === 0) return <p className="text-muted text-xs">{emptyLabel ?? t('noAmbulance')}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {candidates.map(({ option, vehicle }) => (
        <li key={vehicle.id}>
          <Button
            variant="secondary"
            className="w-full justify-between"
            loading={send.isPending && send.variables === vehicle.id}
            disabled={send.isPending}
            onClick={() => send.mutate(vehicle.id)}
            data-testid={testId}
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <Send className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{t('send', { callSign: vehicle.callSign })}</span>
            </span>
            <span className="tabular text-muted text-xs">
              {tc('eta')} {formatClock(option.etaSeconds)}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Hospital choice for a patient awaiting transport. The recommended option is always one tap away (with its reasons);
 * the manual choice — feature `HOSPITAL_CHOICE` — opens inline on desktop and as a sheet on phones. `loadAndGo`: the same
 * choice for a patient nobody here can stabilise, taken to hospital as it is (D-101) — nothing leaves by itself then.
 */
export function TransportPanel({
  patient,
  incident,
  loadAndGo = false,
}: {
  patient: PatientDto;
  incident: IncidentDto;
  loadAndGo?: boolean;
}) {
  const t = useTranslations('medical.transport');
  const tc = useTranslations('common');
  const tht = useTranslations('coaching.marks.hospitalTransport');
  const careerId = useCareerId();
  const isDesktop = useIsDesktop();
  const { vehicles } = useSnapshot();
  const patchSnapshot = usePatchSnapshot();
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const choice = useHospitalChoice();
  const typeOf = useVehicleTypeLookup();
  const patients = usePatients(incident).data ?? [];

  const assigned = vehicles.filter((v) => v.incidentId === incident.id);
  // A field post (EMS_PMA, NO_TRANSPORT) treats on scene and never carries anybody.
  const carriers = assigned.filter(
    (v) =>
      v.status === 'ON_SCENE' &&
      hasCapability(v, [TRANSPORT_CAPABILITY]) &&
      !isFieldPostType(typeOf(v.typeCode)?.tags),
  );
  const incoming = assigned.find(
    (v) => (v.status === 'PREPARING' || v.status === 'EN_ROUTE') && hasCapability(v, [TRANSPORT_CAPABILITY]),
  );

  const options = useQuery({
    queryKey: qk.hospitalOptions(careerId, patient.id),
    queryFn: () => medicalApi.hospitalOptions(careerId, patient.id),
    enabled: carriers.length > 0,
  });
  const hospitals = useHospitals(carriers.length > 0).data ?? [];

  const [vehicleId, setVehicleId] = React.useState<string | null>(null);
  const carrier: VehicleDto | undefined = carriers.find((v) => v.id === vehicleId) ?? carriers[0];
  const [open, setOpen] = React.useState(false);
  const recommended = options.data?.find((o) => o.recommended) ?? options.data?.[0];
  const [picked, setPicked] = React.useState<string | null>(null);
  const pickedId = picked ?? recommended?.hospitalId ?? '';
  // Mass-casualty care: a multi-patient carrier (EMS_MAXI) boards other waiting patients of this incident on the same trip.
  const multi = !!carrier && isMultiPatient(typeOf(carrier.typeCode)?.tags);
  const [boarding, setBoarding] = React.useState<string[] | null>(null);
  const preselected = coPassengerCandidates(patient, patients, MULTI_PATIENT_CAPACITY).preselected;
  // Only people waiting at the meeting point can ride (water patients: nobody from the water).
  const withPatientIds = (boarding ?? preselected).filter((id) =>
    patients.some((p) => p.id === id && canBeTransported(p)),
  );

  const transport = useMutation({
    mutationFn: (hospitalId: string) =>
      medicalApi.transport(careerId, patient.id, {
        hospitalId,
        vehicleId: carrier?.id,
        // The list only when the player edited it: untouched, the server boards the same default pick — and leaves out
        // anyone this hospital cannot take instead of refusing the whole trip.
        ...(multi && boarding !== null ? { withPatientIds } : {}),
      }),
    onSuccess: (result, hospitalId) => {
      // The events follow; patching now keeps the map and the list in step with the tap.
      patchSnapshot((s) => ({
        ...s,
        vehicles: s.vehicles.map((v) => (v.id === result.vehicle.id ? result.vehicle : v)),
        incidents: s.incidents.map((i) =>
          result.incident && i.id === result.incident.id ? result.incident : i,
        ),
      }));
      const hospital = hospitals.find((h) => h.id === hospitalId);
      const aboard = 1 + (result.boarded?.length ?? 0);
      toast({
        tone: 'success',
        title:
          aboard > 1
            ? t('startedMulti', {
                callSign: result.vehicle.callSign,
                hospital: hospital?.name ?? '',
                count: aboard,
              })
            : t('started', { callSign: result.vehicle.callSign, hospital: hospital?.name ?? '' }),
        durationMs: 3500,
      });
      track('patient_transported', {
        patientId: patient.id,
        triage: patient.triage ?? undefined,
        hospitalId,
      });
      setOpen(false);
      void qc.invalidateQueries({ queryKey: qk.medicalRoot(careerId) });
    },
    onError: (e) => {
      toast({ tone: 'danger', title: errorMessage(e) });
      void qc.invalidateQueries({ queryKey: qk.medicalRoot(careerId) });
    },
  });

  if (carriers.length === 0) {
    return (
      <div
        className="border-warning/40 bg-warning/10 flex flex-col gap-2 rounded-md border p-3"
        data-testid="transport-missing-vehicle"
      >
        <p className="text-warning flex items-center gap-1.5 text-sm font-semibold">
          <Ambulance className="size-4 shrink-0" aria-hidden />
          {t('noVehicle')}
        </p>
        {incoming ? (
          <p className="text-muted text-xs">{t('vehicleEnRoute', { callSign: incoming.callSign })}</p>
        ) : (
          <>
            <p className="text-muted text-xs">{t('noVehicleHint')}</p>
            <SendVehicleList incident={incident} capabilities={[TRANSPORT_CAPABILITY]} />
          </>
        )}
      </div>
    );
  }

  if (options.isLoading || !recommended)
    return options.isError ? (
      <p className="text-danger text-xs">{t('loadError')}</p>
    ) : (
      <div aria-busy="true" aria-label={t('loading')}>
        <Skeleton className="h-24" />
      </div>
    );

  const all = options.data ?? [];
  const chooser = (
    <div className="flex flex-col gap-3">
      <OptionsRadioGroup options={all} hospitals={hospitals} value={pickedId} onChange={setPicked} />
      {isDesktop ? (
        <Button
          loading={transport.isPending}
          disabled={!pickedId}
          onClick={() => transport.mutate(pickedId)}
          data-testid="confirm-picked-hospital"
        >
          {t('confirm')}
        </Button>
      ) : null}
    </div>
  );

  return (
    <div
      className="border-border bg-surface-2 flex flex-col gap-3 rounded-md border p-3"
      data-testid="transport-panel"
      data-mode={loadAndGo ? 'load-and-go' : 'awaiting'}
    >
      <CoachMark
        id="hospitalTransport"
        when
        // The header, not the whole (tall) panel: spotlighting the full panel would let the coach mark's own card
        // cover the "choose another hospital" / confirm buttons further down, blocking the very thing it explains.
        selector='[data-testid="transport-panel"] h4'
        title={tht('title')}
        body={tht('body')}
      />
      <h4 className="text-subtle text-xs font-bold tracking-[0.08em] uppercase">
        {loadAndGo ? t('loadAndGoTitle') : t('title')}
      </h4>
      {loadAndGo ? <p className="text-muted text-xs leading-relaxed">{t('loadAndGoHint')}</p> : null}
      <OptionSummary option={recommended} hospital={hospitals.find((h) => h.id === recommended.hospitalId)} />
      <div className="flex flex-col gap-1">
        <span className="text-subtle text-xs font-semibold tracking-wide uppercase">{t('vehicle')}</span>
        {carriers.length > 1 ? (
          <Select
            label={t('vehicle')}
            value={carrier?.id}
            onValueChange={setVehicleId}
            options={carriers.map((v) => ({ value: v.id, label: v.callSign }))}
            className="h-11 w-full text-base lg:h-10 lg:text-sm"
          />
        ) : (
          <span className="text-sm font-semibold" data-testid="transport-carrier">
            {carrier?.callSign}
          </span>
        )}
      </div>
      {multi ? (
        <BoardingPicker
          patient={patient}
          patients={patients}
          capacity={MULTI_PATIENT_CAPACITY}
          value={withPatientIds}
          onChange={setBoarding}
        />
      ) : null}
      <Button
        size="lg"
        className="w-full"
        loading={transport.isPending && transport.variables === recommended.hospitalId}
        disabled={transport.isPending}
        onClick={() => transport.mutate(recommended.hospitalId)}
        data-testid="confirm-recommended-hospital"
      >
        <Ambulance className="size-5 shrink-0" aria-hidden />
        <span className="truncate">
          {multi && withPatientIds.length > 0
            ? t('confirmRecommendedMulti', {
                hospital: hospitals.find((h) => h.id === recommended.hospitalId)?.name ?? '',
                count: withPatientIds.length + 1,
              })
            : t('confirmRecommended', {
                hospital: hospitals.find((h) => h.id === recommended.hospitalId)?.name ?? '',
              })}
        </span>
      </Button>
      {choice.unlocked ? (
        all.length > 1 ? (
          <Button
            variant="outline"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            data-testid="choose-other-hospital"
          >
            {open && isDesktop ? (
              <ChevronUp className="size-4" aria-hidden />
            ) : (
              <ChevronDown className="size-4" aria-hidden />
            )}
            {open && isDesktop ? t('hideOptions') : t('chooseOther')}
          </Button>
        ) : null
      ) : (
        <p className="text-muted flex items-start gap-1.5 text-xs" data-testid="hospital-choice-locked">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t('lockedChoice', { level: choice.requiredLevel })}
        </p>
      )}
      {choice.unlocked && open && isDesktop ? chooser : null}
      {choice.unlocked && !isDesktop ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            title={t('chooseTitle')}
            description={t('chooseDescription')}
            closeLabel={tc('close')}
          >
            {chooser}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                <X className="size-4" aria-hidden />
                {tc('cancel')}
              </Button>
              <Button
                loading={transport.isPending}
                disabled={!pickedId}
                onClick={() => transport.mutate(pickedId)}
                data-testid="confirm-picked-hospital"
              >
                {t('confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      {loadAndGo ? null : <p className="text-subtle text-xs">{t('autoHint')}</p>}
    </div>
  );
}
