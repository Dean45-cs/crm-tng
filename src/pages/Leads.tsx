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
} from 'lucide-react';
import { useStore } from '../store/useStore';
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
import type { Lead, LeadStatus, Contract } from '../types';

const STATUS_ORDER: LeadStatus[] = ['neu', 'inBearbeitung', 'gewonnen', 'verloren'];

const STATUS_LABEL: Record<LeadStatus, string> = {
  neu: 'Neu',
  inBearbeitung: 'In Bearbeitung',
  gewonnen: 'Gewonnen',
  verloren: 'Verloren',
};

export function Leads() {
  const { leads, contracts, settings, updateLead, deleteLead } = useStore();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | undefined>(undefined);
  const [prefill, setPrefill] = useState<LeadPrefill | undefined>(undefined);
  const [confirmId, setConfirmId] = useState<string | null>(null);

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
        <div className="widget" style={{ marginBottom: 18 }}>
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
                  return (
                    <div key={lead.id} className="lead-card">
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
