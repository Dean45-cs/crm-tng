import { create } from 'zustand';
import type { Shift, StaffingTarget } from '../types';
import { getSupabase } from '../lib/supabase';
import { fetchShiftsForWeek, fetchShiftsForUser, fetchStaffingTargets } from '../lib/supabaseApi';

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

/** Wie weit der persönliche Kontext im Voraus geladen wird. Zwei Wochen decken
 *  „meine nächste Schicht" auch über längeren Urlaub hinweg ab. */
const CONTEXT_DAYS = 14;

const addDaysKey = (key: string, days: number): string => {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
};

interface ShiftsState {
  // Der geladene Zeitraum. Hieß früher weekStart/weekEnd — seit es neben der
  // Wochen- auch eine Monatsansicht gibt, ist „Woche" der falsche Begriff: der
  // Store hält schlicht das gerade angezeigte Fenster, egal wie breit es ist.
  rangeStart: string | null; // 'YYYY-MM-DD', erster Tag des geladenen Fensters
  rangeEnd: string | null;
  rows: Shift[];
  loading: boolean;
  /** Soll-Besetzung je ISO-Wochentag (1 = Mo). Leer = Migration 024 fehlt noch. */
  targets: StaffingTarget[];
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
  /**
   * Die eigenen Schichten ab heute (14 Tage) — aus derselben Abfrage wie
   * todayShift. An einem freien Tag ist „wann geht es weiter?" die
   * interessantere Frage als „heute nichts", und dafür reicht eine
   * Tageszeile nicht.
   */
  myShifts: Shift[];

  loadRange: (rangeStart: string, rangeEnd: string) => Promise<Shift[]>;
  patchRows: (updater: (rows: Shift[]) => Shift[]) => void;
  setWriting: (writing: boolean) => void;
  loadContext: (userId: string) => Promise<void>;
  loadTargets: () => Promise<void>;
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
  rangeStart: null,
  rangeEnd: null,
  rows: [],
  loading: false,
  targets: [],
  writing: false,
  todayShift: null,
  contextUserId: null,
  contextDate: null,
  myShifts: [],

  loadRange: async (rangeStart, rangeEnd) => {
    const seq = ++reqSeq;
    set({ loading: true });
    try {
      const rows = await fetchShiftsForWeek(rangeStart, rangeEnd);
      if (seq !== reqSeq) return rows; // inzwischen wurde ein anderes Fenster angefordert
      set({ rows, rangeStart, rangeEnd, loading: false });
      return rows;
    } catch {
      // Migration 020 evtl. noch nicht eingespielt — leer laden statt zu
      // crashen (gleiches Toleranzmuster wie useCalls / fetchIncentives).
      if (seq !== reqSeq) return [];
      set({ rows: [], rangeStart, rangeEnd, loading: false });
      return [];
    }
  },

  patchRows: (updater) => set((s) => ({ rows: updater(s.rows) })),

  setWriting: (writing) => set({ writing }),

  loadTargets: async () => {
    // fetchStaffingTargets schluckt einen fehlenden Tabellen-Fehler selbst und
    // liefert dann [] — ohne Soll-Besetzung zeigt die Ansicht nur Ist-Zahlen.
    set({ targets: await fetchStaffingTargets() });
  },

  loadContext: async (userId) => {
    const day = localDateKey();
    set({ contextUserId: userId, contextDate: day });
    try {
      const mine = await fetchShiftsForUser(userId, day, addDaysKey(day, CONTEXT_DAYS));
      // Nur übernehmen, wenn noch derselbe User gefragt ist (Login-Wechsel /
      // Mitternacht könnten dazwischenfunken).
      if (get().contextUserId === userId) {
        set({
          myShifts: mine,
          todayShift: mine.find((s) => s.shiftDate === day) ?? null,
          contextDate: day,
        });
      }
    } catch {
      if (get().contextUserId === userId) set({ todayShift: null, myShifts: [] });
    }
  },

  reset: () =>
    set({
      rangeStart: null,
      rangeEnd: null,
      rows: [],
      loading: false,
      targets: [],
      writing: false,
      todayShift: null,
      contextUserId: null,
      contextDate: null,
      myShifts: [],
    }),

  subscribeRealtime: () => {
    const sb = getSupabase();
    const reload = debounce(() => {
      const { rangeStart, rangeEnd, writing, contextUserId } = get();
      // Angezeigtes Fenster live nachladen (nicht während eines eigenen Writes).
      if (rangeStart && rangeEnd && !writing) {
        fetchShiftsForWeek(rangeStart, rangeEnd)
          .then((rows) => set({ rows }))
          .catch(() => {});
      }
      // Persönlichen Kontext (eigene Schichten ab heute) unabhängig davon live
      // halten — so sieht z. B. das Dashboard-Widget eine Zuteilung sofort.
      if (contextUserId) {
        const day = localDateKey();
        fetchShiftsForUser(contextUserId, day, addDaysKey(day, CONTEXT_DAYS))
          .then((mine) => {
            if (get().contextUserId === contextUserId) {
              set({
                myShifts: mine,
                todayShift: mine.find((s) => s.shiftDate === day) ?? null,
                contextDate: day,
              });
            }
          })
          .catch(() => {});
      }
    });
    // Die Soll-Besetzung ändert sich selten, aber wenn der Chef sie anpasst,
    // soll die Ampel bei allen sofort umspringen — sonst diskutiert das Team
    // über eine Unterdeckung, die längst keine mehr ist.
    const reloadTargets = debounce(() => {
      fetchStaffingTargets()
        .then((targets) => set({ targets }))
        .catch(() => {});
    });

    const channel = sb
      .channel('crm-tng-shifts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, reload)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'staffing_targets' },
        reloadTargets,
      )
      .subscribe();

    // Über Mitternacht gilt eine andere Schicht, ohne dass sich an der Tabelle
    // etwas ändert — der Realtime-Kanal feuert dafür also nie. Ein offen
    // gelassener Tab zeigte sonst am nächsten Morgen weiter die Schicht von
    // gestern. Minütlicher Vergleich des lokalen Tagesschlüssels; geladen wird
    // nur beim tatsächlichen Wechsel.
    const dayWatch = setInterval(() => {
      const { contextUserId, contextDate } = get();
      if (!contextUserId || contextDate === localDateKey()) return;
      void get().loadContext(contextUserId);
    }, 60_000);

    return () => {
      clearInterval(dayWatch);
      sb.removeChannel(channel);
    };
  },
}));
