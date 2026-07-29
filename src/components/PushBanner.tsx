import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { usePushBanner, type Banner } from '../store/usePushBanner';
import { useNotifications } from '../store/useNotifications';
import { useRouter } from '../router';
import { notificationLook, relativeTime, toRoute } from '../lib/notifications';
import { TngMark } from './TngLogo';

/**
 * Push-Banner im Stil der Mitteilungszentrale: Materialfläche mit App-Symbol,
 * fetter Titel, zwei Zeilen Text, Zeitstempel oben rechts, Schließen-Knopf beim
 * Überfahren. Der Stapel sitzt oben rechts und wächst nach unten.
 *
 * Bewusst selbst gezeichnet statt der System-Meldung des Browsers: die sieht
 * auf jedem System anders aus (unter Windows eine eckige Kachel unten rechts).
 * Als HTML ist das Banner überall dasselbe — genau das war die Vorgabe. Die
 * System-Meldung kommt nur zusätzlich zum Zug, wenn der Tab im Hintergrund
 * liegt und das Banner niemand sehen könnte (siehe pushBanner()).
 */

/** So lange steht ein Banner, wenn niemand es anfasst. */
const DISMISS_MS = 6500;

export function PushBannerHost() {
  const banners = usePushBanner((s) => s.banners);
  if (banners.length === 0) return null;

  return (
    <div className="push-stack" role="region" aria-label="Neue Meldungen">
      {banners.map((b) => (
        <PushBannerCard key={b.id} banner={b} />
      ))}
    </div>
  );
}

function PushBannerCard({ banner }: { banner: Banner }) {
  const dismiss = usePushBanner((s) => s.dismiss);
  const markRead = useNotifications((s) => s.markRead);
  const { navigate } = useRouter();
  const [leaving, setLeaving] = useState(false);
  const [hovered, setHovered] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { notification } = banner;
  const look = notificationLook(notification.kind);

  // Ausblenden erst nach der Animation aus dem Zustand nehmen, sonst
  // verschwindet die Karte schlagartig.
  const close = () => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(() => dismiss(banner.id), 220);
  };

  // Solange die Maus darauf liegt, läuft die Uhr nicht: wer gerade liest, soll
  // nicht mitten im Satz das Banner verlieren.
  useEffect(() => {
    if (hovered || leaving) return;
    timer.current = setTimeout(close, DISMISS_MS);
    return () => clearTimeout(timer.current);
    // close ist stabil genug (nur Zustandssetzer) — Neuaufbau bei jedem Render
    // würde die Uhr endlos zurücksetzen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hovered, leaving]);

  const open = () => {
    void markRead([notification.id]);
    const link = notification.link;
    if (link?.route) {
      // Die Route kommt aus der Datenbank und ist damit nur eine Zeichenkette;
      // der Router prüft sie nicht. Ein unbekannter Name führte zu einer leeren
      // Seite — deshalb ins Postfach, wo die Meldung in jedem Fall steht.
      navigate(toRoute(link));
    } else {
      navigate({ name: 'postfach' });
    }
    close();
  };

  return (
    <div
      className={`push-banner tone-${look.tone} ${leaving ? 'is-leaving' : ''}`}
      role="alert"
      aria-live="polite"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button type="button" className="push-banner-body" onClick={open}>
        <span className="push-banner-icon" aria-hidden>
          <TngMark height={13} color="currentColor" />
        </span>
        <span className="push-banner-text">
          <span className="push-banner-head">
            <span className="push-banner-title">{notification.title}</span>
            <span className="push-banner-time">{relativeTime(notification.createdAt)}</span>
          </span>
          {notification.body && <span className="push-banner-msg">{notification.body}</span>}
        </span>
      </button>
      <button
        type="button"
        className="push-banner-close"
        onClick={close}
        aria-label="Meldung ausblenden"
      >
        <X size={11} strokeWidth={2.6} />
      </button>
    </div>
  );
}
