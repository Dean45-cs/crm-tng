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
  Legend,
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

const PIE_COLORS = ['#0066b3', '#00a3e0', '#34c759', '#ff9500', '#a855f7', '#ff3b30', '#5856d6', '#ffcc00'];

export function Dashboard() {
  const { contracts, tariffChanges, settings } = useStore();

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

  // last 6 months chart
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

  // product distribution
  const productMap = new Map<string, number>();
  contracts.forEach((c) => {
    productMap.set(c.product, (productMap.get(c.product) ?? 0) + 1);
  });
  const productData = Array.from(productMap.entries()).map(([name, value]) => ({
    name,
    value,
  }));

  const activeContracts = contracts.filter((c) => c.status !== 'storniert');

  const recent = [
    ...contracts.map((c) => ({
      type: 'Vertrag' as const,
      date: c.contractDate,
      customer: c.customerName,
      customerNumber: c.customerNumber,
      product: c.product,
      jira: c.jiraTicket,
      commission: calcContractCommission(c, settings),
      status: c.status,
    })),
    ...tariffChanges.map((t) => ({
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
      <div className="page-header">
        <div>
          <h2>Dashboard</h2>
          <p>Willkommen zurück, {settings.agentName}.</p>
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
          <div style={{ width: '100%', height: 250 }}>
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.07)" vertical={false} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={12} />
                <YAxis axisLine={false} tickLine={false} fontSize={12} />
                <Tooltip
                  cursor={{ fill: 'rgba(0,102,179,0.05)' }}
                  contentStyle={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                  formatter={(value) => formatCurrency(Number(value ?? 0))}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Neuvertrag" stackId="a" fill="#0066b3" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Tarifwechsel" stackId="a" fill="#00a3e0" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="row between" style={{ marginBottom: 6 }}>
            <h3 className="section-title" style={{ margin: 0 }}>
              <Target size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
              Monatsziel
            </h3>
            <span className="muted">{Math.round(targetProgress)}%</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.4px' }}>
            {formatCurrency(monthCommission)}
          </div>
          <div className="muted" style={{ marginBottom: 14 }}>
            von {formatCurrency(target)}
          </div>
          <div className="progress">
            <div className="progress-bar" style={{ width: `${targetProgress}%` }} />
          </div>
          <div className="muted" style={{ marginTop: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
            <Trophy size={13} />
            {targetProgress >= 100
              ? 'Ziel erreicht! 🎉'
              : `Noch ${formatCurrency(Math.max(0, target - monthCommission))} bis zum Ziel`}
          </div>

          {productData.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h3 className="section-title">Produktverteilung</h3>
              <div style={{ width: '100%', height: 180 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={productData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={62}
                      innerRadius={36}
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
                        borderRadius: 10,
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">Zuletzt erfasst</h3>
        {recent.length === 0 ? (
          <div className="muted">Noch keine Vorgänge vorhanden.</div>
        ) : (
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Typ</th>
                  <th>Kunde</th>
                  <th>KdNr.</th>
                  <th>Produkt</th>
                  <th>Status</th>
                  <th>Jira</th>
                  <th style={{ textAlign: 'right' }}>Provision</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => (
                  <tr key={i}>
                    <td>{formatDate(r.date)}</td>
                    <td>
                      <span className={`badge ${r.type === 'Vertrag' ? 'badge-blue' : 'badge-orange'}`}>
                        {r.type}
                      </span>
                    </td>
                    <td>{r.customer}</td>
                    <td><code style={{ fontSize: 12 }}>{r.customerNumber}</code></td>
                    <td>{r.product}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td><JiraLink ticket={r.jira} /></td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {formatCurrency(r.commission)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
