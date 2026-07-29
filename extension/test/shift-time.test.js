"use strict";

// Test für src/shift-time.js — die gemeinsame Schichtzeit-/Schichtart-Logik,
// die sowohl per `require()` (Node/CRM-Build über src/lib/shifts.ts) als auch
// als klassisches Content-Script im Cockpit läuft.
//
// Der Punkt dieser Datei ist der geteilte Vertrag: CRM-Dashboard und Cockpit
// zeigen beide die Restzeit der laufenden Schicht an. Wenn sich hier etwas
// verschiebt, müssen es beide Seiten gemeinsam tun — deshalb sind die Zeiten
// hier festgenagelt und nicht nur „irgendwie plausibel" geprüft.
//
// Ausführen mit: node test/shift-time.test.js

const assert = require("assert");
const st = require("../src/shift-time.js");

const hm = (h, m) => h * 60 + (m || 0);

function run() {
  // --- Vertrag: Zeiten sind exakt die betrieblichen ------------------------
  assert.deepStrictEqual(st.SHIFT_TIMES.frueh, { startMin: hm(7, 45), endMin: hm(16, 15) });
  assert.deepStrictEqual(st.SHIFT_TIMES.spaet, { startMin: hm(8, 45), endMin: hm(17, 15) });
  assert.strictEqual(st.shiftTimeLabel("frueh"), "07:45 – 16:15");
  assert.strictEqual(st.shiftTimeLabel("spaet"), "08:45 – 17:15");
  // Abwesenheiten haben kein Zeitfenster — und dürfen auch keins vortäuschen.
  ["frei", "urlaub", "krank", "schulung"].forEach((t) => {
    assert.strictEqual(st.shiftTimeLabel(t), null, `${t} darf kein Zeitfenster haben`);
    assert.strictEqual(st.shiftProgress(t, hm(12)), null, `${t} hat keinen Verlauf`);
  });

  // --- Arbeit vs. Abwesenheit ---------------------------------------------
  assert.strictEqual(st.isWorking("frueh"), true);
  assert.strictEqual(st.isWorking("spaet"), true);
  ["frei", "urlaub", "krank", "schulung"].forEach((t) => {
    assert.strictEqual(st.isWorking(t), false, `${t} ist kein Arbeitstag`);
  });
  // „frei" ist geplant, die anderen drei sind begründete Ausfälle.
  assert.strictEqual(st.shiftMeta("frei").absence, false);
  ["urlaub", "krank", "schulung"].forEach((t) => {
    assert.strictEqual(st.shiftMeta(t).absence, true, `${t} ist eine Abwesenheit`);
  });

  // Unbekannte Art darf nicht werfen — ein alter Client soll an einer neu
  // eingeführten Schichtart nicht zerbrechen.
  assert.strictEqual(st.shiftMeta("sabbatical").label, "Frei");
  assert.strictEqual(st.shiftMeta(undefined).label, "Frei");
  assert.strictEqual(st.isWorking(null), false);

  // --- Verlauf der laufenden Schicht --------------------------------------
  const before = st.shiftProgress("frueh", hm(7, 0));
  assert.strictEqual(before.phase, "before");
  assert.strictEqual(before.minutesLeft, 45);

  const running = st.shiftProgress("frueh", hm(12, 0));
  assert.strictEqual(running.phase, "running");
  assert.strictEqual(running.minutesLeft, 255); // bis 16:15
  assert.ok(running.progress > 0.4 && running.progress < 0.6);

  // Der Endzeitpunkt selbst zählt schon als beendet.
  const after = st.shiftProgress("frueh", hm(16, 15));
  assert.strictEqual(after.phase, "after");
  assert.strictEqual(after.minutesLeft, 0);

  // --- Formatierung --------------------------------------------------------
  assert.strictEqual(st.formatMinutes(hm(7, 45)), "07:45");
  assert.strictEqual(st.formatMinutes(hm(17, 5)), "17:05");
  assert.strictEqual(st.formatDuration(45), "45 Min.");
  assert.strictEqual(st.formatDuration(135), "2:15 Std.");
  assert.strictEqual(st.formatDuration(125), "2:05 Std.");
  assert.strictEqual(st.formatDuration(-10), "0 Min.");

  // --- Reihenfolge: Arbeit zuerst, dann Ausfälle ---------------------------
  assert.deepStrictEqual(st.SHIFT_ORDER, ["frueh", "spaet", "frei", "urlaub", "krank", "schulung"]);

  // --- Browser-Ladeform: registriert sich auf globalThis -------------------
  assert.ok(globalThis.StadtnetzCRM && globalThis.StadtnetzCRM.shiftTime,
    "muss sich unter globalThis.StadtnetzCRM.shiftTime registrieren (Content-Script-Zweig)");
  assert.strictEqual(globalThis.StadtnetzCRM.shiftTime.shiftTimeLabel("frueh"), "07:45 – 16:15");

  console.log("shift-time.test.js: alle Prüfungen bestanden");
}

run();
