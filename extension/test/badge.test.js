"use strict";

// Test für den Hintergrund-Service-Worker (src/background.js): das Wartefeld-
// Badge auf dem Symbolleisten-Icon, die Benachrichtigungs-Logik und der
// Klick-auf-Icon-springt-zu-timio-Weg. Läuft ohne Browser via Node `vm` gegen
// die echten Quelldateien (siehe test/support/stub-env.js).
//
// Ausführen mit: node test/badge.test.js

const assert = require("assert");
const { makeWorkerSandbox, loadScripts } = require("./support/stub-env");

const SCRIPTS = ["src/config.js", "src/shared.js", "src/background.js"];
const flush = () => new Promise((resolve) => setImmediate(resolve));

function load() {
  const env = makeWorkerSandbox();
  loadScripts(env.sandbox, SCRIPTS);
  const bg = env.sandbox.SupportCopilot.background;
  const CONFIG = env.sandbox.SupportCopilot.CONFIG;
  return { env, bg, KEYS: CONFIG.storageKeys, BADGE: CONFIG.badge };
}

function freshQueue(groups, updatedAt) {
  return { updatedAt: updatedAt || Date.now(), groups };
}

async function run() {
  // --- computeBadge (reine Logik) ------------------------------------------
  {
    const { bg, BADGE } = load();
    const now = Date.now();

    const noData = bg.computeBadge(null, null, now);
    assert.strictEqual(noData.text, "", "ohne Daten: leeres Badge");

    const clear = bg.computeBadge(freshQueue([{ name: "A", waiting: 0 }], now), null, now);
    assert.strictEqual(clear.text, "0", "frei: Badge zeigt 0");
    assert.strictEqual(clear.color, BADGE.colorClear, "frei: grüne Farbe");

    const waiting = bg.computeBadge(freshQueue([{ name: "Bestellhotline", waiting: 3, currentWait: "1:20" }], now), null, now);
    assert.strictEqual(waiting.text, "3", "wartend: Badge zeigt Summe");
    assert.strictEqual(waiting.color, BADGE.colorWaiting, "wartend: rote Farbe");
    assert.ok(waiting.title.includes("Bestellhotline: 3"), "Tooltip listet die Gruppe auf");

    const stale = bg.computeBadge(freshQueue([{ name: "A", waiting: 2 }], now - 60000), null, now);
    assert.strictEqual(stale.color, BADGE.colorStale, "veraltet: graue Farbe");
    assert.ok(stale.title.includes("veraltet"), "veraltet: Hinweis im Tooltip");

    const many = bg.computeBadge(freshQueue([{ name: "A", waiting: 250 }], now), null, now);
    assert.strictEqual(many.text, `${BADGE.maxDisplay}+`, "über maxDisplay: Badge zeigt 99+");

    const onCall = bg.computeBadge(
      freshQueue([{ name: "A", waiting: 1 }], now),
      { status: "connected", callerName: "Anna Beispiel", updatedAt: now },
      now
    );
    assert.ok(onCall.title.includes("Im Gespräch: Anna Beispiel"), "Tooltip zeigt den aktiven Anruf");
  }

  // --- shouldNotify (reine Logik) ------------------------------------------
  {
    const { bg } = load();
    assert.strictEqual(bg.shouldNotify(0, 1, true), true, "0→1 mit aktiv: benachrichtigen");
    assert.strictEqual(bg.shouldNotify(0, 3, false), false, "abgeschaltet: nie benachrichtigen");
    assert.strictEqual(bg.shouldNotify(2, 3, true), false, "2→3: keine erneute Meldung (nur steigende Flanke aus leer)");
    assert.strictEqual(bg.shouldNotify(null, 2, true), false, "unbekannt→2 (erster Start): nicht benachrichtigen");
    assert.strictEqual(bg.shouldNotify(1, 0, true), false, "1→0: keine Meldung");
  }

  // --- refresh: End-to-End über den Storage --------------------------------
  {
    const { env, bg, KEYS, BADGE } = load();
    const now = Date.now();
    env.storage[KEYS.queueStats] = freshQueue([{ name: "A", waiting: 2 }], now);
    env.storage[KEYS.badgeState] = { lastTotal: 0, updatedAt: now };
    env.storage[KEYS.settings] = { notifyWaiting: true };

    await bg.refresh({ notify: true });
    assert.strictEqual(env.calls.badgeText.slice(-1)[0], "2", "refresh setzt das Badge auf 2");
    assert.strictEqual(env.calls.badgeColor.slice(-1)[0], BADGE.colorWaiting, "refresh setzt die rote Farbe");
    assert.strictEqual(env.calls.notifications.length, 1, "refresh löst genau eine Benachrichtigung aus (0→2)");
    assert.strictEqual(env.storage[KEYS.badgeState].lastTotal, 2, "refresh merkt sich die neue Zahl");
  }

  // --- refresh: keine Benachrichtigung bei abgeschalteter Einstellung -------
  {
    const { env, bg, KEYS } = load();
    const now = Date.now();
    env.storage[KEYS.queueStats] = freshQueue([{ name: "A", waiting: 4 }], now);
    env.storage[KEYS.badgeState] = { lastTotal: 0, updatedAt: now };
    env.storage[KEYS.settings] = { notifyWaiting: false };

    await bg.refresh({ notify: true });
    assert.strictEqual(env.calls.notifications.length, 0, "abgeschaltet: keine Benachrichtigung");
    assert.strictEqual(env.calls.badgeText.slice(-1)[0], "4", "Badge wird trotzdem gesetzt");
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
