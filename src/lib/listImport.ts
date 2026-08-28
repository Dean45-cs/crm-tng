import type { OutboundContact } from '../types';
import { readXlsx } from './xlsx';

/**
 * Import von Anruflisten aus Excel (.xlsx), CSV und direkt aus der
 * Zwischenablage (Excel kopiert tab-getrennt). Der Parser liefert eine rohe
 * Tabelle, die Spalten werden anschließend Feldern zugeordnet — automatisch,
 * mit der Möglichkeit zur Korrektur in der Import-Maske.
 */

export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

// ============================================================================
// Text-Formate (CSV / Zwischenablage)
// ============================================================================

/**
 * Erkennt das Trennzeichen anhand der Kopfzeile. Deutsche Excel-Exporte nutzen
 * Semikolon, Zwischenablage-Inhalte Tabulatoren, internationale Dateien Komma.
 */
export function detectDelimiter(firstLine: string): string {
  const candidates = [';', '\t', ',', '|'];
  let best = ';';
  let bestCount = 0;
  for (const d of candidates) {
    // Nur Trenner außerhalb von Anführungszeichen zählen.
    let count = 0;
    let quoted = false;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) count += 1;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** Zerlegt CSV/TSV-Text inklusive gequoteter Felder und Zeilenumbrüchen darin. */
export function parseDelimited(text: string, delimiter?: string): ParsedTable {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const firstLineEnd = clean.indexOf('\n');
  const d = delimiter ?? detectDelimiter(clean.slice(0, firstLineEnd < 0 ? undefined : firstLineEnd));

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === d) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const trimmed = rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ''));
  const [headers = [], ...body] = trimmed;
  return { headers, rows: body };
}

// ============================================================================
// Datei einlesen
// ============================================================================

/** Liest eine hochgeladene Datei als Tabelle — .xlsx oder Text. */
export async function parseFile(file: File): Promise<ParsedTable> {
  const buffer = await file.arrayBuffer();
  const head = new Uint8Array(buffer.slice(0, 2));
  // Ein ZIP beginnt mit "PK" — daran erkennen wir eine echte .xlsx-Datei,
  // unabhängig von der Endung.
  const isZip = head[0] === 0x50 && head[1] === 0x4b;

  if (isZip) {
    const rows = await readXlsx(buffer);
    const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
    const [headers = [], ...body] = nonEmpty;
    return { headers: headers.map((h) => h.trim()), rows: body };
  }

  if (/\.xls$/i.test(file.name)) {
    throw new Error(
      'Das alte .xls-Format wird nicht unterstützt. Bitte in Excel als .xlsx oder CSV speichern.',
    );
  }

  return parseDelimited(new TextDecoder().decode(buffer));
}

// ============================================================================
// Spalten-Zuordnung
// ============================================================================

export type ContactField =
  | 'customerName'
  | 'firstName'
  | 'lastName'
  | 'customerNumber'
  | 'phone'
  | 'email'
  | 'street'
  | 'zip'
  | 'city'
  | 'info';

export interface FieldDef {
  key: ContactField;
  label: string;
  /** Kleingeschriebene Kopfzeilen-Varianten, die automatisch erkannt werden */
  aliases: string[];
}

export const CONTACT_FIELDS: FieldDef[] = [
  {
    key: 'customerName',
    label: 'Name',
    aliases: ['name', 'kunde', 'kundenname', 'firma', 'nachname vorname', 'anschrift'],
  },
  { key: 'firstName', label: 'Vorname', aliases: ['vorname', 'first name', 'firstname'] },
  { key: 'lastName', label: 'Nachname', aliases: ['nachname', 'last name', 'lastname', 'familienname'] },
  {
    key: 'customerNumber',
    label: 'Kundennummer',
    aliases: ['kundennummer', 'kdnr', 'kd-nr', 'kd nr', 'kundennr', 'kunden-nr', 'kundennr.'],
  },
  {
    key: 'phone',
    label: 'Telefon',
    aliases: ['telefon', 'telefonnummer', 'tel', 'tel.', 'rufnummer', 'nummer', 'mobil', 'handy', 'phone'],
  },
  { key: 'email', label: 'E-Mail', aliases: ['email', 'e-mail', 'mail', 'e mail'] },
  { key: 'street', label: 'Straße', aliases: ['straße', 'strasse', 'str', 'str.', 'adresse', 'street'] },
  { key: 'zip', label: 'PLZ', aliases: ['plz', 'postleitzahl', 'zip'] },
  { key: 'city', label: 'Ort', aliases: ['ort', 'stadt', 'city', 'wohnort'] },
  {
    key: 'info',
    label: 'Info',
    aliases: ['info', 'hinweis', 'bemerkung', 'notiz', 'tarif', 'produkt', 'vertragsende', 'kommentar'],
  },
];

export type ColumnMapping = Partial<Record<ContactField, number>>;

const normalizeHeader = (h: string): string =>
  h
    .toLowerCase()
    .replace(/[_.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Ordnet Kopfzeilen automatisch den Feldern zu. Exakte Treffer gewinnen vor
 * Teiltreffern, damit „Telefon privat" nicht vor „Telefon" landet.
 */
export function autoMapColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  const normalized = headers.map(normalizeHeader);

  const claim = (field: ContactField, idx: number) => {
    if (mapping[field] !== undefined || used.has(idx)) return;
    mapping[field] = idx;
    used.add(idx);
  };

  for (const field of CONTACT_FIELDS) {
    const idx = normalized.findIndex((h) => h !== '' && field.aliases.includes(h));
    if (idx >= 0) claim(field.key, idx);
  }
  for (const field of CONTACT_FIELDS) {
    if (mapping[field.key] !== undefined) continue;
    const idx = normalized.findIndex(
      (h, i) => !used.has(i) && h !== '' && field.aliases.some((a) => h.includes(a)),
    );
    if (idx >= 0) claim(field.key, idx);
  }
  return mapping;
}

// ============================================================================
// Normalisierung & Dubletten
// ============================================================================

/**
 * Vereinheitlicht eine Telefonnummer für den Dubletten-Vergleich:
 * nur Ziffern, deutsche Ländervorwahl wird zur führenden 0.
 */
export function normalizePhone(raw: string): string {
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = '00' + digits.slice(1);
  digits = digits.replace(/\D/g, '');
  if (digits.startsWith('0049')) digits = '0' + digits.slice(4);
  else if (digits.startsWith('49') && digits.length > 10) digits = '0' + digits.slice(2);
  return digits;
}

/**
 * Schlüssel, über den dieselbe Zeile bei einem erneuten Import wiedererkannt
 * wird: Telefonnummer, sonst Kundennummer, sonst Name + PLZ.
 */
export function dedupeKeyFor(c: {
  phone?: string;
  customerNumber?: string;
  customerName: string;
  zip?: string;
}): string {
  const phone = c.phone ? normalizePhone(c.phone) : '';
  if (phone) return `tel:${phone}`;
  if (c.customerNumber?.trim()) return `kdnr:${c.customerNumber.trim().toLowerCase()}`;
  return `name:${c.customerName.trim().toLowerCase()}|${(c.zip ?? '').trim()}`;
}

// ============================================================================
// Zeilen → Kontakte
// ============================================================================

/** Ein importfertiger Kontakt, noch ohne Datenbank-Felder. */
export type ContactDraft = Pick<
  OutboundContact,
  | 'customerName'
  | 'customerNumber'
  | 'phone'
  | 'email'
  | 'street'
  | 'zip'
  | 'city'
  | 'info'
  | 'dedupeKey'
>;

export interface BuildResult {
  contacts: ContactDraft[];
  /** Zeilen ohne verwertbaren Namen */
  skipped: number;
  /** Zeilen, die eine frühere Zeile derselben Datei wiederholen */
  duplicatesInFile: number;
  /** Zeilen, die es in der Kampagne schon gibt */
  duplicatesExisting: number;
  /** Zeilen ohne Telefonnummer — anrufbar sind sie nicht */
  withoutPhone: number;
}

/**
 * Baut aus Tabelle und Spalten-Zuordnung die zu importierenden Kontakte.
 * Dubletten werden übersprungen, damit ein zweiter Import derselben Liste
 * nichts doppelt anlegt.
 */
export function buildContacts(
  table: ParsedTable,
  mapping: ColumnMapping,
  existingKeys: ReadonlySet<string> = new Set(),
): BuildResult {
  const contacts: ContactDraft[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let duplicatesInFile = 0;
  let duplicatesExisting = 0;
  let withoutPhone = 0;

  const cell = (row: string[], field: ContactField): string => {
    const idx = mapping[field];
    if (idx === undefined) return '';
    return (row[idx] ?? '').trim();
  };

  for (const row of table.rows) {
    const explicit = cell(row, 'customerName');
    const combined = [cell(row, 'firstName'), cell(row, 'lastName')]
      .filter(Boolean)
      .join(' ')
      .trim();
    const customerName = explicit || combined;
    if (!customerName) {
      skipped += 1;
      continue;
    }

    const draft: ContactDraft = {
      customerName,
      customerNumber: cell(row, 'customerNumber') || undefined,
      phone: cell(row, 'phone') || undefined,
      email: cell(row, 'email') || undefined,
      street: cell(row, 'street') || undefined,
      zip: cell(row, 'zip') || undefined,
      city: cell(row, 'city') || undefined,
      info: cell(row, 'info') || undefined,
      dedupeKey: '',
    };
    draft.dedupeKey = dedupeKeyFor(draft);

    if (seen.has(draft.dedupeKey)) {
      duplicatesInFile += 1;
      continue;
    }
    if (existingKeys.has(draft.dedupeKey)) {
      duplicatesExisting += 1;
      seen.add(draft.dedupeKey);
      continue;
    }
    if (!draft.phone) withoutPhone += 1;

    seen.add(draft.dedupeKey);
    contacts.push(draft);
  }

  return { contacts, skipped, duplicatesInFile, duplicatesExisting, withoutPhone };
}
