'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useSessionGate } from '@/hooks/use-session';
import { BrandSplash } from '@/components/brand/splash';

/** "/" has no UI of its own: everyone is sent to /auth, /onboarding or /game. */
export function HomeRedirect() {
  const gateStatus = useSessionGate('anonymous-only');
  const router = useRouter();
  React.useEffect(() => {
    if (gateStatus === 'ok') router.replace('/auth');
  }, [gateStatus, router]);
  return <BrandSplash />;
}
