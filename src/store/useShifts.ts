import { create } from 'zustand';
import type { Shift } from '../types';
import { getSupabase } from '../lib/supabase';
import { fetchShiftsForWeek } from '../lib/supabaseApi';

/**
 * Hält die aktuell im Schichtplan angezeigte Woche als einzige Wahrheit und
 * hört per Supabase-Realtime auf Änderungen an `shifts`. Damit ist der geteilte
 * Plan „alle sehen alle" (RLS read-all, Migration 020) tatsächlich live: editiert
 * der Chef, sehen alle offenen Ansichten die Änderung ohne Reload.
 *
 * Bewusst wochen-fenstrig statt „alle Schichten": Der Plan wird immer wochenweise
 * betrachtet, und über die Jahre wären das sehr viele Zeilen. Der Realtime-Handler
 * lädt darum genau die gerade geladene Woche neu (analog zum debounced Full-Refetch
 * der übrigen Stores), nicht alles.
 */

interface ShiftsState {
  weekStart: string | null; // 'YYYY-MM-DD' Montag der aktuell geladenen Woche
  weekEnd: string | null;
  rows: Shift[];
  loading: boolean;
  /** Solange ein lokaler Schreibvorgang läuft, unterdrückt der Realtime-Handler
   *  seinen Refetch, damit er das optimistische Update nicht mitten im Schreiben
   *  überschreibt — der Schreiber lädt selbst am Ende neu (reconcile). */
  writing: boolean;

  loadWeek: (weekStart: string, weekEnd: string) => Promise<Shift[]>;
  patchRows: (updater: (rows: Shift[]) => Shift[]) => void;
  setWriting: (writing: boolean) => void;
  reset: () => void;
  subscribeRealtime: () => () => void;
}

const debounce = (fn: () => void, ms = 250): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
};

/** „Letzte Anforderung gewinnt": Wird schnell zwischen Wochen gewechselt, darf
 *  ein spät zurückkommender Fetch einer älteren Woche das aktuelle Fenster nicht
 *  überschreiben (ersetzt den früheren `cancelled`-Guard in Schedule.tsx). */
let reqSeq = 0;

export const useShifts = create<ShiftsState>()((set, get) => ({
  weekStart: null,
  weekEnd: null,
  rows: [],
  loading: false,
  writing: false,

  loadWeek: async (weekStart, weekEnd) => {
    const seq = ++reqSeq;
    set({ loading: true });
    try {
      const rows = await fetchShiftsForWeek(weekStart, weekEnd);
      if (seq !== reqSeq) return rows; // inzwischen wurde eine andere Woche angefordert
      set({ rows, weekStart, weekEnd, loading: false });
      return rows;
    } catch {
      // Migration 020 evtl. noch nicht eingespielt — leer laden statt zu
      // crashen (gleiches Toleranzmuster wie useCalls / fetchIncentives).
      if (seq !== reqSeq) return [];
      set({ rows: [], weekStart, weekEnd, loading: false });
      return [];
    }
  },

  patchRows: (updater) => set((s) => ({ rows: updater(s.rows) })),

  setWriting: (writing) => set({ writing }),

  reset: () => set({ weekStart: null, weekEnd: null, rows: [], loading: false, writing: false }),

  subscribeRealtime: () => {
    const sb = getSupabase();
    const reload = debounce(() => {
      const { weekStart, weekEnd, writing } = get();
      if (writing || !weekStart || !weekEnd) return;
      fetchShiftsForWeek(weekStart, weekEnd)
        .then((rows) => set({ rows }))
        .catch(() => {});
    });
    const channel = sb
      .channel('crm-tng-shifts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, reload)
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  },
}));
