import { useMemo, useState } from 'react';
import { Plus, Search, Pencil, Trash2, Download } from 'lucide-react';
import { useStore } from '../store/useStore';
import type { ContractStatus } from '../types';
import {
  calcContractCommission,
  exportCsv,
  formatCurrency,
  formatDate,
} from '../lib/utils';
import { JiraLink } from '../components/JiraLink';
import { StatusBadge } from '../components/StatusBadge';
import { useQuickAdd } from '../components/QuickAdd';

export function Contracts() {
  const { contracts, settings, deleteContract } = useStore();
  const { openNewContract, editContract } = useQuickAdd();
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
          <button className="btn btn-primary" onClick={openNewContract}>
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
            <option value="offen">Offen</option>
            <option value="aktiv">Aktiv</option>
            <option value="storniert">Storniert</option>
          </select>
          <div className="muted" style={{ marginLeft: 'auto' }}>
            {filtered.length} von {contracts.length}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty">
          <h3>Noch keine Verträge</h3>
          <p>Tippe unten rechts auf <strong>+</strong> oder hier:</p>
          <button className="btn btn-primary" onClick={openNewContract} style={{ marginTop: 12 }}>
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
                <th>Status</th>
                <th>Jira</th>
                <th>Wiedervorlage</th>
                <th style={{ textAlign: 'right' }}>Provision</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const cat = settings.products.find((p) => p.name === c.product)?.category;
                return (
                  <tr key={c.id}>
                    <td>{formatDate(c.contractDate)}</td>
                    <td><code style={{ fontSize: 12 }}>{c.customerNumber}</code></td>
                    <td>{c.customerName}</td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        {cat && <span className={`cat-chip cat-${cat}`}>{cat}</span>}
                        <span>{c.product}</span>
                      </div>
                    </td>
                    <td><StatusBadge status={c.status} /></td>
                    <td><JiraLink ticket={c.jiraTicket} /></td>
                    <td>{formatDate(c.followUpDate)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {formatCurrency(calcContractCommission(c, settings))}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="row end">
                        <button className="btn btn-ghost btn-sm" onClick={() => editContract(c)}>
                          <Pencil size={13} />
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => remove(c.id)}>
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
    </div>
  );
}
