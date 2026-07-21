"use strict";

// Abschluss-Panel im Jira-Panel (src/ui.js), Stufe 3 aus
// KONZEPT-INTEGRATION.md ("Ein Gespräch, eine Erfassung"). Eigene Datei statt
// Erweiterung von ui-outbound.test.js, weil hier ein gefakter supabaseClient
// injiziert werden muss, bevor ui.js lädt (siehe mountPanel unten) – und
// local-ai.js bewusst NICHT geladen wird, damit state.ai.callDraft
// deterministisch nie "ok" wird (kein echter Versuch, Chromes Prompt API zu
// nutzen).
//
// Die Panel-Sandbox kann kein echtes Tippen in Freitextfelder simulieren
// (querySelector liefert immer null, siehe test/support/stub-env.js) —
// Szenarien sind deshalb klick-getrieben: Typwechsel, Chip-Auswahl, Absenden.
//
// Ausführen mit: node test/ui-closeout.test.js

const assert = require("assert");
const { makePanelSandbox, loadScripts } = require("./support/stub-env");

const SHARED_SETTINGS_FIXTURE = {
  products: [
    { name: "Fibrelight", category: "Privat", commission: 7.5 },
    { name: "Basic 1000", category: "Business", commission: 40 }
  ],
  tariffCommission: {
    sidegrade: { mvlz_gt3: 0, mvlz_lt3: 5, outside_mvlz: 5 },
    upgrade: { mvlz_gt3: 5, mvlz_lt3: 7.5, outside_mvlz: 7.5 }
  }
};

function makeStub(inserted) {
  return {
    customerCard: async () => ({ ok: false, reason: "not-configured" }),
    fetchSharedSettings: async () => ({ ok: true, data: SHARED_SETTINGS_FIXTURE }),
    insertNote: async (fields) => { inserted.notiz.push(fields); return { ok: true, id: "note-1" }; },
    insertLead: async (fields) => { inserted.lead.push(fields); return { ok: true, id: "lead-1" }; },
    insertContract: async (fields) => { inserted.vertrag.push(fields); return { ok: true, id: "contract-1" }; },
    insertTariffChange: async (fields) => { inserted.tarifwechsel.push(fields); return { ok: true, id: "tariff-1" }; }
  };
}

async function mountPanel(inserted, options) {
  const env = makePanelSandbox(options);
  loadScripts(env.sandbox, ["src/config.js", "src/shared.js"]);
  env.sandbox.SupportCopilot.supabaseClient = makeStub(inserted);
  loadScripts(env.sandbox, ["src/ai-cache.js", "src/jira-reader.js", "src/rules.js", "src/ui.js"]);
  await env.sandbox.SupportCopilot.ui.mount();
  return { env, KEYS: env.sandbox.SupportCopilot.CONFIG.storageKeys };
}

function endedCall(overrides) {
  return Object.assign({
    status: "ended",
    callId: 1,
    callerName: "Anna Beispiel",
    callerNumber: "+49 176 34573586",
    customerNumber: "12345",
    group: "TNG GFIZ Bestellhotline",
    finalDuration: "1:00",
    // isCallStale() verwirft jeden Call ohne frisches updatedAt (siehe ui.js).
    updatedAt: Date.now()
  }, overrides || {});
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function run() {
  // --- Outbound "Mailbox" -> kein Panel --------------------------------------
  {
    const inserted = { notiz: [], lead: [], vertrag: [], tarifwechsel: [] };
    const { env, KEYS } = await mountPanel(inserted);
    env.click("set-call-mode", { mode: "outbound" });
    env.sandbox.chrome.storage.local.set({ [KEYS.activeCall]: endedCall() });
    assert.ok(env.html().includes('data-outcome="mailbox"'), "Voraussetzung: die Outcome-Leiste zeigt Mailbox überhaupt an");
    env.click("call-outcome", { outcome: "mailbox" });
    assert.ok(!env.html().includes("sc-closeout"), "Mailbox hat keinen Gesprächsinhalt und öffnet kein Abschluss-Panel");
  }

  // --- Inbound-Outcome öffnet das Panel mit Notiz ----------------------------
  {
    const inserted = { notiz: [], lead: [], vertrag: [], tarifwechsel: [] };
    const { env, KEYS } = await mountPanel(inserted);
    env.sandbox.chrome.storage.local.set({ [KEYS.activeCall]: endedCall() });
    env.click("call-outcome", { outcome: "resolved" });
    assert.ok(env.html().includes("sc-closeout"), "Inbound-Outcome \"Anliegen geklärt\" öffnet das Abschluss-Panel");
    assert.ok(env.html().includes('data-role="closeout-title"'), "Notiz ist der Standard-Eintragstyp");
  }

  // --- Inbound ohne Klick: Panel öffnet automatisch beim Auflegen ------------
  {
    const inserted = { notiz: [], lead: [], vertrag: [], tarifwechsel: [] };
    const { env, KEYS } = await mountPanel(inserted);
    env.sandbox.chrome.storage.local.set({ [KEYS.activeCall]: Object.assign(endedCall(), { status: "connected" }) });
    assert.ok(!env.html().includes("sc-closeout"), "während des Gesprächs ist noch kein Panel offen");
    env.sandbox.chrome.storage.local.set({ [KEYS.activeCall]: endedCall() });
    assert.ok(env.html().includes("sc-closeout"), "Inbound öffnet das Panel beim Auflegen ohne Klick auf einen Outcome-Button");
  }

  // --- Typ-Wechsel + Produkt-Toggle + Absenden -> insertContract -------------
  {
    const inserted = { notiz: [], lead: [], vertrag: [], tarifwechsel: [] };
    const { env, KEYS } = await mountPanel(inserted);
    env.sandbox.chrome.storage.local.set({ [KEYS.activeCall]: endedCall() });
    env.click("call-outcome", { outcome: "resolved" });

    env.click("closeout-type", { value: "vertrag" });
    await flush();
    env.click("closeout-toggle-product", { product: "Fibrelight" });
    assert.ok(env.html().includes("7.50"), "Provisions-Vorschau zeigt die Summe der gewählten Produkte");

    env.click("closeout-submit");
    await flush();
    assert.strictEqual(inserted.vertrag.length, 1, "genau ein insertContract()-Aufruf");
    assert.strictEqual(inserted.vertrag[0].customerNumber, "12345");
    assert.deepStrictEqual(Array.from(inserted.vertrag[0].products), ["Fibrelight"]);
    assert.strictEqual(inserted.notiz.length, 0, "kein zusätzlicher Notiz-Insert");
  }

  // --- Lead-Typ -> insertLead -------------------------------------------------
  {
    const inserted = { notiz: [], lead: [], vertrag: [], tarifwechsel: [] };
    const { env, KEYS } = await mountPanel(inserted);
    env.sandbox.chrome.storage.local.set({ [KEYS.activeCall]: endedCall({ customerNumber: "99999" }) });
    env.click("call-outcome", { outcome: "callback-agreed" });
    env.click("closeout-type", { value: "lead" });
    env.click("closeout-submit");
    await flush();
    assert.strictEqual(inserted.lead.length, 1, "genau ein insertLead()-Aufruf");
    assert.strictEqual(inserted.lead[0].customerNumber, "99999");
  }

  console.log("ui-closeout.test.js: alle Szenarien bestanden.");
}

run();
