import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * Steuert das manuelle (Wieder-)Öffnen der Einführungstour.
 * Beim allerersten Login öffnet App.tsx die Tour automatisch über das
 * onboardingCompleted-Flag des Nutzers — dieser Store ergänzt das um
 * „jederzeit erneut ansehen": per Tastenkürzel oder Button in den
 * Einstellungen.
 */
interface OnboardingState {
  open: boolean;
  start: () => void;
  close: () => void;
}

export const useOnboarding = create<OnboardingState>()((set) => ({
  open: false,
  start: () => set({ open: true }),
  close: () => set({ open: false }),
}));

/**
 * Globales Tastenkürzel: „." und „o" gleichzeitig gedrückt öffnet die Tour.
 * Gedrückte Tasten werden in einem Set verfolgt; sobald beide gleichzeitig
 * unten sind, startet die Tour. In Eingabefeldern bleibt das Kürzel stumm,
 * damit normales Tippen (z. B. „o." in einer Notiz) nichts auslöst.
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
      if (down.has('.') && down.has('o') && !isTyping(e.target)) {
        e.preventDefault();
        useOnboarding.getState().start();
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
