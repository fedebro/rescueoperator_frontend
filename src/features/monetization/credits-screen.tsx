'use client';
import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { BadgeCheck, Ban, ExternalLink, Flame, Info, Sparkles, Star, type LucideIcon } from 'lucide-react';
import type { z } from 'zod';
import type { CreditPackageDto, PurchaseDto } from '@/contracts';
import { gameApi } from '@/lib/api/endpoints';
import { monetizationApi } from '@/lib/api/depth';
import { qk } from '@/lib/api/query-keys';
import { useErrorMessage } from '@/lib/api/error-message';
import { track } from '@/lib/analytics';
import { formatAmount, formatDateTime, parseAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { useIsDesktop } from '@/hooks/use-media-query';
import { useI18nText } from '@/i18n/use-i18n-text';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/switch';
import { CreditAmount } from '@/components/ui/credit-amount';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Card, EmptyState, SectionTitle, Skeleton } from '@/components/ui/misc';
import { useCareerId, useSnapshot } from '@/features/game/hooks';
import { PageBody } from '@/features/game/shell';
import { RewardedAdCard } from './ads/rewarded-card';
import { useMonetizationPageGuard } from './gate';
import { legalUrl } from './legal';
import { formatPrice } from './money';
import { PurchaseStatusChip } from './purchase-status';

type Package = z.infer<typeof CreditPackageDto>;
type Purchase = z.infer<typeof PurchaseDto>;

const HIGHLIGHT: Record<
  Exclude<Package['highlight'], 'NONE'>,
  { icon: LucideIcon; tone: 'brand' | 'success' | 'info' }
> = {
  POPULAR: { icon: Flame, tone: 'brand' },
  BEST_VALUE: { icon: Star, tone: 'success' },
  STARTER: { icon: Sparkles, tone: 'info' },
};

export function PackageCard({
  pack,
  busy,
  onBuy,
}: {
  pack: Package;
  busy: boolean;
  onBuy: (pack: Package) => void;
}) {
  const t = useTranslations('monetization.shop');
  const tc = useTranslations('common');
  const tx = useI18nText();
  const locale = useLocale();
  const highlight = pack.highlight === 'NONE' ? null : HIGHLIGHT[pack.highlight];
  const bonus = parseAmount(pack.bonusCredits);
  const total = parseAmount(pack.credits) + bonus;
  const price = formatPrice(pack.priceMinor, pack.currency, locale);
  return (
    <li
      className={cn(
        'panel flex flex-col gap-3 p-4',
        highlight && 'border-border-strong',
        !pack.available && 'opacity-60',
      )}
      data-testid="credit-package"
      data-package={pack.id}
      data-available={pack.available}
    >
      <div className="flex min-h-6 flex-wrap items-center gap-1.5">
        {highlight ? (
          <Badge tone={highlight.tone}>
            <highlight.icon className="size-3" aria-hidden />
            {t(`highlight.${pack.highlight as 'POPULAR' | 'BEST_VALUE' | 'STARTER'}`)}
          </Badge>
        ) : null}
        {pack.oneTime ? (
          <Badge>
            <BadgeCheck className="size-3" aria-hidden />
            {t('oneTime')}
          </Badge>
        ) : null}
      </div>
      <div>
        <h3 className="font-display text-base font-bold">{tx(pack.label)}</h3>
        <CreditAmount value={total} label={tc('credits')} size="lg" className="mt-1 text-2xl" />
        {bonus > 0n ? (
          <p className="text-success mt-1 text-xs font-semibold">
            {t('bonus', { base: formatAmount(pack.credits, locale), bonus: formatAmount(bonus, locale) })}
          </p>
        ) : null}
      </div>
      <p className="tabular text-fg mt-auto text-xl font-bold" data-testid="package-price">
        {price}
      </p>
      {pack.available ? (
        <Button
          onClick={() => onBuy(pack)}
          loading={busy}
          aria-label={t('buyFor', { name: tx(pack.label), price })}
          data-testid="buy-package"
        >
          {t('buy', { price })}
        </Button>
      ) : (
        <p className="text-muted flex items-center gap-1.5 text-sm">
          <Ban className="size-4" aria-hidden />
          {pack.oneTime ? t('alreadyBought') : t('unavailable')}
        </p>
      )}
    </li>
  );
}

export function PurchaseHistory({ purchases, packages }: { purchases: Purchase[]; packages: Package[] }) {
  const t = useTranslations('monetization.shop.history');
  const tc = useTranslations('common');
  const tx = useI18nText();
  const locale = useLocale();
  const desktop = useIsDesktop();
  const nameOf = (p: Purchase) => {
    const pack = packages.find((x) => x.id === p.packageId);
    return pack ? tx(pack.label) : p.packageId;
  };
  if (purchases.length === 0) return <EmptyState title={t('empty')} />;
  const columns: Column<Purchase>[] = [
    {
      id: 'date',
      header: t('date'),
      width: '170px',
      cell: (p) => <span className="tabular text-muted">{formatDateTime(p.createdAt, locale)}</span>,
      sortValue: (p) => p.createdAt,
    },
    { id: 'package', header: t('package'), width: 'minmax(180px,2fr)', cell: nameOf },
    {
      id: 'credits',
      header: tc('credits'),
      width: '130px',
      align: 'right',
      cell: (p) => <CreditAmount value={p.credits} label={tc('credits')} />,
    },
    {
      id: 'price',
      header: t('price'),
      width: '110px',
      align: 'right',
      cell: (p) => <span className="tabular">{formatPrice(p.priceMinor, p.currency, locale)}</span>,
    },
    {
      id: 'status',
      header: t('status'),
      width: '150px',
      cell: (p) => <PurchaseStatusChip status={p.status} />,
    },
  ];
  return desktop ? (
    <DataTable
      caption={t('title')}
      columns={columns}
      rows={purchases}
      rowKey={(p) => p.id}
      density="dense"
      maxHeight={320}
    />
  ) : (
    <ul className="flex flex-col gap-2">
      {purchases.map((p) => (
        <li
          key={p.id}
          className="border-border bg-surface-2 flex items-center gap-3 rounded-md border p-3"
          data-testid="purchase-row"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{nameOf(p)}</span>
            <span className="tabular text-subtle block text-[11px]">
              {formatDateTime(p.createdAt, locale)} · {formatPrice(p.priceMinor, p.currency, locale)}
            </span>
            <CreditAmount value={p.credits} label={tc('credits')} size="sm" />
          </span>
          <PurchaseStatusChip status={p.status} />
        </li>
      ))}
    </ul>
  );
}

/** `/game/credits` — credit shop, rewarded video and purchase history. */
export function CreditsScreen() {
  const allowed = useMonetizationPageGuard('creditShop');
  return allowed ? <CreditsContent /> : null;
}

function CreditsContent() {
  const t = useTranslations('monetization.shop');
  const tc = useTranslations('common');
  const locale = useLocale();
  const careerId = useCareerId();
  const errorMessage = useErrorMessage();
  const { career } = useSnapshot();
  const [waiver, setWaiver] = React.useState(false);
  const [waiverError, setWaiverError] = React.useState(false);
  const waiverRef = React.useRef<HTMLButtonElement>(null);

  const packages = useQuery({
    queryKey: qk.packages(careerId),
    queryFn: () => monetizationApi.packages(careerId),
  });
  const purchases = useQuery({
    queryKey: qk.purchases(careerId),
    queryFn: () => monetizationApi.purchases(careerId),
    // The player often lands here right after a checkout: never show a cached list.
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const balance = useQuery({
    queryKey: [...qk.balance(careerId), career.credits],
    queryFn: () => gameApi.balance(careerId),
  }).data;

  React.useEffect(() => {
    track('credit_shop_viewed');
  }, []);

  const checkout = useMutation({
    mutationFn: (pack: Package) => monetizationApi.checkout(careerId, pack.id),
    onSuccess: (result, pack) => {
      track('checkout_started', { packageId: pack.id, priceMinor: pack.priceMinor, currency: pack.currency });
      // Hosted checkout of the payment provider: a full navigation away from the game.
      window.location.assign(result.checkoutUrl);
    },
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });
  const onBuy = (pack: Package) => {
    if (!waiver) {
      setWaiverError(true);
      waiverRef.current?.focus();
      waiverRef.current?.scrollIntoView({ block: 'center' });
      return;
    }
    checkout.mutate(pack);
  };

  return (
    <PageBody title={t('title')} subtitle={t('subtitle')}>
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <SectionTitle className="mb-1">{t('balance')}</SectionTitle>
          <CreditAmount value={career.credits} label={tc('credits')} size="lg" className="text-2xl" />
        </div>
        {balance && parseAmount(balance.purchasedCredits) > 0n ? (
          <p className="text-muted text-sm" data-testid="purchased-balance">
            {t('purchasedBalance', { credits: formatAmount(balance.purchasedCredits, locale) })}
          </p>
        ) : null}
      </Card>

      <Card className={cn('flex flex-col gap-2', waiverError && !waiver && 'border-danger')}>
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <Checkbox
            ref={waiverRef}
            id="withdrawal-waiver"
            checked={waiver}
            aria-required
            aria-invalid={waiverError && !waiver}
            aria-describedby="withdrawal-waiver-hint"
            onCheckedChange={(c) => {
              setWaiver(c === true);
              if (c === true) setWaiverError(false);
            }}
            data-testid="waiver"
          />
          <span>
            {t('waiver')}
            <span className="text-brand-hover"> *</span>
          </span>
        </label>
        <p id="withdrawal-waiver-hint" className="text-subtle pl-8 text-xs">
          {t('waiverHint')}{' '}
          <a
            href={legalUrl('terms', locale)}
            target="_blank"
            rel="noreferrer"
            className="text-skyline inline-flex items-center gap-1 underline-offset-4 hover:underline"
          >
            {t('terms')}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        </p>
        {waiverError && !waiver ? (
          <p role="alert" className="text-danger pl-8 text-xs" data-testid="waiver-error">
            {t('waiverRequired')}
          </p>
        ) : null}
      </Card>

      {packages.isLoading ? (
        <Skeleton className="h-56" />
      ) : packages.isError ? (
        <EmptyState title={errorMessage(packages.error)} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" aria-label={t('packages')}>
          {(packages.data ?? []).map((pack) => (
            <PackageCard
              key={pack.id}
              pack={pack}
              busy={checkout.isPending && checkout.variables?.id === pack.id}
              onBuy={onBuy}
            />
          ))}
        </ul>
      )}

      <p className="text-muted flex items-start gap-2 text-sm">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {t('fairPlay')} {t('payment')}
        </span>
      </p>

      <RewardedAdCard />

      <section aria-labelledby="purchase-history-title">
        <SectionTitle className="mt-2">
          <span id="purchase-history-title">{t('history.title')}</span>
        </SectionTitle>
        {purchases.isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <PurchaseHistory purchases={purchases.data ?? []} packages={packages.data ?? []} />
        )}
      </section>
    </PageBody>
  );
}
