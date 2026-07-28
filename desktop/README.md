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
sagt im Panelkopf, dass sie nicht verbunden ist – und Notizen funktionieren
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
parallel und würden dieselben KI-Aufgaben doppelt starten. An seine Stelle tritt
unten rechts die Sprechblase „Auskunft": ein Klick holt das Overlay nach vorn.
Denselben Weg nimmt der Klick auf das Symbol der Erweiterung. Beides läuft über
`{ t: "show" }` durch die Bridge – der einzige Auftrag, den Chrome der App
erteilt.

## Wie man die Auskunft hervorholt

Sie hat kein Dock-Symbol, keine Titelleiste und keinen Eintrag im
Programmumschalter – ausgeblendet ist sie deshalb nur über diese Wege wieder da.
Absichtlich mehrere: fällt einer aus (Tastenkombination von einem anderen
Programm belegt, Symbol in der Menüleiste übersehen), tragen die übrigen.

| Weg | Wo |
| --- | --- |
| `Cmd/Strg + Umschalt + Leertaste` | systemweit, auch wenn Chrome nicht vorn ist |
| Sprechblase „Auskunft" | unten rechts in der Jira-Seite, solange die App läuft |
| Symbol der Erweiterung | in Chrome, neben der Adressleiste |
| Symbol in der Menü-/Infoleiste | Klick blendet ein/aus, Rechtsklick öffnet das Menü |

Die Tastenkombination steht bei jedem Start auf dem Startbild und in den
Einstellungen des Panels unter „Overlay".

## Im Team verteilen

Die entscheidende Eigenschaft einer Auskunft, die es nicht als Fenster gibt:
**sie muss laufen.** Läuft sie nicht, führt kein Weg zu ihr – auch keiner aus
Chrome, denn eine Erweiterung kann kein Programm starten. Deshalb sorgt die App
selbst dafür, dass sie läuft, statt das jeder Person zu überlassen:

1. **Beim ersten Start trägt sie sich als Anmeldeobjekt ein** (`ensureAutoStart`
   in `main/main.js`) – ab dann ist sie nach jeder Anmeldung da. Genau **einmal**:
   wer den Schalter unter ⚙ → „Overlay" oder im Tray-Menü umlegt, hat
   entschieden, und die App legt ihn nie wieder von selbst um.
2. **Liegt sie nicht im Programme-Ordner, bietet sie an, sich selbst dorthin zu
   legen** (macOS). Aus „Downloads" oder direkt aus dem Installationsabbild
   heraus zeigte der Autostart sonst auf einen Pfad, den es beim nächsten
   Anmelden vielleicht nicht mehr gibt.

Pakete bauen (Symbol, beide Mac-Architekturen, Windows x64):

```bash
cd desktop && npm install && npm run dist
```

Ergebnis in `desktop/dist/`:

| Datei | Für |
| --- | --- |
| `Stadtnetz CRM Copilot-<Version>-arm64.dmg` | Mac mit Apple-Chip (M1–M4) |
| `Stadtnetz CRM Copilot-<Version>.dmg` | Mac mit Intel-Prozessor |
| `Stadtnetz CRM Copilot Setup <Version>.exe` | Windows 64 bit |

Die Architekturen stehen ausdrücklich in `package.json` (`build.mac.target`,
`build.win.target`). Ohne das baut electron-builder nur die des Baurechners –
auf einem M-Mac also ein Windows-Paket für ARM, das auf keinem Büro-PC läuft.

**Windows:** Setup doppelklicken. Es installiert ohne Administratorrechte ins
Benutzerprofil (`oneClick`, `perMachine: false`), legt Verknüpfungen an und
startet die App danach. SmartScreen meldet einen unbekannten Herausgeber →
„Weitere Informationen" → „Trotzdem ausführen".

**macOS:** Abbild öffnen, App in den Programme-Ordner ziehen, starten. Beim
ersten Mal meldet macOS einen nicht verifizierten Entwickler → **Rechtsklick auf
die App → „Öffnen"** → „Öffnen". Nur einmal nötig.

Die Pakete sind **ad-hoc signiert** (`build/afterPack.js`), nicht von Apple
beglaubigt. Das ist bewusst der kleine Unterschied, der zählt: ohne diesen
Schritt bliebe im Bundle die Signatur der Electron-Vorlage stehen, die einen
anderen Inhalt beschreibt – macOS meldet dann „Die App ist beschädigt", und
dagegen hilft auch Rechtsklick → Öffnen nicht mehr. Eine echte Beglaubigung
(Notarisierung, dann startet sie kommentarlos per Doppelklick) bräuchte ein
Apple-Entwicklerkonto mit „Developer ID Application"-Zertifikat; ist eines da,
genügen `CSC_LINK`/`CSC_KEY_PASSWORD` und `notarize` in der Build-Konfiguration.

**Dazu gehört immer die Chrome-Erweiterung** – ohne sie kennt die App weder den
Jira-Vorgang noch die lokale KI (siehe oben, „Warum Chrome trotzdem laufen
muss"). Sie wird unabhängig verteilt: `chrome://extensions` → Entwicklermodus →
„Entpackte Erweiterung laden", oder unternehmensweit per Gruppenrichtlinie.

## Starten (Entwicklung)

```bash
cd desktop && npm install && npm start
```

Mit sichtbaren DevTools und Renderer-Meldungen im Terminal:

```bash
cd desktop && npm run dev
```

Danach in Chrome die Extension aus `extension/` laden (`chrome://extensions`,
Entwicklermodus, „Entpackte Erweiterung laden") und einen Jira-Vorgang öffnen.
Der Punkt links im Panelkopf wird grün, sobald die Verbindung steht.

Beim Start zeigt das Fenster ein Startbild, bis das Cockpit steht: es sagt,
worauf gerade gewartet wird (Stand aus Chrome, Aufbau des Panels), nennt die
Tastenkombination zum Ein- und Ausblenden – und bietet einen neuen Versuch an,
falls der Start hängen bleibt. Ohne diese Ebene wäre ein rahmenloses Fenster in
den ersten Sekunden von einem abgestürzten nicht zu unterscheiden.

## Bedienung

| | |
| --- | --- |
| Ein-/ausblenden | `Cmd/Strg + Umschalt + Leertaste` (systemweit) – weitere Wege siehe oben |
| Befehlspalette | `Cmd/Strg + K` |
| Verschieben / Größe ändern | am Kopf des Panels ziehen / Anfasser unten rechts |
| Notizen | `Cmd/Strg + N`, oder ✎ im Panelkopf |
| Notiz sichern | `Cmd/Strg + Enter` |
| Immer im Vordergrund, Deckkraft, Klicks durchreichen | ⚙ → „Overlay", oder Tray-Menü |
| Beim Anmelden starten | ⚙ → „Overlay", oder Tray-Menü (ab Werk an) |
| Beenden | Tray-Menü → Beenden, oder ⚙ → „Overlay" → Beenden |

Alle Tastenkürzel sind änderbar: ⚙ → „Tastenkürzel", anklicken und die
gewünschte Kombination drücken (Esc bricht ab, Rücktaste schaltet ein Kürzel
aus). Die Liste steht in `extension/src/config.js` unter `hotkeys` und ist die
einzige Wahrheit – ein dort eingetragenes Kürzel erscheint von selbst in den
Einstellungen. Die beiden systemweiten (Ein-/ausblenden, Klicks durchreichen)
registriert der Hauptprozess und speichert sie je Gerät; ist eine Taste schon
von einem anderen Programm belegt, sagt die Zeile das, statt stumm nichts zu
tun.

## Notizen

Gedacht als Schmierzettel während des Gesprächs. Kunde und Vorgang setzt die App
selbst ein – aus der Kundenakte des laufenden Anrufs, sonst aus dem in Chrome
geöffneten Vorgang. Gespeichert wird zuerst lokal, also auch ohne Chrome und ohne
Netz. Von dort lässt sich jede Notiz einzeln in die Kundenakte übernehmen
(dieselbe `notes`-Tabelle wie im CRM); dafür braucht es eine Kundennummer und
eine CRM-Anmeldung, beides wie im Panel unter ⚙.

## Verpacken

`npm run pack:mac` bzw. `npm run pack:win` erzeugen eine lauffähige App ohne
Installer, `npm run dist` die fertigen Pakete für die Verteilung (siehe „Im Team
verteilen"). `extension/` wandert dabei als Ressource mit ins Paket, das
Programmsymbol erzeugt `npm run icon` aus demselben Motiv wie die
Extension-Icons (`tools/generate-app-icon.js`).

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
