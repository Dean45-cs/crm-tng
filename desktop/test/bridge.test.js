"use strict";

// Test für main/bridge.js und main/ws-server.js – die Verbindung zur Extension.
//
// Geprüft wird vor allem, was still schiefgehen kann: dass sich nur die
// Extension verbinden darf (sonst könnte jede offene Webseite die Kundendaten
// mitlesen), dass Schreibvorgänge ohne Chrome nicht verloren gehen, und dass
// große KI-Antworten unbeschädigt ankommen.
//
// Ausführen mit: node test/bridge.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { Store } = require("../main/store");
const { Bridge } = require("../main/bridge");
const { connect } = require("./support/ws-client");

let nextPort = 8830;

// Fängt ab, was das Fenster zu sehen bekäme.
function fakeWindow() {
  const sent = [];
  return {
    sent,
    isDestroyed: () => false,
    webContents: { send: (channel, payload) => sent.push({ channel, payload }) },
    ofChannel: (channel) => sent.filter((entry) => entry.channel === channel)
  };
}

async function makeBridge() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hud-bridge-"));
  const store = new Store(dir);
  const port = nextPort++;
  const shown = [];
  const bridge = new Bridge({ store, port, onShow: () => shown.push(Date.now()) });
  const win = fakeWindow();
  bridge.attachWindow(win);
  await bridge.listen();
  return { bridge, store, win, port, shown };
}

async function run() {
  // --- Wer sich verbinden darf --------------------------------------------
  {
    const { bridge, port } = await makeBridge();

    // Eine Webseite. localhost ist für Webseiten nicht gesperrt – ohne diese
    // Prüfung läse jede offene Seite im Browser die Kundendaten mit.
    await assert.rejects(
      () => connect(port, { origin: "https://beliebige-seite.example" }),
      "eine Webseite darf sich nicht verbinden"
    );
    // Ganz ohne Origin (ein Programm außerhalb des Browsers).
    await assert.rejects(() => connect(port, { origin: null }), "ohne Origin keine Verbindung");

    const extension = await connect(port);
    assert.ok(extension, "die Extension darf");
    extension.close();

    // Jede gültige Extension-ID darf – bewusst nicht auf eine einzelne
    // festgenagelt, sonst würde eine Neuinstallation (neue ID) still abgewiesen.
    const andere = await connect(port, { origin: "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba" });
    assert.ok(andere, "auch eine andere Extension-ID darf sich verbinden");
    andere.close();

    bridge.close();
  }

  // --- Storage in beide Richtungen ----------------------------------------
  {
    const { bridge, store, win, port } = await makeBridge();
    const extension = await connect(port);

    // Beim Verbinden fordert die Brücke den frischen Stand an.
    await extension.waitFor("sync");

    extension.send({ t: "storage-snapshot", data: { "stadtnetzCrm.tone": "sachlich" } });
    await new Promise((resolve) => setTimeout(resolve, 120));

    assert.deepStrictEqual(store.get("stadtnetzCrm.tone"), { "stadtnetzCrm.tone": "sachlich" });
    const changed = win.ofChannel("hud:storage-changed");
    assert.ok(changed.length, "das Fenster erfährt von der Änderung");

    // Schreiben aus dem Fenster: sofort lokal sichtbar UND an Chrome geschickt.
    bridge.storageSet({ "stadtnetzCrm.tone": "locker" });
    assert.deepStrictEqual(store.get("stadtnetzCrm.tone"), { "stadtnetzCrm.tone": "locker" },
      "das Fenster wartet nicht auf Chrome");
    const weitergereicht = await extension.waitFor("storage-set");
    assert.deepStrictEqual(weitergereicht.payload, { "stadtnetzCrm.tone": "locker" });

    // Chrome meldet denselben Wert zurück – daraus darf keine Schleife werden.
    const vorher = win.ofChannel("hud:storage-changed").length;
    extension.send({ t: "storage-changed", changes: { "stadtnetzCrm.tone": { newValue: "locker" } } });
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.strictEqual(win.ofChannel("hud:storage-changed").length, vorher,
      "der Widerhall der eigenen Schreibung löst nichts aus");

    extension.close();
    bridge.close();
  }

  // --- Schreibvorgänge ohne Chrome ----------------------------------------
  {
    const { bridge, port } = await makeBridge();

    // Die App läuft, Chrome noch nicht: eine Notiz oder Einstellung darf
    // deswegen nicht verloren gehen.
    bridge.storageSet({ "stadtnetzCrm.tone": "sachlich" });
    bridge.storageRemove(["stadtnetzCrm.callOutcome"]);

    const extension = await connect(port);
    const nachgereicht = await extension.waitFor("storage-set");
    assert.deepStrictEqual(nachgereicht.payload, { "stadtnetzCrm.tone": "sachlich" },
      "Nachgeholtes geht vor dem Abgleich raus");
    await extension.waitFor("storage-remove");
    await extension.waitFor("sync");

    // Reihenfolge zählt: erst unsere Änderungen, dann der Stand von Chrome.
    const typen = extension.messages.map((message) => message.t);
    assert.ok(typen.indexOf("storage-set") < typen.indexOf("sync"),
      "sonst überschriebe der alte Stand aus Chrome die neuen Werte");

    extension.close();
    bridge.close();
  }

  // --- KI-Aufrufe ----------------------------------------------------------
  {
    const { bridge, win, port } = await makeBridge();

    // Ohne Chrome: die App muss das sofort wissen und darf nicht warten.
    assert.strictEqual(bridge.aiCall({ id: "ai-1", method: "summarize", args: [] }), false,
      "ohne Extension wird der Aufruf nicht angenommen");

    const extension = await connect(port);
    assert.strictEqual(bridge.aiCall({ id: "ai-2", method: "summarize", args: [{}] }), true);
    const auftrag = await extension.waitFor("ai-call");
    assert.strictEqual(auftrag.method, "summarize");

    // Eine lange Zusammenfassung überschreitet das 16-Bit-Längenfeld des
    // WebSocket-Rahmens – genau dort bricht eine unvollständige Implementierung.
    const langerText = "Anliegen: ".repeat(20000);
    extension.send({ t: "ai-result", id: "ai-2", ok: true, result: { status: "available", text: langerText } });
    await new Promise((resolve) => setTimeout(resolve, 250));

    const antwort = win.ofChannel("hud:ai").map((entry) => entry.payload).find((p) => p.t === "ai-result");
    assert.ok(antwort, "das Ergebnis erreicht das Fenster");
    assert.strictEqual(antwort.result.text.length, langerText.length, "der Text kommt vollständig an");

    extension.close();
    bridge.close();
  }

  // --- Verbindungszustand --------------------------------------------------
  {
    const { bridge, win, port } = await makeBridge();
    assert.strictEqual(bridge.connected, false);

    const extension = await connect(port);
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.strictEqual(bridge.connected, true);

    const ticket = { key: "SUP-9", summary: "Test" };
    extension.send({ t: "ticket", ticket });
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.deepStrictEqual(win.ofChannel("hud:ticket").pop().payload, ticket);

    extension.close();
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.strictEqual(bridge.connected, false, "das Trennen wird bemerkt");
    assert.deepStrictEqual(bridge.ticket, ticket,
      "der letzte bekannte Vorgang bleibt stehen – er ist nützlicher als ein leeres Panel");

    bridge.close();
  }

  // --- Auskunft aus Chrome hervorholen ------------------------------------
  {
    const { bridge, port, shown } = await makeBridge();

    // Solange die App läuft, hat der Jira-Tab kein eigenes Panel mehr. Der
    // Klick auf das Symbol der Erweiterung (bzw. auf die Sprechblase in der
    // Seite) ist dann der einzige Weg aus Chrome heraus zur Auskunft – bricht
    // er weg, wirkt eine ausgeblendete App wie eine abgestürzte.
    const extension = await connect(port);
    await extension.waitFor("sync");

    extension.send({ t: "show" });
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.strictEqual(shown.length, 1, "der Auftrag aus Chrome erreicht das Fenster");

    // Zweimal klicken heißt zweimal nach vorn holen – nichts wird zusammengefasst.
    extension.send({ t: "show" });
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.strictEqual(shown.length, 2);

    extension.close();
    bridge.close();
  }

  console.log("bridge.test.js: alle Szenarien bestanden.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
