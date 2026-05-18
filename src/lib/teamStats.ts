import type { Contract, TariffChange, Settings } from '../types';
import { calcContractCommission, calcTariffCommission, isSameMonth } from './utils';

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
