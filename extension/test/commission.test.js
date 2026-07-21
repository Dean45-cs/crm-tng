"use strict";

// Test für src/commission.js — die gemeinsame Provisions-/Produktlogik
// (Stufe 4, KONZEPT-INTEGRATION.md), die sowohl per `require()` (Node/CRM-
// Build) als auch als klassisches Content-Script (Browser, siehe
// shared.test.js) laufen muss. shared.test.js deckt bereits die
// Browser-Ladeform über vm.runInContext ab (per shared.js-Delegation) —
// dieser Test prüft gezielt den CommonJS-Zweig, den sonst nichts ausübt.
//
// Ausführen mit: node test/commission.test.js

const assert = require("assert");
const commission = require("../src/commission.js");

function run() {
  assert.strictEqual(typeof commission.getProductCommission, "function");
  assert.strictEqual(typeof commission.calcContractCommission, "function");
  assert.strictEqual(typeof commission.calcTariffCommission, "function");
  assert.strictEqual(typeof commission.groupProductsByCategory, "function");

  const settings = {
    products: [
      { name: "Fibrelight", category: "Privat", commission: 7.5 },
      { name: "Basic 1000", category: "Business", commission: 40 }
    ],
    tariffCommission: {
      sidegrade: { mvlz_gt3: 0, mvlz_lt3: 5, outside_mvlz: 5 },
      upgrade: { mvlz_gt3: 5, mvlz_lt3: 7.5, outside_mvlz: 7.5 }
    }
  };

  assert.strictEqual(commission.getProductCommission(settings, "Fibrelight"), 7.5);
  assert.strictEqual(
    commission.calcContractCommission({ products: ["Fibrelight", "Basic 1000"], status: "aktiv" }, settings),
    47.5
  );
  assert.strictEqual(
    commission.calcTariffCommission({ changeType: "upgrade", context: "mvlz_lt3" }, settings),
    7.5
  );

  const grouped = commission.groupProductsByCategory(settings.products);
  assert.strictEqual(grouped.length, 2, "Zusatz ist leer und fehlt in der Liste");
  assert.strictEqual(grouped[0].category, "Privat");

  console.log("commission.test.js: alle Szenarien bestanden.");
}

run();
