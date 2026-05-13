export type ContractStatus = 'offen' | 'aktiv' | 'storniert';

export type ProductType =
  | 'Glasfaser 100'
  | 'Glasfaser 250'
  | 'Glasfaser 500'
  | 'Glasfaser 1000'
  | 'Glasfaser 2000'
  | 'TV-Paket'
  | 'Telefon-Flat'
  | 'Mobilfunk';

export interface Contract {
  id: string;
  customerNumber: string;
  customerName: string;
  product: ProductType;
  monthlyPrice: number;
  contractDate: string;
  status: ContractStatus;
  jiraTicket: string;
  followUpDate?: string;
  notes?: string;
  createdAt: string;
}

export interface TariffChange {
  id: string;
  customerNumber: string;
  customerName: string;
  oldProduct: ProductType;
  newProduct: ProductType;
  oldPrice: number;
  newPrice: number;
  changeDate: string;
  jiraTicket: string;
  notes?: string;
  createdAt: string;
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
}

export interface CommissionRate {
  product: ProductType;
  newContract: number;
  tariffChange: number;
}

export interface Settings {
  commissionRates: CommissionRate[];
  monthlyTarget: number;
  jiraBaseUrl: string;
  agentName: string;
}
