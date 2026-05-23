import { describe, it, expect } from 'vitest';
import { agentStats, attainmentPct } from './teamStats';
import type { Contract, TariffChange, Settings } from '../types';

const settings: Settings = {
  products: [
    { name: 'Fibrefamily', category: 'Privat', commission: 10 },
    { name: 'Fibrepro', category: 'Privat', commission: 15 },
  ],
  tariffCommission: {
    sidegrade: { mvlz_gt3: 0, mvlz_lt3: 5, outside_mvlz: 5 },
    upgrade: { mvlz_gt3: 5, mvlz_lt3: 7.5, outside_mvlz: 7.5 },
  },
  monthlyTarget: 500,
  spClientId: '',
  spTenantId: '',
  spFilePath: '',
  spSheetName: 'Tabelle1',
};

const contract = (over: Partial<Contract>): Contract => ({
  id: Math.random().toString(36),
  customerNumber: '1000',
  customerName: 'Test',
  products: ['Fibrefamily'],
  contractDate: '2025-06-10',
  status: 'aktiv',
  jiraTicket: '',
  createdAt: '2025-06-10T00:00:00.000Z',
  ...over,
});

const tariff = (over: Partial<TariffChange>): TariffChange => ({
  id: Math.random().toString(36),
  customerNumber: '1000',
  customerName: 'Test',
  changeType: 'upgrade',
  context: 'mvlz_lt3',
  changeDate: '2025-06-10',
  jiraTicket: '',
  createdAt: '2025-06-10T00:00:00.000Z',
  ...over,
});

describe('agentStats', () => {
  const ref = new Date(2025, 5, 11); // Juni 2025

  it('zählt stornierte Verträge nicht als Abschluss', () => {
    const contracts = [
      contract({ createdBy: 'a1', status: 'aktiv', products: ['Fibrefamily'] }),
      contract({ createdBy: 'a1', status: 'storniert', products: ['Fibrepro'] }),
      contract({ createdBy: 'a2', status: 'aktiv', products: ['Fibrepro'] }),
    ];
    const tariffs = [tariff({ createdBy: 'a1' })];

    const s = agentStats('a1', contracts, tariffs, settings, ref);

    expect(s.totalDeals).toBe(2); // 1 aktiver Vertrag + 1 Tarifwechsel (Storno zählt nicht)
    expect(s.totalCommission).toBe(17.5); // 10 + 0 (Storno) + 7.5
    expect(s.monthContracts).toBe(1);
    expect(s.monthTariffs).toBe(1);
    expect(s.monthDeals).toBe(2);
    expect(s.monthCommission).toBe(17.5);
  });
});

describe('attainmentPct', () => {
  it('rechnet den Prozentwert', () => {
    expect(attainmentPct(250, 500)).toBe(50);
  });
  it('liefert null ohne Ziel', () => {
    expect(attainmentPct(100, 0)).toBeNull();
  });
});
