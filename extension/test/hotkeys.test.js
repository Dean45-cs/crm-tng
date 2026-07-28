"use strict";

// Test für die Tastenkürzel: das Format in src/shared.js und die Liste in
// src/config.js.
//
// Warum das einen eigenen Test wert ist: „Mod" ist je nach System eine andere
// Taste. Steht das Format schief, äußert sich das nicht als Fehler, sondern als
// „das Kürzel tut nichts" – auf einem Betriebssystem, das der Entwickler gerade
// nicht vor sich hat. Deshalb läuft hier beides durch, macOS und Windows.
//
// Ausführen mit: node test/hotkeys.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "src");

// Lädt config.js + shared.js in einer Sandbox mit vorgegebener Plattform.
function load(platform) {
  const sandbox = { console, navigator: { platform } };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  ["config.js", "shared.js"].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(SRC, file), "utf8"), sandbox);
  });
  return sandbox.StadtnetzCRM;
}

// Ein Tastendruck, wie ihn der Browser meldet.
function press(key, mods) {
  return { key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...(mods || {}) };
}

function run() {
  const mac = load("MacIntel").shared;
  const win = load("Win32").shared;

  // --- „Mod" ist die Taste des jeweiligen Systems -------------------------
  {
    // Genau hierfür gibt es die Schreibweise: ein Kürzel, zwei Systeme.
    assert.ok(mac.hotkeyMatches(press("k", { metaKey: true }), "Mod+K"), "macOS: ⌘K");
    assert.ok(!mac.hotkeyMatches(press("k", { ctrlKey: true }), "Mod+K"),
      "macOS: Strg+K ist NICHT ⌘K – dort gehört Strg dem Betriebssystem");

    assert.ok(win.hotkeyMatches(press("k", { ctrlKey: true }), "Mod+K"), "Windows: Strg+K");
    assert.ok(!win.hotkeyMatches(press("k", { metaKey: true }), "Mod+K"), "Windows: Windows-Taste ist nicht Mod");
  }

  // --- Zusatztasten müssen genau stimmen ----------------------------------
  {
    // Ein Kürzel darf nicht mitfeuern, wenn zusätzlich Umschalt gedrückt ist –
    // sonst löst ⌘⇧N (Notiz) nebenbei auch ⌘N (Vertrag) aus.
    assert.ok(!mac.hotkeyMatches(press("n", { metaKey: true, shiftKey: true }), "Mod+N"),
      "⌘⇧N ist nicht ⌘N");
    assert.ok(mac.hotkeyMatches(press("n", { metaKey: true, shiftKey: true }), "Mod+Shift+N"));
    assert.ok(!mac.hotkeyMatches(press("k", { metaKey: true, altKey: true }), "Mod+K"), "⌘⌥K ist nicht ⌘K");
  }

  // --- Aufnehmen ------------------------------------------------------------
  {
    assert.strictEqual(mac.hotkeyFromEvent(press("k", { metaKey: true })), "Mod+K");
    assert.strictEqual(mac.hotkeyFromEvent(press("K", { metaKey: true, shiftKey: true })), "Mod+Shift+K");
    assert.strictEqual(mac.hotkeyFromEvent(press(" ", { metaKey: true, shiftKey: true })), "Mod+Shift+Space",
      "die Leertaste meldet sich als \" \" und braucht einen Namen");
    assert.strictEqual(win.hotkeyFromEvent(press("k", { ctrlKey: true })), "Mod+K",
      "auf Windows wird Strg zu Mod – nicht zu einem zweiten Eintrag");
    // Solange nur Zusatztasten gedrückt sind, ist das noch kein Kürzel: die
    // Aufnahme muss weiterwarten, statt „Mod+Meta" zu speichern.
    assert.strictEqual(mac.hotkeyFromEvent(press("Meta", { metaKey: true })), "");
    assert.strictEqual(mac.hotkeyFromEvent(press("Shift", { shiftKey: true })), "");
  }

  // --- Beschriften ----------------------------------------------------------
  {
    assert.strictEqual(mac.hotkeyLabel("Mod+Shift+Space"), "⌘⇧Leertaste");
    assert.strictEqual(win.hotkeyLabel("Mod+Shift+Space"), "Strg+Umschalt+Leertaste");
    assert.strictEqual(mac.hotkeyLabel("Mod+Enter"), "⌘⏎");
    assert.strictEqual(mac.hotkeyLabel(""), "", "kein Kürzel, keine Beschriftung");
  }

  // --- Übersetzung für die systemweiten Kürzel (Electron) ------------------
  {
    assert.strictEqual(mac.hotkeyToAccelerator("Mod+Shift+Space"), "CommandOrControl+Shift+Space");
    assert.strictEqual(mac.hotkeyToAccelerator("Ctrl+Alt+Delete"), "Control+Alt+Delete");
    assert.strictEqual(mac.hotkeyToAccelerator(""), "", "abgeschaltet bleibt abgeschaltet");
  }

  // --- Nachschlagen: eigene Angabe vor Voreinstellung ----------------------
  {
    assert.strictEqual(mac.hotkeyFor("palette", {}), "Mod+K", "ohne eigene Angabe gilt die Voreinstellung");
    assert.strictEqual(mac.hotkeyFor("palette", { palette: "Mod+Shift+P" }), "Mod+Shift+P");
    // Ein ausdrücklich leerer Eintrag heißt „abgeschaltet" und darf NICHT auf
    // die Voreinstellung zurückfallen – sonst ließe sich nichts abschalten.
    assert.strictEqual(mac.hotkeyFor("palette", { palette: "" }), "", "leer heißt aus");
    assert.strictEqual(mac.hotkeyFor("gibtsnicht", {}), "");
  }

  // --- Doppelbelegung -------------------------------------------------------
  {
    // Zwei gleiche Kürzel sind immer ein Fehler, auch über Bereiche hinweg: ein
    // systemweites schluckt den Tastendruck, bevor das Panel ihn sieht.
    assert.strictEqual(mac.hotkeyConflict("notes", "Mod+K", {}), "palette");
    assert.strictEqual(mac.hotkeyConflict("notes", "Mod+Shift+Space", {}), "toggleOverlay");
    assert.strictEqual(mac.hotkeyConflict("notes", "Mod+J", {}), "", "freie Taste ist frei");
    assert.strictEqual(mac.hotkeyConflict("palette", "Mod+K", {}), "", "sich selbst blockiert man nicht");
    // Wurde das andere Kürzel umgelegt, ist die Taste wieder frei.
    assert.strictEqual(mac.hotkeyConflict("notes", "Mod+K", { palette: "Mod+P" }), "");
  }

  // --- Die Liste selbst -----------------------------------------------------
  {
    const defs = mac.hotkeyDefs();
    assert.ok(defs.length >= 5, "alle Kürzel des Projekts stehen in einer Liste");
    const ids = defs.map((def) => def.id);
    assert.strictEqual(new Set(ids).size, ids.length, "jede id nur einmal");
    defs.forEach((def) => {
      assert.ok(def.label && def.hint, `${def.id}: die Einstellungen zeigen Name und Erklärung`);
      assert.ok(["panel", "hud", "global"].indexOf(def.scope) >= 0, `${def.id}: bekannter Bereich`);
      // Eine Voreinstellung, die selbst schon doppelt belegt ist, wäre ab Werk
      // kaputt – und in den Einstellungen nicht mehr zu retten.
      assert.strictEqual(mac.hotkeyConflict(def.id, def.default, {}), "",
        `${def.id}: die Voreinstellung kollidiert mit keiner anderen`);
      assert.ok(mac.hotkeyFromEvent(fakePress(def.default)) === def.default,
        `${def.id}: die Voreinstellung ist in der Schreibweise, die auch beim Aufnehmen entsteht`);
    });
  }

  console.log("hotkeys.test.js: alle Szenarien bestanden.");
}

// Baut aus einem Kürzel den Tastendruck, der es erzeugen würde (macOS) – damit
// prüfbar ist, dass Voreinstellungen und Aufnahme dieselbe Schreibweise ergeben.
function fakePress(binding) {
  const parts = String(binding).split("+");
  const key = parts.pop();
  return press(key.length === 1 ? key.toLowerCase() : key === "Space" ? " " : key, {
    metaKey: parts.indexOf("Mod") >= 0,
    ctrlKey: parts.indexOf("Ctrl") >= 0,
    altKey: parts.indexOf("Alt") >= 0,
    shiftKey: parts.indexOf("Shift") >= 0
  });
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
