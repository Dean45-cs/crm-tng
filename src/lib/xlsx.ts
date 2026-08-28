/**
 * Minimaler .xlsx-Leser — ohne Fremd-Bibliothek.
 *
 * Eine .xlsx-Datei ist ein ZIP-Archiv aus XML-Dateien. Wir brauchen nur den
 * Lesepfad für einfache Tabellen (die Anruflisten aus Excel), deshalb steckt
 * hier bewusst kein vollständiger OOXML-Parser, sondern genau so viel, wie
 * eine exportierte Liste braucht:
 *
 *   - ZIP entpacken (gespeichert + deflate) über die native `DecompressionStream`
 *   - sharedStrings.xml (Excel legt Texte zentral ab)
 *   - das erste Arbeitsblatt inkl. Inline-Strings und Formel-Ergebnissen
 *   - Datumszellen, die Excel als fortlaufende Zahl speichert
 *
 * Nicht unterstützt: ZIP64 (Listen jenseits von 4 GB), verschlüsselte Dateien
 * und die 1904-Datumsbasis alter Mac-Dateien. Alle drei sind für Anruflisten
 * praktisch ausgeschlossen und werden mit klarer Meldung abgelehnt.
 */

// ============================================================================
// ZIP
// ============================================================================

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

/** Liest das zentrale Verzeichnis eines ZIP-Archivs. */
function readCentralDirectory(view: DataView): ZipEntry[] {
  // Das EOCD steht am Dateiende, hinter einem bis zu 64 KB langen Kommentar.
  const maxScan = Math.min(view.byteLength, 0xffff + 22);
  let eocd = -1;
  for (let i = 22; i <= maxScan; i++) {
    const pos = view.byteLength - i;
    if (pos < 0) break;
    if (view.getUint32(pos, true) === SIG_EOCD) {
      eocd = pos;
      break;
    }
  }
  if (eocd < 0) throw new Error('Die Datei ist kein gültiges Excel-Archiv.');

  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || count === 0xffff) {
    throw new Error('ZIP64-Dateien werden nicht unterstützt. Bitte als CSV exportieren.');
  }

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > view.byteLength || view.getUint32(p, true) !== SIG_CENTRAL) break;
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localHeaderOffset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(
      new Uint8Array(view.buffer, view.byteOffset + p + 46, nameLen),
    );
    entries.push({ name, method, compressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Entpackt einen einzelnen Eintrag und gibt ihn als Text zurück. */
async function readEntry(
  buffer: ArrayBuffer,
  view: DataView,
  entry: ZipEntry,
): Promise<string> {
  const lh = entry.localHeaderOffset;
  // Die Längen im lokalen Header können abweichen, deshalb von dort lesen.
  const nameLen = view.getUint16(lh + 26, true);
  const extraLen = view.getUint16(lh + 28, true);
  const start = lh + 30 + nameLen + extraLen;
  const raw = new Uint8Array(buffer, start, entry.compressedSize);

  if (entry.method === 0) return new TextDecoder().decode(raw);
  if (entry.method !== 8) {
    throw new Error(`Nicht unterstützte Komprimierung in der Excel-Datei (${entry.method}).`);
  }

  // `deflate-raw` = DEFLATE ohne zlib-Header, genau das Format im ZIP.
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

// ============================================================================
// XML
// ============================================================================

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Löst XML-Entities auf (benannte und numerische). */
export function decodeXmlText(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, code: string) => {
    if (code[0] === '#') {
      const num =
        code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(num) ? String.fromCodePoint(num) : match;
    }
    return ENTITIES[code] ?? match;
  });
}

/** Liest ein Attribut aus einem Start-Tag. */
function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeXmlText(m[1]) : undefined;
}

/** Sammelt den Text aller <t>-Elemente eines Abschnitts (Rich-Text-Runs). */
function collectText(xml: string): string {
  let out = '';
  const re = /<t\b[^>]*?(\/>|>([\s\S]*?)<\/t>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[1] !== '/>') out += decodeXmlText(m[2] ?? '');
  }
  return out;
}

/** Die zentrale String-Tabelle von Excel. */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si\b[^>]*?(\/>|>([\s\S]*?)<\/si>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1] === '/>' ? '' : collectText(m[2] ?? ''));
  }
  return out;
}

// ============================================================================
// Datumsformate
// ============================================================================

/** Eingebaute Excel-Formate, die ein Datum oder eine Uhrzeit darstellen. */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/**
 * Ermittelt je Zellstil, ob er ein Datum anzeigt. Ohne das würden Datumsspalten
 * als fünfstellige Zahl im Import landen.
 */
function parseDateStyles(stylesXml: string): Set<number> {
  // Eigene Formate: alles mit Tages-/Monats-/Jahres-Platzhaltern ist ein Datum.
  const dateFormatIds = new Set<number>(BUILTIN_DATE_FORMATS);
  const fmtRe = /<numFmt\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = fmtRe.exec(stylesXml)) !== null) {
    const id = Number(attr(m[1], 'numFmtId'));
    const code = attr(m[1], 'formatCode') ?? '';
    // Escapes und Textliterale entfernen, damit z.B. "Mrd" kein 'd' beisteuert.
    const bare = code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '');
    if (Number.isFinite(id) && /[dmyhs]/i.test(bare)) dateFormatIds.add(id);
  }

  const styles = new Set<number>();
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  if (!cellXfs) return styles;

  const xfRe = /<xf\b([^>]*?)\/?>/g;
  let index = 0;
  while ((m = xfRe.exec(cellXfs[1])) !== null) {
    const id = Number(attr(m[1], 'numFmtId'));
    if (Number.isFinite(id) && dateFormatIds.has(id)) styles.add(index);
    index += 1;
  }
  return styles;
}

/**
 * Wandelt eine Excel-Seriennummer in ein ISO-Datum (YYYY-MM-DD).
 * Basis ist der 30.12.1899 — der Versatz, mit dem Excels erfundener
 * 29.02.1900 rechnerisch wieder aufgeht.
 */
export function excelSerialToIso(serial: number): string {
  const ms = Math.round(serial * 86400000);
  const d = new Date(Date.UTC(1899, 11, 30) + ms);
  if (Number.isNaN(d.getTime())) return String(serial);
  return d.toISOString().slice(0, 10);
}

// ============================================================================
// Arbeitsblatt
// ============================================================================

/** Spaltenbuchstaben einer Zellreferenz in einen 0-basierten Index. */
export function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

function parseSheet(
  xml: string,
  shared: string[],
  dateStyles: Set<number>,
): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*?(\/>|>([\s\S]*?)<\/row>)/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRe.exec(xml)) !== null) {
    if (rowMatch[1] === '/>') {
      rows.push([]);
      continue;
    }
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRe.exec(rowMatch[2] ?? '')) !== null) {
      const tag = cellMatch[1];
      const body = cellMatch[2] === '/>' ? '' : (cellMatch[3] ?? '');
      const ref = attr(tag, 'r');
      const type = attr(tag, 't');
      const styleAttr = attr(tag, 's');

      let value = '';
      if (type === 'inlineStr') {
        value = collectText(body);
      } else {
        // <f> ist die Formel, <v> ihr zwischengespeichertes Ergebnis.
        const v = /<v\b[^>]*?(?:\/>|>([\s\S]*?)<\/v>)/.exec(body);
        const rawValue = v ? decodeXmlText(v[1] ?? '') : '';
        if (type === 's') {
          value = shared[Number(rawValue)] ?? '';
        } else if (type === 'b') {
          value = rawValue === '1' ? 'WAHR' : 'FALSCH';
        } else if (type === 'e') {
          value = '';
        } else if (rawValue !== '') {
          const styleIdx = styleAttr === undefined ? NaN : Number(styleAttr);
          const num = Number(rawValue);
          value =
            Number.isFinite(num) && dateStyles.has(styleIdx)
              ? excelSerialToIso(num)
              : rawValue;
        }
      }

      // Excel lässt leere Zellen weg — anhand der Referenz wieder auffüllen,
      // sonst verrutschen die Spalten.
      const idx = ref ? columnIndex(ref) : cells.length;
      while (cells.length < idx) cells.push('');
      cells[idx] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/** Liest das erste Arbeitsblatt einer .xlsx-Datei als Zeilen von Zelltexten. */
export async function readXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const view = new DataView(buffer);
  const entries = readCentralDirectory(view);
  const byName = new Map(entries.map((e) => [e.name, e]));

  const read = async (name: string): Promise<string> => {
    const entry = byName.get(name);
    return entry ? readEntry(buffer, view, entry) : '';
  };

  // Das erste Blatt der Arbeitsmappe finden — es heißt nicht immer sheet1.xml.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const workbook = await read('xl/workbook.xml');
  const firstSheet = /<sheet\b([^>]*)\/?>/.exec(workbook);
  const rid = firstSheet ? attr(firstSheet[1], 'r:id') : undefined;
  if (rid) {
    const rels = await read('xl/_rels/workbook.xml.rels');
    const relRe = /<Relationship\b([^>]*)\/?>/g;
    let m: RegExpExecArray | null;
    while ((m = relRe.exec(rels)) !== null) {
      if (attr(m[1], 'Id') === rid) {
        const target = attr(m[1], 'Target') ?? '';
        sheetPath = target.startsWith('/')
          ? target.slice(1)
          : `xl/${target.replace(/^\.\//, '')}`;
        break;
      }
    }
  }

  const sheetXml = await read(sheetPath);
  if (!sheetXml) throw new Error('In der Datei wurde kein Arbeitsblatt gefunden.');

  const [sharedXml, stylesXml] = await Promise.all([
    read('xl/sharedStrings.xml'),
    read('xl/styles.xml'),
  ]);

  return parseSheet(
    sheetXml,
    sharedXml ? parseSharedStrings(sharedXml) : [],
    stylesXml ? parseDateStyles(stylesXml) : new Set<number>(),
  );
}
