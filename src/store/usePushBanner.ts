import { create } from 'zustand';
import type { AppNotification } from '../types';

/**
 * Die eingeblendeten Push-Banner — der flüchtige Teil des Postfachs.
 *
 * Bewusst getrennt von useNotifications: das Postfach ist der Bestand (was ist
 * passiert), das Banner der Moment (was ist gerade eingetroffen). Ein Banner
 * verschwindet nach ein paar Sekunden, die Meldung bleibt.
 *
 * Getrennte Datei auch aus einem praktischen Grund: useNotifications ruft
 * pushBanner() auf, und die Banner-Anzeige liest wiederum das Postfach
 * (gelesen-markieren beim Klick). In einer Datei wäre das ein Zirkelbezug.
 */

export interface Banner {
  /** Eigene ID — dieselbe Meldung kann theoretisch zweimal auflaufen. */
  id: string;
  notification: AppNotification;
  /** Zeitpunkt des Einblendens, Grundlage für „jetzt"/„vor 1 Min." im Banner. */
  shownAt: number;
}

/** So viele Banner liegen höchstens übereinander — darunter wird verdrängt. */
const MAX_VISIBLE = 4;

interface PushBannerState {
  banners: Banner[];
  push: (notification: AppNotification) => void;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

export const usePushBanner = create<PushBannerState>()((set) => ({
  banners: [],

  push: (notification) =>
    set((s) => {
      const banner: Banner = {
        id: `${notification.id}-${Date.now()}`,
        notification,
        shownAt: Date.now(),
      };
      // Neueste unten (wie in der Mitteilungszentrale wächst der Stapel nach
      // unten); ältere fallen oben heraus, sobald es zu viele werden.
      return { banners: [...s.banners, banner].slice(-MAX_VISIBLE) };
    }),

  dismiss: (id) => set((s) => ({ banners: s.banners.filter((b) => b.id !== id) })),

  dismissAll: () => set({ banners: [] }),
}));

/**
 * Ein Banner einblenden. Zusätzlich — und nur dann — eine System-Meldung, wenn
 * der Tab gerade nicht sichtbar ist: das Banner im Fenster sieht in dem Fall
 * niemand. Die Erlaubnis wird hier nie erfragt, sondern nur genutzt, wenn sie
 * schon vorliegt; erfragt wird sie auf ausdrücklichen Klick im Postfach.
 */
export function pushBanner(notification: AppNotification): void {
  usePushBanner.getState().push(notification);

  if (typeof document === 'undefined' || !document.hidden) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(notification.title, {
      body: notification.body,
      // tag = Meldungs-ID: ein zweites Zustellen derselben Meldung (etwa nach
      // einem Reconnect) ersetzt die vorhandene Systemmeldung, statt zu stapeln.
      tag: notification.id,
      icon: '/icons/icon-192.png',
    });
  } catch {
    // Manche Browser werfen ohne Service Worker (Android Chrome). Das Banner
    // im Fenster steht ohnehin — die Systemmeldung ist die Zugabe.
  }
}

/**
 * Erlaubnis für System-Meldungen einholen. Gibt den neuen Stand zurück;
 * 'unsupported', wenn der Browser sie gar nicht kennt.
 */
export async function requestSystemNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Aktueller Stand der Erlaubnis, für die Anzeige in den Einstellungen/Postfach. */
export const systemNotificationState = (): NotificationPermission | 'unsupported' =>
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
