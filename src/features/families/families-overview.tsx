'use client';
import { useTranslations } from 'next-intl';
import { Ban, CheckCircle2, Lock } from 'lucide-react';
import type { ServiceFamily } from '@/contracts';
import { cn } from '@/lib/utils';
import { useI18nText } from '@/i18n/use-i18n-text';
import { FamilyBadge } from '@/design/icons';
import { Skeleton } from '@/components/ui/misc';
import { useFamilies } from './use-families';

/**
 * The five service families at a glance — and the family filter of the shop. Locked families stay selectable (the
 * player can window-shop) and say WHEN they open; WILDFIRE / ALPINE explain that their level depends on the territory.
 */
export function FamiliesOverview({
  value,
  onChange,
}: {
  value: ServiceFamily;
  onChange: (family: ServiceFamily) => void;
}) {
  const t = useTranslations('families.overview');
  const tx = useI18nText();
  const families = useFamilies();
  if (families.length === 0) return <Skeleton className="h-[72px]" />;
  return (
    <div
      role="group"
      aria-label={t('title')}
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:grid lg:grid-cols-5 lg:overflow-visible"
      data-testid="families-overview"
    >
      {families.map((f) => (
        <button
          key={f.code}
          type="button"
          aria-pressed={value === f.code}
          onClick={() => onChange(f.code)}
          data-testid="family-card"
          data-family={f.code}
          data-unlocked={f.unlocked}
          className={cn(
            'bg-surface-2 hover:bg-surface-3 flex w-44 shrink-0 items-center gap-2.5 rounded-md border p-2.5 text-left transition-colors lg:w-auto',
            value === f.code ? 'border-focus' : 'border-border',
          )}
        >
          <FamilyBadge family={f.code} size={36} className={f.unlocked ? '' : 'opacity-50 grayscale'} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{tx(f.name)}</span>
            <span
              className={cn(
                'mt-0.5 flex items-start gap-1 text-[11px] leading-tight',
                f.unlocked ? 'text-success' : 'text-muted',
              )}
            >
              {f.unlocked ? (
                <CheckCircle2 className="mt-px size-3 shrink-0" aria-hidden />
              ) : !f.availableInTerritory ? (
                <Ban className="mt-px size-3 shrink-0" aria-hidden />
              ) : (
                <Lock className="mt-px size-3 shrink-0" aria-hidden />
              )}
              <span>
                {f.unlocked
                  ? t('unlocked')
                  : !f.availableInTerritory
                    ? t('notInTerritory')
                    : f.territoryDependent
                      ? t('lockedAtTerritory', { level: f.requiredLevel })
                      : t('lockedAt', { level: f.requiredLevel })}
              </span>
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
