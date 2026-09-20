'use client';
import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Hourglass, Undo2, XCircle } from 'lucide-react';
import { monetizationApi } from '@/lib/api/depth';
import { qk } from '@/lib/api/query-keys';
import { track } from '@/lib/analytics';
import { Button } from '@/components/ui/button';
import { CreditAmount } from '@/components/ui/credit-amount';
import { Card } from '@/components/ui/misc';
import { useCareerId, useSnapshot } from '@/features/game/hooks';
import { PageBody } from '@/features/game/shell';
import { useMonetizationPageGuard } from './gate';
import { PurchaseStatusChip } from './purchase-status';

const POLL_MS = 2000;
/** The webhook normally lands within seconds; after this we stop spinning and tell the player it will arrive. */
const PATIENCE_MS = 30_000;

function ReturnLinks() {
  const t = useTranslations('monetization.checkout');
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Button asChild size="lg">
        <Link href="/game">{t('backToGame')}</Link>
      </Button>
      <Button asChild size="lg" variant="secondary">
        <Link href="/game/credits">{t('backToShop')}</Link>
      </Button>
    </div>
  );
}

/**
 * `/game/credits/success?purchase=<purchaseId>` — the provider redirects here right after payment, usually BEFORE the
 * webhook has credited the purchase: poll the purchase list until the status is final. Credits are never granted by
 * this page; it only reports what the server did.
 */
export function CheckoutSuccessScreen() {
  const allowed = useMonetizationPageGuard('creditShop');
  const t = useTranslations('monetization.checkout');
  const tc = useTranslations('common');
  const careerId = useCareerId();
  const qc = useQueryClient();
  const purchaseId = useSearchParams().get('purchase');
  const { career } = useSnapshot();
  const [patient, setPatient] = React.useState(true);
  React.useEffect(() => {
    const timer = setTimeout(() => setPatient(false), PATIENCE_MS);
    return () => clearTimeout(timer);
  }, []);

  const purchases = useQuery({
    queryKey: qk.purchases(careerId),
    queryFn: () => monetizationApi.purchases(careerId),
    enabled: allowed,
    refetchInterval: (query) => {
      const list = query.state.data ?? [];
      const current = purchaseId ? list.find((p) => p.id === purchaseId) : list[0];
      return current && current.status !== 'CREATED' && current.status !== 'PAID' ? false : POLL_MS;
    },
  });
  const purchase = purchaseId ? purchases.data?.find((p) => p.id === purchaseId) : purchases.data?.[0];
  const status = purchase?.status;
  const credited = status === 'CREDITED';
  const failed = status === 'FAILED' || status === 'REFUNDED';

  React.useEffect(() => {
    if (!credited || !purchase) return;
    track('checkout_completed', { packageId: purchase.packageId, priceMinor: purchase.priceMinor });
    void qc.invalidateQueries({ queryKey: qk.balance(careerId) });
    void qc.invalidateQueries({ queryKey: qk.ledger(careerId) });
  }, [credited, purchase, qc, careerId]);

  if (!allowed) return null;
  return (
    <PageBody title={t('successTitle')}>
      <Card
        className="flex flex-col items-start gap-4"
        data-testid="checkout-result"
        data-state={credited ? 'credited' : failed ? 'failed' : patient ? 'processing' : 'delayed'}
        aria-live="polite"
      >
        {credited && purchase ? (
          <>
            <CheckCircle2 className="text-success size-10" aria-hidden />
            <div>
              <h2 className="font-display text-xl font-bold">{t('credited')}</h2>
              <CreditAmount
                value={purchase.credits}
                sign
                label={tc('credits')}
                size="lg"
                className="mt-2 text-3xl"
              />
            </div>
            <p className="text-muted flex items-center gap-2 text-sm">
              {t('newBalance')} <CreditAmount value={career.credits} label={tc('credits')} />
            </p>
          </>
        ) : failed && purchase ? (
          <>
            <XCircle className="text-danger size-10" aria-hidden />
            <h2 className="font-display text-xl font-bold">{t('failed')}</h2>
            <PurchaseStatusChip status={purchase.status} />
            <p className="text-muted text-sm">{t('failedHint')}</p>
          </>
        ) : (
          <>
            <Hourglass className="text-info size-10" aria-hidden />
            <h2 className="font-display text-xl font-bold">{patient ? t('processing') : t('delayed')}</h2>
            <p className="text-muted text-sm">{patient ? t('processingHint') : t('delayedHint')}</p>
            {purchase ? <PurchaseStatusChip status={purchase.status} /> : null}
          </>
        )}
        <ReturnLinks />
      </Card>
    </PageBody>
  );
}

/** `/game/credits/cancel?purchase=<purchaseId>` — the player left the hosted checkout: nothing was charged. */
export function CheckoutCancelScreen() {
  const allowed = useMonetizationPageGuard('creditShop');
  const t = useTranslations('monetization.checkout');
  React.useEffect(() => {
    track('checkout_cancelled');
  }, []);
  if (!allowed) return null;
  return (
    <PageBody title={t('cancelTitle')}>
      <Card className="flex flex-col items-start gap-4" data-testid="checkout-result" data-state="cancelled">
        <Undo2 className="text-muted size-10" aria-hidden />
        <div>
          <h2 className="font-display text-xl font-bold">{t('cancelled')}</h2>
          <p className="text-muted mt-1 text-sm">{t('cancelledHint')}</p>
        </div>
        <ReturnLinks />
      </Card>
    </PageBody>
  );
}
