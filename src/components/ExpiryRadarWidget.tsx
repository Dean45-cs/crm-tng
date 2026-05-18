import { useMemo } from 'react';
import { Radar, ChevronRight } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { useRouter } from '../router';
import {
  calcContractCommission,
  contractEndDate,
  daysUntil,
  expiryBucket,
  expiryLabel,
  formatCurrency,
} from '../lib/utils';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');
}

/**
 * Dashboard-Widget: zeigt alle Teamverträge die in ≤ 90 Tagen ablaufen.
 * Alle Nutzer sehen alle Verträge (geteilte Leads) – kein userKey-Filter.
 */
export function ExpiryRadarWidget() {
  const { contracts, settings } = useStore();
  const { users } = useAuth();
  const { navigate } = useRouter();

  const expiring = useMemo(() => {
    return contracts
      .filter((c) => c.status !== 'storniert' && expiryBucket(c) !== null)
      .sort((a, b) => {
        const da = daysUntil(contractEndDate(a)!);
        const db = daysUntil(contractEndDate(b)!);
        return da - db;
      })
      .slice(0, 8);
  }, [contracts]);

  if (expiring.length === 0) return null;

  const bucketCounts = {
    soon: expiring.filter((c) => expiryBucket(c) === 'soon').length,
    medium: expiring.filter((c) => expiryBucket(c) === 'medium').length,
    later: expiring.filter((c) => expiryBucket(c) === 'later').length,
  };

  return (
    <div className="widget" style={{ marginBottom: 14 }}>
      <div className="row between" style={{ marginBottom: 4 }}>
        <h3
          className="widget-title"
          style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Radar size={15} /> Auslaufende Verträge
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {bucketCounts.soon > 0 && (
            <span className="expiry-summary-pill soon">{bucketCounts.soon}</span>
          )}
          {bucketCounts.medium > 0 && (
            <span className="expiry-summary-pill medium">{bucketCounts.medium}</span>
          )}
          {bucketCounts.later > 0 && (
            <span className="expiry-summary-pill later">{bucketCounts.later}</span>
          )}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => navigate({ name: 'contracts' })}
          >
            Alle <ChevronRight size={13} />
          </button>
        </div>
      </div>

      <div className="expiry-radar-list">
        {expiring.map((c) => {
          const bucket = expiryBucket(c)!;
          const label = expiryLabel(c);
          const com = calcContractCommission(c, settings);
          const owner = c.createdBy ? Object.values(users).find((u) => u.key === c.createdBy) : null;
          const ownerName = owner?.displayName ?? '';

          return (
            <div key={c.id} className="expiry-radar-row">
              <span className={`expiry-dot ${bucket}`} title={label} />
              <div className="expiry-radar-customer">
                <span className="expiry-radar-name">{c.customerName}</span>
                <span className="expiry-radar-kdnr">{c.customerNumber}</span>
              </div>
              {com > 0 && (
                <span className="expiry-radar-com">{formatCurrency(com)}</span>
              )}
              {ownerName && (
                <span className="expiry-radar-avatar" title={ownerName}>
                  {initials(ownerName)}
                </span>
              )}
              <span className={`expiry-days-pill ${bucket}`}>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
