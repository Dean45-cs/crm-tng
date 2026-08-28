import type {
  Campaign,
  CallDisposition,
  CallOutcome,
  OutboundContact,
  OutboundContactStatus,
} from '../types';
import { parseLocalDate, today } from './utils';

// ============================================================================
// Beschriftungen
// ============================================================================

export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  termin: 'Termin vereinbart',
  abschluss: 'Abschluss',
  wiedervorlage: 'Wiedervorlage',
  nichtErreicht: 'Nicht erreicht',
  keinInteresse: 'Kein Interesse',
  falscheDaten: 'Falsche Daten',
  sperren: 'Nicht mehr anrufen',
};

export const CONTACT_STATUS_LABEL: Record<OutboundContactStatus, string> = {
  offen: 'Offen',
  ...OUTCOME_LABEL,
};

/**
 * Reihenfolge der Ergebnis-Buttons im Fokusmodus — die häufigsten und
 * wertvollsten zuerst, die endgültigen zuletzt.
 */
export const OUTCOME_ORDER: CallOutcome[] = [
  'termin',
  'abschluss',
  'wiedervorlage',
  'nichtErreicht',
  'keinInteresse',
  'falscheDaten',
  'sperren',
];

/**
 * Ergebnisse, nach denen der Kontakt erledigt ist und nicht wieder in der
 * Arbeitsliste auftaucht. `nichtErreicht` gehört bewusst NICHT dazu — dort
 * entscheidet die Zahl der Versuche (siehe `isWorkable`).
 */
const CLOSED_STATUS: ReadonlySet<OutboundContactStatus> = new Set<OutboundContactStatus>([
  'abschluss',
  'keinInteresse',
  'falscheDaten',
  'sperren',
]);

/** Ist der Kontakt abgeschlossen (kein weiterer Anruf mehr vorgesehen)? */
export const isClosed = (c: OutboundContact): boolean => CLOSED_STATUS.has(c.status);

/** Ergebnisse, die eine Wiedervorlage brauchen, um sinnvoll zu sein. */
export const needsFollowUp = (outcome: CallOutcome): boolean =>
  outcome === 'wiedervorlage' || outcome === 'termin';

/**
 * Übersetzt ein Outbound-Ergebnis in die `disposition` der gemeinsamen
 * calls-Tabelle. Zwei Ausgänge teilen sich einen vorhandenen Wert, damit
 * Auswertungen nicht zwischen Inbound und Outbound auseinanderlaufen:
 * die Wiedervorlage ist ein Rückruf, die Absage ist „kein Interesse".
 */
export const OUTCOME_TO_DISPOSITION: Record<CallOutcome, CallDisposition> = {
  wiedervorlage: 'rueckruf',
  keinInteresse: 'kein-interesse',
  termin: 'termin',
  abschluss: 'abschluss',
  nichtErreicht: 'nicht-erreicht',
  falscheDaten: 'falsche-daten',
  sperren: 'sperren',
};

// ============================================================================
// Arbeitsvorrat
// ============================================================================

/**
 * Kann dieser Kontakt (heute) noch angerufen werden?
 *
 * Nicht mehr abzuarbeiten sind: abgeschlossene Kontakte, Kontakte mit
 * ausgereizten Versuchen und solche, deren Wiedervorlage in der Zukunft liegt.
 * Ein vereinbarter Termin bleibt bis zum Termintag außen vor, taucht dann aber
 * wieder auf, damit er nicht vergessen wird.
 */
export function isWorkable(
  contact: OutboundContact,
  campaign: Campaign,
  ref: string = today(),
): boolean {
  if (isClosed(contact)) return false;
  if (contact.attempts >= campaign.maxAttempts && contact.status === 'nichtErreicht') {
    return false;
  }
  if (contact.followUpDate && contact.followUpDate > ref) return false;
  return true;
}

/**
 * Ist der Kontakt für diese Person bestimmt? Nicht zugewiesene Kontakte sind
 * freier Pool und damit für alle offen.
 */
export const isMine = (contact: OutboundContact, userKey?: string | null): boolean =>
  !contact.assignedTo || contact.assignedTo === userKey;

/**
 * Sortierschlüssel für die Abarbeitung: fällige Wiedervorlagen und Termine
 * zuerst (je älter, desto dringender), dann unangefasste Kontakte, dann
 * erneute Versuche mit den wenigsten Anläufen.
 */
function workRank(c: OutboundContact): [number, string] {
  if (c.status === 'termin') return [0, c.followUpDate ?? ''];
  if (c.status === 'wiedervorlage') return [1, c.followUpDate ?? ''];
  if (c.status === 'offen') return [2, c.createdAt];
  return [3, String(c.attempts).padStart(2, '0') + c.createdAt];
}

/**
 * Bringt die abzuarbeitenden Kontakte in Anrufreihenfolge. Eigene bzw. freie
 * Kontakte zuerst — fremd zugewiesene bleiben ganz draußen.
 */
export function workQueue(
  contacts: OutboundContact[],
  campaign: Campaign,
  userKey?: string | null,
  ref: string = today(),
): OutboundContact[] {
  return contacts
    .filter(
      (c) =>
        c.campaignId === campaign.id &&
        isMine(c, userKey) &&
        isWorkable(c, campaign, ref),
    )
    .sort((a, b) => {
      const [ra, sa] = workRank(a);
      const [rb, sb] = workRank(b);
      if (ra !== rb) return ra - rb;
      return sa.localeCompare(sb);
    });
}

/** Der nächste anzurufende Kontakt, oder null wenn nichts mehr offen ist. */
export function nextContact(
  contacts: OutboundContact[],
  campaign: Campaign,
  userKey?: string | null,
  ref: string = today(),
): OutboundContact | null {
  return workQueue(contacts, campaign, userKey, ref)[0] ?? null;
}

// ============================================================================
// Statistik & Prämien
// ============================================================================

export interface CampaignStats {
  total: number;
  /** Noch nicht endgültig bewertet — inkl. Wiedervorlagen und Termine */
  offen: number;
  termine: number;
  abschluesse: number;
  keinInteresse: number;
  /** Kontakte, bei denen mindestens ein Versuch protokolliert ist */
  bearbeitet: number;
  /** Summe aller Kontaktversuche */
  versuche: number;
  /** Erreichte Kontakte / bearbeitete Kontakte in Prozent, null ohne Versuch */
  erreichbarkeit: number | null;
  /** Abschlüsse / bearbeitete Kontakte in Prozent, null ohne Versuch */
  conversion: number | null;
  /** Fortschritt in Prozent (fertig bewertete Kontakte / gesamt) */
  fortschritt: number;
}

/** Kennzahlen einer Kampagne über die zugehörigen Kontakte. */
export function campaignStats(
  contacts: OutboundContact[],
  campaignId: string,
): CampaignStats {
  const rows = contacts.filter((c) => c.campaignId === campaignId);
  const total = rows.length;

  let termine = 0;
  let abschluesse = 0;
  let keinInteresse = 0;
  let bearbeitet = 0;
  let versuche = 0;
  let erreicht = 0;
  let erledigt = 0;

  for (const c of rows) {
    versuche += c.attempts;
    if (c.attempts > 0) bearbeitet += 1;
    // "Erreicht" = wir haben tatsächlich mit jemandem gesprochen.
    if (
      c.status === 'termin' ||
      c.status === 'abschluss' ||
      c.status === 'keinInteresse' ||
      c.status === 'wiedervorlage' ||
      c.status === 'sperren'
    ) {
      erreicht += 1;
    }
    if (c.status === 'termin') termine += 1;
    if (c.status === 'abschluss') abschluesse += 1;
    if (c.status === 'keinInteresse') keinInteresse += 1;
    if (CLOSED_STATUS.has(c.status)) erledigt += 1;
  }

  const offen = total - erledigt;

  return {
    total,
    offen,
    termine,
    abschluesse,
    keinInteresse,
    bearbeitet,
    versuche,
    erreichbarkeit: bearbeitet > 0 ? Math.round((erreicht / bearbeitet) * 100) : null,
    conversion: bearbeitet > 0 ? Math.round((abschluesse / bearbeitet) * 100) : null,
    fortschritt: total > 0 ? Math.round((erledigt / total) * 100) : 0,
  };
}

/**
 * Kampagnen-Prämie eines einzelnen Kontakts nach aktuellem Stand.
 *
 * Bewusst nur der aktuelle Status zählt, nie die Historie: ein Kontakt, der
 * vom Termin zum Abschluss geworden ist, bringt die Abschluss-Prämie — nicht
 * beide. Das verhindert Doppelzählung.
 */
export function contactBonus(contact: OutboundContact, campaign: Campaign): number {
  if (contact.status === 'abschluss') return campaign.bonusAbschluss;
  if (contact.status === 'termin') return campaign.bonusTermin;
  return 0;
}

/**
 * Summe der Kampagnen-Prämien.
 *
 * `agentKey` grenzt auf eine Person ein (weggelassen = das ganze Team), `ref`
 * auf einen Monat — verglichen über `resultAt`, also wann das Ergebnis gesetzt
 * wurde, nicht wann der Kontakt importiert wurde.
 */
export function bonusSum(
  contacts: OutboundContact[],
  campaigns: Campaign[],
  opts: { agentKey?: string; ref?: Date } = {},
): number {
  const byId = new Map(campaigns.map((c) => [c.id, c]));
  let sum = 0;
  for (const c of contacts) {
    if (opts.agentKey !== undefined && c.resultBy !== opts.agentKey) continue;
    const campaign = byId.get(c.campaignId);
    if (!campaign) continue;
    if (opts.ref) {
      if (!c.resultAt) continue;
      const d = parseLocalDate(c.resultAt);
      if (
        d.getFullYear() !== opts.ref.getFullYear() ||
        d.getMonth() !== opts.ref.getMonth()
      ) {
        continue;
      }
    }
    sum += contactBonus(c, campaign);
  }
  return sum;
}

/** Kampagnen-Prämien einer einzelnen Person. */
export function agentBonus(
  contacts: OutboundContact[],
  campaigns: Campaign[],
  agentKey: string,
  ref?: Date,
): number {
  return bonusSum(contacts, campaigns, { agentKey, ref });
}

/**
 * Wie viele Kontaktversuche hat eine Person seit `since` protokolliert?
 * Grundlage für die Aktivitäts-Kennzahl im Team-Dashboard.
 */
export function callCount(
  calls: { createdBy?: string; createdAt: string }[],
  agentKey: string,
  since?: Date,
): number {
  return calls.filter(
    (c) => c.createdBy === agentKey && (!since || new Date(c.createdAt) >= since),
  ).length;
}

// ============================================================================
// Zustandsübergang nach einem Gespräch
// ============================================================================

export interface CallResult {
  outcome: CallOutcome;
  followUpDate?: string;
  followUpTime?: string;
  note?: string;
}

/**
 * Berechnet den neuen Kontakt-Zustand nach einem protokollierten Gespräch.
 * Reine Funktion — der Store schreibt das Ergebnis, damit die Logik testbar
 * bleibt und in der UI keine Sonderfälle nötig sind.
 */
export function applyCallResult(
  contact: OutboundContact,
  result: CallResult,
  agentKey: string | undefined,
  now: Date = new Date(),
): Partial<OutboundContact> {
  const iso = now.toISOString();
  const patch: Partial<OutboundContact> = {
    status: result.outcome,
    attempts: contact.attempts + 1,
    lastCallAt: iso,
    resultBy: agentKey,
    resultAt: iso,
    // Wiedervorlage/Termin setzen ein Datum, alle anderen Ergebnisse räumen
    // ein altes wieder ab, damit nichts fälschlich wieder auftaucht.
    followUpDate: needsFollowUp(result.outcome) ? result.followUpDate : undefined,
    followUpTime: needsFollowUp(result.outcome) ? result.followUpTime : undefined,
  };

  if (result.note?.trim()) {
    const stamp = now.toLocaleDateString('de-DE');
    const line = `${stamp}: ${result.note.trim()}`;
    patch.notes = contact.notes ? `${contact.notes}\n${line}` : line;
  }

  return patch;
}
