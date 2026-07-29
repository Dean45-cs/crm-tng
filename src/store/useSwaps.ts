import { create } from 'zustand';
import type { ShiftSwapRequest, ShiftType } from '../types';
import { getSupabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useShifts } from './useShifts';
import { toast } from './useToast';
import { notify } from './useNotifications';
import { swapSummary } from '../lib/notifications';
import {
  fetchOpenSwapRequests,
  insertSwapRequest,
  setSwapStatus,
  applyShiftSwap,
} from '../lib/supabaseApi';

/**
 * Schichttausch — offene Anfragen und die Übergänge dazwischen.
 *
 * Der Weg ist immer derselbe: A fragt B (pending) → B nimmt an (accepted) →
 * der Chef bestätigt (approved, und erst dann bewegt sich der Plan). Jeder
 * Schritt legt den Beteiligten eine Meldung ins Postfach — ohne das müsste
 * jede:r den Schichtplan im Auge behalten, um zu merken, dass etwas ansteht.
 *
 * Gehalten werden nur offene Anfragen (pending/accepted): erledigte
 * interessieren die Oberfläche nicht mehr, sie stehen als Meldung im Postfach.
 */

const debounce = (fn: () => void, ms = 250): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
};

/** Anzeigename einer Person — fällt auf „Kolleg:in" zurück, nie auf eine ID. */
const nameOf = (userId: string): string =>
  useAuth.getState().users[userId]?.displayName ?? 'Kolleg:in';

/** Alle aktiven Chefs — sie müssen einen angenommenen Tausch bestätigen. */
const managerIds = (): string[] =>
  Object.values(useAuth.getState().users)
    .filter((u) => u.isActive && u.role === 'manager')
    .map((u) => u.key);

interface SwapsState {
  requests: ShiftSwapRequest[];
  loaded: boolean;
  /** Läuft gerade ein Schreibvorgang — sperrt die Knöpfe gegen Doppelklicks. */
  busy: boolean;

  load: () => Promise<void>;
  reset: () => void;
  subscribeRealtime: () => () => void;

  request: (input: {
    partnerId: string;
    requesterDate: string;
    partnerDate: string;
    requesterShiftType?: ShiftType;
    partnerShiftType?: ShiftType;
    message?: string;
  }) => Promise<boolean>;
  accept: (id: string) => Promise<void>;
  decline: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  approve: (id: string) => Promise<void>;
  reject: (id: string) => Promise<void>;
}

export const useSwaps = create<SwapsState>()((set, get) => ({
  requests: [],
  loaded: false,
  busy: false,

  load: async () => {
    try {
      const requests = await fetchOpenSwapRequests();
      set({ requests, loaded: true });
    } catch {
      // Migration 023 evtl. noch nicht eingespielt — dann gibt es eben keine
      // Tauschanfragen, statt dass der Schichtplan gar nicht lädt.
      set({ requests: [], loaded: true });
    }
  },

  reset: () => set({ requests: [], loaded: false, busy: false }),

  subscribeRealtime: () => {
    const sb = getSupabase();
    // Anders als beim Postfach genügt hier der Vollabgleich: die Menge offener
    // Anfragen ist klein, und niemand muss unterscheiden, was neu ist — die
    // Meldung darüber kommt über das Postfach.
    const reload = debounce(() => {
      fetchOpenSwapRequests()
        .then((requests) => set({ requests }))
        .catch(() => {});
    });
    const channel = sb
      .channel('crm-tng-swaps')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_swap_requests' }, reload)
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  },

  request: async (input) => {
    const me = useAuth.getState().getCurrentUser();
    if (!me || get().busy) return false;
    set({ busy: true });
    try {
      const row = await insertSwapRequest({
        requesterId: me.key,
        requesterDate: input.requesterDate,
        partnerId: input.partnerId,
        partnerDate: input.partnerDate,
        message: input.message,
        requesterShiftType: input.requesterShiftType,
        partnerShiftType: input.partnerShiftType,
      });
      set((s) => ({ requests: [row, ...s.requests] }));

      await notify([input.partnerId], {
        kind: 'swap-requested',
        title: `${me.displayName} möchte Schichten tauschen`,
        body: `${swapSummary(row)}${input.message ? ` — „${input.message}"` : ''}`,
        link: { route: 'postfach' },
        entityId: row.id,
      });
      toast.success('Tauschanfrage verschickt.');
      return true;
    } catch (e) {
      console.error('[useSwaps] request', e);
      toast.error('Tauschanfrage konnte nicht verschickt werden.');
      return false;
    } finally {
      set({ busy: false });
    }
  },

  accept: async (id) => {
    const req = get().requests.find((r) => r.id === id);
    const me = useAuth.getState().getCurrentUser();
    if (!req || !me || get().busy) return;
    set({ busy: true });
    try {
      await setSwapStatus(id, 'accepted');
      set((s) => ({
        requests: s.requests.map((r) => (r.id === id ? { ...r, status: 'accepted' } : r)),
      }));
      // Zwei Adressaten mit unterschiedlicher Botschaft: die anfragende Person
      // erfährt „läuft", die Chefs bekommen die Aufgabe.
      await notify([req.requesterId], {
        kind: 'swap-accepted',
        title: `${me.displayName} ist mit dem Tausch einverstanden`,
        body: `${swapSummary(req)} — wartet jetzt auf die Bestätigung durch den Chef.`,
        link: { route: 'postfach' },
        entityId: req.id,
      });
      await notify(managerIds(), {
        kind: 'swap-accepted',
        title: 'Schichttausch wartet auf Bestätigung',
        body: `${nameOf(req.requesterId)} und ${nameOf(req.partnerId)}: ${swapSummary(req)}`,
        link: { route: 'postfach' },
        entityId: req.id,
      });
      toast.success('Angenommen — der Chef bestätigt den Tausch.');
    } catch (e) {
      console.error('[useSwaps] accept', e);
      toast.error('Konnte nicht angenommen werden.');
      void get().load();
    } finally {
      set({ busy: false });
    }
  },

  decline: async (id) => {
    const req = get().requests.find((r) => r.id === id);
    const me = useAuth.getState().getCurrentUser();
    if (!req || !me || get().busy) return;
    set({ busy: true });
    try {
      await setSwapStatus(id, 'declined');
      set((s) => ({ requests: s.requests.filter((r) => r.id !== id) }));
      await notify([req.requesterId], {
        kind: 'swap-declined',
        title: `${me.displayName} kann nicht tauschen`,
        body: swapSummary(req),
        link: { route: 'schedule' },
        entityId: req.id,
      });
      toast.info('Anfrage abgelehnt.');
    } catch (e) {
      console.error('[useSwaps] decline', e);
      toast.error('Konnte nicht abgelehnt werden.');
      void get().load();
    } finally {
      set({ busy: false });
    }
  },

  cancel: async (id) => {
    const req = get().requests.find((r) => r.id === id);
    const me = useAuth.getState().getCurrentUser();
    if (!req || !me || get().busy) return;
    set({ busy: true });
    try {
      await setSwapStatus(id, 'cancelled');
      set((s) => ({ requests: s.requests.filter((r) => r.id !== id) }));
      // Auch die Chefs erfahren davon, wenn sie den Tausch schon auf dem Tisch
      // hatten — sonst bestätigen sie etwas, das niemand mehr will.
      const alsoManagers = req.status === 'accepted' ? managerIds() : [];
      await notify([req.partnerId, ...alsoManagers], {
        kind: 'swap-cancelled',
        title: `${me.displayName} hat die Tauschanfrage zurückgezogen`,
        body: swapSummary(req),
        link: { route: 'schedule' },
        entityId: req.id,
      });
      toast.info('Anfrage zurückgezogen.');
    } catch (e) {
      console.error('[useSwaps] cancel', e);
      toast.error('Konnte nicht zurückgezogen werden.');
      void get().load();
    } finally {
      set({ busy: false });
    }
  },

  approve: async (id) => {
    const req = get().requests.find((r) => r.id === id);
    const me = useAuth.getState().getCurrentUser();
    if (!req || !me || get().busy) return;
    set({ busy: true });
    try {
      // Tauscht die Schichten und setzt den Status — atomar in der Datenbank
      // (siehe apply_shift_swap, Migration 023).
      await applyShiftSwap(id);
      set((s) => ({ requests: s.requests.filter((r) => r.id !== id) }));
      await notify([req.requesterId, req.partnerId], {
        kind: 'swap-approved',
        title: 'Schichttausch bestätigt',
        body: `${nameOf(req.requesterId)} ↔ ${nameOf(req.partnerId)}: ${swapSummary(req)}. Der Plan ist angepasst.`,
        link: { route: 'schedule' },
        entityId: req.id,
      });
      toast.success('Getauscht — der Plan ist angepasst.');
    } catch (e) {
      console.error('[useSwaps] approve', e);
      toast.error('Tausch konnte nicht ausgeführt werden.');
      void get().load();
    } finally {
      set({ busy: false });
      // Der Plan hat sich geändert: die angezeigte Woche neu holen. Realtime
      // auf `shifts` erledigt das zwar auch, aber nur für offene Ansichten —
      // hier ist es die Quittung auf den eigenen Klick.
      const { weekStart, weekEnd, loadWeek } = useShifts.getState();
      if (weekStart && weekEnd) void loadWeek(weekStart, weekEnd);
    }
  },

  reject: async (id) => {
    const req = get().requests.find((r) => r.id === id);
    const me = useAuth.getState().getCurrentUser();
    if (!req || !me || get().busy) return;
    set({ busy: true });
    try {
      await setSwapStatus(id, 'rejected');
      set((s) => ({ requests: s.requests.filter((r) => r.id !== id) }));
      await notify([req.requesterId, req.partnerId], {
        kind: 'swap-rejected',
        title: 'Schichttausch abgelehnt',
        body: `${me.displayName} hat den Tausch (${swapSummary(req)}) nicht bestätigt. Der Plan bleibt wie er ist.`,
        link: { route: 'schedule' },
        entityId: req.id,
      });
      toast.info('Tausch abgelehnt.');
    } catch (e) {
      console.error('[useSwaps] reject', e);
      toast.error('Konnte nicht abgelehnt werden.');
      void get().load();
    } finally {
      set({ busy: false });
    }
  },
}));

/**
 * Läuft für diese Person an diesem Tag schon eine Anfrage? Der Schichtplan
 * markiert solche Zellen, damit nicht zwei Leute dieselbe Schicht verplanen.
 */
export const swapForCell = (
  requests: ShiftSwapRequest[],
  userId: string,
  dateKey: string,
): ShiftSwapRequest | undefined =>
  requests.find(
    (r) =>
      (r.requesterId === userId && r.requesterDate === dateKey) ||
      (r.partnerId === userId && r.partnerDate === dateKey),
  );
