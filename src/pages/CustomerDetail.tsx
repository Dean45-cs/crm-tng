import { useEffect, useMemo, useState } from 'react';
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
  Share2,
  Crown,
  UserIcon,
  Globe,
  ShieldAlert,
  Eraser,
  Phone,
  PhoneOutgoing,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { useRouter } from '../router';
import type { Call } from '../types';
import { fetchCallsForCustomer } from '../lib/supabaseApi';
import { formatClock, formatDuration } from '../lib/statusBoard';
import {
  calcContractCommission,
  calcTariffCommission,
  formatCurrency,
  formatDate,
  TARIFF_CONTEXT_LABEL,
  TARIFF_TYPE_LABEL,
} from '../lib/utils';
import { getEffectiveOwnership, canEditCustomer } from '../lib/customerOwnership';
import { StatusBadge } from '../components/StatusBadge';
import { JiraLink } from '../components/JiraLink';
import { useQuickAdd } from '../components/QuickAdd';
import { CustomerShareDialog } from '../components/CustomerShareDialog';
import { ActivityTimeline } from '../components/ActivityTimeline';
import { AccessRequestInbox, AccessRequestBanner } from '../components/AccessRequests';
import { SkeletonPage } from '../components/Skeleton';

interface Props {
  kdnr: string;
}

export function CustomerDetail({ kdnr }: Props) {
  const { contracts, tariffChanges, notes, settings, customerOwners, customers, deleteContract, deleteTariffChange, deleteNote, purgeCustomer, loaded } =
    useStore();
  const { currentUserKey, users, isManager } = useAuth();
  const { navigate } = useRouter();
  const { openNewContract, openNewTariff, openNewNote, editContract, editTariff, editNote } =
    useQuickAdd();
  const [shareOpen, setShareOpen] = useState(false);
  const [purgeConfirmStep, setPurgeConfirmStep] = useState(0);
  const [purging, setPurging] = useState(false);

  const ownership = useMemo(
    () => getEffectiveOwnership(kdnr, customerOwners, contracts, tariffChanges, notes),
    [kdnr, customerOwners, contracts, tariffChanges, notes],
  );
  const isOwner = ownership.owner === currentUserKey;
  const ownerUser = ownership.owner ? users[ownership.owner] : null;
  const canEdit = canEditCustomer(kdnr, currentUserKey, isManager(), customerOwners, contracts, tariffChanges, notes);

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
  const customerRow = useMemo(
    () => customers.find((c) => c.customerNumber === kdnr) ?? null,
    [customers, kdnr],
  );

  // Anrufhistorie lebt bewusst nicht im globalen Store (siehe useCalls.ts) —
  // Anrufvolumen kann deutlich höher sein als Verträge/Notizen, deshalb hier
  // gezielt pro Kunde geladen.
  // Ein Kunde, der bisher nur angerufen wurde, hat weder Vertrag noch Notiz —
  // dann entscheidet allein diese Liste über „gefunden oder nicht". Solange sie
  // lädt, darf die Seite deshalb noch kein Urteil fällen. Die Kundennummer wird
  // im State mitgeführt: „geladen" heißt damit „geladen für genau diesen
  // Kunden", ohne ein zweites Flag, das beim Wechsel erst zurückgesetzt werden
  // müsste (ein synchrones setState im Effekt).
  const [calls, setCalls] = useState<{ kdnr: string | null; rows: Call[] }>({ kdnr: null, rows: [] });
  const callsLoaded = calls.kdnr === kdnr;
  const callsList = callsLoaded ? calls.rows : [];
  useEffect(() => {
    let cancelled = false;
    fetchCallsForCustomer(kdnr)
      .then((rows) => {
        if (!cancelled) setCalls({ kdnr, rows });
      })
      .catch(() => {
        if (!cancelled) setCalls({ kdnr, rows: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [kdnr]);

  const customerName =
    contractsList[0]?.customerName ??
    tariffList[0]?.customerName ??
    notesList[0]?.customerName ??
    customerRow?.name ??
    '';

  const totalCommission =
    contractsList.reduce((s, c) => s + calcContractCommission(c, settings), 0) +
    tariffList.reduce((s, t) => s + calcTariffCommission(t, settings), 0);

  const initials = (customerName || kdnr).slice(0, 2).toUpperCase();

  // Solange die CRM-Daten (oder die Anrufhistorie) noch laden, ist jede Aussage
  // über den Kunden verfrüht. Ohne diese Schranke begrüßte ausgerechnet der
  // Deep-Link aus der Extension (`?kdnr=…`, siehe router.tsx) den Nutzer mit
  // „Kunde nicht gefunden" — bei langsamer Verbindung sekundenlang.
  if (!loaded || !callsLoaded) {
    return (
      <div>
        <button className="btn btn-ghost" disabled style={{ marginBottom: 10 }}>
          <ArrowLeft size={14} /> Zurück
        </button>
        <SkeletonPage />
      </div>
    );
  }

  if (
    contractsList.length === 0 &&
    tariffList.length === 0 &&
    notesList.length === 0 &&
    callsList.length === 0 &&
    !customerRow
  ) {
    return (
      <div>
        <button
          className="btn btn-ghost"
          onClick={() => navigate({ name: 'customers' })}
          style={{ marginBottom: 10 }}
        >
          <ArrowLeft size={14} /> Zurück
        </button>
        <div className="widget empty">
          <UserIcon size={32} strokeWidth={1.4} className="empty-icon" />
          <h3>Kunde nicht gefunden</h3>
          <p>Zu KdNr <code>{kdnr}</code> gibt es noch keine Vorgänge.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        className="btn btn-ghost"
        onClick={() => navigate({ name: 'customers' })}
        style={{ marginBottom: 10 }}
      >
        <ArrowLeft size={14} /> Kunden
      </button>

      <div className="customer-hero">
        <div className="customer-hero-avatar">{initials}</div>
        <div className="customer-hero-body">
          <h2 className="customer-hero-name">{customerName || 'Unbenannt'}</h2>
          <div className="customer-hero-kdnr">
            Kundennummer <code>{kdnr}</code>
            {customerRow?.phone && <> · {customerRow.phone}</>}
          </div>
          <div className="customer-owner-row">
            {ownership.owner === null ? (
              <span className="customer-owner-tag unowned">
                <Globe size={11} /> Verwaist – noch kein:e Besitzer:in
              </span>
            ) : isOwner ? (
              <span className="customer-owner-tag mine">
                <Crown size={11} /> Du bist Besitzer:in
                {ownership.sharedWith.length > 0 && (
                  <> · geteilt mit {ownership.sharedWith.length} {ownership.sharedWith.length === 1 ? 'Person' : 'Personen'}</>
                )}
              </span>
            ) : (
              <span className="customer-owner-tag shared">
                <UserIcon size={11} /> Besitzer:in: {ownerUser?.displayName ?? ownership.owner}
                {ownership.sharedWith.includes(currentUserKey ?? '') && <> · mit dir geteilt</>}
              </span>
            )}
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

      <AccessRequestInbox customerNumber={kdnr} />

      {!canEdit && (
        <AccessRequestBanner
          customerNumber={kdnr}
          ownerId={ownership.owner ?? undefined}
          ownerName={ownerUser?.displayName}
        />
      )}

      {canEdit && (
        <div className="customer-quick-actions">
          <button
            className="btn btn-primary"
            onClick={() => openNewContract({ customerNumber: kdnr, customerName })}
          >
            <Plus size={14} /> Vertrag
          </button>
          <button
            className="btn"
            onClick={() => openNewTariff({ customerNumber: kdnr, customerName })}
          >
            <Plus size={14} /> Tarifwechsel
          </button>
          <button
            className="btn"
            onClick={() => openNewNote({ customerNumber: kdnr, customerName })}
          >
            <Plus size={14} /> Notiz
          </button>
          <button className="btn" onClick={() => setShareOpen(true)} style={{ marginLeft: 'auto' }}>
            <Share2 size={14} /> Teilen
          </button>
        </div>
      )}

      {shareOpen && (
        <CustomerShareDialog
          customerNumber={kdnr}
          customerName={customerName}
          onClose={() => setShareOpen(false)}
        />
      )}

      <ActivityTimeline
        contracts={contractsList}
        tariffChanges={tariffList}
        notes={notesList}
        calls={callsList}
      />

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
                        {c.products.map((p, i) => {
                          const cat = settings.products.find((x) => x.name === p)?.category;
                          return (
                            <span key={`${p}-${i}`} className={`product-chip cat-${cat}`}>
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
                      {canEdit && (
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
                      )}
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
                      {canEdit && (
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
                      )}
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
                  {canEdit && (
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
                  )}
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

      <Section
        icon={<Phone size={15} />}
        title="Anrufe"
        count={callsList.length}
      >
        {callsList.length === 0 ? (
          <div className="muted" style={{ padding: '14px 2px' }}>Keine Anrufe.</div>
        ) : (
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Richtung</th>
                  <th>Anrufer</th>
                  <th>Bearbeiter:in</th>
                  <th>Gruppe</th>
                  <th style={{ textAlign: 'right' }}>Dauer</th>
                </tr>
              </thead>
              <tbody>
                {callsList.map((call) => (
                  <tr key={call.id}>
                    <td>
                      {formatDate(call.startedAt)} · {formatClock(call.startedAt)}
                    </td>
                    <td>
                      <span className="row" style={{ gap: 4 }}>
                        {call.direction === 'outbound' ? (
                          <PhoneOutgoing size={13} />
                        ) : (
                          <Phone size={13} />
                        )}
                        {call.direction === 'outbound' ? 'Ausgehend' : 'Eingehend'}
                      </span>
                    </td>
                    <td>{call.callerName || call.callerNumber || '–'}</td>
                    <td>{users[call.agentId]?.displayName ?? '–'}</td>
                    <td>{call.queueGroup || '–'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {call.durationS != null ? formatDuration(call.durationS) : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {isManager() && (
        <section className="customer-purge-section">
          <div className="customer-purge-head">
            <ShieldAlert size={16} />
            <div>
              <div className="customer-purge-title">DSGVO: Recht auf Vergessenwerden</div>
              <div className="customer-purge-sub">
                Löscht <strong>alle</strong> Verträge, Tarifwechsel, Notizen, Anrufe und den
                Kundeneintrag selbst endgültig. Der Vorgang ist im Audit-Log nachvollziehbar und
                nicht rückgängig zu machen.
              </div>
            </div>
          </div>
          <div className="customer-purge-actions">
            {purgeConfirmStep === 0 && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => setPurgeConfirmStep(1)}
              >
                <Eraser size={13} /> Alle Kundendaten löschen
              </button>
            )}
            {purgeConfirmStep === 1 && (
              <>
                <span className="customer-purge-confirm">
                  Wirklich alle Daten zu <strong>{customerName || kdnr}</strong> unwiderruflich löschen?
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setPurgeConfirmStep(0)}
                  disabled={purging}
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={purging}
                  onClick={async () => {
                    setPurging(true);
                    await purgeCustomer(kdnr, customerName);
                    setPurging(false);
                    navigate({ name: 'customers' });
                  }}
                >
                  {purging ? 'Lösche …' : 'Ja, endgültig löschen'}
                </button>
              </>
            )}
          </div>
        </section>
      )}
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
    <section style={{ marginBottom: 14 }}>
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

