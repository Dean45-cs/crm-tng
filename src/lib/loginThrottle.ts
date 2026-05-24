/**
 * Client-seitiger Brute-Force-Schutz für den PIN-Login.
 *
 * Eine 4-stellige PIN hat nur 10.000 Kombinationen. Ohne Bremse wäre sie
 * leicht durchprobierbar. Dieser Throttle sperrt nach mehreren Fehlversuchen
 * mit eskalierender Wartezeit. Er ist eine Verteidigung in der Tiefe / UX-
 * Abschreckung — der eigentliche serverseitige Backstop sind die Auth-Rate-
 * Limits des Supabase-Projekts (Dashboard → Authentication → Rate Limits).
 */

const STORAGE_KEY = 'crm-tng-login-attempts';

/** Erst ab dem N-ten Fehlversuch wird gesperrt. */
export const FREE_ATTEMPTS = 4;
/** Basis-Sperrzeit in Sekunden (verdoppelt sich je weiterem Fehlversuch). */
const BASE_LOCK_SECONDS = 30;
/** Obergrenze der Sperrzeit. */
const MAX_LOCK_SECONDS = 15 * 60;

interface AttemptRecord {
  fails: number;
  lockedUntil: number; // epoch ms, 0 = nicht gesperrt
}

type Store = Record<string, AttemptRecord>;

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Store;
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* localStorage nicht verfügbar — ignorieren */
  }
}

/**
 * Reine Berechnung des Sperr-Endzeitpunkts. Ausgelagert und exportiert,
 * damit die Eskalationslogik ohne localStorage testbar ist.
 */
export function computeLockedUntil(fails: number, now: number): number {
  if (fails <= FREE_ATTEMPTS) return 0;
  const steps = fails - FREE_ATTEMPTS - 1;
  const seconds = Math.min(MAX_LOCK_SECONDS, BASE_LOCK_SECONDS * 2 ** steps);
  return now + seconds * 1000;
}

export interface LockStatus {
  locked: boolean;
  /** Verbleibende Sperrzeit in Sekunden (aufgerundet). */
  secondsLeft: number;
}

/** Ist der Login für diesen Namen gerade gesperrt? */
export function lockStatus(name: string, now: number = Date.now()): LockStatus {
  const rec = readStore()[normalize(name)];
  if (!rec || rec.lockedUntil <= now) return { locked: false, secondsLeft: 0 };
  return { locked: true, secondsLeft: Math.ceil((rec.lockedUntil - now) / 1000) };
}

/** Verbucht einen Fehlversuch und gibt den neuen Sperrstatus zurück. */
export function recordFailure(name: string, now: number = Date.now()): LockStatus {
  const key = normalize(name);
  const store = readStore();
  const fails = (store[key]?.fails ?? 0) + 1;
  const lockedUntil = computeLockedUntil(fails, now);
  store[key] = { fails, lockedUntil };
  writeStore(store);
  return lockedUntil > now
    ? { locked: true, secondsLeft: Math.ceil((lockedUntil - now) / 1000) }
    : { locked: false, secondsLeft: 0 };
}

/** Setzt den Zähler nach erfolgreichem Login zurück. */
export function clearFailures(name: string): void {
  const key = normalize(name);
  const store = readStore();
  if (store[key]) {
    delete store[key];
    writeStore(store);
  }
}

/** Formatiert die Wartezeit für eine Nutzer-Meldung. */
export function formatLockMessage(secondsLeft: number): string {
  if (secondsLeft >= 60) {
    const min = Math.ceil(secondsLeft / 60);
    return `Zu viele Fehlversuche. Bitte warte ${min} Minute${min === 1 ? '' : 'n'}.`;
  }
  return `Zu viele Fehlversuche. Bitte warte ${secondsLeft} Sekunde${secondsLeft === 1 ? '' : 'n'}.`;
}
