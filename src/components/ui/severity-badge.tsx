import { cn } from '@/lib/utils';
import { clamp } from '@/lib/utils';

export const severityColor = (severity: number): string =>
  `var(--rc-sev-${clamp(Math.round(severity), 1, 10)})`;

/**
 * Severity 1–10. Never colour alone: the number is always printed and a 4-step bar gives a shape cue
 * (so it survives colour blindness and grayscale screenshots).
 */
export function SeverityBadge({
  severity,
  label,
  escalating,
  size = 'md',
  className,
}: {
  severity: number;
  label: string;
  escalating?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const s = clamp(Math.round(severity), 1, 10);
  const bars = Math.ceil(s / 2.5);
  return (
    <span
      role="img"
      aria-label={`${label} ${s}/10`}
      data-severity={s}
      className={cn(
        'tabular inline-flex shrink-0 items-center gap-1 rounded-sm border font-bold',
        size === 'sm' ? 'h-5 px-1 text-xs' : size === 'lg' ? 'h-8 px-2 text-base' : 'h-6 px-1.5 text-xs',
        className,
      )}
      style={{
        color: severityColor(s),
        borderColor: `color-mix(in srgb, ${severityColor(s)} 55%, transparent)`,
        background: `color-mix(in srgb, ${severityColor(s)} 14%, transparent)`,
      }}
    >
      <span aria-hidden className="flex items-end gap-px">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="w-[3px] rounded-[1px]"
            style={{ height: 3 + i * 2, background: 'currentColor', opacity: i <= bars ? 1 : 0.22 }}
          />
        ))}
      </span>
      <span aria-hidden>{s}</span>
      {escalating ? (
        <span aria-hidden className="text-xs">
          ▲
        </span>
      ) : null}
    </span>
  );
}
