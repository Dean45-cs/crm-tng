import type { StatusLogEntry, UserStatus } from '../types';

// ============================================================================
// Status-Katalog
// ============================================================================
// Reine Daten & Logik rund ums Status-Board — bewusst React-frei, damit die
// Aggregation (KPIs, PowerBI-Export) isoliert testbar bleibt. Die Icon-Zuordnung
// liegt in der StatusBar-Komponente.

export interface StatusDef {
  id: string;
  label: string;
  /** Akzentfarbe (Hex) — funktioniert in Light & Dark. */
  color: string;
  /** Verlangt eine kurze Freitext-Beschreibung. */
  needsDesc: boolean;
  /** Setzt beim Wählen automatisch AFK (z. B. „Kunde am Empfang"). */
  autoAfk?: boolean;
}

export const STATUS_DEFS: StatusDef[] = [
  { id: 'ticketschicht', label: 'Ticketschicht', color: '#4A90D9', needsDesc: false },
  { id: 'hotline', label: 'Hotline', color: '#34C77B', needsDesc: false },
  { id: 'sonderaufgabe', label: 'Sonderaufgabe', color: '#F5A623', needsDesc: true },
  { id: 'meeting', label: 'Meeting', color: '#A78BFA', needsDesc: false },
  { id: 'termin', label: 'Termin', color: '#F472B6', needsDesc: false },
  { id: 'sonstige', label: 'Sonstige', color: '#94A3B8', needsDesc: true },
  { id: 'klaerung', label: 'Klärung Sonderfall', color: '#F87171', needsDesc: true },
  { id: 'empfang', label: 'Kunde am Empfang', color: '#2DD4BF', needsDesc: false, autoAfk: true },
];

/** Tätigkeitsbereiche der Ticketschicht (Sub-Toggle). */
export const TICKET_SUBS = [
  'Leads',
  'Churn',
  'Baustatus',
  'RatingPeak',
  'AM',
  'TL',
  'Eingang',
  'Bauverweigerer',
];

/** Farbe für den AFK-Zustand (überlagert den Status). */
export const AFK_COLOR = '#F5A623';

const STATUS_BY_ID = new Map(STATUS_DEFS.map((s) => [s.id, s]));

export const statusDef = (id?: string | null): StatusDef | undefined =>
  id ? STATUS_BY_ID.get(id) : undefined;

export const statusLabel = (id?: string | null): string =>
  statusDef(id)?.label ?? (id ?? '—');

export const statusColor = (id?: string | null): string =>
  statusDef(id)?.color ?? '#94A3B8';

// ============================================================================
// Formatierung
// ============================================================================

/** Menschlich lesbare Dauer aus Sekunden, z. B. „2h 05m" oder „12m". */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '—';
  const totalMin = Math.floor(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m`;
  return '< 1m';
}

/** Uhrzeit (HH:MM) eines ISO-Zeitstempels. */
export function formatClock(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// ============================================================================
// Zeit-Aggregation
// ============================================================================

/** Sekunden im Schnitt [from, to] eines Intervalls [start, end]. */
function clippedSeconds(start: number, end: number, from: number, to: number): number {
  const s = Math.max(start, from);
  const e = Math.min(end, to);
  return e > s ? Math.round((e - s) / 1000) : 0;
}

/**
 * Summiert die je Status verbrachte Zeit im Fenster [from, to]. Berücksichtigt
 * abgeschlossene Log-Abschnitte UND laufende Status (deren offenes Intervall bis
 * `to` — i. d. R. „jetzt" — mitgezählt wird), damit das Bild live stimmt.
 */
export function aggregateStatusSeconds(
  logs: Pick<StatusLogEntry, 'status' | 'startedAt' | 'endedAt'>[],
  open: { status: string; startedAt?: string }[],
  from: Date,
  to: Date,
): Map<string, number> {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const out = new Map<string, number>();
  const add = (status: string, secs: number) => {
    if (secs <= 0) return;
    out.set(status, (out.get(status) ?? 0) + secs);
  };

  for (const l of logs) {
    const secs = clippedSeconds(
      new Date(l.startedAt).getTime(),
      new Date(l.endedAt).getTime(),
      fromMs,
      toMs,
    );
    add(l.status, secs);
  }
  for (const o of open) {
    if (!o.startedAt) continue;
    const secs = clippedSeconds(new Date(o.startedAt).getTime(), toMs, fromMs, toMs);
    add(o.status, secs);
  }
  return out;
}

export interface StatusShare {
  id: string;
  label: string;
  color: string;
  seconds: number;
  /** Anteil an der Gesamtzeit (0..1). */
  share: number;
}

export interface StatusInsights {
  /** Zeit je Status im Fenster, absteigend sortiert. */
  perStatus: StatusShare[];
  totalSeconds: number;
  /** Nutzer:innen mit Status, nicht AFK. */
  onlineCount: number;
  /** Nutzer:innen mit Status, aktuell AFK. */
  afkCount: number;
  /** Nutzer:innen mit irgendeinem gesetzten Status. */
  activeCount: number;
}

/**
 * Baut die Chef-KPIs: Zeitverteilung je Status im Fenster plus die aktuelle
 * Presence-Verteilung (online / AFK / aktiv) aus den Live-Status.
 */
export function computeStatusInsights(
  logs: Pick<StatusLogEntry, 'status' | 'startedAt' | 'endedAt'>[],
  statuses: UserStatus[],
  from: Date,
  to: Date = new Date(),
): StatusInsights {
  const open = statuses
    .filter((s) => s.status)
    .map((s) => ({ status: s.status as string, startedAt: s.startedAt }));

  const byStatus = aggregateStatusSeconds(logs, open, from, to);
  const totalSeconds = Array.from(byStatus.values()).reduce((a, b) => a + b, 0);

  const perStatus: StatusShare[] = Array.from(byStatus.entries())
    .map(([id, seconds]) => ({
      id,
      label: statusLabel(id),
      color: statusColor(id),
      seconds,
      share: totalSeconds > 0 ? seconds / totalSeconds : 0,
    }))
    .sort((a, b) => b.seconds - a.seconds);

  const withStatus = statuses.filter((s) => s.status);
  const afkCount = withStatus.filter((s) => s.isAfk).length;

  return {
    perStatus,
    totalSeconds,
    onlineCount: withStatus.length - afkCount,
    afkCount,
    activeCount: withStatus.length,
  };
}

// ============================================================================
// PowerBI-Export
// ============================================================================

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Wandelt die Status-Historie in eine flache, PowerBI-freundliche Tabelle:
 * ISO-Zeitstempel (als Datum/Zeit interpretierbar), ganzzahlige Dauer (keine
 * Dezimal-/Locale-Fallen) sowie vorgerechnete Slicer-Spalten (Datum, Wochentag,
 * KW, Stunde). Eine Zeile je abgeschlossenem Status-Abschnitt.
 */
export function buildPowerBiRows(
  logs: StatusLogEntry[],
  userName: (id?: string) => string,
): Record<string, string | number>[] {
  return [...logs]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((l) => {
      const start = new Date(l.startedAt);
      return {
        MitarbeiterId: l.userId ?? '',
        Mitarbeiter: userName(l.userId),
        StatusId: l.status,
        Status: statusLabel(l.status),
        Untertyp: l.sub ?? '',
        Beschreibung: l.description ?? '',
        AFK: l.isAfk ? 'Ja' : 'Nein',
        Beginn: l.startedAt,
        Ende: l.endedAt,
        Datum: l.startedAt.slice(0, 10),
        Wochentag: WEEKDAYS[start.getDay()],
        KW: isoWeek(start),
        Stunde: start.getHours(),
        DauerMinuten: Math.round(l.durationSeconds / 60),
        DauerSekunden: l.durationSeconds,
      };
    });
}
