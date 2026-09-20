'use client';
import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { FlaskConical, Lock } from 'lucide-react';
import { api } from '@/lib/api/client';
import { monetizationApi } from '@/lib/api/depth';
import { qk } from '@/lib/api/query-keys';
import { env } from '@/lib/env';
import { useErrorMessage } from '@/lib/api/error-message';
import { toast } from '@/stores/toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditAmount } from '@/components/ui/credit-amount';
import { Card, EmptyState, Skeleton } from '@/components/ui/misc';
import { useCareerId } from '@/features/game/hooks';
import { PageBody } from '@/features/game/shell';
import { formatPrice } from './money';

type MockEvent = 'checkout.session.completed' | 'checkout.session.expired';

/**
 * `/game/credits/mock-checkout?purchase=…` — stands in for the provider's hosted checkout page in MOCK mode only
 * (no card data, clearly labelled as a simulation). "Pay" fires the simulated webhook, exactly like the provider
 * would call the server, then returns to the same success/cancel URLs the real checkout uses.
 */
export function MockCheckoutScreen() {
  const t = useTranslations('monetization.mockCheckout');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const careerId = useCareerId();
  const errorMessage = useErrorMessage();
  const purchaseId = useSearchParams().get('purchase') ?? '';
  const [busy, setBusy] = React.useState<MockEvent | null>(null);
  const purchases = useQuery({
    queryKey: qk.purchases(careerId),
    queryFn: () => monetizationApi.purchases(careerId),
    enabled: env.apiMock,
  });
  const purchase = purchases.data?.find((p) => p.id === purchaseId);

  React.useEffect(() => {
    if (!env.apiMock) router.replace('/game/credits');
  }, [router]);
  if (!env.apiMock) return null;

  const send = async (type: MockEvent) => {
    setBusy(type);
    try {
      await api.post('/webhooks/stripe', { type, data: { purchaseId } }, { auth: false });
      const target = type === 'checkout.session.completed' ? 'success' : 'cancel';
      router.replace(`/game/credits/${target}?purchase=${encodeURIComponent(purchaseId)}`);
    } catch (e) {
      toast({ tone: 'danger', title: errorMessage(e) });
      setBusy(null);
    }
  };

  return (
    <PageBody title={t('title')}>
      <Card className="mx-auto flex w-full max-w-md flex-col gap-4" data-testid="mock-checkout">
        <Badge tone="warning" className="self-start">
          <FlaskConical className="size-3" aria-hidden />
          {t('simulation')}
        </Badge>
        <p className="text-muted text-sm">{t('notice')}</p>
        {purchases.isLoading ? (
          <Skeleton className="h-20" />
        ) : !purchase || purchase.status !== 'CREATED' ? (
          <EmptyState title={t('notFound')} />
        ) : (
          <>
            <dl className="border-border bg-surface-2 flex items-center justify-between rounded-md border p-3">
              <dt>
                <CreditAmount value={purchase.credits} label={tc('credits')} size="lg" />
              </dt>
              <dd className="tabular text-xl font-bold">
                {formatPrice(purchase.priceMinor, purchase.currency, locale)}
              </dd>
            </dl>
            <Button
              size="lg"
              onClick={() => void send('checkout.session.completed')}
              loading={busy === 'checkout.session.completed'}
              disabled={busy !== null}
              data-testid="mock-pay"
            >
              <Lock className="size-4" aria-hidden />
              {t('pay', { price: formatPrice(purchase.priceMinor, purchase.currency, locale) })}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void send('checkout.session.expired')}
              loading={busy === 'checkout.session.expired'}
              disabled={busy !== null}
              data-testid="mock-cancel"
            >
              {t('cancel')}
            </Button>
          </>
        )}
      </Card>
    </PageBody>
  );
}
