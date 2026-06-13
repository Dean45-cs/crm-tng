# 02 — Sicherheitsmodell (ersetzt Row Level Security)

Die Supabase-RLS-Policies werden in Dataverse durch **Sicherheitsrollen +
Datensatz-Ownership + Freigabe (Sharing)** abgebildet. Das ist Dataverse-Standard
und braucht **keinen eigenen Code** — das ersetzt `schema.sql` Zeilen 228–471
komplett.

## Zwei Sicherheitsrollen

| Rolle | Entspricht | Kernrechte |
|-------|------------|-----------|
| **TNG Vertrieb** | `role = 'agent'` | Eigene Datensätze schreiben; alle lesen; fremde nur via Freigabe bearbeiten |
| **TNG Chef** | `role = 'manager'` / `auth_is_manager()` | Organisationsweit lesen **und** schreiben/löschen; Incentives verwalten; Audit lesen |

Rollenzuweisung macht **nur ein Admin** (oder über Entra-Sicherheitsgruppen, die
auf Dataverse-Rollen gemappt sind). Das ersetzt den Trigger
`prevent_user_privilege_change` — Privilege-Escalation ist strukturell
ausgeschlossen, weil Endnutzer keine Rollen vergeben können.

## Privileg-Tabelle (Access Level pro Tabelle)

Access Levels in Dataverse: **None · User (eigene) · Business Unit · Parent:Child BU · Organization (alle)**.

| Tabelle | TNG Vertrieb (Read / Write / Delete / Create) | TNG Chef |
|---------|----------------------------------------------|----------|
| `tng_customer` | Org / User / User / Org | Org / Org / Org / Org |
| `tng_contract` | Org / User / User / Org | Org / Org / Org / Org |
| `tng_tariffchange` | Org / User / User / Org | Org / Org / Org / Org |
| `tng_note` | Org / User / User / Org | Org / Org / Org / Org |
| `tng_contractproduct` | Org / User / User / Org | Org / Org / Org / Org |
| `tng_lead` | Org / Org / Org / Org | Org / Org / Org / Org |
| `tng_leadactivity` | Org / Org / User / Org | Org / Org / Org / Org |
| `tng_incentive` | Org / **None** / **None** / **None** | Org / Org / Org / Org |
| `tng_product`, `tng_tariffrate` | Org / **None** / **None** / **None** | Org / Org / Org / Org |
| `tng_userprofile` | User+Read-Org / User / None / User | Org / Org / Org / Org |
| `tng_accessrequest` | User+Create / User / None / User | Org / Org / Org / Org |
| `tng_auditevent` | **None** / None / None / Create | Org / None / None / Create |

**So entsprechen sich die Regeln:**

- *„aktive Nutzer lesen alles"* (`... read all using auth_is_active()`)
  → **Read = Organization** für Vertrieb. „Aktiv" = Entra-Benutzer aktiviert.
- *„Bearbeiten nur Ersteller/Owner/Co-Owner/Chef"* (contracts/tariff/notes update)
  → **Write = User** (eigene/zugewiesene) + **Freigabe** für Co-Owner; Chef = Org.
- *„Leads: alle dürfen alles"* (`leads ... all`)
  → **Org** auf allen vier Rechten für beide Rollen.
- *„Incentives: schreiben nur Chefs"*
  → Vertrieb None auf Write/Create/Delete, Chef Org.
- *„Audit-Log: nur Manager lesen; jeder schreibt eigene; immutable"*
  → `tng_auditevent`: nur Create für alle, Read nur Chef, **kein** Update/Delete
  (keine Rolle bekommt das Recht) ⇒ unveränderlich.

## Ownership & Sharing (ersetzt `customer_ownerships` + Access Requests)

- **Owner** eines `tng_customer`/`tng_contract`/… = der `ownerid` (Standard-Spalte).
  Das ist der „Besitzer" aus `customer_ownerships.owner`.
- **`shared_with[]`** → **Dataverse-Datensatzfreigabe** (Share-Privileg). Der/die
  Owner:in (oder Chef) teilt den Kundendatensatz mit „Read+Write" an Kolleg:innen.
- **Verwaiste Kunden** (im React-CRM: ohne Owner für alle bearbeitbar) → in
  Dataverse hat jeder Datensatz immer einen Owner. Gleicher Effekt über Chef-
  Zuweisung oder eine Team-Owned-Variante. Standard: Owner = Ersteller:in.

### Zugriffsanfrage-Workflow (`customer_access_requests`)
1. Vertrieb ohne Rechte legt `tng_accessrequest` an (Status „Offen", mit Begründung).
2. Owner:in oder Chef sieht die Anfrage (Power-Automate-Benachrichtigung optional),
   setzt Status „Genehmigt" **und teilt** den `tng_customer`-Datensatz (Read+Write).
   Ablehnen ⇒ Status „Abgelehnt".

Das Teilen kann ein **Power-Automate-Flow** automatisch erledigen, wenn Status auf
„Genehmigt" wechselt (`Share Row`-Aktion) — so wird aus der Genehmigung sofort
echter Zugriff, genau wie die alte `updateAccessRequestStatus` + `upsertOwnership`.

## Spaltensicherheit (optional)
Sensible Felder (z. B. Telefonnummern in Leads) lassen sich per **Field Level
Security Profile** zusätzlich einschränken — über RLS hinaus.

## Was an Custom-Code wegfällt
| Supabase-Mechanismus | Ersatz |
|----------------------|--------|
| `auth_is_active()`, `auth_is_manager()` (Security-Definer-Funktionen) | Rollen + Benutzerstatus (nativ) |
| `prevent_user_privilege_change`-Trigger | Nur Admin vergibt Rollen |
| `users_exist()` Bootstrap | entfällt (Admin legt ersten Chef an) |
| Login-Throttle (`loginThrottle.ts`) | Entra Smart Lockout + Conditional Access |
| 12 × RLS-Policy-Blöcke | obige Privileg-Tabelle (zusammengeklickt) |
