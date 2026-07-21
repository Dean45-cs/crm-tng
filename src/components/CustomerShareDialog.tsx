import { useMemo } from 'react';
import { X, Check, UserIcon, Crown, ArrowRightLeft } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { getEffectiveOwnership } from '../lib/customerOwnership';

interface Props {
  customerNumber: string;
  customerName: string;
  onClose: () => void;
}

export function CustomerShareDialog({ customerNumber, customerName, onClose }: Props) {
  const {
    contracts,
    tariffChanges,
    notes,
    customerOwners,
    setCustomerOwner,
    shareCustomer,
    unshareCustomer,
    transferCustomer,
  } = useStore();
  const { users, currentUserKey, isManager } = useAuth();

  const ownership = useMemo(
    () => getEffectiveOwnership(customerNumber, customerOwners, contracts, tariffChanges, notes),
    [customerNumber, customerOwners, contracts, tariffChanges, notes],
  );

  const allUsers = Object.values(users).sort((a, b) =>
    a.displayName.localeCompare(b.displayName, 'de'),
  );

  const isOwner = ownership.owner === currentUserKey;
  // Chef:innen dürfen Freigaben fremder Kunden verwalten — die RLS erlaubt
  // ihnen das ausdrücklich (siehe „ownership update owner or manager").
  const canManage = isOwner || ownership.owner === null || isManager();

  const toggleShare = (userKey: string) => {
    if (!canManage) return;
    const isShared = ownership.sharedWith.includes(userKey);
    if (isShared) {
      unshareCustomer(customerNumber, userKey);
    } else {
      // shareCustomer löst implizite Besitzverhältnisse selbst auf und
      // schreibt Owner + Freigabe in einem einzigen Upsert.
      shareCustomer(customerNumber, userKey);
    }
  };

  const transferOwnership = (newOwnerKey: string) => {
    if (!canManage) return;
    if (!confirm(`Besitz an ${users[newOwnerKey]?.displayName} übertragen? Die bisherige Besitzer:in wird dann als geteilte:r Nutzer:in geführt.`)) return;
    transferCustomer(customerNumber, newOwnerKey);
  };

  const claimOwnership = () => {
    if (!currentUserKey) return;
    setCustomerOwner(customerNumber, currentUserKey);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <h3>Kunde teilen</h3>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
              {customerName || '–'} · KdNr <code>{customerNumber}</code>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Schließen">
            <X size={15} />
          </button>
        </div>

        <div>
          {ownership.owner === null ? (
            <div className="share-banner">
              <p>
                Diesem Kunden ist noch kein:e Besitzer:in zugeordnet.
                Du kannst den Besitz übernehmen und dann mit Kolleg:innen teilen.
              </p>
              <button className="btn btn-primary" onClick={claimOwnership}>
                Besitz übernehmen
              </button>
            </div>
          ) : !canManage ? (
            <div className="share-banner muted-banner">
              <p>
                Du kannst diesen Kunden nicht verwalten – nur die:der Besitzer:in
                ({users[ownership.owner]?.displayName ?? ownership.owner}) kann Freigaben ändern.
              </p>
            </div>
          ) : null}

          <div className="share-list">
            {allUsers.map((u) => {
              const isUserOwner = u.key === ownership.owner;
              const isUserShared = ownership.sharedWith.includes(u.key);
              const isMe = u.key === currentUserKey;
              const initials = u.displayName.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
              return (
                <div key={u.key} className="share-row">
                  <div className="share-row-left">
                    <div className="share-avatar">{initials}</div>
                    <div>
                      <div className="share-name">
                        {u.displayName}
                        {isMe && <span className="muted" style={{ marginLeft: 6, fontSize: 11.5 }}>(Du)</span>}
                      </div>
                      <div className="share-status">
                        {isUserOwner ? (
                          <span className="share-tag owner"><Crown size={10} /> Besitzer:in</span>
                        ) : isUserShared ? (
                          <span className="share-tag shared"><Check size={10} /> Hat Zugriff</span>
                        ) : (
                          <span className="muted" style={{ fontSize: 11.5 }}>Kein Zugriff</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="share-row-right">
                    {!isUserOwner && canManage && (
                      <>
                        <button
                          className={`share-toggle ${isUserShared ? 'on' : ''}`}
                          onClick={() => toggleShare(u.key)}
                          aria-label={isUserShared ? 'Freigabe entfernen' : 'Freigeben'}
                        >
                          <span className="share-toggle-thumb" />
                        </button>
                        {isUserShared && (
                          <button
                            className="btn btn-ghost btn-sm"
                            title="Besitz übertragen"
                            onClick={() => transferOwnership(u.key)}
                          >
                            <ArrowRightLeft size={12} />
                          </button>
                        )}
                      </>
                    )}
                    {isUserOwner && (
                      <UserIcon size={14} style={{ color: 'var(--text-tertiary)' }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="share-hint">
            Geteilte Kunden erscheinen bei den Empfängern unter „Mit mir geteilt".
            Sie können ebenfalls Verträge und Notizen lesen und bearbeiten.
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>Fertig</button>
        </div>
      </div>
    </div>
  );
}
