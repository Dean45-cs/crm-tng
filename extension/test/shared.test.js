"use strict";

// Test für die gemeinsamen Helfer (src/shared.js), die von ui.js,
// timio-content.js und background.js geteilt werden. Da drei Verbraucher an
// identischem Verhalten hängen, lohnt sich hier ein direkter Unit-Test.
//
// Ausführen mit: node test/shared.test.js

const assert = require("assert");
const { makeSandbox, loadScripts } = require("./support/stub-env");

function load() {
  const env = makeSandbox();
  loadScripts(env.sandbox, ["src/config.js", "src/commission.js", "src/shared.js"]);
  return env.sandbox.StadtnetzCRM.shared;
}

function run() {
  const shared = load();

  // formatDuration
  assert.strictEqual(shared.formatDuration(0), "0:00");
  assert.strictEqual(shared.formatDuration(65000), "1:05");
  assert.strictEqual(shared.formatDuration(3661000), "1:01:01");
  assert.strictEqual(shared.formatDuration(-500), "0:00", "negative Werte werden auf 0 geklemmt");

  // callStatusMeta (Feldvergleich statt deepStrictEqual – vm-Objekte haben
  // einen anderen Objekt-Prototyp als der Test-Realm)
  [["ringing", "☎ Klingelt", "is-ringing"],
   ["ended", "Beendet", "is-ended"],
   ["connected", "● Im Gespräch", "is-connected"]].forEach(([status, label, cls]) => {
    const meta = shared.callStatusMeta(status);
    assert.strictEqual(meta.label, label, `Label für ${status}`);
    assert.strictEqual(meta.cls, cls, `Klasse für ${status}`);
  });

  // callTimerText
  assert.strictEqual(shared.callTimerText({ status: "ringing" }), "", "beim Klingeln kein Timer");
  assert.strictEqual(shared.callTimerText({ status: "ended", finalDuration: "3:12" }), "3:12", "nach dem Auflegen die feste Enddauer");
  const live = shared.callTimerText({ status: "connected" }, Date.now() - 65000);
  assert.strictEqual(live, "1:05", "im Gespräch tickt die Dauer ab connectedAt");

  // queueTotalWaiting
  assert.strictEqual(shared.queueTotalWaiting(null), null);
  assert.strictEqual(shared.queueTotalWaiting({ groups: [] }), null);
  assert.strictEqual(shared.queueTotalWaiting({ groups: [{ waiting: 2 }, { waiting: 3 }, { waiting: "x" }] }), 5);

  // queueIsStale / queueStaleMinutes
  const now = Date.now();
  assert.strictEqual(shared.queueIsStale(null, 30000, now), true, "ohne Daten: veraltet");
  assert.strictEqual(shared.queueIsStale({ updatedAt: now - 10000 }, 30000, now), false, "frische Daten");
  assert.strictEqual(shared.queueIsStale({ updatedAt: now - 60000 }, 30000, now), true, "alte Daten");
  assert.strictEqual(shared.queueStaleMinutes({ updatedAt: now - 10000 }, 30000, now), 0, "frisch: keine Minutenangabe");
  assert.strictEqual(shared.queueStaleMinutes({ updatedAt: now - 120000 }, 30000, now), 2, "2 Minuten alt");
  assert.strictEqual(shared.queueStaleMinutes(null, 30000, now), 0, "keine Daten: kein Veraltet-Hinweis");

  // groupsMatch (Teilstring in beide Richtungen, case-insensitiv)
  assert.strictEqual(shared.groupsMatch("TNG GFIZ Bestellhotline", "Bestellhotline"), true);
  assert.strictEqual(shared.groupsMatch("Bestellhotline", "TNG GFIZ Bestellhotline"), true);
  assert.strictEqual(shared.groupsMatch("BESTELLHOTLINE", "bestellhotline"), true);
  assert.strictEqual(shared.groupsMatch("Ausbaustatus", "Bestellhotline"), false);
  assert.strictEqual(shared.groupsMatch("", "x"), false);

  // Provisions-Mathematik (Stufe 3) — Parität zu src/lib/utils.ts (CRM-Repo).
  const settings = {
    products: [
      { name: "Fibrelight", category: "Privat", commission: 7.5 },
      { name: "Fibrepro", category: "Privat", commission: 15 },
      { name: "Basic 1000", category: "Business", commission: 40 }
    ],
    tariffCommission: {
      sidegrade: { mvlz_gt3: 0, mvlz_lt3: 5, outside_mvlz: 5 },
      upgrade: { mvlz_gt3: 5, mvlz_lt3: 7.5, outside_mvlz: 7.5 }
    }
  };
  assert.strictEqual(shared.getProductCommission(settings, "Fibrelight"), 7.5);
  assert.strictEqual(shared.getProductCommission(settings, "Unbekanntes Produkt"), 0, "unbekanntes Produkt liefert 0, statt zu werfen");

  assert.strictEqual(
    shared.calcContractCommission({ products: ["Fibrelight", "Fibrepro"], status: "aktiv" }, settings),
    22.5,
    "Summe über alle Produkte des Vertrags"
  );
  assert.strictEqual(
    shared.calcContractCommission({ products: ["Fibrelight"], status: "storniert" }, settings),
    0,
    "ein stornierter Vertrag liefert immer 0"
  );

  assert.strictEqual(shared.calcTariffCommission({ changeType: "upgrade", context: "mvlz_lt3" }, settings), 7.5);
  assert.strictEqual(shared.calcTariffCommission({ changeType: "sidegrade", context: "mvlz_gt3" }, settings), 0);
  assert.strictEqual(
    shared.calcTariffCommission({ changeType: "upgrade", context: "unbekannt" }, settings),
    0,
    "unbekannter Kontext liefert 0, statt zu werfen"
  );

  // groupProductsByCategory — feste Reihenfolge Privat/Business/Zusatz, leere Kategorien fallen weg.
  const grouped = shared.groupProductsByCategory(settings.products);
  assert.strictEqual(grouped.length, 2, "Zusatz ist leer und fehlt in der Liste");
  assert.strictEqual(grouped[0].category, "Privat");
  assert.strictEqual(grouped[0].products.length, 2);
  assert.strictEqual(grouped[1].category, "Business");

  // ticketResolution — Grundlage für "offen/geschlossen" in der Kundenakte.
  // Jira-Workflows benennen Status frei, deshalb wird auf Wortbestandteile
  // geprüft und im Zweifel "offen" gemeldet.
  [["Erledigt", "geschlossen"],
   ["Geschlossen", "geschlossen"],
   ["Abgeschlossen", "geschlossen"],
   ["Gelöst", "geschlossen"],
   ["Done", "geschlossen"],
   ["Closed", "geschlossen"],
   ["Storniert", "geschlossen"],
   ["Offen", "offen"],
   ["In Bearbeitung", "offen"],
   ["Warten auf Kunde", "offen"],
   ["Wiedereröffnet", "offen"]].forEach(([status, expected]) => {
    assert.strictEqual(shared.ticketResolution(status).id, expected, `Status "${status}"`);
  });
  assert.strictEqual(shared.ticketResolution("Erledigt").label, "Geschlossen");
  assert.strictEqual(shared.ticketResolution("Erledigt").raw, "Erledigt", "Originalstatus bleibt für die Notiz erhalten");
  assert.strictEqual(shared.ticketResolution("Phantasiestatus").id, "offen", "unbekannter Status gilt als offen, nicht als erledigt");
  assert.strictEqual(shared.ticketResolution("").id, "unbekannt", "ohne Status keine Behauptung");
  assert.strictEqual(shared.ticketResolution("Nicht sichtbar").id, "unbekannt", "Platzhalter des Jira-Readers zählt nicht als Status");
  assert.strictEqual(shared.ticketResolution(null).id, "unbekannt");

  // ---------------------------------------------------------------------------
  // phoneKey — dieselbe Rufnummer, immer gleich geschrieben.
  //
  // Diese Tabelle ist zugleich die Abmachung mit der Datenbank: public.phone_key()
  // aus db/migrations/027 muss dieselben Ergebnisse liefern. Weicht eine der
  // beiden Seiten ab, findet die Rufnummernsuche nichts mehr — und zwar
  // stillschweigend, weil "kein Treffer" ein gültiges Ergebnis ist.
  // ---------------------------------------------------------------------------
  [
    ["+49 7031 000000", "7031000000"],
    ["07031000000", "7031000000"],
    ["07031 000 000", "7031000000"],
    ["0049 7031 000000", "7031000000"],
    ["+49 (7031) 00-00-00", "7031000000"],
    ["+4917634573586", "17634573586"],
    ["0176 34573586", "17634573586"],
    ["0049-176-34573586", "17634573586"],
    // Die Vorwahl bleibt vollständig: gekürzt auf die letzten Stellen fielen
    // 07031 und 08031 zusammen, und im Gespräch stünde der falsche Kunde da.
    ["08031 000000", "8031000000"],
    // Landesvorwahl nur weg, wenn die Nummer international geschrieben ist –
    // sonst verlöre Leer (0491) seine Vorwahl.
    ["0491 12345", "49112345"],
    ["+49 491 12345", "49112345"],
    ["49 7031 000000", "497031000000"],
    ["123", "123"],
    ["", ""],
    ["   ", ""],
    ["0", ""],
    ["00", ""],
    ["+", ""],
    [null, ""],
    [undefined, ""]
  ].forEach(([input, expected]) => {
    assert.strictEqual(shared.phoneKey(input), expected, `phoneKey(${JSON.stringify(input)})`);
  });

  // Der Zweck in einem Satz: verschiedene Schreibweisen, ein Schlüssel.
  assert.strictEqual(shared.phoneKey("+49 7031 000000"), shared.phoneKey("07031000000"),
    "international und national geschrieben ist dieselbe Nummer");
  assert.notStrictEqual(shared.phoneKey("07031 000000"), shared.phoneKey("08031 000000"),
    "zwei Vorwahlen bleiben zwei Nummern");

  // ---------------------------------------------------------------------------
  // parseCustomerLabel — Kürzel, Kundennummer und Name aus einer Bezeichnung.
  //
  // Die Telefonanlage schickt sie als Displayname zusammengesetzt ("PK 182962
  // Daniel Ratcliffe"), Jira in umgekehrter Reihenfolge. Der wichtigste Fall
  // steht am Ende: passt das Muster nicht, wird NICHTS erfunden.
  // ---------------------------------------------------------------------------
  [
    ["PK 182962 Daniel Ratcliffe", { kundenart: "PK", customerNumber: "182962", name: "Daniel Ratcliffe" }],
    ["GK 44012 Muster GmbH", { kundenart: "GK", customerNumber: "44012", name: "Muster GmbH" }],
    // Jira-Schreibweise (Oikonomikos-Feld, siehe jira-reader.js).
    ["287246 / Herr Kevin Carlsson PK", { kundenart: "PK", customerNumber: "287246", name: "Herr Kevin Carlsson" }],
    // Unbekanntes Kürzel wird durchgereicht, nicht verschluckt: ein neues soll
    // auffallen.
    ["XY 100200 Neue Art", { kundenart: "XY", customerNumber: "100200", name: "Neue Art" }],
    // Mehrfache Leerzeichen und Trennzeichen.
    ["PK  182962   Daniel  Ratcliffe", { kundenart: "PK", customerNumber: "182962", name: "Daniel Ratcliffe" }],
    // Ohne Namensteil bleibt die Nummer als Anzeige übrig – besser als leer.
    ["PK 182962", { kundenart: "PK", customerNumber: "182962", name: "182962" }],
    // Und die Fälle, in denen nichts geraten werden darf:
    ["Daniel Ratcliffe", { kundenart: "", customerNumber: "", name: "Daniel Ratcliffe" }],
    ["182962", { kundenart: "", customerNumber: "", name: "182962" }],
    ["+49 7031 000000", { kundenart: "", customerNumber: "", name: "+49 7031 000000" }],
    ["Frau 12345 Müller", { kundenart: "", customerNumber: "", name: "Frau 12345 Müller" }],
    ["PK 12 Zu kurze Nummer", { kundenart: "", customerNumber: "", name: "PK 12 Zu kurze Nummer" }],
    ["", { kundenart: "", customerNumber: "", name: "" }]
  ].forEach(([input, expected]) => {
    const parsed = shared.parseCustomerLabel(input);
    assert.strictEqual(parsed.kundenart, expected.kundenart, `Kundenart aus ${JSON.stringify(input)}`);
    assert.strictEqual(parsed.customerNumber, expected.customerNumber, `Kundennummer aus ${JSON.stringify(input)}`);
    assert.strictEqual(parsed.name, expected.name, `Name aus ${JSON.stringify(input)}`);
  });

  assert.strictEqual(shared.parseCustomerLabel(null).name, "", "null ist kein Name");
  assert.strictEqual(shared.kundenartLabel("PK"), "Privatkunde");
  assert.strictEqual(shared.kundenartLabel("GK"), "Geschäftskunde");
  assert.strictEqual(shared.kundenartLabel("XY"), "XY", "unbekannte Kürzel werden unverändert gezeigt");

  // todayIso — Format YYYY-MM-DD.
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(shared.todayIso()), "todayIso liefert YYYY-MM-DD");

  console.log("shared.test.js: alle Szenarien bestanden.");
}

run();
