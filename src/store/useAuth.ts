import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Einfacher Hash für die PIN. Nicht kryptographisch sicher, reicht aber
 * für ein lokales Mehrnutzer-Setup auf demselben Gerät.
 */
function hashPin(pin: string, salt: string): string {
  const input = `${salt}::${pin}::tng-crm-v1`;
  let h1 = 0x811c9dc5;
  let h2 = 0xdeadbeef;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ ch, 0x85ebca6b);
  }
  const a = (h1 >>> 0).toString(16).padStart(8, '0');
  const b = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${a}${b}`;
}

export function normalizeUserKey(name: string): string {
  return name.trim().toLowerCase();
}

export interface AuthUser {
  /** Eindeutiger Login-Key (lowercased, getrimmt) */
  key: string;
  /** Anzeigename, wie der User ihn eingegeben hat */
  displayName: string;
  pinHash: string;
  salt: string;
  createdAt: string;
  lastLoginAt?: string;
  /** Hat der Nutzer das Onboarding bereits absolviert? */
  onboardingCompleted: boolean;
  /** Auf Leaderboard sichtbar? */
  leaderboardOptIn: boolean;
}

interface AuthState {
  users: Record<string, AuthUser>;
  currentUserKey: string | null;

  /** Liefert true, wenn ein User mit diesem Namen bereits existiert */
  hasUser: (name: string) => boolean;
  /** Legt einen neuen User an und meldet ihn direkt an */
  registerUser: (name: string, pin: string) => { ok: true } | { ok: false; error: string };
  /** Prüft PIN und meldet User an */
  loginUser: (name: string, pin: string) => { ok: true } | { ok: false; error: string };
  logout: () => void;
  getCurrentUser: () => AuthUser | null;
  /** Markiert das Onboarding als abgeschlossen für den aktuellen Nutzer */
  completeOnboarding: () => void;
  /** Schaltet die Leaderboard-Teilnahme für den aktuellen Nutzer an/aus */
  setLeaderboardOptIn: (optIn: boolean) => void;
}

const randomSalt = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      users: {},
      currentUserKey: null,

      hasUser: (name) => {
        const key = normalizeUserKey(name);
        return Boolean(get().users[key]);
      },

      registerUser: (name, pin) => {
        const trimmed = name.trim();
        if (!trimmed) return { ok: false, error: 'Bitte gib deinen Namen ein.' };
        if (!/^\d{4}$/.test(pin))
          return { ok: false, error: 'PIN muss aus genau 4 Ziffern bestehen.' };

        const key = normalizeUserKey(trimmed);
        if (get().users[key])
          return { ok: false, error: 'Dieser Name ist bereits vergeben.' };

        const salt = randomSalt();
        const user: AuthUser = {
          key,
          displayName: trimmed,
          pinHash: hashPin(pin, salt),
          salt,
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
          onboardingCompleted: false,
          leaderboardOptIn: true,
        };
        set((s) => ({
          users: { ...s.users, [key]: user },
          currentUserKey: key,
        }));
        return { ok: true };
      },

      loginUser: (name, pin) => {
        const key = normalizeUserKey(name);
        const user = get().users[key];
        if (!user) return { ok: false, error: 'Nutzer nicht gefunden.' };
        if (!/^\d{4}$/.test(pin))
          return { ok: false, error: 'PIN muss 4 Ziffern haben.' };
        if (hashPin(pin, user.salt) !== user.pinHash)
          return { ok: false, error: 'Falsche PIN.' };

        set((s) => ({
          currentUserKey: key,
          users: {
            ...s.users,
            [key]: { ...user, lastLoginAt: new Date().toISOString() },
          },
        }));
        return { ok: true };
      },

      logout: () => set({ currentUserKey: null }),

      getCurrentUser: () => {
        const k = get().currentUserKey;
        return k ? get().users[k] ?? null : null;
      },

      completeOnboarding: () =>
        set((s) => {
          if (!s.currentUserKey) return s;
          const u = s.users[s.currentUserKey];
          if (!u) return s;
          return {
            users: {
              ...s.users,
              [s.currentUserKey]: { ...u, onboardingCompleted: true },
            },
          };
        }),

      setLeaderboardOptIn: (optIn) =>
        set((s) => {
          if (!s.currentUserKey) return s;
          const u = s.users[s.currentUserKey];
          if (!u) return s;
          return {
            users: {
              ...s.users,
              [s.currentUserKey]: { ...u, leaderboardOptIn: optIn },
            },
          };
        }),
    }),
    {
      name: 'crm-tng-auth',
      version: 2,
      migrate: (persisted: unknown, version) => {
        const state = (persisted ?? {}) as Partial<AuthState>;
        if (version < 2 && state.users) {
          const migrated: Record<string, AuthUser> = {};
          for (const [k, u] of Object.entries(state.users)) {
            const user = u as AuthUser;
            migrated[k] = {
              ...user,
              // bestehende User überspringen die Tour
              onboardingCompleted: user.onboardingCompleted ?? true,
              leaderboardOptIn: user.leaderboardOptIn ?? true,
            };
          }
          return { ...state, users: migrated } as AuthState;
        }
        return state as AuthState;
      },
    },
  ),
);
