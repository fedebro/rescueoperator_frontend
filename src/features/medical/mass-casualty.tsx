'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { BusFront, Tent } from 'lucide-react';
import type { IncidentDto, PatientDto, VehicleDto } from '@/contracts';
import { cn } from '@/lib/utils';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { Checkbox } from '@/components/ui/switch';
import { useSnapshot, useVehicleTypeLookup } from '@/features/game/hooks';
import { canBeTransported } from './hooks';
import { MedicalChip, TRIAGE_VISUALS } from './visuals';

/**
 * Mass-casualty care (major incidents, analisi/note-agenti/major-incidents.md §1): the maxi-emergency ambulance (EMS_MAXI,
 * tag `MULTI_PATIENT`, `patientCapacity` 4) carries several patients of the same incident to ONE hospital in one trip; the
 * advanced medical post (EMS_PMA, tag `NO_TRANSPORT`) treats 4 at once on scene, 25 % faster, and releases the GREEN / WHITE /
 * BLUE patients there. The capacity is not in the catalog DTO: 4 is the catalog's value for every MULTI_PATIENT type.
 */
export const MULTI_PATIENT_CAPACITY = 4;
export const FIELD_POST_RELEASE = ['GREEN', 'WHITE', 'BLUE'] as const;

export const isMultiPatient = (tags: readonly string[] | undefined): boolean =>
  !!tags?.includes('MULTI_PATIENT');
export const isFieldPostType = (tags: readonly string[] | undefined): boolean =>
  !!tags?.includes('NO_TRANSPORT');

const TRIAGE_RANK: Record<string, number> = { RED: 0, ORANGE: 1, BLUE: 2, GREEN: 3, WHITE: 4 };

/**
 * Who else can ride with a patient: the other patients of the incident waiting for transport at the meeting point (never
 * somebody still in the water), worst triage first — and the default pick (what the server boards when the list is omitted):
 * the first `capacity − 1` of them.
 */
export function coPassengerCandidates(
  patient: Pick<PatientDto, 'id'>,
  patients: readonly PatientDto[],
  capacity: number,
): { candidates: PatientDto[]; preselected: string[] } {
  const candidates = patients
    .filter((p) => p.id !== patient.id && canBeTransported(p))
    .sort(
      (a, b) =>
        (TRIAGE_RANK[a.triage ?? ''] ?? 9) - (TRIAGE_RANK[b.triage ?? ''] ?? 9) ||
        a.label.localeCompare(b.label),
    );
  return { candidates, preselected: candidates.slice(0, Math.max(0, capacity - 1)).map((p) => p.id) };
}

/** A field post (EMS_PMA) of THIS incident is working on scene. */
export function useFieldPostOnScene(incident: Pick<IncidentDto, 'id'>): VehicleDto | null {
  const { vehicles } = useSnapshot();
  const typeOf = useVehicleTypeLookup();
  return (
    vehicles.find(
      (v) =>
        v.incidentId === incident.id && v.status === 'ON_SCENE' && isFieldPostType(typeOf(v.typeCode)?.tags),
    ) ?? null
  );
}

/** In the patients section: the field post is there, and what it changes. */
export function FieldPostBanner({ incident }: { incident: IncidentDto }) {
  const t = useTranslations('medical.massCasualty');
  const post = useFieldPostOnScene(incident);
  if (!post) return null;
  return (
    <div
      className="border-info/40 bg-info/10 flex items-start gap-2 rounded-md border p-3 text-xs"
      data-testid="field-post-banner"
      role="note"
    >
      <Tent className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-fg text-sm font-semibold">{t('fieldPostTitle', { callSign: post.callSign })}</p>
        <p className="text-muted leading-relaxed">{t('fieldPostBody')}</p>
      </div>
    </div>
  );
}

/** A dispatch option of a mass-casualty vehicle says what it is for. */
export function DispatchPatientCapacityNote({
  tags,
  className,
}: {
  tags: readonly string[] | undefined;
  className?: string;
}) {
  const t = useTranslations('medical.massCasualty');
  if (isMultiPatient(tags))
    return (
      <p
        className={cn('text-info flex items-start gap-1 text-xs', className)}
        data-testid="dispatch-multi-patient"
      >
        <BusFront className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t('multiPatientNote', { count: MULTI_PATIENT_CAPACITY })}
      </p>
    );
  if (isFieldPostType(tags))
    return (
      <p
        className={cn('text-info flex items-start gap-1 text-xs', className)}
        data-testid="dispatch-field-post"
      >
        <Tent className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t('fieldPostNote')}
      </p>
    );
  return null;
}

/**
 * The boarding list of a multi-patient vehicle: the other patients waiting, ticked by default up to its capacity (the same
 * pick the server would make), each one a 44 px row. Controlled: the transport panel sends the ticked ids.
 */
export function BoardingPicker({
  patient,
  patients,
  capacity,
  value,
  onChange,
}: {
  patient: PatientDto;
  patients: readonly PatientDto[];
  capacity: number;
  value: readonly string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useTranslations('medical.massCasualty');
  const tm = useTranslations('medical');
  const name = useCatalogName();
  const { candidates } = coPassengerCandidates(patient, patients, capacity);
  const full = value.length >= capacity - 1;
  const id = React.useId();
  if (candidates.length === 0)
    return (
      <p className="text-subtle text-xs" data-testid="boarding-none">
        {t('boardingNone', { count: capacity })}
      </p>
    );
  return (
    <fieldset className="flex flex-col gap-1.5" data-testid="boarding-picker" data-selected={value.length}>
      <legend className="text-subtle mb-1 text-xs font-semibold tracking-wide uppercase">
        {t('boardingTitle', { count: capacity })}
      </legend>
      {candidates.map((p) => {
        const checked = value.includes(p.id);
        const index = patients.findIndex((x) => x.id === p.id);
        const boxId = `${id}-${p.id}`;
        return (
          <label
            key={p.id}
            htmlFor={boxId}
            className={cn(
              'border-border bg-surface-1 flex min-h-11 items-center gap-2.5 rounded-md border px-2.5 py-1.5',
              !checked && full ? 'cursor-default opacity-60' : 'cursor-pointer',
            )}
            data-testid="boarding-patient"
            data-patient-id={p.id}
          >
            <Checkbox
              id={boxId}
              checked={checked}
              disabled={!checked && full}
              onCheckedChange={() =>
                onChange(checked ? value.filter((x) => x !== p.id) : [...value, p.id].slice(0, capacity - 1))
              }
            />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {tm('patients.label', { n: index + 1 })}
            </span>
            {p.triage ? (
              <MedicalChip visual={TRIAGE_VISUALS[p.triage]} label={name('triage', p.triage)} />
            ) : null}
          </label>
        );
      })}
      <p className="text-subtle text-xs">{t('boardingHint', { count: value.length + 1, capacity })}</p>
    </fieldset>
  );
}
