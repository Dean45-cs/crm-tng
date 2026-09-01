import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';

/**
 * Optionale Handlung direkt in der Meldung — gedacht für „Rückgängig" nach
 * einer Massenänderung (Schichtplan). Bewusst genau eine Aktion: eine Meldung,
 * die verschwindet, ist der falsche Ort für Entscheidungen mit mehreren Wegen.
 * Der Klick schließt die Meldung immer, damit sie nicht zweimal auslösbar ist.
 */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: string;
  kind: ToastKind;
  msg: string;
  action?: ToastAction;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, msg: string, action?: ToastAction) => void;
  success: (msg: string, action?: ToastAction) => void;
  error: (msg: string, action?: ToastAction) => void;
  info: (msg: string, action?: ToastAction) => void;
  dismiss: (id: string) => void;
}

const AUTO_DISMISS_MS = 4000;
/** Mit Aktion länger stehen lassen — 4 s reichen nicht zum Lesen und Klicken. */
const AUTO_DISMISS_ACTION_MS = 9000;

export const useToast = create<ToastState>()((set, get) => ({
  toasts: [],

  push: (kind, msg, action) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((s) => ({ toasts: [...s.toasts, { id, kind, msg, action }] }));
    setTimeout(() => get().dismiss(id), action ? AUTO_DISMISS_ACTION_MS : AUTO_DISMISS_MS);
  },

  success: (msg, action) => get().push('success', msg, action),
  error: (msg, action) => get().push('error', msg, action),
  info: (msg, action) => get().push('info', msg, action),

  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Für Aufrufe außerhalb von React-Komponenten (z.B. im Daten-Store). */
export const toast = {
  success: (msg: string, action?: ToastAction) => useToast.getState().success(msg, action),
  error: (msg: string, action?: ToastAction) => useToast.getState().error(msg, action),
  info: (msg: string, action?: ToastAction) => useToast.getState().info(msg, action),
};
