'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { useSnapshot } from '@/features/game/hooks';
import { IconButton } from '@/components/ui/button';
import { AidRequestCard } from './aid-request-card';
import { ColumnComposer } from './column-composer';
import { useAidRequests } from './hooks';
import { allianceOf } from './snapshot';

/** Requests dismissed on this device in this session: the card does not come back for them. */
const dismissed = new Set<string>();

/**
 * The aid request I can cover, as a card over the map (study 09 §1): urgencies do not wait for the section. One card at a
 * time, the newest; "Invia una colonna" opens the composer. Never over "Nuova emergenza": it sits at the top.
 */
export function AidMapCard() {
  const t = useTranslations('alliance.aid');
  const snapshot = useSnapshot();
  const alliance = allianceOf(snapshot);
  const enabled = alliance !== null && snapshot.featureFlags.alliance_aid === true;
  const open = useAidRequests('OPEN', enabled);
  const [compose, setCompose] = React.useState<string | null>(null);
  const [, bump] = React.useReducer((x: number) => x + 1, 0);
  if (!enabled) return null;
  const request = (open.data?.pages.flatMap((p) => p.data) ?? []).find(
    (r) => r.status === 'OPEN' && !r.mine && r.viewer.canSend && !dismissed.has(r.id),
  );
  if (!request) return null;
  return (
    <div
      className="pointer-events-auto absolute inset-x-2 top-2 z-30 mx-auto max-w-md lg:inset-x-auto lg:right-4 lg:left-auto lg:w-96"
      data-testid="aid-map-card"
    >
      <div className="relative">
        <AidRequestCard
          request={request}
          compact
          onSend={() => setCompose(request.id)}
          className="shadow-panel border-brand/40 pr-9"
        />
        <IconButton
          size="sm"
          label={t('dismiss')}
          className="absolute top-1 right-1 size-7 min-h-0"
          onClick={() => {
            dismissed.add(request.id);
            bump();
          }}
          data-testid="aid-map-dismiss"
        >
          <X className="size-3.5" aria-hidden />
        </IconButton>
      </div>
      <ColumnComposer
        requestId={compose}
        onOpenChange={(o) => !o && setCompose(null)}
        onSent={() => {
          dismissed.add(request.id);
          bump();
        }}
      />
    </div>
  );
}
