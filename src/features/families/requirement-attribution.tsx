'use client';
import { useTranslations } from 'next-intl';
import { LifeBuoy, ShieldCheck } from 'lucide-react';
import type { IncidentDto, ServiceFamily } from '@/contracts';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { FamilyBadge, GameIcon, capabilityIconName } from '@/design/icons';
import { Badge } from '@/components/ui/badge';

/** "Who takes care of what": the needs of the incident grouped by the responsible family, external ones marked. */
export function RequirementAttribution({ incident }: { incident: IncidentDto }) {
  const t = useTranslations('families.attribution');
  const tl = useTranslations('game.requirements.level');
  const name = useCatalogName();
  const groups = new Map<ServiceFamily | 'NONE', IncidentDto['requirements']>();
  for (const r of incident.requirements) {
    const key = r.family ?? 'NONE';
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  if (groups.size === 0) return null;
  return (
    <ul className="flex flex-col gap-2" data-testid="requirement-attribution">
      {[...groups.entries()].map(([family, requirements]) => {
        const external = requirements.some((r) => r.external);
        return (
          <li
            key={family}
            className="border-border bg-surface-2 rounded-md border p-3"
            data-family={family}
            data-external={external || undefined}
          >
            <div className="flex items-center gap-2">
              {family === 'NONE' ? null : <FamilyBadge family={family} size={22} />}
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {family === 'NONE' ? t('anyFamily') : name('family', family)}
              </span>
              {external ? (
                <Badge tone="info" data-testid="external-badge">
                  <LifeBuoy className="size-3" aria-hidden />
                  {t('external')}
                </Badge>
              ) : (
                <Badge tone="success">
                  <ShieldCheck className="size-3" aria-hidden />
                  {t('yours')}
                </Badge>
              )}
            </div>
            <ul className="mt-2 flex flex-col gap-1">
              {requirements.map((r) => (
                <li key={r.capability} className="text-muted flex items-center gap-2 text-xs">
                  <GameIcon name={capabilityIconName(r.capability)} size={14} />
                  <span className="min-w-0 flex-1 truncate">{name('capability', r.capability)}</span>
                  <span className="text-subtle">{tl(r.level)}</span>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
