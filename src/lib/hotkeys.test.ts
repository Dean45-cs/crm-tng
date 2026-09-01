import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  HOTKEYS,
  hotkeyConflict,
  hotkeyFromEvent,
  hotkeyLabel,
  hotkeyMatches,
  resolveHotkey,
  setHotkey,
  getStoredHotkeys,
  resetHotkeys,
} from './hotkeys';

/**
 * „Mod" ist je nach System eine andere Taste. Steht das schief, äußert es sich
 * nicht als Fehler, sondern als „das Kürzel tut nichts" – auf einem System, das
 * man gerade nicht vor sich hat. Deshalb wird hier beides durchgespielt.
 *
 * Dieselben Zusagen prüft extension/test/hotkeys.test.js für die Extension und
 * die Auskunft; das Format ist absichtlich identisch.
 */

// Die Tests laufen im Node-Environment (vitest.config.ts) – Browser-Globals
// gibt es hier nicht. Beide werden deshalb gestellt: die Plattform, weil sie
// die Bedeutung von „Mod" bestimmt, und ein Speicher, weil das Modul dort seine
// Wahl ablegt.
function setPlatform(value: string) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { platform: value, userAgent: value },
    configurable: true,
    writable: true,
  });
}

function installLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => void data.set(key, String(value)),
      removeItem: (key: string) => void data.delete(key),
      clear: () => data.clear(),
    },
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  installLocalStorage();
});

function press(key: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  } as KeyboardEvent;
}

afterEach(() => {
  localStorage.clear();
});

describe('Tastenkürzel: „Mod" ist die Taste des jeweiligen Systems', () => {
  it('macOS: ⌘ ist Mod, Strg ist es nicht', () => {
    setPlatform('MacIntel');
    expect(hotkeyMatches(press('k', { metaKey: true }), 'Mod+K')).toBe(true);
    // Auf dem Mac gehört Strg+K dem Betriebssystem (Zeile löschen) – es darf
    // nicht nebenbei die Palette öffnen.
    expect(hotkeyMatches(press('k', { ctrlKey: true }), 'Mod+K')).toBe(false);
  });

  it('Windows: Strg ist Mod', () => {
    setPlatform('Win32');
    expect(hotkeyMatches(press('k', { ctrlKey: true }), 'Mod+K')).toBe(true);
    expect(hotkeyMatches(press('k', { metaKey: true }), 'Mod+K')).toBe(false);
  });
});

describe('Tastenkürzel: Zusatztasten müssen exakt stimmen', () => {
  beforeEach(() => setPlatform('MacIntel'));

  it('⌘⇧N löst nicht zusätzlich ⌘N aus', () => {
    // Sonst legte die Schnellerfassung bei „Neue Notiz" auch einen Vertrag an.
    expect(hotkeyMatches(press('n', { metaKey: true, shiftKey: true }), 'Mod+N')).toBe(false);
    expect(hotkeyMatches(press('n', { metaKey: true, shiftKey: true }), 'Mod+Shift+N')).toBe(true);
    expect(hotkeyMatches(press('n', { metaKey: true }), 'Mod+N')).toBe(true);
  });

  it('ein leeres Kürzel passt nie – so schaltet man es ab', () => {
    expect(hotkeyMatches(press('n', { metaKey: true }), '')).toBe(false);
  });
});

describe('Tastenkürzel: aufnehmen und beschriften', () => {
  it('macht aus einem Tastendruck die gespeicherte Schreibweise', () => {
    setPlatform('MacIntel');
    expect(hotkeyFromEvent(press('k', { metaKey: true }))).toBe('Mod+K');
    expect(hotkeyFromEvent(press('N', { metaKey: true, shiftKey: true }))).toBe('Mod+Shift+N');
    expect(hotkeyFromEvent(press(' ', { metaKey: true }))).toBe('Mod+Space');
  });

  it('wartet, solange nur Zusatztasten liegen', () => {
    setPlatform('MacIntel');
    expect(hotkeyFromEvent(press('Meta', { metaKey: true }))).toBe('');
    expect(hotkeyFromEvent(press('Shift', { shiftKey: true }))).toBe('');
  });

  it('beschriftet je System unterschiedlich', () => {
    setPlatform('MacIntel');
    expect(hotkeyLabel('Mod+Shift+N')).toBe('⌘⇧N');
    setPlatform('Win32');
    expect(hotkeyLabel('Mod+Shift+N')).toBe('Strg+Umschalt+N');
  });
});

describe('Tastenkürzel: speichern und nachschlagen', () => {
  beforeEach(() => {
    setPlatform('MacIntel');
  });

  it('ohne eigene Angabe gilt die Voreinstellung', () => {
    expect(resolveHotkey('palette')).toBe('Mod+K');
  });

  it('eine eigene Angabe geht vor und überlebt das Neuladen', () => {
    setHotkey('palette', 'Mod+Shift+P');
    expect(resolveHotkey('palette')).toBe('Mod+Shift+P');
    expect(getStoredHotkeys()).toEqual({ palette: 'Mod+Shift+P' });
  });

  it('zurück auf die Voreinstellung hinterlässt keinen Eintrag', () => {
    // Sonst bliebe eine Kopie stehen, die eine spätere Änderung der
    // Voreinstellung still aussitzt.
    setHotkey('palette', 'Mod+Shift+P');
    setHotkey('palette', 'Mod+K');
    expect(getStoredHotkeys()).toEqual({});
  });

  it('abgeschaltet bleibt abgeschaltet', () => {
    setHotkey('palette', '');
    expect(resolveHotkey('palette')).toBe('');
    expect(getStoredHotkeys()).toEqual({ palette: '' });
  });

  it('alles zurücksetzen räumt auf', () => {
    setHotkey('palette', 'Mod+J');
    resetHotkeys();
    expect(getStoredHotkeys()).toEqual({});
    expect(resolveHotkey('palette')).toBe('Mod+K');
  });
});

describe('Tastenkürzel: Doppelbelegung', () => {
  beforeEach(() => setPlatform('MacIntel'));

  it('meldet, wer die Taste schon hat', () => {
    expect(hotkeyConflict('newNote', 'Mod+K', {})).toBe('palette');
    expect(hotkeyConflict('newNote', 'Mod+J', {})).toBe('');
    expect(hotkeyConflict('palette', 'Mod+K', {})).toBe('');
  });

  it('gibt die Taste frei, wenn der andere umgelegt wurde', () => {
    expect(hotkeyConflict('newNote', 'Mod+K', { palette: 'Mod+P' })).toBe('');
  });
});

describe('Tastenkürzel: die Liste selbst', () => {
  beforeEach(() => setPlatform('MacIntel'));

  it('ist in sich stimmig', () => {
    const ids = HOTKEYS.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    HOTKEYS.forEach((def) => {
      expect(def.label).toBeTruthy();
      expect(def.hint).toBeTruthy();
      // Eine ab Werk doppelt belegte Voreinstellung wäre kaputt und in den
      // Einstellungen nicht mehr zu retten.
      expect(hotkeyConflict(def.id, def.default, {})).toBe('');
    });
  });
});
