"use strict";

// Der Verlauf eines Gesprächs aus der Telefonanlage (renderer/call-session.js).
//
// Warum diese Datei mehr ist als Pflichtprogramm: die Anlage meldet EINMAL pro
// Anruf, und alles Weitere — Dauer, Status, Zeile in der Historie — leitet sich
// daraus ab. Jeder Fehler darin ist ein stiller: es steht dann nur etwas
// Falsches im Cockpit oder gar nichts in der Auswertung, aber nirgends eine
// Fehlermeldung. Genau solche Fälle stehen hier.
//
// Ausführen mit: node test/call-session.test.js

const assert = require("assert");
const { makePanelSandbox, loadScripts } = require("../../extension/test/support/stub-env");

const T0 = 1700000000000;

function makeSession(options) {
  const opts = options || {};
  const env = makePanelSandbox();
  loadScripts(env.sandbox, ["src/config.js", "src/shared.js", "../desktop/renderer/call-session.js"]);

  const published = [];
  const started = [];
  const ended = [];
  const events = [];
  let clock = T0;
  let dial = opts.pendingDial || null;
  let dialCleared = 0;

  const session = env.sandbox.StadtnetzCRM.createCallSession({
    now: () => clock,
    publish: (payload) => published.push(payload),
    startRow: (fields) => {
      started.push(fields);
      return Promise.resolve(opts.startFails ? { ok: false } : { ok: true, id: `row-${started.length}` });
    },
    endRow: (id, fields) => { ended.push({ id, ...fields }); return Promise.resolve({ ok: true }); },
    pendingDial: () => dial,
    clearPendingDial: () => { dialCleared += 1; dial = null; },
    defaultDirection: () => opts.direction || "outbound",
    onEvent: (event) => events.push(event)
  });

  return {
    session,
    published,
    started,
    ended,
    events,
    last: () => published[published.length - 1],
    advance(ms) { clock += ms; },
    dialCleared: () => dialCleared,
    // startRow antwortet als Promise – ohne das liefe die Prüfung auf die
    // Zeilen-ID vor der Antwort.
    flush: () => new Promise((resolve) => setImmediate(resolve))
  };
}

async function run() {
  // --- Der Normalfall: die Anlage kennt den Anrufer ------------------------
  {
    const env = makeSession();
    env.session.report({ id: "c-1", nr: "+4970310000000", name: "PK 182962 Daniel Ratcliffe" });
    await env.flush();

    const call = env.last();
    assert.strictEqual(call.status, "connected", "ohne ev gilt der Anruf als laufend");
    assert.strictEqual(call.callerName, "Daniel Ratcliffe",
      "der Anzeigename ist der reine Name – nicht der Rohstring mit Kürzel und Nummer");
    assert.strictEqual(call.customerNumber, "182962",
      "die Kundennummer steckt im Displaynamen und wird übernommen");
    assert.strictEqual(call.kundenart, "PK", "die Kundenart wandert mit");
    assert.strictEqual(call.source, "myapps", "die Herkunft steht drin, damit das Panel nicht raten muss");
    assert.strictEqual(env.started.length, 1, "genau eine Zeile in der Historie");
    assert.strictEqual(env.started[0].customerNumber, "182962",
      "die Zeile gehört von der ersten Sekunde an dem richtigen Kunden");
    assert.strictEqual(env.last().dbCallId, "row-1", "die Zeilen-ID kommt im Panel an");
    assert.strictEqual(env.events[0].recognized, true, "erkannt – die Einrichtungskarte zählt es");
  }

  // --- Unbekannter Anrufer: nichts erfinden --------------------------------
  {
    const env = makeSession();
    env.session.report({ id: "c-2", nr: "+4970310000000", name: "Daniel Ratcliffe" });
    await env.flush();
    assert.strictEqual(env.last().callerName, "Daniel Ratcliffe", "der Name bleibt der Name");
    assert.strictEqual(env.last().customerNumber, "",
      "ohne Kürzel-und-Nummer-Muster wird KEINE Kundennummer geraten");
    assert.strictEqual(env.events[0].recognized, false, "und das wird als „nicht erkannt“ gezählt");
  }

  // --- Klingeln bleibt Klingeln (der Herzschlag-Fehler) --------------------
  {
    const env = makeSession();
    env.session.report({ id: "c-3", nr: "+4970310000000", name: "PK 182962 Anna Weber", ev: "ring" });
    await env.flush();
    assert.strictEqual(env.last().status, "ringing", "ev=ring klingelt");
    assert.ok(!env.last().connectedAt, "beim Klingeln läuft noch keine Gesprächsdauer");

    env.advance(4000); env.session.heartbeat();
    env.advance(4000); env.session.heartbeat();
    assert.strictEqual(env.last().status, "ringing",
      "der Herzschlag frischt nur die Frische auf – er macht aus dem Klingeln KEIN Gespräch");

    // Das Abheben: die zweite Meldung zu derselben Kennung.
    env.advance(1000);
    env.session.report({ id: "c-3", nr: "+4970310000000", name: "PK 182962 Anna Weber" });
    assert.strictEqual(env.last().status, "connected", "die zweite Meldung ist das Abheben");
    assert.strictEqual(env.last().connectedAt, T0 + 9000, "ab da läuft die Dauer");
    assert.strictEqual(env.started.length, 1, "und es bleibt bei einer Zeile");
  }

  // --- Dieselbe Meldung mehrfach ------------------------------------------
  {
    const env = makeSession();
    env.session.report({ id: "c-4", nr: "+4970310000000", name: "PK 182962 Daniel Ratcliffe" });
    await env.flush();
    env.session.report({ id: "c-4", nr: "+4970310000000", name: "PK 182962 Daniel Ratcliffe" });
    env.session.report({ id: "c-4", nr: "+4970310000000", name: "PK 182962 Daniel Ratcliffe" });
    await env.flush();
    assert.strictEqual(env.started.length, 1,
      "die Conference-ID entscheidet: dreimal gemeldet ist trotzdem ein Anruf");
    assert.strictEqual(env.ended.length, 0, "und keiner davon beendet den laufenden");
  }

  // --- Das Ende: Anzeigetext und Sekundenzahl getrennt ---------------------
  {
    const env = makeSession();
    env.session.report({ id: "c-5", nr: "+4970310000000", name: "PK 182962 Daniel Ratcliffe" });
    await env.flush();
    env.advance(37000);
    env.session.finish();
    await env.flush();

    const call = env.last();
    assert.strictEqual(call.status, "ended");
    assert.strictEqual(call.finalDuration, "0:37",
      "finalDuration ist Anzeigetext – eine nackte 37 stünde im Gesprächskopf als „37“");
    assert.strictEqual(call.durationS, 37, "und daneben die Sekundenzahl für die Datenbank");
    assert.strictEqual(env.ended.length, 1, "die Zeile wird genau einmal geschlossen");
    assert.strictEqual(env.ended[0].durationS, 37);
    assert.strictEqual(env.ended[0].id, "row-1");
  }

  // --- „Aufgelegt“ im Panel ------------------------------------------------
  {
    const env = makeSession();
    env.session.report({ id: "c-6", nr: "+4970310000000", name: "PK 182962 Daniel Ratcliffe" });
    await env.flush();
    const callId = env.last().callId;

    env.advance(12000);
    const closed = env.session.endedByPanel({ callId, status: "ended", durationS: 12 });
    await env.flush();
    assert.ok(closed, "das Panel schließt das Gespräch");
    assert.strictEqual(env.ended.length, 1, "die Zeile wird geschlossen");
    assert.strictEqual(env.ended[0].durationS, 12, "mit der Dauer, die das Panel gemessen hat");
    assert.strictEqual(env.session.heartbeat(), false,
      "danach gibt es nichts mehr aufzufrischen – sonst stünde der Anruf gleich wieder auf „läuft“");

    // Ein zweites Auflegen darf nicht noch einmal schließen.
    assert.strictEqual(env.session.endedByPanel({ callId, status: "ended", durationS: 12 }), null);
    assert.strictEqual(env.ended.length, 1, "kein zweites Schließen derselben Zeile");
  }

  // --- Zugeordneter Kunde überlebt den Herzschlag --------------------------
  {
    const env = makeSession();
    env.session.report({ id: "c-7", nr: "+4970310000000", name: "Unbekannt" });
    await env.flush();
    const callId = env.last().callId;

    env.session.assignCustomer({ callId, customerNumber: "182962", customerName: "Daniel Ratcliffe" });
    assert.strictEqual(env.last().customerNumber, "182962", "die Zuordnung erscheint sofort");

    env.advance(4000);
    env.session.heartbeat();
    assert.strictEqual(env.last().customerNumber, "182962",
      "und der nächste Herzschlag putzt sie NICHT wieder weg");
    assert.strictEqual(env.last().callerName, "Daniel Ratcliffe");

    // Eine Zuordnung für ein anderes Gespräch geht ins Leere.
    env.session.assignCustomer({ callId: "fremd", customerNumber: "999999" });
    assert.strictEqual(env.last().customerNumber, "182962");
  }

  // --- Ein neuer Anruf beendet den vorherigen ------------------------------
  {
    const env = makeSession();
    env.session.report({ id: "c-8", nr: "+4970310000000", name: "PK 100001 Erster" });
    await env.flush();
    env.advance(60000);
    env.session.report({ id: "c-9", nr: "+4970310000001", name: "PK 100002 Zweiter" });
    await env.flush();

    assert.strictEqual(env.ended.length, 1, "der vorige wird geschlossen");
    assert.strictEqual(env.ended[0].durationS, 60);
    assert.strictEqual(env.started.length, 2, "und der neue bekommt eine eigene Zeile");
    assert.strictEqual(env.last().callerName, "Zweiter");
  }

  // --- Sicherheitsgrenze: kein Gespräch läuft zwei Stunden -----------------
  {
    const env = makeSession();
    env.session.report({ id: "c-10", nr: "+4970310000000", name: "PK 182962 Anna Weber" });
    await env.flush();

    env.advance(2 * 60 * 60 * 1000 + 1000);
    assert.strictEqual(env.session.heartbeat(), false, "der Herzschlag räumt ab");
    await env.flush();
    assert.strictEqual(env.last().status, "ended",
      "sonst bliebe der Anruf für immer in der Live-Anrufleiste des CRM stehen");
    assert.strictEqual(env.ended.length, 1);
  }

  // --- Testanruf: keine Spur in der Historie -------------------------------
  {
    const env = makeSession();
    env.session.report({ id: "probe", nr: "+4970310000000", name: "PK 182962 Daniel Ratcliffe", test: true });
    await env.flush();
    assert.strictEqual(env.last().test, true, "das Panel muss wissen, dass es ein Testanruf ist");
    assert.strictEqual(env.started.length, 0, "ein Selbsttest, der die Historie verschmutzt, wird nicht benutzt");

    env.advance(5000);
    env.session.finish();
    await env.flush();
    assert.strictEqual(env.ended.length, 0, "und schließt folglich auch nichts");
  }

  // --- Aus der Auskunft heraus gewählt -------------------------------------
  {
    const env = makeSession({
      direction: "inbound",
      pendingDial: { phoneKey: "7031000000", customerNumber: "182962", customerName: "Daniel Ratcliffe", at: T0 - 5000 }
    });
    env.session.report({ id: "c-11", nr: "+49 7031 000000", name: "" });
    await env.flush();

    const call = env.last();
    assert.strictEqual(call.likelyOutbound, true,
      "wer selbst gewählt hat, führt ein ausgehendes Gespräch – auch wenn die Voreinstellung anders lautet");
    assert.strictEqual(call.directionSource, "gewählt");
    assert.strictEqual(call.customerNumber, "182962",
      "und der Kunde steht fest, obwohl die Anlage ihn nicht erkannt hat");
    assert.strictEqual(env.dialCleared(), 1, "der Merkposten wird verbraucht");
  }

  // --- Ein alter Merkposten zieht nicht mehr -------------------------------
  {
    const env = makeSession({
      direction: "inbound",
      pendingDial: { phoneKey: "7031000000", customerNumber: "182962", at: T0 - 10 * 60 * 1000 }
    });
    env.session.report({ id: "c-12", nr: "+49 7031 000000", name: "" });
    await env.flush();
    assert.strictEqual(env.last().likelyOutbound, false,
      "ein zehn Minuten alter Wählvorgang ist nicht dieser Anruf – sonst gälte ein späterer Rückruf als ausgehend");
    assert.strictEqual(env.last().customerNumber, "");
    assert.strictEqual(env.dialCleared(), 1,
      "und er wird verworfen statt liegen gelassen – eine gespeicherte Rufnummer ohne Zweck bewahrt man nicht auf");
  }

  // --- Eine andere Nummer ist ein anderer Anruf ----------------------------
  {
    const env = makeSession({
      pendingDial: { phoneKey: "7031000000", customerNumber: "182962", at: T0 }
    });
    env.session.report({ id: "c-13", nr: "+49 7031 999999", name: "" });
    await env.flush();
    assert.strictEqual(env.last().customerNumber, "",
      "der Merkposten gilt nur für die Nummer, die auch gewählt wurde");
    assert.strictEqual(env.dialCleared(), 0, "und bleibt für den echten Anruf liegen");
  }

  // --- Die Zeile fehlt, das Gespräch läuft trotzdem ------------------------
  {
    const env = makeSession({ startFails: true });
    env.session.report({ id: "c-14", nr: "+4970310000000", name: "PK 182962 Daniel Ratcliffe" });
    await env.flush();
    assert.strictEqual(env.last().status, "connected",
      "ohne Supabase-Anmeldung gibt es keine Zeile – das Cockpit muss trotzdem stehen");
    assert.ok(!env.last().dbCallId);
    env.session.finish();
    await env.flush();
    assert.strictEqual(env.ended.length, 0, "und es wird nichts geschlossen, was nie geöffnet wurde");
  }

  console.log("call-session.test.js: alle Prüfungen bestanden");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
