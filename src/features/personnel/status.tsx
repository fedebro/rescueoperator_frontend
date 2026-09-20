'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowLeftRight,
  Ban,
  BedDouble,
  CheckCircle2,
  CircleDashed,
  GraduationCap,
  HeartPulse,
  Link2,
  LogOut,
  Siren,
  Sparkles,
  Star,
  User,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import type { PersonnelDto } from '@/contracts';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { TeamStatus } from './queries';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
const TONE: Record<Tone, string> = {
  neutral: 'text-muted border-border-strong bg-surface-3',
  info: 'text-info border-info/40 bg-info/10',
  success: 'text-success border-success/40 bg-success/10',
  warning: 'text-warning border-warning/40 bg-warning/10',
  danger: 'text-danger border-danger/40 bg-danger/10',
};

/** Same grammar as the design-system StatusChip (icon + label, colour only reinforces) for the personnel statuses. */
function Chip({
  icon: Icon,
  tone,
  label,
  status,
  className,
}: {
  icon: LucideIcon;
  tone: Tone;
  label: string;
  status: string;
  className?: string;
}) {
  return (
    <span
      data-status={status}
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-semibold whitespace-nowrap',
        TONE[tone],
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}

const PERSONNEL_VISUALS: Record<PersonnelDto['status'], { icon: LucideIcon; tone: Tone }> = {
  ONBOARDING: { icon: UserPlus, tone: 'info' },
  AVAILABLE: { icon: CheckCircle2, tone: 'success' },
  ASSIGNED: { icon: Link2, tone: 'success' },
  ON_MISSION: { icon: Siren, tone: 'warning' },
  RESTING: { icon: BedDouble, tone: 'info' },
  TRAINING: { icon: GraduationCap, tone: 'info' },
  INJURED: { icon: HeartPulse, tone: 'danger' },
  TRANSFERRING: { icon: ArrowLeftRight, tone: 'neutral' },
  UNAVAILABLE: { icon: Ban, tone: 'neutral' },
  RETIRED: { icon: LogOut, tone: 'neutral' },
};
export function PersonnelStatusChip({
  status,
  className,
}: {
  status: PersonnelDto['status'];
  className?: string;
}) {
  const t = useTranslations('status.personnel');
  return <Chip {...PERSONNEL_VISUALS[status]} status={status} label={t(status)} className={className} />;
}

const TEAM_VISUALS: Record<TeamStatus, { icon: LucideIcon; tone: Tone }> = {
  READY: { icon: CheckCircle2, tone: 'success' },
  PARTIAL: { icon: CircleDashed, tone: 'warning' },
  ON_MISSION: { icon: Siren, tone: 'warning' },
  RESTING: { icon: BedDouble, tone: 'info' },
  UNAVAILABLE: { icon: Ban, tone: 'danger' },
};
export function TeamStatusChip({ status }: { status: TeamStatus }) {
  const t = useTranslations('status.team');
  return <Chip {...TEAM_VISUALS[status]} status={status} label={t(status)} />;
}

export function PotentialBadge({ potential }: { potential: 'STANDARD' | 'PROMISING' | 'EXCEPTIONAL' }) {
  const t = useTranslations('personnel.potential');
  const Icon = potential === 'EXCEPTIONAL' ? Sparkles : potential === 'PROMISING' ? Star : User;
  return (
    <Badge
      tone={potential === 'EXCEPTIONAL' ? 'xp' : potential === 'PROMISING' ? 'info' : 'neutral'}
      data-potential={potential}
    >
      <Icon className="size-3" aria-hidden />
      {t(potential)}
    </Badge>
  );
}
