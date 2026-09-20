import { Suspense } from 'react';
import { CheckoutSuccessScreen } from '@/features/monetization/checkout-return';

/** Return URL of the hosted checkout: `/game/credits/success?purchase=<purchaseId>`. */
export default function Page() {
  return (
    <Suspense>
      <CheckoutSuccessScreen />
    </Suspense>
  );
}
