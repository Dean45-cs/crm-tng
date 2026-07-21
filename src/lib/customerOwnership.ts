import type {
  Contract,
  TariffChange,
  Note,
  CustomerOwnership,
} from '../types';

export type OwnershipMode = 'mine' | 'shared' | 'all';

/**
 * Effektiver Owner eines Kunden:
 * 1. Falls explizit gesetzt (customerOwners[kdnr]) → dieser Owner
 * 2. Sonst: createdBy des frühesten Vertrags / Tarifwechsels / Notiz
 * 3. Falls niemand → null (verwaister Kunde, sichtbar für alle)
 */
export function getEffectiveOwnership(
  kdnr: string,
  ownerships: Record<string, CustomerOwnership>,
  contracts: Contract[],
  tariffChanges: TariffChange[],
  notes: Note[],
): { owner: string | null; sharedWith: string[]; isImplicit: boolean } {
  const explicit = ownerships[kdnr];
  if (explicit) {
    return { owner: explicit.owner, sharedWith: explicit.sharedWith, isImplicit: false };
  }

  // Aus dem ältesten Vorgang ableiten
  const candidates: { createdAt: string; createdBy?: string }[] = [
    ...contracts.filter((c) => c.customerNumber === kdnr).map((c) => ({ createdAt: c.createdAt, createdBy: c.createdBy })),
    ...tariffChanges.filter((t) => t.customerNumber === kdnr).map((t) => ({ createdAt: t.createdAt, createdBy: t.createdBy })),
    ...notes.filter((n) => n.customerNumber === kdnr).map((n) => ({ createdAt: n.createdAt, createdBy: n.createdBy })),
  ];
  const earliest = candidates
    .filter((x) => x.createdBy)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];

  return {
    owner: earliest?.createdBy ?? null,
    sharedWith: [],
    isImplicit: true,
  };
}

/**
 * Darf der User diesen Kunden bearbeiten (Verträge/Tarife/Notizen anlegen,
 * ändern, löschen, teilen)? Nur Besitzer:in, geteilte Nutzer:innen, Chef:innen
 * oder bei verwaisten Kunden alle. Spiegelt die RLS-Regeln im Backend.
 */
export function canEditCustomer(
  kdnr: string,
  userKey: string | null | undefined,
  isManager: boolean,
  ownerships: Record<string, CustomerOwnership>,
  contracts: Contract[],
  tariffChanges: TariffChange[],
  notes: Note[],
): boolean {
  if (isManager) return true;
  if (!userKey) return false;
  const { owner, sharedWith } = getEffectiveOwnership(kdnr, ownerships, contracts, tariffChanges, notes);
  if (owner === null) return true; // verwaist → für alle bearbeitbar
  if (owner === userKey) return true;
  return sharedWith.includes(userKey);
}

/** Filtert eine Kundenliste nach dem aktuellen User und Modus */
export function filterCustomersByOwnership<T extends { customerNumber: string }>(
  customers: T[],
  userKey: string | null | undefined,
  mode: OwnershipMode,
  ownerships: Record<string, CustomerOwnership>,
  contracts: Contract[],
  tariffChanges: TariffChange[],
  notes: Note[],
): T[] {
  if (!userKey || mode === 'all') return customers;

  return customers.filter((c) => {
    const { owner, sharedWith } = getEffectiveOwnership(
      c.customerNumber, ownerships, contracts, tariffChanges, notes,
    );
    if (mode === 'mine') {
      return owner === userKey || owner === null;
    }
    if (mode === 'shared') {
      return owner !== userKey && sharedWith.includes(userKey);
    }
    return true;
  });
}
