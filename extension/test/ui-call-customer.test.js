"use strict";

// Wer ruft da an — und schreibt das Ergebnis noch auf die richtige Zeile?
//
// Zwei Zusagen, die zusammengehören und beide still brechen können:
//
//   1. Die Telefonanlage liefert den Kunden im Displaynamen mit ("PK 182962
//      Daniel Ratcliffe"). Kommt er im Panel nicht an, sieht man das nicht als
//      Fehler, sondern als leere Kundenakte — und hält den Kunden für unbekannt.
//   2. Nach dem Auflegen bleibt Zeit für die Ergebnis-Erfassung. Verfällt das
//      Gespräch vorher (CONFIG.call.staleAfterMs, 15 s), wird die Disposition
//      ins Leere geschrieben. Auch das meldet niemand.
//
// Ausführen mit: node test/ui-call-customer.test.js

const assert = require("assert");
const { makePanelSandbox, loadScripts } = require("./support/stub-env");

function makeStub(recorded, options) {
  const opts = options || {};
  return {
    customerCard: async (number) => {
      recorded.cards.push(number);
      return { ok: true, data: { customerNumber: number, name: "Daniel Ratcliffe", phone: "", firstSeenAt: "2026-01-01", lastContactAt: "", contractCount: 2, tariffChangeCount: 0, noteCount: 1, leadCount: 0, jiraTicket: "" } };
    },
    customerByPhone: async (phone) => {
      recorded.lookups.push(phone);
      if (opts.lookup) return opts.lookup;
      return { ok: true, matches: [] };
    },
    patchCallCustomer: async (id, number) => { recorded.patchedCustomer.push({ id, number }); return { ok: true }; },
    patchCallDisposition: async (id, patch) => { recorded.patched.push({ id, ...patch }); return { ok: true }; },
    recentCalls: async () => ({ ok: true, rows: [] }),
    fetchSharedSettings: async () => ({ ok: true, data: { products: [], tariffCommission: {} } }),
    fetchCurrentShift: async () => ({ ok: true, data: {} }),
    insertNote: async () => ({ ok: true, id: "note-1" })
  };
}

async function mountPanel(recorded, options) {
  const env = makePanelSandbox();
  loadScripts(env.sandbox, ["src/config.js", "src/commission.js", "src/shared.js"]);
  env.sandbox.StadtnetzCRM.supabaseClient = makeStub(recorded, options);
  loadScripts(env.sandbox, ["src/ai-cache.js", "src/jira-reader.js", "src/rules.js", "src/theme.js", "src/ui.js"]);
  await env.sandbox.StadtnetzCRM.ui.mount();
  return { env, KEYS: env.sandbox.StadtnetzCRM.CONFIG.storageKeys };
}

function makeRecorded() {
  return { cards: [], lookups: [], patched: [], patchedCustomer: [] };
}

// Ein Anruf, wie ihn desktop/renderer/call-session.js schreibt.
function anlagenCall(overrides) {
  return Object.assign({
    status: "connected",
    callId: "myapps-1",
    source: "myapps",
    callerName: "Daniel Ratcliffe",
    callerNumber: "+4970310000000",
    customerNumber: "182962",
    kundenart: "PK",
    dbCallId: "row-1",
    connectedAt: Date.now(),
    updatedAt: Date.now()
  }, overrides || {});
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function run() {
  // --- Die Anlage kennt den Kunden: die Akte steht ohne Zutun da -----------
  {
    const recorded = makeRecorded();
    const { env, KEYS } = await mountPanel(recorded);
    env.sandbox.chrome.storage.local.set({ [KEYS.activeCall]: anlagenCall() });
    await flush();

    assert.deepStrictEqual(recorded.cards, ["182962"],
      "die Kundenakte wird genau einmal geladen – für die Nummer aus dem Displaynamen");
    assert.strictEqual(recorded.lookups.length, 0,
      "und die Rufnummernsuche läuft gar nicht erst an");

    // Der eigentliche Punkt: der gemeinsame Schlüssel wird geschrieben. Davon
    // leben das Cockpit UND die Kundenzuordnung der Notizen – in der Auskunft
    // hat ihn bisher niemand gefüllt.
    const card = env.storage[KEYS.customerCard];
    assert.ok(card, "die Kundenakte landet im gemeinsamen Storage-Schlüssel");
    assert.strictEqual(card.customerNumber, "182962");
    assert.strictEqual(card.status, "ok");

    env.click("switch-tab", { tab: "talk" });
    assert.ok(env.html().includes("Privatkunde"), "die Kundenart steht im Gesprächskopf");
    assert.ok(env.html().includes("182962"), "und die Kundennummer");
    assert.ok(env.html().includes("aus der Telefonanlage"),
      "die Herkunft wird benannt – „aus timio“ wäre hier schlicht falsch");
  }

  // --- Unbekannter Anrufer, ein Treffer über die Rufnummer -----------------
  {
    const recorded = makeRecorded();
    const { env, KEYS } = await mountPanel(recorded, {
      lookup: { ok: true, matches: [{ customerNumber: "182962", name: "Daniel Ratcliffe", source: "Kundenstamm" }] }
    });
    env.sandbox.chrome.storage.local.set({
      [KEYS.activeCall]: anlagenCall({ customerNumber: "", kundenart: "", callerName: "Unbekannt" })
    });
    await flush();
    await flush();

    assert.deepStrictEqual(recorded.lookups, ["+4970310000000"], "gesucht wird über die Rufnummer");
    assert.deepStrictEqual(recorded.patchedCustomer, [{ id: "row-1", number: "182962" }],
      "der eindeutige Treffer wird auf die Zeile in der Historie nachgezogen");
    assert.strictEqual(env.storage[KEYS.activeCall].customerNumber, "182962",
      "und in den gemeinsamen Schlüssel geschrieben, damit die Auskunft ihn übernimmt");
  }

  // --- Mehrere Treffer: die Auswahl gehört dem Menschen --------------------
  {
    const recorded = makeRecorded();
    const { env, KEYS } = await mountPanel(recorded, {
      lookup: { ok: true, matches: [
        { customerNumber: "182962", name: "Daniel Ratcliffe", source: "Kundenstamm" },
        { customerNumber: "182963", name: "Marta Ratcliffe", source: "Lead" }
      ] }
    });
    env.sandbox.chrome.storage.local.set({
      [KEYS.activeCall]: anlagenCall({ customerNumber: "", kundenart: "" })
    });
    await flush();
    await flush();

    assert.strictEqual(recorded.patchedCustomer.length, 0,
      "bei zwei möglichen Kunden wird KEINER von selbst zugeordnet");
    env.click("switch-tab", { tab: "talk" });
    assert.ok(env.html().includes("Mehrere Kunden zu dieser Rufnummer"), "stattdessen steht die Frage da");
    assert.ok(env.html().includes("182963"), "beide Kandidaten sind wählbar");

    env.click("assign-customer", { customerNumber: "182963", customerName: "Marta Ratcliffe" });
    await flush();
    assert.deepStrictEqual(recorded.patchedCustomer, [{ id: "row-1", number: "182963" }],
      "erst der Klick ordnet zu");
    assert.strictEqual(env.storage[KEYS.activeCall].callerName, "Marta Ratcliffe");
  }

  // --- Kein Treffer: von Hand geht immer ----------------------------------
  {
    const recorded = makeRecorded();
    const { env, KEYS } = await mountPanel(recorded, { lookup: { ok: true, matches: [] } });
    env.sandbox.chrome.storage.local.set({
      [KEYS.activeCall]: anlagenCall({ customerNumber: "", kundenart: "" })
    });
    await flush();
    await flush();

    env.click("switch-tab", { tab: "talk" });
    assert.ok(env.html().includes("Kundennummer zuordnen"), "das Feld für die Zuordnung von Hand steht bereit");
    assert.ok(env.html().includes("Telefonanlage kennt diesen Anrufer nicht"), "und der Grund dazu");
  }

  // --- Ein Anruf aus timio wird NICHT angefasst ---------------------------
  {
    const recorded = makeRecorded();
    const { env, KEYS } = await mountPanel(recorded, {
      lookup: { ok: true, matches: [{ customerNumber: "999", name: "Falsch", source: "Kundenstamm" }] }
    });
    env.sandbox.chrome.storage.local.set({
      [KEYS.activeCall]: anlagenCall({ source: undefined, customerNumber: "" })
    });
    await flush();
    await flush();

    assert.strictEqual(recorded.lookups.length, 0,
      "bei timio liest das Content-Script die Kundennummer selbst – hier wäre eine zweite Suche nur Lärm");
    assert.ok(!env.storage[KEYS.customerCard],
      "und der gemeinsame Schlüssel bleibt dem timio-Cockpit überlassen, sonst überschreiben sich zwei Schreiber");
  }

  // --- Der Kern: das Ergebnis nach dem Auflegen ----------------------------
  {
    const recorded = makeRecorded();
    const { env, KEYS } = await mountPanel(recorded);
    env.sandbox.chrome.storage.local.set({ [KEYS.activeCall]: anlagenCall() });
    await flush();

    // Auflegen.
    env.click("end-call");
    await flush();
    assert.strictEqual(env.storage[KEYS.activeCall].status, "ended");
    assert.strictEqual(typeof env.storage[KEYS.activeCall].durationS, "number",
      "die Sekundenzahl für die Datenbank steht neben dem Anzeigetext");
    assert.ok(env.storage[KEYS.lastCall], "das beendete Gespräch wird festgehalten");

    // Und jetzt der Fall, um den es geht: der Anruf ist längst „veraltet",
    // weil die Anlage nach dem Auflegen nichts mehr meldet. Ohne das
    // Erfassungsfenster fände der Klick keine Zeile mehr.
    const stale = { ...env.storage[KEYS.activeCall], updatedAt: Date.now() - 60000 };
    env.sandbox.chrome.storage.local.set({ [KEYS.activeCall]: stale });
    env.sandbox.StadtnetzCRM.ui.rerender();

    env.click("call-outcome", { outcome: "reached-done" });
    await flush();

    assert.strictEqual(recorded.patched.length, 1,
      "eine Minute nach dem Auflegen landet die Disposition immer noch auf der Zeile");
    assert.strictEqual(recorded.patched[0].id, "row-1", "und zwar auf der richtigen");
  }

  // --- Die Suche ist schneller als das Anlegen der Zeile ------------------
  //
  // Bei unbekanntem Anrufer laufen zwei Dinge gleichzeitig: die Auskunft legt
  // die Zeile in `calls` an, das Panel sucht den Kunden. Ist die Suche zuerst
  // fertig, gibt es noch keine Zeilen-ID — und ein einmaliger Versuch ginge
  // ins Leere. Der Anruf bliebe in der Auswertung herrenlos, obwohl im Cockpit
  // der richtige Kunde stand.
  {
    const recorded = makeRecorded();
    const { env, KEYS } = await mountPanel(recorded, {
      lookup: { ok: true, matches: [{ customerNumber: "182962", name: "Daniel Ratcliffe", source: "Kundenstamm" }] }
    });

    // Der Anruf kommt an, bevor die Zeile existiert (dbCallId fehlt noch).
    env.sandbox.chrome.storage.local.set({
      [KEYS.activeCall]: anlagenCall({ customerNumber: "", kundenart: "", dbCallId: undefined })
    });
    await flush();
    await flush();

    assert.strictEqual(recorded.patchedCustomer.length, 0, "ohne Zeilen-ID lässt sich nichts nachziehen");
    assert.strictEqual(env.storage[KEYS.activeCall].customerNumber, "182962",
      "im Cockpit steht der Kunde aber schon");

    // Jetzt trifft die Zeilen-ID ein – die Auskunft schreibt sie in denselben
    // Schlüssel, sobald Supabase geantwortet hat.
    env.sandbox.chrome.storage.local.set({
      [KEYS.activeCall]: { ...env.storage[KEYS.activeCall], dbCallId: "row-spaet", updatedAt: Date.now() }
    });
    await flush();

    assert.deepStrictEqual(recorded.patchedCustomer, [{ id: "row-spaet", number: "182962" }],
      "die Zuordnung wird nachgeholt, sobald es eine Zeile gibt");
  }

  // --- Ein beendetes Gespräch wird durch eine Zuordnung nicht wieder aktiv -
  {
    const recorded = makeRecorded();
    const { env, KEYS } = await mountPanel(recorded, { lookup: { ok: true, matches: [] } });
    env.sandbox.chrome.storage.local.set({
      [KEYS.activeCall]: anlagenCall({ status: "ended", customerNumber: "", finalDuration: "1:00", durationS: 60 })
    });
    await flush();

    // Aufgelegt und veraltet – das Cockpit ist weg, die Erfassung läuft noch.
    env.sandbox.chrome.storage.local.set({
      [KEYS.activeCall]: { ...env.storage[KEYS.activeCall], updatedAt: Date.now() - 60000 }
    });
    env.sandbox.StadtnetzCRM.ui.rerender();

    env.click("assign-customer", { customerNumber: "182962", customerName: "Daniel Ratcliffe" });
    await flush();

    assert.strictEqual(env.storage[KEYS.activeCall].updatedAt < Date.now() - 30000, true,
      "der aktive Anruf wird NICHT aufgefrischt – sonst käme das Cockpit für ein beendetes Gespräch zurück");
    assert.strictEqual(env.storage[KEYS.lastCall].customerNumber, "182962",
      "die Zuordnung landet beim beendeten Gespräch");
    assert.deepStrictEqual(recorded.patchedCustomer, [{ id: "row-1", number: "182962" }],
      "und auf der Zeile in der Historie");
  }

  console.log("ui-call-customer.test.js: alle Szenarien bestanden.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
