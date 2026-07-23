(function initLookupOrchestrator() {
  "use strict";

  // Hintergrund-Orchestrierung der Netz-Auskunft. Läuft im Service-Worker
  // (importScripts in background.js). Öffnet/findet den passenden Dashboard-Tab,
  // wartet aufs Laden, spricht das deklarative Content-Script an und spiegelt
  // Fortschritt + Ergebnis nach chrome.storage.local (storageKeys.lookupResult),
  // von wo das Jira-Panel (ui.js) es liest.
  //
  // Bewusst über Message-Passing an deklarative Content-Scripts statt
  // chrome.scripting.executeScript: Letzteres injiziert generierten Code und
  // scheitert auf strikten CSP/Trusted-Types-Seiten (siehe Kommentar in
  // background.js/forceQueueScrape). Die deklarativ geladenen Scraper sind davon
  // nicht betroffen.
  //
  // GATE: runLookup läuft nur bei settings.enableLookups === true. Das ist die
  // technische Absicherung; der eigentliche Bestätigungsdialog vor jedem Lauf
  // sitzt im Panel (ui.js). So ist auch ein Bridge-Aufruf (bridge.js) doppelt
  // abgesichert: enableBridge erlaubt die Verbindung, enableLookups die
  // Automatisierung selbst.

  const app = globalThis.StadtnetzCRM || (globalThis.StadtnetzCRM = {});
  const CONFIG = app.CONFIG || {};
  const KEYS = CONFIG.storageKeys || {};
  const LOOKUPS = CONFIG.lookups || {};

  // Diagnose: erscheint in der Service-Worker-Konsole (chrome://extensions →
  // „Service Worker"). Macht sichtbar, ob der Auftrag ankommt und woran ein
  // Lauf ggf. scheitert.
  function log(...args) {
    try { console.log("[Netz-Auskunft]", ...args); } catch (error) { /* egal */ }
  }

  // In-Flight-Spiegel des laufenden Lookups (Worker lebt während des aktiven
  // async-Vorgangs; Storage ist die Quelle der Wahrheit fürs Panel).
  const active = new Map();

  function getLocal(keys) {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(keys, (data) => resolve(data || {})); }
      catch (error) { resolve({}); }
    });
  }
  function setLocal(payload) {
    try { chrome.storage.local.set(payload); } catch (error) { /* Worker beendet */ }
  }
  function queryTabs(info) {
    return new Promise((resolve) => {
      try { chrome.tabs.query(info, (tabs) => resolve(tabs || [])); }
      catch (error) { resolve([]); }
    });
  }
  function createTab(opts) {
    return new Promise((resolve) => {
      try { chrome.tabs.create(opts, (tab) => resolve(tab || null)); }
      catch (error) { resolve(null); }
    });
  }
  function sendTabMessage(tabId, message) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          const err = chrome.runtime.lastError;
          if (err) return resolve({ ok: false, error: err.message });
          resolve(response || { ok: false, error: "Keine Antwort vom Dashboard-Tab." });
        });
      } catch (error) {
        resolve({ ok: false, error: (error && error.message) || String(error) });
      }
    });
  }
  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  function waitForTabLoad(tabId, timeout) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        try { chrome.tabs.onUpdated.removeListener(listener); } catch (error) { /* egal */ }
        resolve();
      };
      const listener = (id, info) => { if (id === tabId && info.status === "complete") finish(); };
      try { chrome.tabs.onUpdated.addListener(listener); } catch (error) { return resolve(); }
      setTimeout(finish, timeout || 20000);
    });
  }

  function initSteps(kind) {
    const def = (LOOKUPS[kind] && LOOKUPS[kind].steps) || [];
    return def.map((step) => ({ id: step.id, state: "pending" }));
  }

  function writeResult(result) {
    result.updatedAt = Date.now();
    active.set(result.requestId, result);
    setLocal({ [KEYS.lookupResult]: result });
  }

  function applyStep(requestId, stepId, stepState) {
    const result = active.get(requestId);
    if (!result) return;
    const step = result.steps.find((s) => s.id === stepId);
    if (step) step.state = stepState;
    else result.steps.push({ id: stepId, state: stepState });
    writeResult(result);
  }

  async function findOrOpenTab(dash) {
    const tabs = await queryTabs({ url: dash.urlMatch });
    if (tabs.length) return { tabId: tabs[0].id, created: false, complete: tabs[0].status === "complete" };
    const tab = await createTab({ url: dash.openUrl, active: true });
    return tab ? { tabId: tab.id, created: true, complete: false } : null;
  }

  // Ruft das Content-Script an und wartet auf dessen Antwort. Wiederholt nur bei
  // „kein Empfänger" (Content-Script noch nicht geladen), gedeckelt durch
  // timeoutMs (Navigation + Extraktion können bei Baustatus 20–30 s dauern).
  async function callContentScript(tabId, messageType, payload, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 45000);
    let lastError = "Abfrage fehlgeschlagen.";
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const response = await Promise.race([
        sendTabMessage(tabId, Object.assign({ type: messageType }, payload)),
        sleep(remaining).then(() => ({ __timeout: true }))
      ]);
      if (response && response.__timeout) return { ok: false, error: "Zeitüberschreitung bei der Abfrage." };
      if (response && response.ok) return response;
      lastError = (response && response.error) || lastError;
      if (response && response.error && /receiving end|establish connection|no matching|not establish/i.test(response.error)) {
        await sleep(800);
        continue;
      }
      return { ok: false, error: lastError };
    }
    return { ok: false, error: lastError };
  }

  async function runLookup(request) {
    const req = request || {};
    const requestId = req.requestId || `lk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const kind = req.kind;
    const customerNumber = String(req.customerNumber || "").trim();
    const source = req.source || "panel";
    const dash = LOOKUPS[kind];
    const base = { requestId, kind, customerNumber, source, steps: initSteps(kind), data: null, error: "" };
    log(`Auftrag: kind=${kind} kunde=${customerNumber} quelle=${source} id=${requestId}`);

    // Gate: Master-Schalter (technische Absicherung; Dialog sitzt im Panel).
    const stored = await getLocal([KEYS.settings]);
    const settings = stored[KEYS.settings] || {};
    if (settings.enableLookups !== true) {
      log("Abbruch: enableLookups ist AUS.");
      writeResult(Object.assign({}, base, { status: "error", error: "Netz-Auskunft ist ausgeschaltet – erst in den Einstellungen aktivieren." }));
      return { ok: false, error: "disabled", requestId };
    }
    if (!dash) {
      writeResult(Object.assign({}, base, { status: "error", error: `Unbekannte Abfrageart: ${kind}` }));
      return { ok: false, error: "unknown-kind", requestId };
    }
    if (!customerNumber) {
      writeResult(Object.assign({}, base, { status: "error", error: "Keine Kundennummer erkannt." }));
      return { ok: false, error: "no-customer", requestId };
    }

    writeResult(Object.assign({}, base, { status: "running" }));

    const target = await findOrOpenTab(dash);
    if (!target) {
      log("Fehler: chrome.tabs.create/query lieferte keinen Tab (Permission fehlt? Extension neu laden).");
      writeResult(Object.assign({}, active.get(requestId) || base, { status: "error", error: "Dashboard-Tab konnte nicht geöffnet werden. Extension in chrome://extensions neu laden (die „tabs\"-Berechtigung wurde neu hinzugefügt)." }));
      return { ok: false, error: "no-tab", requestId };
    }
    log(`Tab bereit: id=${target.tabId} neu=${target.created} geladen=${target.complete} → ${dash.openUrl}`);
    if (!target.complete) await waitForTabLoad(target.tabId, LOOKUPS.tabLoadTimeoutMs);
    await sleep(600);

    const response = await callContentScript(
      target.tabId,
      `sc-lookup-${kind}`,
      { requestId, customerNumber, address: req.address || "" },
      LOOKUPS.lookupTimeoutMs
    );

    const latest = active.get(requestId) || base;
    if (response && response.ok) {
      writeResult(Object.assign({}, latest, { status: "ok", data: response.data, error: "" }));
      return { ok: true, data: response.data, requestId };
    }
    let error = (response && response.error) || "Abfrage fehlgeschlagen.";
    // Häufigste reale Ursache, wenn das Content-Script nie antwortet: der
    // Dashboard-Tab lädt eine Login-/SSO-Seite statt des Dashboards, oder die
    // Oberfläche sieht anders aus als erwartet. Konkreten Hinweis anhängen.
    if (/zeitüberschreitung|keine antwort|receiving end|establish connection/i.test(error)) {
      error += ` (Ist der Tab „${dash.openUrl}" geladen und bist du dort angemeldet? Dashboard offen lassen und erneut versuchen.)`;
    }
    writeResult(Object.assign({}, latest, { status: "error", error }));
    return { ok: false, error, requestId };
  }

  // Fortschrittsmeldungen der Content-Scripts + Auslöser aus dem Panel.
  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (!message) return;
      if (message.type === "sc-lookup-step" && message.requestId) {
        applyStep(message.requestId, message.step, message.state);
      } else if (message.type === "sc-run-lookup" && message.request) {
        // Fire-and-forget: das Panel liest Fortschritt/Ergebnis aus dem Storage.
        log("sc-run-lookup empfangen.");
        runLookup(message.request);
      }
    });
  } catch (error) {
    // Kein chrome.runtime (Node-Test) – reine Logik bleibt über app.lookup testbar.
  }

  app.lookup = { runLookup, initSteps, applyStep, waitForTabLoad };
  log("lookup.js geladen – bereit für sc-run-lookup / sc-lookup-step.");
})();
