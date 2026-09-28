'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { VehicleDto } from '@/contracts';
import { track } from '@/lib/analytics';
import { toast } from '@/stores/toast';
import { hasCoachSeen, markCoachSeen, useCoachingEnabled } from '@/features/coaching/store';
import { isAutonomyTracked, returnedWithoutStop } from './autonomy';

/** "Seen" keys of the two one-off coaching lines (per career, features/coaching/store.ts). */
export const AUTONOMY_COACH_KEYS = {
  noStop: 'mark:autonomyNoStop',
  firstReserve: 'mark:autonomyFirstReserve',
  firstBingo: 'mark:autonomyFirstBingo',
} as const;

/**
 * The contextual coaching lines of D-22 (study §3.4): the first time a vehicle comes home without stopping to resupply
 * ("Aveva ancora autonomia: è subito pronto"), the first time one goes into reserve, and (flight endurance) the first time an
 * aircraft turns back at "bingo". Each fires once per career, as a short info toast (a line, never a blocking card), and
 * never when "Suggerimenti attivi" is off.
 */
export function useAutonomyCoaching(careerId: string) {
  const t = useTranslations('autonomy.coaching');
  const enabled = useCoachingEnabled();
  return React.useMemo(() => {
    const once = (key: string, title: string, description: string) => {
      if (!enabled || hasCoachSeen(careerId, key)) return;
      markCoachSeen(careerId, key);
      track('coach_mark_shown', { code: key.replace('mark:', '') });
      toast({ tone: 'info', title, description, durationMs: 7000 });
    };
    return {
      onReturned(vehicle: VehicleDto) {
        if (!returnedWithoutStop(vehicle)) return;
        once(AUTONOMY_COACH_KEYS.noStop, t('noStopTitle'), t('noStopBody', { callSign: vehicle.callSign }));
      },
      onReserve(vehicle: VehicleDto) {
        if (!isAutonomyTracked(vehicle.autonomy)) return;
        once(
          AUTONOMY_COACH_KEYS.firstReserve,
          t('firstReserveTitle'),
          t('firstReserveBody', { callSign: vehicle.callSign }),
        );
      },
      /** Flight endurance (phase 3): the first time an aircraft turns back at "bingo", how the rotation works. */
      onBingo(vehicle: VehicleDto) {
        once(
          AUTONOMY_COACH_KEYS.firstBingo,
          t('firstBingoTitle'),
          t('firstBingoBody', { callSign: vehicle.callSign }),
        );
      },
    };
  }, [careerId, enabled, t]);
}
