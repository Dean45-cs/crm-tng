import { useMemo } from 'react';
import {
  Printer,
  ChevronRight,
  Lock,
  Users,
  BarChart3,
  Wallet,
  Target,
  Handshake,
  Percent,
  ArrowUpRight,
  ArrowDownRight,
  Crown,
  Coins,
  Inbox,
  Trophy,
  Clock,
  CalendarClock,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { useRouter } from '../router';
import {
  formatCurrency,
  formatDate,
  isSameMonth,
  monthKey,
  monthLabel,
  calcContractCommission,
  calcTariffCommission,
} from '../lib/utils';
import { attainmentPct, teamKpis } from '../lib/teamStats';
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

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

const TOOLTIP_STYLE = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  fontSize: 12,
  boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
};

interface AgentRow {
  key: string;
  displayName: string;
  role: string;
  isActive: boolean;
  target: number;
  monthContractCom: number;
  monthTariffCom: number;
  monthContracts: number;
  monthTariffs: number;
  monthCommission: number;
  monthDeals: number;
  totalCommission: number;
  totalDeals: number;
  prevCommission: number;
  attainment: number | null;
  trendPct: number;
  lastActivity: string;
}

export function TeamDashboard() {
  const { contracts, tariffChanges, leads, settings, loaded } = useStore();
  const { users, isManager } = useAuth();
  const { navigate } = useRouter();

  const kpis = useMemo(
    () => teamKpis(contracts, tariffChanges, leads, settings),
    [contracts, tariffChanges, leads, settings],
  );

  const rows = useMemo<AgentRow[]>(() => {
    const now = new Date();
    const prevRef = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    interface Acc {
      key: string;
      displayName: string;
      role: string;
      isActive: boolean;
      target: number;
      monthContractCom: number;
      monthTariffCom: number;
      monthContracts: number;
      monthTariffs: number;
      totalCommission: number;
      totalDeals: number;
      prevCommission: number;
      lastActivity: string;
    }

    const map = new Map<string, Acc>();
    Object.values(users).forEach((u) =>
      map.set(u.key, {
        key: u.key,
        displayName: u.displayName,
        role: u.role,
        isActive: u.isActive,
        target: u.monthlyTarget,
        monthContractCom: 0,
        monthTariffCom: 0,
        monthContracts: 0,
        monthTariffs: 0,
        totalCommission: 0,
        totalDeals: 0,
        prevCommission: 0,
        lastActivity: '',
      }),
    );

    contracts.forEach((c) => {
      const r = c.createdBy ? map.get(c.createdBy) : undefined;
      if (!r) return;
      const com = calcContractCommission(c, settings);
      // Stornierte Verträge zählen nicht als Abschluss (konsistent mit agentStats/teamKpis).
      const counts = c.status !== 'storniert';
      r.totalCommission += com;
      if (counts) r.totalDeals += 1;
      if (c.contractDate > r.lastActivity) r.lastActivity = c.contractDate;
      if (isSameMonth(c.contractDate, now)) {
        r.monthContractCom += com;
        if (counts) r.monthContracts += 1;
      } else if (isSameMonth(c.contractDate, prevRef)) {
        r.prevCommission += com;
      }
    });
    tariffChanges.forEach((t) => {
      const r = t.createdBy ? map.get(t.createdBy) : undefined;
      if (!r) return;
      const com = calcTariffCommission(t, settings);
      r.totalCommission += com;
      r.totalDeals += 1;
      if (t.changeDate > r.lastActivity) r.lastActivity = t.changeDate;
      if (isSameMonth(t.changeDate, now)) {
        r.monthTariffCom += com;
        r.monthTariffs += 1;
      } else if (isSameMonth(t.changeDate, prevRef)) {
        r.prevCommission += com;
      }
    });

    return Array.from(map.values())
      .map((r) => {
        const monthCommission = r.monthContractCom + r.monthTariffCom;
        const monthDeals = r.monthContracts + r.monthTariffs;
        const trendPct =
          r.prevCommission > 0
            ? Math.round(
                ((monthCommission - r.prevCommission) / r.prevCommission) * 100,
              )
            : monthCommission > 0
              ? 100
              : 0;
        return {
          ...r,
          monthCommission,
          monthDeals,
          attainment: attainmentPct(monthCommission, r.target),
          trendPct,
        };
      })
      .sort((a, b) => b.monthCommission - a.monthCommission);
  }, [users, contracts, tariffChanges, settings]);

  const team = useMemo(() => {
    const monthCommission = rows.reduce((s, r) => s + r.monthCommission, 0);
    const prevCommission = rows.reduce((s, r) => s + r.prevCommission, 0);
    const monthDeals = rows.reduce((s, r) => s + r.monthDeals, 0);
    const monthContracts = rows.reduce((s, r) => s + r.monthContracts, 0);
    const monthTariffs = rows.reduce((s, r) => s + r.monthTariffs, 0);
    const targetSum = rows.reduce((s, r) => s + r.target, 0);
    const activeContracts = contracts.filter((c) => c.status === 'aktiv').length;
    const openContracts = contracts.filter((c) => c.status === 'offen').length;
    const convBase = activeContracts + openContracts;
    const trendPct =
      prevCommission > 0
        ? Math.round(((monthCommission - prevCommission) / prevCommission) * 100)
        : monthCommission > 0
          ? 100
          : 0;
    return {
      monthCommission,
      prevCommission,
      monthDeals,
      monthContracts,
      monthTariffs,
      attainment: attainmentPct(monthCommission, targetSum),
      targetSum,
      conversion: convBase > 0 ? Math.round((activeContracts / convBase) * 100) : null,
      activeAgents: rows.filter((r) => r.isActive).length,
      trendPct,
    };
  }, [rows, contracts]);

  // Team-Provision der letzten 6 Monate
  const trend6 = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => {
        const offset = -5 + i;
        const refDate = new Date();
        refDate.setDate(1);
        refDate.setMonth(refDate.getMonth() + offset);
        const key = monthKey(refDate.toISOString());
        const cSum = contracts
          .filter((c) => monthKey(c.contractDate) === key)
          .reduce((s, c) => s + calcContractCommission(c, settings), 0);
        const tSum = tariffChanges
          .filter((t) => monthKey(t.changeDate) === key)
          .reduce((s, t) => s + calcTariffCommission(t, settings), 0);
        return {
          month: monthLabel(offset),
          Verträge: Math.round(cSum * 100) / 100,
          Tarifwechsel: Math.round(tSum * 100) / 100,
        };
      }),
    [contracts, tariffChanges, settings],
  );

  // Vertragsstatus (gesamt)
  const statusMix = useMemo(() => {
    const aktiv = contracts.filter((c) => c.status === 'aktiv').length;
    const offen = contracts.filter((c) => c.status === 'offen').length;
    const storniert = contracts.filter((c) => c.status === 'storniert').length;
    return [
      { name: 'Aktiv', value: aktiv, color: '#34c759' },
      { name: 'Offen', value: offen, color: '#f5a623' },
      { name: 'Storniert', value: storniert, color: '#ff3b30' },
    ].filter((s) => s.value > 0);
  }, [contracts]);

  // Provision je Mitarbeiter (Monat) — aufgeteilt nach Verträgen/Tarifwechseln
  const perAgent = useMemo(
    () =>
      rows.map((r) => ({
        name: firstName(r.displayName),
        Verträge: Math.round(r.monthContractCom * 100) / 100,
        Tarifwechsel: Math.round(r.monthTariffCom * 100) / 100,
      })),
    [rows],
  );

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

  const topPerformer = rows.find((r) => r.monthCommission > 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Team-Dashboard</h2>
          <p>Vollständige Übersicht über Leistung, Trends und Pipeline des Teams.</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => navigate({ name: 'teamreport' })}
        >
          <Printer size={14} /> Team-Bericht
        </button>
      </div>

      <div className="team-kpis">
        <KpiTile
          icon={<Wallet size={15} />}
          accent="blue"
          label="Team-Provision (Monat)"
          value={formatCurrency(team.monthCommission)}
          sub={`${team.monthDeals} Abschlüsse`}
        />
        <KpiTile
          icon={team.trendPct >= 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
          accent={team.trendPct >= 0 ? 'green' : 'red'}
          label="vs. Vormonat"
          value={`${team.trendPct > 0 ? '+' : ''}${team.trendPct} %`}
          sub={`Vormonat: ${formatCurrency(team.prevCommission)}`}
        />
        <KpiTile
          icon={<Target size={15} />}
          accent="purple"
          label="Zielerreichung Team"
          value={team.attainment === null ? '–' : `${team.attainment} %`}
          sub={`Ziel: ${formatCurrency(team.targetSum)}`}
        />
        <KpiTile
          icon={<Handshake size={15} />}
          accent="orange"
          label="Abschlüsse (Monat)"
          value={`${team.monthDeals}`}
          sub={`${team.monthContracts} Verträge · ${team.monthTariffs} Tarifwechsel`}
        />
        <KpiTile
          icon={<Percent size={15} />}
          accent="blue"
          label="Conversion-Rate"
          value={team.conversion === null ? '–' : `${team.conversion} %`}
          sub="aktive von (aktiv + offen)"
        />
        <KpiTile
          icon={<Users size={15} />}
          accent="green"
          label="Mitarbeitende"
          value={`${team.activeAgents}`}
          sub={`von ${rows.length} im Team`}
        />
      </div>

      <div className="team-kpis-subhead">Qualität &amp; Pipeline</div>
      <div className="team-kpis">
        <KpiTile
          icon={<Coins size={15} />}
          accent="blue"
          label="Ø Provision / Abschluss"
          value={formatCurrency(kpis.avgCommissionPerDeal)}
          sub="aktueller Monat"
        />
        <KpiTile
          icon={<Inbox size={15} />}
          accent="orange"
          label="Offene Leads"
          value={`${kpis.openLeads}`}
          sub="neu + in Bearbeitung"
        />
        <KpiTile
          icon={<Trophy size={15} />}
          accent="green"
          label="Lead-Conversion"
          value={kpis.leadConversion === null ? '–' : `${kpis.leadConversion} %`}
          sub="gewonnen von abgeschlossenen"
        />
        <KpiTile
          icon={<Clock size={15} />}
          accent="purple"
          label="Verträge laufen aus"
          value={`${kpis.expiringSoon}`}
          sub="Laufzeitende in ≤ 90 Tagen"
        />
        <KpiTile
          icon={<CalendarClock size={15} />}
          accent="orange"
          label="Fällige Wiedervorlagen"
          value={`${kpis.dueFollowUps}`}
          sub="heute + überfällig"
        />
      </div>

      {topPerformer && (
        <div className="team-top-banner">
          <Crown size={18} />
          <span>
            <strong>{topPerformer.displayName}</strong> führt das Team diesen Monat
            an — {formatCurrency(topPerformer.monthCommission)} Provision.
          </span>
        </div>
      )}

      <div className="grid-2" style={{ marginBottom: 10 }}>
        <div className="widget">
          <div className="row between" style={{ marginBottom: 10 }}>
            <h3 className="widget-title" style={{ margin: 0 }}>
              Team-Provision pro Monat
            </h3>
            <span className="muted">Letzte 6 Monate</span>
          </div>
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={trend6} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={12} stroke="var(--text-tertiary)" />
                <YAxis axisLine={false} tickLine={false} fontSize={12} stroke="var(--text-tertiary)" />
                <Tooltip
                  cursor={{ fill: 'rgba(0,102,179,0.05)' }}
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value) => formatCurrency(Number(value ?? 0))}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Verträge" stackId="a" fill="#0066b3" />
                <Bar dataKey="Tarifwechsel" stackId="a" fill="#00a3e0" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="widget">
          <div className="row between" style={{ marginBottom: 10 }}>
            <h3 className="widget-title" style={{ margin: 0 }}>
              Vertragsstatus
            </h3>
            <span className="muted">alle Verträge</span>
          </div>
          {statusMix.length === 0 ? (
            <div className="empty-inline">
              <span>Noch keine Verträge erfasst.</span>
            </div>
          ) : (
            <div style={{ width: '100%', height: 200 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={statusMix}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={58}
                    outerRadius={88}
                    paddingAngle={3}
                    stroke="none"
                  >
                    {statusMix.map((s) => (
                      <Cell key={s.name} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="widget" style={{ marginBottom: 10 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <h3 className="widget-title" style={{ margin: 0 }}>
            Provision je Mitarbeiter:in
          </h3>
          <span className="muted">aktueller Monat</span>
        </div>
        {perAgent.length === 0 ? (
          <div className="empty-inline">
            <span>Noch keine Mitarbeitenden.</span>
          </div>
        ) : (
          <div style={{ width: '100%', height: Math.max(160, perAgent.length * 32 + 30) }}>
            <ResponsiveContainer>
              <BarChart
                data={perAgent}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" horizontal={false} />
                <XAxis type="number" axisLine={false} tickLine={false} fontSize={12} stroke="var(--text-tertiary)" />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={96}
                  axisLine={false}
                  tickLine={false}
                  fontSize={12}
                  stroke="var(--text-tertiary)"
                />
                <Tooltip
                  cursor={{ fill: 'rgba(0,102,179,0.05)' }}
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value) => formatCurrency(Number(value ?? 0))}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Verträge" stackId="a" fill="#0066b3" />
                <Bar dataKey="Tarifwechsel" stackId="a" fill="#00a3e0" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="widget empty">
          <Users size={32} strokeWidth={1.4} className="empty-icon" />
          <h3>Noch keine Mitarbeitenden</h3>
          <p>Sobald sich Kolleg:innen registrieren, erscheinen sie hier.</p>
        </div>
      ) : (
        <div className="widget" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Mitarbeiter:in</th>
                  <th style={{ textAlign: 'right' }}>Verträge</th>
                  <th style={{ textAlign: 'right' }}>Tarifw.</th>
                  <th style={{ textAlign: 'right' }}>Provision (Monat)</th>
                  <th style={{ textAlign: 'right' }}>vs. VM</th>
                  <th style={{ textAlign: 'right' }}>Monatsziel</th>
                  <th>Zielerreichung</th>
                  <th style={{ textAlign: 'right' }}>Gesamt</th>
                  <th>Letzte Aktivität</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
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
                            {idx === 0 && r.monthCommission > 0 && (
                              <Crown size={13} style={{ color: '#f5a623' }} />
                            )}
                            {r.displayName}
                            {r.role === 'manager' && (
                              <span className="agent-role-badge">Chef</span>
                            )}
                            {!r.isActive && (
                              <span className="agent-role-badge locked">Gesperrt</span>
                            )}
                          </div>
                          <div className="agent-cell-sub">
                            {r.totalDeals} Abschlüsse gesamt
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>{r.monthContracts}</td>
                    <td style={{ textAlign: 'right' }}>{r.monthTariffs}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {formatCurrency(r.monthCommission)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span
                        className="team-trend"
                        style={{
                          color:
                            r.trendPct > 0
                              ? 'var(--green)'
                              : r.trendPct < 0
                                ? 'var(--red)'
                                : 'var(--text-tertiary)',
                        }}
                      >
                        {r.trendPct > 0 ? '+' : ''}
                        {r.trendPct} %
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {r.target > 0 ? formatCurrency(r.target) : '–'}
                    </td>
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
                    <td style={{ textAlign: 'right' }}>
                      {formatCurrency(r.totalCommission)}
                    </td>
                    <td className="muted" style={{ fontSize: 12.5 }}>
                      {r.lastActivity ? formatDate(r.lastActivity) : '–'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <ChevronRight size={15} style={{ color: 'var(--text-tertiary)' }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div
        className="muted"
        style={{ marginTop: 14, fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' }}
      >
        <BarChart3 size={13} /> Klicke auf eine Zeile für die Mitarbeiter-Detailansicht.
      </div>
    </div>
  );
}

function KpiTile({
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
