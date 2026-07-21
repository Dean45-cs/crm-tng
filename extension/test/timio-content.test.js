"use strict";

// Smoke-Test für src/timio-content.js: Call-Erkennung und das Idle-
// Wartefeld-Widget. Läuft ohne Browser via Node `vm` gegen die echten
// Quelldateien (siehe test/support/stub-env.js). Ausführen mit:
//   node test/timio-content.test.js
// Neue Szenarien bitte hier ergänzen statt ein neues Wegwerf-Skript zu
// schreiben.

const assert = require("assert");
const { makeSandbox, loadScripts } = require("./support/stub-env");

function run() {
  const env = makeSandbox();
  loadScripts(env.sandbox, ["src/config.js", "src/shared.js", "src/timio-content.js"]);

  // 1) Idle, noch keine Wartefeld-Daten bekannt -> kein Overlay.
  env.setPageText("Portal Willkommen");
  env.tick();
  assert.strictEqual(env.getOverlay(), null, "kein Overlay, solange keine Wartefeld-Daten bekannt sind");

  // 2) Idle, Portal-Tab sichtbar mit Wartefeld-Daten -> Idle-Widget erscheint.
  env.setPageText([
    "TNG GFIZ Bestellhotline",
    "Agenten",
    "3",
    "Wartefeld",
    "2",
    "1:23",
    "0:45",
    "Anrufe Eingang Aktuell",
    "2",
    "Im Wartefeld"
  ].join("\n"));
  env.tick();
  assert.ok(env.getOverlay(), "Idle-Wartefeld-Widget erscheint, sobald Wartefeld-Daten bekannt sind");
  assert.ok(env.getOverlay().innerHTML.includes("Wartefeld"), "Idle-Widget zeigt das Label \"Wartefeld\"");

  // 3) Weg vom Portal-Tab (Daten bleiben gecacht) -> Widget bleibt sichtbar.
  env.setPageText("Willkommen");
  env.tick();
  assert.ok(env.getOverlay(), "Idle-Widget bleibt mit gecachten Daten sichtbar, auch außerhalb des Portal-Tabs");

  // 4) Eingehender Anruf -> Anrufkarte ersetzt das Idle-Widget.
  env.setPageText([
    "AB",
    "Anna Beispiel",
    "Beispiel",
    "+49 (176) 34573586",
    "Eingehender Anruf",
    "Gruppe: TNG GFIZ Bestellhotline",
    "Wartezeit: 0:12",
    "Kundennummer: 12345"
  ].join("\n"));
  env.tick();
  assert.ok(env.getOverlay().innerHTML.includes("Klingelt"), "während des Klingelns wird die Anrufkarte gezeigt, nicht das Idle-Widget");

  // 5) Anruf endet, Seite wird wieder idle -> Idle-Widget erscheint erneut.
  env.setPageText("Willkommen");
  env.tick();
  assert.ok(env.getOverlay(), "Idle-Widget erscheint nach Anrufende wieder");
  assert.ok(env.getOverlay().innerHTML.includes("Wartefeld"), "das wiedererschienene Widget ist das Idle-Wartefeld-Widget");

  // 6) Idle-Widget per ×-Button schließen -> sofort ausgeblendet.
  env.clickControl("close");
  env.tick();
  assert.strictEqual(env.getOverlay(), null, "Idle-Widget verschwindet nach Klick auf Schließen");

  // 7) Neuer Anruf + Ende startet einen frischen Idle-Abschnitt -> Widget erscheint wieder.
  env.setPageText([
    "AB",
    "Anna Beispiel",
    "Beispiel",
    "+49 (176) 34573586",
    "Eingehender Anruf",
    "Gruppe: TNG GFIZ Bestellhotline",
    "Wartezeit: 0:12",
    "Kundennummer: 12345"
  ].join("\n"));
  env.tick();
  env.setPageText("Willkommen");
  env.tick();
  assert.ok(env.getOverlay(), "Idle-Widget erscheint nach einem frischen Idle-Abschnitt wieder, auch nach vorherigem Dismiss");

  // --- Outbound ------------------------------------------------------------
  // timio wählt aus seiner eigenen Anrufliste selbst; ein solcher Anruf ist
  // ohne Klingel-Phase sofort verbunden. Das ist ein Indiz für "ausgehend" –
  // umgeschaltet wird aber nur über den Modus-Schalter.

  // 8) Direkt verbunden ohne Klingeln -> likelyOutbound wird gemeldet.
  const KEYS = env.sandbox.SupportCopilot.CONFIG.storageKeys;
  env.setPageText([
    "CD",
    "Carl Demo",
    "Demo",
    "+49 (170) 1234567",
    "Gruppe: TNG GFIZ Ausbaustatus",
    "Wartezeit: 0:00",
    "Kundennummer: 287246"
  ].join("\n"));
  env.tick();
  assert.strictEqual(env.storage[KEYS.activeCall].status, "connected", "ohne Klingeln wird direkt verbunden erkannt");
  assert.strictEqual(env.storage[KEYS.activeCall].likelyOutbound, true, "ein Anruf ohne Klingel-Phase wirkt ausgehend");

  // 9) Ein normaler eingehender Anruf darf das Indiz NICHT setzen.
  env.setPageText("Willkommen");
  env.tick();
  env.setPageText([
    "AB",
    "Anna Beispiel",
    "Beispiel",
    "+49 (176) 34573586",
    "Eingehender Anruf",
    "Gruppe: TNG GFIZ Bestellhotline",
    "Wartezeit: 0:12",
    "Kundennummer: 12345"
  ].join("\n"));
  env.tick();
  assert.strictEqual(env.storage[KEYS.activeCall].likelyOutbound, false, "ein geklingelter Anruf wirkt nicht ausgehend");
  // Auch nach dem Annehmen bleibt die Klingel-Herkunft erhalten.
  env.setPageText([
    "AB",
    "Anna Beispiel",
    "Beispiel",
    "+49 (176) 34573586",
    "Gruppe: TNG GFIZ Bestellhotline",
    "Wartezeit: 0:12",
    "Kundennummer: 12345"
  ].join("\n"));
  env.tick();
  assert.strictEqual(env.storage[KEYS.activeCall].likelyOutbound, false, "nach dem Annehmen bleibt der Anruf eingehend");

  // 10) Der Modus-Schalter im Overlay schreibt die Richtung in den Storage,
  //     damit das Jira-Panel sofort nachzieht.
  env.clickControl("mode-outbound");
  assert.strictEqual(env.storage[KEYS.callMode], "outbound", "der Schalter veröffentlicht die Arbeitsrichtung");
  assert.ok(env.getOverlay().innerHTML.includes("Im Gespräch"), "die Anrufkarte bleibt sichtbar");

  env.clickControl("mode-inbound");
  assert.strictEqual(env.storage[KEYS.callMode], "inbound", "zurückschalten funktioniert ebenso");

  // 11) Gesprächsergebnis: in timio geklickt, in Jira verarbeitet. Das
  //     Content-Script legt es nur als Staffelstab in den Storage.
  env.setPageText([
    "AB",
    "Anna Beispiel",
    "+49 (176) 34573586",
    "Beendet",
    "Dauer: 2:13",
    "Gruppe: TNG GFIZ Bestellhotline",
    "Kundennummer: 12345"
  ].join("\n"));
  env.tick();
  env.clickControl("outcome", { outcome: "not-reached" });
  const outcome = env.storage[KEYS.callOutcome];
  assert.ok(outcome, "das Ergebnis wird für die Jira-Seite hinterlegt");
  assert.strictEqual(outcome.outcomeId, "not-reached", "die geklickte Ergebnis-ID kommt an");
  assert.strictEqual(outcome.customerNumber, "12345", "die Kundennummer des Gesprächs wird mitgegeben");

  // Unbekannte IDs dürfen nichts auslösen (Schutz vor kaputtem Markup).
  env.storage[KEYS.callOutcome] = null;
  env.clickControl("outcome", { outcome: "gibt-es-nicht" });
  assert.strictEqual(env.storage[KEYS.callOutcome], null, "eine unbekannte Ergebnis-ID wird ignoriert");

  console.log("timio-content.test.js: alle Szenarien bestanden.");
}

run();
