'use client';
import { useTranslations } from 'next-intl';
import { Handshake, HeartHandshake, Megaphone, MessageSquare, Trophy } from 'lucide-react';
import { EmptyState } from '@/components/ui/misc';

export type AlliancePart = 'board' | 'chat' | 'aid' | 'ranking' | 'objectives' | 'operations';

const ICON = {
  board: Megaphone,
  chat: MessageSquare,
  aid: HeartHandshake,
  ranking: Trophy,
  objectives: Trophy,
  operations: Handshake,
};

/**
 * A part of the alliance that is switched off on the server (flag `alliance_<part>` false — study 10 §3: everything ships
 * behind flags, texts switched on after the legal validation). Sober, no promise of a date.
 */
export function FeatureOff({ part }: { part: AlliancePart }) {
  const t = useTranslations('alliance.featureOff');
  const Icon = ICON[part];
  return (
    <div data-testid={`alliance-off-${part}`}>
      <EmptyState
        icon={<Icon className="size-6" aria-hidden />}
        title={t(`${part}.title`)}
        description={t(`${part}.body`)}
        className="py-14"
      />
    </div>
  );
}
