import { useMemo, useState } from 'react';
import { KeyRound, Check, X, Lock, Clock, ChevronRight } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { useRouter } from '../router';

/**
 * Posteingang für Zugriffsanfragen: zeigt offene Anfragen, die an den/die
 * angemeldete:n Besitzer:in (oder eine:n Chef:in) gerichtet sind. Ohne
 * `customerNumber` für das Dashboard (alle Kunden), mit für eine Kundenseite.
 * Rendert nichts, wenn keine offenen Anfragen vorliegen.
 */
export function AccessRequestInbox({ customerNumber }: { customerNumber?: string }) {
  const accessRequests = useStore((s) => s.accessRequests);
  const approve = useStore((s) => s.approveCustomerAccess);
  const reject = useStore((s) => s.rejectCustomerAccess);
  const { currentUserKey, users, isManager } = useAuth();
  const { navigate } = useRouter();
  const manager = isManager();

  const pending = useMemo(
    () =>
      accessRequests.filter(
        (r) =>
          r.status === 'pending' &&
          (customerNumber ? r.customerNumber === customerNumber : true) &&
          (r.ownerId === currentUserKey || manager),
      ),
    [accessRequests, customerNumber, currentUserKey, manager],
  );

  if (pending.length === 0) return null;

  return (
    <div className="widget access-inbox">
      <div className="row between" style={{ marginBottom: 10 }}>
        <h3 className="widget-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <KeyRound size={15} />
          Zugriffsanfragen
        </h3>
        <span className="muted">{pending.length} offen</span>
      </div>
      <div className="access-req-list">
        {pending.map((r) => {
          const requester = users[r.requesterId]?.displayName ?? 'Unbekannt';
          return (
            <div key={r.id} className="access-req-item">
              <div className="access-req-body">
                <div className="access-req-head">
                  <strong>{requester}</strong> möchte Zugriff auf{' '}
                  {customerNumber ? (
                    <code>{r.customerNumber}</code>
                  ) : (
                    <button
                      type="button"
                      className="access-req-kdnr"
                      onClick={() => navigate({ name: 'customer', kdnr: r.customerNumber })}
                    >
                      <code>{r.customerNumber}</code>
                      <ChevronRight size={12} />
                    </button>
                  )}
                </div>
                {r.comment && <div className="access-req-comment">„{r.comment}"</div>}
              </div>
              <div className="access-req-actions">
                <button className="btn btn-sm btn-primary" onClick={() => approve(r)}>
                  <Check size={13} /> Annehmen
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => reject(r)}>
                  <X size={13} /> Ablehnen
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Hinweis-/Anfrage-Banner für die Kundenseite, wenn der/die angemeldete Nutzer:in
 * nur Lesezugriff hat. Bietet an, mit Begründung Bearbeitungszugriff anzufragen.
 */
export function AccessRequestBanner({
  customerNumber,
  ownerId,
  ownerName,
}: {
  customerNumber: string;
  ownerId?: string;
  ownerName?: string;
}) {
  const accessRequests = useStore((s) => s.accessRequests);
  const requestAccess = useStore((s) => s.requestCustomerAccess);
  const { currentUserKey } = useAuth();
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);

  const myRequest = accessRequests.find(
    (r) => r.customerNumber === customerNumber && r.requesterId === currentUserKey,
  );
  const pending = myRequest?.status === 'pending';

  const submit = async () => {
    if (!comment.trim()) return;
    setSending(true);
    await requestAccess(customerNumber, ownerId, comment);
    setSending(false);
    setComment('');
  };

  return (
    <div className="access-banner">
      <div className="access-banner-head">
        <Lock size={16} />
        <div>
          <div className="access-banner-title">Nur Lesezugriff</div>
          <div className="access-banner-sub">
            {ownerName ? (
              <>
                Dieser Kunde gehört <strong>{ownerName}</strong>.
              </>
            ) : (
              <>Dieser Kunde ist einer:m Kolleg:in zugeordnet.</>
            )}{' '}
            Zum Bearbeiten kannst du mit kurzer Begründung Zugriff anfragen.
          </div>
        </div>
      </div>
      {pending ? (
        <div className="access-banner-pending">
          <Clock size={13} /> Anfrage gesendet – warte auf Freigabe.
        </div>
      ) : (
        <div className="access-banner-form">
          <input
            className="access-banner-input"
            placeholder="Warum brauchst du Zugriff? (z.B. Kunde hat mich direkt angerufen)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={200}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={sending || !comment.trim()}
            onClick={submit}
          >
            <KeyRound size={13} /> Zugriff anfragen
          </button>
        </div>
      )}
    </div>
  );
}
