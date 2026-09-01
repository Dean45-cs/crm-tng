import { describe, it, expect } from 'vitest';
import {
  incentiveValue,
  incentiveStandings,
  incentiveReached,
  isLeader,
} from './incentives';
import { today } from './utils';
import { testSettings, makeContract, makeTariff } from '../test/fixtures';
import type { Incentive } from '../types';
import type { AuthUser } from '../store/useAuth';

const baseIncentive: Incentive = {
  id: 'i1',
  title: 'Test',
  mechanic: 'goal',
  metric: 'commission',
  period: 'monthly',
  target: 100,
  reward: 'Gutschein',
  active: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

function user(key: string, displayName: string): AuthUser {
  return {
    key,
    displayName,
    pinHash: '',
    salt: '',
    createdAt: '2024-01-01T00:00:00.000Z',
    onboardingCompleted: true,
    leaderboardOptIn: true,
    role: 'agent',
    isActive: true,
    monthlyTarget: 0,
  };
}

describe('incentiveValue', () => {
  it('summiert Provision aus Verträgen und Tarifwechseln der Periode', () => {
    const contracts = [
      makeContract({ createdBy: 'a', contractDate: today(), products: ['Fibrefamily'] }), // 50
    ];
    const tariffs = [
      makeTariff({ createdBy: 'a', changeDate: today(), changeType: 'upgrade', context: 'mvlz_gt3' }), // 30
    ];
    const v = incentiveValue(baseIncentive, 'a', contracts, tariffs, testSettings);
    expect(v).toBe(80);
  });

  it('zählt nur die Daten des jeweiligen Agenten', () => {
    const contracts = [
      makeContract({ createdBy: 'a', contractDate: today() }),
      makeContract({ createdBy: 'b', contractDate: today() }),
    ];
    const v = incentiveValue(baseIncentive, 'a', contracts, [], testSettings);
    expect(v).toBe(50);
  });

  it('metric "contracts" ignoriert Stornos', () => {
    const inc: Incentive = { ...baseIncentive, metric: 'contracts' };
    const contracts = [
      makeContract({ createdBy: 'a', contractDate: today(), status: 'aktiv' }),
      makeContract({ createdBy: 'a', contractDate: today(), status: 'storniert' }),
    ];
    expect(incentiveValue(inc, 'a', contracts, [], testSettings)).toBe(1);
  });

  it('metric "deals" zählt aktive Verträge plus Tarifwechsel', () => {
    const inc: Incentive = { ...baseIncentive, metric: 'deals' };
    const contracts = [
      makeContract({ createdBy: 'a', contractDate: today() }),
      makeContract({ createdBy: 'a', contractDate: today(), status: 'storniert' }),
    ];
    const tariffs = [makeTariff({ createdBy: 'a', changeDate: today() })];
    expect(incentiveValue(inc, 'a', contracts, tariffs, testSettings)).toBe(2);
  });
});

describe('incentiveStandings', () => {
  it('sortiert absteigend und vergibt eindeutige Ränge', () => {
    const users: Record<string, AuthUser> = {
      a: user('a', 'Anna'),
      b: user('b', 'Ben'),
    };
    const contracts = [
      makeContract({ createdBy: 'a', contractDate: today(), products: ['Fibrepro'] }), // 80
      makeContract({ createdBy: 'b', contractDate: today(), products: ['Fibrefamily'] }), // 50
    ];
    const standings = incentiveStandings(baseIncentive, users, contracts, [], testSettings);
    expect(standings.map((s) => s.key)).toEqual(['a', 'b']);
    expect(standings[0].rank).toBe(1);
    expect(standings[1].rank).toBe(2);
  });

  it('lässt gesperrte Konten aus dem Teilnehmerfeld heraus', () => {
    const users: Record<string, AuthUser> = {
      a: user('a', 'Anna'),
      b: user('b', 'Ben'),
      z: { ...user('z', 'Alt-Zugang'), isActive: false },
    };
    const contracts = [
      makeContract({ createdBy: 'a', contractDate: today(), products: ['Fibrefamily'] }), // 50
      // Der gesperrte Zugang hätte mit 80 sonst Platz 1 belegt.
      makeContract({ createdBy: 'z', contractDate: today(), products: ['Fibrepro'] }),
    ];
    const standings = incentiveStandings(baseIncentive, users, contracts, [], testSettings);
    expect(standings.map((s) => s.key)).toEqual(['a', 'b']);
    expect(standings).toHaveLength(2);
    expect(standings[0].rank).toBe(1);
  });
});

describe('incentiveReached', () => {
  it('ist nur bei Zielprämien und erreichtem Ziel wahr', () => {
    expect(incentiveReached(baseIncentive, 100)).toBe(true);
    expect(incentiveReached(baseIncentive, 99)).toBe(false);
    expect(incentiveReached({ ...baseIncentive, mechanic: 'competition' }, 999)).toBe(false);
  });
});

describe('isLeader', () => {
  it('erkennt Platz 1 mit Wert > 0', () => {
    const standings = [
      { key: 'a', displayName: 'Anna', value: 80, rank: 1 },
      { key: 'b', displayName: 'Ben', value: 50, rank: 2 },
    ];
    expect(isLeader(standings, 'a')).toBe(true);
    expect(isLeader(standings, 'b')).toBe(false);
  });

  it('niemand führt bei lauter Nullwerten', () => {
    const standings = [{ key: 'a', displayName: 'Anna', value: 0, rank: 1 }];
    expect(isLeader(standings, 'a')).toBe(false);
  });
});
