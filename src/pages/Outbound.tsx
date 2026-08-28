import { useEffect, useMemo, useState } from 'react';
import {
  PhoneCall,
  Phone,
  MapPin,
  Hash,
  Info,
  Megaphone,
  ListChecks,
  Crosshair,
  Search,
  UserPlus,
  UserMinus,
  CheckCircle2,
  CalendarClock,
  Coins,
  Trash2,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { useQuickAdd } from '../components/QuickAdd';
import { Modal } from '../components/Modal';
import { CallResultPanel } from '../components/CallResultPanel';
import {
  workQueue,
  campaignStats,
  contactBonus,
  agentBonus,
  CONTACT_STATUS_LABEL,
  isClosed,
} from '../lib/outbound';
import { formatCurrency, formatDate, today } from '../lib/utils';
import type { CallResult } from '../lib/outbound';
import type { CampaignCallType, OutboundContact, OutboundContactStatus } from '../types';

/** Kurzform des Call-Typs — gleiche Beschriftung wie in der Kampagnen-Verwaltung. */
const CALL_TYPE_SHORT: Record<CampaignCallType, string> = {
  churn: 'Churn',
  welcome: 'Welcome',
  prl: 'PRL',
  dupe: 'Dupe',
  bvw: 'BVW',
  courtesy: 'Courtesy',
  other: 'Sonstige',
};

type ViewMode = 'focus' | 'list';

/** Farbklasse je Status — hält Liste und Fokusmodus konsistent. */
const STATUS_BADGE: Record<OutboundContactStatus, string> = {
  offen: 'badge-blue',
  wiedervorlage: 'badge-orange',
  nichtErreicht: 'badge-orange',
  termin: 'badge-green',
  abschluss: 'badge-green',
  keinInteresse: 'badge-red',
  falscheDaten: 'badge-red',
  sperren: 'badge-red',
};

const FILTERS: { key: 'work' | 'all' | OutboundContactStatus; label: string }[] = [
  { key: 'work', label: 'Zu tun' },
  { key: 'all', label: 'Alle' },
  { key: 'termin', label: 'Termine' },
  { key: 'abschluss', label: 'Abschlüsse' },
  { key: 'wiedervorlage', label: 'Wiedervorlage' },
  { key: 'nichtErreicht', label: 'Nicht erreicht' },
  { key: 'keinInteresse', label: 'Kein Interesse' },
];

/** Kontaktdaten-Zeile mit Telefon als Wählen-Link. */
function ContactFacts({ contact }: { contact: OutboundContact }) {
  const address = [contact.street, [contact.zip, contact.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  return (
    <div className="outbound-facts">
      {contact.phone && (
        <a className="outbound-phone" href={`tel:${contact.phone.replace(/\s/g, '')}`}>
          <Phone size={15} /> {contact.phone}
        </a>
      )}
      {contact.customerNumber && (
        <span className="outbound-fact">
          <Hash size={13} /> {contact.customerNumber}
        </span>
      )}
      {address && (
        <span className="outbound-fact">
          <MapPin size={13} /> {address}
        </span>
      )}
      {contact.info && (
        <span className="outbound-fact">
          <Info size={13} /> {contact.info}
        </span>
      )}
    </div>
  );
}

export function Outbound() {
  const { campaigns, outboundContacts, logCall, assignContact, deleteOutboundContact } =
    useStore();
  const { currentUserKey, users, isManager } = useAuth();
  const { openNewContract } = useQuickAdd();

  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>('focus');
  const [filter, setFilter] = useState<'work' | 'all' | OutboundContactStatus>('work');
  const [search, setSearch] = useState('');
  const [skipped, setSkipped] = useState<string[]>([]);
  const [dialogContact, setDialogContact] = useState<OutboundContact | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<OutboundContact | null>(null);

  // Nur Kampagnen mit importierter Liste — der Katalog enthält auch reine
  // Inbound-Kampagnen (Churn, Welcome), die man nicht abtelefoniert.
  const withList = useMemo(() => {
    const ids = new Set(outboundContacts.map((c) => c.campaignId));
    return campaigns.filter((c) => ids.has(c.id));
  }, [campaigns, outboundContacts]);

  const selectable = useMemo(
    () => withList.filter((c) => c.active),
    [withList],
  );

  // Erste Kampagne vorwählen, sobald die Daten da sind.
  useEffect(() => {
    if (campaignId && selectable.some((c) => c.id === campaignId)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCampaignId(selectable[0]?.id ?? null);
  }, [selectable, campaignId]);

  const campaign = useMemo(
    () => selectable.find((c) => c.id === campaignId) ?? null,
    [selectable, campaignId],
  );

  const queue = useMemo(
    () => (campaign ? workQueue(outboundContacts, campaign, currentUserKey) : []),
    [outboundContacts, campaign, currentUserKey],
  );

  // Übersprungene ans Ende stellen, statt sie ganz zu verbergen — so geht
  // nichts verloren, wenn jemand die ganze Liste einmal durchklickt.
  const focusQueue = useMemo(() => {
    const back = queue.filter((c) => skipped.includes(c.id));
    const front = queue.filter((c) => !skipped.includes(c.id));
    return [...front, ...back];
  }, [queue, skipped]);

  const current = focusQueue[0] ?? null;

  const stats = useMemo(
    () => (campaign ? campaignStats(outboundContacts, campaign.id) : null),
    [outboundContacts, campaign],
  );

  const myBonus = useMemo(
    () => (currentUserKey ? agentBonus(outboundContacts, campaigns, currentUserKey) : 0),
    [outboundContacts, campaigns, currentUserKey],
  );

  const listed = useMemo(() => {
    if (!campaign) return [];
    const q = search.trim().toLowerCase();
    return outboundContacts
      .filter((c) => c.campaignId === campaign.id)
      .filter((c) => {
        if (filter === 'all') return true;
        if (filter === 'work') return !isClosed(c);
        return c.status === filter;
      })
      .filter(
        (c) =>
          !q ||
          c.customerName.toLowerCase().includes(q) ||
          (c.phone ?? '').toLowerCase().includes(q) ||
          (c.customerNumber ?? '').toLowerCase().includes(q) ||
          (c.city ?? '').toLowerCase().includes(q),
      );
  }, [outboundContacts, campaign, filter, search]);

  /** Ergebnis speichern — und bei einem Abschluss direkt den Vertrag anlegen. */
  const handleResult = async (contact: OutboundContact, result: CallResult) => {
    setDialogContact(null);
    setSkipped((s) => s.filter((id) => id !== contact.id));
    await logCall(contact, result);

    if (result.outcome === 'abschluss') {
      openNewContract({
        customerNumber: contact.customerNumber ?? '',
        customerName: contact.customerName,
        products: campaign?.targetProduct ? [campaign.targetProduct] : undefined,
        notes: `Outbound-Abschluss aus Kampagne „${campaign?.name ?? ''}"`,
      });
    }
  };

  if (selectable.length === 0) {
    return (
      <div className="widget empty">
        <Megaphone size={32} strokeWidth={1.4} className="empty-icon" />
        <h3>Keine aktive Kampagne</h3>
        <p>
          Sobald der Chef eine Kampagne anlegt und die Anrufliste importiert,
          kann hier telefoniert werden.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Outbound</h2>
          <p>Kampagnen abtelefonieren — im Fokus oder gezielt aus der Liste.</p>
        </div>
        <div className="seg-group">
          <button
            className={`seg ${mode === 'focus' ? 'active' : ''}`}
            onClick={() => setMode('focus')}
          >
            <Crosshair size={14} /> Fokus
          </button>
          <button
            className={`seg ${mode === 'list' ? 'active' : ''}`}
            onClick={() => setMode('list')}
          >
            <ListChecks size={14} /> Liste
          </button>
        </div>
      </div>

      {/* Kampagnen-Auswahl */}
      <div className="campaign-picker">
        {selectable.map((c) => (
          <button
            key={c.id}
            className={`campaign-chip ${c.id === campaignId ? 'active' : ''}`}
            onClick={() => {
              setCampaignId(c.id);
              setSkipped([]);
            }}
          >
            <Megaphone size={14} />
            <span>{c.name}</span>
            <span className="badge">{CALL_TYPE_SHORT[c.callType]}</span>
          </button>
        ))}
      </div>

      {campaign && stats && (
        <>
          <div className="outbound-statbar">
            <div className="outbound-stat">
              <span className="outbound-stat-value">{queue.length}</span>
              <span className="outbound-stat-label">zu tun</span>
            </div>
            <div className="outbound-stat">
              <span className="outbound-stat-value">{stats.termine}</span>
              <span className="outbound-stat-label">Termine</span>
            </div>
            <div className="outbound-stat">
              <span className="outbound-stat-value">{stats.abschluesse}</span>
              <span className="outbound-stat-label">Abschlüsse</span>
            </div>
            <div className="outbound-stat">
              <span className="outbound-stat-value">
                {stats.erreichbarkeit === null ? '–' : `${stats.erreichbarkeit}%`}
              </span>
              <span className="outbound-stat-label">erreicht</span>
            </div>
            <div className="outbound-stat">
              <span className="outbound-stat-value">{formatCurrency(myBonus)}</span>
              <span className="outbound-stat-label">deine Prämien</span>
            </div>
          </div>

          <div className="outbound-progress">
            <div
              className="outbound-progress-fill"
              style={{ width: `${stats.fortschritt}%` }}
            />
          </div>
          <div className="muted outbound-progress-label">
            {stats.total - stats.offen} von {stats.total} Kontakten abgeschlossen
            {(campaign.bonusTermin > 0 || campaign.bonusAbschluss > 0) && (
              <>
                {' · '}
                <Coins size={12} /> Prämie: {formatCurrency(campaign.bonusTermin)} je
                Termin, {formatCurrency(campaign.bonusAbschluss)} je Abschluss
              </>
            )}
          </div>
        </>
      )}

      {/* ---------------------------------------------------------------- */}
      {mode === 'focus' && campaign && (
        <div className="outbound-focus single">
          {!current ? (
            <div className="widget empty">
              <CheckCircle2 size={32} strokeWidth={1.4} className="empty-icon" />
              <h3>Alles abgearbeitet</h3>
              <p>
                In dieser Kampagne ist gerade nichts mehr offen. Wiedervorlagen
                tauchen automatisch wieder auf, sobald sie fällig sind.
              </p>
            </div>
          ) : (
            <>
              <div className="outbound-card">
                <div className="outbound-card-head">
                  <div>
                    <div className="outbound-name">{current.customerName}</div>
                    <ContactFacts contact={current} />
                  </div>
                  <div className="outbound-card-badges">
                    <span className={`badge ${STATUS_BADGE[current.status]}`}>
                      {CONTACT_STATUS_LABEL[current.status]}
                    </span>
                    {current.attempts > 0 && (
                      <span className="badge">
                        {current.attempts}. Versuch von {campaign.maxAttempts}
                      </span>
                    )}
                    {current.followUpDate && (
                      <span className="badge badge-orange">
                        <CalendarClock size={12} /> {formatDate(current.followUpDate)}
                        {current.followUpTime ? ` · ${current.followUpTime}` : ''}
                      </span>
                    )}
                  </div>
                </div>

                {current.notes && (
                  <div className="outbound-notes">
                    {current.notes.split('\n').map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                )}

                <CallResultPanel
                  contact={current}
                  onSave={(r) => handleResult(current, r)}
                  onSkip={() => setSkipped((s) => [...s, current.id])}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {mode === 'list' && campaign && (
        <div className="widget">
          <div className="outbound-list-toolbar">
            <div className="search-bar">
              <Search size={14} />
              <input
                value={search}
                placeholder="Name, Telefon, KdNr. oder Ort …"
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="seg-group">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  className={`seg ${filter === f.key ? 'active' : ''}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {listed.length === 0 ? (
            <div className="empty-inline">Keine Kontakte für diese Auswahl.</div>
          ) : (
            <div className="table-wrap">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Kunde</th>
                    <th>Telefon</th>
                    <th>Status</th>
                    <th>Wiedervorlage</th>
                    <th>Zuständig</th>
                    <th>Prämie</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {listed.map((c) => {
                    const bonus = contactBonus(c, campaign);
                    const overdue =
                      !!c.followUpDate && c.followUpDate <= today() && !isClosed(c);
                    return (
                      <tr key={c.id}>
                        <td>
                          <div className="outbound-row-name">{c.customerName}</div>
                          <div className="muted">
                            {[c.customerNumber, c.city].filter(Boolean).join(' · ') || '–'}
                          </div>
                        </td>
                        <td>
                          {c.phone ? (
                            <a
                              className="outbound-phone sm"
                              href={`tel:${c.phone.replace(/\s/g, '')}`}
                            >
                              {c.phone}
                            </a>
                          ) : (
                            <span className="muted">–</span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${STATUS_BADGE[c.status]}`}>
                            {CONTACT_STATUS_LABEL[c.status]}
                          </span>
                          {c.attempts > 0 && (
                            <span className="muted"> · {c.attempts} Vers.</span>
                          )}
                        </td>
                        <td className={overdue ? 'bucket-overdue' : ''}>
                          {c.followUpDate ? (
                            <>
                              {formatDate(c.followUpDate)}
                              {c.followUpTime && ` · ${c.followUpTime}`}
                            </>
                          ) : (
                            <span className="muted">–</span>
                          )}
                        </td>
                        <td>
                          {c.assignedTo ? (
                            <span className="badge">
                              {users[c.assignedTo]?.displayName ?? 'Unbekannt'}
                            </span>
                          ) : (
                            <span className="muted">frei</span>
                          )}
                        </td>
                        <td>{bonus > 0 ? formatCurrency(bonus) : <span className="muted">–</span>}</td>
                        <td>
                          <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                            {c.assignedTo === currentUserKey ? (
                              <button
                                className="btn btn-sm btn-ghost"
                                title="Zuständigkeit abgeben"
                                onClick={() => assignContact(c.id, undefined)}
                              >
                                <UserMinus size={13} />
                              </button>
                            ) : (
                              !c.assignedTo && (
                                <button
                                  className="btn btn-sm btn-ghost"
                                  title="Übernehmen"
                                  onClick={() =>
                                    assignContact(c.id, currentUserKey ?? undefined)
                                  }
                                >
                                  <UserPlus size={13} />
                                </button>
                              )
                            )}
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={() => setDialogContact(c)}
                            >
                              <PhoneCall size={13} /> Ergebnis
                            </button>
                            {isManager() && (
                              <button
                                className="btn btn-sm btn-ghost"
                                title="Kontakt aus der Liste entfernen"
                                onClick={() => setConfirmDelete(c)}
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
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
      )}

      {dialogContact && (
        <Modal
          open
          onClose={() => setDialogContact(null)}
          title={dialogContact.customerName}
          subtitle={
            dialogContact.phone
              ? `${dialogContact.phone} · ${CONTACT_STATUS_LABEL[dialogContact.status]}`
              : CONTACT_STATUS_LABEL[dialogContact.status]
          }
        >
          <ContactFacts contact={dialogContact} />
          {dialogContact.notes && (
            <div className="outbound-notes">
              {dialogContact.notes.split('\n').map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
          <CallResultPanel
            contact={dialogContact}
            onSave={(r) => handleResult(dialogContact, r)}
          />
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          open
          onClose={() => setConfirmDelete(null)}
          title="Kontakt entfernen?"
          subtitle={confirmDelete.customerName}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmDelete(null)}>
                Abbrechen
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  deleteOutboundContact(confirmDelete.id);
                  setConfirmDelete(null);
                }}
              >
                Entfernen
              </button>
            </>
          }
        >
          <p>
            Der Kontakt wird mit allen erfassten Ergebnissen aus der Anrufliste
            gelöscht.
          </p>
        </Modal>
      )}
    </div>
  );
}
