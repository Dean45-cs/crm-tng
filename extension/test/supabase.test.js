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
  return env.sandbox.StadtnetzCRM.supabaseClient;
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

  // Ticket-Zusammenfassung für die Kundenakte: ein Titel je Ticket (das ist
  // das Erkennungsmerkmal beim Aktualisieren) und eine Statuszeile, die die
  // Frage "erledigt oder nicht" zuerst beantwortet.
  assert.strictEqual(sb.ticketSummaryNoteTitle("TNG-42"), "Ticket-Zusammenfassung TNG-42");
  assert.strictEqual(
    sb.ticketSummaryNoteTitle("TNG-42"),
    sb.ticketSummaryNoteTitle(" TNG-42 "),
    "Whitespace darf nicht zu einer zweiten Notiz für dasselbe Ticket führen"
  );

  const summaryNote = sb.buildTicketSummaryNoteFields({
    ticketKey: "TNG-42",
    ticketTitle: "Kein Internet seit Montag",
    customerNumber: "287246",
    customerName: "Kevin Carlsson",
    resolution: { id: "geschlossen", label: "Geschlossen", raw: "Erledigt" },
    summary: "Anliegen geklärt, Router getauscht."
  }, "2026-07-22T10:00:00.000Z");
  assert.strictEqual(summaryNote.customerNumber, "287246");
  assert.strictEqual(summaryNote.customerName, "Kevin Carlsson");
  assert.strictEqual(summaryNote.jiraTicket, "TNG-42");
  assert.strictEqual(summaryNote.title, "Ticket-Zusammenfassung TNG-42");
  assert.ok(
    summaryNote.content.startsWith("Status: Geschlossen (Erledigt)"),
    "der Stand des Tickets steht in der ersten Zeile der Notiz"
  );
  assert.ok(summaryNote.content.includes("Anliegen: Kein Internet seit Montag"));
  assert.ok(summaryNote.content.includes("Anliegen geklärt, Router getauscht."), "die Zusammenfassung selbst steht in der Notiz");
  assert.ok(summaryNote.content.includes("TNG-42"), "Herkunft der Notiz bleibt im Text nachvollziehbar");

  const openNote = sb.buildTicketSummaryNoteFields({
    ticketKey: "TNG-43",
    customerNumber: "287246",
    resolution: { id: "offen", label: "Offen", raw: "In Bearbeitung" },
    summary: "Rückruf vereinbart."
  }, "2026-07-22T10:00:00.000Z");
  assert.ok(openNote.content.startsWith("Status: Offen (In Bearbeitung)"));
  assert.ok(!openNote.content.includes("Anliegen:"), "ohne Tickettitel keine leere Anliegen-Zeile");

  const unknownNote = sb.buildTicketSummaryNoteFields({
    ticketKey: "TNG-44",
    customerNumber: "287246",
    resolution: { id: "unbekannt", label: "Unbekannt", raw: "" },
    summary: "Text"
  }, "2026-07-22T10:00:00.000Z");
  assert.ok(unknownNote.content.startsWith("Status: Unbekannt\n"), "ohne Originalstatus keine leere Klammer");

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

// searchWorkspace() (Stufe 4, Befehlspalette) — eigener async Durchlauf mit
// gefaktem fetch, da hier (anders als oben) die netzwerkaufrufende Funktion
// selbst getestet wird statt nur reiner Payload-Builder.
async function runSearchWorkspace() {
  const env = makeSandbox();
  loadScripts(env.sandbox, ["src/config.js", "src/shared.js", "src/supabase.js"]);
  const sb = env.sandbox.StadtnetzCRM.supabaseClient;
  const CONFIG = env.sandbox.StadtnetzCRM.CONFIG;

  // Konfiguriert + eingeloggt, wie getEffectiveSupabaseConfig()/ensureFreshSession() es erwarten.
  env.storage[CONFIG.storageKeys.settings] = { supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon-key" };
  env.storage[CONFIG.storageKeys.supabaseSession] = {
    accessToken: "at-1", refreshToken: "rt-1", expiresAt: Date.now() + 3600000, userId: "u1", displayName: "Max"
  };

  const calls = [];
  env.sandbox.fetch = async (url) => {
    calls.push(url);
    if (url.includes("/customers?")) {
      return { ok: true, status: 200, json: async () => [{ customer_number: "1000", name: "Anna Beispiel" }] };
    }
    if (url.includes("/contracts?")) {
      return {
        ok: true, status: 200,
        json: async () => [{ id: "c1", customer_number: "1000", customer_name: "Anna Beispiel", products: ["Fibrelight"], contract_date: "2024-06-15" }]
      };
    }
    if (url.includes("/tariff_changes?")) return { ok: true, status: 200, json: async () => [] };
    if (url.includes("/notes?")) return { ok: true, status: 200, json: async () => [] };
    return { ok: false, status: 404, json: async () => ({ message: `unerwartete URL: ${url}` }) };
  };

  const res = await sb.searchWorkspace("Anna");
  assert.strictEqual(res.ok, true);
  assert.strictEqual(calls.length, 4, "vier parallele Abfragen (customers/contracts/tariff_changes/notes)");
  assert.ok(calls.every((u) => u.includes("*Anna*")), "Suchbegriff steckt in jeder der vier Abfragen");
  assert.strictEqual(res.groups.length, 2, "nur Kunden und Verträge haben Treffer, leere Gruppen fehlen");
  assert.strictEqual(res.groups[0].group, "Kunden");
  assert.strictEqual(res.groups[0].items[0].customerNumber, "1000");
  assert.strictEqual(res.groups[1].group, "Verträge");
  assert.ok(res.groups[1].items[0].sub.includes("Fibrelight"), "Vertrags-Treffer zeigt die Produkte");

  // Leere Suche (nur Whitespace) -> keine Netzwerkaufrufe, leeres Ergebnis statt Fehler.
  calls.length = 0;
  const empty = await sb.searchWorkspace("   ");
  assert.strictEqual(empty.ok, true);
  assert.strictEqual(Array.from(empty.groups).length, 0);
  assert.strictEqual(calls.length, 0, "leere Suche löst keine Netzwerkaufrufe aus");

  // 401 bei irgendeiner der vier Abfragen -> not-logged-in für alle, Session gelöscht
  // (ein abgelaufenes Login darf nicht durch Teilergebnisse der anderen drei überdeckt werden).
  env.sandbox.fetch = async (url) => {
    if (url.includes("/notes?")) return { ok: false, status: 401, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => [] };
  };
  const unauthorized = await sb.searchWorkspace("Anna");
  assert.strictEqual(unauthorized.ok, false);
  assert.strictEqual(unauthorized.reason, "not-logged-in");
  assert.strictEqual(env.storage[CONFIG.storageKeys.supabaseSession], undefined, "Session wird bei 401 gelöscht");

  console.log("supabase.test.js (searchWorkspace): alle Szenarien bestanden.");
}

// upsertTicketSummaryNote() — die Zusammenfassung des gelesenen Jira-Tickets
// in der Kundenakte. Getestet wird das Kernversprechen: eine Notiz je Ticket
// (kein Zuwachsen der Akte beim erneuten Zusammenfassen).
async function runTicketSummaryNote() {
  function setup(handler) {
    const env = makeSandbox();
    loadScripts(env.sandbox, ["src/config.js", "src/shared.js", "src/supabase.js"]);
    const CONFIG = env.sandbox.StadtnetzCRM.CONFIG;
    env.storage[CONFIG.storageKeys.settings] = { supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon-key" };
    env.storage[CONFIG.storageKeys.supabaseSession] = {
      accessToken: "at-1", refreshToken: "rt-1", expiresAt: Date.now() + 3600000, userId: "u1", displayName: "Max"
    };
    const calls = [];
    env.sandbox.fetch = async (url, options) => {
      calls.push({ url, method: (options && options.method) || "GET", body: options && options.body ? JSON.parse(options.body) : null });
      return handler(url, options) || { ok: true, status: 200, json: async () => [{ id: "audit-1" }] };
    };
    return { env, sb: env.sandbox.StadtnetzCRM.supabaseClient, calls, CONFIG };
  }

  // insertAuditLog() läuft bewusst fire-and-forget (ein Fehler dort darf die
  // Erfassung nicht blockieren) – für die Prüfung muss die Ereignisschleife
  // deshalb einmal durchlaufen.
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  const input = {
    ticketKey: "TNG-42",
    ticketTitle: "Kein Internet",
    customerNumber: "287246",
    customerName: "Kevin Carlsson",
    resolution: { id: "offen", label: "Offen", raw: "In Bearbeitung" },
    summary: "Techniker kommt Freitag."
  };

  // --- Noch keine Notiz zu diesem Ticket -> anlegen ---------------------------
  {
    const { sb, calls } = setup((url, options) => {
      const method = (options && options.method) || "GET";
      if (url.includes("/notes?") && method === "GET") return { ok: true, status: 200, json: async () => [] };
      if (url.includes("/notes") && method === "POST") return { ok: true, status: 201, json: async () => [{ id: "note-neu" }] };
      return null; // audit_log
    });

    const res = await sb.upsertTicketSummaryNote(input);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.created, true, "ohne vorhandene Notiz wird eine neue angelegt");
    const lookup = calls.find((c) => c.method === "GET");
    assert.ok(lookup.url.includes("jira_ticket=eq.TNG-42"), "gesucht wird über das Ticket …");
    assert.ok(lookup.url.includes("created_by=eq.u1"), "… und nur unter den eigenen Notizen (RLS: notes update own)");
    const insert = calls.find((c) => c.method === "POST" && c.url.includes("/notes"));
    assert.strictEqual(insert.body.customer_number, "287246", "die Notiz hängt an der Kundenakte");
    assert.strictEqual(insert.body.jira_ticket, "TNG-42");
    assert.ok(insert.body.content.startsWith("Status: Offen (In Bearbeitung)"));
    await flush();
    const audit = calls.find((c) => c.url.includes("/audit_log"));
    assert.strictEqual(audit.body.action, "create", "Erfassung über die Extension bleibt im Audit-Trail");
    assert.strictEqual(audit.body.details.origin, "jira-summary");
  }

  // --- Notiz existiert schon -> aktualisieren statt zweite anlegen ------------
  {
    const { sb, calls } = setup((url, options) => {
      const method = (options && options.method) || "GET";
      if (url.includes("/notes?") && method === "GET") return { ok: true, status: 200, json: async () => [{ id: "note-alt" }] };
      if (url.includes("/notes?") && method === "PATCH") return { ok: true, status: 200, json: async () => [{ id: "note-alt" }] };
      return null;
    });

    const res = await sb.upsertTicketSummaryNote(
      Object.assign({}, input, { resolution: { id: "geschlossen", label: "Geschlossen", raw: "Erledigt" } })
    );
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.created, false, "dieselbe Zeile wird aktualisiert");
    assert.strictEqual(res.id, "note-alt");
    assert.strictEqual(calls.filter((c) => c.method === "POST" && c.url.includes("/notes")).length, 0, "kein zweiter Eintrag in der Akte");
    const patch = calls.find((c) => c.method === "PATCH");
    assert.ok(patch.url.includes("id=eq.note-alt"));
    assert.ok(patch.body.content.startsWith("Status: Geschlossen (Erledigt)"), "der neue Ticketstand steht in der Akte");
    assert.ok(patch.body.updated_at, "updated_at wird mitgeschrieben – danach sortiert die Kundenakte");
  }

  // --- Fremde Notiz (RLS lässt das PATCH ins Leere laufen) -> eigene anlegen --
  {
    const { sb } = setup((url, options) => {
      const method = (options && options.method) || "GET";
      if (url.includes("/notes?") && method === "GET") return { ok: true, status: 200, json: async () => [{ id: "note-fremd" }] };
      if (url.includes("/notes?") && method === "PATCH") return { ok: true, status: 200, json: async () => [] };
      if (url.includes("/notes") && method === "POST") return { ok: true, status: 201, json: async () => [{ id: "note-eigen" }] };
      return null;
    });

    const res = await sb.upsertTicketSummaryNote(input);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.created, true, "eine nicht änderbare fremde Notiz wird nicht überschrieben, sondern ergänzt");
    assert.strictEqual(res.id, "note-eigen");
  }

  // --- Ohne Kundennummer gar nichts schreiben --------------------------------
  {
    const { sb, calls } = setup(() => ({ ok: true, status: 200, json: async () => [] }));
    const res = await sb.upsertTicketSummaryNote(Object.assign({}, input, { customerNumber: "" }));
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, "no-customer");
    assert.strictEqual(calls.length, 0, "eine Notiz ohne Akte wird erst gar nicht angelegt");
  }

  console.log("supabase.test.js (upsertTicketSummaryNote): alle Szenarien bestanden.");
}

// Bug E: ensureFreshSession() darf bei parallelen Aufrufen mit abgelaufener
// Session nur EINEN Refresh-Request auslösen. Sonst löst der zweite Aufruf den
// bereits rotierten Refresh-Token ein, scheitert und ruft clearSession() auf —
// und löscht damit die Session, die der erste gerade frisch gespeichert hat.
async function runRefreshMutex() {
  const env = makeSandbox();
  loadScripts(env.sandbox, ["src/config.js", "src/shared.js", "src/supabase.js"]);
  const sb = env.sandbox.StadtnetzCRM.supabaseClient;
  const CONFIG = env.sandbox.StadtnetzCRM.CONFIG;

  env.storage[CONFIG.storageKeys.settings] = { supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon-key" };
  // Bereits abgelaufene Session -> ensureFreshSession() muss refreshen.
  env.storage[CONFIG.storageKeys.supabaseSession] = {
    accessToken: "at-alt", refreshToken: "rt-alt", expiresAt: Date.now() - 1000, userId: "u1", displayName: "Max"
  };

  let refreshCalls = 0;
  env.sandbox.fetch = async (url) => {
    if (url.includes("/token?")) {
      refreshCalls += 1;
      // Der Server rotiert den Token: ein zweiter Aufruf mit demselben alten
      // Refresh-Token würde in der Realität scheitern. Hier zählen wir nur, wie
      // oft überhaupt refreshed wird.
      return {
        ok: true, status: 200,
        json: async () => ({ access_token: "at-neu", refresh_token: "rt-neu", expires_in: 3600, user: { id: "u1" } })
      };
    }
    return { ok: false, status: 404, json: async () => ({ message: `unerwartet: ${url}` }) };
  };

  // Zwei gleichzeitige Aufrufe (wie maybeLookupCustomer + maybeStartCall im
  // selben Tick).
  const [a, b] = await Promise.all([sb.ensureFreshSession(), sb.ensureFreshSession()]);
  assert.strictEqual(refreshCalls, 1, "zwei parallele ensureFreshSession() lösen nur EINEN Refresh aus (Bug E)");
  assert.ok(a && a.accessToken === "at-neu", "der erste Aufruf bekommt die frische Session");
  assert.ok(b && b.accessToken === "at-neu", "der zweite Aufruf bekommt dieselbe frische Session, kein null");
  assert.ok(env.storage[CONFIG.storageKeys.supabaseSession], "die Session bleibt gespeichert, wird nicht durch einen Wettlauf gelöscht");

  // Ein späterer Aufruf mit der jetzt gültigen Session refresht nicht erneut.
  await sb.ensureFreshSession();
  assert.strictEqual(refreshCalls, 1, "eine gültige Session löst keinen weiteren Refresh aus");

  console.log("supabase.test.js (ensureFreshSession-Mutex): alle Szenarien bestanden.");
}

// fetchCurrentShift() — die heutige Schicht+Kampagne des Agenten fürs
// Call-Typ-Routing (Outbound-Umbau). Prüft URL-Aufbau, Join-Auswertung und
// sauberes Degradieren ohne Schicht.
async function runFetchCurrentShift() {
  function setup(handler) {
    const env = makeSandbox();
    loadScripts(env.sandbox, ["src/config.js", "src/shared.js", "src/supabase.js"]);
    const CONFIG = env.sandbox.StadtnetzCRM.CONFIG;
    env.storage[CONFIG.storageKeys.settings] = { supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon-key" };
    env.storage[CONFIG.storageKeys.supabaseSession] = {
      accessToken: "at-1", refreshToken: "rt-1", expiresAt: Date.now() + 3600000, userId: "u1", displayName: "Max"
    };
    const calls = [];
    env.sandbox.fetch = async (url) => { calls.push(url); return handler(url); };
    return { env, sb: env.sandbox.StadtnetzCRM.supabaseClient, calls };
  }

  // --- Schicht mit Kampagne -> Call-Typ wird geliefert -----------------------
  {
    const { sb, calls } = setup(() => ({
      ok: true, status: 200,
      json: async () => [{
        shift_type: "frueh", shift_date: "2026-07-24", campaign_id: "c1",
        campaigns: { id: "c1", name: "Kündiger Q3", call_type: "churn", active: true }
      }]
    }));
    const res = await sb.fetchCurrentShift("2026-07-24");
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.data.callType, "churn", "der Call-Typ kommt aus der gejointen Kampagne");
    assert.strictEqual(res.data.campaignName, "Kündiger Q3");
    assert.strictEqual(res.data.shiftType, "frueh");
    assert.ok(calls[0].includes("user_id=eq.u1"), "gefragt wird nach der eigenen Schicht");
    assert.ok(calls[0].includes("shift_date=eq.2026-07-24"), "für den übergebenen Tag");
    assert.ok(calls[0].includes("campaigns"), "die Kampagne wird per Embed mitgeladen");
  }

  // --- Keine Schicht heute -> data ist null, kein Fehler ---------------------
  {
    const { sb } = setup(() => ({ ok: true, status: 200, json: async () => [] }));
    const res = await sb.fetchCurrentShift("2026-07-24");
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.data, null, "ohne Schicht liefert fetchCurrentShift ok:true und data:null (sauberes Degradieren)");
  }

  console.log("supabase.test.js (fetchCurrentShift): alle Szenarien bestanden.");
}

run();
runSearchWorkspace();
runTicketSummaryNote();
runRefreshMutex();
runFetchCurrentShift();
