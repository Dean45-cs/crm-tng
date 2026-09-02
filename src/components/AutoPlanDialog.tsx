import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCheck, Sun, Moon } from 'lucide-react';
import { Modal } from './Modal';
import {
  DEFAULT_PLAN_OPTIONS,
  planShifts,
  type PlanAgent,
  type PlanCell,
  type PlanOptions,
} from '../lib/autoSchedule';
import { shortDay } from '../lib/notifications';
import { initialsOf } from '../lib/utils';
import type { AgentCompetency, Campaign, Shift, StaffingTarget } from '../types';

/**
 * Der Schichtplan schlägt sich selbst vor.
 *
 * Bewusst als Vorschau statt als Knopf, der einfach schreibt: der Plan betrifft
 * die Woche von zehn Leuten, und wer ihn übernimmt, soll vorher gesehen haben,
 * was dabei herauskommt — welche Tage gedeckt sind, wer wie viel bekommt und
 * wo der Vorschlag ehrlich passen muss. Jede Änderung an den Einstellungen
 * rechnet sofort neu; geschrieben wird erst am Ende, in einem Zug und mit
 * „Rückgängig".
 *
 * Die Rechnung selbst steht in src/lib/autoSchedule.ts — hier ist nur die
 * Oberfläche dazu.
 */
export function AutoPlanDialog({
  days,
  agents,
  shifts,
  targets,
  campaigns,
  competencies,
  locked,
  rangeTitle,
  busy,
  onClose,
  onApply,
}: {
  days: string[];
  agents: PlanAgent[];
  shifts: Shift[];
  targets: StaffingTarget[];
  campaigns: Campaign[];
  competencies: AgentCompetency[];
  locked: Set<string>;
  rangeTitle: string;
  busy: boolean;
  onClose: () => void;
  onApply: (cells: PlanCell[]) => void;
}) {
  const [options, setOptions] = useState<PlanOptions>(DEFAULT_PLAN_OPTIONS);
  const set = <K extends keyof PlanOptions>(key: K, value: PlanOptions[K]) =>
    setOptions((prev) => ({ ...prev, [key]: value }));

  const result = useMemo(
    () =>
      planShifts({ days, agents, existing: shifts, targets, campaigns, competencies, locked, options }),
    [days, agents, shifts, targets, campaigns, competencies, locked, options],
  );

  const openSlots = result.gaps.reduce((sum, g) => sum + g.missing, 0);
  const nothingToDo = result.changes.length === 0;

  return (
    <Modal
      open
      onClose={onClose}
      title="Automatisch planen"
      subtitle={rangeTitle}
      footer={
        <>
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button
            className="btn btn-primary"
            onClick={() => onApply(result.changes)}
            disabled={busy || nothingToDo}
            title={nothingToDo ? 'Der Vorschlag entspricht dem, was schon im Plan steht.' : undefined}
          >
            {nothingToDo ? 'Nichts zu tun' : `Plan übernehmen (${result.changes.length})`}
          </button>
        </>
      }
    >
      <div className="autoplan">
        <div className="autoplan-options">
          <div className="autoplan-field">
            <span className="autoplan-label">Umfang</span>
            <div className="autoplan-modes" role="group" aria-label="Umfang">
              <button
                type="button"
                className={`autoplan-mode ${options.mode === 'luecken' ? 'is-active' : ''}`}
                onClick={() => set('mode', 'luecken')}
                aria-pressed={options.mode === 'luecken'}
              >
                Nur Lücken füllen
              </button>
              <button
                type="button"
                className={`autoplan-mode ${options.mode === 'neu' ? 'is-active' : ''}`}
                onClick={() => set('mode', 'neu')}
                aria-pressed={options.mode === 'neu'}
              >
                Neu planen
              </button>
            </div>
            <span className="autoplan-hint">
              {options.mode === 'luecken'
                ? 'Bestehende Einträge bleiben stehen, es werden nur leere Tage gefüllt.'
                : 'Früh, Spät und frei werden im ganzen Zeitraum neu verteilt. Urlaub, Krankheit, Schulung und laufende Tauschanfragen bleiben unangetastet.'}
            </span>
          </div>

          <label className="autoplan-field autoplan-field-num">
            <span className="autoplan-label">Arbeitstage je Woche</span>
            <input
              type="number"
              min={1}
              max={7}
              value={options.maxDaysPerWeek}
              onChange={(e) =>
                set('maxDaysPerWeek', Math.min(7, Math.max(1, Number(e.target.value) || 1)))
              }
            />
          </label>

          <label className="autoplan-check">
            <input
              type="checkbox"
              checked={options.assignCampaigns}
              onChange={(e) => set('assignCampaigns', e.target.checked)}
            />
            <span>
              Kampagnen mitverteilen
              <span className="autoplan-hint">Nur nach hinterlegtem Schulungsstand.</span>
            </span>
          </label>

          <label className="autoplan-check">
            <input
              type="checkbox"
              checked={options.fillFree}
              onChange={(e) => set('fillFree', e.target.checked)}
            />
            <span>
              Freie Tage eintragen
              <span className="autoplan-hint">„Frei" statt leerer Zelle — geplant statt vergessen.</span>
            </span>
          </label>
        </div>

        <div className="autoplan-stats">
          <div className="autoplan-stat">
            <strong>{result.changes.length}</strong>
            <span>Zellen werden gesetzt</span>
          </div>
          <div className="autoplan-stat">
            <strong>{result.kept}</strong>
            <span>bleiben unangetastet</span>
          </div>
          <div className={`autoplan-stat ${openSlots > 0 ? 'is-warn' : 'is-ok'}`}>
            <strong>{openSlots}</strong>
            <span>Plätze bleiben offen</span>
          </div>
        </div>

        <div className="autoplan-days">
          {result.days.map((d) => {
            const shortFrueh = Math.max(0, d.needFrueh - d.frueh);
            const shortSpaet = Math.max(0, d.needSpaet - d.spaet);
            const idle = d.needFrueh === 0 && d.needSpaet === 0;
            return (
              <div key={d.dateKey} className={`autoplan-day ${idle ? 'is-idle' : ''}`}>
                <span className="autoplan-day-name">{shortDay(d.dateKey)}</span>
                <span className={`autoplan-count ${shortFrueh ? 'is-short' : ''}`}>
                  <Sun size={12} /> {d.frueh}
                  <span className="autoplan-target">/{d.needFrueh}</span>
                </span>
                <span className={`autoplan-count ${shortSpaet ? 'is-short' : ''}`}>
                  <Moon size={12} /> {d.spaet}
                  <span className="autoplan-target">/{d.needSpaet}</span>
                </span>
                {d.absent > 0 && <span className="autoplan-absent">{d.absent} abwesend</span>}
              </div>
            );
          })}
        </div>

        <div className="autoplan-agents">
          {result.agents.map((a) => (
            <span key={a.userId} className="autoplan-agent" title={`${a.frueh}× Früh, ${a.spaet}× Spät`}>
              <span className="autoplan-agent-avatar">{initialsOf(a.name)}</span>
              <span className="autoplan-agent-name">{a.name}</span>
              <span className="autoplan-agent-days">{a.workDays}</span>
            </span>
          ))}
        </div>

        {result.warnings.length > 0 && (
          <div className="autoplan-warn">
            <AlertTriangle size={14} />
            <ul>
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {result.gaps.length > 0 && (
          <details className="autoplan-gaps">
            <summary>{result.gaps.length} offene Stelle(n) im Vorschlag</summary>
            <ul>
              {result.gaps.map((g) => (
                <li key={`${g.dateKey}-${g.shiftType}`}>
                  <strong>
                    {shortDay(g.dateKey)} · {g.shiftType === 'frueh' ? 'Früh' : 'Spät'}
                  </strong>{' '}
                  — {g.missing} fehlt/fehlen: {g.reason}
                </li>
              ))}
            </ul>
          </details>
        )}

        {result.warnings.length === 0 && result.gaps.length === 0 && !nothingToDo && (
          <p className="autoplan-ok">
            <CheckCheck size={14} /> Soll-Besetzung gedeckt, Pensum eingehalten, alle Kampagnen
            passend zum Schulungsstand.
          </p>
        )}
      </div>
    </Modal>
  );
}
