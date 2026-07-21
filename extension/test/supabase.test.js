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

  // Payload-Builder (Stufe 3) — exakte snake_case-Feldnamen, Parität zu
  // insertContract()/insertTariffChange()/insertNote()/insertLead() in
  // src/lib/supabaseApi.ts (CRM-Repo).
  const note = sb.buildNotePayload(
    { customerNumber: "1000", customerName: "Anna Beispiel", title: "Telefonat", content: "Text", jiraTicket: "TNG-1" },
    "agent-1",
    "2024-06-15T10:00:00.000Z"
  );
  assert.strictEqual(note.customer_number, "1000");
  assert.strictEqual(note.title, "Telefonat");
  assert.strictEqual(note.created_by, "agent-1");
  assert.strictEqual(note.created_at, "2024-06-15T10:00:00.000Z");
  assert.strictEqual(note.updated_at, "2024-06-15T10:00:00.000Z");

  const noteMinimal = sb.buildNotePayload({ title: "T", content: "C" }, "agent-1", "2024-06-15T10:00:00.000Z");
  assert.strictEqual(noteMinimal.customer_number, null, "leere Kundennummer wird zu null");
  assert.strictEqual(noteMinimal.jira_ticket, null, "leeres Jira-Ticket wird zu null");

  const lead = sb.buildLeadPayload(
    { customerName: "Anna Beispiel", customerNumber: "1000", phone: "+49123", topic: "Frage", status: "neu", priority: "hoch", followUpDate: "2024-07-01" },
    "agent-1"
  );
  assert.strictEqual(lead.customer_name, "Anna Beispiel");
  assert.strictEqual(lead.priority, "hoch");
  assert.strictEqual(lead.follow_up_date, "2024-07-01");
  assert.strictEqual(lead.created_by, "agent-1");

  const leadDefaults = sb.buildLeadPayload({ customerName: "X" }, "agent-1");
  assert.strictEqual(leadDefaults.status, "neu", "Status-Default");
  assert.strictEqual(leadDefaults.priority, "normal", "Priority-Default");

  const contract = sb.buildContractPayload(
    { customerNumber: "1000", customerName: "Anna Beispiel", products: ["Fibrelight"], contractDate: "2024-06-15", contractStatus: "aktiv", laufzeitMonate: 24 },
    "agent-1"
  );
  assert.deepStrictEqual(contract.products, ["Fibrelight"]);
  assert.strictEqual(contract.contract_date, "2024-06-15");
  assert.strictEqual(contract.status, "aktiv");
  assert.strictEqual(contract.laufzeit_monate, 24);
  assert.strictEqual(contract.created_by, "agent-1");

  // Feldvergleich statt deepStrictEqual – innerhalb der Sandbox neu erzeugte
  // Arrays haben einen anderen Array-Prototyp als der Test-Realm (siehe
  // shared.test.js).
  const contractMinimal = sb.buildContractPayload({ customerNumber: "1000", customerName: "X", contractDate: "2024-06-15" }, "agent-1");
  assert.ok(Array.isArray(contractMinimal.products) && contractMinimal.products.length === 0, "fehlende Produkte werden zum leeren Array, nicht undefined");
  assert.strictEqual(contractMinimal.laufzeit_monate, null, "fehlende Laufzeit wird zu null (unbefristet)");

  const tariff = sb.buildTariffChangePayload(
    { customerNumber: "1000", customerName: "Anna Beispiel", changeType: "upgrade", context: "mvlz_lt3", changeDate: "2024-06-15", oldProduct: "A", newProduct: "B" },
    "agent-1"
  );
  assert.strictEqual(tariff.change_type, "upgrade");
  assert.strictEqual(tariff.context, "mvlz_lt3");
  assert.strictEqual(tariff.old_product, "A");
  assert.strictEqual(tariff.new_product, "B");
  assert.strictEqual(tariff.exported_at, null, "exported_at ist SharePoint-Export-Sache und bleibt immer null");
  assert.strictEqual(tariff.created_by, "agent-1");

  const auditPayload = sb.buildAuditLogPayload(
    { action: "create", entityType: "note", entityId: "n1", entityLabel: "Anna Beispiel", details: { source: "extension" } },
    "agent-1",
    "Max Muster"
  );
  assert.strictEqual(auditPayload.actor_id, "agent-1");
  assert.strictEqual(auditPayload.actor_name, "Max Muster");
  assert.strictEqual(auditPayload.action, "create");
  assert.strictEqual(auditPayload.entity_type, "note");
  assert.strictEqual(auditPayload.entity_id, "n1");
  assert.deepStrictEqual(auditPayload.details, { source: "extension" });
  assert.strictEqual(auditPayload.created_at, undefined, "created_at wird nicht gesetzt, die Tabelle hat einen DB-Default");

  // shared_settings-Antwort normalisieren.
  const settings = sb.parseSharedSettingsResponse({
    products: [{ name: "Fibrelight", category: "Privat", commission: 7.5 }],
    tariff_commission: { sidegrade: { mvlz_gt3: 0 } }
  });
  assert.strictEqual(settings.products.length, 1);
  assert.deepStrictEqual(settings.tariffCommission, { sidegrade: { mvlz_gt3: 0 } });
  assert.strictEqual(sb.parseSharedSettingsResponse(null), null, "keine Zeile gefunden");
  assert.strictEqual(sb.parseSharedSettingsResponse(false), null, "falsy-Wert (kein Treffer aus rows[0]) liefert null");

  console.log("supabase.test.js: alle Szenarien bestanden.");
}

run();
