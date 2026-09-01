"use strict";

// Erkennen, ob gerade wirklich gesprochen wird — an den Sockets von myApps.
//
// WARUM ES DAS GIBT. myApps meldet einen Anruf genau einmal: die externe
// Anwendung wird laut innovaphones eigenem Code (PhoneCallExternalApplication.js)
// 100 ms nach Aufbau des Gesprächsfensters gestartet, und beim Auflegen räumt
// dieselbe Datei nur ihre Knöpfe weg. Ein Ereignis fürs Auflegen gibt es dort
// nicht — nachgesehen im ausgelieferten Code, nicht bloß im Wiki. Die Anlage
// selbst wüsste es (RCC-API, CallDel), aber daran soll nichts geändert werden.
//
// Bleibt: hinsehen. Ein Gespräch hinterlässt auf diesem Rechner eine Spur, die
// es ohne Gespräch nicht gibt.
//
// WAS GEMESSEN WURDE (31.08.2026, myApps auf macOS, zwei echte Testanrufe):
//
//   Ruhezustand      34 Sockets, davon 0 UDP  (Listener 10008/10009 für die
//                    eingebetteten Webviews, TLS-Verbindungen zur Anlage)
//   es klingelt      Gesprächsfenster geht auf — immer noch 0 UDP
//   abgehoben        6 UDP-Sockets, Ports 50000/50001 über alle Adressen
//   aufgelegt        wieder 0 UDP, ohne Verzug
//
// Zwei Dinge folgen daraus. Erstens ist „irgendein UDP-Socket" hier kein
// Rauschen, sondern ein Signal — es gibt im Leerlauf keines. Zweitens erscheint
// der Socket ERST BEIM ABHEBEN, nicht beim Klingeln: das ist der einzige
// verlässliche Zeitpunkt, ab dem tatsächlich gesprochen wird.
//
// WAS HIER NICHT ENTSCHIEDEN WIRD. Ob ein Gespräch beendet werden darf, steht
// in renderer/call-session.js — und zwar nur, wenn für dieses Gespräch vorher
// Medien gesehen wurden. Ein Anruf endet nie daran, dass etwas FEHLT, sondern
// nur daran, dass etwas Dagewesenes verschwindet. Wo die Beobachtung nicht
// greift, sieht sie nie ein „war da" und schaltet sich damit selbst ab.
//
// Und wie bei main/call-url.js gilt: keine Electron-Abhängigkeit, kein
// child_process, kein Timer. Alles kommt als Rückruf herein, damit man das hier
// ohne laufendes Fenster prüfen kann.

// So viele gleichlautende Messungen, bevor ein Wechsel gilt. Gemessen war der
// Übergang verzugsfrei — drei Messungen sind also nicht nötig, um ihn zu sehen,
// sondern um eine einzelne verunglückte Messung nicht für eine Tatsache zu
// halten. Bei einem Takt von 1 s heißt das: das Auflegen steht nach ~3 s fest.
const STABLE_TICKS = 3;

// UDP-Ziele, die nie eine Sprachverbindung sind. Heute macht myApps davon
// nichts – aber ein Namensauflöser im Programm soll nicht wie ein Gespräch
// aussehen, falls sich das einmal ändert.
const NON_MEDIA_PORTS = new Set(["53", "5353", "67", "68", "123", "1900", "3702"]);

/**
 * Die Ausgabe von `lsof -nP -a -p <pid> -i -F pcfnP` auseinandernehmen.
 *
 * Maschinenformat, zeilenweise: `p<pid>`, `c<befehl>`, dann je Socket `f<fd>`,
 * `P<protokoll>`, `n<adresse>`. Die Felder gehören zum zuletzt genannten `f`.
 */
function parseLsof(text) {
  const sockets = [];
  let current = null;

  String(text == null ? "" : text).split("\n").forEach((line) => {
    if (!line) return;
    const tag = line[0];
    const value = line.slice(1).trim();

    if (tag === "f") {
      current = { proto: "", name: "" };
      sockets.push(current);
      return;
    }
    if (!current) return;
    if (tag === "P") current.proto = value.toUpperCase();
    else if (tag === "n") current.name = value;
  });

  return sockets.filter((socket) => socket.proto && socket.name);
}

/**
 * Die Ausgabe von `netstat -ano -p UDP` auseinandernehmen, gefiltert auf eine PID.
 *
 * Bewusst nicht an den Überschriften entlang: die sind auf einem deutschen
 * Windows deutsch. Erkannt wird die Zeilenform – Protokoll vorn, PID hinten.
 */
function parseNetstat(text, pid) {
  const wanted = String(pid == null ? "" : pid).trim();
  const sockets = [];

  String(text == null ? "" : text).split("\n").forEach((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) return;
    const proto = parts[0].toUpperCase();
    if (proto !== "UDP" && proto !== "TCP") return;
    const owner = parts[parts.length - 1];
    if (!/^\d+$/.test(owner)) return;
    if (wanted && owner !== wanted) return;
    sockets.push({ proto, name: parts[1] });
  });

  return sockets;
}

/** Die lokale Portnummer aus `1.2.3.4:5060`, `*:50000` oder `[::1]:50000`. */
function localPort(name) {
  const local = String(name == null ? "" : name).split("->")[0];
  const match = local.match(/:(\d+)$/);
  return match ? match[1] : "";
}

/**
 * Ist dieser Socket eine Sprachverbindung?
 *
 * Die eine Stelle, an der das Merkmal steht – austauschbar, falls eine spätere
 * myApps-Fassung die Medien anders führt. Heute genügt „UDP", weil myApps im
 * Leerlauf gemessen keinen einzigen UDP-Socket offen hat.
 */
function isMediaSocket(socket) {
  if (!socket || socket.proto !== "UDP") return false;
  return !NON_MEDIA_PORTS.has(localPort(socket.name));
}

/**
 * Der Wächter. Fragt über `probe` nach den Sockets und meldet Wechsel weiter.
 *
 * `probe()` liefert `{ ok: boolean, sockets: [{proto, name}] }`. `ok: false`
 * heißt: die Messung ist nicht zustande gekommen (myApps nicht gefunden, lsof
 * fehlgeschlagen). Das ergibt „unknown" – und ausdrücklich NICHT „idle", denn
 * eine misslungene Messung ist kein Auflegen.
 *
 * @param {object} deps
 * @param {() => Promise<{ok: boolean, sockets: Array}>} deps.probe
 * @param {(state: "media"|"idle"|"unknown") => void} [deps.onChange]
 * @param {number} [deps.stableTicks]
 */
function createMediaWatcher(deps) {
  const options = deps || {};
  const probe = typeof options.probe === "function" ? options.probe : null;
  const onChange = typeof options.onChange === "function" ? options.onChange : function () {};
  const stableTicks = typeof options.stableTicks === "number" && options.stableTicks > 0
    ? options.stableTicks
    : STABLE_TICKS;

  let reported = "unknown";
  let candidate = null;
  let candidateCount = 0;

  function classify(result) {
    if (!result || !result.ok || !Array.isArray(result.sockets)) return "unknown";
    return result.sockets.some(isMediaSocket) ? "media" : "idle";
  }

  /** Einen beobachteten Zustand einsortieren. Gibt zurück, ob sich etwas geändert hat. */
  function settle(observed) {
    if (observed === reported) {
      candidate = null;
      candidateCount = 0;
      return false;
    }
    if (observed !== candidate) {
      candidate = observed;
      candidateCount = 1;
    } else {
      candidateCount++;
    }
    // „unknown" gilt sofort: dass wir nichts wissen, wissen wir sofort – und es
    // löst ohnehin nichts aus.
    const needed = observed === "unknown" ? 1 : stableTicks;
    if (candidateCount < needed) return false;

    reported = observed;
    candidate = null;
    candidateCount = 0;
    onChange(reported);
    return true;
  }

  /** Eine Runde: messen, einsortieren, melden. */
  async function tick() {
    if (!probe) return settle("unknown");
    try {
      return settle(classify(await probe()));
    } catch (error) {
      return settle("unknown");
    }
  }

  return {
    tick,
    settle,
    classify,
    state: () => reported,
    reset: () => {
      reported = "unknown";
      candidate = null;
      candidateCount = 0;
    },
    STABLE_TICKS: stableTicks
  };
}

module.exports = {
  STABLE_TICKS,
  parseLsof,
  parseNetstat,
  localPort,
  isMediaSocket,
  createMediaWatcher
};
