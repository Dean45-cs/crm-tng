import type { Call, Contract, TariffChange, Lead, Note, Campaign, CallDisposition } from '../types';

export interface CallVolumeStats {
  /** Anrufe im übergebenen Zeitraum (Aufrufer filtert die calls-Liste bereits nach Datum) */
  count: number;
  inbound: number;
  outbound: number;
  /** Ø-Dauer in Sekunden, nur über beendete Anrufe mit bekannter Dauer */
  avgDurationS: number;
}

/** Anrufvolumen im übergebenen Zeitraum, optional auf eine:n Mitarbeiter:in eingegrenzt. */
export function callVolumeStats(calls: Call[], agentKey?: string): CallVolumeStats {
  const relevant = agentKey ? calls.filter((c) => c.agentId === agentKey) : calls;
  const withDuration = relevant.filter((c) => typeof c.durationS === 'number');
  const avgDurationS =
    withDuration.length > 0
      ? Math.round(withDuration.reduce((sum, c) => sum + (c.durationS ?? 0), 0) / withDuration.length)
      : 0;
  return {
    count: relevant.length,
    inbound: relevant.filter((c) => c.direction === 'inbound').length,
    outbound: relevant.filter((c) => c.direction === 'outbound').length,
    avgDurationS,
  };
}

type Outcome =
  | { kind: 'contract'; entity: Contract }
  | { kind: 'tariff'; entity: TariffChange }
  | { kind: 'lead'; entity: Lead }
  | { kind: 'note'; entity: Note };

export interface CallLink {
  call: Call;
  outcome: Outcome | null;
  /** Minuten zwischen Anrufende und dem verknüpften Eintrag, null ohne Treffer. */
  minutesToOutcome: number | null;
}

interface Candidate {
  customerNumber: string;
  createdBy: string | undefined;
  at: number;
  outcome: Outcome;
}

/**
 * Verknüpft Anrufe heuristisch mit CRM-Einträgen — es gibt keinen
 * Fremdschlüssel zwischen `calls` und Verträgen/Tarifwechseln/Leads/Notizen
 * (verifiziert: db/schema.sql). Ein Anruf gilt als "konvertiert", wenn
 * dieselbe Kundennummer UND dieselbe:r Bearbeiter:in einen Eintrag angelegt
 * hat, dessen Erstellzeitpunkt innerhalb von `windowHours` NACH Anrufende
 * liegt (das Abschluss-Panel aus Stufe 3 legt den Eintrag typischerweise
 * direkt nach dem Auflegen an). Bei mehreren Treffern im Fenster zählt der
 * zeitlich nächstliegende.
 */
export function linkCallsToOutcomes(
  calls: Call[],
  contracts: Contract[],
  tariffChanges: TariffChange[],
  leads: Lead[],
  notes: Note[],
  windowHours = 24,
): CallLink[] {
  const windowMs = windowHours * 60 * 60 * 1000;

  const candidates: Candidate[] = [];
  contracts.forEach((c) => {
    candidates.push({ customerNumber: c.customerNumber, createdBy: c.createdBy, at: Date.parse(c.createdAt), outcome: { kind: 'contract', entity: c } });
  });
  tariffChanges.forEach((t) => {
    candidates.push({ customerNumber: t.customerNumber, createdBy: t.createdBy, at: Date.parse(t.createdAt), outcome: { kind: 'tariff', entity: t } });
  });
  leads.forEach((l) => {
    if (!l.customerNumber) return;
    candidates.push({ customerNumber: l.customerNumber, createdBy: l.createdBy, at: Date.parse(l.createdAt), outcome: { kind: 'lead', entity: l } });
  });
  notes.forEach((n) => {
    if (!n.customerNumber) return;
    candidates.push({ customerNumber: n.customerNumber, createdBy: n.createdBy, at: Date.parse(n.createdAt), outcome: { kind: 'note', entity: n } });
  });

  return calls.map((call) => {
    if (!call.customerNumber) return { call, outcome: null, minutesToOutcome: null };
    const callEnd = Date.parse(call.endedAt ?? call.startedAt);

    let best: { outcome: Outcome; at: number } | null = null;
    for (const cand of candidates) {
      if (cand.customerNumber !== call.customerNumber) continue;
      if (cand.createdBy !== call.agentId) continue;
      const delta = cand.at - callEnd;
      if (delta < 0 || delta > windowMs) continue;
      if (!best || cand.at < best.at) best = { outcome: cand.outcome, at: cand.at };
    }

    return {
      call,
      outcome: best?.outcome ?? null,
      minutesToOutcome: best ? Math.round((best.at - callEnd) / 60000) : null,
    };
  });
}

export interface ConversionStats {
  /** Anteil der Anrufe mit mindestens einem verknüpften Ergebnis, in %. null ohne Anrufe. */
  conversionPct: number | null;
  /** Ø Minuten zwischen Anrufende und dem verknüpften Eintrag. null ohne Treffer. */
  avgMinutesToOutcome: number | null;
  linkedCount: number;
  totalCount: number;
}

/** Fasst das Ergebnis von linkCallsToOutcomes() zu einer Abschlussquote zusammen. */
export function conversionStats(links: CallLink[]): ConversionStats {
  const totalCount = links.length;
  const linked = links.filter((l) => l.outcome !== null);
  const linkedCount = linked.length;
  const conversionPct = totalCount > 0 ? Math.round((linkedCount / totalCount) * 100) : null;
  const avgMinutesToOutcome =
    linkedCount > 0
      ? Math.round(linked.reduce((sum, l) => sum + (l.minutesToOutcome ?? 0), 0) / linkedCount)
      : null;
  return { conversionPct, avgMinutesToOutcome, linkedCount, totalCount };
}

// ============================================================================
// Disposition-basierte Kennzahlen (Migration 021) — Save-Rate,
// Kündigungsgründe und Kampagnen-Performance fürs Team-Dashboard.
// ============================================================================

export interface SaveRateStats {
  /** Gehaltene Kunden (disposition === 'gehalten'). */
  saved: number;
  /** Endgültig gekündigt (disposition === 'gekuendigt'). */
  cancelled: number;
  /** Anteil gehaltener an (gehalten + gekündigt), in %. null ohne entschiedene Fälle. */
  saveRatePct: number | null;
}

/**
 * Save-Rate über alle Anrufe mit entschiedener Disposition. Bewusst nur
 * 'gehalten' vs. 'gekuendigt' — Rückrufe/kein-Interesse/sonstige sind noch
 * nicht entschieden und würden die Quote verwässern. Der Aufrufer filtert
 * die Calls-Liste bereits nach Zeitraum (und optional Kampagne).
 */
export function saveRateStats(calls: Call[]): SaveRateStats {
  const saved = calls.filter((c) => c.disposition === 'gehalten').length;
  const cancelled = calls.filter((c) => c.disposition === 'gekuendigt').length;
  const decided = saved + cancelled;
  return {
    saved,
    cancelled,
    saveRatePct: decided > 0 ? Math.round((saved / decided) * 100) : null,
  };
}

export interface CancellationReason {
  reason: string;
  count: number;
}

/**
 * Häufigkeit je Kündigungsgrund über alle gekündigten Anrufe, absteigend
 * sortiert. Nur Anrufe mit disposition === 'gekuendigt' und nicht-leerem
 * cancellation_reason zählen; leere Gründe werden als „Ohne Angabe" gebündelt.
 */
export function cancellationReasonBreakdown(calls: Call[]): CancellationReason[] {
  const counts = new Map<string, number>();
  for (const c of calls) {
    if (c.disposition !== 'gekuendigt') continue;
    const reason = (c.cancellationReason ?? '').trim() || 'Ohne Angabe';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

export interface CampaignPerformance {
  campaignId: string;
  campaignName: string;
  callType: Campaign['callType'];
  totalCalls: number;
  saved: number;
  cancelled: number;
  saveRatePct: number | null;
  avgDurationS: number;
}

/**
 * Performance je Kampagne: Anrufvolumen, Save-Rate und Ø-Gesprächsdauer,
 * gruppiert über calls.campaign_id. Anrufe ohne Kampagnen-Zuordnung werden
 * ignoriert. Absteigend nach Anrufvolumen sortiert.
 */
export function campaignPerformance(calls: Call[], campaigns: Campaign[]): CampaignPerformance[] {
  const byCampaign = new Map<string, Call[]>();
  for (const c of calls) {
    if (!c.campaignId) continue;
    const list = byCampaign.get(c.campaignId);
    if (list) list.push(c);
    else byCampaign.set(c.campaignId, [c]);
  }

  const rows: CampaignPerformance[] = [];
  for (const [campaignId, group] of byCampaign) {
    const campaign = campaigns.find((k) => k.id === campaignId);
    const rate = saveRateStats(group);
    rows.push({
      campaignId,
      campaignName: campaign?.name ?? 'Unbekannte Kampagne',
      callType: campaign?.callType ?? 'other',
      totalCalls: group.length,
      saved: rate.saved,
      cancelled: rate.cancelled,
      saveRatePct: rate.saveRatePct,
      avgDurationS: callVolumeStats(group).avgDurationS,
    });
  }
  return rows.sort((a, b) => b.totalCalls - a.totalCalls);
}

/** Klartext je Disposition — geteilt von Team-Dashboard und Berichten. */
export const DISPOSITION_LABEL: Record<CallDisposition, string> = {
  gehalten: 'Gehalten',
  gekuendigt: 'Gekündigt',
  rueckruf: 'Rückruf vereinbart',
  'kein-interesse': 'Kein Interesse',
  sonstige: 'Sonstige',
};

/** Verteilung der Dispositionen (für eine kompakte Übersicht/Pie). */
export function dispositionBreakdown(calls: Call[]): { disposition: CallDisposition; count: number }[] {
  const counts = new Map<CallDisposition, number>();
  for (const c of calls) {
    if (!c.disposition) continue;
    counts.set(c.disposition, (counts.get(c.disposition) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([disposition, count]) => ({ disposition, count }))
    .sort((a, b) => b.count - a.count);
}

// ============================================================================
// ECHTE GESPRÄCHSZEITEN UND ERREICHBARKEIT (Migration 028)
// ============================================================================
// Diese Kennzahlen gibt es erst, seit das Gesprächsende erkannt wird
// (desktop/main/media-watch.js). Vorher war `durationS` die Spanne vom
// KLINGELN bis zu dem Moment, in dem jemand an den Knopf gedacht hat — mit
// Klingelzeit, Nachdenkzeit und im schlimmsten Fall einem Zwangsende nach zwei
// Stunden darin. Hier wird deshalb ausschließlich auf `connectedAt`/`endedAt`
// gerechnet und alles übersprungen, wo diese Ränder fehlen.
//
// Der Preis dafür ist, dass jede Zahl eine kleinere Grundmenge hat als
// `count`. Das ist kein Makel, sondern der Punkt: lieber ein Durchschnitt über
// 60 % der Anrufe, von dem man weiß, dass er stimmt, als einer über 100 %, von
// dem man es nicht weiß. Wie groß die Grundmenge ist, steht deshalb in jeder
// Kennzahl mit dabei.

/** Angenommene Gespräche unter dieser Dauer gelten als Fehlkontakt. */
export const SHORT_CALL_S = 20;

/**
 * Obergrenzen, jenseits derer ein Wert kein Messwert mehr ist, sondern ein
 * Datenfehler (Uhrensprung, verwaiste Zeile). Ohne sie reicht ein einziger
 * kaputter Datensatz, um einen Monatsdurchschnitt unbrauchbar zu machen.
 */
const MAX_TALK_S = 4 * 60 * 60;
const MAX_RING_S = 10 * 60;
/** Deckt sich mit CONFIG.call.closeoutWindowMs — so lange gilt Nachbearbeitung. */
const MAX_ACW_S = 30 * 60;

export interface CallTimingStats {
  /** Anrufe, bei denen die Erkennung überhaupt gemessen hat. */
  measured: number;
  /** Anteil belastbar gemessener Anrufe in %. Der Ehrlichkeits-Wert zu allem Übrigen. */
  measuredPct: number | null;

  answered: number;
  unanswered: number;
  /** Nenner ist `measured`, NICHT `count` — siehe unten. */
  answerRatePct: number | null;

  withTalkTime: number;
  /** Summe echter Gesprächszeit in Sekunden (ab dem Abheben). */
  talkTimeS: number;
  avgTalkS: number | null;
  /** Ø Sekunden vom Klingeln bis zum Abheben. */
  avgRingS: number | null;
  shortCalls: number;
  shortCallPct: number | null;

  withAcw: number;
  /** Ø Nachbearbeitung in Sekunden (Auflegen → Ergebnis erfasst). */
  avgAcwS: number | null;
  withAht: number;
  /** Ø Gesamtbearbeitung = Gespräch + Nachbearbeitung, je Anruf gerechnet. */
  avgAhtS: number | null;
}

const secondsBetween = (from?: string, to?: string): number | null => {
  if (!from || !to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const s = Math.round((b - a) / 1000);
  return s < 0 ? null : s;
};

const avg = (values: number[]): number | null =>
  values.length > 0 ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : null;

const share = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

/**
 * Zeiten und Erreichbarkeit aus den echten Rändern eines Gesprächs.
 *
 * ZUM NENNER DER ERREICHBARKEIT, weil das der Punkt ist, an dem so eine Zahl
 * still falsch wird: gezählt wird gegen `measured`, also gegen die Anrufe, bei
 * denen die Erkennung tatsächlich hingesehen hat — nicht gegen alle. `answered`
 * ist dreiwertig (siehe Migration 028): `undefined` heißt „nicht gemessen" und
 * ist etwas anderes als `false` („nicht abgenommen"). Würde man beides
 * zusammenwerfen, sänke die Erreichbarkeitsquote genau in dem Maß, wie die
 * Erkennung ausfällt — auf einem Windows-Rechner ohne Messung stünde dann
 * 0 % Erreichbarkeit, und niemand käme auf die Ursache.
 */
export function callTimingStats(calls: Call[], agentKey?: string): CallTimingStats {
  const relevant = agentKey ? calls.filter((c) => c.agentId === agentKey) : calls;

  const measured = relevant.filter((c) => typeof c.answered === 'boolean');
  const answered = measured.filter((c) => c.answered === true);

  const talks: number[] = [];
  const rings: number[] = [];
  const acws: number[] = [];
  const ahts: number[] = [];
  let shortCalls = 0;

  for (const call of relevant) {
    const talk = secondsBetween(call.connectedAt, call.endedAt);
    const valid = talk !== null && talk <= MAX_TALK_S ? talk : null;
    if (valid !== null) {
      talks.push(valid);
      if (valid < SHORT_CALL_S) shortCalls += 1;
    }

    const ring = secondsBetween(call.startedAt, call.connectedAt);
    if (ring !== null && ring <= MAX_RING_S) rings.push(ring);

    const acw = secondsBetween(call.endedAt, call.dispositionAt);
    const acwValid = acw !== null && acw <= MAX_ACW_S ? acw : null;
    if (acwValid !== null) acws.push(acwValid);

    // AHT je Anruf, nicht als Summe zweier Durchschnitte über verschiedene
    // Grundmengen — sonst addierte man Zahlen, die von verschiedenen Anrufen
    // stammen, und das Ergebnis gehörte zu keinem einzigen davon.
    if (valid !== null && acwValid !== null) ahts.push(valid + acwValid);
  }

  return {
    measured: measured.length,
    measuredPct: share(measured.length, relevant.length),
    answered: answered.length,
    unanswered: measured.length - answered.length,
    answerRatePct: share(answered.length, measured.length),
    withTalkTime: talks.length,
    talkTimeS: talks.reduce((s, v) => s + v, 0),
    avgTalkS: avg(talks),
    avgRingS: avg(rings),
    shortCalls,
    shortCallPct: share(shortCalls, talks.length),
    withAcw: acws.length,
    avgAcwS: avg(acws),
    withAht: ahts.length,
    avgAhtS: avg(ahts),
  };
}
