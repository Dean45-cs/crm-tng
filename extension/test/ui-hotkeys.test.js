"use strict";

// Die Tastenkürzel-Einstellungen im Panel (src/ui.js).
//
// Was hier festgehalten wird, sind die Zusagen, an denen so eine Seite scheitert:
//   1. Jedes Kürzel des Projekts steht in den Einstellungen – die Zeilen kommen
//      aus der Liste, nicht aus abgetipptem Markup. Ein neues Kürzel taucht
//      damit von selbst auf.
//   2. Aufnehmen wirkt sofort und überlebt den Neustart (Storage).
//   3. Während der Aufnahme löst der Tastendruck NICHT die Aktion aus, die man
//      gerade neu belegt – sonst ginge beim Belegen von ⌘K die Palette auf.
//   4. Doppelbelegung wird abgewiesen, mit Angabe, wer die Taste schon hat.
//   5. Ein Kürzel lässt sich abschalten, ohne dass es beim nächsten Laden
//      wieder auf der Voreinstellung steht.
//
// Ausführen mit: node test/ui-hotkeys.test.js

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

const PALETTE_ID = "sc-jira-palette";

// Der Storage lebt in der Sandbox: seine Objekte haben einen anderen Prototyp
// als die des Tests, deshalb wird über den Inhalt verglichen.
function storedHotkeys(env, KEYS) {
  return JSON.stringify(env.storage[KEYS.hotkeys]);
}

function press(key, mods) {
  return {
    key,
    metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
    preventDefault() {}, stopPropagation() {},
    ...(mods || {})
  };
}

async function mountPanel(storageSeed) {
  const env = makePanelSandbox();
  loadScripts(env.sandbox, ["src/config.js", "src/commission.js", "src/shared.js"]);
  // Die Palette ist der sichtbare Beweis, dass ein Kürzel wirkt – dafür braucht
  // sie eine Suchquelle (wie in ui-palette.test.js).
  env.sandbox.StadtnetzCRM.supabaseClient = {
    customerCard: async () => ({ ok: false, reason: "not-configured" }),
    searchWorkspace: async () => ({ ok: true, groups: [] })
  };
  loadScripts(env.sandbox, SCRIPTS.filter((file) => ["src/config.js", "src/shared.js"].indexOf(file) < 0));
  const KEYS = env.sandbox.StadtnetzCRM.CONFIG.storageKeys;
  if (storageSeed) Object.assign(env.storage, storageSeed(KEYS));
  await env.sandbox.StadtnetzCRM.ui.mount();
  env.click("toggle-settings");
  return { env, KEYS, app: env.sandbox.StadtnetzCRM };
}

async function run() {
  // --- 1. Die Zeilen kommen aus der Liste ---------------------------------
  {
    const { env, app } = await mountPanel();
    const html = env.html();
    assert.ok(html.includes("Tastenkürzel"), "es gibt einen eigenen Abschnitt");

    // In Chrome gibt es keine systemweiten Kürzel (die registriert die
    // Desktop-App) – ihre Zeilen fehlen hier bewusst, statt Schalter zu zeigen,
    // die nichts bewirken.
    app.CONFIG.hotkeys.forEach((def) => {
      const shown = html.includes(`data-hotkey="${def.id}"`);
      assert.strictEqual(shown, def.scope !== "global",
        `${def.id}: ${def.scope === "global" ? "systemweite Kürzel gehören nicht in den Chrome-Tab" : "steht in den Einstellungen"}`);
    });
    assert.ok(html.includes("⌘K"), "die aktuelle Belegung steht als Taste dabei");
  }

  // --- 2. Aufnehmen wirkt sofort und wird gespeichert ---------------------
  {
    const { env, KEYS } = await mountPanel();

    env.click("capture-hotkey", { hotkey: "palette" });
    assert.ok(env.html().includes("Taste drücken"), "die Zeile wartet sichtbar auf den Tastendruck");

    env.fireKeydown(press("j", { metaKey: true, shiftKey: true }));
    assert.strictEqual(storedHotkeys(env, KEYS), '{"palette":"Mod+Shift+J"}', "die Wahl liegt im Storage");
    assert.ok(env.html().includes("⌘⇧J"), "und steht sofort in der Zeile");

    // Und sie gilt: das neue Kürzel öffnet die Palette, das alte nicht mehr.
    env.fireKeydown(press("k", { metaKey: true }));
    assert.strictEqual(env.getElementById(PALETTE_ID), null, "⌘K ist nicht mehr belegt");
    env.fireKeydown(press("j", { metaKey: true, shiftKey: true }));
    assert.ok(env.getElementById(PALETTE_ID), "⌘⇧J öffnet jetzt die Palette");
  }

  // --- 3. Gespeicherte Kürzel gelten nach dem Neustart --------------------
  {
    const { env } = await mountPanel((KEYS) => ({ [KEYS.hotkeys]: { palette: "Mod+Shift+P" } }));
    env.fireKeydown(press("k", { metaKey: true }));
    assert.strictEqual(env.getElementById(PALETTE_ID), null, "die Voreinstellung gilt nicht mehr");
    env.fireKeydown(press("p", { metaKey: true, shiftKey: true }));
    assert.ok(env.getElementById(PALETTE_ID), "das gespeicherte Kürzel wirkt beim Laden");
  }

  // --- 4. Während der Aufnahme feuert die Aktion nicht --------------------
  {
    const { env, KEYS } = await mountPanel();
    env.click("capture-hotkey", { hotkey: "palette" });

    // Genau der Fall: man will ⌘K neu belegen und drückt dabei ⌘K.
    env.fireKeydown(press("k", { metaKey: true }));
    assert.strictEqual(env.getElementById(PALETTE_ID), null,
      "der Tastendruck gehört der Aufnahme, nicht der Palette");
    // Gleiche Taste wie zuvor = keine Änderung gegenüber der Voreinstellung,
    // also auch kein eigener Eintrag.
    assert.strictEqual(storedHotkeys(env, KEYS), "{}", "die Voreinstellung braucht keinen Eintrag");
  }

  // --- 5. Abbrechen und Abschalten ----------------------------------------
  {
    const { env, KEYS } = await mountPanel();

    env.click("capture-hotkey", { hotkey: "notes" });
    env.fireKeydown(press("Escape"));
    assert.ok(!env.html().includes("Taste drücken"), "Esc bricht die Aufnahme ab");
    assert.strictEqual(env.storage[KEYS.hotkeys], undefined, "und ändert nichts");

    env.click("capture-hotkey", { hotkey: "notes" });
    env.fireKeydown(press("Backspace"));
    assert.strictEqual(storedHotkeys(env, KEYS), '{"notes":""}', "Rücktaste schaltet das Kürzel ab");
    // „aus" muss ein eigener Zustand sein: fiele es auf die Voreinstellung
    // zurück, ließe sich ein Kürzel überhaupt nicht loswerden.
    assert.strictEqual(env.sandbox.StadtnetzCRM.ui.hotkey("notes"), "", "abgeschaltet bleibt abgeschaltet");
  }

  // --- 6. Doppelbelegung wird abgewiesen ----------------------------------
  {
    const { env, KEYS } = await mountPanel();

    env.click("capture-hotkey", { hotkey: "notes" });
    env.fireKeydown(press("k", { metaKey: true })); // gehört der Palette
    const html = env.html();
    assert.ok(html.includes("Schon belegt"), "die Zeile sagt, dass die Taste vergeben ist");
    assert.ok(html.includes("Befehlspalette"), "und nennt den anderen Namen");
    assert.strictEqual(env.storage[KEYS.hotkeys], undefined, "nichts wurde übernommen");
    assert.ok(env.html().includes("Taste drücken"), "die Aufnahme läuft weiter – man kann gleich neu drücken");
  }

  // --- 7. Zurücksetzen -----------------------------------------------------
  {
    const { env, KEYS } = await mountPanel((KEYS) => ({
      [KEYS.hotkeys]: { palette: "Mod+Shift+P", notes: "" }
    }));

    env.click("reset-hotkey", { hotkey: "palette" });
    assert.strictEqual(storedHotkeys(env, KEYS), '{"notes":""}', "die Zeile fällt auf die Voreinstellung zurück");

    env.click("reset-hotkeys");
    assert.strictEqual(storedHotkeys(env, KEYS), "{}", "alles zurück heißt: keine eigenen Angaben mehr");
    env.fireKeydown(press("k", { metaKey: true }));
    assert.ok(env.getElementById(PALETTE_ID), "und die Voreinstellung wirkt wieder");
  }

  console.log("ui-hotkeys.test.js: alle Szenarien bestanden.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
