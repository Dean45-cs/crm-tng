import { useMemo, useState } from 'react';
import {
  Plus,
  Target,
  Phone,
  CalendarClock,
  Pencil,
  Trash2,
  RefreshCw,
  Check,
  PhoneCall,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Send,
  Trash,
  Crown,
  Flame,
  ArrowUp,
  UserPlus,
} from 'lucide-react';
import { useQuickAdd } from '../components/QuickAdd';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import {
  formatDate,
  formatCurrency,
  calcContractCommission,
  contractEndDate,
  daysUntil,
  expiryBucket,
  expiryLabel,
  followUpBucket,
} from '../lib/utils';
import { LeadForm, type LeadPrefill } from '../components/LeadForm';
import { SkeletonCardGrid } from '../components/Skeleton';
import type { Lead, LeadStatus, LeadPriority, Contract } from '../types';

const STATUS_ORDER: LeadStatus[] = ['neu', 'inBearbeitung', 'gewonnen', 'verloren'];

const STATUS_LABEL: Record<LeadStatus, string> = {
  neu: 'Neu',
  inBearbeitung: 'In Bearbeitung',
  gewonnen: 'Gewonnen',
  verloren: 'Verloren',
};

// Niedriger Rang = höhere Dringlichkeit, wird zuerst sortiert.
const PRIORITY_RANK: Record<LeadPriority, number> = {
  dringend: 0,
  hoch: 1,
  normal: 2,
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return 'gerade eben';
  if (mins < 60) return `vor ${mins} Min.`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'gestern';
  if (days < 7) return `vor ${days} Tagen`;
  return formatDate(iso.slice(0, 10));
}

interface ActivityPanelProps {
  leadId: string;
  currentUserKey: string | null;
  userMap: Record<string, { displayName: string }>;
}

function ActivityPanel({ leadId, currentUserKey, userMap }: ActivityPanelProps) {
  const { leadActivities, addLeadActivity, deleteLeadActivity } = useStore();
  const [noteText, setNoteText] = useState('');
  const [sending, setSending] = useState(false);

  const activities = leadActivities[leadId] ?? [];

  const sendNote = async () => {
    const text = noteText.trim();
    if (!text) return;
    setSending(true);
    await addLeadActivity({ leadId, type: 'note', content: text });
    setNoteText('');
    setSending(false);
  };

  return (
    <div className="lead-activity-panel">
      <div className="lead-activity-feed">
        {activities.length === 0 && (
          <div className="lead-activity-empty">Noch keine Aktivität.</div>
        )}
        {activities.map((a) => {
          const name = a.createdBy ? (userMap[a.createdBy]?.displayName ?? 'Unbekannt') : 'System';
          const isOwn = a.createdBy === currentUserKey;
          return (
            <div key={a.id} className={`lead-activity-item ${a.type}`}>
              <span className="lead-activity-icon">
                {a.type === 'contact' ? <PhoneCall size={12} /> : <MessageSquare size={12} />}
              </span>
              <div className="lead-activity-body">
                <div className="lead-activity-meta">
                  <span className="lead-activity-author">{name}</span>
                  <span className="lead-activity-time">{relativeTime(a.createdAt)}</span>
                  {isOwn && (
                    <button
                      className="lead-activity-delete"
                      title="Löschen"
                      onClick={() => deleteLeadActivity(a.id, leadId)}
                    >
                      <Trash size={11} />
                    </button>
                  )}
                </div>
                {a.type === 'contact' ? (
                  <span className="lead-activity-content contact-label">Kunde kontaktiert</span>
                ) : (
                  <span className="lead-activity-content">{a.content}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="lead-activity-input-row">
        <input
          className="lead-activity-input"
          placeholder="Notiz ins Team schreiben …"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendNote(); }
          }}
        />
        <button
          className="lead-activity-send"
          disabled={!noteText.trim() || sending}
          onClick={sendNote}
          title="Senden"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

export function Leads() {
  const { leads, contracts, settings, leadActivities, loaded, updateLead, deleteLead, addLeadActivity } = useStore();
  const { getCurrentUser, users } = useAuth();
  const { openNewContract } = useQuickAdd();
  const currentUser = getCurrentUser();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | undefined>(undefined);
  const [prefill, setPrefill] = useState<LeadPrefill | undefined>(undefined);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Auslaufende Verträge (alle Team-Verträge), nach Ablauf-Dringlichkeit sortiert.
  const expiring = useMemo(
    () =>
      contracts
        .filter((c) => c.status !== 'storniert' && expiryBucket(c) !== null)
        .sort(
          (a, b) =>
            daysUntil(contractEndDate(a)!) - daysUntil(contractEndDate(b)!),
        ),
    [contracts],
  );

  // Kundennummern, für die schon ein Lead existiert (Doppel-Anlage vermeiden).
  const leadKdnrs = useMemo(
    () => new Set(leads.map((l) => l.customerNumber).filter(Boolean)),
    [leads],
  );

  const byStatus = useMemo(() => {
    const groups: Record<LeadStatus, Lead[]> = {
      neu: [],
      inBearbeitung: [],
      gewonnen: [],
      verloren: [],
    };
    for (const l of leads) groups[l.status]?.push(l);
    // Innerhalb jeder Spalte: dringende Leads zuerst, dann nach Wiedervorlage.
    for (const status of STATUS_ORDER) {
      groups[status].sort((a, b) => {
        const r = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (r !== 0) return r;
        return (a.followUpDate ?? '9999-12-31').localeCompare(
          b.followUpDate ?? '9999-12-31',
        );
      });
    }
    return groups;
  }, [leads]);

  const openCreate = () => {
    setEditing(undefined);
    setPrefill(undefined);
    setFormOpen(true);
  };
  const openEdit = (lead: Lead) => {
    setEditing(lead);
    setPrefill(undefined);
    setFormOpen(true);
  };
  const openFromContract = (c: Contract) => {
    setEditing(undefined);
    setPrefill({
      customerName: c.customerName,
      customerNumber: c.customerNumber,
      topic: 'Vertragsverlängerung',
    });
    setFormOpen(true);
  };

  const handleContact = async (leadId: string) => {
    await addLeadActivity({ leadId, type: 'contact', content: undefined });
  };

  const lastContact = (leadId: string): string | null => {
    const acts = leadActivities[leadId] ?? [];
    const c = acts.find((a) => a.type === 'contact');
    return c ? c.createdAt : null;
  };

  if (!loaded) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h2>Leads</h2>
            <p>Vertriebs-Pipeline und auslaufende Verträge — für das ganze Team.</p>
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
          <h2>Leads</h2>
          <p>Vertriebs-Pipeline und auslaufende Verträge — für das ganze Team.</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <Plus size={14} /> Neuer Lead
        </button>
      </div>

      {/* Auslaufende Verträge */}
      {expiring.length > 0 && (
        <div className="widget" style={{ marginBottom: 12 }}>
          <h3
            className="widget-title"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} /> Vertragsverlängerungen ({expiring.length})
          </h3>
          <div className="lead-renewal-list">
            {expiring.map((c) => {
              const bucket = expiryBucket(c)!;
              const hasLead = !!c.customerNumber && leadKdnrs.has(c.customerNumber);
              return (
                <div key={c.id} className="lead-renewal-row">
                  <span className={`expiry-dot ${bucket}`} />
                  <div className="lead-renewal-customer">
                    <span className="lead-renewal-name">{c.customerName}</span>
                    <span className="lead-renewal-kdnr">{c.customerNumber}</span>
                  </div>
                  <span className="lead-renewal-com">
                    {formatCurrency(calcContractCommission(c, settings))}
                  </span>
                  <span className={`expiry-days-pill ${bucket}`}>
                    {expiryLabel(c)}
                  </span>
                  {hasLead ? (
                    <span className="lead-renewal-done">
                      <Check size={13} /> Lead vorhanden
                    </span>
                  ) : (
                    <button
                      className="btn btn-sm"
                      onClick={() => openFromContract(c)}
                    >
                      <Plus size={12} /> Lead anlegen
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pipeline */}
      <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Target size={15} /> Pipeline
      </h3>

      {leads.length === 0 ? (
        <div className="widget empty">
          <Target size={32} strokeWidth={1.4} className="empty-icon" />
          <h3>Noch keine Leads</h3>
          <p>Lege deinen ersten Lead an oder erzeuge einen aus einer auslaufenden Vertragsverlängerung.</p>
        </div>
      ) : (
        <div className="lead-board">
          {STATUS_ORDER.map((status) => (
            <div key={status} className={`lead-column status-${status}`}>
              <div className="lead-column-head">
                <span className="lead-column-dot" />
                <span className="lead-column-title">{STATUS_LABEL[status]}</span>
                <span className="lead-column-count">{byStatus[status].length}</span>
              </div>
              <div className="lead-column-body">
                {byStatus[status].length === 0 && (
                  <div className="lead-column-empty">—</div>
                )}
                {byStatus[status].map((lead) => {
                  const fuBucket = followUpBucket(lead.followUpDate);
                  const lc = lastContact(lead.id);
                  const isExpanded = expandedId === lead.id;
                  const actCount = (leadActivities[lead.id] ?? []).length;
                  const isChef = !!lead.createdBy && users[lead.createdBy]?.role === 'manager';
                  const cardClass = `lead-card prio-${lead.priority}${isChef ? ' from-chef' : ''}`;

                  return (
                    <div key={lead.id} className={cardClass}>
                      {/* Dringlichkeits- und Chef-Badges */}
                      {(isChef || lead.priority !== 'normal') && (
                        <div className="lead-card-badges">
                          {lead.priority === 'dringend' && (
                            <span className="lead-prio-badge dringend">
                              <Flame size={10} /> Dringend
                            </span>
                          )}
                          {lead.priority === 'hoch' && (
                            <span className="lead-prio-badge hoch">
                              <ArrowUp size={10} /> Hoch
                            </span>
                          )}
                          {isChef && (
                            <span className="lead-chef-badge">
                              <Crown size={10} /> Vom Chef
                            </span>
                          )}
                        </div>
                      )}

                      <div className="lead-card-head">
                        <span className="lead-card-name">{lead.customerName}</span>
                        <div className="lead-card-actions">
                          <button
                            className="lead-icon-btn"
                            onClick={() => openEdit(lead)}
                            title="Bearbeiten"
                          >
                            <Pencil size={13} />
                          </button>
                          {confirmId === lead.id ? (
                            <button
                              className="btn btn-sm btn-danger"
                              autoFocus
                              onClick={() => {
                                deleteLead(lead.id);
                                setConfirmId(null);
                              }}
                              onBlur={() =>
                                setConfirmId((c) => (c === lead.id ? null : c))
                              }
                            >
                              Wirklich?
                            </button>
                          ) : (
                            <button
                              className="lead-icon-btn"
                              onClick={() => setConfirmId(lead.id)}
                              title="Löschen"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>

                      {lead.topic && (
                        <div className="lead-card-topic">{lead.topic}</div>
                      )}

                      {(lead.phone || lead.customerNumber) && (
                        <div className="lead-card-meta">
                          {lead.phone && (
                            <a
                              href={`tel:${lead.phone.replace(/\s/g, '')}`}
                              className="lead-card-phone"
                            >
                              <Phone size={11} /> {lead.phone}
                            </a>
                          )}
                          {lead.customerNumber && (
                            <code className="lead-card-kdnr">
                              {lead.customerNumber}
                            </code>
                          )}
                        </div>
                      )}

                      {/* Letzter Kontakt */}
                      {lc && (
                        <div className="lead-last-contact">
                          <PhoneCall size={11} />
                          <span>Zuletzt kontaktiert: {relativeTime(lc)}</span>
                        </div>
                      )}

                      <div className="lead-card-footer">
                        <span
                          className={`lead-card-followup${fuBucket ? ` fu-${fuBucket}` : ''}`}
                        >
                          <CalendarClock size={11} />
                          {formatDate(lead.followUpDate)}
                        </span>
                        <select
                          className="lead-status-select"
                          value={lead.status}
                          onChange={(e) =>
                            updateLead(lead.id, {
                              status: e.target.value as LeadStatus,
                            })
                          }
                          aria-label="Status ändern"
                        >
                          {STATUS_ORDER.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABEL[s]}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Aktionsleiste */}
                      <div className="lead-card-toolbar">
                        <button
                          className="lead-contact-btn"
                          onClick={() => handleContact(lead.id)}
                          title="Kontaktversuch protokollieren"
                        >
                          <PhoneCall size={13} /> Kontaktiert
                        </button>
                        <button
                          className="lead-chat-toggle"
                          onClick={() => setExpandedId(isExpanded ? null : lead.id)}
                          title="Aktivitäts-Log"
                        >
                          <MessageSquare size={13} />
                          {actCount > 0 && <span className="lead-chat-badge">{actCount}</span>}
                          {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                      </div>

                      {/* Aktivitäts-Log */}
                      {isExpanded && (
                        <ActivityPanel
                          leadId={lead.id}
                          currentUserKey={currentUser?.key ?? null}
                          userMap={users}
                        />
                      )}

                      {/* Gewonnen → Kunde anlegen */}
                      {lead.status === 'gewonnen' && (
                        <button
                          className="lead-convert-btn"
                          onClick={() =>
                            openNewContract({
                              customerName: lead.customerName,
                              customerNumber: lead.customerNumber ?? '',
                            })
                          }
                        >
                          <UserPlus size={13} /> Als Kunde in Datenbank anlegen
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <LeadForm
          key={editing?.id ?? 'new'}
          lead={editing}
          prefill={prefill}
          onClose={() => setFormOpen(false)}
        />
      )}
    </div>
  );
}
