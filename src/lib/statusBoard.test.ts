import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  aggregateStatusSeconds,
  computeStatusInsights,
  buildPowerBiRows,
} from './statusBoard';
import type { StatusLogEntry, UserStatus } from '../types';

const HOUR = 3600;

function log(
  status: string,
  startedAt: string,
  endedAt: string,
  extra: Partial<StatusLogEntry> = {},
): StatusLogEntry {
  const durationSeconds = (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000;
  return {
    id: `${status}-${startedAt}`,
    userId: 'u1',
    status,
    isAfk: false,
    startedAt,
    endedAt,
    durationSeconds,
    createdAt: endedAt,
    ...extra,
  };
}

describe('formatDuration', () => {
  it('formatiert Stunden und Minuten', () => {
    expect(formatDuration(0)).toBe('—');
    expect(formatDuration(30)).toBe('< 1m');
    expect(formatDuration(90)).toBe('1m');
    expect(formatDuration(3660)).toBe('1h 01m');
    expect(formatDuration(2 * HOUR + 5 * 60)).toBe('2h 05m');
  });
});

describe('aggregateStatusSeconds', () => {
  const from = new Date('2024-06-15T00:00:00');
  const to = new Date('2024-06-15T12:00:00');

  it('summiert je Status und schneidet auf das Fenster zu', () => {
    const logs = [
      log('hotline', '2024-06-15T09:00:00', '2024-06-15T10:00:00'), // 1h ganz drin
      log('ticketschicht', '2024-06-14T23:00:00', '2024-06-15T01:00:00'), // 2h, aber nur 1h im Fenster
      log('hotline', '2024-06-14T22:00:00', '2024-06-14T23:00:00'), // komplett außerhalb → 0
    ];
    const map = aggregateStatusSeconds(logs, [], from, to);
    expect(map.get('hotline')).toBe(HOUR);
    expect(map.get('ticketschicht')).toBe(HOUR);
  });

  it('zählt laufende (offene) Status bis „jetzt" mit', () => {
    const open = [{ status: 'meeting', startedAt: '2024-06-15T11:00:00' }];
    const map = aggregateStatusSeconds([], open, from, to);
    expect(map.get('meeting')).toBe(HOUR); // 11:00 → 12:00
  });

  it('ignoriert offene Segmente ohne Startzeit', () => {
    const map = aggregateStatusSeconds([], [{ status: 'meeting' }], from, to);
    expect(map.size).toBe(0);
  });
});

describe('computeStatusInsights', () => {
  const from = new Date('2024-06-15T00:00:00');
  const to = new Date('2024-06-15T12:00:00');

  it('errechnet Presence-Zählungen (online / afk / aktiv)', () => {
    // startedAt = to → keine Zeitbeiträge, damit nur die Zählung getestet wird.
    const statuses: UserStatus[] = [
      { userId: 'a', status: 'hotline', isAfk: false, startedAt: to.toISOString(), updatedAt: '' },
      { userId: 'b', status: 'meeting', isAfk: true, startedAt: to.toISOString(), updatedAt: '' },
      { userId: 'c', status: null, isAfk: false, updatedAt: '' },
    ];
    const ins = computeStatusInsights([], statuses, from, to);
    expect(ins.onlineCount).toBe(1);
    expect(ins.afkCount).toBe(1);
    expect(ins.activeCount).toBe(2);
  });

  it('sortiert Status nach Zeit absteigend und rechnet Anteile', () => {
    const logs = [
      log('hotline', '2024-06-15T08:00:00', '2024-06-15T11:00:00'), // 3h
      log('meeting', '2024-06-15T08:00:00', '2024-06-15T09:00:00'), // 1h
    ];
    const ins = computeStatusInsights(logs, [], from, to);
    expect(ins.totalSeconds).toBe(4 * HOUR);
    expect(ins.perStatus[0].id).toBe('hotline');
    expect(ins.perStatus[0].share).toBeCloseTo(0.75, 5);
    expect(ins.perStatus[1].id).toBe('meeting');
  });
});

describe('buildPowerBiRows', () => {
  it('liefert flache, PowerBI-freundliche Spalten', () => {
    const rows = buildPowerBiRows(
      [log('ticketschicht', '2024-06-15T09:00:00', '2024-06-15T09:30:00', { sub: 'Leads' })],
      (id) => (id === 'u1' ? 'Anna Becker' : '?'),
    );
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.Mitarbeiter).toBe('Anna Becker');
    expect(r.Status).toBe('Ticketschicht');
    expect(r.Untertyp).toBe('Leads');
    expect(r.DauerMinuten).toBe(30);
    expect(r.Datum).toBe('2024-06-15');
    expect(r.AFK).toBe('Nein');
  });
});
