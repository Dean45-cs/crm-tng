import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * Steuert das manuelle (Wieder-)Öffnen der geführten Tour.
 *
 * Beim allerersten Login öffnet App.tsx die Tour automatisch über das
 * onboardingCompleted-Flag des Nutzers — dieser Store ergänzt das um
 * „jederzeit erneut ansehen": per Tastenkürzel oder Button in den
 * Einstellungen.
 *
 * Der Modus entscheidet, welches Drehbuch läuft (siehe OnboardingTour.tsx):
 * die Einarbeitung für neue Kolleg:innen oder die moderierte Präsentation vor
 * Entscheider:innen. Er liegt hier und nicht in der Komponente, damit der
 * Einstiegspunkt (Knopf, Kürzel, erster Login) ihn mitgeben kann.
 */
export type TourMode = 'onboarding' | 'presentation';

interface OnboardingState {
  open: boolean;
  mode: TourMode;
  start: (mode?: TourMode) => void;
  close: () => void;
}

export const useOnboarding = create<OnboardingState>()((set) => ({
  open: false,
  mode: 'onboarding',
  start: (mode = 'onboarding') => set({ open: true, mode }),
  // Modus beim Schließen zurücksetzen: sonst liefe eine später automatisch
  // geöffnete Tour (erster Login, onboardingCompleted noch nicht gesetzt) im
  // zuletzt gewählten Präsentationsmodus — mit dem falschen Drehbuch für
  // jemanden, der die Anwendung zum ersten Mal sieht.
  close: () => set({ open: false, mode: 'onboarding' }),
}));

/**
 * Globale Tastenkürzel: „." und „o" gleichzeitig öffnet die Einarbeitung,
 * „." und „p" die Präsentation.
 *
 * Gedrückte Tasten werden in einem Set verfolgt; sobald die Kombination
 * gleichzeitig unten ist, startet die Tour. In Eingabefeldern bleiben die
 * Kürzel stumm, damit normales Tippen (z. B. „o." in einer Notiz) nichts
 * auslöst.
 */
export function useOnboardingHotkey(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const down = new Set<string>();

    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el || !el.tagName) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      down.add(e.key.toLowerCase());
      if (!down.has('.') || isTyping(e.target)) return;
      if (down.has('o')) {
        e.preventDefault();
        useOnboarding.getState().start('onboarding');
      } else if (down.has('p')) {
        e.preventDefault();
        useOnboarding.getState().start('presentation');
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      down.delete(e.key.toLowerCase());
    };
    // Bei Fokusverlust (Alt-Tab, Klick in anderes Fenster) kommen keyup-Events
    // nicht mehr an — Set leeren, damit keine Taste „hängen" bleibt.
    const onBlur = () => down.clear();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [enabled]);
}
