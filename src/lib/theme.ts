export type ThemePref = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'crm-theme';

export function getStoredTheme(): ThemePref {
  const v = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  return pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref;
}

function applyResolved(pref: ThemePref) {
  document.documentElement.setAttribute('data-theme', resolveTheme(pref));
}

// Bei „System" auf Wechsel der Betriebssystem-Einstellung reagieren.
let mql: MediaQueryList | null = null;
let mqlHandler: (() => void) | null = null;

export function setTheme(pref: ThemePref): void {
  localStorage.setItem(STORAGE_KEY, pref);
  applyResolved(pref);

  if (mql && mqlHandler) mql.removeEventListener('change', mqlHandler);
  mql = null;
  mqlHandler = null;
  if (pref === 'system') {
    mql = window.matchMedia('(prefers-color-scheme: dark)');
    mqlHandler = () => applyResolved('system');
    mql.addEventListener('change', mqlHandler);
  }
}

/** Beim App-Start aufrufen: gespeicherte Wahl anwenden + Listener aktivieren. */
export function initTheme(): void {
  setTheme(getStoredTheme());
}
