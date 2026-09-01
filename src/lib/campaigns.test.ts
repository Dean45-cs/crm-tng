import { describe, it, expect } from 'vitest';
import {
  advertisingAllowed,
  averageAdviceScore,
  buildWrapupPatch,
  campaignFor,
  catalogOf,
  doiStats,
  fraudPatterns,
  homeIdRate,
  openWrapups,
  reasonLabel,
  winbackStats,
  wrapupFromCall,
} from './campaigns';
import { makeCall } from '../test/fixtures';
import type { Call, CampaignCallType } from '../types';

const at = new Date('2026-08-17T09:00:00.000Z');

describe('buildWrapupPatch', () => {
  it('übersetzt eine vollständige Erfassung in Spalten und markiert sie als abrechenbar', () => {
    const patch = buildWrapupPatch(
      'churn',
      'winback-erfolgreich',
      {
        legitimation: 'geburtsdatum',
        variant: 'kuendigung',
        winbackReason: 'preis',
        winbackMeasure: 'passung',
        confirmationSent: true,
        decision: true,
        winbackStatus: 'erfolgreich',
        doi: 'bestaetigt',
        documentation: true,
      },
      at,
    );

    expect(patch.outcomeCode).toBe('winback-erfolgreich');
    expect(patch.disposition).toBe('gehalten');
    expect(patch.winbackStatus).toBe('erfolgreich');
    expect(patch.winbackReason).toBe('preis');
    expect(patch.doiStatus).toBe('bestaetigt');
    expect(patch.doiConfirmedAt).toBe(at.toISOString());
    expect(patch.wrapupComplete).toBe(true);
  });

  it('setzt den Winbackstatus auf offen, wenn die Ursache fehlt', () => {
    // Die Regel aus dem BVW-Leitfaden. Die Oberfläche verhindert den Fall
    // vorher — die Übersetzung darf sich aber nicht darauf verlassen.
    const patch = buildWrapupPatch('churn', 'winback-erfolgreich', {}, at);
    expect(patch.winbackStatus).toBe('offen');
    expect(patch.wrapupComplete).toBe(false);
  });

  it('schreibt den Kündigungsgrund im Klartext, nicht als Katalog-Id', () => {
    // calls.cancellation_reason speist die bestehende Auswertung aus
    // Migration 021 — dort sollen Gründe stehen, keine Ids.
    const patch = buildWrapupPatch(
      'churn',
      'winback-gescheitert',
      { rejectionReason: 'umzug' },
      at,
    );
    expect(patch.disposition).toBe('gekuendigt');
    expect(patch.cancellationReason).toBe('Umzug');
  });

  it('leitet die HomeID-Art ab und normalisiert die Nummer', () => {
    const patch = buildWrapupPatch(
      'courtesy',
      'aktiviert',
      { homeId: '  ne 4222 24ws52 ', homeIdConfirmed: true },
      at,
    );
    expect(patch.homeId).toBe('NE422224WS52');
    expect(patch.homeIdKind).toBe('homeid');
    expect(patch.homeIdConfirmed).toBe(true);
  });

  it('legt Kampagnenspezifisches in campaignData ab, nicht in Spalten', () => {
    const patch = buildWrapupPatch(
      'dupe',
      'keine-dublette',
      { legitimation: 'geburtsdatum', buildingType: 'sdu2', haushalte: '2', keller: 'ja' },
      at,
    );
    expect(patch.campaignData).toMatchObject({ buildingType: 'sdu2', haushalte: '2', keller: 'ja' });
    // Was eine eigene Spalte hat, wird nicht zusätzlich dupliziert.
    expect(patch.campaignData).not.toHaveProperty('homeId');
  });

  it('setzt keinen Einwilligungs-Zeitstempel, solange nur angekündigt wurde', () => {
    const patch = buildWrapupPatch('prl', 'irrlaeufer', { doi: 'angekuendigt', note: 'x' }, at);
    expect(patch.doiSentAt).toBeUndefined();
    expect(patch.doiConfirmedAt).toBeUndefined();
  });
});

describe('wrapupFromCall', () => {
  it('führt Spalten und campaignData wieder zu einem Formular zusammen', () => {
    const call = makeCall({
      outcomeCode: 'adresse-korrigiert',
      winbackStatus: 'offen',
      homeId: 'NE422224WS52',
      homeIdKind: 'homeid',
      doiStatus: 'versendet',
      campaignData: { prlCause: 'namensschild', resendTriggered: true },
    });
    const wrapup = wrapupFromCall(call);
    expect(wrapup.outcomeCode).toBe('adresse-korrigiert');
    expect(wrapup.homeId).toBe('NE422224WS52');
    expect(wrapup.doi).toBe('versendet');
    expect(wrapup.prlCause).toBe('namensschild');
  });
});

describe('winbackStats', () => {
  it('rechnet nur entschiedene Fälle in die Quote', () => {
    const s = winbackStats([
      makeCall({ winbackStatus: 'erfolgreich' }),
      makeCall({ winbackStatus: 'erfolgreich' }),
      makeCall({ winbackStatus: 'nicht_erfolgreich' }),
      // Irrelevant ist eine Einordnung, keine Niederlage.
      makeCall({ winbackStatus: 'irrelevant' }),
      // Offen ist gar nicht entschieden.
      makeCall({ winbackStatus: 'offen' }),
      makeCall({}),
    ]);
    expect(s.erfolgreich).toBe(2);
    expect(s.nichtErfolgreich).toBe(1);
    expect(s.irrelevant).toBe(1);
    expect(s.offen).toBe(1);
    expect(s.quotePct).toBe(67);
  });

  it('liefert null statt einer Null-Quote, wenn nichts entschieden ist', () => {
    expect(winbackStats([makeCall({ winbackStatus: 'irrelevant' })]).quotePct).toBeNull();
  });
});

describe('homeIdRate', () => {
  // Der Nenner sind nur Kampagnen, die eine HomeID verlangen — sonst zöge
  // jeder Dubletten-Check die Quote nach unten, obwohl dort nichts zu
  // erheben war.
  const typeOf = (call: Call): CampaignCallType | undefined =>
    (call.campaignId as CampaignCallType | undefined) ?? undefined;

  it('zählt nur Kampagnen mit HomeID-Pflicht', () => {
    const s = homeIdRate(
      [
        makeCall({ campaignId: 'courtesy', disposition: 'gehalten', homeId: 'NE1', homeIdConfirmed: true }),
        makeCall({ campaignId: 'courtesy', disposition: 'gehalten' }),
        makeCall({ campaignId: 'dupe', disposition: 'gehalten' }),
      ],
      typeOf,
    );
    expect(s.relevant).toBe(2);
    expect(s.captured).toBe(1);
    expect(s.ratePct).toBe(50);
  });

  it('wertet eine nicht rückbestätigte Nummer nicht als erfasst', () => {
    const s = homeIdRate(
      [makeCall({ campaignId: 'courtesy', disposition: 'gehalten', homeId: 'NE1', homeIdConfirmed: false })],
      typeOf,
    );
    expect(s.captured).toBe(0);
  });
});

describe('doiStats', () => {
  it('nimmt alle Gespräche mit Ergebnis als Nenner', () => {
    // Der Leitfaden verlangt die Ankündigung in JEDEM positiven oder neutralen
    // Abschluss — nicht nur in den erfolgreichen.
    const s = doiStats([
      makeCall({ disposition: 'gehalten', doiStatus: 'bestaetigt' }),
      makeCall({ disposition: 'gekuendigt', doiStatus: 'angekuendigt' }),
      makeCall({ disposition: 'gehalten' }),
      // Ohne Ergebnis: kein Gespräch, kein Nenner.
      makeCall({}),
    ]);
    expect(s.total).toBe(3);
    expect(s.announced).toBe(2);
    expect(s.confirmed).toBe(1);
    expect(s.announcedPct).toBe(67);
    expect(s.confirmedPct).toBe(50);
  });
});

describe('averageAdviceScore', () => {
  it('mittelt die Schulnoten auf eine Nachkommastelle', () => {
    expect(averageAdviceScore([makeCall({ adviceScore: 1 }), makeCall({ adviceScore: 2 })])).toBe(1.5);
  });
  it('liefert null ohne Bewertungen', () => {
    expect(averageAdviceScore([makeCall({})])).toBeNull();
  });
});

describe('fraudPatterns', () => {
  it('gruppiert nach Vertriebspartner und nennt die häufigsten Merkmale', () => {
    const rows = fraudPatterns([
      makeCall({ salesPartner: 'Partner A', fraudSuspicion: true, fraudMarkers: ['daten-unterschrift'] }),
      makeCall({ salesPartner: 'Partner A', fraudSuspicion: true, fraudMarkers: ['daten-unterschrift'] }),
      makeCall({ salesPartner: 'Partner A' }),
      makeCall({ salesPartner: 'Partner B', fraudSuspicion: true, fraudMarkers: ['vertrieb-draengt'] }),
      // Ohne Partner lässt sich kein Muster bilden.
      makeCall({ fraudSuspicion: true }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].salesPartner).toBe('Partner A');
    expect(rows[0].suspicions).toBe(2);
    expect(rows[0].total).toBe(3);
    expect(rows[0].ratePct).toBe(67);
    expect(rows[0].topMarkers[0]).toEqual({ id: 'daten-unterschrift', count: 2 });
  });

  it('listet Partner ohne Verdachtsfall nicht auf', () => {
    expect(fraudPatterns([makeCall({ salesPartner: 'Partner C' })])).toHaveLength(0);
  });
});

describe('openWrapups', () => {
  it('zeigt nur Gespräche mit Ergebnis und unvollständiger Erfassung, neueste zuerst', () => {
    const rows = openWrapups([
      makeCall({ id: 'alt', disposition: 'gehalten', wrapupComplete: false, startedAt: '2026-08-01T08:00:00.000Z' }),
      makeCall({ id: 'neu', disposition: 'gehalten', wrapupComplete: false, startedAt: '2026-08-05T08:00:00.000Z' }),
      makeCall({ id: 'fertig', disposition: 'gehalten', wrapupComplete: true }),
      // Wer niemanden erreicht hat, hat nichts nachzutragen.
      makeCall({ id: 'ohne', wrapupComplete: false }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['neu', 'alt']);
  });
});

describe('Katalog-Zugriff', () => {
  it('findet den Klartext einer Ursache über alle Kataloge der Kampagne', () => {
    expect(reasonLabel('churn', 'preis')).toBe('Preis zu hoch');
    expect(reasonLabel('bvw', 'weg')).toBe('Eigentümergemeinschaft (WEG)');
    expect(reasonLabel('churn', 'gibtsnicht')).toBe('gibtsnicht');
    expect(reasonLabel('churn', undefined)).toBe('');
  });

  it('liefert je Kampagne den passenden Katalog', () => {
    expect(catalogOf('prl', 'prlCause').map((e) => e.id)).toContain('namensschild');
    expect(catalogOf('dupe', 'dupeReason').map((e) => e.id)).toContain('inhaberwechsel');
    expect(catalogOf('churn', 'gibtsnicht')).toEqual([]);
  });

  it('gibt jeder Kampagne ihre eigene Rufnummernanzeige', () => {
    // § 120 TKG verbietet die Unterdrückung — die Nummer steht im Katalog,
    // damit die Oberfläche sie nennen kann.
    expect(campaignFor('welcome').callerId).toBe('0431 97992556');
    expect(campaignFor('dupe').callerId).toBe('0431 97992557');
  });

  it('erlaubt werbliche Ansprache erst nach der Bestätigung', () => {
    expect(advertisingAllowed('bestaetigt')).toBe(true);
    expect(advertisingAllowed('versendet')).toBe(false);
  });
});
