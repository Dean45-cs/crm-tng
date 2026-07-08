import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Ticket,
  Phone,
  Zap,
  Users,
  CalendarClock,
  MoreHorizontal,
  HelpCircle,
  DoorOpen,
  ChevronDown,
  Coffee,
  Power,
  UserRound,
} from 'lucide-react';
import { useStatus } from '../store/useStatus';
import { useAuth } from '../store/useAuth';
import {
  STATUS_DEFS,
  TICKET_SUBS,
  AFK_COLOR,
  statusDef,
  statusLabel,
  statusColor,
  formatClock,
} from '../lib/statusBoard';
import type { UserStatus } from '../types';

const STATUS_ICONS: Record<string, typeof Ticket> = {
  ticketschicht: Ticket,
  hotline: Phone,
  sonderaufgabe: Zap,
  meeting: Users,
  termin: CalendarClock,
  sonstige: MoreHorizontal,
  klaerung: HelpCircle,
  empfang: DoorOpen,
};

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** Rang für die Team-Sortierung: im Dienst zuerst, dann AFK, dann ohne Status. */
function presenceRank(s?: UserStatus): number {
  if (!s?.status) return 2;
  return s.isAfk ? 1 : 0;
}

export function StatusBar() {
  const statuses = useStatus((s) => s.statuses);
  const setStatus = useStatus((s) => s.setStatus);
  const setSub = useStatus((s) => s.setSub);
  const setDescription = useStatus((s) => s.setDescription);
  const toggleAfk = useStatus((s) => s.toggleAfk);
  const clearMyStatus = useStatus((s) => s.clearMyStatus);

  const currentUserKey = useAuth((s) => s.currentUserKey);
  const users = useAuth((s) => s.users);

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'me' | 'team'>('me');
  const wrapRef = useRef<HTMLDivElement>(null);

  const me = currentUserKey ? statuses[currentUserKey] : undefined;
  const myDef = statusDef(me?.status);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  // Team-Liste: alle aktiven Konten + ihr Live-Status, sinnvoll sortiert.
  const team = useMemo(() => {
    return Object.values(users)
      .filter((u) => u.isActive !== false)
      .map((u) => ({ user: u, st: statuses[u.key] as UserStatus | undefined }))
      .sort((a, b) => {
        const r = presenceRank(a.st) - presenceRank(b.st);
        if (r !== 0) return r;
        return a.user.displayName.localeCompare(b.user.displayName, 'de');
      });
  }, [users, statuses]);

  const liveCounts = useMemo(() => {
    let online = 0;
    let afk = 0;
    for (const t of team) {
      if (!t.st?.status) continue;
      if (t.st.isAfk) afk += 1;
      else online += 1;
    }
    return { online, afk };
  }, [team]);

  const triggerColor = me?.isAfk
    ? AFK_COLOR
    : me?.status
      ? statusColor(me.status)
      : 'var(--text-tertiary)';
  const triggerLabel = me?.status ? statusLabel(me.status) : 'Status setzen';

  const commitDesc = (value: string) => {
    if ((me?.description ?? '') !== value) setDescription(value);
  };

  return (
    <div ref={wrapRef} className="statusbar-wrap">
      <button
        type="button"
        className={`statusbar-trigger${me?.status ? ' has-status' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Status & Team"
      >
        <span
          className={`statusbar-dot${me?.status && !me?.isAfk ? ' live' : ''}`}
          style={{ background: triggerColor }}
        />
        <span className="statusbar-trigger-label">{triggerLabel}</span>
        {me?.isAfk && <span className="statusbar-afk-tag">AFK</span>}
        <ChevronDown size={13} className="statusbar-chevron" />
      </button>

      {open && (
        <div className="statusbar-pop" role="dialog" aria-label="Status-Board">
          <div className="statusbar-tabs">
            <button
              className={`statusbar-tab${tab === 'me' ? ' active' : ''}`}
              onClick={() => setTab('me')}
            >
              Mein Status
            </button>
            <button
              className={`statusbar-tab${tab === 'team' ? ' active' : ''}`}
              onClick={() => setTab('team')}
            >
              Team
              <span className="statusbar-tab-count">{liveCounts.online}</span>
            </button>
          </div>

          {tab === 'me' ? (
            <div className="statusbar-me">
              <div className="statusbar-grid">
                {STATUS_DEFS.map((s) => {
                  const Icon = STATUS_ICONS[s.id] ?? MoreHorizontal;
                  const active = me?.status === s.id;
                  return (
                    <button
                      key={s.id}
                      className={`statusbar-card${active ? ' active' : ''}`}
                      style={
                        active
                          ? { borderColor: s.color, background: `${s.color}1c` }
                          : undefined
                      }
                      onClick={() => setStatus(s.id)}
                    >
                      <span
                        className="statusbar-card-rail"
                        style={{ background: active ? s.color : 'var(--border-strong, var(--border))' }}
                      />
                      <Icon size={15} color={active ? s.color : 'var(--text-secondary)'} />
                      <span
                        className="statusbar-card-label"
                        style={active ? { color: s.color } : undefined}
                      >
                        {s.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              {me?.status === 'ticketschicht' && (
                <div className="statusbar-subs">
                  <div className="statusbar-sub-title">Tätigkeitsbereich</div>
                  <div className="statusbar-chips">
                    {TICKET_SUBS.map((sb) => (
                      <button
                        key={sb}
                        className={`statusbar-chip${me?.sub === sb ? ' active' : ''}`}
                        onClick={() => setSub(sb)}
                      >
                        {sb}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {myDef?.needsDesc && (
                <div className="statusbar-desc">
                  <label className="statusbar-sub-title" htmlFor="statusbar-desc-input">
                    {myDef.label} – was genau?
                  </label>
                  <input
                    id="statusbar-desc-input"
                    key={`${me?.status}:${me?.description ?? ''}`}
                    className="statusbar-desc-input"
                    type="text"
                    defaultValue={me?.description ?? ''}
                    maxLength={120}
                    placeholder="Kurze Beschreibung …"
                    onBlur={(e) => commitDesc(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                  />
                </div>
              )}

              <div className="statusbar-me-footer">
                <button
                  className={`statusbar-afk-btn${me?.isAfk ? ' active' : ''}`}
                  onClick={toggleAfk}
                  disabled={!me?.status}
                >
                  <Coffee size={13} />
                  {me?.isAfk ? 'Zurück' : 'Kurz weg (AFK)'}
                </button>
                {me?.status && (
                  <button className="statusbar-end-btn" onClick={clearMyStatus}>
                    <Power size={13} />
                    Beenden
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="statusbar-team">
              <div className="statusbar-team-head">
                <span>
                  <strong>{liveCounts.online}</strong> im Dienst
                </span>
                <span className="statusbar-team-afk">
                  <strong>{liveCounts.afk}</strong> AFK
                </span>
              </div>
              <div className="statusbar-team-list">
                {team.length === 0 && (
                  <div className="statusbar-team-empty">Noch keine Kolleg:innen.</div>
                )}
                {team.map(({ user, st }) => {
                  const isSelf = user.key === currentUserKey;
                  const color = st?.isAfk
                    ? AFK_COLOR
                    : st?.status
                      ? statusColor(st.status)
                      : 'var(--text-tertiary)';
                  const Icon = st?.status ? STATUS_ICONS[st.status] ?? UserRound : UserRound;
                  return (
                    <div key={user.key} className="statusbar-team-row">
                      <span
                        className="statusbar-team-avatar"
                        style={{ background: `${color}22`, color }}
                      >
                        {initialsOf(user.displayName)}
                      </span>
                      <div className="statusbar-team-main">
                        <div className="statusbar-team-name">
                          {user.displayName}
                          {isSelf && <span className="statusbar-you-tag">Du</span>}
                        </div>
                        <div className="statusbar-team-status" style={{ color: st?.status ? color : 'var(--text-tertiary)' }}>
                          <Icon size={12} />
                          {st?.status
                            ? statusLabel(st.status) + (st.sub ? ` / ${st.sub}` : '')
                            : 'Kein Status'}
                        </div>
                      </div>
                      {st?.status && st.isAfk && <span className="statusbar-row-afk">AFK</span>}
                      {st?.status && st.startedAt && (
                        <span className="statusbar-team-since">{formatClock(st.startedAt)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
