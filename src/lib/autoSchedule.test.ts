import { describe, it, expect } from 'vitest';
import { DEFAULT_PLAN_OPTIONS, planShifts, type PlanInput, type PlanOptions } from './autoSchedule';
import { checkPlan, indexCompetencies } from './competencies';
import type {
  AgentCompetency,
  Campaign,
  CampaignCallType,
  CompetencyLevel,
  Shift,
  ShiftType,
  StaffingTarget,
} from '../types';

// Montag 07.09.2026 bis Sonntag 13.09.2026 — eine ganze Woche, damit auch
// Wochenende (Soll 0) und Wochenpensum im Bild sind.
const WEEK = [
  '2026-09-07',
  '2026-09-08',
  '2026-09-09',
  '2026-09-10',
  '2026-09-11',
  '2026-09-12',
  '2026-09-13',
];

const agents = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ userId: `u${i + 1}`, name: `Person ${i + 1}` }));

const targets = (minFrueh: number, minSpaet: number): StaffingTarget[] =>
  Array.from({ length: 7 }, (_, i) => ({
    weekday: i + 1,
    minFrueh: i < 5 ? minFrueh : 0,
    minSpaet: i < 5 ? minSpaet : 0,
  }));

const campaign = (id: string, callType: CampaignCallType): Campaign => ({
  id,
  name: `Kampagne ${id}`,
  callType,
  active: true,
  createdAt: '2026-08-01T00:00:00.000Z',
});

const comp = (
  userId: string,
  callType: CampaignCallType,
  level: CompetencyLevel,
): AgentCompetency => ({ userId, callType, level, updatedAt: '2026-08-17T00:00:00.000Z' });

let seq = 0;
const shift = (userId: string, shiftDate: string, shiftType: ShiftType, campaignId?: string): Shift => ({
  id: `s${(seq += 1)}`,
  userId,
  shiftDate,
  shiftType,
  campaignId,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
});

const input = (over: Partial<PlanInput> = {}, options: Partial<PlanOptions> = {}): PlanInput => ({
  days: WEEK,
  agents: agents(6),
  existing: [],
  targets: targets(2, 2),
  campaigns: [],
  competencies: [],
  options: { ...DEFAULT_PLAN_OPTIONS, ...options },
  ...over,
});

const workOn = (res: ReturnType<typeof planShifts>, day: string, type: 'frueh' | 'spaet') =>
  res.cells.filter((c) => c.dateKey === day && c.shiftType === type);

describe('planShifts — Besetzung', () => {
  it('erfüllt die Soll-Besetzung an jedem Werktag', () => {
    const res = planShifts(input());
    for (const day of WEEK.slice(0, 5)) {
      expect(workOn(res, day, 'frueh')).toHaveLength(2);
      expect(workOn(res, day, 'spaet')).toHaveLength(2);
    }
    expect(res.gaps).toHaveLength(0);
  });

  it('teilt am Wochenende ohne Sollwert niemanden ein', () => {
    const res = planShifts(input());
    for (const day of WEEK.slice(5)) {
      expect(workOn(res, day, 'frueh')).toHaveLength(0);
      expect(workOn(res, day, 'spaet')).toHaveLength(0);
      // Der Tag ist trotzdem geplant — „frei" statt leer.
      expect(res.cells.filter((c) => c.dateKey === day && c.shiftType === 'frei')).toHaveLength(6);
    }
  });

  it('meldet eine Lücke mit Begründung, wenn zu wenige Leute da sind', () => {
    const res = planShifts(input({ agents: agents(3) }));
    expect(res.gaps.length).toBeGreaterThan(0);
    expect(res.gaps[0].reason).toMatch(/Zu wenige Mitarbeitende|Wochenpensum/);
    expect(res.warnings.join(' ')).toMatch(/offen/);
  });

  it('hält das Wochenpensum ein und begründet die entstehende Lücke', () => {
    // 4 Leute × 5 Tage = 20 Plätze, gebraucht werden 4 × 5 = 20 — passt genau.
    // Mit Pensum 4 fehlen 4 Plätze, und zwar nachweislich wegen des Pensums.
    const res = planShifts(input({ agents: agents(4) }, { maxDaysPerWeek: 4 }));
    for (const a of res.agents) expect(a.workDays).toBeLessThanOrEqual(4);
    expect(res.gaps.some((g) => /Wochenpensum/.test(g.reason))).toBe(true);
  });

  it('verteilt die Arbeitstage gleichmäßig', () => {
    const res = planShifts(input({ agents: agents(5) }));
    const days = res.agents.map((a) => a.workDays);
    expect(Math.max(...days) - Math.min(...days)).toBeLessThanOrEqual(1);
  });

  it('liefert bei gleicher Eingabe denselben Plan', () => {
    // Vorschau und Übernahme sind zwei Läufe — sie müssen dasselbe ergeben.
    expect(planShifts(input()).cells).toEqual(planShifts(input()).cells);
  });
});

describe('planShifts — Bestand', () => {
  it('lässt Urlaub, Krankheit und Schulung unangetastet', () => {
    const existing = [
      shift('u1', '2026-09-07', 'urlaub'),
      shift('u2', '2026-09-07', 'krank'),
      shift('u3', '2026-09-07', 'schulung'),
    ];
    const res = planShifts(input({ existing }, { mode: 'neu' }));
    const montag = res.cells.filter((c) => c.dateKey === '2026-09-07');
    expect(montag.map((c) => c.userId)).not.toContain('u1');
    expect(montag.map((c) => c.userId)).not.toContain('u2');
    expect(montag.map((c) => c.userId)).not.toContain('u3');
    expect(res.days[0].absent).toBe(3);
  });

  it('füllt im Modus „nur Lücken" nur leere Zellen', () => {
    const existing = [shift('u1', '2026-09-07', 'spaet'), shift('u2', '2026-09-07', 'frei')];
    const res = planShifts(input({ existing }));
    expect(res.changes.some((c) => c.userId === 'u1' && c.dateKey === '2026-09-07')).toBe(false);
    expect(res.changes.some((c) => c.userId === 'u2' && c.dateKey === '2026-09-07')).toBe(false);
    // Die bestehende Spätschicht zählt auf den Sollwert — es kommt nur eine dazu.
    expect(workOn(res, '2026-09-07', 'spaet')).toHaveLength(1);
  });

  it('verteilt im Modus „neu planen" auch bestehende Arbeitstage neu', () => {
    // u1 steht an allen fünf Werktagen, die anderen nirgends: im Neu-Modus muss
    // sich das auflösen, statt bestehen zu bleiben.
    const existing = WEEK.slice(0, 5).map((d) => shift('u1', d, 'frueh'));
    const res = planShifts(input({ existing }, { mode: 'neu' }));
    const days = res.agents.map((a) => a.workDays);
    expect(Math.max(...days) - Math.min(...days)).toBeLessThanOrEqual(1);
  });

  it('rührt Zellen mit laufender Tauschanfrage nicht an', () => {
    const existing = [shift('u1', '2026-09-07', 'frueh')];
    const res = planShifts(
      input({ existing, locked: new Set(['u1|2026-09-07']) }, { mode: 'neu' }),
    );
    expect(res.changes.some((c) => c.userId === 'u1' && c.dateKey === '2026-09-07')).toBe(false);
  });

  it('schreibt nur, was sich wirklich ändert', () => {
    const first = planShifts(input());
    // Den Vorschlag als Bestand einspielen und erneut planen: nichts zu tun.
    const existing = first.cells
      .filter((c) => c.shiftType !== null)
      .map((c) => shift(c.userId, c.dateKey, c.shiftType as ShiftType, c.campaignId));
    const second = planShifts(input({ existing }, { mode: 'neu' }));
    expect(second.changes).toHaveLength(0);
  });

  it('leert alte Arbeitstage, wenn freie Tage nicht eingetragen werden', () => {
    const existing = [shift('u1', '2026-09-12', 'frueh')]; // Samstag, Soll 0
    const res = planShifts(input({ existing }, { mode: 'neu', fillFree: false }));
    const cell = res.changes.find((c) => c.userId === 'u1' && c.dateKey === '2026-09-12');
    expect(cell?.shiftType).toBeNull();
  });
});

describe('planShifts — Kompetenzen', () => {
  const BVW = campaign('c-bvw', 'bvw');
  const WELCOME = campaign('c-welcome', 'welcome');

  it('teilt Kampagnen nur an Geschulte zu', () => {
    const res = planShifts(
      input({
        agents: agents(4),
        campaigns: [BVW, WELCOME],
        competencies: [comp('u1', 'bvw', 'einsatzbereit'), comp('u2', 'welcome', 'einsatzbereit')],
        targets: targets(1, 1),
      }),
    );
    // Nur u1 (BVW) und u2 (Welcome) sind geschult — und zwar je auf genau eine
    // Kampagne. Alles andere im Plan bleibt ohne Zuordnung.
    const allowed = new Map([['u1', BVW.id], ['u2', WELCOME.id]]);
    for (const cell of res.cells) {
      if (!cell.campaignId) continue;
      expect(cell.campaignId).toBe(allowed.get(cell.userId));
    }
    expect(res.cells.some((c) => c.campaignId === BVW.id)).toBe(true);
    expect(res.cells.some((c) => c.campaignId === WELCOME.id)).toBe(true);
  });

  it('lässt die Kampagne leer, statt jemanden ohne Schulung darauf zu setzen', () => {
    const res = planShifts(
      input({ agents: agents(4), campaigns: [BVW], competencies: [], targets: targets(1, 1) }),
    );
    expect(res.cells.every((c) => !c.campaignId)).toBe(true);
    expect(res.warnings.join(' ')).toMatch(/niemand ist einsatzbereit/);
  });

  it('setzt Einarbeitung nur mit Begleitung am selben Tag auf die Kampagne', () => {
    // u1 ist Trainer:in, u2 in Einarbeitung, u3/u4 gar nicht geschult.
    const res = planShifts(
      input({
        agents: agents(4),
        campaigns: [BVW],
        competencies: [comp('u1', 'bvw', 'trainer'), comp('u2', 'bvw', 'einarbeitung')],
        targets: targets(2, 0),
      }),
    );
    for (const day of WEEK.slice(0, 5)) {
      const ofDay = res.cells.filter((c) => c.dateKey === day && c.campaignId === BVW.id);
      if (ofDay.some((c) => c.userId === 'u2')) {
        expect(ofDay.some((c) => c.userId === 'u1')).toBe(true);
      }
    }
  });

  it('zählt als Begleitung nur, wer die Kampagne an dem Tag auch wirklich fährt', () => {
    // u1 könnte BVW — bekommt aber Welcome. Für u2 (BVW in Einarbeitung) ist
    // damit niemand da, der begleitet: die Zelle muss ohne Kampagne bleiben.
    const competencies = [
      comp('u1', 'welcome', 'trainer'),
      comp('u1', 'bvw', 'trainer'),
      comp('u2', 'bvw', 'einarbeitung'),
      comp('u3', 'welcome', 'einsatzbereit'),
    ];
    const res = planShifts(
      input({
        agents: agents(3),
        campaigns: [WELCOME, BVW],
        competencies,
        targets: targets(2, 0),
      }),
    );
    for (const day of WEEK.slice(0, 5)) {
      const ofDay = res.cells.filter((c) => c.dateKey === day && c.shiftType !== 'frei');
      const u2 = ofDay.find((c) => c.userId === 'u2');
      if (u2?.campaignId !== BVW.id) continue;
      // Wenn u2 doch BVW fährt, muss an dem Tag jemand BVW selbstständig fahren.
      expect(ofDay.some((c) => c.userId !== 'u2' && c.campaignId === BVW.id)).toBe(true);
    }
    const planned = res.cells
      .filter((c) => c.shiftType !== null)
      .map((c) => shift(c.userId, c.dateKey, c.shiftType as ShiftType, c.campaignId));
    expect(Array.from(checkPlan(planned, indexCompetencies(competencies), [WELCOME, BVW]).values())).toHaveLength(0);
  });

  it('erzeugt einen Plan ohne Kompetenz-Beanstandungen', () => {
    // Die eigentliche Zusage des Planers: was er vorschlägt, warnt hinterher
    // nicht im Plan. Geprüft mit derselben Funktion, die die Seite benutzt.
    const competencies = [
      comp('u1', 'bvw', 'trainer'),
      comp('u2', 'bvw', 'einarbeitung'),
      comp('u3', 'welcome', 'einsatzbereit'),
      comp('u4', 'welcome', 'einarbeitung'),
      comp('u5', 'bvw', 'einsatzbereit'),
    ];
    const res = planShifts(
      input({ agents: agents(6), campaigns: [BVW, WELCOME], competencies, targets: targets(2, 2) }),
    );
    const planned = res.cells
      .filter((c) => c.shiftType !== null)
      .map((c) => shift(c.userId, c.dateKey, c.shiftType as ShiftType, c.campaignId));
    const issues = checkPlan(planned, indexCompetencies(competencies), [BVW, WELCOME]);
    expect(Array.from(issues.values())).toHaveLength(0);
  });

  it('verteilt auch mit Kampagnen gleichmäßig — der Alleskönner räumt nicht ab', () => {
    // u1 kann alles, die anderen je eine Kampagne. Ohne Bremse zieht der
    // Abdeckungs-Vorrang u1 in jede Schicht, und der Rest sitzt zu Hause.
    const res = planShifts(
      input({
        agents: agents(6),
        campaigns: [BVW, WELCOME],
        competencies: [
          comp('u1', 'bvw', 'trainer'),
          comp('u1', 'welcome', 'trainer'),
          comp('u2', 'bvw', 'einsatzbereit'),
          comp('u3', 'welcome', 'einsatzbereit'),
          comp('u4', 'bvw', 'einsatzbereit'),
          comp('u5', 'welcome', 'einsatzbereit'),
        ],
      }),
    );
    const days = res.agents.map((a) => a.workDays);
    expect(Math.max(...days) - Math.min(...days)).toBeLessThanOrEqual(1);
  });

  it('wechselt die Kampagnen durch und meldet, was gar nicht drankommt', () => {
    // Ein Platz am Tag, sechs Kampagnen, eine Person die alles kann: an fünf
    // Werktagen können höchstens fünf Kampagnen laufen. Die Reihenfolge muss
    // weiterwandern (sonst liefe fünfmal dieselbe), und die sechste gehört
    // benannt statt verschwiegen.
    const all: CampaignCallType[] = ['churn', 'welcome', 'prl', 'dupe', 'bvw', 'courtesy'];
    const res = planShifts(
      input({
        agents: agents(1),
        campaigns: all.map((t) => campaign(`c-${t}`, t)),
        competencies: all.map((t) => comp('u1', t, 'einsatzbereit')),
        targets: targets(1, 0),
      }),
    );
    const used = new Set(res.cells.map((c) => c.campaignId).filter(Boolean));
    expect(used.size).toBe(5);
    expect(res.warnings.join(' ')).toMatch(/Im ganzen Zeitraum nicht eingeteilt/);
  });

  it('lässt Kampagnen ganz weg, wenn der Chef das so will', () => {
    const res = planShifts(
      input({
        campaigns: [BVW],
        competencies: [comp('u1', 'bvw', 'einsatzbereit')],
      }, { assignCampaigns: false }),
    );
    expect(res.cells.every((c) => !c.campaignId)).toBe(true);
  });
});
