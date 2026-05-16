import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  kind: ToastKind;
  msg: string;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, msg: string) => void;
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
  dismiss: (id: string) => void;
}

const AUTO_DISMISS_MS = 4000;

export const useToast = create<ToastState>()((set, get) => ({
  toasts: [],

  push: (kind, msg) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((s) => ({ toasts: [...s.toasts, { id, kind, msg }] }));
    setTimeout(() => get().dismiss(id), AUTO_DISMISS_MS);
  },

  success: (msg) => get().push('success', msg),
  error: (msg) => get().push('error', msg),
  info: (msg) => get().push('info', msg),

  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Für Aufrufe außerhalb von React-Komponenten (z.B. im Daten-Store). */
export const toast = {
  success: (msg: string) => useToast.getState().success(msg),
  error: (msg: string) => useToast.getState().error(msg),
  info: (msg: string) => useToast.getState().info(msg),
};
