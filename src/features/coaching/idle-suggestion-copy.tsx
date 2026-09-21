'use client';
import { useTranslations } from 'next-intl';
import { useCatalogName } from '@/i18n/use-i18n-text';
import type { IdleSuggestion } from './idle-suggestion';

export interface IdleSuggestionCopy {
  text: string;
  href: string;
  label: string;
}

/** Resolves an {@link IdleSuggestion} into the sentence + next-action link an `EmptyState` should show. */
export function useIdleSuggestionCopy(suggestion: IdleSuggestion | null): IdleSuggestionCopy | null {
  const t = useTranslations('coaching.idle');
  const name = useCatalogName();
  if (!suggestion) return null;
  switch (suggestion.kind) {
    case 'BROKEN_VEHICLE':
      return {
        text: t('brokenVehicle', { callSign: suggestion.callSign }),
        href: '/game/logistics',
        label: t('brokenVehicleAction'),
      };
    case 'LOW_STOCK':
      return {
        text: t('lowStock', { item: name('item', suggestion.itemCode) }),
        href: '/game/logistics',
        label: t('lowStockAction'),
      };
    case 'EXPIRING_CANDIDATE':
      return {
        text: t('expiringCandidate', { role: name('role', suggestion.roleCode) }),
        href: '/game/personnel?tab=recruitment',
        label: t('expiringCandidateAction'),
      };
    case 'AFFORDABLE_UPGRADE':
      return {
        text: t('affordableUpgrade', { vehicle: name('vehicle', suggestion.vehicleTypeCode) }),
        href: '/game/shop',
        label: t('affordableUpgradeAction'),
      };
    case 'UNCOVERED_FAMILY':
      return {
        text: t('uncoveredFamily', {
          family: name('family', suggestion.family),
          level: suggestion.requiredLevel,
        }),
        href: '/game/progression',
        label: t('uncoveredFamilyAction'),
      };
    default:
      return null;
  }
}
