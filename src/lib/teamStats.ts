import type { Contract, TariffChange, Settings, Lead } from '../types';
import {
  calcContractCommission,
  calcTariffCommission,
  isSameMonth,
  monthKey,
  monthLabel,
  expiryBucket,
  followUpBucket,
} from './utils';

export interface AgentStats {
  /** Provision im Referenzmonat (Verträge + Tarifwechsel) */
  monthCommission: number;
  /** Nur der Vertragsanteil der Monatsprovision (z.B. für gestapelte Charts) */
  monthContractCommission: number;
  /** Nur der Tarifwechsel-Anteil der Monatsprovision */
  monthTariffCommission: number;
  /** Abschlüsse im Referenzmonat (Verträge + Tarifwechsel) */
  monthDeals: number;
  monthContracts: number;
  monthTariffs: number;
  /** Provision über alle Zeiten */
  totalCommission: number;
  totalDeals: number;
}

const emptyStats = (): AgentStats => ({
  monthCommission: 0,
  monthContractCommission: 0,
  monthTariffCommission: 0,
  monthDeals: 0,
  monthContracts: 0,
  monthTariffs: 0,
  totalCommission: 0,
  totalDeals: 0,
});

/**
 * Kennzahlen eines einzelnen Mitarbeiters. Einzige Quelle für Pro-Mitarbeiter-
 * Provision/Abschlüsse — vorher gab es drei unabhängige Nachbauten dieser
 * Aggregation (TeamDashboard.tsx, Leaderboard.tsx, hier), die bei künftigen
 * Änderungen hätten auseinanderlaufen können.
 */
export function agentStats(
  agentKey: string,
  contracts: Contract[],
  tariffChanges: TariffChange[],
  settings: Settings,
  ref: Date = new Date(),
): AgentStats {
  const s = emptyStats();
  for (const c of contracts) {
    if (c.createdBy !== agentKey) continue;
    const com = calcContractCommission(c, settings);
    // Stornierte Verträge zählen nicht als Abschluss (konsistent mit incentives.ts).
    const counts = c.status !== 'storniert';
    s.totalCommission += com;
    if (counts) s.totalDeals += 1;
    if (isSameMonth(c.contractDate, ref)) {
      s.monthCommission += com;
      s.monthContractCommission += com;
      if (counts) {
        s.monthDeals += 1;
        s.monthContracts += 1;
      }
    }
  }
  for (const t of tariffChanges) {
    if (t.createdBy !== agentKey) continue;
    const com = calcTariffCommission(t, settings);
    s.totalCommission += com;
    s.totalDeals += 1;
    if (isSameMonth(t.changeDate, ref)) {
      s.monthCommission += com;
      s.monthTariffCommission += com;
      s.monthDeals += 1;
      s.monthTariffs += 1;
    }
  }
  return s;
}

export interface MonthlyPoint {
  month: string;
  contractCommission: number;
  tariffCommission: number;
}

/**
 * Provisions-Zeitreihe über die letzten `months` Monate (inkl. aktuellem
 * Monat). Einzige Quelle für die "letzte 6 Monate"-Charts — vorher gab es
 * vier fast identische Nachbauten dieser Schleife (Dashboard.tsx,
 * TeamDashboard.tsx, MonthlyReport.tsx, AgentDetail.tsx). Ohne `agentKey`
 * werden alle Verträge/Tarifwechsel gezählt (Team-/Alle-Ansicht).
 */
export function monthlySeries(
  contracts: Contract[],
  tariffChanges: TariffChange[],
  settings: Settings,
  months = 6,
  agentKey?: string,
): MonthlyPoint[] {
  return Array.from({ length: months }, (_, i) => {
    const offset = -(months - 1) + i;
    const refDate = new Date();
    refDate.setDate(1);
    refDate.setMonth(refDate.getMonth() + offset);
    const key = monthKey(refDate.toISOString());

    const contractSum = contracts
      .filter((c) => (!agentKey || c.createdBy === agentKey) && monthKey(c.contractDate) === key)
      .reduce((sum, c) => sum + calcContractCommission(c, settings), 0);
    const tariffSum = tariffChanges
      .filter((t) => (!agentKey || t.createdBy === agentKey) && monthKey(t.changeDate) === key)
      .reduce((sum, t) => sum + calcTariffCommission(t, settings), 0);

    return {
      month: monthLabel(offset),
      contractCommission: Math.round(contractSum * 100) / 100,
      tariffCommission: Math.round(tariffSum * 100) / 100,
    };
  });
}

/**
 * Veränderung ggü. dem Vormonat in Prozent. Einzige Quelle für den
 * "vs. Vormonat"-Wert — vorher gab es drei separate Implementierungen
 * derselben Formel (Dashboard.tsx, TeamDashboard.tsx x2, MonthlyReport.tsx).
 */
export function trendPct(current: number, previous: number): number {
  if (previous > 0) return Math.round(((current - previous) / previous) * 100);
  return current > 0 ? 100 : 0;
}

/** Zielerreichung in Prozent, oder null falls kein Ziel gesetzt. */
export function attainmentPct(commission: number, target: number): number | null {
  if (target <= 0) return null;
  return Math.round((commission / target) * 100);
}

/** Zusätzliche Team-Kennzahlen für die Chef-Übersicht (Qualität & Pipeline). */
export interface TeamKpis {
  /** Durchschnittliche Provision pro Abschluss im Referenzmonat. */
  avgCommissionPerDeal: number;
  /** Offene Leads in der Pipeline (neu + in Bearbeitung). */
  openLeads: number;
  /** Lead-Conversion in % (gewonnen / (gewonnen + verloren)), null ohne Abschluss. */
  leadConversion: number | null;
  /** Verträge, deren Laufzeit in ≤ 90 Tagen endet (Retention-Risiko). */
  expiringSoon: number;
  /** Fällige Wiedervorlagen (heute + überfällig) über Verträge und Leads. */
  dueFollowUps: number;
}

export function teamKpis(
  contracts: Contract[],
  tariffChanges: TariffChange[],
  leads: Lead[],
  settings: Settings,
  ref: Date = new Date(),
): TeamKpis {
  let monthCommission = 0;
  let monthDeals = 0;
  for (const c of contracts) {
    if (!isSameMonth(c.contractDate, ref)) continue;
    monthCommission += calcContractCommission(c, settings);
    if (c.status !== 'storniert') monthDeals += 1;
  }
  for (const t of tariffChanges) {
    if (!isSameMonth(t.changeDate, ref)) continue;
    monthCommission += calcTariffCommission(t, settings);
    monthDeals += 1;
  }
  const avgCommissionPerDeal = monthDeals > 0 ? monthCommission / monthDeals : 0;

  const openLeads = leads.filter(
    (l) => l.status === 'neu' || l.status === 'inBearbeitung',
  ).length;
  const won = leads.filter((l) => l.status === 'gewonnen').length;
  const lost = leads.filter((l) => l.status === 'verloren').length;
  const leadConversion = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null;

  const expiringSoon = contracts.filter((c) => expiryBucket(c) !== null).length;

  const isDue = (iso?: string) => {
    const b = followUpBucket(iso);
    return b === 'overdue' || b === 'today';
  };
  const dueFollowUps =
    contracts.filter((c) => isDue(c.followUpDate)).length +
    leads.filter((l) => isDue(l.followUpDate)).length;

  return {
    avgCommissionPerDeal,
    openLeads,
    leadConversion,
    expiringSoon,
    dueFollowUps,
  };
}
