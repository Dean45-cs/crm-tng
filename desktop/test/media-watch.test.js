"use strict";

// Test für main/media-watch.js – das Erkennen des Gesprächsendes.
//
// Die Prüfdaten sind ECHT: aufgenommen am 31.08.2026 mit
//   lsof -nP -a -p $(pgrep -x myapps) -i -F pcfnP
// im Ruhezustand und während zweier Testanrufe. Ausgedacht wäre hier wertlos —
// die ganze Erkennung steht und fällt damit, dass myApps im Leerlauf keinen
// einzigen UDP-Socket offen hat und beim Abheben welche aufmacht.
//
// Ausführen mit: node test/media-watch.test.js

const assert = require("assert");

const {
  parseLsof, parseNetstat, localPort, isMediaSocket, createMediaWatcher
} = require("../main/media-watch");

// --- Echte Ausgaben --------------------------------------------------------

// Ruhezustand: nur TCP. Die Listener 10008/10009 bedienen die eingebetteten
// Webviews von myApps, die 443er gehen zur Anlage (tng.my-phone.cloud).
const RUHE = [
  "p38707", "cmyapps",
  "f39", "PTCP", "n127.0.0.1:10008->127.0.0.1:64312",
  "f52", "PTCP", "n192.168.178.27:64313->213.158.101.123:443",
  "f53", "PTCP", "n192.168.178.27:64314->213.158.101.123:443",
  "f14", "PTCP", "n*:10008",
  "f15", "PTCP", "n*:10009"
].join("\n");

// Während des Gesprächs: dieselben TCP-Sockets, dazu sechs UDP – die Ports
// 50000/50001 über alle Adressen (LAN, VPN-Tunnel, IPv6). Genau diese Adressen
// standen in der Messung.
const IM_GESPRAECH = RUHE + "\n" + [
  "f96", "PUDP", "n*:50000",
  "f97", "PUDP", "n*:50001",
  "f98", "PUDP", "n192.168.178.27:50000",
  "f99", "PUDP", "n192.168.178.27:50001",
  "f100", "PUDP", "n10.255.4.111:50000",
  "f101", "PUDP", "n[2a00:12d0:ae4c:1201:c11:df1a:89a4:a6a5]:50001"
].join("\n");

function run() {
  // --- Das Auseinandernehmen der lsof-Ausgabe ------------------------------
  {
    const ruhe = parseLsof(RUHE);
    assert.strictEqual(ruhe.length, 5, "fünf Sockets im Ruhezustand");
    assert.ok(ruhe.every((s) => s.proto === "TCP"), "im Ruhezustand ist alles TCP");
    assert.strictEqual(ruhe[0].name, "127.0.0.1:10008->127.0.0.1:64312");

    const gespraech = parseLsof(IM_GESPRAECH);
    assert.strictEqual(gespraech.length, 11, "im Gespräch kommen sechs UDP dazu");
    assert.strictEqual(gespraech.filter((s) => s.proto === "UDP").length, 6);

    assert.deepStrictEqual(parseLsof(""), [], "leere Ausgabe");
    assert.deepStrictEqual(parseLsof(null), [], "gar keine Ausgabe");
    // Ein Feld ohne vorangehendes f gehört zu nichts und darf nicht anlanden.
    assert.deepStrictEqual(parseLsof("PUDP\nn*:50000"), [], "Felder ohne Socket");
  }

  // --- Das Merkmal ---------------------------------------------------------
  {
    const ruhe = parseLsof(RUHE);
    assert.strictEqual(ruhe.some(isMediaSocket), false,
      "DER entscheidende Fall: im Ruhezustand sieht nichts nach Gespräch aus");

    const gespraech = parseLsof(IM_GESPRAECH);
    assert.strictEqual(gespraech.some(isMediaSocket), true, "im Gespräch schon");

    assert.strictEqual(localPort("192.168.178.27:50000"), "50000");
    assert.strictEqual(localPort("[2a00:12d0::a6a5]:50001"), "50001");
    assert.strictEqual(localPort("10.128.200.67:63026->17.248.213.64:443"), "63026",
      "bei einer verbundenen Adresse zählt die eigene Seite");
    assert.strictEqual(localPort(""), "");

    assert.strictEqual(isMediaSocket({ proto: "UDP", name: "*:53" }), false,
      "ein Namensauflöser ist kein Gespräch");
    assert.strictEqual(isMediaSocket({ proto: "UDP", name: "*:5353" }), false, "mDNS auch nicht");
    assert.strictEqual(isMediaSocket(null), false);
  }

  // --- Windows ------------------------------------------------------------
  {
    // Nachgebildete Ausgabe von `netstat -ano -p UDP`, mit deutscher
    // Überschrift – nach der wird ausdrücklich nicht gesucht.
    const netstat = [
      "",
      "Aktive Verbindungen",
      "",
      "  Proto  Lokale Adresse         Remoteadresse          Status           PID",
      "  UDP    0.0.0.0:50000          *:*                                     4711",
      "  UDP    0.0.0.0:50001          *:*                                     4711",
      "  UDP    0.0.0.0:5353           *:*                                     1234",
      "  TCP    127.0.0.1:10008        0.0.0.0:0              ABHÖREN          4711"
    ].join("\r\n");

    const meine = parseNetstat(netstat, 4711);
    assert.strictEqual(meine.length, 3, "nur die Sockets der eigenen PID");
    assert.strictEqual(meine.filter(isMediaSocket).length, 2,
      "die beiden Medien-Ports, nicht der TCP-Listener");
    assert.strictEqual(parseNetstat(netstat, 9999).length, 0, "fremde PID: nichts");
  }

  // --- Der Wächter: Entprellung -------------------------------------------
  {
    const gesehen = [];
    const wächter = createMediaWatcher({ onChange: (s) => gesehen.push(s), stableTicks: 3 });

    wächter.settle("media");
    wächter.settle("media");
    assert.deepStrictEqual(gesehen, [], "zwei Messungen genügen noch nicht");
    wächter.settle("media");
    assert.deepStrictEqual(gesehen, ["media"], "die dritte macht es zur Tatsache");
    assert.strictEqual(wächter.state(), "media");

    // Ein einzelner Aussetzer darf kein Auflegen sein.
    wächter.settle("idle");
    wächter.settle("media");
    wächter.settle("idle");
    wächter.settle("idle");
    assert.deepStrictEqual(gesehen, ["media"], "der Zähler beginnt nach dem Aussetzer von vorn");
    wächter.settle("idle");
    assert.deepStrictEqual(gesehen, ["media", "idle"], "drei gleiche Messungen: aufgelegt");
  }

  // --- Eine misslungene Messung ist kein Auflegen --------------------------
  {
    const gesehen = [];
    const wächter = createMediaWatcher({ onChange: (s) => gesehen.push(s), stableTicks: 3 });
    ["media", "media", "media"].forEach(wächter.settle);
    assert.deepStrictEqual(gesehen, ["media"]);

    wächter.settle("unknown");
    assert.deepStrictEqual(gesehen, ["media", "unknown"],
      "unbekannt gilt sofort – aber es ist ausdrücklich NICHT idle, und call-session.js beendet daran kein Gespräch");
  }

  // --- Der ganze Weg: messen, einsortieren, melden -------------------------
  {
    const gesehen = [];
    let ausgabe = RUHE;
    const wächter = createMediaWatcher({
      probe: async () => ({ ok: true, sockets: parseLsof(ausgabe) }),
      onChange: (s) => gesehen.push(s),
      stableTicks: 3
    });

    return (async () => {
      for (let i = 0; i < 3; i++) await wächter.tick();
      assert.deepStrictEqual(gesehen, ["idle"], "Ruhezustand erkannt");

      ausgabe = IM_GESPRAECH;
      for (let i = 0; i < 3; i++) await wächter.tick();
      assert.deepStrictEqual(gesehen, ["idle", "media"], "abgehoben");

      ausgabe = RUHE;
      for (let i = 0; i < 3; i++) await wächter.tick();
      assert.deepStrictEqual(gesehen, ["idle", "media", "idle"], "aufgelegt");

      // Eine Messung, die nicht zustande kommt.
      const blind = createMediaWatcher({
        probe: async () => { throw new Error("lsof nicht gefunden"); },
        onChange: (s) => gesehen.push(s)
      });
      await blind.tick();
      assert.strictEqual(blind.state(), "unknown", "geworfene Fehler ergeben unknown");

      const leer = createMediaWatcher({ probe: async () => ({ ok: false }), onChange: () => {} });
      await leer.tick();
      assert.strictEqual(leer.state(), "unknown", "ok:false ergibt unknown, nicht idle");

      console.log("media-watch.test.js: alle Szenarien bestanden.");
    })();
  }
}

run();
