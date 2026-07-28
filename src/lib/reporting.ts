import type {
  Call,
  CallDisposition,
  Campaign,
  Contract,
  Lead,
  Note,
  Settings,
  TariffChange,
} from '../types';
import {
  calcContractCommission,
  calcTariffCommission,
  TARIFF_CONTEXT_LABEL,
  TARIFF_TYPE_LABEL,
} from './utils';
import {
  DISPOSITION_LABEL,
  callVolumeStats,
  campaignPerformance,
  cancellationReasonBreakdown,
  conversionStats,
  dispositionBreakdown,
  linkCallsToOutcomes,
  saveRateStats,
  type CampaignPerformance,
} from './callStats';
import {
  bucketKeyOf,
  bucketSizeFor,
  bucketsOf,
  inRange,
  isoToDateKey,
  proratedTarget,
  rangeLengthDays,
  type DateRange,
} from './reportRange';

/**
 * Auswertungs-Engine der Berichte. Eine reine Funktion: alles rein, ein
 * `ReportData` raus — keine Fetches, kein React, kein Datum aus der Umgebung
 * außer dem übergebenen Zeitraum. Dadurch ist der komplette Bericht
 * unit-testbar und identisch für Bildschirm, Druck und CSV-Export.
 *
 * Sie ist bewusst die *einzige* Stelle, an der Verkaufszahlen (Provision,
 * Abschlüsse) und Outbound-Zahlen (Anrufe, Save-Rate, Kampagnen) über
 * denselben Zeitraum zusammengeführt werden. Dashboard und Team-Dashboard
 * zeigen beides nebeneinander, aber nur für den laufenden Monat und ohne
 * gemeinsamen Filter.
 *
 * Rechnet auf den bestehenden Bausteinen (`callStats.ts`, `utils.ts`) statt
 * eigene Formeln nachzubauen — die Save-Rate im Bericht ist per Konstruktion
 * dieselbe Zahl wie die im Team-Dashboard.
 */

export interface ReportAgent {
  /** User-Key (UUID) — entspricht `contracts.createdBy` und `calls.agentId`. */
  key: string;
  displayName: string;
  /** Monatsziel in € (0 = keins gesetzt). */
  monthlyTarget: number;
}

export interface ReportSource {
  contracts: Contract[];
  tariffChanges: TariffChange[];
  notes: Note[];
  leads: Lead[];
  calls: Call[];
  campaigns: Campaign[];
  settings: Settings;
  /** Für den Team-Vergleich. Leer = Block entfällt. */
  agents: ReportAgent[];
}

export interface ReportFilter {
  range: DateRange;
  /** undefined = ganzes Team. */
  agentKey?: string;
  /**
   * undefined = alle Kampagnen. Wirkt **nur auf die Anruf-Kennzahlen** —
   * Verträge und Tarifwechsel tragen keine Kampagnen-Zuordnung (es gibt keinen
   * Fremdschlüssel, siehe callStats.linkCallsToOutcomes). Die Seite weist
   * darauf hin, statt eine Zuordnung zu erfinden, die die Provisionszahlen
   * still verfälschen würde.
   */
  campaignId?: string;
}

// ── Teil-Ergebnisse ─────────────────────────────────────────────────────────

export interface ProductRow {
  name: string;
  count: number;
  commission: number;
}

export interface SalesSummary {
  /** Nicht stornierte Verträge im Zeitraum. */
  contractCount: number;
  cancelledCount: number;
  tariffCount: number;
  /** Verträge + Tarifwechsel, Stornos ausgenommen. */
  deals: number;
  contractCommission: number;
  tariffCommission: number;
  commission: number;
  avgPerDeal: number;
  /** Kundennummern, deren allererster Vertrag in den Zeitraum fällt. */
  newCustomers: number;
  topProducts: ProductRow[];
  biggestDeal: { name: string; amount: number; kind: string } | null;
}

export interface DispositionRow {
  disposition: CallDisposition;
  label: string;
  count: number;
  /** Anteil an allen Anrufen mit Disposition, in %. */
  pct: number;
}

export interface ReasonRow {
  reason: string;
  count: number;
  /** Anteil an allen Kündigungen, in %. */
  pct: number;
}

export interface CallSummary {
  total: number;
  inbound: number;
  outbound: number;
  avgDurationS: number;
  /** Summe aller bekannten Gesprächsdauern in Sekunden. */
  talkTimeS: number;
  /** Anrufe mit gesetztem Gesprächsergebnis. */
  withDisposition: number;
  saved: number;
  cancelled: number;
  saveRatePct: number | null;
  dispositions: DispositionRow[];
  cancellationReasons: ReasonRow[];
  campaigns: CampaignPerformance[];
  /** Anteil der Anrufe mit verknüpftem CRM-Eintrag, in %. */
  conversionPct: number | null;
  avgMinutesToOutcome: number | null;
  linkedCount: number;
  /** Ø Anrufe je Tag, an dem überhaupt telefoniert wurde. */
  callsPerActiveDay: number;
  /** Anrufe je Tagesstunde (0–23), immer 24 Einträge. */
  hourly: { hour: number; count: number }[];
  busiestHour: number | null;
}

export interface ReportSeriesPoint {
  key: string;
  label: string;
  commission: number;
  deals: number;
  calls: number;
  saved: number;
}

export interface AgentReportRow {
  key: string;
  displayName: string;
  contracts: number;
  tariffs: number;
  deals: number;
  commission: number;
  /** Monatsziel auf den Zeitraum umgelegt. */
  target: number;
  attainmentPct: number | null;
  calls: number;
  talkTimeS: number;
  saveRatePct: number | null;
  conversionPct: number | null;
}

export interface ContractReportRow {
  date: string;
  customerNumber: string;
  customerName: string;
  products: string;
  status: string;
  agent: string;
  commission: number;
}

export interface TariffReportRow {
  date: string;
  customerNumber: string;
  customerName: string;
  changeType: string;
  context: string;
  agent: string;
  commission: number;
}

export interface CallReportRow {
  startedAt: string;
  agent: string;
  direction: string;
  customerNumber: string;
  durationS: number | null;
  disposition: string;
  cancellationReason: string;
  campaign: string;
}

export interface ReportData {
  range: DateRange;
  /** Tage im Zeitraum, beide Enden inklusiv. */
  days: number;
  sales: SalesSummary;
  calls: CallSummary;
  series: ReportSeriesPoint[];
  /** Nur bei Team-Scope befüllt (agentKey === undefined). */
  perAgent: AgentReportRow[];
  contractRows: ContractReportRow[];
  tariffRows: TariffReportRow[];
  callRows: CallReportRow[];
  /** Auf den Zeitraum umgelegtes Ziel des Scopes (Person oder Team-Summe). */
  target: number;
  attainmentPct: number | null;
}

// ── Hilfen ──────────────────────────────────────────────────────────────────

const pct = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 100) : 0;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Anrufe im Zeitraum (lokaler Tag des Beginns), optional auf Person/Kampagne eingegrenzt. */
function filterCalls(calls: Call[], filter: ReportFilter): Call[] {
  return calls.filter((c) => {
    if (!inRange(isoToDateKey(c.startedAt), filter.range)) return false;
    if (filter.agentKey && c.agentId !== filter.agentKey) return false;
    if (filter.campaignId && c.campaignId !== filter.campaignId) return false;
    return true;
  });
}

function filterContracts(contracts: Contract[], filter: ReportFilter): Contract[] {
  return contracts
    .filter(
      (c) =>
        inRange(c.contractDate, filter.range) &&
        (!filter.agentKey || c.createdBy === filter.agentKey),
    )
    .sort((a, b) => a.contractDate.localeCompare(b.contractDate));
}

function filterTariffs(tariffs: TariffChange[], filter: ReportFilter): TariffChange[] {
  return tariffs
    .filter(
      (t) =>
        inRange(t.changeDate, filter.range) &&
        (!filter.agentKey || t.createdBy === filter.agentKey),
    )
    .sort((a, b) => a.changeDate.localeCompare(b.changeDate));
}

/**
 * Neukunden im Zeitraum: Kundennummern, deren *allererster* nicht stornierter
 * Vertrag hineinfällt. Der Erst-Vertrag wird über den **gesamten** Bestand
 * gesucht, nicht nur über den Zeitraum — sonst wäre jeder Bestandskunde in
 * jedem Monat wieder „neu".
 */
function countNewCustomers(all: Contract[], scoped: Contract[]): number {
  const firstByCustomer = new Map<string, string>();
  for (const c of all) {
    if (c.status === 'storniert') continue;
    const prev = firstByCustomer.get(c.customerNumber);
    if (!prev || c.contractDate < prev) firstByCustomer.set(c.customerNumber, c.contractDate);
  }
  const seen = new Set<string>();
  for (const c of scoped) {
    if (c.status === 'storniert') continue;
    if (firstByCustomer.get(c.customerNumber) === c.contractDate) seen.add(c.customerNumber);
  }
  return seen.size;
}

function buildSales(
  allContracts: Contract[],
  contracts: Contract[],
  tariffs: TariffChange[],
  settings: Settings,
): SalesSummary {
  const active = contracts.filter((c) => c.status !== 'storniert');
  const cancelled = contracts.filter((c) => c.status === 'storniert');

  const contractCommission = contracts.reduce(
    (s, c) => s + calcContractCommission(c, settings),
    0,
  );
  const tariffCommission = tariffs.reduce((s, t) => s + calcTariffCommission(t, settings), 0);
  const commission = contractCommission + tariffCommission;
  const deals = active.length + tariffs.length;

  const productMap = new Map<string, ProductRow>();
  for (const c of active) {
    for (const p of c.products) {
      const row = productMap.get(p) ?? { name: p, count: 0, commission: 0 };
      row.count += 1;
      row.commission += settings.products.find((x) => x.name === p)?.commission ?? 0;
      productMap.set(p, row);
    }
  }

  let biggestDeal: SalesSummary['biggestDeal'] = null;
  for (const c of active) {
    const v = calcContractCommission(c, settings);
    if (!biggestDeal || v > biggestDeal.amount) {
      biggestDeal = { name: c.customerName, amount: v, kind: 'Neuvertrag' };
    }
  }
  for (const t of tariffs) {
    const v = calcTariffCommission(t, settings);
    if (!biggestDeal || v > biggestDeal.amount) {
      biggestDeal = { name: t.customerName, amount: v, kind: 'Tarifwechsel' };
    }
  }

  return {
    contractCount: active.length,
    cancelledCount: cancelled.length,
    tariffCount: tariffs.length,
    deals,
    contractCommission: round2(contractCommission),
    tariffCommission: round2(tariffCommission),
    commission: round2(commission),
    avgPerDeal: deals > 0 ? round2(commission / deals) : 0,
    newCustomers: countNewCustomers(allContracts, contracts),
    topProducts: Array.from(productMap.values())
      .sort((a, b) => b.count - a.count || b.commission - a.commission)
      .slice(0, 8),
    biggestDeal,
  };
}

function buildCalls(
  calls: Call[],
  campaigns: Campaign[],
  contracts: Contract[],
  tariffs: TariffChange[],
  leads: Lead[],
  notes: Note[],
): CallSummary {
  const volume = callVolumeStats(calls);
  const rate = saveRateStats(calls);
  const dispositions = dispositionBreakdown(calls);
  const withDisposition = dispositions.reduce((s, d) => s + d.count, 0);
  const reasons = cancellationReasonBreakdown(calls);
  const reasonTotal = reasons.reduce((s, r) => s + r.count, 0);
  const conversion = conversionStats(
    linkCallsToOutcomes(calls, contracts, tariffs, leads, notes),
  );

  const talkTimeS = calls.reduce((s, c) => s + (c.durationS ?? 0), 0);

  const activeDays = new Set(calls.map((c) => isoToDateKey(c.startedAt))).size;

  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  for (const c of calls) hourly[new Date(c.startedAt).getHours()].count += 1;
  const peak = hourly.reduce((best, h) => (h.count > best.count ? h : best), hourly[0]);

  return {
    total: calls.length,
    inbound: volume.inbound,
    outbound: volume.outbound,
    avgDurationS: volume.avgDurationS,
    talkTimeS,
    withDisposition,
    saved: rate.saved,
    cancelled: rate.cancelled,
    saveRatePct: rate.saveRatePct,
    dispositions: dispositions.map((d) => ({
      disposition: d.disposition,
      label: DISPOSITION_LABEL[d.disposition],
      count: d.count,
      pct: pct(d.count, withDisposition),
    })),
    cancellationReasons: reasons.map((r) => ({
      reason: r.reason,
      count: r.count,
      pct: pct(r.count, reasonTotal),
    })),
    campaigns: campaignPerformance(calls, campaigns),
    conversionPct: conversion.conversionPct,
    avgMinutesToOutcome: conversion.avgMinutesToOutcome,
    linkedCount: conversion.linkedCount,
    callsPerActiveDay: activeDays > 0 ? round2(calls.length / activeDays) : 0,
    hourly,
    busiestHour: peak.count > 0 ? peak.hour : null,
  };
}

function buildSeries(
  range: DateRange,
  contracts: Contract[],
  tariffs: TariffChange[],
  calls: Call[],
  settings: Settings,
): ReportSeriesPoint[] {
  const size = bucketSizeFor(range);
  const points = new Map<string, ReportSeriesPoint>();
  for (const b of bucketsOf(range)) {
    points.set(b.key, { key: b.key, label: b.label, commission: 0, deals: 0, calls: 0, saved: 0 });
  }

  const bump = (dateKey: string, fn: (p: ReportSeriesPoint) => void) => {
    const p = points.get(bucketKeyOf(dateKey, size));
    if (p) fn(p);
  };

  for (const c of contracts) {
    bump(c.contractDate, (p) => {
      p.commission += calcContractCommission(c, settings);
      if (c.status !== 'storniert') p.deals += 1;
    });
  }
  for (const t of tariffs) {
    bump(t.changeDate, (p) => {
      p.commission += calcTariffCommission(t, settings);
      p.deals += 1;
    });
  }
  for (const c of calls) {
    bump(isoToDateKey(c.startedAt), (p) => {
      p.calls += 1;
      if (c.disposition === 'gehalten') p.saved += 1;
    });
  }

  return Array.from(points.values()).map((p) => ({ ...p, commission: round2(p.commission) }));
}

function buildPerAgent(src: ReportSource, filter: ReportFilter): AgentReportRow[] {
  return src.agents
    .map((agent) => {
      const scoped: ReportFilter = { ...filter, agentKey: agent.key };
      const contracts = filterContracts(src.contracts, scoped);
      const tariffs = filterTariffs(src.tariffChanges, scoped);
      const calls = filterCalls(src.calls, scoped);

      const active = contracts.filter((c) => c.status !== 'storniert');
      const commission = round2(
        contracts.reduce((s, c) => s + calcContractCommission(c, src.settings), 0) +
          tariffs.reduce((s, t) => s + calcTariffCommission(t, src.settings), 0),
      );
      const target = proratedTarget(agent.monthlyTarget, filter.range);
      const rate = saveRateStats(calls);
      const conversion = conversionStats(
        linkCallsToOutcomes(calls, src.contracts, src.tariffChanges, src.leads, src.notes),
      );

      return {
        key: agent.key,
        displayName: agent.displayName,
        contracts: active.length,
        tariffs: tariffs.length,
        deals: active.length + tariffs.length,
        commission,
        target,
        attainmentPct: target > 0 ? Math.round((commission / target) * 100) : null,
        calls: calls.length,
        talkTimeS: calls.reduce((s, c) => s + (c.durationS ?? 0), 0),
        saveRatePct: rate.saveRatePct,
        conversionPct: conversion.conversionPct,
      };
    })
    .sort((a, b) => b.commission - a.commission || b.deals - a.deals);
}

const DIRECTION_LABEL: Record<Call['direction'], string> = {
  inbound: 'Eingehend',
  outbound: 'Ausgehend',
};

/** Baut den vollständigen Bericht. Reine Funktion — gleiche Eingabe, gleiche Ausgabe. */
export function buildReport(src: ReportSource, filter: ReportFilter): ReportData {
  const nameOf = new Map(src.agents.map((a) => [a.key, a.displayName]));
  const campaignName = new Map(src.campaigns.map((c) => [c.id, c.name]));
  const agentLabel = (key?: string) => (key ? (nameOf.get(key) ?? '–') : '–');

  const contracts = filterContracts(src.contracts, filter);
  const tariffs = filterTariffs(src.tariffChanges, filter);
  const calls = filterCalls(src.calls, filter);

  const sales = buildSales(src.contracts, contracts, tariffs, src.settings);
  const callSummary = buildCalls(
    calls,
    src.campaigns,
    src.contracts,
    src.tariffChanges,
    src.leads,
    src.notes,
  );
  const series = buildSeries(filter.range, contracts, tariffs, calls, src.settings);
  const perAgent = filter.agentKey ? [] : buildPerAgent(src, filter);

  // Ziel des Scopes: eine Person → ihr umgelegtes Ziel, Team → Summe aller.
  const target = filter.agentKey
    ? proratedTarget(
        src.agents.find((a) => a.key === filter.agentKey)?.monthlyTarget ?? 0,
        filter.range,
      )
    : round2(src.agents.reduce((s, a) => s + proratedTarget(a.monthlyTarget, filter.range), 0));

  return {
    range: filter.range,
    days: rangeLengthDays(filter.range),
    sales,
    calls: callSummary,
    series,
    perAgent,
    target,
    attainmentPct: target > 0 ? Math.round((sales.commission / target) * 100) : null,
    contractRows: contracts.map((c) => ({
      date: c.contractDate,
      customerNumber: c.customerNumber,
      customerName: c.customerName,
      products: c.products.join(', '),
      status: c.status,
      agent: agentLabel(c.createdBy),
      commission: round2(calcContractCommission(c, src.settings)),
    })),
    tariffRows: tariffs.map((t) => ({
      date: t.changeDate,
      customerNumber: t.customerNumber,
      customerName: t.customerName,
      changeType: TARIFF_TYPE_LABEL[t.changeType],
      context: TARIFF_CONTEXT_LABEL[t.context],
      agent: agentLabel(t.createdBy),
      commission: round2(calcTariffCommission(t, src.settings)),
    })),
    callRows: calls
      .slice()
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map((c) => ({
        startedAt: c.startedAt,
        agent: agentLabel(c.agentId),
        direction: DIRECTION_LABEL[c.direction],
        customerNumber: c.customerNumber ?? '',
        durationS: c.durationS ?? null,
        disposition: c.disposition ? DISPOSITION_LABEL[c.disposition] : '',
        cancellationReason: c.cancellationReason ?? '',
        campaign: c.campaignId ? (campaignName.get(c.campaignId) ?? 'Unbekannt') : '',
      })),
  };
}

/** Prozentuale Veränderung gegenüber der Vorperiode; null wenn beide 0 sind. */
export function deltaPct(current: number, previous: number): number | null {
  if (previous > 0) return Math.round(((current - previous) / previous) * 100);
  if (current > 0) return 100;
  return null;
}

/** Sekunden → „2 h 15 min" / „7 min" — für Gesprächszeiten. */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0 min';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}
