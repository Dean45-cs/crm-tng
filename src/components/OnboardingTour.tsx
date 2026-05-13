import { useEffect, useState } from 'react';
import {
  Sparkles,
  LayoutDashboard,
  Plus,
  Users,
  Trophy,
  ArrowRight,
  ArrowLeft,
  Check,
  X,
} from 'lucide-react';
import { useAuth } from '../store/useAuth';
import { useRouter, type Route } from '../router';
import { TngTile } from './TngLogo';

interface Step {
  title: string;
  body: string;
  icon: React.ReactNode;
  target?: string; // CSS selector for spotlight
  goTo?: Route;
}

export function OnboardingTour() {
  const { getCurrentUser, completeOnboarding } = useAuth();
  const { navigate } = useRouter();
  const user = getCurrentUser();

  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<DOMRect | null>(null);

  const steps: Step[] = [
    {
      title: `Willkommen, ${user?.displayName ?? ''}!`,
      body:
        'Schön, dass du dabei bist. In 5 kurzen Schritten zeige ich dir, wie du das Stadtnetz CRM nutzt. Du kannst die Tour jederzeit überspringen.',
      icon: <Sparkles size={18} />,
    },
    {
      title: 'Dein Dashboard',
      body:
        'Hier siehst du auf einen Blick deine Provision, dein Monatsziel und die letzten Vorgänge. Die Wiedervorlage-Inbox erinnert dich an offene Aufgaben.',
      icon: <LayoutDashboard size={18} />,
      target: '.hero-banner',
      goTo: { name: 'dashboard' },
    },
    {
      title: 'Schnell erfassen',
      body:
        'Mit dem blauen Plus-Button unten rechts erfasst du in Sekunden einen Vertrag, Tarifwechsel oder eine Notiz. Tastaturkürzel: ⌘N · ⌘T · ⌘⇧N.',
      icon: <Plus size={18} />,
      target: '.fab',
    },
    {
      title: 'Kunden-360°',
      body:
        'Im Bereich „Kunden" findest du alle Kundenkarten. Ein Klick zeigt dir Verträge, Tarifwechsel und Notizen pro Kunde auf einer Seite.',
      icon: <Users size={18} />,
      target: '.sidebar-item-customers',
      goTo: { name: 'customers' },
    },
    {
      title: 'Leaderboard',
      body:
        'Vergleich dich freundlich mit deinen Kolleg:innen. Du entscheidest selbst, ob du im Ranking sichtbar bist – einfach in den Einstellungen oder direkt im Leaderboard umschalten.',
      icon: <Trophy size={18} />,
      target: '.sidebar-item-leaderboard',
      goTo: { name: 'leaderboard' },
    },
  ];

  const step = steps[index];
  const isLast = index === steps.length - 1;

  // Sync route + spotlight position to the current step
  useEffect(() => {
    if (step.goTo) navigate(step.goTo);
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!step.target) {
      setSpot(null);
      return;
    }
    let raf = 0;
    const update = () => {
      const el = document.querySelector(step.target!) as HTMLElement | null;
      if (el) {
        setSpot(el.getBoundingClientRect());
      } else {
        setSpot(null);
      }
    };
    // give the navigated route a tick to mount
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

  const finish = () => completeOnboarding();
  const next = () => (isLast ? finish() : setIndex((i) => i + 1));
  const prev = () => setIndex((i) => Math.max(0, i - 1));

  // Position of tooltip relative to spotlight
  const tooltipStyle: React.CSSProperties = (() => {
    if (!spot) {
      return {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };
    }
    const padding = 16;
    const tipWidth = 380;
    const tipHeight = 240;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Try below first
    let top = spot.bottom + padding;
    let left = spot.left + spot.width / 2 - tipWidth / 2;
    let placement: 'below' | 'above' | 'right' | 'left' = 'below';

    if (top + tipHeight > vh - 16) {
      // Try above
      if (spot.top - padding - tipHeight > 16) {
        top = spot.top - padding - tipHeight;
        placement = 'above';
      } else if (spot.right + padding + tipWidth < vw - 16) {
        top = spot.top + spot.height / 2 - tipHeight / 2;
        left = spot.right + padding;
        placement = 'right';
      } else {
        top = spot.top + spot.height / 2 - tipHeight / 2;
        left = spot.left - padding - tipWidth;
        placement = 'left';
      }
    }
    left = Math.max(16, Math.min(left, vw - tipWidth - 16));
    top = Math.max(16, Math.min(top, vh - tipHeight - 16));
    return {
      top,
      left,
      width: tipWidth,
      ['--placement' as never]: placement,
    } as React.CSSProperties;
  })();

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true">
      <SpotlightSvg rect={spot} />

      <button
        className="onboarding-skip"
        onClick={finish}
        aria-label="Tour überspringen"
      >
        <X size={14} /> Überspringen
      </button>

      <div className="onboarding-tooltip" style={tooltipStyle}>
        <div className="onboarding-tip-head">
          <div className="onboarding-tip-icon">{step.icon}</div>
          <div className="onboarding-progress">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`onboarding-dot ${i === index ? 'active' : ''} ${i < index ? 'done' : ''}`}
              />
            ))}
          </div>
        </div>

        {index === 0 && (
          <div className="onboarding-hero-logo">
            <TngTile size={72} radius={18} />
          </div>
        )}

        <h3 className="onboarding-title">{step.title}</h3>
        <p className="onboarding-body">{step.body}</p>

        <div className="onboarding-actions">
          {index > 0 ? (
            <button className="btn btn-ghost" onClick={prev}>
              <ArrowLeft size={14} /> Zurück
            </button>
          ) : (
            <span />
          )}
          <button className="btn btn-primary" onClick={next}>
            {isLast ? (
              <>
                Loslegen <Check size={14} />
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

function SpotlightSvg({ rect }: { rect: DOMRect | null }) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const pad = 10;
  const r = rect
    ? { x: rect.left - pad, y: rect.top - pad, w: rect.width + pad * 2, h: rect.height + pad * 2 }
    : null;

  return (
    <svg className="onboarding-spotlight" width={vw} height={vh}>
      <defs>
        <mask id="spot-mask">
          <rect width={vw} height={vh} fill="white" />
          {r && (
            <rect
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
              rx={14}
              ry={14}
              fill="black"
            />
          )}
        </mask>
      </defs>
      <rect width={vw} height={vh} fill="rgba(10, 28, 50, 0.55)" mask="url(#spot-mask)" />
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
