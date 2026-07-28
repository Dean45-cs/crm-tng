import { describe, it, expect } from 'vitest';
import { buildReport, deltaPct, formatDuration, type ReportSource } from './reporting';
import { resolveRange, type DateRange } from './reportRange';
import {
  testSettings,
  makeContract,
  makeTariff,
  makeCall,
  makeLead,
  makeNote,
} from '../test/fixtures';
import type { Campaign } from '../types';

const JUNE_2024: DateRange = resolveRange('custom', { from: '2024-06-01', to: '2024-06-30' });
const MAY_2024: DateRange = resolveRange('custom', { from: '2024-05-01', to: '2024-05-31' });

const campaigns: Campaign[] = [
  { id: 'camp-1', name: 'Rückgewinnung Juni', callType: 'churn', active: true, createdAt: '2024-06-01T00:00:00.000Z' },
  { id: 'camp-2', name: 'Willkommen', callType: 'welcome', active: true, createdAt: '2024-06-01T00:00:00.000Z' },
];

const agents = [
  { key: 'agent-1', displayName: 'Kevin', monthlyTarget: 1500 },
  { key: 'agent-2', displayName: 'Sam', monthlyTarget: 1000 },
];

/** Basis-Quelle; einzelne Felder pro Test überschrieben. */
function source(over: Partial<ReportSource> = {}): ReportSource {
  return {
    contracts: [],
    tariffChanges: [],
    notes: [],
    leads: [],
    calls: [],
    campaigns,
    settings: testSettings,
    agents,
    ...over,
  };
}

describe('buildReport · Zeitraumfilter', () => {
  it('zählt nur Vorgänge innerhalb des Zeitraums', () => {
    const src = source({
      contracts: [
        makeContract({ contractDate: '2024-06-15', products: ['Fibrefamily'] }), // 50, drin
        makeContract({ contractDate: '2024-05-31', products: ['Fibrepro'] }), // 80, davor
        makeContract({ contractDate: '2024-07-01', products: ['Fibrepro'] }), // 80, danach
      ],
    });
    const r = buildReport(src, { range: JUNE_2024 });
    expect(r.sales.contractCount).toBe(1);
    expect(r.sales.commission).toBe(50);
  });

  it('schließt beide Zeitraumgrenzen ein', () => {
    const src = source({
      contracts: [
        makeContract({ contractDate: '2024-06-01' }),
        makeContract({ contractDate: '2024-06-30' }),
      ],
    });
    expect(buildReport(src, { range: JUNE_2024 }).sales.contractCount).toBe(2);
  });

  it('grenzt auf eine Person ein, wenn agentKey gesetzt ist', () => {
    const src = source({
      contracts: [
        makeContract({ createdBy: 'agent-1', products: ['Fibrefamily'] }), // 50
        makeContract({ createdBy: 'agent-2', products: ['Fibrepro'] }), // 80
      ],
    });
    expect(buildReport(src, { range: JUNE_2024 }).sales.commission).toBe(130);
    expect(
      buildReport(src, { range: JUNE_2024, agentKey: 'agent-1' }).sales.commission,
    ).toBe(50);
  });
});

describe('buildReport · Verkauf', () => {
  it('trennt Stornos von gezählten Abschlüssen, Provision bleibt bei 0', () => {
    const src = source({
      contracts: [
        makeContract({ status: 'storniert', products: ['Fibrefamily'] }),
        makeContract({ products: ['Fibrefamily'] }),
      ],
    });
    const r = buildReport(src, { range: JUNE_2024 });
    expect(r.sales.contractCount).toBe(1);
    expect(r.sales.cancelledCount).toBe(1);
    expect(r.sales.deals).toBe(1);
    expect(r.sales.commission).toBe(50); // Storno trägt 0 bei
  });

  it('zählt Tarifwechsel als Abschluss und summiert die Provision', () => {
    const src = source({
      contracts: [makeContract({ products: ['Fibrefamily'] })], // 50
      tariffChanges: [makeTariff({ changeType: 'upgrade', context: 'mvlz_gt3' })], // 30
    });
    const r = buildReport(src, { range: JUNE_2024 });
    expect(r.sales.deals).toBe(2);
    expect(r.sales.commission).toBe(80);
    expect(r.sales.avgPerDeal).toBe(40);
  });

  it('zählt einen Kunden nur beim allerersten Vertrag als Neukunden', () => {
    const src = source({
      contracts: [
        makeContract({ customerNumber: '1000', contractDate: '2024-01-10' }), // Erstvertrag, außerhalb
        makeContract({ customerNumber: '1000', contractDate: '2024-06-10' }), // Folgevertrag
        makeContract({ customerNumber: '2000', contractDate: '2024-06-12' }), // echter Neukunde
      ],
    });
    expect(buildReport(src, { range: JUNE_2024 }).sales.newCustomers).toBe(1);
  });

  it('führt Top-Produkte und den größten Abschluss', () => {
    const src = source({
      contracts: [
        makeContract({ products: ['Fibrefamily'] }),
        makeContract({ products: ['Fibrefamily'] }),
        makeContract({ customerName: 'Groß GmbH', products: ['Fibrepro'] }),
      ],
    });
    const r = buildReport(src, { range: JUNE_2024 });
    expect(r.sales.topProducts[0]).toEqual({ name: 'Fibrefamily', count: 2, commission: 100 });
    expect(r.sales.biggestDeal).toEqual({ name: 'Groß GmbH', amount: 80, kind: 'Neuvertrag' });
  });
});

describe('buildReport · Anrufe', () => {
  it('fasst Volumen, Gesprächszeit und Richtung zusammen', () => {
    const src = source({
      calls: [
        makeCall({ direction: 'outbound', durationS: 120 }),
        makeCall({ direction: 'outbound', durationS: 240 }),
        makeCall({ direction: 'inbound', durationS: 60 }),
      ],
    });
    const r = buildReport(src, { range: JUNE_2024 });
    expect(r.calls.total).toBe(3);
    expect(r.calls.outbound).toBe(2);
    expect(r.calls.inbound).toBe(1);
    expect(r.calls.talkTimeS).toBe(420);
    expect(r.calls.avgDurationS).toBe(140);
  });

  it('rechnet die Save-Rate wie das Team-Dashboard (nur entschiedene Fälle)', () => {
    const src = source({
      calls: [
        makeCall({ disposition: 'gehalten' }),
        makeCall({ disposition: 'gehalten' }),
        makeCall({ disposition: 'gekuendigt' }),
        makeCall({ disposition: 'rueckruf' }), // unentschieden, zählt nicht
      ],
    });
    const r = buildReport(src, { range: JUNE_2024 });
    expect(r.calls.saveRatePct).toBe(67);
    expect(r.calls.withDisposition).toBe(4);
  });

  it('bündelt Kündigungsgründe mit Anteil', () => {
    const src = source({
      calls: [
        makeCall({ disposition: 'gekuendigt', cancellationReason: 'Preis' }),
        makeCall({ disposition: 'gekuendigt', cancellationReason: 'Preis' }),
        makeCall({ disposition: 'gekuendigt', cancellationReason: 'Umzug' }),
      ],
    });
    const rows = buildReport(src, { range: JUNE_2024 }).calls.cancellationReasons;
    expect(rows[0]).toEqual({ reason: 'Preis', count: 2, pct: 67 });
    expect(rows[1]).toEqual({ reason: 'Umzug', count: 1, pct: 33 });
  });

  it('Kampagnenfilter wirkt auf die Anrufe, nicht auf die Provision', () => {
    const src = source({
      contracts: [makeContract({ products: ['Fibrefamily'] })], // 50, ohne Kampagnenbezug
      calls: [
        makeCall({ campaignId: 'camp-1' }),
        makeCall({ campaignId: 'camp-1' }),
        makeCall({ campaignId: 'camp-2' }),
      ],
    });
    const r = buildReport(src, { range: JUNE_2024, campaignId: 'camp-1' });
    expect(r.calls.total).toBe(2);
    expect(r.sales.commission).toBe(50);
  });

  it('verteilt Anrufe auf Tagesstunden und findet die stärkste', () => {
    const at = (hour: number) => {
      const d = new Date(2024, 5, 15, hour, 0, 0);
      return makeCall({ startedAt: d.toISOString(), endedAt: d.toISOString() });
    };
    const src = source({ calls: [at(10), at(10), at(14)] });
    const r = buildReport(src, { range: JUNE_2024 });
    expect(r.calls.hourly).toHaveLength(24);
    expect(r.calls.hourly[10].count).toBe(2);
    expect(r.calls.busiestHour).toBe(10);
  });

  it('ohne Anrufe bleibt die stärkste Stunde leer statt 0 Uhr', () => {
    expect(buildReport(source(), { range: JUNE_2024 }).calls.busiestHour).toBeNull();
  });

  it('verknüpft Anrufe mit Abschlüssen desselben Kunden derselben Person', () => {
    const src = source({
      contracts: [
        makeContract({
          customerNumber: '1000',
          createdBy: 'agent-1',
          createdAt: '2024-06-15T10:30:00.000Z', // 25 min nach Anrufende
        }),
      ],
      calls: [
        makeCall({
          customerNumber: '1000',
          agentId: 'agent-1',
          startedAt: '2024-06-15T10:00:00.000Z',
          endedAt: '2024-06-15T10:05:00.000Z',
        }),
        makeCall({ customerNumber: '9999', agentId: 'agent-1' }), // ohne Treffer
      ],
    });
    const r = buildReport(src, { range: JUNE_2024 });
    expect(r.calls.linkedCount).toBe(1);
    expect(r.calls.conversionPct).toBe(50);
    expect(r.calls.avgMinutesToOutcome).toBe(25);
  });
});

describe('buildReport · Verlauf', () => {
  it('legt für jeden Tag des Monats einen Punkt an, auch für leere', () => {
    const src = source({
      contracts: [makeContract({ contractDate: '2024-06-15', products: ['Fibrefamily'] })],
    });
    const r = buildReport(src, { range: JUNE_2024 });
    expect(r.series).toHaveLength(30);
    const day15 = r.series.find((p) => p.key === '2024-06-15');
    expect(day15?.commission).toBe(50);
    expect(day15?.deals).toBe(1);
    expect(r.series.find((p) => p.key === '2024-06-14')?.commission).toBe(0);
  });

  it('fasst lange Zeiträume zu Monaten zusammen', () => {
    const year = resolveRange('custom', { from: '2024-01-01', to: '2024-12-31' });
    const src = source({
      contracts: [makeContract({ contractDate: '2024-06-15', products: ['Fibrefamily'] })],
    });
    const r = buildReport(src, { range: year });
    expect(r.series).toHaveLength(12);
    expect(r.series.find((p) => p.key === '2024-06')?.commission).toBe(50);
  });

  it('zählt gehaltene Kunden je Punkt mit', () => {
    const src = source({
      calls: [
        makeCall({ startedAt: '2024-06-15T09:00:00.000Z', disposition: 'gehalten' }),
        makeCall({ startedAt: '2024-06-15T11:00:00.000Z', disposition: 'gekuendigt' }),
      ],
    });
    const r = buildReport(src, { range: JUNE_2024 });
    const day = r.series.find((p) => p.key === '2024-06-15');
    expect(day?.calls).toBe(2);
    expect(day?.saved).toBe(1);
  });
});

describe('buildReport · Team-Vergleich', () => {
  it('liefert pro Person eine Zeile, absteigend nach Provision', () => {
    const src = source({
      contracts: [
        makeContract({ createdBy: 'agent-1', products: ['Fibrefamily'] }), // 50
        makeContract({ createdBy: 'agent-2', products: ['Fibrepro'] }), // 80
      ],
    });
    const rows = buildReport(src, { range: JUNE_2024 }).perAgent;
    expect(rows.map((r) => r.displayName)).toEqual(['Sam', 'Kevin']);
    expect(rows[0].commission).toBe(80);
  });

  it('legt das Monatsziel auf den Zeitraum um', () => {
    const src = source({ contracts: [makeContract({ createdBy: 'agent-1', products: ['Fibrepro'] })] });
    const full = buildReport(src, { range: JUNE_2024 }).perAgent.find((r) => r.key === 'agent-1');
    expect(full?.target).toBe(1500);

    const half = resolveRange('custom', { from: '2024-06-01', to: '2024-06-15' });
    const halfRow = buildReport(src, { range: half }).perAgent.find((r) => r.key === 'agent-1');
    expect(halfRow?.target).toBe(750);
    expect(halfRow?.attainmentPct).toBe(11); // 80 / 750
  });

  it('bleibt leer, wenn auf eine Person eingegrenzt wird', () => {
    const r = buildReport(source(), { range: JUNE_2024, agentKey: 'agent-1' });
    expect(r.perAgent).toEqual([]);
  });

  it('Team-Ziel ist die Summe der umgelegten Einzelziele', () => {
    expect(buildReport(source(), { range: JUNE_2024 }).target).toBe(2500);
  });
});

describe('buildReport · Exportzeilen', () => {
  it('löst Mitarbeiter- und Kampagnennamen auf', () => {
    const src = source({
      contracts: [makeContract({ createdBy: 'agent-2', customerName: 'Meier' })],
      calls: [makeCall({ agentId: 'agent-1', campaignId: 'camp-1', disposition: 'gehalten' })],
    });
    const r = buildReport(src, { range: JUNE_2024 });
    expect(r.contractRows[0].agent).toBe('Sam');
    expect(r.callRows[0].agent).toBe('Kevin');
    expect(r.callRows[0].campaign).toBe('Rückgewinnung Juni');
    expect(r.callRows[0].disposition).toBe('Gehalten');
  });

  it('übersetzt Tarifwechsel-Codes in Klartext', () => {
    const src = source({ tariffChanges: [makeTariff({ changeType: 'upgrade', context: 'mvlz_gt3' })] });
    const row = buildReport(src, { range: JUNE_2024 }).tariffRows[0];
    expect(row.changeType).toBe('Upgrade');
    expect(row.commission).toBe(30);
  });

  it('unbekannte Bearbeiter fallen nicht auf undefined zurück', () => {
    const src = source({ contracts: [makeContract({ createdBy: 'geloeschter-user' })] });
    expect(buildReport(src, { range: JUNE_2024 }).contractRows[0].agent).toBe('–');
  });
});

describe('buildReport · Notizen und Leads als Konversionsziel', () => {
  it('zählt auch Lead und Notiz als Ergebnis eines Anrufs', () => {
    const src = source({
      leads: [
        makeLead({
          customerNumber: '1000',
          createdBy: 'agent-1',
          createdAt: '2024-06-15T10:10:00.000Z',
        }),
      ],
      notes: [
        makeNote({
          customerNumber: '2000',
          createdBy: 'agent-1',
          createdAt: '2024-06-15T10:10:00.000Z',
        }),
      ],
      calls: [
        makeCall({ customerNumber: '1000', agentId: 'agent-1', endedAt: '2024-06-15T10:05:00.000Z' }),
        makeCall({ customerNumber: '2000', agentId: 'agent-1', endedAt: '2024-06-15T10:05:00.000Z' }),
      ],
    });
    expect(buildReport(src, { range: JUNE_2024 }).calls.linkedCount).toBe(2);
  });
});

describe('leerer Zeitraum', () => {
  it('liefert Nullwerte statt zu werfen', () => {
    const r = buildReport(source(), { range: MAY_2024 });
    expect(r.sales.commission).toBe(0);
    expect(r.sales.avgPerDeal).toBe(0);
    expect(r.sales.biggestDeal).toBeNull();
    expect(r.calls.saveRatePct).toBeNull();
    expect(r.calls.callsPerActiveDay).toBe(0);
    expect(r.calls.conversionPct).toBeNull();
    expect(r.contractRows).toEqual([]);
  });
});

describe('deltaPct', () => {
  it('rechnet die Veränderung zur Vorperiode', () => {
    expect(deltaPct(150, 100)).toBe(50);
    expect(deltaPct(50, 100)).toBe(-50);
  });

  it('ohne Vorperiodenwert: 100 % bei Zuwachs, null bei beidseitig 0', () => {
    expect(deltaPct(10, 0)).toBe(100);
    expect(deltaPct(0, 0)).toBeNull();
  });
});

describe('formatDuration', () => {
  it('formatiert Gesprächszeiten lesbar', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(420)).toBe('7 min');
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(8100)).toBe('2 h 15 min');
  });
});
