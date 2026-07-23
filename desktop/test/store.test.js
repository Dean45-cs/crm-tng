"use strict";

// Test für main/store.js – den Spiegel von chrome.storage.local.
//
// Der Kern ist das Erkennen echter Änderungen. Ohne diesen Vergleich entsteht
// eine Rückkopplung: das Fenster schreibt, Chrome meldet dieselbe Änderung
// zurück, das Fenster baut neu auf und schreibt erneut. Wartefeld-Zahlen und
// der Anruf-Timer kommen im Sekundentakt – das würde sofort auffallen.
//
// Ausführen mit: node test/store.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { Store } = require("../main/store");

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hud-store-"));
  return { store: new Store(dir), dir };
}

function run() {
  // --- Änderungen erkennen -------------------------------------------------
  {
    const { store } = tempStore();

    const first = store.set({ a: 1, b: { x: 1 } });
    assert.deepStrictEqual(Object.keys(first).sort(), ["a", "b"], "neue Werte sind Änderungen");
    assert.strictEqual(first.a.newValue, 1);
    assert.strictEqual(first.a.oldValue, undefined);

    const same = store.set({ a: 1, b: { x: 1 } });
    assert.deepStrictEqual(same, {}, "gleicher Wert ist keine Änderung – sonst gäbe es eine Rückkopplung");

    const nested = store.set({ b: { x: 2 } });
    assert.deepStrictEqual(Object.keys(nested), ["b"], "auch verschachtelte Werte werden verglichen");
    assert.strictEqual(nested.b.oldValue.x, 1, "der alte Wert wird mitgeliefert");
  }

  // --- Lesen ---------------------------------------------------------------
  {
    const { store } = tempStore();
    store.set({ a: 1, b: 2 });

    assert.deepStrictEqual(store.get(["a"]), { a: 1 }, "Liste von Schlüsseln");
    assert.deepStrictEqual(store.get("b"), { b: 2 }, "einzelner Schlüssel");
    assert.deepStrictEqual(store.get(["a", "fehlt"]), { a: 1 }, "unbekannte Schlüssel fehlen im Ergebnis");
    assert.deepStrictEqual(store.get(null), { a: 1, b: 2 }, "null liefert alles");
  }

  // --- Entfernen -----------------------------------------------------------
  {
    const { store } = tempStore();
    store.set({ a: 1 });

    const removed = store.remove(["a", "gibtesnicht"]);
    assert.deepStrictEqual(Object.keys(removed), ["a"], "nur vorhandene Schlüssel melden eine Änderung");
    assert.strictEqual(removed.a.newValue, undefined);
    assert.deepStrictEqual(store.get(null), {}, "der Wert ist weg");
  }

  // --- Vollständiger Stand aus Chrome --------------------------------------
  {
    const { store } = tempStore();
    store.set({ bleibt: 1, aendert: "alt", verschwindet: true });

    const changes = store.replaceAll({ bleibt: 1, aendert: "neu", neu: 5 });
    assert.deepStrictEqual(
      Object.keys(changes).sort(),
      ["aendert", "neu", "verschwindet"],
      "gemeldet wird nur, was sich unterscheidet – nicht der ganze Stand"
    );
    assert.strictEqual(changes.verschwindet.newValue, undefined, "fehlende Schlüssel gelten als entfernt");
    assert.deepStrictEqual(store.get(null), { bleibt: 1, aendert: "neu", neu: 5 });

    assert.deepStrictEqual(store.replaceAll({ bleibt: 1, aendert: "neu", neu: 5 }), {},
      "derselbe Stand beim Wiederverbinden lässt das Fenster in Ruhe");
  }

  // --- Dauerhaftigkeit -----------------------------------------------------
  {
    const { store, dir } = tempStore();
    store.set({ merken: "ja" });
    store.hudSet("bounds", { x: 10, y: 20 });
    store.flush();

    // Ohne Chrome soll das Fenster den letzten Stand zeigen können – dafür muss
    // er einen Neustart überleben.
    const wieder = new Store(dir);
    assert.deepStrictEqual(wieder.get("merken"), { merken: "ja" });
    assert.deepStrictEqual(wieder.hudGet("bounds", null), { x: 10, y: 20 });
    assert.strictEqual(wieder.hudGet("gibtesnicht", "vorgabe"), "vorgabe");
  }

  // --- Beschädigte Datei ---------------------------------------------------
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hud-store-"));
    fs.writeFileSync(path.join(dir, "mirror.json"), "{kaputt");

    const store = new Store(dir);
    assert.deepStrictEqual(store.get(null), {}, "eine unlesbare Datei darf den Start nicht verhindern");
  }

  console.log("store.test.js: alle Szenarien bestanden.");
}

run();
