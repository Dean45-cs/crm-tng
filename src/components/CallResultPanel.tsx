import { useEffect, useId, useState } from 'react';
import {
  CalendarCheck,
  Handshake,
  RotateCcw,
  PhoneMissed,
  ThumbsDown,
  AlertTriangle,
  Ban,
  X,
} from 'lucide-react';
import { OUTCOME_LABEL, OUTCOME_ORDER, needsFollowUp } from '../lib/outbound';
import { today } from '../lib/utils';
import type { CallOutcome, OutboundContact } from '../types';
import type { CallResult } from '../lib/outbound';

const OUTCOME_ICON: Record<CallOutcome, React.ReactNode> = {
  termin: <CalendarCheck size={15} />,
  abschluss: <Handshake size={15} />,
  wiedervorlage: <RotateCcw size={15} />,
  nichtErreicht: <PhoneMissed size={15} />,
  keinInteresse: <ThumbsDown size={15} />,
  falscheDaten: <AlertTriangle size={15} />,
  sperren: <Ban size={15} />,
};

/** Ergebnisse, die als Erfolg gelten — bekommen die betonte Darstellung. */
const POSITIVE: ReadonlySet<CallOutcome> = new Set<CallOutcome>(['termin', 'abschluss']);

/** Morgen als YYYY-MM-DD — Vorschlag für die Wiedervorlage. */
function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

interface Props {
  contact: OutboundContact;
  onSave: (result: CallResult) => void;
  /** Im Fokusmodus: Kontakt zurückstellen, ohne ein Ergebnis zu buchen. */
  onSkip?: () => void;
}

/**
 * Erfassung eines Gesprächsergebnisses: erst das Ergebnis wählen, dann —
 * falls nötig — Wiedervorlage und Notiz ergänzen. Wird im Fokusmodus inline
 * und in der Liste im Modal verwendet.
 */
export function CallResultPanel({ contact, onSave, onSkip }: Props) {
  const fid = useId();
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [followUpDate, setFollowUpDate] = useState(tomorrow());
  const [followUpTime, setFollowUpTime] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  // Beim Wechsel auf einen anderen Kontakt alles zurücksetzen.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOutcome(null);
    setFollowUpDate(tomorrow());
    setFollowUpTime('');
    setNote('');
    setError('');
  }, [contact.id]);

  const pick = (o: CallOutcome) => {
    setOutcome(o);
    setError('');
    if (o === 'termin' && !followUpTime) setFollowUpTime('10:00');
  };

  const save = () => {
    if (!outcome) return;
    if (needsFollowUp(outcome) && !followUpDate) {
      setError(
        outcome === 'termin'
          ? 'Bitte das Datum des Termins eintragen.'
          : 'Bitte ein Datum für die Wiedervorlage eintragen.',
      );
      return;
    }
    if (needsFollowUp(outcome) && followUpDate < today()) {
      setError('Das Datum liegt in der Vergangenheit.');
      return;
    }
    onSave({
      outcome,
      followUpDate: needsFollowUp(outcome) ? followUpDate : undefined,
      followUpTime: needsFollowUp(outcome) ? followUpTime || undefined : undefined,
      note: note.trim() || undefined,
    });
  };

  return (
    <div className="call-result">
      <div className="call-result-label">Wie lief das Gespräch?</div>
      <div className="call-outcome-grid">
        {OUTCOME_ORDER.map((o) => (
          <button
            key={o}
            type="button"
            className={`call-outcome-btn ${POSITIVE.has(o) ? 'positive' : ''} ${
              outcome === o ? 'active' : ''
            }`}
            onClick={() => pick(o)}
            aria-pressed={outcome === o}
          >
            {OUTCOME_ICON[o]}
            <span>{OUTCOME_LABEL[o]}</span>
          </button>
        ))}
      </div>

      {outcome && (
        <div className="call-result-detail">
          {needsFollowUp(outcome) && (
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <div className="field">
                <label htmlFor={`${fid}-date`}>
                  {outcome === 'termin' ? 'Termin am *' : 'Wiedervorlage am *'}
                </label>
                <input
                  id={`${fid}-date`}
                  type="date"
                  value={followUpDate}
                  onChange={(e) => {
                    setFollowUpDate(e.target.value);
                    setError('');
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor={`${fid}-time`}>Uhrzeit</label>
                <input
                  id={`${fid}-time`}
                  type="time"
                  value={followUpTime}
                  onChange={(e) => setFollowUpTime(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="field full">
            <label htmlFor={`${fid}-note`}>Notiz</label>
            <textarea
              id={`${fid}-note`}
              rows={2}
              value={note}
              placeholder="Was war das Ergebnis? (optional)"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {error && <div className="field-error">{error}</div>}

          {outcome === 'abschluss' && (
            <div className="setup-hint">
              Im Anschluss öffnet sich das Vertragsformular — vorbelegt mit
              Kunde und Zielprodukt der Kampagne.
            </div>
          )}
          {outcome === 'sperren' && (
            <div className="setup-hint">
              Der Kontakt wird dauerhaft aus der Anrufliste genommen
              (Werbewiderspruch, DSGVO Art. 21).
            </div>
          )}
        </div>
      )}

      <div className="call-result-actions">
        {onSkip && (
          <button className="btn btn-ghost" onClick={onSkip}>
            <X size={14} /> Überspringen
          </button>
        )}
        <button className="btn btn-primary" onClick={save} disabled={!outcome}>
          Speichern{onSkip ? ' & weiter' : ''}
        </button>
      </div>
    </div>
  );
}
