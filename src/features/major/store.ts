import { create } from 'zustand';

/**
 * Client state of the major incidents that is not server data: which full-screen alert is up, and the aircraft that turned
 * back at "bingo" and will fly back to an incident once refuelled (the realtime event says so once; the vehicle DTO does not).
 */
interface MajorUiState {
  /** The major whose full-screen alert is showing (null = none). */
  alertId: string | null;
  showAlert: (majorId: string) => void;
  dismissAlert: () => void;
  /** vehicle id → the incident it goes back to after refuelling (flight endurance, `resumeAfterRefuel`). */
  flightResume: Record<string, string>;
  rememberResume: (vehicleId: string, incidentId: string) => void;
  clearResume: (vehicleId: string) => void;
}

export const useMajorStore = create<MajorUiState>((set) => ({
  alertId: null,
  showAlert: (alertId) => set({ alertId }),
  dismissAlert: () => set({ alertId: null }),
  flightResume: {},
  rememberResume: (vehicleId, incidentId) =>
    set((s) => ({ flightResume: { ...s.flightResume, [vehicleId]: incidentId } })),
  clearResume: (vehicleId) =>
    set((s) => {
      if (!(vehicleId in s.flightResume)) return s;
      const next = { ...s.flightResume };
      delete next[vehicleId];
      return { flightResume: next };
    }),
}));
