'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/error-message';
import { toast } from '@/stores/toast';
import { NAUTICAL_SITES_HREF } from '@/features/water/water';

/** A player-facing refusal: what went wrong, and where to go to fix it (a Base nautica to buy, a pier to lengthen…). */
export interface FixIt {
  code: string;
  reason: string | null;
  message: string;
  fix: { label: string; href: string } | null;
}

/** Where the refused command was aimed: the facility (its page has the upgrades) and the service family. */
export interface FixContext {
  facilityId?: string;
  family?: string;
}

type Details = { reason?: string; domain?: string; upgrade?: string; used?: number; total?: number } | null;
const detailsOf = (error: unknown): Details =>
  isApiError(error) && error.details && typeof error.details === 'object' ? (error.details as Details) : null;

/**
 * Maps the refusals of the shop, the transfers and the facility purchases to a clear sentence with a fix-it link
 * (studio 05 §2.7: never the generic "not enough room"):
 *  - `NEEDS_NAUTICAL_BASE` → "Acquista una Base nautica" (the nautical sites of the facilities page);
 *  - `NAUTICAL_SITE_REQUIRED` → the nautical sites;
 *  - `CAPACITY_EXCEEDED` by `details.reason`: `NO_ROOM` (+ the upgrade that adds room: PIER / GARAGE / HELIPAD) → the
 *    facility page, `INCOMPATIBLE_FACILITY` → a new facility of the family, `FACILITY_NOT_OPERATIONAL` → the facility;
 *  - anything else: the usual `errors.<CODE>` sentence, no link.
 */
export function useFixIt(): (error: unknown, context?: FixContext) => FixIt {
  const t = useTranslations('nautical');
  const errorMessage = useErrorMessage();
  return React.useCallback(
    (error, context = {}) => {
      const code = isApiError(error) ? error.code : 'UNKNOWN';
      const details = detailsOf(error);
      const reason = details?.reason ?? null;
      const facilityHref = context.facilityId
        ? `/game/facilities?id=${context.facilityId}`
        : '/game/facilities';
      const base = { code, reason };
      if (code === 'NEEDS_NAUTICAL_BASE')
        return {
          ...base,
          message: t('errors.NEEDS_NAUTICAL_BASE'),
          fix: { label: t('fix.buyBase'), href: NAUTICAL_SITES_HREF },
        };
      if (code === 'NAUTICAL_SITE_REQUIRED')
        return {
          ...base,
          message: t('errors.NAUTICAL_SITE_REQUIRED'),
          fix: { label: t('fix.showNauticalSites'), href: NAUTICAL_SITES_HREF },
        };
      if (code === 'CAPACITY_EXCEEDED' && reason === 'NO_ROOM') {
        const upgrade = details?.upgrade ?? (details?.domain === 'WATER' ? 'PIER' : 'GARAGE');
        const counts = { used: details?.used ?? 0, total: details?.total ?? 0 };
        return {
          ...base,
          message:
            upgrade === 'PIER'
              ? t('errors.NO_ROOM_WATER', counts)
              : t('errors.NO_ROOM', {
                  ...counts,
                  upgrade: t(`upgrade.${upgrade === 'HELIPAD' ? 'HELIPAD' : 'GARAGE'}`),
                }),
          fix: {
            label: t(`fix.${upgrade === 'PIER' ? 'pier' : upgrade === 'HELIPAD' ? 'helipad' : 'garage'}`),
            href: facilityHref,
          },
        };
      }
      if (code === 'CAPACITY_EXCEEDED' && reason === 'INCOMPATIBLE_FACILITY')
        return {
          ...base,
          message: t('errors.INCOMPATIBLE_FACILITY'),
          fix: {
            label: t('fix.newFacility'),
            href: context.family ? `/game/facilities?new=${context.family}` : '/game/facilities',
          },
        };
      if (code === 'CAPACITY_EXCEEDED' && reason === 'FACILITY_NOT_OPERATIONAL')
        return {
          ...base,
          message: t('errors.FACILITY_NOT_OPERATIONAL'),
          fix: { label: t('fix.facility'), href: facilityHref },
        };
      return { ...base, message: errorMessage(error), fix: null };
    },
    [t, errorMessage],
  );
}

/** Shows a refusal as a danger toast whose action goes where the fix is. Returns the mapped refusal. */
export function useFixItToast(): (error: unknown, context?: FixContext) => FixIt {
  const fixIt = useFixIt();
  const router = useRouter();
  const t = useTranslations('nautical');
  return React.useCallback(
    (error, context) => {
      const mapped = fixIt(error, context);
      toast({
        tone: 'danger',
        title: mapped.fix ? t('fix.title') : mapped.message,
        description: mapped.fix ? mapped.message : undefined,
        action: mapped.fix
          ? { label: mapped.fix.label, onClick: () => router.push(mapped.fix!.href) }
          : undefined,
        durationMs: mapped.fix ? 8000 : undefined,
      });
      return mapped;
    },
    [fixIt, router, t],
  );
}
