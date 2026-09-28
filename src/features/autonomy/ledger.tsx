'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Fuel, Siren } from 'lucide-react';
import type { LedgerEntryDto } from '@/lib/api/types';
import { useI18nText } from '@/i18n/use-i18n-text';
import { cn } from '@/lib/utils';
import { majorLedgerDetail } from '@/features/major/major';
import { fuelLedgerDetail } from './autonomy';

/**
 * Description of a ledger row. The fuel-station premium (entry `FUEL`, D-22 phase 2) also says which vehicle and how many
 * km it refilled — the only fuel the player ever pays for (refuelling at base is free, the rest is in `costPerKm`). The
 * bonus of a major incident (entry `MAJOR_INCIDENT`, D-24) says which one and how it ended.
 */
export function LedgerDescription({ entry, className }: { entry: LedgerEntryDto; className?: string }) {
  const t = useTranslations('autonomy');
  const tx = useI18nText();
  const fuel = fuelLedgerDetail(entry);
  const major = majorLedgerDetail(entry);
  const text = tx(entry.description);
  const detail = fuel
    ? t('ledgerDetail', { callSign: fuel.callSign, km: fuel.km })
    : major
      ? [
          major.scenarioCode ? tx({ key: `major.scenario.${major.scenarioCode}.title` }) : null,
          major.outcome ? tx({ key: `major.outcome.${major.outcome}` }) : null,
        ]
          .filter(Boolean)
          .join(' · ') || null
      : null;
  return (
    <span
      className={cn('flex min-w-0 items-center gap-1.5', className)}
      data-testid="ledger-description"
      data-entry-type={entry.entryType}
      title={detail ? `${text} · ${detail}` : text}
    >
      {fuel ? <Fuel className="text-muted size-3.5 shrink-0" aria-hidden /> : null}
      {major ? <Siren className="text-major size-3.5 shrink-0" aria-hidden /> : null}
      <span className="min-w-0 truncate">
        {text}
        {detail ? <span className="text-subtle"> · {detail}</span> : null}
      </span>
    </span>
  );
}
