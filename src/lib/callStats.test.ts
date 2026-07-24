import { describe, it, expect } from 'vitest';
import {
  callVolumeStats,
  linkCallsToOutcomes,
  conversionStats,
  saveRateStats,
  cancellationReasonBreakdown,
  campaignPerformance,
  dispositionBreakdown,
} from './callStats';
import { makeCall, makeContract, makeTariff, makeLead, makeNote } from '../test/fixtures';
import type { Campaign } from '../types';

const makeCampaign = (over: Partial<Campaign> = {}): Campaign => ({
  id: 'camp-1',
  name: 'Kündiger Q3',
  callType: 'churn',
  active: true,
  createdAt: '2024-06-01T00:00:00.000Z',
  ...over,
});

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

describe('saveRateStats', () => {
  it('berechnet die Save-Rate nur aus gehalten vs. gekündigt', () => {
    const calls = [
      makeCall({ disposition: 'gehalten' }),
      makeCall({ disposition: 'gehalten' }),
      makeCall({ disposition: 'gekuendigt' }),
      makeCall({ disposition: 'rueckruf' }), // zählt nicht in die Quote
      makeCall({ disposition: undefined }), // ohne Ergebnis, ignoriert
    ];
    const s = saveRateStats(calls);
    expect(s.saved).toBe(2);
    expect(s.cancelled).toBe(1);
    expect(s.saveRatePct).toBe(67); // 2 / 3 gerundet
  });

  it('liefert null statt NaN ohne entschiedene Fälle', () => {
    const s = saveRateStats([makeCall({ disposition: 'rueckruf' })]);
    expect(s.saveRatePct).toBeNull();
  });
});

describe('cancellationReasonBreakdown', () => {
  it('zählt Gründe nur bei gekündigten Anrufen, absteigend', () => {
    const calls = [
      makeCall({ disposition: 'gekuendigt', cancellationReason: 'Zu teuer' }),
      makeCall({ disposition: 'gekuendigt', cancellationReason: 'Zu teuer' }),
      makeCall({ disposition: 'gekuendigt', cancellationReason: 'Umzug' }),
      makeCall({ disposition: 'gehalten', cancellationReason: 'sollte ignoriert werden' }),
    ];
    const rows = cancellationReasonBreakdown(calls);
    expect(rows).toEqual([
      { reason: 'Zu teuer', count: 2 },
      { reason: 'Umzug', count: 1 },
    ]);
  });

  it('bündelt leere Gründe als „Ohne Angabe"', () => {
    const rows = cancellationReasonBreakdown([
      makeCall({ disposition: 'gekuendigt', cancellationReason: '  ' }),
      makeCall({ disposition: 'gekuendigt', cancellationReason: undefined }),
    ]);
    expect(rows).toEqual([{ reason: 'Ohne Angabe', count: 2 }]);
  });
});

describe('campaignPerformance', () => {
  it('gruppiert nach Kampagne und rechnet Save-Rate + Ø-Dauer', () => {
    const camp = makeCampaign({ id: 'camp-1', name: 'Kündiger Q3' });
    const calls = [
      makeCall({ campaignId: 'camp-1', disposition: 'gehalten', durationS: 100 }),
      makeCall({ campaignId: 'camp-1', disposition: 'gekuendigt', durationS: 300 }),
      makeCall({ campaignId: undefined, disposition: 'gehalten', durationS: 999 }), // ohne Kampagne, ignoriert
    ];
    const rows = campaignPerformance(calls, [camp]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      campaignId: 'camp-1',
      campaignName: 'Kündiger Q3',
      callType: 'churn',
      totalCalls: 2,
      saved: 1,
      cancelled: 1,
      saveRatePct: 50,
      avgDurationS: 200,
    });
  });

  it('kennzeichnet Anrufe einer gelöschten Kampagne als unbekannt', () => {
    const rows = campaignPerformance([makeCall({ campaignId: 'weg' })], []);
    expect(rows[0].campaignName).toBe('Unbekannte Kampagne');
  });
});

describe('dispositionBreakdown', () => {
  it('zählt gesetzte Dispositionen, ignoriert leere', () => {
    const rows = dispositionBreakdown([
      makeCall({ disposition: 'gehalten' }),
      makeCall({ disposition: 'gehalten' }),
      makeCall({ disposition: 'gekuendigt' }),
      makeCall({ disposition: undefined }),
    ]);
    expect(rows[0]).toEqual({ disposition: 'gehalten', count: 2 });
    expect(rows).toHaveLength(2);
  });
});
