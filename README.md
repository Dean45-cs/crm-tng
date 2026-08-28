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
- **Outbound** — Anruflisten aus Excel/CSV importieren und abtelefonieren:
  Fokusmodus für einen Kontakt nach dem anderen oder filterbare Liste,
  Ergebnis je Gespräch, Wiedervorlagen und Termine. Kampagnen tragen eigene
  **Prämien** je Termin und je Abschluss.
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

## Outbound-Modus

Eine Kampagne sagt bisher, *welche* Art Gespräch geführt wird (`call_type`
steuert Skript und Einwandkarten in der Extension) und *wer* sie fährt
(Schichtplan). Der Outbound-Modus ergänzt, *wen* man anruft.

**Chef:** *Kampagnen-Verwaltung* → Kampagne anlegen oder bearbeiten (Abschnitt
„Anrufliste": Prämie je Termin und je Abschluss, Versuche je Kontakt,
Zielprodukt, Zeitraum) → „Liste importieren".

Der Import liest **.xlsx** und **.csv**; alternativ lassen sich Zeilen direkt
aus Excel kopieren und einfügen. Die Spalten werden anhand der Kopfzeile
automatisch zugeordnet (Name bzw. Vorname+Nachname, Telefon, KdNr., Straße,
PLZ, Ort, E-Mail, Info) und lassen sich vor dem Import korrigieren. Dubletten
werden über eine normalisierte Telefonnummer erkannt — dieselbe Liste ein
zweites Mal zu importieren legt nichts doppelt an.

> Der .xlsx-Leser ist Teil des Projekts (`src/lib/xlsx.ts`) und kommt ohne
> Fremd-Bibliothek aus; er nutzt die native `DecompressionStream`-API. Das alte
> `.xls`-Format wird nicht gelesen — in Excel als .xlsx oder CSV speichern.

**Vertrieb:** *Outbound* → Kampagne wählen. Angeboten werden nur aktive
Kampagnen, zu denen eine Liste importiert wurde. **Fokus** arbeitet sie
priorisiert ab (fällige Termine, dann Wiedervorlagen, dann unangefasste
Kontakte, dann erneute Versuche), **Liste** erlaubt Suche, Filter und das
Übernehmen einzelner Kontakte aus dem freien Pool.

Je Gespräch wird ein Ergebnis erfasst: Termin, Abschluss, Wiedervorlage, nicht
erreicht, kein Interesse, falsche Daten oder Werbewiderspruch. Termine und
Wiedervorlagen verschwinden bis zum Stichtag aus der Arbeitsliste und tauchen
dann automatisch wieder auf. Nach der in der Kampagne eingestellten Zahl
erfolgloser Versuche fällt ein Kontakt heraus. Ein Abschluss öffnet direkt das
Vertragsformular, vorbelegt mit Kunde und Zielprodukt.

Jedes Gespräch wird zusätzlich als Anruf in derselben `calls`-Tabelle
protokolliert, die auch die Extension befüllt (`direction: outbound`) — damit
zählt Outbound in Anrufvolumen, Dispositions-Auswertung und Reports mit,
statt in einem zweiten Silo zu liegen.

**Prämien:** Je Kontakt zählt immer nur das *aktuelle* Ergebnis — aus einem
Termin, der später zum Abschluss wird, entsteht keine doppelte Prämie. Die
Prämie geht an die Person, die das Ergebnis gesetzt hat, und fließt zusätzlich
zur normalen Vertragsprovision über `agentStats()` in Dashboard, Leaderboard,
Team-Dashboard und Team-Bericht ein. Die separat konfigurierten **Incentives**
bleiben bewusst unberührt und zählen weiterhin nur Verträge und Tarifwechsel.

## Tests

Reine Logik-Tests (Provisions-, Datums-, Incentive- und Team-Berechnungen,
Login-Throttle, Validierung) liegen als `*.test.ts` neben den Quelldateien:

```bash
npm test          # einmalig
npm run test:watch
```
