import { create } from 'zustand';
import type { Call } from '../types';
import { getSupabase } from '../lib/supabase';
import { fetchCallsBetween } from '../lib/supabaseApi';
import { dayEndIso, dayStartIso, type DateRange } from '../lib/reportRange';

/**
 * Anrufe eines **beliebigen** Zeitraums, live gehalten — die Datenquelle der
 * Berichte.
 *
 * Bewusst getrennt von `useMonthCalls`: das hält fest den laufenden Monat und
 * wird beim Login app-weit abonniert (Dashboard, Team-Dashboard, AgentDetail
 * hängen daran). Die Berichte brauchen dagegen ein frei wählbares Fenster —
 * letztes Quartal, ein einzelner Tag, das ganze Jahr. Beides in einen Store zu
 * pressen hieße, das app-weite Fenster von einer Seite aus umzuschalten und
 * damit die Kennzahlen aller anderen Ansichten mitzuverstellen.
 *
 * Wird deshalb nur von der Berichte-Seite geladen und abonniert (Mount/Unmount),
 * nicht in App.tsx.
 */

interface RangeCallsState {
  /** Aktuell geladenes Fenster (Tagesschlüssel), null = noch nichts geladen. */
  from: string | null;
  to: string | null;
  /** null = noch nicht geladen (Skeleton), [] = geladen und leer. */
  calls: Call[] | null;
  loading: boolean;
  /** true, wenn die Seitengrenze griff — die Zahlen sind dann unvollständig. */
  truncated: boolean;
  /** Letzter Ladefehler in Klartext, damit die Seite ihn zeigen kann. */
  error: string | null;

  loadRange: (range: DateRange) => Promise<void>;
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

/** „Letzte Anforderung gewinnt" — schnelles Klicken durch die Zeitraum-Vorlagen
 *  darf nicht dazu führen, dass ein spät zurückkommender Fetch eines älteren
 *  Fensters die gerade gewählte Auswertung überschreibt. */
let reqSeq = 0;

export const useRangeCalls = create<RangeCallsState>()((set, get) => ({
  from: null,
  to: null,
  calls: null,
  loading: false,
  truncated: false,
  error: null,

  loadRange: async (range) => {
    const seq = ++reqSeq;
    set({ loading: true, error: null });
    try {
      const { calls, truncated } = await fetchCallsBetween(
        dayStartIso(range.from),
        dayEndIso(range.to),
      );
      if (seq !== reqSeq) return;
      set({ calls, truncated, from: range.from, to: range.to, loading: false });
    } catch (e) {
      if (seq !== reqSeq) return;
      // Anrufe sind nur ein Teil des Berichts — Verträge und Tarifwechsel
      // kommen aus useStore und stehen weiter. Deshalb leer laden statt den
      // ganzen Bericht scheitern zu lassen, aber den Fehler sichtbar machen
      // (sonst läse sich ein RLS-/Migrationsproblem als „0 Anrufe").
      set({
        calls: [],
        truncated: false,
        from: range.from,
        to: range.to,
        loading: false,
        error: e instanceof Error ? e.message : 'Anrufe konnten nicht geladen werden.',
      });
    }
  },

  reset: () =>
    set({ from: null, to: null, calls: null, loading: false, truncated: false, error: null }),

  subscribeRealtime: () => {
    const sb = getSupabase();
    // Träge wie in useMonthCalls: jedes Anrufereignis im Team würde sonst das
    // komplette Fenster neu laden. Ein Bericht ist eine Auswertung, keine
    // Live-Leiste — zwei Sekunden Verzug fallen dort nicht auf.
    const reload = debounce(() => {
      const { from, to, loading } = get();
      if (!from || !to || loading) return;
      const seq = ++reqSeq;
      fetchCallsBetween(dayStartIso(from), dayEndIso(to))
        .then(({ calls, truncated }) => {
          if (seq === reqSeq) set({ calls, truncated });
        })
        .catch(() => {});
    }, 2000);

    const channel = sb
      .channel('crm-tng-range-calls')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls' }, reload)
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  },
}));
