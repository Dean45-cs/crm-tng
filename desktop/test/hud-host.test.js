"use strict";

// Das Overlay auf dem Schreibtisch (renderer/hud-host.js).
//
// Kernzusagen dieses Umbaus:
//   1. Ohne Gastgeber (also in Chrome) ändert sich am Panel nichts – kein
//      Verbindungspunkt, kein Notizknopf, kein Overlay-Abschnitt.
//   2. Mit Gastgeber trägt der Panelkopf den Verbindungspunkt und den
//      Notizknopf – und sonst nichts Fensterartiges.
//   3. Was früher als Fensterknopf oben rechts saß (immer im Vordergrund,
//      ausblenden), steht in den Einstellungen und wirkt sofort.
//   4. Das Fenster selbst hat keine Titelleiste mehr.
//
// Ausführen mit: node test/hud-host.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { makePanelSandbox, loadScripts } = require("../../extension/test/support/stub-env");

// Pfade sind repo-relativ zu extension/ (so lädt loadScripts) – die
// Renderer-Dateien der App liegen daneben.
const SCRIPTS = [
  "src/config.js",
  "src/shared.js",
  "src/ai-cache.js",
  "src/jira-reader.js",
  "src/rules.js",
  "src/local-ai.js",
  "src/theme.js",
  "src/ui.js"
];

const HUD_HOST = "../desktop/renderer/hud-host.js";

const OVERLAY = {
  alwaysOnTop: true,
  opacity: 1,
  clickThrough: false,
  toggleShortcut: "Command+Shift+Space",
  clickThroughShortcut: "Command+Shift+D"
};

async function mount(options) {
  const opts = options || {};
  const env = makePanelSandbox();
  const commands = [];

  // Attrappe der Electron-Brücke: uns interessiert nur, was das Panel dem
  // Fenster aufträgt.
  env.sandbox.hud = {
    command: (name, args) => commands.push({ name, args })
  };

  loadScripts(env.sandbox, SCRIPTS);

  if (opts.withHost !== false) {
    // notes.js braucht die echte Brücke und Supabase – hier reicht die
    // Zustandsfrage, die hud-host.js stellt.
    env.sandbox.StadtnetzCRM.hudNotes = { isOpen: () => false, toggle() {} };
    loadScripts(env.sandbox, [HUD_HOST]);
    env.sandbox.StadtnetzCRM.hudHost.setOverlay({ ...OVERLAY, ...(opts.overlay || {}) });
    env.sandbox.StadtnetzCRM.hudHost.setConnected(opts.connected !== false);
  }

  await env.sandbox.StadtnetzCRM.ui.mount();
  return { env, commands, host: env.sandbox.StadtnetzCRM.hudHost };
}

// Ein Eingabe-Ereignis am Panel (Checkbox/Regler) – ui.js hört per Delegation
// am Wurzelelement.
function fireInput(env, role, props) {
  const handler = env.root()._listeners.input;
  assert.ok(handler, "Panel hört auf input-Ereignisse");
  handler({ target: Object.assign({ dataset: { role } }, props || {}) });
}

async function run() {
  // --- 1. Ohne Gastgeber bleibt das Panel das Panel ------------------------
  {
    const { env } = await mount({ withHost: false });
    const html = env.html();
    assert.ok(!html.includes("hud-dot"), "kein Verbindungspunkt in Chrome");
    assert.ok(!html.includes('data-action="hud-notes"'), "kein Notizknopf in Chrome");
    env.click("toggle-settings");
    assert.ok(!env.html().includes("hud-always-on-top"), "kein Overlay-Abschnitt in Chrome");
    // Der Panelkopf trägt weiterhin seinen eigenen Minimieren-Knopf – in der
    // Seite ist er die einzige Möglichkeit, das Panel wegzuklappen.
    assert.ok(env.html().includes('data-action="close-panel"'), "Panel behält seinen Minimieren-Knopf in der Seite");
  }

  // --- 2. Mit Gastgeber: Kopf trägt Punkt und Notizknopf -------------------
  {
    const { env } = await mount();
    const html = env.html();
    assert.ok(html.includes("hud-dot is-connected"), "verbundener Zustand am Punkt sichtbar");
    assert.ok(html.includes('data-action="hud-notes"'), "Notizknopf sitzt im Panelkopf");
    assert.ok(!html.includes("hud-offline"), "kein Offline-Hinweis, solange Chrome verbunden ist");
  }

  // --- 3. Ohne Chrome: Hinweis als Banner im Panel -------------------------
  {
    const { env } = await mount({ connected: false });
    assert.ok(env.html().includes("hud-offline"), "getrennter Zustand erklärt sich im Panel");
    assert.ok(env.html().includes("hud-dot is-offline"), "Punkt zeigt getrennt");
    // Ohne Chrome gibt es weder lokale KI noch etwas zum erneut Prüfen – der
    // KI-Hinweis würde dieselbe Ursache ein zweites Mal melden.
    assert.ok(!env.html().includes("sc-ai-banner"), "keine zweite Warnung für dieselbe Ursache");
  }

  // --- 4. Fensterknöpfe stehen jetzt in den Einstellungen ------------------
  {
    const { env, commands } = await mount();
    env.click("toggle-settings");
    const html = env.html();
    assert.ok(html.includes("Immer im Vordergrund"), "Vordergrund-Schalter in den Einstellungen");
    assert.ok(html.includes("Klicks durchreichen"), "Klick-Durchlässigkeit in den Einstellungen");
    assert.ok(html.includes('data-action="hud-hide"'), "Ausblenden steht als Zeile in den Einstellungen");
    assert.ok(html.includes('data-action="hud-quit"'), "Beenden steht als Zeile in den Einstellungen");
    // Die Tastenkombination muss dabeistehen: ausgeblendet ist das Overlay
    // sonst nicht mehr auffindbar.
    assert.ok(html.includes("Leertaste"), "Tastenkombination zum Zurückholen steht dabei");

    // Sofort wirksam, ohne Speichern-Knopf: es sind Fenster-Schalter, keine
    // Formularfelder.
    fireInput(env, "hud-always-on-top", { checked: false });
    assert.strictEqual(JSON.stringify(commands.pop()), JSON.stringify({ name: "always-on-top", args: { enabled: false } }));

    fireInput(env, "hud-click-through", { checked: true });
    assert.strictEqual(JSON.stringify(commands.pop()), JSON.stringify({ name: "click-through", args: { enabled: true } }));

    fireInput(env, "hud-opacity", { value: "70" });
    assert.strictEqual(JSON.stringify(commands.pop()), JSON.stringify({ name: "opacity", args: { value: 0.7 } }));

    env.click("hud-hide");
    assert.strictEqual(JSON.stringify(commands.pop()), JSON.stringify({ name: "hide", args: {} }));
  }

  // --- 5. Fremd umgelegte Schalter kommen im Panel an ----------------------
  {
    const { env, host } = await mount();
    env.click("toggle-settings");
    assert.ok(!env.html().includes('data-role="hud-click-through" checked'), "Ausgangslage: Klicks kommen an");
    // Tray-Menü oder Tastenkombination – das Panel hat davon nichts mitbekommen.
    host.setOverlay({ ...OVERLAY, clickThrough: true });
    assert.ok(env.html().includes('data-role="hud-click-through" checked'), "umgelegter Schalter erscheint im Panel");
  }

  // --- 6. Das Fenster selbst hat keine Titelleiste mehr --------------------
  {
    const html = fs.readFileSync(path.join(__dirname, "..", "renderer", "index.html"), "utf8");
    assert.ok(!html.includes("hud-titlebar"), "keine eigene Titelleiste");
    assert.ok(!/data-hud="(hide|minimize|pin)"/.test(html), "keine Fensterknöpfe über der Auskunft");
    assert.ok(html.includes('data-role="hud-resize"'), "Anfasser für die Größe ist da");
  }

  console.log("hud-host.test.js: alle Szenarien bestanden.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
