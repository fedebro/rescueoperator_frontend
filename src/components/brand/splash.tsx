import { Logo } from './logo';

export function BrandSplash() {
  return (
    <div
      className="h-dvh-safe bg-bg grid place-items-center"
      role="status"
      aria-busy="true"
      data-testid="splash"
    >
      <div className="flex flex-col items-center gap-5">
        <Logo variant="stacked" className="w-56" priority />
        <span aria-hidden className="bg-surface-3 h-1 w-32 overflow-hidden rounded-full">
          <span className="bg-brand block h-full w-1/2 animate-pulse rounded-full" />
        </span>
      </div>
    </div>
  );
}
