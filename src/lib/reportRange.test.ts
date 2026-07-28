import { describe, it, expect } from 'vitest';
import {
  bucketKeyOf,
  bucketSizeFor,
  bucketsOf,
  dateKey,
  dayEndIso,
  dayStartIso,
  fromDateKey,
  inRange,
  isoToDateKey,
  previousRange,
  proratedTarget,
  rangeLengthDays,
  resolveRange,
  type DateRange,
} from './reportRange';

/** 15. Juli 2026, lokal — festes Referenzdatum, damit die Tests datumsstabil sind. */
const REF = new Date(2026, 6, 15);

const range = (from: string, to: string): DateRange => ({ from, to, label: '' });

describe('fromDateKey / dateKey', () => {
  it('parst lokal statt als UTC (kein Tagesversatz)', () => {
    const d = fromDateKey('2026-07-01');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(1);
  });

  it('ist rundreisefest', () => {
    for (const key of ['2026-01-01', '2026-02-28', '2026-07-15', '2026-12-31']) {
      expect(dateKey(fromDateKey(key))).toBe(key);
    }
  });

  it('dayStartIso/dayEndIso landen wieder auf demselben lokalen Tag', () => {
    expect(isoToDateKey(dayStartIso('2026-07-01'))).toBe('2026-07-01');
    expect(isoToDateKey(dayEndIso('2026-07-31'))).toBe('2026-07-31');
  });
});

describe('resolveRange', () => {
  it('dieser Monat umfasst den ganzen Kalendermonat', () => {
    const r = resolveRange('thisMonth', undefined, REF);
    expect(r.from).toBe('2026-07-01');
    expect(r.to).toBe('2026-07-31');
    expect(r.label).toBe('Juli 2026');
  });

  it('letzter Monat', () => {
    const r = resolveRange('lastMonth', undefined, REF);
    expect(r.from).toBe('2026-06-01');
    expect(r.to).toBe('2026-06-30');
  });

  it('letzte 7 Tage enden heute und sind 7 Tage lang', () => {
    const r = resolveRange('last7', undefined, REF);
    expect(r.from).toBe('2026-07-09');
    expect(r.to).toBe('2026-07-15');
    expect(rangeLengthDays(r)).toBe(7);
  });

  it('Quartale bekommen ihren Namen', () => {
    const r = resolveRange('thisQuarter', undefined, REF);
    expect(r.from).toBe('2026-07-01');
    expect(r.to).toBe('2026-09-30');
    expect(r.label).toBe('Q3 2026');

    const prev = resolveRange('lastQuarter', undefined, REF);
    expect(prev.from).toBe('2026-04-01');
    expect(prev.to).toBe('2026-06-30');
    expect(prev.label).toBe('Q2 2026');
  });

  it('Jahr', () => {
    const r = resolveRange('thisYear', undefined, REF);
    expect(r.from).toBe('2026-01-01');
    expect(r.to).toBe('2026-12-31');
    expect(r.label).toBe('Jahr 2026');
  });

  it('vertauschte freie Grenzen werden getauscht statt abgelehnt', () => {
    const r = resolveRange('custom', { from: '2026-07-20', to: '2026-07-05' }, REF);
    expect(r.from).toBe('2026-07-05');
    expect(r.to).toBe('2026-07-20');
  });

  it('unvollständiger freier Zeitraum fällt auf den laufenden Monat zurück', () => {
    const r = resolveRange('custom', { from: '2026-07-20' }, REF);
    expect(r.from).toBe('2026-07-01');
  });
});

describe('previousRange', () => {
  it('voller Monat vergleicht gegen den Vormonat (nicht gegen 31 Tage davor)', () => {
    const p = previousRange(range('2026-07-01', '2026-07-31'));
    expect(p.from).toBe('2026-06-01');
    expect(p.to).toBe('2026-06-30');
  });

  it('volles Quartal vergleicht gegen das Vorquartal', () => {
    const p = previousRange(range('2026-07-01', '2026-09-30'));
    expect(p.from).toBe('2026-04-01');
    expect(p.to).toBe('2026-06-30');
  });

  it('volles Jahr vergleicht gegen das Vorjahr', () => {
    const p = previousRange(range('2026-01-01', '2026-12-31'));
    expect(p.from).toBe('2025-01-01');
    expect(p.to).toBe('2025-12-31');
  });

  it('freier Zeitraum bekommt ein gleich langes Fenster direkt davor', () => {
    const r = range('2026-07-10', '2026-07-19'); // 10 Tage
    const p = previousRange(r);
    expect(p.from).toBe('2026-06-30');
    expect(p.to).toBe('2026-07-09');
    expect(rangeLengthDays(p)).toBe(rangeLengthDays(r));
  });
});

describe('Buckets', () => {
  it('wählt die Auflösung nach Länge', () => {
    expect(bucketSizeFor(range('2026-07-01', '2026-07-31'))).toBe('day');
    expect(bucketSizeFor(range('2026-07-01', '2026-09-30'))).toBe('week');
    expect(bucketSizeFor(range('2026-01-01', '2026-12-31'))).toBe('month');
  });

  it('deckt den Zeitraum lückenlos ab', () => {
    const buckets = bucketsOf(range('2026-07-01', '2026-07-31'));
    expect(buckets).toHaveLength(31);
    expect(buckets[0].key).toBe('2026-07-01');
    expect(buckets[30].key).toBe('2026-07-31');
  });

  it('Monats-Buckets werden an den Zeitraumgrenzen beschnitten', () => {
    const buckets = bucketsOf(range('2026-02-10', '2026-12-31'));
    expect(buckets[0].from).toBe('2026-02-10');
    expect(buckets[0].key).toBe('2026-02');
    expect(buckets.at(-1)?.to).toBe('2026-12-31');
  });

  it('Wochen-Buckets starten montags und tragen die KW', () => {
    const buckets = bucketsOf(range('2026-07-01', '2026-09-30'));
    // 1.7.2026 ist ein Mittwoch → erster Bucket beginnt Mo 29.06., am Zeitraum beschnitten
    expect(buckets[0].key).toBe('2026-06-29');
    expect(buckets[0].from).toBe('2026-07-01');
    expect(buckets[0].label).toMatch(/^KW \d+$/);
  });

  it('bucketKeyOf ordnet Tage ihrem Bucket zu', () => {
    expect(bucketKeyOf('2026-07-15', 'day')).toBe('2026-07-15');
    expect(bucketKeyOf('2026-07-15', 'week')).toBe('2026-07-13'); // Montag
    expect(bucketKeyOf('2026-07-15', 'month')).toBe('2026-07');
  });

  it('jeder Tag des Zeitraums landet in genau einem Bucket', () => {
    const r = range('2026-07-01', '2026-09-30');
    const keys = new Set(bucketsOf(r).map((b) => b.key));
    for (const d of ['2026-07-01', '2026-08-15', '2026-09-30']) {
      expect(keys.has(bucketKeyOf(d, bucketSizeFor(r)))).toBe(true);
    }
  });
});

describe('inRange', () => {
  it('schließt beide Enden ein', () => {
    const r = range('2026-07-01', '2026-07-31');
    expect(inRange('2026-07-01', r)).toBe(true);
    expect(inRange('2026-07-31', r)).toBe(true);
    expect(inRange('2026-06-30', r)).toBe(false);
    expect(inRange('2026-08-01', r)).toBe(false);
  });
});

describe('proratedTarget', () => {
  it('voller Monat ergibt exakt das Monatsziel', () => {
    expect(proratedTarget(1500, range('2026-07-01', '2026-07-31'))).toBe(1500);
  });

  it('volles Quartal ergibt das Dreifache', () => {
    expect(proratedTarget(1500, range('2026-07-01', '2026-09-30'))).toBe(4500);
  });

  it('Teilmonat wird tagesanteilig umgelegt', () => {
    // 7 von 31 Julitagen
    expect(proratedTarget(3100, range('2026-07-01', '2026-07-07'))).toBe(700);
  });

  it('rechnet über Monatsgrenzen hinweg mit der jeweiligen Monatslänge', () => {
    // 1 Tag Juni (von 30) + 1 Tag Juli (von 31)
    const v = proratedTarget(300, range('2026-06-30', '2026-07-01'));
    expect(v).toBeCloseTo(300 / 30 + 300 / 31, 1);
  });

  it('ohne Ziel bleibt es bei 0', () => {
    expect(proratedTarget(0, range('2026-07-01', '2026-07-31'))).toBe(0);
  });
});
