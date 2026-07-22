"use strict";

// Übernahme der Ticket-Zusammenfassung in die Kundenakte (src/ui.js).
// Eigene Datei, weil hier – anders als in ui-closeout.test.js – sowohl ein
// gefakter supabaseClient ALS AUCH eine gefakte lokale KI injiziert werden
// müssen, bevor ui.js lädt: geprüft wird ja genau die Kette
// "Ticket gelesen -> zusammengefasst -> in der Akte".
//
// Ebenfalls gefakt ist der Jira-Reader: die Panel-Sandbox hat kein echtes DOM
// (querySelector liefert immer null, siehe test/support/stub-env.js), aus dem
// sich Kundennummer und Status auslesen ließen.
//
// Ausführen mit: node test/ui-summary-crm.test.js

const assert = require("assert");
const { makePanelSandbox, loadScripts } = require("./support/stub-env");

const UNKNOWN = "Nicht sichtbar";
const SUMMARY_TEXT = "Anliegen: Kein Internet. Stand: Techniker beauftragt.";

function makeTicket(overrides) {
  return Object.assign({
    key: "TNG-42",
    summary: "Kein Internet seit Montag",
    priority: "Hoch",
    status: "In Bearbeitung",
    issueType: "Störung",
    customerReference: "287246",
    customerName: "Kevin Carlsson",
    assignee: "Max Muster",
    reporter: "Bot",
    description: "Kunde meldet Totalausfall.",
    latestInformation: "Techniker beauftragt.",
    commentCount: 1,
    comments: ["Techniker beauftragt."]
  }, overrides || {});
}

// Nur so viel KI, wie die Auto-Kette in ui.js anfasst (Einordnung ->
// Zusammenfassung -> Doku; Gesprächsvorbereitung nur im Outbound-Modus).
function makeLocalAi() {
  return {
    STATUS: {
      UNSUPPORTED: "unsupported", UNAVAILABLE: "unavailable", DOWNLOADABLE: "downloadable",
      DOWNLOADING: "downloading", AVAILABLE: "available", OK: "ok", ERROR: "error"
    },
    capabilities: async () => ({ usable: true, status: "available" }),
    triage: async () => ({ status: "ok", data: { stimmung: "neutral", dringlichkeit: "mittel", kundenwunsch: "Reparatur" } }),
    summarize: async () => ({ status: "available", text: SUMMARY_TEXT }),
    documentTicket: async () => ({ status: "available", text: "Doku" }),
    prepareCall: async () => ({ status: "available", data: null })
  };
}

async function mountPanel(options) {
  const opts = options || {};
  const env = makePanelSandbox();
  loadScripts(env.sandbox, ["src/config.js", "src/commission.js", "src/shared.js"]);

  const upserts = [];
  const ticketRef = { current: opts.ticket || makeTicket() };

  env.sandbox.StadtnetzCRM.supabaseClient = {
    customerCard: async () => ({ ok: false, reason: "not-configured" }),
    fetchSharedSettings: async () => ({ ok: false, reason: "not-configured" }),
    upsertTicketSummaryNote: async (input) => {
      upserts.push(input);
      return opts.upsertResult || { ok: true, id: `note-${upserts.length}`, created: upserts.length === 1 };
    }
  };
  env.sandbox.StadtnetzCRM.localAi = makeLocalAi();
  env.sandbox.StadtnetzCRM.jiraReader = { read: () => ticketRef.current, UNKNOWN };

  // rules.js liest app.jiraReader.UNKNOWN beim Laden – deshalb erst jetzt.
  loadScripts(env.sandbox, ["src/ai-cache.js", "src/rules.js", "src/ui.js"]);
  await env.sandbox.StadtnetzCRM.ui.mount();
  return { env, upserts, ticketRef, KEYS: env.sandbox.StadtnetzCRM.CONFIG.storageKeys };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function run() {
  // --- Zusammengefasst -> ohne Zutun in der Kundenakte -----------------------
  {
    const { env, upserts } = await mountPanel();
    await flush();

    assert.strictEqual(upserts.length, 1, "die fertige Zusammenfassung wandert von selbst in die Akte");
    const written = upserts[0];
    assert.strictEqual(written.ticketKey, "TNG-42");
    assert.strictEqual(written.customerNumber, "287246", "Kundennummer aus dem Oikonomikos-Feld des Tickets");
    assert.strictEqual(written.customerName, "Kevin Carlsson");
    assert.strictEqual(written.summary, SUMMARY_TEXT);
    assert.strictEqual(written.resolution.id, "offen", "\"In Bearbeitung\" ist ein offenes Ticket");
    assert.ok(env.html().includes("Kundenakte 287246"), "das Panel zeigt, was in der Akte gelandet ist");
    assert.ok(env.html().includes("Ticket offen"));

    // Kein zweiter Schreibvorgang, solange sich am Stand nichts ändert.
    env.sandbox.StadtnetzCRM.ui.refresh();
    await flush();
    assert.strictEqual(upserts.length, 1, "unveränderter Stand wird nicht erneut geschrieben");
  }

  // --- Ticket inzwischen erledigt -> Akte bekommt den neuen Stand ------------
  {
    const { env, upserts, ticketRef } = await mountPanel();
    await flush();
    assert.strictEqual(upserts[0].resolution.id, "offen");

    ticketRef.current = makeTicket({ status: "Erledigt", commentCount: 2, comments: ["Techniker beauftragt.", "Anschluss läuft wieder."] });
    env.sandbox.StadtnetzCRM.ui.refresh();
    await flush();

    assert.strictEqual(upserts.length, 2, "geänderter Ticketinhalt -> neue Zusammenfassung -> neuer Aktenstand");
    assert.strictEqual(upserts[1].resolution.id, "geschlossen", "\"Erledigt\" wird als geschlossen vermerkt");
    assert.strictEqual(upserts[1].resolution.raw, "Erledigt", "der Original-Jira-Status bleibt nachvollziehbar");
    assert.ok(env.html().includes("Ticket geschlossen"));
  }

  // --- Ohne Kundennummer keine Notiz ohne Akte -------------------------------
  {
    const { env, upserts } = await mountPanel({ ticket: makeTicket({ customerReference: UNKNOWN, customerName: UNKNOWN }) });
    await flush();

    assert.strictEqual(upserts.length, 0, "ohne Kundennummer gibt es keine Akte, in die die Notiz gehören würde");
    assert.ok(env.html().includes("Keine Kundennummer im Ticket"), "das Panel sagt, warum nichts gespeichert wurde");

    // Auch ein Klick auf den Button ändert daran nichts.
    env.click("save-summary-to-crm");
    await flush();
    assert.strictEqual(upserts.length, 0);
  }

  // --- Abgeschalteter Schalter: nur noch auf Klick ---------------------------
  {
    const env = makePanelSandbox();
    loadScripts(env.sandbox, ["src/config.js", "src/commission.js", "src/shared.js"]);
    const KEYS = env.sandbox.StadtnetzCRM.CONFIG.storageKeys;
    env.storage[KEYS.settings] = { syncTicketSummaryToCrm: false };

    const upserts = [];
    env.sandbox.StadtnetzCRM.supabaseClient = {
      customerCard: async () => ({ ok: false, reason: "not-configured" }),
      fetchSharedSettings: async () => ({ ok: false, reason: "not-configured" }),
      upsertTicketSummaryNote: async (input) => { upserts.push(input); return { ok: true, id: "note-1", created: true }; }
    };
    env.sandbox.StadtnetzCRM.localAi = makeLocalAi();
    env.sandbox.StadtnetzCRM.jiraReader = { read: () => makeTicket(), UNKNOWN };
    loadScripts(env.sandbox, ["src/ai-cache.js", "src/rules.js", "src/ui.js"]);
    await env.sandbox.StadtnetzCRM.ui.mount();
    await flush();

    assert.strictEqual(upserts.length, 0, "abgeschaltet wird nichts automatisch geschrieben");
    env.click("save-summary-to-crm");
    await flush();
    assert.strictEqual(upserts.length, 1, "von Hand geht es weiterhin");
  }

  // --- Fehler beim Schreiben: sichtbar, aber ohne Wiederholungsschleife ------
  {
    const { env, upserts } = await mountPanel({ upsertResult: { ok: false, reason: "not-logged-in" } });
    await flush();

    assert.strictEqual(upserts.length, 1);
    assert.ok(env.html().includes("Nicht am CRM angemeldet"), "der Grund steht im Panel");
    env.sandbox.StadtnetzCRM.ui.refresh();
    await flush();
    assert.strictEqual(upserts.length, 1, "kein automatischer Wiederholungsversuch bei gleichem Stand");
    env.click("save-summary-to-crm");
    await flush();
    assert.strictEqual(upserts.length, 2, "der Button versucht es erneut");
  }

  console.log("ui-summary-crm.test.js: alle Szenarien bestanden.");
}

run();
