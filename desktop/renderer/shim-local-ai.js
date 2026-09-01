"use strict";

// Ersatz für extension/src/local-ai.js im HUD.
//
// Chromes eingebaute KI (LanguageModel/Summarizer/… – Gemini Nano) gibt es nur
// in Google Chrome selbst, nicht im Chromium, das Electron mitbringt. Die
// Aufgaben laufen deshalb weiterhin dort: dieselbe Datei local-ai.js, dieselben
// Prompts, dieselben Modelle. Hier steht nur die Fernbedienung dazu.
//
// Nach außen sieht die Schnittstelle identisch aus – inklusive Streaming
// (onChunk), Download-Fortschritt (onDownload) und Abbruch (AbortSignal),
// damit ui.js keinen Unterschied bemerkt.

(function initLocalAiShim() {
  const app = window.StadtnetzCRM;

  const STATUS = {
    UNSUPPORTED: "unsupported",
    UNAVAILABLE: "unavailable",
    DOWNLOADABLE: "downloadable",
    DOWNLOADING: "downloading",
    AVAILABLE: "available",
    OK: "ok",
    ERROR: "error"
  };

  // Fällt eine Antwort aus (Chrome zwischendurch geschlossen), soll die
  // Aufgabe nicht ewig hängen – ui.js zeigt sonst dauerhaft "läuft…".
  const TIMEOUT_MS = 180000;

  const pending = new Map();
  let nextId = 1;

  function abortError() {
    const error = new Error("Abgebrochen");
    error.name = "AbortError"; // ui.js erkennt daran den Abbruch (isAbort)
    return error;
  }

  window.hud.onAi((message) => {
    const entry = pending.get(message && message.id);
    if (!entry) return;

    if (message.t === "ai-chunk") {
      if (entry.onChunk) entry.onChunk(message.chunk || "");
      entry.touch();
      return;
    }
    if (message.t === "ai-download") {
      if (entry.onDownload) entry.onDownload(Number(message.percent) || 0);
      entry.touch();
      return;
    }
    if (message.t !== "ai-result") return;

    entry.finish();
    if (message.ok) return entry.resolve(message.result);
    if (message.aborted) return entry.reject(abortError());
    // Der Auftrag kam nicht bis zur KI (kein Jira-Tab, Tab stumm) – das ist ein
    // VERBINDUNGS-, kein Modellproblem. Bei der Fähigkeitsprüfung deshalb wie
    // "offline" antworten: das Panel zeigt dann den behebbaren Hinweis und prüft
    // von selbst erneut, statt „Das lokale KI-Modell ist auf diesem Gerät derzeit
    // nicht nutzbar" zu melden und alle KI-Knöpfe dauerhaft zu sperren.
    if (message.transport) return entry.rejectTransport(message.error);
    const error = new Error(message.error || "Die lokale KI in Chrome hat einen Fehler gemeldet.");
    error.name = message.errorName || "Error";
    entry.reject(error);
  });

  // Trennt die Rückruf-Funktionen von den übrigen Argumenten: über die Bridge
  // geht nur JSON, Funktionen bleiben hier und werden per Nachricht bedient.
  function splitOptions(args) {
    const copy = args.slice();
    const last = copy[copy.length - 1];
    if (!last || typeof last !== "object" || Array.isArray(last)) {
      return { args: copy, callbacks: {}, signal: null };
    }
    const { signal, onChunk, onDownload, ...rest } = last;
    copy[copy.length - 1] = rest;
    return {
      args: copy,
      callbacks: { onChunk: typeof onChunk === "function" ? onChunk : null, onDownload: typeof onDownload === "function" ? onDownload : null },
      signal: signal || null
    };
  }

  function call(method, rawArgs) {
    const { args, callbacks, signal } = splitOptions(Array.from(rawArgs));

    if (signal && signal.aborted) return Promise.reject(abortError());

    return new Promise((resolve, reject) => {
      const id = `ai-${nextId++}`;
      let timer = null;
      let onAbort = null;

      const finish = () => {
        pending.delete(id);
        if (timer) clearTimeout(timer);
        if (onAbort && signal) signal.removeEventListener("abort", onAbort);
      };
      // Ein Transportproblem (Chrome/Jira-Tab nicht erreichbar) ist keine Aussage
      // über das Modell. Die Fähigkeitsprüfung antwortet deshalb "offline" –
      // damit zeigt das Panel den behebbaren Hinweis und prüft automatisch
      // erneut; jede andere Aufgabe scheitert mit klarem Verbindungsfehler.
      const rejectTransport = (reason) => {
        finish();
        if (method === "capabilities") return resolve(offlineCapabilities(reason));
        const error = new Error(reason || "Keine Verbindung zur Chrome-Erweiterung.");
        error.name = "ConnectionError";
        reject(error);
      };
      // Jedes Lebenszeichen (Chunk, Download-Fortschritt) verlängert die Frist:
      // eine lange Zusammenfassung ist kein hängender Aufruf.
      const touch = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => rejectTransport("Chrome hat nicht geantwortet."), TIMEOUT_MS);
      };

      pending.set(id, { resolve, reject, finish, touch, rejectTransport, method, ...callbacks });
      touch();

      if (signal) {
        onAbort = () => {
          window.hud.aiAbort(id);
          finish();
          reject(abortError());
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }

      window.hud
        .aiCall({
          id,
          method,
          args,
          wantsChunks: Boolean(callbacks.onChunk),
          wantsDownload: Boolean(callbacks.onDownload)
        })
        .then((delivered) => {
          if (delivered) return;
          // Keine Extension verbunden. Genau wie das Original antworten, wenn
          // die lokale KI nicht zur Verfügung steht – ui.js zeigt dafür schon
          // den passenden Hinweis an.
          finish();
          resolve(method === "capabilities" ? offlineCapabilities() : { status: STATUS.UNSUPPORTED });
        })
        .catch((error) => {
          // Auch ein Fehler auf dem Weg zur Extension ist ein Transportproblem.
          rejectTransport((error && error.message) || "Keine Verbindung zur Chrome-Erweiterung.");
        });
    });
  }

  function offlineCapabilities(reason) {
    return {
      status: STATUS.UNSUPPORTED,
      usable: false,
      needsDownload: false,
      downloading: false,
      // Klartext, woran es lag – das Panel hängt ihn an den Hinweis.
      reason: reason || "",
      hasSummarizer: false,
      hasRewriter: false,
      hasProofreader: false,
      hasTranslator: false,
      hasDetector: false,
      // Nur fürs HUD: unterscheidet "Chrome fehlt" von "Chrome kann es nicht".
      offline: true
    };
  }

  const METHODS = [
    "capabilities", "summarize", "triage", "prepareCall", "advise", "documentTicket",
    "draftComment", "draftEmail", "draftHandoffComment", "draftHandoffEmail",
    "reviewDraft", "rewrite", "proofread", "detectLanguage", "translate"
  ];

  const localAi = { STATUS };
  METHODS.forEach((method) => {
    localAi[method] = function proxied() {
      return call(method, arguments);
    };
  });

  app.localAi = localAi;
})();
