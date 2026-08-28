import type {
  Contract,
  TariffChange,
  Settings,
  Lead,
  Customer,
  Note,
  Call,
  Campaign,
  OutboundContact,
} from '../types';

/** Minimale, deterministische Settings für Tests. */
export const testSettings: Settings = {
  products: [
    { name: 'Fibrefamily', category: 'Privat', commission: 50 },
    { name: 'Fibrepro', category: 'Privat', commission: 80 },
    { name: 'Waipu TV', category: 'Zusatz', commission: 10 },
  ],
  tariffCommission: {
    sidegrade: { mvlz_gt3: 15, mvlz_lt3: 10, outside_mvlz: 5 },
    upgrade: { mvlz_gt3: 30, mvlz_lt3: 20, outside_mvlz: 12 },
  },
  monthlyTarget: 1500,
  jiraBaseUrl: '',
  spClientId: '',
  spTenantId: '',
  spFilePath: '',
  spSheetName: '',
};

let seq = 0;

export function makeContract(over: Partial<Contract> = {}): Contract {
  seq += 1;
  return {
    id: `c${seq}`,
    customerNumber: '1000',
    customerName: 'Test Kunde',
    products: ['Fibrefamily'],
    contractDate: '2024-06-15',
    status: 'aktiv',
    jiraTicket: '',
    createdAt: '2024-06-15T10:00:00.000Z',
    createdBy: 'agent-1',
    ...over,
  };
}

export function makeTariff(over: Partial<TariffChange> = {}): TariffChange {
  seq += 1;
  return {
    id: `t${seq}`,
    customerNumber: '1000',
    customerName: 'Test Kunde',
    changeType: 'upgrade',
    context: 'mvlz_gt3',
    changeDate: '2024-06-15',
    jiraTicket: '',
    createdAt: '2024-06-15T10:00:00.000Z',
    createdBy: 'agent-1',
    ...over,
  };
}

export function makeLead(over: Partial<Lead> = {}): Lead {
  seq += 1;
  return {
    id: `l${seq}`,
    customerName: 'Lead Kunde',
    status: 'neu',
    priority: 'normal',
    createdAt: '2024-06-15T10:00:00.000Z',
    updatedAt: '2024-06-15T10:00:00.000Z',
    createdBy: 'agent-1',
    ...over,
  };
}

export function makeNote(over: Partial<Note> = {}): Note {
  seq += 1;
  return {
    id: `n${seq}`,
    customerNumber: '1000',
    customerName: 'Test Kunde',
    title: 'Telefonat',
    content: 'Testnotiz',
    createdAt: '2024-06-15T10:00:00.000Z',
    updatedAt: '2024-06-15T10:00:00.000Z',
    createdBy: 'agent-1',
    ...over,
  };
}

export function makeCall(over: Partial<Call> = {}): Call {
  seq += 1;
  return {
    id: `call${seq}`,
    customerNumber: '1000',
    direction: 'inbound',
    startedAt: '2024-06-15T10:00:00.000Z',
    endedAt: '2024-06-15T10:05:00.000Z',
    durationS: 300,
    agentId: 'agent-1',
    ...over,
  };
}

export function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    customerNumber: '1000',
    name: 'Test Kunde',
    firstSeenAt: '2024-06-15T10:00:00.000Z',
    lastContactAt: '2024-06-15T10:00:00.000Z',
    createdBy: 'agent-1',
    ...over,
  };
}

export function makeCampaign(over: Partial<Campaign> = {}): Campaign {
  seq += 1;
  return {
    id: `k${seq}`,
    name: 'Testkampagne',
    callType: 'other',
    active: true,
    bonusTermin: 5,
    bonusAbschluss: 20,
    maxAttempts: 3,
    createdAt: '2024-06-01T10:00:00.000Z',
    ...over,
  };
}

export function makeContact(over: Partial<OutboundContact> = {}): OutboundContact {
  seq += 1;
  return {
    id: `o${seq}`,
    campaignId: 'k1',
    customerName: 'Anrufliste Kunde',
    phone: '040123456',
    status: 'offen',
    attempts: 0,
    dedupeKey: `tel:040123456-${seq}`,
    createdAt: '2024-06-01T10:00:00.000Z',
    updatedAt: '2024-06-01T10:00:00.000Z',
    ...over,
  };
}
