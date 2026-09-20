'use client';
import { useTranslations } from 'next-intl';
import { LifeBuoy } from 'lucide-react';
import type { IncidentDto } from '@/contracts';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { FamilyBadge } from '@/design/icons';

/**
 * Family badges of an incident. Families still locked for the career are marked as "external support"
 * (lifebuoy overlay + accessible name), never by colour alone.
 */
export function IncidentFamilies({ incident, size = 22 }: { incident: IncidentDto; size?: number }) {
  const t = useTranslations('families.external');
  const name = useCatalogName();
  const external = new Set(incident.externalFamilies ?? []);
  return (
    <span className="inline-flex items-center gap-1" data-testid="incident-families">
      {incident.families
        .filter((f) => f !== 'UNG')
        .map((f) => {
          const label = external.has(f) ? t('familyTitle', { family: name('family', f) }) : name('family', f);
          return (
            <span
              key={f}
              className="relative inline-flex"
              data-family={f}
              data-external={external.has(f) || undefined}
            >
              <FamilyBadge
                family={f}
                size={size}
                title={label}
                className={external.has(f) ? 'opacity-60' : ''}
              />
              {external.has(f) ? (
                <LifeBuoy
                  aria-hidden
                  className="bg-surface-1 text-fg absolute -right-1 -bottom-1 rounded-full p-px"
                  style={{ width: Math.round(size * 0.55), height: Math.round(size * 0.55) }}
                />
              ) : null}
            </span>
          );
        })}
    </span>
  );
}
