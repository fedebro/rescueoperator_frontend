import { Suspense } from 'react';
import { PersonnelScreen } from '@/features/personnel/personnel-screen';

export default function Page() {
  // useSearchParams (deep links ?tab= / ?operator= / ?facility=) needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <PersonnelScreen />
    </Suspense>
  );
}
