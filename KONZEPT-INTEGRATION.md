# Ein Produkt aus zwei: Support Copilot × Stadtnetz CRM

Arbeitsstand des Integrationskonzepts. Ziel ist nicht, ein Addon an ein CRM zu
hängen, sondern beide zu einem System zu machen, das den Arbeitsalltag im
Support- und Vertriebstelefonat trägt.

## Ausgangslage

Es existieren zwei fertige, unabhängig gewachsene Systeme:

| | Support Copilot | Stadtnetz CRM |
|---|---|---|
| Was | Chrome MV3 Extension | React 19 PWA |
| Wo | in Jira und in timio | eigener Tab |
| Daten | `chrome.storage.local` | Supabase (Postgres, RLS, Realtime) |
| Stärke | ist da, wo gearbeitet wird | kennt die Geschäftsbeziehung |
| Schwäche | vergisst alles, kennt keine Kunden | ist nicht da, wo telefoniert wird |

Verbindendes Element ist die **Kundennummer**. Sie steht in timios Anrufkarte,
im Oikonomikos-Feld des Jira-Tickets und in `Contract.customerNumber`. Drei
Systeme, ein Schlüssel — bislang ungenutzt.

## Der Befund, der das Konzept bestimmt

**Das CRM hat keinen Kundenbegriff.** Es gibt keine `customers`-Tabelle. Ein
Kunde ist eine Ableitung aus Verträgen, Tarifwechseln und Notizen
(`buildCustomerSummaries()` in `src/lib/utils.ts`), aggregiert über die
Kundennummer. Wer keinen Vorgang hat, existiert nicht — `CustomerDetail.tsx`
zeigt dann „Kunde nicht gefunden".

Im Support ist ein Kunde aber jemand, der anruft. Der hat meistens keinen
verkauften Vertrag, er hat ein Problem. **Der Normalfall am Telefon ist im CRM
ein Nichts.**

Solange das so bleibt, bleiben es zwei Produkte — unabhängig davon, wie
ähnlich sie aussehen. Ein gemeinsamer Kundenbegriff ist deshalb kein
Implementierungsdetail, sondern die Voraussetzung für alles Weitere.

## Leitidee

> Der Kunde ist die App. Das CRM ist die Wahrheit, und die Extension ist kein
> Addon mehr, sondern das CRM an den Orten, wo tatsächlich gearbeitet wird.

Daraus folgen vier Prinzipien:

1. **Eine Wahrheit.** Kundendaten leben in Supabase, nicht doppelt.
2. **Ein Vokabular.** Gleiche Begriffe, gleiche Farben, gleiche Aktionen —
   egal ob in timio, Jira oder im CRM.
3. **Kein schreibender Zugriff auf Fremdsysteme.** Jira und timio werden
   gelesen, nie ferngesteuert. Die Brücke ist die Zwischenablage. Das ist
   bereits das Muster des Outbound-Modus und der Grund für dessen Robustheit.
4. **KI bleibt auf dem Gerät.** Ohne Ausnahme, ohne Fallback.

## Datenmodell

### Neu: `customers`

Die Kundennummer wird zur eigenständigen Entität statt zur Fremdschlüssel-Zeichenkette.

```
customers
  customer_number   text primary key
  name              text
  phone             text            -- aus timio, für Rückwärtssuche
  first_seen_at     timestamptz
  last_contact_at   timestamptz
  created_by        uuid
```

Bestehende Tabellen behalten `customer_number` als Textspalte — kein
Fremdschlüssel-Zwang, damit die Migration bestehende Daten nicht bricht.
Migration `015_customers.sql` legt die Tabelle an und füllt sie aus
`contracts`, `tariff_changes`, `notes` und `leads` per `distinct`.

Damit kehrt sich die Beziehung um: Verträge hängen am Kunden, statt ihn zu
definieren. Ein Anrufer ohne Vertrag ist ab jetzt ein vollwertiger Kunde.

### Neu: `calls`

Die Daten liest `src/timio-content.js` heute bereits — sie verfallen nur.

```
calls
  id                uuid
  customer_number   text null        -- unbekannte Anrufer sind erlaubt
  caller_name       text
  caller_number     text
  direction         text             -- inbound | outbound
  queue_group       text
  started_at        timestamptz
  ended_at          timestamptz
  duration_s        int
  agent_id          uuid
  outcome           text null
  note              text null
  jira_ticket       text null
```

`customer_number` ist bewusst nullable: Nicht jeder Anrufer ist zuzuordnen,
und ein Anruf ohne Zuordnung ist immer noch wertvoller als kein Anruf.

### Datenschutz

`calls` und `customers` enthalten personenbezogene Daten und gehören damit in
dieselbe Behandlung wie der Rest des CRM: RLS-Policies analog zu `contracts`,
Eintrag in `purgeCustomerData()` für das Recht auf Vergessenwerden, Protokoll
im `audit_log`. Die Aufbewahrungsfrist für `calls` ist zu klären (Vorschlag:
90 Tage, dann automatische Anonymisierung der Rufnummer).

## Ausbaustufen

### Stufe 1 — Der Anrufer bekommt ein Gesicht *(umgesetzt)*

Die Fünf-Sekunden-Frage lösen: Wer ruft an, und was wissen wir über ihn?

- Migration `017_customers.sql` inklusive Backfill
- CRM: `customers` wird geladen und im Store gehalten; `CustomerDetail` zeigt
  auch Kunden ohne Vorgang; `Customers.tsx` listet sie mit
- Extension: Anbindung an Supabase (siehe „Anmeldung" unten)
- Extension: Bei eingehendem Anruf Kundennummer → Lookup → Kundenakte im
  timio-Cockpit und im Jira-Panel
- Fällt dabei ab: Der JQL-Link-Workaround wird überflüssig. Die Kundennummer
  findet das Jira-Ticket künftig über das CRM, weil `jiraTicket` an jedem
  Vorgang hängt.

### Stufe 2 — Der Anruf wird Teil der Akte *(umgesetzt)*

- Migration `018_calls.sql`
- Extension schreibt Anrufe automatisch mit
- CRM: Anrufhistorie in `CustomerDetail`, Live-Anrufleiste in der Titlebar
- Damit sieht der Chef erstmals Anrufaufkommen neben Provision

### Stufe 3 — Ein Gespräch, eine Erfassung *(umgesetzt)*

Heute: dreimal dieselbe Kundennummer eintippen (timio-Notiz, Jira-Kommentar,
CRM-Erfassung). Künftig ein Formular am Gesprächsende, dort wo der Bearbeiter
ohnehin sitzt — im timio-Cockpit.

Umgesetzt mit allen vier Eintragstypen von Anfang an (Notiz, Lead, Vertrag,
Tarifwechsel — inklusive nachgebauter Provisionsmathematik und
Produktkatalog-Anbindung) sowie eigenen Abschluss-Flüssen für ein- und
ausgehende Anrufe. Jeder erfolgreiche Eintrag wird zusätzlich im
`audit_log` protokolliert, damit Schreiben über die Extension nicht an der
DSGVO-Nachvollziehbarkeit vorbeiläuft, die für CRM-eigene Erfassungen
bereits gilt.

**Mitschreiben während des Gesprächs, nicht erst danach.** Das Cockpit
bekommt ein freies Notizfeld, das während des laufenden Anrufs offen bleibt —
Stichpunkte reichen, formuliert wird nicht live. Nach Auflegen macht die
lokale KI daraus eine polierte **interne Notiz** fürs CRM. Kein Neubau: das
Notizfeld (`state.ai.callNotes`), das automatische Aufräumen beim Tippen
(`cleanCallNotes()`) und die Umwandlung in einen Text-Entwurf
(`useCallDraft()`) existieren im Cockpit bereits für den Jira-Kommentar —
Stufe 3 verdrahtet denselben Weg zusätzlich auf einen CRM-Notiz-Datensatz statt
nur auf die Zwischenablage.

Ein Abschluss erzeugt in einem Rutsch:
- CRM-Eintrag (Notiz — aus den Gesprächsstichpunkten von der lokalen KI
  formuliert —, Lead, Vertrag oder Tarifwechsel)
- Jira-Ticket-Text in der Zwischenablage (siehe unten)
- optionale Wiedervorlage

Der bestehende `callOutcome`-Staffelstab ist genau dieses Muster — ihm fehlt
nur das Ziel.

### Stufe 4 — Ein Vokabular

- Gemeinsames Paket für Typen, Provisionslogik und Design-Tokens
- Befehlspalette (⌘K) auch in Jira und timio, mit denselben Ergebnissen
- Die Extension verliert ihren eigenen Produktnamen

### Stufe 5 — Das Cockpit verlässt den Browser

Unabhängig von 3 und 4, sobald 1+2 stehen (also ab jetzt startbar). Das
Cockpit lebt heute als DOM-Overlay in einem timio- oder Jira-Tab — wechselt
der Bearbeiter das Fenster (Mail, Slack, ein zweiter Monitor), verschwindet
es. Ein Browser-Tab kann grundsätzlich nicht außerhalb des Browserfensters
zeichnen; „immer sichtbar, über allem" ist eine Eigenschaft des
Betriebssystem-Fensters, keine, die sich in einer Extension nachbauen lässt.

**Lösung: ein kleiner nativer Desktop-Begleiter**, kein Ersatz für die
Extension, sondern eine zweite, dünne Oberfläche auf denselben Daten:

- Rahmenloses Fenster mit `alwaysOnTop`-Flag (unter Windows `WS_EX_TOPMOST`,
  unter macOS ein entsprechendes `NSWindowLevel`) — eine Zeile Konfiguration
  in Tauri oder Electron, keine Betriebssystem-Programmierung.
- **Tauri statt Electron** empfohlen: nutzt das System-Webview statt ein
  eigenes Chromium mitzubringen, dadurch spürbar kleinere und genügsamere App.
- Datenschicht komplett wiederverwendbar: dieselbe Supabase-Realtime-
  Anbindung auf `calls`, derselbe `customer_card()`-Aufruf, dieselbe Login-
  Logik wie in `extension/src/supabase.js` — praktisch Copy-Paste in eine
  andere Hülle, kein neuer Server, keine neue RLS.
- Login folgt Option **(a)** aus „Anmeldung" unten — dieselbe Entscheidung,
  die die Extension bereits umsetzt, hier nur ein zweites Mal.
- Neu ist nur die UI-Schicht: kompakteres Cockpit als heute (Wartefeld kommt
  weiterhin aus dem Portal-Tab, das bleibt Browser-Aufgabe), plus das
  Tauri-Projekt-Setup selbst.
- **Das Notizfeld aus Stufe 3 (Mitschreiben während des Gesprächs → lokale KI
  → interne Notiz) ist eine harte Anforderung an Stufe 5, kein Nice-to-have.**
  Es muss im Desktop-Cockpit tatsächlich funktionieren. Tauri nutzt kein
  Chromium (macOS: WKWebView, Windows: WebView2) — die Prompt API des
  Host-Webviews scheidet damit als Grundlage aus, unabhängig von diesem
  konkreten Notizfeld. Das ist der Auslöser für die grundsätzliche
  Entscheidung „weg von Chrome, hin zu Ollama" (siehe eigener Abschnitt unten)
  — das Desktop-Cockpit spricht dieselbe lokale Ollama-Instanz an wie die
  Extension, kein separates Modell nur für Stufe 5.

Der größte reale Aufwand ist nicht der Code, sondern die **Verteilung**:
macOS verlangt für eine reibungslose Installation eine Notarisierung,
Windows im Idealfall ein Code-Signing-Zertifikat — sonst Warnmeldungen beim
ersten Start. Siehe „Offene Punkte" unten.

## Der Jira-Baustein: Text statt API

Ein Knopf „Jira-Text kopieren" im CRM und im Cockpit erzeugt einen fertig
formatierten Ticket-Text und legt ihn in die Zwischenablage. Eingefügt wird
von Hand.

Das ist bewusst kein API-Aufruf. Es hält die Integration robust gegen
Jira-Änderungen, braucht keine Zugangsdaten, keine Rechte, kein Vertrauen in
fremde Schnittstellen — und ist exakt das Muster, mit dem der Outbound-Modus
heute schon wählt.

Der Text entsteht aus dem Kontext, der ohnehin vorliegt: Kunde, Kundennummer,
Anliegen, Gesprächsverlauf, nächster Schritt. Formulieren übernimmt die lokale
KI; ohne verfügbare KI greift eine Vorlage.

## Anmeldung — offene Entscheidung

Damit die Extension Supabase lesen und schreiben kann, braucht sie eine
Sitzung. Drei Wege, keiner davon geschenkt:

**a) Eigener Login in der Extension** (Name + PIN, gleiche Maske wie im CRM).
Technisch sauber, eigene Sitzung in `chrome.storage.local`, kein Konflikt.
Kostet einen einmaligen zusätzlichen Anmeldeschritt.

**b) Sitzung aus dem CRM-Tab übernehmen.** Der Client legt sie unter
`crm-tng-sb-auth` in `localStorage` ab, ein Content-Script auf der CRM-Domain
käme heran. Klingt eleganter, hat aber ein ungeprüftes Problem: Supabase
rotiert Refresh-Tokens, zwei Clients auf demselben Token können sich
gegenseitig abmelden. **Vor einer Entscheidung zu verifizieren.**

**c) Der CRM-Tab als Stellvertreter.** Die Extension schickt Anfragen an den
offenen CRM-Tab, der sie mit seinem Client ausführt. Keine Token-Probleme,
aber funktioniert nur bei offenem CRM-Tab.

Empfehlung: **(a)**, bis (b) verifiziert ist. Der Eindruck „ein Produkt"
entsteht ohnehin nicht durch gesparte Logins, sondern durch identische Optik
und gemeinsame Daten.

## Die lokale KI: weg von Chrome, hin zu einem gemeinsamen Modell

**Entscheidung:** Chromes Prompt API (`globalThis.LanguageModel` /
Gemini Nano) wird abgelöst — nicht nur für Stufe 5 (dort ist sie ohnehin
nicht verfügbar, siehe dort), sondern überall. Grund ist nicht nur die
fehlende Verfügbarkeit im Tauri-Webview, sondern auch, dass die heutige
Lösung selbst schon fragil ist: sie hängt an einem experimentellen
Chrome-Flag und einem manuellen Modell-Download (`chrome://components`),
den jede neue Installation einzeln erledigen muss.

**Neues Fundament: ein lokal installierter Ollama-Dienst**, den Extension
*und* Desktop-Cockpit gleichermaßen über `localhost` ansprechen — ein
Modell, ein Verhalten, eine Installation, egal auf welcher Oberfläche
gerade gearbeitet wird. Modellempfehlung: Gemma 2/3 (2B–4B) oder Qwen2.5 3B
— ähnliche Größenklasse wie das bisherige Gemini Nano, mit dem der
bisherige Qualitätseindruck entstanden ist, und für deutsche Texte
brauchbar.

**Wichtig: Ollama ist ein eigenständiger Hintergrunddienst, keine
Zutat des Desktop-Cockpits.** Die Extension bekommt KI-Fähigkeit über
Ollama unabhängig davon, ob überhaupt jemand die Tauri-App aus Stufe 5
installiert hat — sonst würde eine heute funktionierende, App-freie
Extension plötzlich einen nativen App-Download voraussetzen, nur um ihre
bestehenden KI-Funktionen zu behalten. Fehlt Ollama, degradiert die
Extension wie heute schon bei fehlender Chrome-KI: klarer Hinweis statt
Cloud-Fallback, lokale Regelprüfung statt KI-Qualitätscheck.

**Größenordnung ehrlich benannt:** Das ist kein Austausch einer Zeile Code.
`src/local-ai.js` (36 KB) treibt praktisch jede KI-Funktion der Extension —
Zusammenfassung, Triage, Antwort-Entwürfe, Qualitätscheck, Team-Doku,
Anrufvorbereitung. Diese Umstellung ist ein eigenständiges
Migrationsprojekt neben Stufe 5, nicht Teil davon.

Das CRM bekommt KI-Funktionen weiterhin über die Extension: ein
Content-Script auf der CRM-Domain nimmt Anfragen der Seite entgegen, leitet
sie an Ollama weiter (statt wie bisher an `src/local-ai.js`s
Chrome-API-Aufruf) und gibt das Ergebnis zurück. Das CRM selbst braucht
weiterhin keine eigene KI-Schicht.

Die Grenze bleibt scharf, ändert sich durch den Modellwechsel nicht:

- Kundendaten ins eigene Supabase — kein Bruch der Zusage, das ist der Ort,
  an dem diese Daten ohnehin leben, mit RLS, Audit-Log und Löschrecht.
- Ticketinhalte und Gesprächstexte an ein Sprachmodell — ausschließlich
  auf dem Gerät, jetzt via Ollama statt via Chrome.

## Offene Punkte

- ~~Wo läuft das CRM produktiv?~~ Geklärt: `https://crm-tng.vercel.app/`
  (Vercel). Diese Domain kommt in `host_permissions` und ans Content-Script.
- **Verteilung der Extension.** Chrome Web Store, Enterprise-Policy oder
  entpackt geladen? Bestimmt, wie tief integriert werden kann.
- ~~Prompt-API-Status für Webseiten~~ Hinfällig — Chromes Prompt API wird
  komplett durch Ollama abgelöst (siehe „Die lokale KI: weg von Chrome").
- **Aufbewahrungsfrist für `calls`.**
- **Refresh-Token-Rotation** bei geteilter Sitzung.
- **Verteilung des Desktop-Cockpits (Stufe 5).** Tauri vs. Electron final
  entscheiden; Code-Signing/Notarisierung für Windows/macOS klären, sonst
  Sicherheitswarnungen beim ersten Start. Bestimmt auch den
  Auto-Update-Mechanismus.
- **Ollama-Rollout.** Welches Modell genau (Gemma 2/3 vs. Qwen2.5, Größe
  2B–4B), automatischer Download/Update des Modells oder manueller Schritt
  bei der Installation, wie die Extension erkennt und meldet, dass Ollama
  fehlt oder nicht läuft (heute: Hinweis + Regelprüfung statt KI).
- **Migration von `local-ai.js` auf Ollama.** Eigenständiges Projekt: alle
  bestehenden KI-Funktionen (Zusammenfassung, Triage, Antwort-Entwürfe,
  Qualitätscheck, Team-Doku, Anrufvorbereitung) von der Chrome-Prompt-API
  auf Ollama-Aufrufe umstellen, ohne die heutige Qualität/das Prompting zu
  verschlechtern.

## Sicherheitsbefund im CRM-Repo

Die `.env` mit Projekt-URL und anon key war eingecheckt, obwohl die README das
Gegenteil behauptet — bei einem öffentlich klonbaren Repository sind die Werte
damit öffentlich. Auf diesem Branch ist sie aus der Versionsverwaltung
entfernt und `.gitignore` ergänzt.

Noch offen, weil nur außerhalb des Repos lösbar: Die Datei bleibt in der
Git-Historie (anon key rotieren!), und die RLS-Policies sollten gezielt gegen
anonyme Zugriffe geprüft werden, denn sie tragen die Absicherung allein.
Grundsatzfrage dahinter: ob ein internes Firmenwerkzeug ein öffentliches
Repository sein sollte.
