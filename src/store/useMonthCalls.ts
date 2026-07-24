import { create } from 'zustand';
import type { Call } from '../types';
import { getSupabase } from '../lib/supabase';
import { fetchCallsSince } from '../lib/supabaseApi';

/**
 * Anrufe seit Monatsbeginn als eine geteilte, live gehaltene Quelle für die
 * Reporting-Ansichten (Dashboard, TeamDashboard, AgentDetail). Ersetzt die drei
 * bisher identischen, aber je Seite kopierten `fetchCallsSince(monthStart)`-
 * useState-Fetches — die waren nicht live: eine neue Disposition tauchte erst
 * nach Reload auf. Jetzt hängt der Store am `calls`-Realtime-Kanal und lädt das
 * Fenster bei jeder Änderung neu (debounced, Muster wie useCalls/useStatus).
 *
 * Bewusst getrennt von useCalls (das nur die aktiven Anrufe der Live-Leiste
 * hält): hier geht es um das begrenzte Monatsfenster für Kennzahlen. `null`
 * signalisiert „noch nicht geladen" (Skeleton), genau wie der bisherige lokale
 * State in den Seiten.
 */

const monthStartIso = (): string => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
};

interface MonthCallsState {
  calls: Call[] | null;

  load: () => Promise<void>;
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

export const useMonthCalls = create<MonthCallsState>()((set) => ({
  calls: null,

  load: async () => {
    try {
      // monthStart bei jedem Laden frisch berechnen → rollt über den Monats-
      // wechsel, ohne dass eine offene Seite neu gemountet werden muss.
      const rows = await fetchCallsSince(monthStartIso());
      set({ calls: rows });
    } catch {
      // Migration 018/021 evtl. noch nicht eingespielt — leer/loading lassen
      // statt zu crashen (gleiches Toleranzmuster wie useCalls).
      set({ calls: null });
    }
  },

  reset: () => set({ calls: null }),

  subscribeRealtime: () => {
    const sb = getSupabase();
    const reload = debounce(() => {
      fetchCallsSince(monthStartIso())
        .then((rows) => set({ calls: rows }))
        .catch(() => {});
    });
    const channel = sb
      .channel('crm-tng-month-calls')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls' }, reload)
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  },
}));
