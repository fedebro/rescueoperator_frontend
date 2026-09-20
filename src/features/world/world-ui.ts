import { create } from 'zustand';

/** UI state shared by the pieces of the world area (the widget can open the map layers panel on the closures list). */
interface WorldUiState {
  layersOpen: boolean;
  highlightedClosureId: string | null;
  /** Cells currently drawn by the coverage layer (0 while hidden/loading): exposed on the control for tests and a11y. */
  coverageCells: number;
  setCoverageCells: (count: number) => void;
  setLayersOpen: (open: boolean) => void;
  showClosure: (closureId: string | null) => void;
}

export const useWorldUi = create<WorldUiState>((set) => ({
  layersOpen: false,
  highlightedClosureId: null,
  coverageCells: 0,
  setCoverageCells: (coverageCells) => set({ coverageCells }),
  setLayersOpen: (layersOpen) =>
    set(layersOpen ? { layersOpen } : { layersOpen, highlightedClosureId: null }),
  showClosure: (highlightedClosureId) => set({ layersOpen: true, highlightedClosureId }),
}));
