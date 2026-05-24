import { useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  Search,
  RefreshCw,
  Filter,
  Lock,
  FileSignature,
  ArrowLeftRight,
  StickyNote,
  Target,
  Users as UsersIcon,
  Trash2,
  Edit3,
  Plus,
  LogIn,
  LogOut,
  Shield,
  UserCheck,
  UserX,
  Eraser,
  Crown,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../store/useAuth';
import { fetchAuditLog } from '../lib/supabaseApi';
import { getSupabase } from '../lib/supabase';
import type { AuditLogEntry, AuditAction, AuditEntity } from '../types';

const ACTION_LABEL: Record<AuditAction, string> = {
  create: 'Erstellt',
  update: 'Geändert',
  delete: 'Gelöscht',
  purge: 'Vollständig gelöscht',
  login: 'Angemeldet',
  logout: 'Abgemeldet',
  role_change: 'Rolle geändert',
  lock: 'Gesperrt',
  unlock: 'Entsperrt',
  consent: 'Datenschutz bestätigt',
  export: 'Exportiert',
};

const ENTITY_LABEL: Record<AuditEntity, string> = {
  contract: 'Vertrag',
  tariff_change: 'Tarifwechsel',
  note: 'Notiz',
  lead: 'Lead',
  lead_activity: 'Lead-Aktivität',
  customer: 'Kunde',
  user: 'Nutzer',
  incentive: 'Incentive',
  auth: 'Anmeldung',
  settings: 'Einstellungen',
};

const ACTION_ICON: Record<AuditAction, React.ReactNode> = {
  create: <Plus size={12} />,
  update: <Edit3 size={12} />,
  delete: <Trash2 size={12} />,
  purge: <Eraser size={12} />,
  login: <LogIn size={12} />,
  logout: <LogOut size={12} />,
  role_change: <Crown size={12} />,
  lock: <UserX size={12} />,
  unlock: <UserCheck size={12} />,
  consent: <CheckCircle2 size={12} />,
  export: <Shield size={12} />,
};

const ENTITY_ICON: Record<AuditEntity, React.ReactNode> = {
  contract: <FileSignature size={13} />,
  tariff_change: <ArrowLeftRight size={13} />,
  note: <StickyNote size={13} />,
  lead: <Target size={13} />,
  lead_activity: <Target size={13} />,
  customer: <UsersIcon size={13} />,
  user: <UsersIcon size={13} />,
  incentive: <Shield size={13} />,
  auth: <LogIn size={13} />,
  settings: <Shield size={13} />,
};

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const diff = (now - date.getTime()) / 1000;
  if (diff < 60) return 'gerade eben';
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
  if (diff < 7 * 86400) return `vor ${Math.floor(diff / 86400)} Tag${Math.floor(diff / 86400) === 1 ? '' : 'en'}`;
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AuditLog() {
  const { isManager, users } = useAuth();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<'all' | AuditAction>('all');
  const [entityFilter, setEntityFilter] = useState<'all' | AuditEntity>('all');
  const [userFilter, setUserFilter] = useState<'all' | string>('all');
  const [limit, setLimit] = useState(100);

  const reload = async (lim = limit) => {
    setLoading(true);
    try {
      const rows = await fetchAuditLog(lim);
      setEntries(rows);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isManager()) return;
    // Laden + Live-Abo gegen Supabase (externe Datenquelle) — der setState
    // im reload() ist hier beabsichtigt.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload(limit);
    const sb = getSupabase();
    const channel = sb
      .channel('audit-log-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_log' }, () => {
        reload(limit);
      })
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (actionFilter !== 'all' && e.action !== actionFilter) return false;
      if (entityFilter !== 'all' && e.entityType !== entityFilter) return false;
      if (userFilter !== 'all' && e.actorId !== userFilter) return false;
      if (q) {
        const hay = `${e.actorName} ${e.entityLabel ?? ''} ${e.entityId ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, search, actionFilter, entityFilter, userFilter]);

  const actorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of entries) {
      if (e.actorId) seen.set(e.actorId, e.actorName);
    }
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [entries]);

  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const last24h = entries.filter((e) => new Date(e.createdAt).getTime() >= todayMs);
    const deletes = entries.filter((e) => e.action === 'delete' || e.action === 'purge').length;
    return {
      total: entries.length,
      today: last24h.length,
      deletes,
    };
  }, [entries]);

  if (!isManager()) {
    return (
      <div className="widget empty">
        <Lock size={32} strokeWidth={1.4} className="empty-icon" />
        <h3>Nur für Chef-Accounts</h3>
        <p>Das Audit-Log enthält sensible Aktivitätsdaten und ist Manager-Accounts vorbehalten.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <ShieldCheck size={20} />
          <div>
            <h2 style={{ margin: 0 }}>Audit-Log</h2>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
              DSGVO-konforme Aktivitäts-Nachverfolgung — wer hat wann was getan?
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => reload(limit)}
            disabled={loading}
            title="Aktualisieren"
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Aktualisieren
          </button>
        </div>
      </div>

      <div className="audit-stats">
        <div className="audit-stat-card">
          <div className="audit-stat-label">Heute</div>
          <div className="audit-stat-value">{stats.today}</div>
          <div className="audit-stat-sub">Ereignisse</div>
        </div>
        <div className="audit-stat-card">
          <div className="audit-stat-label">Geladen</div>
          <div className="audit-stat-value">{stats.total}</div>
          <div className="audit-stat-sub">Einträge</div>
        </div>
        <div className="audit-stat-card">
          <div className="audit-stat-label">Löschungen</div>
          <div className="audit-stat-value">{stats.deletes}</div>
          <div className="audit-stat-sub">in diesem Fenster</div>
        </div>
      </div>

      <div className="audit-filter-bar">
        <div className="audit-search">
          <Search size={14} />
          <input
            type="text"
            placeholder="Nach Person, Kunde oder ID suchen …"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="audit-filter-group">
          <Filter size={13} />
          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value as 'all' | AuditAction)}>
            <option value="all">Alle Aktionen</option>
            {(Object.keys(ACTION_LABEL) as AuditAction[]).map((a) => (
              <option key={a} value={a}>{ACTION_LABEL[a]}</option>
            ))}
          </select>
          <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value as 'all' | AuditEntity)}>
            <option value="all">Alle Bereiche</option>
            {(Object.keys(ENTITY_LABEL) as AuditEntity[]).map((e) => (
              <option key={e} value={e}>{ENTITY_LABEL[e]}</option>
            ))}
          </select>
          <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
            <option value="all">Alle Personen</option>
            {actorOptions.map(([id, name]) => (
              <option key={id} value={id}>{users[id]?.displayName ?? name}</option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="widget empty">
          <ShieldCheck size={32} strokeWidth={1.4} className="empty-icon" />
          <h3>{entries.length === 0 ? 'Noch keine Einträge' : 'Keine Treffer'}</h3>
          <p>
            {entries.length === 0
              ? 'Sobald Nutzer:innen Aktionen ausführen, erscheinen hier die Einträge.'
              : 'Versuche die Filter zu lockern oder die Suche zu ändern.'}
          </p>
        </div>
      ) : (
        <div className="audit-list">
          {filtered.map((e) => (
            <AuditRow key={e.id} entry={e} />
          ))}
        </div>
      )}

      {entries.length >= limit && (
        <div className="row center" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn"
            onClick={() => setLimit((l) => l + 100)}
            disabled={loading}
          >
            Weitere 100 laden
          </button>
        </div>
      )}
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = !!entry.details && Object.keys(entry.details).length > 0;

  return (
    <div className={`audit-row action-${entry.action}`}>
      <div className="audit-row-icon" aria-hidden>
        {ENTITY_ICON[entry.entityType]}
      </div>
      <div className="audit-row-main">
        <div className="audit-row-headline">
          <span className="audit-actor">{entry.actorName}</span>
          <span className={`audit-action-badge act-${entry.action}`}>
            {ACTION_ICON[entry.action]}
            {ACTION_LABEL[entry.action]}
          </span>
          <span className="audit-entity-tag">{ENTITY_LABEL[entry.entityType]}</span>
        </div>
        {entry.entityLabel && (
          <div className="audit-row-target">{entry.entityLabel}</div>
        )}
        {expanded && hasDetails && (
          <pre className="audit-row-details">
            {JSON.stringify(entry.details, null, 2)}
          </pre>
        )}
      </div>
      <div className="audit-row-side">
        <div className="audit-time" title={formatTime(entry.createdAt)}>
          {formatRelative(entry.createdAt)}
        </div>
        {hasDetails && (
          <button
            type="button"
            className="audit-expand-btn"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Weniger' : 'Details'}
          </button>
        )}
      </div>
    </div>
  );
}
