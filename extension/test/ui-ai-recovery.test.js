"use strict";

// Test für den Fall aus dem Betrieb: „die Zusammenfassung wird einmal geladen,
// danach funktioniert keine KI-Funktion mehr" – und das HUD meldet dazu „Das
// lokale KI-Modell ist auf diesem Gerät derzeit nicht nutzbar."
//
// Ursache war nicht das Modell, sondern die VERBINDUNG: im HUD läuft die KI
// ferngesteuert in Chrome. Fällt eine Antwort aus (kein Jira-Tab, Tab nach einem
// Extension-Reload stumm, keine Antwort), scheiterte die Fähigkeitsprüfung – und
// das Panel schrieb sich „unavailable" dauerhaft in den Zustand. Ab da waren
// alle KI-Knöpfe grau, ohne Weg zurück außer Neustart.
//
// Geprüft wird deshalb:
//   1. Eine gescheiterte PRÜFUNG wird als vorübergehend gemeldet, nicht als
//      Urteil über das Gerät.
//   2. Die Knöpfe bleiben bedienbar (ein Versuch kann ja klappen).
//   3. Es gibt einen Weg zurück: „Erneut prüfen" – und die Selbstheilung, die
//      im Sekundentakt mitläuft.
//
// Ausführen mit: node test/ui-ai-recovery.test.js

const assert = require("assert");
const { makePanelSandbox, loadScripts } = require("./support/stub-env");

const SCRIPTS = [
  "src/config.js",
  "src/campaigns.js",
  "src/shared.js",
  "src/ai-cache.js",
  "src/jira-reader.js",
  "src/rules.js",
  "src/local-ai.js",
  "src/theme.js",
  "src/ui.js"
];

// Lässt anstehende Mikrotasks/Timer durchlaufen (die Fähigkeitsprüfung ist async).
function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function run() {
  const env = makePanelSandbox();
  loadScripts(env.sandbox, SCRIPTS);
  const app = env.sandbox.StadtnetzCRM;

  // Die Verbindung zur Extension ist weg – die Prüfung scheitert mit einem
  // Fehler, genau wie es der Shim im HUD tut (shim-local-ai.js).
  let mode = "broken";
  app.localAi.capabilities = async () => {
    if (mode === "broken") throw new Error("Chrome hat nicht geantwortet.");
    return { status: "available", usable: true, provenWorking: false };
  };

  await app.ui.mount();
  await settle();

  // --- 1. Vorübergehend, nicht endgültig ------------------------------------
  let html = env.html();
  assert.ok(
    !html.includes("auf diesem Gerät derzeit nicht nutzbar"),
    "eine gescheiterte Prüfung wird NICHT als „Gerät kann das nicht“ gemeldet"
  );
  assert.ok(html.includes("war gerade nicht erreichbar"), "sondern als vorübergehend nicht erreichbar");
  assert.ok(html.includes("Chrome hat nicht geantwortet."), "mit der echten Ursache im Klartext");

  // --- 2. Ein Weg zurück, ohne Neustart ------------------------------------
  assert.ok(html.includes('data-action="recheck-ai"'), "es gibt einen „Erneut prüfen“-Knopf");

  // --- 3. Die Knöpfe bleiben bedienbar -------------------------------------
  // Ein Versuch kann klappen, also wird er nicht vorsorglich gesperrt.
  const prepButton = html.match(/data-action="generate-call-prep"[^>]*>/);
  assert.ok(prepButton, "der Vorbereitungs-Knopf ist da");
  assert.ok(!/disabled/.test(prepButton[0]), "und nicht gesperrt, obwohl die Prüfung fehlschlug");

  // --- 4. Erneut prüfen holt die KI zurück ---------------------------------
  mode = "ok"; // Verbindung steht wieder
  env.click("recheck-ai");
  await settle();
  await settle();

  html = env.html();
  assert.ok(!html.includes("war gerade nicht erreichbar"), "nach der erneuten Prüfung ist der Hinweis weg");

  // --- 5. Selbstheilung: derselbe Weg läuft auch ohne Klick ----------------
  // maybeRecheckAi hängt am Sekundentakt des Panels. Ein Fehlschlag gilt nur
  // befristet (CONFIG.ai.recheckMs) – sonst wäre man wieder beim alten Fehler:
  // einmal gestört, für immer gesperrt.
  mode = "broken";
  await app.ui.loadCapabilities();
  await settle();
  assert.ok(env.html().includes("war gerade nicht erreichbar"), "ein neuer Fehlschlag wird wieder angezeigt");

  mode = "ok";
  app.CONFIG.ai.recheckMs = 0; // im Betrieb übernimmt das die Zeit
  env.tick();                  // ein Durchlauf des Sekundentakts
  await settle();
  await settle();
  assert.ok(
    !env.html().includes("war gerade nicht erreichbar"),
    "der Sekundentakt prüft von selbst nach und die KI ist wieder da – ohne Neustart"
  );

  console.log("ui-ai-recovery.test.js: alle Szenarien bestanden.");
}

run().catch((error) => { console.error(error); process.exit(1); });
