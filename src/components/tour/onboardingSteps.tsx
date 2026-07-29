import {
  Sparkles,
  LayoutDashboard,
  Plus,
  Users,
  Trophy,
  Check,
  FileSignature,
  ArrowLeftRight,
  StickyNote,
  Target,
  BarChart3,
  Settings as SettingsIcon,
  FileText,
  Share2,
  CalendarClock,
  CalendarDays,
  Search,
  UsersRound,
  Award,
  ShieldCheck,
  Boxes,
  Smartphone,
  Rocket,
  Gauge,
  Inbox,
  AppWindow,
  Calculator,
  FileChartColumn,
  Palette,
  Keyboard,
  PhoneCall,
} from 'lucide-react';
import { hotkeyLabel, resolveHotkey } from '../../lib/hotkeys';
import { BenefitRow, FeatureChip, ShortcutRow, Tip, type StepDef } from './parts';
import type { Route } from '../../router';

/**
 * Drehbuch „Einarbeitung" — für neue Kolleg:innen.
 *
 * Erklärt, wo man klickt und was ein Bereich für den eigenen Arbeitstag
 * bedeutet. Gegenstück ist presentationSteps.tsx, das dieselbe Anwendung aus
 * der Entscheider-Perspektive erzählt.
 *
 * Der Chef-Block erscheint nur für Führungskräfte: Schritte über Bereiche, die
 * man gar nicht sehen kann, verunsichern mehr, als sie erklären.
 */
export function onboardingSteps(firstName: string, isManager: boolean): StepDef[] {
  return [
    {
      title: `Willkommen, ${firstName}!`,
      icon: <Sparkles size={18} />,
      content: (
        <>
          <p className="onboarding-body">
            Das Stadtnetz CRM bündelt Verträge, Tarifwechsel, Leads, Kunden und deinen Schichtplan
            an einem Ort und hält deine Provision immer im Blick. Diese Tour zeigt dir alle
            Funktionen.
          </p>
          <div className="onboarding-feature-grid">
            <FeatureChip icon={<LayoutDashboard size={13} />} label="Dashboard & Ziel" />
            <FeatureChip icon={<CalendarDays size={13} />} label="Schichtplan" />
            <FeatureChip icon={<Target size={13} />} label="Leads" />
            <FeatureChip icon={<FileSignature size={13} />} label="Verträge" />
            <FeatureChip icon={<Users size={13} />} label="Kunden 360°" />
            <FeatureChip icon={<Trophy size={13} />} label="Leaderboard" />
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
              Verträge, Tarifwechsel, Leads, Kunden, Notizen und Schichten — kein Excel-Chaos,
              keine Doppelerfassung.
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
      title: 'Deine Schicht im Blick',
      icon: <CalendarClock size={18} />,
      target: '.my-shift-widget',
      goTo: { name: 'dashboard' },
      content: (
        <>
          <p className="onboarding-body">
            Hier siehst du, ob deine Schicht schon läuft und wie lange noch — mit Fortschritt über
            den Tag. Hast du frei, steht stattdessen da, wann es wieder losgeht.
          </p>
          <p className="onboarding-body onboarding-body-tight">
            Ist deiner Schicht eine <strong>Kampagne</strong> zugeordnet, steht sie gleich mit
            dabei. Genau die steuert auch das Skript in der Browser-Erweiterung.
          </p>
        </>
      ),
    },
    {
      title: 'Der Schichtplan',
      icon: <CalendarDays size={18} />,
      target: '.sidebar-item-schedule',
      goTo: { name: 'schedule' },
      content: (
        <>
          <p className="onboarding-body">
            Der Plan des ganzen Teams — du siehst alle, alle sehen dich. Eingeteilt wird von der
            Führungskraft; du erkennst deine eigene Zeile an der blauen Markierung.
          </p>
          <p className="onboarding-body onboarding-body-tight">
            Passt dir ein Tag nicht, bietest du ihn über <strong>Schicht tauschen</strong> einer
            Kolleg:in an. Stimmt sie zu, bestätigt der Chef — und der Plan ändert sich.
          </p>
          <div className="onboarding-feature-grid onboarding-feature-grid-2">
            <FeatureChip icon={<CalendarDays size={13} />} label="Woche & Monat" />
            <FeatureChip icon={<ArrowLeftRight size={13} />} label="Tauschbörse" />
            <FeatureChip icon={<Gauge size={13} />} label="Besetzung je Tag" />
            <FeatureChip icon={<Users size={13} />} label="Nur meine Schichten" />
          </div>
          <Tip>
            Ändert sich etwas an deinem Plan, bekommst du automatisch eine Meldung ins Postfach.
          </Tip>
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
      title: 'Dein Postfach',
      icon: <Inbox size={18} />,
      target: '.sidebar-item-postfach',
      goTo: { name: 'postfach' },
      content: (
        <>
          <p className="onboarding-body">
            Alles, was <strong>dich persönlich</strong> betrifft, landet hier: Änderungen an deinem
            Schichtplan, Tauschanfragen von Kolleg:innen, geteilte Kunden.
          </p>
          <p className="onboarding-body onboarding-body-tight">
            Die Glocke oben in der Leiste zeigt ungelesene Meldungen. Auf Tauschanfragen kannst du
            direkt aus der Meldung heraus antworten.
          </p>
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
          <Tip>
            Einmal ausprobiert, willst du nie wieder klicken:{' '}
            {hotkeyLabel(resolveHotkey('palette'))} ist der schnellste Weg.
          </Tip>
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
            die komplette Historie eines Kunden — Verträge, Tarifwechsel, Notizen und Anrufe auf
            einer Seite.
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
      title: 'Die Browser-Erweiterung',
      icon: <AppWindow size={18} />,
      content: (
        <>
          <p className="onboarding-body">
            Ein großer Teil der Arbeit passiert in Jira und in der Telefonie. Dort hilft dir eine
            eigene Erweiterung — du musst dafür nichts ins CRM tippen.
          </p>
          <div className="onboarding-benefit-list">
            <BenefitRow icon={<PhoneCall size={14} />} title="Anrufe werden mitgeschrieben">
              Dauer, Gesprächspartner und Ergebnis landen automatisch im CRM.
            </BenefitRow>
            <BenefitRow icon={<Search size={14} />} title="Netz-Auskunft">
              Verfügbarkeit und Baustatus direkt im Ticket nachschlagen.
            </BenefitRow>
            <BenefitRow icon={<Target size={14} />} title="Passendes Gesprächs-Skript">
              Leitfaden und Einwandkarten richten sich nach der Kampagne deiner heutigen Schicht.
            </BenefitRow>
          </div>
          <Tip>
            Aus einem Ticket springst du per Klick direkt in die richtige Kundenakte im CRM.
          </Tip>
        </>
      ),
    },
    {
      title: 'Berichte & Netto-Rechner',
      icon: <FileChartColumn size={18} />,
      target: '.sidebar-item-reports',
      goTo: { name: 'reports' },
      content: (
        <>
          <p className="onboarding-body">
            Unter <strong>Berichte</strong> wertest du jeden Zeitraum aus — nach Produkt,
            Kampagne, Gesprächsergebnis und Abschlussquote.
          </p>
          <p className="onboarding-body onboarding-body-tight">
            Der <strong>Netto-Rechner</strong> zeigt dir, was von deiner Provision am Monatsende
            tatsächlich ankommt.
          </p>
          <div className="onboarding-feature-grid onboarding-feature-grid-2">
            <FeatureChip icon={<FileText size={13} />} label="PDF-Bericht" />
            <FeatureChip icon={<Share2 size={13} />} label="SharePoint-Export" />
            <FeatureChip icon={<Calculator size={13} />} label="Netto-Rechner" />
            <FeatureChip icon={<PhoneCall size={13} />} label="Anruf-Auswertung" />
          </div>
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
    ...(isManager
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
          {
            title: 'Schichten & Kampagnen planen',
            icon: <CalendarDays size={18} />,
            target: '.sidebar-item-campaignmanager',
            goTo: { name: 'campaignmanager' } as Route,
            content: (
              <>
                <p className="onboarding-body">
                  In der <strong>Kampagnen-Verwaltung</strong> legst du fest, welche Aktionen
                  laufen und welchen Gesprächstyp sie haben. Genau dieser Typ steuert später das
                  Skript in der Browser-Erweiterung.
                </p>
                <p className="onboarding-body onboarding-body-tight">
                  Im <strong>Schichtplan</strong> ordnest du jeder Schicht eine Kampagne zu und
                  legst über <strong>Soll-Besetzung</strong> fest, wie viele Personen ein Wochentag
                  braucht — der Plan warnt dann bei Unterdeckung.
                </p>
                <Tip>
                  Über „Vorwoche übernehmen" ist ein Wochenplan in einem Klick erstellt und danach
                  nur noch anzupassen.
                </Tip>
              </>
            ),
          } satisfies StepDef,
        ]
      : []),
    {
      title: 'Einstellungen: mach es dir passend',
      icon: <SettingsIcon size={18} />,
      target: '.sidebar-item-settings',
      goTo: { name: 'settings' },
      content: (
        <>
          <p className="onboarding-body">
            In den <strong>Einstellungen</strong> passt du Provisionssätze pro Produkt und dein
            Monatsziel an. Diese Werte gelten nur für dich.
          </p>
          <p className="onboarding-body onboarding-body-tight">
            Dazu das Erscheinungsbild: hell oder dunkel, eigene Akzentfarbe, Widgets ein- und
            ausblenden — und alle Tastenkürzel frei belegbar.
          </p>
          <div className="onboarding-feature-grid onboarding-feature-grid-2">
            <FeatureChip icon={<Target size={13} />} label="Monatsziel" />
            <FeatureChip icon={<SettingsIcon size={13} />} label="Provisionssätze" />
            <FeatureChip icon={<Palette size={13} />} label="Farben & Themes" />
            <FeatureChip icon={<Keyboard size={13} />} label="Tastenkürzel" />
          </div>
          <Tip>Das Dashboard selbst kannst du über „Anpassen" frei anordnen.</Tip>
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
}
