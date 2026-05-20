import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Modul-level: registriert sich BEVOR React rendert. Browser feuern
// `beforeinstallprompt` typischerweise einmalig vor dem Login — eine
// Komponente, die ihren Listener im `useEffect` registriert (was erst
// nach Mount läuft), verpasst das Event und zeigt den Install-Button nie.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = computeInstalled();
const listeners = new Set<() => void>();

function computeInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

function notify() {
  listeners.forEach((fn) => fn());
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferredPrompt = null;
    notify();
  });
  // Falls die App schon als Standalone läuft, aktualisiert sich der Status
  // auch ohne Reload (z. B. Tab in PWA umgehängt).
  try {
    const mq = window.matchMedia('(display-mode: standalone)');
    mq.addEventListener('change', (e) => {
      if (e.matches) {
        installed = true;
        deferredPrompt = null;
        notify();
      }
    });
  } catch {
    /* ältere Browser ohne MediaQueryList.addEventListener */
  }
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): string {
  return `${deferredPrompt ? '1' : '0'}|${installed ? '1' : '0'}`;
}

export function usePwaInstall(): {
  canInstall: boolean;
  installed: boolean;
  install: () => Promise<boolean>;
} {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    canInstall: !!deferredPrompt && !installed,
    installed,
    install: async () => {
      const ev = deferredPrompt;
      if (!ev) return false;
      // BeforeInstallPromptEvent kann nur einmal mit prompt() benutzt werden —
      // sofort räumen, damit kein Doppelklick einen Fehler wirft.
      deferredPrompt = null;
      notify();
      try {
        await ev.prompt();
        const { outcome } = await ev.userChoice;
        return outcome === 'accepted';
      } catch {
        return false;
      }
    },
  };
}
