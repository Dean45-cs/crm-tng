import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Contract,
  TariffChange,
  Note,
  Settings,
  ProductType,
  CommissionRate,
} from '../types';

const DEFAULT_RATES: CommissionRate[] = [
  { product: 'Glasfaser 100', newContract: 40, tariffChange: 15 },
  { product: 'Glasfaser 250', newContract: 60, tariffChange: 20 },
  { product: 'Glasfaser 500', newContract: 80, tariffChange: 25 },
  { product: 'Glasfaser 1000', newContract: 110, tariffChange: 35 },
  { product: 'Glasfaser 2000', newContract: 150, tariffChange: 50 },
  { product: 'TV-Paket', newContract: 25, tariffChange: 10 },
  { product: 'Telefon-Flat', newContract: 20, tariffChange: 8 },
  { product: 'Mobilfunk', newContract: 30, tariffChange: 12 },
];

interface StoreState {
  contracts: Contract[];
  tariffChanges: TariffChange[];
  notes: Note[];
  settings: Settings;

  addContract: (c: Omit<Contract, 'id' | 'createdAt'>) => void;
  updateContract: (id: string, c: Partial<Contract>) => void;
  deleteContract: (id: string) => void;

  addTariffChange: (t: Omit<TariffChange, 'id' | 'createdAt'>) => void;
  updateTariffChange: (id: string, t: Partial<TariffChange>) => void;
  deleteTariffChange: (id: string) => void;

  addNote: (n: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateNote: (id: string, n: Partial<Note>) => void;
  deleteNote: (id: string) => void;

  updateSettings: (s: Partial<Settings>) => void;
  updateCommissionRate: (product: ProductType, rate: Partial<CommissionRate>) => void;
}

const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
      contracts: [],
      tariffChanges: [],
      notes: [],
      settings: {
        commissionRates: DEFAULT_RATES,
        monthlyTarget: 1500,
        jiraBaseUrl: 'https://jira.tng.de/browse/',
        agentName: 'Auszubildende:r',
      },

      addContract: (c) =>
        set((s) => ({
          contracts: [
            ...s.contracts,
            { ...c, id: uid(), createdAt: new Date().toISOString() },
          ],
        })),
      updateContract: (id, c) =>
        set((s) => ({
          contracts: s.contracts.map((x) =>
            x.id === id ? { ...x, ...c } : x,
          ),
        })),
      deleteContract: (id) =>
        set((s) => ({ contracts: s.contracts.filter((x) => x.id !== id) })),

      addTariffChange: (t) =>
        set((s) => ({
          tariffChanges: [
            ...s.tariffChanges,
            { ...t, id: uid(), createdAt: new Date().toISOString() },
          ],
        })),
      updateTariffChange: (id, t) =>
        set((s) => ({
          tariffChanges: s.tariffChanges.map((x) =>
            x.id === id ? { ...x, ...t } : x,
          ),
        })),
      deleteTariffChange: (id) =>
        set((s) => ({
          tariffChanges: s.tariffChanges.filter((x) => x.id !== id),
        })),

      addNote: (n) =>
        set((s) => ({
          notes: [
            ...s.notes,
            {
              ...n,
              id: uid(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        })),
      updateNote: (id, n) =>
        set((s) => ({
          notes: s.notes.map((x) =>
            x.id === id ? { ...x, ...n, updatedAt: new Date().toISOString() } : x,
          ),
        })),
      deleteNote: (id) =>
        set((s) => ({ notes: s.notes.filter((x) => x.id !== id) })),

      updateSettings: (s) =>
        set((state) => ({ settings: { ...state.settings, ...s } })),
      updateCommissionRate: (product, rate) =>
        set((state) => ({
          settings: {
            ...state.settings,
            commissionRates: state.settings.commissionRates.map((r) =>
              r.product === product ? { ...r, ...rate } : r,
            ),
          },
        })),
    }),
    { name: 'crm-tng-store' },
  ),
);
