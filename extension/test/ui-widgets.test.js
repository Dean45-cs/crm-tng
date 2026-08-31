"use strict";

// Widget-Anpassung im Jira-Panel (src/ui.js, Phase 3): die Prep-/Talk-Tabs
// bestehen aus eigenständigen Widgets, die sich im Anpassen-Modus ausblenden
// und umsortieren lassen. Kernzusagen:
//   1. Standard = keine Widget-Hülle, Reihenfolge wie bisher (opt-in).
//   2. Anpassen-Modus zeigt Werkzeuge (verschieben/ausblenden).
//   3. Ausblenden + Verschieben landen im Storage und überleben ein Neu-Mounten.
//
// Ausführen mit: node test/ui-widgets.test.js

const assert = require("assert");
const { makePanelSandbox, loadScripts } = require("./support/stub-env");

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

async function mountWith(storageSeed) {
  const env = makePanelSandbox();
  loadScripts(env.sandbox, SCRIPTS);
  const KEYS = env.sandbox.StadtnetzCRM.CONFIG.storageKeys;
  Object.assign(env.storage, (storageSeed && storageSeed(KEYS)) || {});
  await env.sandbox.StadtnetzCRM.ui.mount();
  return { env, KEYS };
}

async function run() {
  // --- Standard: keine Hülle, Ticketkontext sichtbar -----------------------
  {
    const { env } = await mountWith();
    assert.ok(env.html().includes('aria-label="Ticketkontext"'), "Ticketkontext wird gerendert");
    assert.ok(!env.html().includes("sc-widget-shell"), "im Standard ohne Widget-Hülle (Ansicht bleibt wie bisher)");
    assert.ok(!env.html().includes('data-action="widget-move"'), "keine Werkzeuge im Standard");
  }

  // --- Anpassen-Modus: Hülle + Werkzeuge ------------------------------------
  {
    const { env } = await mountWith();
    env.click("toggle-customize");
    assert.ok(env.html().includes("sc-widget-shell"), "Anpassen-Modus zeigt die Widget-Hülle");
    assert.ok(env.html().includes('data-action="widget-move"'), "Verschieben-Werkzeug erscheint");
    assert.ok(env.html().includes('data-action="widget-hide"'), "Ausblenden-Werkzeug erscheint");
    assert.ok(env.html().includes("Layout anpassen"), "Editor-Kopf erklärt den Modus");
  }

  // --- Ausblenden wird gespeichert und übersteht Neu-Mounten ----------------
  {
    const { env, KEYS } = await mountWith();
    env.click("toggle-customize");
    env.click("widget-hide", { tab: "prep", widget: "netzauskunft" });
    const saved = env.storage[KEYS.layout];
    assert.ok(saved && saved.tabs && saved.tabs.prep, "Layout landet unter dem eigenen Storage-Key");
    assert.ok(saved.tabs.prep.hidden.includes("netzauskunft"), "das ausgeblendete Widget ist vermerkt");
    // Chip zum Wieder-Einblenden ist da …
    assert.ok(env.html().includes('data-action="widget-show" data-tab="prep" data-widget="netzauskunft"'), "Wieder-Einblenden-Chip erscheint");

    // … und nach einem frischen Mount mit demselben Storage bleibt es ausgeblendet.
    const env2 = makePanelSandbox();
    loadScripts(env2.sandbox, SCRIPTS);
    Object.assign(env2.storage, { [KEYS.layout]: saved });
    await env2.sandbox.StadtnetzCRM.ui.mount();
    assert.ok(!env2.html().includes("sc-netzauskunft"), "Netz-Auskunft bleibt nach Neu-Mounten ausgeblendet");
    assert.ok(env2.html().includes('aria-label="Ticketkontext"'), "andere Widgets sind weiter sichtbar");
  }

  // --- Verschieben ändert die gespeicherte Reihenfolge ----------------------
  {
    const { env, KEYS } = await mountWith();
    env.click("toggle-customize");
    // Standardreihenfolge prep: ticket-context, customer-context, summary,
    // call-prep, netzauskunft.
    env.click("widget-move", { tab: "prep", widget: "netzauskunft", dir: "up" });
    const order = env.storage[KEYS.layout].tabs.prep.order;
    // JSON-Vergleich statt deepStrictEqual: das Array stammt aus dem
    // vm-Sandbox-Kontext (fremdes Array.prototype), sonst schlägt der
    // Prototyp-Vergleich fehl.
    assert.strictEqual(
      JSON.stringify(order),
      JSON.stringify(["ticket-context", "customer-context", "summary", "netzauskunft", "call-prep"]),
      "netzauskunft rückt einen Platz nach oben"
    );
  }

  // --- Zurücksetzen räumt das persönliche Layout weg ------------------------
  {
    const { env, KEYS } = await mountWith((KEYS) => ({
      [KEYS.layout]: { tabs: { prep: { order: ["netzauskunft", "ticket-context", "call-prep"], hidden: ["call-prep"] } } }
    }));
    env.click("toggle-customize");
    env.click("reset-layout");
    assert.strictEqual(JSON.stringify(env.storage[KEYS.layout]), JSON.stringify({ tabs: {} }), "Zurücksetzen leert das gespeicherte Layout");
  }

  console.log("ui-widgets.test.js: alle Szenarien bestanden.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
