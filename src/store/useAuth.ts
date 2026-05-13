import { create } from 'zustand';
import { getSupabase, pinToPassword, nameToEmail } from '../lib/supabase';
import {
  fetchAllUsers,
  upsertUserProfile,
  updateUserFlags,
} from '../lib/supabaseApi';

export function normalizeUserKey(name: string): string {
  return name.trim().toLowerCase();
}

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
}

interface AuthState {
  users: Record<string, AuthUser>;
  currentUserKey: string | null;
  /** True solange wir die Auth-Session beim App-Start prüfen */
  initializing: boolean;

  /** Wird einmalig vom App-Bootstrap aufgerufen */
  init: () => Promise<void>;
  /** Lädt alle User-Profile aus der DB neu */
  refreshUsers: () => Promise<void>;

  hasUser: (name: string) => boolean;
  registerUser: (name: string, pin: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  loginUser: (name: string, pin: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => Promise<void>;
  getCurrentUser: () => AuthUser | null;
  completeOnboarding: () => Promise<void>;
  setLeaderboardOptIn: (optIn: boolean) => Promise<void>;
}

export const useAuth = create<AuthState>()((set, get) => ({
  users: {},
  currentUserKey: null,
  initializing: true,

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

      set({
        users,
        currentUserKey: session?.user.id ?? null,
        initializing: false,
      });

      // Auth-State-Changes abonnieren
      sb.auth.onAuthStateChange((_event, sess) => {
        set({ currentUserKey: sess?.user.id ?? null });
        if (sess) {
          fetchAllUsers().then((u) => set({ users: u })).catch(() => {});
        }
      });
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

    const sb = getSupabase();
    const email = nameToEmail(trimmed);
    const password = pinToPassword(trimmed, pin);
    const key = normalizeUserKey(trimmed);

    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { data: { display_name: trimmed } },
    });
    if (error) {
      if (error.message.toLowerCase().includes('already')) {
        return { ok: false, error: 'Dieser Name ist bereits vergeben.' };
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

    await get().refreshUsers();
    set({ currentUserKey: uid });
    return { ok: true };
  },

  loginUser: async (name, pin) => {
    const sb = getSupabase();
    const email = nameToEmail(name);
    const password = pinToPassword(name, pin);

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.toLowerCase().includes('invalid')) {
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
    await get().refreshUsers();
    set({ currentUserKey: uid });
    return { ok: true };
  },

  logout: async () => {
    const sb = getSupabase();
    await sb.auth.signOut();
    set({ currentUserKey: null });
  },

  getCurrentUser: () => {
    const k = get().currentUserKey;
    return k ? get().users[k] ?? null : null;
  },

  completeOnboarding: async () => {
    const uid = get().currentUserKey;
    if (!uid) return;
    try {
      await updateUserFlags(uid, { onboardingCompleted: true });
      const u = get().users[uid];
      if (u) {
        set((s) => ({
          users: { ...s.users, [uid]: { ...u, onboardingCompleted: true } },
        }));
      }
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
}));
