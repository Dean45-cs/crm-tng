# Stadtnetz CRM Copilot – lokale KI für Jira

Eine Chrome-Extension für die klassische Jira-Vorgangsansicht, die jeden Arbeitsschritt mit **Chromes lokaler On-Device-KI** unterstützt. Sie liest ausschließlich die aktuell sichtbaren Ticketinformationen, formuliert Zusammenfassungen, Einordnungen, Kommentare und E-Mails – und verlässt dabei **nie den Browser**. Kein Server, keine API, kein Cloud-Fallback.

## KI-Funktionen (alle lokal)

Die Extension baut vollständig auf Chromes eingebauten KI-APIs auf (Prompt API / Gemini Nano, ergänzt durch Rewriter, Proofreader, Translator, wenn verfügbar).

Da das On-Device-Modell (Gemini Nano) klein ist, holt die Prompt-Schicht in `src/local-ai.js` bewusst das Maximum heraus: die **neuesten Kommentare** eines Tickets werden bei langen Verläufen priorisiert und überleben das Kontext-Budget (statt hinten abgeschnitten zu werden – dort steht meist die aktuelle Kundennachricht), Entwürfe bekommen ein **Form-Beispiel** (Few-Shot) mit auf den Weg, und Analyse-/JSON-Aufgaben laufen bewusst **deterministisch** (niedriger topK) für formattreue Ergebnisse. Das alles ohne zusätzliche Modell-Durchläufe, damit es auch auf schwächerer Hardware flüssig bleibt.

Das Panel gliedert sich in drei Bereiche: **Übersicht**, **Antwort** und **Call-Hilfe**.

**Übersicht**
- **KI-Einordnung** – automatische Analyse von Stimmung, Dringlichkeit, Kategorie und Kundenwunsch inkl. empfohlenem nächsten Schritt. Läuft automatisch, sobald das Modell bereit ist.
- **Eskalations-Erkennung** – bei verärgerter Stimmung oder hoher Dringlichkeit erscheint ein Hinweis mit Ein-Klick-Button **„Deeskalierend antworten"**, der direkt einen passenden E-Mail-Entwurf startet.
- **Nächster Schritt** – eine Karte mit sofortiger, deterministischer Schnellregel (ein Klick übernimmt die passende Notiz-Vorlage in den Antwort-Tab) plus KI-Handlungsempfehlung mit 2–4 konkreten Schritten aus Status, Beschreibung und Kommentaren.
- **Ticket-Zusammenfassung** – vier klare Punkte (Anliegen, Stand, Kundenergebnis, nächster Schritt), live gestreamt. Sie wandert zusätzlich als Notiz in die **Kundenakte des CRM**, zusammen mit dem Vermerk, ob das Ticket **offen oder geschlossen** ist – eine Notiz je Ticket, beim erneuten Zusammenfassen aktualisiert statt verdoppelt. Nur bei erkannter Kundennummer (Oikonomikos-Feld) und bestehender CRM-Anmeldung; abschaltbar in den Einstellungen.
- **Team-Doku** – vollständiger Übergabetext (Anliegen, Verlauf, aktueller Stand, wichtige Fakten, offene Punkte, empfohlener nächster Schritt), damit jeder Kollege das Ticket ohne Rückfrage übernehmen kann. Lässt sich kopieren oder direkt als Kommentar-Entwurf übernehmen. Zeigt bei einer erneuten Doku zusätzlich einen Abschnitt „Neu seit letztem Mal", falls sich das Ticket seitdem verändert hat.
- **Übersetzung** – erkennt fremdsprachige Kundentexte und übersetzt die Beschreibung ins Deutsche.
- **Automatisch & gecacht** – Einordnung, Zusammenfassung und Team-Doku laufen automatisch im Hintergrund, sobald das Modell bereit ist, und werden lokal pro Ticket gespeichert. Ein bereits besuchtes Ticket zeigt seinen letzten Stand sofort, ohne erneut auf die KI zu warten. Hat sich der Ticketinhalt seither geändert, markiert ein Hinweis „Ticket aktualisiert" die betroffene Karte.

**Antwort**
- **An Fachabteilung weiterleiten** – Fachabteilung eintragen, optional Hinweise ergänzen: in einem Schritt entsteht eine Kunden-Info-Mail zur Weiterleitung **und** ein interner Jira-Kommentar mit explizitem ToDo für die Fachabteilung. Beides editierbar, kopierbar und wahlweise als Kommentar- bzw. E-Mail-Entwurf in den Antwort-Assistenten übernehmbar.
- **Antwort-Assistent** – aus Stichworten formuliert die KI einen strukturierten Jira-Kommentar **oder** eine Kunden-E-Mail (Betreff + Text).
- **Antwortsprache** – E-Mails wahlweise auf Deutsch oder Englisch (in der Sprache des Kunden).
- **Schnellstart-Absichten** – ein Klick füllt typische Dokumentationslagen vor (Rückruf, Daten fehlen, Weitergabe …).
- **Tonalität** – professionell, freundlich, kürzer oder ausführlicher.
- **Werkzeuge am Entwurf** – Umschreiben, Korrektur lesen, KI-Qualitätscheck (mit verbesserter Fassung) und Kopieren.
- **E-Mail-Vorlagen** – eigene Vorlagen lokal speichern; Platzhalter werden beim Kopieren mit Ticketdaten gefüllt.

**Einstellungen** (Zahnrad oben im Panel)
- Name, Team und E-Mail-Signatur hinterlegen. Diese Angaben fließen in die KI-Entwürfe ein, sodass Kommentare und E-Mails ohne `[Name]`-Platzhalter fertig sind. Sie bleiben ausschließlich im Chrome-Profil.
- **Ticket-Zusammenfassung in die Kundenakte schreiben** – standardmäßig an; steuert die oben beschriebene Übernahme ins CRM. Abgeschaltet bleibt der Button „In die Kundenakte schreiben" an der Zusammenfassungs-Karte für den Einzelfall erhalten.

Das Panel unterstützt automatisch **hellen und dunklen Modus** (folgt der Systemeinstellung).

**Call-Hilfe**
- **Notizen → sauberer Kommentar** – Stichworte aus dem Gespräch werden zu einem strukturierten Jira-Kommentar; direkt in den Antwort-Tab übernehmbar. Räumt automatisch auf, sobald du beim Tippen kurz pausierst – ohne das Textfeld zu sperren, du kannst jederzeit weiterschreiben.
- Gesprächsleitfaden und Einwandkarten.
- **Rückrufliste** (in beiden Richtungen) – siehe Outbound-Modus.

## Outbound-Modus

Ausgehend wird anders gearbeitet als eingehend, und der Unterschied ist größer als es klingt: **timio hat eine eigene Anrufliste und wählt selbst**, sobald du dich auf grün/bereit stellst. Du suchst dir niemanden aus und hast keine Vorbereitungszeit – du bist plötzlich im Gespräch mit jemandem, den du nicht ausgewählt hast. Die entscheidende Frage ist damit nicht „welche Liste arbeite ich ab", sondern:

> **Wer ist gerade dran, welches Ticket gehört dazu, und was will ich von dieser Person – in unter fünf Sekunden.**

Genau darauf ist der Modus zugeschnitten.

**Richtungsschalter** oben im Panel (und ebenso im Cockpit auf der timio-Seite, weil du während des Gesprächs dort arbeitest). Er ist nötig, weil timios Call-Screen bei ausgehenden Anrufen genauso aussieht wie bei eingehenden – die Richtung steht nirgends im Seitentext und wird deshalb bewusst **nicht geraten**. Beide Seiten teilen sich den Schalter über `chrome.storage`; legst du ihn in timio um, zieht Jira binnen einer Sekunde nach. Der Call-Tab heißt im Outbound-Modus „Outbound", damit die eingestellte Richtung auch ohne Blick auf den Schalter sichtbar ist.

Ein Anruf, der ohne Klingel-Phase direkt verbunden ist, stammt typischerweise aus timios Anrufliste. Das Cockpit bietet dann einen dezenten Hinweis „Wirkt ausgehend – umschalten?" an. Das ist ein **Indiz, keine Automatik** – umgeschaltet wird nur auf deinen Klick.

- **Befehlspalette (`Cmd/Strg + K`)** – Schnellsuche über Kunden, Verträge und Notizen, im Jira-Panel wie im timio-Cockpit. Wie alle Tastenkürzel änderbar unter ⚙ → „Tastenkürzel".
- **Kundennummer → Ticket in einem Klick** – der eigentliche Engpass. Die Extension kann Jira nicht durchsuchen (sie liest nur die sichtbare Seite), aber sie kann eine Suche als Link öffnen: ein Klick auf „Ticket zu Kundennummer … suchen" öffnet die Jira-Trefferliste in einem neuen Tab. Voreingestellt ist eine Volltextsuche; kennst du den JQL-Feldnamen deines Kundenfelds, hinterlege in den Einstellungen eine treffsicherere Vorlage (z. B. `"Oikonomikos-ID" ~ "{q}"`). Hilft eingehend genauso.
- **KI-Gesprächsvorbereitung** – aus dem Ticket entstehen Anrufziel, 2–3 Gesprächspunkte, die offenen Fragen und die zu erwartenden Einwände mit Antwort. Läuft im Outbound-Modus **automatisch im Voraus** und wird pro Ticket gecacht, ist also fertig, bevor timio wählt – nach dem Verbinden bleibt dafür keine Zeit. Ziel und Punkte erscheinen auch im Cockpit **auf der timio-Seite**, wo du während des Gesprächs hinsiehst.
- **Outbound-Leitfaden & Einwandkarten** – Eigenvorstellung und Anlass, Erlaubnis/Zeit abholen, Sachstand, Ziel klären, Ergebnis bestätigen. Dazu die Einwände, die es nur ausgehend gibt („Ich habe gerade keine Zeit", „Woher haben Sie meine Nummer?").
- **Ergebnis-Erfassung nach dem Auflegen** – ein Klick auf erreicht / Rückruf vereinbart / Mailbox / nicht erreicht / falsche Nummer / kein Interesse füllt die Gesprächsnotiz vor und lässt die lokale KI daraus den Jira-Kommentar bauen. Die Leiste erscheint auch im timio-Cockpit; dort läuft keine KI, der Klick wird lokal an die Jira-Seite weitergereicht und dort verarbeitet.
- **Rückrufliste (Wiedervorlage)** – bewusst **getrennt von timios Anrufliste**: hier stehen nur die Rückrufe, die du selbst vereinbart hast. Bei „nicht erreicht" oder „Mailbox" entsteht der Eintrag automatisch, mit Versuchszähler und wachsendem Abstand (2 Stunden → 1 Tag → 3 Tage). Je Eintrag: Nummer kopieren und in den timio-Tab springen, Ticket öffnen, um eine Stunde oder auf morgen verschieben, erledigen. Ein Ticket erzeugt nie eine Dublette.
- **Erinnerung an fällige Rückrufe** – im Outbound-Modus zeigt das Symbolleisten-Icon die Zahl der fälligen Rückrufe in Bernstein (steht keiner an, wieder das Wartefeld). Dazu eine lokale Desktop-Meldung, je Eintrag genau einmal; in den Einstellungen abschaltbar.

Gewählt wird bewusst über **Nummer kopieren + timio in den Vordergrund holen**, nicht durch automatisches Ausfüllen von timios Wählfeld. Die Extension greift nirgends schreibend in timio ein – auf dieser Zusage beruht die Robustheit der gesamten Integration.

## timio-Anrufer-Integration & Call-Cockpit

Läuft ihr über **timio** (`ccc.my-phone.cloud`), erkennt ein zweites, separates Content-Script dort klingelnde/aktive Anrufe und die Wartefeld-Zahlen des Portals rein anhand des sichtbaren Seitentexts (kein Mithören, keine Audiodaten – nur DOM-Text wie bei der Ticketerkennung) und meldet das per `chrome.storage` an das Jira-Panel – ohne Server und ohne Umweg über den Hintergrundprozess, die beiden Tabs lesen und schreiben schlicht denselben lokalen Schlüssel:

- **Call-Cockpit (Overlay)** – erscheint automatisch beim Klingeln und bleibt **während des gesamten Gesprächs** sichtbar, egal welcher Panel-Tab offen ist (auch bei minimiertem Panel). Es zeigt auf einen Blick:
  - Anrufername, Rufnummer, Kundennummer, Gruppe und die Wartezeit des Kunden vor der Annahme,
  - die **laufende Gesprächsdauer**,
  - **live die Anzahl der Anrufe im Wartefeld** – pro Gruppe (z. B. „TNG GFIZ Ausbaustatus", „TNG GFIZ Bestellhotline") und als Summe, mit Markierung der Gruppe des aktuellen Anrufers. Voraussetzung: der Portal-Tab in timio ist geöffnet; sind die Zahlen älter als ~30 Sekunden, wird das angezeigt,
  - den **Ticket-Abgleich**: passt das offene Jira-Ticket zur Kundennummer des Anrufers, erscheinen Ticket-Key, Titel, Status/Priorität, die KI-Zusammenfassung und offene Hinweise; bei Abweichung eine deutliche rote Warnung; ohne Vergleichsmöglichkeit ein Hinweis, das passende Ticket zu öffnen (die Extension kann Jira nicht durchsuchen, nur die sichtbare Seite lesen).
  - Das Cockpit ist **verschiebbar** (an der Kopfzeile ziehen) und **minimierbar** zu einer schmalen Leiste mit Status, Name, Dauer und Wartefeld-Zähler. Position und Modus bleiben lokal gespeichert. Nach dem Auflegen zeigt es kurz „Beendet" samt Gesprächsdauer und blendet sich dann selbst aus.
- **Call-Cockpit auch direkt in timio** – da während des Telefonats meist in timio gearbeitet wird (Notizfeld, Formular), erscheint dort dasselbe Cockpit als eigenes Overlay: Anrufer, Gesprächsdauer, Wartefeld-Zahlen **und der Kontext des aktuell in Jira geöffneten Tickets** (Key, Titel, Status/Priorität, KI-Zusammenfassung, Kundennummern-Abgleich mit Warnung bei Abweichung). Die Jira-Seite stellt den Ticket-Kontext dafür lokal per `chrome.storage` bereit – auch das verlässt den Browser nie. Ebenfalls verschiebbar und minimierbar, Position wird gemerkt.
- **Anrufer-Banner** oben im Panel – Name, Rufnummer, Kundennummer, Gruppe, Gesprächsdauer und Wartefeld-Summe.
- **Wartefeld live** auch als Karte im Call-Hilfe-Tab – so siehst du die Warteschlange auch zwischen zwei Gesprächen.
- **Abgleich-Warnung** – weicht die Kundennummer des aktiven Anrufers von der Kundenreferenz des offenen Tickets ab, wird das in Banner und Cockpit rot markiert.
- **Automatischer Wechsel zum Call-Tab**, sobald ein Anruf angenommen wird.

### Wartefeld-Badge auf dem Symbolleisten-Icon

Ein Hintergrund-Service-Worker (`src/background.js`) zeigt die Zahl der Anrufer im Wartefeld direkt als **Badge auf dem Extension-Icon** in der Chrome-Symbolleiste – sichtbar in **jedem** Tab, egal ob gerade Jira, timio oder etwas ganz anderes offen ist, und ohne dass ein timio-Tab im Vordergrund sein muss. Damit kannst du z. B. den timio-**Portal**-Tab im Hintergrund offen lassen (liefert die Zahlen) und in einem zweiten timio-Tab wirklich telefonieren – die Warteschlange bleibt trotzdem überall im Blick.

- **Farbe** signalisiert den Zustand: rot = es warten Anrufer, grün = Wartefeld frei, grau = Daten veraltet (kein Portal-Tab offen). Der **Tooltip** (Maus übers Icon) listet die Zahl pro Gruppe und – falls gerade telefoniert wird – den aktiven Anruf auf.
- **Klick aufs Icon** springt zum offenen timio-Tab (oder öffnet timio, falls keiner offen ist) – erspart das Suchen des Tabs. Läuft die Desktop-App, holt derselbe Klick stattdessen deren Auskunft nach vorn: dort steckt dann das Cockpit, und ausgeblendet wäre es aus Chrome heraus sonst nicht erreichbar. Was gerade gilt, steht im Tooltip.
- **Optionale Desktop-Benachrichtigung**, sobald aus einem leeren Wartefeld ein Anruf zu warten beginnt – so musst du das Wartefeld gar nicht mehr aktiv beobachten. Standardmäßig an, in den Einstellungen (⚙) abschaltbar. Es wird bewusst nur bei der steigenden Flanke „niemand → jemand wartet" gemeldet, nicht bei jedem weiteren Anrufer, und nicht beim Browserstart.

> Tipp: Das Icon ggf. in Chrome anpinnen (Puzzle-Symbol → Stecknadel), damit das Badge dauerhaft sichtbar ist. Falls Chrome den Portal-Tab im Energiesparmodus „entlädt", pausiert dessen Datenlieferung, bis er wieder aktiv ist – das Badge wird dann grau (veraltet). Für einen dauerhaft offenen Portal-Tab ggf. unter `chrome://settings/performance` vom Energiesparmodus ausnehmen.

Robustheit: Wechselst du in timio während eines Gesprächs auf einen anderen internen Tab (z. B. Portal), verschwinden die Call-Marker aus dem sichtbaren Text – der Status bleibt dann für eine Schonfrist (~20 s) „verbunden", statt sofort zu verschwinden. Wird der timio-Tab geschlossen, werden die Anrufdaten sofort lokal gelöscht; verwaiste Einträge räumt die Jira-Seite zusätzlich selbst auf.

Die Erkennung ist textbasiert (keine festen HTML-Selektoren, da kein Entwicklerzugriff auf timio bestand), inzwischen aber anhand echter Screenshots aller relevanten Ansichten verifiziert: Portal (Wartefeld-Kacheln „Agenten" / „Wartefeld" / „Anrufe Eingang … Im Wartefeld"), Klingel-Toast, Gesprächsansicht und „Beendet"-Karte. Die Rufnummer des Anrufers wird gezielt in der Anrufkarte (wenige Zeilen vor dem „Gruppe:"-Label) gesucht – andere Nummern auf der Seite (z. B. „Meine letzten Unterhaltungen" oder das Rufnummer-Feld im timio-Formular) werden dadurch nie verwechselt. Bei UI-Änderungen in timio ggf. nachjustieren – siehe `src/timio-content.js`.

## Ticketdaten

- Erkennt Tickets über `/browse/PROJEKT-123`.
- Liest Ticketnummer, Titel, Priorität, Status, Typ, Bearbeiter, Autor, Kunden-/Referenzfelder, Beschreibung und sichtbare Kommentare – ausschließlich aus den klassischen Jira-Bereichen.

## Netz-Auskunft (optional, aktive Dashboard-Abfrage)

Anders als der Rest der Extension **liest** die Netz-Auskunft nicht nur die
sichtbare Seite, sondern **öffnet und automatisiert** ein internes Dashboard, um
zu einer Kundennummer nachzuschlagen:

- **Baustatus (FTTX)** über `fttx-dash.tng.de` – Ausbauphase, Vertrag, Line
  Status, KVZ, Gebäudetyp, Adresse, externe Firmen und Zeitschienen.
- **Kündiger-Status (GFIZ)** über `gfiz-dash.tng.de` – offene Churn-Vorgänge zur
  Kundennummer (Vertrag, Geschäftsfall, Ursache, Jira-Ticket, Kommentar).

Der Orchestrierung liegt eine bewusste Architekturentscheidung zugrunde: der
Hintergrund-Worker (`src/lookup.js`) öffnet/findet den Dashboard-Tab und spricht
ein **deklaratives Content-Script** (`src/baustatus-content.js` /
`src/churn-content.js`) per Nachricht an – kein `chrome.scripting.executeScript`,
das auf strikten CSP-/Trusted-Types-Seiten scheitert. Die reine Auswertung
liegt in testbaren Parsern (`shared.parseBaustatus` / `shared.parseChurn`).

**Weil das ein fremdes System automatisiert, ist es doppelt abgesichert:**

- **Master-Schalter** in den Einstellungen (**Standard AUS**). Ohne ihn erscheinen
  keine Abfrage-Buttons, sondern nur ein Hinweis zum Aktivieren.
- **Bestätigung vor jedem einzelnen Lauf** direkt im Panel (kein Blindstart).

Ergebnis und Fortschritt erscheinen in der Übersicht in der bestehenden
Panel-Optik. Kundennummer wird aus dem Ticket (Kunden-ID) bzw. einem aktiven
Anruf übernommen.

### WebSocket-Bridge (optional)

Ein lokaler Server (`server/baustatus_bridge.py`) kann ein externes Frontend mit
der Extension verbinden, sodass dieses eine Netz-Auskunft auslösen und Ergebnis
+ Fortschritt live erhält. Eigener **Schalter (Standard AUS)** plus
**Token-Handshake**; solange verbunden, zeigt das Panel ein Banner „Bridge
aktiv". Nur `127.0.0.1`. Ein Bridge-Aufruf benötigt **beide** Schalter
(Bridge *und* Netz-Auskunft). Details in [`../server/README.md`](../server/README.md).

> **Freigabe/Compliance:** Aktives Automatisieren interner Dashboards sollte
> abgestimmt sein (mit dem/der Verantwortlichen und bzgl. der Nutzungsregeln der
> Dashboards). Die Schalter stehen deshalb bewusst auf AUS.

## Lokal laden

1. Chrome öffnen und `chrome://extensions` aufrufen.
2. Oben rechts den **Entwicklermodus** aktivieren.
3. **Entpackte Erweiterung laden** wählen.
4. Diesen Ordner auswählen: `New project`.
5. Eine Jira-Ticketseite wie `https://jira.ennit.de/browse/TNG-1592568` neu laden.

Falls sich die Jira-Domain ändert, in `manifest.json` den Eintrag unter `content_scripts[0].matches` anpassen und die Erweiterung neu laden.

## Als Desktop-App (Mac & Windows)

Dasselbe Cockpit gibt es auch als eigenes Fenster, das immer im Vordergrund bleibt – unabhängig davon, welcher Tab gerade offen ist, und mit Notizen als zusätzlicher Funktion. Siehe [`desktop/`](../desktop/README.md).

Die Extension bleibt dabei bestehen: sie liefert weiterhin den Vorgang und die lokale KI, denn beides gibt es nur in Chrome. Läuft die App, baut die Extension ihr Panel in der Jira-Seite nicht zusätzlich auf (`src/hud-agent.js`, `src/hud-bridge.js`) – sonst liefen beide Fassungen parallel.

An die Stelle des Panels tritt dann unten rechts die Sprechblase **„Auskunft"**: ein Klick holt das Overlay der App nach vorn (ebenso der Klick aufs Symbolleisten-Icon). Die App hat kein Dock-Symbol und keine Titelleiste – ohne diesen Weg käme man aus Chrome heraus an eine ausgeblendete Auskunft nicht mehr heran.

## Voraussetzungen für die lokale KI

Die KI nutzt Chromes On-Device-Modelle. Damit sie einsatzbereit sind, braucht es:

- Aktuelles Chrome mit aktivierter **Prompt API** (Gemini Nano). Ggf. unter `chrome://flags` „Prompt API for Gemini Nano“ aktivieren und das Modell unter `chrome://components` („Optimization Guide On Device Model") laden.
- Geeignete Hardware (genug RAM/Speicher). Das Modell wird einmalig lokal geladen – dabei werden **nur Modelldaten** heruntergeladen, keine Ticketinhalte.

Ist die KI nicht verfügbar, zeigt die Extension einen klaren Hinweis und nutzt ausdrücklich **keinen** Cloud-Dienst. Der Qualitätscheck fällt in diesem Fall auf eine lokale Regelprüfung zurück.

## Daten und Datenschutz (DSGVO)

- **Keine API, kein Server, kein Tracking.** Es verlässt nichts den Browser – Datenverarbeitung findet ausschließlich lokal auf dem Gerät statt. Der einzige Hintergrundprozess ist der Service-Worker fürs Symbolleisten-Badge und die Rückruf-Erinnerung; er liest ausschließlich den lokalen `chrome.storage` und spricht mit keinem Netzwerk (siehe unten).
- Alle KI-Aufgaben (Zusammenfassung, Einordnung, Entwürfe, Umschreiben, Korrektur, Übersetzung) laufen **on-device**.
- **Ausnahme mit Anmeldung: das eigene CRM.** Ist die Extension am CRM angemeldet (Einstellungen), spricht sie mit dessen Supabase-Projekt – für die Kundenakte beim Anruf, die Erfassung am Gesprächsende und die Übernahme der Ticket-Zusammenfassung. Das sind Daten, die ohnehin ins CRM gehören, gehen an keinen Dritten, und jeder Schreibvorgang steht im `audit_log`. Ohne Anmeldung entfällt das vollständig, die KI-Funktionen bleiben unverändert nutzbar.
- Ticketinhalte, die an die KI gehen, sind als Daten deklariert; Anweisungen aus Tickettexten werden ignoriert (Schutz vor Prompt-Injection).
- **Was lokal gespeichert wird** (Chrome Storage, nur im eigenen Chrome-Profil):
  - UI-Zustand (offen/Tab/Ton), Cockpit-Position/-Modus,
  - eigene E-Mail-Vorlagen und die Einstellungen (Name/Team/Signatur),
  - die zuletzt generierten KI-Ergebnisse pro Ticket (Zusammenfassung, Einordnung, Team-Doku, Empfehlung) – für die letzten 30 besuchten Tickets, danach wird der älteste Eintrag verdrängt,
  - der aktuelle Anrufstatus (Name, Rufnummer, Kundennummer, Gruppe, Dauer) – **nur für die Dauer des Anrufs**: beim Auflegen, beim Schließen des timio-Tabs oder spätestens beim Erkennen eines verwaisten Eintrags wird er gelöscht,
  - die eingestellte Arbeitsrichtung (nur das Wort „inbound" bzw. „outbound"),
  - die **Rückrufliste** – siehe den eigenen Punkt unten, sie ist die einzige Stelle mit dauerhaft gespeicherten Kontaktdaten,
  - die Wartefeld-Zahlen aus dem timio-Portal – **nur Gruppennamen und Zähler**, keine Namen oder Rufnummern anderer Personen,
  - der Kontext des zuletzt in Jira geöffneten Tickets (Key, Titel, Status, Priorität, Kundenreferenz, KI-Zusammenfassung) für das Cockpit in timio,
  - die zuletzt fürs Badge gemeldete Wartefeld-Summe (nur eine Zahl, um die Benachrichtigungs-Flanke zu erkennen).
  - Kommentar- und Gesprächsentwürfe werden **nicht** gespeichert.
- **Die Rückrufliste ist die einzige Ausnahme von „nur während des Anrufs".** Sie enthält naturgemäß Kontaktdaten (Name, Rufnummer, Kundennummer, Ticketbezug) und muss den Anruf überdauern – sonst wäre eine Wiedervorlage sinnlos. Deshalb gilt dort ausdrücklich:
  - Einträge entstehen **nur durch eine bewusste Aktion** (Button „Auf die Rückrufliste setzen" oder ein Klick auf ein Gesprächsergebnis), nie automatisch aus einem vorbeilaufenden Anruf.
  - Erledigte Einträge werden **sofort** entfernt, nicht archiviert.
  - Einträge, deren Fälligkeit länger als 30 Tage zurückliegt, verschwinden beim nächsten Laden von selbst; die Liste ist zusätzlich auf 100 Einträge gedeckelt.
  - Sie liegt wie alles andere ausschließlich im lokalen Chrome-Profil und wird vom Lösch-Button unten miterfasst.
- **Recht auf Löschung, lokal umgesetzt:** In den Einstellungen (Zahnrad) gibt es unter „Daten & Datenschutz" einen Button, der sämtliche lokal gespeicherten Daten der Extension auf einen Schlag löscht.
- Das timio-Content-Script liest ausschließlich sichtbaren Text auf der timio-Seite (Rufnummer, Kundennummer, Gruppe, Status, Wartefeld-Zähler) – kein Mithören, keine Audiodaten, kein Server.
- Der Hintergrund-Service-Worker liest nur den lokalen `chrome.storage` (nie die Seiten selbst), setzt daraus das Icon-Badge und zeigt – falls aktiviert – **lokale** Desktop-Benachrichtigungen. Auch das verlässt den Browser nicht.
- Texte werden ausschließlich auf Nutzeraktion in die lokale Zwischenablage kopiert. Die Extension sendet nie Kommentare und ändert keinen Jira-Status.
- Berechtigungen: `storage` und `clipboardWrite` sowie `notifications` (lokale Wartefeld-Meldung) und `alarms` (regelmäßiges Aktualisieren des Badges); Zugriff nur auf `jira.ennit.de` und `ccc.my-phone.cloud`.

## Anpassungen

- KI-Verhalten (System-Prompt, Tonalitäten, Schnellstart-Absichten): `src/config.js` unter `ai`.
- KI-Funktionen und API-Anbindung: `src/local-ai.js`.
- Deterministische Regeln (Hinweise, Schnell-Empfehlung, Fallback-Qualitätscheck): `src/rules.js`.
- Jira-Selektoren und Feldnamen: `src/jira-reader.js`.
- timio-Erkennung (Textmuster für Rufnummer/Kundennummer/Status): `src/timio-content.js`.
- Outbound-Leitfaden, Einwandkarten, Gesprächsergebnisse und Wiedervorlage-Abstände: `src/config.js` unter `callGuides`, `objectionCards` und `outbound`; JQL-Vorlage unter `jira`.
- Oberfläche und Abläufe: `src/ui.js`.
- Symbolleisten-Badge, Icon-Klick und Wartefeld-Benachrichtigung: `src/background.js` (Farben/Schwellen in `src/config.js` unter `badge`).
- Extension-Icons neu erzeugen (nach Farbänderung in `tools/generate-icons.js`): `node tools/generate-icons.js`.

Nach jeder Code-Änderung die Extension in `chrome://extensions` neu laden und die Jira-Ticketseite aktualisieren.

Node-Smoke-Tests liegen unter `test/` und laufen ohne Browser (kein Framework, keine Dependency). **Alle auf einmal:** `node test/run-all.js`. Einzeln:

- `node test/timio-content.test.js` – Anruf-Erkennung und Idle-Wartefeld-Widget des timio-Content-Scripts.
- `node test/timio-cross-tab.test.js` – zwei gleichzeitig offene timio-Tabs (z. B. einer auf „Portal", einer für echte Anrufe) teilen sich die Wartefeld-Zahlen korrekt über `chrome.storage`.
- `node test/shared.test.js` – gemeinsame Helfer in `src/shared.js` (Dauer-Formatierung, Call-Status, Wartefeld-Summe/-Veraltung, Gruppen-Matching), die von Panel, timio-Cockpit und Service-Worker geteilt werden.
- `node test/badge.test.js` – Symbolleisten-Badge (Text/Farbe/Tooltip), Benachrichtigungs-Flanke und Icon-Klick-zu-timio des Service-Workers.
- `node test/local-ai.test.js` – Prompt-Engineering der KI-Schicht: Kontext-Priorisierung (neueste Kommentare überleben), Few-Shot-Beispiele und topK-Determinismus für Analyse-Aufgaben (Fake-Modell fängt den Prompt ab).
- `node test/outbound.test.js` – Outbound-Grundlagen: Arbeitsrichtung, Rufnummern-Normalisierung, Wiedervorlage-Staffelung und Ausmisten der Rückrufliste, Kundennummer-Suche (inkl. JQL-Escaping), modusabhängiges Badge und die Rückruf-Erinnerung im Service-Worker – samt Nachweis, dass dessen Schreiben auf `callbacks` keine Endlosschleife auslöst.
- `node test/ui-outbound.test.js` – der Outbound-Modus im Panel: Richtungsschalter (auch aus timio heraus), wechselnder Leitfaden inkl. korrekt indizierender Kopier-Buttons, Rückrufliste ohne Dubletten, Ergebnis-Erfassung mit automatischer Wiedervorlage und die Prüfung, dass neue Einstellungen das Speichern überleben.

Neue Szenarien bitte in die passende `*.test.js` ergänzen statt ein neues Wegwerf-Skript im Scratchpad zu schreiben – `test/support/stub-env.js` stellt die document/chrome/window- bzw. Service-Worker-Stubs und den vm-Loader bereit.
