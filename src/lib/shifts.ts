import type { Call, Contract, Shift, ShiftType, StaffingTarget } from '../types';
// Schichtzeiten und Schichtart-Metadaten leben in der Extension (gleiches
// Muster wie commission.js, siehe src/lib/utils.ts) — einzige Quelle für CRM
// und Cockpit. Reiner Seiteneffekt-Import, weil dieselbe Datei auch als
// klassisches Content-Script ohne `export`-Syntax laufen muss.
import '../../extension/src/shift-time.js';

/**
 * Alles, was der Schichtplan fachlich weiß, an genau einer Stelle: wann eine
 * Schicht läuft, was eine Schichtart bedeutet, wann ein Tag gedeckt ist und was
 * in einer Schicht herausgekommen ist.
 *
 * Warum zentral und nicht in Schedule.tsx: Die Schicht ist inzwischen keine
 * Seite mehr, sondern der gemeinsame Kontext der ganzen Anwendung — Dashboard,
 * Auswertung, HUD und die Extension leiten daraus ab, was gerade gilt. Läge die
 * Definition in der Seite, müsste jede dieser Stellen sie nachbauen; genau so
 * entstehen Anzeigen, die sich widersprechen.
 *
 * Zeiten und Farben sind hier Konstanten statt Datenbankwerte: sie ändern sich
 * betrieblich sehr selten, aber sehr sichtbar. Eine Konstante an einer Stelle
 * ist dafür ehrlicher als eine Einstellung, die niemand pflegt.
 */

// ── Schichtzeiten ───────────────────────────────────────────────────────────
// Früh und Spät überlappen sich hier fast vollständig (versetzter Start, kein
// klassisches Zweischicht-Modell). Deshalb ist die reine Kopfzahl je Schichtart
// als Besetzungsmaß wenig aussagekräftig — die interessanten Lücken liegen an
// den Rändern, und dafür gibt es coverageTimeline() weiter unten.

/** Minuten seit Mitternacht — die Rechengrundlage für alles Zeitliche hier. */
export interface TimeRange {
  startMin: number;
  endMin: number;
}

interface ShiftTimeShared {
  SHIFT_TIMES: Partial<Record<ShiftType, TimeRange>>;
  SHIFT_META: Record<ShiftType, ShiftMeta>;
  SHIFT_ORDER: ShiftType[];
  shiftMeta: (t: ShiftType | null | undefined) => ShiftMeta;
  isWorking: (t: ShiftType | null | undefined) => boolean;
  formatMinutes: (min: number) => string;
  shiftTimeLabel: (t: ShiftType) => string | null;
  shiftProgress: (t: ShiftType, nowMin: number) => ShiftProgress | null;
  formatDuration: (minutes: number) => string;
  minutesOfDay: (d?: Date) => number;
}

const shared = (
  globalThis as unknown as { StadtnetzCRM: { shiftTime: ShiftTimeShared } }
).StadtnetzCRM.shiftTime;

export const SHIFT_TIMES = shared.SHIFT_TIMES;

/** 465 → "07:45" */
export const formatMinutes = shared.formatMinutes;

/** "07:45 – 16:15", oder null bei Schichtarten ohne Zeitfenster. */
export const shiftTimeLabel = shared.shiftTimeLabel;

// ── Schichtarten ────────────────────────────────────────────────────────────

export interface ShiftMeta {
  label: string;
  /** Kurzform für enge Zellen (Monatsansicht, Handy). */
  short: string;
  /** true = zählt als Arbeitstag und in die Besetzung. */
  working: boolean;
  /** true = Abwesenheit mit Grund (Urlaub/Krank/Schulung), nicht bloß „frei". */
  absence: boolean;
  /** CSS-Klassensuffix — die Farben liegen in index.css, nicht hier. */
  tone: string;
}

export const SHIFT_META = shared.SHIFT_META;

/** Reihenfolge für Werkzeugleiste und Legende — Arbeit zuerst, dann Ausfälle. */
export const SHIFT_ORDER = shared.SHIFT_ORDER;

/**
 * Unbekannte Schichtart aus der Datenbank fällt nicht auf die Nase, sondern auf
 * „frei" zurück (gleiches Toleranzmuster wie notificationLook()): ein alter
 * Client soll an einer neu eingeführten Art nicht zerbrechen.
 */
export const shiftMeta = shared.shiftMeta;

export const isWorking = shared.isWorking;

// ── Laufende Schicht ────────────────────────────────────────────────────────

export interface ShiftProgress {
  /** Vor Beginn, während, oder nach Ende der Schicht. */
  phase: 'before' | 'running' | 'after';
  /** Anteil 0…1 — nur während der Schicht aussagekräftig. */
  progress: number;
  /** Minuten bis zum Beginn (phase 'before') bzw. bis zum Ende (phase 'running'). */
  minutesLeft: number;
}

/**
 * Wo im Schichtfenster steht der Tag gerade? Grundlage für „noch 2:15" im HUD
 * und auf dem Dashboard.
 *
 * `nowMin` wird übergeben statt intern aus `new Date()` gelesen, damit die
 * Funktion rein und ohne Zeitmanipulation testbar bleibt.
 */
export const shiftProgress = shared.shiftProgress;

/** 135 → "2:15 Std."; unter einer Stunde nur Minuten. */
export const formatDuration = shared.formatDuration;

/** Minuten seit Mitternacht für ein Date — Gegenstück zu `nowMin` oben. */
export const minutesOfDay = shared.minutesOfDay;

// ── Besetzung ───────────────────────────────────────────────────────────────

export interface CoverageBand {
  /** Zeitpunkt in Minuten, ab dem `count` Personen anwesend sind. */
  startMin: number;
  endMin: number;
  count: number;
}

export interface DayCoverage {
  frueh: number;
  spaet: number;
  /** Anwesende insgesamt (Früh + Spät). */
  working: number;
  /** Wie viele fehlen — je Schichtart, gegen die Soll-Besetzung. */
  missingFrueh: number;
  missingSpaet: number;
  /** true, sobald irgendein Sollwert unterschritten ist. */
  understaffed: boolean;
  /** Abwesenheiten des Tages, aufgeschlüsselt (für den Tooltip). */
  absences: Partial<Record<ShiftType, number>>;
  /**
   * Belegung über den Tag als Stufen — die ehrliche Antwort auf „ist der Tag
   * besetzt?", wenn sich die Schichten überlappen. Nur Zeiträume mit
   * mindestens einer anwesenden Person; leere Ränder fallen weg.
   */
  bands: CoverageBand[];
}

/** Frühester Beginn / spätestes Ende über alle Schichtarten — der Tagesrahmen. */
export const DAY_WINDOW: TimeRange = (() => {
  const ranges = Object.values(SHIFT_TIMES).filter(Boolean) as TimeRange[];
  return {
    startMin: Math.min(...ranges.map((r) => r.startMin)),
    endMin: Math.max(...ranges.map((r) => r.endMin)),
  };
})();

/**
 * Besetzung eines Tages aus den Schichten dieses Tages.
 *
 * Die Stufen (`bands`) entstehen, indem alle Schichtgrenzen als Schnittpunkte
 * genommen und die Anwesenden je Abschnitt gezählt werden — unabhängig davon,
 * wie viele Schichtarten es gibt und wie sie sich überlappen.
 */
export function dayCoverage(shiftsOfDay: Shift[], target?: StaffingTarget | null): DayCoverage {
  const counts: Partial<Record<ShiftType, number>> = {};
  for (const s of shiftsOfDay) {
    counts[s.shiftType] = (counts[s.shiftType] ?? 0) + 1;
  }
  const frueh = counts.frueh ?? 0;
  const spaet = counts.spaet ?? 0;

  const absences: Partial<Record<ShiftType, number>> = {};
  for (const t of SHIFT_ORDER) {
    if (SHIFT_META[t].absence && counts[t]) absences[t] = counts[t];
  }

  // Schnittpunkte = alle vorkommenden Start- und Endzeiten, sortiert.
  const edges = new Set<number>();
  for (const s of shiftsOfDay) {
    const r = SHIFT_TIMES[s.shiftType];
    if (r) {
      edges.add(r.startMin);
      edges.add(r.endMin);
    }
  }
  const points = Array.from(edges).sort((a, b) => a - b);
  const bands: CoverageBand[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const startMin = points[i];
    const endMin = points[i + 1];
    const count = shiftsOfDay.filter((s) => {
      const r = SHIFT_TIMES[s.shiftType];
      return r && r.startMin <= startMin && r.endMin >= endMin;
    }).length;
    if (count > 0) {
      // Gleich hohe Nachbarabschnitte zusammenfassen — sonst zerfällt ein
      // durchgehend gleich besetzter Block optisch in Einzelstücke.
      const prev = bands[bands.length - 1];
      if (prev && prev.count === count && prev.endMin === startMin) prev.endMin = endMin;
      else bands.push({ startMin, endMin, count });
    }
  }

  const missingFrueh = Math.max(0, (target?.minFrueh ?? 0) - frueh);
  const missingSpaet = Math.max(0, (target?.minSpaet ?? 0) - spaet);

  return {
    frueh,
    spaet,
    working: frueh + spaet,
    missingFrueh,
    missingSpaet,
    understaffed: missingFrueh > 0 || missingSpaet > 0,
    absences,
    bands,
  };
}

/** ISO-Wochentag 1 = Montag … 7 = Sonntag (passend zu staffing_targets.weekday). */
export const isoWeekday = (d: Date): number => d.getDay() || 7;

// ── Achse Schicht → Ergebnis ────────────────────────────────────────────────
// Der Plan weiß, wer wann gearbeitet hat; calls und contracts wissen, was dabei
// herauskam. Verbunden wird über (Agent, Kalendertag) — ein eigenes Feld
// braucht es dafür nicht, und ein nachträglich in `calls` gespiegelter
// Schichtbezug würde bei jeder Planänderung schief stehen.

export interface ShiftOutcome {
  calls: number;
  /** Gesprächsminuten in dieser Schicht. */
  talkMinutes: number;
  contracts: number;
  commission: number;
}

const EMPTY_OUTCOME: ShiftOutcome = { calls: 0, talkMinutes: 0, contracts: 0, commission: 0 };

/** Lokaler Tagesschlüssel eines Zeitstempels — calls speichern timestamptz. */
const dateKeyOf = (iso: string): string => {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

/**
 * Was ist in einer Schicht herausgekommen?
 *
 * `commissionOf` wird hereingereicht statt hier gerechnet: die Provisionslogik
 * hängt an den persönlichen Sätzen des Nutzers (siehe calcContractCommission)
 * und gehört nicht in ein Schicht-Modul.
 */
export function shiftOutcome(
  shift: Pick<Shift, 'userId' | 'shiftDate'>,
  calls: Call[],
  contracts: Contract[],
  commissionOf: (c: Contract) => number,
): ShiftOutcome {
  const ownCalls = calls.filter(
    (c) => c.agentId === shift.userId && dateKeyOf(c.startedAt) === shift.shiftDate,
  );
  // Verträge hängen am erfassenden Nutzer (createdBy), nicht an einem
  // agent_id-Feld. Stornierte zählen wie überall sonst nicht als Abschluss
  // (siehe incentives.ts / teamStats.ts).
  const ownContracts = contracts.filter(
    (c) =>
      c.createdBy === shift.userId &&
      c.contractDate === shift.shiftDate &&
      c.status !== 'storniert',
  );
  return {
    calls: ownCalls.length,
    talkMinutes: Math.round(ownCalls.reduce((sum, c) => sum + (c.durationS ?? 0), 0) / 60),
    contracts: ownContracts.length,
    commission: ownContracts.reduce((sum, c) => sum + commissionOf(c), 0),
  };
}

/**
 * Ergebnisse für viele Schichten in einem Durchgang, als Map `userId|dateKey`.
 * Bei 10 Personen × 7 Tagen wäre die Einzelvariante 70 volle Durchläufe über
 * alle Calls — das ist in der Wochenansicht spürbar.
 */
export function outcomeIndex(
  calls: Call[],
  contracts: Contract[],
  commissionOf: (c: Contract) => number,
): Map<string, ShiftOutcome> {
  const map = new Map<string, ShiftOutcome>();
  const bump = (key: string): ShiftOutcome => {
    let entry = map.get(key);
    if (!entry) {
      entry = { ...EMPTY_OUTCOME };
      map.set(key, entry);
    }
    return entry;
  };

  for (const c of calls) {
    const entry = bump(`${c.agentId}|${dateKeyOf(c.startedAt)}`);
    entry.calls += 1;
    entry.talkMinutes += (c.durationS ?? 0) / 60;
  }
  for (const c of contracts) {
    if (c.status === 'storniert' || !c.createdBy) continue;
    const entry = bump(`${c.createdBy}|${c.contractDate}`);
    entry.contracts += 1;
    entry.commission += commissionOf(c);
  }
  // Gesprächsminuten erst am Ende runden — sonst summieren sich Rundungsfehler
  // über viele kurze Anrufe zu einer sichtbar falschen Zahl.
  for (const entry of map.values()) entry.talkMinutes = Math.round(entry.talkMinutes);
  return map;
}

export const outcomeKey = (userId: string, dateKey: string): string => `${userId}|${dateKey}`;

export const emptyOutcome = (): ShiftOutcome => ({ ...EMPTY_OUTCOME });
