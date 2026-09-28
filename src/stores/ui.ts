import { create } from 'zustand';
import type { I18nText } from '@/contracts';

/** Single-selection model shared by the map, the queue, the desktop inspector and the mobile bottom sheet. */
export type Selection =
  | { kind: 'incident'; id: string }
  | { kind: 'vehicle'; id: string }
  | { kind: 'facility'; id: string }
  | { kind: 'hospital'; id: string }
  | { kind: 'site'; id: string }
  /** A major incident's coordination view (D-24 / D-69): not in the snapshot, the inspector loads it. */
  | { kind: 'major'; id: string }
  | null;
/** Optional map layers (toggled from the map layers control). Base game layers are always on. */
export type MapLayerKey = 'hospitals' | 'closures' | 'coverage' | 'sites';
export type SheetSnap = 'peek' | 'half' | 'full';
export type ConnectionState = 'connecting' | 'online' | 'reconnecting' | 'polling' | 'offline';
export type IncidentClosure = { result: 'resolved' | 'failed' | 'expired' | 'cancelled'; title: I18nText };

interface Camera {
  center: [number, number];
  zoom: number;
}

interface UiState {
  selection: Selection;
  sheetSnap: SheetSnap;
  /** Height the queue sheet had before the inspector opened: closing the inspector goes back there (02 §4 #5). */
  sheetRestore: SheetSnap | null;
  /**
   * Pixels of the map covered by the bottom sheet once it has SETTLED (null while it moves, 0 without a sheet).
   * The map centres the selected marker in the part above it (02 §4 #1–3).
   */
  sheetCover: number | null;
  /** Bumped on every settle report, even when the height is unchanged, so listeners can re-centre on it. */
  sheetSettleSeq: number;
  camera: Camera | null;
  focusRequest: { center: [number, number]; zoom?: number; nonce: number } | null;
  connection: ConnectionState;
  outcomeIncidentId: string | null;
  mapLayers: Record<MapLayerKey, boolean>;
  /** Family shown by the coverage layer (null = overall best time). */
  coverageFamily: string | null;
  /**
   * Filter of the "new facility" map mode: every site, one family, or `NAUTICAL` — the nautical sites where a Base
   * nautica can be bought, highlighted when the player is about to buy one or a boat (D-23).
   */
  sitesFilter: string;
  setSitesFilter: (filter: string) => void;
  /** How recently closed incidents ended, so an inspector left open on one can say so instead of vanishing. */
  closedIncidents: Record<string, IncidentClosure>;
  /** The operations map is parked off screen (another game page is showing): its animation loop stands still. */
  mapParked: boolean;
  setMapParked: (parked: boolean) => void;
  setMapLayer: (key: MapLayerKey, on: boolean) => void;
  setCoverageFamily: (family: string | null) => void;
  select: (selection: Selection, opts?: { focus?: [number, number] }) => void;
  clearSelection: () => void;
  setSheetSnap: (snap: SheetSnap) => void;
  /** Tap on the empty map: get the sheet out of the way, but keep what is selected (X / Back close it). */
  lowerSheet: () => void;
  /** The whole incident list ("Tutte le emergenze"): nothing selected, sheet at the given height. */
  showQueue: (snap: SheetSnap) => void;
  setSheetCover: (px: number | null) => void;
  setCamera: (camera: Camera) => void;
  focusOn: (center: [number, number], zoom?: number) => void;
  setConnection: (state: ConnectionState) => void;
  noteIncidentClosed: (id: string, closure: IncidentClosure) => void;
}

let nonce = 0;

export const useUiStore = create<UiState>((set) => ({
  selection: null,
  sheetSnap: 'peek',
  sheetRestore: null,
  sheetCover: null,
  sheetSettleSeq: 0,
  camera: null,
  focusRequest: null,
  connection: 'connecting',
  outcomeIncidentId: null,
  mapLayers: { hospitals: false, closures: true, coverage: false, sites: false },
  coverageFamily: null,
  sitesFilter: 'ALL',
  closedIncidents: {},
  mapParked: true,
  setMapParked: (mapParked) => set((s) => (s.mapParked === mapParked ? s : { mapParked })),
  setMapLayer: (key, on) => set((s) => ({ mapLayers: { ...s.mapLayers, [key]: on } })),
  setCoverageFamily: (coverageFamily) => set({ coverageFamily }),
  setSitesFilter: (sitesFilter) => set({ sitesFilter }),
  // Opening something always lands on half with the marker centred above the sheet (02 §4 #3); the queue height it
  // came from is remembered once, so moving from one inspector to another still returns to the list as it was.
  select: (selection, opts) =>
    set((s) => ({
      selection,
      sheetSnap: selection ? 'half' : (s.sheetRestore ?? 'peek'),
      sheetRestore: selection ? (s.selection ? s.sheetRestore : s.sheetSnap) : null,
      focusRequest: opts?.focus ? { center: opts.focus, nonce: ++nonce } : s.focusRequest,
    })),
  clearSelection: () =>
    set((s) => ({ selection: null, sheetSnap: s.sheetRestore ?? 'peek', sheetRestore: null })),
  setSheetSnap: (sheetSnap) => set({ sheetSnap }),
  lowerSheet: () => set({ sheetSnap: 'peek' }),
  showQueue: (sheetSnap) => set({ selection: null, sheetRestore: null, sheetSnap }),
  setSheetCover: (px) =>
    set((s) => ({ sheetCover: px, sheetSettleSeq: px === null ? s.sheetSettleSeq : s.sheetSettleSeq + 1 })),
  setCamera: (camera) => set({ camera }),
  focusOn: (center, zoom) => set({ focusRequest: { center, zoom, nonce: ++nonce } }),
  setConnection: (connection) => set({ connection }),
  noteIncidentClosed: (id, closure) =>
    set((s) => ({
      // A handful is plenty: the record only has to outlive the inspector's short "closed" notice.
      closedIncidents: Object.fromEntries([...Object.entries(s.closedIncidents).slice(-19), [id, closure]]),
    })),
}));
