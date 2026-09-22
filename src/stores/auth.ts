import { create } from 'zustand';
import type { UserDto } from '@/contracts';

/**
 * `unreachable`: the initial session check couldn't get a definitive answer from the server (network error, timeout,
 * 5xx) — we don't know yet whether the player is signed in or not. Distinct from `anonymous` (server said no) so a
 * backend outage never bounces a signed-in player to the login screen; route guards should show a "retry" state
 * instead of redirecting while in this status.
 */
export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous' | 'unreachable';

interface AuthState {
  status: AuthStatus;
  user: UserDto | null;
  setSession: (user: UserDto) => void;
  setUser: (user: UserDto) => void;
  clear: () => void;
  markUnreachable: () => void;
}

/** The access token itself lives in the API client module (memory only); this store holds who is signed in. */
export const useAuthStore = create<AuthState>((set) => ({
  status: 'unknown',
  user: null,
  setSession: (user) => set({ status: 'authenticated', user }),
  setUser: (user) => set({ user }),
  clear: () => set({ status: 'anonymous', user: null }),
  // A previously-authenticated session is kept intact (not wiped) while merely unreachable: once the server answers
  // again, `setSession`/`clear` from the retry overwrite `status` correctly either way.
  markUnreachable: () => set((s) => ({ status: s.status === 'authenticated' ? s.status : 'unreachable' })),
}));

export const isAdminUser = (user: UserDto | null): boolean =>
  !!user?.roles.some((r) => r === 'SUPPORT' || r === 'GAME_ADMIN' || r === 'SUPER_ADMIN');
