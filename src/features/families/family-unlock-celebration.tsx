'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Building2, Siren, Truck } from 'lucide-react';
import type { ServiceFamily } from '@/contracts';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { useSettingsStore } from '@/stores/settings';
import { FamilyBadge } from '@/design/icons';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { useCareerId, useCatalog, useSnapshot } from '@/features/game/hooks';
import { TERRITORY_FAMILIES } from './use-families';

const storageKey = (careerId: string) => `rc-families-seen:${careerId}`;

/** The "already celebrated" list lives in localStorage: a tiny external store so React re-renders when it changes. */
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
function readSeenRaw(careerId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(careerId));
  } catch {
    return null;
  }
}
// Private mode / blocked storage: keep the list in memory so the dialog can still be dismissed.
const memory = new Map<string, string>();
function writeSeen(careerId: string, families: readonly ServiceFamily[]): void {
  const raw = JSON.stringify(families);
  memory.set(careerId, raw);
  try {
    window.localStorage.setItem(storageKey(careerId), raw);
  } catch {
    /* storage unavailable: the in-memory copy applies for this session */
  }
  for (const cb of listeners) cb();
}
function parseSeen(raw: string | null): ServiceFamily[] | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as ServiceFamily[]) : null;
  } catch {
    return null;
  }
}

/** Families present in `current` and not yet celebrated. `seen === null` = first visit: nothing to celebrate. */
export function newlyUnlocked(
  seen: readonly ServiceFamily[] | null,
  current: readonly ServiceFamily[],
): ServiceFamily[] {
  if (seen === null) return [];
  return current.filter((f) => f !== 'UNG' && !seen.includes(f));
}

/**
 * Celebrates a FAMILY unlock (a career milestone, rarer than a level-up). Driven by `career.unlockedFamilies` of the
 * snapshot, remembered per career in localStorage so it also fires for an unlock that happened while the player was
 * away, and never twice.
 */
export function FamilyUnlockCelebration() {
  const careerId = useCareerId();
  const t = useTranslations('families.unlock');
  const tc = useTranslations('common');
  const name = useCatalogName();
  const catalog = useCatalog();
  const { career } = useSnapshot();
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);
  const seenRaw = React.useSyncExternalStore(
    subscribe,
    () => memory.get(careerId) ?? readSeenRaw(careerId),
    () => null,
  );
  const seen = React.useMemo(() => parseSeen(seenRaw), [seenRaw]);
  const fresh = newlyUnlocked(seen, career.unlockedFamilies);
  const family = fresh[0];

  // First visit on this device: remember what is unlocked today, celebrate only what comes later.
  const unlockedKey = career.unlockedFamilies.join(',');
  React.useEffect(() => {
    if (seen === null) writeSeen(careerId, unlockedKey ? (unlockedKey.split(',') as ServiceFamily[]) : []);
  }, [careerId, seen, unlockedKey]);
  React.useEffect(() => {
    if (family) track('family_unlocked', { family });
  }, [family]);

  if (!family) return null;
  const close = () => writeSeen(careerId, [...(seen ?? []), family]);
  const vehicleCount = catalog?.vehicleTypes.filter((v) => v.family === family).length ?? 0;
  const facilityCount = catalog?.facilityTypes.filter((f) => f.family === family).length ?? 0;
  const facts = [
    { icon: Truck, text: t('vehicles', { count: vehicleCount }) },
    { icon: Building2, text: t('facilities', { count: facilityCount }) },
    { icon: Siren, text: t('incidents') },
  ];
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent
        title={t('title', { family: name('family', family) })}
        description={
          TERRITORY_FAMILIES.includes(family)
            ? t('subtitleTerritory', { level: career.level })
            : t('subtitle', { level: career.level })
        }
        closeLabel={tc('close')}
        data-testid="family-unlock"
        data-family={family}
      >
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <FamilyBadge
            family={family}
            size={84}
            className={cn('shadow-panel', reducedMotion ? '' : 'motion-safe:animate-slide-up')}
          />
          <p className="text-muted max-w-prose text-sm">{name('family', family, 'description')}</p>
        </div>
        <ul className="border-border bg-surface-2 mt-3 flex flex-col gap-2 rounded-md border p-4 text-sm">
          {facts.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-2.5">
              <Icon className="text-muted size-4 shrink-0" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
        <p className="text-muted mt-3 text-sm">{t('nextStep')}</p>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {t('later')}
          </Button>
          <Button asChild variant="secondary" onClick={close}>
            <Link href={`/game/facilities?new=${family}`}>{t('newFacility')}</Link>
          </Button>
          <Button asChild onClick={close} data-testid="family-unlock-shop">
            <Link href={`/game/shop?family=${family}`}>{t('openShop')}</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
