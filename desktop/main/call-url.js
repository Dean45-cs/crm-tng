"use strict";

// Die Anruf-URL aus myApps lesen.
//
// Eigene Datei, weil das die einzige Stelle der Anlagen-Anbindung ist, die man
// ohne laufendes Fenster prüfen kann – und weil sie Eingaben von außen
// entgegennimmt: was hier hereinkommt, hat ein fremdes Programm geschrieben.
// Alles, was nicht eindeutig eine Anruf-Meldung ist, muss hier ausscheiden und
// nicht erst im Panel.
//
// Form: stadtnetzcrm://call?id=$c&nr=$I&name=$d
//
// Die Platzhalter setzt myApps ein (Einstellungen · Externe Anwendungen):
//   $n Rufnummer roh · $N national · $I international (+49…) · $u URI
//   $d Displayname   · $c Conference-ID (globale ID für den Anruf)
//
// Dazu zwei eigene, die myApps nicht kennt und die deshalb von Hand in die
// Adresse geschrieben werden, wenn es sie braucht:
//   dir=in|out  Richtung, falls myApps getrennte Aktionen für ankommend und
//               abgehend anbietet. Ohne Angabe entscheidet der Schalter im Panel.
//   ev=ring|end Ereignisart. Ohne Angabe gilt der Anruf als laufend.

const PROTOCOL = "stadtnetzcrm";

// Was aus der Adresse übernommen wird. Alles andere wird verworfen: eine
// fremde Anwendung soll uns keine beliebigen Felder ins Panel schreiben können.
const KEYS = ["id", "nr", "name", "uri", "dir", "ev"];

// Ein Wert, der länger ist als das, kann keine Rufnummer und kein Name mehr
// sein – dann stimmt etwas nicht, und wir kürzen, statt es weiterzureichen.
const MAX_VALUE_LENGTH = 200;

/**
 * Die Query selbst auseinandernehmen, statt URLSearchParams zu fragen.
 *
 * DER GRUND, und er hat die halbe Kundenerkennung lahmgelegt: URLSearchParams
 * liest nach den Regeln von HTML-Formularen, und dort steht ein „+" für ein
 * Leerzeichen. myApps setzt für $I aber eine echte internationale Nummer ein:
 *
 *   nr=+4917645874682   →   searchParams.get("nr")   →   " 4917645874682"
 *
 * Das Plus war weg, das Leerzeichen fiel dem trim() zum Opfer, und übrig blieb
 * eine Nummer, die wie eine nationale aussieht. shared.phoneKey() entscheidet
 * genau an diesem Plus, ob die Landesvorwahl abzuschneiden ist – aus
 * „+4917645874682" wird der Schlüssel 17645874682, aus „4917645874682" der
 * Schlüssel 4917645874682. Zwei verschiedene Kunden, so gesehen. Deshalb fand
 * customer_by_phone() nie etwas, und deshalb passte auch der vorgemerkte
 * Wählvorgang nie zur Meldung der Anlage – samt falscher Richtung.
 *
 * Aufgefallen ist es lange nicht, weil die Anleitung zum Prüfen von Hand die
 * Nummer als %2B… schreibt. So kodiert kommt sie richtig an; nur genau so
 * schickt myApps sie eben nicht.
 *
 * Hier gilt deshalb: „+" ist ein Plus. Ein Leerzeichen steht als %20 in der
 * Adresse, und so schickt myApps es auch.
 */
function queryValues(search) {
  const values = Object.create(null);
  const text = String(search == null ? "" : search).replace(/^\?/, "");
  if (!text) return values;

  text.split("&").forEach((pair) => {
    if (!pair) return;
    const eq = pair.indexOf("=");
    const key = decodeValue(eq === -1 ? pair : pair.slice(0, eq));
    if (!key || values[key] !== undefined) return; // der erste Wert gewinnt
    values[key] = decodeValue(eq === -1 ? "" : pair.slice(eq + 1));
  });
  return values;
}

/**
 * Entschlüsseln, ohne an kaputter Kodierung zu scheitern. Ein einzelnes „%" im
 * Namen einer Firma ist kein Grund, den ganzen Anrufer wegzuwerfen – dann steht
 * eben der rohe Text da, gekürzt wie jeder andere Wert auch.
 */
function decodeValue(text) {
  try {
    return decodeURIComponent(text);
  } catch (error) {
    return text;
  }
}

/**
 * Liest eine Anruf-URL. Gibt null zurück, wenn es keine ist – hier landet
 * alles, was das System für unser Schema hält, auch Unfug.
 *
 * @param {string} raw
 * @param {number} [now] Zeitstempel, damit Tests nicht von der Uhr abhängen.
 * @returns {{receivedAt: number, id?: string, nr?: string, name?: string, uri?: string, dir?: string, ev?: string}|null}
 */
function parseCallUrl(raw, now) {
  const text = String(raw == null ? "" : raw).trim();
  if (!text.toLowerCase().startsWith(`${PROTOCOL}:`)) return null;

  let url;
  try {
    url = new URL(text);
  } catch (error) {
    return null;
  }

  // Der Hostname ist die Aktion. Andere heben wir uns auf, statt sie als Anruf
  // misszuverstehen – so bleibt Platz für spätere Zwecke desselben Schemas.
  if (url.hostname && url.hostname !== "call") return null;

  const values = queryValues(url.search);
  const call = { receivedAt: typeof now === "number" ? now : Date.now() };
  KEYS.forEach((key) => {
    const value = values[key];
    if (value == null) return;
    const trimmed = String(value).trim();
    if (!trimmed) return;
    call[key] = trimmed.slice(0, MAX_VALUE_LENGTH);
  });

  // Nicht ersetzte Platzhalter: myApps schreibt den Platzhalter unverändert
  // hinein, wenn es den Wert für diesen Anruf nicht kennt. Ein Anrufer namens
  // „$d" ist keiner – solche Felder gehören weg, sonst stünden sie später im
  // Cockpit und in der Anrufhistorie.
  KEYS.forEach((key) => {
    if (call[key] && /^\$[a-zA-Z]$/.test(call[key])) delete call[key];
  });

  // Ohne jede Angabe zum Anrufer ist es keine Meldung, sondern nur ein
  // Fensterwink – und den gibt es über andere Wege schon.
  if (!call.id && !call.nr && !call.name) return null;
  return call;
}

/**
 * Unter Windows/Linux kommt die URL nicht als Ereignis, sondern als eines der
 * Argumente des (zweiten) Programmaufrufs.
 */
function callUrlFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  return argv.find((arg) => String(arg == null ? "" : arg).trim().toLowerCase().startsWith(`${PROTOCOL}:`)) || null;
}

module.exports = { PROTOCOL, KEYS, parseCallUrl, callUrlFromArgv };
