import { useId, useMemo, useState } from 'react';
import { Lock, Unlock, ShieldCheck, UserCog, Crown, Users } from 'lucide-react';
import { useAuth, type AuthUser } from '../store/useAuth';
import { useStore } from '../store/useStore';
import { formatCurrency } from '../lib/utils';

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function TeamManagement() {
  const { users, currentUserKey, isManager, setUserRole, setUserActive, setAgentTarget } = useAuth();

  const sorted = useMemo(
    () => Object.values(users).sort((a, b) => a.displayName.localeCompare(b.displayName, 'de')),
    [users],
  );

  if (!isManager()) {
    return (
      <div className="widget empty">
        <Lock size={32} strokeWidth={1.4} className="empty-icon" />
        <h3>Kein Zugriff</h3>
        <p>Die Team-Verwaltung ist nur für Chefs sichtbar.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Team-Verwaltung</h2>
          <p>Rollen vergeben, Monatsziele setzen und Zugänge sperren.</p>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="widget empty">
          <Users size={32} strokeWidth={1.4} className="empty-icon" />
          <h3>Noch keine Mitarbeitenden</h3>
          <p>Sobald sich Kolleg:innen registrieren, erscheinen sie hier.</p>
        </div>
      ) : (
        <div className="agent-manage-grid">
          {sorted.map((u) => (
            <AgentManageCard
              key={u.key}
              user={u}
              isSelf={u.key === currentUserKey}
              onSetRole={setUserRole}
              onSetActive={setUserActive}
              onSetTarget={setAgentTarget}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface CardProps {
  user: AuthUser;
  isSelf: boolean;
  onSetRole: (key: string, role: 'agent' | 'manager') => void;
  onSetActive: (key: string, isActive: boolean) => void;
  onSetTarget: (key: string, target: number) => void;
}

function AgentManageCard({ user, isSelf, onSetRole, onSetActive, onSetTarget }: CardProps) {
  const fid = useId();
  const { contracts, tariffChanges } = useStore();
  const [target, setTarget] = useState(String(user.monthlyTarget || ''));

  const dealCount = useMemo(
    () =>
      contracts.filter((c) => c.createdBy === user.key).length +
      tariffChanges.filter((t) => t.createdBy === user.key).length,
    [contracts, tariffChanges, user.key],
  );

  const commitTarget = () => {
    const num = parseFloat(target) || 0;
    if (num !== user.monthlyTarget) onSetTarget(user.key, num);
  };

  const isManagerRole = user.role === 'manager';

  return (
    <div className={`agent-manage-card ${user.isActive ? '' : 'inactive'}`}>
      <div className="agent-manage-head">
        <span className="agent-avatar lg">{initialsOf(user.displayName)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="agent-cell-name">
            {user.displayName}
            {isSelf && <span className="agent-role-badge subtle">Du</span>}
          </div>
          <div className="agent-manage-badges">
            <span className={`agent-role-badge ${isManagerRole ? 'manager' : 'subtle'}`}>
              {isManagerRole ? <><Crown size={10} /> Chef</> : 'Vertrieb'}
            </span>
            <span className={`agent-role-badge ${user.isActive ? 'subtle' : 'locked'}`}>
              {user.isActive ? 'Aktiv' : 'Gesperrt'}
            </span>
          </div>
        </div>
      </div>

      <div className="agent-manage-stat">
        {dealCount} Abschlüsse erfasst
      </div>

      <div className="field">
        <label htmlFor={`${fid}-target`}>Monatsziel (€)</label>
        <div className="row" style={{ gap: 8 }}>
          <input
            id={`${fid}-target`}
            type="number"
            step="10"
            min="0"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onBlur={commitTarget}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
          <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            {formatCurrency(parseFloat(target) || 0)}
          </span>
        </div>
      </div>

      <div className="agent-manage-actions">
        <button
          className="btn btn-sm"
          onClick={() => onSetRole(user.key, isManagerRole ? 'agent' : 'manager')}
          disabled={isSelf}
          title={isSelf ? 'Die eigene Rolle kann nicht geändert werden.' : undefined}
        >
          {isManagerRole ? <UserCog size={13} /> : <ShieldCheck size={13} />}
          {isManagerRole ? 'Chef entziehen' : 'Chef ernennen'}
        </button>
        <button
          className={`btn btn-sm ${user.isActive ? 'btn-danger' : ''}`}
          onClick={() => onSetActive(user.key, !user.isActive)}
          disabled={isSelf}
          title={isSelf ? 'Der eigene Zugang kann nicht gesperrt werden.' : undefined}
        >
          {user.isActive ? <Lock size={13} /> : <Unlock size={13} />}
          {user.isActive ? 'Sperren' : 'Entsperren'}
        </button>
      </div>
    </div>
  );
}
