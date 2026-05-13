import type { Contract, TariffChange, Settings, ProductType } from '../types';

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

export const getRateFor = (
  settings: Settings,
  product: ProductType,
): { newContract: number; tariffChange: number } => {
  const rate = settings.commissionRates.find((r) => r.product === product);
  return rate ?? { newContract: 0, tariffChange: 0 };
};

export const calcContractCommission = (
  contract: Contract,
  settings: Settings,
): number => {
  if (contract.status === 'storniert') return 0;
  return getRateFor(settings, contract.product).newContract;
};

export const calcTariffCommission = (
  change: TariffChange,
  settings: Settings,
): number => getRateFor(settings, change.newProduct).tariffChange;

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
