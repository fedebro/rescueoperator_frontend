'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { HeartHandshake, MapPin, Truck } from 'lucide-react';
import type { AidGapDto, AidRequestDto } from '@/contracts';
import { aidApi } from '@/lib/api/alliance';
import { formatDistance } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useLocale } from 'next-intl';
import { useCatalogName, useI18nText } from '@/i18n/use-i18n-text';
import { GameIcon, catalogIconName } from '@/design/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { SeverityBadge } from '@/components/ui/severity-badge';
import { TimeAgo } from '@/components/ui/time-ago';
import { useAllianceMutation } from './hooks';

/** "Soccorso avanzato 80 · Estricazione 40" — the gaps still missing (05 §2.2). */
export function GapList({ gaps, className }: { gaps: AidGapDto[]; className?: string }) {
  const name = useCatalogName();
  const t = useTranslations('alliance.aid');
  const open = gaps.filter((g) => g.missing > 0);
  if (open.length === 0)
    return <span className={cn('text-success text-xs font-semibold', className)}>{t('gapCovered')}</span>;
  return (
    <span className={cn('flex flex-wrap gap-x-2 gap-y-0.5 text-xs', className)} data-testid="aid-gaps">
      {open.map((g) => (
        <span
          key={g.capability}
          className={g.level === 'REQUIRED' ? 'text-danger font-semibold' : 'text-warning'}
        >
          {name('capability', g.capability)} <span className="tabular">{g.missing}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * An aid request as the alliance sees it (05 §3.1): who, what, where, what is missing, time left; "Invia una colonna" when
 * the viewer can help, the reason when not; for the requester, the request's own state and "Ritira".
 */
export function AidRequestCard({
  request,
  compact,
  onSend,
  onOpenRequest,
  onOpenIncident,
  className,
}: {
  request: AidRequestDto;
  compact?: boolean;
  onSend?: () => void;
  onOpenRequest?: () => void;
  /** The requester's own incident (opens the inspector). */
  onOpenIncident?: () => void;
  className?: string;
}) {
  const t = useTranslations('alliance.aid');
  const tx = useI18nText();
  const locale = useLocale();
  const cancel = useAllianceMutation((careerId, id: string) => aidApi.cancel(careerId, id), {
    successToast: t('cancelled'),
  });
  const columns = request.columns.filter((c) => c.status === 'EN_ROUTE' || c.status === 'ON_SCENE');
  const open = request.status === 'OPEN';
  return (
    <div
      className={cn(
        'border-border bg-surface-2 flex flex-col gap-2 rounded-md border p-3',
        !open && 'opacity-80',
        className,
      )}
      data-testid="aid-request"
      data-request-id={request.id}
      data-status={request.status}
      data-mine={request.mine}
    >
      <div className="flex items-start gap-2.5">
        <span className="bg-surface-3 grid size-9 shrink-0 place-items-center rounded-md">
          <GameIcon name={catalogIconName(request.incident.icon)} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            <HeartHandshake className="text-brand size-4 shrink-0" aria-hidden />
            <span className="font-semibold">
              {request.mine ? t('mineTitle') : t('title', { name: request.requester.directorName ?? '' })}
            </span>
            {request.incident.major ? <Badge tone="warning">{t('majorBadge')}</Badge> : null}
            {!open ? <Badge tone="neutral">{t(`status.${request.status}`)}</Badge> : null}
          </p>
          <p className="text-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span className="text-fg truncate">{tx(request.incident.title)}</span>
            <SeverityBadge severity={request.incident.severity} label={t('severity')} size="sm" />
            {request.incident.municipality ? (
              <span className="inline-flex items-center gap-0.5">
                <MapPin className="size-3" aria-hidden />
                {request.incident.municipality}
              </span>
            ) : null}
            {request.distanceKm !== null ? (
              <span className="tabular">
                {t('distance', { distance: formatDistance(request.distanceKm * 1000, locale) })}
              </span>
            ) : null}
          </p>
        </div>
        {open && request.expiresAt ? (
          <Countdown
            to={request.expiresAt}
            urgentBelowSeconds={120}
            className="text-muted shrink-0 text-xs"
            doneLabel="…"
          />
        ) : (
          <TimeAgo at={request.createdAt} className="text-subtle shrink-0 text-xs" />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-subtle text-xs">{t('missing')}</span>
        <GapList gaps={request.gaps} />
      </div>
      {columns.length > 0 ? (
        <p className="text-info flex items-center gap-1 text-xs" data-testid="aid-columns-summary">
          <Truck className="size-3.5" aria-hidden />
          {t('columnsInFlight', {
            count: columns.length,
            names: columns.map((c) => c.helper.directorName ?? '').join(', '),
          })}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {onOpenRequest && compact ? (
          <Button size="sm" variant="ghost" onClick={onOpenRequest}>
            {t('openInTab')}
          </Button>
        ) : null}
        {request.mine ? (
          <>
            {onOpenIncident ? (
              <Button size="sm" variant="secondary" onClick={onOpenIncident} data-testid="aid-open-incident">
                {t('openIncident')}
              </Button>
            ) : null}
            {open ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => cancel.mutate(request.id)}
                loading={cancel.isPending}
                data-testid="aid-cancel"
              >
                {t('withdraw')}
              </Button>
            ) : null}
          </>
        ) : request.viewer.canSend && onSend ? (
          <Button size="sm" onClick={onSend} data-testid="aid-send">
            <Truck className="size-4" aria-hidden />
            {t('sendColumn')}
          </Button>
        ) : request.viewer.blockedReason && open ? (
          <span
            className="text-subtle text-xs"
            data-testid="aid-blocked"
            data-reason={request.viewer.blockedReason}
          >
            {t(`blocked.${request.viewer.blockedReason}`)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
