# TNG Stadtnetz CRM

Ein mehrbenutzerfähiges Vertriebs-CRM im Apple-/macOS-Stil mit TNG-Stadtnetz-Branding.
Verträge, Tarifwechsel, Leads, Provisionen, Wiedervorlagen, Team-Steuerung und
Incentives an einem Ort – mit zentraler Cloud-Datenbank (Supabase) und Echtzeit-Sync
über alle Geräte und Kolleg:innen hinweg.

> Online-First Progressive Web App (PWA). Die Daten liegen zentral in Supabase, nicht
> mehr lokal im Browser. Dark Mode wird automatisch erkannt.

---

## Inhaltsverzeichnis

1. [Überblick](#überblick)
2. [Features](#features)
3. [Tech-Stack](#tech-stack)
4. [Architektur](#architektur)
5. [Schnellstart](#schnellstart)
6. [Supabase einrichten](#supabase-einrichten)
7. [Umgebungsvariablen](#umgebungsvariablen)
8. [NPM-Skripte](#npm-skripte)
9. [Projektstruktur](#projektstruktur)
10. [Datenmodell](#datenmodell)
11. [Rollen & Rechte](#rollen--rechte)
12. [Anmeldung (Name + PIN)](#anmeldung-name--pin)
13. [Provisionslogik](#provisionslogik)
14. [SharePoint-Excel-Export](#sharepoint-excel-export)
15. [Tastenkürzel](#tastenkürzel)
16. [PWA & Offline](#pwa--offline)
17. [Tests](#tests)
18. [Datenschutz (DSGVO)](#datenschutz-dsgvo)
19. [Sicherheit & bekannte Einschränkungen](#sicherheit--bekannte-einschränkungen)
20. [Deployment](#deployment)

---

## Überblick

Das CRM richtet sich an ein Vertriebsteam mit zwei Rollen:

- **Vertrieb (`agent`)** – erfasst Verträge, Tarifwechsel, Notizen und Leads, sieht
  das eigene Dashboard, das Team-Leaderboard und laufende Incentives.
- **Chef (`manager`)** – zusätzlich Team-Dashboard, Mitarbeiter-Detailansichten,
  Team-Verwaltung (Rollen/Ziele/Sperren), Incentive-Verwaltung und das Audit-Log.

Alle Daten werden zentral in einer Supabase-Postgres-Datenbank gespeichert und per
Realtime-Subscription live in alle offenen Sessions gespiegelt. Provisionen werden
automatisch nach einem konfigurierbaren Satzkatalog berechnet.

---

## Features

### Dashboard
- **Monatsziel-Ring** mit Prozent, Restbetrag, „pro Tag noch nötig" und Resttagen.
- **KPI-Kacheln**: Provision gesamt, aktive Verträge, Tarifwechsel, Trend vs. Vormonat.
- **Meine / Alle-Umschalter** – eigene Zahlen vs. Team-Ansicht.
- **Provision pro Monat** (6-Monats-Chart, gestapelt nach Neuvertrag/Tarifwechsel).
- **Wiedervorlage-Inbox** (überfällig / heute / Woche / später, mit Erledigt-Haken).
- **Auslauf-Radar** für Verträge, die in ≤ 90 Tagen enden.
- **Incentive-Widget**, **„Zuletzt erfasst"** und **Top-Produkte**.

### Leads (Vertriebs-Pipeline)
- **Kanban-Board**: Neu → In Bearbeitung → Gewonnen → Verloren.
- **Dringlichkeit** (normal / hoch / dringend) mit Hervorhebung und Sortierung.
- **Vertragsverlängerungs-Liste** aus dem Auslauf-Radar – per Klick zum Lead.
- **„Kontaktiert"-Button** und **Aktivitäts-Log / Team-Notizen** je Lead.
- **Wiedervorlage**, **Klick-zum-Anrufen**, **Chef-Kennzeichnung**,
  **Gewonnen → als Kunde anlegen**.

### Verträge
- Sortier- und durchsuchbare Tabelle mit Status-Filter, Storno-Zähler und Summe.
- **Bundle-Verträge** (mehrere Produkte) mit **automatischer Provisionsberechnung**.
- **Laufzeit** (12 / 24 Monate / unbefristet) inkl. errechnetem Vertragsende und Ampel.
- Erfassungsformular mit **Kunden-Typeahead**, **Dublettenwarnung** und
  **Live-Provisions-Vorschau** (inkl. Anteil am Monatsziel).
- **CSV-Export**.

### Tarifwechsel
- **Provisionsmatrix** nach Wechselart (Sidegrade/VVL · Upgrade) × MVLZ-Situation.
- **SharePoint-Excel-Export** (einzeln + Sammel) mit Export-Status je Eintrag.
- Suche, Sortierung, CSV-Export.

### Notizen
- Freie Notizkarten, optional verknüpft mit Kundennummer und Jira-Ticket.

### Kunden (360°-Ansicht)
- **Automatische Kundenakte**, aggregiert aus Verträgen, Tarifwechseln und Notizen.
- **Besitz & Teilen**: Owner, Freigaben, Besitz übertragen, verwaiste Kunden übernehmen.
- Tabs **Meine / Mit mir geteilt / Alle**, **Aktivitäts-Timeline**, Schnellaktionen.
- **Kunden-Schnellsuche** in der Kopfzeile (Tastatursteuerung).

### Leaderboard
- Monatliches Provisions-Ranking mit **Podium** für die Top 3.
- **Sichtbarkeits-Opt-in** – man bleibt für andere anonym, sieht sich selbst aber weiter.

### Incentives
- **Zielprämie** (jede:r, der das Ziel erreicht) oder **Wettbewerb** (nur Platz 1).
- Messgröße **Provision / Verträge / Abschlüsse**, Zeitraum **wöchentlich / monatlich**.
- Fortschrittsbalken, Sieger-Podest, Belohnungsanzeige; kompaktes Dashboard-Widget.

### Chef-Bereich (nur Manager)
- **Team-Dashboard**: Team-KPIs (Provision, Trend, Zielerreichung, Abschlüsse,
  Conversion-Rate, aktive Mitarbeitende), Top-Performer-Banner, Charts und eine
  klickbare Mitarbeiter-Tabelle.
- **Mitarbeiter-Detail**: Einzelkennzahlen, 6-Monats-Verlauf und alle Vorgänge.
- **Team-Verwaltung**: Rollen vergeben, Monatsziele setzen, Zugänge sperren/entsperren.
- **Incentive-Verwaltung**: Team-Ziele anlegen, aktivieren, bearbeiten, löschen.
- **Audit-Log** (DSGVO Art. 30): wer/wann/was, mit Filtern, Statistik, Live-Updates.

### Berichte (Druck / PDF)
- **Monatsbericht** (persönlich) und **Team-Bericht** (Chef) – druckoptimiert.

### Einstellungen
- Monatsziel, Leaderboard-Sichtbarkeit.
- **Provisionssätze pro Produkt** und **Tarifwechsel-Matrix** (teamweit, anpassbar).
- **SharePoint-Anbindung** und **JSON-Backup-Export**.

### Allgemein / Komfort
- **Command Palette (⌘K)** und **Schnell-erfassen-FAB** mit Tastenkürzeln.
- **Echtzeit-Sync** + optimistische Updates mit automatischem Rollback bei Fehlern.
- **Onboarding-Tour**, Toast-Meldungen, einheitlicher Bestätigungsdialog,
  Offline-Banner, App-weiter Error-Boundary.
- **PWA** (installierbar), **Dark Mode**, deutsche Lokalisierung, Code-Splitting.

---

## Tech-Stack

| Bereich | Technologie |
|---|---|
| UI | React 19 + TypeScript |
| Build / Dev-Server | Vite 8 + `@vitejs/plugin-react` |
| State | Zustand 5 (mehrere kleine Stores) |
| Backend / DB / Auth / Realtime | Supabase (`@supabase/supabase-js`) |
| Charts | Recharts 3 |
| Icons | lucide-react |
| SharePoint-Export | `@azure/msal-browser` + Microsoft Graph |
| PWA | `vite-plugin-pwa` (Workbox) |
| Tests | Vitest 3 |
| Linting | ESLint 10 + `typescript-eslint` |
| Styling | Eigenes CSS-Designsystem (`src/index.css`), Apple-inspiriert |

Recharts und MSAL werden per **Code-Splitting** erst bei Bedarf nachgeladen, damit
das Initial-Bundle (und der Login-Screen) klein bleiben.

---

## Architektur

```
Browser (React PWA)
  │
  ├─ Zustand-Stores
  │    ├─ useAuth      – Session, Profile, Rollen, Consent
  │    ├─ useStore     – Verträge, Tarifwechsel, Notizen, Leads, Incentives, Settings
  │    ├─ useToast     – globale Benachrichtigungen
  │    └─ useConfirm   – globaler Bestätigungsdialog
  │
  ├─ lib/supabaseApi  – typisierte CRUD-Funktionen (Row ⇄ Domain-Mapping)
  │
  └─ Supabase
       ├─ Auth (E-Mail/Passwort; intern Name+PIN, siehe unten)
       ├─ Postgres mit Row Level Security (RLS)
       └─ Realtime-Subscriptions → live-Reload pro Tabelle (debounced)
```

- **Datenfluss**: Komponenten lesen aus den Stores; Mutationen gehen über
  `supabaseApi` an Supabase, werden lokal optimistisch angewandt und bei Fehlern
  zurückgerollt (mit Toast-Hinweis).
- **Realtime**: `useStore.subscribeRealtime()` abonniert alle relevanten Tabellen
  und lädt betroffene Tabellen gebündelt neu, sobald sich etwas ändert.
- **Routing**: schlanker, state-basierter Router (`src/router.tsx`) ohne externe
  Library.
- **Audit**: `lib/audit.ts` schreibt fire-and-forget Einträge ins `audit_log`
  (blockiert nie den Nutzer-Flow).

---

## Schnellstart

Voraussetzung: **Node.js ≥ 20** (Vite 8).

```bash
# 1. Abhängigkeiten installieren
npm install

# 2. Supabase-Projekt einrichten (siehe nächster Abschnitt) und
#    URL + anon key bereithalten

# 3. Entwicklungsmodus mit Hot-Reload
npm run dev        # http://localhost:5173

# 4. Produktions-Build erzeugen und lokal ausliefern
npm run build
npm run preview    # http://localhost:4173
```

Beim allerersten Start ohne konfiguriertes Backend erscheint automatisch ein
**Einrichtungs-Screen**, über den Supabase-URL und anon key eingetragen werden
(alternativ über Umgebungsvariablen, siehe unten).

---

## Supabase einrichten

1. Unter [supabase.com/dashboard](https://supabase.com/dashboard) ein **neues Projekt**
   anlegen (EU-Region wählen).
2. Im **SQL Editor** die Datei [`db/schema.sql`](db/schema.sql) komplett ausführen.
   Sie legt alle Tabellen samt Row-Level-Security-Policies an.
   - Die einzelnen Schritte sind zusätzlich in [`db/migrations/`](db/migrations) als
     nummerierte Migrationen dokumentiert (001–010).
3. **Authentication → Providers → Email** öffnen und **„Confirm email" deaktivieren**
   (die App nutzt Namen statt echter E-Mails – siehe [Anmeldung](#anmeldung-name--pin)).
4. **Project Settings → API** → `Project URL` und `anon public` Key kopieren und
   entweder im Einrichtungs-Screen eintragen oder als Umgebungsvariablen setzen.

> Der erste registrierte Nutzer ist standardmäßig `agent`. Um den ersten **Chef**
> festzulegen, in Supabase in der Tabelle `users` das Feld `role` der betreffenden
> Person auf `manager` setzen. Danach lassen sich weitere Rollen bequem über die
> **Team-Verwaltung** in der App vergeben.

---

## Umgebungsvariablen

Optional statt des Einrichtungs-Screens – eine `.env`-Datei im Projektwurzelverzeichnis:

```bash
VITE_SUPABASE_URL=https://<projekt>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

- Beide Werte werden zur Build-Zeit ins Frontend eingebettet (`import.meta.env`).
- Der **anon key ist öffentlich** und darf im Client liegen – die Absicherung erfolgt
  vollständig über die **RLS-Policies** in der Datenbank.
- Ohne Env-Variablen liest die App eine im Einrichtungs-Screen gespeicherte Konfiguration
  aus dem `localStorage` (Schlüssel `crm-tng-supabase-config`).
- **Keine echten Secrets committen.** `.env` gehört in `.gitignore`.

---

## NPM-Skripte

| Skript | Beschreibung |
|---|---|
| `npm run dev` | Vite-Dev-Server mit Hot-Reload |
| `npm run build` | Typecheck (`tsc -b`) **und** Produktions-Build (`vite build`) |
| `npm run preview` | gebauten Stand lokal ausliefern |
| `npm run lint` | ESLint über das gesamte Projekt |
| `npm test` | Unit-Tests mit Vitest (`vitest run`) |

---

## Projektstruktur

```
crm-tng/
├─ db/
│  ├─ schema.sql              # vollständiges DB-Schema inkl. RLS
│  └─ migrations/             # 001–010, nummerierte Einzelschritte
├─ public/                    # Icons, Favicon, Manifest-Assets
├─ src/
│  ├─ App.tsx                 # App-Shell, Routing-Switch, Lazy-Loading der Seiten
│  ├─ main.tsx                # Einstiegspunkt + Error-Boundary
│  ├─ router.tsx              # state-basierter Router
│  ├─ index.css               # komplettes Designsystem
│  ├─ pages/                  # Seiten (Dashboard, Leads, Verträge, …)
│  ├─ components/             # UI-Komponenten (Formulare, Modal, Sidebar, Widgets …)
│  ├─ store/                  # Zustand-Stores (useStore, useAuth, useToast, useConfirm)
│  ├─ lib/                    # Logik & Anbindung
│  │  ├─ supabase.ts          # Client-Setup, Name→E-Mail / PIN→Passwort
│  │  ├─ supabaseApi.ts       # typisierte CRUD-Funktionen
│  │  ├─ utils.ts             # Provision, Datums-/Perioden-Mathematik, Formatierung
│  │  ├─ validation.ts        # Jira-/Dubletten-Prüfung
│  │  ├─ customerOwnership.ts # Besitz-/Freigabe-Logik
│  │  ├─ teamStats.ts         # Mitarbeiter-Kennzahlen
│  │  ├─ incentives.ts        # Incentive-Werte & Ranglisten
│  │  ├─ audit.ts             # Audit-Log-Schreiber
│  │  ├─ sharepointGraph.ts   # Microsoft-Graph-/Excel-Export
│  │  └─ pwaInstall.ts        # PWA-Installations-Prompt
│  └─ types/index.ts          # zentrale TypeScript-Typen
└─ vite.config.ts / vitest.config.ts / tsconfig.*.json
```

---

## Datenmodell

Zentrale Tabellen (Mapping siehe `src/lib/supabaseApi.ts`):

| Tabelle | Zweck |
|---|---|
| `users` | Profile: Anzeigename, Rolle (`agent`/`manager`), `is_active`, Consent, Onboarding |
| `contracts` | Verträge inkl. Produkte (Array), Status, Laufzeit, Wiedervorlage, `created_by` |
| `tariff_changes` | Tarifwechsel (Wechselart, MVLZ-Kontext, alt/neu, Export-Status) |
| `notes` | Freie Notizen, optional mit Kunde + Jira verknüpft |
| `customer_ownerships` | Besitzer + Freigabeliste je Kundennummer |
| `leads` | Vertriebs-Leads (Status, Priorität, Wiedervorlage, Thema) |
| `lead_activities` | Kontaktversuche und Team-Notizen je Lead |
| `incentives` | Team-Ziele/Wettbewerbe mit Belohnung |
| `user_settings` | persönliche Werte: Monatsziel, SharePoint-IDs |
| `shared_settings` | teamweite Werte: Provisionssätze + Tarifmatrix (Zeile `id = 1`) |
| `audit_log` | unveränderliche Aktivitätseinträge (Art. 30 DSGVO) |

Kunden sind **keine eigene Tabelle**, sondern werden zur Laufzeit aus Verträgen,
Tarifwechseln und Notizen über die **Kundennummer** aggregiert.

---

## Rollen & Rechte

- **`agent` (Vertrieb)** – eigene Vorgänge erfassen/bearbeiten, alle Team-Vorgänge
  lesen (geteiltes Werkzeug), Dashboard, Leaderboard, Incentives, Leads.
- **`manager` (Chef)** – zusätzlich Team-Dashboard, Mitarbeiter-Detail,
  Team-Verwaltung, Incentive-Verwaltung, Audit-Log und Kunden-Löschung (Art. 17).

Die Durchsetzung erfolgt **serverseitig über RLS-Policies** – die UI blendet
manager-only-Bereiche zusätzlich aus.

---

## Anmeldung (Name + PIN)

Die App nutzt einen vereinfachten Login mit **Name + 4-stelliger PIN**:

- Der Name wird zu einer technischen Pseudo-E-Mail (`name@crm.tng.local`) normalisiert.
- Aus Name + PIN wird ein deterministisches Supabase-Passwort abgeleitet
  (`tng-crm::name::pin`), da Supabase mindestens 6 Zeichen verlangt.
- Gesperrte Konten (`is_active = false`) werden serverseitig **fail-closed** abgewiesen.
- Beim ersten Login wird der **Datenschutzhinweis** angezeigt und anschließend die
  **Onboarding-Tour** gestartet.

> ⚠️ Eine 4-stellige PIN ist bewusst niedrigschwellig. Für den Produktivbetrieb mit
> echten Kundendaten siehe [Sicherheit & bekannte Einschränkungen](#sicherheit--bekannte-einschränkungen).

---

## Provisionslogik

Alle Sätze sind in den **Einstellungen** anpassbar (teamweit gespeichert in
`shared_settings`). Stornierte Verträge zählen nicht und ergeben 0 € Provision.

- **Verträge**: Summe der Provisionssätze aller enthaltenen Produkte (Bundle möglich).
  Produkte sind in drei Kategorien gruppiert (Privat / Business / Zusatz) mit
  individuell konfigurierbaren Sätzen.
- **Tarifwechsel**: Wert aus der Matrix nach Wechselart × MVLZ-Situation. Standardwerte:

  | | Restlaufzeit > 3 Mon. | Restlaufzeit < 3 Mon. | Außerhalb MVLZ |
  |---|---|---|---|
  | **Sidegrade / VVL** | 0 € | 5 € | 5 € |
  | **Upgrade** | 5 € | 7,50 € | 7,50 € |

---

## SharePoint-Excel-Export

Tarifwechsel können per Klick in eine SharePoint-Excel-Tabelle (Spalten B:I)
geschrieben werden. Einmalige Einrichtung im **Azure-Portal**:

1. **App-Registrierungen → Neue Registrierung**, Plattform **Single-Page Application**.
2. **Redirect-URI** = Origin der App (z. B. `https://<deine-domain>`); im Dev `http://localhost:5173`.
3. **API-Berechtigung**: `Files.ReadWrite` (delegiert).
4. In den **Einstellungen** der App `Client ID`, `Tenant ID`, Dateipfad und Tabellenblatt
   eintragen → „Verbindung testen & anmelden".

Anschließend genügt in der Tarifwechsel-Liste ein Klick (einzeln oder als Sammel-Export).

---

## Tastenkürzel

| Kürzel | Aktion |
|---|---|
| `⌘/Strg + K` | Command Palette (Suche & Navigation) |
| `⌘/Strg + N` | Neuer Vertrag |
| `⌘/Strg + T` | Neuer Tarifwechsel |
| `⌘/Strg + ⇧ + N` | Neue Notiz |
| `Esc` | Dialog / Palette schließen |

---

## PWA & Offline

- Über `vite-plugin-pwa` installierbar (Sidebar-Button „App installieren" bzw. der
  Browser-Installationsdialog).
- **Online-First**: Es wird nur die App-Shell gecacht; Daten kommen live aus Supabase.
  Bei fehlender Verbindung erscheint ein Offline-Banner.

---

## Tests

Unit-Tests decken die reine Logik ab (keine DB/Netz nötig):

```bash
npm test
```

Abgedeckt sind u. a. Provisionsberechnung, Datums-/Perioden-Mathematik
(Vertragsende, Auslauf-Ampel, Wiedervorlage-Buckets), Jira-/Dubletten-Validierung,
Mitarbeiter-Kennzahlen und Incentive-Ranglisten (inkl. Storno-Ausschluss).
Testdateien (`src/**/*.test.ts`) sind vom Produktions-Build ausgenommen.

---

## Datenschutz (DSGVO)

Eingebaute Bausteine:

- **Datenschutzhinweis (Art. 13)** beim ersten Login (Kenntnisnahme).
- **Audit-Log (Art. 30)** – nachvollziehbar, nur für Chef-Accounts sichtbar.
- **Recht auf Löschung (Art. 17)** – vollständige Kunden-Löschung über die
  Kunden-Detailseite (Manager), protokolliert im Audit-Log.
- Datenhaltung in der **EU-Region** von Supabase.

---

## Sicherheit & bekannte Einschränkungen

Vor einem echten Produktivbetrieb mit Kundendaten beachten:

- **Login härten**: Die 4-stellige PIN ist niedrigschwellig und das abgeleitete
  Passwort deterministisch. Empfehlung: längere PIN/Passwort, Rate-Limiting, ggf. SSO/2FA.
- **RLS-Policies prüfen**: Da der anon key öffentlich ist, hängt der gesamte Schutz an
  korrekten Row-Level-Security-Regeln. Vor Rollout sorgfältig auditieren.
- **Datenminimierung**: Standardmäßig sehen alle Vertriebler alle Vorgänge, und der
  JSON-Backup-Export gibt die gesamte Datenbank aus – bei Bedarf einschränken.
- **Organisatorisch**: Auftragsverarbeitungsvertrag (Art. 28) mit Supabase, Drittland-
  Bewertung, dokumentierte Rechtsgrundlage (Art. 6) und ggf. eine DSFA sind durch die/den
  Datenschutzbeauftragte:n zu klären. Diese README ersetzt keine Rechtsberatung.

---

## Deployment

`npm run build` erzeugt einen statischen Build in `dist/`, der auf jedem
Static-Hosting (z. B. Vercel, Netlify, Cloudflare Pages, eigener Webserver)
ausgeliefert werden kann.

- Umgebungsvariablen `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` beim Build setzen
  (oder Nutzer konfigurieren das Backend beim ersten Start).
- Für die PWA und MSAL-Redirects ist **HTTPS** erforderlich; die Azure-Redirect-URI muss
  exakt der ausgelieferten Origin entsprechen.
- Single-Page-App: alle Routen auf `index.html` zurückfallen lassen.
