import {
  Wallet,
  TrendingUp,
  FileSignature,
  ArrowLeftRight,
  Target,
  Trophy,
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
} from 'recharts';
import { useStore } from '../store/useStore';
import {
  calcContractCommission,
  calcTariffCommission,
  formatCurrency,
  formatDate,
  isSameMonth,
  monthKey,
  monthLabel,
} from '../lib/utils';
import { StatusBadge } from '../components/StatusBadge';
import { JiraLink } from '../components/JiraLink';
import { FollowUpInbox } from '../components/FollowUpInbox';
import { useRouter } from '../router';

const PIE_COLORS = ['#0066b3', '#00a3e0', '#34c759', '#ff9500', '#a855f7', '#ff3b30', '#5856d6', '#ffcc00'];

export function Dashboard() {
  const { contracts, tariffChanges, settings } = useStore();
  const { navigate } = useRouter();

  const totalCommission =
    contracts.reduce((sum, c) => sum + calcContractCommission(c, settings), 0) +
    tariffChanges.reduce((sum, t) => sum + calcTariffCommission(t, settings), 0);

  const monthContracts = contracts.filter((c) => isSameMonth(c.contractDate));
  const monthTariff = tariffChanges.filter((t) => isSameMonth(t.changeDate));

  const monthCommission =
    monthContracts.reduce((s, c) => s + calcContractCommission(c, settings), 0) +
    monthTariff.reduce((s, t) => s + calcTariffCommission(t, settings), 0);

  const target = settings.monthlyTarget || 0;
  const targetProgress = target > 0 ? Math.min(100, (monthCommission / target) * 100) : 0;

  const chartData = Array.from({ length: 6 }, (_, i) => {
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
      Neuvertrag: Math.round(cSum * 100) / 100,
      Tarifwechsel: Math.round(tSum * 100) / 100,
    };
  });

  const productMap = new Map<string, number>();
  contracts.forEach((c) => {
    c.products.forEach((p) => {
      productMap.set(p, (productMap.get(p) ?? 0) + 1);
    });
  });
  const productData = Array.from(productMap.entries()).map(([name, value]) => ({
    name,
    value,
  }));

  const activeContracts = contracts.filter((c) => c.status !== 'storniert');

  const recent = [
    ...contracts.map((c) => ({
      kind: 'contract' as const,
      id: c.id,
      kdnr: c.customerNumber,
      type: 'Vertrag' as const,
      date: c.contractDate,
      customer: c.customerName,
      customerNumber: c.customerNumber,
      product:
        c.products.length === 1
          ? c.products[0]
          : `${c.products[0]} +${c.products.length - 1}`,
      jira: c.jiraTicket,
      commission: calcContractCommission(c, settings),
      status: c.status,
    })),
    ...tariffChanges.map((t) => ({
      kind: 'tariff' as const,
      id: t.id,
      kdnr: t.customerNumber,
      type: 'Tarifwechsel' as const,
      date: t.changeDate,
      customer: t.customerName,
      customerNumber: t.customerNumber,
      product:
        t.oldProduct && t.newProduct
          ? `${t.oldProduct} → ${t.newProduct}`
          : t.changeType === 'upgrade'
            ? 'Upgrade'
            : 'Sidegrade / VVL',
      jira: t.jiraTicket,
      commission: calcTariffCommission(t, settings),
      status: 'aktiv' as const,
    })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);

  return (
    <div>
      <div className="hero-banner">
        <div>
          <div className="hero-greeting">
            {greeting()}, {settings.agentName} 👋
          </div>
          <div className="hero-sub">
            {new Date().toLocaleDateString('de-DE', {
              weekday: 'long',
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            })}
          </div>
        </div>
        <div className="hero-target">
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <Target size={14} />
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>
              Monatsziel · {Math.round(targetProgress)} %
            </span>
          </div>
          <div className="hero-progress">
            <div
              className="hero-progress-bar"
              style={{ width: `${targetProgress}%` }}
            />
          </div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            {formatCurrency(monthCommission)} / {formatCurrency(target)}
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard
          icon={<Wallet size={18} />}
          label="Provision (Monat)"
          value={formatCurrency(monthCommission)}
          delta={`${monthContracts.length + monthTariff.length} Abschlüsse`}
          color="bg-blue"
        />
        <StatCard
          icon={<TrendingUp size={18} />}
          label="Provision gesamt"
          value={formatCurrency(totalCommission)}
          delta={`${contracts.length + tariffChanges.length} Vorgänge`}
          color="bg-green"
        />
        <StatCard
          icon={<FileSignature size={18} />}
          label="Aktive Verträge"
          value={`${activeContracts.length}`}
          delta={`${contracts.filter((c) => c.status === 'offen').length} offen`}
          color="bg-orange"
        />
        <StatCard
          icon={<ArrowLeftRight size={18} />}
          label="Tarifwechsel"
          value={`${tariffChanges.length}`}
          delta={`${monthTariff.length} diesen Monat`}
          color="bg-purple"
        />
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="row between" style={{ marginBottom: 14 }}>
            <h3 className="section-title" style={{ margin: 0 }}>
              Provision pro Monat
            </h3>
            <span className="muted">Letzte 6 Monate</span>
          </div>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
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
                <Bar dataKey="Neuvertrag" stackId="a" fill="#0066b3" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Tarifwechsel" stackId="a" fill="#00a3e0" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <FollowUpInbox />
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3 className="section-title">Zuletzt erfasst</h3>
          {recent.length === 0 ? (
            <div className="empty-inline">
              <span>Noch keine Vorgänge.</span>
            </div>
          ) : (
            <div className="recent-list">
              {recent.map((r) => (
                <button
                  key={`${r.kind}-${r.id}`}
                  className="recent-item"
                  onClick={() => navigate({ name: 'customer', kdnr: r.kdnr })}
                >
                  <div className={`recent-bullet ${r.type === 'Vertrag' ? 'bullet-blue' : 'bullet-orange'}`} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row between" style={{ gap: 8 }}>
                      <div className="recent-name">{r.customer}</div>
                      <div className="recent-amount">{formatCurrency(r.commission)}</div>
                    </div>
                    <div className="recent-meta">
                      <span className="muted" style={{ fontSize: 11.5 }}>
                        {formatDate(r.date)} · {r.product}
                      </span>
                      {r.jira && <JiraLink ticket={r.jira} />}
                      <StatusBadge status={r.status} />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="section-title">
            <Trophy size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
            Produktverteilung
          </h3>
          {productData.length === 0 ? (
            <div className="empty-inline" style={{ minHeight: 200 }}>
              <span>Keine Produkte verkauft.</span>
            </div>
          ) : (
            <div style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={productData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={86}
                    innerRadius={50}
                    paddingAngle={2}
                  >
                    {productData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      fontSize: 12,
                      boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  delta,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  delta?: string;
  color: string;
}) {
  return (
    <div className="stat-card">
      <div className={`icon-wrap ${color}`}>{icon}</div>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {delta && <div className="delta">{delta}</div>}
    </div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Gute Nacht';
  if (hour < 11) return 'Guten Morgen';
  if (hour < 17) return 'Hallo';
  if (hour < 22) return 'Guten Abend';
  return 'Gute Nacht';
}
