"use strict";

// Prüft die vom Nutzer vorgeschlagene Arbeitsweise: ein timio-Tab bleibt auf
// "Portal" stehen und liefert laufend frische Wartefeld-Zahlen, ein zweiter,
// unabhängiger timio-Tab (z. B. für echte Anrufe) zeigt diese Zahlen an,
// ohne selbst je das Portal gesehen zu haben. Beide Sandboxes teilen sich
// einen Bus, der das echte extension-weite chrome.storage.local +
// chrome.storage.onChanged simuliert (siehe test/support/stub-env.js).
//
// Ausführen mit: node test/timio-cross-tab.test.js

const assert = require("assert");
const { makeSandbox, loadScripts, createBus } = require("./support/stub-env");

const SCRIPTS = ["src/config.js", "src/shared.js", "src/timio-content.js"];

function portalText(waiting) {
  return [
    "TNG GFIZ Bestellhotline",
    "Agenten",
    "3",
    "Wartefeld",
    String(waiting),
    "1:23",
    "0:45",
    "Anrufe Eingang Aktuell",
    String(waiting),
    "Im Wartefeld"
  ].join("\n");
}

function run() {
  const bus = createBus();

  // Tab A: bleibt auf dem timio-Portal, liefert die Wartefeld-Zahlen.
  const tabA = makeSandbox(bus);
  loadScripts(tabA.sandbox, SCRIPTS);
  tabA.setPageText(portalText(2));
  tabA.tick();
  assert.ok(bus.storage["supportCopilot.queueStats"], "Tab A schreibt Wartefeld-Daten in den geteilten Storage");

  // Tab B: wird ERST NACH Tab A geöffnet (z. B. für echte Anrufe) und
  // bekommt beim Laden bereits den vorhandenen Stand aus dem Storage.
  const tabB = makeSandbox(bus);
  loadScripts(tabB.sandbox, SCRIPTS);
  tabB.setPageText("Willkommen"); // kein Portal – Tab B parst selbst nie Wartefeld-Text
  tabB.tick();
  assert.ok(tabB.getOverlay(), "Tab B zeigt das Idle-Wartefeld-Widget, obwohl es nie selbst das Portal gesehen hat");
  assert.ok(tabB.getOverlay().innerHTML.includes(">2<"), "Tab B zeigt die von Tab A gelieferte Zahl (2)");

  // Tab A meldet neue Zahlen (z. B. mehr Anrufer in der Leitung) -> Tab B
  // übernimmt sie automatisch über chrome.storage.onChanged, ganz ohne dass
  // Tab B selbst auf dem Portal war.
  tabA.setPageText(portalText(5));
  tabA.tick();
  tabB.tick(); // Tab B rendert bei jedem eigenen Tick neu, auch ohne lokale Textänderung
  assert.ok(tabB.getOverlay().innerHTML.includes(">5<"), "Tab B übernimmt eine live aktualisierte Zahl (5) von Tab A");

  // Schließt Tab A (z. B. Browser-Tab zu) -> Tab B behält die letzten
  // bekannten Zahlen weiter sichtbar (mit Veraltet-Hinweis), statt das
  // Widget zu verstecken.
  tabB.tick();
  assert.ok(tabB.getOverlay(), "Tab B blendet das Widget nicht aus, nur weil gerade keine neuen Daten hereinkommen");

  console.log("timio-cross-tab.test.js: alle Szenarien bestanden.");
}

run();
