import { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';
import { Activity, Coffee, Users, Timer, Download, Trash2 } from 'lucide-react';
import { useStatus } from '../store/useStatus';
import { useAuth } from '../store/useAuth';
import {
  computeStatusInsights,
  formatDuration,
  buildPowerBiRows,
  statusWindowStart,
  STATUS_WINDOW_LABEL,
} from '../lib/statusBoard';
import { exportCsv } from '../lib/utils';
import { logAudit } from '../lib/audit';

type Window = 'today' | 'week' | 'month';

const WINDOWS: Window[] = ['today', 'week', 'month'];

const TOOLTIP_STYLE = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  fontSize: 12,
  boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
};

/**
 * Chef-KPIs zum Status-Board: aktuelle Presence, Zeitverteilung je Status im
 * gewählten Fenster und der PowerBI-Export der Roh-Historie.
 */
export function StatusInsights() {
  const statuses = useStatus((s) => s.statuses);
  const logs = useStatus((s) => s.logs);
  const clearHistory = useStatus((s) => s.clearHistory);
  const users = useAuth((s) => s.users);

  const [win, setWin] = useState<Window>('today');
  const [confirmClear, setConfirmClear] = useState(false);

  const insights = useMemo(
    () => computeStatusInsights(logs, Object.values(statuses), statusWindowStart(win)),
    [logs, statuses, win],
  );

  const chartData = useMemo(
    () =>
      insights.perStatus.map((p) => ({
        name: p.label,
        Stunden: Math.round((p.seconds / 3600) * 100) / 100,
        color: p.color,
      })),
    [insights],
  );

  const userName = (id?: string): string =>
    (id && users[id]?.displayName) || 'Unbekannt';

  const exportPowerBi = () => {
    if (logs.length === 0) return;
    const rows = buildPowerBiRows(logs, userName);
    exportCsv(`status-powerbi-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    logAudit({
      action: 'export',
      entityType: 'status',
      entityLabel: 'Status-Historie → PowerBI',
      details: { rows: rows.length },
    });
  };

  return (
    <div className="widget" style={{ marginBottom: 10 }}>
      <div className="row between" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3 className="widget-title" style={{ margin: 0 }}>
            Team-Status &amp; Auslastung
          </h3>
          <p className="muted" style={{ margin: '2px 0 0', fontSize: 12.5 }}>
            Live-Presence und Zeitverteilung je Status.
          </p>
        </div>
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
      </div>

      <div className="team-kpis" style={{ marginBottom: 10 }}>
        <MiniTile
          icon={<Activity size={15} />}
          accent="green"
          label="Im Dienst"
          value={`${insights.onlineCount}`}
          sub="aktiv, nicht AFK"
        />
        <MiniTile
          icon={<Coffee size={15} />}
          accent="orange"
          label="AFK / kurz weg"
          value={`${insights.afkCount}`}
          sub="Status gesetzt, abwesend"
        />
        <MiniTile
          icon={<Users size={15} />}
          accent="blue"
          label="Mit Status"
          value={`${insights.activeCount}`}
          sub={`von ${Object.keys(users).length} im Team`}
        />
        <MiniTile
          icon={<Timer size={15} />}
          accent="purple"
          label={`Erfasste Zeit · ${STATUS_WINDOW_LABEL[win]}`}
          value={formatDuration(insights.totalSeconds)}
          sub={`${insights.perStatus.length} Status-Arten`}
        />
      </div>

      {chartData.length === 0 ? (
        <div className="empty-inline">
          <span>Für {STATUS_WINDOW_LABEL[win].toLowerCase()} wurde noch keine Status-Zeit erfasst.</span>
        </div>
      ) : (
        <>
          <div style={{ width: '100%', height: Math.max(130, chartData.length * 30 + 30) }}>
            <ResponsiveContainer>
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" horizontal={false} />
                <XAxis
                  type="number"
                  axisLine={false}
                  tickLine={false}
                  fontSize={12}
                  stroke="var(--text-tertiary)"
                  unit=" h"
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={128}
                  axisLine={false}
                  tickLine={false}
                  fontSize={12}
                  stroke="var(--text-tertiary)"
                />
                <Tooltip
                  cursor={{ fill: 'rgba(0,102,179,0.05)' }}
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value) => [`${value} h`, 'Dauer']}
                />
                <Bar dataKey="Stunden" radius={[0, 6, 6, 0]}>
                  {chartData.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="statusinsights-legend">
            {insights.perStatus.map((p) => (
              <div key={p.id} className="statusinsights-legend-item">
                <span className="statusinsights-legend-dot" style={{ background: p.color }} />
                <span className="statusinsights-legend-label">{p.label}</span>
                <span className="statusinsights-legend-val">
                  {formatDuration(p.seconds)} · {Math.round(p.share * 100)}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="statusinsights-actions">
        <button className="btn btn-primary" onClick={exportPowerBi} disabled={logs.length === 0}>
          <Download size={14} /> PowerBI-Datei erzeugen
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          {logs.length > 0
            ? `${logs.length} Abschnitte · CSV mit ISO-Zeitstempeln & Dauer`
            : 'Noch keine Historie zum Exportieren'}
        </span>
        <div style={{ flex: 1 }} />
        {logs.length > 0 &&
          (confirmClear ? (
            <span className="statusinsights-confirm">
              <span className="muted" style={{ fontSize: 12 }}>
                Ganze Historie löschen?
              </span>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => {
                  clearHistory();
                  setConfirmClear(false);
                }}
              >
                Ja, löschen
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(false)}>
                Abbrechen
              </button>
            </span>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(true)}>
              <Trash2 size={13} /> Historie löschen
            </button>
          ))}
      </div>
    </div>
  );
}

function MiniTile({
  icon,
  accent,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  accent: 'blue' | 'orange' | 'purple' | 'green' | 'red';
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="widget team-kpi">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="team-kpi-label">{label}</div>
        <span className={`team-kpi-icon accent-${accent}`}>{icon}</span>
      </div>
      <div className="team-kpi-value">{value}</div>
      <div className="team-kpi-sub">{sub}</div>
    </div>
  );
}
