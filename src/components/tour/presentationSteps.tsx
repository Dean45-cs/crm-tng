import {
  Rocket,
  LayoutDashboard,
  CalendarDays,
  PhoneCall,
  Megaphone,
  Users,
  Plus,
  Inbox,
  AppWindow,
  MonitorSmartphone,
  Gauge,
  BarChart3,
  FileChartColumn,
  UsersRound,
  ShieldCheck,
  Trophy,
  Palette,
  Flag,
  Boxes,
  Clock,
  Search,
  Target,
} from 'lucide-react';
import {
  BenefitRow,
  BeforeAfter,
  FeatureChip,
  StatRow,
  Tip,
  TodoRow,
  type Chapter,
  type StepDef,
} from './parts';

/**
 * Drehbuch „Präsentation" — 20 Stationen in 6 Kapiteln, ausgelegt auf 15–20
 * Minuten live moderiert.
 *
 * Anders als die Einarbeitungstour erklärt dieses Drehbuch nicht, wo man
 * klickt, sondern was die Sache leistet und was sie ersetzt. Der Weg ist
 * bewusst der Arbeitstag: erst was das Team davon hat, dann die Technik
 * dahinter, dann die Führungssicht, und zum Schluss ein ehrlicher Stand mit
 * offenen Punkten. Ein Ausblick, der nur Erfolge zeigt, wirkt in einer
 * Entscheidungsrunde unglaubwürdig — die offenen Punkte sind das, was die
 * Frage „was braucht ihr dafür?" überhaupt auslöst.
 *
 * Die Zahlen im Schlusskapitel sind aus dem Projekt gezählt, nicht geschätzt.
 * Wenn sie veralten, gehören sie hier aktualisiert — eine falsche Zahl vor der
 * Geschäftsführung ist schlimmer als gar keine.
 */

// Kurze Titel: die Leiste soll auch auf einem Beamer-Bildschirm ohne Scrollen
// vollständig lesbar sein — abgeschnittene Kapitel helfen beim Moderieren nicht.
export const PRESENTATION_CHAPTERS: Chapter[] = [
  { title: 'Ausgangslage', minutes: 1 },
  { title: 'Arbeitstag', minutes: 6 },
  { title: 'Technik', minutes: 4 },
  { title: 'Führung', minutes: 4 },
  { title: 'Motivation', minutes: 2 },
  { title: 'Ausblick', minutes: 3 },
];

export function presentationSteps(): StepDef[] {
  return [
    // ── Kapitel 0 · Ausgangslage ────────────────────────────────────────────
    {
      chapter: 0,
      title: 'Wo wir herkommen',
      icon: <Flag size={18} />,
      content: (
        <>
          <p className="onboarding-body">
            Bevor ich etwas zeige: Das hier ist kein Werkzeug, das ein Problem sucht. Es ist die
            Antwort auf die Frage, wo unsere Arbeit heute eigentlich liegt.
          </p>
          <BeforeAfter
            before={
              <>
                Verträge in Excel, Tarifwechsel in einer zweiten Liste, Schichten auf Papier,
                Provision einmal im Monat von Hand nachgerechnet. Jede Zahl, die jemand oben
                braucht, muss unten zusammengesucht werden.
              </>
            }
            after={
              <>
                Ein Ort für alles. Jede Erfassung zählt sofort in Ziel, Rangliste und Auswertung —
                ohne dass jemand etwas zuliefert.
              </>
            }
          />
          <Tip>
            Alles, was jetzt kommt, läuft live auf echten Daten. Nichts davon ist ein Mockup.
          </Tip>
        </>
      ),
    },

    // ── Kapitel 1 · Ein Arbeitstag im Team ──────────────────────────────────
    {
      chapter: 1,
      title: 'Der Start in den Tag',
      icon: <LayoutDashboard size={18} />,
      target: '.dash-header',
      goTo: { name: 'dashboard' },
      content: (
        <>
          <p className="onboarding-body">
            Wer sich morgens anmeldet, sieht sofort das Wesentliche: den eigenen Stand zum
            Monatsziel, die Provision, die laufende Schicht und was heute noch offen ist.
          </p>
          <p className="onboarding-body onboarding-body-tight">
            Der Ring füllt sich mit jedem Abschluss. Kein Mitarbeiter muss mehr fragen, wo er
            steht — und keine Führungskraft muss es ausrechnen.
          </p>
          <Tip>
            Mit dem <strong>Meine / Alle</strong>-Schalter wechselt dieselbe Seite zwischen
            persönlicher und Teamsicht.
          </Tip>
        </>
      ),
    },
    {
      chapter: 1,
      title: 'Meine Schicht — mit Restzeit',
      icon: <Clock size={18} />,
      target: '.my-shift-widget',
      goTo: { name: 'dashboard' },
      content: (
        <>
          <p className="onboarding-body">
            Die laufende Schicht mit Fortschritt und Restzeit. An einem freien Tag steht hier
            stattdessen, wann es wieder losgeht.
          </p>
          <p className="onboarding-body onboarding-body-tight">
            Klingt nach Kleinigkeit — ist aber die Stelle, an der Schichtplan, Kampagne und
            Arbeitszeit zusammenlaufen. Dieselbe Quelle speist gleich auch das Cockpit im Browser.
          </p>
        </>
      ),
    },
    {
      chapter: 1,
      title: 'Der Schichtplan',
      icon: <CalendarDays size={18} />,
      target: '.schedule-board',
      goTo: { name: 'schedule' },
      content: (
        <>
          <p className="onboarding-body">
            Die ganze Woche auf einen Blick, für alle sichtbar, in Echtzeit. Eingeteilt wird per
            Werkzeug und Ziehen — ganze Zeilen und Spalten auf einen Griff, jede Aktion
            rückgängig zu machen.
          </p>
          <div className="onboarding-feature-grid onboarding-feature-grid-2">
            <FeatureChip icon={<Clock size={13} />} label="Feste Schichtzeiten" />
            <FeatureChip icon={<CalendarDays size={13} />} label="Urlaub · Krank · Schulung" />
            <FeatureChip icon={<Megaphone size={13} />} label="Kampagne je Schicht" />
            <FeatureChip icon={<Gauge size={13} />} label="Besetzung je Tag" />
          </div>
          <Tip>
            Der Balken unten zeigt die Besetzung über den Tagesverlauf — und warnt, wenn ein Tag
            unter der Soll-Besetzung liegt.
          </Tip>
        </>
      ),
    },
    {
      chapter: 1,
      title: 'Tauschen, ohne dass der Plan entgleitet',
      icon: <Users size={18} />,
      target: '.schedule-header-actions',
      goTo: { name: 'schedule' },
      content: (
        <>
          <p className="onboarding-body">
            Schichttausch läuft im Team an, aber der Plan bleibt Chefsache: A fragt B, B stimmt
            zu — und erst die Bestätigung durch die Führungskraft verschiebt tatsächlich etwas.
          </p>
          <p className="onboarding-body onboarding-body-tight">
            Solange eine Anfrage läuft, ist die Zelle markiert. Damit verplant niemand eine
            Schicht, über die zwei Leute gerade verhandeln.
          </p>
          <Tip>
            Der Tausch selbst passiert in der Datenbank in einem Zug — er kann nicht auf halbem
            Weg stecken bleiben.
          </Tip>
        </>
      ),
    },
    {
      chapter: 1,
      title: 'Was die Schicht gebracht hat',
      icon: <Target size={18} />,
      target: '.schedule-board',
      goTo: { name: 'schedule' },
      content: (
        <>
          <p className="onboarding-body">
            Und jetzt der Punkt, auf den es mir ankommt: In den Zellen stehen nicht nur
            Einteilungen, sondern <strong>Anrufe und Abschlüsse dieses Tages</strong>.
          </p>
          <p className="onboarding-body onboarding-body-tight">
            Der Plan weiß, wer wann gearbeitet hat. Die Anrufe wissen, was dabei herauskam.
            Verbunden ergibt das die Frage, die man sonst nie beantworten kann: Welche Besetzung
            bringt eigentlich was?
          </p>
          <Tip>
            Der Schichtplan ist damit keine Seite von vielen, sondern die Achse, an der Auswertung
            und Steuerung hängen.
          </Tip>
        </>
      ),
    },
    {
      chapter: 1,
      title: 'Kunde finden — in Sekunden',
      icon: <Search size={18} />,
      target: '.header-search-wrap',
      goTo: { name: 'customers' },
      content: (
        <>
          <p className="onboarding-body">
            Kundennummer oder Name tippen, und die komplette Historie steht da: Verträge,
            Tarifwechsel, Notizen, Anrufe — auf einer Seite.
          </p>
          <p className="onboarding-body onboarding-body-tight">
            Über <kbd className="onboarding-inline-kbd">⌘</kbd>
            <kbd className="onboarding-inline-kbd">K</kbd> geht dasselbe von jeder Stelle der
            Anwendung aus, ohne Mausweg.
          </p>
          <BeforeAfter
            before={<>Drei Systeme durchsuchen, Kollegen fragen, im Zweifel neu anlegen.</>}
            after={<>Ein Suchfeld, eine Akte, vollständige Historie.</>}
          />
        </>
      ),
    },
    {
      chapter: 1,
      title: 'Erfassen, während der Kunde noch dran ist',
      icon: <Plus size={18} />,
      target: '.fab',
      goTo: { name: 'dashboard' },
      content: (
        <>
          <p className="onboarding-body">
            Vertrag, Tarifwechsel, Lead oder Notiz — immer erreichbar, aus dem Kundenprofil heraus
            schon vorausgefüllt. Die Provision rechnet sich dabei selbst aus.
          </p>
          <p className="onboarding-body onboarding-body-tight">
            Das ist der Unterschied zwischen „wird später nachgetragen" und „ist erfasst".
          </p>
          <Tip>
            Provisionssätze pflegt jede:r selbst — und dieselbe Rechenlogik nutzt auch die
            Browser-Erweiterung, damit nie zwei Zahlen im Umlauf sind.
          </Tip>
        </>
      ),
    },
    {
      chapter: 1,
      title: 'Nichts geht verloren',
      icon: <Inbox size={18} />,
      target: '.followup-inbox',
      goTo: { name: 'dashboard' },
      content: (
        <>
          <p className="onboarding-body">
            Wiedervorlagen landen automatisch in einer Inbox — überfällige rot, heute fällige
            orange. Dazu ein persönliches Postfach für alles, was mich betrifft:
            Planänderungen, Tauschanfragen, geteilte Kunden.
          </p>
          <Tip>
            Kein „das habe ich vergessen" mehr — und kein Rundmail-Verteiler für Dinge, die nur
            eine Person angehen.
          </Tip>
        </>
      ),
    },

    // ── Kapitel 2 · Die Technik dahinter ────────────────────────────────────
    {
      chapter: 2,
      title: 'Das Cockpit im Browser',
      icon: <AppWindow size={18} />,
      content: (
        <>
          <p className="onboarding-body">
            Jetzt verlassen wir kurz das CRM. Wir arbeiten den ganzen Tag in Jira und in der
            Telefonie — und genau dort sitzt eine eigene Erweiterung, die mitdenkt.
          </p>
          <div className="onboarding-benefit-list">
            <BenefitRow icon={<PhoneCall size={14} />} title="Anrufe erfassen sich selbst">
              Wer anruft, mit wem, wie lange, mit welchem Ergebnis — ohne dass jemand etwas
              tippt.
            </BenefitRow>
            <BenefitRow icon={<Megaphone size={14} />} title="Das Skript passt sich an">
              Die Erweiterung liest die Kampagne aus meiner heutigen Schicht und schaltet
              Gesprächsleitfaden und Einwandkarten automatisch um.
            </BenefitRow>
            <BenefitRow icon={<Search size={14} />} title="Netz-Auskunft direkt daneben">
              Verfügbarkeit und Baustatus, ohne das Ticket zu verlassen.
            </BenefitRow>
          </div>
          <Tip>Das ist der Teil, den ich gleich live zeige.</Tip>
        </>
      ),
    },
    {
      chapter: 2,
      title: 'Ein Klick — und die Akte ist offen',
      icon: <MonitorSmartphone size={18} />,
      content: (
        <>
          <p className="onboarding-body">
            Aus dem Ticket heraus springt man direkt in die richtige Kundenakte im CRM. Kein
            Kopieren von Kundennummern, kein Suchen, kein falscher Kunde.
          </p>
          <p className="onboarding-body onboarding-body-tight">
            Dazu ein Overlay auf dem Desktop, das immer im Blick bleibt: laufende Schicht,
            Restzeit, aktueller Anruf — ohne Fenster zu wechseln.
          </p>
          <Tip>
            Schichtzeiten stehen an genau einer Stelle im Code. CRM und Cockpit können deshalb
            gar nicht unterschiedliche Feierabende anzeigen.
          </Tip>
        </>
      ),
    },
    {
      chapter: 2,
      title: 'Echtzeit, Offline, überall',
      icon: <Gauge size={18} />,
      content: (
        <>
          <div className="onboarding-benefit-list">
            <BenefitRow icon={<Gauge size={14} />} title="Alles live">
              Trägt jemand etwas ein, sehen es alle sofort — ohne Neuladen. Das gilt für
              Verträge, Schichten, Status und Meldungen.
            </BenefitRow>
            <BenefitRow icon={<MonitorSmartphone size={14} />} title="PC, Tablet, Handy">
              Installierbar wie eine App, funktioniert auch bei schlechter Verbindung weiter.
            </BenefitRow>
            <BenefitRow icon={<Boxes size={14} />} title="Angebunden statt danebengestellt">
              Jira-Tickets verlinkt, Export nach SharePoint, Anrufe aus der Telefonanlage.
            </BenefitRow>
          </div>
        </>
      ),
    },

    // ── Kapitel 3 · Führungssicht ───────────────────────────────────────────
    {
      chapter: 3,
      title: 'Das Team auf einen Blick',
      icon: <BarChart3 size={18} />,
      target: '.sidebar-item-teamdashboard',
      goTo: { name: 'teamdashboard' },
      content: (
        <>
          <p className="onboarding-body">
            Umsatz, Abschlüsse und Zielerreichung pro Person — in Echtzeit, ohne dass jemand
            Zahlen zuliefert. Ein Klick auf eine Person öffnet ihr vollständiges Bild.
          </p>
          <BeforeAfter
            before={<>Monatlich Zahlen einsammeln, zusammenkopieren, auf Stand bringen.</>}
            after={<>Die Zahlen sind immer aktuell, weil sie beim Arbeiten entstehen.</>}
          />
        </>
      ),
    },
    {
      chapter: 3,
      title: 'Auswertungen für jeden Zeitraum',
      icon: <FileChartColumn size={18} />,
      target: '.sidebar-item-reports',
      goTo: { name: 'reports' },
      content: (
        <>
          <p className="onboarding-body">
            Frei wählbarer Zeitraum, aufgeschlüsselt nach Produkt, Kampagne, Gesprächsergebnis und
            Person. Abschlussquote vom Anruf bis zum Vertrag inklusive.
          </p>
          <p className="onboarding-body onboarding-body-tight">
            Als PDF-Monatsbericht oder als Export nach SharePoint — für alles, was das Haus
            ohnehin in Excel weiterverarbeitet.
          </p>
        </>
      ),
    },
    {
      chapter: 3,
      title: 'Konten, Rollen, Zugriff',
      icon: <UsersRound size={18} />,
      target: '.sidebar-item-teammanager',
      goTo: { name: 'teammanager' },
      content: (
        <>
          <p className="onboarding-body">
            Konten anlegen, Ziele vergeben, Zugänge sperren. Wer welche Kunden sehen darf, ist
            geregelt — und wer Zugriff braucht, stellt eine Anfrage, statt sich zu behelfen.
          </p>
          <Tip>
            Die Rechte hängen nicht an der Oberfläche, sondern an der Datenbank. Ein gesperrtes
            Konto kommt auch dann nicht an Daten, wenn jemand am Programm vorbei fragt.
          </Tip>
        </>
      ),
    },
    {
      chapter: 3,
      title: 'DSGVO ist kein Anhang',
      icon: <ShieldCheck size={18} />,
      target: '.sidebar-item-auditlog',
      goTo: { name: 'auditlog' },
      content: (
        <>
          <p className="onboarding-body">
            Jede Änderung ist protokolliert: wer, was, wann. Die Einwilligung jedes Nutzers ist
            dokumentiert, Kundendaten lassen sich auf Verlangen vollständig löschen.
          </p>
          <p className="onboarding-body onboarding-body-tight">
            Das war von Anfang an eingebaut und nicht nachträglich drübergelegt — bei
            personenbezogenen Daten in dieser Menge ist das der Unterschied zwischen einsatzfähig
            und Risiko.
          </p>
        </>
      ),
    },

    // ── Kapitel 4 · Motivation & Anpassbarkeit ──────────────────────────────
    {
      chapter: 4,
      title: 'Erfolge sichtbar machen',
      icon: <Trophy size={18} />,
      target: '.sidebar-item-leaderboard',
      goTo: { name: 'leaderboard' },
      content: (
        <>
          <p className="onboarding-body">
            Monatsrangliste mit Podium, dazu ausgelobte Aktionen mit automatischer Zählung — etwa
            „meiste Glasfaser-Abschlüsse im März".
          </p>
          <Tip>
            Ob jemand in der Rangliste auftaucht, entscheidet er selbst. Ein Ansporn, der sich
            nicht abschalten lässt, ist Druck — und der funktioniert selten lange.
          </Tip>
        </>
      ),
    },
    {
      chapter: 4,
      title: 'Jede:r richtet es sich ein',
      icon: <Palette size={18} />,
      target: '.sidebar-item-settings',
      goTo: { name: 'settings' },
      content: (
        <>
          <p className="onboarding-body">
            Farben und Themes, Widgets ein- und ausblenden, Dashboard frei anordnen, alle
            Tastenkürzel selbst belegen. Bis hin zum Netto-Rechner, der aus der Provision zeigt,
            was am Monatsende ankommt.
          </p>
          <Tip>
            Klingt nach Beiwerk. Ist es nicht: Werkzeuge, die man sich einrichten kann, werden
            benutzt — und ein Rollout scheitert selten an Funktionen, sondern an Akzeptanz.
          </Tip>
        </>
      ),
    },

    // ── Kapitel 5 · Stand & Ausblick ────────────────────────────────────────
    {
      chapter: 5,
      title: 'Wo das Projekt heute steht',
      icon: <Rocket size={18} />,
      content: (
        <>
          <p className="onboarding-body">
            Kein Prototyp und keine Bastelei — sondern eine Anwendung, die man am Montag
            ausrollen könnte.
          </p>
          <StatRow
            items={[
              { value: '22', label: 'Bereiche' },
              { value: '24', label: 'DB-Migrationen' },
              { value: '265+', label: 'automatische Tests' },
              { value: '~42.000', label: 'Zeilen Code' },
            ]}
          />
          <p className="onboarding-body onboarding-body-tight">
            Die Tests laufen bei jeder Änderung mit — deshalb kann ich weiterbauen, ohne dass
            Bestehendes still kaputtgeht.
          </p>
        </>
      ),
    },
    {
      chapter: 5,
      title: 'Was ich als Nächstes brauche',
      icon: <Flag size={18} />,
      content: (
        <>
          <p className="onboarding-body">
            Offen und ehrlich — das sind die Punkte, an denen es ohne Entscheidung nicht
            weitergeht:
          </p>
          <div className="onboarding-benefit-list">
            <TodoRow title="Echte Nutzer statt Testkonten">
              Für einen Rollout braucht es angelegte Konten, saubere Stammdaten und eine kurze
              Einweisung — die geführte Tour dafür ist eingebaut.
            </TodoRow>
            <TodoRow title="Die Erweiterung im Team verteilen">
              Sie läuft, muss aber paketiert und auf den Arbeitsplätzen installiert werden.
            </TodoRow>
            <TodoRow title="Zeit zum Weiterbauen">
              Abwesenheitsanträge, Auswertung nach Schicht, mobile Ansicht für unterwegs — alles
              angelegt, nichts davon macht sich von allein.
            </TodoRow>
          </div>
          <Tip>
            Meine Bitte: einen Testlauf mit einem kleinen Team und feste Zeit dafür im Kalender.
          </Tip>
        </>
      ),
    },
  ];
}
