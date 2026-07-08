import { useEffect, useMemo, useState } from 'react';
import { History, Download, Coffee, Radio } from 'lucide-react';
import { useStatus } from '../store/useStatus';
import {
  computeStatusInsights,
  statusWindowStart,
  STATUS_WINDOW_LABEL,
  statusLabel,
  statusColor,
  formatDuration,
  formatClock,
  buildPowerBiRows,
  type StatusWindow,
} from '../lib/statusBoard';
import { exportCsv } from '../lib/utils';
import { logAudit } from '../lib/audit';

const WINDOWS: StatusWindow[] = ['today', 'week', 'month', 'all'];

interface TimelineItem {
  id: string;
  status: string;
  sub?: string;
  description?: string;
  isAfk: boolean;
  startedAt: string;
  endedAt?: string;
  durationSeconds: number;
  live: boolean;
}

/** Tages-Überschrift: „Heute" / „Gestern" / „Mi, 08.07.2026". */
function dayHeading(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return 'Heute';
  if (same(d, yest)) return 'Gestern';
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Detaillierter, nutzerfreundlicher Status-Verlauf einer einzelnen Person für
 * die Chef-Ansicht: Live-Status, Zeitverteilung im gewählten Fenster und eine
 * tagesweise gruppierte Timeline (wann welcher Status, wie lange, mit AFK).
 */
export function AgentStatusHistory({ agentKey, agentName }: { agentKey: string; agentName: string }) {
  const logs = useStatus((s) => s.logs);
  const statuses = useStatus((s) => s.statuses);
  const [win, setWin] = useState<StatusWindow>('week');

  // Tickende „Jetzt"-Zeit, damit die laufende Dauer live mitzählt (und der
  // Purity-Regel genügt: kein Date.now() direkt im Render).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const current = statuses[agentKey];
  const from = statusWindowStart(win);

  // Alle abgeschlossenen Abschnitte dieser Person im Fenster, neueste zuerst.
  const userLogs = useMemo(
    () =>
      logs
        .filter((l) => l.userId === agentKey && new Date(l.startedAt) >= from)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [logs, agentKey, from],
  );

  const insights = useMemo(
    () => computeStatusInsights(userLogs, current ? [current] : [], from),
    [userLogs, current, from],
  );

  // Timeline: laufender Status (falls gesetzt) oben, dann die Historie.
  const items = useMemo<TimelineItem[]>(() => {
    const arr: TimelineItem[] = [];
    if (current?.status && current.startedAt) {
      arr.push({
        id: 'live',
        status: current.status,
        sub: current.sub,
        description: current.description,
        isAfk: current.isAfk,
        startedAt: current.startedAt,
        durationSeconds: Math.max(0, (now - new Date(current.startedAt).getTime()) / 1000),
        live: true,
      });
    }
    for (const l of userLogs) {
      arr.push({
        id: l.id,
        status: l.status,
        sub: l.sub,
        description: l.description,
        isAfk: l.isAfk,
        startedAt: l.startedAt,
        endedAt: l.endedAt,
        durationSeconds: l.durationSeconds,
        live: false,
      });
    }
    return arr;
  }, [current, userLogs, now]);

  // Nach Tagen gruppieren (Reihenfolge bleibt: neueste zuerst).
  const groups = useMemo(() => {
    const map = new Map<string, TimelineItem[]>();
    for (const it of items) {
      const key = it.startedAt.slice(0, 10);
      const bucket = map.get(key);
      if (bucket) bucket.push(it);
      else map.set(key, [it]);
    }
    return Array.from(map.entries());
  }, [items]);

  const exportUser = () => {
    const all = logs.filter((l) => l.userId === agentKey);
    if (all.length === 0) return;
    const rows = buildPowerBiRows(all, () => agentName);
    const safe = agentName.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase();
    exportCsv(`status-${safe}-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    logAudit({
      action: 'export',
      entityType: 'status',
      entityId: agentKey,
      entityLabel: `Status-Verlauf ${agentName}`,
      details: { rows: rows.length },
    });
  };

  const totalLogs = useMemo(() => logs.filter((l) => l.userId === agentKey).length, [logs, agentKey]);

  return (
    <div className="widget" style={{ marginBottom: 22 }}>
      <div className="row between" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <h3 className="widget-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
          <History size={15} /> Status-Verlauf
        </h3>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="statusinsights-windows">
            {WINDOWS.map((w) => (
              <button
                key={w}
                className={`statusinsights-window${win === w ? ' active' : ''}`}
                onClick={() => setWin(w)}
              >
                {STATUS_WINDOW_LABEL[w]}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={exportUser} disabled={totalLogs === 0}>
            <Download size={13} /> Export
          </button>
        </div>
      </div>

      {/* Live-Status */}
      {current?.status ? (
        <div
          className="agent-status-live"
          style={{ borderColor: `${statusColor(current.status)}66` }}
        >
          <Radio size={14} style={{ color: statusColor(current.status) }} />
          <span className="agent-status-live-label">
            Aktuell:&nbsp;
            <strong style={{ color: statusColor(current.status) }}>
              {statusLabel(current.status)}
              {current.sub ? ` / ${current.sub}` : ''}
            </strong>
            {current.isAfk && <span className="agent-status-afk-badge">AFK</span>}
          </span>
          {current.startedAt && (
            <span className="agent-status-live-since">
              seit {formatClock(current.startedAt)} · {formatDuration(
                Math.max(0, (now - new Date(current.startedAt).getTime()) / 1000),
              )}
            </span>
          )}
        </div>
      ) : (
        <div className="agent-status-live agent-status-live-idle">
          <Radio size={14} style={{ color: 'var(--text-tertiary)' }} />
          <span className="agent-status-live-label">Aktuell kein Status gesetzt</span>
        </div>
      )}

      {/* Zeitverteilung im Fenster */}
      <div className="agent-status-summary">
        <div className="agent-status-summary-head">
          <span>Zeitverteilung · {STATUS_WINDOW_LABEL[win]}</span>
          <span className="muted">Erfasst: {formatDuration(insights.totalSeconds)}</span>
        </div>
        {insights.perStatus.length === 0 ? (
          <div className="muted" style={{ fontSize: 12.5, padding: '4px 0' }}>
            Keine erfasste Zeit in diesem Zeitraum.
          </div>
        ) : (
          <div className="agent-status-bars">
            {insights.perStatus.map((p) => (
              <div key={p.id} className="agent-status-bar-row">
                <span className="agent-status-bar-label">{p.label}</span>
                <span className="agent-status-bar-track">
                  <span
                    className="agent-status-bar-fill"
                    style={{ width: `${Math.max(3, Math.round(p.share * 100))}%`, background: p.color }}
                  />
                </span>
                <span className="agent-status-bar-val">
                  {formatDuration(p.seconds)} · {Math.round(p.share * 100)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Timeline */}
      {items.length === 0 ? (
        <div className="empty-inline" style={{ marginTop: 14 }}>
          <span>Für {STATUS_WINDOW_LABEL[win].toLowerCase()} liegen keine Status-Einträge vor.</span>
        </div>
      ) : (
        <div className="agent-status-timeline">
          {groups.map(([day, dayItems]) => (
            <div key={day} className="agent-status-day">
              <div className="agent-status-day-head">{dayHeading(day + 'T00:00:00')}</div>
              {dayItems.map((it) => (
                <div key={it.id} className={`agent-status-entry${it.live ? ' live' : ''}`}>
                  <span className="agent-status-rail" style={{ background: statusColor(it.status) }} />
                  <span className="agent-status-time">
                    {formatClock(it.startedAt)}
                    <span className="agent-status-time-sep">–</span>
                    {it.live ? <span className="agent-status-now">jetzt</span> : formatClock(it.endedAt)}
                  </span>
                  <span className="agent-status-body">
                    <span className="agent-status-name" style={{ color: statusColor(it.status) }}>
                      {statusLabel(it.status)}
                      {it.sub ? <span className="agent-status-sub"> / {it.sub}</span> : ''}
                      {it.isAfk && (
                        <span className="agent-status-afk-badge">
                          <Coffee size={9} /> AFK
                        </span>
                      )}
                      {it.live && <span className="agent-status-live-tag">läuft</span>}
                    </span>
                    {it.description && (
                      <span className="agent-status-desc">↳ {it.description}</span>
                    )}
                  </span>
                  <span className="agent-status-dur">{formatDuration(it.durationSeconds)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
