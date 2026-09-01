import type {
  Call,
  CallWrapup,
  CampaignCallType,
  DoiChannel,
  DoiStatus,
  HomeIdKind,
  WinbackStatus,
} from '../types';
// Der Kampagnen-Katalog lebt in der Extension (gleiches Muster wie
// shift-time.js, siehe src/lib/shifts.ts) — eine Quelle für CRM und Cockpit.
// Reiner Seiteneffekt-Import, weil dieselbe Datei auch als klassisches
// Content-Script ohne `export`-Syntax laufen muss.
import '../../extension/src/campaigns.js';

/**
 * Was die sechs Kampagnen fachlich verlangen, für das CRM typisiert.
 *
 * Der Inhalt selbst steht in extension/src/campaigns.js — dieses Modul gibt
 * ihm nur Typen und ergänzt, was ausschließlich das CRM braucht: die
 * Übersetzung zwischen erfasstem Formular (CallWrapup) und Datenbankzeile
 * (Call), sowie die Auswertungen über bereits erfasste Gespräche.
 *
 * Warum die Trennung: die Extension erfasst dieselben Gespräche am timio-
 * Cockpit. Stünde der Katalog zweimal da, würde die erste Änderung an einem
 * Leitfaden sofort zu zwei Oberflächen führen, die unterschiedliche
 * Pflichtfelder verlangen — und zwar unbemerkt, bis eine Abrechnung auffällt.
 */

// ── Formen des geteilten Katalogs ───────────────────────────────────────────

export interface CatalogEntry {
  id: string;
  label: string;
  hint?: string;
  [extra: string]: unknown;
}

export interface CampaignOutcome {
  id: string;
  label: string;
  /** Roll-up für die kampagnenübergreifende Auswertung (calls.disposition). */
  disposition?: Call['disposition'];
  winbackStatus?: WinbackStatus;
  /** Pflichtfelder dieses Ergebnisses — Ids aus WRAPUP_FIELDS. */
  requires?: string[];
  followUp?: boolean;
  opensPanel?: boolean;
  outboundOnly?: boolean;
  countsAsAttempt?: boolean;
  seed: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  required: boolean;
  hint?: string;
}

export interface CampaignDefinition {
  id: CampaignCallType;
  label: string;
  title: string;
  subtitle: string;
  scope: string;
  version: string;
  stand: string;
  systems: string[];
  /** Rufnummernanzeige dieser Kampagne — Unterdrückung ist untersagt (§ 120 TKG). */
  callerId: string;
  timing: {
    window?: string;
    note?: string;
    minAttempts: number;
    spreadOverDay: boolean;
    followUpDays?: number;
  };
  outcomes: CampaignOutcome[];
  checklist: ChecklistItem[];
  catalogs: Record<string, CatalogEntry[]>;
  variants?: CatalogEntry[];
  privacy?: { hideOtherContractHolders: boolean; note: string };
  rules?: Record<string, unknown>;
  capturesAdviceScore?: boolean;
  capturesFraud?: boolean;
  requiresHomeId?: boolean;
}

export interface MissingRequirement {
  id: string;
  label: string;
  hint?: string;
}

interface HomeIdKindDef extends CatalogEntry {
  id: HomeIdKind;
  rank: number;
  example: string;
  pattern: RegExp;
}

interface WinbackStatusDef extends CatalogEntry {
  id: WinbackStatus;
  requiresReason: boolean;
  billable: boolean;
}

interface DoiStatusDef extends CatalogEntry {
  id: DoiStatus;
  terminal: boolean;
  advertisingAllowed: boolean;
}

interface CampaignsShared {
  CONTACT_WINDOW: { weekdays: number[]; startMin: number; endMin: number; label: string };
  LEGITIMATION_METHODS: CatalogEntry[];
  HOME_ID_KINDS: HomeIdKindDef[];
  DOI_STATUS: DoiStatusDef[];
  DOI_CHANNELS: (CatalogEntry & { id: DoiChannel })[];
  DOI_RETENTION_YEARS: number;
  FRAUD_MARKERS: (CatalogEntry & { group: string })[];
  WINBACK_STATUS: WinbackStatusDef[];
  JIRA_COMPONENTS: (CatalogEntry & { campaign: CampaignCallType })[];
  DOC_SYSTEMS: CatalogEntry[];
  DOC_STANDARD_4W: string[];
  NO_CONTACT_OUTCOMES: CampaignOutcome[];
  CHURN_REASONS: CatalogEntry[];
  WELCOME_REGRET_TRIGGERS: CatalogEntry[];
  WINBACK_LADDER: (CatalogEntry & { stage: number; needsApproval?: boolean })[];
  PRL_CAUSES: CatalogEntry[];
  PRL_ADDRESS_FIELDS: CatalogEntry[];
  BUILDING_TYPES: (CatalogEntry & { details: boolean })[];
  BUILDING_DETAIL_FIELDS: (CatalogEntry & { type: string; question: string; options?: string[] })[];
  TRISTATE: CatalogEntry[];
  DUPE_REASONS: CatalogEntry[];
  BVW_TYPOLOGY: CatalogEntry[];
  BVW_SOLUTIONS: (CatalogEntry & { group: string; needsApproval?: boolean; reactiveOnly?: boolean })[];
  COURTESY_FAULTS: CatalogEntry[];
  COURTESY_ISSUES: CatalogEntry[];
  CAMPAIGNS: Record<string, CampaignDefinition>;
  CAMPAIGN_ORDER: CampaignCallType[];
  WRAPUP_FIELDS: Record<string, { label: string; hint?: string; confirm?: boolean }>;
  campaign: (callType: CampaignCallType | null | undefined) => CampaignDefinition;
  allCampaigns: () => CampaignDefinition[];
  outcomesFor: (callType: CampaignCallType | null | undefined, direction?: string) => CampaignOutcome[];
  outcome: (callType: CampaignCallType | null | undefined, outcomeId: string) => CampaignOutcome | null;
  normalizeHomeId: (raw: string) => string;
  detectHomeIdKind: (raw: string) => HomeIdKindDef | null;
  validateHomeId: (raw: string, kindId: string) => { ok: boolean; value: string; reason?: string };
  isWithinContactWindow: (date?: Date) => boolean;
  missingRequirements: (
    callType: CampaignCallType | null | undefined,
    outcomeId: string,
    wrapup: CallWrapup,
  ) => MissingRequirement[];
  isBillable: (callType: CampaignCallType | null | undefined, outcomeId: string, wrapup: CallWrapup) => boolean;
  effectiveWinbackStatus: (
    callType: CampaignCallType | null | undefined,
    outcomeId: string,
    wrapup: CallWrapup,
  ) => WinbackStatus;
  advertisingAllowed: (doiStatus: DoiStatus | null | undefined) => boolean;
  labelOf: (list: CatalogEntry[] | undefined, id: string | null | undefined) => string;
}

const shared = (
  globalThis as unknown as { StadtnetzCRM: { campaigns: CampaignsShared } }
).StadtnetzCRM.campaigns;

// ── Durchgereicht ───────────────────────────────────────────────────────────

export const CONTACT_WINDOW = shared.CONTACT_WINDOW;
export const LEGITIMATION_METHODS = shared.LEGITIMATION_METHODS;
export const HOME_ID_KINDS = shared.HOME_ID_KINDS;
export const DOI_STATUS = shared.DOI_STATUS;
export const DOI_CHANNELS = shared.DOI_CHANNELS;
export const DOI_RETENTION_YEARS = shared.DOI_RETENTION_YEARS;
export const FRAUD_MARKERS = shared.FRAUD_MARKERS;
export const WINBACK_STATUS = shared.WINBACK_STATUS;
export const JIRA_COMPONENTS = shared.JIRA_COMPONENTS;
export const DOC_SYSTEMS = shared.DOC_SYSTEMS;
export const DOC_STANDARD_4W = shared.DOC_STANDARD_4W;
export const TRISTATE = shared.TRISTATE;
export const BUILDING_TYPES = shared.BUILDING_TYPES;
export const BUILDING_DETAIL_FIELDS = shared.BUILDING_DETAIL_FIELDS;
export const WINBACK_LADDER = shared.WINBACK_LADDER;
export const BVW_SOLUTIONS = shared.BVW_SOLUTIONS;
export const COURTESY_FAULTS = shared.COURTESY_FAULTS;
export const CAMPAIGN_ORDER = shared.CAMPAIGN_ORDER;
export const WRAPUP_FIELDS = shared.WRAPUP_FIELDS;

/** Die Kampagne zu einem Call-Typ. Unbekanntes fällt auf churn zurück. */
export const campaignFor = shared.campaign;
/** Alle sechs Kampagnen in Anzeigereihenfolge. */
export const allCampaigns = shared.allCampaigns;
/** Ergebnisliste inklusive der kampagnenübergreifenden „nicht erreicht"-Fälle. */
export const outcomesFor = shared.outcomesFor;
export const outcomeOf = shared.outcome;
export const normalizeHomeId = shared.normalizeHomeId;
export const detectHomeIdKind = shared.detectHomeIdKind;
export const validateHomeId = shared.validateHomeId;
export const isWithinContactWindow = shared.isWithinContactWindow;
/** Welche Pflichtangaben fehlen dieser Erfassung noch? */
export const missingRequirements = shared.missingRequirements;
/** Ist die Erfassung so vollständig, dass abgerechnet werden kann? */
export const isBillable = shared.isBillable;
export const effectiveWinbackStatus = shared.effectiveWinbackStatus;
/** Darf dieser Kunde werblich angesprochen werden? (§ 7 Abs. 2 UWG) */
export const advertisingAllowed = shared.advertisingAllowed;
export const labelOf = shared.labelOf;

/** Katalog einer Kampagne, z.B. die Kündigungsgründe von churn. */
export function catalogOf(callType: CampaignCallType | null | undefined, name: string): CatalogEntry[] {
  return campaignFor(callType).catalogs[name] ?? [];
}

/**
 * Klartext für eine Ursachen-Id. Sucht in allen Katalogen der Kampagne, weil
 * dieselbe Id je nach Ergebnis aus `winbackReason` oder `rejectionReason`
 * kommen kann — der Leser interessiert sich nur für den Text.
 */
export function reasonLabel(callType: CampaignCallType | null | undefined, id: string | null | undefined): string {
  if (!id) return '';
  const catalogs = campaignFor(callType).catalogs;
  for (const list of Object.values(catalogs)) {
    const hit = list.find((e) => e.id === id);
    if (hit) return hit.label;
  }
  return id;
}

// ── Übersetzung Formular ↔ Datenbankzeile ───────────────────────────────────

/**
 * Baut aus einer Erfassung die Felder, die auf `calls` geschrieben werden.
 *
 * Zwei Dinge passieren hier bewusst und nicht in der Oberfläche:
 *
 *  - Der Winbackstatus wird über effectiveWinbackStatus() gefiltert. Wer
 *    „erfolgreich" ohne Ursache abschickt, bekommt „offen" gespeichert statt
 *    einer Datenbank-Fehlermeldung. Die Oberfläche verhindert den Fall vorher,
 *    aber die Regel darf nicht davon abhängen, dass sie das tut.
 *  - Alles, was nicht als eigene Spalte existiert, landet in campaign_data.
 *    Die Liste der Spalten steht deshalb genau einmal hier.
 */
const COLUMN_FIELDS = new Set([
  'outcomeCode',
  'winbackStatus',
  'winbackReason',
  'winbackMeasure',
  'rejectionReason',
  'homeId',
  'homeIdKind',
  'homeIdConfirmed',
  'doi',
  'doiChannels',
  'fraudSuspicion',
  'fraudMarkers',
  'fraudNote',
  'salesPartner',
  'adviceScore',
  'adviceProtocol',
]);

export interface WrapupPatch {
  outcomeCode?: string;
  disposition?: Call['disposition'];
  cancellationReason?: string;
  winbackStatus: WinbackStatus;
  winbackReason?: string;
  winbackMeasure?: string;
  homeId?: string;
  homeIdKind?: HomeIdKind;
  homeIdConfirmed: boolean;
  doiStatus?: DoiStatus;
  doiChannels?: DoiChannel[];
  doiSentAt?: string;
  doiConfirmedAt?: string;
  fraudSuspicion: boolean;
  fraudMarkers?: string[];
  fraudNote?: string;
  salesPartner?: string;
  adviceScore?: number;
  adviceProtocol?: boolean;
  campaignData: Record<string, unknown>;
  wrapupComplete: boolean;
  wrapupAt: string;
}

export function buildWrapupPatch(
  callType: CampaignCallType | null | undefined,
  outcomeId: string,
  wrapup: CallWrapup,
  now = new Date(),
): WrapupPatch {
  const chosen = outcomeOf(callType, outcomeId);
  const status = effectiveWinbackStatus(callType, outcomeId, wrapup);
  const reason = (wrapup.winbackReason ?? wrapup.rejectionReason ?? '') || undefined;

  const campaignData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(wrapup)) {
    if (COLUMN_FIELDS.has(key)) continue;
    if (value === undefined || value === null || value === '') continue;
    campaignData[key] = value;
  }

  const doiStatus = wrapup.doi;
  const homeId = normalizeHomeId(String(wrapup.homeId ?? '')) || undefined;

  return {
    outcomeCode: outcomeId || undefined,
    disposition: chosen?.disposition,
    // Der Kündigungsgrund (Migration 021) speist die bestehende Auswertung.
    // Er ist derselbe Wert wie die Winback-Ursache, nur im Klartext — sonst
    // stünden im Team-Dashboard plötzlich Ids statt Gründen.
    cancellationReason:
      chosen?.disposition === 'gekuendigt' ? reasonLabel(callType, reason) || undefined : undefined,
    winbackStatus: status,
    winbackReason: reason,
    winbackMeasure: (wrapup.winbackMeasure as string | undefined) || undefined,
    homeId,
    // Fehlt die Art, wird sie aus der Nummer abgeleitet: die Datenbank lehnt
    // eine HomeID ohne Art ab, und die Rangfolge ist der ganze Punkt.
    homeIdKind: homeId ? (wrapup.homeIdKind ?? detectHomeIdKind(homeId)?.id) : undefined,
    homeIdConfirmed: Boolean(wrapup.homeIdConfirmed),
    doiStatus,
    doiChannels: wrapup.doiChannels?.length ? wrapup.doiChannels : undefined,
    doiSentAt: doiStatus === 'versendet' || doiStatus === 'bestaetigt' ? now.toISOString() : undefined,
    doiConfirmedAt: doiStatus === 'bestaetigt' ? now.toISOString() : undefined,
    fraudSuspicion: Boolean(wrapup.fraudSuspicion),
    fraudMarkers: wrapup.fraudMarkers?.length ? wrapup.fraudMarkers : undefined,
    fraudNote: wrapup.fraudNote || undefined,
    salesPartner: wrapup.salesPartner || undefined,
    adviceScore: typeof wrapup.adviceScore === 'number' ? wrapup.adviceScore : undefined,
    adviceProtocol: typeof wrapup.adviceProtocol === 'boolean' ? wrapup.adviceProtocol : undefined,
    campaignData,
    wrapupComplete: isBillable(callType, outcomeId, wrapup),
    wrapupAt: now.toISOString(),
  };
}

/** Zurück in die Formularform — für das Nachbearbeiten einer Erfassung. */
export function wrapupFromCall(call: Call): CallWrapup {
  return {
    ...(call.campaignData ?? {}),
    outcomeCode: call.outcomeCode,
    winbackStatus: call.winbackStatus,
    winbackReason: call.winbackReason,
    winbackMeasure: call.winbackMeasure,
    homeId: call.homeId,
    homeIdKind: call.homeIdKind,
    homeIdConfirmed: call.homeIdConfirmed,
    doi: call.doiStatus,
    doiChannels: call.doiChannels,
    fraudSuspicion: call.fraudSuspicion,
    fraudMarkers: call.fraudMarkers,
    fraudNote: call.fraudNote,
    salesPartner: call.salesPartner,
    adviceScore: call.adviceScore,
    adviceProtocol: call.adviceProtocol,
  };
}

// ── Auswertung über erfasste Gespräche ──────────────────────────────────────

export interface WinbackStats {
  erfolgreich: number;
  nichtErfolgreich: number;
  irrelevant: number;
  /** Gesprächen mit Winback-Bezug, deren Status noch auf „offen" steht. */
  offen: number;
  /** Anteil erfolgreicher an den entschiedenen Fällen, in %. */
  quotePct: number | null;
}

/**
 * Winback-Quote. Nur erfolgreich vs. nicht erfolgreich zählen in die Quote —
 * „irrelevant" ist eine Einordnung, keine Niederlage, und „offen" ist gar
 * nicht entschieden.
 */
export function winbackStats(calls: Call[]): WinbackStats {
  let erfolgreich = 0;
  let nichtErfolgreich = 0;
  let irrelevant = 0;
  let offen = 0;
  for (const c of calls) {
    switch (c.winbackStatus) {
      case 'erfolgreich':
        erfolgreich++;
        break;
      case 'nicht_erfolgreich':
        nichtErfolgreich++;
        break;
      case 'irrelevant':
        irrelevant++;
        break;
      case 'offen':
        offen++;
        break;
      default:
        break;
    }
  }
  const decided = erfolgreich + nichtErfolgreich;
  return {
    erfolgreich,
    nichtErfolgreich,
    irrelevant,
    offen,
    quotePct: decided > 0 ? Math.round((erfolgreich / decided) * 100) : null,
  };
}

/**
 * Wie viele Gespräche, in denen eine HomeID zu erheben war, haben eine —
 * bestätigt. Der Nenner sind nur Kampagnen, die sie verlangen: sonst zöge
 * jeder Dubletten-Check die Quote nach unten, obwohl dort nichts zu erheben
 * war.
 */
export function homeIdRate(calls: Call[], callTypeOf: (call: Call) => CampaignCallType | undefined) {
  const relevant = calls.filter((c) => {
    if (!c.disposition) return false;
    const type = callTypeOf(c);
    return type ? Boolean(campaignFor(type).requiresHomeId) : false;
  });
  const captured = relevant.filter((c) => Boolean(c.homeId) && c.homeIdConfirmed).length;
  return {
    relevant: relevant.length,
    captured,
    ratePct: relevant.length > 0 ? Math.round((captured / relevant.length) * 100) : null,
  };
}

/**
 * Double-Opt-In-Quote. Der Leitfaden verlangt die Ankündigung in JEDEM
 * positiven oder neutralen Gesprächsabschluss — der Nenner sind deshalb alle
 * Gespräche mit Ergebnis, nicht nur die erfolgreichen.
 */
export function doiStats(calls: Call[]) {
  const withResult = calls.filter((c) => Boolean(c.disposition));
  const announced = withResult.filter((c) => c.doiStatus && c.doiStatus !== 'offen').length;
  const confirmed = withResult.filter((c) => c.doiStatus === 'bestaetigt').length;
  return {
    total: withResult.length,
    announced,
    confirmed,
    announcedPct: withResult.length > 0 ? Math.round((announced / withResult.length) * 100) : null,
    confirmedPct: announced > 0 ? Math.round((confirmed / announced) * 100) : null,
  };
}

/** Ø-Beratungsnote (Welcome Call), auf eine Nachkommastelle. */
export function averageAdviceScore(calls: Call[]): number | null {
  const scored = calls.filter((c) => typeof c.adviceScore === 'number');
  if (scored.length === 0) return null;
  const sum = scored.reduce((acc, c) => acc + (c.adviceScore ?? 0), 0);
  return Math.round((sum / scored.length) * 10) / 10;
}

export interface FraudPattern {
  salesPartner: string;
  suspicions: number;
  /** Anrufe zu diesem Partner insgesamt — der Nenner der Auffälligkeit. */
  total: number;
  ratePct: number;
  /** Häufigste Merkmale, absteigend. */
  topMarkers: { id: string; count: number }[];
}

/**
 * Fraud-Muster je Vertriebspartner. Der Einzelfall ist selten eindeutig, das
 * Muster ist es — genau deshalb wird hier nach Partner gruppiert und nicht nur
 * gezählt. Partner ohne Verdachtsfall erscheinen nicht: die Liste ist ein
 * Frühwarnsignal, keine Partnerübersicht.
 */
export function fraudPatterns(calls: Call[]): FraudPattern[] {
  const byPartner = new Map<string, { suspicions: number; total: number; markers: Map<string, number> }>();
  for (const c of calls) {
    const partner = (c.salesPartner ?? '').trim();
    if (!partner) continue;
    let entry = byPartner.get(partner);
    if (!entry) {
      entry = { suspicions: 0, total: 0, markers: new Map() };
      byPartner.set(partner, entry);
    }
    entry.total++;
    if (!c.fraudSuspicion) continue;
    entry.suspicions++;
    for (const m of c.fraudMarkers ?? []) {
      entry.markers.set(m, (entry.markers.get(m) ?? 0) + 1);
    }
  }

  return Array.from(byPartner.entries())
    .filter(([, e]) => e.suspicions > 0)
    .map(([salesPartner, e]) => ({
      salesPartner,
      suspicions: e.suspicions,
      total: e.total,
      ratePct: Math.round((e.suspicions / e.total) * 100),
      topMarkers: Array.from(e.markers.entries())
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.suspicions - a.suspicions || b.ratePct - a.ratePct);
}

/**
 * Gespräche, deren Erfassung unvollständig ist — die offene Nachbearbeitung.
 * Nur Anrufe mit Ergebnis: wer niemanden erreicht hat, hat nichts nachzutragen.
 */
export function openWrapups(calls: Call[]): Call[] {
  return calls
    .filter((c) => Boolean(c.disposition) && !c.wrapupComplete)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}
