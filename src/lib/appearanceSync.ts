import { getSupabase } from './supabase';
import { fetchUserAppearance, upsertUserAppearance } from './supabaseApi';
import { getStoredTheme, setTheme, type ThemePref } from './theme';
import { getStoredPalette, setPalette, normalizePalette, type PaletteState } from './palette';

/**
 * Surface-übergreifender Sync der persönlichen Optik (Tier 3).
 *
 * Supabase (user_settings.theme_pref / .palette) ist die Quelle der Wahrheit;
 * localStorage bleibt schneller Cache für den Sofort-Paint beim Kaltstart
 * (main.tsx ruft weiterhin initTheme()/initPalette() vor dem Login auf). Beim
 * Login wird die Wahrheit gezogen und angewandt, fehlende Werte werden mit dem
 * lokalen Stand geseedet, danach hält ein Realtime-Abo auf die eigene Zeile
 * alle offenen Sessions/Geräte gleich.
 *
 * Die Extension teilt bereits dasselbe Rollen-Schema (extension/src/theme.js);
 * ihre Übernahme dieser Werte ist ein bewusster Folgeschritt (die Rollen-Sets
 * decken sich noch nicht 1:1 — braucht ein explizites Mapping).
 */

const isThemePref = (v: unknown): v is ThemePref => v === 'light' || v === 'dark' || v === 'system';

/**
 * Fernwerte anwenden (falls vorhanden). setTheme/setPalette schreiben zusätzlich
 * in den localStorage-Cache und lösen KEINEN Push zurück aus — kein Sync-Loop.
 */
async function applyRemoteAppearance(userId: string): Promise<{ theme: boolean; palette: boolean }> {
  const { themePref, palette } = await fetchUserAppearance(userId);
  let themeApplied = false;
  let paletteApplied = false;
  if (isThemePref(themePref)) {
    setTheme(themePref);
    themeApplied = true;
  }
  if (palette && typeof palette === 'object') {
    setPalette(normalizePalette(palette));
    paletteApplied = true;
  }
  return { theme: themeApplied, palette: paletteApplied };
}

/** Aktuelle Hell/Dunkel-Präferenz in die geteilte Wahrheit schreiben. */
export function pushThemePref(userId: string, pref: ThemePref): void {
  void upsertUserAppearance(userId, { themePref: pref }).catch(() => {});
}

/** Aktuelle Farb-Palette in die geteilte Wahrheit schreiben. */
export function pushPalette(userId: string, state: PaletteState): void {
  void upsertUserAppearance(userId, { palette: state }).catch(() => {});
}

/**
 * Beim Login aufrufen: initialer Pull + Seed, dann Realtime-Abo auf die eigene
 * user_settings-Zeile. Gibt die Unsubscribe-Funktion synchron zurück (der Pull
 * läuft fire-and-forget), damit der Aufrufer sie direkt aufräumen kann.
 */
export function subscribeAppearance(userId: string): () => void {
  void (async () => {
    try {
      const had = await applyRemoteAppearance(userId);
      // Was in der Cloud noch fehlt, mit dem lokalen Stand seeden, damit andere
      // Geräte es erben.
      if (!had.theme) pushThemePref(userId, getStoredTheme());
      if (!had.palette) pushPalette(userId, getStoredPalette());
    } catch {
      // Migration 022 evtl. noch nicht eingespielt — dann eben nur lokal.
    }
  })();

  const sb = getSupabase();
  const channel = sb
    .channel('crm-tng-appearance')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_settings', filter: `user_id=eq.${userId}` },
      () => {
        void applyRemoteAppearance(userId).catch(() => {});
      },
    )
    .subscribe();

  return () => {
    sb.removeChannel(channel);
  };
}
