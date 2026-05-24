/**
 * Zentrale Fehler-Erfassung.
 *
 * Aktuell wird auf die Konsole geloggt. Der Hook ist bewusst zentral, damit
 * später ein Dienst wie Sentry an genau einer Stelle angebunden werden kann
 * (z. B. in `init()` Sentry.init und hier Sentry.captureException). So müssen
 * die Aufrufstellen nicht angefasst werden.
 */

type Context = Record<string, unknown>;

let initialized = false;

/** Einmalig beim App-Start aufrufen. Bindet globale Fehler-Handler. */
export function initErrorReporting(): void {
  if (initialized) return;
  initialized = true;

  window.addEventListener('error', (e) => {
    reportError(e.error ?? new Error(e.message), { source: 'window.onerror' });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    const err = reason instanceof Error ? reason : new Error(String(reason));
    reportError(err, { source: 'unhandledrejection' });
  });
}

/** Meldet einen Fehler an die zentrale Erfassung. */
export function reportError(error: unknown, context?: Context): void {
  const err = error instanceof Error ? error : new Error(String(error));
  // Hier später: Sentry.captureException(err, { extra: context });
  if (context) {
    console.error('[error]', err.message, context, err);
  } else {
    console.error('[error]', err.message, err);
  }
}
