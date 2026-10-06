'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Ban, UserPlus } from 'lucide-react';
import type { DirectorCardDto } from '@/contracts';
import { allianceApi, moderationApi } from '@/lib/api/alliance';
import { qk } from '@/lib/api/query-keys';
import { formatDateTime } from '@/lib/format';
import { FamilyBadge } from '@/design/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Skeleton, Stat } from '@/components/ui/misc';
import { Emblem } from './emblem';
import { useAllianceMutation, useBlocks, useDirectorCard } from './hooks';
import { PresenceDot } from './members-tab';

/**
 * The Director card (study 02 §6): name, level, municipality of the control centre, services, alliance and role, member
 * since, aid given / received, medals; presence only for allies who allow it. Never fleet, facilities, credits or positions.
 * Actions: invite (when possible), block / unblock (04 §2.3).
 */
export function DirectorCardDialog({
  careerId,
  onOpenChange,
  canInviteFrom,
}: {
  careerId: string | null;
  onOpenChange: (open: boolean) => void;
  /** The viewer may create direct invites (his alliance allows it). */
  canInviteFrom?: boolean;
}) {
  const t = useTranslations('alliance.director');
  const tr = useTranslations('alliance.role');
  const tc = useTranslations('common');
  const locale = useLocale();
  const card = useDirectorCard(careerId);
  const blocks = useBlocks();
  const myBlock = blocks.data?.find((b) => b.careerId === careerId) ?? null;
  const invite = useAllianceMutation(
    (me, target: string) => allianceApi.createInvite(me, { targetCareerId: target }),
    {
      successToast: t('inviteSent'),
      invalidate: (me) => [qk.allianceInvites(me), qk.directorCard(careerId ?? '')],
    },
  );
  const block = useAllianceMutation((me, target: string) => moderationApi.block(me, { careerId: target }), {
    successToast: t('blockedToast'),
    invalidate: (me) => [qk.blocks(me), qk.directorCard(careerId ?? ''), qk.allianceMembers(me)],
  });
  const unblock = useAllianceMutation((me, blockId: string) => moderationApi.unblock(me, blockId), {
    successToast: t('unblockedToast'),
    invalidate: (me) => [qk.blocks(me), qk.directorCard(careerId ?? ''), qk.allianceMembers(me)],
  });
  const d: DirectorCardDto | undefined = card.data;
  return (
    <Dialog open={careerId !== null} onOpenChange={onOpenChange}>
      <DialogContent
        title={d?.directorName ?? t('title')}
        closeLabel={tc('close')}
        aria-describedby={undefined}
      >
        <div className="flex flex-col gap-4 px-4 pb-2" data-testid="director-card">
          {!d ? (
            <Skeleton className="h-40" />
          ) : (
            <>
              <div className="flex items-center gap-3">
                {d.alliance ? <Emblem emblem={d.alliance.emblem} size={44} /> : null}
                <div className="min-w-0 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    {d.alliance ? (
                      <>
                        <span className="font-semibold">{d.alliance.name}</span>
                        <span className="tabular text-muted text-xs">[{d.alliance.tag}]</span>
                        <Badge tone="neutral">{tr(d.alliance.role)}</Badge>
                      </>
                    ) : (
                      <span className="text-muted">{t('noAlliance')}</span>
                    )}
                    {d.isMe ? <Badge tone="info">{t('you')}</Badge> : null}
                    {d.blocked ? <Badge tone="danger">{t('blocked')}</Badge> : null}
                  </p>
                  {d.presence ? <PresenceDot presence={d.presence} /> : null}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat label={t('level')} value={<span className="tabular">{d.level}</span>} />
                <Stat
                  label={t('location')}
                  value={<span className="font-sans text-sm">{d.locationName}</span>}
                />
                <Stat
                  label={t('services')}
                  value={
                    <span className="inline-flex gap-1">
                      {d.families.length === 0 ? (
                        <span className="text-subtle">—</span>
                      ) : (
                        d.families.map((f) => <FamilyBadge key={f} family={f} size={20} />)
                      )}
                    </span>
                  }
                />
                <Stat
                  label={t('memberSince')}
                  value={
                    <span className="font-sans text-sm">
                      {d.memberSince ? formatDateTime(d.memberSince, locale) : '—'}
                    </span>
                  }
                />
                <Stat
                  label={t('aid')}
                  value={
                    <span className="tabular">
                      {d.aid.given} / {d.aid.received}
                    </span>
                  }
                />
                <Stat
                  label={t('medals')}
                  value={
                    <span className="tabular">
                      {d.medals.gold} · {d.medals.silver} · {d.medals.bronze}
                    </span>
                  }
                />
              </div>
              {d.lastSeen ? (
                <p className="text-subtle text-xs">
                  {t('lastSeen', { when: t(`lastSeenValue.${d.lastSeen}`) })}
                </p>
              ) : null}
              <p className="text-subtle text-xs">{t('privacyNote')}</p>
            </>
          )}
        </div>
        {d && !d.isMe ? (
          <DialogFooter>
            {myBlock ? (
              <Button
                variant="outline"
                onClick={() => unblock.mutate(myBlock.id)}
                loading={unblock.isPending}
                data-testid="director-unblock"
              >
                {t('unblock')}
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => block.mutate(d.careerId)}
                loading={block.isPending}
                data-testid="director-block"
              >
                <Ban className="size-4" aria-hidden />
                {t('block')}
              </Button>
            )}
            {canInviteFrom && d.canInvite ? (
              <Button
                onClick={() => invite.mutate(d.careerId)}
                loading={invite.isPending}
                data-testid="director-invite"
              >
                <UserPlus className="size-4" aria-hidden />
                {t('invite')}
              </Button>
            ) : null}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
