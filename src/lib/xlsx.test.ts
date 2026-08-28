import { describe, it, expect } from 'vitest';
import { readXlsx } from './xlsx';
import { parseFile } from './listImport';

// ============================================================================
// Test-Hilfsmittel: eine echte .xlsx-Datei im Speicher bauen
// ============================================================================
// Damit prüfen wir den kompletten Weg — ZIP entpacken, sharedStrings auflösen,
// Zellformate erkennen — und nicht nur die Einzelteile.

interface FileSpec {
  name: string;
  content: string;
  /** true = mit deflate komprimieren (wie Excel es tut), sonst gespeichert */
  deflate?: boolean;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Baut ein ZIP-Archiv nach APPNOTE — genug für einen Lesetest. */
async function buildZip(files: FileSpec[]): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const raw = enc.encode(f.content);
    const data = f.deflate ? await deflateRaw(raw) : raw;
    const method = f.deflate ? 8 : 0;

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, method, true);
    lv.setUint32(14, 0, true); // crc32 — wird beim Lesen nicht geprüft
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, 0, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const total =
    locals.reduce((n, l) => n + l.length, 0) + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const chunk of [...locals, ...centrals, eocd]) {
    out.set(chunk, p);
    p += chunk.length;
  }
  return out.buffer;
}

const WORKBOOK = `<?xml version="1.0"?>
<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Anrufliste" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const RELS = `<?xml version="1.0"?>
<Relationships>
  <Relationship Id="rId1" Type="worksheet" Target="worksheets/blatt.xml"/>
</Relationships>`;

const SHARED = `<?xml version="1.0"?>
<sst count="6" uniqueCount="6">
  <si><t>Name</t></si>
  <si><t>Telefon</t></si>
  <si><t>Vertragsende</t></si>
  <si><t>Meier &amp; Sohn</t></si>
  <si><r><t>Anna </t></r><r><t>Schmidt</t></r></si>
  <si><t>0431 999</t></si>
</sst>`;

// numFmtId 14 = eingebautes Datumsformat, 164 = eigenes Format mit Datum.
const STYLES = `<?xml version="1.0"?>
<styleSheet>
  <numFmts><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/></numFmts>
  <cellXfs count="3">
    <xf numFmtId="0"/>
    <xf numFmtId="14"/>
    <xf numFmtId="164"/>
  </cellXfs>
</styleSheet>`;

const SHEET = `<?xml version="1.0"?>
<worksheet><sheetData>
  <row r="1">
    <c r="A1" t="s"><v>0</v></c>
    <c r="B1" t="s"><v>1</v></c>
    <c r="C1" t="s"><v>2</v></c>
  </row>
  <row r="2">
    <c r="A2" t="s"><v>3</v></c>
    <c r="B2" t="inlineStr"><is><t>0431 123456</t></is></c>
    <c r="C2" s="1"><v>45658</v></c>
  </row>
  <row r="3">
    <c r="A3" t="s"><v>4</v></c>
    <c r="B3" t="s"><v>5</v></c>
    <c r="C3" s="2"><v>44927</v></c>
  </row>
  <row r="4">
    <c r="A4" t="inlineStr"><is><t>Ohne Telefon</t></is></c>
    <c r="C4"><v>123</v></c>
  </row>
</sheetData></worksheet>`;

const buildXlsx = (deflate = false) =>
  buildZip([
    { name: 'xl/workbook.xml', content: WORKBOOK, deflate },
    { name: 'xl/_rels/workbook.xml.rels', content: RELS, deflate },
    { name: 'xl/sharedStrings.xml', content: SHARED, deflate },
    { name: 'xl/styles.xml', content: STYLES, deflate },
    { name: 'xl/worksheets/blatt.xml', content: SHEET, deflate },
  ]);

// ============================================================================

describe('readXlsx', () => {
  it('liest ein gespeichertes (unkomprimiertes) Archiv', async () => {
    const rows = await readXlsx(await buildXlsx(false));
    expect(rows[0]).toEqual(['Name', 'Telefon', 'Vertragsende']);
    expect(rows[1][0]).toBe('Meier & Sohn');
  });

  it('liest ein deflate-komprimiertes Archiv — wie Excel es schreibt', async () => {
    const rows = await readXlsx(await buildXlsx(true));
    expect(rows[0]).toEqual(['Name', 'Telefon', 'Vertragsende']);
    expect(rows[1][1]).toBe('0431 123456');
  });

  it('folgt der Blatt-Referenz statt sheet1.xml zu raten', async () => {
    // Das Blatt heißt hier blatt.xml — ohne Auflösung über die Relationships
    // käme nichts zurück.
    const rows = await readXlsx(await buildXlsx(true));
    expect(rows).toHaveLength(4);
  });

  it('setzt Rich-Text-Bausteine zu einem Wert zusammen', async () => {
    const rows = await readXlsx(await buildXlsx(true));
    expect(rows[2][0]).toBe('Anna Schmidt');
  });

  it('erkennt eingebaute und eigene Datumsformate', async () => {
    const rows = await readXlsx(await buildXlsx(true));
    expect(rows[1][2]).toBe('2025-01-01'); // numFmtId 14
    expect(rows[2][2]).toBe('2023-01-01'); // eigenes Format dd.mm.yyyy
  });

  it('lässt normale Zahlen unverändert', async () => {
    const rows = await readXlsx(await buildXlsx(true));
    expect(rows[3][2]).toBe('123');
  });

  it('füllt ausgelassene leere Zellen auf, damit Spalten nicht verrutschen', async () => {
    const rows = await readXlsx(await buildXlsx(true));
    // Zeile 4 hat kein B — die 123 muss trotzdem in Spalte C landen.
    expect(rows[3][0]).toBe('Ohne Telefon');
    expect(rows[3][1]).toBe('');
    expect(rows[3][2]).toBe('123');
  });

  it('lehnt eine Datei ohne ZIP-Struktur verständlich ab', async () => {
    const junk = new TextEncoder().encode('kein zip').buffer;
    await expect(readXlsx(junk)).rejects.toThrow(/kein gültiges Excel-Archiv/);
  });
});

describe('parseFile', () => {
  it('erkennt .xlsx an den Magic Bytes, nicht an der Endung', async () => {
    const buf = await buildXlsx(true);
    const file = new File([buf], 'liste.txt');
    const table = await parseFile(file);
    expect(table.headers).toEqual(['Name', 'Telefon', 'Vertragsende']);
    expect(table.rows).toHaveLength(3);
  });

  it('liest CSV-Dateien als Text', async () => {
    const file = new File(['Name;Telefon\nHans;0431 1'], 'liste.csv');
    const table = await parseFile(file);
    expect(table.headers).toEqual(['Name', 'Telefon']);
    expect(table.rows[0]).toEqual(['Hans', '0431 1']);
  });

  it('weist das alte .xls-Format mit einem Hinweis ab', async () => {
    const file = new File(['irgendwas'], 'alt.xls');
    await expect(parseFile(file)).rejects.toThrow(/\.xlsx oder CSV/);
  });
});
