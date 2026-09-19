import { cn } from '@/lib/utils';

const SRC = {
  horizontal: '/brand/logo-horizontal.svg',
  stacked: '/brand/logo-stacked.svg',
  icon: '/brand/logo-icon.svg',
  mono: '/brand/logo-horizontal-mono.svg',
} as const;
const RATIO = { horizontal: [505, 128], stacked: [600, 470], icon: [512, 512], mono: [505, 128] } as const;

/** Brand logo (SVG re-drawn from logo.png by scripts/generate-assets.ts). */
export function Logo({
  variant = 'horizontal',
  className,
  priority,
}: {
  variant?: keyof typeof SRC;
  className?: string;
  priority?: boolean;
}) {
  const [w, h] = RATIO[variant];
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static SVG, no optimisation needed
    <img
      src={SRC[variant]}
      alt="Rescue Control"
      width={w}
      height={h}
      decoding="async"
      fetchPriority={priority ? 'high' : undefined}
      className={cn('h-auto select-none', className)}
      draggable={false}
    />
  );
}
