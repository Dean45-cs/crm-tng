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
  Incentive,
  Lead,
  LeadActivity,
} from '../types';
import { useAuth } from './useAuth';
import { toast } from './useToast';
import { getSupabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
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
  fetchIncentives,
  insertIncentive,
  updateIncentiveRow,
  deleteIncentiveRow,
  fetchLeads,
  insertLead,
  updateLeadRow,
  deleteLeadRow,
  fetchLeadActivities,
  insertLeadActivity,
  deleteLeadActivityRow,
  purgeCustomerData,
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
  incentives: Incentive[];
  leads: Lead[];
  /** Aktivitäten pro Lead, absteigend nach created_at */
  leadActivities: Record<string, LeadActivity[]>;

  /** Wird gesetzt, sobald wir initial alle Daten geladen haben. */
  loaded: boolean;

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

  addIncentive: (i: Omit<Incentive, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateIncentive: (id: string, i: Partial<Incentive>) => Promise<void>;
  deleteIncentive: (id: string) => Promise<void>;

  addLead: (l: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateLead: (id: string, l: Partial<Lead>) => Promise<void>;
  deleteLead: (id: string) => Promise<void>;

  addLeadActivity: (a: Pick<LeadActivity, 'leadId' | 'type' | 'content'>) => Promise<void>;
  deleteLeadActivity: (id: string, leadId: string) => Promise<void>;

  /**
   * Recht auf Vergessenwerden (DSGVO Art. 17): löscht alle CRM-Daten eines
   * Kunden (Verträge, Tarifwechsel, Notizen, Ownership) endgültig. Loggt den
   * Vorgang im Audit-Log.
   */
  purgeCustomer: (customerNumber: string, customerName?: string) => Promise<void>;
}

/** Loggt den technischen Fehler und zeigt dem Nutzer einen Toast. */
const fail = (userMsg: string, e: unknown) => {
  const detail = e instanceof Error ? e.message : String(e);
  console.error('[useStore]', detail);
  toast.error(userMsg);
};

/**
 * Bündelt schnelle Aufrufe: bei einem Schwall Realtime-Events wird die
 * Tabelle nur einmal neu geladen statt pro Event.
 */
const debounce = (fn: () => void, ms = 250): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
};

export const useStore = create<StoreState>()((set, get) => ({
  contracts: [],
  tariffChanges: [],
  notes: [],
  customerOwners: {},
  incentives: [],
  leads: [],
  leadActivities: {},
  settings: DEFAULT_SETTINGS,
  loaded: false,

  loadAll: async () => {
    const uid = useAuth.getState().currentUserKey;
    try {
      const [contracts, tariffChanges, notes, owners, incentives, leads, activities, settingsRes] = await Promise.all([
        fetchContracts(),
        fetchTariffChanges(),
        fetchNotes(),
        fetchOwnerships(),
        // Fehlt die Tabelle noch (Migration 003 nicht eingespielt), darf das
        // nicht den ganzen Datenload abbrechen — dann eben keine Incentives.
        fetchIncentives().catch(() => [] as Incentive[]),
        // Ebenso für Leads (Migration 005).
        fetchLeads().catch(() => [] as Lead[]),
        // Lead-Aktivitäten (Migration 006).
        fetchLeadActivities().catch(() => [] as LeadActivity[]),
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

      const leadActivities: Record<string, LeadActivity[]> = {};
      for (const a of activities) {
        if (!leadActivities[a.leadId]) leadActivities[a.leadId] = [];
        leadActivities[a.leadId].push(a);
      }

      set({
        contracts,
        tariffChanges,
        notes,
        customerOwners: owners,
        incentives,
        leads,
        leadActivities,
        settings: mergedSettings,
        loaded: true,
      });
    } catch (e) {
      fail('Daten konnten nicht geladen werden. Bitte Seite neu laden.', e);
      set({ loaded: true });
    }
  },

  reset: () =>
    set({
      contracts: [],
      tariffChanges: [],
      notes: [],
      customerOwners: {},
      incentives: [],
      leads: [],
      leadActivities: {},
      settings: DEFAULT_SETTINGS,
      loaded: false,
    }),

  subscribeRealtime: () => {
    const sb = getSupabase();

    // Pro Tabelle ein gebündelter Reload — ein Event-Schwall (z.B. Bulk-Export)
    // löst so nur einen Refetch aus statt einen pro Zeile.
    const reloadContracts = debounce(() => {
      fetchContracts().then((rows) => set({ contracts: rows })).catch(() => {});
    });
    const reloadTariffs = debounce(() => {
      fetchTariffChanges().then((rows) => set({ tariffChanges: rows })).catch(() => {});
    });
    const reloadNotes = debounce(() => {
      fetchNotes().then((rows) => set({ notes: rows })).catch(() => {});
    });
    const reloadOwners = debounce(() => {
      fetchOwnerships().then((rows) => set({ customerOwners: rows })).catch(() => {});
    });
    const reloadIncentives = debounce(() => {
      fetchIncentives().then((rows) => set({ incentives: rows })).catch(() => {});
    });
    const reloadLeads = debounce(() => {
      fetchLeads().then((rows) => set({ leads: rows })).catch(() => {});
    });
    const reloadActivities = debounce(() => {
      fetchLeadActivities()
        .then((rows) => {
          const map: Record<string, LeadActivity[]> = {};
          for (const a of rows) {
            if (!map[a.leadId]) map[a.leadId] = [];
            map[a.leadId].push(a);
          }
          set({ leadActivities: map });
        })
        .catch(() => {});
    });

    const channel = sb
      .channel('crm-tng-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contracts' }, reloadContracts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tariff_changes' }, reloadTariffs)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, reloadNotes)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_ownerships' }, reloadOwners)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incentives' }, reloadIncentives)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, reloadLeads)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lead_activities' }, reloadActivities)
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  },

  addContract: async (c) => {
    try {
      const created = await insertContract({ ...c, createdBy: c.createdBy ?? currentUserKey() });
      set((s) => ({ contracts: [created, ...s.contracts] }));
      toast.success('Vertrag gespeichert.');
      logAudit({
        action: 'create',
        entityType: 'contract',
        entityId: created.id,
        entityLabel: `${created.customerName} (${created.customerNumber})`,
        details: { products: created.products, status: created.status },
      });
    } catch (e) {
      fail('Vertrag konnte nicht gespeichert werden.', e);
    }
  },
  updateContract: async (id, c) => {
    const prev = get().contracts;
    const before = prev.find((x) => x.id === id);
    set({ contracts: prev.map((x) => (x.id === id ? { ...x, ...c } : x)) });
    try {
      await updateContractRow(id, c);
      toast.success('Vertrag aktualisiert.');
      logAudit({
        action: 'update',
        entityType: 'contract',
        entityId: id,
        entityLabel: before ? `${before.customerName} (${before.customerNumber})` : id,
        details: { changed: Object.keys(c) },
      });
    } catch (e) {
      fail('Änderung fehlgeschlagen – Vertrag wurde zurückgesetzt.', e);
      set({ contracts: prev });
    }
  },
  deleteContract: async (id) => {
    const prev = get().contracts;
    const before = prev.find((x) => x.id === id);
    set({ contracts: prev.filter((x) => x.id !== id) });
    try {
      await deleteContractRow(id);
      toast.success('Vertrag gelöscht.');
      logAudit({
        action: 'delete',
        entityType: 'contract',
        entityId: id,
        entityLabel: before ? `${before.customerName} (${before.customerNumber})` : id,
      });
    } catch (e) {
      fail('Löschen fehlgeschlagen – Vertrag wiederhergestellt.', e);
      set({ contracts: prev });
    }
  },

  addTariffChange: async (t) => {
    try {
      const created = await insertTariffChange({ ...t, createdBy: t.createdBy ?? currentUserKey() });
      set((s) => ({ tariffChanges: [created, ...s.tariffChanges] }));
      toast.success('Tarifwechsel gespeichert.');
      logAudit({
        action: 'create',
        entityType: 'tariff_change',
        entityId: created.id,
        entityLabel: `${created.customerName} (${created.customerNumber})`,
        details: { type: created.changeType, context: created.context },
      });
    } catch (e) {
      fail('Tarifwechsel konnte nicht gespeichert werden.', e);
    }
  },
  updateTariffChange: async (id, t) => {
    const prev = get().tariffChanges;
    const before = prev.find((x) => x.id === id);
    set({ tariffChanges: prev.map((x) => (x.id === id ? { ...x, ...t } : x)) });
    try {
      await updateTariffChangeRow(id, t);
      toast.success('Tarifwechsel aktualisiert.');
      logAudit({
        action: 'update',
        entityType: 'tariff_change',
        entityId: id,
        entityLabel: before ? `${before.customerName} (${before.customerNumber})` : id,
        details: { changed: Object.keys(t) },
      });
    } catch (e) {
      fail('Änderung fehlgeschlagen – Tarifwechsel wurde zurückgesetzt.', e);
      set({ tariffChanges: prev });
    }
  },
  deleteTariffChange: async (id) => {
    const prev = get().tariffChanges;
    const before = prev.find((x) => x.id === id);
    set({ tariffChanges: prev.filter((x) => x.id !== id) });
    try {
      await deleteTariffChangeRow(id);
      toast.success('Tarifwechsel gelöscht.');
      logAudit({
        action: 'delete',
        entityType: 'tariff_change',
        entityId: id,
        entityLabel: before ? `${before.customerName} (${before.customerNumber})` : id,
      });
    } catch (e) {
      fail('Löschen fehlgeschlagen – Tarifwechsel wiederhergestellt.', e);
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
      fail('Export-Status konnte nicht gespeichert werden.', e);
      set({ tariffChanges: prev });
    }
  },

  addNote: async (n) => {
    try {
      const created = await insertNote(n, currentUserKey());
      set((s) => ({ notes: [created, ...s.notes] }));
      toast.success('Notiz gespeichert.');
      logAudit({
        action: 'create',
        entityType: 'note',
        entityId: created.id,
        entityLabel: created.title,
        details: created.customerNumber ? { customerNumber: created.customerNumber } : undefined,
      });
    } catch (e) {
      fail('Notiz konnte nicht gespeichert werden.', e);
    }
  },
  updateNote: async (id, n) => {
    const prev = get().notes;
    const before = prev.find((x) => x.id === id);
    const now = new Date().toISOString();
    set({ notes: prev.map((x) => (x.id === id ? { ...x, ...n, updatedAt: now } : x)) });
    try {
      await updateNoteRow(id, n);
      toast.success('Notiz aktualisiert.');
      logAudit({
        action: 'update',
        entityType: 'note',
        entityId: id,
        entityLabel: before?.title ?? id,
        details: { changed: Object.keys(n) },
      });
    } catch (e) {
      fail('Änderung fehlgeschlagen – Notiz wurde zurückgesetzt.', e);
      set({ notes: prev });
    }
  },
  deleteNote: async (id) => {
    const prev = get().notes;
    const before = prev.find((x) => x.id === id);
    set({ notes: prev.filter((x) => x.id !== id) });
    try {
      await deleteNoteRow(id);
      toast.success('Notiz gelöscht.');
      logAudit({
        action: 'delete',
        entityType: 'note',
        entityId: id,
        entityLabel: before?.title ?? id,
      });
    } catch (e) {
      fail('Löschen fehlgeschlagen – Notiz wiederhergestellt.', e);
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
      toast.success('Einstellungen gespeichert.');
    } catch (e) {
      fail('Einstellungen konnten nicht gespeichert werden.', e);
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
      fail('Provision konnte nicht gespeichert werden.', e);
      set({ settings: prev });
    }
  },
  updateTariffCommission: async (matrix) => {
    const prev = get().settings;
    set({ settings: { ...prev, tariffCommission: matrix } });
    try {
      await upsertSharedSettings({ tariffCommission: matrix });
    } catch (e) {
      fail('Provision konnte nicht gespeichert werden.', e);
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
      toast.success('Besitzer:in aktualisiert.');
    } catch (e) {
      fail('Besitzer:in konnte nicht geändert werden.', e);
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
      toast.success('Kunde geteilt.');
    } catch (e) {
      fail('Teilen fehlgeschlagen.', e);
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
      toast.success('Freigabe entfernt.');
    } catch (e) {
      fail('Freigabe konnte nicht entfernt werden.', e);
      set({ customerOwners: prev });
    }
  },

  addIncentive: async (i) => {
    try {
      const created = await insertIncentive({ ...i, createdBy: i.createdBy ?? currentUserKey() });
      set((s) => ({ incentives: [created, ...s.incentives] }));
      toast.success('Incentive erstellt.');
    } catch (e) {
      fail('Incentive konnte nicht erstellt werden.', e);
    }
  },
  updateIncentive: async (id, i) => {
    const prev = get().incentives;
    set({ incentives: prev.map((x) => (x.id === id ? { ...x, ...i } : x)) });
    try {
      await updateIncentiveRow(id, i);
      toast.success('Incentive aktualisiert.');
    } catch (e) {
      fail('Änderung fehlgeschlagen – Incentive wurde zurückgesetzt.', e);
      set({ incentives: prev });
    }
  },
  deleteIncentive: async (id) => {
    const prev = get().incentives;
    set({ incentives: prev.filter((x) => x.id !== id) });
    try {
      await deleteIncentiveRow(id);
      toast.success('Incentive gelöscht.');
    } catch (e) {
      fail('Löschen fehlgeschlagen – Incentive wiederhergestellt.', e);
      set({ incentives: prev });
    }
  },

  addLead: async (l) => {
    try {
      const created = await insertLead({ ...l, createdBy: l.createdBy ?? currentUserKey() });
      set((s) => ({ leads: [created, ...s.leads] }));
      toast.success('Lead angelegt.');
      logAudit({
        action: 'create',
        entityType: 'lead',
        entityId: created.id,
        entityLabel: created.customerName,
        details: { status: created.status, priority: created.priority },
      });
    } catch (e) {
      fail('Lead konnte nicht angelegt werden.', e);
    }
  },
  updateLead: async (id, l) => {
    const prev = get().leads;
    const before = prev.find((x) => x.id === id);
    const now = new Date().toISOString();
    set({ leads: prev.map((x) => (x.id === id ? { ...x, ...l, updatedAt: now } : x)) });
    try {
      await updateLeadRow(id, l);
      toast.success('Lead aktualisiert.');
      logAudit({
        action: 'update',
        entityType: 'lead',
        entityId: id,
        entityLabel: before?.customerName ?? id,
        details: { changed: Object.keys(l) },
      });
    } catch (e) {
      fail('Änderung fehlgeschlagen – Lead wurde zurückgesetzt.', e);
      set({ leads: prev });
    }
  },
  deleteLead: async (id) => {
    const prev = get().leads;
    const before = prev.find((x) => x.id === id);
    set({ leads: prev.filter((x) => x.id !== id) });
    try {
      await deleteLeadRow(id);
      // Verwaiste Aktivitäten aus dem State entfernen (DB cascadet selbst).
      set((s) => {
        if (!s.leadActivities[id]) return {};
        const next = { ...s.leadActivities };
        delete next[id];
        return { leadActivities: next };
      });
      toast.success('Lead gelöscht.');
      logAudit({
        action: 'delete',
        entityType: 'lead',
        entityId: id,
        entityLabel: before?.customerName ?? id,
      });
    } catch (e) {
      fail('Löschen fehlgeschlagen – Lead wiederhergestellt.', e);
      set({ leads: prev });
    }
  },

  addLeadActivity: async ({ leadId, type, content }) => {
    const uid = currentUserKey();
    try {
      const created = await insertLeadActivity({ leadId, type, content, createdBy: uid });
      set((s) => {
        const existing = s.leadActivities[leadId] ?? [];
        return { leadActivities: { ...s.leadActivities, [leadId]: [created, ...existing] } };
      });
    } catch (e) {
      fail('Aktivität konnte nicht gespeichert werden.', e);
    }
  },

  deleteLeadActivity: async (id, leadId) => {
    const prev = get().leadActivities;
    set((s) => ({
      leadActivities: {
        ...s.leadActivities,
        [leadId]: (s.leadActivities[leadId] ?? []).filter((a) => a.id !== id),
      },
    }));
    try {
      await deleteLeadActivityRow(id);
    } catch (e) {
      fail('Löschen fehlgeschlagen.', e);
      set({ leadActivities: prev });
    }
  },

  purgeCustomer: async (customerNumber, customerName) => {
    try {
      const counts = await purgeCustomerData(customerNumber);
      set((s) => ({
        contracts: s.contracts.filter((x) => x.customerNumber !== customerNumber),
        tariffChanges: s.tariffChanges.filter((x) => x.customerNumber !== customerNumber),
        notes: s.notes.filter((x) => x.customerNumber !== customerNumber),
        customerOwners: Object.fromEntries(
          Object.entries(s.customerOwners).filter(([k]) => k !== customerNumber),
        ),
      }));
      const total = counts.contracts + counts.tariffChanges + counts.notes;
      toast.success(`Kunde gelöscht (${total} Einträge entfernt).`);
      logAudit({
        action: 'purge',
        entityType: 'customer',
        entityId: customerNumber,
        entityLabel: customerName ?? customerNumber,
        details: counts as unknown as Record<string, unknown>,
      });
    } catch (e) {
      fail('Kundendaten konnten nicht gelöscht werden.', e);
    }
  },
}));
