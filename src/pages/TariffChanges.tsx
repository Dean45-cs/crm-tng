import { useMemo, useState } from 'react';
import { Plus, Search, Pencil, Trash2, Download, ArrowRight } from 'lucide-react';
import { useStore } from '../store/useStore';
import type { TariffChange, ProductType } from '../types';
import {
  calcTariffCommission,
  exportCsv,
  formatCurrency,
  formatDate,
} from '../lib/utils';
import { Modal } from '../components/Modal';
import { JiraLink } from '../components/JiraLink';

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

type Draft = Omit<TariffChange, 'id' | 'createdAt'>;

const emptyDraft = (): Draft => ({
  customerNumber: '',
  customerName: '',
  oldProduct: 'Glasfaser 100',
  newProduct: 'Glasfaser 500',
  oldPrice: 29.9,
  newPrice: 49.9,
  changeDate: new Date().toISOString().slice(0, 10),
  jiraTicket: '',
  notes: '',
});

export function TariffChanges() {
  const {
    tariffChanges,
    settings,
    addTariffChange,
    updateTariffChange,
    deleteTariffChange,
  } = useStore();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return [...tariffChanges]
      .filter((t) =>
        !q
          ? true
          : t.customerName.toLowerCase().includes(q) ||
            t.customerNumber.toLowerCase().includes(q) ||
            t.jiraTicket.toLowerCase().includes(q) ||
            t.oldProduct.toLowerCase().includes(q) ||
            t.newProduct.toLowerCase().includes(q),
      )
      .sort((a, b) => b.changeDate.localeCompare(a.changeDate));
  }, [tariffChanges, search]);

  const openNew = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setOpen(true);
  };

  const openEdit = (t: TariffChange) => {
    setEditingId(t.id);
    setDraft({
      customerNumber: t.customerNumber,
      customerName: t.customerName,
      oldProduct: t.oldProduct,
      newProduct: t.newProduct,
      oldPrice: t.oldPrice,
      newPrice: t.newPrice,
      changeDate: t.changeDate,
      jiraTicket: t.jiraTicket,
      notes: t.notes ?? '',
    });
    setOpen(true);
  };

  const save = () => {
    if (!draft.customerName.trim() || !draft.customerNumber.trim()) return;
    if (editingId) {
      updateTariffChange(editingId, draft);
    } else {
      addTariffChange(draft);
    }
    setOpen(false);
  };

  const remove = (id: string) => {
    if (confirm('Tarifwechsel wirklich löschen?')) deleteTariffChange(id);
  };

  const exportData = () => {
    exportCsv(
      `tarifwechsel-${new Date().toISOString().slice(0, 10)}.csv`,
      filtered.map((t) => ({
        Datum: formatDate(t.changeDate),
        Kundennummer: t.customerNumber,
        Kunde: t.customerName,
        'Alter Tarif': t.oldProduct,
        'Alter Preis (€)': t.oldPrice,
        'Neuer Tarif': t.newProduct,
        'Neuer Preis (€)': t.newPrice,
        Jira: t.jiraTicket,
        'Provision (€)': calcTariffCommission(t, settings),
        Notizen: t.notes ?? '',
      })),
    );
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Tarifwechsel</h2>
          <p>Tarifwechsel von Bestandskunden erfassen und nachhalten.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={exportData} disabled={filtered.length === 0}>
            <Download size={14} /> CSV
          </button>
          <button className="btn btn-primary" onClick={openNew}>
            <Plus size={14} /> Neuer Tarifwechsel
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="search-bar">
            <Search size={14} />
            <input
              placeholder="Kunde, Kundennummer, Jira, Tarif..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="muted" style={{ marginLeft: 'auto' }}>
            {filtered.length} von {tariffChanges.length}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty">
          <h3>Noch keine Tarifwechsel</h3>
          <p>Erfasse den ersten Tarifwechsel eines Bestandskunden.</p>
          <button className="btn btn-primary" onClick={openNew} style={{ marginTop: 12 }}>
            <Plus size={14} /> Neuer Tarifwechsel
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
                <th>Wechsel</th>
                <th>Preisdiff.</th>
                <th>Jira</th>
                <th style={{ textAlign: 'right' }}>Provision</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const diff = t.newPrice - t.oldPrice;
                return (
                  <tr key={t.id}>
                    <td>{formatDate(t.changeDate)}</td>
                    <td><code style={{ fontSize: 12 }}>{t.customerNumber}</code></td>
                    <td>{t.customerName}</td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <span className="badge">{t.oldProduct}</span>
                        <ArrowRight size={12} style={{ color: 'var(--text-tertiary)' }} />
                        <span className="badge badge-blue">{t.newProduct}</span>
                      </div>
                    </td>
                    <td>
                      <span style={{ color: diff >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {diff >= 0 ? '+' : ''}
                        {formatCurrency(diff)}
                      </span>
                    </td>
                    <td><JiraLink ticket={t.jiraTicket} /></td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {formatCurrency(calcTariffCommission(t, settings))}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="row end">
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(t)}>
                          <Pencil size={13} />
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => remove(t.id)}>
                          <Trash2 size={13} color="var(--red)" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? 'Tarifwechsel bearbeiten' : 'Neuer Tarifwechsel'}
        subtitle="Erfasse den Tarifwechsel eines Bestandskunden."
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
            <label>Alter Tarif</label>
            <select
              value={draft.oldProduct}
              onChange={(e) => setDraft({ ...draft, oldProduct: e.target.value as ProductType })}
            >
              {PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Neuer Tarif</label>
            <select
              value={draft.newProduct}
              onChange={(e) => setDraft({ ...draft, newProduct: e.target.value as ProductType })}
            >
              {PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Alter Preis (€)</label>
            <input
              type="number"
              step="0.01"
              value={draft.oldPrice}
              onChange={(e) => setDraft({ ...draft, oldPrice: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="field">
            <label>Neuer Preis (€)</label>
            <input
              type="number"
              step="0.01"
              value={draft.newPrice}
              onChange={(e) => setDraft({ ...draft, newPrice: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="field">
            <label>Wechseldatum</label>
            <input
              type="date"
              value={draft.changeDate}
              onChange={(e) => setDraft({ ...draft, changeDate: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Jira-Vorgang</label>
            <input
              value={draft.jiraTicket}
              onChange={(e) => setDraft({ ...draft, jiraTicket: e.target.value })}
              placeholder="z.B. TNG-1234"
            />
          </div>
          <div className="field full">
            <label>Notizen</label>
            <textarea
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="Optional: Anmerkungen zum Wechsel"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
