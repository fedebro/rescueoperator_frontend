import { create } from 'zustand';
import type { UserDto } from '@/contracts';

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

interface AuthState {
  status: AuthStatus;
  user: UserDto | null;
  setSession: (user: UserDto) => void;
  setUser: (user: UserDto) => void;
  clear: () => void;
}

/** The access token itself lives in the API client module (memory only); this store holds who is signed in. */
export const useAuthStore = create<AuthState>((set) => ({
  status: 'unknown',
  user: null,
  setSession: (user) => set({ status: 'authenticated', user }),
  setUser: (user) => set({ user }),
  clear: () => set({ status: 'anonymous', user: null }),
}));

export const isAdminUser = (user: UserDto | null): boolean =>
  !!user?.roles.some((r) => r === 'SUPPORT' || r === 'GAME_ADMIN' || r === 'SUPER_ADMIN');
