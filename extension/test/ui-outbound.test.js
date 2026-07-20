"use strict";

// Outbound-Modus im Jira-Panel (src/ui.js): Richtungsschalter, modusabhängiger
// Leitfaden, Rückrufliste und die Ergebnis-Erfassung nach dem Gespräch.
//
// Deckt bewusst die Stellen ab, an denen der Modus die Oberfläche umschaltet –
// dort sitzen die stillen Fehler: ein Kopier-Button, der weiter in die
// Inbound-Liste indiziert, oder eine Einstellung, die beim Speichern
// verlorengeht, fällt sonst niemandem auf.
//
// Ausführen mit: node test/ui-outbound.test.js

const assert = require("assert");
const { makePanelSandbox, loadScripts } = require("./support/stub-env");

const SCRIPTS = [
  "src/config.js",
  "src/shared.js",
  "src/ai-cache.js",
  "src/jira-reader.js",
  "src/rules.js",
  "src/local-ai.js",
  "src/ui.js"
];

async function mountPanel(options) {
  const env = makePanelSandbox(options);
  loadScripts(env.sandbox, SCRIPTS);
  await env.sandbox.SupportCopilot.ui.mount();
  return { env, CONFIG: env.sandbox.SupportCopilot.CONFIG, KEYS: env.sandbox.SupportCopilot.CONFIG.storageKeys };
}

async function run() {
  // --- Richtungsschalter ----------------------------------------------------
  {
    const { env, KEYS } = await mountPanel();

    assert.ok(env.html().includes('data-action="set-call-mode"'), "der Richtungsschalter steht im Panel-Kopf");
    assert.ok(env.html().includes("Call-Hilfe"), "im Normalfall heißt der Tab Call-Hilfe");
    assert.ok(!env.html().includes(">Outbound<"), "und noch nicht Outbound");

    env.click("set-call-mode", { mode: "outbound" });
    assert.strictEqual(env.storage[KEYS.callMode], "outbound", "die Richtung wird für das timio-Cockpit veröffentlicht");
    assert.ok(env.html().includes(">Outbound<"), "der Tab heißt jetzt Outbound – die Richtung ist auch ohne Blick auf den Schalter sichtbar");

    env.click("set-call-mode", { mode: "inbound" });
    assert.strictEqual(env.storage[KEYS.callMode], "inbound", "zurückschalten funktioniert ebenso");
  }

  // --- Richtung kommt aus dem timio-Cockpit --------------------------------
  {
    const { env, KEYS } = await mountPanel();
    // Beide Seiten zeigen denselben Schalter; wird er in timio umgelegt, muss
    // das Panel nachziehen, ohne dass jemand neu lädt.
    env.sandbox.chrome.storage.local.set({ [KEYS.callMode]: "outbound" });
    assert.ok(env.html().includes(">Outbound<"), "ein Moduswechsel aus timio schlägt im Panel durch");
  }

  // --- Gemerkte Richtung überlebt den Reload -------------------------------
  {
    const env = makePanelSandbox();
    loadScripts(env.sandbox, SCRIPTS);
    const KEYS = env.sandbox.SupportCopilot.CONFIG.storageKeys;
    env.storage[KEYS.callMode] = "outbound";
    await env.sandbox.SupportCopilot.ui.mount();
    assert.ok(env.html().includes(">Outbound<"), "die zuletzt gewählte Richtung wird beim Laden übernommen");
  }

  // --- Leitfaden und Einwandkarten wechseln mit ----------------------------
  {
    const { env, CONFIG } = await mountPanel();
    // Titel enthalten Zeichen wie "&", die im Markup escaped landen – deshalb
    // mit derselben Funktion vergleichen, die auch das Panel benutzt.
    const escapeHtml = env.sandbox.SupportCopilot.shared.escapeHtml;
    env.click("switch-tab", { tab: "call" });

    const inboundFirst = escapeHtml(CONFIG.callGuides.inbound[0].title);
    const outboundFirst = escapeHtml(CONFIG.callGuides.outbound[0].title);
    assert.ok(env.html().includes(inboundFirst), "eingehend steht der Inbound-Leitfaden im Call-Tab");
    assert.ok(!env.html().includes(outboundFirst), "und nicht der Outbound-Leitfaden");

    env.click("set-call-mode", { mode: "outbound" });
    assert.ok(env.html().includes(outboundFirst), "ausgehend erscheint der Outbound-Leitfaden");
    assert.ok(!env.html().includes(inboundFirst), "der Inbound-Leitfaden verschwindet");
    assert.ok(env.html().includes(escapeHtml(CONFIG.objectionCards.outbound[0].title)), "auch die Einwandkarten wechseln mit");
    assert.ok(env.html().includes('data-action="generate-call-prep"'), "die Gesprächsvorbereitung erscheint nur im Outbound-Modus prominent");
  }

  // --- Kopier-Buttons greifen in den AKTIVEN Leitfaden ---------------------
  {
    const { env, CONFIG } = await mountPanel();
    env.click("switch-tab", { tab: "call" });
    env.click("set-call-mode", { mode: "outbound" });

    // Der stille Fehler wäre hier: der Button indiziert weiter in die
    // Inbound-Liste und kopiert im Outbound-Modus den falschen Satz.
    env.click("copy-call-phase", { phaseIndex: "0" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(env.copied.slice(-1)[0], CONFIG.callGuides.outbound[0].prompt, "kopiert wird der Outbound-Satz, nicht der Inbound-Satz");

    env.click("copy-objection", { objectionIndex: "0" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(env.copied.slice(-1)[0], CONFIG.objectionCards.outbound[0].text, "dasselbe gilt für die Einwandkarten");
  }

  // --- Rückrufliste ---------------------------------------------------------
  {
    const { env, KEYS } = await mountPanel();
    env.click("switch-tab", { tab: "call" });

    assert.ok(env.html().includes("Keine offenen Rückrufe"), "die Liste startet leer");

    env.click("add-callback");
    const stored = env.storage[KEYS.callbacks];
    assert.ok(stored && stored.items.length === 1, "das offene Ticket landet auf der Rückrufliste");
    assert.strictEqual(stored.items[0].ticketKey, "TNG-1592568", "mit dem Ticket-Key aus der Adresszeile");
    assert.ok(stored.items[0].dueAt > Date.now(), "und mit einer Fälligkeit in der Zukunft");
    assert.ok(env.html().includes("TNG-1592568"), "der Eintrag ist im Panel sichtbar");

    // Kein zweiter Eintrag fürs selbe Ticket – sonst wächst die Liste bei
    // jedem Klick und enthält Dubletten mit Rufnummern.
    const id = stored.items[0].id;
    env.click("add-callback");
    assert.strictEqual(env.storage[KEYS.callbacks].items.length, 1, "dasselbe Ticket erzeugt keine Dublette");

    env.click("snooze-callback", { callbackId: id, snooze: "3600000" });
    assert.ok(env.storage[KEYS.callbacks].items[0].dueAt > Date.now() + 3000000, "verschieben schiebt die Fälligkeit nach hinten");

    env.click("complete-callback", { callbackId: id });
    assert.strictEqual(env.storage[KEYS.callbacks].items.length, 0, "erledigte Rückrufe verschwinden sofort – sie enthalten Rufnummern");
  }

  // --- Ergebnis-Erfassung ---------------------------------------------------
  {
    const { env, KEYS } = await mountPanel();
    env.click("switch-tab", { tab: "call" });
    env.click("set-call-mode", { mode: "outbound" });

    env.click("call-outcome", { outcome: "not-reached" });
    const after = env.storage[KEYS.callbacks];
    assert.ok(after && after.items.length === 1, "Nichterreichen legt automatisch eine Wiedervorlage an");
    assert.strictEqual(after.items[0].attempts, 1, "und zählt den Versuch mit");
    assert.strictEqual(after.items[0].lastOutcome, "not-reached", "das Ergebnis wird am Eintrag vermerkt");

    // Zweiter Fehlversuch: kein neuer Eintrag, sondern höherer Versuchszähler
    // und ein größerer Abstand.
    const firstDue = after.items[0].dueAt;
    env.click("call-outcome", { outcome: "not-reached" });
    const second = env.storage[KEYS.callbacks].items;
    assert.strictEqual(second.length, 1, "der zweite Fehlversuch erzeugt keine Dublette");
    assert.strictEqual(second[0].attempts, 2, "sondern zählt den Versuch hoch");
    assert.ok(second[0].dueAt > firstDue, "und wartet vor dem nächsten Versuch länger");

    // Ein erfolgreiches Gespräch darf keine Wiedervorlage nach sich ziehen.
    env.click("complete-callback", { callbackId: second[0].id });
    env.click("call-outcome", { outcome: "reached-done" });
    const items = (env.storage[KEYS.callbacks] || {}).items || [];
    assert.strictEqual(items.length, 0, "ein geklärtes Gespräch legt keine Wiedervorlage an");
  }

  // --- Ergebnis aus dem timio-Cockpit ---------------------------------------
  {
    const { env, KEYS } = await mountPanel();
    // In timio läuft keine lokale KI – der Klick kommt dort nur als
    // Staffelstab über den Storage an und wird hier verarbeitet.
    env.sandbox.chrome.storage.local.set({
      [KEYS.callOutcome]: { outcomeId: "mailbox", callerNumber: "+49 176 34573586", customerNumber: "287246", createdAt: Date.now() }
    });

    const items = (env.storage[KEYS.callbacks] || {}).items || [];
    assert.strictEqual(items.length, 1, "das in timio geklickte Ergebnis legt hier die Wiedervorlage an");
    assert.strictEqual(items[0].phone, "+49 176 34573586", "die Rufnummer aus dem Gespräch wird übernommen");
    // Der Staffelstab enthält Anrufdaten und wird nach der Übernahme entfernt.
    assert.ok(!env.storage[KEYS.callOutcome], "der Staffelstab wird nach der Übernahme wieder aufgeräumt");
  }

  // --- Kundennummer-Suche ---------------------------------------------------
  {
    const { env } = await mountPanel();
    env.click("search-customer", { customer: "287246" });
    assert.strictEqual(env.openedUrls.length, 1, "die Jira-Trefferliste wird geöffnet");
    assert.ok(decodeURIComponent(env.openedUrls[0]).includes("287246"), "die Kundennummer steht in der Suche");
  }

  // --- Einstellungen gehen beim Speichern nicht verloren --------------------
  {
    const { env, KEYS } = await mountPanel();
    env.click("toggle-settings");
    assert.ok(env.html().includes('data-role="set-customer-jql"'), "die JQL-Vorlage ist einstellbar");
    assert.ok(env.html().includes('data-role="set-notify-callbacks"'), "die Rückruf-Meldung ist abschaltbar");

    // saveSettings baut state.settings komplett neu auf. Fehlt ein neues Feld
    // dort, ist es nach dem ersten Speichern still verschwunden.
    env.click("save-settings");
    const saved = env.storage[KEYS.settings];
    assert.ok(Object.prototype.hasOwnProperty.call(saved, "customerSearchJql"), "customerSearchJql überlebt das Speichern");
    assert.ok(Object.prototype.hasOwnProperty.call(saved, "notifyCallbacks"), "notifyCallbacks überlebt das Speichern");
    assert.ok(Object.prototype.hasOwnProperty.call(saved, "agentName"), "die bisherigen Felder bleiben erhalten");
  }

  // --- Recht auf Löschung erfasst auch die neuen Daten ---------------------
  {
    const { env, KEYS } = await mountPanel();
    env.click("switch-tab", { tab: "call" });
    env.click("set-call-mode", { mode: "outbound" });
    env.click("add-callback");
    assert.ok(env.storage[KEYS.callbacks], "es liegen Rückrufdaten vor");

    env.click("wipe-data");
    assert.ok(!env.storage[KEYS.callbacks], "die Rückrufliste wird mitgelöscht");
    assert.ok(!env.storage[KEYS.callMode], "die gemerkte Richtung wird mitgelöscht");
    assert.ok(env.html().includes("Call-Hilfe"), "und das Panel steht wieder auf eingehend");
  }

  console.log("ui-outbound.test.js: alle Szenarien bestanden.");
}

run().catch((error) => { console.error(error); process.exit(1); });
