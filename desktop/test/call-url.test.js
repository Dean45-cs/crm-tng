"use strict";

// Test für main/call-url.js – das Auswerten der Anruf-Meldung aus myApps.
//
// Das ist die Stelle, an der ein fremdes Programm in die App hineinschreibt:
// myApps öffnet bei einem Anruf eine Adresse, die wir gebaut haben, mit Werten,
// die wir nicht gebaut haben. Alles, was hier durchrutscht, landet unmittelbar
// im Cockpit und in der Anrufhistorie – deshalb wird hier geprüft und nicht
// erst dort.
//
// Ausführen mit: node test/call-url.test.js

const assert = require("assert");

const { parseCallUrl, callUrlFromArgv } = require("../main/call-url");

const NOW = 1700000000000;

function run() {
  // --- Der Normalfall ------------------------------------------------------
  {
    const call = parseCallUrl(
      "stadtnetzcrm://call?id=c-4711&nr=%2B4970310000000&name=Marta%20Willems", NOW);
    assert.ok(call, "eine vollständige Meldung wird angenommen");
    assert.strictEqual(call.id, "c-4711", "die Conference-ID kommt an");
    assert.strictEqual(call.nr, "+4970310000000", "das Plus der internationalen Nummer überlebt die URL");
    assert.strictEqual(call.name, "Marta Willems", "der Displayname kommt entschlüsselt an");
    assert.strictEqual(call.receivedAt, NOW, "der Zeitstempel ist übergebbar (sonst wäre der Test von der Uhr abhängig)");
  }

  // --- Was nicht von uns ist, wird abgewiesen ------------------------------
  {
    assert.strictEqual(parseCallUrl("https://example.com/?id=1", NOW), null, "fremdes Schema");
    assert.strictEqual(parseCallUrl("", NOW), null, "leer");
    assert.strictEqual(parseCallUrl(null, NOW), null, "gar nichts");
    assert.strictEqual(parseCallUrl("stadtnetzcrm://", NOW), null, "Schema ohne alles");
    assert.strictEqual(parseCallUrl("kein:// url ?? &", NOW), null, "Unfug");
    // Derselbe Draht soll später auch für anderes taugen – was nicht "call"
    // ist, darf nicht als Anruf durchgehen.
    assert.strictEqual(parseCallUrl("stadtnetzcrm://notiz?id=1", NOW), null, "andere Aktion");
  }

  // --- Eine Meldung ohne jede Angabe zum Anrufer ist keine ------------------
  {
    assert.strictEqual(parseCallUrl("stadtnetzcrm://call", NOW), null, "ohne Parameter");
    assert.strictEqual(parseCallUrl("stadtnetzcrm://call?dir=out", NOW), null,
      "nur eine Richtung, aber niemand am Apparat");
    assert.ok(parseCallUrl("stadtnetzcrm://call?nr=%2B49123", NOW), "die Nummer allein genügt");
    assert.ok(parseCallUrl("stadtnetzcrm://call?name=Unbekannt", NOW), "der Name allein genügt");
  }

  // --- Nicht ersetzte Platzhalter ------------------------------------------
  //
  // myApps setzt den Platzhalter unverändert ein, wenn es den Wert für diesen
  // Anruf nicht kennt. Stünde das so im Cockpit, hieße der Anrufer „$d" – und
  // genauso stünde es hinterher in der Anrufhistorie.
  {
    const call = parseCallUrl("stadtnetzcrm://call?id=c-1&nr=%24I&name=%24d", NOW);
    assert.ok(call, "die Meldung selbst bleibt gültig");
    assert.strictEqual(call.nr, undefined, "ein nicht ersetztes $I fällt weg");
    assert.strictEqual(call.name, undefined, "ein nicht ersetztes $d fällt weg");
    assert.strictEqual(call.id, "c-1", "der echte Wert bleibt");

    assert.strictEqual(parseCallUrl("stadtnetzcrm://call?nr=%24I&name=%24d", NOW), null,
      "bleibt nach dem Aussortieren nichts übrig, ist es keine Meldung mehr");
  }

  // --- Nur bekannte Felder --------------------------------------------------
  {
    const call = parseCallUrl("stadtnetzcrm://call?nr=%2B49123&boese=%3Cscript%3E&agent_id=fremd", NOW);
    assert.strictEqual(call.boese, undefined, "unbekannte Felder werden nicht übernommen");
    assert.strictEqual(call.agent_id, undefined, "auch dann nicht, wenn sie nach einer Spalte klingen");
    assert.deepStrictEqual(Object.keys(call).sort(), ["nr", "receivedAt"], "es bleibt genau das Erlaubte");
  }

  // --- Überlange Werte ------------------------------------------------------
  {
    const call = parseCallUrl(`stadtnetzcrm://call?nr=%2B49&name=${"a".repeat(500)}`, NOW);
    assert.ok(call.name.length <= 200, "ein absurd langer Name wird gekürzt statt weitergereicht");
  }

  // --- Richtung und Ereignisart --------------------------------------------
  {
    assert.strictEqual(parseCallUrl("stadtnetzcrm://call?nr=1&dir=out", NOW).dir, "out");
    assert.strictEqual(parseCallUrl("stadtnetzcrm://call?nr=1&ev=end", NOW).ev, "end");
    assert.strictEqual(parseCallUrl("stadtnetzcrm://call?nr=1", NOW).dir, undefined,
      "ohne Angabe bleibt die Richtung offen – dann entscheidet der Schalter im Panel");
  }

  // --- Groß-/Kleinschreibung des Schemas -----------------------------------
  //
  // Windows reicht die URL so weiter, wie sie eingetragen wurde.
  {
    assert.ok(parseCallUrl("StadtnetzCRM://call?nr=%2B49123", NOW), "Schema case-insensitiv");
  }

  // --- Aus den Programmargumenten ------------------------------------------
  {
    assert.strictEqual(
      callUrlFromArgv(["/pfad/zur/app", "--irgendwas", "stadtnetzcrm://call?nr=1"]),
      "stadtnetzcrm://call?nr=1",
      "die URL wird zwischen anderen Argumenten gefunden");
    assert.strictEqual(callUrlFromArgv(["/pfad/zur/app", "--hud-dev"]), null, "kein Anruf dabei");
    assert.strictEqual(callUrlFromArgv(null), null, "gar keine Argumente");
    assert.strictEqual(callUrlFromArgv([]), null, "leere Argumente");
  }

  console.log("call-url.test.js: alle Szenarien bestanden.");
}

run();
