"use strict";

// Verbindung zur Desktop-App (desktop/). Läuft im Hintergrund-Service-Worker.
//
// Aufgabenteilung: die Extension bleibt Datenquelle und KI-Motor – sie liest
// Jira und timio und hat als einzige Zugriff auf Chromes eingebaute KI
// (Gemini Nano). Die Desktop-App zeigt das Cockpit in einem eigenen Fenster,
// das nicht verschwindet, wenn der Jira-Tab in den Hintergrund rutscht.
//
// Nach außen geht dabei nichts: die Verbindung endet auf 127.0.0.1, also auf
// demselben Rechner. Läuft die App nicht, passiert schlicht nichts – die
// Extension arbeitet dann wie vorher allein weiter.

(function initHudBridge() {
  const app = globalThis.StadtnetzCRM || (globalThis.StadtnetzCRM = {});
  const CONFIG = app.CONFIG || {};
  const KEYS = CONFIG.storageKeys || {};

  const PORT = (CONFIG.hud && CONFIG.hud.port) || 8777;
  const URL = `ws://127.0.0.1:${PORT}/`;
  const RETRY_ALARM = "sc-hud-retry";
  const JIRA_MATCH = "https://jira.ennit.de/*";

  // Wiederverbinden mit wachsendem Abstand: die App läuft oft einfach nicht
  // (jemand nutzt nur die Extension). Dauerndes Klopfen im Sekundentakt wäre
  // reine Verschwendung, deshalb bis auf eine Minute hochlaufen.
  const RETRY_MIN_MS = 2000;
  const RETRY_MAX_MS = 60000;

  // Genau diese Schlüssel werden gespiegelt. Bewusst eine Liste statt "alles,
  // was im Storage liegt": so kann nie versehentlich etwas Neues mitwandern,
  // das dort nichts zu suchen hat.
  const MIRRORED = [
    KEYS.isOpen, KEYS.activeTab, KEYS.emailTemplates, KEYS.tone, KEYS.settings,
    KEYS.aiCache, KEYS.activeCall, KEYS.queueStats, KEYS.callOverlay,
    KEYS.ticketContext, KEYS.timioOverlay, KEYS.callMode, KEYS.callbacks,
    KEYS.callOutcome, KEYS.supabaseSession, KEYS.customerCard
  ].filter(Boolean);

  let socket = null;
  let retryMs = RETRY_MIN_MS;
  let retryTimer = null;
  // Tab, der zuletzt einen Vorgang gemeldet hat. Dorthin gehen die KI-Aufträge,
  // denn dort liegt der Ticketinhalt schon im Speicher.
  let preferredTabId = null;

  function connected() {
    return socket && socket.readyState === WebSocket.OPEN;
  }

  function send(message) {
    if (!connected()) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      return false;
    }
  }

  // --- Storage -------------------------------------------------------------

  function getLocal(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (data) => resolve(data || {}));
      } catch (error) {
        resolve({});
      }
    });
  }

  async function sendSnapshot() {
    const data = await getLocal(MIRRORED);
    send({ t: "storage-snapshot", data });
  }

  function forwardStorageChange(changes, area) {
    if (area !== "local" || !connected()) return;
    const relevant = {};
    MIRRORED.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(changes, key)) relevant[key] = changes[key];
    });
    if (Object.keys(relevant).length) send({ t: "storage-changed", changes: relevant });
  }

  // --- Ticket --------------------------------------------------------------

  function queryTabs(query) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.query(query, (tabs) => resolve(tabs || []));
      } catch (error) {
        resolve([]);
      }
    });
  }

  function tellTab(tabId, message) {
    try {
      chrome.tabs.sendMessage(tabId, message, () => void chrome.runtime.lastError);
      return true;
    } catch (error) {
      return false;
    }
  }

  // Reihenfolge der Kandidaten für einen KI-Auftrag: der Tab, der zuletzt einen
  // Vorgang gemeldet hat, dann der aktive, dann die übrigen.
  function orderedAiTabs(tabs) {
    const score = (tab) => (tab.id === preferredTabId ? 0 : tab.active ? 1 : 2);
    return tabs.slice().sort((a, b) => score(a) - score(b));
  }

  // Sucht den Tab, der den KI-Auftrag ausführen soll: bevorzugt den, der
  // zuletzt einen Vorgang gemeldet hat, sonst irgendeinen offenen Jira-Tab.
  async function aiTabId() {
    const tabs = await queryTabs({ url: JIRA_MATCH });
    if (!tabs.length) return null;
    return orderedAiTabs(tabs)[0].id;
  }

  // Antwortet in diesem Tab ein lebendes Content-Script? Nur dorthin lohnt ein
  // Auftrag. chrome.tabs.sendMessage meldet einen fehlenden Empfänger nicht
  // synchron – ein Auftrag an einen stummen Tab verschwand deshalb lautlos, die
  // App lief in ihren 3-Minuten-Timeout und meldete am Ende „Modell nicht
  // nutzbar", obwohl in Wahrheit nur der Tab neu geladen werden musste.
  function pingAgent(tabId) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (value) => { if (!settled) { settled = true; resolve(value); } };
      try {
        chrome.tabs.sendMessage(tabId, { type: "sc-hud-ping" }, (response) => {
          void chrome.runtime.lastError;
          done(Boolean(response && response.ok));
        });
      } catch (error) {
        done(false);
      }
      setTimeout(() => done(false), 2000);
    });
  }

  async function requestTicket() {
    const tabs = await queryTabs({ url: JIRA_MATCH });
    if (!tabs.length) {
      send({ t: "ticket", ticket: null });
      return;
    }
    tabs.forEach((tab) => tellTab(tab.id, { type: "sc-hud-ticket-request" }));
  }

  // Sagt den Jira-Tabs Bescheid, ob die App läuft. Sie blenden ihr eigenes
  // Overlay in der Seite dann aus – sonst stünde dasselbe Cockpit zweimal da.
  async function broadcastState() {
    const isConnected = connected();
    const tabs = await queryTabs({ url: JIRA_MATCH });
    tabs.forEach((tab) => tellTab(tab.id, { type: "sc-hud-state", connected: isConnected }));
  }

  // --- KI ------------------------------------------------------------------

  // transport: true kennzeichnet „der Auftrag kam nicht bis zur KI" – im
  // Unterschied zu einer Antwort der KI selbst. Die App unterscheidet daran
  // Verbindungsproblem und Modellproblem (siehe desktop/renderer/shim-local-ai.js);
  // ohne diese Unterscheidung wurde jeder Verbindungsabbruch als „Das lokale
  // KI-Modell ist auf diesem Gerät nicht nutzbar" angezeigt und blieb hängen.
  function failTransport(id, error) {
    send({ t: "ai-result", id, ok: false, transport: true, error });
  }

  async function runAi(request) {
    const tabs = await queryTabs({ url: JIRA_MATCH });
    if (!tabs.length) {
      // Kein Jira-Tab offen: sofort ehrlich antworten, statt die App warten zu
      // lassen.
      failTransport(request.id, "In Chrome ist kein Jira-Tab offen. Bitte in Chrome einen Jira-Vorgang öffnen.");
      return;
    }
    // Den ersten Tab nehmen, der wirklich antwortet. Ein verwaistes
    // Content-Script (Extension neu geladen, Tab nicht) nimmt den Auftrag nicht
    // an – dann ist der nächste Tab dran, statt den Auftrag zu verlieren.
    for (const tab of orderedAiTabs(tabs)) {
      if (!(await pingAgent(tab.id))) continue;
      if (tellTab(tab.id, { ...request, type: "sc-hud-ai" })) return;
    }
    failTransport(
      request.id,
      "Kein Jira-Tab in Chrome hat den Auftrag angenommen. Nach einem Neuladen der Erweiterung muss der Jira-Tab neu geladen werden (F5)."
    );
  }

  async function abortAi(id) {
    const tabId = await aiTabId();
    if (tabId) tellTab(tabId, { type: "sc-hud-ai-abort", id });
  }

  // --- Kommandos aus dem Fenster -------------------------------------------

  function runCommand(name, args) {
    const background = app.background || {};
    switch (name) {
      case "focus-timio":
        if (typeof background.focusTimio === "function") background.focusTimio();
        return;
      case "focus-jira":
        focusJira();
        return;
      case "scrape-queue":
        if (typeof background.forceQueueScrape === "function") background.forceQueueScrape();
        return;
      case "open-url":
        if (args && /^https:\/\//i.test(args.url || "")) {
          try { chrome.tabs.create({ url: args.url }); } catch (error) { /* Fenster weg */ }
        }
        return;
      default:
        return;
    }
  }

  async function focusJira() {
    const tabs = await queryTabs({ url: JIRA_MATCH });
    const tab = tabs.find((item) => item.id === preferredTabId) || tabs[0];
    if (!tab) return;
    try {
      chrome.tabs.update(tab.id, { active: true });
      chrome.windows.update(tab.windowId, { focused: true });
    } catch (error) { /* Tab inzwischen zu */ }
  }

  // --- Verbindung ----------------------------------------------------------

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, retryMs);
    retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    // Der Worker kann vor dem Timer beendet werden. Der Alarm holt ihn dafür
    // spätestens nach einer Minute zurück – setTimeout allein wäre unzuverlässig.
    try { chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 }); } catch (error) { /* alarms fehlt */ }
  }

  // Steht die Verbindung, hat der Wiederhol-Alarm seinen Zweck erfüllt. Ohne
  // dieses Aufräumen weckt er den Service-Worker für den Rest der
  // Browser-Sitzung im Minutentakt, nur um in connect() sofort wieder
  // auszusteigen.
  function clearRetry() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    try { chrome.alarms.clear(RETRY_ALARM); } catch (error) { /* alarms fehlt */ }
  }

  function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

    let next;
    try {
      next = new WebSocket(URL);
    } catch (error) {
      scheduleRetry();
      return;
    }
    socket = next;

    next.addEventListener("open", () => {
      retryMs = RETRY_MIN_MS;
      clearRetry();
      send({ t: "hello", version: (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || "" });
      sendSnapshot();
      requestTicket();
      broadcastState();
    });

    next.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      if (!message || typeof message.t !== "string") return;

      switch (message.t) {
        case "sync":
          sendSnapshot();
          requestTicket();
          return;
        case "storage-set":
          try { chrome.storage.local.set(message.payload || {}); } catch (error) { /* Kontext weg */ }
          return;
        case "storage-remove":
          try { chrome.storage.local.remove(message.keys || []); } catch (error) { /* Kontext weg */ }
          return;
        case "ai-call":
          runAi(message);
          return;
        case "ai-abort":
          abortAi(message.id);
          return;
        case "cmd":
          runCommand(message.name, message.args);
          return;
        default:
          return;
      }
    });

    const onGone = () => {
      if (socket === next) socket = null;
      broadcastState();
      scheduleRetry();
    };
    next.addEventListener("close", onGone);
    next.addEventListener("error", onGone);
  }

  // --- Verdrahtung ---------------------------------------------------------

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(forwardStorageChange);
  }

  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message.type !== "string") return undefined;
      switch (message.type) {
        // Ein frisch geladenes Content-Script fragt nach, ob die App läuft.
        case "sc-hud-state?":
          sendResponse({ connected: connected() });
          return undefined;
        case "sc-hud-ticket":
          if (sender && sender.tab && message.ticket) preferredTabId = sender.tab.id;
          send({ t: "ticket", ticket: message.ticket || null });
          return undefined;
        case "sc-hud-ai-chunk":
          send({ t: "ai-chunk", id: message.id, chunk: message.chunk });
          return undefined;
        case "sc-hud-ai-download":
          send({ t: "ai-download", id: message.id, percent: message.percent });
          return undefined;
        case "sc-hud-ai-result":
          send({
            t: "ai-result",
            id: message.id,
            ok: Boolean(message.ok),
            result: message.result,
            error: message.error,
            errorName: message.errorName,
            aborted: Boolean(message.aborted)
          });
          return undefined;
        default:
          return undefined;
      }
    });
  }

  if (chrome.alarms && chrome.alarms.onAlarm) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm && alarm.name === RETRY_ALARM) connect();
    });
  }

  // Verschwindet der bevorzugte Tab, fällt die Wahl beim nächsten Auftrag
  // wieder auf irgendeinen offenen Jira-Tab.
  if (chrome.tabs && chrome.tabs.onRemoved) {
    chrome.tabs.onRemoved.addListener((tabId) => {
      if (tabId === preferredTabId) preferredTabId = null;
    });
  }

  app.hudBridge = { connect, connected, requestTicket };

  connect();
})();
