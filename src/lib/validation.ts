import type { Contract, TariffChange } from '../types';

/** Jira-Vorgangsschlüssel, z.B. TNG-1234. Leer = gültig (Feld ist optional). */
export function isJiraTicket(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  return /^[A-Z]{2,}-\d+$/.test(v);
}

/** Normalisiert eine Jira-Eingabe: trimmt und schreibt den Projektteil groß. */
export function normalizeJiraTicket(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Sucht zu einer Kundennummer einen bereits erfassten – abweichenden – Namen.
 * Gibt den bekannten Namen zurück, wenn die KdNr. existiert, aber unter einem
 * anderen Namen geführt wird. Sonst null. Dient als nicht-blockierende Warnung.
 */
export function findDuplicateCustomer(
  kdnr: string,
  name: string,
  contracts: Contract[],
  tariffChanges: TariffChange[],
): string | null {
  const num = kdnr.trim();
  const nm = name.trim().toLowerCase();
  if (!num || !nm) return null;

  for (const c of contracts) {
    if (c.customerNumber === num && c.customerName.trim().toLowerCase() !== nm) {
      return c.customerName;
    }
  }
  for (const t of tariffChanges) {
    if (t.customerNumber === num && t.customerName.trim().toLowerCase() !== nm) {
      return t.customerName;
    }
  }
  return null;
}
