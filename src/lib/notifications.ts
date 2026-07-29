import type { NotificationKind, NotificationLink, ShiftType, SwapStatus } from '../types';
import type { Route } from '../router';

/**
 * Reine Ableitungen rund ums Postfach — Aussehen einer Meldungsart, relative
 * Zeitangaben und die Texte des Schichttauschs. Bewusst ohne React und ohne
 * Supabase, damit sie ohne DOM testbar sind (src/lib/notifications.test.ts).
 */

/** Farbton einer Meldung — bestimmt Akzentfarbe und Symbol in der Anzeige. */
export type NotificationTone = 'info' | 'success' | 'warn' | 'danger';

interface NotificationLook {
  tone: NotificationTone;
  /** Kurzbezeichnung der Art, z. B. für den Filter im Postfach. */
  label: string;
}

const LOOKS: Record<NotificationKind, NotificationLook> = {
  'shift-changed': { tone: 'info', label: 'Schichtplan' },
  'swap-requested': { tone: 'info', label: 'Tauschanfrage' },
  'swap-accepted': { tone: 'success', label: 'Tausch angenommen' },
  'swap-declined': { tone: 'warn', label: 'Tausch abgelehnt' },
  'swap-cancelled': { tone: 'warn', label: 'Tausch zurückgezogen' },
  'swap-approved': { tone: 'success', label: 'Tausch bestätigt' },
  'swap-rejected': { tone: 'danger', label: 'Tausch abgelehnt' },
  campaign: { tone: 'info', label: 'Kampagne' },
  incentive: { tone: 'success', label: 'Incentive' },
  system: { tone: 'info', label: 'System' },
};

const FALLBACK: NotificationLook = { tone: 'info', label: 'Meldung' };

/**
 * Aussehen einer Meldungsart. Eine unbekannte Art ist kein Fehler, sondern
 * eine neutrale Meldung: die Datenbank soll neue Arten liefern können, ohne
 * dass ein Client, der sie noch nicht kennt, daran scheitert.
 */
export const notificationLook = (kind: string): NotificationLook =>
  LOOKS[kind as NotificationKind] ?? FALLBACK;

/** Alle bekannten Arten — Grundlage der Filterleiste im Postfach. */
export const NOTIFICATION_KINDS = Object.keys(LOOKS) as NotificationKind[];

/**
 * „vor 3 Min.", „vor 2 Std.", „Gestern", sonst das Datum. Wie in der
 * Mitteilungszentrale: je frischer, desto genauer.
 */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = now - then;
  // Kleine Vorlaufzeiten (Uhr des Servers geht vor) nicht als „in 4 Sekunden"
  // ausgeben — für die Anzeige ist das schlicht „jetzt".
  if (diffMs < 60_000) return 'jetzt';

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'Gestern';
  if (days < 7) return `vor ${days} Tagen`;
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** Tagesüberschrift für die Gruppierung im Postfach. */
export function dayHeading(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return 'Heute';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Gestern';
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' });
}

const SHIFT_LABEL: Record<ShiftType, string> = { frueh: 'Früh', spaet: 'Spät', frei: 'Frei' };

/** „Früh"/„Spät"/„Frei", und ohne Schicht schlicht „frei" (kleingeschrieben im Satz). */
export const shiftLabel = (t?: ShiftType | null): string => (t ? SHIFT_LABEL[t] : 'keine Schicht');

/** Tag als „Mo, 03.08." — kurz genug für eine Meldungszeile. */
export function shortDay(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return dateKey;
  // Lokal konstruieren: `new Date('2026-08-03')` läse UTC und rutschte
  // westlich von Greenwich auf den Vortag (gleiche Falle wie parseLocalDate).
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

/**
 * Ein Tausch in einem Satz: „Mo, 03.08. (Früh) gegen Di, 04.08. (Spät)".
 * Steht so in der Anfrage, in der Meldung und in der Bestätigung — damit alle
 * Beteiligten dieselbe Formulierung vor Augen haben.
 */
export function swapSummary(a: {
  requesterDate: string;
  requesterShiftType?: ShiftType;
  partnerDate: string;
  partnerShiftType?: ShiftType;
}): string {
  return `${shortDay(a.requesterDate)} (${shiftLabel(a.requesterShiftType)}) gegen ${shortDay(a.partnerDate)} (${shiftLabel(a.partnerShiftType)})`;
}

/** Routen ohne Pflichtparameter — nur die sind aus einer Meldung heraus erreichbar. */
const SIMPLE_ROUTES = new Set([
  'dashboard',
  'contracts',
  'tariff',
  'notes',
  'customers',
  'leaderboard',
  'settings',
  'reports',
  'teamdashboard',
  'teammanager',
  'incentives',
  'incentivemanager',
  'leads',
  'auditlog',
  'netto',
  'schedule',
  'campaignmanager',
  'postfach',
]);

/**
 * Sprungziel einer Meldung in eine echte Route übersetzen.
 *
 * Das Ziel kommt aus der Datenbank und ist damit nur eine Zeichenkette — der
 * Router prüft sie nicht. Alles Unbekannte landet deshalb im Postfach: dort
 * steht die Meldung ohnehin, und eine leere Seite wäre die schlechtere Antwort
 * auf einen Klick.
 */
export function toRoute(link: NotificationLink): Route {
  if (link.route === 'customer' && link.kdnr) return { name: 'customer', kdnr: link.kdnr };
  if (link.route === 'agentdetail' && link.agentKey) return { name: 'agentdetail', agentKey: link.agentKey };
  if (SIMPLE_ROUTES.has(link.route)) return { name: link.route } as Route;
  return { name: 'postfach' };
}

/** Klartext für den Stand einer Anfrage — in Liste und Postfach identisch. */
export const SWAP_STATUS_LABEL: Record<SwapStatus, string> = {
  pending: 'Wartet auf Antwort',
  accepted: 'Wartet auf Bestätigung',
  approved: 'Getauscht',
  declined: 'Abgelehnt',
  cancelled: 'Zurückgezogen',
  rejected: 'Vom Chef abgelehnt',
};
