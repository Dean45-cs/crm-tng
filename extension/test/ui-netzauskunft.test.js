"use strict";

// Netz-Auskunft im Jira-Panel (src/ui.js): der kritische Pfad ist die
// Absicherung. Ohne Master-Schalter dürfen keine Abfrage-Buttons erscheinen;
// mit Schalter muss vor JEDEM Lauf bestätigt werden, und erst nach „Ja" geht
// ein Auftrag an den Hintergrund-Worker. Das Ergebnis aus dem Storage landet
// in unserem Design.
//
// Ausführen mit: node test/ui-netzauskunft.test.js

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

// Mountet das Panel mit vorab gesetztem Storage (Schalter/aktiver Anruf), damit
// der Zustand schon beim Laden gilt – ein Settings-Change zur Laufzeit löst im
// Panel bewusst kein Neu-Laden von state.settings aus.
async function mountWith(storageSeed) {
  const env = makePanelSandbox();
  loadScripts(env.sandbox, SCRIPTS);
  const KEYS = env.sandbox.StadtnetzCRM.CONFIG.storageKeys;
  Object.assign(env.storage, storageSeed(KEYS));
  await env.sandbox.StadtnetzCRM.ui.mount();
  return { env, KEYS };
}

// Ein „ringing"-Call liefert die Kundennummer, ohne (wie „connected") den
// aktiven Tab auf Call umzuschalten – die Übersicht mit der Netz-Auskunft
// bleibt sichtbar.
function ringingCall(number) {
  return { status: "ringing", customerNumber: number, callerName: "Test", updatedAt: Date.now() };
}

async function run() {
  // --- Standardmäßig aus: nur der Aktivieren-Hinweis ------------------------
  {
    const { env } = await mountWith(() => ({}));
    assert.ok(env.html().includes("Netz-Auskunft"), "die Section ist vorhanden");
    assert.ok(env.html().includes('data-action="open-lookup-settings"'), "ohne Freigabe steht der Aktivieren-Hinweis");
    assert.ok(!env.html().includes('data-action="lookup-baustatus"'), "und keine Abfrage-Buttons");
    assert.ok(env.html().includes('data-role="set-enable-lookups"') === false, "der Schalter steht in den Einstellungen, nicht in der Übersicht");
  }

  // --- Der kritische Schalter steht in den Einstellungen --------------------
  {
    const { env } = await mountWith(() => ({}));
    env.click("toggle-settings");
    assert.ok(env.html().includes('data-role="set-enable-lookups"'), "Master-Schalter Netz-Auskunft");
    assert.ok(env.html().includes('data-role="set-enable-bridge"'), "separater Bridge-Schalter");
    // saveSettings baut state.settings komplett neu auf – die neuen Flags
    // müssen mit, sonst sind sie nach dem ersten Speichern weg.
    env.click("save-settings");
    const saved = env.storage[env.sandbox.StadtnetzCRM.CONFIG.storageKeys.settings];
    assert.ok(Object.prototype.hasOwnProperty.call(saved, "enableLookups"), "enableLookups überlebt das Speichern");
    assert.ok(Object.prototype.hasOwnProperty.call(saved, "enableBridge"), "enableBridge überlebt das Speichern");
    assert.strictEqual(saved.enableLookups, false, "ein fehlendes Feld darf niemals „an“ bedeuten (checkedStrict)");
  }

  // --- Freigegeben ohne erkannte Nummer: manuelles Feld, kein Blindstart ----
  {
    const { env } = await mountWith((KEYS) => ({ [KEYS.settings]: { enableLookups: true } }));
    assert.ok(env.html().includes('data-role="lookup-customer"'), "es gibt ein manuelles Kundennummer-Feld");
    assert.ok(env.html().includes("keine Kundennummer automatisch erkannt"), "mit Hinweis, dass nichts erkannt wurde");
    assert.ok(env.html().includes('data-action="lookup-baustatus"'), "die Buttons stehen trotzdem bereit (manuelle Eingabe möglich)");
    // Klick ohne eingetragene Nummer löst keine Bestätigung/Abfrage aus.
    env.click("lookup-baustatus");
    assert.ok(!env.html().includes('data-action="lookup-confirm"'), "ohne Nummer keine Bestätigung");
    assert.strictEqual(env.messages.filter((m) => m.type === "sc-run-lookup").length, 0, "und kein Auftrag");
  }

  // --- Freigegeben + Kundennummer: Confirm-Flow -----------------------------
  {
    const { env, KEYS } = await mountWith((K) => ({
      [K.settings]: { enableLookups: true },
      [K.activeCall]: ringingCall("287246")
    }));

    assert.ok(env.html().includes('data-action="lookup-baustatus"'), "die Buttons erscheinen");
    assert.ok(env.html().includes("287246"), "die erkannte Kundennummer steht dran");

    // Klick zeigt zuerst die Bestätigung – noch KEIN Auftrag an den Worker.
    env.click("lookup-baustatus");
    assert.ok(env.html().includes('data-action="lookup-confirm"'), "erst kommt die Bestätigung");
    assert.ok(env.html().includes("verlässt bewusst das"), "mit dem Hinweis, dass das „liest nur\"-Prinzip verlassen wird");
    assert.strictEqual(env.messages.filter((m) => m.type === "sc-run-lookup").length, 0, "vor der Bestätigung wird nichts ausgelöst");

    // Abbrechen schließt die Bestätigung folgenlos.
    env.click("lookup-cancel");
    assert.ok(!env.html().includes('data-action="lookup-confirm"'), "Abbrechen schließt die Bestätigung");
    assert.strictEqual(env.messages.filter((m) => m.type === "sc-run-lookup").length, 0, "und löst weiterhin nichts aus");

    // Erneut, diesmal bestätigen → genau ein Auftrag geht an den Worker.
    env.click("lookup-baustatus");
    env.click("lookup-confirm");
    const msgs = env.messages.filter((m) => m.type === "sc-run-lookup");
    assert.strictEqual(msgs.length, 1, "erst nach „Ja“ geht der Auftrag an den Worker");
    assert.strictEqual(msgs[0].request.kind, "baustatus");
    assert.strictEqual(msgs[0].request.customerNumber, "287246");
    assert.strictEqual(msgs[0].request.source, "panel");
    assert.ok(env.html().includes("läuft"), "das Panel zeigt den Läuft-Zustand");

    // Ergebnis vom Worker (über den Storage) erscheint in unserem Design.
    env.sandbox.chrome.storage.local.set({
      [KEYS.lookupResult]: {
        requestId: msgs[0].request.requestId,
        kind: "baustatus",
        customerNumber: "287246",
        status: "ok",
        steps: [],
        data: { found: true, contract: "1EPK", contractStatus: "aktiv", kvz: { value: "", color: "" }, contacts: {}, timelines: {} }
      }
    });
    assert.ok(env.html().includes("1EPK"), "das Baustatus-Ergebnis erscheint im Panel");
    assert.ok(env.html().includes("aktiv"), "inklusive Vertragsstatus");
  }

  // --- Churn-Abfrage: eigener Confirm, eigener Ergebnistyp -------------------
  {
    const { env, KEYS } = await mountWith((K) => ({
      [K.settings]: { enableLookups: true },
      [K.activeCall]: ringingCall("555")
    }));
    env.click("lookup-churn");
    env.click("lookup-confirm");
    const msgs = env.messages.filter((m) => m.type === "sc-run-lookup");
    assert.strictEqual(msgs[0].request.kind, "churn");

    env.sandbox.chrome.storage.local.set({
      [KEYS.lookupResult]: {
        requestId: msgs[0].request.requestId, kind: "churn", customerNumber: "555",
        status: "ok", steps: [],
        data: { found: true, count: 1, cases: [{ vertrag: "1ABC", geschaeftsfall: "Kündigung", ursache: "Umzug", eingang: "01.02.2026", jiraTicket: "TNG-9", jiraHref: "", kommentar: "" }] }
      }
    });
    assert.ok(env.html().includes("1 Vorgang gefunden"), "der Churn-Zähler erscheint");
    assert.ok(env.html().includes("Kündigung"), "mit dem Geschäftsfall");
  }

  // --- Bridge-Banner: nur wenn verbunden ------------------------------------
  {
    const { env, KEYS } = await mountWith(() => ({}));
    assert.ok(!env.html().includes("Bridge aktiv"), "ohne Verbindung kein Banner");
    env.sandbox.chrome.storage.local.set({ [KEYS.bridgeState]: { connected: true, active: true, updatedAt: Date.now() } });
    assert.ok(env.html().includes("Bridge aktiv"), "verbunden erscheint das Banner");
    env.sandbox.chrome.storage.local.set({ [KEYS.bridgeState]: { connected: false } });
    assert.ok(!env.html().includes("Bridge aktiv"), "getrennt verschwindet es wieder");
  }

  // --- Recht auf Löschung erfasst auch Netz-Auskunft-Daten ------------------
  {
    const { env, KEYS } = await mountWith((K) => ({
      [K.settings]: { enableLookups: true },
      [K.activeCall]: ringingCall("287246"),
      [K.lookupResult]: { requestId: "x", kind: "baustatus", status: "ok", steps: [], data: { found: false } }
    }));
    env.click("wipe-data");
    assert.ok(!env.storage[KEYS.lookupResult], "das Lookup-Ergebnis wird mitgelöscht");
    assert.ok(env.html().includes('data-action="open-lookup-settings"') || env.html().includes("Netz-Auskunft"), "die Section bleibt, aber wieder im gesperrten Grundzustand");
  }

  console.log("ui-netzauskunft.test.js: alle Szenarien bestanden.");
}

run().catch((error) => { console.error(error); process.exit(1); });
