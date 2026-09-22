'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, isAdminUser } from '@/stores/auth';

export type Gate = 'anonymous-only' | 'needs-career' | 'needs-no-career' | 'admin';
/** `loading`: still resolving, render a splash. `unreachable`: server didn't answer — show a retry state, don't navigate. */
export type SessionGateResult = 'ok' | 'loading' | 'unreachable';

/** Client-side route guard. Returns 'ok' when the current route may render. */
export function useSessionGate(gate: Gate): SessionGateResult {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const target = React.useMemo(() => {
    if (status === 'unknown') return null;
    if (status === 'unreachable') return 'unreachable' as const;
    if (status === 'anonymous') return gate === 'anonymous-only' ? 'ok' : '/auth';
    const hasCareer = !!user?.activeCareerId;
    if (gate === 'anonymous-only') return hasCareer ? '/game' : '/onboarding';
    if (gate === 'needs-career') return hasCareer ? 'ok' : '/onboarding';
    if (gate === 'needs-no-career') return hasCareer ? '/game' : 'ok';
    return isAdminUser(user) ? 'ok' : '/game';
  }, [status, user, gate]);
  React.useEffect(() => {
    if (target && target !== 'ok' && target !== 'unreachable') router.replace(target);
  }, [target, router]);
  if (target === 'ok') return 'ok';
  if (target === 'unreachable') return 'unreachable';
  return 'loading';
}
