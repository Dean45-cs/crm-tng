import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  MailCheck,
  Radar,
  ShieldAlert,
  Tag,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { useMonthCalls } from '../store/useMonthCalls';
import { useToast } from '../store/useToast';
import { CallWrapupForm } from '../components/CallWrapupForm';
import { KpiTile } from '../components/KpiTile';
import { SkeletonCardGrid } from '../components/Skeleton';
import { saveCallWrapup } from '../lib/supabaseApi';
import {
  FRAUD_MARKERS,
  allCampaigns,
  averageAdviceScore,
  campaignFor,
  doiStats,
  fraudPatterns,
  homeIdRate,
  labelOf,
  openWrapups,
  outcomeOf,
  reasonLabel,
  winbackStats,
  WINBACK_STATUS,
} from '../lib/campaigns';
import { formatClock } from '../lib/statusBoard';
import { formatDate } from '../lib/utils';
import type { Call, CampaignCallType } from '../types';

type Scope = 'mine' | 'team';

/**
 * Nachbearbeitung — die offene Gesprächsdokumentation und was sie ergibt.
 *
 * Warum es diese Seite überhaupt gibt: die Gesprächsleitfäden v2.0 schließen
 * alle mit einem Abschluss-Check, der ausdrücklich vergütungsrelevant ist
 * (HomeID, Winbackstatus mit Ursache, Double-Opt-In). Ein Gespräch, dessen
 * Erfassung unvollständig bleibt, ist damit geführt, aber nicht abgerechnet —
 * und niemand sieht es, solange die Lücke nur in der Anrufzeile steht. Diese
 * Seite macht genau diese Lücke sichtbar und schließbar.
 *
 * Der Zeitraum ist der laufende Monat (useMonthCalls), weil das der Zeitraum
 * der Vergütung ist. Ältere Lücken lassen sich ohnehin nicht mehr nachtragen.
 */
export function CallWrapups() {
  const { campaigns, loaded } = useStore();
  const { users, currentUserKey, isManager } = useAuth();
  const monthCalls = useMonthCalls((s) => s.calls);
  const toast = useToast((s) => s.push);

  const [scope, setScope] = useState<Scope>('mine');
  const [filterType, setFilterType] = useState<CampaignCallType | 'alle'>('alle');
  const [editing, setEditing] = useState<Call | null>(null);

  /** Call-Typ eines Anrufs über seine Kampagne. */
  const callTypeOf = useMemo(() => {
    const byId = new Map(campaigns.map((c) => [c.id, c]));
    return (call: Call): CampaignCallType | undefined => byId.get(call.campaignId ?? '')?.callType;
  }, [campaigns]);

  const scoped = useMemo(() => {
    const rows = monthCalls ?? [];
    const mine = scope === 'mine' ? rows.filter((c) => c.agentId === currentUserKey) : rows;
    if (filterType === 'alle') return mine;
    return mine.filter((c) => callTypeOf(c) === filterType);
  }, [monthCalls, scope, currentUserKey, filterType, callTypeOf]);

  const open = useMemo(() => openWrapups(scoped), [scoped]);
  const winback = useMemo(() => winbackStats(scoped), [scoped]);
  const doi = useMemo(() => doiStats(scoped), [scoped]);
  const homeIds = useMemo(() => homeIdRate(scoped, callTypeOf), [scoped, callTypeOf]);
  const advice = useMemo(() => averageAdviceScore(scoped), [scoped]);
  const fraud = useMemo(() => fraudPatterns(scoped), [scoped]);

  const save = async (call: Call, patch: Parameters<typeof saveCallWrapup>[1]) => {
    await saveCallWrapup(call.id, patch);
    // Der Monats-Store hängt am Realtime-Kanal von `calls` und lädt sich selbst
    // nach — hier deshalb nur die Rückmeldung, kein manuelles Nachladen.
    toast(
      patch.wrapupComplete ? 'success' : 'info',
      patch.wrapupComplete
        ? 'Erfassung abgeschlossen — der Vorgang ist abrechenbar.'
        : 'Erfassung gespeichert, es fehlen noch Pflichtangaben.',
    );
  };

  if (!loaded || monthCalls === null) {
    return <SkeletonCardGrid count={4} />;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Nachbearbeitung</h2>
          <p>
            Gespräche dieses Monats, deren Erfassung nach dem Abschluss-Check der Kampagne noch
            unvollständig ist — und was aus den erfassten Gesprächen geworden ist.
          </p>
        </div>
        <div className="seg-group">
          <button
            className={`seg ${scope === 'mine' ? 'active' : ''}`}
            onClick={() => setScope('mine')}
          >
            Meine
          </button>
          {isManager() && (
            <button
              className={`seg ${scope === 'team' ? 'active' : ''}`}
              onClick={() => setScope('team')}
            >
              Team
            </button>
          )}
        </div>
      </div>

      <div className="wrapup-filter">
        <button
          className={`wrapup-choice ${filterType === 'alle' ? 'is-active' : ''}`}
          onClick={() => setFilterType('alle')}
        >
          Alle Kampagnen
        </button>
        {allCampaigns().map((c) => (
          <button
            key={c.id}
            className={`wrapup-choice ${filterType === c.id ? 'is-active' : ''}`}
            onClick={() => setFilterType(c.id)}
            title={c.subtitle}
          >
            {c.title}
          </button>
        ))}
      </div>

      <div className="team-kpis">
        <KpiTile
          icon={<ClipboardList size={15} />}
          accent={open.length > 0 ? 'orange' : 'green'}
          label="Offene Erfassungen"
          value={open.length}
          sub={open.length === 0 ? 'Alles dokumentiert' : 'Nicht abrechenbar, solange offen'}
        />
        <KpiTile
          icon={<Radar size={15} />}
          accent="blue"
          label="Winback-Quote"
          value={winback.quotePct === null ? '–' : `${winback.quotePct} %`}
          sub={`${winback.erfolgreich} gehalten · ${winback.nichtErfolgreich} verloren · ${winback.irrelevant} irrelevant`}
        />
        <KpiTile
          icon={<Tag size={15} />}
          accent="purple"
          label="HomeID erfasst"
          value={homeIds.ratePct === null ? '–' : `${homeIds.ratePct} %`}
          sub={
            homeIds.relevant === 0
              ? 'Keine Kampagne mit HomeID-Pflicht im Zeitraum'
              : `${homeIds.captured} von ${homeIds.relevant} bestätigt`
          }
        />
        <KpiTile
          icon={<MailCheck size={15} />}
          accent="green"
          label="Double-Opt-In"
          value={doi.announcedPct === null ? '–' : `${doi.announcedPct} %`}
          sub={
            doi.announced === 0
              ? 'Wird in jedem Abschluss angekündigt — ohne Ausnahme'
              : `${doi.confirmed} bestätigt (${doi.confirmedPct ?? 0} % der angekündigten)`
          }
        />
        {advice !== null && (
          <KpiTile
            icon={<CheckCircle2 size={15} />}
            accent={advice >= 4 ? 'red' : 'blue'}
            label="Ø Beratungsnote"
            value={advice.toFixed(1)}
            sub="Schulnote 1–6 aus dem Welcome Call"
          />
        )}
        {fraud.length > 0 && (
          <KpiTile
            icon={<ShieldAlert size={15} />}
            accent="red"
            label="Fraud-Verdacht"
            value={fraud.reduce((sum, f) => sum + f.suspicions, 0)}
            sub={`bei ${fraud.length} Vertriebspartner${fraud.length === 1 ? '' : 'n'}`}
          />
        )}
      </div>

      {/* ── Offene Erfassungen ─────────────────────────────────────────────── */}
      <section className="widget" style={{ marginTop: 16 }}>
        <div className="widget-title">
          <AlertTriangle size={15} /> Offene Erfassungen
        </div>
        {open.length === 0 ? (
          <div className="muted" style={{ padding: '14px 2px' }}>
            Keine offenen Erfassungen — jedes Gespräch mit Ergebnis ist vollständig dokumentiert.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Zeitpunkt</th>
                  <th>Kunde</th>
                  <th>Kampagne</th>
                  <th>Ergebnis</th>
                  {scope === 'team' && <th>Bearbeiter:in</th>}
                  <th style={{ textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {open.map((call) => {
                  const type = callTypeOf(call);
                  const conf = campaignFor(type);
                  const outcome = call.outcomeCode ? outcomeOf(type, call.outcomeCode) : null;
                  return (
                    <tr key={call.id}>
                      <td>
                        {formatDate(call.startedAt)} · {formatClock(call.startedAt)}
                      </td>
                      <td>{call.callerName || call.customerNumber || call.callerNumber || '–'}</td>
                      <td>{type ? conf.title : 'Ohne Kampagne'}</td>
                      <td>{outcome?.label ?? '–'}</td>
                      {scope === 'team' && <td>{users[call.agentId]?.displayName ?? '–'}</td>}
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-sm btn-primary" onClick={() => setEditing(call)}>
                          Dokumentieren
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Winback nach Ursache ───────────────────────────────────────────── */}
      <WinbackBreakdown calls={scoped} callTypeOf={callTypeOf} />

      {/* ── Fraud-Muster ───────────────────────────────────────────────────── */}
      {isManager() && fraud.length > 0 && (
        <section className="widget" style={{ marginTop: 16 }}>
          <div className="widget-title">
            <ShieldAlert size={15} /> Fraud-Muster je Vertriebspartner
          </div>
          <p className="muted" style={{ margin: '0 0 10px' }}>
            Der einzelne Fall ist selten eindeutig — das Muster ist es. Die Liste ist ein
            Frühwarnsignal für die Partnersteuerung, keine Bewertung einzelner Gespräche.
          </p>
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Vertriebspartner</th>
                  <th style={{ textAlign: 'right' }}>Verdachtsfälle</th>
                  <th style={{ textAlign: 'right' }}>Anteil</th>
                  <th>Häufigste Merkmale</th>
                </tr>
              </thead>
              <tbody>
                {fraud.map((f) => (
                  <tr key={f.salesPartner}>
                    <td>{f.salesPartner}</td>
                    <td style={{ textAlign: 'right' }}>
                      {f.suspicions} / {f.total}
                    </td>
                    <td style={{ textAlign: 'right' }}>{f.ratePct} %</td>
                    <td className="muted">
                      {f.topMarkers
                        .slice(0, 2)
                        .map((m) => labelOf(FRAUD_MARKERS, m.id))
                        .join(' · ') || '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {editing && (
        <CallWrapupForm
          key={editing.id}
          call={editing}
          campaign={campaigns.find((c) => c.id === editing.campaignId)}
          onClose={() => setEditing(null)}
          onSave={(patch) => save(editing, patch)}
        />
      )}
    </div>
  );
}

/**
 * Was den Kunden zum Gehen bewegt hat, nach Ursache — die Auswertung, für die
 * die Leitfäden den strukturierten Ablehnungsgrund überhaupt verlangen
 * („strukturiert, nicht als Freitext-Roman").
 */
function WinbackBreakdown({
  calls,
  callTypeOf,
}: {
  calls: Call[];
  callTypeOf: (call: Call) => CampaignCallType | undefined;
}) {
  const rows = useMemo(() => {
    const counts = new Map<string, { label: string; held: number; lost: number }>();
    for (const c of calls) {
      const reason = c.winbackReason;
      if (!reason || !c.winbackStatus || c.winbackStatus === 'offen') continue;
      const label = reasonLabel(callTypeOf(c), reason);
      const entry = counts.get(reason) ?? { label, held: 0, lost: 0 };
      if (c.winbackStatus === 'erfolgreich') entry.held++;
      else if (c.winbackStatus === 'nicht_erfolgreich') entry.lost++;
      counts.set(reason, entry);
    }
    return Array.from(counts.values())
      .map((e) => ({
        ...e,
        total: e.held + e.lost,
        ratePct: e.held + e.lost > 0 ? Math.round((e.held / (e.held + e.lost)) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [calls, callTypeOf]);

  if (rows.length === 0) return null;

  return (
    <section className="widget" style={{ marginTop: 16 }}>
      <div className="widget-title">
        <Radar size={15} /> Winback nach Ursache
      </div>
      <div className="table-wrap">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Ursache</th>
              <th style={{ textAlign: 'right' }}>Gehalten</th>
              <th style={{ textAlign: 'right' }}>Verloren</th>
              <th style={{ textAlign: 'right' }}>Quote</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td style={{ textAlign: 'right' }}>{r.held}</td>
                <td style={{ textAlign: 'right' }}>{r.lost}</td>
                <td style={{ textAlign: 'right' }}>
                  <span
                    className={`badge ${r.ratePct >= 50 ? 'badge-green' : r.ratePct >= 25 ? 'badge-orange' : 'badge-red'}`}
                  >
                    {r.ratePct} %
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ margin: '10px 0 0' }}>
        Zählt nur entschiedene Fälle. Status ohne Ursache bleibt auf „
        {WINBACK_STATUS[0].label}“ und erscheint hier nicht.
      </p>
    </section>
  );
}
