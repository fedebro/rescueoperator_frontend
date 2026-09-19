import { create } from 'zustand';

/** Single-selection model shared by the map, the queue, the desktop inspector and the mobile bottom sheet. */
export type Selection =
  | { kind: 'incident'; id: string }
  | { kind: 'vehicle'; id: string }
  | { kind: 'facility'; id: string }
  | null;
export type SheetSnap = 'peek' | 'half' | 'full';
export type ConnectionState = 'connecting' | 'online' | 'reconnecting' | 'polling' | 'offline';

interface Camera {
  center: [number, number];
  zoom: number;
}

interface UiState {
  selection: Selection;
  sheetSnap: SheetSnap;
  camera: Camera | null;
  focusRequest: { center: [number, number]; zoom?: number; nonce: number } | null;
  connection: ConnectionState;
  outcomeIncidentId: string | null;
  select: (selection: Selection, opts?: { focus?: [number, number] }) => void;
  clearSelection: () => void;
  setSheetSnap: (snap: SheetSnap) => void;
  setCamera: (camera: Camera) => void;
  focusOn: (center: [number, number], zoom?: number) => void;
  setConnection: (state: ConnectionState) => void;
}

let nonce = 0;

export const useUiStore = create<UiState>((set) => ({
  selection: null,
  sheetSnap: 'peek',
  camera: null,
  focusRequest: null,
  connection: 'connecting',
  outcomeIncidentId: null,
  select: (selection, opts) =>
    set((s) => ({
      selection,
      sheetSnap: selection ? (s.sheetSnap === 'full' ? 'full' : 'half') : 'peek',
      focusRequest: opts?.focus ? { center: opts.focus, nonce: ++nonce } : s.focusRequest,
    })),
  clearSelection: () => set({ selection: null, sheetSnap: 'peek' }),
  setSheetSnap: (sheetSnap) => set({ sheetSnap }),
  setCamera: (camera) => set({ camera }),
  focusOn: (center, zoom) => set({ focusRequest: { center, zoom, nonce: ++nonce } }),
  setConnection: (connection) => set({ connection }),
}));
