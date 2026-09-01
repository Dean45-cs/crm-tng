import type { Contract, TariffChange, Settings, Incentive } from '../types';
import type { AuthUser } from '../store/useAuth';
import {
  calcContractCommission,
  calcTariffCommission,
  isSameMonth,
  isSameWeek,
} from './utils';

/** Liegt das ISO-Datum in der aktuellen Periode des Incentives? */
function inPeriod(iso: string, period: Incentive['period']): boolean {
  return period === 'weekly' ? isSameWeek(iso) : isSameMonth(iso);
}

/**
 * Der aktuelle Periodenwert eines Agenten für die Zielgröße des Incentives.
 * Stornierte Verträge zählen nicht bei den Zähl-Zielen (commission ist
 * ohnehin 0 für Stornos).
 */
export function incentiveValue(
  incentive: Incentive,
  agentKey: string,
  contracts: Contract[],
  tariffChanges: TariffChange[],
  settings: Settings,
): number {
  const myContracts = contracts.filter(
    (c) => c.createdBy === agentKey && inPeriod(c.contractDate, incentive.period),
  );
  const myTariffs = tariffChanges.filter(
    (t) => t.createdBy === agentKey && inPeriod(t.changeDate, incentive.period),
  );

  switch (incentive.metric) {
    case 'commission': {
      const fromContracts = myContracts.reduce(
        (sum, c) => sum + calcContractCommission(c, settings),
        0,
      );
      const fromTariffs = myTariffs.reduce(
        (sum, t) => sum + calcTariffCommission(t, settings),
        0,
      );
      return fromContracts + fromTariffs;
    }
    case 'contracts':
      return myContracts.filter((c) => c.status !== 'storniert').length;
    case 'deals':
      return (
        myContracts.filter((c) => c.status !== 'storniert').length +
        myTariffs.length
      );
  }
}

export interface Standing {
  key: string;
  displayName: string;
  value: number;
  rank: number;
}

/**
 * Rangliste für ein Incentive, absteigend nach Wert sortiert.
 * Gleichstände erhalten eindeutige Positionsränge (klarer Platz 1).
 *
 * Gesperrte Konten bleiben außen vor: Sie können den Wettbewerb weder gewinnen
 * noch verlieren, blähen aber das Teilnehmerfeld auf — „Platz 17 von 19" liest
 * sich deutlich anders als „Platz 9 von 11", wenn acht davon stillgelegte
 * Testzugänge sind.
 */
export function incentiveStandings(
  incentive: Incentive,
  users: Record<string, AuthUser>,
  contracts: Contract[],
  tariffChanges: TariffChange[],
  settings: Settings,
): Standing[] {
  return Object.values(users)
    .filter((u) => u.isActive)
    .map((u) => ({
      key: u.key,
      displayName: u.displayName,
      value: incentiveValue(incentive, u.key, contracts, tariffChanges, settings),
    }))
    .sort((a, b) => b.value - a.value)
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

/** Ziel erreicht? Nur bei Zielprämien relevant. */
export function incentiveReached(incentive: Incentive, value: number): boolean {
  return incentive.mechanic === 'goal' && incentive.target > 0 && value >= incentive.target;
}

/** Führt der Agent den Wettbewerb an (Rang 1 mit einem Wert > 0)? */
export function isLeader(standings: Standing[], agentKey: string): boolean {
  const top = standings[0];
  return !!top && top.key === agentKey && top.value > 0;
}
