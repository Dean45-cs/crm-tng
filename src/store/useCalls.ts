import { create } from 'zustand';
import type { Call } from '../types';
import { getSupabase } from '../lib/supabase';
import { fetchActiveCalls } from '../lib/supabaseApi';

/**
 * Hält ausschließlich die aktiven (noch nicht beendeten) Anrufe — die
 * Grundlage der Live-Anrufleiste in der Titlebar. Bewusst kein Store für die
 * volle Anrufhistorie: Anrufvolumen kann deutlich höher sein als
 * Verträge/Notizen, aktive Anrufe sind dagegen immer eine kleine, natürlich
 * begrenzte Menge. Die Historie eines einzelnen Kunden lädt CustomerDetail
 * gezielt per fetchCallsForCustomer(), die Team-KPI per fetchCallCountSince().
 */

interface CallsState {
  activeCalls: Call[];
  loaded: boolean;

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

export const useCalls = create<CallsState>()((set) => ({
  activeCalls: [],
  loaded: false,

  load: async () => {
    try {
      const activeCalls = await fetchActiveCalls();
      set({ activeCalls, loaded: true });
    } catch {
      // Migration 018 evtl. noch nicht eingespielt — darf die Live-
      // Anrufleiste nur leer lassen, nicht den Rest der App stören (gleiches
      // Toleranzmuster wie fetchIncentives/fetchLeads in useStore.loadAll()).
      set({ activeCalls: [], loaded: true });
    }
  },

  reset: () => set({ activeCalls: [], loaded: false }),

  subscribeRealtime: () => {
    const sb = getSupabase();
    const reload = debounce(() => {
      fetchActiveCalls().then((rows) => set({ activeCalls: rows })).catch(() => {});
    });
    const channel = sb
      .channel('crm-tng-calls')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls' }, reload)
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  },
}));
