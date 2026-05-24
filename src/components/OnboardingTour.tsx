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
  FileSignature,
  ArrowLeftRight,
  StickyNote,
  Target,
  BarChart3,
  Settings as SettingsIcon,
  FileText,
  Share2,
  Zap,
  CalendarClock,
} from 'lucide-react';
import { useAuth } from '../store/useAuth';
import { useRouter, type Route } from '../router';
import { TngTile } from './TngLogo';

// ── Bausteine für den Schritt-Inhalt ────────────────────────────────────────

function FeatureChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="onboarding-feature-chip">
      <span className="onboarding-chip-icon">{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="onboarding-tip">
      <Zap size={12} className="onboarding-tip-icon-sm" />
      <span>{children}</span>
    </div>
  );
}

function ShortcutRow({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="onboarding-shortcut-row">
      <span>{label}</span>
      <div className="onboarding-kbd-group">
        {keys.map((k) => (
          <kbd key={k}>{k}</kbd>
        ))}
      </div>
    </div>
  );
}

// ── Schritt-Definition ──────────────────────────────────────────────────────

interface StepDef {
  title: string;
  icon: React.ReactNode;
  target?: string; // CSS-Selektor für das Spotlight
  goTo?: Route;
  hint?: string; // kleiner Hinweis am Spotlight ("Klicke hier …")
  content: React.ReactNode;
}

export function OnboardingTour() {
  const { getCurrentUser, completeOnboarding } = useAuth();
  const { navigate } = useRouter();
  const user = getCurrentUser();
  const firstName = user?.displayName?.trim().split(/\s+/)[0] ?? '';

  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<DOMRect | null>(null);

  const steps: StepDef[] = [
    {
      title: `Willkommen, ${firstName}!`,
      icon: <Sparkles size={18} />,
      content: (
        <>
          <p className="onboarding-body">
            Das Stadtnetz CRM bündelt deine Verträge, Tarifwechsel und Notizen an einem Ort und
            hält deine Provision im Blick. In <strong>8 kurzen Schritten</strong> zeige ich dir, wie
            alles zusammenspielt.
          </p>
          <div className="onboarding-feature-grid">
            <FeatureChip icon={<LayoutDashboard size={13} />} label="Dashboard & Ziel" />
            <FeatureChip icon={<FileSignature size={13} />} label="Verträge" />
            <FeatureChip icon={<Users size={13} />} label="Kunden 360°" />
            <FeatureChip icon={<CalendarClock size={13} />} label="Wiedervorlage" />
            <FeatureChip icon={<Trophy size={13} />} label="Leaderboard" />
            <FeatureChip icon={<FileText size={13} />} label="Monats-PDF" />
          </div>
        </>
      ),
    },
    {
      title: 'Dein persönliches Dashboard',
      icon: <LayoutDashboard size={18} />,
      target: '.scope-toggle',
      goTo: { name: 'dashboard' },
      hint: 'Probier den Schalter aus',
      content: (
        <>
          <p className="onboarding-body">
            Der große Ring zeigt deinen Fortschritt zum Monatsziel — er füllt sich mit jeder
            Provision. Die KPI-Kacheln darunter zeigen Abschlüsse, Provision und Trend.
          </p>
          <p className="onboarding-body onboarding-body-tight">
            Mit dem hervorgehobenen <strong>Meine / Alle</strong>-Schalter wechselst du zwischen
            deinen eigenen Zahlen und der Teamansicht. Standard ist <strong>Meine</strong>.
          </p>
          <Tip>Dein Monatsziel in € legst du selbst in den Einstellungen fest.</Tip>
        </>
      ),
    },
    {
      title: 'Die Wiedervorlage-Inbox',
      icon: <CalendarClock size={18} />,
      target: '.followup-inbox',
      goTo: { name: 'dashboard' },
      content: (
        <>
          <p className="onboarding-body">
            Setzt du bei einem Vertrag ein <strong>Wiedervorlage-Datum</strong>, taucht er hier
            automatisch auf. Überfällige Einträge leuchten rot, heute fällige orange.
          </p>
          <p className="onboarding-body onboarding-body-tight">
            Ein Klick auf das <strong>Häkchen</strong> markiert den Vorgang als erledigt und
            entfernt ihn aus der Inbox.
          </p>
          <Tip>Perfekt für Rückrufe, offene Abschlüsse und das Nachfassen nach Angeboten.</Tip>
        </>
      ),
    },
    {
      title: 'Schnell erfassen',
      icon: <Plus size={18} />,
      target: '.fab',
      goTo: { name: 'dashboard' },
      hint: 'Hier neue Einträge anlegen',
      content: (
        <>
          <p className="onboarding-body">
            Der blaue <strong>+ Button</strong> unten rechts ist immer erreichbar. Ein Klick öffnet
            das Menü für Vertrag, Tarifwechsel oder Notiz — oder du nutzt diese Tastenkürzel:
          </p>
          <div className="onboarding-shortcut-list">
            <ShortcutRow label="Neuer Vertrag" keys={['⌘', 'N']} />
            <ShortcutRow label="Neuer Tarifwechsel" keys={['⌘', 'T']} />
            <ShortcutRow label="Neue Notiz" keys={['⌘', '⇧', 'N']} />
          </div>
          <Tip>Legst du einen Vorgang im Kundenprofil an, ist der Kunde schon vorausgefüllt.</Tip>
        </>
      ),
    },
    {
      title: 'Verträge & Provision',
      icon: <FileSignature size={18} />,
      target: '.sidebar-item-contracts',
      goTo: { name: 'contracts' },
      content: (
        <>
          <p className="onboarding-body">
            In <strong>Verträge</strong> findest du alle Abschlüsse als Tabelle — sortierbar nach
            Datum, Kunde oder Provision. Die Summenzeile unten zeigt die Gesamt-Provision des
            gewählten Zeitraums.
          </p>
          <div className="onboarding-feature-grid onboarding-feature-grid-2">
            <FeatureChip icon={<BarChart3 size={13} />} label="Spalten sortieren" />
            <FeatureChip icon={<Target size={13} />} label="Provisions-Total" />
            <FeatureChip icon={<ArrowLeftRight size={13} />} label="Tarifwechsel" />
            <FeatureChip icon={<StickyNote size={13} />} label="Notizen" />
          </div>
          <Tip>Stornierte Verträge werden durchgestrichen und zählen nicht zur Summe.</Tip>
        </>
      ),
    },
    {
      title: 'Kunden 360°',
      icon: <Users size={18} />,
      target: '.sidebar-item-customers',
      goTo: { name: 'customers' },
      content: (
        <>
          <p className="onboarding-body">
            Jeder Vorgang gehört zu einer Kundennummer. Im <strong>Kundenprofil</strong> siehst du
            die komplette Historie eines Kunden — Verträge, Tarifwechsel und Notizen auf einer
            Seite.
          </p>
          <p className="onboarding-body onboarding-body-tight">
            Kunden kannst du mit Kolleg:innen <strong>teilen</strong>: Geteilte Kunden erscheinen
            dann in beiden Ansichten.
          </p>
          <Tip>Im Kundenprofil erfasste Vorgänge werden automatisch dem Kunden zugeordnet.</Tip>
        </>
      ),
    },
    {
      title: 'Team-Leaderboard',
      icon: <Trophy size={18} />,
      target: '.sidebar-item-leaderboard',
      goTo: { name: 'leaderboard' },
      content: (
        <>
          <p className="onboarding-body">
            Das Leaderboard zeigt die monatliche Provisions-Rangliste deines Teams — mit Podium für
            die Top 3. Ein freundlicher Ansporn, kein Druckmittel.
          </p>
          <Tip>
            Mit dem Schalter oben auf der Seite entscheidest du selbst, ob du sichtbar bist. Versteckt
            siehst du dich weiterhin, andere aber nicht.
          </Tip>
        </>
      ),
    },
    {
      title: 'Einstellungen & Berichte',
      icon: <SettingsIcon size={18} />,
      target: '.sidebar-item-settings',
      goTo: { name: 'settings' },
      content: (
        <>
          <p className="onboarding-body">
            Zum Schluss die <strong>Einstellungen</strong>: Hier passt du deine Provisionssätze pro
            Produkt und dein Monatsziel an. Diese Werte gelten nur für dich.
          </p>
          <div className="onboarding-feature-grid onboarding-feature-grid-2">
            <FeatureChip icon={<Target size={13} />} label="Monatsziel" />
            <FeatureChip icon={<SettingsIcon size={13} />} label="Provisionssätze" />
            <FeatureChip icon={<FileText size={13} />} label="PDF-Bericht" />
            <FeatureChip icon={<Share2 size={13} />} label="SharePoint-Export" />
          </div>
          <Tip>Den PDF-Monatsbericht öffnest du über den Button oben rechts im Dashboard.</Tip>
        </>
      ),
    },
  ];

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

  const finish = () => completeOnboarding();
  const next = () => (isLast ? finish() : setIndex((i) => i + 1));
  const prev = () => setIndex((i) => Math.max(0, i - 1));

  const TIP_W = 430;
  const TIP_H = 330;

  // Tooltip relativ zum Spotlight platzieren
  const tooltipStyle: React.CSSProperties = (() => {
    if (!spot) {
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: TIP_W };
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

      {spot && step.hint && (
        <div
          className="onboarding-hint"
          style={{ top: spot.top - 14, left: spot.left + spot.width / 2 }}
        >
          {step.hint}
        </div>
      )}

      <button className="onboarding-skip" onClick={finish} aria-label="Tour überspringen">
        <X size={14} /> Überspringen
      </button>

      <div className="onboarding-tooltip" style={tooltipStyle}>
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

        {index === 0 && (
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
              Tour überspringen
            </button>
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
            <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={14} ry={14} fill="black" />
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
