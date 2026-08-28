import { useMemo, useState } from 'react';
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
  Phone,
  ShieldCheck,
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
import { formatCurrency, formatDate } from '../lib/utils';
import { agentStats, attainmentPct, teamKpis, monthlySeries, trendPct } from '../lib/teamStats';
import { useMonthCalls } from '../store/useMonthCalls';
import {
  callVolumeStats,
  linkCallsToOutcomes,
  conversionStats,
  saveRateStats,
  cancellationReasonBreakdown,
  campaignPerformance,
} from '../lib/callStats';
import { SkeletonTable } from '../components/Skeleton';
import { StatusInsights } from '../components/StatusInsights';
import { KpiTile } from '../components/KpiTile';

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
  /** Anrufe diesen Monat — null solange der Fetch noch läuft. */
  callCount: number | null;
}

export function TeamDashboard() {
  const {
    contracts,
    tariffChanges,
    leads,
    notes,
    settings,
    campaigns,
    outboundContacts,
    loaded,
  } = useStore();
  const { users, isManager } = useAuth();
  const { navigate } = useRouter();

  const kpis = useMemo(
    () => teamKpis(contracts, tariffChanges, leads, settings),
    [contracts, tariffChanges, leads, settings],
  );

  // Anrufe kommen aus dem geteilten, live gehaltenen Monats-Store
  // (useMonthCalls) — volle Zeilen für Pro-Agent-Aufschlüsselung, Abschluss-
  // quote (Stufe 4) und Disposition-Kennzahlen, per calls-Realtime aktuell.
  const monthCalls = useMonthCalls((s) => s.calls);

  const teamCallVolume = useMemo(() => (monthCalls ? callVolumeStats(monthCalls) : null), [monthCalls]);

  const teamCallConversion = useMemo(() => {
    if (!monthCalls) return null;
    return conversionStats(linkCallsToOutcomes(monthCalls, contracts, tariffChanges, leads, notes));
  }, [monthCalls, contracts, tariffChanges, leads, notes]);

  // Disposition-basierte Kennzahlen (Migration 021): Save-Rate über gehaltene
  // vs. gekündigte Anrufe, häufigste Kündigungsgründe, Performance je Kampagne.
  const teamSaveRate = useMemo(() => (monthCalls ? saveRateStats(monthCalls) : null), [monthCalls]);
  const churnReasons = useMemo(
    () => (monthCalls ? cancellationReasonBreakdown(monthCalls).slice(0, 6) : []),
    [monthCalls],
  );
  const churnReasonsHeight = Math.max(140, churnReasons.length * 34 + 20);
  const campaignRows = useMemo(
    () => (monthCalls ? campaignPerformance(monthCalls, campaigns) : []),
    [monthCalls, campaigns],
  );

  // Einzige Quelle für Pro-Mitarbeiter-Provision/Abschlüsse ist agentStats()
  // (teamStats.ts) — vorher baute diese Seite dieselbe Aggregation komplett
  // eigenständig nach (mit eigenem Storno-/Monats-Handling), was bei
  // künftigen Änderungen hätte auseinanderlaufen können. prevCommission wird
  // durch einen zweiten agentStats()-Aufruf mit dem Vormonat als Referenz
  // gewonnen, statt eine eigene Vormonats-Schleife zu pflegen.
  const rows = useMemo<AgentRow[]>(() => {
    const now = new Date();
    const prevRef = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // Letzte Aktivität pro Mitarbeiter:in — reine Anzeige-/Sortierhilfe für
    // die Tabelle, kein Kennzahlenwert, deshalb hier belassen statt in
    // teamStats.ts aufgenommen.
    const lastActivity = new Map<string, string>();
    const bump = (key: string | undefined, date: string) => {
      if (!key) return;
      if (!lastActivity.has(key) || date > (lastActivity.get(key) as string)) lastActivity.set(key, date);
    };
    contracts.forEach((c) => bump(c.createdBy, c.contractDate));
    tariffChanges.forEach((t) => bump(t.createdBy, t.changeDate));

    return Object.values(users)
      .map((u) => {
        const outbound = { contacts: outboundContacts, campaigns };
        const stats = agentStats(u.key, contracts, tariffChanges, settings, now, outbound);
        const prevCommission = agentStats(
          u.key,
          contracts,
          tariffChanges,
          settings,
          prevRef,
          outbound,
        ).monthCommission;
        return {
          key: u.key,
          displayName: u.displayName,
          role: u.role,
          isActive: u.isActive,
          target: u.monthlyTarget,
          monthContractCom: stats.monthContractCommission,
          monthTariffCom: stats.monthTariffCommission,
          monthContracts: stats.monthContracts,
          monthTariffs: stats.monthTariffs,
          monthCommission: stats.monthCommission,
          monthDeals: stats.monthDeals,
          totalCommission: stats.totalCommission,
          totalDeals: stats.totalDeals,
          prevCommission,
          attainment: attainmentPct(stats.monthCommission, u.monthlyTarget),
          trendPct: trendPct(stats.monthCommission, prevCommission),
          lastActivity: lastActivity.get(u.key) ?? '',
          callCount: monthCalls ? callVolumeStats(monthCalls, u.key).count : null,
        };
      })
      .sort((a, b) => b.monthCommission - a.monthCommission);
  }, [users, contracts, tariffChanges, settings, monthCalls, outboundContacts, campaigns]);

  /**
   * Gesperrte Konten gehören nicht in die Mannschaftsliste — ein gesperrter
   * Zugang ist niemand, den man einteilt oder dessen Zielerreichung man
   * bespricht. Ihre Vorgänge zählen aber weiterhin in den Kennzahlen oben:
   * ein im Mai erfasster Vertrag bleibt Umsatz, auch wenn das Konto im Juli
   * gesperrt wurde. Deshalb wird nur die Tabelle gefiltert, nicht `rows`.
   */
  const [showLocked, setShowLocked] = useState(false);
  const lockedCount = useMemo(() => rows.filter((r) => !r.isActive).length, [rows]);
  const visibleRows = useMemo(
    () => (showLocked ? rows : rows.filter((r) => r.isActive)),
    [rows, showLocked],
  );

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
      trendPct: trendPct(monthCommission, prevCommission),
    };
  }, [rows, contracts]);

  // Team-Provision der letzten 6 Monate (ungefiltert = ganzes Team)
  const trend6 = useMemo(
    () =>
      monthlySeries(contracts, tariffChanges, settings, 6).map((p) => ({
        month: p.month,
        Verträge: p.contractCommission,
        Tarifwechsel: p.tariffCommission,
      })),
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
  const perAgentHeight = Math.max(140, perAgent.length * 32 + 30);

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
        <KpiTile
          icon={<Phone size={15} />}
          accent="orange"
          label="Anrufe (Monat)"
          value={teamCallVolume === null ? '–' : `${teamCallVolume.count}`}
          sub="von der Extension automatisch erfasst"
        />
        <KpiTile
          icon={<Percent size={15} />}
          accent="blue"
          label="Anruf-Abschlussquote"
          value={teamCallConversion?.conversionPct == null ? '–' : `${teamCallConversion.conversionPct} %`}
          sub={
            teamCallConversion?.linkedCount
              ? `${teamCallConversion.linkedCount} von ${teamCallConversion.totalCount} Anrufen → Vertrag/Tarifwechsel/Lead/Notiz`
              : 'noch keine Verknüpfung diesen Monat'
          }
        />
        <KpiTile
          icon={<ShieldCheck size={15} />}
          accent="green"
          label="Save-Rate (Churn)"
          value={teamSaveRate?.saveRatePct == null ? '–' : `${teamSaveRate.saveRatePct} %`}
          sub={
            teamSaveRate && teamSaveRate.saved + teamSaveRate.cancelled > 0
              ? `${teamSaveRate.saved} gehalten · ${teamSaveRate.cancelled} gekündigt`
              : 'noch kein entschiedenes Gespräch'
          }
        />
      </div>

      {(churnReasons.length > 0 || campaignRows.length > 0) && (
        <>
          <div className="team-kpis-subhead">Outbound-Auswertung</div>
          <div className="grid-2" style={{ marginBottom: 10 }}>
            <div className="widget">
              <div className="row between" style={{ marginBottom: 10 }}>
                <h3 className="widget-title" style={{ margin: 0 }}>
                  Häufigste Kündigungsgründe
                </h3>
                <span className="muted">aktueller Monat</span>
              </div>
              {churnReasons.length === 0 ? (
                <div className="empty-inline">
                  <span>Noch keine gekündigten Gespräche erfasst.</span>
                </div>
              ) : (
                <div style={{ width: '100%', height: churnReasonsHeight }}>
                  <ResponsiveContainer height={churnReasonsHeight}>
                    <BarChart
                      data={churnReasons}
                      layout="vertical"
                      margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} fontSize={12} stroke="var(--text-tertiary)" />
                      <YAxis
                        type="category"
                        dataKey="reason"
                        width={120}
                        axisLine={false}
                        tickLine={false}
                        fontSize={12}
                        stroke="var(--text-tertiary)"
                      />
                      <Tooltip cursor={{ fill: 'rgba(255,59,48,0.05)' }} contentStyle={TOOLTIP_STYLE} />
                      <Bar dataKey="count" name="Kündigungen" fill="#ff3b30" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="widget">
              <div className="row between" style={{ marginBottom: 10 }}>
                <h3 className="widget-title" style={{ margin: 0 }}>
                  Save-Rate je Kampagne
                </h3>
                <span className="muted">aktueller Monat</span>
              </div>
              {campaignRows.length === 0 ? (
                <div className="empty-inline">
                  <span>Noch keine Anrufe mit Kampagnen-Zuordnung.</span>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th>Kampagne</th>
                        <th style={{ textAlign: 'right' }}>Anrufe</th>
                        <th style={{ textAlign: 'right' }}>Gehalten</th>
                        <th style={{ textAlign: 'right' }}>Save-Rate</th>
                        <th style={{ textAlign: 'right' }}>Ø Dauer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaignRows.map((c) => (
                        <tr key={c.campaignId}>
                          <td>{c.campaignName}</td>
                          <td style={{ textAlign: 'right' }}>{c.totalCalls}</td>
                          <td style={{ textAlign: 'right' }}>{c.saved}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>
                            {c.saveRatePct == null ? '–' : `${c.saveRatePct} %`}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {c.avgDurationS > 0 ? `${Math.round(c.avgDurationS / 60)} min` : '–'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}

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

      <StatusInsights />

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
            <ResponsiveContainer height={200}>
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
              <ResponsiveContainer height={200}>
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
          <div style={{ width: '100%', height: perAgentHeight }}>
            <ResponsiveContainer height={perAgentHeight}>
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
          {lockedCount > 0 && (
            <div className="team-locked-bar">
              <span className="muted">
                {lockedCount === 1
                  ? '1 gesperrtes Konto ausgeblendet'
                  : `${lockedCount} gesperrte Konten ausgeblendet`}{' '}
                — die Vorgänge zählen weiterhin in den Kennzahlen oben.
              </span>
              <button className="btn btn-sm" onClick={() => setShowLocked((v) => !v)}>
                {showLocked ? 'Ausblenden' : 'Einblenden'}
              </button>
            </div>
          )}
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Mitarbeiter:in</th>
                  <th style={{ textAlign: 'right' }}>Verträge</th>
                  <th style={{ textAlign: 'right' }}>Tarifw.</th>
                  <th style={{ textAlign: 'right' }}>Anrufe</th>
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
                {visibleRows.map((r, idx) => (
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
                    <td style={{ textAlign: 'right' }}>{r.callCount ?? '–'}</td>
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
        style={{ marginTop: 10, fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' }}
      >
        <BarChart3 size={13} /> Klicke auf eine Zeile für die Mitarbeiter-Detailansicht.
      </div>
    </div>
  );
}
