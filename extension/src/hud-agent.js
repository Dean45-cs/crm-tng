"use strict";

// Gegenstelle der Desktop-App im Jira-Tab.
//
// Zwei Aufgaben, die nur hier erledigt werden können:
//   1. Den geöffneten Vorgang lesen – dafür braucht es das DOM der Seite.
//   2. Die lokale KI ausführen – Chromes eingebaute Modelle (LanguageModel,
//      Summarizer, …) gibt es nur in Chrome selbst, nicht im Fenster der App.
//
// Beides läuft über denselben Code wie bisher (jira-reader.js, local-ai.js);
// diese Datei ist nur die Durchreiche zum Hintergrund-Worker, der wiederum mit
// der App spricht (siehe hud-bridge.js).

(function initHudAgent() {
  const app = window.StadtnetzCRM;
  const { jiraReader, localAi } = app;

  const TICKET_POLL_MS = 2000;
  const running = new Map(); // Auftrags-ID -> AbortController

  let lastSignature = "";
  let hudConnected = false;

  function tell(message) {
    try {
      chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
    } catch (error) { /* Extension neu geladen – der nächste Versuch klappt wieder */ }
  }

  function isIssueView() {
    return /\/browse\/[A-Z][A-Z0-9_]+-\d+/i.test(window.location.pathname)
      || Boolean(document.querySelector("#summary-val, #key-val"));
  }

  // --- Vorgang melden ------------------------------------------------------

  function pushTicket(force) {
    if (!hudConnected && !force) return;
    const ticket = isIssueView() ? jiraReader.read() : null;
    const signature = JSON.stringify(ticket);
    if (!force && signature === lastSignature) return;
    lastSignature = signature;
    tell({ type: "sc-hud-ticket", ticket });
  }

  // --- Übergabe an die App -------------------------------------------------

  // Läuft die App, gehört das Cockpit dorthin. Das Panel in der Seite wird dann
  // abgebaut – nicht bloß versteckt, sonst liefen beide Fassungen parallel und
  // würden dieselben KI-Aufgaben doppelt starten. Das Lesen des Vorgangs bleibt
  // davon unberührt, das erledigt jiraReader ohne Panel. Beim Beenden der App
  // kommt das Panel von selbst zurück.
  function setConnected(value) {
    const next = Boolean(value);
    if (next === hudConnected) return;
    hudConnected = next;
    app.hudTakeover = hudConnected;
    if (app.content) app.content.sync();
    if (hudConnected) pushTicket(true);
  }

  // --- KI-Aufträge ---------------------------------------------------------

  async function runAiJob(request) {
    const method = request && request.method;
    if (!localAi || typeof localAi[method] !== "function") {
      tell({ type: "sc-hud-ai-result", id: request.id, ok: false, error: `Unbekannte KI-Aufgabe: ${method}` });
      return;
    }

    const controller = new AbortController();
    running.set(request.id, controller);

    // Die Rückruf-Funktionen bleiben hier: über die Bridge geht nur JSON. Was
    // die App davon braucht, hat sie im Auftrag vermerkt.
    const options = { signal: controller.signal };
    if (request.wantsChunks) {
      options.onChunk = (accumulated) => tell({ type: "sc-hud-ai-chunk", id: request.id, chunk: accumulated });
    }
    if (request.wantsDownload) {
      options.onDownload = (percent) => tell({ type: "sc-hud-ai-download", id: request.id, percent });
    }

    // Die App hat den Options-Platz im Argumentblock schon freigeräumt (siehe
    // splitOptions in desktop/renderer/shim-local-ai.js) – hier werden nur die
    // Rückrufe wieder hineingelegt.
    const args = Array.isArray(request.args) ? request.args.slice() : [];
    const last = args[args.length - 1];
    if (last && typeof last === "object" && !Array.isArray(last)) {
      args[args.length - 1] = { ...last, ...options };
    } else if (method !== "capabilities" && method !== "detectLanguage") {
      args.push(options);
    }

    try {
      const result = await localAi[method](...args);
      tell({ type: "sc-hud-ai-result", id: request.id, ok: true, result });
    } catch (error) {
      const aborted = error && (error.name === "AbortError" || controller.signal.aborted);
      tell({
        type: "sc-hud-ai-result",
        id: request.id,
        ok: false,
        aborted: Boolean(aborted),
        error: String((error && error.message) || error),
        errorName: (error && error.name) || "Error"
      });
    } finally {
      running.delete(request.id);
    }
  }

  function abortAiJob(id) {
    const controller = running.get(id);
    if (!controller) return;
    controller.abort();
    running.delete(id);
  }

  // --- Verdrahtung ---------------------------------------------------------

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message.type !== "string") return;
    switch (message.type) {
      case "sc-hud-state":
        setConnected(message.connected);
        return;
      case "sc-hud-ticket-request":
        setConnected(true);
        pushTicket(true);
        return;
      case "sc-hud-ai":
        runAiJob(message);
        return;
      case "sc-hud-ai-abort":
        abortAiJob(message.id);
        return;
      default:
    }
  });

  // Jira baut Details und Kommentare verzögert auf und wechselt den Vorgang
  // ohne Seitenwechsel – deshalb regelmäßig nachsehen statt nur einmal beim
  // Laden. Gemeldet wird nur, was sich tatsächlich geändert hat.
  window.setInterval(() => pushTicket(false), TICKET_POLL_MS);

  try {
    chrome.runtime.sendMessage({ type: "sc-hud-state?" }, (response) => {
      void chrome.runtime.lastError;
      if (response) setConnected(response.connected);
    });
  } catch (error) { /* Worker schläft – er meldet sich beim Verbinden von selbst */ }
})();
