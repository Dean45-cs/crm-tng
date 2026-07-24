import { useMemo } from 'react';
import {
  ArrowLeft,
  FileSignature,
  ArrowLeftRight,
  StickyNote,
  Wallet,
  Target,
  Pencil,
  Trash2,
  Calendar,
  Crown,
  Lock,
  UserIcon,
  TrendingUp,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { useRouter } from '../router';
import {
  calcContractCommission,
  calcTariffCommission,
  formatCurrency,
  formatDate,
  TARIFF_CONTEXT_LABEL,
  TARIFF_TYPE_LABEL,
} from '../lib/utils';
import { agentStats, attainmentPct, monthlySeries } from '../lib/teamStats';
import { useMonthCalls } from '../store/useMonthCalls';
import { callVolumeStats, linkCallsToOutcomes, conversionStats } from '../lib/callStats';
import { KpiTile } from '../components/KpiTile';
import { StatusBadge } from '../components/StatusBadge';
import { JiraLink } from '../components/JiraLink';
import { AgentStatusHistory } from '../components/AgentStatusHistory';
import { useQuickAdd } from '../components/QuickAdd';

interface Props {
  agentKey: string;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function AgentDetail({ agentKey }: Props) {
  const { contracts, tariffChanges, notes, leads, settings, deleteContract, deleteTariffChange, deleteNote } =
    useStore();
  const { users, isManager } = useAuth();
  const { navigate } = useRouter();
  const { editContract, editTariff, editNote } = useQuickAdd();

  // Anrufe kommen aus dem geteilten, live gehaltenen Monats-Store
  // (useMonthCalls) — dieselbe Quelle wie Dashboard/TeamDashboard, per
  // calls-Realtime aktuell. `null` = lädt noch.
  const monthCalls = useMonthCalls((s) => s.calls);

  const agentCallVolume = useMemo(
    () => (monthCalls ? callVolumeStats(monthCalls, agentKey) : null),
    [monthCalls, agentKey],
  );
  const agentCallConversion = useMemo(() => {
    if (!monthCalls) return null;
    const own = monthCalls.filter((c) => c.agentId === agentKey);
    return conversionStats(linkCallsToOutcomes(own, contracts, tariffChanges, leads, notes));
  }, [monthCalls, agentKey, contracts, tariffChanges, leads, notes]);

  const agent = users[agentKey];

  const contractsList = useMemo(
    () =>
      contracts
        .filter((c) => c.createdBy === agentKey)
        .sort((a, b) => b.contractDate.localeCompare(a.contractDate)),
    [contracts, agentKey],
  );
  const tariffList = useMemo(
    () =>
      tariffChanges
        .filter((t) => t.createdBy === agentKey)
        .sort((a, b) => b.changeDate.localeCompare(a.changeDate)),
    [tariffChanges, agentKey],
  );
  const notesList = useMemo(
    () =>
      notes
        .filter((n) => n.createdBy === agentKey)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [notes, agentKey],
  );

  const stats = useMemo(
    () => agentStats(agentKey, contracts, tariffChanges, settings),
    [agentKey, contracts, tariffChanges, settings],
  );

  const chart6 = useMemo(
    () =>
      monthlySeries(contracts, tariffChanges, settings, 6, agentKey).map((p) => ({
        month: p.month,
        Verträge: p.contractCommission,
        Tarifwechsel: p.tariffCommission,
      })),
    [agentKey, contracts, tariffChanges, settings],
  );

  if (!isManager()) {
    return (
      <div className="widget empty">
        <Lock size={32} strokeWidth={1.4} className="empty-icon" />
        <h3>Kein Zugriff</h3>
        <p>Die Mitarbeiter-Detailansicht ist nur für Chefs sichtbar.</p>
      </div>
    );
  }

  if (!agent) {
    return (
      <div>
        <button
          className="btn btn-ghost"
          onClick={() => navigate({ name: 'teamdashboard' })}
          style={{ marginBottom: 16 }}
        >
          <ArrowLeft size={14} /> Zurück
        </button>
        <div className="widget empty">
          <UserIcon size={32} strokeWidth={1.4} className="empty-icon" />
          <h3>Mitarbeiter:in nicht gefunden</h3>
          <p>Dieser Zugang existiert nicht mehr.</p>
        </div>
      </div>
    );
  }

  const attainment = attainmentPct(stats.monthCommission, agent.monthlyTarget);

  return (
    <div>
      <button
        className="btn btn-ghost"
        onClick={() => navigate({ name: 'teamdashboard' })}
        style={{ marginBottom: 16 }}
      >
        <ArrowLeft size={14} /> Team-Dashboard
      </button>

      <div className="customer-hero">
        <div className="customer-hero-avatar">{initialsOf(agent.displayName)}</div>
        <div className="customer-hero-body">
          <h2 className="customer-hero-name">{agent.displayName}</h2>
          <div className="customer-owner-row">
            <span className={`agent-role-badge ${agent.role === 'manager' ? 'manager' : 'subtle'}`}>
              {agent.role === 'manager' ? <><Crown size={10} /> Chef</> : 'Vertrieb'}
            </span>
            {!agent.isActive && <span className="agent-role-badge locked">Gesperrt</span>}
          </div>
        </div>
        <div className="customer-hero-stats">
          <div className="hero-stat">
            <Wallet size={14} />
            <div>
              <div className="hero-stat-label">Provision (Monat)</div>
              <div className="hero-stat-value">{formatCurrency(stats.monthCommission)}</div>
            </div>
          </div>
          <div className="hero-stat">
            <Target size={14} />
            <div>
              <div className="hero-stat-label">Zielerreichung</div>
              <div className="hero-stat-value">
                {attainment === null ? '–' : `${attainment} %`}
              </div>
            </div>
          </div>
          <div className="hero-stat">
            <FileSignature size={14} />
            <div>
              <div className="hero-stat-label">Abschlüsse (Monat)</div>
              <div className="hero-stat-value">{stats.monthDeals}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="team-kpis" style={{ marginTop: 18 }}>
        <KpiTile label="Provision gesamt" value={formatCurrency(stats.totalCommission)} sub="über alle Monate" />
        <KpiTile label="Abschlüsse gesamt" value={stats.totalDeals} sub="Verträge + Tarifwechsel" />
        <KpiTile
          label="Monatsziel"
          value={agent.monthlyTarget > 0 ? formatCurrency(agent.monthlyTarget) : '–'}
          sub="individuelles Ziel"
        />
        <KpiTile
          label="Ø Provision / Abschluss"
          value={stats.totalDeals > 0 ? formatCurrency(stats.totalCommission / stats.totalDeals) : '–'}
          sub="Schnitt aller Abschlüsse"
        />
        <KpiTile
          label="Anrufe (Monat)"
          value={agentCallVolume === null ? '–' : agentCallVolume.count}
          sub="von der Extension automatisch erfasst"
        />
        <KpiTile
          label="Abschlussquote (Anruf → Vertrag/Tarifwechsel)"
          value={agentCallConversion?.conversionPct == null ? '–' : `${agentCallConversion.conversionPct} %`}
          sub={
            agentCallConversion?.linkedCount
              ? `${agentCallConversion.linkedCount} von ${agentCallConversion.totalCount} Anrufen`
              : 'noch keine Verknüpfung diesen Monat'
          }
        />
      </div>

      <div className="widget" style={{ marginBottom: 22 }}>
        <div className="row between" style={{ marginBottom: 14 }}>
          <h3
            className="widget-title"
            style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 7 }}
          >
            <TrendingUp size={15} /> Provision pro Monat
          </h3>
          <span className="muted">Letzte 6 Monate</span>
        </div>
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={chart6} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
              <XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={12} stroke="var(--text-tertiary)" />
              <YAxis axisLine={false} tickLine={false} fontSize={12} stroke="var(--text-tertiary)" />
              <Tooltip
                cursor={{ fill: 'rgba(0,102,179,0.05)' }}
                contentStyle={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  fontSize: 12,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
                }}
                formatter={(value) => formatCurrency(Number(value ?? 0))}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Verträge" stackId="a" fill="#0066b3" />
              <Bar dataKey="Tarifwechsel" stackId="a" fill="#00a3e0" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <AgentStatusHistory agentKey={agentKey} agentName={agent.displayName} />

      <Section icon={<FileSignature size={15} />} title="Verträge" count={contractsList.length}>
        {contractsList.length === 0 ? (
          <div className="muted" style={{ padding: '14px 2px' }}>Keine Verträge.</div>
        ) : (
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>KdNr.</th>
                  <th>Kunde</th>
                  <th>Produkte</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Provision</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {contractsList.map((c) => (
                  <tr key={c.id}>
                    <td>{formatDate(c.contractDate)}</td>
                    <td><code style={{ fontSize: 12 }}>{c.customerNumber}</code></td>
                    <td>{c.customerName}</td>
                    <td>
                      <div className="product-chips">
                        {c.products.slice(0, 2).map((p, i) => {
                          const cat = settings.products.find((x) => x.name === p)?.category;
                          return (
                            <span key={`${p}-${i}`} className={`product-chip cat-${cat}`}>{p}</span>
                          );
                        })}
                        {c.products.length > 2 && (
                          <span className="product-chip product-chip-more">
                            +{c.products.length - 2}
                          </span>
                        )}
                      </div>
                    </td>
                    <td><StatusBadge status={c.status} /></td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {formatCurrency(calcContractCommission(c, settings))}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="row end">
                        <button className="btn btn-ghost btn-sm" onClick={() => editContract(c)}>
                          <Pencil size={13} />
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => confirm('Wirklich löschen?') && deleteContract(c.id)}
                        >
                          <Trash2 size={13} color="var(--red)" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section icon={<ArrowLeftRight size={15} />} title="Tarifwechsel" count={tariffList.length}>
        {tariffList.length === 0 ? (
          <div className="muted" style={{ padding: '14px 2px' }}>Keine Tarifwechsel.</div>
        ) : (
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>KdNr.</th>
                  <th>Kunde</th>
                  <th>Art</th>
                  <th>MVLZ</th>
                  <th style={{ textAlign: 'right' }}>Provision</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tariffList.map((t) => (
                  <tr key={t.id}>
                    <td>{formatDate(t.changeDate)}</td>
                    <td><code style={{ fontSize: 12 }}>{t.customerNumber}</code></td>
                    <td>{t.customerName}</td>
                    <td>
                      <span className={`badge ${t.changeType === 'upgrade' ? 'badge-green' : 'badge-blue'}`}>
                        {TARIFF_TYPE_LABEL[t.changeType]}
                      </span>
                    </td>
                    <td style={{ fontSize: 12.5 }}>{TARIFF_CONTEXT_LABEL[t.context]}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {formatCurrency(calcTariffCommission(t, settings))}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="row end">
                        <button className="btn btn-ghost btn-sm" onClick={() => editTariff(t)}>
                          <Pencil size={13} />
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => confirm('Wirklich löschen?') && deleteTariffChange(t.id)}
                        >
                          <Trash2 size={13} color="var(--red)" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section icon={<StickyNote size={15} />} title="Notizen" count={notesList.length}>
        {notesList.length === 0 ? (
          <div className="muted" style={{ padding: '14px 2px' }}>Keine Notizen.</div>
        ) : (
          <div className="notes-grid">
            {notesList.map((n) => (
              <div key={n.id} className="note-card">
                <div className="row between">
                  <h4>{n.title}</h4>
                  <div className="row" style={{ gap: 2 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => editNote(n)}>
                      <Pencil size={12} />
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => confirm('Wirklich löschen?') && deleteNote(n.id)}
                    >
                      <Trash2 size={12} color="var(--red)" />
                    </button>
                  </div>
                </div>
                <div className="body">{n.content}</div>
                <div className="meta">
                  {n.customerName && (
                    <span className="row" style={{ gap: 3 }}>
                      <UserIcon size={11} /> {n.customerName}
                    </span>
                  )}
                  {n.jiraTicket && <JiraLink ticket={n.jiraTicket} />}
                  <span className="row" style={{ gap: 3, marginLeft: 'auto' }}>
                    <Calendar size={11} />
                    {formatDate(n.updatedAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 22 }}>
      <div className="customer-section-header">
        <div className="customer-section-title">
          {icon}
          <span>{title}</span>
        </div>
        <span className="customer-section-count">{count}</span>
      </div>
      {children}
    </section>
  );
}
