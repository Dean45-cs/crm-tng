import { create } from 'zustand';
import type { Shift } from '../types';
import { getSupabase } from '../lib/supabase';
import { fetchShiftsForWeek, fetchShiftForUserDay } from '../lib/supabaseApi';

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

/** Lokaler Tagesschlüssel 'YYYY-MM-DD' (nicht UTC — die Schicht gilt kalendarisch). */
const localDateKey = (d = new Date()): string => {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

interface ShiftsState {
  weekStart: string | null; // 'YYYY-MM-DD' Montag der aktuell geladenen Woche
  weekEnd: string | null;
  rows: Shift[];
  loading: boolean;
  /** Solange ein lokaler Schreibvorgang läuft, unterdrückt der Realtime-Handler
   *  seinen Refetch, damit er das optimistische Update nicht mitten im Schreiben
   *  überschreibt — der Schreiber lädt selbst am Ende neu (reconcile). */
  writing: boolean;

  // --- Aktueller Kontext (Tier 2): die heutige Schicht des eingeloggten Users,
  //     app-weit live gehalten, unabhängig davon welche Woche der Schichtplan
  //     gerade anzeigt. Grundlage für useCurrentShiftContext(). ---
  todayShift: Shift | null; // null = keine Schicht heute / noch nicht geladen
  contextUserId: string | null;
  contextDate: string | null; // Tagesschlüssel, für den todayShift gilt

  loadWeek: (weekStart: string, weekEnd: string) => Promise<Shift[]>;
  patchRows: (updater: (rows: Shift[]) => Shift[]) => void;
  setWriting: (writing: boolean) => void;
  loadContext: (userId: string) => Promise<void>;
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
  todayShift: null,
  contextUserId: null,
  contextDate: null,

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

  loadContext: async (userId) => {
    const day = localDateKey();
    set({ contextUserId: userId, contextDate: day });
    try {
      const shift = await fetchShiftForUserDay(userId, day);
      // Nur übernehmen, wenn noch derselbe User/Tag gefragt ist (Login-Wechsel /
      // Mitternacht könnten dazwischenfunken).
      if (get().contextUserId === userId) set({ todayShift: shift, contextDate: day });
    } catch {
      if (get().contextUserId === userId) set({ todayShift: null });
    }
  },

  reset: () =>
    set({
      weekStart: null,
      weekEnd: null,
      rows: [],
      loading: false,
      writing: false,
      todayShift: null,
      contextUserId: null,
      contextDate: null,
    }),

  subscribeRealtime: () => {
    const sb = getSupabase();
    const reload = debounce(() => {
      const { weekStart, weekEnd, writing, contextUserId } = get();
      // Angezeigte Woche live nachladen (nicht während eines eigenen Writes).
      if (weekStart && weekEnd && !writing) {
        fetchShiftsForWeek(weekStart, weekEnd)
          .then((rows) => set({ rows }))
          .catch(() => {});
      }
      // Aktuellen Kontext (heutige Schicht des Users) unabhängig davon live
      // halten — so sieht z. B. das Dashboard-Badge eine Zuteilung sofort.
      if (contextUserId) {
        const day = localDateKey();
        fetchShiftForUserDay(contextUserId, day)
          .then((shift) => {
            if (get().contextUserId === contextUserId) set({ todayShift: shift, contextDate: day });
          })
          .catch(() => {});
      }
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
