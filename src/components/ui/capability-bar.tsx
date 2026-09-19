import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CapabilityBarProps {
  label: string;
  icon?: React.ReactNode;
  required: number;
  onScene: number;
  enRoute: number;
  /** Extra value a pending manual selection would add (dispatch panel preview). */
  planned?: number;
  levelLabel: string;
  level: 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';
  legend: { onScene: string; enRoute: string; planned: string; required: string };
}

/**
 * Required vs on-scene vs en-route. Solid = on scene, hatched = en route, outlined = planned;
 * the required threshold is a tick mark, so the three states differ by pattern, not just by colour.
 */
export function CapabilityBar({
  label,
  icon,
  required,
  onScene,
  enRoute,
  planned = 0,
  levelLabel,
  level,
  legend,
}: CapabilityBarProps) {
  const scale = Math.max(required, onScene + enRoute + planned, 1) * 1.08;
  const pct = (v: number) => `${(Math.max(0, v) / scale) * 100}%`;
  const covered = onScene >= required;
  const willCover = onScene + enRoute + planned >= required;
  return (
    <div className="flex flex-col gap-1" data-covered={covered} data-testid="capability-bar">
      <div className="flex items-center gap-2 text-xs">
        {icon ? (
          <span aria-hidden className="text-muted">
            {icon}
          </span>
        ) : null}
        <span className="text-fg min-w-0 flex-1 truncate font-semibold">{label}</span>
        <span
          className={cn(
            'rounded-sm px-1 text-[10px] font-bold tracking-wide uppercase',
            level === 'REQUIRED'
              ? 'bg-brand-soft text-brand-hover'
              : level === 'RECOMMENDED'
                ? 'bg-warning/15 text-warning'
                : 'bg-surface-3 text-subtle',
          )}
        >
          {levelLabel}
        </span>
        <span
          className={cn(
            'tabular inline-flex items-center gap-0.5',
            covered ? 'text-success' : willCover ? 'text-warning' : 'text-muted',
          )}
        >
          {covered ? <Check className="size-3" aria-hidden /> : null}
          {onScene}
          {enRoute + planned > 0 ? <span className="text-subtle">+{enRoute + planned}</span> : null}
          <span className="text-subtle">/{required}</span>
        </span>
      </div>
      <div
        role="img"
        aria-label={`${label}: ${legend.onScene} ${onScene}, ${legend.enRoute} ${enRoute}, ${legend.planned} ${planned}, ${legend.required} ${required}`}
        className="bg-surface-3 relative h-2.5 overflow-hidden rounded-full"
      >
        <div className="bg-success absolute inset-y-0 left-0" style={{ width: pct(onScene) }} />
        <div
          className="absolute inset-y-0"
          style={{
            left: pct(onScene),
            width: pct(enRoute),
            backgroundImage:
              'repeating-linear-gradient(135deg, var(--rc-warning) 0 4px, transparent 4px 7px)',
            backgroundColor: 'rgb(245 182 60 / 0.25)',
          }}
        />
        <div
          className="border-info bg-info/20 absolute inset-y-0 border border-dashed"
          style={{
            left: pct(onScene + enRoute),
            width: pct(planned),
            display: planned > 0 ? undefined : 'none',
          }}
        />
        <div aria-hidden className="bg-fg absolute inset-y-0 w-0.5" style={{ left: pct(required) }} />
      </div>
    </div>
  );
}
