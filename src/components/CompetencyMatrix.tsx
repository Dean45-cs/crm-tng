import { useMemo, useState } from 'react';
import { GraduationCap, Info, TriangleAlert } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { allCampaigns, campaignFor } from '../lib/campaigns';
import {
  COMPETENCY_LEVELS,
  campaignReadiness,
  competencyOf,
  indexCompetencies,
  levelDef,
} from '../lib/competencies';
import type { CampaignCallType, CompetencyLevel } from '../types';

/**
 * Wer darf welche Kampagne fahren — als Matrix Person × Kampagne.
 *
 * Bewusst eine Tabelle und keine Kompetenz-Felder auf den einzelnen
 * Mitarbeiter-Karten: die Frage, die der Chef hier stellt, ist fast nie „was
 * kann diese Person", sondern „wer kann eigentlich Bauverweigerer". Das ist
 * eine Spalte, keine Karte — und die Lücke fällt nur in der Matrix auf.
 *
 * Klick auf eine Zelle schaltet die Stufe weiter (keine → Einarbeitung →
 * einsatzbereit → Trainer:in → keine). Ein Dropdown je Zelle wären bei
 * 11 Personen × 6 Kampagnen 66 Auswahlfelder für eine Angabe mit drei Werten.
 */
export function CompetencyMatrix() {
  const { competencies, setCompetency } = useStore();
  const users = useAuth((s) => s.users);
  const [busy, setBusy] = useState<string | null>(null);

  const agents = useMemo(
    () =>
      Object.values(users)
        .filter((u) => u.isActive)
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de')),
    [users],
  );

  const index = useMemo(() => indexCompetencies(competencies), [competencies]);
  const activeIds = useMemo(() => new Set(agents.map((a) => a.key)), [agents]);
  const readiness = useMemo(
    () => campaignReadiness(competencies, activeIds),
    [competencies, activeIds],
  );

  const campaigns = allCampaigns();

  /** Nächste Stufe im Ringtausch — null steht für „nicht geschult". */
  const nextLevel = (current: CompetencyLevel | null): CompetencyLevel | null => {
    const order: (CompetencyLevel | null)[] = [null, ...COMPETENCY_LEVELS.map((l) => l.id)];
    const idx = order.indexOf(current);
    return order[(idx + 1) % order.length];
  };

  const cycle = async (userId: string, callType: CampaignCallType) => {
    const key = `${userId}|${callType}`;
    if (busy) return;
    setBusy(key);
    const current = competencyOf(index, userId, callType)?.level ?? null;
    const next = nextLevel(current);
    // Die Fassung des Leitfadens mitschreiben, auf die geschult wurde: geht
    // eine Kampagne später auf 2.1, ist der Stand aller Betroffenen sichtbar
    // veraltet, ohne dass jemand eine Liste führen muss.
    await setCompetency(userId, callType, next, {
      trainedAt: next ? new Date().toISOString().slice(0, 10) : undefined,
      guideVersion: next ? campaignFor(callType).version : undefined,
    });
    setBusy(null);
  };

  if (agents.length === 0) return null;

  return (
    <section className="widget" style={{ marginTop: 16 }}>
      <div className="row between" style={{ marginBottom: 4 }}>
        <h3 className="widget-title" style={{ margin: 0 }}>
          <GraduationCap size={15} /> Kompetenzen je Kampagne
        </h3>
      </div>
      <p className="muted" style={{ margin: '0 0 12px' }}>
        Jede Kampagne hat eine eigene Schulungsunterlage und einen eigenen Leitfaden. Der
        Schichtplan prüft gegen diese Matrix und warnt, bevor jemand eine Kampagne fährt, für die
        er nicht geschult ist. Zum Ändern auf eine Zelle klicken.
      </p>

      <div className="comp-legend">
        {COMPETENCY_LEVELS.map((l) => (
          <span key={l.id} className="comp-legend-item" title={l.hint}>
            <span className={`comp-cell is-${l.id}`}>{l.short}</span>
            {l.label}
          </span>
        ))}
        <span className="comp-legend-item">
          <span className="comp-cell">–</span>
          Nicht geschult
        </span>
      </div>

      <div className="table-wrap">
        <table className="crm-table comp-matrix">
          <thead>
            <tr>
              <th>Mitarbeiter:in</th>
              {campaigns.map((c) => (
                <th key={c.id} style={{ textAlign: 'center' }} title={c.subtitle}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.key}>
                <td>{agent.displayName}</td>
                {campaigns.map((c) => {
                  const entry = competencyOf(index, agent.key, c.id);
                  const def = levelDef(entry?.level);
                  // Auf eine ältere Leitfaden-Fassung geschult: die Kompetenz
                  // gilt weiter, ist aber sichtbar nachzuziehen.
                  const stale = Boolean(
                    entry?.guideVersion && entry.guideVersion !== c.version,
                  );
                  return (
                    <td key={c.id} style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className={`comp-cell ${def ? `is-${def.id}` : ''} ${stale ? 'is-stale' : ''}`}
                        disabled={busy === `${agent.key}|${c.id}`}
                        onClick={() => void cycle(agent.key, c.id)}
                        title={
                          def
                            ? `${def.label}${entry?.trainedAt ? ` · seit ${entry.trainedAt}` : ''}${
                                stale ? ` · geschult auf v${entry?.guideVersion}, aktuell v${c.version}` : ''
                              }`
                            : `Nicht geschult für ${c.title}`
                        }
                        aria-label={`${agent.displayName}, ${c.title}: ${def?.label ?? 'nicht geschult'}`}
                      >
                        {def?.short ?? '–'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="muted">Einsatzbereit im Team</td>
              {readiness.map((r) => (
                <td key={r.callType} style={{ textAlign: 'center' }}>
                  <span className={r.uncovered ? 'comp-readiness is-uncovered' : 'comp-readiness'}>
                    {r.uncovered && <TriangleAlert size={11} />}
                    {r.ready}
                    {r.inTraining > 0 && <span className="muted"> +{r.inTraining}</span>}
                  </span>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {readiness.some((r) => r.uncovered) && (
        <p className="comp-warning">
          <TriangleAlert size={13} />
          Ohne einsatzbereite Person ist eine Kampagne nicht planbar:{' '}
          {readiness
            .filter((r) => r.uncovered)
            .map((r) => r.title)
            .join(', ')}
          .
        </p>
      )}
      {readiness.some((r) => r.ready > 0 && r.trainers === 0) && (
        <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
          <Info size={12} /> Ohne Trainer:in kann in einer Kampagne niemand eingearbeitet werden —
          neue Kolleg:innen bleiben dort dauerhaft auf Begleitung angewiesen.
        </p>
      )}
    </section>
  );
}
