import { useEffect, useState } from 'react';
import { ArrowRight, ArrowLeft, Check, X, Clock } from 'lucide-react';
import { useAuth } from '../store/useAuth';
import { useOnboarding } from '../store/useOnboarding';
import { useRouter } from '../router';
import { TngTile } from './TngLogo';
import { onboardingSteps } from './tour/onboardingSteps';
import { presentationSteps, PRESENTATION_CHAPTERS } from './tour/presentationSteps';
import type { StepDef } from './tour/parts';

/**
 * Geführte Tour durch die Anwendung — eine Mechanik, zwei Drehbücher:
 *
 *   „Einarbeitung"  (onboardingSteps.tsx)   für neue Kolleg:innen
 *   „Präsentation"  (presentationSteps.tsx) für die Vorstellung vor
 *                                           Entscheider:innen
 *
 * Gemeinsam ist beiden das Spotlight auf ein Element, der Sprung auf die
 * passende Seite und die Tastatursteuerung. Der Präsentationsmodus ergänzt das
 * um Dinge, die nur beim Moderieren zählen: eine Kapitelleiste, Sprungmarken
 * auf den Zifferntasten (wenn die Zeit knapp wird, überspringt man ein Kapitel
 * statt zu hetzen) und eine mitlaufende Uhr gegen die geplante Redezeit.
 *
 * Die Anwendung darunter bleibt in beiden Modi bedienbar — das Overlay liegt
 * darüber, blockiert aber nichts. Genau deshalb kann man live vorführen und
 * die Tour gleichzeitig als Spickzettel benutzen.
 */
export function OnboardingTour() {
  const { getCurrentUser, completeOnboarding, isManager } = useAuth();
  const closeTour = useOnboarding((s) => s.close);
  const mode = useOnboarding((s) => s.mode);
  const { navigate } = useRouter();
  const user = getCurrentUser();
  const firstName = user?.displayName?.trim().split(/\s+/)[0] ?? '';

  const presenting = mode === 'presentation';
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<DOMRect | null>(null);

  const steps: StepDef[] = presenting
    ? presentationSteps()
    : onboardingSteps(firstName, isManager());

  const step = steps[index];
  const isLast = index === steps.length - 1;

  // Route zum aktuellen Schritt wechseln
  useEffect(() => {
    if (step.goTo) navigate(step.goTo);
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  // Spotlight-Position laufend nachführen
  useEffect(() => {
    if (!step.target) {
      // Spotlight aus, wenn der Schritt kein Ziel-Element hat (DOM-Sync-Effekt).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSpot(null);
      return;
    }
    let raf = 0;
    // Letzte gesetzte Position merken und nur bei echter Änderung neu rendern —
    // sonst löst der RAF-Loop ~60×/s ein State-Update aus (neues DOMRect-Objekt).
    let last: { top: number; left: number; width: number; height: number } | null = null;
    const update = () => {
      const el = document.querySelector(step.target!) as HTMLElement | null;
      if (!el) {
        if (last !== null) {
          last = null;
          setSpot(null);
        }
        return;
      }
      const r = el.getBoundingClientRect();
      if (
        !last ||
        last.top !== r.top ||
        last.left !== r.left ||
        last.width !== r.width ||
        last.height !== r.height
      ) {
        last = { top: r.top, left: r.left, width: r.width, height: r.height };
        setSpot(r);
      }
    };
    const tick = () => {
      update();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
    };
  }, [step.target, index]);

  const finish = () => {
    // Nur beim allerersten Durchlauf der Einarbeitung das Flag schreiben — eine
    // manuell geöffnete Tour und der Präsentationsmodus sollen den
    // Willkommens-Status nicht verändern.
    if (!presenting && user && !user.onboardingCompleted) completeOnboarding();
    closeTour();
  };
  const next = () => (isLast ? finish() : setIndex((i) => i + 1));
  const prev = () => setIndex((i) => Math.max(0, i - 1));

  // Erster Schritt eines Kapitels — Ziel der Sprungmarken.
  const chapterStart = (chapter: number) => steps.findIndex((s) => s.chapter === chapter);

  // Tastatursteuerung: Pfeile blättern, Escape beendet die Tour, im
  // Präsentationsmodus springen die Zifferntasten an den Kapitelanfang.
  // Während man in einem Eingabefeld tippt (die App bleibt unter dem Overlay
  // bedienbar), bleiben die Tasten dem Feld überlassen.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) {
        return;
      }
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (presenting && /^[1-9]$/.test(e.key)) {
        const target = chapterStart(Number(e.key) - 1);
        if (target >= 0) setIndex(target);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }); // bewusst ohne Deps: greift immer auf den aktuellen Schritt zu

  const TIP_W = Math.min(430, (typeof window !== 'undefined' ? window.innerWidth : 430) - 24);
  const TIP_H = 330;

  // Tooltip relativ zum Spotlight platzieren; ohne Spotlight zentriert
  // (Positionierung + Animation übernimmt dann die CSS-Klasse `centered`).
  const tooltipStyle: React.CSSProperties = (() => {
    if (!spot) {
      return { width: TIP_W };
    }
    const pad = 18;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = spot.bottom + pad;
    let left = spot.left + spot.width / 2 - TIP_W / 2;

    if (top + TIP_H > vh - 16) {
      if (spot.top - pad - TIP_H > 16) {
        top = spot.top - pad - TIP_H;
      } else if (spot.right + pad + TIP_W < vw - 16) {
        top = spot.top + spot.height / 2 - TIP_H / 2;
        left = spot.right + pad;
      } else {
        top = spot.top + spot.height / 2 - TIP_H / 2;
        left = spot.left - pad - TIP_W;
      }
    }
    left = Math.max(16, Math.min(left, vw - TIP_W - 16));
    top = Math.max(16, Math.min(top, vh - TIP_H - 16));
    return { top, left, width: TIP_W };
  })();

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true">
      <SpotlightSvg rect={spot} />

      {presenting && (
        <PresenterBar
          steps={steps}
          index={index}
          onJump={(chapter) => {
            const target = chapterStart(chapter);
            if (target >= 0) setIndex(target);
          }}
          onClose={finish}
        />
      )}

      {spot && step.hint && (
        <div
          className="onboarding-hint"
          style={{ top: spot.top - 14, left: spot.left + spot.width / 2 }}
        >
          {step.hint}
        </div>
      )}

      {/* Im Präsentationsmodus sitzt der Beenden-Knopf in der Kapitelleiste —
          sonst würden sich beide oben am Rand überlagern. */}
      {!presenting && (
        <button className="onboarding-skip" onClick={finish} aria-label="Tour überspringen">
          <X size={14} /> Überspringen
        </button>
      )}

      <div className={`onboarding-tooltip ${spot ? '' : 'centered'}`} style={tooltipStyle}>
        <div className="onboarding-tip-head">
          <div className="onboarding-tip-icon">{step.icon}</div>
          <div className="onboarding-progress-wrap">
            <span className="onboarding-step-count">
              {index + 1} / {steps.length}
            </span>
            <div className="onboarding-progress">
              {steps.map((_, i) => (
                <span
                  key={i}
                  className={`onboarding-dot ${i === index ? 'active' : ''} ${
                    i < index ? 'done' : ''
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {index === 0 && !presenting && (
          <div className="onboarding-hero-logo">
            <TngTile size={64} radius={16} />
          </div>
        )}

        <h3 className="onboarding-title">{step.title}</h3>

        <div className="onboarding-content">{step.content}</div>

        <div className="onboarding-actions">
          {index > 0 ? (
            <button className="btn btn-ghost" onClick={prev}>
              <ArrowLeft size={14} /> Zurück
            </button>
          ) : (
            <button className="btn btn-ghost" onClick={finish}>
              {presenting ? 'Abbrechen' : 'Tour überspringen'}
            </button>
          )}
          <button className="btn btn-primary" onClick={next}>
            {isLast ? (
              <>
                {presenting ? 'Fertig' : 'Loslegen'} <Check size={14} />
              </>
            ) : (
              <>
                Weiter <ArrowRight size={14} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Kapitelleiste für den Präsentationsmodus.
 *
 * Zeigt, wo man im Ablauf steht, erlaubt den Sprung an jeden Kapitelanfang
 * (Klick oder Zifferntaste) und lässt die Zeit mitlaufen. Die Uhr vergleicht
 * gegen die geplante Redezeit bis zum aktuellen Kapitel — sie sagt also nicht
 * nur „12 Minuten", sondern ob das für diese Stelle zu viel ist.
 */
function PresenterBar({
  steps,
  index,
  onJump,
  onClose,
}: {
  steps: StepDef[];
  index: number;
  onJump: (chapter: number) => void;
  onClose: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const current = steps[index]?.chapter ?? 0;
  const total = PRESENTATION_CHAPTERS.reduce((sum, c) => sum + c.minutes, 0);

  // Sollzeit bis zum Ende des laufenden Kapitels — der Vergleichswert.
  const plannedSoFar = PRESENTATION_CHAPTERS.slice(0, current + 1).reduce(
    (sum, c) => sum + c.minutes,
    0,
  );
  const behind = elapsed > plannedSoFar * 60;

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <div className="presenter-bar">
      <div className="presenter-chapters">
        {PRESENTATION_CHAPTERS.map((c, i) => (
          <button
            key={c.title}
            type="button"
            className={`presenter-chapter ${i === current ? 'is-active' : ''} ${
              i < current ? 'is-done' : ''
            }`}
            onClick={() => onJump(i)}
            title={`Kapitel ${i + 1} · ${c.minutes} Min. — Taste ${i + 1}`}
          >
            <span className="presenter-chapter-num">{i + 1}</span>
            <span className="presenter-chapter-title">{c.title}</span>
          </button>
        ))}
      </div>
      <div className={`presenter-clock ${behind ? 'is-behind' : ''}`} title={`Geplant: ${total} Min.`}>
        <Clock size={13} />
        <span>
          {mm}:{ss}
        </span>
        <span className="presenter-clock-plan">/ {total} Min.</span>
      </div>
      <button type="button" className="presenter-close" onClick={onClose} aria-label="Präsentation beenden">
        <X size={14} />
      </button>
    </div>
  );
}

function SpotlightSvg({ rect }: { rect: DOMRect | null }) {
  const pad = 10;
  const r = rect
    ? { x: rect.left - pad, y: rect.top - pad, w: rect.width + pad * 2, h: rect.height + pad * 2 }
    : null;

  return (
    <svg className="onboarding-spotlight" width="100%" height="100%">
      <defs>
        <mask id="spot-mask">
          <rect width="100%" height="100%" fill="white" />
          {r && <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={14} ry={14} fill="black" />}
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="rgba(10, 28, 50, 0.55)" mask="url(#spot-mask)" />
      {r && (
        <rect
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          rx={14}
          ry={14}
          fill="none"
          stroke="rgba(255,255,255,0.9)"
          strokeWidth={2}
          className="onboarding-spotlight-ring"
        />
      )}
    </svg>
  );
}
