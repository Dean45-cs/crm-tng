import { create } from 'zustand';
import { createClient } from '@supabase/supabase-js';
import { getSupabase, getConfig, pinToPassword, nameToEmail } from '../lib/supabase';
import {
  fetchAllUsers,
  fetchUserActive,
  fetchUsersExist,
  upsertUserProfile,
  upsertUserSettings,
  updateUserFlags,
  updateUserRole as apiUpdateUserRole,
  setUserActive as apiSetUserActive,
  updateUserConsent,
} from '../lib/supabaseApi';
import { toast } from './useToast';
import { logAudit } from '../lib/audit';
import {
  lockStatus,
  recordFailure,
  clearFailures,
  formatLockMessage,
} from '../lib/loginThrottle';

export function normalizeUserKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Verhindert, dass der Auth-Listener bei HMR/Remount mehrfach registriert wird. */
let authListenerRegistered = false;

export type UserRole = 'agent' | 'manager';

export interface AuthUser {
  /** UUID des Users (= Supabase auth.users.id) */
  key: string;
  displayName: string;
  pinHash: string; // unused mit Supabase, behalten für Type-Kompat
  salt: string;
  createdAt: string;
  lastLoginAt?: string;
  onboardingCompleted: boolean;
  leaderboardOptIn: boolean;
  /** 'manager' = Chef mit Team-Bereich, sonst 'agent' */
  role: UserRole;
  /** false = gesperrt, kein Login möglich */
  isActive: boolean;
  /** Zeitpunkt der DSGVO-Datenschutzhinweis-Bestätigung; undefined = noch nicht erteilt */
  consentGivenAt?: string;
  /** Monatsziel des Nutzers (aus user_settings; 0 = nicht gesetzt) */
  monthlyTarget: number;
}

interface AuthState {
  users: Record<string, AuthUser>;
  currentUserKey: string | null;
  /** True solange wir die Auth-Session beim App-Start prüfen */
  initializing: boolean;
  /**
   * True nur im Bootstrap: es existiert noch KEIN Nutzer, daher darf sich das
   * allererste Konto selbst anlegen (und wird automatisch zum ersten Manager).
   * Danach legt nur noch der Chef Konten an.
   */
  registrationOpen: boolean;

  /** Wird einmalig vom App-Bootstrap aufgerufen */
  init: () => Promise<void>;
  /** Lädt alle User-Profile aus der DB neu */
  refreshUsers: () => Promise<void>;

  hasUser: (name: string) => boolean;
  /** Bootstrap-Selbstregistrierung des ersten Kontos (sonst gesperrt). */
  registerUser: (name: string, pin: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Chef-Aktion: legt ein neues Mitarbeitenden-Konto an (ohne die eigene Session zu verlieren). */
  createUser: (
    name: string,
    pin: string,
    role?: UserRole,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  loginUser: (name: string, pin: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => Promise<void>;
  getCurrentUser: () => AuthUser | null;
  /** True, wenn der angemeldete Nutzer ein Chef ist. */
  isManager: () => boolean;
  completeOnboarding: () => Promise<void>;
  setLeaderboardOptIn: (optIn: boolean) => Promise<void>;
  /** Bestätigt den DSGVO-Datenschutzhinweis. Schreibt Audit-Log-Eintrag. */
  giveConsent: () => Promise<void>;

  /** Chef-Aktionen für die Team-Verwaltung */
  setUserRole: (key: string, role: UserRole) => Promise<void>;
  setUserActive: (key: string, isActive: boolean) => Promise<void>;
  setAgentTarget: (key: string, target: number) => Promise<void>;
}

export const useAuth = create<AuthState>()((set, get) => ({
  users: {},
  currentUserKey: null,
  initializing: true,
  registrationOpen: false,

  init: async () => {
    try {
      const sb = getSupabase();
      const { data } = await sb.auth.getSession();
      const session = data.session;

      // Lade alle User-Profile (für Leaderboard, Sharing-Auswahl etc.)
      let users: Record<string, AuthUser> = {};
      try {
        users = await fetchAllUsers();
      } catch {
        users = {};
      }

      // Bootstrap erkennen: existiert noch gar kein Konto, darf sich das erste
      // selbst anlegen. Schlägt die Prüfung fehl (z. B. Migration 012 fehlt),
      // bleibt die Registrierung sicherheitshalber zu.
      let registrationOpen = false;
      try {
        registrationOpen = !(await fetchUsersExist());
      } catch {
        registrationOpen = false;
      }

      set({
        users,
        currentUserKey: session?.user.id ?? null,
        initializing: false,
        registrationOpen,
      });

      // Auth-State-Changes abonnieren (genau einmal).
      if (!authListenerRegistered) {
        authListenerRegistered = true;
        sb.auth.onAuthStateChange((event, sess) => {
          set({ currentUserKey: sess?.user.id ?? null });
          // Profile nur bei echtem Login neu laden — nicht bei jedem
          // stündlichen TOKEN_REFRESHED-Event.
          if (event === 'SIGNED_IN') {
            fetchAllUsers().then((u) => set({ users: u })).catch(() => {});
          }
        });
      }
    } catch (e) {
      console.error('Auth init failed', e);
      set({ initializing: false });
    }
  },

  refreshUsers: async () => {
    try {
      const users = await fetchAllUsers();
      set({ users });
    } catch (e) {
      console.error('refreshUsers failed', e);
    }
  },

  hasUser: (name) => {
    const k = normalizeUserKey(name);
    return Object.values(get().users).some((u) => normalizeUserKey(u.displayName) === k);
  },

  registerUser: async (name, pin) => {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: 'Bitte gib deinen Namen ein.' };
    if (!/^\d{4}$/.test(pin)) return { ok: false, error: 'PIN muss aus genau 4 Ziffern bestehen.' };
    // Selbst-Registrierung ist nur im Bootstrap (noch kein Konto) erlaubt.
    if (!get().registrationOpen) {
      return {
        ok: false,
        error: 'Neue Konten werden von der Chefin/dem Chef angelegt. Bitte wende dich an deine:n Vorgesetzte:n.',
      };
    }

    const sb = getSupabase();
    const email = nameToEmail(trimmed);
    const password = pinToPassword(trimmed, pin);
    const key = normalizeUserKey(trimmed);

    // Das allererste Konto wird automatisch der erste Manager (Bootstrap).
    const finishBootstrap = async (uid: string) => {
      try {
        await apiUpdateUserRole(uid, 'manager');
      } catch {
        /* Beförderung kann später per SQL nachgeholt werden */
      }
      await get().refreshUsers();
      set({ registrationOpen: false });
    };

    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { data: { display_name: trimmed, key } },
    });
    if (error) {
      if (error.message.toLowerCase().includes('already')) {
        // User exists in auth but may be missing their public.users profile
        // (e.g. interrupted first registration or landing on a new device).
        // Transparently fall back to login so the user isn't blocked.
        const { data: sd, error: se } = await sb.auth.signInWithPassword({ email, password });
        if (!se && sd.user?.id) {
          const uid = sd.user.id;
          try { await upsertUserProfile(uid, key, trimmed); } catch { /* profile may already exist */ }
          try {
            const active = await fetchUserActive(uid);
            if (!active) {
              await sb.auth.signOut();
              return { ok: false, error: 'Dieser Zugang wurde gesperrt. Bitte wende dich an deine:n Vorgesetzte:n.' };
            }
          } catch {
            await sb.auth.signOut();
            return { ok: false, error: 'Anmeldung konnte nicht verifiziert werden. Bitte erneut versuchen.' };
          }
          set({ currentUserKey: uid });
          await finishBootstrap(uid);
          return { ok: true };
        }
        return { ok: false, error: 'Dieser Name ist bereits belegt. Falls du einen Account hast, melde dich über "Anmelden" an.' };
      }
      return { ok: false, error: error.message };
    }
    const uid = data.user?.id;
    if (!uid) return { ok: false, error: 'Registrierung fehlgeschlagen.' };

    // Wenn Email-Bestätigung an ist, ggf. direkt einloggen
    if (!data.session) {
      const { error: signInErr } = await sb.auth.signInWithPassword({ email, password });
      if (signInErr) return { ok: false, error: signInErr.message };
    }

    try {
      await upsertUserProfile(uid, key, trimmed);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }

    set({ currentUserKey: uid });
    await finishBootstrap(uid);
    return { ok: true };
  },

  createUser: async (name, pin, role = 'agent') => {
    if (!get().isManager()) {
      return { ok: false, error: 'Nur Chefs dürfen Konten anlegen.' };
    }
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: 'Bitte einen Namen eingeben.' };
    if (!/^\d{4}$/.test(pin)) return { ok: false, error: 'PIN muss aus genau 4 Ziffern bestehen.' };
    if (get().hasUser(trimmed)) return { ok: false, error: 'Diesen Namen gibt es bereits.' };

    const cfg = getConfig();
    if (!cfg) return { ok: false, error: 'Keine Verbindung zum Backend.' };

    // Isolierter Client mit eigener, NICHT persistierter Session: signUp legt
    // ein neues Konto an, ohne die Chef-Session im localStorage zu überschreiben.
    const temp = createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: 'crm-tng-admin-temp' },
    });

    const email = nameToEmail(trimmed);
    const password = pinToPassword(trimmed, pin);
    const key = normalizeUserKey(trimmed);

    const { data, error } = await temp.auth.signUp({
      email,
      password,
      options: { data: { display_name: trimmed, key } },
    });
    if (error) {
      if (error.message.toLowerCase().includes('already')) {
        return { ok: false, error: 'Für diesen Namen existiert bereits ein Konto.' };
      }
      return { ok: false, error: error.message };
    }
    const uid = data.user?.id;
    if (!uid) {
      await temp.auth.signOut();
      return { ok: false, error: 'Konto konnte nicht angelegt werden.' };
    }

    // Das Profil in public.users legt der DB-Trigger handle_new_user serverseitig
    // an (Migration 015) — unabhängig davon, ob eine Session zurückkam. Als
    // Fallback für Projekte, in denen der Trigger (noch) fehlt, versuchen wir es
    // zusätzlich als der neue Nutzer selbst, sofern signUp eine Session lieferte
    // (nur bei ausgeschalteter E-Mail-Bestätigung möglich). Ein Fehler hier ist
    // unkritisch: bei vorhandenem Trigger existiert die Zeile bereits.
    if (data.session) {
      await temp.from('users').insert({ id: uid, key, display_name: trimmed });
    }
    await temp.auth.signOut();

    // Rolle setzt der angemeldete Chef über die Hauptsession (Trigger erlaubt es).
    if (role === 'manager') {
      try {
        await apiUpdateUserRole(uid, 'manager');
      } catch {
        /* bleibt vorerst Vertrieb, kann in der Team-Verwaltung nachgeholt werden */
      }
    }

    await get().refreshUsers();

    // Verifizieren, dass das Profil wirklich existiert. Fehlt es, ist der
    // DB-Trigger aus Migration 015 nicht eingespielt und die E-Mail-Bestätigung
    // aktiv — dann konnte auch der Fallback nicht greifen.
    if (!get().users[uid]) {
      return {
        ok: false,
        error:
          'Konto in der Anmeldung angelegt, aber das Profil konnte nicht erstellt werden. ' +
          'Bitte Migration 015 in Supabase einspielen (SQL Editor) oder die E-Mail-Bestätigung deaktivieren.',
      };
    }

    logAudit({
      action: 'create',
      entityType: 'user',
      entityId: uid,
      entityLabel: trimmed,
      details: { role },
    });
    return { ok: true };
  },

  loginUser: async (name, pin) => {
    // Brute-Force-Bremse: nach mehreren Fehlversuchen kurz sperren.
    const lock = lockStatus(name);
    if (lock.locked) {
      return { ok: false, error: formatLockMessage(lock.secondsLeft) };
    }

    const sb = getSupabase();
    const email = nameToEmail(name);
    const password = pinToPassword(name, pin);

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.toLowerCase().includes('invalid')) {
        const next = recordFailure(name);
        if (next.locked) {
          return { ok: false, error: formatLockMessage(next.secondsLeft) };
        }
        return { ok: false, error: 'Falscher Name oder PIN.' };
      }
      return { ok: false, error: error.message };
    }
    const uid = data.user?.id;
    if (!uid) return { ok: false, error: 'Login fehlgeschlagen.' };

    // last_login_at aktualisieren
    try {
      await upsertUserProfile(uid, normalizeUserKey(name), name.trim());
    } catch {
      /* ignore */
    }

    // Gesperrte Nutzer dürfen sich nicht anmelden — verbindlich serverseitig
    // prüfen. Schlägt die Prüfung fehl, wird fail-closed abgewiesen, damit
    // ein Netzwerkfehler keinen gesperrten Zugang durchrutschen lässt.
    try {
      const active = await fetchUserActive(uid);
      if (!active) {
        await sb.auth.signOut();
        return {
          ok: false,
          error: 'Dieser Zugang wurde gesperrt. Bitte wende dich an deine:n Vorgesetzte:n.',
        };
      }
    } catch {
      await sb.auth.signOut();
      return {
        ok: false,
        error: 'Anmeldung konnte nicht verifiziert werden. Bitte erneut versuchen.',
      };
    }

    clearFailures(name);
    await get().refreshUsers();
    set({ currentUserKey: uid });
    logAudit({ action: 'login', entityType: 'auth', entityId: uid });
    return { ok: true };
  },

  logout: async () => {
    const uid = get().currentUserKey;
    if (uid) logAudit({ action: 'logout', entityType: 'auth', entityId: uid });
    const sb = getSupabase();
    await sb.auth.signOut();
    set({ currentUserKey: null });
  },

  getCurrentUser: () => {
    const k = get().currentUserKey;
    return k ? get().users[k] ?? null : null;
  },

  isManager: () => get().getCurrentUser()?.role === 'manager',

  completeOnboarding: async () => {
    const uid = get().currentUserKey;
    if (!uid) return;
    // Lokal sofort als erledigt markieren, damit die Tour auch dann schließt,
    // wenn der Schreibvorgang scheitert (sonst bliebe das Overlay hängen).
    const u = get().users[uid];
    if (u) {
      set((s) => ({
        users: { ...s.users, [uid]: { ...u, onboardingCompleted: true } },
      }));
    }
    try {
      await updateUserFlags(uid, { onboardingCompleted: true });
    } catch (e) {
      console.error(e);
    }
  },

  setLeaderboardOptIn: async (optIn) => {
    const uid = get().currentUserKey;
    if (!uid) return;
    try {
      await updateUserFlags(uid, { leaderboardOptIn: optIn });
      const u = get().users[uid];
      if (u) {
        set((s) => ({
          users: { ...s.users, [uid]: { ...u, leaderboardOptIn: optIn } },
        }));
      }
    } catch (e) {
      console.error(e);
    }
  },

  giveConsent: async () => {
    const uid = get().currentUserKey;
    if (!uid) return;
    const now = new Date().toISOString();
    try {
      await updateUserConsent(uid, now);
      const u = get().users[uid];
      if (u) {
        set((s) => ({
          users: { ...s.users, [uid]: { ...u, consentGivenAt: now } },
        }));
      }
      logAudit({
        action: 'consent',
        entityType: 'user',
        entityId: uid,
        entityLabel: get().users[uid]?.displayName,
      });
    } catch (e) {
      console.error(e);
      toast.error('Bestätigung konnte nicht gespeichert werden.');
    }
  },

  setUserRole: async (key, role) => {
    const u = get().users[key];
    if (!u) return;
    const prev = u.role;
    set((s) => ({ users: { ...s.users, [key]: { ...u, role } } }));
    try {
      await apiUpdateUserRole(key, role);
      toast.success(
        role === 'manager'
          ? `${u.displayName} ist jetzt Chef.`
          : `${u.displayName} ist jetzt im Vertrieb.`,
      );
      logAudit({
        action: 'role_change',
        entityType: 'user',
        entityId: key,
        entityLabel: u.displayName,
        details: { from: prev, to: role },
      });
    } catch (e) {
      console.error(e);
      set((s) => ({ users: { ...s.users, [key]: { ...u, role: prev } } }));
      toast.error('Rolle konnte nicht geändert werden.');
    }
  },

  setUserActive: async (key, isActive) => {
    const u = get().users[key];
    if (!u) return;
    set((s) => ({ users: { ...s.users, [key]: { ...u, isActive } } }));
    try {
      await apiSetUserActive(key, isActive);
      toast.success(
        isActive ? `${u.displayName} entsperrt.` : `${u.displayName} gesperrt.`,
      );
      logAudit({
        action: isActive ? 'unlock' : 'lock',
        entityType: 'user',
        entityId: key,
        entityLabel: u.displayName,
      });
    } catch (e) {
      console.error(e);
      set((s) => ({ users: { ...s.users, [key]: { ...u, isActive: !isActive } } }));
      toast.error('Status konnte nicht geändert werden.');
    }
  },

  setAgentTarget: async (key, target) => {
    const u = get().users[key];
    if (!u) return;
    const prev = u.monthlyTarget;
    set((s) => ({ users: { ...s.users, [key]: { ...u, monthlyTarget: target } } }));
    try {
      await upsertUserSettings(key, { monthlyTarget: target });
      toast.success(`Monatsziel für ${u.displayName} gespeichert.`);
    } catch (e) {
      console.error(e);
      set((s) => ({ users: { ...s.users, [key]: { ...u, monthlyTarget: prev } } }));
      toast.error('Monatsziel konnte nicht gespeichert werden.');
    }
  },
}));
