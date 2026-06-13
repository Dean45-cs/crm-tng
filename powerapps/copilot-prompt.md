# Copilot-Prompt — TNG CRM in Power Apps generieren

Auf **make.powerapps.com** → Startseite → ins Feld **„Beschreibe die App, die du
erstellen möchtest"** (Copilot) den folgenden Text **komplett** einfügen.

> **Erwartung:** Copilot legt die **Tabellen** zuverlässig an und erzeugt eine
> klickbare App. **Design** und **Sicherheit/Provisionslogik** macht es nur grob —
> der exakte Look wird danach über das Theme in `03-design-system.md` gesetzt, die
> Logik über `04-powerfx-logic.md`, die Rollen über `02-security-model.md`.
> Falls Copilot bei 12 Tabellen abbricht: erst Tabellen 1–6 generieren, dann
> „Füge folgende Tabellen hinzu: …" nachschieben.

---

```text
Erstelle eine mehrseitige Vertriebs-CRM-App mit dem Namen „TNG Stadtnetz CRM“ für
ein Glasfaser-/Telekommunikations-Vertriebsteam. Lege die folgenden Dataverse-
Tabellen samt Beziehungen an und erzeuge dazu eine App mit Übersichtslisten,
Detail- und Bearbeitungsformularen.

TABELLEN
1. Kunde — Kundennummer (Text, eindeutig), Name (Text).
2. Produkt — Name (Text), Kategorie (Auswahl: Privat, Business, Zusatz),
   Provision (Währung €), Aktiv (Ja/Nein).
3. Tarifsatz — Wechseltyp (Auswahl: Sidegrade/VVL, Upgrade),
   Kontext (Auswahl: Restlaufzeit über 3 Monate, Restlaufzeit unter 3 Monate,
   Außerhalb MVLZ), Betrag (Währung €).
4. Vertrag — Kunde (Beziehung zu Kunde), Vertragsdatum (Datum),
   Status (Auswahl: Offen, Aktiv, Storniert), Laufzeit (Auswahl: 12 Monate,
   24 Monate), Jira-Ticket (Text), Wiedervorlage (Datum),
   Notizen (mehrzeiliger Text), Provision (Währung).
5. Vertragsprodukt — Vertrag (Beziehung zu Vertrag), Produkt (Beziehung zu
   Produkt), Provision-Snapshot (Währung). Ein Vertrag kann mehrere Produkte
   enthalten (Bundle).
6. Tarifwechsel — Kunde (Beziehung), Wechseltyp (Auswahl wie Tarifsatz),
   Kontext (Auswahl wie Tarifsatz), Altes Produkt (Beziehung zu Produkt),
   Neues Produkt (Beziehung zu Produkt), Wechseldatum (Datum), Jira-Ticket (Text),
   Notizen (Text), Provision (Währung).
7. Notiz — Kunde (Beziehung, optional), Titel (Text), Inhalt (mehrzeiliger Text),
   Jira-Ticket (Text).
8. Lead — Name (Text), Kundennummer (Text), Telefon (Text), Thema (Text),
   Status (Auswahl: Neu, In Bearbeitung, Gewonnen, Verloren),
   Priorität (Auswahl: Normal, Hoch, Dringend), Wiedervorlage (Datum),
   Notizen (Text).
9. Lead-Aktivität — Lead (Beziehung), Typ (Auswahl: Kontakt, Notiz), Inhalt (Text).
10. Incentive — Titel (Text), Mechanik (Auswahl: Zielprämie, Wettbewerb),
    Kennzahl (Auswahl: Provision, Verträge, Abschlüsse),
    Zeitraum (Auswahl: Wöchentlich, Monatlich), Ziel (Zahl), Belohnung (Text),
    Aktiv (Ja/Nein).
11. Zugriffsanfrage — Kunde (Beziehung), Begründung (Text),
    Status (Auswahl: Offen, Genehmigt, Abgelehnt).
12. Benutzerprofil — Monatsziel (Währung), Leaderboard-Teilnahme (Ja/Nein),
    Onboarding abgeschlossen (Ja/Nein), Einwilligung erteilt am (Datum/Uhrzeit).

SEITEN
- Dashboard mit Kennzahlen-Kacheln (Provision aktueller Monat, Abschlüsse aktueller
  Monat, Monatsziel-Fortschritt als Balken, bald auslaufende Verträge) und
  Diagrammen (Provision pro Monat als Säulendiagramm, Produktverteilung als Donut).
- Verträge: Liste mit Suchfeld und Statusfilter, plus Bearbeitungsformular.
- Tarifwechsel: Liste plus Formular.
- Leads: Pipeline-Ansicht in vier Spalten nach Status
  (Neu / In Bearbeitung / Gewonnen / Verloren), dringende Leads hervorgehoben.
- Notizen und Kunden: jeweils Liste plus Formular.
- Chef-Bereich: Team-Dashboard, Rangliste (Leaderboard), Berichte,
  Incentive-Verwaltung.
- Einstellungen.

ROLLEN
Zwei Sicherheitsrollen: „Vertrieb“ bearbeitet eigene Datensätze und liest alle;
„Chef“ sieht und bearbeitet alles und verwaltet Incentives.

DESIGN — sehr wichtig, durchgängig auf alle Seiten anwenden
- Stil: seriös, vertrauenswürdig, professionell, aufgeräumt, datendicht
  (Anmutung „Trust & Authority“, wie ein hochwertiges B2B-SaaS-Dashboard).
  KEINE verspielten Effekte, KEINE Lila/Pink-Verläufe, KEINE Emojis als Icons.
- Farben hell: Primär #0F172A (Navy), Sekundär #334155, Akzent/Buttons #0369A1
  (Blau), Hintergrund #F8FAFC, Karten/Flächen #FFFFFF, Text #020617, gedämpfter
  Text #475569, Rahmen #E2E8F0. Statusfarben: Aktiv = Grün #15803D,
  Storniert = Rot #B91C1C, Offen = Grau; Warnung = #B45309.
- Farben dunkel (Dark Mode zusätzlich anbieten): Hintergrund #0B1220,
  Karten #111A2E, Text #F1F5F9, Akzent #38BDF8.
- Typografie: Schriftart „Open Sans“ (ersatzweise „Plus Jakarta Sans“), klare
  Größenhierarchie (Seitentitel groß und halbfett, Kennzahlen groß und fett,
  Fließtext 15). 
- Layout: Karten mit abgerundeten Ecken (Radius 12), dezente Schatten,
  durchgehendes 8-Pixel-Abstandsraster, linke Navigationsleiste in Navy.
- Barrierefreiheit: Textkontrast mindestens 4,5:1, sichtbare Fokus-Rahmen in der
  Akzentfarbe, Status immer zusätzlich als Text-Label (nicht nur über Farbe),
  Touch-Ziele mindestens 44 Pixel hoch.
```

---

## Danach (damit das Design wirklich exakt sitzt)
1. App in **Power Apps Studio** öffnen → **App → Formulas** → das `Theme`-Objekt
   aus `03-design-system.md` einfügen. Alle Controls auf `Theme.*` umstellen
   (`Fill = Theme.Surface`, `Color = Theme.Text`, Buttons `Fill = Theme.Accent`).
   → Ein zentraler Schalter `varDark` färbt die ganze App exakt um.
2. Provisionsformel aus `04-powerfx-logic.md` einsetzen.
3. Stammdaten `seed/products.csv` + `seed/tariff-commission.csv` importieren.
