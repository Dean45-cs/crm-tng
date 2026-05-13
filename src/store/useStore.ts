import { create } from 'zustand';
import type {
  Contract,
  TariffChange,
  Note,
  Settings,
  ProductInfo,
  ProductType,
  TariffCommissionMatrix,
  CustomerOwnership,
} from '../types';
import { useAuth } from './useAuth';
import { getSupabase } from '../lib/supabase';
import {
  fetchContracts,
  fetchTariffChanges,
  fetchNotes,
  fetchOwnerships,
  fetchSettings,
  insertContract,
  updateContractRow,
  deleteContractRow,
  insertTariffChange,
  updateTariffChangeRow,
  deleteTariffChangeRow,
  insertNote,
  updateNoteRow,
  deleteNoteRow,
  upsertOwnership,
  upsertUserSettings,
  upsertSharedSettings,
} from '../lib/supabaseApi';

const currentUserKey = () => useAuth.getState().currentUserKey ?? undefined;

const DEFAULT_PRODUCTS: ProductInfo[] = [
  { name: 'Fibrelight', category: 'Privat', commission: 7.5 },
  { name: 'Fibrefamily', category: 'Privat', commission: 10 },
  { name: 'Fibrepro', category: 'Privat', commission: 15 },
  { name: 'Flott50', category: 'Privat', commission: 7.5 },
  { name: 'Flott300', category: 'Privat', commission: 10 },
  { name: 'Flott500', category: 'Privat', commission: 15 },
  { name: 'Surf100', category: 'Privat', commission: 7.5 },
  { name: 'Surf1.000', category: 'Privat', commission: 10 },
  { name: 'Smart300', category: 'Privat', commission: 7.5 },
  { name: 'Smart1.000', category: 'Privat', commission: 10 },
  { name: 'Family1.000', category: 'Privat', commission: 15 },
  { name: 'Max.1.000', category: 'Privat', commission: 20 },
  { name: 'Winback Privat', category: 'Privat', commission: 12.5 },
  { name: 'Lite 1000', category: 'Business', commission: 30 },
  { name: 'Basic 1000', category: 'Business', commission: 40 },
  { name: 'Pro 1000', category: 'Business', commission: 50 },
  { name: 'Premium 1000', category: 'Business', commission: 70 },
  { name: 'Winback Business', category: 'Business', commission: 12.5 },
  { name: 'Waipu TV', category: 'Zusatz', commission: 10 },
  { name: 'Mobilfunk LTE Smart 4G', category: 'Zusatz', commission: 5 },
  { name: 'Mobilfunk LTE Komplett 4G', category: 'Zusatz', commission: 7.5 },
  { name: 'Mobilfunk LTE Smart 5G', category: 'Zusatz', commission: 5 },
  { name: 'Mobilfunk LTE Komplett 5G', category: 'Zusatz', commission: 7.5 },
];

const DEFAULT_TARIFF_COMMISSION: TariffCommissionMatrix = {
  sidegrade: { mvlz_gt3: 0, mvlz_lt3: 5, outside_mvlz: 5 },
  upgrade: { mvlz_gt3: 5, mvlz_lt3: 7.5, outside_mvlz: 7.5 },
};

const DEFAULT_SETTINGS: Settings = {
  products: DEFAULT_PRODUCTS,
  tariffCommission: DEFAULT_TARIFF_COMMISSION,
  monthlyTarget: 500,
  jiraBaseUrl: 'https://jira.tng.de/browse/',
  agentName: 'Auszubildende:r',
  spClientId: '',
  spTenantId: '',
  spFilePath: '',
  spSheetName: 'Tabelle1',
};

interface StoreState {
  contracts: Contract[];
  tariffChanges: TariffChange[];
  notes: Note[];
  settings: Settings;
  customerOwners: Record<string, CustomerOwnership>;

  /** Wird gesetzt, sobald wir initial alle Daten geladen haben. */
  loaded: boolean;
  /** Letzter Fehler aus einer DB-Operation (für Toast / Banner). */
  lastError: string | null;

  /** Lädt alle CRM-Daten für den aktuellen User. */
  loadAll: () => Promise<void>;
  /** Setzt den Store zurück (bei Logout). */
  reset: () => void;
  /** Abonniert Realtime-Changes auf allen relevanten Tabellen. */
  subscribeRealtime: () => () => void;

  addContract: (c: Omit<Contract, 'id' | 'createdAt'>) => Promise<void>;
  updateContract: (id: string, c: Partial<Contract>) => Promise<void>;
  deleteContract: (id: string) => Promise<void>;

  addTariffChange: (t: Omit<TariffChange, 'id' | 'createdAt'>) => Promise<void>;
  updateTariffChange: (id: string, t: Partial<TariffChange>) => Promise<void>;
  deleteTariffChange: (id: string) => Promise<void>;
  markTariffChangeExported: (id: string) => Promise<void>;

  addNote: (n: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateNote: (id: string, n: Partial<Note>) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;

  updateSettings: (s: Partial<Settings>) => Promise<void>;
  updateProductCommission: (product: ProductType, commission: number) => Promise<void>;
  updateTariffCommission: (matrix: TariffCommissionMatrix) => Promise<void>;

  setCustomerOwner: (customerNumber: string, ownerKey: string) => Promise<void>;
  shareCustomer: (customerNumber: string, withUserKey: string) => Promise<void>;
  unshareCustomer: (customerNumber: string, withUserKey: string) => Promise<void>;
}

const reportError = (set: (s: Partial<StoreState>) => void, e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  // eslint-disable-next-line no-console
  console.error('[useStore]', msg);
  set({ lastError: msg });
};

export const useStore = create<StoreState>()((set, get) => ({
  contracts: [],
  tariffChanges: [],
  notes: [],
  customerOwners: {},
  settings: DEFAULT_SETTINGS,
  loaded: false,
  lastError: null,

  loadAll: async () => {
    const uid = useAuth.getState().currentUserKey;
    try {
      const [contracts, tariffChanges, notes, owners, settingsRes] = await Promise.all([
        fetchContracts(),
        fetchTariffChanges(),
        fetchNotes(),
        fetchOwnerships(),
        uid ? fetchSettings(uid) : Promise.resolve({ user: null, shared: null }),
      ]);

      const mergedSettings: Settings = {
        ...DEFAULT_SETTINGS,
        ...(settingsRes.shared
          ? {
              products: settingsRes.shared.products.length
                ? settingsRes.shared.products
                : DEFAULT_PRODUCTS,
              tariffCommission:
                settingsRes.shared.tariffCommission &&
                Object.keys(settingsRes.shared.tariffCommission).length > 0
                  ? settingsRes.shared.tariffCommission
                  : DEFAULT_TARIFF_COMMISSION,
            }
          : {}),
        ...(settingsRes.user
          ? {
              monthlyTarget: settingsRes.user.monthlyTarget,
              spClientId: settingsRes.user.spClientId,
              spTenantId: settingsRes.user.spTenantId,
            }
          : {}),
      };

      // Falls noch keine shared_settings existieren, einmalig die Defaults anlegen.
      if (!settingsRes.shared) {
        upsertSharedSettings({
          products: DEFAULT_PRODUCTS,
          tariffCommission: DEFAULT_TARIFF_COMMISSION,
        }).catch(() => {});
      }

      set({
        contracts,
        tariffChanges,
        notes,
        customerOwners: owners,
        settings: mergedSettings,
        loaded: true,
        lastError: null,
      });
    } catch (e) {
      reportError(set, e);
      set({ loaded: true });
    }
  },

  reset: () =>
    set({
      contracts: [],
      tariffChanges: [],
      notes: [],
      customerOwners: {},
      settings: DEFAULT_SETTINGS,
      loaded: false,
      lastError: null,
    }),

  subscribeRealtime: () => {
    const sb = getSupabase();
    const channel = sb
      .channel('crm-tng-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contracts' }, () => {
        fetchContracts().then((rows) => set({ contracts: rows })).catch(() => {});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tariff_changes' }, () => {
        fetchTariffChanges().then((rows) => set({ tariffChanges: rows })).catch(() => {});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, () => {
        fetchNotes().then((rows) => set({ notes: rows })).catch(() => {});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_ownerships' }, () => {
        fetchOwnerships().then((rows) => set({ customerOwners: rows })).catch(() => {});
      })
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  },

  addContract: async (c) => {
    try {
      const created = await insertContract({ ...c, createdBy: c.createdBy ?? currentUserKey() });
      set((s) => ({ contracts: [created, ...s.contracts] }));
    } catch (e) {
      reportError(set, e);
    }
  },
  updateContract: async (id, c) => {
    const prev = get().contracts;
    set({ contracts: prev.map((x) => (x.id === id ? { ...x, ...c } : x)) });
    try {
      await updateContractRow(id, c);
    } catch (e) {
      reportError(set, e);
      set({ contracts: prev });
    }
  },
  deleteContract: async (id) => {
    const prev = get().contracts;
    set({ contracts: prev.filter((x) => x.id !== id) });
    try {
      await deleteContractRow(id);
    } catch (e) {
      reportError(set, e);
      set({ contracts: prev });
    }
  },

  addTariffChange: async (t) => {
    try {
      const created = await insertTariffChange({ ...t, createdBy: t.createdBy ?? currentUserKey() });
      set((s) => ({ tariffChanges: [created, ...s.tariffChanges] }));
    } catch (e) {
      reportError(set, e);
    }
  },
  updateTariffChange: async (id, t) => {
    const prev = get().tariffChanges;
    set({ tariffChanges: prev.map((x) => (x.id === id ? { ...x, ...t } : x)) });
    try {
      await updateTariffChangeRow(id, t);
    } catch (e) {
      reportError(set, e);
      set({ tariffChanges: prev });
    }
  },
  deleteTariffChange: async (id) => {
    const prev = get().tariffChanges;
    set({ tariffChanges: prev.filter((x) => x.id !== id) });
    try {
      await deleteTariffChangeRow(id);
    } catch (e) {
      reportError(set, e);
      set({ tariffChanges: prev });
    }
  },
  markTariffChangeExported: async (id) => {
    const now = new Date().toISOString();
    const prev = get().tariffChanges;
    set({
      tariffChanges: prev.map((x) => (x.id === id ? { ...x, exportedAt: now } : x)),
    });
    try {
      await updateTariffChangeRow(id, { exportedAt: now });
    } catch (e) {
      reportError(set, e);
      set({ tariffChanges: prev });
    }
  },

  addNote: async (n) => {
    try {
      const created = await insertNote(n, currentUserKey());
      set((s) => ({ notes: [created, ...s.notes] }));
    } catch (e) {
      reportError(set, e);
    }
  },
  updateNote: async (id, n) => {
    const prev = get().notes;
    const now = new Date().toISOString();
    set({ notes: prev.map((x) => (x.id === id ? { ...x, ...n, updatedAt: now } : x)) });
    try {
      await updateNoteRow(id, n);
    } catch (e) {
      reportError(set, e);
      set({ notes: prev });
    }
  },
  deleteNote: async (id) => {
    const prev = get().notes;
    set({ notes: prev.filter((x) => x.id !== id) });
    try {
      await deleteNoteRow(id);
    } catch (e) {
      reportError(set, e);
      set({ notes: prev });
    }
  },

  updateSettings: async (patch) => {
    const prev = get().settings;
    set({ settings: { ...prev, ...patch } });
    const uid = currentUserKey();
    if (!uid) return;
    try {
      await upsertUserSettings(uid, patch);
    } catch (e) {
      reportError(set, e);
      set({ settings: prev });
    }
  },
  updateProductCommission: async (product, commission) => {
    const prev = get().settings;
    const newProducts = prev.products.map((p) =>
      p.name === product ? { ...p, commission } : p,
    );
    set({ settings: { ...prev, products: newProducts } });
    try {
      await upsertSharedSettings({ products: newProducts });
    } catch (e) {
      reportError(set, e);
      set({ settings: prev });
    }
  },
  updateTariffCommission: async (matrix) => {
    const prev = get().settings;
    set({ settings: { ...prev, tariffCommission: matrix } });
    try {
      await upsertSharedSettings({ tariffCommission: matrix });
    } catch (e) {
      reportError(set, e);
      set({ settings: prev });
    }
  },

  setCustomerOwner: async (kdnr, ownerKey) => {
    const prev = get().customerOwners;
    const existing = prev[kdnr];
    const next: CustomerOwnership = {
      owner: ownerKey,
      sharedWith: (existing?.sharedWith ?? []).filter((k) => k !== ownerKey),
    };
    set({ customerOwners: { ...prev, [kdnr]: next } });
    try {
      await upsertOwnership(kdnr, next.owner, next.sharedWith);
    } catch (e) {
      reportError(set, e);
      set({ customerOwners: prev });
    }
  },

  shareCustomer: async (kdnr, withUserKey) => {
    const prev = get().customerOwners;
    const existing = prev[kdnr];
    if (!existing) return;
    if (existing.owner === withUserKey) return;
    if (existing.sharedWith.includes(withUserKey)) return;
    const next: CustomerOwnership = {
      ...existing,
      sharedWith: [...existing.sharedWith, withUserKey],
    };
    set({ customerOwners: { ...prev, [kdnr]: next } });
    try {
      await upsertOwnership(kdnr, next.owner, next.sharedWith);
    } catch (e) {
      reportError(set, e);
      set({ customerOwners: prev });
    }
  },

  unshareCustomer: async (kdnr, withUserKey) => {
    const prev = get().customerOwners;
    const existing = prev[kdnr];
    if (!existing) return;
    const next: CustomerOwnership = {
      ...existing,
      sharedWith: existing.sharedWith.filter((k) => k !== withUserKey),
    };
    set({ customerOwners: { ...prev, [kdnr]: next } });
    try {
      await upsertOwnership(kdnr, next.owner, next.sharedWith);
    } catch (e) {
      reportError(set, e);
      set({ customerOwners: prev });
    }
  },
}));
