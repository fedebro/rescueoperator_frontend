'use client';
import * as React from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronRight, Siren } from 'lucide-react';
import { useI18nText } from '@/i18n/use-i18n-text';
import { useSnapshot } from '@/features/game/hooks';
import { useOpenMajor } from './hooks';

/**
 * A running major, one tap away from any page (06 §2.6): a 44 px strip under the top bar on every screen but the map — where
 * the pinned queue block (and the event area) already say it. Phase and the sectors still waiting for vehicles.
 */
export function MajorStrip() {
  const t = useTranslations('maxi.strip');
  const tx = useI18nText();
  const pathname = usePathname();
  const { incidents } = useSnapshot();
  const openMajor = useOpenMajor();
  const members = incidents.filter((i) => i.major);
  if (pathname === '/game' || members.length === 0) return null;
  const ref = (members.find((i) => i.major?.role === 'MAIN') ?? members[0]!).major!;
  const pending = members.filter((i) => i.major?.id === ref.id && i.status === 'PENDING_RESPONSE').length;
  return (
    <button
      type="button"
      onClick={() => openMajor(ref.id, ref.center)}
      className="bg-major/15 border-major/50 text-fg flex min-h-11 w-full shrink-0 items-center gap-2 border-b px-3 text-left text-sm"
      data-testid="major-strip"
      data-major-id={ref.id}
      aria-label={t('aria', { title: tx(ref.title) })}
    >
      <Siren className="text-major size-4 shrink-0" aria-hidden />
      <span className="text-major shrink-0 text-xs font-extrabold tracking-wide uppercase">
        {tx({ key: 'major.common.title' })}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-semibold">{tx({ key: `major.phase.${ref.phase}.name` })}</span>
        {pending > 0 ? <span className="text-danger"> · {t('pending', { count: pending })}</span> : null}
      </span>
      <span className="text-major flex shrink-0 items-center gap-0.5 text-xs font-bold">
        {/* Narrow phones: the chevron alone (the whole strip is the button, its name says where it goes) — the room
            goes to the phase and the sectors still waiting. */}
        <span className="hidden min-[480px]:inline">{t('open')}</span>
        <ChevronRight className="size-4" aria-hidden />
      </span>
    </button>
  );
}
