import { useMemo, useState } from 'react';
import {
  Megaphone,
  Lock,
  Plus,
  Pencil,
  Eye,
  EyeOff,
  Upload,
  Download,
  Eraser,
  Users,
  Coins,
  BarChart3,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { CampaignForm } from '../components/CampaignForm';
import { ContactImportDialog } from '../components/ContactImportDialog';
import { Modal } from '../components/Modal';
import { SkeletonCardGrid } from '../components/Skeleton';
import {
  campaignStats,
  contactBonus,
  agentBonus,
  CONTACT_STATUS_LABEL,
} from '../lib/outbound';
import { formatCurrency, formatDate, exportCsv } from '../lib/utils';
import type { Campaign, CampaignCallType } from '../types';

const CALL_TYPE_SHORT: Record<CampaignCallType, string> = {
  churn: 'Churn',
  welcome: 'Welcome',
  prl: 'PRL',
  dupe: 'Dupe',
  bvw: 'BVW',
  courtesy: 'Courtesy',
  other: 'Sonstige',
};

export function CampaignManager() {
  const {
    campaigns,
    outboundContacts,
    updateCampaign,
    clearCampaignContacts,
    loaded,
  } = useStore();
  const { isManager, users } = useAuth();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | undefined>(undefined);
  const [importFor, setImportFor] = useState<Campaign | null>(null);
  const [detailFor, setDetailFor] = useState<Campaign | null>(null);
  const [confirmClear, setConfirmClear] = useState<Campaign | null>(null);

  // Prämien und Ergebnisse je Mitarbeiter:in über alle Kampagnen.
  const agentRows = useMemo(() => {
    return Object.values(users)
      .filter((u) => u.isActive)
      .map((u) => ({
        key: u.key,
        name: u.displayName,
        bonus: agentBonus(outboundContacts, campaigns, u.key),
        termine: outboundContacts.filter((c) => c.resultBy === u.key && c.status === 'termin')
          .length,
        abschluesse: outboundContacts.filter(
          (c) => c.resultBy === u.key && c.status === 'abschluss',
        ).length,
        bearbeitet: outboundContacts.filter((c) => c.resultBy === u.key).length,
      }))
      .filter((r) => r.bearbeitet > 0)
      .sort((a, b) => b.bonus - a.bonus || b.bearbeitet - a.bearbeitet);
  }, [users, outboundContacts, campaigns]);

  if (!isManager()) {
    return (
      <div className="widget empty">
        <Lock size={32} strokeWidth={1.4} className="empty-icon" />
        <h3>Kein Zugriff</h3>
        <p>Die Kampagnen-Verwaltung ist nur für Chefs sichtbar.</p>
      </div>
    );
  }

  const openCreate = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const openEdit = (c: Campaign) => {
    setEditing(c);
    setFormOpen(true);
  };

  const exportCampaign = (c: Campaign) => {
    const rows = outboundContacts
      .filter((x) => x.campaignId === c.id)
      .map((x) => ({
        Kunde: x.customerName,
        Kundennummer: x.customerNumber ?? '',
        Telefon: x.phone ?? '',
        PLZ: x.zip ?? '',
        Ort: x.city ?? '',
        Status: CONTACT_STATUS_LABEL[x.status],
        Versuche: x.attempts,
        Wiedervorlage: x.followUpDate ?? '',
        Bearbeiter: x.resultBy ? (users[x.resultBy]?.displayName ?? '') : '',
        'Prämie (€)': contactBonus(x, c),
        Notizen: (x.notes ?? '').replace(/\n/g, ' | '),
      }));
    exportCsv(`kampagne-${c.name.replace(/\s+/g, '-').toLowerCase()}.csv`, rows);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Kampagnen-Verwaltung</h2>
          <p>
            Kampagnen bestimmen automatisch, welches Skript und welche Einwandkarten
            Agent:innen im timio-Cockpit sehen, sobald sie im Schichtplan zugewiesen sind.
            Wird eine Liste abtelefoniert, wird sie hier importiert.
          </p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <Plus size={14} /> Neue Kampagne
        </button>
      </div>

      {!loaded ? (
        <SkeletonCardGrid count={3} />
      ) : campaigns.length === 0 ? (
        <div className="widget empty">
          <Megaphone size={32} strokeWidth={1.4} className="empty-icon" />
          <h3>Noch keine Kampagnen</h3>
          <p>Lege die erste Kampagne an, z.B. für Kündiger-Rückgewinnung oder Welcome-Calls.</p>
        </div>
      ) : (
        <div className="agent-manage-grid">
          {campaigns.map((c) => {
            const s = campaignStats(outboundContacts, c.id);
            const hasList = s.total > 0;
            return (
              <div key={c.id} className={`agent-manage-card ${c.active ? '' : 'inactive'}`}>
                <div className="agent-manage-head">
                  <span className="agent-avatar lg">
                    <Megaphone size={18} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="agent-cell-name">{c.name}</div>
                    <div className="agent-manage-badges">
                      <span className="agent-role-badge subtle">{CALL_TYPE_SHORT[c.callType]}</span>
                      <span className={`agent-role-badge ${c.active ? 'manager' : 'locked'}`}>
                        {c.active ? 'Aktiv' : 'Inaktiv'}
                      </span>
                      {(c.startDate || c.endDate) && (
                        <span className="agent-role-badge subtle">
                          {c.startDate ? formatDate(c.startDate) : '…'} –{' '}
                          {c.endDate ? formatDate(c.endDate) : '…'}
                        </span>
                      )}
                      {c.targetProduct && (
                        <span className="agent-role-badge subtle">{c.targetProduct}</span>
                      )}
                    </div>
                  </div>
                </div>

                {hasList ? (
                  <>
                    <div className="campaign-stat-row">
                      <div className="agent-manage-stat">
                        <span>{s.total}</span>
                        <label>Kontakte</label>
                      </div>
                      <div className="agent-manage-stat">
                        <span>{s.offen}</span>
                        <label>offen</label>
                      </div>
                      <div className="agent-manage-stat">
                        <span>{s.termine}</span>
                        <label>Termine</label>
                      </div>
                      <div className="agent-manage-stat">
                        <span>{s.abschluesse}</span>
                        <label>Abschlüsse</label>
                      </div>
                      <div className="agent-manage-stat">
                        <span>{s.conversion === null ? '–' : `${s.conversion}%`}</span>
                        <label>Conversion</label>
                      </div>
                    </div>

                    <div className="outbound-progress">
                      <div
                        className="outbound-progress-fill"
                        style={{ width: `${s.fortschritt}%` }}
                      />
                    </div>
                    <div className="muted outbound-progress-label">
                      {s.fortschritt}% abgearbeitet · {s.versuche} Anrufe
                      {(c.bonusTermin > 0 || c.bonusAbschluss > 0) && (
                        <>
                          {' · '}
                          <Coins size={12} /> {formatCurrency(c.bonusTermin)} /{' '}
                          {formatCurrency(c.bonusAbschluss)}
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="muted">
                    Keine Anrufliste — reine Inbound-Kampagne, oder die Liste fehlt noch.
                  </p>
                )}

                <div className="agent-manage-actions">
                  <button className="btn btn-sm btn-primary" onClick={() => setImportFor(c)}>
                    <Upload size={13} /> Liste importieren
                  </button>
                  {hasList && (
                    <>
                      <button className="btn btn-sm" onClick={() => setDetailFor(c)}>
                        <BarChart3 size={13} /> Auswertung
                      </button>
                      <button className="btn btn-sm" onClick={() => exportCampaign(c)}>
                        <Download size={13} /> CSV
                      </button>
                    </>
                  )}
                  <button className="btn btn-sm" onClick={() => openEdit(c)}>
                    <Pencil size={13} /> Bearbeiten
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => updateCampaign(c.id, { active: !c.active })}
                  >
                    {c.active ? (
                      <>
                        <EyeOff size={13} /> Deaktivieren
                      </>
                    ) : (
                      <>
                        <Eye size={13} /> Aktivieren
                      </>
                    )}
                  </button>
                  {hasList && (
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => setConfirmClear(c)}
                      title="Anrufliste leeren"
                    >
                      <Eraser size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {agentRows.length > 0 && (
        <div className="widget" style={{ marginTop: 18 }}>
          <div className="widget-title">
            <Users size={14} /> Outbound-Leistung des Teams
          </div>
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Mitarbeiter:in</th>
                  <th>Bearbeitet</th>
                  <th>Termine</th>
                  <th>Abschlüsse</th>
                  <th>Prämien</th>
                </tr>
              </thead>
              <tbody>
                {agentRows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.name}</td>
                    <td>{r.bearbeitet}</td>
                    <td>{r.termine}</td>
                    <td>{r.abschluesse}</td>
                    <td>{formatCurrency(r.bonus)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {formOpen && (
        <CampaignForm
          key={editing?.id ?? 'new'}
          campaign={editing}
          onClose={() => setFormOpen(false)}
        />
      )}

      {importFor && (
        <ContactImportDialog campaign={importFor} onClose={() => setImportFor(null)} />
      )}

      {detailFor && (
        <Modal
          open
          onClose={() => setDetailFor(null)}
          title={`Auswertung: ${detailFor.name}`}
          subtitle="Ergebnisse dieser Anrufliste im Überblick."
        >
          <CampaignDetail campaign={detailFor} />
        </Modal>
      )}

      {confirmClear && (
        <Modal
          open
          onClose={() => setConfirmClear(null)}
          title="Anrufliste leeren?"
          subtitle={confirmClear.name}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmClear(null)}>
                Abbrechen
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  clearCampaignContacts(confirmClear.id);
                  setConfirmClear(null);
                }}
              >
                Liste leeren
              </button>
            </>
          }
        >
          <p>
            Alle{' '}
            {outboundContacts.filter((c) => c.campaignId === confirmClear.id).length} Kontakte
            dieser Kampagne werden gelöscht — inklusive der erfassten Ergebnisse. Die
            Kampagne selbst und die protokollierten Anrufe bleiben bestehen.
          </p>
        </Modal>
      )}
    </div>
  );
}

/** Ergebnis-Verteilung und offene Wiedervorlagen einer einzelnen Kampagne. */
function CampaignDetail({ campaign }: { campaign: Campaign }) {
  const { outboundContacts } = useStore();
  const { users } = useAuth();

  const rows = outboundContacts.filter((c) => c.campaignId === campaign.id);
  const stats = campaignStats(outboundContacts, campaign.id);

  const byStatus = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of rows) map.set(c.status, (map.get(c.status) ?? 0) + 1);
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const offene = useMemo(
    () =>
      rows
        .filter((c) => c.followUpDate && (c.status === 'termin' || c.status === 'wiedervorlage'))
        .sort((a, b) => (a.followUpDate ?? '').localeCompare(b.followUpDate ?? ''))
        .slice(0, 12),
    [rows],
  );

  const bonusTotal = rows.reduce((sum, c) => sum + contactBonus(c, campaign), 0);

  return (
    <>
      <div className="campaign-stat-row">
        <div className="agent-manage-stat">
          <span>{stats.versuche}</span>
          <label>Anrufe</label>
        </div>
        <div className="agent-manage-stat">
          <span>{stats.erreichbarkeit === null ? '–' : `${stats.erreichbarkeit}%`}</span>
          <label>erreicht</label>
        </div>
        <div className="agent-manage-stat">
          <span>{stats.conversion === null ? '–' : `${stats.conversion}%`}</span>
          <label>Conversion</label>
        </div>
        <div className="agent-manage-stat">
          <span>{formatCurrency(bonusTotal)}</span>
          <label>Prämien</label>
        </div>
      </div>

      <div className="section-title" style={{ marginTop: 14 }}>
        Ergebnisse
      </div>
      <div className="table-wrap">
        <table className="crm-table">
          <tbody>
            {byStatus.map(([status, count]) => (
              <tr key={status}>
                <td>{CONTACT_STATUS_LABEL[status as keyof typeof CONTACT_STATUS_LABEL]}</td>
                <td>{count}</td>
                <td className="muted">{Math.round((count / rows.length) * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title" style={{ marginTop: 14 }}>
        Offene Wiedervorlagen und Termine
      </div>
      <div className="table-wrap">
        <table className="crm-table">
          <tbody>
            {offene.map((c) => (
              <tr key={c.id}>
                <td>{c.customerName}</td>
                <td>{CONTACT_STATUS_LABEL[c.status]}</td>
                <td>
                  {formatDate(c.followUpDate)}
                  {c.followUpTime && ` · ${c.followUpTime}`}
                </td>
                <td className="muted">
                  {c.resultBy ? (users[c.resultBy]?.displayName ?? '–') : '–'}
                </td>
              </tr>
            ))}
            {offene.length === 0 && (
              <tr>
                <td className="muted">Keine offenen Wiedervorlagen.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
