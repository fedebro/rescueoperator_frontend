'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, isAdminUser } from '@/stores/auth';

export type Gate = 'anonymous-only' | 'needs-career' | 'needs-no-career' | 'admin';

/** Client-side route guard. Returns true when the current route may render. */
export function useSessionGate(gate: Gate): boolean {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const target = React.useMemo(() => {
    if (status === 'unknown') return null;
    if (status === 'anonymous') return gate === 'anonymous-only' ? 'ok' : '/auth';
    const hasCareer = !!user?.activeCareerId;
    if (gate === 'anonymous-only') return hasCareer ? '/game' : '/onboarding';
    if (gate === 'needs-career') return hasCareer ? 'ok' : '/onboarding';
    if (gate === 'needs-no-career') return hasCareer ? '/game' : 'ok';
    return isAdminUser(user) ? 'ok' : '/game';
  }, [status, user, gate]);
  React.useEffect(() => {
    if (target && target !== 'ok') router.replace(target);
  }, [target, router]);
  return target === 'ok';
}
