import type { ContractStatus } from '../types';

const LABELS: Record<ContractStatus, string> = {
  offen: 'Offen',
  aktiv: 'Aktiv',
  storniert: 'Storniert',
};

const CLASSES: Record<ContractStatus, string> = {
  offen: 'badge-orange',
  aktiv: 'badge-green',
  storniert: 'badge-red',
};

export function StatusBadge({ status }: { status: ContractStatus }) {
  return <span className={`badge ${CLASSES[status]}`}>{LABELS[status]}</span>;
}
