"use strict";

// Tests für die Netz-Auskunft-Orchestrierung (src/lookup.js), speziell das
// kritische Gate: ohne aktivierten Master-Schalter (settings.enableLookups)
// darf runLookup NICHTS am Dashboard tun, sondern muss mit einem Fehler-
// Ergebnis in den Storage abbrechen. Dazu die Schritt-Vorbelegung und der
// Schritt-Reducer.
//
// Ausführen mit: node test/lookup-gate.test.js

const assert = require("assert");
const { makeWorkerSandbox, loadScripts } = require("./support/stub-env");

async function run() {
  const env = makeWorkerSandbox();
  loadScripts(env.sandbox, ["src/config.js", "src/shared.js", "src/lookup.js"]);
  const app = env.sandbox.StadtnetzCRM;
  const lookup = app.lookup;
  const KEYS = app.CONFIG.storageKeys;

  assert.ok(lookup && typeof lookup.runLookup === "function", "app.lookup.runLookup ist exportiert");

  // 1. Gate: enableLookups nicht gesetzt → verweigert, Fehler-Ergebnis im Storage,
  //    KEIN Tab angefasst.
  const r1 = await lookup.runLookup({ requestId: "t1", kind: "churn", customerNumber: "12345" });
  assert.strictEqual(r1.ok, false);
  assert.strictEqual(r1.error, "disabled");
  const stored1 = env.storage[KEYS.lookupResult];
  assert.strictEqual(stored1.status, "error");
  assert.ok(/aktivieren/i.test(stored1.error), "Fehlermeldung verweist auf die Einstellungen");
  assert.strictEqual(stored1.requestId, "t1");
  assert.strictEqual(env.calls.tabsCreated.length, 0, "kein Tab wurde geöffnet");
  // Kein deepStrictEqual auf vm-Realm-Arrays (anderer Prototyp) – join vergleicht Inhalte.
  assert.strictEqual(stored1.steps.map((s) => s.id).join(","), "search,settle,extract", "churn-Schritte vorbelegt");
  assert.ok(stored1.steps.every((s) => s.state === "pending"), "alle Schritte starten als pending");

  // Schritt-Reducer: aktualisiert den passenden Schritt und spiegelt in den Storage.
  lookup.applyStep("t1", "search", "done");
  assert.strictEqual(env.storage[KEYS.lookupResult].steps.find((s) => s.id === "search").state, "done");
  lookup.applyStep("unbekannt", "search", "done"); // darf nicht werfen
  assert.strictEqual(env.storage[KEYS.lookupResult].requestId, "t1", "unbekannte requestId ändert nichts");

  // 2. Schalter an, aber unbekannte Abfrageart → Fehler vor jeder Tab-Aktion.
  env.chrome.storage.local.set({ [KEYS.settings]: { enableLookups: true } });
  const r2 = await lookup.runLookup({ requestId: "t2", kind: "quatsch", customerNumber: "1" });
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.error, "unknown-kind");
  assert.strictEqual(env.calls.tabsCreated.length, 0, "auch hier kein Tab");

  // 3. Schalter an, gültige Art, aber keine Kundennummer → Fehler.
  const r3 = await lookup.runLookup({ requestId: "t3", kind: "baustatus", customerNumber: "" });
  assert.strictEqual(r3.ok, false);
  assert.strictEqual(r3.error, "no-customer");

  // initSteps deckt beide Abfragearten ab.
  assert.strictEqual(lookup.initSteps("baustatus").length, 8);
  assert.strictEqual(lookup.initSteps("churn").length, 3);
  assert.strictEqual(lookup.initSteps("quatsch").length, 0, "unbekannte Art hat keine Schritte");

  // 4. Fortschrittsmeldung nach Worker-Neustart: der In-Memory-Spiegel (active)
  //    ist leer (frischer Worker), der letzte Stand liegt nur im Storage.
  //    applyStep muss ihn von dort holen und weiterschreiben – sonst geht der
  //    Fortschritt verloren und das Panel hängt ewig bei „läuft".
  {
    const env2 = makeWorkerSandbox();
    loadScripts(env2.sandbox, ["src/config.js", "src/shared.js", "src/lookup.js"]);
    const lookup2 = env2.sandbox.StadtnetzCRM.lookup;
    const KEYS2 = env2.sandbox.StadtnetzCRM.CONFIG.storageKeys;
    env2.chrome.storage.local.set({ [KEYS2.lookupResult]: {
      requestId: "restart-1", kind: "baustatus", status: "running",
      steps: [{ id: "search", state: "pending" }, { id: "confirm", state: "pending" }]
    } });
    lookup2.applyStep("restart-1", "search", "active");
    await new Promise((resolve) => setImmediate(resolve)); // Storage-Fallback (Microtask) durchlaufen lassen
    const after = env2.storage[KEYS2.lookupResult];
    assert.strictEqual(after.steps.find((s) => s.id === "search").state, "active", "Schritt nach Neustart aus dem Storage aktualisiert");
    // Eine Meldung zu einer fremden requestId darf den Storage NICHT verändern.
    lookup2.applyStep("fremd", "search", "done");
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(env2.storage[KEYS2.lookupResult].requestId, "restart-1", "fremde requestId ändert nichts");
    assert.strictEqual(env2.storage[KEYS2.lookupResult].steps.find((s) => s.id === "search").state, "active", "und lässt den Schritt unverändert");
  }

  console.log("lookup-gate.test.js: alle Szenarien bestanden.");
}

run().catch((error) => { console.error(error); process.exit(1); });
