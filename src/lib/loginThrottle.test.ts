import { describe, it, expect } from 'vitest';
import { computeLockedUntil, formatLockMessage, FREE_ATTEMPTS } from './loginThrottle';

describe('computeLockedUntil', () => {
  const now = 1_000_000;

  it('sperrt nicht innerhalb der freien Versuche', () => {
    for (let fails = 1; fails <= FREE_ATTEMPTS; fails++) {
      expect(computeLockedUntil(fails, now)).toBe(0);
    }
  });

  it('startet beim ersten Fehlversuch über dem Limit mit 30s', () => {
    expect(computeLockedUntil(FREE_ATTEMPTS + 1, now)).toBe(now + 30_000);
  });

  it('verdoppelt die Sperrzeit je weiterem Fehlversuch', () => {
    expect(computeLockedUntil(FREE_ATTEMPTS + 2, now)).toBe(now + 60_000);
    expect(computeLockedUntil(FREE_ATTEMPTS + 3, now)).toBe(now + 120_000);
  });

  it('deckelt die Sperrzeit bei 15 Minuten', () => {
    expect(computeLockedUntil(FREE_ATTEMPTS + 50, now)).toBe(now + 15 * 60 * 1000);
  });
});

describe('formatLockMessage', () => {
  it('formatiert Sekunden und Minuten', () => {
    expect(formatLockMessage(20)).toContain('20 Sekunden');
    expect(formatLockMessage(1)).toContain('1 Sekunde');
    expect(formatLockMessage(90)).toContain('2 Minuten');
    expect(formatLockMessage(60)).toContain('1 Minute');
  });
});
