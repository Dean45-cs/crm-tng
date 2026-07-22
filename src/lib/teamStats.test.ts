import { describe, it, expect } from 'vitest';
import { agentStats, attainmentPct, teamKpis, monthlySeries, trendPct } from './teamStats';
import { today } from './utils';
import { testSettings, makeContract, makeTariff, makeLead } from '../test/fixtures';

/** ISO-Datum (YYYY-MM-DD) für "vor N Monaten, am 15." — relativ zu heute,
 * damit die Tests unabhängig vom Ausführungsdatum stabil bleiben. */
function isoMonthsAgo(monthsAgo: number): string {
  const d = new Date();
  d.setDate(15);
  d.setMonth(d.getMonth() - monthsAgo);
  return d.toISOString().slice(0, 10);
}

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

  it('trennt Vertrags- von Tarifwechsel-Provision im Monat (für gestapelte Charts)', () => {
    const contracts = [
      makeContract({ createdBy: 'a', contractDate: '2024-06-10', products: ['Fibrefamily'] }), // 50
    ];
    const tariffs = [
      makeTariff({ createdBy: 'a', changeDate: '2024-06-12', changeType: 'upgrade', context: 'mvlz_gt3' }), // 30
    ];
    const s = agentStats('a', contracts, tariffs, testSettings, ref);
    expect(s.monthContractCommission).toBe(50);
    expect(s.monthTariffCommission).toBe(30);
    expect(s.monthCommission).toBe(80);
  });
});

describe('monthlySeries', () => {
  it('liefert die angeforderte Anzahl Monate, aktueller Monat zuletzt', () => {
    expect(monthlySeries([], [], testSettings, 3).length).toBe(3);
  });

  it('ordnet Provision dem richtigen Monat zu', () => {
    const contracts = [
      makeContract({ contractDate: isoMonthsAgo(0), products: ['Fibrefamily'] }), // 50, aktueller Monat
      makeContract({ contractDate: isoMonthsAgo(1), products: ['Fibrepro'] }), // 80, Vormonat
    ];
    const series = monthlySeries(contracts, [], testSettings, 3);
    expect(series[series.length - 1].contractCommission).toBe(50);
    expect(series[series.length - 2].contractCommission).toBe(80);
  });

  it('filtert nach agentKey, wenn angegeben', () => {
    const contracts = [
      makeContract({ createdBy: 'a', contractDate: isoMonthsAgo(0), products: ['Fibrefamily'] }), // 50
      makeContract({ createdBy: 'b', contractDate: isoMonthsAgo(0), products: ['Fibrepro'] }), // 80
    ];
    const series = monthlySeries(contracts, [], testSettings, 1, 'a');
    expect(series[0].contractCommission).toBe(50);
  });

  it('summiert Tarifwechsel getrennt von Verträgen', () => {
    const tariffs = [
      makeTariff({ changeDate: isoMonthsAgo(0), changeType: 'upgrade', context: 'mvlz_gt3' }), // 30
    ];
    const series = monthlySeries([], tariffs, testSettings, 1);
    expect(series[0].tariffCommission).toBe(30);
    expect(series[0].contractCommission).toBe(0);
  });
});

describe('trendPct', () => {
  it('rechnet prozentuale Veränderung ggü. dem Vormonat', () => {
    expect(trendPct(150, 100)).toBe(50);
    expect(trendPct(50, 100)).toBe(-50);
  });

  it('liefert 100 bei Sprung von 0 auf einen positiven Wert', () => {
    expect(trendPct(100, 0)).toBe(100);
  });

  it('liefert 0, wenn weder Vormonat noch aktueller Monat etwas hatten', () => {
    expect(trendPct(0, 0)).toBe(0);
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

describe('teamKpis', () => {
  it('berechnet Ø Provision pro Abschluss im Monat', () => {
    const contracts = [
      makeContract({ contractDate: today(), products: ['Fibrefamily'] }), // 50
      makeContract({ contractDate: today(), products: ['Fibrepro'] }), // 80
    ];
    const k = teamKpis(contracts, [], [], testSettings);
    expect(k.avgCommissionPerDeal).toBe(65);
  });

  it('zählt offene Leads und die Lead-Conversion', () => {
    const leads = [
      makeLead({ status: 'neu' }),
      makeLead({ status: 'inBearbeitung' }),
      makeLead({ status: 'gewonnen' }),
      makeLead({ status: 'gewonnen' }),
      makeLead({ status: 'verloren' }),
    ];
    const k = teamKpis([], [], leads, testSettings);
    expect(k.openLeads).toBe(2);
    expect(k.leadConversion).toBe(67); // 2 / 3
  });

  it('leadConversion ist null ohne abgeschlossene Leads', () => {
    const leads = [makeLead({ status: 'neu' })];
    expect(teamKpis([], [], leads, testSettings).leadConversion).toBeNull();
  });

  it('zählt fällige Wiedervorlagen (heute + überfällig) über Verträge und Leads', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const contracts = [
      makeContract({ followUpDate: today() }),
      makeContract({ followUpDate: iso(yesterday) }),
      makeContract({ followUpDate: undefined }),
    ];
    const leads = [makeLead({ followUpDate: today() })];
    const k = teamKpis(contracts, [], leads, testSettings);
    expect(k.dueFollowUps).toBe(3);
  });
});
