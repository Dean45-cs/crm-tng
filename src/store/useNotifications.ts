import { create } from 'zustand';
import type { AppNotification, NotificationKind, NotificationLink } from '../types';
import { getSupabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { toast } from './useToast';
import {
  fetchNotifications,
  insertNotifications,
  markNotificationsRead,
  markAllNotificationsRead,
  deleteNotificationRow,
  deleteAllNotifications,
} from '../lib/supabaseApi';
import { pushBanner } from './usePushBanner';

/**
 * Das Postfach: alle Meldungen des angemeldeten Users, live gehalten über
 * Supabase-Realtime. Zwei Dinge hängen daran:
 *
 *   1. Die Postfach-Seite und die Glocke in der Titelleiste (Ungelesen-Zähler).
 *   2. Das Push-Banner — jede neu eintreffende Meldung wird einmal eingeblendet.
 *
 * Anders als die übrigen Stores wird hier NICHT komplett nachgeladen, wenn
 * Realtime etwas meldet: die INSERT-Nutzlast enthält die neue Zeile bereits,
 * und nur so lässt sich „das ist gerade eingetroffen" von „das war beim Laden
 * schon da" unterscheiden. Ein Vollabgleich würde jede Meldung beim ersten
 * Laden als frisch einblenden.
 */

interface NotificationRealtimePayload {
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
}

/** Realtime liefert die rohe Zeile (snake_case) — hier auf unsere Form bringen. */
function mapRealtimeRow(row: Record<string, unknown>): AppNotification {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    kind: row.kind as NotificationKind,
    title: String(row.title ?? ''),
    body: (row.body as string | null) ?? undefined,
    link: (row.link as NotificationLink | null) ?? undefined,
    actorId: (row.actor_id as string | null) ?? undefined,
    actorName: (row.actor_name as string | null) ?? undefined,
    entityId: (row.entity_id as string | null) ?? undefined,
    readAt: (row.read_at as string | null) ?? undefined,
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

interface NotificationsState {
  items: AppNotification[];
  loaded: boolean;

  load: () => Promise<void>;
  reset: () => void;
  subscribeRealtime: () => () => void;

  markRead: (ids: string[]) => Promise<void>;
  markAllRead: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useNotifications = create<NotificationsState>()((set, get) => ({
  items: [],
  loaded: false,

  load: async () => {
    try {
      const items = await fetchNotifications();
      set({ items, loaded: true });
    } catch {
      // Migration 023 evtl. noch nicht eingespielt — leer laden statt zu
      // crashen (gleiches Toleranzmuster wie useShifts/useCalls).
      set({ items: [], loaded: true });
    }
  },

  reset: () => set({ items: [], loaded: false }),

  subscribeRealtime: () => {
    const sb = getSupabase();
    const channel = sb
      .channel('crm-tng-notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload: NotificationRealtimePayload) => {
          if (!payload.new) return;
          const item = mapRealtimeRow(payload.new);
          // RLS liefert ohnehin nur eigene Zeilen; der Vergleich schützt davor,
          // dass ein Kanalwechsel beim Nutzerwechsel eine fremde Meldung einblendet.
          if (item.userId !== useAuth.getState().currentUserKey) return;
          // Doppelte ignorieren: beim Zustellen an mehrere Empfänger kann der
          // eigene Insert auch über den Kanal zurückkommen.
          if (get().items.some((n) => n.id === item.id)) return;
          set((s) => ({ items: [item, ...s.items] }));
          pushBanner(item);
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications' },
        (payload: NotificationRealtimePayload) => {
          if (!payload.new) return;
          const item = mapRealtimeRow(payload.new);
          // Gelesen-Markierung von einem anderen Gerät/Tab nachziehen —
          // ohne Banner, es ist nichts Neues passiert.
          set((s) => ({ items: s.items.map((n) => (n.id === item.id ? item : n)) }));
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'notifications' },
        (payload: NotificationRealtimePayload) => {
          const id = payload.old?.id;
          if (!id) return;
          set((s) => ({ items: s.items.filter((n) => n.id !== id) }));
        },
      )
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  },

  markRead: async (ids) => {
    const open = ids.filter((id) => get().items.some((n) => n.id === id && !n.readAt));
    if (open.length === 0) return;
    const now = new Date().toISOString();
    const prev = get().items;
    set({ items: prev.map((n) => (open.includes(n.id) ? { ...n, readAt: now } : n)) });
    try {
      await markNotificationsRead(open);
    } catch {
      set({ items: prev });
    }
  },

  markAllRead: async () => {
    const prev = get().items;
    if (!prev.some((n) => !n.readAt)) return;
    const now = new Date().toISOString();
    set({ items: prev.map((n) => (n.readAt ? n : { ...n, readAt: now })) });
    try {
      await markAllNotificationsRead();
    } catch {
      toast.error('Konnte nicht als gelesen markiert werden.');
      set({ items: prev });
    }
  },

  remove: async (id) => {
    const prev = get().items;
    set({ items: prev.filter((n) => n.id !== id) });
    try {
      await deleteNotificationRow(id);
    } catch {
      toast.error('Meldung konnte nicht gelöscht werden.');
      set({ items: prev });
    }
  },

  clearAll: async () => {
    const prev = get().items;
    if (prev.length === 0) return;
    set({ items: [] });
    try {
      await deleteAllNotifications();
      toast.success('Postfach geleert.');
    } catch {
      toast.error('Postfach konnte nicht geleert werden.');
      set({ items: prev });
    }
  },
}));

/** Ungelesen-Zähler für die Glocke. */
export const unreadCount = (items: AppNotification[]): number =>
  items.reduce((n, item) => (item.readAt ? n : n + 1), 0);

/**
 * Meldungen zustellen — der einzige Weg, über den die App etwas ins Postfach
 * anderer legt. Der Absender ist immer der angemeldete User (die RLS-Policy
 * verlangt actor_id = auth.uid()), und niemand benachrichtigt sich selbst.
 *
 * Fehler blockieren nie den auslösenden Vorgang — eine nicht zugestellte
 * Meldung ist ärgerlich, ein abgebrochener Schichtplan-Speichervorgang wäre
 * schlimmer (gleiche Haltung wie logAudit()).
 */
export function notify(
  recipients: string[],
  payload: {
    kind: NotificationKind;
    title: string;
    body?: string;
    link?: NotificationLink;
    entityId?: string;
  },
): Promise<void> {
  const actor = useAuth.getState().getCurrentUser();
  if (!actor) return Promise.resolve();

  const targets = Array.from(new Set(recipients)).filter((id) => id && id !== actor.key);
  if (targets.length === 0) return Promise.resolve();

  return insertNotifications(
    targets.map((userId) => ({
      userId,
      kind: payload.kind,
      title: payload.title,
      body: payload.body,
      link: payload.link,
      actorId: actor.key,
      actorName: actor.displayName,
      entityId: payload.entityId,
    })),
  ).catch((e) => {
    console.warn('[notify] Zustellung fehlgeschlagen:', e instanceof Error ? e.message : e);
  });
}
