"use strict";

// Hintergrund-Service-Worker: hält ein Badge auf dem Symbolleisten-Icon
// aktuell, das die Zahl der Anrufer im Wartefeld zeigt – sichtbar in JEDEM
// Tab, auch ohne offenen oder sichtbaren timio-Tab. Er liest ausschließlich
// chrome.storage.local (kein eigenes Scraping, kein Mithören, kein Server),
// gespeist vom timio-Content-Script (src/timio-content.js).
//
// Zusätzlich: Klick aufs Icon springt zum timio-Tab (oder öffnet ihn), und –
// per Einstellung abschaltbar – eine lokale Desktop-Benachrichtigung, sobald
// jemand ins Wartefeld kommt. So muss niemand das Wartefeld dauerhaft im Blick
// behalten.
//
// Der Worker ist kurzlebig (Chrome beendet ihn bei Inaktivität) – deshalb
// keine Zustände im Speicher, sondern alles aus dem Storage rekonstruiert;
// die zuletzt gemeldete Wartefeld-Zahl liegt unter storageKeys.badgeState.

// CONFIG + gemeinsame Helfer aus denselben Dateien laden wie die Content-
// Scripts, damit Storage-Schlüssel/Schwellen nicht dupliziert werden.
try {
  importScripts(chrome.runtime.getURL("src/config.js"), chrome.runtime.getURL("src/shared.js"));
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

  const STALE_MS = CALL.queueStaleAfterMs || 30000;
  const CALL_STALE_MS = CALL.staleAfterMs || 15000;
  const MAX_DISPLAY = BADGE.maxDisplay || 99;
  const COLOR_WAITING = BADGE.colorWaiting || "#D93F3C";
  const COLOR_CLEAR = BADGE.colorClear || "#2E7D46";
  const COLOR_STALE = BADGE.colorStale || "#9AA0A6";
  const COLOR_DUE = BADGE.colorDue || "#B26A00";

  const REFRESH_ALARM = "sc-badge-refresh";
  const WAITING_NOTIFICATION = "sc-waiting";
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

  function totalWaiting(queueStats) {
    return shared.queueTotalWaiting ? shared.queueTotalWaiting(queueStats) : null;
  }

  function queueIsStale(queueStats, now) {
    if (shared.queueIsStale) return shared.queueIsStale(queueStats, STALE_MS, now);
    return !queueStats || !queueStats.updatedAt || (now - queueStats.updatedAt) > STALE_MS;
  }

  // Ein Anruf gilt als vorbei, wenn er auf "idle" steht oder länger kein
  // frisches Update mehr kam (timio-Tab geschlossen o. Ä.).
  function normalizeCall(call, now) {
    if (!call || !call.status || call.status === "idle") return null;
    if (call.updatedAt && (now - call.updatedAt) > CALL_STALE_MS) return null;
    return call;
  }

  function callLineOf(call, mode) {
    if (!call) return "";
    const who = call.callerName || call.callerNumber || "Anrufer";
    const outbound = mode === "outbound";
    if (call.status === "ringing") return outbound ? `↗ Wählt: ${who}` : `☎ Eingehend: ${who}`;
    if (call.status === "connected") return `${outbound ? "↗" : "●"} Im Gespräch: ${who}`;
    return "";
  }

  function dueCallbacks(callbacks, now) {
    const items = (callbacks && callbacks.items) || [];
    return shared.dueCallbacks ? shared.dueCallbacks(items, now) : [];
  }

  // Ermittelt Text/Farbe/Tooltip fürs Badge aus dem aktuellen Zustand.
  //
  // Im Outbound-Modus hat der Bearbeiter das Wartefeld nicht zu bedienen – dort
  // ist die drängende Zahl die der fälligen Rückrufe. Steht keiner an, zeigt
  // das Badge wieder das Wartefeld, damit die Information nicht verloren geht.
  function computeBadge(queueStats, activeCall, now, options) {
    const opts = options || {};
    const mode = opts.mode === "outbound" ? "outbound" : "inbound";
    const due = dueCallbacks(opts.callbacks, now);
    const callLine = callLineOf(activeCall, mode);
    const dueLine = due.length
      ? `${due.length} ${due.length === 1 ? "Rückruf fällig" : "Rückrufe fällig"}`
      : "";

    if (mode === "outbound" && due.length) {
      const lines = [dueLine];
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

    const total = totalWaiting(queueStats);

    if (total === null) {
      const title = ["Wartefeld: keine Daten – erst einen timio-Portal-Tab öffnen.", dueLine, callLine]
        .filter(Boolean).join("\n");
      return { text: "", color: COLOR_STALE, title };
    }

    const stale = queueIsStale(queueStats, now);
    // Bei veralteten Daten NICHT die letzte bekannte Zahl weiterzeigen – die
    // sieht identisch zu einer frischen Zahl aus und suggeriert Aktualität,
    // die nicht (mehr) da ist (z. B. timio-Tab discarded/im Hintergrund
    // gethrottelt). Statt "3" also "–", dazu weiterhin die graue Farbe.
    const text = stale ? "–" : (total > MAX_DISPLAY ? `${MAX_DISPLAY}+` : String(total));
    const color = stale ? COLOR_STALE : (total > 0 ? COLOR_WAITING : COLOR_CLEAR);

    const lines = [total > 0
      ? `${total} ${total === 1 ? "Anrufer wartet" : "Anrufer im Wartefeld"}`
      : "Wartefeld frei – niemand wartet"];
    (queueStats.groups || [])
      .filter((group) => typeof group.waiting === "number" && group.waiting > 0)
      .forEach((group) => lines.push(`• ${group.name}: ${group.waiting}${group.currentWait ? ` (akt. ${group.currentWait})` : ""}`));
    if (stale) lines.push("(veraltet – timio-Portal öffnen/aktualisieren)");
    if (dueLine) lines.push(dueLine);
    if (callLine) lines.push(callLine);

    return { text, color, title: lines.join("\n") };
  }

  // Benachrichtigen nur bei steigender Flanke aus "leer": vorher wartete
  // niemand (bekannt 0), jetzt wartet jemand. Kein Ping beim ersten Laden
  // (prev unbekannt) und kein Dauerfeuer bei jedem weiteren Anrufer.
  function shouldNotify(prevTotal, nextTotal, enabled) {
    if (!enabled) return false;
    return prevTotal === 0 && typeof nextTotal === "number" && nextTotal > 0;
  }

  // refresh wird weiter unten definiert und hier nachgereicht (siehe Ende),
  // damit Tests die reine Logik UND den End-to-End-Weg prüfen können.
  // Fällige Rückrufe, für die noch nicht erinnert wurde. Der Merker sitzt am
  // Eintrag selbst (notifiedAt), damit jede Fälligkeit genau eine Meldung
  // erzeugt – auch über Worker-Neustarts hinweg.
  function callbacksToNotify(callbacks, now, enabled) {
    if (!enabled) return [];
    return dueCallbacks(callbacks, now).filter((item) => !item.notifiedAt);
  }

  app.background = { computeBadge, shouldNotify, normalizeCall, queueIsStale, callbacksToNotify };

  // --- Wirkung (chrome.*) --------------------------------------------------

  function applyBadge(badge) {
    try {
      chrome.action.setBadgeText({ text: badge.text });
      if (badge.text) chrome.action.setBadgeBackgroundColor({ color: badge.color });
      if (chrome.action.setBadgeTextColor) {
        try { chrome.action.setBadgeTextColor({ color: "#FFFFFF" }); } catch (error) { /* ältere Chrome-Version */ }
      }
      chrome.action.setTitle({ title: badge.title || "Stadtnetz CRM Copilot" });
    } catch (error) { /* Worker beendet */ }
  }

  function fireWaitingNotification(total, queueStats) {
    if (!chrome.notifications) return;
    const groups = (queueStats.groups || [])
      .filter((group) => typeof group.waiting === "number" && group.waiting > 0)
      .map((group) => `${group.name}: ${group.waiting}`)
      .join(" · ");
    try {
      chrome.notifications.create(WAITING_NOTIFICATION, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: total === 1 ? "1 Anrufer wartet" : `${total} Anrufer im Wartefeld`,
        message: groups || "Ein Anruf ist im Wartefeld.",
        priority: 2
      }, () => void chrome.runtime.lastError);
    } catch (error) { /* Benachrichtigungen nicht verfügbar */ }
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
    const data = await getLocal([KEYS.queueStats, KEYS.activeCall, KEYS.settings, KEYS.badgeState, KEYS.callMode, KEYS.callbacks]);
    const now = Date.now();
    const queueStats = data[KEYS.queueStats] || null;
    const activeCall = normalizeCall(data[KEYS.activeCall], now);
    const settings = data[KEYS.settings] || {};
    const callMode = data[KEYS.callMode] === "outbound" ? "outbound" : "inbound";
    const callbacks = data[KEYS.callbacks] || null;

    applyBadge(computeBadge(queueStats, activeCall, now, { mode: callMode, callbacks }));

    // Fällige Rückrufe melden – unabhängig vom Wartefeld, das kann veraltet
    // sein, ohne dass die Rückrufe deswegen weniger fällig wären.
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

    // Benachrichtigung + Merkposten nur bei frischen Daten pflegen, damit ein
    // Veralten (Portal-Tab zu) die letzte bekannte Zahl nicht auf 0 zurücksetzt.
    if (queueIsStale(queueStats, now)) return;

    const nextTotal = totalWaiting(queueStats);
    if (typeof nextTotal !== "number") return;

    const prev = data[KEYS.badgeState] || {};
    if (withNotifications && shouldNotify(prev.lastTotal, nextTotal, settings.notifyWaiting !== false)) {
      fireWaitingNotification(nextTotal, queueStats);
    }
    if (prev.lastTotal !== nextTotal) {
      setLocal({ [KEYS.badgeState]: { lastTotal: nextTotal, updatedAt: now } });
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

  // Chrome darf lange im Hintergrund liegende Tabs zur Speicherentlastung
  // "discarden" – das Content-Script (timio-content.js) läuft dann gar nicht
  // mehr, bis der Tab wieder aktiviert wird, und das Wartefeld friert exakt
  // beim letzten Stand ein. Der timio-Tab ist aber die einzige Quelle für die
  // Wartefeld-Zahl, deshalb schließen wir ihn von der Discard-Kandidatur aus.
  function protectTimioTab(tab) {
    if (!tab || tab.autoDiscardable === false) return;
    try {
      chrome.tabs.update(tab.id, { autoDiscardable: false });
    } catch (error) { /* Tab verschwunden oder API fehlt */ }
  }

  async function protectTimioTabs() {
    const tabs = await queryTabs({ url: TIMIO_MATCH });
    tabs.forEach(protectTimioTab);
  }

  function ensureAlarm() {
    // Re-evaluiert regelmäßig die Veraltung, auch wenn keine Storage-Änderung
    // kommt (z. B. Portal-Tab geschlossen → Badge soll grau werden).
    try { chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 0.5 }); } catch (error) { /* alarms fehlt */ }
  }

  // --- Verdrahtung ---------------------------------------------------------

  if (chrome.runtime && chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => { ensureAlarm(); refresh({ notify: false }); protectTimioTabs(); });
  }
  if (chrome.runtime && chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(() => { ensureAlarm(); refresh({ notify: false }); protectTimioTabs(); });
  }

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      // Nur auf inhaltliche Änderungen reagieren – NICHT auf unseren eigenen
      // badgeState-Write (sonst Endlosschleife).
      //
      // callbacks steht hier bewusst mit drin, obwohl der Worker den Schlüssel
      // selbst schreibt (notifiedAt): ein neu angelegter Rückruf soll das Badge
      // sofort erreichen und nicht erst beim nächsten Alarm. Die Schleife ist
      // dabei sicher begrenzt – der Worker schreibt nur, wenn es unbenachrichtigte
      // fällige Einträge gibt, und genau die sind nach diesem Write erledigt.
      // Der zweite Durchlauf findet also nichts mehr zu tun und schreibt nicht.
      const relevant = [KEYS.queueStats, KEYS.activeCall, KEYS.settings, KEYS.callMode, KEYS.callbacks]
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
      if (alarm && alarm.name === REFRESH_ALARM) { refresh({ notify: false }); protectTimioTabs(); }
    });
  }

  // Sobald der timio-Tab neu entsteht oder navigiert (z. B. nach einem
  // Neustart/Discard-Reload), sofort wieder als nicht-discardable markieren,
  // statt bis zum nächsten 30s-Alarm zu warten.
  if (chrome.tabs && chrome.tabs.onUpdated) {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (tab && tab.url && tab.url.indexOf("ccc.my-phone.cloud") !== -1) protectTimioTab(tab);
    });
  }

  if (chrome.action && chrome.action.onClicked) {
    chrome.action.onClicked.addListener(() => { focusTimio(); });
  }
  if (chrome.notifications && chrome.notifications.onClicked) {
    chrome.notifications.onClicked.addListener((id) => {
      if (id === WAITING_NOTIFICATION || (typeof id === "string" && id.startsWith(CALLBACK_NOTIFICATION_PREFIX))) {
        focusTimio();
        chrome.notifications.clear(id);
      }
    });
  }

  app.background.refresh = refresh;
  app.background.focusTimio = focusTimio;
  app.background.protectTimioTabs = protectTimioTabs;

  // Beim ersten Laden sofort einen Stand setzen.
  ensureAlarm();
  refresh({ notify: false });
  protectTimioTabs();
})();
