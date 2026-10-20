'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Ambulance, Check, Hospital, Stethoscope, X } from 'lucide-react';
import type { IncidentDto, PatientDto } from '@/contracts';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { useCareerIdOptional, useSnapshot } from '@/features/game/hooks';
import { markCoachSeen, useCoachingEnabled, useCoachSeen } from '@/features/coaching/store';
import { canBeTransported } from './hooks';

/**
 * «Guida breve al primo incontro» (study 2026-10-20 §3.3): the first call with a patient once the 118 is unlocked (level 3)
 * explains the three things of a patient, one at a time and only when they happen — assessment, care, hospital. One line,
 * next to the patients it talks about; it moves on by itself with the real states and is gone for good after the first
 * patient leaves for (or is released before) the hospital, or when dismissed. Silent when hints are off in Settings.
 */
export type PatientGuideStep = 'SEND' | 'ASSESS' | 'TREAT' | 'HOSPITAL' | 'DONE';

export const PATIENT_GUIDE_KEY = 'guide:patients';
const STEP_NUMBER: Record<PatientGuideStep, number> = { SEND: 1, ASSESS: 1, TREAT: 2, HOSPITAL: 3, DONE: 3 };

export function patientGuideStep(
  patients: Pick<PatientDto, 'status' | 'triage' | 'location'>[],
  medicalAssigned: boolean,
): PatientGuideStep | null {
  if (patients.length === 0) return medicalAssigned ? 'ASSESS' : 'SEND';
  if (patients.some((p) => canBeTransported(p as PatientDto))) return 'HOSPITAL';
  if (patients.some((p) => ['IN_TRANSPORT', 'HANDOFF', 'ADMITTED', 'RELEASED_ON_SCENE'].includes(p.status)))
    return 'DONE';
  if (patients.some((p) => p.triage && ['ASSESSED', 'TREATING', 'STABILIZED'].includes(p.status)))
    return 'TREAT';
  if (patients.every((p) => p.status === 'UNASSESSED')) return medicalAssigned ? 'ASSESS' : 'SEND';
  return null;
}

const ICON: Record<PatientGuideStep, React.ComponentType<{ className?: string }>> = {
  SEND: Ambulance,
  ASSESS: Stethoscope,
  TREAT: Stethoscope,
  HOSPITAL: Hospital,
  DONE: Check,
};

export function PatientGuide({
  incident,
  patients,
  medicalAssigned,
}: {
  incident: IncidentDto;
  patients: PatientDto[];
  medicalAssigned: boolean;
}) {
  const t = useTranslations('firstShift.patientGuide');
  const careerId = useCareerIdOptional() ?? '_no_career';
  const { career } = useSnapshot();
  const enabled = useCoachingEnabled();
  const seen = useCoachSeen(careerId, PATIENT_GUIDE_KEY);
  // Once started on this call, the guide finishes here even after it is marked seen (the DONE line stays readable).
  const [ownedBy, setOwnedBy] = React.useState<string | null>(null);
  const step = patientGuideStep(patients, medicalAssigned);
  const eligible = enabled && career.unlockedFamilies.includes('EMS') && incident.patientCount > 0;
  const active = eligible && step !== null && (!seen || ownedBy === incident.id);

  // The first eligible call claims the guide (adjusted during render, no effect).
  if (eligible && !seen && !ownedBy) setOwnedBy(incident.id);
  React.useEffect(() => {
    if (ownedBy === incident.id) track('coach_mark_shown', { id: 'patientGuide' });
  }, [ownedBy, incident.id]);
  React.useEffect(() => {
    if (step === 'DONE' && ownedBy === incident.id) markCoachSeen(careerId, PATIENT_GUIDE_KEY);
  }, [step, ownedBy, incident.id, careerId]);

  if (!active || !step) return null;
  const Icon = ICON[step];
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-start gap-2.5 rounded-md border px-3 py-2',
        step === 'DONE' ? 'border-success/40 bg-success/10' : 'border-info/40 bg-info/10',
      )}
      data-testid="patient-guide"
      data-step={step}
    >
      <Icon
        className={cn('mt-0.5 size-4 shrink-0', step === 'DONE' ? 'text-success' : 'text-info')}
        aria-hidden
      />
      <p className="min-w-0 flex-1 text-sm">
        <span className="text-subtle mr-1.5 text-xs font-bold tracking-wider uppercase">
          {t('progress', { current: STEP_NUMBER[step], total: 3 })}
        </span>
        {t(step)}
      </p>
      <button
        type="button"
        onClick={() => {
          markCoachSeen(careerId, PATIENT_GUIDE_KEY);
          setOwnedBy(null);
          track('coach_mark_dismissed', { id: 'patientGuide' });
        }}
        className="text-subtle hover:text-fg -m-1.5 grid size-8 shrink-0 place-items-center rounded-full"
        aria-label={t('dismiss')}
        data-testid="patient-guide-dismiss"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
