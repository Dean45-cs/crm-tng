"use strict";

// Test für die reinen Funktionen des Supabase-Clients (src/supabase.js):
// Login-Ableitung, Token-Parsing, Session-Ablauf, customer_card-Normalisierung.
// Die fetch()-aufrufenden Funktionen (login/customerCard/refreshSession) sind
// hier bewusst nicht getestet – der vm-Sandbox fehlt ein fetch-Stub, das wäre
// eine separate Erweiterung.
//
// Ausführen mit: node test/supabase.test.js

const assert = require("assert");
const { makeSandbox, loadScripts } = require("./support/stub-env");

function load() {
  const env = makeSandbox();
  loadScripts(env.sandbox, ["src/config.js", "src/shared.js", "src/supabase.js"]);
  return env.sandbox.SupportCopilot.supabaseClient;
}

function run() {
  const sb = load();

  // pinToPassword / nameToEmail — muss exakt zu src/lib/supabase.ts im
  // CRM-Repo passen, sonst schlägt der Login mit korrekten Zugangsdaten fehl.
  assert.strictEqual(sb.pinToPassword("Max Muster", "1234"), "tng-crm::max muster::1234");
  assert.strictEqual(sb.pinToPassword("  Anna  ", "0000"), "tng-crm::anna::0000", "wird getrimmt");
  assert.strictEqual(sb.pinToPassword("ANNA", "1234"), sb.pinToPassword("anna", "1234"), "Groß-/Kleinschreibung egal");

  assert.strictEqual(sb.nameToEmail("Max Muster"), "max-muster@crm.tng.local");
  assert.strictEqual(sb.nameToEmail("Max Müller"), "max-m-ller@crm.tng.local", "Umlaute werden wie im CRM durch - ersetzt, nicht entfernt");
  assert.strictEqual(sb.nameToEmail("  Anna  "), "anna@crm.tng.local");

  // parseTokenResponse
  const now = 1_000_000_000;
  // Feldvergleich statt deepStrictEqual – vm-Objekte haben einen anderen
  // Objekt-Prototyp als der Test-Realm (siehe shared.test.js).
  const token = sb.parseTokenResponse(
    { access_token: "at", refresh_token: "rt", expires_in: 3600, user: { id: "u1", email: "a@b.c" } },
    now
  );
  assert.strictEqual(token.accessToken, "at");
  assert.strictEqual(token.refreshToken, "rt");
  assert.strictEqual(token.expiresAt, now + 3600 * 1000);
  assert.strictEqual(token.userId, "u1");
  assert.strictEqual(token.email, "a@b.c");
  assert.strictEqual(sb.parseTokenResponse(null), null, "keine Antwort");
  assert.strictEqual(sb.parseTokenResponse({ access_token: "at" }), null, "kein refresh_token");
  assert.strictEqual(sb.parseTokenResponse({}), null, "leere Antwort");
  const tokenDefaultExpiry = sb.parseTokenResponse({ access_token: "at", refresh_token: "rt" }, now);
  assert.strictEqual(tokenDefaultExpiry.expiresAt, now + 3600 * 1000, "Default 1h ohne expires_in");

  // isSessionExpired
  assert.strictEqual(sb.isSessionExpired(null), true, "keine Session ist immer abgelaufen");
  assert.strictEqual(sb.isSessionExpired({}), true, "ohne expiresAt abgelaufen");
  assert.strictEqual(
    sb.isSessionExpired({ expiresAt: now + 300000 }, now, 60000),
    false,
    "5 Minuten Vorlauf, 1 Minute Skew: noch gültig"
  );
  assert.strictEqual(
    sb.isSessionExpired({ expiresAt: now + 30000 }, now, 60000),
    true,
    "30s Vorlauf liegt innerhalb der 60s-Refresh-Vorlauffrist: gilt als abgelaufen"
  );
  assert.strictEqual(
    sb.isSessionExpired({ expiresAt: now - 1000 }, now, 60000),
    true,
    "bereits abgelaufen"
  );

  // parseCustomerCardResponse
  assert.strictEqual(sb.parseCustomerCardResponse(null), null, "kein Treffer (customer_card()-RPC liefert null)");
  const card = sb.parseCustomerCardResponse({
    customerNumber: "1000",
    name: "Anna Beispiel",
    phone: "+49123456",
    firstSeenAt: "2024-01-01T00:00:00Z",
    lastContactAt: "2024-06-01T00:00:00Z",
    contractCount: 2,
    tariffChangeCount: 0,
    noteCount: 1,
    leadCount: 0,
    jiraTicket: "TNG-42"
  });
  assert.strictEqual(card.customerNumber, "1000");
  assert.strictEqual(card.name, "Anna Beispiel");
  assert.strictEqual(card.phone, "+49123456");
  assert.strictEqual(card.firstSeenAt, "2024-01-01T00:00:00Z");
  assert.strictEqual(card.lastContactAt, "2024-06-01T00:00:00Z");
  assert.strictEqual(card.contractCount, 2);
  assert.strictEqual(card.tariffChangeCount, 0);
  assert.strictEqual(card.noteCount, 1);
  assert.strictEqual(card.leadCount, 0);
  assert.strictEqual(card.jiraTicket, "TNG-42");
  const cardMinimal = sb.parseCustomerCardResponse({ customerNumber: "2000" });
  assert.strictEqual(cardMinimal.name, "", "fehlender Name wird zu leerem String, nicht undefined");
  assert.strictEqual(cardMinimal.contractCount, 0, "fehlende Zählung wird zu 0");
  assert.strictEqual(cardMinimal.jiraTicket, "", "kein Ticket gefunden");

  console.log("supabase.test.js: alle Szenarien bestanden.");
}

run();
