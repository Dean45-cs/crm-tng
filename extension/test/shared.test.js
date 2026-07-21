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
  loadScripts(env.sandbox, ["src/config.js", "src/shared.js"]);
  return env.sandbox.SupportCopilot.shared;
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

  // todayIso — Format YYYY-MM-DD.
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(shared.todayIso()), "todayIso liefert YYYY-MM-DD");

  console.log("shared.test.js: alle Szenarien bestanden.");
}

run();
