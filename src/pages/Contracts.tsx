import { useMemo, useState } from 'react';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Download,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from 'lucide-react';
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

type SortKey = 'date' | 'customer' | 'commission';
type SortDir = 'asc' | 'desc';

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown size={12} className="sort-icon" />;
  return dir === 'desc' ? (
    <ChevronDown size={12} className="sort-icon active" />
  ) : (
    <ChevronUp size={12} className="sort-icon active" />
  );
}

export function Contracts() {
  const { contracts, settings, deleteContract } = useStore();
  const { openNewContract, editContract } = useQuickAdd();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'alle' | ContractStatus>('alle');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list = contracts
      .filter((c) => statusFilter === 'alle' || c.status === statusFilter)
      .filter((c) =>
        !q
          ? true
          : c.customerName.toLowerCase().includes(q) ||
            c.customerNumber.toLowerCase().includes(q) ||
            c.jiraTicket.toLowerCase().includes(q) ||
            c.products.some((p) => p.toLowerCase().includes(q)),
      );

    const sign = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortKey === 'date') return sign * a.contractDate.localeCompare(b.contractDate);
      if (sortKey === 'customer') return sign * a.customerName.localeCompare(b.customerName, 'de');
      const ca = calcContractCommission(a, settings);
      const cb = calcContractCommission(b, settings);
      return sign * (ca - cb);
    });
  }, [contracts, search, statusFilter, sortKey, sortDir, settings]);

  const filteredTotal = useMemo(
    () => filtered.reduce((s, c) => s + calcContractCommission(c, settings), 0),
    [filtered, settings],
  );

  const storniertCount = useMemo(
    () => filtered.filter((c) => c.status === 'storniert').length,
    [filtered],
  );

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
        Produkte: c.products.join(' + '),
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
          <p>Verkaufte Verträge und Neuabschlüsse – auch als Bundle.</p>
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

      <div className="card-soft" style={{ padding: 14, marginBottom: 16 }}>
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
            className="select-pill"
          >
            <option value="alle">Alle Status</option>
            <option value="offen">Offen</option>
            <option value="aktiv">Aktiv</option>
            <option value="storniert">Storniert</option>
          </select>
          <div
            className="row"
            style={{ marginLeft: 'auto', gap: 12, alignItems: 'center' }}
          >
            {statusFilter === 'alle' && storniertCount > 0 && (
              <span className="badge badge-red" style={{ fontSize: 11 }}>
                {storniertCount} storniert
              </span>
            )}
            <span className="muted">
              {filtered.length} von {contracts.length}
            </span>
            <span
              style={{
                fontWeight: 600,
                color: 'var(--tng-blue-dark)',
                fontSize: 13,
              }}
            >
              Σ {formatCurrency(filteredTotal)}
            </span>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card-soft empty">
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
                <th>
                  <button className="sort-th" onClick={() => toggleSort('date')}>
                    Datum <SortIcon active={sortKey === 'date'} dir={sortDir} />
                  </button>
                </th>
                <th>KdNr.</th>
                <th>
                  <button className="sort-th" onClick={() => toggleSort('customer')}>
                    Kunde <SortIcon active={sortKey === 'customer'} dir={sortDir} />
                  </button>
                </th>
                <th>Produkte</th>
                <th>Status</th>
                <th>Jira</th>
                <th>Wiedervorlage</th>
                <th style={{ textAlign: 'right' }}>
                  <button
                    className="sort-th"
                    onClick={() => toggleSort('commission')}
                    style={{ marginLeft: 'auto' }}
                  >
                    Provision <SortIcon active={sortKey === 'commission'} dir={sortDir} />
                  </button>
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  className={c.status === 'storniert' ? 'row-storniert' : ''}
                >
                  <td>{formatDate(c.contractDate)}</td>
                  <td><code style={{ fontSize: 12 }}>{c.customerNumber}</code></td>
                  <td>{c.customerName}</td>
                  <td>
                    <div className="product-chips">
                      {c.products.slice(0, 2).map((p) => {
                        const cat = settings.products.find((x) => x.name === p)?.category;
                        return (
                          <span key={p} className={`product-chip cat-${cat}`}>
                            {p}
                          </span>
                        );
                      })}
                      {c.products.length > 2 && (
                        <span className="product-chip product-chip-more">
                          +{c.products.length - 2}
                        </span>
                      )}
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
              ))}
            </tbody>
            <tfoot>
              <tr className="table-footer-row">
                <td colSpan={7} style={{ textAlign: 'right' }}>
                  {filtered.length} Vertrag{filtered.length !== 1 ? 'sätze' : ''} · Provision gesamt
                </td>
                <td style={{ textAlign: 'right', color: 'var(--tng-blue-dark)' }}>
                  {formatCurrency(filteredTotal)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
