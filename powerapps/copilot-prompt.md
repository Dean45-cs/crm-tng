# Copilot-Prompts — TNG CRM in Power Apps generieren

Das Copilot-Eingabefeld hat ein **Zeichenlimit** → daher in **Etappen**.
Auf **make.powerapps.com** → Startseite → Copilot-Feld. Erst Prompt 1, dann
Prompt 2 + 3 nachschieben (Copilot bzw. „+ Neue Tabelle").

> Copilot legt die **Tabellen** zuverlässig an. **Design** und
> **Provisionslogik/Sicherheit** macht es nur grob — exakter Look danach über das
> `Theme` aus `03-design-system.md`, Logik über `04-powerfx-logic.md`, Rollen über
> `02-security-model.md`. Falls Prompt 1 noch zu lang ist: den Design-Absatz
> weglassen (Design wird ohnehin nachträglich exakt gesetzt).

---

## Prompt 1 — Kern + Design (zuerst)
```text
Erstelle eine Vertriebs-CRM-App „TNG Stadtnetz CRM“ mit diesen Dataverse-Tabellen und einer mehrseitigen App (Listen + Bearbeitungsformulare):
- Kunde: Kundennummer, Name.
- Produkt: Name, Kategorie (Privat/Business/Zusatz), Provision (Währung), Aktiv (Ja/Nein).
- Vertrag: Kunde (Beziehung), Vertragsdatum, Status (Offen/Aktiv/Storniert), Laufzeit (12/24 Monate), Jira-Ticket, Wiedervorlage (Datum), Notizen, Provision (Währung).
- Vertragsprodukt: Vertrag (Beziehung), Produkt (Beziehung), Provision (Währung). Mehrere Produkte pro Vertrag.
- Lead: Name, Telefon, Thema, Status (Neu/In Bearbeitung/Gewonnen/Verloren), Priorität (Normal/Hoch/Dringend), Wiedervorlage (Datum).
Seiten: Dashboard mit Kennzahlen-Kacheln und Diagrammen; Verträge mit Suche und Statusfilter; Leads als Pipeline nach Status; Kunden.
Design: seriöses, professionelles B2B-Dashboard, keine Verläufe, keine Emoji-Icons. Navy #0F172A, Buttons/Akzent Blau #0369A1, Hintergrund #F8FAFC, weiße Karten, dunkler Text. Status Aktiv grün, Storniert rot. Schrift Open Sans, abgerundete Karten, gute Kontraste.
```

## Prompt 2 — Tarifwechsel, Notiz, Lead-Aktivität (danach)
```text
Füge der App folgende Dataverse-Tabellen mit Beziehungen hinzu:
- Tarifwechsel: Kunde (Beziehung), Typ (Sidegrade/Upgrade), Kontext (Restlaufzeit über 3 Monate / unter 3 Monate / außerhalb MVLZ), Altprodukt (Beziehung zu Produkt), Neuprodukt (Beziehung zu Produkt), Datum, Jira-Ticket, Provision (Währung).
- Notiz: Kunde (Beziehung), Titel, Inhalt (mehrzeilig), Jira-Ticket.
- Lead-Aktivität: Lead (Beziehung), Typ (Kontakt/Notiz), Inhalt.
```

## Prompt 3 — Incentive, Zugriffsanfrage, Benutzerprofil (danach)
```text
Füge folgende Dataverse-Tabellen hinzu:
- Incentive: Titel, Mechanik (Zielprämie/Wettbewerb), Kennzahl (Provision/Verträge/Abschlüsse), Zeitraum (Wöchentlich/Monatlich), Ziel (Zahl), Belohnung, Aktiv (Ja/Nein).
- Zugriffsanfrage: Kunde (Beziehung), Begründung, Status (Offen/Genehmigt/Abgelehnt).
- Benutzerprofil: Monatsziel (Währung), Leaderboard-Teilnahme (Ja/Nein), Onboarding abgeschlossen (Ja/Nein), Einwilligung erteilt am (Datum/Uhrzeit).
```

---

## Danach (Reihenfolge)
1. Prüfen, ob alle Tabellen/Beziehungen sauber sind (siehe `01-dataverse-schema.md`).
2. Stammdaten importieren: `seed/products.csv`, `seed/tariff-commission.csv`.
3. Provisionslogik aus `04-powerfx-logic.md` einsetzen.
4. `Theme` aus `03-design-system.md` in *App → Formulas* → exakter Look + Dark Mode.
5. Sicherheitsrollen aus `02-security-model.md`.
6. Mit Demo-Daten gegen die Soll-Zahlen testen.
