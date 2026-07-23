# Stadtnetz CRM Copilot – Desktop-App (Mac & Windows)

Das Cockpit, das bisher als Overlay in der Jira-Seite hing, in einem eigenen
Fenster: immer im Vordergrund, unabhängig davon, welcher Tab gerade offen ist,
und mit Notizen als zusätzlicher Funktion.

## Warum Chrome trotzdem laufen muss

Die Extension bleibt bestehen und liefert weiterhin zwei Dinge, die es außerhalb
von Chrome nicht gibt:

1. **Den geöffneten Jira-Vorgang.** Gelesen wird er aus dem DOM der Seite – dafür
   braucht es die Seite selbst.
2. **Die lokale KI.** Chromes eingebaute Modelle (`LanguageModel`, `Summarizer`,
   … alias Gemini Nano) sind an Google Chrome gebunden. Nicht einmal andere
   Chromium-Browser wie Edge oder Brave bekommen sie – das Chromium in Electron
   erst recht nicht.

Damit gilt: **Zusammenfassung, Einordnung und Entwürfe funktionieren nur, solange
Jira in Google Chrome offen ist** (ein Hintergrund-Tab genügt, das Fenster muss
nicht sichtbar sein). Ohne Chrome zeigt die App den zuletzt bekannten Stand,
sagt in der Titelleiste, dass sie nicht verbunden ist – und Notizen funktionieren
weiter, die hängen an nichts davon.

Wer das nicht will, müsste die lokale KI durch ein eigenes Modell im Bundle
ersetzen (z. B. Ollama). Das ist bewusst nicht gebaut: es wäre ein zweiter
KI-Pfad neben `src/local-ai.js`, mit eigenen Prompts, eigener Pflege und deutlich
größerem Installationspaket.

## Aufbau

```
Chrome                                   Desktop-App
┌───────────────────────────┐            ┌────────────────────────────┐
│ jira.ennit.de             │            │ Fenster (renderer/)        │
│  jira-reader.js  ─ liest  │            │  ui.js  ← unverändert      │
│  local-ai.js     ─ KI     │            │  supabase.js ← unverändert │
│  hud-agent.js    ─┐       │            │  shim-chrome.js            │
│                   │       │            │  shim-jira-reader.js       │
│ Service-Worker    │       │            │  shim-local-ai.js          │
│  hud-bridge.js  ←─┘       │            │  notes.js  ← neu           │
└──────────┬────────────────┘            └────────────┬───────────────┘
           │      WebSocket 127.0.0.1:8777            │  IPC
           └──────────────────► main/bridge.js ◄──────┘
```

Der Kniff: **`ui.js` läuft im Fenster unverändert.** Es weiß nicht, dass es nicht
mehr in einem Jira-Tab steckt. Ersetzt sind nur die drei Dinge, die es dort gäbe
und hier nicht:

| Original | Im Fenster | Was passiert |
| --- | --- | --- |
| `chrome.storage`, `chrome.runtime` | `shim-chrome.js` | Lesen/Schreiben gehen über die Bridge auf das echte `chrome.storage.local` in Chrome. Ein Spiegel im Benutzerprofil hält den letzten Stand vor, damit das Fenster auch ohne Chrome etwas anzeigt. |
| `jira-reader.js` | `shim-jira-reader.js` | Gelesen wird weiter in Chrome (`hud-agent.js` ruft dort denselben `read()` auf), das Ergebnis kommt herüber. |
| `local-ai.js` | `shim-local-ai.js` | Fernbedienung: Aufruf geht nach Chrome, Streaming (`onChunk`), Download-Fortschritt und Abbruch inklusive. |

Weil es keine zweite Kopie gibt, sondern `renderer/index.html` direkt
`../../extension/src/*.js` lädt, kann die Fassung im Fenster gar nicht von der im
Browser abweichen. Die Ladereihenfolge entspricht exakt `manifest.json` – die
Dateien bauen beim Laden aufeinander auf.

Solange die App läuft, baut die Extension ihr eigenes Panel in der Jira-Seite
**nicht** auf (`content.js`, `app.hudTakeover`). Sonst liefen beide Fassungen
parallel und würden dieselben KI-Aufgaben doppelt starten.

## Starten

```bash
cd desktop && npm install && npm start
```

Mit sichtbaren DevTools und Renderer-Meldungen im Terminal:

```bash
cd desktop && npm run dev
```

Danach in Chrome die Extension aus `extension/` laden (`chrome://extensions`,
Entwicklermodus, „Entpackte Erweiterung laden") und einen Jira-Vorgang öffnen.
Der Punkt links in der Titelleiste wird grün, sobald die Verbindung steht.

## Bedienung

| | |
| --- | --- |
| Fenster ein-/ausblenden | `Cmd/Strg + Umschalt + Leertaste` (systemweit) |
| Notizen | `Cmd/Strg + N`, oder ✎ in der Titelleiste |
| Notiz sichern | `Cmd/Strg + Enter` |
| Immer im Vordergrund | ⇧ in der Titelleiste, oder Tray-Menü |
| Beenden | Tray-Menü → Beenden (das × legt das Fenster nur ins Tray) |

## Notizen

Gedacht als Schmierzettel während des Gesprächs. Kunde und Vorgang setzt die App
selbst ein – aus der Kundenakte des laufenden Anrufs, sonst aus dem in Chrome
geöffneten Vorgang. Gespeichert wird zuerst lokal, also auch ohne Chrome und ohne
Netz. Von dort lässt sich jede Notiz einzeln in die Kundenakte übernehmen
(dieselbe `notes`-Tabelle wie im CRM); dafür braucht es eine Kundennummer und
eine CRM-Anmeldung, beides wie im Panel unter ⚙.

## Verpacken

`npm run pack:mac` bzw. `npm run pack:win` erzeugen eine lauffähige App ohne
Installer, `npm run dist` die fertigen Pakete (dmg/nsis). `extension/` wandert
dabei als Ressource mit ins Paket.

Für Windows und macOS gilt jeweils: unsignierte Pakete werden vom System
angemeckert. Für den Rollout im Haus braucht es ein Entwicklerzertifikat
(Apple Developer ID bzw. Authenticode) – bis dahin ist `npm start` der Weg.

## Sicherheit

* Der WebSocket-Server lauscht nur auf `127.0.0.1` – nichts davon verlässt den
  Rechner.
* Verbinden dürfen sich nur Chrome-Extensions (`Origin: chrome-extension://…`).
  Ohne diese Prüfung könnte jede beliebige Webseite im Browser sich anhängen und
  die Kundendaten mitlesen – `localhost` ist für Webseiten nicht gesperrt. Der
  Origin-Header wird vom Browser gesetzt und ist von Seitencode nicht fälschbar;
  eine Webseite trägt immer den Origin ihrer Domain (`https://…`) und kommt damit
  nicht durch.
* Das Fenster hat keinen Node-Zugriff (`contextIsolation`, kein
  `nodeIntegration`) und darf per CSP nur eigene Dateien laden. Einzige erlaubte
  Netzwerkverbindung ist Supabase (`https://*.supabase.co`) – bei einer selbst
  gehosteten Supabase-Instanz muss die CSP in `renderer/index.html` ergänzt
  werden, sonst schlägt der Zugriff fehl.
