# TNG Stadtnetz CRM

Ein minimales, lokal laufendes CRM im Apple-/macOS-Stil mit TNG Stadtnetz Branding.
Gebaut für die Ausbildung bei der TNG.

## Features

- **Dashboard** mit Provisions-Übersicht, Monatsziel-Fortschritt, Charts (Provision pro Monat, Produktverteilung) und Aktivitäts-Feed.
- **Verträge** mit Kundennummer, Produkt, Monatspreis, Status (Offen / Aktiv / Storniert), Jira-Vorgang, Wiedervorlage-Datum und Notizen.
- **Tarifwechsel** mit altem/neuem Tarif, Preisdifferenz, Jira-Referenz.
- **Notizen** als freie Karten, optional verknüpft mit Kunde + Jira-Ticket.
- **Provisionsberechnung** automatisch pro Produkt – konfigurierbare Sätze in den Einstellungen.
- **Monatsziel** mit Fortschrittsanzeige.
- **CSV-Export** für Verträge / Tarifwechsel und **JSON-Backup** / Import.
- Alle Daten werden lokal im Browser gespeichert (LocalStorage).
- Dark Mode wird automatisch erkannt (macOS Systemeinstellung).

## Auf dem Mac starten

Voraussetzung: **Node.js** (>= 18). Falls noch nicht installiert: `brew install node`.

```bash
# einmalig
npm install

# Entwicklungsmodus (Hot Reload)
npm run dev

# oder: optimierten Build erzeugen und ausliefern
npm run build
npm run preview
```

Dann öffnet sich die App im Browser unter `http://localhost:5173` (dev) bzw. `http://localhost:4173` (preview).

### Als App auf dem Dock (optional)

In Safari → "Datei" → "Zum Dock hinzufügen" – die CRM-App liegt anschließend wie ein natives Programm im Dock.

## Tech-Stack

- React 18 + TypeScript + Vite
- Zustand (State + LocalStorage Persistenz)
- Recharts (Charts)
- Lucide Icons
- CSS mit Apple-inspiriertem Design-System
