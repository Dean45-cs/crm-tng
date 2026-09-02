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

  // --- Das erkannte Gesprächsende ------------------------------------------
  //
  // DIE SICHERUNG, und der Grund, warum diese Erkennung überhaupt eingebaut
  // werden durfte: beendet wird nur, was vorher als laufend beobachtet wurde.
  {
    const env = makeSession();
    env.session.report({ id: "c-20", nr: "+4970310000000", name: "PK 182962 Daniel Ratcliffe" });
    await env.flush();

    // Ein „idle", bevor je Medien da waren, darf nichts tun. Genau so sieht es
    // auf einem Rechner aus, auf dem die Beobachtung gar nicht greift.
    assert.strictEqual(env.session.mediaState("idle"), null,
      "ohne je gesehene Medien beendet ein leerer Socket-Stand kein Gespräch");
    assert.strictEqual(env.ended.length, 0, "und schließt erst recht keine Zeile");
    assert.strictEqual(env.last().status, "connected", "das Gespräch läuft weiter");

    // Abgehoben. DER RÜCKGABEWERT ist hier das Entscheidende: er bedeutet
    // „das Gespräch ist beendet", und die Verdrahtung stellt daran den
    // Herzschlag ab. Gab er beim Auftauchen der Medien etwas zurück, hörte das
    // Auffrischen genau dann auf, wenn das Gespräch begann — und das Panel warf
    // den Anruf nach staleAfterMs (15 s) als verwaist weg. Ein laufendes
    // Gespräch endete nach rund zwanzig Sekunden von selbst.
    assert.strictEqual(env.session.mediaState("media"), null,
      "das Erkennen der Medien meldet KEIN Ende");
    assert.strictEqual(env.last().status, "connected", "und beendet auch nichts");

    env.advance(30000);
    assert.ok(env.session.mediaState("idle"), "nach gesehenen Medien beendet ihr Verschwinden das Gespräch");
    await env.flush();

    assert.strictEqual(env.last().status, "ended", "das Cockpit erfährt es über den Storage");
    assert.strictEqual(env.ended.length, 1, "die Zeile in der Historie wird genau einmal geschlossen");
    assert.strictEqual(env.ended[0].durationS, 30,
      "die Dauer zählt ab dem Gespräch, nicht ab dem Verschwinden des Sockets");

    const ende = env.events.filter((e) => e.type === "call-end").pop();
    assert.strictEqual(ende.reason, "aufgelegt-erkannt", "der Grund geht an die Einrichtungskarte");
    assert.strictEqual(ende.sawMedia, true);
  }

  // --- Der Herzschlag überlebt das Erkennen der Medien ----------------------
  //
  // Genau der Weg, den die Verdrahtung geht: solange mediaState() nichts
  // zurückgibt, läuft heartbeat() weiter und hält den Anruf im Panel frisch.
  {
    const env = makeSession();
    env.session.report({ id: "c-26", nr: "+4970310000000", name: "" });
    await env.flush();

    env.session.mediaState("media");
    for (let i = 0; i < 10; i++) {
      env.advance(4000);
      assert.strictEqual(env.session.heartbeat(), true,
        "der Herzschlag läuft nach dem Erkennen der Medien weiter");
    }
    assert.strictEqual(env.last().status, "connected",
      "nach 40 Sekunden läuft das Gespräch immer noch");
    assert.strictEqual(env.ended.length, 0, "und nichts wurde geschlossen");
  }

  // --- Eine misslungene Messung ist kein Auflegen --------------------------
  {
    const env = makeSession();
    env.session.report({ id: "c-21", nr: "+4970310000000", name: "" });
    await env.flush();
    env.session.mediaState("media");

    assert.strictEqual(env.session.mediaState("unknown"), null,
      "„nicht gemessen\u201c ist etwas anderes als „nichts gefunden\u201c");
    assert.strictEqual(env.last().status, "connected", "das Gespräch läuft weiter");
    assert.strictEqual(env.ended.length, 0);
  }

  // --- Von außen unterbrochen ----------------------------------------------
  //
  // Anders als der Medien-Socket braucht das keinen Beweis: bei gesperrtem
  // Bildschirm spricht niemand mehr, auch wenn nie Medien beobachtet wurden.
  {
    const env = makeSession();
    env.session.report({ id: "c-22", nr: "+4970310000000", name: "" });
    await env.flush();
    env.advance(12000);

    assert.ok(env.session.interrupted("gesperrt"), "der gesperrte Bildschirm beendet das Gespräch");
    await env.flush();
    assert.strictEqual(env.ended.length, 1);
    const ende = env.events.filter((e) => e.type === "call-end").pop();
    assert.strictEqual(ende.reason, "gesperrt");
    assert.strictEqual(ende.sawMedia, false, "und zwar ausdrücklich ohne je Medien gesehen zu haben");

    assert.strictEqual(env.session.interrupted("gesperrt"), null,
      "ein zweites Mal schließt nichts nach");
  }

  // --- Medien gehören zu genau einem Gespräch -------------------------------
  //
  // Sonst erbte der nächste Anruf die Beobachtung des vorigen und ließe sich
  // sofort von einem einzigen leeren Socket-Stand beenden.
  {
    const env = makeSession();
    env.session.report({ id: "c-23", nr: "+4970310000000", name: "" });
    await env.flush();
    env.session.mediaState("media");

    env.advance(5000);
    env.session.report({ id: "c-24", nr: "+4970311111111", name: "" });
    await env.flush();
    assert.strictEqual(env.ended.length, 1, "der neue Anruf schließt den alten");

    assert.strictEqual(env.session.mediaState("idle"), null,
      "der neue Anruf beginnt ohne gesehene Medien – und endet daran nicht");
    assert.strictEqual(env.last().status, "connected");
  }

  // --- Die Gründe der übrigen Wege ------------------------------------------
  {
    const env = makeSession();
    env.session.report({ id: "c-25", nr: "+4970310000000", name: "" });
    await env.flush();
    env.session.finish();
    await env.flush();
    assert.strictEqual(env.events.filter((e) => e.type === "call-end").pop().reason, "von-hand",
      "ohne Angabe gilt das Gespräch als von Hand beendet");
  }

  // --- Der Kunde geht nicht ran ---------------------------------------------
  //
  // DER FALL, den die Sicherung zuerst kaputt gemacht hat: „beende nie ein
  // Gespräch, für das nie Medien da waren" heißt bei einem nicht angenommenen
  // Anruf, dass er NIE endet — der Wächter meldet einmal „idle" und danach
  // nichts mehr, weil sich nichts ändert. Der Anruf lief bis zur
  // Zwei-Stunden-Grenze weiter.
  {
    const env = makeSession();
    env.session.report({ id: "c-30", nr: "+4970310000000", name: "" });
    await env.flush();

    // Die Messung arbeitet und findet nichts: es klingelt.
    env.session.mediaState("idle");
    assert.strictEqual(env.last().status, "connected", "solange es klingeln kann, läuft der Anruf");

    // Kurz vor der Grenze passiert noch nichts.
    env.advance(env.session.RING_TIMEOUT_MS - 1000);
    assert.strictEqual(env.session.heartbeat(), true, "eine Sekunde vorher läuft er noch");
    assert.strictEqual(env.ended.length, 0);

    // Danach steht fest: es hat niemand abgenommen.
    env.advance(2000);
    assert.strictEqual(env.session.heartbeat(), false, "der Herzschlag hört auf");
    await env.flush();
    assert.strictEqual(env.last().status, "ended", "und der Anruf ist beendet");
    assert.strictEqual(env.ended.length, 1);

    const ende = env.events.filter((e) => e.type === "call-end").pop();
    assert.strictEqual(ende.reason, "nicht-abgenommen");
    assert.strictEqual(ende.sawMedia, false);
  }

  // --- Ohne arbeitende Messung wird nichts beendet --------------------------
  //
  // Die Sicherung bleibt: auf einem Rechner, auf dem die Erkennung nicht
  // greift, kommt nie ein „idle" an — und dann darf auch die Klingelgrenze
  // nichts beenden, sonst verschwände mitten im Gespräch die Kundenakte.
  {
    const env = makeSession();
    env.session.report({ id: "c-31", nr: "+4970310000000", name: "" });
    await env.flush();

    env.advance(env.session.RING_TIMEOUT_MS * 3);
    assert.strictEqual(env.session.heartbeat(), true,
      "ohne je gemessen zu haben, bleibt alles wie vorher");
    assert.strictEqual(env.ended.length, 0);
  }

  // --- Wer abgenommen hat, fällt nicht unter die Klingelgrenze --------------
  {
    const env = makeSession();
    env.session.report({ id: "c-32", nr: "+4970310000000", name: "" });
    await env.flush();
    env.session.mediaState("media");

    env.advance(env.session.RING_TIMEOUT_MS * 2);
    assert.strictEqual(env.session.heartbeat(), true,
      "ein langes Gespräch ist kein nicht angenommener Anruf");
    assert.strictEqual(env.ended.length, 0);
  }

  // --- Das Protokoll von myApps: die beiden echten Anrufe vom 02.09.2026 ----
  //
  // Nachgestellt mit den Zeitabständen aus der Messung. Das ist der Fall, den
  // der Medien-Socket NICHT unterscheiden konnte: beide Anrufe sahen dort
  // gleich aus.
  {
    // Anruf B: geklingelt 5 s, abgehoben, 19 s gesprochen.
    const env = makeSession();
    env.session.report({ id: "d42162673e0f438f8284941b75dec414", nr: "+4917645874682", name: "" });
    await env.flush();

    env.advance(5000);
    env.session.traceEvent({ kind: "connected", id: "d42162673e0f438f8284941b75dec414", at: T0 + 5000 });
    assert.strictEqual(env.last().status, "connected");

    env.advance(19000);
    assert.ok(env.session.traceEvent({ kind: "ended", id: "d42162673e0f438f8284941b75dec414", at: T0 + 24000 }));
    await env.flush();

    assert.strictEqual(env.ended[0].durationS, 19,
      "die Dauer zählt ab dem Abheben – die fünf Sekunden Klingeln gehören nicht dazu");
    assert.strictEqual(env.ended[0].answered, true, "abgehoben, und das ist eine Feststellung");
    assert.ok(env.ended[0].connectedAt, "der Verbindungszeitpunkt wird festgehalten");
    assert.strictEqual(env.events.filter((e) => e.type === "call-end").pop().reason, "aufgelegt");
  }

  {
    // Anruf A: geklingelt 10 s, NIE abgenommen.
    const env = makeSession();
    env.session.report({ id: "cb3282c88358461888c4247a905412a8", nr: "+4917645874682", name: "" });
    await env.flush();

    env.advance(10000);
    assert.ok(env.session.traceEvent({ kind: "ended", id: "cb3282c88358461888c4247a905412a8", at: T0 + 10000 }));
    await env.flush();

    assert.strictEqual(env.ended[0].answered, false,
      "ohne 'connected' wurde nachweislich nicht abgenommen");
    assert.strictEqual(env.ended[0].connectedAt, null, "und es gibt keinen Verbindungszeitpunkt");
    assert.strictEqual(env.events.filter((e) => e.type === "call-end").pop().reason, "nicht-abgenommen");
  }

  // --- Ein Ereignis zu einem ANDEREN Anruf geht uns nichts an ---------------
  //
  // Ohne den Vergleich der Conference-ID beendete ein Auflegen auf einer
  // zweiten Leitung das laufende Gespräch.
  {
    const env = makeSession();
    env.session.report({ id: "aaaa1111", nr: "+4970310000000", name: "" });
    await env.flush();
    assert.strictEqual(env.session.traceEvent({ kind: "ended", id: "bbbb2222", at: T0 + 5000 }), null);
    assert.strictEqual(env.ended.length, 0, "der fremde Anruf lässt unseren in Ruhe");
    assert.strictEqual(env.last().status, "connected");
  }

  // --- Spricht das Protokoll, schweigt der Socket ---------------------------
  //
  // Beide Quellen gleichzeitig wirken zu lassen, hieße dem Socket zu erlauben,
  // ein noch klingelndes Gespräch zu beenden – genau das, was er nicht kann.
  {
    const env = makeSession();
    env.session.report({ id: "cccc3333", nr: "+4970310000000", name: "" });
    await env.flush();

    env.session.mediaState("media");
    env.session.traceEvent({ kind: "alerting", id: "cccc3333", at: T0 });

    assert.strictEqual(env.session.mediaState("idle"), null,
      "der Socket beendet nichts mehr, sobald das Protokoll für diesen Anruf spricht");
    assert.strictEqual(env.ended.length, 0);

    // Das Protokoll beendet es dann sauber.
    env.advance(8000);
    assert.ok(env.session.traceEvent({ kind: "ended", id: "cccc3333", at: T0 + 8000 }));
  }

  // --- Ohne Protokoll bleibt die Erreichbarkeit ausdrücklich unbekannt ------
  {
    const env = makeSession();
    env.session.report({ id: "dddd4444", nr: "+4970310000000", name: "" });
    await env.flush();
    env.session.mediaState("media");
    env.advance(20000);
    env.session.mediaState("idle");
    await env.flush();

    assert.strictEqual(env.ended[0].answered, null,
      "ohne Protokoll wird nichts behauptet – null heißt nicht gemessen, nicht 'nicht abgenommen'");
    assert.strictEqual(env.ended[0].connectedAt, null);
  }

  console.log("call-session.test.js: alle Prüfungen bestanden");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
