import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase Client.
 *
 * URL und anon key kommen entweder aus Vite-Umgebungsvariablen
 * (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`) oder werden
 * beim ersten Start in einer Konfig-Maske eingegeben und in
 * localStorage abgelegt.
 *
 * Wir wrappen die Erzeugung, damit die App auch ohne gültige
 * Config starten kann (Setup-Screen). `getSupabase()` wirft, wenn
 * noch nicht konfiguriert.
 */

const STORAGE_KEY = 'crm-tng-supabase-config';

interface SupabaseConfig {
  url: string;
  anonKey: string;
}

function readStoredConfig(): SupabaseConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SupabaseConfig>;
    if (parsed.url && parsed.anonKey) {
      return { url: parsed.url, anonKey: parsed.anonKey };
    }
    return null;
  } catch {
    return null;
  }
}

function readEnvConfig(): SupabaseConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (url && key) return { url, anonKey: key };
  return null;
}

let client: SupabaseClient | null = null;
let currentConfig: SupabaseConfig | null = null;

const configListeners = new Set<() => void>();

/**
 * Benachrichtigt über Änderungen an der Supabase-Config (gesetzt/gelöscht).
 * Gibt eine Abmelde-Funktion zurück.
 */
export function onConfigChange(cb: () => void): () => void {
  configListeners.add(cb);
  return () => configListeners.delete(cb);
}

function notifyConfigChange(): void {
  configListeners.forEach((cb) => cb());
}

function initClient(cfg: SupabaseConfig): SupabaseClient {
  currentConfig = cfg;
  client = createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storage: localStorage,
      storageKey: 'crm-tng-sb-auth',
    },
  });
  return client;
}

// Bei Modul-Load versuchen wir, schon einen Client zu bauen.
const initial = readEnvConfig() ?? readStoredConfig();
if (initial) initClient(initial);

export function getSupabase(): SupabaseClient {
  if (!client) {
    throw new Error('Supabase is not configured. Call setSupabaseConfig() first.');
  }
  return client;
}

export function isConfigured(): boolean {
  return client !== null;
}

export function getConfig(): SupabaseConfig | null {
  return currentConfig;
}

export function setSupabaseConfig(cfg: SupabaseConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  initClient(cfg);
  notifyConfigChange();
}

export function clearSupabaseConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
  client = null;
  currentConfig = null;
  notifyConfigChange();
}

/**
 * PIN ist für Supabase Auth zu kurz (min 6 Zeichen). Wir hängen einen
 * festen Suffix an, der DB-seitig nirgends gespeichert wird – er ist
 * deterministisch aus dem Username + PIN ableitbar und macht das
 * "Passwort" zu einem validen Supabase-Passwort.
 */
export function pinToPassword(name: string, pin: string): string {
  const key = name.trim().toLowerCase();
  return `tng-crm::${key}::${pin}`;
}

/**
 * Fake-Email für PIN-basierten Login. Supabase Auth braucht eine Email,
 * wir nutzen den normalisierten Namen + lokale Domain.
 */
export function nameToEmail(name: string): string {
  const key = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '-');
  return `${key}@crm.tng.local`;
}
