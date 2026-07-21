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

### Stufe 1 — Der Anrufer bekommt ein Gesicht *(Startpunkt)*

Die Fünf-Sekunden-Frage lösen: Wer ruft an, und was wissen wir über ihn?

- Migration `015_customers.sql` inklusive Backfill
- CRM: `customers` wird geladen und im Store gehalten; `CustomerDetail` zeigt
  auch Kunden ohne Vorgang; `Customers.tsx` listet sie mit
- Extension: Anbindung an Supabase (siehe „Anmeldung" unten)
- Extension: Bei eingehendem Anruf Kundennummer → Lookup → Kundenakte im
  timio-Cockpit und im Jira-Panel
- Fällt dabei ab: Der JQL-Link-Workaround wird überflüssig. Die Kundennummer
  findet das Jira-Ticket künftig über das CRM, weil `jiraTicket` an jedem
  Vorgang hängt.

### Stufe 2 — Der Anruf wird Teil der Akte

- Migration `016_calls.sql`
- Extension schreibt Anrufe automatisch mit
- CRM: Anrufhistorie in `CustomerDetail`, Live-Anrufleiste in der Titlebar
- Damit sieht der Chef erstmals Anrufaufkommen neben Provision

### Stufe 3 — Ein Gespräch, eine Erfassung

Heute: dreimal dieselbe Kundennummer eintippen (timio-Notiz, Jira-Kommentar,
CRM-Erfassung). Künftig ein Formular am Gesprächsende, dort wo der Bearbeiter
ohnehin sitzt — im timio-Cockpit.

Ein Abschluss erzeugt in einem Rutsch:
- CRM-Eintrag (Notiz, Lead, Vertrag oder Tarifwechsel)
- Jira-Ticket-Text in der Zwischenablage (siehe unten)
- optionale Wiedervorlage

Der bestehende `callOutcome`-Staffelstab ist genau dieses Muster — ihm fehlt
nur das Ziel.

### Stufe 4 — Ein Vokabular

- Gemeinsames Paket für Typen, Provisionslogik und Design-Tokens
- Befehlspalette (⌘K) auch in Jira und timio, mit denselben Ergebnissen
- Die Extension verliert ihren eigenen Produktnamen

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

## Die lokale KI als Dienst der Extension

Die Prompt API (`globalThis.LanguageModel`) ist in Extensions verlässlich
verfügbar. Für normale Webseiten ist ihr Status zu prüfen — falls sie dort
nicht stabil ist, gilt der robuste Weg:

**Die Extension stellt dem CRM die KI zur Verfügung.** Ein Content-Script auf
der CRM-Domain nimmt Anfragen der Seite entgegen, lässt sie durch
`src/local-ai.js` laufen und gibt das Ergebnis zurück. Das CRM bekommt damit
KI-Funktionen, ohne selbst eine KI-Schicht zu brauchen — und die Extension
wird vom Beiwerk zum unverzichtbaren Teil.

Die Grenze bleibt scharf:

- Kundendaten ins eigene Supabase — kein Bruch der Zusage, das ist der Ort,
  an dem diese Daten ohnehin leben, mit RLS, Audit-Log und Löschrecht.
- Ticketinhalte und Gesprächstexte an ein Sprachmodell — ausschließlich
  auf dem Gerät.

## Offene Punkte

- ~~Wo läuft das CRM produktiv?~~ Geklärt: `https://crm-tng.vercel.app/`
  (Vercel). Diese Domain kommt in `host_permissions` und ans Content-Script.
- **Verteilung der Extension.** Chrome Web Store, Enterprise-Policy oder
  entpackt geladen? Bestimmt, wie tief integriert werden kann.
- **Prompt-API-Status für Webseiten** (siehe oben).
- **Aufbewahrungsfrist für `calls`.**
- **Refresh-Token-Rotation** bei geteilter Sitzung.

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
