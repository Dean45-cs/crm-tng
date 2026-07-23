"use strict";

// Tests für die reinen Netz-Auskunft-Parser (shared.parseChurn/parseBaustatus)
// und die async-DOM-Helfer (waitForCondition/waitForStableRows) aus shared.js.
// Die Parser sind DOM-frei und damit direkt prüfbar; für die Helfer werden die
// von der Sandbox gestubbten Timer nach dem Laden durch echte ersetzt.
//
// Ausführen mit: node test/lookup-parse.test.js

const assert = require("assert");
const { makeSandbox, loadScripts } = require("./support/stub-env");

function loadShared() {
  const env = makeSandbox();
  loadScripts(env.sandbox, ["src/config.js", "src/commission.js", "src/shared.js"]);
  // Reale Timer für die async-Helfer – die Sandbox stubbt setTimeout ohne
  // Auto-Fire, was für Polling-Schleifen ungeeignet ist.
  env.sandbox.setTimeout = (fn, ms) => setTimeout(fn, ms);
  env.sandbox.clearTimeout = (id) => clearTimeout(id);
  return env.sandbox.StadtnetzCRM.shared;
}

async function run() {
  const shared = loadShared();

  // ── parseChurn ─────────────────────────────────────────────────────────────
  const churn = shared.parseChurn({
    found: true,
    kundennummer: "  12345  ",
    rows: [
      { vertrag: "1ABC ", geschaeftsfall: "Kündigung", ursache: "Umzug", eingang: "01.02.2026", jiraTicket: "TNG-1", jiraHref: "https://jira/TNG-1", kommentar: "  bla   bla  " },
      { vertrag: "", geschaeftsfall: "", ursache: "", eingang: "", jiraTicket: "", jiraHref: "", kommentar: "" },
      { vertrag: "", geschaeftsfall: "Retention", ursache: "", eingang: "", jiraTicket: "", jiraHref: "", kommentar: "" }
    ]
  });
  assert.strictEqual(churn.found, true);
  assert.strictEqual(churn.count, 2, "leere Zeile wird herausgefiltert, die anderen beiden zählen");
  assert.strictEqual(churn.customerNumber, "12345", "Kundennummer wird getrimmt");
  assert.strictEqual(churn.cases[0].vertrag, "1ABC");
  assert.strictEqual(churn.cases[0].kommentar, "bla bla", "Mehrfach-Whitespace wird zusammengefasst");
  assert.strictEqual(churn.cases[0].jiraHref, "https://jira/TNG-1", "href bleibt unangetastet");

  const noneChurn = shared.parseChurn({ found: false, kundennummer: "9", rows: [] });
  assert.strictEqual(noneChurn.found, false);
  assert.strictEqual(noneChurn.count, 0);
  const nullChurn = shared.parseChurn(null);
  assert.strictEqual(nullChurn.found, false);
  // Kein deepStrictEqual gegen []: vm-Realm-Arrays haben einen anderen
  // Prototyp als der Test-Realm (siehe shared.test.js).
  assert.strictEqual(nullChurn.cases.length, 0, "null-Eingabe ergibt eine leere, aber gültige Struktur");

  // ── parseBaustatus ─────────────────────────────────────────────────────────
  const raw = {
    "Vertrag": "1EPK",
    "Vertragsstatus": "aktiv",
    "Line Status": "in Betrieb",
    "Ausbauphas": "Bau",
    "KVZ": "KVZ-12",
    "KVZ_COLOR": "green",
    "Building Type": "SDU",
    "Adresse": "Schmiedstraße 34, 73433 Aalen",
    "BG Firma": "Firma A",
    "HAB Firma": "Firma B",
    "LWL Firma": "Firma C",
    "Tiefbau Timeline": "Start 01.01.2026\nEnde 01.03.2026",
    "LWL Timeline": "Keine Zeiten vorhanden",
    "Phase Predictions": "Realisierung\n01.01.2026 - 01.03.2026"
  };
  const b = shared.parseBaustatus(raw);
  assert.strictEqual(b.found, true);
  assert.strictEqual(b.contract, "1EPK");
  assert.strictEqual(b.contractStatus, "aktiv");
  assert.strictEqual(b.lineStatus, "in Betrieb");
  assert.strictEqual(b.buildingPhase, "Bau");
  assert.strictEqual(b.buildingType, "SDU");
  assert.strictEqual(b.kvz.value, "KVZ-12");
  assert.strictEqual(b.kvz.color, "green");
  assert.strictEqual(b.address, "Schmiedstraße 34, 73433 Aalen");
  assert.strictEqual(b.contacts.begehung, "Firma A");
  assert.strictEqual(b.contacts.hausanschluss, "Firma B");
  assert.strictEqual(b.contacts.lwl, "Firma C");
  assert.strictEqual(b.timelines.tiefbau, "Start 01.01.2026 Ende 01.03.2026");
  assert.strictEqual(b.phasePredictions, "Realisierung 01.01.2026 - 01.03.2026");

  const emptyB = shared.parseBaustatus({});
  assert.strictEqual(emptyB.found, false, "ohne Felder gilt nichts als gefunden");
  assert.strictEqual(emptyB.contract, "");
  assert.strictEqual(emptyB.kvz.color, "");

  const badColor = shared.parseBaustatus({ "Vertrag": "1X", "KVZ_COLOR": "purple" });
  assert.strictEqual(badColor.kvz.color, "", "unbekannte Farbklasse wird verworfen");
  assert.strictEqual(badColor.found, true, "ein Vertrag allein reicht als Treffer");

  // ── waitForCondition ───────────────────────────────────────────────────────
  let calls = 0;
  const hit = await shared.waitForCondition(() => (++calls >= 3 ? "treffer" : null), 1000, 10);
  assert.strictEqual(hit, "treffer", "löst auf, sobald die Bedingung truthy ist");
  const timedOut = await shared.waitForCondition(() => null, 60, 10);
  assert.strictEqual(timedOut, null, "gibt bei Timeout null zurück");
  const guarded = await shared.waitForCondition(() => { throw new Error("boom"); }, 40, 10);
  assert.strictEqual(guarded, null, "eine werfende Bedingung führt nicht zum Absturz");

  // ── waitForStableRows ──────────────────────────────────────────────────────
  const stableStart = Date.now();
  const stable = await shared.waitForStableRows(
    () => (Date.now() - stableStart < 50 ? Math.floor((Date.now() - stableStart) / 10) : 7),
    { intervalMs: 10, quietMs: 40, timeoutMs: 2000 }
  );
  assert.strictEqual(stable, 7, "löst mit der stabilen Zeilenzahl auf");

  const busyStart = Date.now();
  const capped = await shared.waitForStableRows(
    () => Math.floor((Date.now() - busyStart) / 5),
    { intervalMs: 10, quietMs: 1000, timeoutMs: 60 }
  );
  assert.ok(typeof capped === "number" && capped >= 0, "bei Dauerbewegung greift der Timeout mit der letzten Zahl");

  console.log("lookup-parse.test.js: alle Szenarien bestanden.");
}

run().catch((error) => { console.error(error); process.exit(1); });
