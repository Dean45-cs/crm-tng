import { useState } from 'react';
import { Megaphone, Lock, Plus, Pencil, Eye, EyeOff } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { CampaignForm } from '../components/CampaignForm';
import type { Campaign, CampaignCallType } from '../types';

const CALL_TYPE_SHORT: Record<CampaignCallType, string> = {
  churn: 'Churn',
  welcome: 'Welcome',
  other: 'Sonstige',
};

export function CampaignManager() {
  const { campaigns, updateCampaign } = useStore();
  const { isManager } = useAuth();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | undefined>(undefined);

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

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Kampagnen-Verwaltung</h2>
          <p>
            Kampagnen bestimmen automatisch, welches Skript und welche Einwandkarten
            Agent:innen im timio-Cockpit sehen, sobald sie im Schichtplan zugewiesen sind.
          </p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <Plus size={14} /> Neue Kampagne
        </button>
      </div>

      {campaigns.length === 0 ? (
        <div className="widget empty">
          <Megaphone size={32} strokeWidth={1.4} className="empty-icon" />
          <h3>Noch keine Kampagnen</h3>
          <p>Lege die erste Kampagne an, z.B. für Kündiger-Rückgewinnung oder Welcome-Calls.</p>
        </div>
      ) : (
        <div className="agent-manage-grid">
          {campaigns.map((c) => (
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
                  </div>
                </div>
              </div>

              <div className="agent-manage-actions">
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
              </div>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <CampaignForm
          key={editing?.id ?? 'new'}
          campaign={editing}
          onClose={() => setFormOpen(false)}
        />
      )}
    </div>
  );
}
