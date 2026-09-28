import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';
export interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  durationMs: number;
}

interface ToastState {
  toasts: ToastItem[];
  push: (toast: Omit<ToastItem, 'id' | 'durationMs'> & { durationMs?: number }) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;

/** Cards kept at once (phones show the front one with the others tucked behind; desktop lists them). */
export const MAX_TOASTS = 4;

/**
 * Over the cap the oldest card goes — but a card the player can act on ("Annulla", "Vedi", "Riepilogo") outlives plain
 * notices: a burst of "intervento concluso" at the end of a major incident must not push out its summary toast.
 * Only when every older card has an action does the oldest actionable one go. The new card is always kept.
 */
export function withToast(current: readonly ToastItem[], next: ToastItem): ToastItem[] {
  const list = [...current, next];
  while (list.length > MAX_TOASTS) {
    const plain = list.findIndex((t) => !t.action && t.id !== next.id);
    list.splice(plain >= 0 ? plain : 0, 1);
  }
  return list;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = nextId++;
    set((s) => ({ toasts: withToast(s.toasts, { durationMs: 5000, ...toast, id }) }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (t: Parameters<ToastState['push']>[0]) => useToastStore.getState().push(t);
