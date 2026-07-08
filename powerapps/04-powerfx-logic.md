# 04 — Geschäftslogik in Power Fx

1:1-Übersetzung der getesteten TypeScript-Logik (`utils.ts`, `teamStats.ts`,
`incentives.ts`, `validation.ts`, `customerOwnership.ts`) nach Power Fx.

**Datenquellen-Namen** (so in der App benannt): `tng_Contracts`,
`tng_ContractProducts`, `tng_TariffChanges`, `tng_Products`, `tng_TariffRates`,
`tng_Leads`, `tng_Incentives`, `tng_UserProfiles`, `Users` (System­benutzer).

**Choice-Referenzen** über Labels, z. B. `'Contract Status'.Aktiv`,
`'Change Type'.Upgrade`, `'Context'.'Restlaufzeit < 3 Monate'`. (Globale Choices
heißen in Power Fx wie der Anzeigename des Option Sets.)

> **Delegation:** `Year()`/`Month()` sind **nicht** delegierbar. Für Abfragen über
> große Tabellen daher **Datumsbereiche** (`>=`, `<`) statt `isSameMonth` nutzen —
> die sind delegierbar. Die reinen Helfer (`IsSameMonth` etc.) bleiben für
> In-Memory-Logik.

---

## A. Pure Helfer — als benannte Formeln / UDFs in `App.Formulas`

```powerfx
// Heutiges Datum, Mitternacht lokal (ersetzt today()/parseLocalDate)
Heute = DateValue(Text(Today(), "yyyy-mm-dd"));

// Monatsanfang/-ende als delegierbarer Bereich [MonStart, MonEnd)
MonStart = Date(Year(Heute), Month(Heute), 1);
MonEnd   = DateAdd(MonStart, 1, Months);

// Wochenanfang (Montag 00:00) — deutsche Zählung, ersetzt weekStart()
WoStart(d: Date): Date = DateAdd(d, -(Weekday(d, StartOfWeek.Monday) - 1), Days);
WoEnde(d: Date): Date  = DateAdd(WoStart(d), 6, Days);

IsSameMonth(d: Date, ref: Date): Boolean = Year(d) = Year(ref) && Month(d) = Month(ref);
IsSameWeek(d: Date, ref: Date): Boolean  = d >= WoStart(ref) && d <= WoEnde(ref);

MonatsKey(d: Date): Text = Text(d, "yyyy-mm");

// ISO-8601-Kalenderwoche (Donnerstag-Regel) — ersetzt isoWeekNumber()
IsoWoche(d: Date): Number =
    With({ thu: DateAdd(d, 4 - Weekday(d, StartOfWeek.Monday), Days) },
         RoundDown((thu - Date(Year(thu), 1, 1)) / 7, 0) + 1);
WochenLabel(d: Date): Text = "KW " & IsoWoche(d);

// Jira-Validierung (ersetzt isJiraTicket / normalizeJiraTicket)
IstJira(v: Text): Boolean = IsBlank(Trim(v)) || IsMatch(Trim(v), "^[A-Z]{2,}-\d+$");
NormJira(v: Text): Text   = Upper(Trim(v));
```

---

## B. Provision

**Per Produktzeile:** beim Anlegen `tng_commissionsnapshot` aus dem Produkt
setzen (im Formular, siehe 05):
```powerfx
// beim Patch einer tng_contractproduct-Zeile
tng_commissionsnapshot: LookUp(tng_Products, tng_name = selectedProduct.tng_name).tng_commission
```

**Provision eines Vertrags** (ersetzt `calcContractCommission`; Storno ⇒ 0):
```powerfx
// als Spalten-/Anzeigeausdruck. ThisRecord = ein tng_contract
If( ThisRecord.tng_status = 'Contract Status'.Storniert,
    0,
    Sum(ThisRecord.tng_contractproduct_Contract, tng_commissionsnapshot) )
// "tng_contractproduct_Contract" = Name der 1:N-Beziehung Vertrag→Vertragsprodukt
```
*Alternative Live-Berechnung (wie im React-CRM, ohne Snapshot):*
`Sum(ThisRecord.tng_contractproduct_Contract, LookUp(tng_Products, tng_productid = tng_Product.tng_productid).tng_commission)`.
*Optional als Dataverse-**Rollup**:* `tng_commissionraw = Sum(children.snapshot)`,
dazu **berechnete Spalte** `tng_commission = If(status=Storniert,0,tng_commissionraw)`.

**Provision eines Tarifwechsels** (ersetzt `calcTariffCommission`):
```powerfx
TariffProvision(changeType: Text, context: Text): Number =
    LookUp(tng_TariffRates,
           tng_changetype = changeType && tng_context = context,
           tng_amount);
// Aufruf je Zeile: TariffProvision(ThisRecord.tng_changetype, ThisRecord.tng_context)
```

---

## C. Mitarbeiter-Kennzahlen (ersetzt `agentStats`)

`agentEmail` = E-Mail des Mitarbeiters; `'Created By'` ist die Standard-Spalte
(= Supabase `created_by`). Storno zählt **nicht** als Abschluss; Provision ist
für Storno ohnehin 0. Tarifwechsel zählen **immer** als Abschluss.

```powerfx
// Monats-Provision (Verträge + Tarifwechsel), delegierbar über Datumsbereich
With(
  {
    cM: Filter(tng_Contracts,
               'Created By'.'Primary Email' = agentEmail,
               tng_contractdate >= MonStart, tng_contractdate < MonEnd),
    tM: Filter(tng_TariffChanges,
               'Created By'.'Primary Email' = agentEmail,
               tng_changedate >= MonStart, tng_changedate < MonEnd)
  },
  {
    monthCommission:
        Sum(cM, If(tng_status = 'Contract Status'.Storniert, 0,
                   Sum(tng_contractproduct_Contract, tng_commissionsnapshot)))
      + Sum(tM, tng_commission),
    monthContracts: CountRows(Filter(cM, tng_status <> 'Contract Status'.Storniert)),
    monthTariffs:   CountRows(tM),
    monthDeals:     CountRows(Filter(cM, tng_status <> 'Contract Status'.Storniert))
                  + CountRows(tM)
  }
)
```
`totalCommission` / `totalDeals`: dieselben Ausdrücke **ohne** die Datumsfilter
(`>= MonStart …`).

**Zielerreichung %** (ersetzt `attainmentPct`): gibt `Blank()` ohne Ziel:
```powerfx
AttainmentPct(commission: Number, target: Number): Number =
    If(target <= 0, Blank(), Round(commission / target * 100, 0));
```

---

## D. Team-KPIs (ersetzt `teamKpis`)

```powerfx
With(
  {
    cM: Filter(tng_Contracts, tng_contractdate >= MonStart, tng_contractdate < MonEnd),
    tM: Filter(tng_TariffChanges, tng_changedate >= MonStart, tng_changedate < MonEnd),
    won:  CountRows(Filter(tng_Leads, tng_status = 'Lead Status'.Gewonnen)),
    lost: CountRows(Filter(tng_Leads, tng_status = 'Lead Status'.Verloren))
  },
  With(
    {
      monthCommission:
          Sum(cM, If(tng_status='Contract Status'.Storniert, 0,
                     Sum(tng_contractproduct_Contract, tng_commissionsnapshot)))
        + Sum(tM, tng_commission),
      monthDeals:
          CountRows(Filter(cM, tng_status <> 'Contract Status'.Storniert)) + CountRows(tM)
    },
    {
      avgCommissionPerDeal: If(monthDeals > 0, monthCommission / monthDeals, 0),
      openLeads: CountRows(Filter(tng_Leads,
                   tng_status = 'Lead Status'.Neu
                   || tng_status = 'Lead Status'.'In Bearbeitung')),
      leadConversion: If(won + lost > 0, Round(won / (won + lost) * 100, 0), Blank()),
      // expiringSoon / dueFollowUps: siehe Abschnitt F (ExpiryBucket / IstFaellig)
      expiringSoon: CountRows(Filter(tng_Contracts, !IsBlank(tng_laufzeit)
                     && ExpiryBucketRec(ThisRecord) <> "")),
      dueFollowUps:
          CountRows(Filter(tng_Contracts, IstFaellig(tng_followupdate)))
        + CountRows(Filter(tng_Leads, IstFaellig(tng_followupdate)))
    }
  )
)
```

---

## E. Incentives (ersetzt `incentives.ts`)

**Periodenwert eines Agenten** (`incentiveValue`):
```powerfx
IncentiveValue(inc: Record, agentEmail: Text): Number =
  With(
    {
      isWeek: inc.tng_period = 'Incentive Period'.'Wöchentlich',
      pStart: If(inc.tng_period='Incentive Period'.'Wöchentlich', WoStart(Heute), MonStart),
      pEnd:   If(inc.tng_period='Incentive Period'.'Wöchentlich', DateAdd(WoStart(Heute),7,Days), MonEnd)
    },
    With(
      {
        cP: Filter(tng_Contracts, 'Created By'.'Primary Email' = agentEmail,
                   tng_contractdate >= pStart, tng_contractdate < pEnd),
        tP: Filter(tng_TariffChanges, 'Created By'.'Primary Email' = agentEmail,
                   tng_changedate >= pStart, tng_changedate < pEnd)
      },
      Switch(inc.tng_metric,
        'Incentive Metric'.Provision,
            Sum(cP, If(tng_status='Contract Status'.Storniert,0,
                       Sum(tng_contractproduct_Contract, tng_commissionsnapshot)))
          + Sum(tP, tng_commission),
        'Incentive Metric'.'Verträge',
            CountRows(Filter(cP, tng_status <> 'Contract Status'.Storniert)),
        'Incentive Metric'.'Abschlüsse',
            CountRows(Filter(cP, tng_status <> 'Contract Status'.Storniert)) + CountRows(tP)
      )
    )
  );
```

**Rangliste** (`incentiveStandings`) — als Galerie-`Items`, absteigend, mit Rang:
```powerfx
With(
  { roh: AddColumns(Users,                       // bzw. tng_UserProfiles
          "Wert", IncentiveValue(galInc.Selected, 'Primary Email')) },
  AddColumns(
    Sort(roh, Wert, SortOrder.Descending),
    "Rang", CountRows(Filter(roh, Wert > ThisRecord.Wert)) + 1)
)
```

**Ziel erreicht** (`incentiveReached`) / **Wettbewerbsführer** (`isLeader`):
```powerfx
IncentiveReached(inc: Record, value: Number): Boolean =
    inc.tng_mechanic = 'Incentive Mechanic'.'Zielprämie' && inc.tng_target > 0 && value >= inc.tng_target;

// Führer = Rang 1 mit Wert > 0  (auf der sortierten Standings-Collection colStandings)
IstFuehrer(agentEmail: Text): Boolean =
    With({ top: First(colStandings) }, top.'Primary Email' = agentEmail && top.Wert > 0);
```

---

## F. Auslauf-Radar & Wiedervorlage (ersetzt `utils.ts`)

```powerfx
// Vertragsende = contractdate + laufzeit (Monatsende-sicher). Blank = unbefristet.
ContractEnd(start: Date, laufzeit: Number): Date =
    If(laufzeit = 0 || IsBlank(laufzeit), Blank(), DateAdd(start, laufzeit, Months));

TageBis(d: Date): Number = DateDiff(Heute, d, Days);   // negativ = vergangen

// Ampel: ""=keine, "soon"≤30, "medium"31–60, "later"61–90  (ersetzt expiryBucket)
ExpiryBucket(start: Date, laufzeit: Number): Text =
  With({ e: ContractEnd(start, laufzeit) },
    If(IsBlank(e), "",
       With({ days: TageBis(e) },
         If(days < 0 || days > 90, "",
            If(days <= 30, "soon", If(days <= 60, "medium", "later"))))));

// Komfort-Wrapper auf einen tng_contract-Datensatz
ExpiryBucketRec(c: Record): Text = ExpiryBucket(c.tng_contractdate, Value(c.tng_laufzeit));

ExpiryLabel(start: Date, laufzeit: Number): Text =
  With({ e: ContractEnd(start, laufzeit) },
    If(IsBlank(e), "",
       With({ days: TageBis(e) },
         Switch(true,
           days < 0,  "vor " & Abs(days) & " Tagen abgelaufen",
           days = 0,  "Läuft heute ab",
           days = 1,  "Morgen",
           "in " & days & " Tagen"))));

// Wiedervorlage-Kategorie (ersetzt followUpBucket): ""=keine
FollowUpBucket(d: Date): Text =
    If(IsBlank(d), "",
       With({ diff: DateDiff(Heute, d, Days) },
         Switch(true, diff < 0, "overdue", diff = 0, "today", diff <= 7, "thisWeek", "later")));

IstFaellig(d: Date): Boolean = FollowUpBucket(d) in ["overdue", "today"];
```
Ampel-Farbe: `Switch(bucket, "soon",Theme.Danger, "medium",Theme.Warning, "later",ColorValue("#CA8A04"), Transparent)`.

---

## G. Validierung & Duplikat-Warnung (ersetzt `validation.ts`)

`IstJira` / `NormJira` siehe Abschnitt A. **Duplikat-Warnung**
(`findDuplicateCustomer`) — gibt den abweichenden bekannten Namen oder Blank:
```powerfx
DuplicateCustomerName(kdnr: Text, name: Text): Text =
    LookUp(tng_Contracts,
        tng_customer.tng_customernumber = Trim(kdnr)
        && Lower(Trim(tng_customer.tng_displayname)) <> Lower(Trim(name)),
        tng_customer.tng_displayname);
// In der Praxis besser über tng_customer direkt:
//   LookUp(tng_Customers, tng_customernumber = Trim(kdnr) && Lower(tng_displayname) <> Lower(Trim(name)), tng_displayname)
```
Nicht-blockierende Warnung im Formular: `If(!IsBlank(DuplicateCustomerName(...)), "⚠ Bekannt als: " & ...)`.

---

## H. Kunden-Aggregation (ersetzt `buildCustomerSummaries`)

Da `tng_customer` jetzt echte Tabelle ist, entfällt das Gruppieren weitgehend —
Zähler/Provision je Kunde als Galerie-Ausdrücke:
```powerfx
// in einer Galerie über tng_Customers (ThisRecord = Kunde)
contractCount:   CountRows(Filter(tng_Contracts,     tng_customer.tng_customerid = ThisRecord.tng_customerid)),
tariffCount:     CountRows(Filter(tng_TariffChanges, tng_customer.tng_customerid = ThisRecord.tng_customerid)),
noteCount:       CountRows(Filter(tng_Notes,         tng_customer.tng_customerid = ThisRecord.tng_customerid)),
totalCommission:
    Sum(Filter(tng_Contracts, tng_customer.tng_customerid = ThisRecord.tng_customerid),
        If(tng_status='Contract Status'.Storniert,0, Sum(tng_contractproduct_Contract, tng_commissionsnapshot)))
  + Sum(Filter(tng_TariffChanges, tng_customer.tng_customerid = ThisRecord.tng_customerid), tng_commission)
```
Sortierung „letzte Aktivität" → über `Max(...)` der jeweiligen Datumsfelder oder
einfacher `ModifiedOn`-basiert sortieren.
