'use client';
import * as React from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Lock, PlayCircle, ShoppingBag, Siren } from 'lucide-react';
import type { ServiceFamily } from '@/contracts';
import type { CatalogDto } from '@/lib/api/types';
import { gameApi } from '@/lib/api/endpoints';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/error-message';
import { compareAmount, formatClock, parseAmount } from '@/lib/format';
import { toast } from '@/stores/toast';
import { useI18nText } from '@/i18n/use-i18n-text';
import { cn } from '@/lib/utils';
import { FamilyBadge, GameIcon, capabilityIconName, vehicleIconName } from '@/design/icons';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditAmount } from '@/components/ui/credit-amount';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCareerId, useCatalog, useSnapshot } from './hooks';
import { PageBody } from './shell';

type VehicleType = CatalogDto['vehicleTypes'][number];

/** "Not enough credits": keep playing → rewarded video → buy credits, in this order (analisi/05 §7.6). Paid options obey feature flags. */
export function InsufficientCreditsDialog({ price, onClose }: { price: string | null; onClose: () => void }) {
  const t = useTranslations('game.shop.insufficient');
  const tc = useTranslations('common');
  const { career, featureFlags } = useSnapshot();
  if (price === null) return null;
  const missing = parseAmount(price) - parseAmount(career.credits);
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        title={t('title')}
        description={t('subtitle')}
        closeLabel={tc('close')}
        data-testid="insufficient-credits"
      >
        <p className="border-border bg-surface-2 flex items-center justify-between rounded-md border p-3 text-sm">
          <span className="text-muted">{t('missing')}</span>
          <CreditAmount value={missing > 0n ? missing : 0n} label={tc('credits')} size="lg" />
        </p>
        <ul className="mt-4 flex flex-col gap-2">
          <li>
            <Button asChild variant="primary" size="lg" className="w-full justify-start">
              <Link href="/game" onClick={onClose}>
                <Siren className="size-5" aria-hidden />
                {t('keepPlaying')}
              </Link>
            </Button>
          </li>
          <li>
            <Button
              variant="secondary"
              size="lg"
              className="w-full justify-start"
              disabled={!featureFlags.rewardedAds}
            >
              <PlayCircle className="size-5" aria-hidden />
              {t('watchAd')}
              {!featureFlags.rewardedAds ? <Badge className="ml-auto">{t('soon')}</Badge> : null}
            </Button>
          </li>
          <li>
            <Button
              variant="secondary"
              size="lg"
              className="w-full justify-start"
              disabled={!featureFlags.creditShop}
            >
              <ShoppingBag className="size-5" aria-hidden />
              {t('buyCredits')}
              {!featureFlags.creditShop ? <Badge className="ml-auto">{t('soon')}</Badge> : null}
            </Button>
          </li>
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {tc('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VehicleOffer({
  type,
  onBuy,
  busy,
  canHost,
}: {
  type: VehicleType;
  onBuy: (type: VehicleType) => void;
  busy: boolean;
  canHost: boolean;
}) {
  const t = useTranslations('game.shop');
  const tc = useTranslations('common');
  const tx = useI18nText();
  const { career } = useSnapshot();
  const affordable = compareAmount(career.credits, type.price) >= 0;
  return (
    <li
      className={cn(
        'bg-surface-2 flex flex-col gap-3 rounded-md border p-3',
        type.unlocked ? 'border-border' : 'border-border/60 opacity-75',
      )}
      data-testid="vehicle-offer"
      data-code={type.code}
      data-unlocked={type.unlocked}
    >
      <div className="flex items-start gap-3">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-md text-white"
          style={{ background: `var(--rc-family-${type.family.toLowerCase()})` }}
        >
          <GameIcon name={vehicleIconName(type.icon)} size={26} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{tx(type.name)}</p>
          <p className="text-muted line-clamp-2 text-xs">{tx(type.description)}</p>
        </div>
      </div>
      <ul className="flex flex-wrap gap-1">
        {type.capabilities.map((c) => (
          <li key={c.code}>
            <Badge title={tx({ key: `catalog.capability.${c.code}` })}>
              <GameIcon name={capabilityIconName(c.code)} size={12} />
              <span className="sr-only">{tx({ key: `catalog.capability.${c.code}` })}</span>
              {c.value}
            </Badge>
          </li>
        ))}
      </ul>
      <dl className="text-subtle grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <dt>{t('crew')}</dt>
          <dd className="tabular text-fg">
            {type.crewMin}–{type.crewOptimal}
          </dd>
        </div>
        <div>
          <dt>{t('space')}</dt>
          <dd className="tabular text-fg">{type.capacityPoints}</dd>
        </div>
        <div>
          <dt>{t('delivery')}</dt>
          <dd className="tabular text-fg">{formatClock(type.deliverySeconds)}</dd>
        </div>
      </dl>
      {type.unlocked ? (
        <Button
          variant={affordable && canHost ? 'primary' : 'outline'}
          className="justify-between"
          disabled={!canHost}
          loading={busy}
          onClick={() => onBuy(type)}
          data-testid="buy-vehicle"
          data-tutorial={affordable && canHost ? 'buy-vehicle' : undefined}
        >
          <span>{canHost ? t('buy') : t('noRoom')}</span>
          <CreditAmount value={type.price} label={tc('credits')} tone={affordable ? 'plain' : 'credits'} />
        </Button>
      ) : (
        <p
          className="border-border-strong text-muted flex h-10 items-center justify-between gap-2 rounded-md border border-dashed px-3 text-xs"
          data-testid="locked-reason"
        >
          <span className="flex items-center gap-1.5">
            <Lock className="size-3.5" aria-hidden />
            {type.lockedReason === 'NOT_UNLOCKED'
              ? t('lockedFamily')
              : tc('requiresLevel', { level: type.requiredLevel })}
          </span>
          <CreditAmount value={type.price} label={tc('credits')} size="sm" tone="plain" />
        </p>
      )}
    </li>
  );
}

export function ShopScreen() {
  const careerId = useCareerId();
  const t = useTranslations('game.shop');
  const tx = useI18nText();
  const errorMessage = useErrorMessage();
  const catalog = useCatalog();
  const { facilities, career } = useSnapshot();
  const [family, setFamily] = React.useState<ServiceFamily>('FIRE');
  const [facilityId, setFacilityId] = React.useState<string | undefined>(facilities[0]?.id);
  const [missing, setMissing] = React.useState<string | null>(null);
  const facility = facilities.find((f) => f.id === facilityId) ?? facilities[0];

  const buy = useMutation({
    mutationFn: (type: VehicleType) =>
      gameApi.buyVehicle(careerId, { vehicleTypeCode: type.code, facilityId: facility!.id }),
    onSuccess: (vehicle) => {
      toast({
        tone: 'success',
        title: t('bought', { callSign: vehicle.callSign }),
        description: t('boughtHint'),
      });
      if (!career.tutorial.completed) void gameApi.tutorialAdvance(careerId, 'DONE').catch(() => undefined);
    },
    onError: (e, type) => {
      if (isApiError(e, 'INSUFFICIENT_CREDITS')) setMissing(type.price);
      else toast({ tone: 'danger', title: errorMessage(e) });
    },
  });
  const onBuy = (type: VehicleType) => {
    if (compareAmount(career.credits, type.price) < 0) setMissing(type.price);
    else buy.mutate(type);
  };

  const families = (catalog?.families ?? []).filter((f) => f.code !== 'UNG');
  const types = (catalog?.vehicleTypes ?? [])
    .filter((v) => v.family === family)
    .sort(
      (a, b) =>
        Number(b.unlocked) - Number(a.unlocked) ||
        a.requiredLevel - b.requiredLevel ||
        compareAmount(a.price, b.price),
    );
  const freeSpace = (domain: string) => {
    const c = facility?.capacities.find((x) => x.domain === domain);
    return c ? c.total - c.used : 0;
  };

  return (
    <PageBody
      title={t('title')}
      subtitle={t('subtitle')}
      actions={
        facilities.length > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-muted text-xs font-semibold">{t('deliverTo')}</span>
            <Select
              label={t('deliverTo')}
              value={facility?.id}
              onValueChange={setFacilityId}
              options={facilities.map((f) => ({ value: f.id, label: f.name }))}
              className="max-w-56"
            />
          </div>
        ) : null
      }
    >
      <Tabs value={family} onValueChange={(v) => setFamily(v as ServiceFamily)}>
        <TabsList>
          {families.map((f) => (
            <TabsTrigger key={f.code} value={f.code} className="gap-2">
              <FamilyBadge family={f.code} size={20} />
              {tx(f.name)}
              {f.requiredLevel > career.level ? (
                <Lock className="text-subtle size-3" aria-label={t('lockedFamily')} />
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {!catalog ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-52" />
          ))}
        </div>
      ) : types.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {types.map((type) => (
            <VehicleOffer
              key={type.code}
              type={type}
              onBuy={onBuy}
              busy={buy.isPending && buy.variables?.code === type.code}
              canHost={freeSpace(type.domain) >= type.capacityPoints}
            />
          ))}
        </ul>
      )}
      <InsufficientCreditsDialog price={missing} onClose={() => setMissing(null)} />
    </PageBody>
  );
}
