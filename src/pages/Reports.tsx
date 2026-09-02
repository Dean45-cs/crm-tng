import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Clock,
  Download,
  Percent,
  Phone,
  Printer,
  ShieldCheck,
  Target,
  UserPlus,
  Wallet,
  PhoneOff,
  Timer,
  Hourglass,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { useRangeCalls } from '../store/useRangeCalls';
import { KpiTile } from '../components/KpiTile';
import { SkeletonTable } from '../components/Skeleton';
import { exportCsv, formatCurrency, formatDate } from '../lib/utils';
import {
  RANGE_PRESETS,
  RANGE_PRESET_LABEL,
  dateKey,
  previousRange,
  rangeFileStamp,
  resolveRange,
  type RangePreset,
} from '../lib/reportRange';
import {
  buildReport,
  deltaPct,
  formatDuration,
  type ReportAgent,
  type ReportSource,
} from '../lib/reporting';
import { SHORT_CALL_S } from '../lib/callStats';

/**
 * Berichtszentrale: eine Auswertung über einen frei wählbaren Zeitraum, die
 * Verkauf (Provision, Abschlüsse) und Outbound (Anrufe, Save-Rate,
 * Kündigungsgründe, Kampagnen) zusammenführt.
 *
 * Abgrenzung zu den bestehenden Seiten:
 * - Dashboard/Team-Dashboard zeigen den *laufenden Monat* als Betriebsanzeige.
 * - `MonthlyReport`/`TeamReport` sind unterschriftsfertige Monatsdokumente.
 * - Diese Seite beantwortet Fragen über beliebige Zeiträume („Wie lief Q2?",
 *   „Welcher Kündigungsgrund kam letzte Woche am häufigsten?") und gibt die
 *   Rohdaten als CSV heraus.
 *
 * Gerechnet wird ausschließlich in `lib/reporting.ts` — diese Datei stellt nur
 * dar. Dadurch sind die Zahlen identisch mit dem, was die Unit-Tests prüfen.
 */

const TOOLTIP_STYLE = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  fontSize: 12,
  boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
};

/** Wie viele Detailzeilen auf dem Bildschirm stehen — der CSV-Export enthält alle. */
const TABLE_PREVIEW_LIMIT = 100;

const firstName = (name: string): string => name.split(/\s+/)[0] ?? name;

/** Kompakter Balken je Zeile — für Verteilungen ohne eigenes Chart. */
function BarList({
  rows,
  color,
  empty,
}: {
  rows: { label: string; count: number; pct: number }[];
  color: string;
  empty: string;
}) {
  if (rows.length === 0) return <div className="reports-empty">{empty}</div>;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="reports-barlist">
      {rows.map((r) => (
        <div key={r.label} className="reports-barlist-row">
          <div className="reports-barlist-label" title={r.label}>
            {r.label}
          </div>
          <div className="reports-barlist-track">
            <div
              className="reports-barlist-fill"
              style={{ width: `${Math.max(2, (r.count / max) * 100)}%`, background: color }}
            />
          </div>
          <div className="reports-barlist-value">
            {r.count}
            <span className="reports-barlist-pct">{r.pct} %</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Abschnittsrahmen mit optionalem CSV-Knopf in der Kopfzeile. */
function Section({
  title,
  meta,
  onExport,
  exportDisabled,
  children,
}: {
  title: string;
  meta?: string;
  onExport?: () => void;
  exportDisabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="widget reports-section">
      <div className="row between reports-section-head">
        <div className="widget-title">{title}</div>
        <div className="row" style={{ gap: 8 }}>
          {meta && <span className="muted">{meta}</span>}
          {onExport && (
            <button
              className="btn btn-sm no-print"
              onClick={onExport}
              disabled={exportDisabled}
              title="Als CSV herunterladen"
            >
              <Download size={13} /> CSV
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

/** Vorzeichenbehaftete Veränderung als Kachel-Unterzeile. */
function deltaSub(current: number, previous: number, format: (n: number) => string): string {
  const d = deltaPct(current, previous);
  if (d === null) return 'keine Vergleichsdaten';
  return `${d > 0 ? '+' : ''}${d} % · zuvor ${format(previous)}`;
}

export function Reports() {
  const { contracts, tariffChanges, notes, leads, campaigns, settings, loaded } = useStore();
  const { users, isManager, getCurrentUser } = useAuth();
  const currentUser = getCurrentUser();
  const myKey = currentUser?.key ?? '';
  const canSeeTeam = isManager();

  const {
    calls,
    loading: callsLoading,
    truncated,
    error: callsError,
    loadRange,
    subscribeRealtime,
    reset,
  } = useRangeCalls();

  const [preset, setPreset] = useState<RangePreset>('thisMonth');
  const [customFrom, setCustomFrom] = useState(() => dateKey(new Date()));
  const [customTo, setCustomTo] = useState(() => dateKey(new Date()));
  // 'team' = ganzes Team, sonst der User-Key einer Person.
  const [scope, setScope] = useState<string>(() => (canSeeTeam ? 'team' : myKey));
  const [campaignId, setCampaignId] = useState<string>('');

  const range = useMemo(
    () => resolveRange(preset, { from: customFrom, to: customTo }),
    [preset, customFrom, customTo],
  );
  const compareRange = useMemo(() => previousRange(range), [range]);

  // Ein einziger Fetch über Vergleichs- UND Berichtszeitraum: die Vorperiode
  // endet per Konstruktion am Tag vor `range.from`, das Fenster ist also
  // lückenlos. So bekommen auch die Anruf-Kennzahlen einen echten
  // Vorperiodenvergleich, ohne zweite Abfrage.
  const windowFrom = compareRange.from;
  const windowTo = range.to;

  useEffect(() => {
    void loadRange({ from: windowFrom, to: windowTo, label: '' });
  }, [windowFrom, windowTo, loadRange]);

  useEffect(() => {
    const unsubscribe = subscribeRealtime();
    return () => {
      unsubscribe();
      reset();
    };
  }, [subscribeRealtime, reset]);

  // Nicht-Chefs werten ausschließlich sich selbst aus — der Scope-Wähler wird
  // gar nicht erst angeboten, und der Filter wird hier hart gesetzt (nicht nur
  // im UI ausgeblendet).
  const agentKey = canSeeTeam ? (scope === 'team' ? undefined : scope) : myKey;

  const agents = useMemo<ReportAgent[]>(() => {
    const all = Object.values(users)
      .map((u) => ({
        key: u.key,
        displayName: u.displayName,
        monthlyTarget: u.monthlyTarget,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    return canSeeTeam ? all : all.filter((a) => a.key === myKey);
  }, [users, canSeeTeam, myKey]);

  const source = useMemo<ReportSource>(
    () => ({
      contracts,
      tariffChanges,
      notes,
      leads,
      calls: calls ?? [],
      campaigns,
      settings,
      agents,
    }),
    [contracts, tariffChanges, notes, leads, calls, campaigns, settings, agents],
  );

  const filter = useMemo(
    () => ({ range, agentKey, campaignId: campaignId || undefined }),
    [range, agentKey, campaignId],
  );

  const report = useMemo(() => buildReport(source, filter), [source, filter]);
  const previous = useMemo(
    () => buildReport(source, { ...filter, range: compareRange }),
    [source, filter, compareRange],
  );

  const scopeLabel = agentKey
    ? (agents.find((a) => a.key === agentKey)?.displayName ?? 'Unbekannt')
    : 'Gesamtes Team';
  const campaignLabel = campaignId
    ? (campaigns.find((c) => c.id === campaignId)?.name ?? 'Unbekannte Kampagne')
    : null;

  const fileBase = `bericht-${rangeFileStamp(range)}`;

  // ── Exporte ───────────────────────────────────────────────────────────────

  const exportSummary = () => {
    exportCsv(`${fileBase}-kennzahlen.csv`, [
      {
        Zeitraum: range.label,
        Von: range.from,
        Bis: range.to,
        Auswertung: scopeLabel,
        Kampagne: campaignLabel ?? 'Alle',
        'Provision (€)': report.sales.commission,
        'Provision Verträge (€)': report.sales.contractCommission,
        'Provision Tarifwechsel (€)': report.sales.tariffCommission,
        Abschlüsse: report.sales.deals,
        Neuverträge: report.sales.contractCount,
        Stornos: report.sales.cancelledCount,
        Tarifwechsel: report.sales.tariffCount,
        Neukunden: report.sales.newCustomers,
        'Ziel (€)': report.target,
        'Zielerreichung (%)': report.attainmentPct ?? '',
        Anrufe: report.calls.total,
        Eingehend: report.calls.inbound,
        Ausgehend: report.calls.outbound,
        'Gesprächszeit (s)': report.calls.talkTimeS,
        'Ø Dauer (s)': report.calls.avgDurationS,
        Gehalten: report.calls.saved,
        Gekündigt: report.calls.cancelled,
        'Save-Rate (%)': report.calls.saveRatePct ?? '',
        'Anruf→Abschluss (%)': report.calls.conversionPct ?? '',
        'Gemessene Anrufe': report.calls.timing.measured,
        'Erreichbarkeit (%)': report.calls.timing.answerRatePct ?? '',
        'Angenommen': report.calls.timing.answered,
        'Ohne Abheben': report.calls.timing.unanswered,
        'Ø Gespräch echt (s)': report.calls.timing.avgTalkS ?? '',
        'Ø Klingeln (s)': report.calls.timing.avgRingS ?? '',
        'Kurzgespräche': report.calls.timing.shortCalls,
        'Ø Nachbearbeitung (s)': report.calls.timing.avgAcwS ?? '',
        'Ø AHT (s)': report.calls.timing.avgAhtS ?? '',
      },
    ]);
  };

  const exportSeries = () => {
    exportCsv(
      `${fileBase}-verlauf.csv`,
      report.series.map((p) => ({
        Zeitpunkt: p.label,
        Schlüssel: p.key,
        'Provision (€)': p.commission,
        Abschlüsse: p.deals,
        Anrufe: p.calls,
        Gehalten: p.saved,
      })),
    );
  };

  const exportAgents = () => {
    exportCsv(
      `${fileBase}-mitarbeiter.csv`,
      report.perAgent.map((r) => ({
        'Mitarbeiter:in': r.displayName,
        Neuverträge: r.contracts,
        Tarifwechsel: r.tariffs,
        Abschlüsse: r.deals,
        'Provision (€)': r.commission,
        'Ziel (€)': r.target,
        'Zielerreichung (%)': r.attainmentPct ?? '',
        Anrufe: r.calls,
        'Gesprächszeit (s)': r.talkTimeS,
        'Erreichbarkeit (%)': r.timing.answerRatePct ?? '',
        'Ø Gespräch echt (s)': r.timing.avgTalkS ?? '',
        'Ø Nachbearbeitung (s)': r.timing.avgAcwS ?? '',
        'Ø AHT (s)': r.timing.avgAhtS ?? '',
        'Save-Rate (%)': r.saveRatePct ?? '',
        'Anruf→Abschluss (%)': r.conversionPct ?? '',
      })),
    );
  };

  const exportCampaigns = () => {
    exportCsv(
      `${fileBase}-kampagnen.csv`,
      report.calls.campaigns.map((c) => ({
        Kampagne: c.campaignName,
        'Call-Typ': c.callType,
        Anrufe: c.totalCalls,
        Gehalten: c.saved,
        Gekündigt: c.cancelled,
        'Save-Rate (%)': c.saveRatePct ?? '',
        'Ø Dauer (s)': c.avgDurationS,
      })),
    );
  };

  const exportReasons = () => {
    exportCsv(
      `${fileBase}-kuendigungsgruende.csv`,
      report.calls.cancellationReasons.map((r) => ({
        Kündigungsgrund: r.reason,
        Anzahl: r.count,
        'Anteil (%)': r.pct,
      })),
    );
  };

  const exportContracts = () => {
    exportCsv(
      `${fileBase}-vertraege.csv`,
      report.contractRows.map((r) => ({
        Datum: formatDate(r.date),
        Kundennummer: r.customerNumber,
        Kunde: r.customerName,
        Produkte: r.products,
        Status: r.status,
        'Bearbeitet von': r.agent,
        'Provision (€)': r.commission,
      })),
    );
  };

  const exportTariffs = () => {
    exportCsv(
      `${fileBase}-tarifwechsel.csv`,
      report.tariffRows.map((r) => ({
        Datum: formatDate(r.date),
        Kundennummer: r.customerNumber,
        Kunde: r.customerName,
        Art: r.changeType,
        MVLZ: r.context,
        'Bearbeitet von': r.agent,
        'Provision (€)': r.commission,
      })),
    );
  };

  const exportCalls = () => {
    exportCsv(
      `${fileBase}-anrufe.csv`,
      report.callRows.map((r) => ({
        Beginn: new Date(r.startedAt).toLocaleString('de-DE'),
        'Mitarbeiter:in': r.agent,
        Richtung: r.direction,
        Kundennummer: r.customerNumber,
        'Dauer (s)': r.durationS ?? '',
        Gesprächsergebnis: r.disposition,
        Kündigungsgrund: r.cancellationReason,
        Kampagne: r.campaign,
      })),
    );
  };

  // ── Chart-Daten ───────────────────────────────────────────────────────────

  const seriesData = useMemo(
    () =>
      report.series.map((p) => ({
        label: p.label,
        Provision: p.commission,
        Abschlüsse: p.deals,
        Anrufe: p.calls,
        Gehalten: p.saved,
      })),
    [report.series],
  );

  // Standardfenster 6–21 Uhr hält die Achse lesbar, wird aber erweitert, sobald
  // außerhalb telefoniert wurde: sonst nennt die Kopfzeile eine Spitzenstunde,
  // die im Chart gar nicht vorkommt.
  const hourlyData = useMemo(() => {
    const busy = report.calls.hourly.filter((h) => h.count > 0).map((h) => h.hour);
    const from = Math.min(6, ...busy);
    const to = Math.max(21, ...busy);
    return report.calls.hourly
      .filter((h) => h.hour >= from && h.hour <= to)
      .map((h) => ({ label: String(h.hour).padStart(2, '0'), Anrufe: h.count }));
  }, [report.calls.hourly]);

  const agentChart = useMemo(
    () =>
      report.perAgent
        .filter((r) => r.commission > 0 || r.calls > 0)
        .map((r) => ({ name: firstName(r.displayName), Provision: r.commission })),
    [report.perAgent],
  );

  if (!loaded) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h2>Berichte</h2>
            <p>Auswertung über frei wählbare Zeiträume — Verkauf und Telefonie.</p>
          </div>
        </div>
        <SkeletonTable rows={7} cols={6} />
      </div>
    );
  }

  const trendUp = (deltaPct(report.sales.commission, previous.sales.commission) ?? 0) >= 0;

  return (
    <div className="reports-page">
      <div className="page-header no-print">
        <div>
          <h2>Berichte</h2>
          <p>Auswertung über frei wählbare Zeiträume — Verkauf und Telefonie.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={exportSummary}>
            <Download size={14} /> Kennzahlen
          </button>
          <button className="btn btn-primary" onClick={() => window.print()}>
            <Printer size={14} /> Drucken / PDF
          </button>
        </div>
      </div>

      {/* ── Filterleiste ── */}
      <div className="widget reports-toolbar no-print">
        <label className="reports-filter">
          <span>Zeitraum</span>
          <select
            className="select-pill"
            value={preset}
            onChange={(e) => setPreset(e.target.value as RangePreset)}
          >
            {RANGE_PRESETS.map((p) => (
              <option key={p} value={p}>
                {RANGE_PRESET_LABEL[p]}
              </option>
            ))}
          </select>
        </label>

        {preset === 'custom' && (
          <>
            <label className="reports-filter">
              <span>Von</span>
              <input
                type="date"
                className="select-pill"
                value={customFrom}
                max={customTo}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </label>
            <label className="reports-filter">
              <span>Bis</span>
              <input
                type="date"
                className="select-pill"
                value={customTo}
                min={customFrom}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </label>
          </>
        )}

        {canSeeTeam && (
          <label className="reports-filter">
            <span>Auswertung</span>
            <select
              className="select-pill"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="team">Gesamtes Team</option>
              {agents.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.displayName}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="reports-filter">
          <span>Kampagne</span>
          <select
            className="select-pill"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
          >
            <option value="">Alle Kampagnen</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.active ? '' : ' (inaktiv)'}
              </option>
            ))}
          </select>
        </label>

        <div className="reports-toolbar-spacer" />
        <div className="reports-range-info">
          <strong>{range.label}</strong>
          <span className="muted">
            {report.days} Tage · Vergleich: {compareRange.label}
            {callsLoading ? ' · lädt Anrufe…' : ''}
          </span>
        </div>
      </div>

      {/* Berichtskopf — im Ausdruck der Ersatz für die Filterleiste. */}
      <div className="reports-print-head">
        <strong>{range.label}</strong> · {scopeLabel}
        {campaignLabel ? ` · Kampagne: ${campaignLabel}` : ''} · erstellt am{' '}
        {new Date().toLocaleDateString('de-DE')}
      </div>

      {callsError && (
        <div className="reports-note reports-note-warn">
          <AlertTriangle size={14} />
          Anrufdaten konnten nicht geladen werden ({callsError}). Verkaufszahlen sind
          vollständig, Telefonie-Kennzahlen stehen auf 0.
        </div>
      )}
      {truncated && (
        <div className="reports-note reports-note-warn">
          <AlertTriangle size={14} />
          Sehr viele Anrufe im Zeitraum — es wurden nicht alle geladen. Bitte den Zeitraum
          verkleinern, sonst sind die Telefonie-Kennzahlen unvollständig.
        </div>
      )}
      {campaignLabel && (
        <div className="reports-note">
          Kampagnenfilter <strong>{campaignLabel}</strong> wirkt auf die Telefonie-Kennzahlen.
          Verträge und Tarifwechsel tragen keine Kampagnen-Zuordnung und bleiben ungefiltert.
        </div>
      )}

      {/* ── Kennzahlen ── */}
      {report.calls.total > 0 && report.calls.timing.measuredPct !== null && (
        <div className="hint" style={{ marginBottom: 8 }}>
          {report.calls.timing.measured === 0 ? (
            <>
              Für keinen Anruf im Zeitraum liegt eine gemessene Gesprächszeit vor —
              Erreichbarkeit, echte Gesprächsdauer und Nachbearbeitung bleiben deshalb
              aus. Sie entstehen erst mit der Ende-Erkennung der Auskunft auf dem
              Schreibtisch.
            </>
          ) : (
            <>
              Echte Zeiten und Erreichbarkeit beruhen auf{' '}
              <strong>
                {report.calls.timing.measured} von {report.calls.total} Anrufen
              </strong>{' '}
              ({report.calls.timing.measuredPct} %) — nur bei diesen wurde das
              Gesprächsende tatsächlich gemessen. Die übrigen fließen bewusst weder
              positiv noch negativ ein.
              {report.calls.endReasons.withReason > 0 && (
                <>
                  {' '}Davon endeten{' '}
                  <strong>{report.calls.endReasons.measuredEndPct} %</strong> auf die
                  Sekunde genau
                  {report.calls.endReasons.unusablePct !== null &&
                    report.calls.endReasons.unusablePct > 0 && (
                      <>
                        ; bei{' '}
                        <strong>{report.calls.endReasons.unusablePct} %</strong> ist die
                        Dauer ein Artefakt (Zwangsende oder erst vom nächsten Anruf
                        beendet) und taugt nicht als Gesprächslänge
                      </>
                    )}
                  .
                </>
              )}
            </>
          )}
        </div>
      )}
      <div className="team-kpis">
        <KpiTile
          icon={<Wallet size={15} />}
          accent="blue"
          label="Provision"
          value={formatCurrency(report.sales.commission)}
          sub={deltaSub(report.sales.commission, previous.sales.commission, formatCurrency)}
        />
        <KpiTile
          icon={trendUp ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
          accent={trendUp ? 'green' : 'red'}
          label="Abschlüsse"
          value={report.sales.deals}
          sub={`${report.sales.contractCount} Verträge · ${report.sales.tariffCount} Tarifwechsel${
            report.sales.cancelledCount > 0 ? ` · ${report.sales.cancelledCount} Storno` : ''
          }`}
        />
        <KpiTile
          icon={<Target size={15} />}
          accent="purple"
          label="Zielerreichung"
          value={report.attainmentPct === null ? '–' : `${report.attainmentPct} %`}
          sub={report.target > 0 ? `Ziel: ${formatCurrency(report.target)}` : 'kein Ziel gesetzt'}
        />
        <KpiTile
          icon={<UserPlus size={15} />}
          accent="green"
          label="Neukunden"
          value={report.sales.newCustomers}
          sub={`Ø ${formatCurrency(report.sales.avgPerDeal)} je Abschluss`}
        />
        <KpiTile
          icon={<Phone size={15} />}
          accent="blue"
          label="Anrufe"
          value={report.calls.total}
          sub={deltaSub(report.calls.total, previous.calls.total, (n) => String(n))}
        />
        {report.calls.timing.measured > 0 && (
          <>
            <KpiTile
              icon={<PhoneOff size={15} />}
              accent={
                report.calls.timing.answerRatePct !== null &&
                report.calls.timing.answerRatePct >= 60
                  ? 'green'
                  : 'orange'
              }
              label="Erreichbarkeit"
              value={
                report.calls.timing.answerRatePct === null
                  ? '–'
                  : `${report.calls.timing.answerRatePct} %`
              }
              sub={`${report.calls.timing.answered} angenommen · ${report.calls.timing.unanswered} ohne Abheben`}
            />
            <KpiTile
              icon={<Timer size={15} />}
              accent="orange"
              label="Ø Gespräch (echt)"
              value={
                report.calls.timing.avgTalkS === null
                  ? '–'
                  : formatDuration(report.calls.timing.avgTalkS)
              }
              sub={
                report.calls.timing.avgRingS === null
                  ? `${report.calls.timing.withTalkTime} gemessene Gespräche`
                  : `ab dem Abheben · Ø ${formatDuration(report.calls.timing.avgRingS)} klingeln`
              }
            />
            <KpiTile
              icon={<Hourglass size={15} />}
              accent="purple"
              label="Ø Nachbearbeitung"
              value={
                report.calls.timing.avgAcwS === null
                  ? '–'
                  : formatDuration(report.calls.timing.avgAcwS)
              }
              sub={
                report.calls.timing.avgAhtS === null
                  ? 'noch kein Ergebnis nach einem Gespräch erfasst'
                  : `AHT Ø ${formatDuration(report.calls.timing.avgAhtS)} · ${report.calls.timing.withAht} Anrufe`
              }
            />
            <KpiTile
              icon={<PhoneOff size={15} />}
              accent={
                report.calls.timing.shortCallPct !== null &&
                report.calls.timing.shortCallPct > 25
                  ? 'red'
                  : 'blue'
              }
              label="Kurzgespräche"
              value={
                report.calls.timing.shortCallPct === null
                  ? '–'
                  : `${report.calls.timing.shortCallPct} %`
              }
              sub={`${report.calls.timing.shortCalls} unter ${SHORT_CALL_S} s — meist Fehlkontakte`}
            />
          </>
        )}
        <KpiTile
          icon={<ShieldCheck size={15} />}
          accent={
            report.calls.saveRatePct !== null && report.calls.saveRatePct >= 50 ? 'green' : 'orange'
          }
          label="Save-Rate"
          value={report.calls.saveRatePct === null ? '–' : `${report.calls.saveRatePct} %`}
          sub={`${report.calls.saved} gehalten · ${report.calls.cancelled} gekündigt`}
        />
        <KpiTile
          icon={<Clock size={15} />}
          accent="orange"
          label="Gesprächszeit"
          value={formatDuration(report.calls.talkTimeS)}
          // Sobald es eine gemessene Durchschnittsdauer gibt, verschwindet die
          // alte hier: zwei Ø nebeneinander, die dasselbe zu heißen scheinen
          // und Verschiedenes bedeuten, sind schlimmer als eines. Die Summe
          // bleibt, weil sie die Arbeitslast zeigt und alle Anrufe umfasst.
          sub={
            report.calls.timing.avgTalkS !== null
              ? `alle Anrufe, ab Klingeln gerechnet · ${report.calls.callsPerActiveDay} Anrufe/Tag`
              : `Ø ${formatDuration(report.calls.avgDurationS)} ab Klingeln · ${report.calls.callsPerActiveDay} Anrufe/Tag`
          }
        />
        <KpiTile
          icon={<Percent size={15} />}
          accent="purple"
          label="Anruf → Abschluss"
          value={report.calls.conversionPct === null ? '–' : `${report.calls.conversionPct} %`}
          sub={
            report.calls.avgMinutesToOutcome === null
              ? `${report.calls.linkedCount} verknüpfte Anrufe`
              : `${report.calls.linkedCount} verknüpft · Ø ${report.calls.avgMinutesToOutcome} min danach`
          }
        />
      </div>

      {/* ── Verlauf ── */}
      <Section
        title="Verlauf"
        meta={`${report.series.length} Punkte`}
        onExport={exportSeries}
        exportDisabled={report.series.length === 0}
      >
        <div className="reports-chart">
          <ResponsiveContainer height={230}>
            <BarChart data={seriesData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                fontSize={11}
                stroke="var(--text-tertiary)"
                interval="preserveStartEnd"
              />
              <YAxis axisLine={false} tickLine={false} fontSize={12} stroke="var(--text-tertiary)" />
              <Tooltip
                cursor={{ fill: 'rgba(0,102,179,0.05)' }}
                contentStyle={TOOLTIP_STYLE}
                formatter={(value, name) =>
                  name === 'Provision' ? formatCurrency(Number(value ?? 0)) : value
                }
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Provision" fill="#0066b3" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <div className="reports-grid-2">
        <Section title="Anrufvolumen im Verlauf">
          <div className="reports-chart">
            <ResponsiveContainer height={210}>
              <BarChart data={seriesData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  fontSize={11}
                  stroke="var(--text-tertiary)"
                  interval="preserveStartEnd"
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  fontSize={12}
                  stroke="var(--text-tertiary)"
                  allowDecimals={false}
                />
                <Tooltip cursor={{ fill: 'rgba(0,163,224,0.05)' }} contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Anrufe" fill="#00a3e0" radius={[5, 5, 0, 0]} />
                <Bar dataKey="Gehalten" fill="#34c759" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section
          title="Anrufe nach Tageszeit"
          meta={
            report.calls.busiestHour === null
              ? undefined
              : `Spitze ${String(report.calls.busiestHour).padStart(2, '0')}:00 Uhr`
          }
        >
          {report.calls.total === 0 ? (
            <div className="reports-empty">Keine Anrufe im Zeitraum.</div>
          ) : (
            <div className="reports-chart">
              <ResponsiveContainer height={210}>
                <BarChart data={hourlyData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    fontSize={11}
                    stroke="var(--text-tertiary)"
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    fontSize={12}
                    stroke="var(--text-tertiary)"
                    allowDecimals={false}
                  />
                  <Tooltip cursor={{ fill: 'rgba(0,102,179,0.05)' }} contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="Anrufe" fill="#5856d6" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Section>
      </div>

      {/* ── Gesprächsergebnisse ── */}
      <div className="reports-grid-2">
        <Section
          title="Gesprächsergebnisse"
          meta={`${report.calls.withDisposition} von ${report.calls.total} erfasst`}
        >
          <BarList
            rows={report.calls.dispositions.map((d) => ({
              label: d.label,
              count: d.count,
              pct: d.pct,
            }))}
            color="#0066b3"
            empty="Keine Gesprächsergebnisse im Zeitraum erfasst."
          />
        </Section>

        <Section
          title="Kündigungsgründe"
          meta={`${report.calls.cancelled} Kündigungen`}
          onExport={exportReasons}
          exportDisabled={report.calls.cancellationReasons.length === 0}
        >
          <BarList
            rows={report.calls.cancellationReasons.map((r) => ({
              label: r.reason,
              count: r.count,
              pct: r.pct,
            }))}
            color="#ff3b30"
            empty="Keine Kündigungen im Zeitraum."
          />
        </Section>
      </div>

      {/* ── Kampagnen ── */}
      <Section
        title="Kampagnen-Performance"
        meta={`${report.calls.campaigns.length} mit Anrufen`}
        onExport={exportCampaigns}
        exportDisabled={report.calls.campaigns.length === 0}
      >
        {report.calls.campaigns.length === 0 ? (
          <div className="reports-empty">
            Keine Anrufe mit Kampagnen-Zuordnung im Zeitraum.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Kampagne</th>
                  <th style={{ textAlign: 'right' }}>Anrufe</th>
                  <th style={{ textAlign: 'right' }}>Gehalten</th>
                  <th style={{ textAlign: 'right' }}>Gekündigt</th>
                  <th style={{ textAlign: 'right' }}>Save-Rate</th>
                  <th style={{ textAlign: 'right' }}>Ø Dauer</th>
                </tr>
              </thead>
              <tbody>
                {report.calls.campaigns.map((c) => (
                  <tr key={c.campaignId}>
                    <td>{c.campaignName}</td>
                    <td style={{ textAlign: 'right' }}>{c.totalCalls}</td>
                    <td style={{ textAlign: 'right' }}>{c.saved}</td>
                    <td style={{ textAlign: 'right' }}>{c.cancelled}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {c.saveRatePct === null ? '–' : `${c.saveRatePct} %`}
                    </td>
                    <td style={{ textAlign: 'right' }}>{formatDuration(c.avgDurationS)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── Team-Vergleich ── */}
      {report.perAgent.length > 0 && (
        <Section
          title="Leistung pro Mitarbeiter:in"
          meta={`${report.perAgent.length} Personen`}
          onExport={exportAgents}
        >
          {agentChart.length > 0 && (
            <div className="reports-chart">
              <ResponsiveContainer height={Math.max(140, agentChart.length * 30 + 30)}>
                <BarChart
                  layout="vertical"
                  data={agentChart}
                  margin={{ top: 0, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" horizontal={false} />
                  <XAxis
                    type="number"
                    axisLine={false}
                    tickLine={false}
                    fontSize={12}
                    stroke="var(--text-tertiary)"
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={90}
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
                  <Bar dataKey="Provision" fill="#0066b3" radius={[0, 5, 5, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Mitarbeiter:in</th>
                  <th style={{ textAlign: 'right' }}>Verträge</th>
                  <th style={{ textAlign: 'right' }}>Tarifw.</th>
                  <th style={{ textAlign: 'right' }}>Provision</th>
                  <th style={{ textAlign: 'right' }}>Ziel %</th>
                  <th style={{ textAlign: 'right' }}>Anrufe</th>
                  <th style={{ textAlign: 'right' }}>Gesprächszeit</th>
                  <th style={{ textAlign: 'right' }} title="Anteil der gemessenen Anrufe, bei denen abgehoben wurde">
                    Erreichbar
                  </th>
                  <th style={{ textAlign: 'right' }} title="Ø Gesprächsdauer ab dem Abheben">
                    Ø Gespräch
                  </th>
                  <th style={{ textAlign: 'right' }} title="Ø Gespräch + Nachbearbeitung je Anruf">
                    Ø AHT
                  </th>
                  <th style={{ textAlign: 'right' }}>Save-Rate</th>
                </tr>
              </thead>
              <tbody>
                {report.perAgent.map((r) => (
                  <tr key={r.key}>
                    <td>{r.displayName}</td>
                    <td style={{ textAlign: 'right' }}>{r.contracts}</td>
                    <td style={{ textAlign: 'right' }}>{r.tariffs}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {formatCurrency(r.commission)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {r.attainmentPct === null ? '–' : `${r.attainmentPct} %`}
                    </td>
                    <td style={{ textAlign: 'right' }}>{r.calls}</td>
                    <td style={{ textAlign: 'right' }}>{formatDuration(r.talkTimeS)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {r.timing.answerRatePct === null ? '–' : `${r.timing.answerRatePct} %`}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {r.timing.avgTalkS === null ? '–' : formatDuration(r.timing.avgTalkS)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {r.timing.avgAhtS === null ? '–' : formatDuration(r.timing.avgAhtS)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {r.saveRatePct === null ? '–' : `${r.saveRatePct} %`}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ fontWeight: 500 }}>
                    Gesamt
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>
                    {formatCurrency(report.sales.commission)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {report.attainmentPct === null ? '–' : `${report.attainmentPct} %`}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{report.calls.total}</td>
                  <td style={{ textAlign: 'right' }}>
                    {formatDuration(report.calls.talkTimeS)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {report.calls.timing.answerRatePct === null
                      ? '–'
                      : `${report.calls.timing.answerRatePct} %`}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {report.calls.timing.avgTalkS === null
                      ? '–'
                      : formatDuration(report.calls.timing.avgTalkS)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {report.calls.timing.avgAhtS === null
                      ? '–'
                      : formatDuration(report.calls.timing.avgAhtS)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {report.calls.saveRatePct === null ? '–' : `${report.calls.saveRatePct} %`}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Section>
      )}

      {/* ── Top-Produkte ── */}
      <Section title="Top-Produkte" meta={`${report.sales.topProducts.length} Produkte verkauft`}>
        <BarList
          rows={report.sales.topProducts.map((p) => ({
            label: p.name,
            count: p.count,
            pct: Math.round(
              (p.count / Math.max(1, report.sales.topProducts.reduce((s, x) => s + x.count, 0))) *
                100,
            ),
          }))}
          color="#00a3e0"
          empty="Keine Produktverkäufe im Zeitraum."
        />
        {report.sales.biggestDeal && (
          <div className="reports-highlight">
            Größter Einzelabschluss: <strong>{report.sales.biggestDeal.name}</strong> ·{' '}
            {formatCurrency(report.sales.biggestDeal.amount)} ({report.sales.biggestDeal.kind})
          </div>
        )}
      </Section>

      {/* ── Detailtabellen ── */}
      <Section
        title="Neuverträge"
        meta={`${report.contractRows.length} · ${formatCurrency(report.sales.contractCommission)}`}
        onExport={exportContracts}
        exportDisabled={report.contractRows.length === 0}
      >
        {report.contractRows.length === 0 ? (
          <div className="reports-empty">Keine Neuverträge im Zeitraum.</div>
        ) : (
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th style={{ width: 95 }}>Datum</th>
                  <th style={{ width: 95 }}>KdNr.</th>
                  <th>Kunde</th>
                  <th>Produkte</th>
                  <th style={{ width: 90 }}>Status</th>
                  <th style={{ width: 120 }}>Bearbeitet von</th>
                  <th style={{ width: 100, textAlign: 'right' }}>Provision</th>
                </tr>
              </thead>
              <tbody>
                {report.contractRows.slice(0, TABLE_PREVIEW_LIMIT).map((r, i) => (
                  <tr key={`${r.customerNumber}-${r.date}-${i}`}>
                    <td>{formatDate(r.date)}</td>
                    <td>
                      <code style={{ fontSize: 11 }}>{r.customerNumber}</code>
                    </td>
                    <td>{r.customerName}</td>
                    <td style={{ fontSize: 12 }}>{r.products}</td>
                    <td style={{ fontSize: 12, textTransform: 'capitalize' }}>{r.status}</td>
                    <td style={{ fontSize: 12 }}>{r.agent}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {formatCurrency(r.commission)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.contractRows.length > TABLE_PREVIEW_LIMIT && (
              <div className="reports-more">
                … {report.contractRows.length - TABLE_PREVIEW_LIMIT} weitere — vollständig im
                CSV-Export.
              </div>
            )}
          </div>
        )}
      </Section>

      <Section
        title="Tarifwechsel"
        meta={`${report.tariffRows.length} · ${formatCurrency(report.sales.tariffCommission)}`}
        onExport={exportTariffs}
        exportDisabled={report.tariffRows.length === 0}
      >
        {report.tariffRows.length === 0 ? (
          <div className="reports-empty">Keine Tarifwechsel im Zeitraum.</div>
        ) : (
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th style={{ width: 95 }}>Datum</th>
                  <th style={{ width: 95 }}>KdNr.</th>
                  <th>Kunde</th>
                  <th style={{ width: 110 }}>Art</th>
                  <th>MVLZ</th>
                  <th style={{ width: 120 }}>Bearbeitet von</th>
                  <th style={{ width: 100, textAlign: 'right' }}>Provision</th>
                </tr>
              </thead>
              <tbody>
                {report.tariffRows.slice(0, TABLE_PREVIEW_LIMIT).map((r, i) => (
                  <tr key={`${r.customerNumber}-${r.date}-${i}`}>
                    <td>{formatDate(r.date)}</td>
                    <td>
                      <code style={{ fontSize: 11 }}>{r.customerNumber}</code>
                    </td>
                    <td>{r.customerName}</td>
                    <td style={{ fontSize: 12 }}>{r.changeType}</td>
                    <td style={{ fontSize: 12 }}>{r.context}</td>
                    <td style={{ fontSize: 12 }}>{r.agent}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {formatCurrency(r.commission)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.tariffRows.length > TABLE_PREVIEW_LIMIT && (
              <div className="reports-more">
                … {report.tariffRows.length - TABLE_PREVIEW_LIMIT} weitere — vollständig im
                CSV-Export.
              </div>
            )}
          </div>
        )}
      </Section>

      <Section
        title="Anrufprotokoll"
        meta={`${report.callRows.length} Anrufe`}
        onExport={exportCalls}
        exportDisabled={report.callRows.length === 0}
      >
        {report.callRows.length === 0 ? (
          <div className="reports-empty">Keine Anrufe im Zeitraum.</div>
        ) : (
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th style={{ width: 140 }}>Beginn</th>
                  <th style={{ width: 120 }}>Mitarbeiter:in</th>
                  <th style={{ width: 95 }}>Richtung</th>
                  <th style={{ width: 95 }}>KdNr.</th>
                  <th style={{ width: 80, textAlign: 'right' }}>Dauer</th>
                  <th style={{ width: 130 }}>Ergebnis</th>
                  <th>Kündigungsgrund</th>
                  <th>Kampagne</th>
                </tr>
              </thead>
              <tbody>
                {report.callRows.slice(0, TABLE_PREVIEW_LIMIT).map((r, i) => (
                  <tr key={`${r.startedAt}-${i}`}>
                    <td style={{ fontSize: 12 }}>
                      {new Date(r.startedAt).toLocaleString('de-DE', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td style={{ fontSize: 12 }}>{r.agent}</td>
                    <td style={{ fontSize: 12 }}>{r.direction}</td>
                    <td>
                      <code style={{ fontSize: 11 }}>{r.customerNumber || '–'}</code>
                    </td>
                    <td style={{ textAlign: 'right', fontSize: 12 }}>
                      {r.durationS === null ? '–' : formatDuration(r.durationS)}
                    </td>
                    <td style={{ fontSize: 12 }}>{r.disposition || '–'}</td>
                    <td style={{ fontSize: 12 }}>{r.cancellationReason || '–'}</td>
                    <td style={{ fontSize: 12 }}>{r.campaign || '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.callRows.length > TABLE_PREVIEW_LIMIT && (
              <div className="reports-more">
                … {report.callRows.length - TABLE_PREVIEW_LIMIT} weitere — vollständig im
                CSV-Export.
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
