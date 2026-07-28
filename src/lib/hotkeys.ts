/**
 * Tastenkürzel der Web-App.
 *
 * Dieselbe Schreibweise wie in der Extension und der Auskunft
 * (extension/src/shared.js): Teile mit "+" verbunden, Reihenfolge Mod, Ctrl,
 * Alt, Shift, Taste. „Mod" ist die Befehlstaste (macOS) bzw. Strg (Windows) –
 * ein Kürzel muss deshalb nicht je System doppelt gepflegt werden.
 *
 * Die Liste unten ist die einzige Wahrheit: die Einstellungsseite baut ihre
 * Zeilen daraus, und jeder Verbraucher fragt über dieselbe id nach seinem
 * Kürzel. Wer ein neues einführt, trägt es hier ein – dann steht es von selbst
 * in den Einstellungen und ist änderbar.
 *
 * Gespeichert wird lokal (localStorage), wie Theme und Palette auch, und nur
 * das Abweichende: was fehlt, gilt in der Voreinstellung.
 */

export type HotkeyId = 'palette' | 'newContract' | 'newNote' | 'newTariff';

export type HotkeyDef = {
  id: HotkeyId;
  label: string;
  hint: string;
  default: string;
};

export const HOTKEYS: HotkeyDef[] = [
  {
    id: 'palette',
    label: 'Befehlspalette',
    hint: 'Suche über Kunden, Verträge und Notizen.',
    default: 'Mod+K',
  },
  {
    id: 'newContract',
    label: 'Neuer Vertrag',
    hint: 'Schnellerfassung für einen Vertragsabschluss.',
    default: 'Mod+N',
  },
  {
    id: 'newNote',
    label: 'Neue Notiz',
    hint: 'Schnellerfassung für eine Notiz zum Kunden.',
    default: 'Mod+Shift+N',
  },
  {
    id: 'newTariff',
    label: 'Neuer Tarifwechsel',
    hint: 'Schnellerfassung für einen Tarifwechsel.',
    default: 'Mod+T',
  },
];

export type HotkeyMap = Partial<Record<HotkeyId, string>>;

const STORAGE_KEY = 'crm-hotkeys';

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
}

/** Einheitliche Schreibweise der Taste: Buchstaben groß, Leertaste als "Space". */
function normalizeKey(key: string): string {
  if (!key) return '';
  if (key === ' ' || key === 'Spacebar') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

const DEAD_KEYS = ['Meta', 'Control', 'Alt', 'Shift', 'AltGraph', 'CapsLock', 'Dead', 'OS', 'Unidentified'];

/** Aus einem Tastendruck ein Kürzel machen – leer, solange nur Zusatztasten liegen. */
export function hotkeyFromEvent(e: KeyboardEvent): string {
  const key = normalizeKey(e.key);
  if (!key || DEAD_KEYS.includes(e.key)) return '';
  const mac = isMac();
  const parts: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) parts.push('Mod');
  if (mac && e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/**
 * Passt der Tastendruck zum Kürzel? Ein leeres Kürzel passt nie – so schaltet
 * man es ab, ohne den Verbraucher anzufassen.
 *
 * Die Zusatztasten müssen exakt stimmen: sonst löste ⌘⇧N (Notiz) nebenbei auch
 * ⌘N (Vertrag) aus.
 */
export function hotkeyMatches(e: KeyboardEvent, binding: string): boolean {
  if (!binding) return false;
  const parts = binding.split('+');
  const key = parts.pop() || '';
  if (!key) return false;
  const mac = isMac();
  const want = {
    mod: parts.includes('Mod'),
    ctrl: parts.includes('Ctrl'),
    alt: parts.includes('Alt'),
    shift: parts.includes('Shift'),
  };
  if ((mac ? e.metaKey : e.ctrlKey) !== want.mod) return false;
  if (mac && e.ctrlKey !== want.ctrl) return false;
  if (e.altKey !== want.alt) return false;
  if (e.shiftKey !== want.shift) return false;
  return normalizeKey(e.key) === key;
}

/** Für die Anzeige: auf dem Mac die Zeichen der Tasten, sonst ausgeschrieben. */
export function hotkeyLabel(binding: string): string {
  if (!binding) return '';
  const mac = isMac();
  return binding
    .split('+')
    .map((part) => {
      if (part === 'Mod') return mac ? '⌘' : 'Strg';
      if (part === 'Ctrl') return mac ? '⌃' : 'Strg';
      if (part === 'Alt') return mac ? '⌥' : 'Alt';
      if (part === 'Shift') return mac ? '⇧' : 'Umschalt';
      if (part === 'Space') return 'Leertaste';
      if (part === 'Enter') return mac ? '⏎' : 'Enter';
      if (part === 'Escape') return 'Esc';
      return part;
    })
    .join(mac ? '' : '+');
}

export function getStoredHotkeys(): HotkeyMap {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as HotkeyMap) : {};
  } catch {
    return {};
  }
}

/**
 * Was für diese id gerade gilt. Ein ausdrücklich leerer Eintrag bleibt leer –
 * das ist „abgeschaltet" und darf nicht auf die Voreinstellung zurückfallen.
 */
export function resolveHotkey(id: HotkeyId, map: HotkeyMap = getStoredHotkeys()): string {
  if (Object.prototype.hasOwnProperty.call(map, id)) return map[id] ?? '';
  return HOTKEYS.find((h) => h.id === id)?.default ?? '';
}

/** Belegt ein anderes Kürzel dieselbe Taste? Gibt dessen id zurück, sonst "". */
export function hotkeyConflict(id: HotkeyId, binding: string, map: HotkeyMap): HotkeyId | '' {
  if (!binding) return '';
  const clash = HOTKEYS.find((def) => def.id !== id && resolveHotkey(def.id, map) === binding);
  return clash ? clash.id : '';
}

// Wer die aktuelle Wahl anzeigt oder auf Tasten hört, muss mitbekommen, wenn sie
// woanders geändert wird – gleiches Muster wie onThemeChange() in lib/theme.ts.
const listeners = new Set<(map: HotkeyMap) => void>();

export function onHotkeysChange(cb: (map: HotkeyMap) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function setHotkeys(map: HotkeyMap): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  listeners.forEach((cb) => cb(map));
}

/** Ein einzelnes Kürzel setzen. Gleich der Voreinstellung = kein eigener Eintrag. */
export function setHotkey(id: HotkeyId, binding: string): void {
  const next = { ...getStoredHotkeys() };
  const def = HOTKEYS.find((h) => h.id === id);
  if (def && binding === def.default) delete next[id];
  else next[id] = binding;
  setHotkeys(next);
}

export function resetHotkeys(): void {
  setHotkeys({});
}
