import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  incentiveValue,
  incentiveStandings,
  incentiveReached,
  isLeader,
} from './incentives';
import type { Contract, TariffChange, Settings, Incentive } from '../types';
import type { AuthUser } from '../store/useAuth';

const settings: Settings = {
  products: [{ name: 'Fibrefamily', category: 'Privat', commission: 10 }],
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

const user = (key: string, displayName: string): AuthUser => ({
  key,
  displayName,
  pinHash: '',
  salt: '',
  createdAt: '2025-01-01T00:00:00.000Z',
  onboardingCompleted: true,
  leaderboardOptIn: true,
  role: 'agent',
  isActive: true,
  monthlyTarget: 0,
});

const incentive = (over: Partial<Incentive>): Incentive => ({
  id: 'i1',
  title: 'Test',
  mechanic: 'goal',
  metric: 'commission',
  period: 'monthly',
  target: 5,
  reward: 'Gutschein',
  active: true,
  createdAt: '2025-06-01T00:00:00.000Z',
  updatedAt: '2025-06-01T00:00:00.000Z',
  ...over,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('incentiveValue', () => {
  it('summiert Provision in der Periode (Verträge + Tarifwechsel)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 5, 11));
    const contracts = [contract({ createdBy: 'a1' })]; // 10
    const tariffs = [tariff({ createdBy: 'a1' })]; // 7.5
    expect(incentiveValue(incentive({ metric: 'commission' }), 'a1', contracts, tariffs, settings)).toBe(17.5);
  });

  it('zählt bei "contracts" keine Stornos', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 5, 11));
    const contracts = [
      contract({ createdBy: 'a1', status: 'aktiv' }),
      contract({ createdBy: 'a1', status: 'storniert' }),
    ];
    expect(incentiveValue(incentive({ metric: 'contracts' }), 'a1', contracts, [], settings)).toBe(1);
  });

  it('zählt bei "deals" Verträge (ohne Storno) plus Tarifwechsel', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 5, 11));
    const contracts = [
      contract({ createdBy: 'a1', status: 'aktiv' }),
      contract({ createdBy: 'a1', status: 'storniert' }),
    ];
    const tariffs = [tariff({ createdBy: 'a1' })];
    expect(incentiveValue(incentive({ metric: 'deals' }), 'a1', contracts, tariffs, settings)).toBe(2);
  });
});

describe('incentiveReached', () => {
  it('ist erreicht, wenn der Wert das Ziel erreicht', () => {
    expect(incentiveReached(incentive({ mechanic: 'goal', target: 5 }), 10)).toBe(true);
    expect(incentiveReached(incentive({ mechanic: 'goal', target: 5 }), 3)).toBe(false);
  });
  it('ist bei Wettbewerben nie "erreicht"', () => {
    expect(incentiveReached(incentive({ mechanic: 'competition', target: 0 }), 999)).toBe(false);
  });
});

describe('incentiveStandings / isLeader', () => {
  it('vergibt absteigende Ränge und erkennt den Anführer', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 5, 11));
    const users = { a1: user('a1', 'Alice'), a2: user('a2', 'Bob') };
    const contracts = [contract({ createdBy: 'a1' })]; // Alice 10, Bob 0
    const standings = incentiveStandings(incentive({ metric: 'commission' }), users, contracts, [], settings);

    expect(standings[0].key).toBe('a1');
    expect(standings[0].rank).toBe(1);
    expect(standings[1].rank).toBe(2);
    expect(isLeader(standings, 'a1')).toBe(true);
    expect(isLeader(standings, 'a2')).toBe(false);
  });
});
