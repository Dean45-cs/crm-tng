"use strict";

// Test für main/call-trace.js — den Gesprächsverlauf aus dem Protokoll von myApps.
//
// Die Prüfzeilen sind ECHT: aufgenommen am 02.09.2026 mit festgehaltener
// Bodenwahrheit — ein Anruf wurde absichtlich nicht angenommen, einer schon.
// Ausgedacht wäre hier wertlos, denn genau die Unterscheidung zwischen diesen
// beiden Fällen ist der einzige Grund, warum es diese Datei gibt.
//
// Ausführen mit: node test/call-trace.test.js

const assert = require("assert");
const { parseTraceLine, parseTraceChunk, createTraceCursor } = require("../main/call-trace");

// Anruf A: gewählt, geklingelt, NIE angenommen, aufgelegt.
const A_ALERT = "2026-09-02 11:22:29.764 myapps[77778:3218089] SignalingApp::ReportOutgoingCallAlerting cb3282c88358461888c4247a905412a8 ignoreCallkit 0";
const A_END = "2026-09-02 11:22:40.041 myapps[77778:3218089] SignalingApp::ReportCallEnded uuid: cb3282c88358461888c4247a905412a8 reason: 2 ignoreCallkit: 0 reconnectUuid: ()";

// Anruf B: gewählt, geklingelt, ABGENOMMEN, gesprochen, aufgelegt.
const B_ALERT = "2026-09-02 11:23:09.338 myapps[77778:3218089] SignalingApp::ReportOutgoingCallAlerting d42162673e0f438f8284941b75dec414 ignoreCallkit 0";
const B_CONN = "2026-09-02 11:23:14.635 myapps[77778:3218089] SignalingApp::ReportCallConnected uuid: d42162673e0f438f8284941b75dec414 connected: true ignoreCallkit:0";
const B_END = "2026-09-02 11:23:33.670 myapps[77778:3218089] SignalingApp::ReportCallEnded uuid: d42162673e0f438f8284941b75dec414 reason: 2 ignoreCallkit: 0 reconnectUuid: ()";

function run() {
  // --- Die drei Ereignisarten ----------------------------------------------
  {
    const alert = parseTraceLine(B_ALERT);
    assert.strictEqual(alert.kind, "alerting");
    assert.strictEqual(alert.id, "d42162673e0f438f8284941b75dec414",
      "die uuid IST die Conference-ID aus $c – daran hängt die Zuordnung zum Anruf");

    const conn = parseTraceLine(B_CONN);
    assert.strictEqual(conn.kind, "connected", "DAS ist der Moment des Abhebens");

    const end = parseTraceLine(B_END);
    assert.strictEqual(end.kind, "ended");
    assert.strictEqual(end.reason, "2");
  }

  // --- Die Zeitstempel stimmen und ergeben die echte Gesprächsdauer ---------
  {
    const conn = parseTraceLine(B_CONN);
    const end = parseTraceLine(B_END);
    const alert = parseTraceLine(B_ALERT);
    assert.strictEqual(Math.round((end.at - conn.at) / 1000), 19,
      "Gesprächsdauer ab dem Abheben");
    assert.strictEqual(Math.round((conn.at - alert.at) / 1000), 5,
      "und davor fünf Sekunden Klingeln, die nicht mitzählen dürfen");
  }

  // --- DER FALL, um den es geht: nie angenommen ----------------------------
  {
    const folge = parseTraceChunk([A_ALERT, A_END].join("\n"));
    assert.deepStrictEqual(folge.map((e) => e.kind), ["alerting", "ended"],
      "kein 'connected' dazwischen – der Anruf wurde nie angenommen");
    // Genau daran, und nur daran, ist es zu erkennen. Am Medien-Socket sah
    // dieser Anruf aus wie ein angenommener.
  }

  // --- Was nicht verstanden wird, wird verworfen ---------------------------
  //
  // Das ist ein internes Protokollformat. Bei allem Unklaren lieber nichts
  // melden, damit der Weg von vorher greift, statt etwas zu erfinden.
  {
    assert.strictEqual(parseTraceLine(""), null);
    assert.strictEqual(parseTraceLine(null), null);
    assert.strictEqual(
      parseTraceLine("2026-09-02 11:23:31.169 myapps[77778:3218089] 33ca4800/4:SignalingCall::ChangeState 5->7"),
      null, "die tiefer liegenden Zustandszeilen tragen keine uuid und werden nicht verwendet");
    assert.strictEqual(
      parseTraceLine("2026-09-02 11:23:33.671 myapps[1:2] Turn(0xa3310f4d0)::releaseAllocation state=8"),
      null, "Rauschen");
    assert.strictEqual(
      parseTraceLine("2026-09-02 11:23:14.635 myapps[1:2] SignalingApp::ReportIrgendwasNeues abc123 …"),
      null, "eine unbekannte Meldung wird verworfen, nicht geraten");
    assert.strictEqual(
      parseTraceLine("2026-09-02 11:23:14.635 myapps[1:2] SignalingApp::ReportCallConnected uuid: zzzz connected: true"),
      null, "eine uuid, die keine ist");
    assert.strictEqual(
      parseTraceLine("SignalingApp::ReportCallEnded uuid: cb3282c88358461888c4247a905412a8 reason: 2"),
      null, "ohne Zeitstempel ist das Ereignis wertlos");
  }

  // --- „connected: false" ist kein Abheben ---------------------------------
  {
    assert.strictEqual(
      parseTraceLine("2026-09-02 11:23:14.635 myapps[1:2] SignalingApp::ReportCallConnected uuid: d42162673e0f438f8284941b75dec414 connected: false ignoreCallkit:0"),
      null, "das Format kennt auch false – das darf nicht als Gespräch gelten");
  }

  // --- Ein ganzer Abschnitt, wie er beim Nachlesen anfällt ------------------
  {
    const roh = [
      "2026-09-02 11:23:08.110 myapps[77778:3218089] 33ca4800/4:SignalingCall::ChangeState 0->1",
      B_ALERT,
      "2026-09-02 11:23:10.206 myapps[77778:3218089] 32bead00/3:SignalingRccCall::MonitorRecv(type=facility)",
      B_CONN,
      "2026-09-02 11:23:33.672 myapps[77778:3218089] MediaChannel(0xa33110000)::TurnReleased RTP",
      B_END,
      ""
    ].join("\n");
    const events = parseTraceChunk(roh);
    assert.deepStrictEqual(events.map((e) => e.kind), ["alerting", "connected", "ended"],
      "aus dem Rauschen bleiben genau die drei Ereignisse übrig");
    assert.ok(events.every((e) => e.id === "d42162673e0f438f8284941b75dec414"));
    assert.deepStrictEqual(parseTraceChunk(""), []);
  }

  // --- Der Lesezeiger: hier sitzt die Zuverlässigkeit ----------------------
  //
  // Jeder Fall hier verliert im Fehlerfall STILL ein Ereignis. Ein verlorenes
  // „connected" heißt ein Gespräch, das als nicht angenommen in der Auswertung
  // landet — und niemand meldet das, weil es niemand sieht.

  // Beim Start ans Ende springen: die Vergangenheit der Datei ist nicht unser Anruf.
  {
    const c = createTraceCursor();
    c.reset(50000);
    assert.strictEqual(c.plan(50000), null, "ohne Zuwachs gibt es nichts zu lesen");
    assert.deepStrictEqual(c.plan(50100), { from: 50000, to: 50100 }, "nur das Neue");
  }

  // NIE springen, auch nicht bei Rückstand.
  {
    const c = createTraceCursor({ maxChunk: 100 });
    c.reset(0);
    assert.deepStrictEqual(c.plan(1000), { from: 0, to: 100 },
      "höchstens ein Block je Runde");
    c.accept("", 100);
    assert.deepStrictEqual(c.plan(1000), { from: 100, to: 200 },
      "der Rest kommt beim nächsten Mal – übersprungen wird NICHTS");
  }

  // Rotation: myApps dreht trace.txt -> trace0.txt und fängt neu an.
  {
    const c = createTraceCursor();
    c.reset(900000);
    assert.deepStrictEqual(c.plan(1200), { from: 0, to: 1200 },
      "wird die Datei kürzer, wird von vorn gelesen");
    // Ohne diesen Fall liefe der Wächter ab der ersten Rotation für immer
    // scheinbar weiter und meldete nie wieder ein Ereignis.
  }

  // Halbe Zeile am Blockende: aufheben statt verwerfen.
  {
    const c = createTraceCursor();
    c.reset(0);
    const haelfte = B_CONN.slice(0, 40);
    assert.deepStrictEqual(c.accept(haelfte, 40), [],
      "eine angefangene Zeile ergibt noch nichts");
    const events = c.accept(B_CONN.slice(40) + "\n", 200);
    assert.strictEqual(events.length, 1, "beim nächsten Mal ist sie vollständig");
    assert.strictEqual(events[0].kind, "connected",
      "und das Abheben geht NICHT verloren, nur weil der Block dazwischen endete");
  }

  // Ein ganzer Anruf über drei Runden verteilt.
  {
    const c = createTraceCursor();
    c.reset(0);
    const alle = [];
    [B_ALERT + "\n", B_CONN + "\n", B_END + "\n"].forEach((teil, i) => {
      alle.push(...c.accept(teil, (i + 1) * 100));
    });
    assert.deepStrictEqual(alle.map((e) => e.kind), ["alerting", "connected", "ended"],
      "über mehrere Runden hinweg bleibt die Reihenfolge und nichts fehlt");
  }

  // Die Datei wird gelöscht und neu angelegt, während wir lesen.
  {
    const c = createTraceCursor();
    c.reset(5000);
    assert.strictEqual(c.plan(0), null, "eine leere Datei hat nichts zu bieten");
    assert.strictEqual(c.offset(), 0, "aber der Lesezeiger steht wieder vorn");
    assert.deepStrictEqual(c.plan(300), { from: 0, to: 300 }, "und liest, sobald sie wächst");
  }

  console.log("call-trace.test.js: alle Szenarien bestanden.");
}

run();
