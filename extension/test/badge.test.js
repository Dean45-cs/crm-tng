"use strict";

// Test für den Hintergrund-Service-Worker (src/background.js): das Rückruf-
// Badge auf dem Symbolleisten-Icon, die Benachrichtigungs-Logik für fällige
// Rückrufe und der Klick-auf-Icon-springt-zu-timio-Weg. Im reinen Outbound-
// Betrieb gibt es kein Wartefeld mehr – die drängende Zahl sind die fälligen
// Wiedervorlagen. Läuft ohne Browser via Node `vm` gegen die echten
// Quelldateien (siehe test/support/stub-env.js).
//
// Ausführen mit: node test/badge.test.js

const assert = require("assert");
const { makeWorkerSandbox, loadScripts } = require("./support/stub-env");

const SCRIPTS = ["src/config.js", "src/shared.js", "src/background.js"];
const flush = () => new Promise((resolve) => setImmediate(resolve));

function load() {
  const env = makeWorkerSandbox();
  loadScripts(env.sandbox, SCRIPTS);
  const bg = env.sandbox.StadtnetzCRM.background;
  const CONFIG = env.sandbox.StadtnetzCRM.CONFIG;
  return { env, bg, KEYS: CONFIG.storageKeys, BADGE: CONFIG.badge };
}

function callbacks(items, updatedAt) {
  return { items, updatedAt: updatedAt || Date.now() };
}

async function run() {
  // --- computeBadge (reine Logik) ------------------------------------------
  {
    const { bg, BADGE } = load();
    const now = Date.now();

    const none = bg.computeBadge(null, now, { callbacks: null });
    assert.strictEqual(none.text, "", "keine fälligen Rückrufe: leeres Badge");
    assert.ok(none.title.includes("Keine fälligen Rückrufe"), "Tooltip meldet: keine fälligen Rückrufe");

    const dueOne = bg.computeBadge(null, now, {
      callbacks: callbacks([{ id: "cb1", dueAt: now - 1000, ticketKey: "TNG-1", reason: "Mailbox" }], now)
    });
    assert.strictEqual(dueOne.text, "1", "ein fälliger Rückruf: Badge zeigt 1");
    assert.strictEqual(dueOne.color, BADGE.colorDue, "fällig: bernsteinfarbenes Badge");
    assert.ok(dueOne.title.includes("Rückruf fällig"), "Tooltip nennt fälligen Rückruf");
    assert.ok(dueOne.title.includes("TNG-1"), "Tooltip listet den Ticketschlüssel auf");

    const notYet = bg.computeBadge(null, now, {
      callbacks: callbacks([{ id: "cb2", dueAt: now + 3600000, ticketKey: "TNG-2" }], now)
    });
    assert.strictEqual(notYet.text, "", "noch nicht fälliger Rückruf zählt nicht");

    const many = bg.computeBadge(null, now, {
      callbacks: callbacks(Array.from({ length: 250 }, (_, i) => ({ id: `c${i}`, dueAt: now - 1000 })), now)
    });
    assert.strictEqual(many.text, `${BADGE.maxDisplay}+`, "über maxDisplay: Badge zeigt 99+");

    const onCall = bg.computeBadge(
      { status: "connected", callerName: "Anna Beispiel", updatedAt: now },
      now,
      { callbacks: callbacks([{ id: "cb3", dueAt: now - 1000, ticketKey: "TNG-3" }], now) }
    );
    assert.ok(onCall.title.includes("Im Gespräch: Anna Beispiel"), "Tooltip zeigt den aktiven Anruf");
  }

  // --- callbacksToNotify (reine Logik) -------------------------------------
  {
    const { bg } = load();
    const now = Date.now();
    const cbs = callbacks([
      { id: "a", dueAt: now - 1000 },                    // fällig, noch nicht gemeldet
      { id: "b", dueAt: now - 1000, notifiedAt: now - 5 }, // fällig, schon gemeldet
      { id: "c", dueAt: now + 1000 }                      // noch nicht fällig
    ], now);
    const pending = bg.callbacksToNotify(cbs, now, true);
    assert.strictEqual(pending.length, 1, "nur der ungemeldete fällige Rückruf steht zur Meldung an");
    assert.strictEqual(pending[0].id, "a", "und zwar der richtige");
    assert.strictEqual(bg.callbacksToNotify(cbs, now, false).length, 0, "abgeschaltet: keine Meldung");
  }

  // --- refresh: End-to-End über den Storage --------------------------------
  {
    const { env, bg, KEYS, BADGE } = load();
    const now = Date.now();
    env.storage[KEYS.callbacks] = callbacks([{ id: "cb1", dueAt: now - 1000, ticketKey: "TNG-9" }], now);
    env.storage[KEYS.settings] = { notifyCallbacks: true };

    await bg.refresh({ notify: true });
    assert.strictEqual(env.calls.badgeText.slice(-1)[0], "1", "refresh setzt das Badge auf 1");
    assert.strictEqual(env.calls.badgeColor.slice(-1)[0], BADGE.colorDue, "refresh setzt die bernsteinfarbene Farbe");
    assert.strictEqual(env.calls.notifications.length, 1, "refresh löst genau eine Rückruf-Meldung aus");
    assert.ok(env.storage[KEYS.callbacks].items[0].notifiedAt, "refresh merkt sich, dass gemeldet wurde");
  }

  // --- refresh: keine erneute Meldung für einen schon gemeldeten Rückruf ----
  {
    const { env, bg, KEYS } = load();
    const now = Date.now();
    env.storage[KEYS.callbacks] = callbacks([{ id: "cb1", dueAt: now - 1000, notifiedAt: now - 5 }], now);
    env.storage[KEYS.settings] = { notifyCallbacks: true };

    await bg.refresh({ notify: true });
    assert.strictEqual(env.calls.notifications.length, 0, "schon gemeldet: keine erneute Benachrichtigung");
    assert.strictEqual(env.calls.badgeText.slice(-1)[0], "1", "Badge zeigt den fälligen Rückruf trotzdem");
  }

  // --- refresh: keine Meldung bei abgeschalteter Einstellung ----------------
  {
    const { env, bg, KEYS } = load();
    const now = Date.now();
    env.storage[KEYS.callbacks] = callbacks([{ id: "cb1", dueAt: now - 1000 }], now);
    env.storage[KEYS.settings] = { notifyCallbacks: false };

    await bg.refresh({ notify: true });
    assert.strictEqual(env.calls.notifications.length, 0, "abgeschaltet: keine Benachrichtigung");
    assert.strictEqual(env.calls.badgeText.slice(-1)[0], "1", "Badge wird trotzdem gesetzt");
  }

  // --- Klick aufs Icon springt zu einem vorhandenen timio-Tab --------------
  {
    const { env } = load();
    env.bus.timioTabs = [{ id: 42, windowId: 7 }];
    assert.ok(env.chrome.action._onClicked, "Icon-Klick-Listener ist registriert");
    env.chrome.action._onClicked();
    await flush();
    const updated = env.calls.tabsUpdated.slice(-1)[0];
    assert.strictEqual(updated.id, 42, "vorhandener timio-Tab wird per id aktiviert");
    assert.strictEqual(updated.info.active, true, "der Tab wird in den Vordergrund geholt");
    assert.strictEqual(env.calls.tabsCreated.length, 0, "kein neuer Tab, wenn schon einer offen ist");
  }

  // --- Klick aufs Icon öffnet timio, wenn keiner offen ist ------------------
  {
    const { env } = load();
    env.bus.timioTabs = [];
    env.chrome.action._onClicked();
    await flush();
    assert.strictEqual(env.calls.tabsCreated.length, 1, "ohne offenen timio-Tab wird einer geöffnet");
    assert.ok(String(env.calls.tabsCreated[0].url).includes("ccc.my-phone.cloud"), "es wird die timio-URL geöffnet");
  }

  console.log("badge.test.js: alle Szenarien bestanden.");
}

run().catch((error) => { console.error(error); process.exit(1); });
