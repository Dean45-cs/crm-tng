import { useMemo, useState } from 'react';
import { Plus, Search, Pencil, Trash2, Download } from 'lucide-react';
import { useStore } from '../store/useStore';
import type { Contract, ContractStatus, ProductType } from '../types';
import {
  calcContractCommission,
  exportCsv,
  formatCurrency,
  formatDate,
} from '../lib/utils';
import { Modal } from '../components/Modal';
import { JiraLink } from '../components/JiraLink';
import { StatusBadge } from '../components/StatusBadge';

const PRODUCTS: ProductType[] = [
  'Glasfaser 100',
  'Glasfaser 250',
  'Glasfaser 500',
  'Glasfaser 1000',
  'Glasfaser 2000',
  'TV-Paket',
  'Telefon-Flat',
  'Mobilfunk',
];

const STATUSES: ContractStatus[] = ['offen', 'aktiv', 'storniert'];

type Draft = Omit<Contract, 'id' | 'createdAt'>;

const emptyDraft = (): Draft => ({
  customerNumber: '',
  customerName: '',
  product: 'Glasfaser 250',
  monthlyPrice: 39.9,
  contractDate: new Date().toISOString().slice(0, 10),
  status: 'offen',
  jiraTicket: '',
  followUpDate: '',
  notes: '',
});

export function Contracts() {
  const { contracts, settings, addContract, updateContract, deleteContract } =
    useStore();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'alle' | ContractStatus>('alle');

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return [...contracts]
      .filter((c) => statusFilter === 'alle' || c.status === statusFilter)
      .filter((c) =>
        !q
          ? true
          : c.customerName.toLowerCase().includes(q) ||
            c.customerNumber.toLowerCase().includes(q) ||
            c.jiraTicket.toLowerCase().includes(q) ||
            c.product.toLowerCase().includes(q),
      )
      .sort((a, b) => b.contractDate.localeCompare(a.contractDate));
  }, [contracts, search, statusFilter]);

  const openNew = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setOpen(true);
  };

  const openEdit = (c: Contract) => {
    setEditingId(c.id);
    setDraft({
      customerNumber: c.customerNumber,
      customerName: c.customerName,
      product: c.product,
      monthlyPrice: c.monthlyPrice,
      contractDate: c.contractDate,
      status: c.status,
      jiraTicket: c.jiraTicket,
      followUpDate: c.followUpDate ?? '',
      notes: c.notes ?? '',
    });
    setOpen(true);
  };

  const save = () => {
    if (!draft.customerName.trim() || !draft.customerNumber.trim()) return;
    if (editingId) {
      updateContract(editingId, draft);
    } else {
      addContract(draft);
    }
    setOpen(false);
  };

  const remove = (id: string) => {
    if (confirm('Vertrag wirklich löschen?')) deleteContract(id);
  };

  const exportData = () => {
    exportCsv(
      `vertraege-${new Date().toISOString().slice(0, 10)}.csv`,
      filtered.map((c) => ({
        Datum: formatDate(c.contractDate),
        Kundennummer: c.customerNumber,
        Kunde: c.customerName,
        Produkt: c.product,
        'Monatspreis (€)': c.monthlyPrice,
        Status: c.status,
        Jira: c.jiraTicket,
        Wiedervorlage: formatDate(c.followUpDate),
        'Provision (€)': calcContractCommission(c, settings),
        Notizen: c.notes ?? '',
      })),
    );
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Verträge</h2>
          <p>Verkaufte Verträge und Neuabschlüsse verwalten.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={exportData} disabled={filtered.length === 0}>
            <Download size={14} /> CSV
          </button>
          <button className="btn btn-primary" onClick={openNew}>
            <Plus size={14} /> Neuer Vertrag
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="search-bar">
            <Search size={14} />
            <input
              placeholder="Kunde, Kundennummer, Jira, Produkt..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'alle' | ContractStatus)}
            style={{
              padding: '7px 10px',
              borderRadius: 8,
              border: '1px solid var(--border-strong)',
              background: 'var(--bg-card)',
              fontSize: 13,
            }}
          >
            <option value="alle">Alle Status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
          <div className="muted" style={{ marginLeft: 'auto' }}>
            {filtered.length} von {contracts.length}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty">
          <h3>Noch keine Verträge</h3>
          <p>Lege deinen ersten verkauften Vertrag an.</p>
          <button className="btn btn-primary" onClick={openNew} style={{ marginTop: 12 }}>
            <Plus size={14} /> Neuer Vertrag
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Datum</th>
                <th>KdNr.</th>
                <th>Kunde</th>
                <th>Produkt</th>
                <th>Preis/Mt.</th>
                <th>Status</th>
                <th>Jira</th>
                <th>Wiedervorlage</th>
                <th style={{ textAlign: 'right' }}>Provision</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td>{formatDate(c.contractDate)}</td>
                  <td><code style={{ fontSize: 12 }}>{c.customerNumber}</code></td>
                  <td>{c.customerName}</td>
                  <td>{c.product}</td>
                  <td>{formatCurrency(c.monthlyPrice)}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td><JiraLink ticket={c.jiraTicket} /></td>
                  <td>{formatDate(c.followUpDate)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    {formatCurrency(calcContractCommission(c, settings))}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="row end">
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(c)}>
                        <Pencil size={13} />
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => remove(c.id)}>
                        <Trash2 size={13} color="var(--red)" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? 'Vertrag bearbeiten' : 'Neuer Vertrag'}
        subtitle="Erfasse alle relevanten Daten für deinen Verkauf."
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>
              Abbrechen
            </button>
            <button className="btn btn-primary" onClick={save}>
              Speichern
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field">
            <label>Kundennummer *</label>
            <input
              value={draft.customerNumber}
              onChange={(e) => setDraft({ ...draft, customerNumber: e.target.value })}
              placeholder="z.B. 1234567"
            />
          </div>
          <div className="field">
            <label>Kunde *</label>
            <input
              value={draft.customerName}
              onChange={(e) => setDraft({ ...draft, customerName: e.target.value })}
              placeholder="Max Mustermann"
            />
          </div>
          <div className="field">
            <label>Produkt</label>
            <select
              value={draft.product}
              onChange={(e) => setDraft({ ...draft, product: e.target.value as ProductType })}
            >
              {PRODUCTS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Monatspreis (€)</label>
            <input
              type="number"
              step="0.01"
              value={draft.monthlyPrice}
              onChange={(e) =>
                setDraft({ ...draft, monthlyPrice: parseFloat(e.target.value) || 0 })
              }
            />
          </div>
          <div className="field">
            <label>Vertragsdatum</label>
            <input
              type="date"
              value={draft.contractDate}
              onChange={(e) => setDraft({ ...draft, contractDate: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Status</label>
            <select
              value={draft.status}
              onChange={(e) =>
                setDraft({ ...draft, status: e.target.value as ContractStatus })
              }
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Jira-Vorgang</label>
            <input
              value={draft.jiraTicket}
              onChange={(e) => setDraft({ ...draft, jiraTicket: e.target.value })}
              placeholder="z.B. TNG-1234"
            />
          </div>
          <div className="field">
            <label>Wiedervorlage</label>
            <input
              type="date"
              value={draft.followUpDate}
              onChange={(e) => setDraft({ ...draft, followUpDate: e.target.value })}
            />
          </div>
          <div className="field full">
            <label>Notizen</label>
            <textarea
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="Optional: Anmerkungen zum Vertrag"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
