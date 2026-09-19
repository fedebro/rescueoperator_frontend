'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { gameApi } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/query-keys';
import { formatDateTime } from '@/lib/format';
import { useI18nText } from '@/i18n/use-i18n-text';
import { Button } from '@/components/ui/button';
import { CreditAmount } from '@/components/ui/credit-amount';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Stat } from '@/components/ui/misc';
import { useCareerId } from './hooks';

/** "While you were away": fetched once per session entry; the server returns null when there is nothing to tell. */
export function AwayReportDialog() {
  const careerId = useCareerId();
  const t = useTranslations('game.away');
  const tc = useTranslations('common');
  const tx = useI18nText();
  const locale = useLocale();
  const [dismissed, setDismissedState] = React.useState(false);
  const setDismissed = (value: boolean) => {
    setDismissedState(value);
    if (value) void gameApi.ackAwayReport(careerId).catch(() => undefined);
  };
  const report = useQuery({
    queryKey: qk.awayReport(careerId),
    queryFn: () => gameApi.awayReport(careerId),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  }).data;
  if (!report || dismissed) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) setDismissed(true);
      }}
    >
      <DialogContent
        title={t('title')}
        description={t('since', { date: formatDateTime(report.since, locale) })}
        closeLabel={tc('close')}
        data-testid="away-report"
      >
        <div className="grid grid-cols-2 gap-4">
          <Stat label={t('resolved')} value={report.incidentsResolved} />
          <Stat label={t('failed')} value={report.incidentsFailed} />
          <Stat
            label={t('credits')}
            value={<CreditAmount value={report.creditsEarned} sign label={tc('credits')} />}
          />
          <Stat
            label={t('stipend')}
            value={<CreditAmount value={report.stipendPaid} sign label={tc('credits')} />}
          />
          <Stat label={t('xp')} value={<span className="text-xp">+{report.xpEarned}</span>} />
        </div>
        {report.events.length > 0 ? (
          <ul className="text-muted mt-4 flex flex-col gap-1 text-sm">
            {report.events.map((e, i) => (
              <li key={i}>• {tx(e)}</li>
            ))}
          </ul>
        ) : null}
        <DialogFooter>
          <Button size="lg" onClick={() => setDismissed(true)}>
            {t('continue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
