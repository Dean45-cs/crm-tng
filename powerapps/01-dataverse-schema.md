# 01 — Dataverse Datenmodell

Publisher-Präfix: **`tng`** (Schema-Namen wie `tng_contract`). Alle Tabellen sind
**user-/team-owned** (nicht organisation-owned), damit Ownership + Sharing wie in
der RLS funktionieren (siehe `02-security-model.md`).

Legende Datentypen: `Text` = Single Line of Text · `Memo` = Multiple Lines of Text ·
`Choice` = Option Set (lokal/global) · `Decimal`/`Currency` · `DateOnly` · `DateTime` ·
`YesNo` · `Lookup(→Tabelle)` · `Owner` = Standard-Owner-Spalte.

> Dataverse legt automatisch an: `createdon`, `createdby`, `modifiedon`,
> `modifiedby`, `ownerid`, `statecode/statuscode`. **`created_by` aus Supabase →
> `createdby`/`ownerid`.** Diese Spalten werden unten **nicht** wiederholt.

---

## Globale Choices (Option Sets)

| Choice | Werte (Label = intern) |
|--------|------------------------|
| `tng_productcategory` | Privat (1) · Business (2) · Zusatz (3) |
| `tng_contractstatus` | Offen (1) · Aktiv (2) · Storniert (3) |
| `tng_laufzeit` | 12 Monate (12) · 24 Monate (24) |
| `tng_changetype` | Sidegrade/VVL (1) · Upgrade (2) |
| `tng_context` | Restlaufzeit > 3 Monate (1) · Restlaufzeit < 3 Monate (2) · Außerhalb MVLZ (3) |
| `tng_leadstatus` | Neu (1) · In Bearbeitung (2) · Gewonnen (3) · Verloren (4) |
| `tng_leadpriority` | Normal (1) · Hoch (2) · Dringend (3) |
| `tng_incentivemechanic` | Zielprämie (1) · Wettbewerb (2) |
| `tng_incentivemetric` | Provision (1) · Verträge (2) · Abschlüsse (3) |
| `tng_incentiveperiod` | Wöchentlich (1) · Monatlich (2) |
| `tng_leadactivitytype` | Kontakt (1) · Notiz (2) |
| `tng_accessstatus` | Offen (1) · Genehmigt (2) · Abgelehnt (3) |

> Choices ersetzen die Postgres-`check`-Constraints (z. B. `status in
> ('offen','aktiv','storniert')`). Die internen Zahlenwerte sind frei wählbar,
> müssen aber in den Power-Fx-Formeln (Datei 04) konsistent referenziert werden —
> dort über die **Choice-Labels**, nicht über Zahlen.

---

## Tabellen

### 1. `tng_product` — Produkt  *(Stammdaten, ersetzt `shared_settings.products`)*
Empfohlen **organization-owned** (Stammdaten, für alle gleich).

| Spalte | Typ | Notiz |
|--------|-----|-------|
| `tng_name` | Text | **Primary Name.** Produktname, z. B. „Premium 1000". Alternate Key (unique). |
| `tng_category` | Choice `tng_productcategory` | |
| `tng_commission` | Currency (EUR) | Provisionssatz |
| `tng_active` | YesNo | Standard Ja |

### 2. `tng_tariffrate` — Tarifwechsel-Provision  *(ersetzt `shared_settings.tariff_commission`)*
Organization-owned. **6 Zeilen** (2 Typen × 3 Kontexte).

| Spalte | Typ | Notiz |
|--------|-----|-------|
| `tng_name` | Text | Primary Name, z. B. „Upgrade · MVLZ < 3" |
| `tng_changetype` | Choice `tng_changetype` | |
| `tng_context` | Choice `tng_context` | |
| `tng_amount` | Currency (EUR) | Provision |

### 3. `tng_customer` — Kunde
**Neu als echte Tabelle** (im React-CRM wird der Kunde aus den Vorgängen
abgeleitet). In Dataverse ist eine eigene Tabelle sauberer — sie trägt die
**Ownership** (= Besitzer:in/Sharing aus `customer_ownerships`).

| Spalte | Typ | Notiz |
|--------|-----|-------|
| `tng_customernumber` | Text | **Primary Name** + **Alternate Key (unique)**. Kundennummer, z. B. „K-10234". |
| `tng_displayname` | Text | Kundenname |
| `ownerid` | Owner | = `customer_ownerships.owner`. Sharing → Dataverse-Datensatzfreigabe. |

### 4. `tng_contract` — Vertrag

| Spalte | Typ | Notiz |
|--------|-----|-------|
| `tng_name` | Text (Autonummer) | Primary Name, z. B. „VTR-{SEQNUM:00000}" |
| `tng_customer` | Lookup(→`tng_customer`) | ersetzt `customer_number` + `customer_name` |
| `tng_contractdate` | DateOnly | Pflicht |
| `tng_status` | Choice `tng_contractstatus` | Pflicht |
| `tng_jiraticket` | Text | optional, Validierung siehe 04 |
| `tng_followupdate` | DateOnly | optional (Wiedervorlage) |
| `tng_laufzeit` | Choice `tng_laufzeit` | optional (leer = unbefristet) |
| `tng_notes` | Memo | optional |
| `tng_commission` | Currency | berechnet — Rollup **oder** Power Fx (siehe 04). Storno ⇒ 0. |

Produkte eines Vertrags ⇒ Kind-Tabelle (1:N):

### 5. `tng_contractproduct` — Vertragsprodukt  *(ersetzt `products jsonb[]`)*

| Spalte | Typ | Notiz |
|--------|-----|-------|
| `tng_name` | Text (Autonummer) | Primary Name |
| `tng_contract` | Lookup(→`tng_contract`) | Pflicht, Parent (Kaskaden-Löschung) |
| `tng_product` | Lookup(→`tng_product`) | Pflicht |
| `tng_commissionsnapshot` | Currency | Provision **zum Verkaufszeitpunkt** (= `tng_product.tng_commission` bei Anlage). Verhindert rückwirkende Änderung bei Satz-Anpassung. |

### 6. `tng_tariffchange` — Tarifwechsel

| Spalte | Typ | Notiz |
|--------|-----|-------|
| `tng_name` | Text (Autonummer) | Primary Name |
| `tng_customer` | Lookup(→`tng_customer`) | |
| `tng_changetype` | Choice `tng_changetype` | Pflicht |
| `tng_context` | Choice `tng_context` | Pflicht |
| `tng_oldproduct` | Lookup(→`tng_product`) | optional |
| `tng_newproduct` | Lookup(→`tng_product`) | optional |
| `tng_changedate` | DateOnly | Pflicht |
| `tng_jiraticket` | Text | optional |
| `tng_notes` | Memo | optional |
| `tng_exportedon` | DateTime | gesetzt nach SharePoint-Export |
| `tng_commission` | Currency | aus `tng_tariffrate` (siehe 04) |

### 7. `tng_note` — Notiz

| Spalte | Typ | Notiz |
|--------|-----|-------|
| `tng_title` | Text | **Primary Name**, Pflicht |
| `tng_customer` | Lookup(→`tng_customer`) | optional |
| `tng_content` | Memo | Pflicht |
| `tng_jiraticket` | Text | optional |

### 8. `tng_lead` — Lead

| Spalte | Typ | Notiz |
|--------|-----|-------|
| `tng_name` | Text | **Primary Name** = Kundenname, Pflicht |
| `tng_customernumber` | Text | optional |
| `tng_phone` | Text | optional |
| `tng_topic` | Text | optional (Anliegen) |
| `tng_status` | Choice `tng_leadstatus` | Standard „Neu" |
| `tng_priority` | Choice `tng_leadpriority` | Standard „Normal" |
| `tng_followupdate` | DateOnly | optional |
| `tng_notes` | Memo | optional |

### 9. `tng_leadactivity` — Lead-Aktivität  *(Kind von Lead)*

| Spalte | Typ | Notiz |
|--------|-----|-------|
| `tng_name` | Text (Autonummer) | Primary Name |
| `tng_lead` | Lookup(→`tng_lead`) | Pflicht, Parent (Kaskaden-Löschung) |
| `tng_type` | Choice `tng_leadactivitytype` | |
| `tng_content` | Memo | bei Typ „Notiz" |

### 10. `tng_incentive` — Incentive (Team-Ziel/Wettbewerb)

| Spalte | Typ | Notiz |
|--------|-----|-------|
| `tng_title` | Text | **Primary Name** |
| `tng_mechanic` | Choice `tng_incentivemechanic` | |
| `tng_metric` | Choice `tng_incentivemetric` | |
| `tng_period` | Choice `tng_incentiveperiod` | |
| `tng_target` | Decimal | nur bei „Zielprämie" relevant |
| `tng_reward` | Text | Belohnung |
| `tng_active` | YesNo | Standard Ja |

### 11. `tng_accessrequest` — Zugriffsanfrage  *(ersetzt `customer_access_requests`)*

| Spalte | Typ | Notiz |
|--------|-----|-------|
| `tng_name` | Text (Autonummer) | Primary Name |
| `tng_customer` | Lookup(→`tng_customer`) | Pflicht |
| `tng_requester` | Lookup(→`systemuser`) | Anfragende:r |
| `tng_owner` | Lookup(→`systemuser`) | Besitzer:in z. Zeitpunkt |
| `tng_comment` | Memo | Begründung |
| `tng_status` | Choice `tng_accessstatus` | Standard „Offen" |
| `tng_decidedon` | DateTime | |
| `tng_decidedby` | Lookup(→`systemuser`) | |

> **Eindeutigkeit „nur eine offene Anfrage pro Kunde+Anfragende:r"** (Postgres
> `uniq_pending_access_request`): in Dataverse über **Alternate Key** auf
> (`tng_customer`,`tng_requester`,`tng_status`) **nicht** direkt abbildbar, weil
> Keys keine Teilbedingung haben. Stattdessen vor dem Anlegen per Power Fx prüfen
> (siehe 04, `CanCreateAccessRequest`).

### 12. `tng_userprofile` — App-Profil  *(1:1 zu `systemuser`, ersetzt App-Flags aus `public.users`)*
Die Identität (Name, E-Mail, Aktiv/Inaktiv) kommt aus **Entra/`systemuser`**.
Hier nur App-spezifische Flags:

| Spalte | Typ | Notiz |
|--------|-----|-------|
| `tng_user` | Lookup(→`systemuser`) | **Alternate Key (unique)** |
| `tng_monthlytarget` | Currency | = `user_settings.monthly_target` |
| `tng_leaderboardoptin` | YesNo | Standard Ja |
| `tng_onboardingcompleted` | YesNo | Standard Nein |
| `tng_consentgivenon` | DateTime | DSGVO-Einwilligung (Art. 13) |

> **Rolle (`role`):** **nicht** als Spalte — das ist eine **Sicherheitsrolle**
> (`TNG Chef` vs. `TNG Vertrieb`, siehe 02). **`is_active`:** Entra-Benutzer
> aktiviert/deaktiviert. Das ersetzt `is_active` + `prevent_user_privilege_change`
> (nur Admins vergeben Rollen).

---

## Audit (DSGVO Art. 30)

- **Dataverse-Auditing** auf den Tabellen `tng_contract`, `tng_tariffchange`,
  `tng_note`, `tng_customer`, `tng_lead`, `tng_userprofile` aktivieren →
  protokolliert Anlage/Änderung/Löschung **unveränderlich**, ersetzt das
  `audit_log` für Datenänderungen.
- App-Ereignisse ohne Datensatzbezug (Login, Consent, Export, Rollenwechsel):
  **Entra-Anmeldeprotokolle** (Login) + optionale Tabelle **`tng_auditevent`**
  (`tng_action` Choice, `tng_entitytype` Text, `tng_entityid` Text,
  `tng_actorname` Text, `tng_details` Memo) für Consent/Export. In der App per
  `Patch()` schreiben, kein Update/Delete erlauben (Rollen-Privilegien).

## „Recht auf Vergessenwerden" (Art. 17)
Die Supabase-`purgeCustomerData()` (löscht Verträge/Tarife/Notizen/Ownership zu
einer KdNr.) wird in Dataverse durch **Kaskaden-Löschung** abgebildet: Beziehung
`tng_customer` → (`tng_contract`,`tng_tariffchange`,`tng_note`) auf
**Parental/Kaskaden-Löschen** setzen ⇒ Löschen des Kunden entfernt alle Spuren.
`tng_contract` → `tng_contractproduct` und `tng_lead` → `tng_leadactivity`
ebenfalls kaskadierend.
