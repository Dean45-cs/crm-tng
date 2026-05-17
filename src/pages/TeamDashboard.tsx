import { useMemo } from 'react';
import { Printer, ChevronRight, Lock, Users, BarChart3 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { useRouter } from '../router';
import { formatCurrency } from '../lib/utils';
import { agentStats, attainmentPct } from '../lib/teamStats';
import { SkeletonTable } from '../components/Skeleton';

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function TeamDashboard() {
  const { contracts, tariffChanges, settings, loaded } = useStore();
  const { users, isManager } = useAuth();
  const { navigate } = useRouter();

  const rows = useMemo(() => {
    return Object.values(users)
      .map((u) => {
        const stats = agentStats(u.key, contracts, tariffChanges, settings);
        return {
          key: u.key,
          displayName: u.displayName,
          role: u.role,
          isActive: u.isActive,
          target: u.monthlyTarget,
          stats,
          attainment: attainmentPct(stats.monthCommission, u.monthlyTarget),
        };
      })
      .sort((a, b) => b.stats.monthCommission - a.stats.monthCommission);
  }, [users, contracts, tariffChanges, settings]);

  const team = useMemo(() => {
    const monthCommission = rows.reduce((s, r) => s + r.stats.monthCommission, 0);
    const monthDeals = rows.reduce((s, r) => s + r.stats.monthDeals, 0);
    const targetSum = rows.reduce((s, r) => s + r.target, 0);
    const activeContracts = contracts.filter((c) => c.status === 'aktiv').length;
    const openContracts = contracts.filter((c) => c.status === 'offen').length;
    const convBase = activeContracts + openContracts;
    return {
      monthCommission,
      monthDeals,
      attainment: attainmentPct(monthCommission, targetSum),
      conversion: convBase > 0 ? Math.round((activeContracts / convBase) * 100) : null,
      activeAgents: rows.filter((r) => r.isActive).length,
    };
  }, [rows, contracts]);

  if (!isManager()) {
    return (
      <div className="widget empty">
        <Lock size={32} strokeWidth={1.4} className="empty-icon" />
        <h3>Kein Zugriff</h3>
        <p>Der Team-Bereich ist nur für Chefs sichtbar.</p>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h2>Team-Dashboard</h2>
            <p>Provision, Zielerreichung und Abschlüsse des gesamten Teams.</p>
          </div>
        </div>
        <SkeletonTable rows={6} cols={5} />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Team-Dashboard</h2>
          <p>Provision, Zielerreichung und Abschlüsse des gesamten Teams.</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => navigate({ name: 'teamreport' })}
        >
          <Printer size={14} /> Team-Bericht
        </button>
      </div>

      <div className="team-kpis">
        <div className="widget team-kpi">
          <div className="team-kpi-label">Team-Provision (Monat)</div>
          <div className="team-kpi-value">{formatCurrency(team.monthCommission)}</div>
          <div className="team-kpi-sub">{team.monthDeals} Abschlüsse</div>
        </div>
        <div className="widget team-kpi">
          <div className="team-kpi-label">Zielerreichung Team</div>
          <div className="team-kpi-value">
            {team.attainment === null ? '–' : `${team.attainment} %`}
          </div>
          <div className="team-kpi-sub">Summe aller Monatsziele</div>
        </div>
        <div className="widget team-kpi">
          <div className="team-kpi-label">Conversion-Rate</div>
          <div className="team-kpi-value">
            {team.conversion === null ? '–' : `${team.conversion} %`}
          </div>
          <div className="team-kpi-sub">aktive von (aktiv + offen)</div>
        </div>
        <div className="widget team-kpi">
          <div className="team-kpi-label">Mitarbeitende</div>
          <div className="team-kpi-value">{team.activeAgents}</div>
          <div className="team-kpi-sub">aktiv im Team</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="widget empty">
          <Users size={32} strokeWidth={1.4} className="empty-icon" />
          <h3>Noch keine Mitarbeitenden</h3>
          <p>Sobald sich Kolleg:innen registrieren, erscheinen sie hier.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Mitarbeiter:in</th>
                <th>Abschlüsse (Monat)</th>
                <th>Zielerreichung</th>
                <th style={{ textAlign: 'right' }}>Provision (Monat)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.key}
                  className="row-clickable"
                  onClick={() => navigate({ name: 'agentdetail', agentKey: r.key })}
                >
                  <td>
                    <div className="agent-cell">
                      <span className="agent-avatar">{initialsOf(r.displayName)}</span>
                      <div>
                        <div className="agent-cell-name">
                          {r.displayName}
                          {r.role === 'manager' && (
                            <span className="agent-role-badge">Chef</span>
                          )}
                          {!r.isActive && (
                            <span className="agent-role-badge locked">Gesperrt</span>
                          )}
                        </div>
                        <div className="agent-cell-sub">
                          Gesamt: {formatCurrency(r.stats.totalCommission)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>{r.stats.monthDeals}</td>
                  <td>
                    {r.attainment === null ? (
                      <span className="muted">kein Ziel</span>
                    ) : (
                      <div className="agent-target">
                        <div className="agent-target-bar">
                          <div
                            className="agent-target-fill"
                            style={{ width: `${Math.min(100, Math.max(2, r.attainment))}%` }}
                          />
                        </div>
                        <span className="agent-target-pct">{r.attainment} %</span>
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    {formatCurrency(r.stats.monthCommission)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <ChevronRight size={15} style={{ color: 'var(--text-tertiary)' }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="muted" style={{ marginTop: 14, fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' }}>
        <BarChart3 size={13} /> Klicke auf eine Zeile für die Mitarbeiter-Detailansicht.
      </div>
    </div>
  );
}
