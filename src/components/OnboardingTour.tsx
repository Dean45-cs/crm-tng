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
  Search,
  Gift,
  UsersRound,
  Award,
  ShieldCheck,
  Boxes,
  Smartphone,
  Rocket,
  Gauge,
} from 'lucide-react';
import { useAuth } from '../store/useAuth';
import { hotkeyLabel, resolveHotkey } from '../lib/hotkeys';
import { useOnboarding } from '../store/useOnboarding';
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

function BenefitRow({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="onboarding-benefit-row">
      <span className="onboarding-benefit-icon">{icon}</span>
      <div className="onboarding-benefit-text">
        <strong>{title}</strong>
        <span>{children}</span>
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
  const { getCurrentUser, completeOnboarding, isManager } = useAuth();
  const closeTour = useOnboarding((s) => s.close);
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
            Das Stadtnetz CRM bündelt Verträge, Tarifwechsel, Leads und Notizen an einem Ort und
            hält deine Provision immer im Blick. Diese kurze Tour zeigt dir alle Funktionen.
          </p>
          <div className="onboarding-feature-grid">
            <FeatureChip icon={<LayoutDashboard size={13} />} label="Dashboard & Ziel" />
            <FeatureChip icon={<Target size={13} />} label="Leads" />
            <FeatureChip icon={<FileSignature size={13} />} label="Verträge" />
            <FeatureChip icon={<Users size={13} />} label="Kunden 360°" />
            <FeatureChip icon={<Trophy size={13} />} label="Leaderboard" />
            <FeatureChip icon={<Gift size={13} />} label="Incentives" />
          </div>
          <Tip>
            Du kannst diese Tour jederzeit wieder öffnen: Drücke einfach{' '}
            <kbd className="onboarding-inline-kbd">.</kbd> und{' '}
            <kbd className="onboarding-inline-kbd">o</kbd> gleichzeitig.
          </Tip>
        </>
      ),
    },
    {
      title: 'Warum dieses CRM?',
      icon: <Rocket size={18} />,
      content: (
        <>
          <div className="onboarding-benefit-list">
            <BenefitRow icon={<Boxes size={14} />} title="Alles an einem Ort">
              Verträge, Tarifwechsel, Leads, Kunden & Notizen — kein Excel-Chaos, keine
              Doppelerfassung.
            </BenefitRow>
            <BenefitRow icon={<Gauge size={14} />} title="Echtzeit im ganzen Team">
              Jede Änderung ist sofort für alle sichtbar. Berichte und Team-Zahlen entstehen
              automatisch — ohne manuelles Zusammenkopieren.
            </BenefitRow>
            <BenefitRow icon={<Trophy size={14} />} title="Motivation eingebaut">
              Monatsziele, Leaderboard und Incentive-Aktionen machen Erfolge sichtbar und spornen
              an.
            </BenefitRow>
            <BenefitRow icon={<ShieldCheck size={14} />} title="DSGVO & Nachvollziehbarkeit">
              Rollen & Zugriffskontrolle, dokumentierte Einwilligung und ein lückenloses
              Audit-Log.
            </BenefitRow>
            <BenefitRow icon={<Smartphone size={14} />} title="Überall einsatzbereit">
              Läuft am PC, Tablet und Handy, ist als App installierbar und übersteht auch
              Funklöcher — inklusive Jira- und SharePoint-Anbindung.
            </BenefitRow>
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
      title: 'Blitzsuche & Springen',
      icon: <Search size={18} />,
      target: '.header-search-wrap',
      goTo: { name: 'dashboard' },
      content: (
        <>
          <p className="onboarding-body">
            Oben in der Leiste findest du die <strong>Kundensuche</strong> — tippe Name oder
            Kundennummer und spring direkt ins Profil.
          </p>
          <p className="onboarding-body onboarding-body-tight">
            Noch schneller ist die <strong>Befehlspalette</strong>: Mit{' '}
            <kbd className="onboarding-inline-kbd">⌘</kbd>
            <kbd className="onboarding-inline-kbd">K</kbd> durchsuchst du Kunden, Verträge,
            Tarifwechsel und Notizen gleichzeitig — und legst von dort auch Neues an.
          </p>
          <Tip>Einmal ausprobiert, willst du nie wieder klicken: {hotkeyLabel(resolveHotkey('palette'))} ist der schnellste Weg.</Tip>
        </>
      ),
    },
    {
      title: 'Leads: vom Interessenten zum Vertrag',
      icon: <Target size={18} />,
      target: '.sidebar-item-leads',
      goTo: { name: 'leads' },
      content: (
        <>
          <p className="onboarding-body">
            In <strong>Leads</strong> sammelst du Interessenten, bevor ein Vertrag zustande kommt —
            mit Status, Notizen und Wiedervorlage. So geht kein potenzieller Abschluss verloren.
          </p>
          <p className="onboarding-body onboarding-body-tight">
            Gewonnene Leads legst du mit <strong>einem Klick</strong> als Kunde an — das
            Vertragsformular ist dann schon vorausgefüllt.
          </p>
          <Tip>
            Das Dashboard-Widget „Auslaufende Verträge" zeigt dir zusätzlich, welche Kunden bald
            eine Verlängerung brauchen — die nächste Verkaufschance.
          </Tip>
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
      title: 'Leaderboard & Incentives',
      icon: <Trophy size={18} />,
      target: '.sidebar-item-leaderboard',
      goTo: { name: 'leaderboard' },
      content: (
        <>
          <p className="onboarding-body">
            Das <strong>Leaderboard</strong> zeigt die monatliche Provisions-Rangliste deines Teams
            — mit Podium für die Top 3. Ein freundlicher Ansporn, kein Druckmittel.
          </p>
          <p className="onboarding-body onboarding-body-tight">
            Unter <strong>Incentives</strong> laufen zusätzlich ausgelobte Aktionen (z. B. „Meiste
            Glasfaser-Abschlüsse im März") — dein Fortschritt wird automatisch mitgezählt.
          </p>
          <Tip>
            Ob du im Ranking sichtbar bist, entscheidest du selbst — der Schalter dafür ist oben
            auf der Leaderboard-Seite und in den Einstellungen.
          </Tip>
        </>
      ),
    },
    ...(isManager()
      ? [
          {
            title: 'Dein Chef-Bereich',
            icon: <BarChart3 size={18} />,
            target: '.sidebar-item-teamdashboard',
            goTo: { name: 'teamdashboard' } as Route,
            content: (
              <>
                <p className="onboarding-body">
                  Als Führungskraft hast du einen eigenen Bereich: Das{' '}
                  <strong>Team-Dashboard</strong> zeigt Umsatz, Abschlüsse und Zielerreichung pro
                  Mitarbeiter:in — in Echtzeit, ohne dass jemand Zahlen zuliefern muss.
                </p>
                <div className="onboarding-feature-grid onboarding-feature-grid-2">
                  <FeatureChip icon={<BarChart3 size={13} />} label="Team-Dashboard" />
                  <FeatureChip icon={<UsersRound size={13} />} label="Konten & Rollen" />
                  <FeatureChip icon={<Award size={13} />} label="Incentives ausloben" />
                  <FeatureChip icon={<ShieldCheck size={13} />} label="Audit-Log" />
                </div>
                <Tip>
                  In der Team-Verwaltung legst du Konten an, vergibst Ziele und sperrst Zugänge —
                  jede Änderung landet nachvollziehbar im Audit-Log.
                </Tip>
              </>
            ),
          } satisfies StepDef,
        ]
      : []),
    {
      title: 'Einstellungen & Berichte',
      icon: <SettingsIcon size={18} />,
      target: '.sidebar-item-settings',
      goTo: { name: 'settings' },
      content: (
        <>
          <p className="onboarding-body">
            In den <strong>Einstellungen</strong> passt du Provisionssätze pro Produkt, dein
            Monatsziel und das Erscheinungsbild (hell/dunkel) an. Diese Werte gelten nur für dich.
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
    {
      title: 'Startklar! 🎉',
      icon: <Check size={18} />,
      content: (
        <>
          <p className="onboarding-body">
            Das war's — du kennst jetzt alle Bereiche. Die wichtigsten Kürzel für den Alltag noch
            einmal auf einen Blick:
          </p>
          <div className="onboarding-shortcut-list">
            <ShortcutRow label="Blitzsuche öffnen" keys={['⌘', 'K']} />
            <ShortcutRow label="Neuer Vertrag" keys={['⌘', 'N']} />
            <ShortcutRow label="Neuer Tarifwechsel" keys={['⌘', 'T']} />
            <ShortcutRow label="Diese Tour erneut öffnen" keys={['.', 'o']} />
          </div>
          <Tip>
            Für die Tour drückst du <strong>Punkt und o gleichzeitig</strong> — oder startest sie
            in den Einstellungen. Viel Erfolg!
          </Tip>
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

  const finish = () => {
    // Nur beim allerersten Durchlauf das Flag schreiben — bei einer manuell
    // erneut geöffneten Tour reicht das Schließen.
    if (user && !user.onboardingCompleted) completeOnboarding();
    closeTour();
  };
  const next = () => (isLast ? finish() : setIndex((i) => i + 1));
  const prev = () => setIndex((i) => Math.max(0, i - 1));

  // Tastatursteuerung: Pfeile blättern, Escape beendet die Tour. Während man
  // in einem Eingabefeld tippt (die App bleibt unter dem Overlay bedienbar),
  // bleiben die Tasten dem Feld überlassen.
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
  const pad = 10;
  const r = rect
    ? { x: rect.left - pad, y: rect.top - pad, w: rect.width + pad * 2, h: rect.height + pad * 2 }
    : null;

  return (
    <svg className="onboarding-spotlight" width="100%" height="100%">
      <defs>
        <mask id="spot-mask">
          <rect width="100%" height="100%" fill="white" />
          {r && (
            <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={14} ry={14} fill="black" />
          )}
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
