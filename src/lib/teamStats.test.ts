import { describe, it, expect } from 'vitest';
import { agentStats, attainmentPct } from './teamStats';
import { testSettings, makeContract, makeTariff } from '../test/fixtures';

describe('agentStats', () => {
  const ref = new Date(2024, 5, 15); // Juni 2024

  it('trennt Monats- von Gesamtwerten', () => {
    const contracts = [
      makeContract({ createdBy: 'a', contractDate: '2024-06-10', products: ['Fibrefamily'] }), // 50, im Monat
      makeContract({ createdBy: 'a', contractDate: '2024-05-10', products: ['Fibrepro'] }), // 80, Vormonat
    ];
    const s = agentStats('a', contracts, [], testSettings, ref);
    expect(s.monthCommission).toBe(50);
    expect(s.totalCommission).toBe(130);
    expect(s.monthContracts).toBe(1);
    expect(s.totalDeals).toBe(2);
  });

  it('stornierte Verträge zählen nicht als Abschluss, aber Provision bleibt 0', () => {
    const contracts = [
      makeContract({ createdBy: 'a', contractDate: '2024-06-10', status: 'storniert' }),
    ];
    const s = agentStats('a', contracts, [], testSettings, ref);
    expect(s.monthCommission).toBe(0);
    expect(s.monthDeals).toBe(0);
    expect(s.totalDeals).toBe(0);
  });

  it('zählt Tarifwechsel als Abschluss', () => {
    const tariffs = [
      makeTariff({ createdBy: 'a', changeDate: '2024-06-12', changeType: 'upgrade', context: 'mvlz_gt3' }), // 30
    ];
    const s = agentStats('a', [], tariffs, testSettings, ref);
    expect(s.monthCommission).toBe(30);
    expect(s.monthTariffs).toBe(1);
    expect(s.monthDeals).toBe(1);
  });

  it('ignoriert Daten anderer Agenten', () => {
    const contracts = [makeContract({ createdBy: 'b', contractDate: '2024-06-10' })];
    const s = agentStats('a', contracts, [], testSettings, ref);
    expect(s.totalDeals).toBe(0);
  });
});

describe('attainmentPct', () => {
  it('rechnet Prozent der Zielerreichung', () => {
    expect(attainmentPct(750, 1500)).toBe(50);
    expect(attainmentPct(1500, 1500)).toBe(100);
  });

  it('liefert null ohne gesetztes Ziel', () => {
    expect(attainmentPct(500, 0)).toBeNull();
  });
});
