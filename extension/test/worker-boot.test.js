"use strict";

// Startet den Hintergrund-Service-Worker so, wie Chrome es tut: dieselben
// Dateien, dieselbe Reihenfolge wie in background.js/manifest.json.
//
// Warum das einen eigenen Test wert ist: scheitert der Worker beim Laden – eine
// einzige werfende Zeile auf oberster Ebene genügt –, dann ist er tot, ohne dass
// irgendwo etwas erscheint. Für den Bearbeiter sieht das so aus: „Ich klicke auf
// Nachschlagen und es passiert gar nichts, nicht mal ein Tab geht auf." Der
// Fehler steht dann nur in der Service-Worker-Konsole, die niemand offen hat.
//
// Der Test hält außerdem fest, dass lookup.js seine Listener beim Laden
// registriert (nicht erst später) – nur so erreicht ein Auftrag den Worker,
// der gerade erst geweckt wurde.
//
// Ausführen mit: node test/worker-boot.test.js

const assert = require("assert");
const { makeWorkerSandbox, loadScripts } = require("./support/stub-env");

// Die Dateien, die background.js per importScripts lädt – in genau dieser
// Reihenfolge. Wird dort etwas ergänzt, gehört es auch hierher.
const WORKER_SCRIPTS = [
  "src/config.js",
  "src/shared.js",
  "src/lookup.js",
  "src/background.js",
  "src/hud-bridge.js",
  "src/bridge.js"
];

function run() {
  const env = makeWorkerSandbox();

  // Timer bewusst NICHT feuern lassen: geprüft wird das Laden, nicht der
  // Betrieb. (Die Brücken planen beim Start einen Wiederverbindungsversuch –
  // mit echten Timern liefe der Test endlos weiter, weil genau das ihr Job ist.)
  env.sandbox.setTimeout = () => 0;
  env.sandbox.clearTimeout = () => {};
  env.sandbox.setInterval = () => 0;
  env.sandbox.clearInterval = () => {};
  // WebSocket bewusst NICHT stellen: die beiden Brücken müssen auch dann sauber
  // starten, wenn keine Gegenstelle existiert (der Normalfall – die Desktop-App
  // läuft meistens nicht).
  env.chrome.runtime.onMessage = { addListener(fn) { (env.bus.messageListeners = env.bus.messageListeners || []).push(fn); } };
  env.chrome.alarms.clear = () => {};
  env.chrome.storage.local.remove = env.chrome.storage.local.remove || (() => {});

  // Der eigentliche Test: das darf nicht werfen.
  assert.doesNotThrow(() => {
    loadScripts(env.sandbox, WORKER_SCRIPTS);
  }, "der Service-Worker lädt ohne Fehler durch");

  const app = env.sandbox.StadtnetzCRM;

  // Ohne diese drei ist der Worker zwar am Leben, aber taub.
  assert.ok(app, "StadtnetzCRM ist aufgebaut");
  assert.ok(app.CONFIG && app.CONFIG.storageKeys.lookupRequest, "CONFIG inkl. Auftrags-Schlüssel steht bereit");
  assert.strictEqual(typeof app.lookup.runLookup, "function", "die Netz-Auskunft ist geladen");
  assert.strictEqual(typeof app.lookup.claimJob, "function", "und kann Aufträge annehmen");
  assert.ok(app.background, "der Badge-Teil ist geladen");

  // Die Listener müssen beim LADEN hängen. Chrome weckt den Worker für eine
  // Nachricht und stellt sie erst zu, wenn das Script durchgelaufen ist – wer
  // seinen Listener später registriert, verpasst genau diese Nachricht.
  const listeners = env.bus.messageListeners || [];
  assert.ok(listeners.length >= 2, `onMessage-Listener sind beim Laden registriert (${listeners.length})`);

  // Und der Auftrags-Weg über den Storage steht ebenfalls schon.
  assert.ok(env.bus.listeners.length >= 2, "storage.onChanged-Listener sind beim Laden registriert");

  console.log("worker-boot.test.js: alle Szenarien bestanden.");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
