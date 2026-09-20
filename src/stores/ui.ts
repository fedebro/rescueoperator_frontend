import { create } from 'zustand';

/** Single-selection model shared by the map, the queue, the desktop inspector and the mobile bottom sheet. */
export type Selection =
  | { kind: 'incident'; id: string }
  | { kind: 'vehicle'; id: string }
  | { kind: 'facility'; id: string }
  | { kind: 'hospital'; id: string }
  | { kind: 'site'; id: string }
  | null;
/** Optional map layers (toggled from the map layers control). Base game layers are always on. */
export type MapLayerKey = 'hospitals' | 'closures' | 'coverage' | 'sites';
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
  mapLayers: Record<MapLayerKey, boolean>;
  /** Family shown by the coverage layer (null = overall best time). */
  coverageFamily: string | null;
  setMapLayer: (key: MapLayerKey, on: boolean) => void;
  setCoverageFamily: (family: string | null) => void;
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
  mapLayers: { hospitals: false, closures: true, coverage: false, sites: false },
  coverageFamily: null,
  setMapLayer: (key, on) => set((s) => ({ mapLayers: { ...s.mapLayers, [key]: on } })),
  setCoverageFamily: (coverageFamily) => set({ coverageFamily }),
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
