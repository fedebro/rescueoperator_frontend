import { Suspense } from 'react';
import { MockCheckoutScreen } from '@/features/monetization/mock-checkout';

/** Simulated hosted checkout — mock mode only (redirects to the shop otherwise). */
export default function Page() {
  return (
    <Suspense>
      <MockCheckoutScreen />
    </Suspense>
  );
}
