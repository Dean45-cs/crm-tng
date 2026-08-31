import { describe, it, expect } from 'vitest';
import {
  callVolumeStats,
  linkCallsToOutcomes,
  conversionStats,
  saveRateStats,
  cancellationReasonBreakdown,
  campaignPerformance,
  dispositionBreakdown,
  callTimingStats,
  SHORT_CALL_S,
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

// ============================================================================
// Echte Gesprächszeiten und Erreichbarkeit (Migration 028)
// ============================================================================

/** Ein Anruf mit echten Rändern: klingelt ab T, abgehoben nach `ring`, Gespräch `talk`. */
const timedCall = (over: {
  ring?: number;
  talk?: number;
  acw?: number;
  answered?: boolean;
  agentId?: string;
  base?: string;
}) => {
  const base = Date.parse(over.base ?? '2026-09-01T10:00:00.000Z');
  const at = (s: number) => new Date(base + s * 1000).toISOString();
  const ring = over.ring ?? 0;
  const talk = over.talk ?? 0;
  const connected = over.answered === false ? undefined : at(ring);
  const ended = over.answered === false ? at(ring) : at(ring + talk);
  return makeCall({
    agentId: over.agentId ?? 'a',
    startedAt: at(0),
    connectedAt: connected,
    endedAt: ended,
    answered: over.answered,
    dispositionAt: over.acw === undefined ? undefined : at(ring + talk + over.acw),
    disposition: over.acw === undefined ? undefined : 'gehalten',
  });
};

describe('callTimingStats', () => {
  it('rechnet die Gesprächsdauer ab dem Abheben, nicht ab dem Klingeln', () => {
    // 25 s klingeln, dann 100 s sprechen. durationS wäre 125 – und damit falsch.
    const s = callTimingStats([timedCall({ ring: 25, talk: 100, answered: true })]);
    expect(s.avgTalkS).toBe(100);
    expect(s.avgRingS).toBe(25);
    expect(s.talkTimeS).toBe(100);
    expect(s.withTalkTime).toBe(1);
  });

  it('zählt die Erreichbarkeit gegen die gemessenen Anrufe, nicht gegen alle', () => {
    // DER FALL, der die Zahl sonst still ruiniert: zwei Anrufe von einem
    // Rechner ohne Erkennung (answered undefined). Sie dürfen die Quote weder
    // heben noch senken – sie sagen nichts aus.
    const s = callTimingStats([
      timedCall({ talk: 60, answered: true }),
      timedCall({ answered: false }),
      makeCall({ answered: undefined }),
      makeCall({ answered: undefined }),
    ]);
    expect(s.measured).toBe(2);
    expect(s.answered).toBe(1);
    expect(s.unanswered).toBe(1);
    expect(s.answerRatePct).toBe(50);
    expect(s.measuredPct).toBe(50);
  });

  it('gibt keine Quote aus, wo nichts gemessen wurde', () => {
    const s = callTimingStats([makeCall({}), makeCall({})]);
    expect(s.measured).toBe(0);
    // null, nicht 0 – „keine Angabe" ist etwas anderes als „null Prozent".
    expect(s.answerRatePct).toBeNull();
    expect(s.avgTalkS).toBeNull();
    expect(s.avgAhtS).toBeNull();
  });

  it('erkennt Kurzgespräche unter der Schwelle', () => {
    const s = callTimingStats([
      timedCall({ talk: SHORT_CALL_S - 1, answered: true }),
      timedCall({ talk: SHORT_CALL_S, answered: true }),
      timedCall({ talk: 300, answered: true }),
    ]);
    expect(s.shortCalls).toBe(1);
    expect(s.shortCallPct).toBeCloseTo(33.3, 1);
  });

  it('rechnet AHT je Anruf statt als Summe zweier Durchschnitte', () => {
    // Anruf 1: 100 s Gespräch + 20 s Nachbearbeitung = 120
    // Anruf 2: 200 s Gespräch, Ergebnis nie erfasst -> zählt bei AHT nicht mit
    const s = callTimingStats([
      timedCall({ talk: 100, acw: 20, answered: true }),
      timedCall({ talk: 200, answered: true }),
    ]);
    expect(s.avgTalkS).toBe(150);
    expect(s.avgAcwS).toBe(20);
    expect(s.withAht).toBe(1);
    // Die Summe der Durchschnitte wäre 170 – eine Zahl, die zu keinem der
    // beiden Anrufe gehört.
    expect(s.avgAhtS).toBe(120);
  });

  it('wirft kaputte Zeitstempel weg, statt den Durchschnitt zu verderben', () => {
    const s = callTimingStats([
      timedCall({ talk: 100, answered: true }),
      // Ende vor dem Anfang (Uhrensprung)
      makeCall({
        startedAt: '2026-09-01T10:00:00.000Z',
        connectedAt: '2026-09-01T10:05:00.000Z',
        endedAt: '2026-09-01T10:01:00.000Z',
        answered: true,
      }),
      // Ein Gespräch über der Obergrenze – eine verwaiste Zeile, kein Messwert
      timedCall({ talk: 5 * 60 * 60, answered: true }),
    ]);
    expect(s.withTalkTime).toBe(1);
    expect(s.avgTalkS).toBe(100);
  });

  it('lässt sich auf eine Person einschränken', () => {
    const s = callTimingStats(
      [
        timedCall({ talk: 100, answered: true, agentId: 'a' }),
        timedCall({ talk: 900, answered: true, agentId: 'b' }),
      ],
      'a',
    );
    expect(s.withTalkTime).toBe(1);
    expect(s.avgTalkS).toBe(100);
  });
});
