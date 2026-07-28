import { isoWeekNumber } from './utils';

/**
 * Zeitraum-Logik der Berichte: Vorlagen (dieser Monat, letztes Quartal, …),
 * freie Von-Bis-Auswahl, die passende Vergleichs-Vorperiode und die Buckets
 * für die Verlaufs-Charts.
 *
 * Bewusst ohne date-fns und ohne UTC: die App rechnet durchgängig in *lokaler*
 * Zeit mit `YYYY-MM-DD`-Schlüsseln — Verträge und Tarifwechsel speichern reine
 * Datumsstrings, kein Instant. Genau diese Schlüssel gehen hier rein und raus.
 * Erst an der Supabase-Grenze wird in ISO-Instants übersetzt (`dayStartIso` /
 * `dayEndIso`), denn `calls.started_at` ist ein Zeitstempel.
 *
 * Fallstrick, gegen den hier bewusst gebaut wird: `new Date('2026-07-01')`
 * parst als UTC-Mitternacht und liegt östlich von Greenwich einen Tag daneben.
 * Deshalb überall `fromDateKey()` statt `new Date(string)`.
 */

export type RangePreset =
  | 'thisMonth'
  | 'lastMonth'
  | 'last7'
  | 'last30'
  | 'thisQuarter'
  | 'lastQuarter'
  | 'thisYear'
  | 'custom';

export const RANGE_PRESET_LABEL: Record<RangePreset, string> = {
  thisMonth: 'Dieser Monat',
  lastMonth: 'Letzter Monat',
  last7: 'Letzte 7 Tage',
  last30: 'Letzte 30 Tage',
  thisQuarter: 'Dieses Quartal',
  lastQuarter: 'Letztes Quartal',
  thisYear: 'Dieses Jahr',
  custom: 'Freier Zeitraum',
};

/** Reihenfolge für die Auswahl im UI. */
export const RANGE_PRESETS: RangePreset[] = [
  'thisMonth',
  'lastMonth',
  'last7',
  'last30',
  'thisQuarter',
  'lastQuarter',
  'thisYear',
  'custom',
];

export interface DateRange {
  /** Erster Tag, inklusiv (YYYY-MM-DD, lokal). */
  from: string;
  /** Letzter Tag, inklusiv (YYYY-MM-DD, lokal). */
  to: string;
  /** Menschenlesbare Beschriftung für Berichtskopf und Dateinamen. */
  label: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Date → lokaler Tagesschlüssel `YYYY-MM-DD`. */
export const dateKey = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** `YYYY-MM-DD` → lokales Date (Mitternacht). Ersatz für `new Date(string)`. */
export const fromDateKey = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

/** Lokaler Tagesschlüssel eines ISO-Zeitstempels (Anrufe kommen als Instant). */
export const isoToDateKey = (iso: string): string => dateKey(new Date(iso));

/** Beginn des Tages als ISO-Instant — untere Grenze für Supabase-Abfragen. */
export const dayStartIso = (key: string): string => {
  const d = fromDateKey(key);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

/** Ende des Tages als ISO-Instant — obere Grenze für Supabase-Abfragen. */
export const dayEndIso = (key: string): string => {
  const d = fromDateKey(key);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
};

const addDays = (key: string, days: number): string => {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + days);
  return dateKey(d);
};

/** Anzahl Tage im Zeitraum, beide Enden inklusiv. */
export const rangeLengthDays = (range: DateRange): number => {
  const from = fromDateKey(range.from).getTime();
  const to = fromDateKey(range.to).getTime();
  return Math.round((to - from) / 86_400_000) + 1;
};

/** Liegt ein Tagesschlüssel im Zeitraum? Reiner Stringvergleich reicht bei ISO-Datum. */
export const inRange = (key: string, range: DateRange): boolean =>
  key >= range.from && key <= range.to;

const firstOfMonth = (y: number, m: number): string => dateKey(new Date(y, m, 1));
/** Tag 0 des Folgemonats = letzter Tag des gesuchten Monats. */
const lastOfMonth = (y: number, m: number): string => dateKey(new Date(y, m + 1, 0));

const monthTitle = (y: number, m: number): string =>
  new Date(y, m, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

const dayTitle = (key: string): string => fromDateKey(key).toLocaleDateString('de-DE');

/** Beschriftung aus den Grenzen ableiten: volle Kalendereinheiten bekommen ihren Namen. */
function labelFor(from: string, to: string): string {
  const a = fromDateKey(from);
  const b = fromDateKey(to);
  const sameYear = a.getFullYear() === b.getFullYear();

  if (sameYear && from === firstOfMonth(a.getFullYear(), 0) && to === lastOfMonth(a.getFullYear(), 11)) {
    return `Jahr ${a.getFullYear()}`;
  }
  if (
    sameYear &&
    a.getMonth() === b.getMonth() &&
    from === firstOfMonth(a.getFullYear(), a.getMonth()) &&
    to === lastOfMonth(a.getFullYear(), a.getMonth())
  ) {
    return monthTitle(a.getFullYear(), a.getMonth());
  }
  const qa = Math.floor(a.getMonth() / 3);
  const qb = Math.floor(b.getMonth() / 3);
  if (
    sameYear &&
    qa === qb &&
    from === firstOfMonth(a.getFullYear(), qa * 3) &&
    to === lastOfMonth(a.getFullYear(), qa * 3 + 2)
  ) {
    return `Q${qa + 1} ${a.getFullYear()}`;
  }
  return `${dayTitle(from)} – ${dayTitle(to)}`;
}

const makeRange = (from: string, to: string): DateRange => ({
  from,
  to,
  label: labelFor(from, to),
});

/**
 * Löst eine Vorlage gegen ein Referenzdatum auf. Bei `custom` gewinnen die
 * übergebenen Grenzen; vertauschte Eingaben werden getauscht statt abgelehnt,
 * damit ein Tippfehler im Datumsfeld keinen leeren Bericht erzeugt.
 */
export function resolveRange(
  preset: RangePreset,
  custom?: { from?: string; to?: string },
  ref: Date = new Date(),
): DateRange {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const todayKey = dateKey(ref);

  switch (preset) {
    case 'thisMonth':
      return makeRange(firstOfMonth(y, m), lastOfMonth(y, m));
    case 'lastMonth':
      return makeRange(firstOfMonth(y, m - 1), lastOfMonth(y, m - 1));
    case 'last7':
      return makeRange(addDays(todayKey, -6), todayKey);
    case 'last30':
      return makeRange(addDays(todayKey, -29), todayKey);
    case 'thisQuarter': {
      const q = Math.floor(m / 3);
      return makeRange(firstOfMonth(y, q * 3), lastOfMonth(y, q * 3 + 2));
    }
    case 'lastQuarter': {
      const q = Math.floor(m / 3) - 1;
      return makeRange(firstOfMonth(y, q * 3), lastOfMonth(y, q * 3 + 2));
    }
    case 'thisYear':
      return makeRange(firstOfMonth(y, 0), lastOfMonth(y, 11));
    case 'custom': {
      const from = custom?.from;
      const to = custom?.to;
      if (!from || !to) return resolveRange('thisMonth', undefined, ref);
      return from <= to ? makeRange(from, to) : makeRange(to, from);
    }
  }
}

/**
 * Vergleichszeitraum. Volle Kalendereinheiten bekommen die *vorherige*
 * Kalendereinheit (Juli → Juni, Q3 → Q2, 2026 → 2025) — ein „30 Tage
 * davor"-Fenster wäre dort irreführend, weil Monate unterschiedlich lang
 * sind. Alles andere bekommt ein gleich langes Fenster, das direkt vor
 * `from` endet.
 */
export function previousRange(range: DateRange): DateRange {
  const a = fromDateKey(range.from);
  const y = a.getFullYear();
  const m = a.getMonth();

  const isFullMonth =
    range.from === firstOfMonth(y, m) && range.to === lastOfMonth(y, m);
  if (isFullMonth) return makeRange(firstOfMonth(y, m - 1), lastOfMonth(y, m - 1));

  const q = Math.floor(m / 3);
  const isFullQuarter =
    range.from === firstOfMonth(y, q * 3) && range.to === lastOfMonth(y, q * 3 + 2);
  if (isFullQuarter) {
    return makeRange(firstOfMonth(y, (q - 1) * 3), lastOfMonth(y, (q - 1) * 3 + 2));
  }

  const isFullYear = range.from === firstOfMonth(y, 0) && range.to === lastOfMonth(y, 11);
  if (isFullYear) return makeRange(firstOfMonth(y - 1, 0), lastOfMonth(y - 1, 11));

  const len = rangeLengthDays(range);
  const to = addDays(range.from, -1);
  return makeRange(addDays(to, -(len - 1)), to);
}

// ── Buckets für den Verlaufs-Chart ──────────────────────────────────────────

export type BucketSize = 'day' | 'week' | 'month';

export interface RangeBucket {
  /** Stabiler Schlüssel; passt zu `bucketKeyOf()`. */
  key: string;
  /** Achsenbeschriftung. */
  label: string;
  from: string;
  to: string;
}

/**
 * Auflösung nach Zeitraumlänge: bis 31 Tage täglich, bis ~4 Monate wöchentlich,
 * darüber monatlich. Hält die Achse unter ~30 Punkten, sonst wird der Chart
 * unlesbar.
 */
export function bucketSizeFor(range: DateRange): BucketSize {
  const days = rangeLengthDays(range);
  if (days <= 31) return 'day';
  if (days <= 120) return 'week';
  return 'month';
}

/** Montag der Woche, in der `key` liegt (ISO-Woche, Mo = Wochenstart). */
const mondayOf = (key: string): string => {
  const d = fromDateKey(key);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dateKey(d);
};

/** Ordnet einen Tagesschlüssel dem Bucket zu, in den er fällt. */
export function bucketKeyOf(key: string, size: BucketSize): string {
  if (size === 'day') return key;
  if (size === 'week') return mondayOf(key);
  return key.slice(0, 7);
}

/**
 * Alle Buckets des Zeitraums, lückenlos und aufsteigend — auch leere, damit
 * der Chart keine Tage überspringt und Lücken als das sichtbar werden, was sie
 * sind (kein Umsatz), statt weggekürzt zu werden.
 */
export function bucketsOf(range: DateRange): RangeBucket[] {
  const size = bucketSizeFor(range);
  const buckets: RangeBucket[] = [];

  if (size === 'month') {
    const start = fromDateKey(range.from);
    const end = fromDateKey(range.to);
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      const y = cursor.getFullYear();
      const m = cursor.getMonth();
      const from = firstOfMonth(y, m);
      const to = lastOfMonth(y, m);
      buckets.push({
        key: `${y}-${pad(m + 1)}`,
        label: cursor.toLocaleDateString('de-DE', { month: 'short' }),
        from: from < range.from ? range.from : from,
        to: to > range.to ? range.to : to,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return buckets;
  }

  if (size === 'week') {
    let cursor = mondayOf(range.from);
    while (cursor <= range.to) {
      const end = addDays(cursor, 6);
      buckets.push({
        key: cursor,
        label: `KW ${isoWeekNumber(fromDateKey(cursor))}`,
        from: cursor < range.from ? range.from : cursor,
        to: end > range.to ? range.to : end,
      });
      cursor = addDays(cursor, 7);
    }
    return buckets;
  }

  let cursor = range.from;
  while (cursor <= range.to) {
    const d = fromDateKey(cursor);
    buckets.push({
      key: cursor,
      label: `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`,
      from: cursor,
      to: cursor,
    });
    cursor = addDays(cursor, 1);
  }
  return buckets;
}

/** Dateinamens-Baustein für Exporte: `2026-07-01_bis_2026-07-31`. */
export const rangeFileStamp = (range: DateRange): string => `${range.from}_bis_${range.to}`;

/**
 * Monatsziel auf einen beliebigen Zeitraum umgelegt: je berührtem Kalender-
 * monat der Anteil der enthaltenen Tage. Für einen vollen Monat kommt exakt
 * das Monatsziel heraus, für ein Quartal das Dreifache, für „letzte 7 Tage"
 * rund ein Viertel.
 *
 * Nötig, weil `users.monthly_target` ein reiner Monatswert ist — ohne
 * Umlegung würde eine Quartalsauswertung eine Zielerreichung von 300 %
 * ausweisen und ein 7-Tage-Bericht 25 %, beides ohne Aussage.
 */
export function proratedTarget(monthlyTarget: number, range: DateRange): number {
  if (monthlyTarget <= 0) return 0;
  let total = 0;
  const end = fromDateKey(range.to);
  const cursor = fromDateKey(range.from);
  cursor.setDate(1);

  while (cursor <= end) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const mFrom = firstOfMonth(y, m);
    const mTo = lastOfMonth(y, m);
    const overlapFrom = mFrom < range.from ? range.from : mFrom;
    const overlapTo = mTo > range.to ? range.to : mTo;
    if (overlapFrom <= overlapTo) {
      const daysInMonth = fromDateKey(mTo).getDate();
      const overlapDays = rangeLengthDays({ from: overlapFrom, to: overlapTo, label: '' });
      total += (monthlyTarget * overlapDays) / daysInMonth;
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return Math.round(total * 100) / 100;
}
