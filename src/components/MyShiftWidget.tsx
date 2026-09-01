import { useEffect, useState } from 'react';
import { CalendarDays, ChevronRight, Coffee } from 'lucide-react';
import { useShifts } from '../store/useShifts';
import { useStore } from '../store/useStore';
import { useRouter } from '../router';
import {
  shiftMeta,
  shiftTimeLabel,
  shiftProgress,
  formatDuration,
  minutesOfDay,
  SHIFT_TIMES,
} from '../lib/shifts';
import { shortDay } from '../lib/notifications';
import { today } from '../lib/utils';
import type { Shift } from '../types';

/**
 * „Meine Schicht" auf dem Dashboard.
 *
 * Das Dashboard hatte bisher nur eine Zeile Text („Heute: Kampagne X"). Für den
 * Arbeitstag ist aber die Zeit die eigentliche Information: läuft meine Schicht
 * schon, wie lange noch, und wenn ich frei habe — wann geht es weiter? Genau
 * das beantwortet dieses Widget, und zwar aus derselben Quelle, aus der auch
 * die Extension ihren Call-Typ zieht (useShifts.myShifts).
 *
 * Die Restzeit läuft mit: ein Dashboard, das den ganzen Vormittag „noch 6:30"
 * behauptet, ist schlimmer als keins. Minütlich reicht dafür — die Anzeige ist
 * auf Minuten genau.
 */
export function MyShiftWidget() {
  const myShifts = useShifts((s) => s.myShifts);
  const campaigns = useStore((s) => s.campaigns);
  const { navigate } = useRouter();

  const [nowMin, setNowMin] = useState(() => minutesOfDay());
  useEffect(() => {
    const id = setInterval(() => setNowMin(minutesOfDay()), 60_000);
    return () => clearInterval(id);
  }, []);

  const todayKey = today();
  const todayShift = myShifts.find((s) => s.shiftDate === todayKey) ?? null;
  const meta = todayShift ? shiftMeta(todayShift.shiftType) : null;
  const progress = todayShift && meta?.working ? shiftProgress(todayShift.shiftType, nowMin) : null;

  // Die nächste Arbeitsschicht nach heute. Freie Tage und Abwesenheiten fallen
  // dabei heraus — gesucht ist, wann wieder gearbeitet wird.
  const nextWorking = myShifts.find(
    (s) => s.shiftDate > todayKey && shiftMeta(s.shiftType).working,
  );

  // Läuft heute nichts mehr (frei, Abwesenheit oder Feierabend), zeigt das
  // Widget die nächste Schicht statt einer abgelaufenen.
  const showNext = !todayShift || !meta?.working || progress?.phase === 'after';
  const highlight: Shift | null = showNext ? nextWorking ?? null : todayShift;

  const campaignName = (s: Shift | null) =>
    s?.campaignId ? campaigns.find((c) => c.id === s.campaignId)?.name ?? null : null;

  return (
    <div className="widget my-shift-widget">
      <div className="row between" style={{ marginBottom: 10 }}>
        <h3
          className="widget-title"
          style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <CalendarDays size={15} />
          Meine Schicht
        </h3>
        <button className="btn btn-sm" onClick={() => navigate({ name: 'schedule' })}>
          Schichtplan <ChevronRight size={13} />
        </button>
      </div>

      {!highlight && !todayShift ? (
        <div className="my-shift-empty">
          <Coffee size={22} strokeWidth={1.5} />
          <p>Für die nächsten zwei Wochen ist keine Schicht für dich eingetragen.</p>
        </div>
      ) : showNext && !highlight ? (
        // Heute frei oder abwesend, und danach steht (noch) nichts an.
        <div className="my-shift-body">
          <div className={`my-shift-badge tone-${meta?.tone ?? 'frei'}`}>
            {meta?.label ?? 'Frei'}
          </div>
          <div className="my-shift-text">
            <strong>Heute {meta?.absence ? meta.label.toLowerCase() : 'frei'}</strong>
            <span className="muted">Danach ist noch keine Schicht eingetragen.</span>
          </div>
        </div>
      ) : showNext ? (
        <div className="my-shift-body">
          <div className={`my-shift-badge tone-${shiftMeta(highlight!.shiftType).tone}`}>
            {shiftMeta(highlight!.shiftType).label}
          </div>
          <div className="my-shift-text">
            <strong>
              {todayShift && meta && !meta.working
                ? `Heute ${meta.absence ? meta.label.toLowerCase() : 'frei'} · weiter am ${shortDay(highlight!.shiftDate)}`
                : `Nächste Schicht: ${shortDay(highlight!.shiftDate)}`}
            </strong>
            <span className="muted">
              {shiftTimeLabel(highlight!.shiftType)}
              {campaignName(highlight) ? ` · ${campaignName(highlight)}` : ''}
            </span>
          </div>
        </div>
      ) : (
        // Die laufende (oder heute noch bevorstehende) Schicht.
        <>
          <div className="my-shift-body">
            <div className={`my-shift-badge tone-${meta!.tone}`}>{meta!.label}</div>
            <div className="my-shift-text">
              <strong>
                {progress?.phase === 'running'
                  ? `Noch ${formatDuration(progress.minutesLeft)}`
                  : `Beginnt in ${formatDuration(progress?.minutesLeft ?? 0)}`}
              </strong>
              <span className="muted">
                {shiftTimeLabel(todayShift!.shiftType)}
                {campaignName(todayShift) ? ` · ${campaignName(todayShift)}` : ''}
              </span>
            </div>
          </div>
          <ShiftProgressBar
            shiftType={todayShift!.shiftType}
            nowMin={nowMin}
            progress={progress?.progress ?? 0}
          />
        </>
      )}
    </div>
  );
}

/** Der Tagesbalken mit Start-, Jetzt- und Endmarke. */
function ShiftProgressBar({
  shiftType,
  nowMin,
  progress,
}: {
  shiftType: Shift['shiftType'];
  nowMin: number;
  progress: number;
}) {
  const range = SHIFT_TIMES[shiftType];
  if (!range) return null;
  const pct = Math.min(100, Math.max(0, progress * 100));
  const started = nowMin >= range.startMin;

  return (
    <div className="my-shift-progress">
      <div className="my-shift-track">
        <div className="my-shift-fill" style={{ width: `${pct}%` }} />
        {started && pct < 100 && <span className="my-shift-now" style={{ left: `${pct}%` }} />}
      </div>
      <div className="my-shift-scale">
        <span>{shiftTimeLabel(shiftType)?.split(' – ')[0]}</span>
        <span>{shiftTimeLabel(shiftType)?.split(' – ')[1]}</span>
      </div>
    </div>
  );
}
