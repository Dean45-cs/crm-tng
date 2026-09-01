"use strict";

// Test für den Kampagnen-Katalog (src/campaigns.js) — die gemeinsame Quelle
// von CRM und Cockpit für das, was die Gesprächsleitfäden v2.0 verlangen.
//
// Der Schwerpunkt liegt auf den Regeln, die Geld kosten, wenn sie kippen:
// „Winbackstatus nur mit Ursache", die HomeID-Rangfolge und die Frage, wann
// ein Vorgang abrechenbar ist.
//
// Ausführen mit: node test/campaigns.test.js

const assert = require("assert");
const c = require("../src/campaigns.js");

function run() {
  // --- Katalog-Integrität ---------------------------------------------------
  // Ein `requires`, das kein Feld hat, wäre eine Pflichtangabe, die niemand
  // erfüllen kann — und ein Abschluss-Check, den niemand prüft, ist Dekoration.
  for (const type of c.CAMPAIGN_ORDER) {
    const conf = c.CAMPAIGNS[type];
    assert.ok(conf, `${type} existiert`);
    assert.ok(conf.callerId, `${type}: Rufnummernanzeige ist hinterlegt (§ 120 TKG)`);
    for (const outcome of conf.outcomes) {
      for (const field of outcome.requires || []) {
        assert.ok(
          c.WRAPUP_FIELDS[field],
          `${type}/${outcome.id}: verlangt "${field}", das Feld gibt es aber nicht`
        );
      }
    }
    for (const item of conf.checklist) {
      if (!item.required) continue;
      assert.ok(
        c.WRAPUP_FIELDS[item.id],
        `${type}: Abschluss-Check verlangt "${item.id}", das Feld gibt es aber nicht`
      );
    }
    // Ein Katalog, den ein Ergebnis anspricht, muss auch gefüllt sein.
    for (const [name, list] of Object.entries(conf.catalogs || {})) {
      assert.ok(Array.isArray(list) && list.length > 0, `${type}: Katalog "${name}" ist leer`);
    }
  }

  // --- Ergebnisse je Kampagne ----------------------------------------------
  // Der Postrückläufer endet nicht mit „gekündigt", sondern mit „Adresse
  // korrigiert" — genau dafür gibt es den Katalog.
  const prlIds = c.outcomesFor("prl").map((o) => o.id);
  assert.ok(prlIds.includes("adresse-korrigiert"), "PRL hat sein eigenes Ergebnis");
  assert.ok(!prlIds.includes("winback-gescheitert"), "und nicht das des Churn-Leitfadens");

  // Eingehend ergeben „Mailbox"/„Nicht erreicht" keinen Sinn.
  const inbound = c.outcomesFor("churn", "inbound").map((o) => o.id);
  assert.ok(!inbound.includes("mailbox"), "eingehend fällt die Mailbox weg");
  assert.ok(inbound.includes("winback-erfolgreich"), "das Gesprächsergebnis bleibt");

  // Unbekannter Typ fällt auf churn zurück statt zu werfen.
  assert.strictEqual(c.campaign("gibtsnicht").id, "churn", "unbekannter Typ fällt zurück");
  assert.strictEqual(c.campaign(null).id, "churn");

  // --- „Winbackstatus nur mit Ursache" -------------------------------------
  // Die Regel aus dem BVW-Leitfaden. Ohne Ursache bleibt der Fall auf „offen"
  // und ist weder abrechenbar noch auswertbar.
  assert.strictEqual(
    c.effectiveWinbackStatus("churn", "winback-erfolgreich", {}),
    "offen",
    "ohne Ursache bleibt es bei offen"
  );
  assert.strictEqual(
    c.effectiveWinbackStatus("churn", "winback-erfolgreich", { winbackReason: "preis" }),
    "erfolgreich"
  );
  assert.strictEqual(
    c.effectiveWinbackStatus("churn", "winback-gescheitert", { rejectionReason: "umzug" }),
    "nicht_erfolgreich",
    "der Ablehnungsgrund zählt genauso als Ursache"
  );
  // „irrelevant" braucht keine Ursache — das ist die Einordnung, die der
  // BVW-Leitfaden für Sonderfälle ausdrücklich vorsieht.
  assert.strictEqual(
    c.effectiveWinbackStatus("bvw", "klaerung-irrelevant", {}),
    "irrelevant",
    "irrelevant ist immer setzbar"
  );

  // --- Pflichtangaben -------------------------------------------------------
  const missingChurn = c.missingRequirements("churn", "winback-erfolgreich", {}).map((m) => m.id);
  assert.ok(missingChurn.includes("winbackReason"), "die Ursache fehlt");
  assert.ok(missingChurn.includes("doi"), "die Einwilligung fehlt");
  assert.ok(missingChurn.includes("legitimation"), "die Legitimation fehlt");

  // Wer niemanden erreicht hat, hat nichts zu dokumentieren.
  assert.deepStrictEqual(
    c.missingRequirements("churn", "not-reached", {}),
    [],
    "Nichterreichen verlangt keine Pflichtangaben"
  );
  assert.strictEqual(c.isBillable("churn", "not-reached", {}), true);

  // Vollständig erfasst = abrechenbar.
  const complete = {
    legitimation: "geburtsdatum",
    variant: "kuendigung",
    winbackReason: "preis",
    winbackMeasure: "passung",
    confirmationSent: true,
    decision: true,
    winbackStatus: "erfolgreich",
    doi: "versendet",
    documentation: true
  };
  assert.deepStrictEqual(
    c.missingRequirements("churn", "winback-erfolgreich", complete),
    [],
    "mit allen Pflichtangaben bleibt nichts offen"
  );
  assert.strictEqual(c.isBillable("churn", "winback-erfolgreich", complete), true);

  // Ein unbekanntes Ergebnis verlangt nichts, statt zu werfen.
  assert.deepStrictEqual(c.missingRequirements("churn", "gibtsnicht", {}), []);

  // --- HomeID ---------------------------------------------------------------
  // Rangfolge: ausgewiesene HomeID vor ONT-Seriennummer vor AD-Nummer.
  assert.strictEqual(c.detectHomeIdKind("NE422224WS52").id, "homeid");
  assert.strictEqual(c.detectHomeIdKind("AD.01.01").id, "ad", "AD-Muster hat Vorrang vor dem allgemeinen");
  assert.strictEqual(c.detectHomeIdKind("ad-1-2").id, "ad", "auch mit Bindestrich und ohne Führungsnullen");
  assert.strictEqual(c.detectHomeIdKind(""), null);
  assert.strictEqual(c.detectHomeIdKind("kurz"), null, "zu kurz ist keine gültige Kennung");

  // Normalisierung: Leerzeichen und Kleinschreibung sind Tippfehler, keine
  // andere Nummer — 0/O und 1/I bleiben bewusst unverändert, die klärt nur
  // die Rückbestätigung durch den Kunden.
  assert.strictEqual(c.normalizeHomeId("  ne 4222 24ws52 "), "NE422224WS52");

  assert.strictEqual(c.validateHomeId("NE422224WS52", "homeid").ok, true);
  assert.strictEqual(c.validateHomeId("NE422224WS52", "ad").ok, false, "falsche Art wird erkannt");
  assert.strictEqual(c.validateHomeId("", "homeid").ok, false);
  assert.strictEqual(c.validateHomeId("ABCDEFGH", "gibtsnicht").ok, false, "unbekannte Art");

  // Der Courtesy Call hat die HomeID als Kern — sie ist dort Pflicht.
  assert.strictEqual(c.CAMPAIGNS.courtesy.requiresHomeId, true);
  assert.ok(
    c.missingRequirements("courtesy", "aktiviert", {}).some((m) => m.id === "homeId"),
    "ohne HomeID ist der Courtesy Call nicht abgeschlossen"
  );

  // --- Double-Opt-In --------------------------------------------------------
  // Werblich angesprochen werden darf erst nach der Bestätigung (§ 7 Abs. 2 UWG).
  assert.strictEqual(c.advertisingAllowed("bestaetigt"), true);
  assert.strictEqual(c.advertisingAllowed("versendet"), false, "versendet reicht nicht");
  assert.strictEqual(c.advertisingAllowed("angekuendigt"), false);
  assert.strictEqual(c.advertisingAllowed("abgelehnt"), false);
  assert.strictEqual(c.advertisingAllowed(undefined), false, "ohne Stand keine Werbung");
  assert.strictEqual(c.DOI_RETENTION_YEARS, 5, "Nachweis fünf Jahre (§ 7a UWG)");

  // --- Anrufzeitfenster -----------------------------------------------------
  // Mo–Fr 08:00–17:00 Uhr, in jedem Leitfaden gleich.
  const monday10 = new Date(2026, 7, 17, 10, 0);
  const monday7 = new Date(2026, 7, 17, 7, 59);
  const monday17 = new Date(2026, 7, 17, 17, 0);
  const saturday10 = new Date(2026, 7, 22, 10, 0);
  assert.strictEqual(c.isWithinContactWindow(monday10), true);
  assert.strictEqual(c.isWithinContactWindow(monday7), false, "vor acht ist zu früh");
  assert.strictEqual(c.isWithinContactWindow(monday17), false, "ab 17:00 ist Schluss");
  assert.strictEqual(c.isWithinContactWindow(saturday10), false, "am Wochenende gar nicht");

  // --- Datenschutz-Sonderfall Dubletten-Check -------------------------------
  assert.strictEqual(
    c.CAMPAIGNS.dupe.privacy.hideOtherContractHolders,
    true,
    "gegenüber Person A wird der Vertrag von Person B nicht offengelegt"
  );

  // --- Kompetenzen ----------------------------------------------------------
  // Jede Kampagne hat eine eigene Schulungsunterlage — wer den Dubletten-Check
  // kann, kennt deshalb noch nicht den Bauverweigerer-Prozess.
  assert.deepStrictEqual(
    c.COMPETENCY_LEVELS.map((l) => l.id),
    ["einarbeitung", "einsatzbereit", "trainer"],
    "drei Stufen in aufsteigender Ordnung"
  );
  assert.strictEqual(c.competencyLevel("einarbeitung").needsSupervision, true);
  assert.strictEqual(c.competencyLevel("einsatzbereit").needsSupervision, false);
  assert.strictEqual(c.competencyLevel("trainer").canTrain, true);
  assert.strictEqual(c.competencyLevel("gibtsnicht"), null);

  // Ohne Eintrag darf niemand auf eine Kampagne.
  assert.strictEqual(c.isQualified("bvw", null), false);
  assert.strictEqual(c.isQualified("bvw", "einarbeitung"), true, "Einarbeitung ist zuweisbar");
  // 'other' hat keinen eigenen Leitfaden und deshalb auch keine Schulung.
  assert.strictEqual(c.isQualified("other", null), true);

  assert.deepStrictEqual(
    c.competencyIssues("bvw", null, {}).map((i) => i.id),
    ["nicht-geschult"]
  );
  assert.deepStrictEqual(
    c.competencyIssues("bvw", { level: "einarbeitung" }, { hasSupervisor: false }).map((i) => i.id),
    ["ohne-begleitung"]
  );
  assert.deepStrictEqual(
    c.competencyIssues("bvw", { level: "einarbeitung" }, { hasSupervisor: true }),
    [],
    "mit Begleitung ist die Einarbeitung in Ordnung"
  );
  assert.deepStrictEqual(
    c.competencyIssues("bvw", { level: "einsatzbereit", guideVersion: "1.0" }, {}).map((i) => i.id),
    ["veraltete-schulung"],
    "auf eine ältere Leitfaden-Fassung geschult"
  );
  assert.deepStrictEqual(
    c.competencyIssues("bvw", { level: "einsatzbereit" }, {}),
    [],
    "ein fehlender Versionsvermerk gilt nicht als veraltet"
  );
  assert.strictEqual(c.worstSeverity([{ severity: "warn" }, { severity: "block" }]), "block");
  assert.strictEqual(c.worstSeverity([]), null);

  // --- Beschriftung ---------------------------------------------------------
  assert.strictEqual(c.labelOf(c.CHURN_REASONS, "preis"), "Preis zu hoch");
  assert.strictEqual(c.labelOf(c.CHURN_REASONS, "gibtsnicht"), "gibtsnicht", "unbekannte Id bleibt lesbar");
  assert.strictEqual(c.labelOf(undefined, "x"), "x");

  console.log("campaigns.test.js: alle Szenarien bestanden.");
}

run();
