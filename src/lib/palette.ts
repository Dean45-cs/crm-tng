// Persönliches Farbschema der App (Phase 2 der Theme-/Layout-Anpassung).
// Getrenntes Modul von theme.ts, weil das dort bereits vorhandene
// ThemePref ('light'|'dark'|'system') eine unabhängige Achse ist (Helligkeit),
// während hier die Markenfarbe selbst (Preset + freie Overrides) gewählt wird.
// Gleiches Rollen-Schema wie extension/src/theme.js, damit ein gespeichertes
// Farbschema später leicht surface-übergreifend synchronisiert werden könnte.

export type PaletteId = 'crm' | 'jira' | 'custom';

export type PaletteRole =
  | 'accent'
  | 'accentDark'
  | 'background'
  | 'surface'
  | 'textPrimary'
  | 'textMuted'
  | 'border'
  | 'success'
  | 'warning'
  | 'danger';

export type PaletteState = {
  presetId: PaletteId;
  overrides: Partial<Record<PaletteRole, string>>;
};

const STORAGE_KEY = 'crm-palette';

const ROLE_TO_VAR: Record<PaletteRole, string> = {
  accent: '--tng-blue',
  accentDark: '--tng-blue-dark',
  background: '--bg-app',
  surface: '--bg-card',
  textPrimary: '--text',
  textMuted: '--text-secondary',
  border: '--border',
  success: '--green',
  warning: '--orange',
  danger: '--red',
};

// "crm" = die heutige TNG-Markenfarbe (Default — bleibt für alle, die das
// Farbschema nie anfassen, garantiert unverändert). "jira" = zweites Preset,
// angelehnt an das Jira-Blau aus der Chrome-Extension.
const PRESETS: Record<'crm' | 'jira', Record<PaletteRole, string>> = {
  crm: {
    accent: '#0066b3', accentDark: '#004a85', background: '#f2f3f7',
    surface: '#ffffff', textPrimary: '#1d1d1f', textMuted: '#5e5e63',
    border: '#e2e2e6', success: '#34c759', warning: '#ff9500',
    danger: '#ff3b30',
  },
  jira: {
    accent: '#0c66e4', accentDark: '#0055cc', background: '#f7f8fa',
    surface: '#ffffff', textPrimary: '#172b4d', textMuted: '#5e6c84',
    border: '#dfe1e6', success: '#216e4e', warning: '#974f0c',
    danger: '#ae2e24',
  },
};

export const DEFAULT_PALETTE: PaletteState = { presetId: 'crm', overrides: {} };

export function resolvePaletteColors(state: PaletteState): Record<PaletteRole, string> {
  const preset = PRESETS[state.presetId === 'jira' ? 'jira' : 'crm'];
  return { ...preset, ...state.overrides };
}

export function getStoredPalette(): PaletteState {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  if (!raw) return { ...DEFAULT_PALETTE, overrides: {} };
  try {
    const parsed = JSON.parse(raw);
    return normalizePalette(parsed);
  } catch {
    return { ...DEFAULT_PALETTE, overrides: {} };
  }
}

export function normalizePalette(raw: unknown): PaletteState {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PALETTE, overrides: {} };
  const r = raw as Partial<PaletteState>;
  const presetId: PaletteId = r.presetId === 'jira' || r.presetId === 'custom' ? r.presetId : 'crm';
  const overrides: Partial<Record<PaletteRole, string>> = {};
  if (r.overrides && typeof r.overrides === 'object') {
    for (const role of Object.keys(r.overrides) as PaletteRole[]) {
      const value = r.overrides[role];
      if (ROLE_TO_VAR[role] && typeof value === 'string' && value) overrides[role] = value;
    }
  }
  return { presetId, overrides };
}

// Setzt die Farb-Variablen als Inline-Style an <html>. WICHTIG: index.css
// definiert für background/surface/textPrimary/textMuted/border eigene Werte
// unter :root[data-theme='dark'] — ein Inline-Style gewinnt dagegen immer,
// unabhängig vom aktuell gewählten Hell/Dunkel-Modus. Ein pauschal für alle
// Rollen gesetzter Inline-Wert würde den Hell/Dunkel-Umschalter für JEDEN
// Nutzer kaputt machen, nicht nur für den, der etwas anpasst. Deshalb nur
// Rollen anfassen, die tatsächlich vom Standard abweichen (eigenes Preset
// ODER eine konkrete Override-Rolle) — alle anderen bleiben unter Kontrolle
// von index.css (removeProperty räumt einen zuvor gesetzten Wert wieder weg,
// z. B. bei „Zurücksetzen").
// Abgeleitete Akzent-Familie: index.css definiert Buttons, aktive Sidebar,
// Chips und Badges NICHT über --tng-blue, sondern über hartcodierte Tokens
// (--tng-gradient, --tng-blue-50/-100, --tng-gradient-soft, --shadow-tng). Wer
// nur --tng-blue umsetzt, färbt darum Links, aber keine Buttons. Deshalb werden
// diese Tokens hier zur Laufzeit aus der gewählten Akzentfarbe berechnet, damit
// die Akzentwahl tatsächlich bis zu den Buttons durchschlägt.
const ACCENT_DERIVED_VARS = [
  '--tng-blue-light',
  '--tng-blue-50',
  '--tng-blue-100',
  '--tng-gradient',
  '--tng-gradient-soft',
  '--shadow-tng',
] as const;

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function mixWithWhite([r, g, b]: [number, number, number], amount: number): string {
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function applyAccentFamily(root: HTMLElement, accent: string, accentDark: string): void {
  const rgb = hexToRgb(accent);
  if (!rgb) return; // nicht-hex (z. B. rgba) → Akzent-Familie unverändert lassen
  const [r, g, b] = rgb;
  const rgba = (a: number) => `rgba(${r}, ${g}, ${b}, ${a})`;
  root.style.setProperty('--tng-blue-light', mixWithWhite(rgb, 0.4));
  root.style.setProperty('--tng-blue-50', rgba(0.14));
  root.style.setProperty('--tng-blue-100', rgba(0.22));
  root.style.setProperty('--tng-gradient', `linear-gradient(180deg, ${accent} 0%, ${accentDark} 100%)`);
  root.style.setProperty('--tng-gradient-soft', `linear-gradient(135deg, ${rgba(0.08)}, ${rgba(0.05)})`);
  root.style.setProperty('--shadow-tng', `0 2px 8px ${rgba(0.2)}`);
}

export function applyPalette(state: PaletteState): void {
  const root = document.documentElement;
  const presetChanged = state.presetId !== 'crm';
  const colors = resolvePaletteColors(state);
  (Object.keys(ROLE_TO_VAR) as PaletteRole[]).forEach((role) => {
    const touched = presetChanged || Object.prototype.hasOwnProperty.call(state.overrides, role);
    if (touched) root.style.setProperty(ROLE_TO_VAR[role], colors[role]);
    else root.style.removeProperty(ROLE_TO_VAR[role]);
  });

  // Akzent-Familie nur setzen, wenn Akzent tatsächlich abweicht — sonst
  // entfernen, damit die (auch dunkelmodus-abhängigen) Defaults aus index.css
  // wieder greifen.
  const accentTouched =
    presetChanged ||
    Object.prototype.hasOwnProperty.call(state.overrides, 'accent') ||
    Object.prototype.hasOwnProperty.call(state.overrides, 'accentDark');
  if (accentTouched) applyAccentFamily(root, colors.accent, colors.accentDark);
  else ACCENT_DERIVED_VARS.forEach((v) => root.style.removeProperty(v));
}

export function setPalette(state: PaletteState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  applyPalette(state);
}

export function resetPalette(): void {
  const state = { ...DEFAULT_PALETTE, overrides: {} };
  setPalette(state);
}

/** Beim App-Start aufrufen: gespeicherte Wahl anwenden. */
export function initPalette(): void {
  applyPalette(getStoredPalette());
}

export { ROLE_TO_VAR as PALETTE_ROLE_TO_VAR };
