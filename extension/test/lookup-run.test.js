"use strict";

// Tests für den kompletten Lauf der Netz-Auskunft (src/lookup.js) – also für
// genau die Dinge, die den Unterschied zwischen „geht manchmal" und „geht jedes
// Mal" machen und die man beim Lesen des Codes nicht nachprüfen kann:
//
//   1. Der Dashboard-Tab wird in den VORDERGRUND geholt (sonst drosselt Chrome
//      die Timer des Scrapers und jede Wartebedingung läuft in den Timeout).
//   2. Jeder Lauf beginnt auf der Startseite des Dashboards (zurückgesetzt),
//      damit ein zweiter Lauf nicht aus dem Endzustand des ersten startet.
//   3. Automatisiert wird erst, wenn ein FRISCHES Content-Script bestätigt, dass
//      dort wirklich das Dashboard steht – nicht die Login-Seite und nicht die
//      alte Seite von vor dem Zurücksetzen.
//   4. Ein Transportfehler (Seite räumt das Script mitten im Lauf ab) kostet
//      einen zweiten Anlauf, nicht den Vorgang.
//   5. Am Ende kehrt der Fokus zum Ausgangs-Tab (Jira) zurück.
//
// Ausführen mit: node test/lookup-run.test.js

const assert = require("assert");
const { makeWorkerSandbox, loadScripts } = require("./support/stub-env");

// Der Worker-Sandbox fehlen echte Timer (setTimeout feuert dort nicht von
// selbst). Für einen echten Ablauf braucht es sie – analog lookup-parse.test.js.
function withRealTimers(env) {
  env.sandbox.setTimeout = (fn, ms) => setTimeout(fn, ms);
  env.sandbox.clearTimeout = (id) => clearTimeout(id);
  env.sandbox.setInterval = (fn, ms) => setInterval(fn, ms);
  env.sandbox.clearInterval = (id) => clearInterval(id);
}

// Baut eine Umgebung mit freigeschalteter Netz-Auskunft, kurzen Zeitschranken
// und einem Dashboard-Tab im Hintergrund.
function setup(options) {
  const opts = options || {};
  const env = makeWorkerSandbox();
  withRealTimers(env);
  // config.js/shared.js zuerst: dadurch stehen die Storage-Schlüssel bereit,
  // bevor lookup.js geladen wird. So kann ein Test einen offenen Auftrag
  // hinterlegen, den lookup.js beim Start vorfindet (Worker-Start-Nachholung).
  loadScripts(env.sandbox, ["src/config.js", "src/shared.js"]);

  const app = env.sandbox.StadtnetzCRM;
  const KEYS = app.CONFIG.storageKeys;
  // Zeitschranken herunterdrehen, damit der Test in Millisekunden läuft und
  // nicht in den echten Sekunden-Fenstern der Produktion.
  Object.assign(app.CONFIG.lookups, {
    tabLoadTimeoutMs: 600,
    readyTimeoutMs: 2000,
    lookupTimeoutMs: 2000,
    heartbeatMs: 30
  });

  env.chrome.storage.local.set({ [KEYS.settings]: { enableLookups: true } });

  // Jira-Tab (Ausgangspunkt) + Dashboard-Tab im Hintergrund, auf einer
  // Unterseite – so wie ihn ein vorheriger Lauf hinterlässt.
  env.bus.tabs = [
    { id: 1, url: "https://jira.ennit.de/browse/TNG-1", status: "complete", windowId: 1, active: true },
    { id: 2, url: opts.dashUrl || "https://gfiz-dash.tng.de/vorgang/4711", status: "complete", windowId: 1, active: false }
  ];
  // Gelegenheit, vor dem Laden von lookup.js etwas zu hinterlegen.
  if (typeof opts.seed === "function") opts.seed(env, KEYS);
  loadScripts(env.sandbox, ["src/lookup.js"]);
  return { env, app, KEYS };
}

// Wartet, bis eine Bedingung zutrifft (oder die Frist abläuft) – die
// Auftragsannahme läuft asynchron und ohne Handle zum Awaiten.
async function until(condition, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 3000);
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

// Gegenstelle im Dashboard-Tab. `script` beschreibt, wie sich das
// Content-Script verhält; jeder Aufruf wird protokolliert.
function contentScript(env, script) {
  const seen = [];
  env.bus.tabHandler = (tabId, message) => {
    seen.push({ tabId, message });
    if (message.type === "sc-ping") {
      const ping = script.ping(seen.filter((s) => s.message.type === "sc-ping").length);
      return ping === undefined ? undefined : Object.assign({ ok: true, pong: true }, ping);
    }
    if (message.type === "sc-lookup-churn") {
      return script.lookup(seen.filter((s) => s.message.type === "sc-lookup-churn").length);
    }
    return undefined;
  };
  return seen;
}

// „nach dem Zurücksetzen gestartet". Muss bei jedem Ping neu berechnet werden –
// der Worker akzeptiert nur ein Script, dessen loadedAt nach dem Reset liegt.
const ready = () => ({ ready: true, loadedAt: Date.now() + 5000 });
const RESULT = { ok: true, data: { found: true, count: 1, cases: [{ vertrag: "1ABC" }] } };

async function run() {
  // --- 1. Erfolgreicher Lauf: Vordergrund, Reset, Ergebnis, Fokus zurück -----
  {
    const { env, KEYS } = setup();
    const seen = contentScript(env, { ping: ready, lookup: () => RESULT });

    const result = await env.sandbox.StadtnetzCRM.lookup.runLookup({
      requestId: "r1", kind: "churn", customerNumber: "287246", callerTabId: 1
    });

    assert.strictEqual(result.ok, true, "der Lauf ist erfolgreich");
    const stored = env.storage[KEYS.lookupResult];
    assert.strictEqual(stored.status, "ok");
    assert.strictEqual(stored.data.cases[0].vertrag, "1ABC", "das Ergebnis des Content-Scripts landet im Storage");

    // (1) Vordergrund: der Dashboard-Tab wurde aktiviert und sein Fenster fokussiert.
    assert.ok(
      env.calls.tabsUpdated.some((call) => call.id === 2 && call.info.active === true),
      "der Dashboard-Tab wird aktiviert – im Hintergrund drosselt Chrome die Timer des Scrapers"
    );
    assert.ok(env.calls.windowsFocused.some((call) => call.id === 1), "und sein Fenster fokussiert");

    // (2) Reset: der Tab stand auf einer Unterseite → Navigation auf die Startseite.
    assert.ok(
      env.calls.tabsUpdated.some((call) => call.id === 2 && call.info.url === "https://gfiz-dash.tng.de/"),
      "der Tab wird auf die Startseite des Dashboards zurückgesetzt"
    );

    // (3) Erst Ping, dann Automatisierung – nie umgekehrt.
    assert.strictEqual(seen[0].message.type, "sc-ping", "zuerst wird die Bereitschaft geprüft");
    assert.ok(seen.some((s) => s.message.type === "sc-lookup-churn"), "danach läuft die Abfrage");
    const lookupCall = seen.find((s) => s.message.type === "sc-lookup-churn");
    assert.strictEqual(lookupCall.message.customerNumber, "287246");
    assert.strictEqual(lookupCall.message.requestId, "r1");

    // (5) Fokus zurück auf den Ausgangs-Tab.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(
      env.calls.tabsUpdated.some((call) => call.id === 1 && call.info.active === true),
      "am Ende kehrt der Fokus zum Jira-Tab zurück"
    );

    // Lebenszeichen: hält den Worker wach und frischt updatedAt auf.
    assert.ok(env.calls.platformInfo.length > 0, "während des Laufs schlägt der Heartbeat");
  }

  // --- 2. Login-Seite: erkannt, benannt, KEINE Automatisierung ---------------
  {
    const { env, KEYS } = setup();
    // Script antwortet, aber das Dashboard ist nicht zu sehen (Login/SSO).
    const seen = contentScript(env, {
      ping: () => ({ ready: false, loadedAt: Date.now() + 5000 }),
      lookup: () => RESULT
    });

    const result = await env.sandbox.StadtnetzCRM.lookup.runLookup({
      requestId: "r2", kind: "churn", customerNumber: "1", callerTabId: 1
    });

    assert.strictEqual(result.ok, false);
    const stored = env.storage[KEYS.lookupResult];
    assert.strictEqual(stored.status, "error");
    assert.ok(/angemeldet/i.test(stored.error), `Fehler nennt die Anmeldung, nicht „Zeitüberschreitung“: ${stored.error}`);
    assert.ok(
      !seen.some((s) => s.message.type === "sc-lookup-churn"),
      "ohne sichtbares Dashboard wird nichts automatisiert"
    );
  }

  // --- 3. Kein Content-Script: eigene, umsetzbare Meldung --------------------
  {
    const { env, KEYS } = setup();
    env.bus.tabHandler = null; // niemand antwortet → "receiving end does not exist"

    const result = await env.sandbox.StadtnetzCRM.lookup.runLookup({
      requestId: "r3", kind: "churn", customerNumber: "1", callerTabId: 1
    });

    assert.strictEqual(result.ok, false);
    assert.ok(/meldet sich nicht/i.test(env.storage[KEYS.lookupResult].error), "eigene Meldung für ein fehlendes Content-Script");
  }

  // --- 4. Transportfehler mitten im Lauf → zweiter Anlauf rettet den Vorgang -
  {
    const { env, KEYS } = setup();
    const seen = contentScript(env, {
      ping: ready,
      // Erster Versuch: die Seite räumt das Script ab, während es läuft.
      lookup: (nth) => (nth === 1
        ? { ok: false, error: "The message port closed before a response was received." }
        : RESULT)
    });

    const result = await env.sandbox.StadtnetzCRM.lookup.runLookup({
      requestId: "r4", kind: "churn", customerNumber: "42", callerTabId: 1
    });

    assert.strictEqual(result.ok, true, "der zweite Anlauf bringt das Ergebnis");
    assert.strictEqual(env.storage[KEYS.lookupResult].status, "ok");
    assert.strictEqual(
      seen.filter((s) => s.message.type === "sc-lookup-churn").length, 2,
      "es wurde genau zweimal angesetzt (attempts: 2)"
    );
    // Der zweite Anlauf beginnt wieder mit einem Reset, nicht mitten im Zustand.
    assert.ok(
      env.calls.tabsReloaded.length + env.calls.tabsUpdated.filter((c) => c.id === 2 && c.info.url).length >= 2,
      "auch der zweite Anlauf setzt den Tab zurück"
    );
  }

  // --- 5. Echter Fehler des Scrapers wird NICHT wiederholt, sondern gemeldet -
  {
    const { env, KEYS } = setup();
    const seen = contentScript(env, {
      ping: ready,
      lookup: () => ({ ok: false, error: "Suchfeld nicht gefunden – ist das GFIZ-Dashboard wirklich geöffnet?" })
    });

    const result = await env.sandbox.StadtnetzCRM.lookup.runLookup({
      requestId: "r5", kind: "churn", customerNumber: "42", callerTabId: 1
    });

    assert.strictEqual(result.ok, false);
    assert.ok(/Suchfeld/.test(env.storage[KEYS.lookupResult].error), "der Fehler des Scrapers wird durchgereicht");
    assert.strictEqual(
      seen.filter((s) => s.message.type === "sc-lookup-churn").length, 1,
      "ein sachlicher Fehler wird nicht sinnlos wiederholt"
    );
  }

  // --- 6. Kein Dashboard-Tab offen: einer wird geöffnet ----------------------
  {
    const { env } = setup();
    env.bus.tabs = [{ id: 1, url: "https://jira.ennit.de/browse/TNG-1", status: "complete", windowId: 1, active: true }];
    contentScript(env, { ping: ready, lookup: () => RESULT });

    const result = await env.sandbox.StadtnetzCRM.lookup.runLookup({
      requestId: "r6", kind: "churn", customerNumber: "7", callerTabId: 1
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(env.calls.tabsCreated.length, 1, "der Dashboard-Tab wird geöffnet");
    assert.strictEqual(env.calls.tabsCreated[0].url, "https://gfiz-dash.tng.de/");
    assert.strictEqual(env.calls.tabsCreated[0].active, true, "und zwar im Vordergrund");
  }

  // --- 7. Der Auftrag trägt auch ohne Nachricht (Storage-Weg) ---------------
  // Das ist der Kern gegen „es passiert gar nichts": chrome.runtime.sendMessage
  // ist ein Zuruf ohne Zustellgarantie. Schläft der Worker oder ist er beim
  // Laden gescheitert, ist die Nachricht weg. Ein Storage-Eintrag weckt ihn.
  {
    const { env, KEYS } = setup();
    const seen = contentScript(env, { ping: ready, lookup: () => RESULT });

    env.chrome.storage.local.set({
      [KEYS.lookupRequest]: {
        requestId: "s1", kind: "churn", customerNumber: "999", source: "panel", createdAt: Date.now()
      }
    });

    const done = await until(() => {
      const r = env.storage[KEYS.lookupResult];
      return r && r.requestId === "s1" && r.status === "ok";
    }, 5000);
    assert.ok(done, "der Auftrag aus dem Storage läuft von selbst durch");
    assert.ok(seen.some((s) => s.message.type === "sc-lookup-churn"), "das Dashboard wurde tatsächlich abgefragt");
    assert.ok(!env.storage[KEYS.lookupRequest], "und der Auftrag ist aus der Warteschlange genommen");
  }

  // --- 8. Beim Worker-Start liegen gebliebene Aufträge nachholen ------------
  // Der Klick weckt den Worker erst; bis lookup.js läuft, ist die Nachricht
  // längst verfallen. Der Eintrag im Storage nicht.
  {
    const { env, KEYS } = setup({
      seed: (e, K) => {
        e.chrome.storage.local.set({
          [K.lookupRequest]: {
            requestId: "b1", kind: "churn", customerNumber: "777", source: "panel", createdAt: Date.now()
          }
        });
      }
    });
    contentScript(env, { ping: ready, lookup: () => RESULT });

    const done = await until(() => {
      const r = env.storage[KEYS.lookupResult];
      return r && r.requestId === "b1" && r.status === "ok";
    }, 5000);
    assert.ok(done, "ein beim Start vorgefundener Auftrag wird nachgeholt");
  }

  // --- 9. Nachricht UND Storage-Ereignis starten nur EINEN Lauf -------------
  {
    const { env, KEYS } = setup();
    const seen = contentScript(env, { ping: ready, lookup: () => RESULT });
    const request = { requestId: "d1", kind: "churn", customerNumber: "5", source: "panel", createdAt: Date.now() };

    // Beide Wege gleichzeitig, genau wie im Betrieb.
    env.chrome.storage.local.set({ [KEYS.lookupRequest]: request });
    env.sandbox.StadtnetzCRM.lookup.claimJob(request, "Nachricht");

    await until(() => {
      const r = env.storage[KEYS.lookupResult];
      return r && r.requestId === "d1" && r.status === "ok";
    }, 5000);
    await new Promise((resolve) => setTimeout(resolve, 300)); // einem zweiten Lauf Zeit geben, sich zu zeigen
    assert.strictEqual(
      seen.filter((s) => s.message.type === "sc-lookup-churn").length, 1,
      "der Auftrag läuft genau einmal – nicht zweimal mit zwei Tabs"
    );
  }

  // --- 10. Ein vergessener Auftrag öffnet nicht später ein Dashboard --------
  {
    const { env, KEYS } = setup({
      seed: (e, K) => {
        e.chrome.storage.local.set({
          [K.lookupRequest]: {
            requestId: "old", kind: "churn", customerNumber: "1", source: "panel",
            createdAt: Date.now() - 600000 // zehn Minuten alt
          }
        });
      }
    });
    const seen = contentScript(env, { ping: ready, lookup: () => RESULT });

    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.ok(!seen.length, "ein veralteter Auftrag wird nicht mehr ausgeführt");
    assert.strictEqual(env.calls.tabsCreated.length, 0, "und öffnet erst recht kein Dashboard");
    assert.ok(!env.storage[KEYS.lookupRequest], "er wird dabei aufgeräumt");
  }

  // --- 11. Jeder Auftrag endet sichtbar – nie stilles „läuft" ---------------
  // Selbst wenn die Tab-API selbst versagt: es muss eine lesbare Fehlermeldung
  // im Ergebnis stehen, nicht ein für immer laufender Zustand.
  {
    const { env, KEYS } = setup();
    env.bus.tabs = []; // kein Dashboard-Tab offen …
    env.sandbox.chrome.tabs.create = () => { throw new Error("Tab-API kaputt"); };

    const result = await env.sandbox.StadtnetzCRM.lookup.runLookup({
      requestId: "x1", kind: "churn", customerNumber: "1", callerTabId: 1
    });

    assert.strictEqual(result.ok, false);
    const stored = env.storage[KEYS.lookupResult];
    assert.strictEqual(stored.status, "error", "der Zustand bleibt nicht auf „läuft“ stehen");
    assert.ok(stored.error && stored.error.length > 20, `mit einer erklärenden Meldung: ${stored.error}`);
  }

  // --- 12. Die Annahme ist für das Panel erkennbar --------------------------
  // phase !== "queued" ist der Beweis, dass der Hintergrund-Dienst lebt. Genau
  // daran erkennt das Panel den Fall „Dienst läuft gar nicht".
  {
    const { env, KEYS } = setup();
    contentScript(env, { ping: ready, lookup: () => RESULT });
    const phases = [];
    env.bus.listeners.push((changes) => {
      const entry = changes[KEYS.lookupResult];
      if (entry && entry.newValue && entry.newValue.phase) phases.push(entry.newValue.phase);
    });

    await env.sandbox.StadtnetzCRM.lookup.runLookup({
      requestId: "p1", kind: "churn", customerNumber: "1", callerTabId: 1
    });

    assert.ok(phases.length, "der Worker meldet Abschnitte");
    assert.ok(phases[0] !== "queued", "der erste gemeldete Abschnitt ist bereits die Annahme");
    assert.ok(phases.includes("tab"), "inklusive „Tab öffnen“ – sichtbar, bevor irgendetwas dauern kann");
    assert.strictEqual(phases[phases.length - 1], "done", "und am Ende steht „fertig“");
  }

  // --- 13. Zwei Aufträge gleichzeitig teilen sich nicht einen Tab ----------
  // Zwei offene Jira-Tabs (oder ein Doppelklick) dürfen nicht zwei Läufe
  // starten, die sich denselben Dashboard-Tab wegziehen.
  {
    const { env, KEYS } = setup();
    const seen = contentScript(env, {
      ping: ready,
      lookup: () => new Promise((resolve) => setTimeout(() => resolve(RESULT), 400))
    });
    const app = env.sandbox.StadtnetzCRM;

    const first = app.lookup.claimJob(
      { requestId: "c1", kind: "churn", customerNumber: "1", createdAt: Date.now() }, "Tab A");
    await new Promise((resolve) => setTimeout(resolve, 50));
    await app.lookup.claimJob(
      { requestId: "c2", kind: "churn", customerNumber: "2", createdAt: Date.now() }, "Tab B");

    // Der zweite Auftrag wird sauber abgelehnt – mit sichtbarer Begründung.
    const rejected = env.storage[KEYS.lookupResult];
    assert.strictEqual(rejected.requestId, "c2");
    assert.strictEqual(rejected.status, "error");
    assert.ok(/bereits eine Abfrage/i.test(rejected.error), "der zweite Auftrag wird begründet abgelehnt");

    await first;
    assert.strictEqual(
      seen.filter((s) => s.message.type === "sc-lookup-churn").length, 1,
      "nur der erste Auftrag hat das Dashboard angefasst"
    );
  }

  // --- 14. Kündiger gefunden → Ticket öffnet sich von selbst (Winback) ------
  // Der nächste Handgriff ist immer derselbe: Kündigungsticket aufmachen und
  // nachlesen, woran es lag. Die Churnliste führt die Ticketnummer selbst.
  {
    const { env, KEYS } = setup();
    const churnHit = {
      ok: true,
      data: {
        found: true, count: 1, customerNumber: "287246",
        cases: [{
          vertrag: "152P", ursache: "nicht erreicht", winback: "nicht erfolgreich",
          dealcloser: "", eingang: "10.06.2026 13:47:34",
          jiraTicket: "TNG-1407030", jiraHref: "https://jira.ennit.de/browse/TNG-1407030", kommentar: ""
        }]
      }
    };
    contentScript(env, { ping: ready, lookup: () => churnHit });

    const result = await env.sandbox.StadtnetzCRM.lookup.runLookup({
      requestId: "w1", kind: "churn", customerNumber: "287246", callerTabId: 1
    });
    assert.strictEqual(result.ok, true);

    const opened = env.calls.tabsCreated.find((tab) => /TNG-1407030/.test(tab.url || ""));
    assert.ok(opened, "das Kündigungsticket aus der Churnliste wird geöffnet");
    assert.strictEqual(opened.active, true, "und zwar im Vordergrund");

    const stored = env.storage[KEYS.lookupResult];
    assert.ok(/TNG-1407030/.test(stored.openedTicket), "das Panel erfährt, welches Ticket geöffnet wurde");
    // Die Kündigungsdaten müssen im Storage stehen, BEVOR der Tab aufgeht –
    // sonst baut das Panel dort seine Vorbereitung ohne den Kündigungsgrund.
    assert.strictEqual(stored.data.cases[0].ursache, "nicht erreicht");
    assert.strictEqual(stored.data.cases[0].winback, "nicht erfolgreich");

    // Der Fokus bleibt beim Ticket – nicht zurück auf den Ausgangs-Tab.
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.ok(
      !env.calls.tabsUpdated.some((call) => call.id === 1 && call.info.active === true),
      "der Fokus wird NICHT zurückgeholt – sonst wäre das Ticket sofort wieder verdeckt"
    );
  }

  // --- 15. Ohne Treffer wird nichts geöffnet -------------------------------
  {
    const { env } = setup();
    contentScript(env, {
      ping: ready,
      lookup: () => ({ ok: true, data: { found: false, count: 0, cases: [] } })
    });

    await env.sandbox.StadtnetzCRM.lookup.runLookup({
      requestId: "w2", kind: "churn", customerNumber: "1", callerTabId: 1
    });
    assert.ok(
      !env.calls.tabsCreated.some((tab) => /jira/i.test(tab.url || "")),
      "kein Kündiger, kein Ticket – es wird nichts ungefragt geöffnet"
    );
  }

  console.log("lookup-run.test.js: alle Szenarien bestanden.");
}

run().catch((error) => { console.error(error); process.exit(1); });
