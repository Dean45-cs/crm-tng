"use strict";

// Den Gesprächsverlauf aus dem Protokoll von myApps lesen.
//
// WARUM DAS SEIN MUSS, obwohl es schon eine Erkennung am Medien-Socket gibt:
// die Sockets können den Unterschied zwischen Klingeln und Sprechen nicht
// zeigen. Am 02.09.2026 mit festgehaltener Bodenwahrheit gemessen — ein Anruf,
// der NIE angenommen wurde, öffnete drei Sekunden nach dem Wählen dieselben
// Medien-Sockets wie ein angenommener, und im Moment des Abhebens passierte am
// Socket gar nichts. Das Freizeichen ist selbst eine Sprachverbindung. Damit
// waren Erreichbarkeit und echte Gesprächsdauer aus dem Socket nicht zu
// gewinnen, und das Auflegen nur mit Restrisiko.
//
// myApps weiß es dagegen genau und schreibt es auf. Aus derselben Messung:
//
//   11:22:29.764  ReportOutgoingCallAlerting cb3282…      es klingelt
//   11:22:40.041  ReportCallEnded uuid: cb3282… reason: 2 Ende — nie verbunden
//
//   11:23:09.338  ReportOutgoingCallAlerting d42162…      es klingelt
//   11:23:14.635  ReportCallConnected uuid: d42162…       ABGEHOBEN
//   11:23:33.670  ReportCallEnded uuid: d42162… reason: 2 aufgelegt
//
// DER SCHLÜSSEL: die uuid in diesen Zeilen IST die Conference-ID, die myApps
// als $c in die Anruf-Adresse einsetzt — im selben Versuch gegengeprüft gegen
// den externalId, den das Panel gespeichert hatte. Damit lässt sich jedes
// Ereignis genau dem Anruf zuordnen, um den es geht, ohne über Zeitnähe zu
// raten.
//
// WAS DAS KOSTET, und es steht bewusst hier: das ist ein internes
// Protokollformat, keine Schnittstelle. Ein myApps-Update kann es ändern, ohne
// dass jemand etwas ankündigt. Deshalb ist diese Datei so gebaut, dass sie bei
// allem, was sie nicht sicher versteht, NICHTS meldet — dann greift wieder der
// Weg von vorher (Knopf „Aufgelegt", nächster Anruf, Grenzen). Lieber keine
// Erkennung als eine falsche.
//
// Eingeschaltet wird die Protokollierung in myApps über die Trace-Kennzeichen
// (Maske 0x856000001, enthält Signaling). Ohne sie schreibt myApps diese Zeilen
// nicht, und hier kommt schlicht nie etwas an.

// Zeitstempel + irgendwo in der Zeile die Meldung. Absichtlich nicht auf die
// Spalten dazwischen festgelegt (PID, Thread-ID) – die ändern sich je Start.
const LINE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3}).*?SignalingApp::Report(\w+)\s+(?:uuid:\s*)?([0-9a-f]{32})(.*)$/;

/**
 * Aus dem Meldungsnamen die Art des Ereignisses. Unbekannte Namen ergeben null
 * und werden verworfen — myApps meldet über denselben Kanal auch Dinge, die uns
 * nichts angehen.
 */
function kindOf(verb, rest) {
  if (/Alerting$/.test(verb)) return "alerting";
  if (/CallConnected$/.test(verb)) {
    // „connected: false" gibt es laut Format; das wäre kein Abheben.
    if (/connected:\s*false/i.test(rest)) return null;
    return "connected";
  }
  if (/CallEnded$/.test(verb)) return "ended";
  return null;
}

/**
 * Eine Protokollzeile lesen.
 *
 * @param {string} line
 * @returns {{at: number, kind: "alerting"|"connected"|"ended", id: string, reason: string}|null}
 */
function parseTraceLine(line) {
  const match = String(line == null ? "" : line).match(LINE);
  if (!match) return null;

  const kind = kindOf(match[8], match[10] || "");
  if (!kind) return null;

  // myApps schreibt Ortszeit ohne Zonenangabe. Genau so wird sie hier gelesen —
  // der Rechner, der das Protokoll schreibt, ist derselbe, der es liest.
  const at = new Date(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6]), Number(match[7])
  ).getTime();
  if (!Number.isFinite(at)) return null;

  const reason = (match[10] || "").match(/reason:\s*(\d+)/);
  return { at, kind, id: match[9], reason: reason ? reason[1] : "" };
}

/**
 * Einen Abschnitt frisch angehängter Protokollzeilen lesen.
 * Gibt die verwertbaren Ereignisse in der Reihenfolge zurück, in der sie
 * aufgetreten sind.
 */
function parseTraceChunk(text) {
  return String(text == null ? "" : text)
    .split("\n")
    .map(parseTraceLine)
    .filter(Boolean);
}


/**
 * Der Lesezeiger auf der Protokolldatei.
 *
 * Eigene, fensterlose Einheit, weil hier die Zuverlässigkeit sitzt: Rotation,
 * Blockgrenzen und halbe Zeilen. Jeder dieser drei Fälle verliert im Fehlerfall
 * still ein Ereignis — und ein verlorenes „connected" heißt ein Gespräch, das
 * als nicht angenommen in der Auswertung landet. Genau solche Fehler meldet
 * niemand, weil man sie nicht sieht.
 *
 * Die Datei-Ein-/Ausgabe bleibt draußen (main.js); hier steht nur, WAS zu lesen
 * ist und was aus dem Gelesenen folgt.
 *
 * @param {object} [options]
 * @param {number} [options.maxChunk] Höchstmenge je Runde.
 */
function createTraceCursor(options) {
  const opts = options || {};
  const maxChunk = typeof opts.maxChunk === "number" && opts.maxChunk > 0
    ? opts.maxChunk
    : 512 * 1024;

  let offset = 0;
  let rest = "";

  /** Ans Ende springen: was vor diesem Anruf im Protokoll stand, geht uns nichts an. */
  function reset(size) {
    offset = Math.max(0, Number(size) || 0);
    rest = "";
  }

  /**
   * Was als Nächstes zu lesen ist, oder null.
   *
   * Wird die Datei KÜRZER als der Lesezeiger, hat myApps sie gedreht
   * (trace.txt → trace0.txt) und neu angefangen. Ohne diesen Fall läse man ab
   * der ersten Rotation für immer ins Leere — der Wächter liefe scheinbar, und
   * es käme nie wieder ein Ereignis.
   */
  function plan(size) {
    const end = Math.max(0, Number(size) || 0);
    if (end < offset) { offset = 0; rest = ""; }
    if (end === offset) return null;
    // NIE springen: höchstens maxChunk je Runde, der Rest beim nächsten Mal.
    // Ein Rückstand darf Zeilen verzögern, aber niemals überspringen.
    return { from: offset, to: Math.min(end, offset + maxChunk) };
  }

  /**
   * Einen gelesenen Abschnitt verarbeiten. `to` ist die Stelle, bis zu der
   * gelesen wurde — sie wird zum neuen Lesezeiger.
   *
   * Die letzte Zeile kann mitten im Schreiben abgeschnitten sein. Sie wird
   * aufgehoben und beim nächsten Mal vervollständigt, statt halb gelesen und
   * damit verworfen zu werden.
   */
  function accept(text, to) {
    offset = Math.max(offset, Number(to) || 0);
    const combined = rest + String(text == null ? "" : text);
    const lastBreak = combined.lastIndexOf("\n");
    if (lastBreak === -1) {
      rest = combined;
      return [];
    }
    rest = combined.slice(lastBreak + 1);
    return parseTraceChunk(combined.slice(0, lastBreak));
  }

  return { reset, plan, accept, offset: () => offset, maxChunk };
}

module.exports = { parseTraceLine, parseTraceChunk, createTraceCursor };
