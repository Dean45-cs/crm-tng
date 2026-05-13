import { useMemo, useState } from 'react';
import { Search, ChevronRight, Users } from 'lucide-react';
import { useStore } from '../store/useStore';
import {
  buildCustomerSummaries,
  formatCurrency,
  formatDate,
} from '../lib/utils';
import { useRouter } from '../router';

export function Customers() {
  const { contracts, tariffChanges, notes, settings } = useStore();
  const { navigate } = useRouter();
  const [search, setSearch] = useState('');

  const customers = useMemo(
    () => buildCustomerSummaries(contracts, tariffChanges, notes, settings),
    [contracts, tariffChanges, notes, settings],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.customerNumber.toLowerCase().includes(q) ||
        c.customerName.toLowerCase().includes(q),
    );
  }, [customers, search]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Kunden</h2>
          <p>Alle Kunden mit zusammengefassten Vorgängen und Provision.</p>
        </div>
      </div>

      <div className="card-soft" style={{ padding: 14, marginBottom: 16 }}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="search-bar">
            <Search size={14} />
            <input
              placeholder="Name oder Kundennummer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="muted" style={{ marginLeft: 'auto' }}>
            {filtered.length} {filtered.length === 1 ? 'Kunde' : 'Kunden'}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card-soft empty">
          <Users size={28} strokeWidth={1.5} style={{ opacity: 0.4 }} />
          <h3>Noch keine Kunden</h3>
          <p>Sobald du Verträge, Tarifwechsel oder Notizen mit Kundennummer anlegst, erscheinen sie hier.</p>
        </div>
      ) : (
        <div className="customer-grid">
          {filtered.map((c) => (
            <button
              key={c.customerNumber}
              className="customer-card"
              onClick={() => navigate({ name: 'customer', kdnr: c.customerNumber })}
            >
              <div className="customer-avatar">
                {(c.customerName || c.customerNumber).slice(0, 2).toUpperCase()}
              </div>
              <div className="customer-card-body">
                <div className="customer-name">{c.customerName || '–'}</div>
                <div className="customer-kdnr">
                  KdNr. <code>{c.customerNumber}</code>
                </div>
                <div className="customer-meta">
                  <span>
                    <strong>{c.contractCount}</strong> Verträge
                  </span>
                  <span>
                    <strong>{c.tariffChangeCount}</strong> Wechsel
                  </span>
                  <span>
                    <strong>{c.noteCount}</strong> Notizen
                  </span>
                </div>
              </div>
              <div className="customer-card-right">
                <div className="customer-commission">
                  {formatCurrency(c.totalCommission)}
                </div>
                <div className="muted" style={{ fontSize: 11.5 }}>
                  {formatDate(c.lastActivity)}
                </div>
                <ChevronRight size={16} className="customer-chevron" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
