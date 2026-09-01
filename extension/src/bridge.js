"use strict";

// WebSocket-Bridge zur externen Anbindung (server/baustatus_bridge.py). Läuft
// im Hintergrund-Service-Worker. Erlaubt einem externen Frontend, über den
// lokalen Server eine Netz-Auskunft (Baustatus/Churn) auszulösen, die diese
// Extension ausführt.
//
// KRITISCH und deshalb streng abgesichert:
//  - Verbindet sich NUR, wenn settings.enableBridge === true (eigener Schalter,
//    Standard AUS). Ein automatischer Bridge-Aufruf hat keinen Menschen für die
//    Einzel-Bestätigung – der Schalter IST die Freigabe.
//  - Handshake mit einem gemeinsamen Token (settings.bridgeToken == BRIDGE_TOKEN
//    des Servers). Ohne passendes Token weist der Server ab.
//  - Der eigentliche Lookup läuft über app.lookup.runLookup und erbt dessen
//    Gate: enableLookups muss ZUSÄTZLICH an sein. So braucht ein Bridge-Aufruf
//    beide Schalter.
//  - Nur ws://127.0.0.1 – nichts davon verlässt den Rechner. Läuft kein Server,
//    passiert schlicht nichts.

(function initBridge() {
  const app = globalThis.StadtnetzCRM || (globalThis.StadtnetzCRM = {});
  const CONFIG = app.CONFIG || {};
  const KEYS = CONFIG.storageKeys || {};
  const BRIDGE = CONFIG.bridge || {};

  const PORT = BRIDGE.port || 8766;
  const URL = `ws://127.0.0.1:${PORT}/extension`;
  const RETRY_MIN_MS = BRIDGE.reconnectMinMs || 2000;
  const RETRY_MAX_MS = BRIDGE.reconnectMaxMs || 30000;
  const RETRY_ALARM = "sc-bridge-retry";

  let socket = null;
  let retryMs = RETRY_MIN_MS;
  let retryTimer = null;
  let enabled = false;
  let token = "";
  // requestIds, die über die Bridge angestoßen wurden – nur deren
  // Fortschrittsmeldungen werden an den Server weitergereicht.
  const bridgeRequests = new Set();

  function isOpen() {
    return socket && socket.readyState === WebSocket.OPEN;
  }

  function send(message) {
    if (!isOpen()) return false;
    try { socket.send(JSON.stringify(message)); return true; }
    catch (error) { return false; }
  }

  function getLocal(keys) {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(keys, (data) => resolve(data || {})); }
      catch (error) { resolve({}); }
    });
  }

  function writeBridgeState(connected) {
    try { chrome.storage.local.set({ [KEYS.bridgeState]: { connected, active: connected, updatedAt: Date.now() } }); }
    catch (error) { /* Worker beendet */ }
  }

  // --- Lookup über die Bridge ------------------------------------------------

  async function handleLookup(message) {
    const requestId = message.requestId || `br_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const kind = message.kind === "churn" ? "churn" : "baustatus";
    const customerNumber = String(message.customerNumber || message.kundenNr || "").trim();
    bridgeRequests.add(requestId);
    try {
      const runner = app.lookup && app.lookup.runLookup;
      if (typeof runner !== "function") {
        send({ type: "error", requestId, message: "Lookup-Orchestrierung nicht verfügbar." });
        return;
      }
      const result = await runner({ kind, customerNumber, source: "bridge", requestId });
      if (result && result.ok) send({ type: "result", requestId, data: result.data });
      else send({ type: "error", requestId, message: (result && result.error) || "Abfrage fehlgeschlagen." });
    } catch (error) {
      send({ type: "error", requestId, message: (error && error.message) || String(error) });
    } finally {
      bridgeRequests.delete(requestId);
    }
  }

  // --- Verbindung ------------------------------------------------------------

  function scheduleRetry() {
    if (!enabled) return;
    if (retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = null; connect(); }, retryMs);
    retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    try { chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 }); } catch (error) { /* alarms fehlt */ }
  }

  // Steht die Verbindung (oder ist die Bridge abgeschaltet), hat der
  // Wiederhol-Alarm seinen Zweck erfüllt. Ohne dieses Aufräumen weckt er den
  // Service-Worker für den Rest der Browser-Sitzung im Minutentakt.
  function clearRetry() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    try { chrome.alarms.clear(RETRY_ALARM); } catch (error) { /* alarms fehlt */ }
  }

  function disconnect() {
    clearRetry();
    if (socket) {
      try { socket.close(); } catch (error) { /* egal */ }
      socket = null;
    }
    writeBridgeState(false);
  }

  function connect() {
    if (!enabled) return;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

    let next;
    try { next = new WebSocket(URL); }
    catch (error) { scheduleRetry(); return; }
    socket = next;

    next.addEventListener("open", () => {
      retryMs = RETRY_MIN_MS;
      clearRetry();
      send({ type: "hello", token });
      // „connected" wird erst nach dem „ready" des Servers gesetzt (Token ok).
    });

    next.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch (error) { return; }
      if (!message || typeof message.type !== "string") return;
      switch (message.type) {
        case "ready":
          writeBridgeState(true);
          return;
        case "lookup":
          handleLookup(message);
          return;
        case "error":
          // Handshake abgelehnt o. Ä. – Verbindung gilt als nicht aktiv.
          writeBridgeState(false);
          return;
        default:
          return;
      }
    });

    const onGone = () => {
      if (socket === next) socket = null;
      writeBridgeState(false);
      scheduleRetry();
    };
    next.addEventListener("close", onGone);
    next.addEventListener("error", onGone);
  }

  // Liest den Schalter + Token aus dem Storage und verbindet/trennt entsprechend.
  async function applySettings() {
    const data = await getLocal([KEYS.settings]);
    const settings = data[KEYS.settings] || {};
    const nextEnabled = settings.enableBridge === true;
    token = settings.bridgeToken || "";
    if (nextEnabled && !enabled) {
      enabled = true;
      retryMs = RETRY_MIN_MS;
      connect();
    } else if (!nextEnabled && enabled) {
      enabled = false;
      disconnect();
    } else if (nextEnabled && enabled && !isOpen()) {
      // Token evtl. geändert – frisch verbinden.
      disconnect();
      enabled = true;
      connect();
    }
  }

  // --- Verdrahtung -----------------------------------------------------------

  // Fortschrittsmeldungen der Content-Scripts an den Server weiterreichen – nur
  // für Anfragen, die über die Bridge kamen.
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.type === "sc-lookup-step" && bridgeRequests.has(message.requestId)) {
        send({ type: "step", requestId: message.requestId, step: message.step, state: message.state });
      }
    });
  }

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && Object.prototype.hasOwnProperty.call(changes, KEYS.settings)) applySettings();
    });
  }

  if (chrome.alarms && chrome.alarms.onAlarm) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm && alarm.name === RETRY_ALARM && enabled && !isOpen()) connect();
    });
  }

  app.bridge = { applySettings, connect, disconnect, isOpen };

  // Beim Worker-Start den aktuellen Schalterstand übernehmen.
  applySettings();
})();
