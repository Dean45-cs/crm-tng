import { useId, useMemo, useState } from 'react';
import { Lock, Unlock, ShieldCheck, UserCog, Crown, Users, UserPlus, Loader2 } from 'lucide-react';
import { useAuth, type AuthUser, type UserRole } from '../store/useAuth';
import { useStore } from '../store/useStore';
import { toast } from '../store/useToast';
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
  const { users, currentUserKey, isManager, setUserRole, setUserActive, setAgentTarget, createUser } =
    useAuth();
  const [showCreate, setShowCreate] = useState(false);

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
          <p>Konten anlegen, Rollen vergeben, Monatsziele setzen und Zugänge sperren.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate((v) => !v)}>
          <UserPlus size={14} /> Neues Konto
        </button>
      </div>

      {showCreate && (
        <CreateAccountForm
          onCreate={createUser}
          onDone={() => setShowCreate(false)}
        />
      )}

      {sorted.length === 0 ? (
        <div className="widget empty">
          <Users size={32} strokeWidth={1.4} className="empty-icon" />
          <h3>Noch keine Mitarbeitenden</h3>
          <p>Lege über „Neues Konto" den ersten Zugang für dein Team an.</p>
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

function CreateAccountForm({
  onCreate,
  onDone,
}: {
  onCreate: (name: string, pin: string, role?: UserRole) => Promise<{ ok: true } | { ok: false; error: string }>;
  onDone: () => void;
}) {
  const fid = useId();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<UserRole>('agent');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Bitte einen Namen eingeben.');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setError('Die Start-PIN muss aus genau 4 Ziffern bestehen.');
      return;
    }
    setBusy(true);
    const res = await onCreate(name, pin, role);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast.success(`Konto für ${name.trim()} angelegt.`);
    setName('');
    setPin('');
    setRole('agent');
    onDone();
  };

  return (
    <form className="widget create-account" onSubmit={submit}>
      <h3 className="widget-title" style={{ marginTop: 0 }}>
        <UserPlus size={15} style={{ marginRight: 7, verticalAlign: '-2px' }} />
        Neues Konto anlegen
      </h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>
        Lege Name und eine 4-stellige Start-PIN fest und gib sie an die:den
        Mitarbeitende:n weiter. Die PIN kann später nicht eingesehen werden.
      </p>

      <div className="create-account-row">
        <div className="field">
          <label htmlFor={`${fid}-name`}>Name</label>
          <input
            id={`${fid}-name`}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Max Mustermann"
            maxLength={32}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor={`${fid}-pin`}>Start-PIN</label>
          <input
            id={`${fid}-pin`}
            type="text"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="4 Ziffern"
            maxLength={4}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor={`${fid}-role`}>Rolle</label>
          <select
            id={`${fid}-role`}
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
          >
            <option value="agent">Vertrieb</option>
            <option value="manager">Chef</option>
          </select>
        </div>
      </div>

      {error && <div className="login-error" style={{ marginTop: 4 }}>{error}</div>}

      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />}
          {busy ? 'Lege an …' : 'Konto anlegen'}
        </button>
        <button type="button" className="btn" onClick={onDone} disabled={busy}>
          Abbrechen
        </button>
      </div>
    </form>
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
