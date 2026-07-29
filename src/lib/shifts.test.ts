import { describe, it, expect } from 'vitest';
import {
  SHIFT_TIMES,
  DAY_WINDOW,
  shiftTimeLabel,
  shiftMeta,
  isWorking,
  shiftProgress,
  formatDuration,
  formatMinutes,
  dayCoverage,
  isoWeekday,
  shiftOutcome,
  outcomeIndex,
  outcomeKey,
} from './shifts';
import { makeCall, makeContract } from '../test/fixtures';
import type { Shift, ShiftType } from '../types';

let seq = 0;
const makeShift = (over: Partial<Shift> = {}): Shift => {
  seq += 1;
  return {
    id: `s${seq}`,
    userId: 'agent-1',
    shiftDate: '2024-06-17',
    shiftType: 'frueh',
    createdAt: '2024-06-01T00:00:00.000Z',
    updatedAt: '2024-06-01T00:00:00.000Z',
    ...over,
  };
};

const hm = (h: number, m = 0) => h * 60 + m;

describe('Schichtzeiten', () => {
  it('kennt Zeitfenster nur für Arbeitsschichten', () => {
    expect(shiftTimeLabel('frueh')).toBe('07:45 – 16:15');
    expect(shiftTimeLabel('spaet')).toBe('08:45 – 17:15');
    expect(shiftTimeLabel('frei')).toBeNull();
    expect(shiftTimeLabel('urlaub')).toBeNull();
  });

  it('spannt das Tagesfenster über alle Schichten', () => {
    expect(DAY_WINDOW.startMin).toBe(SHIFT_TIMES.frueh!.startMin);
    expect(DAY_WINDOW.endMin).toBe(SHIFT_TIMES.spaet!.endMin);
  });

  it('formatiert Minuten zweistellig', () => {
    expect(formatMinutes(hm(7, 45))).toBe('07:45');
    expect(formatMinutes(hm(17, 5))).toBe('17:05');
  });
});

describe('Schichtarten', () => {
  it('trennt Arbeit von Abwesenheit', () => {
    expect(isWorking('frueh')).toBe(true);
    expect(isWorking('spaet')).toBe(true);
    for (const t of ['frei', 'urlaub', 'krank', 'schulung'] as ShiftType[]) {
      expect(isWorking(t)).toBe(false);
    }
  });

  it('markiert nur begründete Abwesenheiten als absence — „frei" ist geplant', () => {
    expect(shiftMeta('frei').absence).toBe(false);
    expect(shiftMeta('urlaub').absence).toBe(true);
    expect(shiftMeta('krank').absence).toBe(true);
    expect(shiftMeta('schulung').absence).toBe(true);
  });

  it('fällt bei unbekannter Art auf „frei" zurück statt zu werfen', () => {
    expect(shiftMeta(undefined).label).toBe('Frei');
    expect(shiftMeta('sabbatical' as ShiftType).label).toBe('Frei');
    expect(isWorking('sabbatical' as ShiftType)).toBe(false);
  });
});

describe('shiftProgress', () => {
  it('meldet vor Schichtbeginn die Zeit bis zum Start', () => {
    const p = shiftProgress('frueh', hm(7, 0))!;
    expect(p.phase).toBe('before');
    expect(p.minutesLeft).toBe(45);
  });

  it('meldet während der Schicht Fortschritt und Restzeit', () => {
    const p = shiftProgress('frueh', hm(12, 0))!;
    expect(p.phase).toBe('running');
    expect(p.minutesLeft).toBe(255); // bis 16:15
    expect(p.progress).toBeGreaterThan(0.4);
    expect(p.progress).toBeLessThan(0.6);
  });

  it('behandelt den Endzeitpunkt selbst schon als beendet', () => {
    const p = shiftProgress('frueh', hm(16, 15))!;
    expect(p.phase).toBe('after');
    expect(p.minutesLeft).toBe(0);
  });

  it('gibt für Schichtarten ohne Zeitfenster nichts zurück', () => {
    expect(shiftProgress('urlaub', hm(12, 0))).toBeNull();
    expect(shiftProgress('frei', hm(12, 0))).toBeNull();
  });
});

describe('formatDuration', () => {
  it('zeigt unter einer Stunde nur Minuten', () => {
    expect(formatDuration(45)).toBe('45 Min.');
  });
  it('zeigt darüber Stunden mit zweistelligen Minuten', () => {
    expect(formatDuration(135)).toBe('2:15 Std.');
    expect(formatDuration(125)).toBe('2:05 Std.');
  });
  it('rutscht nicht ins Negative', () => {
    expect(formatDuration(-10)).toBe('0 Min.');
  });
});

describe('dayCoverage', () => {
  it('zählt Schichtarten und Anwesende', () => {
    const c = dayCoverage([
      makeShift({ shiftType: 'frueh' }),
      makeShift({ shiftType: 'frueh' }),
      makeShift({ shiftType: 'spaet' }),
      makeShift({ shiftType: 'urlaub' }),
    ]);
    expect(c.frueh).toBe(2);
    expect(c.spaet).toBe(1);
    expect(c.working).toBe(3);
    expect(c.absences.urlaub).toBe(1);
  });

  it('bildet die Überlappung als Stufen ab — der Kern bei versetztem Start', () => {
    // Eine Frühschicht (07:45–16:15) und eine Spätschicht (08:45–17:15):
    // erst eine Person, dann beide, am Ende wieder eine.
    const c = dayCoverage([makeShift({ shiftType: 'frueh' }), makeShift({ shiftType: 'spaet' })]);
    expect(c.bands).toEqual([
      { startMin: hm(7, 45), endMin: hm(8, 45), count: 1 },
      { startMin: hm(8, 45), endMin: hm(16, 15), count: 2 },
      { startMin: hm(16, 15), endMin: hm(17, 15), count: 1 },
    ]);
  });

  it('fasst gleich hohe Nachbarabschnitte zusammen', () => {
    // Zwei identische Frühschichten ergeben einen einzigen Block, keine zwei.
    const c = dayCoverage([makeShift({ shiftType: 'frueh' }), makeShift({ shiftType: 'frueh' })]);
    expect(c.bands).toEqual([{ startMin: hm(7, 45), endMin: hm(16, 15), count: 2 }]);
  });

  it('lässt Abwesenheiten aus der Belegung heraus', () => {
    const c = dayCoverage([
      makeShift({ shiftType: 'urlaub' }),
      makeShift({ shiftType: 'krank' }),
      makeShift({ shiftType: 'frei' }),
    ]);
    expect(c.bands).toEqual([]);
    expect(c.working).toBe(0);
  });

  it('erkennt Unterdeckung gegen die Soll-Besetzung', () => {
    const shifts = [makeShift({ shiftType: 'frueh' }), makeShift({ shiftType: 'spaet' })];
    const c = dayCoverage(shifts, { weekday: 1, minFrueh: 2, minSpaet: 2 });
    expect(c.missingFrueh).toBe(1);
    expect(c.missingSpaet).toBe(1);
    expect(c.understaffed).toBe(true);
  });

  it('gilt als gedeckt, wenn das Soll erreicht oder übertroffen ist', () => {
    const shifts = [
      makeShift({ shiftType: 'frueh' }),
      makeShift({ shiftType: 'frueh' }),
      makeShift({ shiftType: 'spaet' }),
    ];
    const c = dayCoverage(shifts, { weekday: 1, minFrueh: 2, minSpaet: 1 });
    expect(c.understaffed).toBe(false);
    expect(c.missingFrueh).toBe(0);
  });

  it('ohne Sollwert ist nie unterbesetzt', () => {
    expect(dayCoverage([], null).understaffed).toBe(false);
  });
});

describe('isoWeekday', () => {
  it('zählt Montag als 1 und Sonntag als 7', () => {
    expect(isoWeekday(new Date(2024, 5, 17))).toBe(1); // Montag
    expect(isoWeekday(new Date(2024, 5, 23))).toBe(7); // Sonntag
  });
});

describe('shiftOutcome', () => {
  const commissionOf = () => 50;

  it('zählt nur Anrufe der Person am Schichttag', () => {
    const calls = [
      makeCall({ agentId: 'agent-1', startedAt: '2024-06-17T09:00:00.000', durationS: 300 }),
      makeCall({ agentId: 'agent-1', startedAt: '2024-06-17T11:00:00.000', durationS: 600 }),
      makeCall({ agentId: 'agent-2', startedAt: '2024-06-17T09:00:00.000', durationS: 900 }),
      makeCall({ agentId: 'agent-1', startedAt: '2024-06-18T09:00:00.000', durationS: 900 }),
    ];
    const out = shiftOutcome({ userId: 'agent-1', shiftDate: '2024-06-17' }, calls, [], commissionOf);
    expect(out.calls).toBe(2);
    expect(out.talkMinutes).toBe(15);
  });

  it('zählt Verträge über createdBy und lässt Stornos aus', () => {
    const contracts = [
      makeContract({ createdBy: 'agent-1', contractDate: '2024-06-17' }),
      makeContract({ createdBy: 'agent-1', contractDate: '2024-06-17', status: 'storniert' }),
      makeContract({ createdBy: 'agent-2', contractDate: '2024-06-17' }),
    ];
    const out = shiftOutcome(
      { userId: 'agent-1', shiftDate: '2024-06-17' },
      [],
      contracts,
      commissionOf,
    );
    expect(out.contracts).toBe(1);
    expect(out.commission).toBe(50);
  });
});

describe('outcomeIndex', () => {
  const commissionOf = () => 40;

  it('liefert dieselben Zahlen wie die Einzelauswertung', () => {
    const calls = [
      makeCall({ agentId: 'a', startedAt: '2024-06-17T09:00:00.000', durationS: 300 }),
      makeCall({ agentId: 'a', startedAt: '2024-06-17T10:00:00.000', durationS: 300 }),
      makeCall({ agentId: 'b', startedAt: '2024-06-17T09:00:00.000', durationS: 120 }),
    ];
    const contracts = [
      makeContract({ createdBy: 'a', contractDate: '2024-06-17' }),
      makeContract({ createdBy: 'b', contractDate: '2024-06-18', status: 'storniert' }),
    ];
    const idx = outcomeIndex(calls, contracts, commissionOf);

    const single = shiftOutcome({ userId: 'a', shiftDate: '2024-06-17' }, calls, contracts, commissionOf);
    expect(idx.get(outcomeKey('a', '2024-06-17'))).toEqual(single);
    expect(idx.get(outcomeKey('b', '2024-06-17'))!.calls).toBe(1);
    // Storno legt keinen Eintrag an
    expect(idx.get(outcomeKey('b', '2024-06-18'))).toBeUndefined();
  });

  it('rundet Gesprächsminuten erst am Ende, nicht je Anruf', () => {
    // 4 × 40 s = 160 s = 2,67 Min. → 3. Würde jeder Anruf einzeln gerundet
    // (40 s → 1 Min.), stünden hier 4 — bei vielen kurzen Anrufen läuft dieser
    // Fehler sichtbar auseinander.
    const calls = [40, 40, 40, 40].map((d) =>
      makeCall({ agentId: 'a', startedAt: '2024-06-17T09:00:00.000', durationS: d }),
    );
    const idx = outcomeIndex(calls, [], commissionOf);
    expect(idx.get(outcomeKey('a', '2024-06-17'))!.talkMinutes).toBe(3);
  });
});
