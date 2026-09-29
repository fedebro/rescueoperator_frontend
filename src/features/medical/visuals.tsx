import * as React from 'react';
import {
  Activity,
  Ambulance,
  Ban,
  CircleCheck,
  CircleDashed,
  ClipboardList,
  HandHeart,
  Hospital,
  Hourglass,
  LifeBuoy,
  Minus,
  OctagonAlert,
  ShieldCheck,
  Stethoscope,
  Timer,
  TriangleAlert,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { z } from 'zod';
import type { HospitalLoad, PatientDto } from '@/contracts';
import { cn } from '@/lib/utils';

export type TriageCode = NonNullable<PatientDto['triage']>;
export type PatientStatus = PatientDto['status'];
export type HospitalLoadCode = z.infer<typeof HospitalLoad>;

type Visual = { icon: LucideIcon; className: string };
const TONE = {
  neutral: 'text-muted border-border-strong bg-surface-3',
  info: 'text-info border-info/40 bg-info/10',
  success: 'text-success border-success/40 bg-success/10',
  warning: 'text-warning border-warning/40 bg-warning/10',
  danger: 'text-danger border-danger/40 bg-danger/10',
} as const;

/** Triage codes: a distinct SHAPE per code, the colour only reinforces it (the label comes from the catalog bundle). */
export const TRIAGE_VISUALS: Record<TriageCode, Visual> = {
  RED: { icon: OctagonAlert, className: TONE.danger },
  ORANGE: {
    icon: TriangleAlert,
    className: 'text-[var(--rc-sev-6)] border-[var(--rc-sev-6)]/40 bg-[var(--rc-sev-6)]/10',
  },
  BLUE: { icon: Timer, className: TONE.info },
  GREEN: { icon: CircleCheck, className: TONE.success },
  WHITE: { icon: Minus, className: 'text-fg border-border-strong bg-surface-3' },
};

export const PATIENT_STATUS_VISUALS: Record<PatientStatus, Visual> = {
  UNASSESSED: { icon: CircleDashed, className: TONE.neutral },
  ASSESSED: { icon: ClipboardList, className: TONE.info },
  TREATING: { icon: Stethoscope, className: TONE.info },
  STABILIZED: { icon: ShieldCheck, className: TONE.success },
  AWAITING_TRANSPORT: { icon: Hourglass, className: TONE.warning },
  IN_TRANSPORT: { icon: Ambulance, className: TONE.info },
  HANDOFF: { icon: Users, className: TONE.info },
  ADMITTED: { icon: Hospital, className: TONE.success },
  RELEASED_ON_SCENE: { icon: UserCheck, className: TONE.success },
  DECEASED: { icon: HandHeart, className: TONE.neutral },
};

/** Water patients: somebody still in the water (a lifebuoy — never a cross). */
export const WATER_VISUAL: Visual = { icon: LifeBuoy, className: TONE.info };

export const LOAD_VISUALS: Record<HospitalLoadCode, Visual> = {
  NORMAL: { icon: CircleCheck, className: TONE.success },
  BUSY: { icon: Activity, className: TONE.warning },
  SATURATED: { icon: TriangleAlert, className: TONE.danger },
  CLOSED: { icon: Ban, className: TONE.neutral },
};

/** Pill with icon + label, same geometry as the design-system StatusChip (whose icon table is closed). */
export function MedicalChip({
  visual,
  label,
  className,
  ...props
}: { visual: Visual; label: string } & React.HTMLAttributes<HTMLSpanElement>) {
  const Icon = visual.icon;
  return (
    <span
      {...props}
      className={cn(
        'inline-flex h-6 max-w-full shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-semibold',
        visual.className,
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
}

/* ───────────── stability (anchored value, animated on the client) ───────────── */

export type StabilityBand = 'stable' | 'watch' | 'unstable' | 'critical';
/** Thresholds of the catalog patient profiles (watch < 70, unstable < 45, critical < 20): identical for every profile. */
export function stabilityBand(value: number): StabilityBand {
  return value < 20 ? 'critical' : value < 45 ? 'unstable' : value < 70 ? 'watch' : 'stable';
}
export function stabilityNow(
  anchor: { value: number; ratePerSecond: number; anchorAt: string },
  nowMs: number,
): number {
  const elapsed = Math.max(0, (nowMs - Date.parse(anchor.anchorAt)) / 1000);
  return Math.min(100, Math.max(0, anchor.value + anchor.ratePerSecond * elapsed));
}
export type StabilityTrend = 'improving' | 'worsening' | 'steady';
export function stabilityTrend(ratePerSecond: number, value: number): StabilityTrend {
  if (ratePerSecond > 1e-6 && value < 100) return 'improving';
  if (ratePerSecond < -1e-6 && value > 0) return 'worsening';
  return 'steady';
}
