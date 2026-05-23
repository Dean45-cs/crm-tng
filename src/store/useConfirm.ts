import { create } from 'zustand';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** true = destruktive Aktion (roter Bestätigen-Button). */
  danger?: boolean;
}

interface ActiveConfirm extends ConfirmOptions {
  id: number;
}

interface ConfirmState {
  current: ActiveConfirm | null;
  resolver: ((ok: boolean) => void) | null;
  open: (opts: ConfirmOptions) => Promise<boolean>;
  respond: (ok: boolean) => void;
}

let counter = 0;

export const useConfirm = create<ConfirmState>()((set, get) => ({
  current: null,
  resolver: null,

  open: (opts) => {
    // Falls bereits ein Dialog offen ist, den vorherigen als abgelehnt auflösen.
    get().resolver?.(false);
    return new Promise<boolean>((resolve) => {
      set({ current: { ...opts, id: ++counter }, resolver: resolve });
    });
  },

  respond: (ok) => {
    const resolve = get().resolver;
    set({ current: null, resolver: null });
    resolve?.(ok);
  },
}));

/**
 * Öffnet einen Bestätigungsdialog und liefert ein Promise, das mit true (OK)
 * oder false (Abbrechen/Escape) auflöst. Ersetzt das native window.confirm().
 */
export const confirmDialog = (opts: ConfirmOptions): Promise<boolean> =>
  useConfirm.getState().open(opts);
