import { create } from 'zustand';
import type { StatusLogEntry, UserStatus } from '../types';
import { useAuth } from './useAuth';
import { toast } from './useToast';
import { getSupabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import { statusDef } from '../lib/statusBoard';
import {
  fetchUserStatuses,
  upsertUserStatus,
  insertStatusLog,
  fetchStatusLog,
  clearStatusLog,
} from '../lib/supabaseApi';

const uidNow = (): string | null => useAuth.getState().currentUserKey;

/** Historie der letzten 90 Tage laden — deckt Monats-KPIs komfortabel ab. */
const LOG_WINDOW_DAYS = 90;
const logWindowStart = (): string =>
  new Date(Date.now() - LOG_WINDOW_DAYS * 86_400_000).toISOString();

interface StatusState {
  /** Aktueller Status aller Kolleg:innen, indexiert nach User-ID. */
  statuses: Record<string, UserStatus>;
  /** Abgeschlossene Status-Abschnitte (für KPIs & Export). */
  logs: StatusLogEntry[];
  loaded: boolean;

  load: () => Promise<void>;
  reset: () => void;
  subscribeRealtime: () => () => void;

  /** Status wechseln — schließt den vorherigen Abschnitt und protokolliert ihn. */
  setStatus: (statusId: string) => Promise<void>;
  /** Ticketschicht-Untertyp umschalten (eigener Abschnitt in der Historie). */
  setSub: (sub: string) => Promise<void>;
  /** Freitext-Beschreibung des laufenden Status setzen. */
  setDescription: (desc: string) => Promise<void>;
  /** „Kurz weg" umschalten (überlagert den Status, ohne ihn zu beenden). */
  toggleAfk: () => Promise<void>;
  /** Status beenden (Feierabend) — letzten Abschnitt protokollieren, Status leeren. */
  clearMyStatus: () => Promise<void>;
  /** Chef-Aktion: komplette Historie löschen. */
  clearHistory: () => Promise<void>;
}

const fail = (msg: string, e: unknown) => {
  console.error('[useStatus]', e instanceof Error ? e.message : e);
  toast.error(msg);
};

const debounce = (fn: () => void, ms = 250): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
};

export const useStatus = create<StatusState>()((set, get) => ({
  statuses: {},
  logs: [],
  loaded: false,

  load: async () => {
    try {
      const [statuses, logs] = await Promise.all([
        fetchUserStatuses().catch(() => ({} as Record<string, UserStatus>)),
        fetchStatusLog(logWindowStart()).catch(() => [] as StatusLogEntry[]),
      ]);
      set({ statuses, logs, loaded: true });
    } catch (e) {
      fail('Status-Board konnte nicht geladen werden.', e);
      set({ loaded: true });
    }
  },

  reset: () => set({ statuses: {}, logs: [], loaded: false }),

  subscribeRealtime: () => {
    const sb = getSupabase();
    const reloadStatuses = debounce(() => {
      fetchUserStatuses().then((s) => set({ statuses: s })).catch(() => {});
    });
    const reloadLogs = debounce(() => {
      fetchStatusLog(logWindowStart()).then((l) => set({ logs: l })).catch(() => {});
    });
    const channel = sb
      .channel('crm-tng-status')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_status' }, reloadStatuses)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'status_log' }, reloadLogs)
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  },

  setStatus: async (statusId) => {
    const uid = uidNow();
    if (!uid) return;
    const def = statusDef(statusId);
    if (!def) return;

    const prev = get().statuses;
    const cur = prev[uid];
    const now = new Date().toISOString();

    // Vorherigen Abschnitt archivieren (lückenlose Historie).
    if (cur?.status && cur.startedAt) {
      const durationSeconds = (Date.now() - new Date(cur.startedAt).getTime()) / 1000;
      insertStatusLog({
        userId: uid,
        status: cur.status,
        sub: cur.sub,
        description: cur.description,
        isAfk: cur.isAfk,
        startedAt: cur.startedAt,
        endedAt: now,
        durationSeconds,
      }).catch((e) => console.warn('[useStatus] log failed', e));
    }

    // AFK-Übergänge wie im Status-Tool: Auto-AFK-Status setzt AFK, das Verlassen
    // eines Auto-AFK-Status hebt es wieder auf, sonst bleibt AFK unverändert.
    let isAfk = cur?.isAfk ?? false;
    if (def.autoAfk) isAfk = true;
    else if (statusDef(cur?.status)?.autoAfk) isAfk = false;

    const sub = statusId === 'ticketschicht' ? cur?.sub : undefined;
    const description = def.needsDesc ? cur?.description : undefined;

    const next: UserStatus = { userId: uid, status: statusId, sub, description, isAfk, startedAt: now, updatedAt: now };
    set({ statuses: { ...prev, [uid]: next } });
    try {
      await upsertUserStatus({ userId: uid, status: statusId, sub, description, isAfk, startedAt: now });
    } catch (e) {
      fail('Status konnte nicht gespeichert werden.', e);
      set({ statuses: prev });
    }
  },

  setSub: async (sub) => {
    const uid = uidNow();
    if (!uid) return;
    const prev = get().statuses;
    const cur = prev[uid];
    if (cur?.status !== 'ticketschicht') return;
    const now = new Date().toISOString();

    if (cur.startedAt) {
      const durationSeconds = (Date.now() - new Date(cur.startedAt).getTime()) / 1000;
      insertStatusLog({
        userId: uid,
        status: cur.status,
        sub: cur.sub,
        description: cur.description,
        isAfk: cur.isAfk,
        startedAt: cur.startedAt,
        endedAt: now,
        durationSeconds,
      }).catch((e) => console.warn('[useStatus] log failed', e));
    }

    const newSub = cur.sub === sub ? undefined : sub;
    const next: UserStatus = { ...cur, sub: newSub, startedAt: now, updatedAt: now };
    set({ statuses: { ...prev, [uid]: next } });
    try {
      await upsertUserStatus({
        userId: uid,
        status: cur.status,
        sub: newSub,
        description: cur.description,
        isAfk: cur.isAfk,
        startedAt: now,
      });
    } catch (e) {
      fail('Untertyp konnte nicht gespeichert werden.', e);
      set({ statuses: prev });
    }
  },

  setDescription: async (desc) => {
    const uid = uidNow();
    if (!uid) return;
    const prev = get().statuses;
    const cur = prev[uid];
    if (!cur?.status) return;
    const description = desc.trim() ? desc : undefined;
    if ((cur.description ?? '') === (description ?? '')) return;
    const next: UserStatus = { ...cur, description, updatedAt: new Date().toISOString() };
    set({ statuses: { ...prev, [uid]: next } });
    try {
      await upsertUserStatus({
        userId: uid,
        status: cur.status,
        sub: cur.sub,
        description,
        isAfk: cur.isAfk,
        startedAt: cur.startedAt,
      });
    } catch (e) {
      fail('Beschreibung konnte nicht gespeichert werden.', e);
      set({ statuses: prev });
    }
  },

  toggleAfk: async () => {
    const uid = uidNow();
    if (!uid) return;
    const prev = get().statuses;
    const cur = prev[uid];
    if (!cur?.status) return;
    const isAfk = !cur.isAfk;
    const next: UserStatus = { ...cur, isAfk, updatedAt: new Date().toISOString() };
    set({ statuses: { ...prev, [uid]: next } });
    try {
      await upsertUserStatus({
        userId: uid,
        status: cur.status,
        sub: cur.sub,
        description: cur.description,
        isAfk,
        startedAt: cur.startedAt,
      });
    } catch (e) {
      fail('AFK-Status konnte nicht gespeichert werden.', e);
      set({ statuses: prev });
    }
  },

  clearMyStatus: async () => {
    const uid = uidNow();
    if (!uid) return;
    const prev = get().statuses;
    const cur = prev[uid];
    const now = new Date().toISOString();

    if (cur?.status && cur.startedAt) {
      const durationSeconds = (Date.now() - new Date(cur.startedAt).getTime()) / 1000;
      insertStatusLog({
        userId: uid,
        status: cur.status,
        sub: cur.sub,
        description: cur.description,
        isAfk: cur.isAfk,
        startedAt: cur.startedAt,
        endedAt: now,
        durationSeconds,
      }).catch((e) => console.warn('[useStatus] log failed', e));
    }

    const next: UserStatus = { userId: uid, status: null, isAfk: false, updatedAt: now };
    set({ statuses: { ...prev, [uid]: next } });
    try {
      await upsertUserStatus({ userId: uid, status: null, isAfk: false, startedAt: null });
    } catch (e) {
      fail('Status konnte nicht beendet werden.', e);
      set({ statuses: prev });
    }
  },

  clearHistory: async () => {
    const prev = get().logs;
    set({ logs: [] });
    try {
      await clearStatusLog();
      toast.success('Status-Historie gelöscht.');
      logAudit({ action: 'delete', entityType: 'status', entityLabel: 'Status-Historie' });
    } catch (e) {
      fail('Historie konnte nicht gelöscht werden.', e);
      set({ logs: prev });
    }
  },
}));
