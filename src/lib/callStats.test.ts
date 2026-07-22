import { describe, it, expect } from 'vitest';
import { callVolumeStats, linkCallsToOutcomes, conversionStats } from './callStats';
import { makeCall, makeContract, makeTariff, makeLead, makeNote } from '../test/fixtures';

describe('callVolumeStats', () => {
  it('zählt Anrufe ohne agentKey über alle Mitarbeiter:innen', () => {
    const calls = [
      makeCall({ agentId: 'a', direction: 'inbound', durationS: 100 }),
      makeCall({ agentId: 'b', direction: 'outbound', durationS: 200 }),
    ];
    const s = callVolumeStats(calls);
    expect(s.count).toBe(2);
    expect(s.inbound).toBe(1);
    expect(s.outbound).toBe(1);
    expect(s.avgDurationS).toBe(150);
  });

  it('filtert nach agentKey, wenn angegeben', () => {
    const calls = [
      makeCall({ agentId: 'a', durationS: 100 }),
      makeCall({ agentId: 'b', durationS: 400 }),
    ];
    const s = callVolumeStats(calls, 'a');
    expect(s.count).toBe(1);
    expect(s.avgDurationS).toBe(100);
  });

  it('ignoriert Anrufe ohne bekannte Dauer bei der Ø-Berechnung', () => {
    const calls = [makeCall({ durationS: 100 }), makeCall({ durationS: undefined, endedAt: undefined })];
    const s = callVolumeStats(calls);
    expect(s.count).toBe(2);
    expect(s.avgDurationS).toBe(100);
  });

  it('liefert 0 ohne jeden Anruf, statt zu werfen', () => {
    expect(callVolumeStats([]).avgDurationS).toBe(0);
  });
});

describe('linkCallsToOutcomes', () => {
  it('verknüpft einen Anruf mit einem Vertrag derselben Kundennummer/Bearbeiter:in im Zeitfenster', () => {
    const call = makeCall({
      customerNumber: '1000',
      agentId: 'agent-1',
      endedAt: '2024-06-15T10:05:00.000Z',
    });
    const contract = makeContract({
      customerNumber: '1000',
      createdBy: 'agent-1',
      createdAt: '2024-06-15T10:20:00.000Z', // 15 Min. nach Anrufende
    });
    const [link] = linkCallsToOutcomes([call], [contract], [], [], []);
    expect(link.outcome?.kind).toBe('contract');
    expect(link.minutesToOutcome).toBe(15);
  });

  it('verknüpft nicht, wenn die Kundennummer abweicht', () => {
    const call = makeCall({ customerNumber: '1000', agentId: 'agent-1' });
    const contract = makeContract({ customerNumber: '2000', createdBy: 'agent-1', createdAt: '2024-06-15T10:10:00.000Z' });
    const [link] = linkCallsToOutcomes([call], [contract], [], [], []);
    expect(link.outcome).toBeNull();
  });

  it('verknüpft nicht, wenn eine andere Person den Eintrag angelegt hat', () => {
    const call = makeCall({ customerNumber: '1000', agentId: 'agent-1' });
    const contract = makeContract({ customerNumber: '1000', createdBy: 'agent-2', createdAt: '2024-06-15T10:10:00.000Z' });
    const [link] = linkCallsToOutcomes([call], [contract], [], [], []);
    expect(link.outcome).toBeNull();
  });

  it('verknüpft nicht außerhalb des Zeitfensters', () => {
    const call = makeCall({ customerNumber: '1000', agentId: 'agent-1', endedAt: '2024-06-15T10:05:00.000Z' });
    const contract = makeContract({
      customerNumber: '1000',
      createdBy: 'agent-1',
      createdAt: '2024-06-17T10:05:00.000Z', // 2 Tage später
    });
    const [link] = linkCallsToOutcomes([call], [contract], [], [], [], 24);
    expect(link.outcome).toBeNull();
  });

  it('verknüpft nicht rückwärts (Eintrag vor dem Anruf)', () => {
    const call = makeCall({ customerNumber: '1000', agentId: 'agent-1', endedAt: '2024-06-15T10:05:00.000Z' });
    const contract = makeContract({
      customerNumber: '1000',
      createdBy: 'agent-1',
      createdAt: '2024-06-15T09:00:00.000Z', // vor Anrufende
    });
    const [link] = linkCallsToOutcomes([call], [contract], [], [], []);
    expect(link.outcome).toBeNull();
  });

  it('bei mehreren Treffern im Fenster zählt der zeitlich nächstliegende', () => {
    const call = makeCall({ customerNumber: '1000', agentId: 'agent-1', endedAt: '2024-06-15T10:00:00.000Z' });
    const far = makeNote({ customerNumber: '1000', createdBy: 'agent-1', createdAt: '2024-06-15T20:00:00.000Z' });
    const near = makeContract({ customerNumber: '1000', createdBy: 'agent-1', createdAt: '2024-06-15T10:10:00.000Z' });
    const [link] = linkCallsToOutcomes([call], [near], [], [], [far]);
    expect(link.outcome?.kind).toBe('contract');
    expect(link.minutesToOutcome).toBe(10);
  });

  it('berücksichtigt Tarifwechsel und Leads genauso wie Verträge/Notizen', () => {
    const call = makeCall({ customerNumber: '1000', agentId: 'agent-1', endedAt: '2024-06-15T10:00:00.000Z' });
    const tariff = makeTariff({ customerNumber: '1000', createdBy: 'agent-1', createdAt: '2024-06-15T10:05:00.000Z' });
    const [link] = linkCallsToOutcomes([call], [], [tariff], [], []);
    expect(link.outcome?.kind).toBe('tariff');
  });

  it('Lead ohne Kundennummer wird als Kandidat übersprungen, nicht geworfen', () => {
    const call = makeCall({ customerNumber: '1000', agentId: 'agent-1' });
    const lead = makeLead({ customerNumber: undefined, createdBy: 'agent-1' });
    expect(() => linkCallsToOutcomes([call], [], [], [lead], [])).not.toThrow();
  });

  it('Anruf ohne Kundennummer bleibt unverknüpft', () => {
    const call = makeCall({ customerNumber: undefined });
    const [link] = linkCallsToOutcomes([call], [makeContract()], [], [], []);
    expect(link.outcome).toBeNull();
    expect(link.minutesToOutcome).toBeNull();
  });
});

describe('conversionStats', () => {
  it('berechnet die Abschlussquote aus verknüpften vs. unverknüpften Anrufen', () => {
    const call1 = makeCall({ customerNumber: '1000', agentId: 'agent-1', endedAt: '2024-06-15T10:00:00.000Z' });
    const call2 = makeCall({ customerNumber: '2000', agentId: 'agent-1', endedAt: '2024-06-15T11:00:00.000Z' });
    const contract = makeContract({ customerNumber: '1000', createdBy: 'agent-1', createdAt: '2024-06-15T10:10:00.000Z' });
    const links = linkCallsToOutcomes([call1, call2], [contract], [], [], []);
    const stats = conversionStats(links);
    expect(stats.totalCount).toBe(2);
    expect(stats.linkedCount).toBe(1);
    expect(stats.conversionPct).toBe(50);
    expect(stats.avgMinutesToOutcome).toBe(10);
  });

  it('liefert null statt NaN ohne jeden Anruf', () => {
    const stats = conversionStats([]);
    expect(stats.conversionPct).toBeNull();
    expect(stats.avgMinutesToOutcome).toBeNull();
  });

  it('liefert 0 % ohne jede Verknüpfung', () => {
    const call = makeCall({ customerNumber: '1000', agentId: 'agent-1' });
    const links = linkCallsToOutcomes([call], [], [], [], []);
    const stats = conversionStats(links);
    expect(stats.conversionPct).toBe(0);
    expect(stats.avgMinutesToOutcome).toBeNull();
  });
});
