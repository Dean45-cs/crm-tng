import type { Contract, TariffChange, Settings, Lead } from '../types';
import {
  calcContractCommission,
  calcTariffCommission,
  isSameMonth,
  expiryBucket,
  followUpBucket,
} from './utils';

export interface AgentStats {
  /** Provision im Referenzmonat (Verträge + Tarifwechsel) */
  monthCommission: number;
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
  monthDeals: 0,
  monthContracts: 0,
  monthTariffs: 0,
  totalCommission: 0,
  totalDeals: 0,
});

/** Kennzahlen eines einzelnen Mitarbeiters. */
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
      s.monthDeals += 1;
      s.monthTariffs += 1;
    }
  }
  return s;
}

/** Zielerreichung in Prozent, oder null falls kein Ziel gesetzt. */
export function attainmentPct(commission: number, target: number): number | null {
  if (target <= 0) return null;
  return Math.round((commission / target) * 100);
}

/** Zusätzliche Team-Kennzahlen für die Chef-Übersicht (Qualität & Pipeline). */
export interface TeamKpis {
  /** Storno-Quote in % (stornierte / alle Verträge), null ohne Verträge. */
  cancelRate: number | null;
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
  const totalContracts = contracts.length;
  const cancelled = contracts.filter((c) => c.status === 'storniert').length;
  const cancelRate = totalContracts > 0 ? Math.round((cancelled / totalContracts) * 100) : null;

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
    cancelRate,
    avgCommissionPerDeal,
    openLeads,
    leadConversion,
    expiringSoon,
    dueFollowUps,
  };
}
