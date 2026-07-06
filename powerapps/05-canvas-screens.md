# 05 — Canvas-Screens (Bauanleitung mit Power Fx)

Konkrete Bauanleitung der Kern-Screens. Jede Eigenschaft referenziert die Theme-
Tokens aus `03` und die Logik aus `04`. Layout per **Vertical/Horizontal
Container** (responsive), nicht per absoluter Position.

Allgemein:
- `App.Width/Height` responsive; `Screen.Fill = Theme.Background`.
- Schrift überall `Font = FontMain` (`Open Sans`).
- Karten = Container: `Fill = Theme.Surface`, `BorderColor = Theme.Border`,
  `BorderThickness = 1`, `RadiusTopLeft…= Radius.card`, `DropShadow = DropShadow.Light`.

---

## App-Shell / Navigation (Komponente `cmpSidebar`)
Linke Sidebar (Breite 240, `Fill = Theme.Primary`). Navigationseinträge als
Galerie über eine kleine In-Memory-Tabelle; Auswahl steuert die sichtbaren Screens
(oder echte `Navigate()`-Screens).

```powerfx
// App.OnStart — Navigationsmodell + Rolle
ClearCollect(colNav,
  { key:"dashboard", label:"Dashboard",   icon:Icon.Home },
  { key:"contracts", label:"Verträge",    icon:Icon.DetailList },
  { key:"tariffs",   label:"Tarifwechsel",icon:Icon.Sync },
  { key:"leads",     label:"Leads",       icon:Icon.People },
  { key:"notes",     label:"Notizen",     icon:Icon.Post },
  { key:"customers", label:"Kunden",      icon:Icon.Contact }
);
// Chef-Bereich nur für Manager (Sicherheitsrolle → über Profil/Feature prüfen)
Set(varIsManager, !IsBlank(LookUp(tng_UserProfiles, tng_user.'Primary Email' = User().Email)));
Set(varNav, "dashboard");
```
Nav-Eintrag (Galerie-Zeile): `Fill = If(ThisItem.key = varNav, Theme.Accent, Transparent)`,
`Color = Theme.Surface`, `OnSelect = Set(varNav, ThisItem.key); Navigate(...)`,
`AccessibleLabel = ThisItem.label`, Touch-Höhe ≥ 44.

Dark-Mode-Toggle (ersetzt `theme.ts`): Toggle-Control →
`OnCheck = Set(varDark, true)`, `OnUncheck = Set(varDark, false)`.

---

## Screen `scrDashboard` (ersetzt `Dashboard.tsx`)
KPI-Karten + zwei Charts + Aktivitäts-Feed. Werte aus `04 C/D`, gefiltert auf den
**angemeldeten** Nutzer (`User().Email`) bzw. Team (Chef).

**KPI-Karten** (Provision Monat / Abschlüsse Monat / Zielerreichung / Auslauf bald):
```powerfx
// Karte 1 — Provision laufender Monat (eigene)
lblKpiCommission.Text:
  Text(
    With({ cM: Filter(tng_Contracts, 'Created By'.'Primary Email'=User().Email,
                       tng_contractdate>=MonStart, tng_contractdate<MonEnd),
           tM: Filter(tng_TariffChanges, 'Created By'.'Primary Email'=User().Email,
                       tng_changedate>=MonStart, tng_changedate<MonEnd) },
      Sum(cM, If(tng_status='Contract Status'.Storniert,0,
                 Sum(tng_contractproduct_Contract, tng_commissionsnapshot)))
      + Sum(tM, tng_commission)),
    "[$-de-DE]€ #,##0.00")
lblKpiValue.Color: Theme.Primary
card.Fill: Theme.Surface
```
**Zielerreichung** (Fortschrittsbalken): Wert = `AttainmentPct(monatsProvision,
LookUp(tng_UserProfiles, tng_user.'Primary Email'=User().Email).tng_monthlytarget)`;
Balkenfarbe `If(pct>=100, Theme.Success, Theme.Accent)`.

**Charts:** native **Column Chart** „Provision pro Monat" und **Pie/Donut**
„Produktverteilung". `Items` für Provision je Monat (letzte 6) z. B. über eine
vorbereitete Collection:
```powerfx
// OnVisible
ClearCollect(colMonths,
  ForAll(Sequence(6,-5),
    With({ s: DateAdd(MonStart, Value, Months) },
      { Label: Text(s,"mmm yy"),
        Wert: Sum(Filter(tng_Contracts, tng_contractdate>=s, tng_contractdate<DateAdd(s,1,Months)),
                  If(tng_status='Contract Status'.Storniert,0,
                     Sum(tng_contractproduct_Contract, tng_commissionsnapshot))) })));
```
Chart-Farben aus dem Theme; Legende sichtbar; bei „keine Daten" Empty-State-Label.

---

## Screen `scrContracts` (ersetzt `Contracts.tsx`)
Suchleiste + Statusfilter + Galerie mit Status-Badge, Auslauf-/Wiedervorlage-
Hinweis, Bearbeiten/Neu.

**Suche + Filter (delegierbar):**
```powerfx
galContracts.Items:
  SortByColumns(
    Filter(tng_Contracts,
      (IsBlank(txtSearch.Value)
        || StartsWith(tng_customer.tng_customernumber, txtSearch.Value)
        || StartsWith(tng_customer.tng_displayname, txtSearch.Value))
      && (ddStatus.Selected.Value = "Alle"
        || tng_status = ddStatus.Selected.Choice)
    ),
    "tng_contractdate", SortOrder.Descending)
```
`ddStatus.Items = Table({Value:"Alle"},{Value:"Offen",Choice:'Contract Status'.Offen},
{Value:"Aktiv",Choice:'Contract Status'.Aktiv},{Value:"Storniert",Choice:'Contract Status'.Storniert})`.

**Status-Badge** (Zeile): Pill-Container `Fill = StatusColor(ThisItem.tng_status)` (Token
aus 03 anpassen auf Choice-Text via `Text(ThisItem.tng_status)`), `Color=Theme.Surface`,
`Text = ThisItem.tng_status`, Radius `Radius.pill`. Status nie nur farblich — Text steht dabei.

**Provision je Zeile:** `Text(If(ThisItem.tng_status='Contract Status'.Storniert,0,
Sum(ThisItem.tng_contractproduct_Contract, tng_commissionsnapshot)), "[$-de-DE]€ #,##0.00")`.

**Auslauf-/Wiedervorlage-Hinweis:** kleines Label
`ExpiryLabel(ThisItem.tng_contractdate, Value(ThisItem.tng_laufzeit))`, Farbe nach
`ExpiryBucketRec(ThisItem)`; Wiedervorlage-Punkt rot, wenn `IstFaellig(ThisItem.tng_followupdate)`.

**Neu / Bearbeiten:** `OnSelect = Set(varContract, ThisItem); Navigate(scrContractEdit, ScreenTransition.CoverRight)`.
Button „Neu": `Set(varContract, Defaults(tng_Contracts)); Navigate(scrContractEdit)`.

---

## Screen `scrContractEdit` (ersetzt `ContractForm.tsx`)
**Edit form** (`frmContract`) auf `tng_Contracts`, `Item = varContract`. Felder:
Kunde (Lookup/Combobox auf `tng_Customers` + Anlegen-falls-neu), Datum (Pflicht),
Status (Choice), Laufzeit (Choice, optional), Jira (Text), Wiedervorlage (Date),
Notizen (Memo).

**Pflicht-Datum** (wie im React-CRM „Pflicht-Datum in Formularen"): DataCard
`Required = true`; Speichern-Button `DisplayMode = If(IsBlank(dpDate.SelectedDate)
|| IsBlank(cbCustomer.Selected), Disabled, Edit)`.

**Jira-Validierung + Duplikat-Warnung:**
```powerfx
lblJiraError.Text:  If(!IstJira(txtJira.Value), "Format: TNG-1234", "")
lblJiraError.Color: Theme.Danger
// beim Verlassen normalisieren
txtJira.OnChange:   Set(varJira, NormJira(txtJira.Value))
lblDupWarn.Text:    If(!IsBlank(DuplicateCustomerName(cbCustomer.Selected.tng_customernumber, txtName.Value)),
                       "⚠ KdNr. bekannt als: " & DuplicateCustomerName(...), "")
```

**Speichern (mit Produkten + Snapshot + Audit):**
```powerfx
btnSave.OnSelect:
  If(IstJira(txtJira.Value),
    SubmitForm(frmContract),   // schreibt den Vertrag
    Notify("Jira-Format ungültig (TNG-1234).", NotificationType.Error));
// frmContract.OnSuccess: Produkte als Kindzeilen patchen + Snapshot setzen
frmContract.OnSuccess:
  ForAll(colSelectedProducts As p,
    Patch(tng_ContractProducts, Defaults(tng_ContractProducts),
      { tng_Contract: frmContract.LastSubmit,
        tng_Product: p.product,
        tng_commissionsnapshot: p.product.tng_commission }));
  // App-Audit (Consent/Export/Custom-Events laufen analog)
  Patch(tng_AuditEvents, Defaults(tng_AuditEvents),
    { tng_action:"create", tng_entitytype:"contract",
      tng_entityid: frmContract.LastSubmit.tng_contractid,
      tng_actorname: User().FullName });
  Navigate(scrContracts, ScreenTransition.UnCoverRight)
```
**Storno-Logik** (Provision 0): rein über `tng_status` — die Provisionsformeln in
04 geben für „Storniert" automatisch 0 zurück (deckungsgleich mit `calcContractCommission`).

---

## Screen `scrLeads` (ersetzt `Leads.tsx`)
4-Stufen-Pipeline. Entweder vier Galerien nebeneinander (Kanban) oder eine Galerie
mit Statusfilter. Dringlichkeit steuert Sortierung/Hervorhebung.

```powerfx
// Pro Spalte (Status), nach Priorität + Wiedervorlage sortiert
galNeu.Items:
  SortByColumns(
    Filter(tng_Leads, tng_status = 'Lead Status'.Neu),
    "tng_priority", SortOrder.Descending,   // dringend > hoch > normal (Choice-Werte 3>2>1)
    "tng_followupdate", SortOrder.Ascending)
```
**Prioritäts-Badge:** Farbe `Switch(Text(ThisItem.tng_priority),
"Dringend",Theme.Danger, "Hoch",Theme.Warning, Theme.TextMuted)`, Text dabei.
**Fällige Wiedervorlage** hervorheben: linker Rand rot, wenn
`IstFaellig(ThisItem.tng_followupdate)`.
**Statuswechsel** (gewinnen/verlieren/weiterschieben): Buttons →
`Patch(tng_Leads, ThisItem, { tng_status: 'Lead Status'.Gewonnen })`.
**Aktivitäts-Log:** Detail-Panel mit Galerie über
`Filter(tng_LeadActivities, tng_lead.tng_leadid = varLead.tng_leadid)` +
„Kontakt"/„Notiz"-Buttons, die `tng_LeadActivities` patchen.

---

## Wiederverwendbare Bausteine
- **StatusBadge-Komponente:** Eingang `statusText` (Text) + `bgColor` (Color),
  Pill-Layout — überall (Verträge, Leads) verwenden (ersetzt `StatusBadge.tsx`).
- **KPI-Card-Komponente:** Eingänge `title`, `value`, `accent` — auf Dashboard &
  Team-Dashboard (ersetzt die KPI-Kacheln).
- **Toast:** `Notify(...)` ersetzt `useToast`/`ToastHost`.
- **Modal:** Container mit Overlay (`Fill = ColorFade(Theme.Text, -60%)`, Scrim
  40–60 %) ersetzt `Modal.tsx`.
