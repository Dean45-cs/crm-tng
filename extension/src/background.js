"use strict";

// Hintergrund-Service-Worker: hält ein Badge auf dem Symbolleisten-Icon
// aktuell, das die Zahl der FÄLLIGEN RÜCKRUFE zeigt – sichtbar in JEDEM Tab.
// Er liest ausschließlich chrome.storage.local (kein eigenes Scraping, kein
// Mithören, kein Server); die Rückrufliste pflegt das Panel (src/ui.js), den
// aktiven Anruf meldet das timio-Content-Script (src/timio-content.js).
//
// Im reinen Outbound-Betrieb gibt es kein eingehendes Wartefeld mehr zu
// überwachen – timio wählt selbst aus seiner Anrufliste. Die einzige
// drängende Zahl ist damit die der fälligen Wiedervorlagen.
//
// Zusätzlich: Klick aufs Icon springt zum timio-Tab (oder öffnet ihn), und –
// per Einstellung abschaltbar – eine lokale Desktop-Benachrichtigung, sobald
// ein vereinbarter Rückruf fällig wird.
//
// Der Worker ist kurzlebig (Chrome beendet ihn bei Inaktivität) – deshalb
// keine Zustände im Speicher, sondern alles aus dem Storage rekonstruiert.

// CONFIG + gemeinsame Helfer aus denselben Dateien laden wie die Content-
// Scripts, damit Storage-Schlüssel/Schwellen nicht dupliziert werden.
try {
  importScripts(
    chrome.runtime.getURL("src/config.js"),
    chrome.runtime.getURL("src/shared.js"),
    // Netz-Auskunft: Orchestrierung der aktiven Dashboard-Abfragen. Registriert
    // eigene onMessage-Listener (sc-run-lookup vom Panel, sc-lookup-step von den
    // Content-Scripts) und exportiert app.lookup.
    chrome.runtime.getURL("src/lookup.js")
  );
} catch (error) {
  // Im Node-Test sind config.js/shared.js bereits in den Kontext geladen.
}

(function initBackground() {
  const app = globalThis.StadtnetzCRM || (globalThis.StadtnetzCRM = {});
  const CONFIG = app.CONFIG || {};
  const shared = app.shared || {};
  const KEYS = CONFIG.storageKeys || {};
  const BADGE = CONFIG.badge || {};
  const CALL = CONFIG.call || {};

  const CALL_STALE_MS = CALL.staleAfterMs || 15000;
  const MAX_DISPLAY = BADGE.maxDisplay || 99;
  const COLOR_DUE = BADGE.colorDue || "#B26A00";

  const REFRESH_ALARM = "sc-badge-refresh";
  const CALLBACK_NOTIFICATION_PREFIX = "sc-callback:";
  const TIMIO_MATCH = "https://ccc.my-phone.cloud/*";
  const TIMIO_OPEN_URL = "https://ccc.my-phone.cloud/web/timio/timio.html";

  // --- Promise-Wrapper für die Callback-APIs -------------------------------

  function getLocal(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (data) => resolve(data || {}));
      } catch (error) {
        resolve({});
      }
    });
  }

  function setLocal(payload) {
    try {
      chrome.storage.local.set(payload);
    } catch (error) { /* Worker beendet – nächster Event baut neu auf */ }
  }

  function queryTabs(info) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.query(info, (tabs) => resolve(tabs || []));
      } catch (error) {
        resolve([]);
      }
    });
  }

  // --- Reine Logik (ohne chrome.*, deshalb direkt testbar) -----------------

  // Ein Anruf gilt als vorbei, wenn er auf "idle" steht oder länger kein
  // frisches Update mehr kam (timio-Tab geschlossen o. Ä.).
  function normalizeCall(call, now) {
    if (!call || !call.status || call.status === "idle") return null;
    if (call.updatedAt && (now - call.updatedAt) > CALL_STALE_MS) return null;
    return call;
  }

  function callLineOf(call) {
    if (!call) return "";
    const who = call.callerName || call.callerNumber || "Kontakt";
    if (call.status === "ringing") return `↗ Wählt: ${who}`;
    if (call.status === "connected") return `↗ Im Gespräch: ${who}`;
    return "";
  }

  function dueCallbacks(callbacks, now) {
    const items = (callbacks && callbacks.items) || [];
    return shared.dueCallbacks ? shared.dueCallbacks(items, now) : [];
  }

  // Ermittelt Text/Farbe/Tooltip fürs Badge aus dem aktuellen Zustand.
  // Die drängende Zahl im Outbound-Betrieb ist die der fälligen Rückrufe.
  function computeBadge(activeCall, now, options) {
    const opts = options || {};
    const due = dueCallbacks(opts.callbacks, now);
    const callLine = callLineOf(activeCall);

    if (due.length) {
      const lines = [`${due.length} ${due.length === 1 ? "Rückruf fällig" : "Rückrufe fällig"}`];
      due.slice(0, 5).forEach((item) => {
        lines.push(`• ${item.ticketKey || item.customerName || "Rückruf"}${item.reason ? ` – ${item.reason}` : ""}`);
      });
      if (callLine) lines.push(callLine);
      return {
        text: due.length > MAX_DISPLAY ? `${MAX_DISPLAY}+` : String(due.length),
        color: COLOR_DUE,
        title: lines.join("\n")
      };
    }

    const title = ["Keine fälligen Rückrufe.", callLine].filter(Boolean).join("\n");
    return { text: "", color: COLOR_DUE, title };
  }

  // Fällige Rückrufe, für die noch nicht erinnert wurde. Der Merker sitzt am
  // Eintrag selbst (notifiedAt), damit jede Fälligkeit genau eine Meldung
  // erzeugt – auch über Worker-Neustarts hinweg.
  function callbacksToNotify(callbacks, now, enabled) {
    if (!enabled) return [];
    return dueCallbacks(callbacks, now).filter((item) => !item.notifiedAt);
  }

  app.background = { computeBadge, normalizeCall, callbacksToNotify };

  // --- Wirkung (chrome.*) --------------------------------------------------

  function applyBadge(badge) {
    try {
      chrome.action.setBadgeText({ text: badge.text });
      if (badge.text) chrome.action.setBadgeBackgroundColor({ color: badge.color });
      if (chrome.action.setBadgeTextColor) {
        try { chrome.action.setBadgeTextColor({ color: "#FFFFFF" }); } catch (error) { /* ältere Chrome-Version */ }
      }
      chrome.action.setTitle({ title: badge.title || "Stadtnetz CRM Outbound" });
    } catch (error) { /* Worker beendet */ }
  }

  function fireCallbackNotification(item) {
    if (!chrome.notifications) return;
    const who = item.customerName || item.ticketKey || "Kunde";
    try {
      chrome.notifications.create(`${CALLBACK_NOTIFICATION_PREFIX}${item.id}`, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "Rückruf fällig",
        message: [who, item.ticketSummary, item.reason].filter(Boolean).join(" · ") || "Ein vereinbarter Rückruf ist fällig.",
        priority: 2
      }, () => void chrome.runtime.lastError);
    } catch (error) { /* Benachrichtigungen nicht verfügbar */ }
  }

  async function refresh(options) {
    const withNotifications = !options || options.notify !== false;
    const data = await getLocal([KEYS.activeCall, KEYS.settings, KEYS.callbacks]);
    const now = Date.now();
    const activeCall = normalizeCall(data[KEYS.activeCall], now);
    const settings = data[KEYS.settings] || {};
    const callbacks = data[KEYS.callbacks] || null;

    applyBadge(computeBadge(activeCall, now, { callbacks }));

    // Fällige Rückrufe melden, je Fälligkeit genau einmal.
    const pending = withNotifications
      ? callbacksToNotify(callbacks, now, settings.notifyCallbacks !== false)
      : [];
    if (pending.length) {
      pending.forEach(fireCallbackNotification);
      // Merker am Eintrag setzen, damit dieselbe Fälligkeit nicht erneut meldet.
      const notified = new Set(pending.map((item) => item.id));
      const items = (callbacks.items || []).map((item) =>
        notified.has(item.id) ? { ...item, notifiedAt: now } : item);
      setLocal({ [KEYS.callbacks]: { items, updatedAt: now } });
    }
  }

  async function focusTimio() {
    const tabs = await queryTabs({ url: TIMIO_MATCH });
    if (tabs.length) {
      try {
        chrome.tabs.update(tabs[0].id, { active: true });
        if (tabs[0].windowId != null && chrome.windows) chrome.windows.update(tabs[0].windowId, { focused: true });
      } catch (error) { /* Tab verschwunden */ }
    } else {
      try { chrome.tabs.create({ url: TIMIO_OPEN_URL }); } catch (error) { /* egal */ }
    }
  }

  function ensureAlarm() {
    // Re-evaluiert regelmäßig, ob inzwischen ein Rückruf fällig wurde, auch
    // ohne Storage-Änderung.
    try { chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 0.5 }); } catch (error) { /* alarms fehlt */ }
  }

  // --- Verdrahtung ---------------------------------------------------------

  if (chrome.runtime && chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => { ensureAlarm(); refresh({ notify: false }); });
  }
  if (chrome.runtime && chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(() => { ensureAlarm(); refresh({ notify: false }); });
  }

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      // callbacks steht hier bewusst mit drin, obwohl der Worker den Schlüssel
      // selbst schreibt (notifiedAt): ein neu angelegter Rückruf soll das Badge
      // sofort erreichen. Die Schleife ist begrenzt – der Worker schreibt nur,
      // wenn es unbenachrichtigte fällige Einträge gibt, und genau die sind nach
      // dem Write erledigt; der zweite Durchlauf findet nichts mehr zu tun.
      const relevant = [KEYS.activeCall, KEYS.settings, KEYS.callbacks]
        .some((key) => Object.prototype.hasOwnProperty.call(changes, key));
      if (relevant) refresh();
    });
  }

  // Das Panel kann den timio-Tab in den Vordergrund holen (Rückrufliste:
  // "Nummer & timio"). Nur der Worker hat Zugriff auf chrome.tabs.
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.type === "focus-timio") focusTimio();
    });
  }

  if (chrome.alarms && chrome.alarms.onAlarm) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm && alarm.name === REFRESH_ALARM) refresh({ notify: false });
    });
  }

  if (chrome.action && chrome.action.onClicked) {
    chrome.action.onClicked.addListener(() => { focusTimio(); });
  }
  if (chrome.notifications && chrome.notifications.onClicked) {
    chrome.notifications.onClicked.addListener((id) => {
      if (typeof id === "string" && id.startsWith(CALLBACK_NOTIFICATION_PREFIX)) {
        focusTimio();
        chrome.notifications.clear(id);
      }
    });
  }

  app.background.refresh = refresh;
  app.background.focusTimio = focusTimio;

  // Verbindung zur Desktop-App (desktop/), falls sie läuft. Muss nach dem
  // Setzen von app.background stehen – die Brücke ruft focusTimio() darüber
  // auf, wenn das Fenster den timio-Tab nach vorn holen soll.
  try {
    importScripts(chrome.runtime.getURL("src/hud-bridge.js"));
  } catch (error) {
    // Im Node-Test ist hud-bridge.js nicht geladen; ohne App fehlt nichts.
  }

  // WebSocket-Bridge zur externen Anbindung (server/baustatus_bridge.py).
  // Verbindet sich nur bei aktivem Schalter (settings.enableBridge) und nutzt
  // app.lookup.runLookup – muss deshalb nach dem lookup.js-Import stehen.
  try {
    importScripts(chrome.runtime.getURL("src/bridge.js"));
  } catch (error) {
    // Im Node-Test ist bridge.js nicht geladen; ohne Server fehlt nichts.
  }

  // Beim ersten Laden sofort einen Stand setzen.
  ensureAlarm();
  refresh({ notify: false });
})();
