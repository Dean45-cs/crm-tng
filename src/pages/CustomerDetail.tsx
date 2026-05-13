import { useMemo } from 'react';
import {
  ArrowLeft,
  Plus,
  FileSignature,
  ArrowLeftRight,
  StickyNote,
  Wallet,
  Pencil,
  Trash2,
  Calendar,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useRouter } from '../router';
import {
  calcContractCommission,
  calcTariffCommission,
  formatCurrency,
  formatDate,
  TARIFF_CONTEXT_LABEL,
  TARIFF_TYPE_LABEL,
} from '../lib/utils';
import { StatusBadge } from '../components/StatusBadge';
import { JiraLink } from '../components/JiraLink';
import { useQuickAdd } from '../components/QuickAdd';

interface Props {
  kdnr: string;
}

export function CustomerDetail({ kdnr }: Props) {
  const { contracts, tariffChanges, notes, settings, deleteContract, deleteTariffChange, deleteNote } =
    useStore();
  const { navigate } = useRouter();
  const { openNewContract, openNewTariff, openNewNote, editContract, editTariff, editNote } =
    useQuickAdd();

  const contractsList = useMemo(
    () => contracts.filter((c) => c.customerNumber === kdnr).sort((a, b) => b.contractDate.localeCompare(a.contractDate)),
    [contracts, kdnr],
  );
  const tariffList = useMemo(
    () => tariffChanges.filter((t) => t.customerNumber === kdnr).sort((a, b) => b.changeDate.localeCompare(a.changeDate)),
    [tariffChanges, kdnr],
  );
  const notesList = useMemo(
    () => notes.filter((n) => n.customerNumber === kdnr).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [notes, kdnr],
  );

  const customerName =
    contractsList[0]?.customerName ??
    tariffList[0]?.customerName ??
    notesList[0]?.customerName ??
    '';

  const totalCommission =
    contractsList.reduce((s, c) => s + calcContractCommission(c, settings), 0) +
    tariffList.reduce((s, t) => s + calcTariffCommission(t, settings), 0);

  const initials = (customerName || kdnr).slice(0, 2).toUpperCase();

  if (contractsList.length === 0 && tariffList.length === 0 && notesList.length === 0) {
    return (
      <div>
        <button
          className="btn btn-ghost"
          onClick={() => navigate({ name: 'customers' })}
          style={{ marginBottom: 16 }}
        >
          <ArrowLeft size={14} /> Zurück
        </button>
        <div className="card-soft empty">
          <h3>Kunde nicht gefunden</h3>
          <p>Zu KdNr {kdnr} gibt es keine Vorgänge.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        className="btn btn-ghost"
        onClick={() => navigate({ name: 'customers' })}
        style={{ marginBottom: 16 }}
      >
        <ArrowLeft size={14} /> Kunden
      </button>

      <div className="customer-hero">
        <div className="customer-hero-avatar">{initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 26, letterSpacing: '-0.4px' }}>
            {customerName || 'Unbenannt'}
          </h2>
          <div className="muted" style={{ marginTop: 4 }}>
            Kundennummer <code>{kdnr}</code>
          </div>
        </div>
        <div className="customer-hero-stats">
          <div className="hero-stat">
            <Wallet size={14} />
            <div>
              <div className="hero-stat-label">Provision</div>
              <div className="hero-stat-value">{formatCurrency(totalCommission)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="customer-quick-actions">
        <button className="btn btn-primary" onClick={openNewContract}>
          <Plus size={14} /> Vertrag
        </button>
        <button className="btn" onClick={openNewTariff}>
          <Plus size={14} /> Tarifwechsel
        </button>
        <button className="btn" onClick={openNewNote}>
          <Plus size={14} /> Notiz
        </button>
      </div>

      <Section
        icon={<FileSignature size={15} />}
        title="Verträge"
        count={contractsList.length}
      >
        {contractsList.length === 0 ? (
          <div className="muted" style={{ padding: '14px 2px' }}>Keine Verträge.</div>
        ) : (
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Produkte</th>
                  <th>Status</th>
                  <th>Jira</th>
                  <th>Wiedervorlage</th>
                  <th style={{ textAlign: 'right' }}>Provision</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {contractsList.map((c) => (
                  <tr key={c.id}>
                    <td>{formatDate(c.contractDate)}</td>
                    <td>
                      <div className="product-chips">
                        {c.products.map((p) => {
                          const cat = settings.products.find((x) => x.name === p)?.category;
                          return (
                            <span key={p} className={`product-chip cat-${cat}`}>
                              {p}
                            </span>
                          );
                        })}
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
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => confirm('Wirklich löschen?') && deleteContract(c.id)}
                        >
                          <Trash2 size={13} color="var(--red)" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        icon={<ArrowLeftRight size={15} />}
        title="Tarifwechsel"
        count={tariffList.length}
      >
        {tariffList.length === 0 ? (
          <div className="muted" style={{ padding: '14px 2px' }}>Keine Tarifwechsel.</div>
        ) : (
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Art</th>
                  <th>MVLZ</th>
                  <th>Jira</th>
                  <th style={{ textAlign: 'right' }}>Provision</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tariffList.map((t) => (
                  <tr key={t.id}>
                    <td>{formatDate(t.changeDate)}</td>
                    <td>
                      <span className={`badge ${t.changeType === 'upgrade' ? 'badge-green' : 'badge-blue'}`}>
                        {TARIFF_TYPE_LABEL[t.changeType]}
                      </span>
                    </td>
                    <td style={{ fontSize: 12.5 }}>{TARIFF_CONTEXT_LABEL[t.context]}</td>
                    <td><JiraLink ticket={t.jiraTicket} /></td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {formatCurrency(calcTariffCommission(t, settings))}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="row end">
                        <button className="btn btn-ghost btn-sm" onClick={() => editTariff(t)}>
                          <Pencil size={13} />
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => confirm('Wirklich löschen?') && deleteTariffChange(t.id)}
                        >
                          <Trash2 size={13} color="var(--red)" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        icon={<StickyNote size={15} />}
        title="Notizen"
        count={notesList.length}
      >
        {notesList.length === 0 ? (
          <div className="muted" style={{ padding: '14px 2px' }}>Keine Notizen.</div>
        ) : (
          <div className="notes-grid">
            {notesList.map((n) => (
              <div key={n.id} className="note-card">
                <div className="row between">
                  <h4>{n.title}</h4>
                  <div className="row" style={{ gap: 2 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => editNote(n)}>
                      <Pencil size={12} />
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => confirm('Wirklich löschen?') && deleteNote(n.id)}
                    >
                      <Trash2 size={12} color="var(--red)" />
                    </button>
                  </div>
                </div>
                <div className="body">{n.content}</div>
                <div className="meta">
                  {n.jiraTicket && <JiraLink ticket={n.jiraTicket} />}
                  <span className="row" style={{ gap: 3, marginLeft: 'auto' }}>
                    <Calendar size={11} />
                    {formatDate(n.updatedAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 22 }}>
      <div className="customer-section-header">
        <div className="customer-section-title">
          {icon}
          <span>{title}</span>
        </div>
        <span className="customer-section-count">{count}</span>
      </div>
      {children}
    </section>
  );
}

