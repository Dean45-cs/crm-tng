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

// Wie viele gleichlautende Messungen einen Wechsel ausmachen — und warum die
// beiden Richtungen NICHT gleich behandelt werden.
//
// Ein fälschlich erkanntes „Medien da" ist harmlos: es schaltet die
// Ende-Erkennung für dieses Gespräch nur scharf. Ein fälschlich erkanntes
// „Medien weg" beendet ein laufendes Gespräch — dem Menschen verschwindet
// mitten im Satz die Kundenakte vom Bildschirm. Die Schwellen folgen deshalb
// dem Schaden, nicht der Symmetrie.
const MEDIA_TICKS = 3;

// ZWEITE MESSUNG (02.09.2026), die die erste korrigiert hat: die Medien-Sockets
// verschwinden auch MITTEN in einer laufenden Sitzung und kommen wieder —
// beobachtet war eine Lücke von neun Sekunden, während die Fenster-Verbindungen
// von myApps durchgehend bestanden. Die erste Messung hatte nur saubere
// Übergänge gezeigt und mich zu drei Sekunden verleitet; damit hätte diese
// Lücke ein laufendes Gespräch beendet.
//
// Fünfzehn Sekunden überbrücken das mit Reserve. Der Preis ist, dass ein
// Auflegen erst nach ~15 s feststeht statt nach 3. Das ist die richtige
// Richtung des Irrtums: ein Gespräch, das zu spät endet, ist lästig; eines,
// das zu früh endet, kostet die Kundenakte im Gespräch.
const IDLE_TICKS = 15;

// Rückwärtskompatibler Name für die Tests und die Voreinstellung.
const STABLE_TICKS = MEDIA_TICKS;

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
    : MEDIA_TICKS;
  const idleTicks = typeof options.idleTicks === "number" && options.idleTicks > 0
    ? options.idleTicks
    : Math.max(stableTicks, IDLE_TICKS);

  let reported = "unknown";
  let candidate = null;
  let candidateCount = 0;
  // Wie viele Messungen hintereinander nichts ergeben haben. Für die
  // Einrichtungskarte: dauerhaft hohe Werte heißen, dass die Messung selbst
  // klemmt — und nicht, dass niemand telefoniert.
  let unknowns = 0;

  function classify(result) {
    // myApps läuft nicht mehr. Das ist keine misslungene Messung, sondern eine
    // Auskunft: ohne die App gibt es keine Sprachverbindung.
    if (result && result.gone) return "idle";
    if (!result || !result.ok || !Array.isArray(result.sockets)) return "unknown";
    return result.sockets.some(isMediaSocket) ? "media" : "idle";
  }

  /** Einen beobachteten Zustand einsortieren. Gibt zurück, ob sich etwas geändert hat. */
  function settle(observed) {
    // „unknown" ist KEIN Zustand, sondern das Ausbleiben einer Auskunft — und
    // wird deshalb übersprungen, statt einsortiert.
    //
    // DAS WAR EIN ECHTER FEHLER: vorher galt unknown sofort als neuer Zustand
    // und setzte den Zähler zurück. Läuft lsof gelegentlich ins Zeitlimit,
    // wechseln sich unknown und idle ab — und die drei aufeinanderfolgenden
    // idle-Messungen, die das Auflegen ausmachen, kommen nie zustande. Das
    // Gespräch bliebe stehen, ohne dass irgendwo ein Fehler aufliefe. Eine
    // misslungene Messung darf nichts auslösen, aber sie darf auch nicht
    // vergessen machen, was vorher schon gemessen wurde.
    if (observed === "unknown") {
      unknowns++;
      return false;
    }
    unknowns = 0;

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
    // „idle" muss länger anhalten als „media" – siehe IDLE_TICKS.
    if (candidateCount < (observed === "idle" ? idleTicks : stableTicks)) return false;

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
    unknownStreak: () => unknowns,
    reset: () => {
      reported = "unknown";
      candidate = null;
      candidateCount = 0;
      unknowns = 0;
    },
    STABLE_TICKS: stableTicks,
    IDLE_TICKS: idleTicks
  };
}

module.exports = {
  STABLE_TICKS,
  MEDIA_TICKS,
  IDLE_TICKS,
  parseLsof,
  parseNetstat,
  localPort,
  isMediaSocket,
  createMediaWatcher
};
