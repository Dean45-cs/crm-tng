import {
  TrendingUp,
  FileSignature,
  ArrowLeftRight,
  Sparkles,
  Printer,
  Boxes,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
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

export function Dashboard() {
  const { contracts, tariffChanges, settings } = useStore();
  const currentUser = useAuth((s) => s.getCurrentUser());
  const greetName = currentUser?.displayName ?? settings.agentName;
  const { navigate } = useRouter();

  const totalCommission =
    contracts.reduce((sum, c) => sum + calcContractCommission(c, settings), 0) +
    tariffChanges.reduce((sum, t) => sum + calcTariffCommission(t, settings), 0);

  const monthContracts = contracts.filter((c) => isSameMonth(c.contractDate));
  const monthTariff = tariffChanges.filter((t) => isSameMonth(t.changeDate));

  const monthCommission =
    monthContracts.reduce((s, c) => s + calcContractCommission(c, settings), 0) +
    monthTariff.reduce((s, t) => s + calcTariffCommission(t, settings), 0);

  // Vormonat-Vergleich
  const prevMonthRef = (() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return d;
  })();
  const prevMonthCommission =
    contracts
      .filter((c) => isSameMonth(c.contractDate, prevMonthRef))
      .reduce((s, c) => s + calcContractCommission(c, settings), 0) +
    tariffChanges
      .filter((t) => isSameMonth(t.changeDate, prevMonthRef))
      .reduce((s, t) => s + calcTariffCommission(t, settings), 0);

  const trendPct =
    prevMonthCommission > 0
      ? Math.round(
          ((monthCommission - prevMonthCommission) / prevMonthCommission) * 100,
        )
      : monthCommission > 0
        ? 100
        : 0;

  const target = settings.monthlyTarget || 0;
  const targetProgress = target > 0 ? Math.min(100, (monthCommission / target) * 100) : 0;
  const remainingToTarget = Math.max(0, target - monthCommission);

  // Tage bis Monatsende
  const daysLeftInMonth = (() => {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return last - now.getDate();
  })();

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

  // Top-Produkte
  const productMap = new Map<string, number>();
  contracts.forEach((c) => {
    c.products.forEach((p) => {
      productMap.set(p, (productMap.get(p) ?? 0) + 1);
    });
  });
  const topProducts = Array.from(productMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const topMax = topProducts[0]?.count ?? 1;

  const activeContracts = contracts.filter((c) => c.status !== 'storniert');
  const offenCount = contracts.filter((c) => c.status === 'offen').length;

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
      {/* Versteckte SVG-Defs für Ring-Gradient */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        <defs>
          <linearGradient id="tng-ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0066b3" />
            <stop offset="100%" stopColor="#00a3e0" />
          </linearGradient>
        </defs>
      </svg>

      <div className="dash-header">
        <div>
          <h1 className="dash-greeting">
            {greeting()}, {greetName}
          </h1>
          <div className="dash-date">
            {new Date().toLocaleDateString('de-DE', {
              weekday: 'long',
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            })}
          </div>
        </div>
        <button
          className="dash-report-pill"
          onClick={() => navigate({ name: 'report' })}
          title="Druckansicht des Monatsabschlusses öffnen"
        >
          <Printer size={13} /> Monatsbericht
        </button>
      </div>

      <div className="widget-row hero-row">
        <TargetWidget
          monthCommission={monthCommission}
          target={target}
          progress={targetProgress}
          daysLeft={daysLeftInMonth}
          remaining={remainingToTarget}
        />

        <div className="widget-mini-grid">
          <KpiWidget
            icon={<TrendingUp size={14} />}
            accent="blue"
            label="Provision gesamt"
            value={formatCurrency(totalCommission)}
            delta={`${contracts.length + tariffChanges.length} Vorgänge`}
          />
          <KpiWidget
            icon={<FileSignature size={14} />}
            accent="orange"
            label="Aktive Verträge"
            value={`${activeContracts.length}`}
            delta={`${offenCount} offen`}
          />
          <KpiWidget
            icon={<ArrowLeftRight size={14} />}
            accent="purple"
            label="Tarifwechsel"
            value={`${tariffChanges.length}`}
            delta={`${monthTariff.length} diesen Monat`}
          />
          <KpiWidget
            icon={<Sparkles size={14} />}
            accent="green"
            label="vs. Vormonat"
            value={`${trendPct > 0 ? '+' : ''}${trendPct} %`}
            delta={formatCurrency(prevMonthCommission) + ' im Vormonat'}
            trend={trendPct > 0 ? 'positive' : trendPct < 0 ? 'negative' : undefined}
          />
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 14 }}>
        <div className="widget">
          <div className="row between" style={{ marginBottom: 14 }}>
            <h3 className="widget-title" style={{ margin: 0 }}>
              Provision pro Monat
            </h3>
            <span className="muted">Letzte 6 Monate</span>
          </div>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
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
                <Bar dataKey="Neuvertrag" stackId="a" fill="#0066b3" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Tarifwechsel" stackId="a" fill="#00a3e0" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <FollowUpInbox />
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="widget">
          <h3 className="widget-title">Zuletzt erfasst</h3>
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

        <TopProductsWidget items={topProducts} max={topMax} />
      </div>
    </div>
  );
}

function TargetWidget({
  monthCommission,
  target,
  progress,
  daysLeft,
  remaining,
}: {
  monthCommission: number;
  target: number;
  progress: number;
  daysLeft: number;
  remaining: number;
}) {
  const radius = 56;
  const circ = 2 * Math.PI * radius;
  const dashOffset = circ - (progress / 100) * circ;
  const dailyNeeded = daysLeft > 0 ? remaining / daysLeft : 0;

  return (
    <div className="widget target-widget">
      <div className="target-ring">
        <svg width="132" height="132" viewBox="0 0 132 132">
          <circle
            className="target-ring-track"
            cx="66"
            cy="66"
            r={radius}
            fill="none"
            strokeWidth="11"
          />
          <circle
            className="target-ring-fill"
            cx="66"
            cy="66"
            r={radius}
            fill="none"
            strokeWidth="11"
            strokeDasharray={circ}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <div className="target-ring-pct">
          {Math.round(progress)}%
          <span>Ziel</span>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="target-info-label">Monatsziel</div>
        <div className="target-info-value">{formatCurrency(monthCommission)}</div>
        <div className="target-info-sub">von {formatCurrency(target)}</div>
        <div className="target-info-forecast">
          {remaining > 0 ? (
            <>
              <span>
                Noch <strong>{formatCurrency(remaining)}</strong> · {daysLeft}{' '}
                Tage übrig
              </span>
            </>
          ) : target > 0 ? (
            <span style={{ color: '#2eb84e', fontWeight: 600 }}>
              ✓ Ziel erreicht
            </span>
          ) : (
            <span>Kein Monatsziel gesetzt</span>
          )}
        </div>
        {remaining > 0 && daysLeft > 0 && (
          <div
            className="target-info-sub"
            style={{ marginTop: 4, fontSize: 11.5 }}
          >
            ≈ {formatCurrency(dailyNeeded)} pro Tag
          </div>
        )}
      </div>
    </div>
  );
}

function KpiWidget({
  icon,
  accent,
  label,
  value,
  delta,
  trend,
}: {
  icon: React.ReactNode;
  accent: 'blue' | 'orange' | 'purple' | 'green';
  label: string;
  value: string;
  delta?: string;
  trend?: 'positive' | 'negative';
}) {
  return (
    <div className="widget kpi-widget">
      <div className="kpi-head">
        <span className="kpi-label">{label}</span>
        <div className={`kpi-chip accent-${accent}`}>{icon}</div>
      </div>
      <div>
        <div className="kpi-value">{value}</div>
        {delta && (
          <div className={`kpi-delta ${trend ?? ''}`}>
            {trend === 'positive' && (
              <ArrowUpRight size={11} style={{ verticalAlign: '-1px', marginRight: 2 }} />
            )}
            {trend === 'negative' && (
              <ArrowDownRight size={11} style={{ verticalAlign: '-1px', marginRight: 2 }} />
            )}
            {delta}
          </div>
        )}
      </div>
    </div>
  );
}

function TopProductsWidget({
  items,
  max,
}: {
  items: { name: string; count: number }[];
  max: number;
}) {
  return (
    <div className="widget">
      <h3 className="widget-title">
        <Boxes size={13} style={{ marginRight: 6, verticalAlign: '-2px' }} />
        Top-Produkte
      </h3>
      {items.length === 0 ? (
        <div className="empty-inline" style={{ minHeight: 200 }}>
          <span>Keine Produkte verkauft.</span>
        </div>
      ) : (
        <div className="top-products">
          {items.map((p, i) => (
            <div key={p.name} className="top-product-row">
              <span className="top-product-rank">{i + 1}</span>
              <span className="top-product-name">{p.name}</span>
              <span className="top-product-count">{p.count}×</span>
              <div className="top-product-bar">
                <div
                  className="top-product-bar-fill"
                  style={{ width: `${Math.round((p.count / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
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
