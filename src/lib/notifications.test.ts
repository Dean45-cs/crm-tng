import { describe, it, expect } from 'vitest';
import {
  notificationLook,
  relativeTime,
  dayHeading,
  shiftLabel,
  shortDay,
  swapSummary,
  toRoute,
} from './notifications';

describe('notificationLook', () => {
  it('kennt die eigenen Arten', () => {
    expect(notificationLook('swap-approved').tone).toBe('success');
    expect(notificationLook('swap-rejected').tone).toBe('danger');
    expect(notificationLook('shift-changed').label).toBe('Schichtplan');
  });

  it('macht aus einer unbekannten Art eine neutrale Meldung statt eines Fehlers', () => {
    // Die Datenbank soll neue Arten liefern können, ohne dass ein Client,
    // der sie noch nicht kennt, daran scheitert.
    const look = notificationLook('gibt-es-noch-nicht');
    expect(look.tone).toBe('info');
    expect(look.label).toBe('Meldung');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-07-28T12:00:00Z').getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('fasst alles unter einer Minute als „jetzt"', () => {
    expect(relativeTime(ago(5_000), now)).toBe('jetzt');
    expect(relativeTime(ago(59_000), now)).toBe('jetzt');
  });

  it('zeigt eine Uhr, die vorgeht, nicht als Zukunft an', () => {
    expect(relativeTime(new Date(now + 4_000).toISOString(), now)).toBe('jetzt');
  });

  it('wird gröber, je länger es her ist', () => {
    expect(relativeTime(ago(3 * 60_000), now)).toBe('vor 3 Min.');
    expect(relativeTime(ago(2 * 3_600_000), now)).toBe('vor 2 Std.');
    expect(relativeTime(ago(26 * 3_600_000), now)).toBe('Gestern');
    expect(relativeTime(ago(3 * 86_400_000), now)).toBe('vor 3 Tagen');
  });

  it('gibt ab einer Woche ein Datum aus', () => {
    expect(relativeTime(ago(10 * 86_400_000), now)).toMatch(/\d{2}\.\d{2}\.\d{2}/);
  });

  it('verträgt einen kaputten Zeitstempel', () => {
    expect(relativeTime('keine-zeit', now)).toBe('');
  });
});

describe('dayHeading', () => {
  const now = new Date(2026, 6, 28, 12, 0, 0);

  it('benennt heute und gestern', () => {
    expect(dayHeading(new Date(2026, 6, 28, 8, 0).toISOString(), now)).toBe('Heute');
    expect(dayHeading(new Date(2026, 6, 27, 23, 0).toISOString(), now)).toBe('Gestern');
  });

  it('schreibt für ältere Tage Wochentag und Datum', () => {
    const heading = dayHeading(new Date(2026, 6, 20, 9, 0).toISOString(), now);
    expect(heading).toMatch(/^Montag, 20\./);
  });
});

describe('shortDay', () => {
  it('liest den Datumsschlüssel lokal, nicht als UTC', () => {
    // `new Date('2026-08-03')` wäre UTC-Mitternacht und rutschte westlich von
    // Greenwich auf den 02.08. — genau die Falle, die parseLocalDate im
    // Schichtplan schon einmal gekostet hat.
    expect(shortDay('2026-08-03')).toContain('03.08.');
    expect(shortDay('2026-08-03')).toMatch(/^Mo/);
  });

  it('gibt Unsinn unverändert zurück, statt „Invalid Date" zu zeigen', () => {
    expect(shortDay('kein-datum')).toBe('kein-datum');
  });
});

describe('shiftLabel & swapSummary', () => {
  it('nennt eine fehlende Schicht beim Namen', () => {
    expect(shiftLabel(undefined)).toBe('keine Schicht');
    expect(shiftLabel('frueh')).toBe('Früh');
  });

  it('beschreibt den Tausch in einem Satz', () => {
    const text = swapSummary({
      requesterDate: '2026-08-03',
      requesterShiftType: 'frueh',
      partnerDate: '2026-08-04',
      partnerShiftType: 'spaet',
    });
    expect(text).toContain('03.08.');
    expect(text).toContain('Früh');
    expect(text).toContain('gegen');
    expect(text).toContain('04.08.');
    expect(text).toContain('Spät');
  });
});

describe('toRoute', () => {
  it('führt einfache Routen direkt an ihr Ziel', () => {
    expect(toRoute({ route: 'schedule' })).toEqual({ name: 'schedule' });
  });

  it('reicht Parameter durch, wenn die Route sie braucht', () => {
    expect(toRoute({ route: 'customer', kdnr: '4711' })).toEqual({ name: 'customer', kdnr: '4711' });
    expect(toRoute({ route: 'agentdetail', agentKey: 'u1' })).toEqual({ name: 'agentdetail', agentKey: 'u1' });
  });

  it('landet im Postfach, wenn das Ziel nicht taugt', () => {
    // Das Ziel kommt aus der Datenbank; ein unbekannter Name oder ein
    // fehlender Pflichtparameter führte sonst auf eine leere Seite.
    expect(toRoute({ route: 'gibt-es-nicht' })).toEqual({ name: 'postfach' });
    expect(toRoute({ route: 'customer' })).toEqual({ name: 'postfach' });
    expect(toRoute({ route: 'agentdetail' })).toEqual({ name: 'postfach' });
  });
});
