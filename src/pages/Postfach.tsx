import { useEffect, useMemo, useState } from 'react';
import {
  Inbox,
  CalendarDays,
  ArrowLeftRight,
  Check,
  X,
  Megaphone,
  Gift,
  Info,
  Bell,
  CheckCheck,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../store/useAuth';
import { useNotifications } from '../store/useNotifications';
import { useSwaps } from '../store/useSwaps';
import { requestSystemNotifications, systemNotificationState } from '../store/usePushBanner';
import { useRouter } from '../router';
import { notificationLook, relativeTime, dayHeading, toRoute } from '../lib/notifications';
import { toast } from '../store/useToast';
import { SkeletonTable } from '../components/Skeleton';
import { SwapActions } from '../components/SwapActions';
import type { AppNotification, NotificationKind, ShiftSwapRequest } from '../types';

/**
 * Das Postfach: alles, worüber jemand Bescheid wissen muss, an einer Stelle —
 * Schichtplan-Änderungen, Tauschanfragen, Kampagnen, System-Hinweise.
 *
 * Tauschanfragen sind hier nicht nur Text, sondern haben ihre Knöpfe direkt an
 * der Meldung: Annehmen/Ablehnen für den Gefragten, Zurückziehen für den
 * Fragenden, Bestätigen/Ablehnen für den Chef. Wer eine Anfrage bekommt, soll
 * sie beantworten können, ohne erst in den Schichtplan zu wechseln.
 */

const KIND_ICON: Record<NotificationKind, React.ReactNode> = {
  'shift-changed': <CalendarDays size={15} />,
  'swap-requested': <ArrowLeftRight size={15} />,
  'swap-accepted': <Check size={15} />,
  'swap-declined': <X size={15} />,
  'swap-cancelled': <X size={15} />,
  'swap-approved': <Check size={15} />,
  'swap-rejected': <X size={15} />,
  campaign: <Megaphone size={15} />,
  incentive: <Gift size={15} />,
  system: <Info size={15} />,
};

type Filter = 'all' | 'unread';

export function Postfach() {
  const { getCurrentUser, isManager } = useAuth();
  const me = getCurrentUser();
  const manager = isManager();

  const items = useNotifications((s) => s.items);
  const loaded = useNotifications((s) => s.loaded);
  const markRead = useNotifications((s) => s.markRead);
  const markAllRead = useNotifications((s) => s.markAllRead);
  const remove = useNotifications((s) => s.remove);
  const clearAll = useNotifications((s) => s.clearAll);

  const swaps = useSwaps((s) => s.requests);
  const loadSwaps = useSwaps((s) => s.load);

  const [filter, setFilter] = useState<Filter>('all');
  const [permission, setPermission] = useState(systemNotificationState);

  // Offene Anfragen werden für die Inline-Knöpfe gebraucht — der Schichtplan
  // lädt sie sonst erst, wenn man ihn öffnet.
  useEffect(() => {
    loadSwaps();
  }, [loadSwaps]);

  const shown = useMemo(
    () => (filter === 'unread' ? items.filter((n) => !n.readAt) : items),
    [items, filter],
  );

  // Nach Tagen gruppieren — eine flache Liste von 200 Meldungen liest niemand.
  const groups = useMemo(() => {
    const out: { heading: string; items: AppNotification[] }[] = [];
    for (const item of shown) {
      const heading = dayHeading(item.createdAt);
      const last = out[out.length - 1];
      if (last && last.heading === heading) last.items.push(item);
      else out.push({ heading, items: [item] });
    }
    return out;
  }, [shown]);

  const unread = items.filter((n) => !n.readAt).length;

  const askPermission = async () => {
    const next = await requestSystemNotifications();
    if (next === 'unsupported') {
      toast.error('Dieser Browser kennt keine System-Meldungen.');
      return;
    }
    setPermission(next);
    if (next === 'granted') toast.success('System-Meldungen sind erlaubt.');
    else if (next === 'denied') toast.info('System-Meldungen bleiben aus — im Fenster erscheinen sie weiterhin.');
  };

  const emptyAll = () => {
    if (items.length === 0) return;
    if (!confirm(`Alle ${items.length} Meldungen löschen? Das lässt sich nicht rückgängig machen.`)) return;
    void clearAll();
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Postfach</h2>
          <p>
            {unread > 0
              ? `${unread} ungelesene ${unread === 1 ? 'Meldung' : 'Meldungen'} — Schichtplan, Tauschanfragen und alles Weitere.`
              : 'Alles gelesen. Hier laufen Schichtplan-Änderungen, Tauschanfragen und Hinweise auf.'}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-sm" onClick={() => void markAllRead()} disabled={unread === 0}>
            <CheckCheck size={13} /> Alles gelesen
          </button>
          <button className="btn btn-sm" onClick={emptyAll} disabled={items.length === 0}>
            <Trash2 size={13} /> Leeren
          </button>
        </div>
      </div>

      {/* Nur zeigen, solange die Erlaubnis wirklich noch aussteht — ein Hinweis,
          der bleibt, nachdem man ihn befolgt hat, ist ein Ärgernis. */}
      {permission === 'default' && (
        <div className="widget postfach-permission">
          <Bell size={16} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>Auch dann Bescheid wissen, wenn das CRM im Hintergrund läuft</strong>
            <div className="muted" style={{ fontSize: 12.5 }}>
              Im Fenster erscheinen Meldungen ohnehin. Mit der Erlaubnis meldet sich das
              System zusätzlich, wenn dieser Tab gerade nicht vorn ist.
            </div>
          </div>
          <button className="btn btn-sm btn-primary" onClick={() => void askPermission()}>
            Erlauben
          </button>
        </div>
      )}

      <div className="postfach-filter" role="group" aria-label="Filter">
        <button
          type="button"
          className={`postfach-filter-btn ${filter === 'all' ? 'is-active' : ''}`}
          onClick={() => setFilter('all')}
          aria-pressed={filter === 'all'}
        >
          Alle <span className="postfach-filter-count">{items.length}</span>
        </button>
        <button
          type="button"
          className={`postfach-filter-btn ${filter === 'unread' ? 'is-active' : ''}`}
          onClick={() => setFilter('unread')}
          aria-pressed={filter === 'unread'}
        >
          Ungelesen <span className="postfach-filter-count">{unread}</span>
        </button>
      </div>

      {!loaded ? (
        <SkeletonTable rows={5} cols={2} />
      ) : shown.length === 0 ? (
        <div className="widget empty">
          <Inbox size={32} strokeWidth={1.4} className="empty-icon" />
          <h3>{filter === 'unread' ? 'Nichts Ungelesenes' : 'Noch keine Meldungen'}</h3>
          <p>
            {filter === 'unread'
              ? 'Alle Meldungen sind gelesen.'
              : 'Sobald sich am Schichtplan etwas ändert oder jemand tauschen möchte, steht es hier.'}
          </p>
        </div>
      ) : (
        <div className="postfach-list">
          {groups.map((group) => (
            <section key={group.heading}>
              <h3 className="postfach-day">{group.heading}</h3>
              {group.items.map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  swap={n.entityId ? swaps.find((r) => r.id === n.entityId) : undefined}
                  myId={me?.key ?? ''}
                  manager={manager}
                  onRead={() => void markRead([n.id])}
                  onRemove={() => void remove(n.id)}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  notification,
  swap,
  myId,
  manager,
  onRead,
  onRemove,
}: {
  notification: AppNotification;
  swap?: ShiftSwapRequest;
  myId: string;
  manager: boolean;
  onRead: () => void;
  onRemove: () => void;
}) {
  const { navigate } = useRouter();
  const look = notificationLook(notification.kind);
  const unread = !notification.readAt;

  const goToTarget = () => {
    onRead();
    if (notification.link?.route) navigate(toRoute(notification.link));
  };

  return (
    <div className={`postfach-item tone-${look.tone} ${unread ? 'is-unread' : ''}`}>
      <span className="postfach-item-icon" aria-hidden>
        {KIND_ICON[notification.kind] ?? <Info size={15} />}
      </span>

      <div className="postfach-item-main">
        <button type="button" className="postfach-item-open" onClick={goToTarget}>
          <span className="postfach-item-title">{notification.title}</span>
          {notification.body && <span className="postfach-item-body">{notification.body}</span>}
        </button>

        {swap && <SwapActions swap={swap} myId={myId} manager={manager} />}
      </div>

      <div className="postfach-item-side">
        <span className="postfach-item-time">{relativeTime(notification.createdAt)}</span>
        <div className="postfach-item-tools">
          {unread && (
            <button
              type="button"
              className="postfach-item-tool"
              onClick={onRead}
              title="Als gelesen markieren"
              aria-label="Als gelesen markieren"
            >
              <Check size={13} />
            </button>
          )}
          <button
            type="button"
            className="postfach-item-tool"
            onClick={onRemove}
            title="Meldung löschen"
            aria-label="Meldung löschen"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
