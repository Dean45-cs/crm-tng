import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Contract,
  TariffChange,
  Note,
  Settings,
  ProductInfo,
  ProductType,
  TariffCommissionMatrix,
} from '../types';
import { useAuth } from './useAuth';

const currentUserKey = () => useAuth.getState().currentUserKey ?? undefined;

const DEFAULT_PRODUCTS: ProductInfo[] = [
  // Privat
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
  // Business
  { name: 'Lite 1000', category: 'Business', commission: 30 },
  { name: 'Basic 1000', category: 'Business', commission: 40 },
  { name: 'Pro 1000', category: 'Business', commission: 50 },
  { name: 'Premium 1000', category: 'Business', commission: 70 },
  { name: 'Winback Business', category: 'Business', commission: 12.5 },
  // Zusatz
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
  markTariffChangeExported: (id: string) => void;

  addNote: (n: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateNote: (id: string, n: Partial<Note>) => void;
  deleteNote: (id: string) => void;

  updateSettings: (s: Partial<Settings>) => void;
  updateProductCommission: (product: ProductType, commission: number) => void;
  updateTariffCommission: (matrix: TariffCommissionMatrix) => void;
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
        products: DEFAULT_PRODUCTS,
        tariffCommission: DEFAULT_TARIFF_COMMISSION,
        monthlyTarget: 500,
        jiraBaseUrl: 'https://jira.tng.de/browse/',
        agentName: 'Auszubildende:r',
        spClientId: '',
        spTenantId: '',
        spFilePath: '',
        spSheetName: 'Tabelle1',
      },

      addContract: (c) =>
        set((s) => ({
          contracts: [
            ...s.contracts,
            {
              ...c,
              id: uid(),
              createdAt: new Date().toISOString(),
              createdBy: c.createdBy ?? currentUserKey(),
            },
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
            {
              ...t,
              id: uid(),
              createdAt: new Date().toISOString(),
              createdBy: t.createdBy ?? currentUserKey(),
            },
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
      markTariffChangeExported: (id) =>
        set((s) => ({
          tariffChanges: s.tariffChanges.map((x) =>
            x.id === id ? { ...x, exportedAt: new Date().toISOString() } : x,
          ),
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
      updateProductCommission: (product, commission) =>
        set((state) => ({
          settings: {
            ...state.settings,
            products: state.settings.products.map((p) =>
              p.name === product ? { ...p, commission } : p,
            ),
          },
        })),
      updateTariffCommission: (matrix) =>
        set((state) => ({
          settings: { ...state.settings, tariffCommission: matrix },
        })),
    }),
    {
      name: 'crm-tng-store',
      version: 3,
    },
  ),
);
