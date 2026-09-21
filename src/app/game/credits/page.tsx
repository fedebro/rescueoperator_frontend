import { Suspense } from 'react';
import { CreditsScreen } from '@/features/monetization/credits-screen';

export default function Page() {
  return (
    <Suspense>
      <CreditsScreen />
    </Suspense>
  );
}
