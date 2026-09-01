/**
 * Kampagnen-Katalog — was jede der sechs Kampagnen verlangt, an genau einer
 * Stelle. Einzige gemeinsame Quelle für Extension (dieses File, direkt als
 * Content-Script geladen, siehe manifest.json) und CRM (`src/lib/campaigns.ts`
 * importiert diese Datei direkt statt eine eigene Kopie zu pflegen). Gleiches
 * Muster wie shift-time.js und commission.js: reines UMD-artiges Script, das
 * sich per `globalThis` (Browser) oder `module.exports` (Node/Vite) exportiert
 * — kein Build-Schritt für die Extension nötig.
 *
 * Grundlage sind die Gesprächsleitfäden Version 2.0 (Stand August 2026):
 *   welcome  — Welcome Call
 *   churn    — Churn: Widerrufe & Kündigungen
 *   prl      — Postrückläufer
 *   dupe     — Dubletten-Check
 *   bvw      — Bauverweigerer
 *   courtesy — Courtesy Call
 *
 * Warum hier und nicht in config.js: config.js hält den *Text*, den der Mensch
 * im Gespräch liest (callGuides, objectionCards). Dieses File hält, was das
 * Programm davon prüfen und speichern muss — Ergebnisse, Pflichtfelder,
 * Ursachenkataloge. Beides zu vermischen hieße, dass jede Textänderung am
 * Leitfaden das Datenmodell anfasst.
 *
 * Die Leitfäden nennen mehrfach Punkte als „vergütungsrelevant“ (HomeID,
 * Winbackstatus mit Ursache, Double-Opt-In). Das ist der Grund, warum die
 * Pflichtfelder hier hart stehen und nicht als Freitext-Erinnerung: ein
 * Gespräch ohne sie ist nicht abgerechnet, und das merkt sonst erst die
 * Nachbearbeitung.
 */
(function () {
  "use strict";

  // ── Rahmen, der für ALLE Kampagnen gilt ───────────────────────────────────
  //
  // Steht in jedem der sechs Leitfäden wortgleich unter „Vor dem Anruf“ bzw.
  // „Legitimation und Datenschutz“. Einmal hier statt sechsmal unten.

  /**
   * Zulässiges Anrufzeitfenster: Mo–Fr 08:00–17:00 Uhr. Minuten seit
   * Mitternacht, weekdays als ISO-Wochentage (1 = Montag).
   */
  const CONTACT_WINDOW = {
    weekdays: [1, 2, 3, 4, 5],
    startMin: 8 * 60,
    endMin: 17 * 60,
    label: "Mo–Fr 08:00–17:00 Uhr"
  };

  /**
   * Zulässige Legitimationsmerkmale. Die Frage „Spreche ich mit Herrn/Frau …?“
   * ist ausdrücklich KEINE Legitimation — sie steht deshalb nicht in dieser
   * Liste, sondern nur als Gesprächseinstieg im Leitfaden.
   */
  const LEGITIMATION_METHODS = [
    { id: "geburtsdatum", label: "Geburtsdatum" },
    { id: "kundennummer", label: "Kunden- oder Auftragsnummer" },
    { id: "anschrift", label: "Vollständige Anschlussadresse" }
  ];

  /**
   * HomeID-Aufnahme. Die Reihenfolge ist keine Vorliebe, sondern Vorgabe aus
   * Welcome- und Courtesy-Leitfaden: eine ausgewiesene HomeID hat immer
   * Vorrang, danach die ONT-Seriennummer, zuletzt die AD-Nummer der Dose.
   */
  const HOME_ID_KINDS = [
    {
      id: "homeid",
      label: "HomeID",
      rank: 1,
      hint: "Aufgeklebt oder beschriftet — hat immer Vorrang.",
      example: "NE422224WS52",
      pattern: /^[A-Z0-9]{8,20}$/
    },
    {
      id: "ont",
      label: "ONT-Seriennummer",
      rank: 2,
      hint: "Schwarzer Kasten, Seriennummer auf dem Aufkleber.",
      example: "ALCLFD9DEE90",
      pattern: /^[A-Z0-9]{8,20}$/
    },
    {
      id: "ad",
      label: "AD-Nummer",
      rank: 3,
      hint: "Nur wenn weder HomeID noch ONT vorhanden — exakt wie abgebildet.",
      example: "AD.01.01",
      pattern: /^AD[.\-][0-9]{1,3}[.\-][0-9]{1,3}$/i
    },
    {
      id: "genexis",
      label: "Genexis-Nummer",
      rank: 4,
      hint: "Bereits installierte Box im Bestandsobjekt.",
      example: "GNX12345678",
      pattern: /^[A-Z0-9]{8,20}$/
    }
  ];

  /**
   * Double-Opt-In (Permission). Wird laut allen sechs Leitfäden „in jedem
   * positiven oder neutralen Gesprächsabschluss angekündigt – ohne Ausnahme“
   * und über das CRM ausgelöst. Erst die Bestätigung des Kunden macht sie
   * wirksam (§ 7 Abs. 2 UWG), der Nachweis ist fünf Jahre aufzubewahren
   * (§ 7a UWG).
   */
  const DOI_STATUS = [
    { id: "offen", label: "Nicht angekündigt", terminal: false, advertisingAllowed: false },
    { id: "angekuendigt", label: "Angekündigt", terminal: false, advertisingAllowed: false },
    { id: "versendet", label: "Versendet — Bestätigung offen", terminal: false, advertisingAllowed: false },
    { id: "bestaetigt", label: "Vom Kunden bestätigt", terminal: true, advertisingAllowed: true },
    { id: "abgelehnt", label: "Vom Kunden abgelehnt", terminal: true, advertisingAllowed: false }
  ];

  /** Kontaktarten werden laut Leitfaden getrennt erfasst. */
  const DOI_CHANNELS = [
    { id: "email", label: "E-Mail" },
    { id: "telefon", label: "Telefon" },
    { id: "mobil", label: "Mobil" }
  ];

  /** Aufbewahrungsfrist des Einwilligungsnachweises, § 7a UWG. */
  const DOI_RETENTION_YEARS = 5;

  /**
   * Fraud-Merkmale aus Welcome- und Churn-Leitfaden, nach Beobachtungsort
   * gruppiert. Wichtig für die Oberfläche: das sind *Beobachtungen*, keine
   * Bewertungen — der Verdacht wird nie im Gespräch benannt.
   */
  const FRAUD_MARKERS = [
    { id: "kunde-kennt-vertrag-nicht", group: "Im Kundenkontakt", label: "Kunde gibt an, den Vertrag nicht oder nicht in dieser Form abgeschlossen zu haben" },
    { id: "kunde-kennt-vertriebler-nicht", group: "Im Kundenkontakt", label: "Kennt den Namen des Vertrieblers nicht oder kann den Gesprächsverlauf nicht wiedergeben" },
    { id: "kunde-ueberrascht", group: "Im Kundenkontakt", label: "Ist überrascht von Vertragsinhalten, Laufzeiten oder Preis" },
    { id: "kunde-versteht-inhalt-nicht", group: "Im Kundenkontakt", label: "Sprachlich oder inhaltlich nicht in der Lage, den Vertragsinhalt zu verstehen" },
    { id: "vertrieb-draengt", group: "Im Verhalten des Vertrieblers", label: "Drängt auf schnellen Abschluss oder verhindert Rückfragen" },
    { id: "vertrieb-beschwerden", group: "Im Verhalten des Vertrieblers", label: "Wiederholte Beschwerden oder Widerrufe bei diesem Vertriebspartner" },
    { id: "vertrieb-nicht-erreichbar", group: "Im Verhalten des Vertrieblers", label: "Nicht mehr erreichbar oder erschwert den Kundenkontakt" },
    { id: "vertrieb-quote-auffaellig", group: "Im Verhalten des Vertrieblers", label: "Hohe Abschlussquote bei gleichzeitig hoher Widerrufsquote" },
    { id: "daten-unterschrift", group: "Bei Vertragsdaten", label: "Unterschrift fehlt oder weicht sichtbar von Referenzunterschriften ab" },
    { id: "daten-mehrfach", group: "Bei Vertragsdaten", label: "Adress- oder Kontodaten stimmen mit weiteren Kunden überein" },
    { id: "daten-muster", group: "Bei Vertragsdaten", label: "Auffällig viele Verträge derselben Person mit ähnlichem Datenmuster" },
    { id: "daten-kontakt-fremd", group: "Bei Vertragsdaten", label: "Telefonnummer oder E-Mail-Adresse ist erkennbar nicht die des Kunden" },
    { id: "daten-provisionsende", group: "Bei Vertragsdaten", label: "Häufung kurz vor Ende von Provisionsaktionen oder Wettbewerbszeiträumen" }
  ];

  /**
   * Winbackstatus. Aus dem BVW-Leitfaden, gilt aber überall, wo ein Winback
   * geführt wird: „erfolgreich“ und „nicht erfolgreich“ verlangen ZWINGEND
   * eine Ursache, „irrelevant“ nicht. Ohne Ursache bleibt der Fall auf „offen“
   * — weder abrechenbar noch auswertbar. Genau das setzt requiresReason durch.
   */
  const WINBACK_STATUS = [
    { id: "offen", label: "Offen", requiresReason: false, billable: false },
    { id: "erfolgreich", label: "Erfolgreich", requiresReason: true, billable: true },
    { id: "nicht_erfolgreich", label: "Nicht erfolgreich", requiresReason: true, billable: true },
    { id: "irrelevant", label: "Irrelevant", requiresReason: false, billable: true }
  ];

  /**
   * JIRA-Komponenten, die die Leitfäden namentlich nennen. Als Liste, weil die
   * Oberfläche sie zur Auswahl stellt statt sie tippen zu lassen — ein
   * vertippter Komponentenname heißt, dass das Ticket in keinem Filter
   * auftaucht und der Vorgang liegen bleibt.
   */
  const JIRA_COMPONENTS = [
    { id: "gfiz-bvw-klaerung", label: "GFIZ-BVW-Klärung", campaign: "bvw", hint: "Klärung noch erforderlich (Renovierung, technisch nicht umsetzbar)." },
    { id: "gfiz-bvw-anschreiben", label: "GFIZ-BVW-Anschreiben", campaign: "bvw", hint: "Schadenersatz-Anschreiben — Arbeitsbeginn auf in 14 Tagen setzen." },
    { id: "ama-eingang", label: "AMA-Eingang", campaign: "bvw", hint: "Winback gescheitert — Weitergabe zur Abrechnung." },
    { id: "pkv-immo-eingang", label: "PKV-Immo-Eingang", campaign: "dupe", hint: "Umstellung SDU → MDU an die Wohnungswirtschaft melden." }
  ];

  /**
   * Zielsysteme der Dokumentation. Steht in jedem Leitfaden als eigene Tabelle;
   * die Oberfläche zeigt daraus die Erinnerung, wo was hingehört.
   */
  const DOC_SYSTEMS = [
    { id: "oiko", label: "OIKO", hint: "Direkte Korrekturen an Vertrag und Stammdaten." },
    { id: "jira", label: "JIRA", hint: "Vorgänge für andere Einheiten." },
    { id: "caseris", label: "Caseris", hint: "Gesprächsdokumentation und Beratungsqualität." },
    { id: "churnliste", label: "Churnliste", hint: "Winback-relevante Ergebnisse." }
  ];

  /** Dokumentationsstandard 4 W — steht so im Welcome-Leitfaden. */
  const DOC_STANDARD_4W = [
    "Wer hat angerufen",
    "Was wurde besprochen",
    "Welche Maßnahme wurde vereinbart",
    "Wann ist der nächste Schritt fällig"
  ];

  // ── Ergebnisse ohne Gespräch ──────────────────────────────────────────────
  //
  // Gelten in allen Kampagnen gleich und tragen bewusst KEINE disposition:
  // Wer niemanden erreicht hat, hat nichts entschieden. Sie würden sonst jede
  // Quote verwässern. `outboundOnly`, weil sie bei einem eingehenden Anruf
  // keinen Sinn ergeben.

  const NO_CONTACT_OUTCOMES = [
    {
      id: "mailbox",
      label: "Mailbox",
      followUp: true,
      opensPanel: false,
      outboundOnly: true,
      countsAsAttempt: true,
      seed: "Kunde telefonisch nicht erreicht, Mailbox erreicht. Keine Nachricht hinterlassen / Nachricht hinterlassen: [ergänzen]. Erneuter Kontaktversuch geplant."
    },
    {
      id: "not-reached",
      label: "Nicht erreicht",
      followUp: true,
      opensPanel: false,
      outboundOnly: true,
      countsAsAttempt: true,
      seed: "Kunde telefonisch nicht erreicht (kein Abheben). Erneuter Kontaktversuch geplant."
    },
    {
      id: "wrong-number",
      label: "Falsche Nummer",
      followUp: false,
      opensPanel: true,
      outboundOnly: true,
      countsAsAttempt: true,
      requires: ["note"],
      seed: "Hinterlegte Rufnummer ist nicht korrekt bzw. gehört nicht zum Kunden. Aktuelle Kontaktdaten müssen ermittelt werden."
    },
    {
      id: "third-party",
      label: "Dritte:r am Apparat — Rückrufbitte",
      followUp: true,
      opensPanel: false,
      countsAsAttempt: true,
      seed: "Nicht der Vertragsnehmer am Apparat. Keine Auskunft erteilt, Rückrufbitte an den Vertragsnehmer hinterlassen."
    },
    {
      id: "no-legitimation",
      label: "Legitimation gescheitert",
      followUp: true,
      opensPanel: false,
      countsAsAttempt: true,
      seed: "Identität konnte nicht bestätigt werden. Keine Vertragsdaten genannt, erneuter Kontaktversuch geplant."
    }
  ];

  /** Rückruf-Ergebnis — überall gleich, deshalb einmal hier. */
  const CALLBACK_OUTCOME = {
    id: "callback",
    label: "Rückruf vereinbart",
    disposition: "rueckruf",
    followUp: true,
    opensPanel: true,
    requires: ["followUpAt"],
    seed: "Kunde telefonisch erreicht. Rückruf vereinbart für [Datum] um [Uhrzeit]. Offener Punkt: [ergänzen]."
  };

  // ── Ursachenkataloge ──────────────────────────────────────────────────────
  //
  // Bewusst Listen statt Freitext. Die Leitfäden sagen an mehreren Stellen
  // ausdrücklich, warum: „Ablehnungsgrund tracken – strukturiert, nicht als
  // Freitext-Roman“ und „Wer nur ‚Adresse geändert‘ dokumentiert, produziert
  // denselben Rückläufer beim nächsten Versand erneut.“

  /** Kündigungs-/Ablehnungsgründe aus dem Winback-Baukasten (Churn-Leitfaden). */
  const CHURN_REASONS = [
    { id: "preis", label: "Preis zu hoch", approach: "„Womit vergleichen Sie uns gerade?“ → Tarifwechsel, Rabattprüfung, Dealcloser" },
    { id: "bauzeit", label: "Zu lange Bauzeit", approach: "Ursachen erklären (Kommunen, Tiefbau, Genehmigungen), konkreten Stand nennen, Rückmeldung terminieren" },
    { id: "technik", label: "Technische Probleme", approach: "Ursache konkretisieren, Ticket an KB, Rückruf zusagen, ggf. Gutschrift prüfen" },
    { id: "umzug", label: "Umzug", approach: "Neue Adresse prüfen — bauen wir dort aus? Vertragsmitnahme, sonst Sonderregelung" },
    { id: "wettbewerb", label: "Wettbewerbsangebot", approach: "Konkretes Angebot erfragen, Wechselgarantie, Tarifvergleich, Leistungsargumentation" },
    { id: "beratung", label: "Unzufriedenheit mit der Beratung", approach: "Verstehen, einordnen, entschuldigen — ohne Kollegenschelte. Beratung nachholen, VZF versenden" },
    { id: "kein-bedarf", label: "Kein Bedarf mehr", approach: "Kaufmotiv reaktivieren, Nutzenargumentation, Joker-Frage" },
    { id: "sonstige", label: "Sonstiges", approach: "Im Kommentar konkret benennen — nur so wird der Grund auswertbar" }
  ];

  /** Auslöser von Kaufreue im Welcome Call — fünf Stück, mit Behandlung. */
  const WELCOME_REGRET_TRIGGERS = [
    { id: "ueberrumpelt", label: "Überrumpelungsgefühl", cue: "„Das ging mir alles zu schnell an der Tür.“", approach: "Tempo herausnehmen, Entscheidung als weiterhin frei darstellen, alles schriftlich anbieten" },
    { id: "abweichende-zusage", label: "Abweichende Zusage", cue: "„Der Kollege hat mir gesagt, dass …“", approach: "Nicht bewerten, sondern einordnen: Nur was schriftlich bestätigt ist, zählt — dann Unterlagen zusenden" },
    { id: "partner", label: "Partner nicht eingebunden", cue: "„Ich muss das erst mit meiner Frau besprechen.“", approach: "Worst-Case-Methode, Unterlagen zur gemeinsamen Prüfung, konkreten Rückruftermin" },
    { id: "preisschock", label: "Preisschock nach Vergleich", cue: "„Ich habe inzwischen günstigere Angebote gesehen.“", approach: "Vergleichsfrage stellen, Leistungsumfang gegenüberstellen, Tarifprüfung anbieten" },
    { id: "bauzeit", label: "Bauzeit unterschätzt", cue: "„Wann kommt das denn überhaupt?“", approach: "Ursachen erklären, konkreten Stand nennen, Rückmeldung terminieren statt vertrösten" }
  ];

  /**
   * Winback-Baukasten des Welcome Calls, in Eskalationsstufen. Die Reihenfolge
   * ist die Regel: „Nicht mit Stufe 3 einsteigen — wer sofort kompensiert,
   * verschenkt Marge und löst das eigentliche Problem nicht.“
   */
  const WINBACK_LADDER = [
    { id: "klarheit", stage: 1, label: "Klarheit", measure: "Unterlagen zusenden: Auftragsbestätigung, VZF, Widerrufsbelehrung", when: "Immer zuerst — kostet nichts und löst die meisten Fälle" },
    { id: "passung", stage: 2, label: "Passung", measure: "Tarif prüfen und anpassen, Wechselgarantie, Option ergänzen oder streichen", when: "Wenn Unsicherheit über Leistung oder Preis besteht" },
    { id: "kompensation", stage: 3, label: "Kompensation", measure: "Dealcloser einsetzen", when: "Nur nach Rücksprache und nur, wenn Stufe 1 und 2 nicht tragen", needsApproval: true },
    { id: "zeit", stage: 4, label: "Zeit", measure: "Konkreten Rückruftermin vereinbaren", when: "Statt eine Absage zu erzwingen" }
  ];

  /** Ursachen eines Postrückläufers — bestimmen die Korrektur, nicht nur die Doku. */
  const PRL_CAUSES = [
    { id: "namensschild", label: "Namensschild fehlt", cue: "Adresse korrekt, kein Name an Briefkasten oder Klingel", action: "Schreibweise und Namenszusatz erfragen, ggf. c/o aufnehmen" },
    { id: "wohnungsnummer", label: "Wohnungsnummer fehlt (MFH)", cue: "Mehrfamilienhaus ohne Etagen- oder Wohnungsangabe", action: "Stockwerk und Lage erfragen, HVN-Adresse ergänzen" },
    { id: "erfassungsfehler", label: "Erfassungsfehler im Auftrag", cue: "Hausnummer, PLZ oder Straßenname vertauscht", action: "Adresse vollständig neu aufnehmen und bestätigen lassen" },
    { id: "abweichende-post", label: "Abweichende Postanschrift", cue: "Anschlussadresse ist nicht die Zustelladresse", action: "ASA und HVN-Adresse getrennt erfassen" },
    { id: "umzug", label: "Umzug", cue: "Kunde ist bereits ausgezogen oder noch nicht eingezogen", action: "Neue Anschrift und Einzugsdatum erfassen, Auswirkung auf den Bau prüfen" },
    { id: "nachsendeauftrag", label: "Nachsendeauftrag abgelaufen", cue: "Kunde kennt die Sendung nicht", action: "Aktuelle Anschrift aufnehmen, erneuten Versand veranlassen" },
    { id: "zustellfehler", label: "Zustellfehler", cue: "Adresse ist nachweislich korrekt", action: "Erneuten Versand veranlassen, zusätzlich E-Mail-Zustellung anbieten" }
  ];

  /** Adressfelder, die der PRL-Call abgleicht. */
  const PRL_ADDRESS_FIELDS = [
    { id: "asa", label: "Anschlussadresse (ASA)", pitfall: "Wird mit der Postanschrift verwechselt" },
    { id: "hvn", label: "Postanschrift (HVN)", pitfall: "Fehlt bei abweichender Zustellung komplett" },
    { id: "name", label: "Name & Namenszusatz", pitfall: "Namensschild am Briefkasten weicht ab" },
    { id: "etage", label: "Etage / Wohnungslage", pitfall: "Ohne Angabe keine eindeutige Zustellung" },
    { id: "telefon", label: "Rufnummer", pitfall: "Nur eine hinterlegte Nummer" },
    { id: "email", label: "E-Mail-Adresse", pitfall: "Häufigste Fehlerquelle überhaupt — buchstabieren lassen" },
    { id: "zustellweg", label: "Zustellweg", pitfall: "E-Mail-Zustellung wird selten aktiv angeboten" }
  ];

  /** Gebäudetypen im Dubletten-Check — die eine Frage, die alles steuert. */
  const BUILDING_TYPES = [
    { id: "sdu1", label: "SDU 1 — eine Wohneinheit", details: false, hint: "Klassisches Einfamilienhaus. Direkter Duplikat-Check." },
    { id: "sdu2", label: "SDU 2 — zwei Wohneinheiten", details: true, hint: "Zweifamilienhaus. Gebäudedetails abfragen, dann Duplikat-Check." },
    { id: "mdu", label: "MDU — ab drei Wohneinheiten", details: true, hint: "Mehrfamilienhaus. Umstellung SDU → MDU prüfen und der Wohnungswirtschaft melden." }
  ];

  /** Gebäudedetails, die bei SDU 2 und MDU erhoben werden. */
  const BUILDING_DETAIL_FIELDS = [
    { id: "haushalte", label: "Anzahl Haushalte", type: "number", question: "„Wie viele Haushalte gibt es bei Ihnen im Haus?“" },
    { id: "stockwerk", label: "Stockwerk", type: "text", question: "„In welchem Stockwerk befindet sich Ihre Wohnung? Erdgeschoss oder Obergeschoss?“" },
    { id: "keller", label: "Keller vorhanden", type: "tristate", question: "„Gibt es bei Ihnen einen Keller, in dem Technik installiert werden könnte?“" },
    { id: "gemeinschaftsraum", label: "Gemeinschaftsraum zugänglich", type: "tristate", question: "„Gibt es einen Gemeinschaftsraum, zu dem Techniker Zugang hätten?“" },
    { id: "hausverwaltung", label: "Hausverwaltung", type: "text", question: "„Gibt es eine Hausverwaltung für das Gebäude?“" },
    { id: "innenhausverkabelung", label: "Innenhausverkabelung", type: "choice", options: ["eigenleistung", "erforderlich"], question: "„Kümmert sich der Eigentümer um die Verkabelung im Haus — oder müsste das noch gemacht werden?“" },
    { id: "vermieterZustimmung", label: "Vermieter-Zustimmung", type: "tristate", question: "„Haben Sie schon mit dem Eigentümer über den Anschluss gesprochen?“" }
  ];

  /** Antwortoptionen für die tristate-Felder oben. */
  const TRISTATE = [
    { id: "ja", label: "Ja" },
    { id: "nein", label: "Nein" },
    { id: "unbekannt", label: "Unbekannt" }
  ];

  /** Begründungen der Dublettenentscheidung. Ohne Begründung kein Status. */
  const DUPE_REASONS = [
    { id: "doppelter-abschluss", label: "Doppelter Vertragsabschluss", hint: "Gleicher Haushalt, zwei Bestellungen — älterer Vertrag bleibt bestehen." },
    { id: "inhaberwechsel", label: "Inhaberwechsel / Umzug", hint: "Neuer Bewohner oder Wechsel — gewünschter Vertrag bleibt bestehen." }
  ];

  /** Typologie der Bauverweigerer — die Ursache bestimmt den Lösungsweg. */
  const BVW_TYPOLOGY = [
    { id: "eigentuemer", label: "Eigentümer, selbstnutzend", cause: "Sorge um Garten, Einfahrt, Fassade oder Terminaufwand", approach: "Wiederherstellung, Trassenalternative, Terminflexibilität" },
    { id: "mieter", label: "Mieter ohne Eigentümerzustimmung", cause: "Eigentümer nicht erreicht oder ablehnend", approach: "§ 156 TKG erklären, Kontaktdaten aufnehmen, Abstimmung übernehmen" },
    { id: "hausverwaltung", label: "Hausverwaltung", cause: "Formale Gestattung fehlt oder ist nicht bearbeitet", approach: "Ansprechpartner und Weg der Gestattung erfragen, an WoWi geben" },
    { id: "weg", label: "Eigentümergemeinschaft (WEG)", cause: "Beschluss steht aus, nächste Versammlung entfernt", approach: "Zeitfenster benennen, Unterlagen für die Versammlung anbieten" },
    { id: "kosten", label: "Kosteneinwand", cause: "Mehrmeter über 20 m ab Grundstücksgrenze", approach: "Erlass der Mehrmeter prüfen — Rücksprache erforderlich" },
    { id: "innenverkabelung", label: "Innenhausverkabelung", cause: "Eigentümer sieht sich nicht zuständig", approach: "Zuständigkeit erklären, Gutschein bis 3 × 50 € reaktiv anbieten" },
    { id: "ablehnung", label: "Grundsätzliche Ablehnung", cause: "Kein Bedarf gesehen, Zweifel am Vertrag", approach: "Kaufmotiv reaktivieren, Einwandbehandlung, ggf. Eskalation" }
  ];

  /** Lösungsbaukasten BVW, nach Art gruppiert. */
  const BVW_SOLUTIONS = [
    { id: "trasse", group: "Technisch", label: "Alternative Trassenführung prüfen lassen" },
    { id: "erdrakete", group: "Technisch", label: "Erdrakete statt offener Grabung" },
    { id: "gebaeudeseite", group: "Technisch", label: "Einführung an anderer Gebäudeseite" },
    { id: "leerrohr", group: "Technisch", label: "Nutzung vorhandener Leerrohre" },
    { id: "saison", group: "Technisch", label: "Zeitpunkt an die Gartensaison anpassen" },
    { id: "mehrmeter", group: "Kaufmännisch", label: "Erlass der Mehrmeter über 20 m", needsApproval: true },
    { id: "gutschein", group: "Kaufmännisch", label: "Gutschein Innenhausverkabelung, bis 3 × 50 €", needsApproval: true, reactiveOnly: true },
    { id: "tarif", group: "Kaufmännisch", label: "Prüfung von Tarif oder Dealcloser bei Zweifeln am Vertrag", needsApproval: true },
    { id: "kostenklarheit", group: "Kaufmännisch", label: "Klarstellung: Hausanschluss und Tiefbau sind kostenfrei" },
    { id: "abstimmung", group: "Organisatorisch", label: "Abstimmung mit Hausverwaltung oder Eigentümer übernehmen" },
    { id: "ansprechpartner", group: "Organisatorisch", label: "Ansprechpartner und Erreichbarkeit aufnehmen" },
    { id: "termin", group: "Organisatorisch", label: "Terminfenster nach Kundenwunsch" },
    { id: "weg-unterlagen", group: "Organisatorisch", label: "Unterlagen für WEG-Versammlung bereitstellen" },
    { id: "wiederherstellung", group: "Organisatorisch", label: "Wiederherstellung schriftlich zusichern lassen" }
  ];

  /** Typische Fehlerbilder bei der Inbetriebnahme (Courtesy). */
  const COURTESY_FAULTS = [
    { id: "kein-signal-ont", label: "Keine Verbindungsanzeige am ONT", cause: "Glasfaserkabel nicht vollständig eingerastet oder falsche Dose" },
    { id: "router-lan", label: "ONT leuchtet, Router bekommt keine Verbindung", cause: "Router am LAN-Port statt am WAN-Port angeschlossen" },
    { id: "zugangsdaten", label: "Zugangsdaten werden abgelehnt", cause: "Daten aus einer älteren Sendung verwendet" },
    { id: "nicht-freigeschaltet", label: "Alles korrekt angeschlossen, dennoch kein Signal", cause: "Leitung noch nicht freigeschaltet — Leitungsprüfung im OIKO" }
  ];

  /** Was im Courtesy Call schiefgehen kann und wohin es weitergegeben wird. */
  const COURTESY_ISSUES = [
    { id: "hardware-fehlt", label: "Hardware oder Unterlagen fehlen", target: "KB — Neuversand" },
    { id: "hardware-falsch", label: "Falsche Geräte erhalten", target: "KB — Neuversand" },
    { id: "installation", label: "Schwierigkeiten bei der Installation", target: "KB — technische Unterstützung" },
    { id: "stoerung", label: "Störung auf der Leitung", target: "Planung & Bau" },
    { id: "sprachbarriere", label: "Sprachbarriere", target: "Rückruf in der Muttersprache oder Ticket" }
  ];

  // ── Die sechs Kampagnen ───────────────────────────────────────────────────
  //
  // `outcomes` ist je Kampagne vollständig: das, was der Bearbeiter nach dem
  // Auflegen anklickt. Felder je Ergebnis:
  //   disposition     Roll-up für die kampagnenübergreifende Auswertung
  //                   (Spalte calls.disposition, Migration 021). Fehlt sie,
  //                   gilt der Anruf als nicht entschieden.
  //   winbackStatus   Setzt den Winbackstatus mit (Migration 029). Steht hier
  //                   'erfolgreich'/'nicht_erfolgreich', verlangt die Erfassung
  //                   zwingend eine Ursache — siehe WINBACK_STATUS.
  //   requires        Pflichtfelder der Erfassung. Ids siehe WRAPUP_FIELDS.
  //   followUp        Legt zusätzlich eine Wiedervorlage an.
  //   opensPanel      Öffnet das Abschluss-Panel für einen echten CRM-Eintrag.

  const CAMPAIGNS = {
    welcome: {
      id: "welcome",
      label: "Welcome",
      title: "Welcome Call",
      subtitle: "Vertragssicherung, Datenqualität und Kundenerlebnis im ersten Kontakt nach Vertragsabschluss",
      scope: "Alle Neuverträge, alle Kanäle",
      version: "2.0",
      stand: "August 2026",
      systems: ["oiko", "jira", "caseris", "churnliste"],
      // Feste Rufnummernanzeige dieser Kampagne. § 120 TKG verbietet die
      // Unterdrückung — der Wert steht hier, damit die Oberfläche ihn nennen
      // kann statt ihn dem Gedächtnis zu überlassen.
      callerId: "0431 97992556",
      timing: {
        window: "24 bis 72 Stunden nach Vertragsabschluss",
        note: "Innerhalb der Widerrufsfrist und bevor sich Zweifel verfestigen.",
        minAttempts: 3,
        spreadOverDay: true
      },
      outcomes: [
        {
          id: "auftrag-bestaetigt",
          label: "Auftrag bestätigt & Daten abgeglichen",
          disposition: "gehalten",
          opensPanel: true,
          requires: ["legitimation", "adviceScore", "doi"],
          seed: "Welcome Call geführt. Auftrag vom Kunden bestätigt, Stammdaten abgeglichen. Beratungsnote: [ergänzen]."
        },
        {
          id: "winback-erfolgreich",
          label: "Kaufreue — Winback erfolgreich",
          disposition: "gehalten",
          winbackStatus: "erfolgreich",
          opensPanel: true,
          requires: ["legitimation", "winbackReason", "winbackMeasure", "adviceScore", "doi"],
          seed: "Kunde äußerte Zweifel am Vertrag. Winback erfolgreich. Auslöser: [ergänzen]. Vereinbarte Maßnahme: [ergänzen]."
        },
        {
          id: "widerruf-absicht",
          label: "Widerrufsabsicht — Formular zugesandt",
          disposition: "gekuendigt",
          winbackStatus: "nicht_erfolgreich",
          opensPanel: true,
          requires: ["legitimation", "rejectionReason"],
          seed: "Kunde hält an der Widerrufsabsicht fest. Winbackversuch erfolglos. Ablehnungsgrund: [ergänzen]. Auf das Formular auf der Homepage verwiesen, Link zugesandt."
        },
        {
          id: "vertragsaenderung",
          label: "Tarifwechsel im Gespräch vereinbart",
          disposition: "gehalten",
          winbackStatus: "erfolgreich",
          opensPanel: true,
          requires: ["legitimation", "winbackReason", "winbackMeasure", "confirmationSent", "doi"],
          seed: "Tarifwechsel im Gespräch vereinbart und im OIKO abgebildet. VZF-Bestätigung im laufenden Gespräch. Bestätigung per E-Mail versandt."
        },
        CALLBACK_OUTCOME,
        {
          id: "kein-interesse",
          label: "Kein Interesse / später",
          disposition: "kein-interesse",
          opensPanel: false,
          seed: "Kunde wünscht aktuell keine weitere Besprechung des Anliegens. Begründung: [ergänzen]."
        }
      ],
      // „Abschluss-Check“ des Leitfadens. Was hier steht, wird bei jedem
      // Ergebnis mit disposition geprüft — unabhängig vom gewählten Ergebnis.
      checklist: [
        { id: "legitimation", label: "Identität vor Nennung von Vertragsdaten bestätigt", required: true },
        { id: "auftragsverifikation", label: "Auftrag (Adresse, Tarif) mit dem Kunden verifiziert", required: true },
        { id: "adviceProtocol", label: "Beratungsprotokoll erfragt", required: true },
        { id: "adviceScore", label: "Beratungsnote 1–6 erfasst", required: true },
        { id: "dataCheck", label: "Stammdaten abgeglichen (Adresse, Name, Rufnummer, E-Mail)", required: true },
        { id: "homeId", label: "HomeID aufgenommen (falls bereits ausgebaut)", required: false, hint: "Zwingend und vergütungsrelevant, sobald ausgebaut wurde." },
        { id: "doi", label: "Double-Opt-In Permission angekündigt und ausgelöst", required: true },
        { id: "documentation", label: "Dokumentation nach dem 4-W-Standard", required: true }
      ],
      catalogs: {
        rejectionReason: WELCOME_REGRET_TRIGGERS,
        winbackMeasure: WINBACK_LADDER
      },
      // Gilt in dieser Kampagne besonders: Kaufreue-Auslöser als
      // Winback-Ursache, Beratungsnote als eigene Kennzahl.
      capturesAdviceScore: true,
      capturesFraud: true
    },

    churn: {
      id: "churn",
      label: "Churn",
      title: "Churn: Widerrufe & Kündigungen",
      subtitle: "Gezielte Winbacks — verstehen, einordnen, halten und sauber dokumentieren",
      scope: "Alle Widerrufs- und Kündigungswünsche",
      version: "2.0",
      stand: "August 2026",
      systems: ["oiko", "jira", "caseris", "churnliste"],
      callerId: "eigene Mobil-/Handynummer",
      timing: {
        note: "Jeder Widerruf und jede Kündigung wird angerufen — ohne Ausnahme. Winback immer vor Churn.",
        minAttempts: 3,
        spreadOverDay: true
      },
      // Weichenstellung des Leitfadens: Widerruf oder Kündigung. Bestimmt
      // Frist, Wirkung und Winback-Chance — deshalb Pflichtangabe.
      variants: [
        { id: "widerruf", label: "Widerruf", law: "§§ 312g, 355 BGB", deadline: "14 Tage ab Zugang der Widerrufsbelehrung (§ 356 Abs. 3 BGB)", effect: "Vertrag gilt als nicht geschlossen — vollständige Rückabwicklung", winbackChance: "hoch" },
        { id: "kuendigung", label: "Kündigung", law: "§ 56 TKG", deadline: "Vertragliche Kündigungsfrist, Textform genügt (§ 309 Nr. 13 BGB)", effect: "Vertrag endet zum Kündigungstermin, Laufzeit bleibt bestehen", winbackChance: "geringer, aber vorhanden" }
      ],
      outcomes: [
        {
          id: "winback-erfolgreich",
          label: "Winback erfolgreich — Kunde gehalten",
          disposition: "gehalten",
          winbackStatus: "erfolgreich",
          opensPanel: true,
          requires: ["legitimation", "variant", "winbackReason", "winbackMeasure", "confirmationSent"],
          seed: "Kunde gehalten. Ursprünglicher Grund: [ergänzen]. Vereinbarte Maßnahme: [ergänzen]. Bestätigung per E-Mail versandt."
        },
        {
          id: "winback-gescheitert",
          label: "Winback gescheitert — Formular zugesandt",
          disposition: "gekuendigt",
          winbackStatus: "nicht_erfolgreich",
          opensPanel: true,
          requires: ["legitimation", "variant", "rejectionReason"],
          seed: "Kunde hält an der Erklärung fest. Ablehnungsgrund: [ergänzen]. Auf das Formular auf der Homepage verwiesen und Link zugesandt."
        },
        {
          id: "irrelevant",
          label: "Irrelevant (kein Winback möglich)",
          winbackStatus: "irrelevant",
          opensPanel: true,
          requires: ["note"],
          seed: "Kein Winback möglich. Begründung so dokumentiert, dass sie ohne Rückfrage verständlich ist: [ergänzen]."
        },
        CALLBACK_OUTCOME,
        {
          id: "kein-interesse",
          label: "Kein Interesse / später",
          disposition: "kein-interesse",
          opensPanel: false,
          seed: "Kunde wünscht aktuell keine weitere Besprechung des Anliegens. Begründung: [ergänzen]."
        }
      ],
      checklist: [
        { id: "legitimation", label: "Identität vor Nennung von Vertragsdaten bestätigt", required: true },
        { id: "decision", label: "Klare Entscheidung herbeigeführt — kein offenes Ende", required: true },
        { id: "winbackStatus", label: "Winback-Status mit Ursache gesetzt", required: true, hint: "Ohne Ursache bleibt der Fall auf „offen“ — weder abrechenbar noch auswertbar." },
        { id: "measures", label: "Besprochene Maßnahmen ausgeführt (Tarifwechsel, Dealcloser, Datenänderung)", required: false },
        { id: "confirmationSent", label: "Vertragsänderungen per E-Mail zur Bestätigung versandt", required: false },
        { id: "homeId", label: "HomeID nach erfolgreichem Winback aufgenommen", required: false },
        { id: "doi", label: "Double-Opt-In Permission angekündigt und ausgelöst", required: true },
        { id: "documentation", label: "Ergebnis in der Churnliste dokumentiert (Grund + Kommentar)", required: true }
      ],
      catalogs: {
        rejectionReason: CHURN_REASONS,
        winbackReason: CHURN_REASONS,
        winbackMeasure: WINBACK_LADDER
      },
      capturesFraud: true
    },

    prl: {
      id: "prl",
      label: "PRL",
      title: "Postrückläufer",
      subtitle: "Verträge, deren Auftragsbestätigung postalisch nicht zugestellt werden konnte",
      scope: "Alle Verträge mit Postrücklauf",
      version: "2.0",
      stand: "August 2026",
      systems: ["oiko", "jira", "churnliste"],
      callerId: "eigene Mobil-/Handynummer",
      timing: {
        note: "Ohne Zugang der Widerrufsbelehrung läuft die Frist nicht — der Vertrag bleibt bis zu zwölf Monate und 14 Tage angreifbar (§ 356 Abs. 3 BGB).",
        minAttempts: 3,
        spreadOverDay: true
      },
      outcomes: [
        {
          id: "adresse-korrigiert",
          label: "Adresse korrigiert — Versand veranlasst",
          disposition: "gehalten",
          opensPanel: true,
          requires: ["legitimation", "prlCause", "resendTriggered", "emailConfirmed"],
          seed: "Adressdaten gemeinsam abgeglichen und korrigiert. Ursache des Rückläufers: [ergänzen]. Erneuter Versand veranlasst, E-Mail-Zustellung zusätzlich angeboten."
        },
        {
          id: "adresse-bestaetigt",
          label: "Adresse korrekt — Zustellfehler",
          disposition: "gehalten",
          opensPanel: true,
          requires: ["legitimation", "prlCause", "resendTriggered"],
          seed: "Adresse nachweislich korrekt, Zustellfehler. Erneuter Versand veranlasst, zusätzlich E-Mail-Zustellung angeboten."
        },
        {
          id: "irrlaeufer",
          label: "Irrläufer — nicht der Vertragsnehmer",
          opensPanel: true,
          requires: ["note"],
          seed: "Angerufene Person ist nicht der Vertragsnehmer. Keine Vertragsdaten genannt, Vorgang gekennzeichnet."
        },
        {
          id: "widerruf-absicht",
          label: "Kaufreue — Widerrufsabsicht",
          disposition: "gekuendigt",
          winbackStatus: "nicht_erfolgreich",
          opensPanel: true,
          requires: ["legitimation", "rejectionReason"],
          seed: "Kunde äußert Zweifel am Vertrag. Winbackversuch erfolglos. Ablehnungsgrund: [ergänzen]. Auf das Formular verwiesen und Link zugesandt."
        },
        {
          id: "winback-erfolgreich",
          label: "Kaufreue — Winback erfolgreich",
          disposition: "gehalten",
          winbackStatus: "erfolgreich",
          opensPanel: true,
          requires: ["legitimation", "winbackReason", "winbackMeasure"],
          seed: "Kunde äußerte Zweifel am Vertrag. Winback erfolgreich. Vereinbarte Maßnahme: [ergänzen]."
        },
        CALLBACK_OUTCOME
      ],
      checklist: [
        { id: "legitimation", label: "Identität vor Nennung von Vertragsdaten bestätigt", required: true },
        { id: "addressComplete", label: "Adress- und Kontaktdaten vollständig und bestätigt", required: true },
        { id: "prlCause", label: "Ursache des Rückläufers dokumentiert — nicht nur die Korrektur", required: true },
        { id: "resendTriggered", label: "Erneuter Versand veranlasst und dem Kunden angekündigt", required: true },
        { id: "emailConfirmed", label: "E-Mail-Adresse bestätigt und als Zustellweg angeboten", required: true },
        { id: "homeId", label: "HomeID aufgenommen, sofern bereits ausgebaut", required: false },
        { id: "doi", label: "Double-Opt-In Permission angekündigt und ausgelöst", required: true }
      ],
      catalogs: {
        prlCause: PRL_CAUSES,
        addressField: PRL_ADDRESS_FIELDS,
        rejectionReason: CHURN_REASONS,
        winbackReason: CHURN_REASONS,
        winbackMeasure: WINBACK_LADDER
      },
      capturesFraud: true
    },

    dupe: {
      id: "dupe",
      label: "Dupe",
      title: "Dubletten-Check",
      subtitle: "Mehrere Verträge zu einer Adresse prüfen, einordnen und im System bereinigen",
      scope: "Gelistete Ein- und Zweifamilienhäuser mit Dublettenverdacht",
      version: "2.0",
      stand: "August 2026",
      systems: ["oiko", "jira", "caseris"],
      callerId: "0431 97992557",
      timing: { minAttempts: 3, spreadOverDay: true },
      // Besondere Datenschutz-Vorgabe dieser Kampagne. Die Oberfläche muss sie
      // durchsetzen, nicht nur anzeigen: gegenüber Person A darf nicht
      // offengelegt werden, dass Person B einen Vertrag hat.
      privacy: {
        hideOtherContractHolders: true,
        note: "Neutral formulieren: „uns liegen mehrere Bestellungen zu dieser Adresse vor“ — keine Namen, keine Tarife, keine Konditionen Dritter."
      },
      outcomes: [
        {
          id: "keine-dublette",
          label: "Keine Dublette — beide Verträge korrekt",
          disposition: "gehalten",
          opensPanel: true,
          requires: ["legitimation", "buildingType"],
          seed: "Prüfung ergibt keine Dublette. Beide Bestellungen sind so gewollt bzw. betreffen unterschiedliche Wohnungen. Gebäudetyp: [ergänzen]."
        },
        {
          id: "dublette-bereinigt",
          label: "Bestätigte Dublette — bereinigt",
          disposition: "gehalten",
          opensPanel: true,
          requires: ["legitimation", "buildingType", "dupeReason", "secondPartyHandled"],
          seed: "Bestätigte Dublette. Ein Vertrag bleibt bestehen, der andere wird bereinigt. Begründung: [ergänzen]. Zweiter Vertragsnehmer einbezogen bzw. informiert."
        },
        {
          id: "klaerung-offen",
          label: "Klärung offen — zweite Person nicht erreicht",
          opensPanel: true,
          requires: ["legitimation", "buildingType", "note"],
          seed: "Faktenlage noch nicht eindeutig. Zweiter Vertragsnehmer nicht erreicht, Aufklärung per Mail angestoßen. Offener Punkt: [ergänzen]."
        },
        {
          id: "sdu-mdu-umstellung",
          label: "Umstellung SDU → MDU gemeldet",
          disposition: "gehalten",
          opensPanel: true,
          requires: ["legitimation", "buildingType", "jiraComponent"],
          seed: "Gelistetes Einfamilienhaus ist tatsächlich ein Mehrfamilienhaus. Gebäudedetails erhoben, Umstellung der Wohnungswirtschaft per Ticket gemeldet (PKV-Immo-Eingang)."
        },
        {
          id: "uebergang-bvw",
          label: "Keine Einigung — Übergang Bauverweigerer",
          opensPanel: true,
          requires: ["legitimation", "note"],
          seed: "Zur Innenhausverkabelung keine Einigung erzielt. Übergang in den Bauverweigerer-Leitfaden."
        },
        CALLBACK_OUTCOME
      ],
      checklist: [
        { id: "legitimation", label: "Identität vor Nennung von Vertragsdaten bestätigt", required: true },
        { id: "buildingType", label: "Gebäudetyp bestimmt (SDU 1 / SDU 2 / MDU)", required: true },
        { id: "buildingDetails", label: "Gebäudedetails vollständig erfasst (bei SDU 2 / MDU)", required: false },
        { id: "dupeDecision", label: "Ein Vertrag bleibt bestehen, Dublette mit Begründung bereinigt", required: false },
        { id: "wiring", label: "Innenhausverkabelung korrekt zugeordnet — bei SDU 2 nie „erforderlich“", required: false },
        { id: "secondPartyHandled", label: "Zweite Person einbezogen oder informiert", required: false },
        { id: "homeId", label: "HomeID aufgenommen, sofern bereits ausgebaut", required: false },
        { id: "doi", label: "Double-Opt-In Permission angekündigt und ausgelöst", required: true }
      ],
      catalogs: {
        buildingType: BUILDING_TYPES,
        buildingDetail: BUILDING_DETAIL_FIELDS,
        dupeReason: DUPE_REASONS,
        jiraComponent: JIRA_COMPONENTS.filter((c) => c.campaign === "dupe")
      },
      // Systemvorgabe des Leitfadens: bei SDU 2 ist „erforderlich“ nicht
      // zulässig — die Umsetzung liegt beim Eigentümer.
      rules: {
        wiringRequiredForbiddenFor: ["sdu2"]
      }
    },

    bvw: {
      id: "bvw",
      label: "BVW",
      title: "Bauverweigerer",
      subtitle: "Ausbau ermöglichen, Verträge sichern — und den Anschluss gemeinsam realisieren",
      scope: "Kunden mit gültigem Vertrag, die den Ausbau verweigern",
      version: "2.0",
      stand: "August 2026",
      systems: ["oiko", "jira", "churnliste"],
      callerId: "eigene Mobil-/Handynummer",
      timing: {
        note: "Der Ausbau ist noch möglich — aber nur kurzfristig (innerhalb von vier Monaten).",
        minAttempts: 3,
        spreadOverDay: true,
        // Nach dem Schadenersatz-Anschreiben: Arbeitsbeginn auf in 14 Tagen,
        // danach zweiter Winbackversuch.
        followUpDays: 14
      },
      outcomes: [
        {
          id: "ausbau-ermoeglicht",
          label: "Ausbau ermöglicht — Kunde stimmt zu",
          disposition: "gehalten",
          winbackStatus: "erfolgreich",
          opensPanel: true,
          requires: ["legitimation", "bvwTypology", "buildCondition", "contactPerson"],
          seed: "Kunde lässt den Bau vertragsgemäß zu. Ursache der Verweigerung: [ergänzen]. Bedingung des Kunden: [ergänzen]. Für den Tiefbaupartner hinterlegt."
        },
        {
          id: "anschreiben",
          label: "Ablehnung — Schadenersatz-Anschreiben veranlasst",
          winbackStatus: "offen",
          opensPanel: true,
          requires: ["legitimation", "bvwTypology", "rejectionReason", "contractValid", "jiraComponent", "followUpAt"],
          seed: "Kunde lehnt den Ausbau weiterhin ab. Vertragsgültigkeit geprüft. Schadenersatz-Anschreiben veranlasst, Arbeitsbeginn auf in 14 Tagen gesetzt (GFIZ-BVW-Anschreiben)."
        },
        {
          id: "ablehnung-final",
          label: "Zweiter Winback gescheitert — an AMA",
          disposition: "gekuendigt",
          winbackStatus: "nicht_erfolgreich",
          opensPanel: true,
          requires: ["legitimation", "bvwTypology", "rejectionReason", "jiraComponent"],
          seed: "Zweiter Winbackversuch nach dem Anschreiben gescheitert. Weitergabe an AMA zur Abrechnung (AMA-Eingang)."
        },
        {
          id: "klaerung-irrelevant",
          label: "Sonderfall — Klärung erforderlich (irrelevant)",
          winbackStatus: "irrelevant",
          opensPanel: true,
          requires: ["legitimation", "note", "jiraComponent"],
          seed: "Ausbau derzeit nicht möglich (Renovierung / technisch nicht umsetzbar). Ticket auf Wiedervorlage, Komponente GFIZ-BVW-Klärung. Begründung ohne Vorwissen verständlich: [ergänzen]."
        },
        {
          id: "storno-ungueltig",
          label: "Vertrag nicht mehr gültig — AMA & Storno",
          winbackStatus: "irrelevant",
          opensPanel: true,
          requires: ["legitimation", "contractValid", "note"],
          seed: "Vertrag nicht mehr gültig (keine VZF-Genehmigung bzw. Restlaufzeit unter 7 Monaten). Direkte Weiterleitung an AMA und Storno — kein Anschreiben, keine Schadenersatzforderung."
        },
        {
          id: "eskalation-recht",
          label: "Rechtseinwand — an die Rechtsabteilung",
          opensPanel: true,
          requires: ["legitimation", "note"],
          seed: "Kunde nennt fehlende VZF-Bestätigung (§ 54 TKG) bzw. ein OLG-Urteil. Keine eigene Bewertung, Übergabe an die Rechtsabteilung."
        },
        CALLBACK_OUTCOME
      ],
      checklist: [
        { id: "legitimation", label: "Identität vor Nennung von Vertragsdaten bestätigt", required: true },
        { id: "bvwTypology", label: "Ursache der Verweigerung ermittelt und eingeordnet", required: true },
        { id: "buildCondition", label: "Ausbaubedingung wörtlich dokumentiert", required: false, hint: "Was der Kunde konkret braucht, damit gebaut werden darf." },
        { id: "contactPerson", label: "Kontaktdaten aufgenommen — auch Eigentümer / Hausverwaltung", required: false },
        { id: "winbackStatus", label: "Winback-Status mit Ursache gesetzt", required: true },
        { id: "jiraComponent", label: "JIRA-Komponente gesetzt und Arbeitsbeginn eingetragen", required: false, hint: "Ohne Arbeitsbeginn taucht das Ticket in keinem Filter auf." },
        { id: "doi", label: "Double-Opt-In Permission angekündigt und ausgelöst", required: true }
      ],
      catalogs: {
        bvwTypology: BVW_TYPOLOGY,
        solution: BVW_SOLUTIONS,
        rejectionReason: CHURN_REASONS,
        jiraComponent: JIRA_COMPONENTS.filter((c) => c.campaign === "bvw")
      },
      rules: {
        // „Vertrag nicht mehr gültig“: keine VZF-Genehmigung ODER
        // Restvertragslaufzeit unter 7 Monaten → AMA & Storno, kein Anschreiben.
        minRemainingMonthsForLetter: 7,
        damagesMonths: 24
      }
    },

    courtesy: {
      id: "courtesy",
      label: "Courtesy",
      title: "Courtesy Call",
      subtitle: "Aktivierungsunterstützung nach Hardwareversand – vom Paket zum nutzbaren Anschluss",
      scope: "ONT-Postversand, fehlende HomeID, Bestandsobjekte",
      version: "2.0",
      stand: "August 2026",
      systems: ["oiko", "jira", "caseris"],
      callerId: "0431 97992556",
      timing: {
        note: "Ein abgebrochener Call bedeutet einen nicht aktivierten Anschluss.",
        minAttempts: 3,
        spreadOverDay: true
      },
      outcomes: [
        {
          id: "aktiviert",
          label: "Anschluss aktiv — alles in Ordnung",
          disposition: "gehalten",
          opensPanel: true,
          requires: ["legitimation", "connectionId", "homeId", "doi"],
          seed: "Inbetriebnahme war erfolgreich, Anschluss ist aktiv. Anschluss-ID bestätigt, HomeID aufgenommen."
        },
        {
          id: "begleitet-aktiviert",
          label: "Aktivierung telefonisch begleitet — jetzt aktiv",
          disposition: "gehalten",
          opensPanel: true,
          requires: ["legitimation", "connectionId", "courtesyIssue", "homeId", "doi"],
          seed: "Installation telefonisch begleitet, Anschluss anschließend aktiv. Beobachtetes Fehlerbild: [ergänzen]."
        },
        {
          id: "hardware-ticket",
          label: "Hardware fehlt / falsch — Ticket an KB",
          opensPanel: true,
          requires: ["legitimation", "connectionId", "courtesyIssue", "note"],
          seed: "Hardware oder Unterlagen fehlten bzw. waren falsch. Ticket an KB für Neuversand. Was gefehlt hat: [ergänzen]."
        },
        {
          id: "stoerung-ticket",
          label: "Störung — Ticket an Planung & Bau",
          opensPanel: true,
          requires: ["legitimation", "connectionId", "courtesyIssue", "note"],
          seed: "Leitungsprüfung im OIKO ergibt eine Störung. Ticket an Planung & Bau. Beobachtung des Kunden wörtlich: [ergänzen]. Erreichbarkeit: [ergänzen]."
        },
        {
          id: "sprachbarriere",
          label: "Sprachbarriere — Rückruf in Muttersprache",
          opensPanel: true,
          followUp: true,
          requires: ["language"],
          seed: "Sprachbarriere. Muttersprache dokumentiert, Rückruf in der Muttersprache terminiert bzw. Ticket angelegt."
        },
        CALLBACK_OUTCOME
      ],
      checklist: [
        { id: "legitimation", label: "Identität vor Nennung von Vertragsdaten bestätigt", required: true },
        { id: "connectionId", label: "Anschluss-ID abgeglichen, bevor über den Anschluss gesprochen wurde", required: true },
        { id: "activation", label: "Aktivierung begleitet oder gelungene Aktivierung geprüft", required: true },
        { id: "hardware", label: "Fehlende Hardware oder Zugänge veranlasst", required: false },
        { id: "escalation", label: "Weitere Anliegen geklärt oder als Ticket dokumentiert", required: false },
        { id: "homeId", label: "HomeID gegengeprüft oder neu aufgenommen", required: true, hint: "Kern dieser Kampagne — zwingend und vergütungsrelevant." },
        { id: "doi", label: "Double-Opt-In Permission angekündigt und ausgelöst", required: true }
      ],
      catalogs: {
        courtesyIssue: COURTESY_ISSUES,
        fault: COURTESY_FAULTS
      },
      requiresHomeId: true
    }
  };

  /** Reihenfolge für Werkzeugleisten und Auswertungen. */
  const CAMPAIGN_ORDER = ["welcome", "churn", "prl", "dupe", "bvw", "courtesy"];

  /**
   * Felder der Gesprächserfassung. `requires` je Ergebnis referenziert diese
   * Ids; die Oberfläche baut daraus ihre Pflichtfeld-Prüfung, und
   * `missingRequirements()` unten benutzt dieselbe Liste. Eine ID, die hier
   * fehlt, kann nicht verlangt werden — das ist Absicht.
   */
  const WRAPUP_FIELDS = {
    legitimation: { label: "Legitimation", hint: "Womit wurde die Identität bestätigt?" },
    // Bestätigungen aus dem Abschluss-Check. Sie sind Ja/Nein-Haken, keine
    // Werte — stehen aber hier, weil sie sonst nicht verlangt werden könnten:
    // `want()` kennt nur Ids aus dieser Liste, und ein Abschluss-Check, den
    // niemand prüft, ist bloß Dekoration.
    auftragsverifikation: { label: "Auftrag verifiziert", hint: "Adresse und Tarif mit dem Kunden abgeglichen.", confirm: true },
    adviceProtocol: { label: "Beratungsprotokoll erfragt", hint: "Wurde beim Abschluss eines ausgehändigt?", confirm: true },
    dataCheck: { label: "Stammdaten abgeglichen", hint: "Adresse, Name, Rufnummer, E-Mail.", confirm: true },
    decision: { label: "Entscheidung herbeigeführt", hint: "Kein offenes Ende — das Gespräch hat ein Ergebnis.", confirm: true },
    addressComplete: { label: "Adressdaten vollständig", hint: "ASA und HVN getrennt, Etage, Namenszusatz.", confirm: true },
    activation: { label: "Aktivierung geprüft", hint: "Begleitet oder gelungene Aktivierung bestätigt.", confirm: true },
    buildingDetails: { label: "Gebäudedetails erfasst", hint: "Haushalte, Stockwerk, Keller, Gemeinschaftsraum, Hausverwaltung.", confirm: true },
    wiring: { label: "Innenhausverkabelung zugeordnet", hint: "Bei SDU 2 nie „erforderlich“.", confirm: true },
    documentation: { label: "Dokumentation nach 4 W", hint: "Wer, Was, Welche Maßnahme, Wann.", confirm: true },
    winbackStatus: { label: "Winback-Status", hint: "Nur mit Ursache setzbar." },
    variant: { label: "Widerruf oder Kündigung", hint: "Bestimmt Frist, Wirkung und Winback-Chance." },
    winbackReason: { label: "Winback-Ursache", hint: "Warum wollte der Kunde gehen?" },
    winbackMeasure: { label: "Vereinbarte Maßnahme", hint: "Welche Stufe des Baukastens wurde eingesetzt?" },
    rejectionReason: { label: "Ablehnungsgrund", hint: "Strukturiert erfassen, nicht als Freitext-Roman." },
    adviceScore: { label: "Beratungsnote", hint: "Schulnote 1–6, wie der Kunde die Beratung bewertet." },
    prlCause: { label: "Ursache des Rückläufers", hint: "Bestimmt die Korrektur — nicht nur die Doku." },
    resendTriggered: { label: "Erneuter Versand veranlasst", hint: "Konkret zusagen und auslösen." },
    emailConfirmed: { label: "E-Mail-Adresse bestätigt", hint: "Buchstabieren lassen und wiederholen." },
    buildingType: { label: "Gebäudetyp", hint: "SDU 1, SDU 2 oder MDU." },
    dupeReason: { label: "Begründung der Dublettenentscheidung", hint: "Inhaberwechsel/Umzug oder doppelter Vertragsabschluss." },
    secondPartyHandled: { label: "Zweite Person einbezogen", hint: "Einbezogen oder informiert — keine einseitige Entscheidung." },
    bvwTypology: { label: "Typologie der Verweigerung", hint: "Die Ursache bestimmt den Lösungsweg." },
    buildCondition: { label: "Ausbaubedingung", hint: "Wörtlich dokumentieren, was der Kunde braucht." },
    contactPerson: { label: "Ansprechpartner", hint: "Name, Telefon und E-Mail — auch Eigentümer oder Hausverwaltung." },
    contractValid: { label: "Vertragsgültigkeit geprüft", hint: "VZF-Genehmigung und Restlaufzeit ≥ 7 Monate." },
    jiraComponent: { label: "JIRA-Komponente", hint: "Ohne sie taucht das Ticket in keinem Filter auf." },
    connectionId: { label: "Anschluss-ID abgeglichen", hint: "Vor jedem inhaltlichen Wort über den Anschluss." },
    courtesyIssue: { label: "Beobachtetes Problem", hint: "Was der Kunde meldet — wörtlich, nicht interpretiert." },
    language: { label: "Muttersprache", hint: "In welcher Sprache der Rückruf erfolgen sollte." },
    homeId: { label: "HomeID", hint: "HomeID vor ONT-Seriennummer vor AD-Nummer." },
    doi: { label: "Double-Opt-In", hint: "Angekündigt und ausgelöst — ohne Ausnahme." },
    confirmationSent: { label: "Bestätigung versandt", hint: "Ohne dokumentierte Bestätigung keine Umsetzung und keine Vergütung." },
    followUpAt: { label: "Rückruftermin", hint: "Konkreter Termin, nicht „irgendwann nochmal“." },
    note: { label: "Kommentar", hint: "Ganze Sätze, sachlich und wertfrei." }
  };

  // ── Funktionen ────────────────────────────────────────────────────────────

  /**
   * Unbekannter Call-Typ fällt auf churn zurück statt zu werfen — gleiche
   * Haltung wie shiftMeta(): ein alter Client soll an einer neu eingeführten
   * Kampagne nicht zerbrechen. 'other' hat bewusst keinen eigenen Leitfaden.
   */
  function campaign(callType) {
    return (callType && CAMPAIGNS[callType]) || CAMPAIGNS.churn;
  }

  /** Alle Kampagnen in Anzeigereihenfolge. */
  function allCampaigns() {
    return CAMPAIGN_ORDER.map((id) => CAMPAIGNS[id]);
  }

  /** Ergebnisliste einer Kampagne, inklusive der Nicht-Erreicht-Ergebnisse. */
  function outcomesFor(callType, direction) {
    const own = campaign(callType).outcomes || [];
    const generic = direction === "inbound"
      ? NO_CONTACT_OUTCOMES.filter((o) => !o.outboundOnly)
      : NO_CONTACT_OUTCOMES;
    return own.concat(generic);
  }

  /** Ein einzelnes Ergebnis. null, wenn die Kampagne es nicht kennt. */
  function outcome(callType, outcomeId) {
    return outcomesFor(callType).find((o) => o.id === outcomeId) || null;
  }

  /**
   * Erkennt die Art einer eingegebenen Nummer. Gibt die bestbewertete
   * passende Art zurück (HomeID vor ONT vor AD) — oder null, wenn nichts passt.
   * Wichtig fürs Gespräch: 0/O und 1/I sind laut Leitfaden die häufigsten
   * Verwechslungen, deshalb wird vor dem Test normalisiert.
   */
  function normalizeHomeId(raw) {
    return String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  }

  function detectHomeIdKind(raw) {
    const value = normalizeHomeId(raw);
    if (!value) return null;
    // AD-Nummern zuerst: ihr Muster ist das engste und würde sonst vom
    // allgemeinen alphanumerischen Muster mitgefressen.
    const ad = HOME_ID_KINDS.find((k) => k.id === "ad");
    if (ad.pattern.test(value)) return ad;
    const generic = HOME_ID_KINDS.filter((k) => k.id !== "ad");
    return generic.find((k) => k.pattern.test(value)) || null;
  }

  /**
   * Prüft eine HomeID-Eingabe gegen die für sie angegebene Art.
   * @returns {{ok: boolean, value: string, reason?: string}}
   */
  function validateHomeId(raw, kindId) {
    const value = normalizeHomeId(raw);
    if (!value) return { ok: false, value, reason: "leer" };
    const kind = HOME_ID_KINDS.find((k) => k.id === kindId);
    if (!kind) return { ok: false, value, reason: "unbekannte Art" };
    if (!kind.pattern.test(value)) return { ok: false, value, reason: `passt nicht zum Muster einer ${kind.label} (Beispiel: ${kind.example})` };
    return { ok: true, value };
  }

  /** Liegt der Zeitpunkt im zulässigen Anrufzeitfenster? */
  function isWithinContactWindow(date) {
    const d = date || new Date();
    const weekday = d.getDay() === 0 ? 7 : d.getDay();
    if (!CONTACT_WINDOW.weekdays.includes(weekday)) return false;
    const min = d.getHours() * 60 + d.getMinutes();
    return min >= CONTACT_WINDOW.startMin && min < CONTACT_WINDOW.endMin;
  }

  /**
   * Das Herzstück: welche Pflichtangaben fehlen einer Gesprächserfassung noch?
   *
   * Prüft drei Quellen zusammen, weil sie im Leitfaden auch zusammengehören:
   *   1. `requires` des gewählten Ergebnisses
   *   2. den Abschluss-Check der Kampagne (checklist mit required: true)
   *   3. die harte Regel „Winbackstatus nur mit Ursache“
   *
   * @param {string} callType
   * @param {string} outcomeId
   * @param {object} wrapup Erfasste Werte, Schlüssel wie in WRAPUP_FIELDS.
   * @returns {{id: string, label: string, hint?: string}[]}
   */
  function missingRequirements(callType, outcomeId, wrapup) {
    const data = wrapup || {};
    const conf = campaign(callType);
    const chosen = outcome(callType, outcomeId);
    if (!chosen) return [];

    // Ergebnisse ohne Gespräch verlangen nichts weiter: wer niemanden erreicht
    // hat, kann weder legitimieren noch eine HomeID aufnehmen. Sie tragen
    // deshalb auch keine disposition.
    const hadConversation = Boolean(chosen.disposition || chosen.winbackStatus || chosen.requires);

    const needed = new Map();
    const want = (id) => {
      if (needed.has(id)) return;
      const field = WRAPUP_FIELDS[id];
      if (!field) return;
      needed.set(id, { id, label: field.label, hint: field.hint });
    };

    (chosen.requires || []).forEach(want);

    if (hadConversation && chosen.disposition) {
      // Der Abschluss-Check gilt für jedes Gespräch mit Ergebnis, nicht nur
      // für das eine, das gerade geklickt wurde.
      (conf.checklist || []).forEach((item) => {
        if (item.required && WRAPUP_FIELDS[item.id]) want(item.id);
      });
    }

    // „erfolgreich“/„nicht erfolgreich“ ohne Ursache ist der Fall, den der
    // BVW-Leitfaden ausdrücklich verbietet: der Status bliebe auf „offen“
    // stehen und wäre weder abrechenbar noch auswertbar.
    const statusId = chosen.winbackStatus || data.winbackStatus;
    const status = WINBACK_STATUS.find((s) => s.id === statusId);
    if (status && status.requiresReason) {
      const hasReason = has(data.winbackReason) || has(data.rejectionReason);
      if (!hasReason) {
        want(statusId === "erfolgreich" ? "winbackReason" : "rejectionReason");
      }
    }

    return Array.from(needed.values()).filter((f) => !has(data[f.id]));
  }

  /** Ein Wert gilt als erfasst, wenn er weder leer noch eine leere Liste ist. */
  function has(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return String(value).trim() !== "";
  }

  /**
   * Ist die Erfassung so vollständig, dass der Vorgang abgerechnet werden kann?
   * Genau die Frage, die die Leitfäden mit „vergütungsrelevant“ markieren.
   */
  function isBillable(callType, outcomeId, wrapup) {
    return missingRequirements(callType, outcomeId, wrapup).length === 0;
  }

  /**
   * Winbackstatus eines erfassten Gesprächs: aus dem Ergebnis, sonst aus der
   * Erfassung, sonst „offen“. Fehlt die Ursache, bleibt es bei „offen“ —
   * dieselbe Regel wie oben, nur aus der Lese-Richtung.
   */
  function effectiveWinbackStatus(callType, outcomeId, wrapup) {
    const data = wrapup || {};
    const chosen = outcome(callType, outcomeId);
    const statusId = (chosen && chosen.winbackStatus) || data.winbackStatus || "offen";
    const status = WINBACK_STATUS.find((s) => s.id === statusId);
    if (!status) return "offen";
    if (status.requiresReason && !has(data.winbackReason) && !has(data.rejectionReason)) return "offen";
    return status.id;
  }

  /** Darf dieser Kunde werblich angesprochen werden? (§ 7 Abs. 2 UWG) */
  function advertisingAllowed(doiStatus) {
    const entry = DOI_STATUS.find((s) => s.id === doiStatus);
    return Boolean(entry && entry.advertisingAllowed);
  }

  /** Klartext-Label aus einem Katalog, mit der Id als Rückfallebene. */
  function labelOf(list, id) {
    const entry = (list || []).find((e) => e.id === id);
    return (entry && entry.label) || id || "";
  }

  const api = {
    CONTACT_WINDOW,
    LEGITIMATION_METHODS,
    HOME_ID_KINDS,
    DOI_STATUS,
    DOI_CHANNELS,
    DOI_RETENTION_YEARS,
    FRAUD_MARKERS,
    WINBACK_STATUS,
    JIRA_COMPONENTS,
    DOC_SYSTEMS,
    DOC_STANDARD_4W,
    NO_CONTACT_OUTCOMES,
    CHURN_REASONS,
    WELCOME_REGRET_TRIGGERS,
    WINBACK_LADDER,
    PRL_CAUSES,
    PRL_ADDRESS_FIELDS,
    BUILDING_TYPES,
    BUILDING_DETAIL_FIELDS,
    TRISTATE,
    DUPE_REASONS,
    BVW_TYPOLOGY,
    BVW_SOLUTIONS,
    COURTESY_FAULTS,
    COURTESY_ISSUES,
    CAMPAIGNS,
    CAMPAIGN_ORDER,
    WRAPUP_FIELDS,
    campaign,
    allCampaigns,
    outcomesFor,
    outcome,
    normalizeHomeId,
    detectHomeIdKind,
    validateHomeId,
    isWithinContactWindow,
    missingRequirements,
    isBillable,
    effectiveWinbackStatus,
    advertisingAllowed,
    labelOf
  };

  // Siehe shift-time.js: beide Export-Formen nebeneinander, weil dieselbe
  // Datei als klassisches Content-Script, als ESM-Seiteneffekt-Import (Vite/
  // Vitest) und per require() (Extension-Tests) geladen wird.
  globalThis.StadtnetzCRM = globalThis.StadtnetzCRM || {};
  globalThis.StadtnetzCRM.campaigns = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
