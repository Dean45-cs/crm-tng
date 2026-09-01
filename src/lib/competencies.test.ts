import { describe, it, expect } from 'vitest';
import {
  campaignReadiness,
  campaignsForUser,
  checkPlan,
  checkShift,
  competencyOf,
  hasSupervisorForDay,
  indexCompetencies,
  isQualified,
  levelDef,
} from './competencies';
import type { AgentCompetency, Campaign, CampaignCallType, CompetencyLevel, Shift } from '../types';

const comp = (
  userId: string,
  callType: CampaignCallType,
  level: CompetencyLevel,
  over: Partial<AgentCompetency> = {},
): AgentCompetency => ({
  userId,
  callType,
  level,
  updatedAt: '2026-08-17T00:00:00.000Z',
  ...over,
});

const campaign = (id: string, callType: CampaignCallType): Campaign => ({
  id,
  name: `Kampagne ${id}`,
  callType,
  active: true,
  createdAt: '2026-08-01T00:00:00.000Z',
});

let seq = 0;
const shift = (over: Partial<Shift> & Pick<Shift, 'userId'>): Shift => ({
  id: `s${(seq += 1)}`,
  shiftDate: '2026-09-01',
  shiftType: 'frueh',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const BVW = campaign('c-bvw', 'bvw');
const WELCOME = campaign('c-welcome', 'welcome');
const typeOf = (id: string | undefined) =>
  id === 'c-bvw' ? ('bvw' as const) : id === 'c-welcome' ? ('welcome' as const) : undefined;

describe('isQualified', () => {
  it('lässt ohne Eintrag niemanden auf eine Kampagne', () => {
    const index = indexCompetencies([]);
    expect(isQualified(index, 'u1', 'bvw')).toBe(false);
  });

  it('erlaubt jede Stufe — auch die Einarbeitung', () => {
    // „In Einarbeitung" ist zuweisbar, verlangt aber Begleitung. Das ist eine
    // andere Frage als „darf überhaupt".
    const index = indexCompetencies([comp('u1', 'bvw', 'einarbeitung')]);
    expect(isQualified(index, 'u1', 'bvw')).toBe(true);
  });

  it('lässt Kampagnen ohne eigenen Leitfaden frei', () => {
    // 'other' hat keine Schulungsunterlage — ein Schulungszwang hieße dort nur,
    // dass sie niemand je fahren dürfte.
    expect(isQualified(indexCompetencies([]), 'u1', 'other')).toBe(true);
  });

  it('gilt je Kampagnentyp, nicht pauschal', () => {
    const index = indexCompetencies([comp('u1', 'dupe', 'trainer')]);
    expect(isQualified(index, 'u1', 'dupe')).toBe(true);
    expect(isQualified(index, 'u1', 'bvw')).toBe(false);
  });
});

describe('checkShift', () => {
  it('beanstandet eine Zuteilung ohne Schulung als blockierend', () => {
    const s = shift({ userId: 'u1', campaignId: 'c-bvw' });
    const check = checkShift(s, [s], indexCompetencies([]), typeOf);
    expect(check.severity).toBe('block');
    expect(check.issues[0].id).toBe('nicht-geschult');
  });

  it('prüft nur Arbeitstage mit Kampagne', () => {
    const index = indexCompetencies([]);
    // Urlaub soll nicht warnen, nur weil die Person für nichts geschult ist.
    const urlaub = shift({ userId: 'u1', shiftType: 'urlaub', campaignId: 'c-bvw' });
    expect(checkShift(urlaub, [urlaub], index, typeOf).severity).toBeNull();
    // Und eine Schicht ohne Kampagne hat nichts zu prüfen.
    const ohne = shift({ userId: 'u1' });
    expect(checkShift(ohne, [ohne], index, typeOf).severity).toBeNull();
  });

  it('warnt, wenn jemand in Einarbeitung allein auf der Kampagne steht', () => {
    const s = shift({ userId: 'u1', campaignId: 'c-bvw' });
    const check = checkShift(s, [s], indexCompetencies([comp('u1', 'bvw', 'einarbeitung')]), typeOf);
    expect(check.severity).toBe('warn');
    expect(check.issues[0].id).toBe('ohne-begleitung');
  });

  it('ist zufrieden, wenn eine erfahrene Person am selben Tag dieselbe Kampagne fährt', () => {
    const lernend = shift({ userId: 'u1', campaignId: 'c-bvw' });
    const erfahren = shift({ userId: 'u2', campaignId: 'c-bvw', shiftType: 'spaet' });
    const index = indexCompetencies([
      comp('u1', 'bvw', 'einarbeitung'),
      comp('u2', 'bvw', 'einsatzbereit'),
    ]);
    expect(checkShift(lernend, [lernend, erfahren], index, typeOf).severity).toBeNull();
  });

  it('lässt eine erfahrene Person einer ANDEREN Kampagne nicht als Begleitung gelten', () => {
    // Eine Trainerin für Welcome Calls hilft beim Bauverweigerer-Gespräch mit
    // § 156 TKG nicht weiter.
    const lernend = shift({ userId: 'u1', campaignId: 'c-bvw' });
    const andere = shift({ userId: 'u2', campaignId: 'c-welcome' });
    const index = indexCompetencies([
      comp('u1', 'bvw', 'einarbeitung'),
      comp('u2', 'welcome', 'trainer'),
    ]);
    expect(checkShift(lernend, [lernend, andere], index, typeOf).severity).toBe('warn');
  });

  it('lässt zwei Lernende einander nicht begleiten', () => {
    const a = shift({ userId: 'u1', campaignId: 'c-bvw' });
    const b = shift({ userId: 'u2', campaignId: 'c-bvw' });
    const index = indexCompetencies([
      comp('u1', 'bvw', 'einarbeitung'),
      comp('u2', 'bvw', 'einarbeitung'),
    ]);
    expect(checkShift(a, [a, b], index, typeOf).severity).toBe('warn');
  });

  it('meldet einen veralteten Schulungsstand', () => {
    // Der BVW-Leitfaden steht auf v2.0 — wer auf 1.0 geschult wurde, kennt die
    // aktuelle Fassung nicht.
    const s = shift({ userId: 'u1', campaignId: 'c-bvw' });
    const index = indexCompetencies([comp('u1', 'bvw', 'einsatzbereit', { guideVersion: '1.0' })]);
    const check = checkShift(s, [s], index, typeOf);
    expect(check.issues.map((i) => i.id)).toContain('veraltete-schulung');
  });

  it('wertet einen fehlenden Versionsvermerk nicht als veraltet', () => {
    // Altbestände hätten sonst über Nacht lauter Warnungen, ohne dass sich
    // etwas geändert hätte.
    const s = shift({ userId: 'u1', campaignId: 'c-bvw' });
    const index = indexCompetencies([comp('u1', 'bvw', 'einsatzbereit')]);
    expect(checkShift(s, [s], index, typeOf).severity).toBeNull();
  });
});

describe('hasSupervisorForDay', () => {
  it('ignoriert Abwesende', () => {
    const index = indexCompetencies([comp('u2', 'bvw', 'trainer')]);
    const urlaub = shift({ userId: 'u2', shiftType: 'urlaub', campaignId: 'c-bvw' });
    expect(hasSupervisorForDay([urlaub], index, 'bvw', typeOf)).toBe(false);
  });

  it('zählt die eigene Person nicht als eigene Begleitung', () => {
    const index = indexCompetencies([comp('u1', 'bvw', 'einsatzbereit')]);
    const own = shift({ userId: 'u1', campaignId: 'c-bvw' });
    expect(hasSupervisorForDay([own], index, 'bvw', typeOf, 'u1')).toBe(false);
  });
});

describe('checkPlan', () => {
  it('sammelt nur die beanstandeten Zellen, je Tag getrennt', () => {
    const shifts = [
      // Montag: allein und ungeschult → blockierend
      shift({ userId: 'u1', shiftDate: '2026-09-01', campaignId: 'c-bvw' }),
      // Dienstag: mit erfahrener Begleitung → in Ordnung
      shift({ userId: 'u1', shiftDate: '2026-09-02', campaignId: 'c-welcome' }),
      shift({ userId: 'u2', shiftDate: '2026-09-02', campaignId: 'c-welcome' }),
    ];
    const index = indexCompetencies([
      comp('u1', 'welcome', 'einarbeitung'),
      comp('u2', 'welcome', 'trainer'),
    ]);
    const result = checkPlan(shifts, index, [BVW, WELCOME]);
    expect(Array.from(result.keys())).toEqual(['u1|2026-09-01']);
    expect(result.get('u1|2026-09-01')?.severity).toBe('block');
  });

  it('trennt die Tage — eine Begleitung am Dienstag hilft am Montag nicht', () => {
    const shifts = [
      shift({ userId: 'u1', shiftDate: '2026-09-01', campaignId: 'c-bvw' }),
      shift({ userId: 'u2', shiftDate: '2026-09-02', campaignId: 'c-bvw' }),
    ];
    const index = indexCompetencies([
      comp('u1', 'bvw', 'einarbeitung'),
      comp('u2', 'bvw', 'trainer'),
    ]);
    const result = checkPlan(shifts, index, [BVW]);
    expect(result.get('u1|2026-09-01')?.issues[0].id).toBe('ohne-begleitung');
  });
});

describe('campaignReadiness', () => {
  it('zählt einsatzbereit, Einarbeitung und Trainer:innen getrennt', () => {
    const rows = [
      comp('u1', 'bvw', 'einsatzbereit'),
      comp('u2', 'bvw', 'trainer'),
      comp('u3', 'bvw', 'einarbeitung'),
    ];
    const r = campaignReadiness(rows, new Set(['u1', 'u2', 'u3'])).find((x) => x.callType === 'bvw')!;
    // Trainer:innen fahren die Kampagne ebenfalls selbstständig und zählen mit.
    expect(r.ready).toBe(2);
    expect(r.inTraining).toBe(1);
    expect(r.trainers).toBe(1);
    expect(r.uncovered).toBe(false);
  });

  it('gilt als nicht abgedeckt, wenn nur Lernende da sind', () => {
    const r = campaignReadiness([comp('u1', 'bvw', 'einarbeitung')], new Set(['u1'])).find(
      (x) => x.callType === 'bvw',
    )!;
    expect(r.ready).toBe(0);
    expect(r.uncovered).toBe(true);
  });

  it('ignoriert gesperrte Konten', () => {
    // Eine Kompetenz nützt nichts, wenn die Person sich nicht anmelden kann.
    const r = campaignReadiness([comp('u1', 'bvw', 'trainer')], new Set()).find(
      (x) => x.callType === 'bvw',
    )!;
    expect(r.ready).toBe(0);
    expect(r.uncovered).toBe(true);
  });

  it('deckt alle sechs Kampagnen ab', () => {
    expect(campaignReadiness([], new Set()).map((r) => r.callType)).toEqual([
      'welcome',
      'churn',
      'prl',
      'dupe',
      'bvw',
      'courtesy',
    ]);
  });
});

describe('campaignsForUser', () => {
  it('behält nicht geschulte Kampagnen in der Liste, markiert sie aber', () => {
    // Der Chef darf bewusst abweichen (siehe Migration 030) — soll es aber sehen.
    const index = indexCompetencies([comp('u1', 'welcome', 'einsatzbereit')]);
    const rows = campaignsForUser([BVW, WELCOME], index, 'u1');
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.campaign.id === 'c-welcome')?.qualified).toBe(true);
    expect(rows.find((r) => r.campaign.id === 'c-bvw')?.qualified).toBe(false);
    expect(rows.find((r) => r.campaign.id === 'c-bvw')?.level).toBeNull();
  });
});

describe('Katalog', () => {
  it('kennt genau drei Stufen mit klarer Ordnung', () => {
    expect(levelDef('einarbeitung')?.needsSupervision).toBe(true);
    expect(levelDef('einsatzbereit')?.needsSupervision).toBe(false);
    expect(levelDef('trainer')?.canTrain).toBe(true);
    expect(levelDef(null)).toBeNull();
  });

  it('liefert competencyOf ohne Call-Typ nichts', () => {
    const index = indexCompetencies([comp('u1', 'bvw', 'trainer')]);
    expect(competencyOf(index, 'u1', undefined)).toBeNull();
    expect(competencyOf(index, 'u1', 'bvw')?.level).toBe('trainer');
  });
});
