import { useMemo, useState } from 'react';
import {
  TrendingUp,
  FileSignature,
  ArrowLeftRight,
  Sparkles,
  Printer,
  Boxes,
  ArrowUpRight,
  ArrowDownRight,
  User,
  Users,
  Phone,
  Percent,
  LayoutGrid,
  Check,
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
} from '../lib/utils';
import { monthlySeries, trendPct } from '../lib/teamStats';
import { callVolumeStats, linkCallsToOutcomes, conversionStats } from '../lib/callStats';
import { useMonthCalls } from '../store/useMonthCalls';
import { useCurrentShiftContext } from '../hooks/useCurrentShiftContext';
import { StatusBadge } from '../components/StatusBadge';
import { JiraLink } from '../components/JiraLink';
import { FollowUpInbox } from '../components/FollowUpInbox';
import { SkeletonDashboard } from '../components/Skeleton';
import { IncentiveWidget } from '../components/IncentiveWidget';
import { ExpiryRadarWidget } from '../components/ExpiryRadarWidget';
import { AccessRequestInbox } from '../components/AccessRequests';
import { CustomizableGrid } from '../components/CustomizableGrid';
import type { WidgetDef } from '../lib/gridLayout';
import { useRouter } from '../router';
import type { CampaignCallType } from '../types';

type Scope = 'mine' | 'all';

// Beschriftungen für das Betriebskontext-Badge (Tier 2).
const CALL_TYPE_LABEL: Record<CampaignCallType, string> = {
  churn: 'Rückgewinnung',
  welcome: 'Willkommen',
  other: 'Sonstige',
};
const SHIFT_LABEL: Record<'frueh' | 'spaet', string> = {
  frueh: 'Frühschicht',
  spaet: 'Spätschicht',
};

export function Dashboard() {
  // Gezielte Selektoren statt Komplett-Abo: das Dashboard (inkl. Chart)
  // rendert so nur neu, wenn sich Verträge/Tarifwechsel/Settings ändern —
  // nicht bei jedem Realtime-Update von Notizen, Leads oder Aktivitäten.
  const allContracts = useStore((s) => s.contracts);
  const allTariffChanges = useStore((s) => s.tariffChanges);
  const settings = useStore((s) => s.settings);
  const loaded = useStore((s) => s.loaded);
  const currentUser = useAuth((s) => s.getCurrentUser());
  const greetName = currentUser?.displayName ?? 'Kolleg:in';
  // Live aus useShifts.todayShift + Kampagnen-Katalog abgeleitet (Tier 2).
  const shiftContext = useCurrentShiftContext();
  const shiftContextText = shiftContext.working
    ? shiftContext.campaignName
      ? `Heute: ${shiftContext.campaignName}${shiftContext.callType ? ` · ${CALL_TYPE_LABEL[shiftContext.callType]}` : ''}`
      : `Heute: ${shiftContext.shiftType === 'spaet' ? SHIFT_LABEL.spaet : SHIFT_LABEL.frueh}`
    : null;
  const { navigate } = useRouter();

  const [scope, setScope] = useState<Scope>('mine');
  const [editingLayout, setEditingLayout] = useState(false);
  const userKey = currentUser?.key;

  // Anrufe kommen aus dem geteilten, live gehaltenen Monats-Store
  // (useMonthCalls) — eine Quelle für Dashboard/TeamDashboard/AgentDetail, die
  // per calls-Realtime aktuell bleibt. `null` = lädt noch (Skeleton).
  const monthCalls = useMonthCalls((s) => s.calls);

  // Abschlussquote Anruf → Vertrag/Tarifwechsel (Stufe 4, KONZEPT-INTEGRATION.md).
  // Notizen/Leads werden hier bewusst per Store-Snapshot statt reaktivem
  // Selektor gelesen (siehe Kommentar oben zu allContracts/allTariffChanges) —
  // sonst würde jedes Notiz-/Lead-Realtime-Update diese Seite neu rendern.
  const callConversion = useMemo(() => {
    if (!monthCalls) return null;
    const scoped = scope === 'mine' && userKey ? monthCalls.filter((c) => c.agentId === userKey) : monthCalls;
    const { notes, leads } = useStore.getState();
    const links = linkCallsToOutcomes(scoped, allContracts, allTariffChanges, leads, notes);
    return conversionStats(links);
  }, [monthCalls, allContracts, allTariffChanges, scope, userKey]);

  const callVolume = monthCalls ? callVolumeStats(monthCalls, scope === 'mine' ? userKey : undefined) : null;

  const todayLabel = new Date().toLocaleDateString('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  if (!loaded) {
    return (
      <div>
        <div className="dash-header">
          <div>
            <h1 className="dash-greeting">
              {greeting()}, {greetName}
            </h1>
            <div className="dash-date">{todayLabel}</div>
          </div>
        </div>
        <SkeletonDashboard />
      </div>
    );
  }

  // Standardmäßig nur eigene Daten, bei 'all' alle anzeigen
  const contracts =
    scope === 'mine' && userKey
      ? allContracts.filter((c) => c.createdBy === userKey)
      : allContracts;
  const tariffChanges =
    scope === 'mine' && userKey
      ? allTariffChanges.filter((t) => t.createdBy === userKey)
      : allTariffChanges;

  const totalCommission =
    contracts.reduce((sum, c) => sum + calcContractCommission(c, settings), 0) +
    tariffChanges.reduce((sum, t) => sum + calcTariffCommission(t, settings), 0);

  const monthTariff = tariffChanges.filter((t) => isSameMonth(t.changeDate));

  // Einzige Quelle für Monats-/Vormonatsprovision und die 6-Monats-Reihe
  // (siehe teamStats.ts) — vorher hatte diese Seite ihre eigene, leicht
  // abweichende Kopie derselben Schleife.
  const series = monthlySeries(contracts, tariffChanges, settings, 6);
  const currentPoint = series[series.length - 1];
  const prevPoint = series[series.length - 2];
  const monthCommission = currentPoint.contractCommission + currentPoint.tariffCommission;
  const prevMonthCommission = prevPoint.contractCommission + prevPoint.tariffCommission;
  const trend = trendPct(monthCommission, prevMonthCommission);

  const target = currentUser?.monthlyTarget || 0;
  const targetProgress = target > 0 ? Math.min(100, (monthCommission / target) * 100) : 0;
  const remainingToTarget = Math.max(0, target - monthCommission);

  // Tage bis Monatsende
  const daysLeftInMonth = (() => {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return last - now.getDate();
  })();

  const chartData = series.map((p) => ({
    month: p.month,
    Neuvertrag: p.contractCommission,
    Tarifwechsel: p.tariffCommission,
  }));

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
        c.products.length === 0
          ? '–'
          : c.products.length === 1
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
            <stop offset="100%" stopColor="#3a8dd1" />
          </linearGradient>
        </defs>
      </svg>

      <div className="dash-header">
        <div>
          <h1 className="dash-greeting">
            {greeting()}, {greetName}
          </h1>
          <div className="dash-date">{todayLabel}</div>
          {shiftContextText && (
            <div className="dash-shift-context">
              <span className="dash-shift-context-dot" />
              {shiftContextText}
            </div>
          )}
        </div>
        <div className="dash-header-actions">
          <div
            className="scope-toggle"
            role="tablist"
            aria-label="Datenumfang"
          >
            <button
              role="tab"
              aria-selected={scope === 'mine'}
              className={`scope-toggle-btn ${scope === 'mine' ? 'active' : ''}`}
              onClick={() => setScope('mine')}
              title="Nur deine Vorgänge"
            >
              <User size={12} /> Meine
            </button>
            <button
              role="tab"
              aria-selected={scope === 'all'}
              className={`scope-toggle-btn ${scope === 'all' ? 'active' : ''}`}
              onClick={() => setScope('all')}
              title="Vorgänge aller Mitarbeitenden"
            >
              <Users size={12} /> Alle
            </button>
          </div>
          <button
            className={`dash-report-pill${editingLayout ? ' is-active' : ''}`}
            onClick={() => setEditingLayout((v) => !v)}
            title="Dashboard-Layout anpassen (Widgets verschieben, Größe ändern, ausblenden)"
          >
            {editingLayout ? <><Check size={13} /> Fertig</> : <><LayoutGrid size={13} /> Anpassen</>}
          </button>
          <button
            className="dash-report-pill"
            onClick={() => navigate({ name: 'report' })}
            title="Druckansicht des Monatsabschlusses öffnen"
          >
            <Printer size={13} /> Monatsbericht
          </button>
        </div>
      </div>

      {/* Bedingte Info-Boxen bleiben außerhalb des Grids (blenden sich selbst
          aus, wenn leer) und immer über volle Breite. */}
      <AccessRequestInbox />
      <IncentiveWidget />
      <ExpiryRadarWidget />

      <CustomizableGrid
        storageKey="crm-dashboard-layout"
        editing={editingLayout}
        widgets={[
          {
            id: 'target',
            title: 'Monatsziel',
            defaultW: 5,
            minW: 4,
            render: () => (
              <TargetWidget
                monthCommission={monthCommission}
                target={target}
                progress={targetProgress}
                daysLeft={daysLeftInMonth}
                remaining={remainingToTarget}
              />
            ),
          },
          {
            id: 'kpis',
            title: 'Kennzahlen',
            defaultW: 7,
            minW: 4,
            render: () => (
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
                  value={`${trend > 0 ? '+' : ''}${trend} %`}
                  delta={formatCurrency(prevMonthCommission) + ' im Vormonat'}
                  trend={trend > 0 ? 'positive' : trend < 0 ? 'negative' : undefined}
                />
                <KpiWidget
                  icon={<Phone size={14} />}
                  accent="blue"
                  label="Anrufe diesen Monat"
                  value={callVolume === null ? '–' : `${callVolume.count}`}
                  delta="von der Extension automatisch erfasst"
                />
                <KpiWidget
                  icon={<Percent size={14} />}
                  accent="orange"
                  label="Abschlussquote (Anruf → Vertrag/Tarifwechsel)"
                  value={callConversion?.conversionPct == null ? '–' : `${callConversion.conversionPct} %`}
                  delta={
                    callConversion?.linkedCount
                      ? `${callConversion.linkedCount} von ${callConversion.totalCount} Anrufen`
                      : 'noch keine Verknüpfung diesen Monat'
                  }
                />
              </div>
            ),
          },
          {
            id: 'chart',
            title: 'Provision pro Monat',
            defaultW: 6,
            minW: 4,
            render: () => (
              <div className="widget">
                <div className="row between" style={{ marginBottom: 10 }}>
                  <h3 className="widget-title" style={{ margin: 0 }}>
                    Provision pro Monat
                  </h3>
                  <span className="muted">Letzte 6 Monate</span>
                </div>
                <div style={{ width: '100%', height: 200 }}>
                  {/* Feste Höhe direkt am ResponsiveContainer statt nur am Wrapper:
                      sonst misst er beim ersten Rendern noch nichts (-1) und
                      warnt bei jedem Seitenaufbau in der Konsole. Die Breite
                      bleibt prozentual, also weiterhin responsiv. */}
                  <ResponsiveContainer height={200}>
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
            ),
          },
          {
            id: 'followups',
            title: 'Wiedervorlagen',
            defaultW: 6,
            minW: 4,
            render: () => <FollowUpInbox />,
          },
          {
            id: 'recent',
            title: 'Zuletzt erfasst',
            defaultW: 6,
            minW: 4,
            render: () => (
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
            ),
          },
          {
            id: 'topproducts',
            title: 'Top-Produkte',
            defaultW: 6,
            minW: 4,
            render: () => <TopProductsWidget items={topProducts} max={topMax} />,
          },
        ] as WidgetDef[]}
      />
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
  const radius = 44;
  const circ = 2 * Math.PI * radius;
  const dashOffset = circ - (progress / 100) * circ;
  const dailyNeeded = daysLeft > 0 ? remaining / daysLeft : 0;

  return (
    <div className="widget target-widget">
      <div className="target-ring">
        <svg width="104" height="104" viewBox="0 0 104 104">
          <circle
            className="target-ring-track"
            cx="52"
            cy="52"
            r={radius}
            fill="none"
            strokeWidth="9"
          />
          <circle
            className="target-ring-fill"
            cx="52"
            cy="52"
            r={radius}
            fill="none"
            strokeWidth="9"
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
            <span style={{ color: 'var(--green)', fontWeight: 600 }}>
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
        <div className="empty-inline" style={{ minHeight: 110 }}>
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
