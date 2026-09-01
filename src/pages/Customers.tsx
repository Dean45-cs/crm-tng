import { useMemo, useState } from 'react';
import { Search, ChevronRight, Users, User as UserIcon, Share2, Globe } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import {
  buildCustomerSummaries,
  formatCurrency,
  formatDate,
} from '../lib/utils';
import {
  filterCustomersByOwnership,
  getEffectiveOwnership,
  type OwnershipMode,
} from '../lib/customerOwnership';
import { SkeletonCardGrid } from '../components/Skeleton';
import { useRouter } from '../router';

export function Customers() {
  const { contracts, tariffChanges, notes, settings, customerOwners, loaded, customers: customerRows } = useStore();
  const { currentUserKey, users } = useAuth();
  const { navigate } = useRouter();
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<OwnershipMode>('mine');

  const allCustomers = useMemo(
    () => buildCustomerSummaries(contracts, tariffChanges, notes, settings, customerRows),
    [contracts, tariffChanges, notes, settings, customerRows],
  );

  const visibleCustomers = useMemo(
    () =>
      filterCustomersByOwnership(
        allCustomers, currentUserKey, mode,
        customerOwners, contracts, tariffChanges, notes,
      ),
    [allCustomers, currentUserKey, mode, customerOwners, contracts, tariffChanges, notes],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return visibleCustomers;
    return visibleCustomers.filter(
      (c) =>
        c.customerNumber.toLowerCase().includes(q) ||
        c.customerName.toLowerCase().includes(q),
    );
  }, [visibleCustomers, search]);

  // Counts pro Modus für die Tab-Badges
  const counts = useMemo(() => {
    const mine = filterCustomersByOwnership(allCustomers, currentUserKey, 'mine', customerOwners, contracts, tariffChanges, notes).length;
    const shared = filterCustomersByOwnership(allCustomers, currentUserKey, 'shared', customerOwners, contracts, tariffChanges, notes).length;
    return { mine, shared, all: allCustomers.length };
  }, [allCustomers, currentUserKey, customerOwners, contracts, tariffChanges, notes]);

  if (!loaded) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h2>Kunden</h2>
            <p>Deine Kunden und alle, mit denen Kolleg:innen dich verknüpft haben.</p>
          </div>
        </div>
        <SkeletonCardGrid count={6} />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Kunden</h2>
          <p>Deine Kunden und alle, mit denen Kolleg:innen dich verknüpft haben.</p>
        </div>
      </div>

      <div className="ownership-tabs">
        <button
          className={`ownership-tab ${mode === 'mine' ? 'active' : ''}`}
          onClick={() => setMode('mine')}
        >
          <UserIcon size={13} /> Meine Kunden
          <span className="ownership-tab-count">{counts.mine}</span>
        </button>
        <button
          className={`ownership-tab ${mode === 'shared' ? 'active' : ''}`}
          onClick={() => setMode('shared')}
        >
          <Share2 size={13} /> Mit mir geteilt
          <span className="ownership-tab-count">{counts.shared}</span>
        </button>
        <button
          className={`ownership-tab ${mode === 'all' ? 'active' : ''}`}
          onClick={() => setMode('all')}
        >
          <Globe size={13} /> Alle
          <span className="ownership-tab-count">{counts.all}</span>
        </button>
      </div>

      <div className="widget" style={{ padding: 10, marginBottom: 10 }}>
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
        <div className="widget empty">
          <Users size={32} strokeWidth={1.4} className="empty-icon" />
          <h3>
            {search
              ? 'Keine Treffer'
              : mode === 'mine'
                ? 'Noch keine eigenen Kunden'
                : mode === 'shared'
                  ? 'Niemand hat Kunden mit dir geteilt'
                  : 'Noch keine Kunden'}
          </h3>
          <p>
            {search
              ? 'Versuche es mit einem anderen Suchbegriff.'
              : mode === 'mine'
                ? 'Sobald du einen Vertrag oder Tarifwechsel anlegst, erscheint der Kunde automatisch hier.'
                : mode === 'shared'
                  ? 'Bitte deine Kolleg:innen, dich in einer Kundenkarte als Teilnehmer hinzuzufügen.'
                  : 'Sobald jemand Vorgänge mit Kundennummer anlegt, erscheinen sie hier.'}
          </p>
        </div>
      ) : (
        <div className="customer-grid">
          {filtered.map((c) => {
            const ownership = getEffectiveOwnership(
              c.customerNumber, customerOwners, contracts, tariffChanges, notes,
            );
            const ownerUser = ownership.owner ? users[ownership.owner] : null;
            const isMine = ownership.owner === currentUserKey;
            const isShared = !isMine && ownership.owner !== null;
            return (
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
                  <div className="customer-owner-row">
                    {ownership.owner === null ? (
                      <span className="customer-owner-tag unowned">
                        <Globe size={10} /> Verwaist
                      </span>
                    ) : isMine ? (
                      <span className="customer-owner-tag mine">
                        <UserIcon size={10} /> Du
                        {ownership.sharedWith.length > 0 && (
                          <> · geteilt mit {ownership.sharedWith.length}</>
                        )}
                      </span>
                    ) : (
                      <span className={`customer-owner-tag ${isShared && ownership.sharedWith.includes(currentUserKey ?? '') ? 'shared' : ''}`}>
                        <UserIcon size={10} /> {ownerUser?.displayName ?? ownership.owner}
                      </span>
                    )}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
