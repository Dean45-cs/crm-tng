"use strict";

// Test für src/hud-agent.js – die Gegenstelle der Desktop-App im Jira-Tab.
//
// Zwei Dinge lohnen hier den Aufwand, weil sie beim Lesen des Codes nicht
// auffallen, wenn sie kaputtgehen:
//
//   1. Das Zusammensetzen der KI-Argumente. Die App entfernt die Rückruf-
//      Funktionen vor dem Versand (nur JSON geht über die Brücke) und hier
//      werden sie wieder eingesetzt – an genau der Stelle im Argumentblock, an
//      der local-ai.js sie erwartet. Ein Fehler dabei fällt nicht auf, sondern
//      äußert sich als "die KI streamt nicht mehr".
//   2. Die Übergabe an die App: läuft sie, darf das Panel in der Seite nicht
//      zusätzlich aufgebaut werden, sonst laufen dieselben KI-Aufgaben doppelt.
//
// Ausführen mit: node test/hud-agent.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO_ROOT = path.join(__dirname, "..", "..");

const TICKET = { key: "SUP-1", summary: "Kein Anschluss", status: "Offen", comments: [] };

// Eigene, sehr kleine Sandbox: hud-agent.js braucht weder Rendering noch
// Storage, sondern nur Nachrichten, einen Vorgang und die lokale KI. Alles
// davon wird hier als Attrappe gestellt, damit der Test genau die Durchreiche
// prüft und nicht nebenbei ui.js oder jira-reader.js.
function loadAgent({ localAi } = {}) {
  const sent = [];
  const aiCalls = [];
  const syncCalls = [];
  let onMessage = null;
  let interval = null;

  const app = {
    jiraReader: { read: () => TICKET, UNKNOWN: "Nicht sichtbar" },
    content: { sync: () => syncCalls.push(true) },
    localAi: localAi || {
      capabilities: (...args) => { aiCalls.push({ method: "capabilities", args }); return Promise.resolve({ usable: true }); },
      summarize: (...args) => { aiCalls.push({ method: "summarize", args }); return Promise.resolve({ status: "available", text: "ok" }); }
    }
  };

  const globalObj = {
    StadtnetzCRM: app,
    location: { pathname: "/browse/SUP-1" },
    document: { querySelector: () => null },
    console,
    setInterval(fn) { interval = fn; return 1; },
    clearInterval() {},
    AbortController,
    Promise,
    chrome: {
      runtime: {
        lastError: undefined,
        onMessage: { addListener(fn) { onMessage = fn; } },
        sendMessage(message, cb) { sent.push(message); if (cb) cb(undefined); }
      }
    }
  };
  globalObj.window = globalObj;
  vm.createContext(globalObj);
  vm.runInContext(fs.readFileSync(path.join(REPO_ROOT, "extension/src/hud-agent.js"), "utf8"), globalObj);

  return {
    app,
    sent,
    aiCalls,
    syncCalls,
    tick: () => interval && interval(),
    receive: (message) => onMessage(message),
    // Wartet, bis die angestoßenen Promise-Ketten durchgelaufen sind.
    settle: () => new Promise((resolve) => setImmediate(resolve))
  };
}

function messagesOfType(sent, type) {
  return sent.filter((message) => message.type === type);
}

async function run() {
  // --- Vorgang melden ------------------------------------------------------
  {
    const env = loadAgent();

    // Beim Laden fragt der Agent den Worker nach dem Verbindungszustand.
    assert.deepStrictEqual(
      messagesOfType(env.sent, "sc-hud-state?").length, 1,
      "beim Laden wird der Verbindungszustand erfragt"
    );

    // Solange die App nicht verbunden ist, wird nichts gemeldet – sonst liefe
    // in jedem Jira-Tab dauerhaft ein Nachrichtenverkehr ins Leere.
    env.tick();
    assert.strictEqual(messagesOfType(env.sent, "sc-hud-ticket").length, 0, "ohne App keine Ticketmeldung");

    env.receive({ type: "sc-hud-state", connected: true });
    const pushes = messagesOfType(env.sent, "sc-hud-ticket");
    assert.strictEqual(pushes.length, 1, "beim Verbinden wird der Vorgang sofort gemeldet");
    assert.strictEqual(pushes[0].ticket.key, "SUP-1");

    // Unverändertes Ticket erzeugt keine zweite Meldung: der Takt läuft im
    // Sekundenbereich, das Panel soll davon nicht dauernd neu bauen.
    env.tick();
    env.tick();
    assert.strictEqual(messagesOfType(env.sent, "sc-hud-ticket").length, 1, "gleicher Stand wird nicht erneut gemeldet");
  }

  // --- Übergabe an die App -------------------------------------------------
  {
    const env = loadAgent();
    assert.strictEqual(env.app.hudTakeover, undefined, "vor der Verbindung keine Übergabe");

    env.receive({ type: "sc-hud-state", connected: true });
    assert.strictEqual(env.app.hudTakeover, true, "mit App übernimmt das Fenster");
    assert.strictEqual(env.syncCalls.length, 1, "content.js baut das Panel daraufhin ab");

    // Gleicher Zustand nochmal: kein erneuter Umbau der Seite.
    env.receive({ type: "sc-hud-state", connected: true });
    assert.strictEqual(env.syncCalls.length, 1, "unveränderter Zustand löst nichts aus");

    env.receive({ type: "sc-hud-state", connected: false });
    assert.strictEqual(env.app.hudTakeover, false, "ohne App gehört das Panel wieder in die Seite");
    assert.strictEqual(env.syncCalls.length, 2, "content.js baut das Panel wieder auf");
  }

  // --- KI: Rückrufe landen im richtigen Argument ---------------------------
  {
    const env = loadAgent();
    env.receive({
      type: "sc-hud-ai",
      id: "ai-1",
      method: "summarize",
      // So schickt es die App: der Options-Platz ist da, aber leergeräumt.
      args: [TICKET, {}],
      wantsChunks: true,
      wantsDownload: true
    });
    await env.settle();

    const call = env.aiCalls.find((entry) => entry.method === "summarize");
    assert.ok(call, "summarize wurde aufgerufen");
    assert.strictEqual(call.args.length, 2, "die Argumentanzahl bleibt unverändert");
    assert.strictEqual(call.args[0].key, "SUP-1", "das Ticket steht weiter an erster Stelle");
    assert.strictEqual(typeof call.args[1].onChunk, "function", "onChunk wird wieder eingesetzt");
    assert.strictEqual(typeof call.args[1].onDownload, "function", "onDownload wird wieder eingesetzt");
    assert.ok(call.args[1].signal, "ein Abbruchsignal ist gesetzt");

    // Die Rückrufe müssen bei der App ankommen, nicht nur existieren.
    call.args[1].onChunk("Anliegen: …");
    call.args[1].onDownload(42);
    assert.deepStrictEqual(
      messagesOfType(env.sent, "sc-hud-ai-chunk").map((m) => [m.id, m.chunk]),
      [["ai-1", "Anliegen: …"]]
    );
    assert.deepStrictEqual(
      messagesOfType(env.sent, "sc-hud-ai-download").map((m) => [m.id, m.percent]),
      [["ai-1", 42]]
    );

    const result = messagesOfType(env.sent, "sc-hud-ai-result")[0];
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.result.text, "ok");
  }

  // --- KI ohne Options-Platz ----------------------------------------------
  {
    // capabilities() nimmt keine Optionen – dort darf auch keine angehängt
    // werden, sonst bekommt die Funktion ein Argument zu viel.
    const env = loadAgent();
    env.receive({ type: "sc-hud-ai", id: "ai-2", method: "capabilities", args: [] });
    await env.settle();

    const call = env.aiCalls.find((entry) => entry.method === "capabilities");
    assert.deepStrictEqual(call.args, [], "capabilities bleibt ohne Argumente");
  }

  // --- KI: unbekannte Aufgabe ---------------------------------------------
  {
    const env = loadAgent();
    env.receive({ type: "sc-hud-ai", id: "ai-3", method: "gibtesnicht", args: [{}] });
    await env.settle();

    const result = messagesOfType(env.sent, "sc-hud-ai-result")[0];
    assert.strictEqual(result.ok, false, "unbekannte Aufgaben werden abgelehnt");
    assert.match(result.error, /gibtesnicht/, "die Fehlermeldung benennt die Aufgabe");
  }

  // --- KI: Abbruch ---------------------------------------------------------
  {
    let capturedSignal = null;
    const env = loadAgent({
      localAi: {
        summarize: (ticket, opts) => {
          capturedSignal = opts.signal;
          return new Promise((resolve, reject) => {
            opts.signal.addEventListener("abort", () => {
              const error = new Error("Abgebrochen");
              error.name = "AbortError";
              reject(error);
            });
          });
        }
      }
    });

    env.receive({ type: "sc-hud-ai", id: "ai-4", method: "summarize", args: [TICKET, {}] });
    await env.settle();
    assert.ok(capturedSignal && !capturedSignal.aborted, "die Aufgabe läuft");

    env.receive({ type: "sc-hud-ai-abort", id: "ai-4" });
    await env.settle();
    assert.ok(capturedSignal.aborted, "das Signal wurde ausgelöst");

    const result = messagesOfType(env.sent, "sc-hud-ai-result")[0];
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.aborted, true, "der Abbruch wird als solcher gemeldet, nicht als Fehler");
  }

  console.log("hud-agent.test.js: alle Szenarien bestanden.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
