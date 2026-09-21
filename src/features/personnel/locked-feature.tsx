'use client';
import { useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { Card, ProgressBar } from '@/components/ui/misc';
import { useSnapshot } from '@/features/game/hooks';

/** A level-gated feature is SHOWN locked with its level (and how far the player is), never hidden. */
export function LockedFeature({
  feature,
  requiredLevel,
  description,
}: {
  feature: 'TEAMS' | 'DEPARTMENTS' | 'TRAINING';
  requiredLevel: number;
  description: string;
}) {
  const t = useTranslations('personnel.locked');
  const tc = useTranslations('common');
  const name = useCatalogName();
  const { career } = useSnapshot();
  return (
    <Card className="flex items-start gap-3" data-testid={`locked-${feature}`}>
      <span
        className="bg-surface-3 text-subtle grid size-10 shrink-0 place-items-center rounded-full"
        title={tc('locked')}
      >
        <Lock className="size-5" aria-label={tc('locked')} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {name('feature', feature)} · {tc('requiresLevel', { level: requiredLevel })}
        </p>
        <p className="text-muted mt-0.5 text-sm">{description}</p>
        <ProgressBar
          value={career.level / requiredLevel}
          label={t('progress', { level: career.level, required: requiredLevel })}
          tone="xp"
          className="mt-3 max-w-xs"
        />
        <p className="text-subtle mt-1 text-xs">
          {t('progress', { level: career.level, required: requiredLevel })}
        </p>
      </div>
    </Card>
  );
}
