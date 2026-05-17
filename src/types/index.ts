export type ContractStatus = 'offen' | 'aktiv' | 'storniert';

export type ProductCategory = 'Privat' | 'Business' | 'Zusatz';

export type ProductType =
  // Privat
  | 'Fibrelight'
  | 'Fibrefamily'
  | 'Fibrepro'
  | 'Flott50'
  | 'Flott300'
  | 'Flott500'
  | 'Surf100'
  | 'Surf1.000'
  | 'Smart300'
  | 'Smart1.000'
  | 'Family1.000'
  | 'Max.1.000'
  | 'Winback Privat'
  // Business
  | 'Lite 1000'
  | 'Basic 1000'
  | 'Pro 1000'
  | 'Premium 1000'
  | 'Winback Business'
  // Zusatz
  | 'Waipu TV'
  | 'Mobilfunk LTE Smart 4G'
  | 'Mobilfunk LTE Komplett 4G'
  | 'Mobilfunk LTE Smart 5G'
  | 'Mobilfunk LTE Komplett 5G';

export interface ProductInfo {
  name: ProductType;
  category: ProductCategory;
  commission: number;
}

export type TariffChangeType = 'sidegrade' | 'upgrade';
export type TariffContext = 'mvlz_gt3' | 'mvlz_lt3' | 'outside_mvlz';

export interface Contract {
  id: string;
  customerNumber: string;
  customerName: string;
  /** Ein Vertrag kann mehrere Produkte enthalten (Bundle-Verkauf) */
  products: ProductType[];
  contractDate: string;
  status: ContractStatus;
  jiraTicket: string;
  followUpDate?: string;
  notes?: string;
  createdAt: string;
  /** Key des angemeldeten Nutzers, der den Vertrag erfasst hat */
  createdBy?: string;
}

export interface TariffChange {
  id: string;
  customerNumber: string;
  customerName: string;
  changeType: TariffChangeType;
  context: TariffContext;
  oldProduct?: ProductType;
  newProduct?: ProductType;
  changeDate: string;
  jiraTicket: string;
  notes?: string;
  createdAt: string;
  /** Key des angemeldeten Nutzers, der den Wechsel erfasst hat */
  createdBy?: string;
  /** ISO-Zeitstempel, gesetzt nach erfolgreichem SharePoint-Export */
  exportedAt?: string;
}

export interface Note {
  id: string;
  customerNumber?: string;
  customerName?: string;
  title: string;
  content: string;
  jiraTicket?: string;
  createdAt: string;
  updatedAt: string;
  /** Key des angemeldeten Nutzers, der die Notiz erfasst hat */
  createdBy?: string;
}

export interface TariffCommissionMatrix {
  sidegrade: { mvlz_gt3: number; mvlz_lt3: number; outside_mvlz: number };
  upgrade: { mvlz_gt3: number; mvlz_lt3: number; outside_mvlz: number };
}

export interface Settings {
  products: ProductInfo[];
  tariffCommission: TariffCommissionMatrix;
  monthlyTarget: number;
  jiraBaseUrl: string;
  agentName: string;
  spClientId: string;
  spTenantId: string;
  spFilePath: string;
  spSheetName: string;
}

/** Abgeleitete Kunden-Aggregation aus den Daten */
export interface CustomerSummary {
  customerNumber: string;
  customerName: string;
  contractCount: number;
  tariffChangeCount: number;
  noteCount: number;
  totalCommission: number;
  lastActivity: string;
}

/** Wer einen Kunden besitzt und mit wem er geteilt wird */
export interface CustomerOwnership {
  /** User-Key des Besitzers */
  owner: string;
  /** User-Keys, mit denen der Kunde geteilt wird */
  sharedWith: string[];
}

/** Zielprämie (jede:r, der/die das Ziel erreicht) oder Wettbewerb (nur Platz 1) */
export type IncentiveMechanic = 'goal' | 'competition';
/** Was gemessen wird: Provision (€), Anzahl Verträge oder Abschlüsse gesamt */
export type IncentiveMetric = 'commission' | 'contracts' | 'deals';
export type IncentivePeriod = 'weekly' | 'monthly';

/** Zeitlich begrenztes Team-Ziel mit Belohnung, vom Chef konfiguriert */
export interface Incentive {
  id: string;
  title: string;
  mechanic: IncentiveMechanic;
  metric: IncentiveMetric;
  period: IncentivePeriod;
  /** Zielwert — nur bei mechanic === 'goal' relevant, sonst 0 */
  target: number;
  reward: string;
  active: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}
