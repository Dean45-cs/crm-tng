import { describe, it, expect } from 'vitest';
import {
  parseDelimited,
  detectDelimiter,
  autoMapColumns,
  buildContacts,
  normalizePhone,
  dedupeKeyFor,
} from './listImport';
import { columnIndex, excelSerialToIso, decodeXmlText } from './xlsx';

describe('detectDelimiter', () => {
  it('erkennt Semikolon, Tab und Komma', () => {
    expect(detectDelimiter('Name;Telefon;Ort')).toBe(';');
    expect(detectDelimiter('Name\tTelefon\tOrt')).toBe('\t');
    expect(detectDelimiter('Name,Telefon,Ort')).toBe(',');
  });

  it('lässt sich von Trennzeichen im Anführungszeichen nicht täuschen', () => {
    expect(detectDelimiter('"Meier, Hans";Telefon;Ort')).toBe(';');
  });
});

describe('parseDelimited', () => {
  it('trennt Kopfzeile und Datenzeilen', () => {
    const t = parseDelimited('Name;Telefon\nHans Meier;040 123\nAnna Schmidt;040 456');
    expect(t.headers).toEqual(['Name', 'Telefon']);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[1]).toEqual(['Anna Schmidt', '040 456']);
  });

  it('versteht gequotete Felder mit Trennzeichen und Umbrüchen', () => {
    const t = parseDelimited('Name;Info\n"Meier, Hans";"Zeile 1\nZeile 2"');
    expect(t.rows[0]).toEqual(['Meier, Hans', 'Zeile 1\nZeile 2']);
  });

  it('behandelt doppelte Anführungszeichen als Escape', () => {
    const t = parseDelimited('Name\n"Firma ""Nord"" GmbH"');
    expect(t.rows[0][0]).toBe('Firma "Nord" GmbH');
  });

  it('entfernt BOM und leere Zeilen und versteht CRLF', () => {
    const t = parseDelimited('﻿Name;Ort\r\nHans;Kiel\r\n\r\n');
    expect(t.headers).toEqual(['Name', 'Ort']);
    expect(t.rows).toEqual([['Hans', 'Kiel']]);
  });

  it('liest aus Excel kopierte Zwischenablage (tab-getrennt)', () => {
    const t = parseDelimited('Name\tTelefon\nHans Meier\t040123');
    expect(t.headers).toEqual(['Name', 'Telefon']);
    expect(t.rows[0]).toEqual(['Hans Meier', '040123']);
  });
});

describe('autoMapColumns', () => {
  it('erkennt die üblichen deutschen Kopfzeilen', () => {
    const m = autoMapColumns(['Kundenname', 'KdNr.', 'Telefon', 'PLZ', 'Ort', 'E-Mail']);
    expect(m.customerName).toBe(0);
    expect(m.customerNumber).toBe(1);
    expect(m.phone).toBe(2);
    expect(m.zip).toBe(3);
    expect(m.city).toBe(4);
    expect(m.email).toBe(5);
  });

  it('bevorzugt den exakten Treffer vor dem Teiltreffer', () => {
    const m = autoMapColumns(['Telefon geschäftlich', 'Telefon']);
    expect(m.phone).toBe(1);
  });

  it('ordnet Vor- und Nachname getrennt zu', () => {
    const m = autoMapColumns(['Vorname', 'Nachname', 'Rufnummer']);
    expect(m.firstName).toBe(0);
    expect(m.lastName).toBe(1);
    expect(m.phone).toBe(2);
    expect(m.customerName).toBeUndefined();
  });

  it('vergibt jede Spalte nur einmal', () => {
    const m = autoMapColumns(['Name', 'Name']);
    expect(m.customerName).toBe(0);
    const indices = Object.values(m);
    expect(new Set(indices).size).toBe(indices.length);
  });
});

describe('normalizePhone', () => {
  it('vereinheitlicht Schreibweisen derselben Nummer', () => {
    const variants = ['0431 / 123 456', '+49 431 123456', '0049431123456', '0431123456'];
    const normalized = variants.map(normalizePhone);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe('0431123456');
  });

  it('lässt kurze Nummern ohne Vorwahl unangetastet', () => {
    expect(normalizePhone('49123')).toBe('49123');
  });
});

describe('dedupeKeyFor', () => {
  it('nimmt Telefon vor Kundennummer vor Name+PLZ', () => {
    expect(dedupeKeyFor({ customerName: 'A', phone: '0431 1', customerNumber: '77' })).toBe('tel:04311');
    expect(dedupeKeyFor({ customerName: 'A', customerNumber: '77' })).toBe('kdnr:77');
    expect(dedupeKeyFor({ customerName: 'Hans Meier', zip: '24103' })).toBe('name:hans meier|24103');
  });
});

describe('buildContacts', () => {
  const table = parseDelimited(
    [
      'Name;KdNr;Telefon;PLZ;Ort;Hinweis',
      'Hans Meier;1001;0431 123456;24103;Kiel;Vertrag läuft aus',
      'Anna Schmidt;1002;+49 431 123456;24103;Kiel;',
      ';1003;0431 999;24103;Kiel;ohne Namen',
      'Ohne Telefon;1004;;24105;Kiel;',
    ].join('\n'),
  );
  const mapping = autoMapColumns(table.headers);

  it('übernimmt die zugeordneten Felder', () => {
    const r = buildContacts(table, mapping);
    expect(r.contacts[0]).toMatchObject({
      customerName: 'Hans Meier',
      customerNumber: '1001',
      phone: '0431 123456',
      zip: '24103',
      city: 'Kiel',
      info: 'Vertrag läuft aus',
    });
  });

  it('überspringt Zeilen ohne Namen', () => {
    const r = buildContacts(table, mapping);
    expect(r.skipped).toBe(1);
    expect(r.contacts.some((c) => c.customerNumber === '1003')).toBe(false);
  });

  it('erkennt dieselbe Nummer in unterschiedlicher Schreibweise als Dublette', () => {
    const r = buildContacts(table, mapping);
    expect(r.duplicatesInFile).toBe(1);
    expect(r.contacts.some((c) => c.customerName === 'Anna Schmidt')).toBe(false);
  });

  it('zählt Zeilen ohne Telefonnummer', () => {
    const r = buildContacts(table, mapping);
    expect(r.withoutPhone).toBe(1);
  });

  it('macht einen zweiten Import derselben Liste zum No-Op', () => {
    const first = buildContacts(table, mapping);
    const existing = new Set(first.contacts.map((c) => c.dedupeKey));
    const second = buildContacts(table, mapping, existing);
    expect(second.contacts).toHaveLength(0);
    expect(second.duplicatesExisting).toBe(first.contacts.length);
  });

  it('setzt den Namen aus Vor- und Nachname zusammen', () => {
    const t = parseDelimited('Vorname;Nachname;Telefon\nHans;Meier;0431 1');
    const r = buildContacts(t, autoMapColumns(t.headers));
    expect(r.contacts[0].customerName).toBe('Hans Meier');
  });
});

describe('xlsx-Hilfsfunktionen', () => {
  it('rechnet Spaltenbuchstaben in Indizes um', () => {
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('C7')).toBe(2);
    expect(columnIndex('Z1')).toBe(25);
    expect(columnIndex('AA1')).toBe(26);
    expect(columnIndex('AB10')).toBe(27);
  });

  it('wandelt Excel-Seriennummern in ISO-Daten', () => {
    expect(excelSerialToIso(45658)).toBe('2025-01-01');
    expect(excelSerialToIso(44927)).toBe('2023-01-01');
  });

  it('löst XML-Entities auf', () => {
    expect(decodeXmlText('M&amp;M &lt;Nord&gt; &#65;&#x42;')).toBe('M&M <Nord> AB');
  });
});
