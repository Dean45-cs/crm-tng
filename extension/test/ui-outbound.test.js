"use strict";

// Outbound-Panel (src/ui.js): die vier Bereiche Vorbereitung/Gespräch/
// Abschluss/Rückrufe, der Outbound-Leitfaden samt Einwandkarten, die
// Rückrufliste und die Ergebnis-Erfassung nach dem Gespräch.
//
// Im reinen Outbound-Betrieb gibt es keinen Richtungsschalter mehr – der Modus
// ist konstant ausgehend. Geprüft werden hier die Stellen, an denen ein stiller
// Fehler teuer wäre: ein Kopier-Button, der in die falsche Liste indiziert, oder
// eine Einstellung, die beim Speichern verlorengeht.
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
  "src/theme.js",
  "src/ui.js"
];

async function mountPanel(options) {
  const env = makePanelSandbox(options);
  loadScripts(env.sandbox, SCRIPTS);
  await env.sandbox.StadtnetzCRM.ui.mount();
  return { env, CONFIG: env.sandbox.StadtnetzCRM.CONFIG, KEYS: env.sandbox.StadtnetzCRM.CONFIG.storageKeys };
}

async function run() {
  // --- Vier Bereiche, kein Richtungsschalter -------------------------------
  {
    const { env } = await mountPanel();

    assert.ok(!env.html().includes('data-action="set-call-mode"'), "es gibt keinen Richtungsschalter mehr");
    ["Vorbereitung", "Gespräch", "Abschluss", "Rückrufe"].forEach((label) => {
      assert.ok(env.html().includes(label), `der Tab "${label}" steht im Panel`);
    });
    // Vorbereitung ist der Startbereich – dort läuft die Gesprächsvorbereitung.
    assert.ok(env.html().includes('data-action="generate-call-prep"'), "die Gesprächsvorbereitung steht im Vorbereitungs-Tab");
  }

  // --- Leitfaden und Einwandkarten (Standard: Churn) -----------------------
  {
    const { env, CONFIG } = await mountPanel();
    const escapeHtml = env.sandbox.StadtnetzCRM.shared.escapeHtml;
    env.click("switch-tab", { tab: "talk" });

    // Ohne geladene Schicht ist der Call-Typ der Standard „churn".
    assert.ok(env.html().includes(escapeHtml(CONFIG.callGuides.churn[0].title)), "der Churn-Leitfaden steht im Gespräch-Tab");
    assert.ok(env.html().includes(escapeHtml(CONFIG.objectionCards.churn[0].title)), "auch die Churn-Einwandkarten sind da");
  }

  // --- Umschalten auf Welcome tauscht Leitfaden & Karten -------------------
  {
    const { env, CONFIG } = await mountPanel();
    const escapeHtml = env.sandbox.StadtnetzCRM.shared.escapeHtml;
    env.click("switch-tab", { tab: "talk" });
    env.click("set-call-type", { callType: "welcome" });

    assert.ok(env.html().includes(escapeHtml(CONFIG.callGuides.welcome[0].title)), "nach dem Umschalten steht der Welcome-Leitfaden da");
    assert.ok(env.html().includes(escapeHtml(CONFIG.objectionCards.welcome[0].title)), "und die Welcome-Einwandkarten");
    // Der Leitfaden zeigt seinen Fortschritt. Wortlaut seit dem Umbau auf das
    // Schrittwerk: "Schritt 1 von 6" und daneben "0 erledigt" – vorher stand
    // hier "N von M Punkten erledigt", und der Test hing noch daran fest.
    assert.ok(env.html().includes("Schritt 1 von"), "die Schrittanzeige des Leitfadens ist sichtbar");
    assert.ok(env.html().includes("0 erledigt"), "und daneben der Zähler der abgehakten Schritte");

    // Ein Punkt abhaken erhöht den Fortschritt.
    env.click("toggle-phase", { phaseIndex: "0" });
    assert.ok(env.html().includes("1 erledigt"), "ein abgehakter Punkt zählt im Fortschritt mit");
  }

  // --- Kopier-Buttons greifen in den aktiven Leitfaden ---------------------
  {
    const { env, CONFIG } = await mountPanel();
    env.click("switch-tab", { tab: "talk" });

    env.click("copy-call-phase", { phaseIndex: "0" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(env.copied.slice(-1)[0], CONFIG.callGuides.churn[0].prompt, "kopiert wird der Churn-Gesprächsbaustein");

    env.click("copy-objection", { objectionIndex: "0" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(env.copied.slice(-1)[0], CONFIG.objectionCards.churn[0].text, "dasselbe gilt für die Einwandkarten");
  }

  // --- Rückrufliste ---------------------------------------------------------
  {
    const { env, KEYS } = await mountPanel();
    env.click("switch-tab", { tab: "callbacks" });

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

  // --- Bug D: Remount dupliziert die Listener nicht -------------------------
  // content.js baut das Panel bei jeder Jira-Navigation ab (removePanel) und
  // beim Zurückkehren neu auf (mount). Früher registrierte jeder mount einen
  // weiteren storage.onChanged-Listener, sodass ein einzelnes in timio
  // geklicktes Ergebnis applyOutcome N-fach feuerte (doppelter Notiztext,
  // hochgezählte Rückrufe). Jetzt gilt: egal wie oft neu gemountet wird, ein
  // Ergebnis wird genau einmal verarbeitet.
  {
    const { env, KEYS } = await mountPanel();
    const ui = env.sandbox.StadtnetzCRM.ui;

    // Zwei Board→Ticket-Zyklen simulieren: Root entfernen und neu mounten.
    env.root().remove();
    await ui.mount();
    env.root().remove();
    await ui.mount();

    // Ein einziges Ergebnis aus timio (Staffelstab über den Storage).
    env.sandbox.chrome.storage.local.set({
      [KEYS.callOutcome]: { outcomeId: "not-reached", callerNumber: "+49 176 34573586", customerNumber: "287246", createdAt: Date.now() }
    });

    const items = (env.storage[KEYS.callbacks] || {}).items || [];
    assert.strictEqual(items.length, 1, "trotz mehrfachem Remount entsteht genau eine Wiedervorlage (kein Duplikat)");
    assert.strictEqual(items[0].attempts, 1, "der Versuchszähler wird nur einmal erhöht (applyOutcome lief genau einmal)");
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

  // --- Recht auf Löschung erfasst auch die Rückrufdaten --------------------
  {
    const { env, KEYS } = await mountPanel();
    env.click("switch-tab", { tab: "callbacks" });
    env.click("add-callback");
    assert.ok(env.storage[KEYS.callbacks], "es liegen Rückrufdaten vor");

    env.click("wipe-data");
    assert.ok(!env.storage[KEYS.callbacks], "die Rückrufliste wird mitgelöscht");
    assert.ok(env.html().includes("Vorbereitung"), "das Panel steht danach wieder auf den Standard-Bereichen");
  }

  console.log("ui-outbound.test.js: alle Szenarien bestanden.");
}

run().catch((error) => { console.error(error); process.exit(1); });
