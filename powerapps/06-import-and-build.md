# 06 — Import & Bau (Schritt für Schritt)

Das ist der **einzige Teil, der in eurem Microsoft-Tenant passieren muss.**
Voraussetzungen: Microsoft-365-Tenant mit Power-Platform-Zugang, ein Konto mit
**Systemadministrator** (Power Platform) und **Power Apps per user**-Lizenz
(Dataverse = Premium, siehe 07).

## Schritt 0 — Environment (EU)
1. **Power Platform Admin Center** → *Environments* → *New*.
2. **Region: Europe** (Datenresidenz — der Grund der ganzen Migration).
3. **Dataverse: Ja** (Datenbank anlegen). Typ *Production*.

## Schritt 1 — Publisher & Solution
1. **make.powerapps.com** → richtiges Environment wählen.
2. *Solutions* → *New solution* → Name „TNG CRM", **Publisher** mit Präfix `tng`.
3. Alles Folgende **in diese Solution** anlegen (sauber transportierbar).

## Schritt 2 — Globale Choices
*Solution* → *New* → *More* → *Choice* — alle aus `01` Abschnitt „Globale Choices"
(z. B. `tng_contractstatus` mit Offen/Aktiv/Storniert). Erst Choices, dann Tabellen
(Spalten referenzieren sie).

## Schritt 3 — Tabellen & Spalten
Pro Tabelle aus `01`: *New* → *Table*, Primary-Name-Spalte setzen, dann Spalten
gemäß Tabelle. Reihenfolge:
1. `tng_product`, `tng_tariffrate` (Stammdaten, organization-owned)
2. `tng_customer` (user-owned)
3. `tng_contract`, dann `tng_contractproduct` (Lookup → contract + product)
4. `tng_tariffchange`, `tng_note`
5. `tng_lead`, dann `tng_leadactivity`
6. `tng_incentive`, `tng_accessrequest`, `tng_userprofile`, optional `tng_auditevent`

Beziehungen + **Kaskaden-Löschen** wie in `01` („Recht auf Vergessenwerden")
setzen. **Alternate Keys** anlegen: `tng_customer.tng_customernumber`,
`tng_product.tng_name`, `tng_userprofile.tng_user`.

### Optional: Tabellen per `pac` automatisieren
Wer Tabellen lieber skriptet, nutzt das **Power Platform CLI** (`pac`) lokal:
```bash
# einmalig: pac installieren (.NET-Tool)
dotnet tool install --global Microsoft.PowerApps.CLI.Tool

pac auth create --environment https://<deine-org>.crm4.dynamics.com
# Tabellen/Spalten als Solution-Komponenten anlegen oder eine vorbereitete
# (unmanaged) Solution-ZIP importieren:
pac solution import --path .\TNG_CRM_unmanaged.zip
pac solution publish
```
> Das fertige Solution-ZIP gibt es hier nicht (braucht einen Tenant zum Erzeugen).
> Wer es einmal in eurem Environment baut, kann es per `pac solution export`
> sichern und ins Repo legen — danach ist der Import ein Einzeiler.

## Schritt 4 — Stammdaten importieren (Seed)
1. **Produkte:** Tabelle `tng_product` → *Import* → *Import from Excel/CSV* →
   `seed/products.csv` (Spalten `name, category, commission, active`).
2. **Tarifsätze:** `tng_tariffrate` ← `seed/tariff-commission.csv`
   (`name, changetype, context, amount`) — 6 Zeilen.
3. **Auditing aktivieren** (Schritt vor Echtbetrieb): Environment-Settings →
   *Auditing* → ein; pro Tabelle (siehe 01) „Audit" anhaken.

## Schritt 5 — Canvas-App
**Variante A — aus YAML-Quelle paketieren** (`src/`):
```bash
pac canvas pack --sources .\powerapps\src --msapp .\TNG_CRM.msapp
# dann in make.powerapps.com: Apps → Import canvas app → TNG_CRM.msapp
```
> Die `src/*.pa.yaml` sind als **Referenz-/Startquelle** gedacht. Power-Apps-YAML
> ist versionsabhängig; nach dem ersten Import einmal in Studio öffnen, speichern,
> dann mit `pac canvas unpack` zurückschreiben — danach ist die Quelle exakt auf
> eure `pac`-Version normalisiert und sauber versionierbar.

**Variante B — in Studio bauen** (verlässlichste Methode):
1. *Apps* → *New app* → *Canvas* (Tablet-Layout).
2. Datenquellen verbinden: alle `tng_*`-Tabellen + `Users`/`Office 365 Users`.
3. `App.OnStart` / `App.Formulas` aus `03` + `04` einfügen (Theme, Helfer).
4. Screens nach `05` bauen: Shell → Dashboard → Verträge → Vertrag bearbeiten → Leads.
5. Restliche Screens nach `07`-Roadmap (gleiche Muster).

## Schritt 6 — Sicherheit
1. Zwei Sicherheitsrollen anlegen: **TNG Vertrieb** und **TNG Chef** mit den
   Access Levels aus `02`.
2. Rollen den Nutzern (oder Entra-Sicherheitsgruppen) zuweisen.
3. App **teilen** (Share) mit denselben Gruppen + Rolle mitgeben.
4. Optional: Power-Automate-Flow „Zugriffsanfrage genehmigt ⇒ `Share Row`" (siehe 02).

## Schritt 7 — Datenmigration (optional, echte Bestandsdaten)
Reihenfolge wegen Lookups: **Kunden → Produkte/Tarifsätze → Verträge →
Vertragsprodukte → Tarifwechsel → Notizen → Leads → Lead-Aktivitäten.** Quelle =
CSV-Export aus Supabase. Mapping-Hinweise:
- `created_by` (UUID) → Systembenutzer per **E-Mail** auflösen (nicht per UUID).
- `products jsonb[]` → je Element eine `tng_contractproduct`-Zeile, `snapshot` =
  damaliger Produkt-Provisionssatz.
- `customer_number`/`customer_name` → zuerst `tng_customer` anlegen, dann Verträge
  per Lookup auf KdNr. verknüpfen.
- Werkzeug: **Dataflows** (Power Query) oder `pac data import` mit Schema-Mapping.

## Schritt 8 — Veröffentlichen & abnehmen
*Publish* → mit Pilot-Nutzern testen → Checkliste aus `03` (Kontrast, Fokus,
Touch-Ziele) abhaken → ausrollen.
