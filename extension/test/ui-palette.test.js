"use strict";

// Befehlspalette im Jira-Panel (src/ui.js), Stufe 4 aus KONZEPT-INTEGRATION.md
// ("Befehlspalette (⌘K) auch in Jira und timio, mit denselben Ergebnissen").
// Eigene Datei, weil hier ein gefakter supabaseClient mit searchWorkspace()
// injiziert werden muss, bevor ui.js lädt. local-ai.js wird bewusst NICHT
// geladen (Fixture-Modus, wie in ui-closeout.test.js).
//
// Die Panel-Sandbox kann kein echtes Tippen simulieren; das Eingabe-Event
// wird direkt am Palette-Root-Listener gefeuert (der Produktivcode liest
// daraus denselben event.target.dataset.role wie im Browser).
//
// Ausführen mit: node test/ui-palette.test.js

const assert = require("assert");
const { makePanelSandbox, loadScripts } = require("./support/stub-env");

const PALETTE_ID = "sc-jira-palette";

async function mountPanel(searchImpl) {
  const env = makePanelSandbox();
  loadScripts(env.sandbox, ["src/config.js", "src/commission.js", "src/shared.js"]);
  env.sandbox.StadtnetzCRM.supabaseClient = {
    customerCard: async () => ({ ok: false, reason: "not-configured" }),
    searchWorkspace: searchImpl
  };
  loadScripts(env.sandbox, ["src/ai-cache.js", "src/jira-reader.js", "src/rules.js", "src/theme.js", "src/ui.js"]);
  await env.sandbox.StadtnetzCRM.ui.mount();
  return env;
}

const key = (k, extra) => Object.assign({ key: k, preventDefault() {} }, extra || {});
const microflush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function run() {
  const searchCalls = [];
  let searchResult = {
    ok: true,
    groups: [
      { group: "Kunden", items: [{ kind: "customer", customerNumber: "1000", label: "Anna Beispiel", sub: "KdNr. 1000" }] },
      { group: "Notizen", items: [{ kind: "note", customerNumber: "1000", label: "Telefonat", sub: "Anna Beispiel" }] }
    ]
  };
  const env = await mountPanel(async (query) => { searchCalls.push(query); return searchResult; });

  const typeQuery = async (value) => {
    const root = env.getElementById(PALETTE_ID);
    root._listeners.input({ target: { dataset: { role: "palette-query" }, value } });
    await Promise.all(env.flushTimers());
    await microflush();
  };

  // 1) ⌘K öffnet die Palette.
  assert.strictEqual(env.getElementById(PALETTE_ID), null, "vor ⌘K existiert keine Palette");
  env.fireKeydown(key("k", { metaKey: true }));
  assert.ok(env.getElementById(PALETTE_ID), "⌘K öffnet die Befehlspalette");

  // 2) Ein einzelnes Zeichen sucht noch nicht (Mindestlänge 2).
  await typeQuery("A");
  assert.strictEqual(searchCalls.length, 0, "ein Zeichen löst keine Suche aus");

  // 3) Ab zwei Zeichen wird gesucht – genau einmal, mit dem Suchbegriff.
  await typeQuery("Anna");
  assert.strictEqual(searchCalls.length, 1, "ab zwei Zeichen wird gesucht");
  assert.strictEqual(searchCalls[0], "Anna");

  // 4) Enter auf dem ersten Treffer öffnet die passende Kundenakte im CRM.
  env.fireKeydown(key("Enter"));
  assert.strictEqual(env.openedUrls.length, 1, "Enter öffnet genau einen CRM-Tab");
  assert.strictEqual(env.openedUrls[0], "https://crm-tng.vercel.app/?kdnr=1000", "Deep-Link auf die Kundennummer");
  assert.strictEqual(env.getElementById(PALETTE_ID), null, "nach dem Öffnen schließt sich die Palette");

  // 5) Toggle: ⌘K öffnet, erneutes ⌘K schließt.
  env.fireKeydown(key("k", { metaKey: true }));
  assert.ok(env.getElementById(PALETTE_ID), "⌘K öffnet die Palette");
  env.fireKeydown(key("k", { metaKey: true }));
  assert.strictEqual(env.getElementById(PALETTE_ID), null, "zweites ⌘K schließt (Toggle)");

  // 5b) Auf diesem System (Mac-Sandbox) ist „Mod" die Befehlstaste – und nur
  // die. Strg+K gehört hier dem Betriebssystem (Zeile löschen im Textfeld);
  // früher öffnete es die Palette gleich mit, was auf einem Mac ein Fehler war.
  // Wer Strg+K trotzdem will, kann es jetzt in den Einstellungen belegen.
  env.fireKeydown(key("k", { ctrlKey: true }));
  assert.strictEqual(env.getElementById(PALETTE_ID), null, "Strg+K ist auf dem Mac nicht das Panel-Kürzel");

  // 6) Escape schließt die offene Palette.
  env.fireKeydown(key("k", { metaKey: true }));
  assert.ok(env.getElementById(PALETTE_ID), "Palette wieder offen");
  env.fireKeydown(key("Escape"));
  assert.strictEqual(env.getElementById(PALETTE_ID), null, "Escape schließt die Palette");

  // 7) Abgelaufenes Login -> Palette bleibt offen, kein Crash, Enter öffnet nichts.
  searchResult = { ok: false, reason: "not-logged-in" };
  env.fireKeydown(key("k", { metaKey: true }));
  await typeQuery("Beispiel");
  assert.ok(env.getElementById(PALETTE_ID), "bei nicht angemeldet bleibt die Palette offen");
  env.fireKeydown(key("Enter"));
  assert.strictEqual(env.openedUrls.length, 1, "ohne Treffer öffnet Enter keinen weiteren Tab");

  console.log("ui-palette.test.js: alle Szenarien bestanden.");
}

run();
