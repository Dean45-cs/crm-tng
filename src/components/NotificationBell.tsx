import { useEffect, useRef, useState } from 'react';
import { Bell, Inbox } from 'lucide-react';
import { useNotifications, unreadCount } from '../store/useNotifications';
import { useRouter } from '../router';
import { notificationLook, relativeTime, toRoute } from '../lib/notifications';

/**
 * Die Glocke in der Titelleiste: Ungelesen-Zähler plus die letzten Meldungen
 * im Schnellzugriff. Sie ersetzt das Postfach nicht — sie zeigt, ob sich ein
 * Blick lohnt, und führt mit einem Klick dorthin.
 */

/** So viele stehen in der Kurzübersicht; alles Weitere im Postfach. */
const PREVIEW = 6;

export function NotificationBell() {
  const items = useNotifications((s) => s.items);
  const markRead = useNotifications((s) => s.markRead);
  const markAllRead = useNotifications((s) => s.markAllRead);
  const { navigate } = useRouter();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const unread = unreadCount(items);
  const preview = items.slice(0, PREVIEW);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  const openItem = (id: string, link?: { route: string; kdnr?: string; agentKey?: string }) => {
    void markRead([id]);
    setOpen(false);
    navigate(link?.route ? toRoute(link) : { name: 'postfach' });
  };

  return (
    <div ref={wrapRef} className="bell-wrap">
      <button
        type="button"
        className={`bell-trigger${unread > 0 ? ' has-unread' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={unread > 0 ? `Postfach — ${unread} ungelesen` : 'Postfach'}
        title={unread > 0 ? `${unread} ungelesene Meldungen` : 'Postfach'}
      >
        <Bell size={16} />
        {unread > 0 && <span className="bell-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="bell-pop" role="dialog" aria-label="Postfach">
          <div className="bell-pop-head">
            <strong>Postfach</strong>
            {unread > 0 && (
              <button type="button" className="bell-pop-link" onClick={() => void markAllRead()}>
                Alles gelesen
              </button>
            )}
          </div>

          {preview.length === 0 ? (
            <div className="bell-pop-empty">
              <Inbox size={22} strokeWidth={1.5} />
              <span>Keine Meldungen</span>
            </div>
          ) : (
            <div className="bell-pop-list">
              {preview.map((n) => {
                const look = notificationLook(n.kind);
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={`bell-pop-item tone-${look.tone}${n.readAt ? '' : ' is-unread'}`}
                    onClick={() => openItem(n.id, n.link)}
                  >
                    <span className="bell-pop-item-dot" aria-hidden />
                    <span className="bell-pop-item-text">
                      <span className="bell-pop-item-title">{n.title}</span>
                      {n.body && <span className="bell-pop-item-body">{n.body}</span>}
                    </span>
                    <span className="bell-pop-item-time">{relativeTime(n.createdAt)}</span>
                  </button>
                );
              })}
            </div>
          )}

          <button
            type="button"
            className="bell-pop-all"
            onClick={() => {
              setOpen(false);
              navigate({ name: 'postfach' });
            }}
          >
            Postfach öffnen
          </button>
        </div>
      )}
    </div>
  );
}
