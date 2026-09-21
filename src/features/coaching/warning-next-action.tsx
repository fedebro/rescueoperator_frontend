'use client';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Every blocking-reason renderer in the game (`game.dispatch.warning` in `dispatch-panel.tsx`,
 * `personnel.teams.warning` in `teams-tab.tsx`, and the crew block of `personnel/slots.tsx`, which already carries
 * its own `fix.<code>` link) explains a warning code with plain text. This adds the other half of Master Plan
 * requirement §3: a concrete "what should I do about it" next action for the codes that have an obvious one — a
 * screen to go to, not just a diagnosis. Codes with no sensible destination (e.g. `ROUTING_DEGRADED`, informational
 * team warnings with no dedicated fix screen) resolve to `null` and render nothing extra.
 */
const NEXT_ACTION: Record<
  string,
  { href: string; messageKey: 'hire' | 'train' | 'rest' | 'order' | 'repair' }
> = {
  MISSING_ROLE: { href: '/game/personnel?tab=recruitment', messageKey: 'hire' },
  CREW_ROLE_MISSING: { href: '/game/personnel?tab=recruitment', messageKey: 'hire' },
  MISSING_QUALIFICATION: { href: '/game/personnel?tab=training', messageKey: 'train' },
  FATIGUED_MEMBERS: { href: '/game/personnel?tab=roster', messageKey: 'rest' },
  CREW_FATIGUED: { href: '/game/personnel?tab=roster', messageKey: 'rest' },
  STOCK_LOW: { href: '/game/logistics', messageKey: 'order' },
  STOCK_MISSING: { href: '/game/logistics', messageKey: 'order' },
  VEHICLE_INOPERABLE: { href: '/game/logistics', messageKey: 'repair' },
};

/** `code` may carry a parameter after a colon (`STOCK_LOW:FIRE_FOAM`) — only the prefix is looked up. */
export function warningNextAction(
  code: string,
): { href: string; messageKey: 'hire' | 'train' | 'rest' | 'order' | 'repair' } | null {
  return NEXT_ACTION[code.split(':')[0] ?? code] ?? null;
}

/** Small inline "go fix it" link appended after a warning's explanation, when a concrete next action exists. */
export function WarningNextAction({ code, className }: { code: string; className?: string }) {
  const t = useTranslations('coaching.warningNextAction');
  const action = warningNextAction(code);
  if (!action) return null;
  return (
    <Link
      href={action.href}
      className={className ?? 'text-skyline inline-flex items-center gap-1 font-semibold hover:underline'}
      data-testid="warning-next-action"
      data-code={code}
    >
      {t(action.messageKey)}
      <ArrowRight className="size-3" aria-hidden />
    </Link>
  );
}
