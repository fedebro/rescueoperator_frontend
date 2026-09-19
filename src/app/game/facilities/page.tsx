import { Suspense } from 'react';
import { FacilitiesScreen } from '@/features/game/pages-lists';

export default function Page() {
  return (
    <Suspense>
      <FacilitiesScreen />
    </Suspense>
  );
}
