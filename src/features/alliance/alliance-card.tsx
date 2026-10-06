'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronRight, Users } from 'lucide-react';
import type { AllianceCardDto, AllianceJoinPolicy } from '@/contracts';
import { LOCALE_NAMES } from '@/i18n/config';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { TimeAgo } from '@/components/ui/time-ago';
import { Emblem } from './emblem';

export function PolicyBadge({ policy }: { policy: AllianceJoinPolicy }) {
  const t = useTranslations('alliance.policy');
  return (
    <Badge
      tone={policy === 'OPEN' ? 'success' : policy === 'REQUEST' ? 'info' : 'neutral'}
      data-testid="alliance-policy"
    >
      {t(policy)}
    </Badge>
  );
}

/** One alliance in a list (the search, the invites received): emblem, name, tag, level, seats, language, policy. */
export function AllianceCardRow({
  alliance,
  onOpen,
  trailing,
  className,
}: {
  alliance: AllianceCardDto;
  onOpen?: () => void;
  trailing?: React.ReactNode;
  className?: string;
}) {
  const t = useTranslations('alliance.find');
  const Comp = onOpen ? 'button' : 'div';
  return (
    <li
      className={cn('border-border bg-surface-2 flex items-center gap-3 rounded-md border p-3', className)}
      data-testid="alliance-card"
    >
      <Comp
        type={onOpen ? 'button' : undefined}
        onClick={onOpen}
        className={cn('flex min-w-0 flex-1 items-center gap-3 text-left', onOpen && 'hover:text-fg')}
        aria-label={onOpen ? `${alliance.name} [${alliance.tag}]` : undefined}
      >
        <Emblem emblem={alliance.emblem} frame={alliance.frame} size={44} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-semibold">{alliance.name}</span>
            <span className="tabular text-muted text-xs">[{alliance.tag}]</span>
          </span>
          <span className="text-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span>{t('level', { level: alliance.level })}</span>
            <span className="inline-flex items-center gap-1">
              <Users className="size-3" aria-hidden />
              {t('members', { count: alliance.members, slots: alliance.memberSlots })}
            </span>
            <span>{LOCALE_NAMES[alliance.language]}</span>
            <PolicyBadge policy={alliance.joinPolicy} />
          </span>
        </span>
        {onOpen ? <ChevronRight className="text-subtle size-4 shrink-0" aria-hidden /> : null}
      </Comp>
      {trailing}
    </li>
  );
}

export type JoinIntent = { kind: 'join'; allianceId: string } | { kind: 'request'; allianceId: string };

/** The card of an alliance with "Entra" / "Chiedi di entrare" — or the reason the viewer cannot (study 02 §5). */
export function AllianceDetailDialog({
  alliance,
  open,
  onOpenChange,
  onJoin,
  onWithdraw,
  pending,
}: {
  alliance: AllianceCardDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJoin: (intent: JoinIntent) => void;
  onWithdraw?: (requestId: string) => void;
  pending?: boolean;
}) {
  const t = useTranslations('alliance');
  const tc = useTranslations('common');
  const locale = useLocale();
  if (!alliance) return null;
  const viewer = alliance.viewer;
  const blocked = viewer?.blockedReason ?? null;
  const canJoin = viewer?.canJoin === true;
  const cta = alliance.joinPolicy === 'REQUEST' ? t('find.request') : t('find.join');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={
          <span className="flex items-center gap-3">
            <Emblem emblem={alliance.emblem} frame={alliance.frame} size={40} />
            <span className="min-w-0">
              <span className="block truncate">{alliance.name}</span>
              <span className="tabular text-muted block text-xs font-normal">[{alliance.tag}]</span>
            </span>
          </span>
        }
        closeLabel={tc('close')}
        aria-describedby={undefined}
      >
        <div className="flex flex-col gap-3 px-4 pb-2 text-sm" data-testid="alliance-detail">
          <div className="text-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span>{t('find.level', { level: alliance.level })}</span>
            <span>{t('find.members', { count: alliance.members, slots: alliance.memberSlots })}</span>
            <span>{LOCALE_NAMES[alliance.language]}</span>
            <PolicyBadge policy={alliance.joinPolicy} />
            {alliance.status !== 'ACTIVE' ? (
              <Badge tone="warning">{t(`status.${alliance.status}`)}</Badge>
            ) : null}
          </div>
          <p className="text-muted text-xs">{t(`policyHint.${alliance.joinPolicy}`)}</p>
          <p className={cn(!alliance.description && 'text-subtle italic')}>
            {alliance.description || t('card.noDescription')}
          </p>
          <p className="text-subtle text-xs">
            {alliance.minLevel !== null
              ? t('card.minLevel', { level: alliance.minLevel })
              : t('card.noMinLevel')}{' '}
            · {t('card.created', { date: formatDateTime(alliance.createdAt, locale) })}
            {alliance.lastActivityAt ? (
              <>
                {' · '}
                {t('find.lastActivity')} <TimeAgo at={alliance.lastActivityAt} />
              </>
            ) : null}
          </p>
          {blocked && blocked !== 'REQUEST_PENDING' ? (
            <p className="text-warning text-xs font-semibold" data-testid="alliance-join-blocked">
              {t(`find.blocked.${blocked}`, { level: alliance.minLevel ?? 0 })}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tc('close')}
          </Button>
          {blocked === 'REQUEST_PENDING' && viewer?.pendingRequestId && onWithdraw ? (
            <Button
              variant="outline"
              onClick={() => onWithdraw(viewer.pendingRequestId!)}
              loading={pending}
              data-testid="alliance-withdraw"
            >
              {t('find.withdraw')}
            </Button>
          ) : (
            <Button
              onClick={() =>
                onJoin({
                  kind: alliance.joinPolicy === 'REQUEST' ? 'request' : 'join',
                  allianceId: alliance.id,
                })
              }
              disabled={!canJoin}
              loading={pending}
              data-testid="alliance-join"
            >
              {cta}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
