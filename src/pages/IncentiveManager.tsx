import { useState } from 'react';
import { Award, Lock, Plus, Pencil, Trash2, Eye, EyeOff } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { formatCurrency, weekLabel, monthLabel } from '../lib/utils';
import { IncentiveForm } from '../components/IncentiveForm';
import { confirmDialog } from '../store/useConfirm';
import type { Incentive, IncentiveMechanic, IncentiveMetric, IncentivePeriod } from '../types';

const MECHANIC_SHORT: Record<IncentiveMechanic, string> = {
  goal: 'Zielprämie',
  competition: 'Wettbewerb',
};
const METRIC_SHORT: Record<IncentiveMetric, string> = {
  commission: 'Provision',
  contracts: 'Verträge',
  deals: 'Abschlüsse',
};
const PERIOD_SHORT: Record<IncentivePeriod, string> = {
  weekly: 'Wöchentlich',
  monthly: 'Monatlich',
};

export function IncentiveManager() {
  const { incentives, updateIncentive, deleteIncentive } = useStore();
  const { isManager } = useAuth();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Incentive | undefined>(undefined);

  if (!isManager()) {
    return (
      <div className="widget empty">
        <Lock size={32} strokeWidth={1.4} className="empty-icon" />
        <h3>Kein Zugriff</h3>
        <p>Die Incentive-Verwaltung ist nur für Chefs sichtbar.</p>
      </div>
    );
  }

  const openCreate = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const openEdit = (inc: Incentive) => {
    setEditing(inc);
    setFormOpen(true);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Incentive-Verwaltung</h2>
          <p>Team-Ziele mit Belohnung anlegen, aktivieren und verwalten.</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <Plus size={14} /> Neues Incentive
        </button>
      </div>

      {incentives.length === 0 ? (
        <div className="widget empty">
          <Award size={32} strokeWidth={1.4} className="empty-icon" />
          <h3>Noch keine Incentives</h3>
          <p>Lege das erste Team-Ziel an, um dein Team zu motivieren.</p>
        </div>
      ) : (
        <div className="agent-manage-grid">
          {incentives.map((inc) => (
            <div
              key={inc.id}
              className={`agent-manage-card ${inc.active ? '' : 'inactive'}`}
            >
              <div className="agent-manage-head">
                <span className="agent-avatar lg">
                  <Award size={18} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="agent-cell-name">{inc.title}</div>
                  <div className="agent-manage-badges">
                    <span className="agent-role-badge subtle">
                      {MECHANIC_SHORT[inc.mechanic]}
                    </span>
                    <span className="agent-role-badge subtle">
                      {METRIC_SHORT[inc.metric]}
                    </span>
                    <span className="agent-role-badge subtle">
                      {PERIOD_SHORT[inc.period]} ·{' '}
                      {inc.period === 'weekly' ? weekLabel() : monthLabel(0)}
                    </span>
                    <span
                      className={`agent-role-badge ${inc.active ? 'manager' : 'locked'}`}
                    >
                      {inc.active ? 'Aktiv' : 'Inaktiv'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="agent-manage-stat">
                {inc.mechanic === 'goal' && (
                  <>
                    Ziel:{' '}
                    <strong>
                      {inc.metric === 'commission'
                        ? formatCurrency(inc.target)
                        : `${inc.target} ${METRIC_SHORT[inc.metric]}`}
                    </strong>
                    {' · '}
                  </>
                )}
                Belohnung: <strong>{inc.reward}</strong>
              </div>

              <div className="agent-manage-actions">
                <button className="btn btn-sm" onClick={() => openEdit(inc)}>
                  <Pencil size={13} /> Bearbeiten
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => updateIncentive(inc.id, { active: !inc.active })}
                >
                  {inc.active ? (
                    <>
                      <EyeOff size={13} /> Deaktivieren
                    </>
                  ) : (
                    <>
                      <Eye size={13} /> Aktivieren
                    </>
                  )}
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() =>
                    confirmDialog({
                      title: 'Incentive löschen?',
                      message: `„${inc.title}" wird dauerhaft entfernt.`,
                      confirmLabel: 'Löschen',
                      danger: true,
                    }).then((ok) => { if (ok) deleteIncentive(inc.id); })
                  }
                >
                  <Trash2 size={13} /> Löschen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <IncentiveForm
          key={editing?.id ?? 'new'}
          incentive={editing}
          onClose={() => setFormOpen(false)}
        />
      )}
    </div>
  );
}
