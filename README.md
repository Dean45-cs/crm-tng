# TNG Stadtnetz CRM

Ein CRM im Apple-/macOS-Stil mit TNG-Stadtnetz-Branding für den Vertriebsalltag.
Verträge, Tarifwechsel, Provisionen, Leads und Team-Auswertungen — als
installierbare PWA, mit gemeinsamem Supabase-Backend und Live-Sync.

## Features

- **Dashboard** mit Provisions-Übersicht, Monatsziel-Fortschritt, Charts
  (Provision pro Monat, Produktverteilung) und Aktivitäts-Feed.
- **Verträge** mit Kundennummer, Produkt(en), Status (Offen / Aktiv / Storniert),
  Laufzeit (12/24 Monate), Jira-Vorgang, Wiedervorlage-Datum und Notizen.
- **Tarifwechsel** (Upgrade / Sidegrade / VVL) mit Kontext und Jira-Referenz.
- **Auslauf-Radar** für Verträge, deren Laufzeit endet.
- **Leads** mit 4-Stufen-Pipeline, Dringlichkeit und Aktivitäts-Log.
- **Notizen** als freie Karten, optional verknüpft mit Kunde + Jira-Ticket.
- **Provisionsberechnung** automatisch pro Produkt — konfigurierbare Sätze.
- **Chef-Modus:** Team-Dashboard, Mitarbeiter-Detail, Monats-/Team-Berichte,
  Incentives (Team-Ziele & Wettbewerbe) und Team-Verwaltung.
- **DSGVO:** unveränderliches Audit-Log, Kunden-Löschung, Datenschutzhinweis.
- **CSV-Export** und optionaler **SharePoint-Export** (Microsoft Graph / MSAL).
- **Online-First** mit Supabase Realtime — alle sehen dieselben Daten live.
  Installierbar als App (PWA), Dark Mode wird automatisch erkannt.

## Tech-Stack

- React 19 + TypeScript + Vite 8
- Supabase (Postgres, Auth, Realtime, Row Level Security) als Backend
- Zustand (State-Management)
- Recharts (Charts), Lucide (Icons)
- `@azure/msal-browser` für den optionalen SharePoint-Export
- vite-plugin-pwa (Service Worker, installierbar)
- Vitest (Unit-Tests)

## Voraussetzungen

- **Node.js >= 18**
- Ein **Supabase-Projekt** — Einrichtung Schritt für Schritt in
  [`db/README.md`](./db/README.md) (Schema einspielen, Migrationen, Email-
  Bestätigung deaktivieren, Keys holen).

## Lokal starten

```bash
npm install

# Entwicklungsmodus (Hot Reload) → http://localhost:5173
npm run dev

# Tests
npm test

# Lint
npm run lint

# Produktions-Build erzeugen und lokal ausliefern → http://localhost:4173
npm run build
npm run preview
```

## Konfiguration (Supabase)

Die App braucht die Zugangsdaten des Supabase-Projekts. Zwei Wege:

1. **`.env`-Datei** (empfohlen für Entwicklung): `.env.example` nach `.env`
   kopieren und die Werte eintragen:

   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon-public-key>
   ```

2. **Setup-Screen in der App**: Ohne `.env` fragt die App die Werte beim ersten
   Start ab und speichert sie lokal im Browser.

> Der **Anon-/Public-Key** ist für den Browser bestimmt und kein Geheimnis,
> solange Row Level Security aktiv ist (siehe `db/schema.sql`). Der
> **service_role-Key** gehört niemals ins Frontend oder ins Repo. `.env` ist
> in `.gitignore` und wird nicht eingecheckt.

## Anmeldung & Rollen

- Anmeldung mit **Name + 4-stelliger PIN** (synthetische Email pro Name,
  verwaltet über Supabase Auth). Nach mehreren Fehlversuchen greift eine
  eskalierende Login-Sperre.
- Zwei Rollen: **agent** (Vertrieb) und **manager** (Chef-Bereich).
- **Konten legt nur der Chef an** (Team-Verwaltung → „Neues Konto"). Eine
  Selbst-Registrierung gibt es nicht — Ausnahme: das allererste Konto einer
  frischen Installation richtet sich beim ersten Start selbst ein und wird
  automatisch zum ersten Chef. Details in `db/README.md`.

## Tests

Reine Logik-Tests (Provisions-, Datums-, Incentive- und Team-Berechnungen,
Login-Throttle, Validierung) liegen als `*.test.ts` neben den Quelldateien:

```bash
npm test          # einmalig
npm run test:watch
```
