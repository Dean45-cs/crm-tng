import type {
  Contract,
  ContractStatus,
  TariffChange,
  Note,
  Settings,
  ProductType,
  TariffChangeType,
  TariffContext,
  CustomerSummary,
  Customer,
} from '../types';
// Provisions-/Produktlogik lebt in der Extension (Stufe 4,
// KONZEPT-INTEGRATION.md: "gemeinsames Paket für Typen und
// Provisionslogik") — einzige Quelle für CRM und Chrome-Extension, damit
// beide Seiten nie mehr manuell in Sync gehalten werden müssen.
//
// Reiner Seiteneffekt-Import statt `import commissionShared from ...`: die
// Datei muss auch als klassisches (Nicht-Modul-)Content-Script der
// Chrome-Extension per <script> geladen werden können, wo `export`-Syntax
// einen SyntaxError auslösen würde. Sie registriert sich deshalb selbst
// unter `globalThis.StadtnetzCRM.commission`, was hier ausgelesen wird —
// funktioniert identisch im Vite-Dev-Server (natives ESM ohne Bundling) und
// im Produktions-Build (Rollup/esbuild).
import '../../extension/src/commission.js';

interface CommissionShared {
  getProductCommission: (settings: Settings, product: ProductType) => number;
  calcContractCommission: (
    contract: Pick<Contract, 'products' | 'status'>,
    settings: Settings,
  ) => number;
  calcTariffCommission: (
    change: Pick<TariffChange, 'changeType' | 'context'>,
    settings: Settings,
  ) => number;
  groupProductsByCategory: (
    products: Settings['products'],
  ) => { category: string; products: Settings['products'] }[];
}

const commissionShared = (
  globalThis as unknown as { StadtnetzCRM: { commission: CommissionShared } }
).StadtnetzCRM.commission;

export const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
  }).format(value);

/**
 * Parst ein ISO-Datum. Reine Datumsstrings (YYYY-MM-DD) werden als lokale
 * Mitternacht interpretiert — `new Date('2024-03-01')` läse sie sonst als
 * UTC und würde in westlichen Zeitzonen auf den Vortag rutschen.
 */
export const parseLocalDate = (iso: string): Date => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(iso);
};

/** Formatiert ein lokales Date-Objekt als TT.MM.JJJJ — ohne UTC-Umweg. */
export const formatDateObj = (d: Date): string =>
  d.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

export const formatDate = (iso?: string): string => {
  if (!iso) return '–';
  return formatDateObj(parseLocalDate(iso));
};

/**
 * Initialen für Avatare: „Anna Becker" → „AB", einteilige Namen → erster
 * Buchstabe. Lag bislang mehrfach parallel in einzelnen Komponenten.
 */
export const initialsOf = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

/** YYYY-MM-DD in lokaler Zeit für ein beliebiges Date (nicht nur heute). */
export const dateKey = (d: Date): string => {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

/** Heutiges Datum als YYYY-MM-DD in lokaler Zeit (nicht UTC). */
export const today = (): string => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

export const TARIFF_TYPE_LABEL: Record<TariffChangeType, string> = {
  sidegrade: 'Sidegrade / VVL',
  upgrade: 'Upgrade',
};

export const TARIFF_CONTEXT_LABEL: Record<TariffContext, string> = {
  mvlz_gt3: 'Restlaufzeit > 3 Monate',
  mvlz_lt3: 'Restlaufzeit < 3 Monate',
  outside_mvlz: 'Außerhalb MVLZ',
};

export const { getProductCommission, calcContractCommission, calcTariffCommission, groupProductsByCategory } =
  commissionShared;

export const isSameMonth = (iso: string, ref = new Date()): boolean => {
  const d = parseLocalDate(iso);
  return (
    d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth()
  );
};

export const monthLabel = (offset = 0): string => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return d.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
};

export const monthKey = (iso: string): string => {
  const d = parseLocalDate(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Montag 00:00 der Woche, in der `ref` liegt (deutsche Wochenzählung). */
export const weekStart = (ref = new Date()): Date => {
  const d = new Date(ref);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=So .. 6=Sa
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
};

/** Sonntag 23:59:59.999 der Woche, in der `ref` liegt. */
export const weekEnd = (ref = new Date()): Date => {
  const e = weekStart(ref);
  e.setDate(e.getDate() + 6);
  e.setHours(23, 59, 59, 999);
  return e;
};

/** true, wenn das ISO-Datum in derselben Montag-Woche wie `ref` liegt. */
export const isSameWeek = (iso: string, ref = new Date()): boolean => {
  const d = parseLocalDate(iso);
  return d >= weekStart(ref) && d <= weekEnd(ref);
};

/** ISO-8601-Kalenderwoche (1..53). */
export const isoWeekNumber = (ref = new Date()): number => {
  const d = new Date(Date.UTC(ref.getFullYear(), ref.getMonth(), ref.getDate()));
  const day = d.getUTCDay() || 7; // Mo=1 .. So=7
  d.setUTCDate(d.getUTCDate() + 4 - day); // Donnerstag dieser Woche
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
};

/** z.B. "KW 21" */
export const weekLabel = (ref = new Date()): string => `KW ${isoWeekNumber(ref)}`;

/** Kopiert Text in die Zwischenablage — mit Fallback für unsichere Kontexte/ältere Browser. */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fällt durch auf den execCommand-Fallback
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};

export const exportCsv = (filename: string, rows: Record<string, unknown>[]) => {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.join(';'),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(';')),
  ].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

/** Aggregiert alle Daten zu Kunden-Übersichten (gruppiert nach Kundennummer) */
export const buildCustomerSummaries = (
  contracts: Contract[],
  tariffChanges: TariffChange[],
  notes: Note[],
  settings: Settings,
  customers: Customer[] = [],
): CustomerSummary[] => {
  const map = new Map<string, CustomerSummary>();

  // Kunden ohne jeglichen Vorgang zuerst eintragen (Nullstand) — ein Anrufer
  // ohne Vertrag/Tarifwechsel/Notiz ist jetzt ein vollwertiger Kunde.
  customers.forEach((c) => {
    if (!c.customerNumber || map.has(c.customerNumber)) return;
    map.set(c.customerNumber, {
      customerNumber: c.customerNumber,
      customerName: c.name || '',
      contractCount: 0,
      tariffChangeCount: 0,
      noteCount: 0,
      totalCommission: 0,
      lastActivity: c.lastContactAt || c.firstSeenAt || '',
    });
  });

  const touch = (kdnr: string, name: string, date: string) => {
    if (!kdnr) return null;
    const existing = map.get(kdnr);
    if (existing) {
      if (date > existing.lastActivity) existing.lastActivity = date;
      if (name && !existing.customerName) existing.customerName = name;
      return existing;
    }
    const fresh: CustomerSummary = {
      customerNumber: kdnr,
      customerName: name,
      contractCount: 0,
      tariffChangeCount: 0,
      noteCount: 0,
      totalCommission: 0,
      lastActivity: date,
    };
    map.set(kdnr, fresh);
    return fresh;
  };

  contracts.forEach((c) => {
    const e = touch(c.customerNumber, c.customerName, c.contractDate);
    if (e) {
      e.contractCount += 1;
      e.totalCommission += calcContractCommission(c, settings);
    }
  });

  tariffChanges.forEach((t) => {
    const e = touch(t.customerNumber, t.customerName, t.changeDate);
    if (e) {
      e.tariffChangeCount += 1;
      e.totalCommission += calcTariffCommission(t, settings);
    }
  });

  notes.forEach((n) => {
    if (!n.customerNumber) return;
    const e = touch(n.customerNumber, n.customerName ?? '', n.updatedAt);
    if (e) e.noteCount += 1;
  });

  return Array.from(map.values()).sort((a, b) =>
    b.lastActivity.localeCompare(a.lastActivity),
  );
};

// ── Vertragslaufzeit / Auslauf-Radar ─────────────────────────────────────────

/** Berechnet das Vertragsende (contractDate + laufzeitMonate). Null = unbefristet. */
export const contractEndDate = (contract: Contract): Date | null => {
  if (!contract.laufzeitMonate) return null;
  const d = parseLocalDate(contract.contractDate);
  const day = d.getDate();
  // Tag erst auf 1 setzen, damit das Monats-Addieren nicht überläuft
  // (z.B. 29.02. + 12 Monate dürfte sonst auf den 01.03. springen).
  d.setDate(1);
  d.setMonth(d.getMonth() + contract.laufzeitMonate);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
};

const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  offen: 'Offen',
  aktiv: 'Aktiv',
  storniert: 'Storniert',
};

/** Baut eine Klartext-Dokumentation eines Vertragsabschlusses zum Einfügen in ein Jira-Ticket. */
export const buildContractJiraDoc = (
  contract: Omit<Contract, 'id' | 'createdAt'>,
  settings: Settings,
): string => {
  const full = contract as Contract;
  const lines: string[] = [
    'Vertragsabschluss',
    `Kunde: ${contract.customerName} (KdNr. ${contract.customerNumber})`,
    `Datum: ${formatDate(contract.contractDate)}`,
    'Produkte:',
    ...contract.products.map(
      (p) => `- ${p} (${formatCurrency(getProductCommission(settings, p))})`,
    ),
    `Provision gesamt: ${formatCurrency(calcContractCommission(full, settings))}`,
  ];

  if (contract.laufzeitMonate) {
    const end = contractEndDate(full);
    lines.push(
      `Laufzeit: ${contract.laufzeitMonate} Monate${end ? ` (Ende: ${formatDateObj(end)})` : ''}`,
    );
  } else {
    lines.push('Laufzeit: Unbefristet');
  }

  lines.push(`Status: ${CONTRACT_STATUS_LABEL[contract.status]}`);
  if (contract.followUpDate) lines.push(`Wiedervorlage: ${formatDate(contract.followUpDate)}`);
  if (contract.jiraTicket) lines.push(`Jira: ${contract.jiraTicket}`);
  if (contract.notes) lines.push(`Notiz: ${contract.notes}`);

  return lines.join('\n');
};

/** Tage bis zu einem Datum (negativ = bereits vergangen). */
export const daysUntil = (d: Date): number => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
};

export type ExpiryBucket = 'soon' | 'medium' | 'later';

/**
 * Ampel-Kategorie für den Auslauf-Radar.
 * soon   = ≤ 30 Tage  (rot)
 * medium = 31–60 Tage (orange)
 * later  = 61–90 Tage (gelb)
 * null   = > 90 Tage, bereits abgelaufen, oder unbefristet
 */
export const expiryBucket = (contract: Contract): ExpiryBucket | null => {
  const end = contractEndDate(contract);
  if (!end) return null;
  const days = daysUntil(end);
  if (days < 0 || days > 90) return null;
  if (days <= 30) return 'soon';
  if (days <= 60) return 'medium';
  return 'later';
};

/** Formatiert die verbleibenden Tage als lesbaren Hinweis. */
export const expiryLabel = (contract: Contract): string => {
  const end = contractEndDate(contract);
  if (!end) return '';
  const days = daysUntil(end);
  if (days < 0) return `vor ${Math.abs(days)} Tagen abgelaufen`;
  if (days === 0) return 'Läuft heute ab';
  if (days === 1) return 'Morgen';
  return `in ${days} Tagen`;
};

export type FollowUpBucket = 'overdue' | 'today' | 'thisWeek' | 'later';

export const FOLLOW_UP_LABEL: Record<FollowUpBucket, string> = {
  overdue: 'Überfällig',
  today: 'Heute',
  thisWeek: 'Diese Woche',
  later: 'Später',
};

export const followUpBucket = (iso?: string): FollowUpBucket | null => {
  if (!iso) return null;
  const target = parseLocalDate(iso);
  target.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  if (diffDays <= 7) return 'thisWeek';
  return 'later';
};
