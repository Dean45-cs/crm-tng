import { Zap } from 'lucide-react';
import type { Route } from '../../router';

/**
 * Bausteine und Typen für die geführten Touren.
 *
 * Es gibt zwei Drehbücher auf derselben Mechanik (siehe OnboardingTour.tsx):
 *
 *   „Einarbeitung"  — für neue Kolleg:innen. Erklärt, wo man klickt.
 *   „Präsentation"  — für die Vorstellung vor Entscheider:innen. Erklärt, was
 *                     es bringt. Wird live moderiert, deshalb Kapitel,
 *                     Sprungmarken und mitlaufende Zeit.
 *
 * Getrennt gehalten, weil die beiden Zielgruppen unterschiedliche Fragen haben:
 * „wie mache ich X?" gegen „warum sollten wir das einführen?". Ein Text, der
 * beides versucht, beantwortet keine der beiden.
 */

export type TourMode = 'onboarding' | 'presentation';

export interface Chapter {
  /** Kurzer Titel für die Kapitelleiste. */
  title: string;
  /** Grobe Redezeit in Minuten — Grundlage für den Zeitplan-Hinweis. */
  minutes: number;
}

export interface StepDef {
  title: string;
  icon: React.ReactNode;
  /** CSS-Selektor für das Spotlight. */
  target?: string;
  goTo?: Route;
  /** Kleiner Hinweis am Spotlight („Klicke hier …"). */
  hint?: string;
  /** Index in die Kapitelliste — nur im Präsentationsmodus ausgewertet. */
  chapter?: number;
  content: React.ReactNode;
}

export function FeatureChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="onboarding-feature-chip">
      <span className="onboarding-chip-icon">{icon}</span>
      <span>{label}</span>
    </div>
  );
}

export function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="onboarding-tip">
      <Zap size={12} className="onboarding-tip-icon-sm" />
      <span>{children}</span>
    </div>
  );
}

export function ShortcutRow({ label, keys }: { label: string; keys: string[] }) {
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

export function BenefitRow({
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

/**
 * Kennzahl mit Beschriftung — für das Schlusskapitel der Präsentation.
 * Zahlen sagen dort mehr als Adjektive: „24 Datenbank-Migrationen" ist
 * überprüfbar, „ausgereift" ist eine Behauptung.
 */
export function StatRow({ items }: { items: { value: string; label: string }[] }) {
  return (
    <div className="onboarding-stats">
      {items.map((s) => (
        <div key={s.label} className="onboarding-stat">
          <strong>{s.value}</strong>
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Gegenüberstellung „vorher / nachher". Der wirksamste Satz in einer
 * Vorstellung ist selten das Feature, sondern der Aufwand, der wegfällt.
 */
export function BeforeAfter({ before, after }: { before: React.ReactNode; after: React.ReactNode }) {
  return (
    <div className="onboarding-ba">
      <div className="onboarding-ba-side is-before">
        <span className="onboarding-ba-label">Bisher</span>
        <span>{before}</span>
      </div>
      <div className="onboarding-ba-side is-after">
        <span className="onboarding-ba-label">Mit dem CRM</span>
        <span>{after}</span>
      </div>
    </div>
  );
}

/** Offener Punkt im Ausblick — ehrlich benannt, nicht als Feature verkauft. */
export function TodoRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="onboarding-todo-row">
      <span className="onboarding-todo-dot" />
      <div className="onboarding-benefit-text">
        <strong>{title}</strong>
        <span>{children}</span>
      </div>
    </div>
  );
}
