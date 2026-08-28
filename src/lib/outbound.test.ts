import { describe, it, expect } from 'vitest';
import {
  isWorkable,
  isMine,
  workQueue,
  nextContact,
  campaignStats,
  contactBonus,
  agentBonus,
  callCount,
  applyCallResult,
  needsFollowUp,
} from './outbound';
import { makeCampaign, makeContact } from '../test/fixtures';

const REF = '2024-06-15';

describe('isWorkable', () => {
  const campaign = makeCampaign({ id: 'k1', maxAttempts: 3 });

  it('nimmt offene Kontakte', () => {
    expect(isWorkable(makeContact({ campaignId: 'k1' }), campaign, REF)).toBe(true);
  });

  it('schließt abgeschlossene Ergebnisse aus', () => {
    for (const status of ['abschluss', 'keinInteresse', 'falscheDaten', 'sperren'] as const) {
      expect(isWorkable(makeContact({ campaignId: 'k1', status }), campaign, REF)).toBe(false);
    }
  });

  it('lässt ausgereizte Nicht-erreicht-Kontakte fallen', () => {
    const c = makeContact({ campaignId: 'k1', status: 'nichtErreicht', attempts: 3 });
    expect(isWorkable(c, campaign, REF)).toBe(false);
  });

  it('hält Nicht-erreicht unterhalb der Versuchsgrenze im Vorrat', () => {
    const c = makeContact({ campaignId: 'k1', status: 'nichtErreicht', attempts: 2 });
    expect(isWorkable(c, campaign, REF)).toBe(true);
  });

  it('blendet Wiedervorlagen in der Zukunft aus und ab Fälligkeit wieder ein', () => {
    const future = makeContact({
      campaignId: 'k1',
      status: 'wiedervorlage',
      followUpDate: '2024-06-20',
    });
    const due = makeContact({
      campaignId: 'k1',
      status: 'wiedervorlage',
      followUpDate: '2024-06-15',
    });
    expect(isWorkable(future, campaign, REF)).toBe(false);
    expect(isWorkable(due, campaign, REF)).toBe(true);
  });

  it('holt einen fälligen Termin zurück in den Vorrat', () => {
    const termin = makeContact({
      campaignId: 'k1',
      status: 'termin',
      followUpDate: '2024-06-14',
    });
    expect(isWorkable(termin, campaign, REF)).toBe(true);
  });
});

describe('isMine', () => {
  it('gibt nicht zugewiesene Kontakte für alle frei', () => {
    expect(isMine(makeContact(), 'agent-1')).toBe(true);
  });

  it('schützt fremd zugewiesene Kontakte', () => {
    const c = makeContact({ assignedTo: 'agent-2' });
    expect(isMine(c, 'agent-1')).toBe(false);
    expect(isMine(c, 'agent-2')).toBe(true);
  });
});

describe('workQueue / nextContact', () => {
  const campaign = makeCampaign({ id: 'k1', maxAttempts: 3 });

  it('priorisiert Termine vor Wiedervorlagen vor neuen Kontakten', () => {
    const contacts = [
      makeContact({ campaignId: 'k1', customerName: 'Neu' }),
      makeContact({
        campaignId: 'k1',
        customerName: 'Wiedervorlage',
        status: 'wiedervorlage',
        followUpDate: '2024-06-10',
      }),
      makeContact({
        campaignId: 'k1',
        customerName: 'Termin',
        status: 'termin',
        followUpDate: '2024-06-12',
      }),
    ];
    const queue = workQueue(contacts, campaign, 'agent-1', REF);
    expect(queue.map((c) => c.customerName)).toEqual(['Termin', 'Wiedervorlage', 'Neu']);
    expect(nextContact(contacts, campaign, 'agent-1', REF)?.customerName).toBe('Termin');
  });

  it('sortiert fällige Wiedervorlagen nach Alter', () => {
    const contacts = [
      makeContact({
        campaignId: 'k1',
        customerName: 'jung',
        status: 'wiedervorlage',
        followUpDate: '2024-06-14',
      }),
      makeContact({
        campaignId: 'k1',
        customerName: 'alt',
        status: 'wiedervorlage',
        followUpDate: '2024-06-01',
      }),
    ];
    expect(workQueue(contacts, campaign, 'agent-1', REF)[0].customerName).toBe('alt');
  });

  it('ignoriert Kontakte anderer Kampagnen und fremde Zuweisungen', () => {
    const contacts = [
      makeContact({ campaignId: 'k2' }),
      makeContact({ campaignId: 'k1', assignedTo: 'agent-9' }),
    ];
    expect(workQueue(contacts, campaign, 'agent-1', REF)).toHaveLength(0);
    expect(nextContact(contacts, campaign, 'agent-1', REF)).toBeNull();
  });

  it('nimmt erneute Versuche zuletzt, die mit wenigsten Anläufen zuerst', () => {
    const contacts = [
      makeContact({
        campaignId: 'k1',
        customerName: 'zwei Versuche',
        status: 'nichtErreicht',
        attempts: 2,
      }),
      makeContact({
        campaignId: 'k1',
        customerName: 'ein Versuch',
        status: 'nichtErreicht',
        attempts: 1,
      }),
    ];
    expect(workQueue(contacts, campaign, 'agent-1', REF).map((c) => c.customerName)).toEqual([
      'ein Versuch',
      'zwei Versuche',
    ]);
  });
});

describe('campaignStats', () => {
  it('rechnet Erreichbarkeit, Conversion und Fortschritt', () => {
    const contacts = [
      makeContact({ campaignId: 'k1', status: 'abschluss', attempts: 1 }),
      makeContact({ campaignId: 'k1', status: 'termin', attempts: 2 }),
      makeContact({ campaignId: 'k1', status: 'keinInteresse', attempts: 1 }),
      makeContact({ campaignId: 'k1', status: 'nichtErreicht', attempts: 1 }),
      makeContact({ campaignId: 'k1', status: 'offen', attempts: 0 }),
      makeContact({ campaignId: 'k2', status: 'abschluss', attempts: 1 }),
    ];
    const s = campaignStats(contacts, 'k1');
    expect(s.total).toBe(5);
    expect(s.abschluesse).toBe(1);
    expect(s.termine).toBe(1);
    expect(s.keinInteresse).toBe(1);
    expect(s.bearbeitet).toBe(4);
    expect(s.versuche).toBe(5);
    // erreicht: Abschluss, Termin, kein Interesse = 3 von 4 bearbeiteten
    expect(s.erreichbarkeit).toBe(75);
    expect(s.conversion).toBe(25);
    // erledigt: Abschluss + kein Interesse = 2 von 5
    expect(s.fortschritt).toBe(40);
    expect(s.offen).toBe(3);
  });

  it('liefert null statt Division durch null', () => {
    const s = campaignStats([makeContact({ campaignId: 'k1' })], 'k1');
    expect(s.erreichbarkeit).toBeNull();
    expect(s.conversion).toBeNull();
    expect(s.fortschritt).toBe(0);
  });
});

describe('Prämien', () => {
  const campaign = makeCampaign({ id: 'k1', bonusTermin: 5, bonusAbschluss: 20 });

  it('zahlt je Status genau eine Prämie', () => {
    expect(contactBonus(makeContact({ status: 'abschluss' }), campaign)).toBe(20);
    expect(contactBonus(makeContact({ status: 'termin' }), campaign)).toBe(5);
    expect(contactBonus(makeContact({ status: 'keinInteresse' }), campaign)).toBe(0);
    expect(contactBonus(makeContact({ status: 'offen' }), campaign)).toBe(0);
  });

  it('summiert je Person und ordnet sie dem Ergebnis-Setzer zu', () => {
    const contacts = [
      makeContact({ campaignId: 'k1', status: 'abschluss', resultBy: 'a' }),
      makeContact({ campaignId: 'k1', status: 'termin', resultBy: 'a' }),
      makeContact({ campaignId: 'k1', status: 'abschluss', resultBy: 'b' }),
    ];
    expect(agentBonus(contacts, [campaign], 'a')).toBe(25);
    expect(agentBonus(contacts, [campaign], 'b')).toBe(20);
  });

  it('grenzt optional auf den Referenzmonat ein', () => {
    const contacts = [
      makeContact({
        campaignId: 'k1',
        status: 'abschluss',
        resultBy: 'a',
        resultAt: '2024-06-10T09:00:00.000Z',
      }),
      makeContact({
        campaignId: 'k1',
        status: 'abschluss',
        resultBy: 'a',
        resultAt: '2024-05-10T09:00:00.000Z',
      }),
    ];
    expect(agentBonus(contacts, [campaign], 'a', new Date(2024, 5, 15))).toBe(20);
    expect(agentBonus(contacts, [campaign], 'a')).toBe(40);
  });

  it('ignoriert Kontakte ohne bekannte Kampagne', () => {
    const contacts = [makeContact({ campaignId: 'weg', status: 'abschluss', resultBy: 'a' })];
    expect(agentBonus(contacts, [campaign], 'a')).toBe(0);
  });
});

describe('callCount', () => {
  it('zählt eigene Gespräche ab Stichtag', () => {
    const calls = [
      { createdBy: 'a', createdAt: '2024-06-10T09:00:00.000Z' },
      { createdBy: 'a', createdAt: '2024-05-10T09:00:00.000Z' },
      { createdBy: 'b', createdAt: '2024-06-11T09:00:00.000Z' },
    ];
    expect(callCount(calls, 'a')).toBe(2);
    expect(callCount(calls, 'a', new Date('2024-06-01T00:00:00.000Z'))).toBe(1);
  });
});

describe('applyCallResult', () => {
  const now = new Date('2024-06-15T08:30:00.000Z');

  it('zählt den Versuch hoch und schreibt das Ergebnis fest', () => {
    const c = makeContact({ attempts: 1 });
    const patch = applyCallResult(c, { outcome: 'nichtErreicht' }, 'agent-1', now);
    expect(patch.status).toBe('nichtErreicht');
    expect(patch.attempts).toBe(2);
    expect(patch.resultBy).toBe('agent-1');
    expect(patch.resultAt).toBe(now.toISOString());
    expect(patch.lastCallAt).toBe(now.toISOString());
  });

  it('übernimmt die Wiedervorlage bei Termin und Wiedervorlage', () => {
    expect(needsFollowUp('termin')).toBe(true);
    expect(needsFollowUp('wiedervorlage')).toBe(true);
    expect(needsFollowUp('abschluss')).toBe(false);

    const patch = applyCallResult(
      makeContact(),
      { outcome: 'termin', followUpDate: '2024-06-20', followUpTime: '14:30' },
      'agent-1',
      now,
    );
    expect(patch.followUpDate).toBe('2024-06-20');
    expect(patch.followUpTime).toBe('14:30');
  });

  it('räumt eine alte Wiedervorlage bei endgültigem Ergebnis ab', () => {
    const c = makeContact({
      status: 'wiedervorlage',
      followUpDate: '2024-06-20',
      followUpTime: '10:00',
    });
    const patch = applyCallResult(c, { outcome: 'keinInteresse' }, 'agent-1', now);
    expect(patch.followUpDate).toBeUndefined();
    expect(patch.followUpTime).toBeUndefined();
    // Die Schlüssel müssen im Patch stehen — updateOutboundContactRow löscht
    // das Datum über `in`, ein Fehlen hieße „unverändert lassen".
    expect('followUpDate' in patch).toBe(true);
    expect('followUpTime' in patch).toBe(true);
  });

  it('hängt eine Notiz mit Datum an die bestehenden an', () => {
    const c = makeContact({ notes: 'Erstkontakt' });
    const patch = applyCallResult(
      c,
      { outcome: 'wiedervorlage', followUpDate: '2024-06-20', note: 'Ruft zurück' },
      'agent-1',
      now,
    );
    expect(patch.notes).toBe('Erstkontakt\n15.6.2024: Ruft zurück');
  });

  it('lässt Notizen unangetastet, wenn nichts eingegeben wurde', () => {
    const patch = applyCallResult(
      makeContact({ notes: 'alt' }),
      { outcome: 'keinInteresse', note: '   ' },
      'agent-1',
      now,
    );
    expect(patch.notes).toBeUndefined();
  });
});
