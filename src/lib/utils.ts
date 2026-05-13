import type {
  Contract,
  TariffChange,
  Note,
  Settings,
  ProductType,
  TariffChangeType,
  TariffContext,
  CustomerSummary,
} from '../types';

export const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
  }).format(value);

export const formatDate = (iso?: string): string => {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

export const today = (): string => new Date().toISOString().slice(0, 10);

export const TARIFF_TYPE_LABEL: Record<TariffChangeType, string> = {
  sidegrade: 'Sidegrade / VVL',
  upgrade: 'Upgrade',
};

export const TARIFF_CONTEXT_LABEL: Record<TariffContext, string> = {
  mvlz_gt3: 'Restlaufzeit > 3 Monate',
  mvlz_lt3: 'Restlaufzeit < 3 Monate',
  outside_mvlz: 'Außerhalb MVLZ',
};

export const getProductCommission = (
  settings: Settings,
  product: ProductType,
): number => settings.products.find((p) => p.name === product)?.commission ?? 0;

export const calcContractCommission = (
  contract: Contract,
  settings: Settings,
): number => {
  if (contract.status === 'storniert') return 0;
  return contract.products.reduce(
    (sum, p) => sum + getProductCommission(settings, p),
    0,
  );
};

export const calcTariffCommission = (
  change: TariffChange,
  settings: Settings,
): number =>
  settings.tariffCommission[change.changeType]?.[change.context] ?? 0;

export const isSameMonth = (iso: string, ref = new Date()): boolean => {
  const d = new Date(iso);
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
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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
): CustomerSummary[] => {
  const map = new Map<string, CustomerSummary>();

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

export type FollowUpBucket = 'overdue' | 'today' | 'thisWeek' | 'later';

export const FOLLOW_UP_LABEL: Record<FollowUpBucket, string> = {
  overdue: 'Überfällig',
  today: 'Heute',
  thisWeek: 'Diese Woche',
  later: 'Später',
};

export const followUpBucket = (iso?: string): FollowUpBucket | null => {
  if (!iso) return null;
  const target = new Date(iso);
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
