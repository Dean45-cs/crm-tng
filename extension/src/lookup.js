(function initLookupOrchestrator() {
  "use strict";

  // Hintergrund-Orchestrierung der Netz-Auskunft. Läuft im Service-Worker
  // (importScripts in background.js). Nimmt Aufträge entgegen, bringt den
  // Dashboard-Tab in einen definierten Zustand, spricht das deklarative
  // Content-Script an und spiegelt Fortschritt + Ergebnis nach
  // chrome.storage.local (storageKeys.lookupResult), von wo das Jira-Panel
  // (ui.js) es liest.
  //
  // Leitgedanke: JEDER Auftrag endet sichtbar. Entweder mit Daten oder mit einer
  // Fehlermeldung, die sagt, was zu tun ist – nie mit Stille. Die fünf Stellen,
  // an denen vorher lautlos nichts passierte, und wie sie abgesichert sind:
  //
  //   1. AUFTRAG GEHT VERLOREN. chrome.runtime.sendMessage ist ein Zuruf ohne
  //      Zustellgarantie: schläft der Worker, wurde er beendet oder ist er beim
  //      Laden gescheitert, verschwindet die Nachricht – es öffnete sich nicht
  //      einmal ein Tab. Der Auftrag liegt deshalb ZUSÄTZLICH im Storage
  //      (storageKeys.lookupRequest). Eine Storage-Änderung weckt den
  //      Service-Worker zuverlässig, und beim Start sieht er ohnehin nach, ob
  //      noch etwas offen ist. Beide Wege laufen in dieselbe Annahme (claimJob),
  //      die per requestId gegen Doppelstarts sichert.
  //   2. ANNAHME UNSICHTBAR. Der Worker quittiert sofort (phase "accepted").
  //      Bleibt die Quittung aus, weiß das Panel binnen Sekunden, dass der
  //      Dienst nicht läuft – statt eine Minute auf einen Timeout zu warten.
  //   3. HINTERGRUND-TAB. Chrome drosselt setTimeout in einem nicht sichtbaren
  //      Tab auf >= 1 s und nach einigen Minuten auf einen Aufruf pro Minute.
  //      Die Scraper pollen das DOM – im Hintergrund verhungert jede
  //      Wartebedingung. Der Tab wird deshalb aktiviert und sein Fenster
  //      fokussiert; danach kehrt der Fokus zum Ausgangs-Tab zurück.
  //   4. UNDEFINIERTER AUSGANGSZUSTAND. Die Dashboards sind Einzelseiten-Apps:
  //      nach einem Lauf steht fttx-dash tief in einem Bauabschnitt. Jeder Lauf
  //      setzt den Tab deshalb auf die Startseite zurück – das spielt zugleich
  //      ein frisches Content-Script ein.
  //   5. WORKER STIRBT MITTENDRIN. Ohne regelmäßigen chrome.*-Aufruf beendet
  //      Chrome den kurzlebigen Worker. Der Heartbeat hält ihn wach und frischt
  //      updatedAt auf, damit der Panel-Watchdog nur bei echter Stille greift.
  //
  // Bewusst über Message-Passing an deklarative Content-Scripts statt
  // chrome.scripting.executeScript: Letzteres injiziert generierten Code und
  // scheitert auf strikten CSP/Trusted-Types-Seiten. Die deklarativ geladenen
  // Scraper sind davon nicht betroffen.
  //
  // GATE: runLookup läuft nur bei settings.enableLookups === true. Das ist die
  // technische Absicherung; der Bestätigungsdialog vor jedem Lauf sitzt im Panel
  // (ui.js). So ist auch ein Bridge-Aufruf (bridge.js) doppelt abgesichert:
  // enableBridge erlaubt die Verbindung, enableLookups die Automatisierung.

  const app = globalThis.StadtnetzCRM || (globalThis.StadtnetzCRM = {});
  const CONFIG = app.CONFIG || {};
  const KEYS = CONFIG.storageKeys || {};
  const LOOKUPS = CONFIG.lookups || {};

  // Fehler, die bedeuten „die Nachricht hat niemanden erreicht bzw. die
  // Gegenstelle ist mitten im Vorgang verschwunden". Genau diese lohnen einen
  // zweiten Anlauf – alles andere ist ein echter Fehler und wird gemeldet.
  const TRANSPORT_ERROR = /receiving end|establish connection|no matching|not establish|message port closed|keine antwort/i;
  // Ein Auftrag aus dem Storage ist nur kurz gültig. Sonst startete ein Worker,
  // der Stunden später aus anderem Anlass hochfährt, eine längst vergessene
  // Abfrage – und öffnete unvermittelt ein Dashboard.
  const PENDING_MAX_AGE_MS = 120000;

  // Diagnose: erscheint in der Service-Worker-Konsole (chrome://extensions →
  // „Service Worker"). Macht sichtbar, ob der Auftrag ankommt und woran ein
  // Lauf ggf. scheitert.
  function log(...args) {
    try { console.log("[Netz-Auskunft]", ...args); } catch (error) { /* egal */ }
  }

  // In-Flight-Spiegel des laufenden Lookups (Worker lebt während des aktiven
  // async-Vorgangs; Storage ist die Quelle der Wahrheit fürs Panel).
  const active = new Map();
  // Bereits angenommene Aufträge dieser Worker-Instanz – verhindert, dass
  // Nachricht UND Storage-Ereignis denselben Auftrag zweimal starten.
  const claimedIds = new Set();
  // Läuft gerade eine Abfrage? Es darf immer nur eine sein – zwei parallele
  // Läufe würden sich denselben Dashboard-Tab wegziehen (zwei Jira-Tabs,
  // Doppelklick, Bridge-Aufruf während einer Panel-Abfrage).
  let runningRequestId = null;

  // ---------------------------------------------------------------------------
  // chrome.* als Promises. Alle mit Schutz: fehlt eine API oder wirft sie, ist
  // das ein normaler Rückgabewert, kein Absturz mitten im Auftrag.
  // ---------------------------------------------------------------------------

  // Jeder chrome.*-Aufruf mit Rückruf bekommt hier eine Frist und einen
  // Ersatzwert. Bleibt ein Rückruf aus – weil der Tab verschwindet, die API in
  // dieser Umgebung anders aussieht oder der Worker gerade abgebaut wird –, wäre
  // der Auftrag sonst lautlos für immer angehalten: kein Tab, kein Fehler,
  // nichts. Genau das Verhalten, das als „es passiert gar nichts" auffällt.
  // Lieber mit einem Ersatzwert weiterlaufen und sichtbar scheitern.
  function guarded(executor, fallback, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        resolve(value === undefined ? fallback : value);
      };
      try { executor(done); } catch (error) { return done(fallback); }
      try { setTimeout(() => done(fallback), timeoutMs || 5000); } catch (error) { /* ohne Timer eben ohne Netz */ }
    });
  }

  function getLocal(keys) {
    return guarded((done) => {
      chrome.storage.local.get(keys, (data) => { void chrome.runtime.lastError; done(data || {}); });
    }, {});
  }
  function setLocal(payload) {
    try { chrome.storage.local.set(payload); } catch (error) { /* Worker beendet */ }
  }
  function removeLocal(keys) {
    return guarded((done) => {
      // Ältere/abweichende Umgebungen kennen den Rückruf nicht – dann greift die
      // Frist oben und es geht trotzdem weiter.
      chrome.storage.local.remove(keys, () => { void chrome.runtime.lastError; done(true); });
    }, true, 1500);
  }
  function queryTabs(info) {
    return guarded((done) => {
      chrome.tabs.query(info, (tabs) => { void chrome.runtime.lastError; done(tabs || []); });
    }, []);
  }
  function createTab(opts) {
    return guarded((done) => {
      chrome.tabs.create(opts, (tab) => { void chrome.runtime.lastError; done(tab || null); });
    }, null);
  }
  function getTab(tabId) {
    return guarded((done) => {
      if (!chrome.tabs || typeof chrome.tabs.get !== "function") return done(null);
      chrome.tabs.get(tabId, (tab) => { void chrome.runtime.lastError; done(tab || null); });
    }, null);
  }
  function updateTab(tabId, props) {
    return guarded((done) => {
      if (!chrome.tabs || typeof chrome.tabs.update !== "function") return done(null);
      chrome.tabs.update(tabId, props, (tab) => { void chrome.runtime.lastError; done(tab || null); });
    }, null);
  }
  function focusWindow(windowId) {
    return guarded((done) => {
      if (windowId == null || !chrome.windows || typeof chrome.windows.update !== "function") return done(true);
      chrome.windows.update(windowId, { focused: true }, () => { void chrome.runtime.lastError; done(true); });
    }, true);
  }
  function reloadTab(tabId) {
    return guarded((done) => {
      if (!chrome.tabs || typeof chrome.tabs.reload !== "function") return done(true);
      chrome.tabs.reload(tabId, { bypassCache: false }, () => { void chrome.runtime.lastError; done(true); });
    }, true);
  }
  function sendTabMessage(tabId, message) {
    return guarded((done) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) return done({ ok: false, error: err.message });
        done(response || { ok: false, error: "Keine Antwort vom Dashboard-Tab." });
      });
      // Kein eigener Timeout hier: die Antwort auf einen Lookup darf lange
      // dauern. Die Frist setzt callContentScript (lookupTimeoutMs).
    }, { ok: false, error: "Keine Antwort vom Dashboard-Tab." }, LOOKUPS.lookupTimeoutMs || 90000);
  }
  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  // ---------------------------------------------------------------------------
  // Ergebnis-Zustand (Quelle der Wahrheit fürs Panel)
  // ---------------------------------------------------------------------------

  function initSteps(kind) {
    const def = (LOOKUPS[kind] && LOOKUPS[kind].steps) || [];
    return def.map((step) => ({ id: step.id, state: "pending" }));
  }

  function writeResult(result) {
    result.updatedAt = Date.now();
    active.set(result.requestId, result);
    setLocal({ [KEYS.lookupResult]: result });
  }

  function mergeStep(result, stepId, stepState) {
    if (!Array.isArray(result.steps)) result.steps = [];
    const step = result.steps.find((s) => s.id === stepId);
    if (step) step.state = stepState;
    else result.steps.push({ id: stepId, state: stepState });
    writeResult(result);
  }

  function applyStep(requestId, stepId, stepState) {
    const inMemory = active.get(requestId);
    if (inMemory) { mergeStep(inMemory, stepId, stepState); return; }
    // Der Service-Worker ist kurzlebig: Chrome kann ihn zwischen Auftragsstart
    // und Fortschrittsmeldung beenden und neu starten – dann ist der In-Memory-
    // Spiegel (active) leer. Die Meldung dann einfach zu verwerfen ließ das
    // Panel ewig bei „läuft" hängen. Stattdessen den letzten Stand aus dem
    // Storage holen und dort weiterschreiben – aber nur, wenn er zur selben
    // Anfrage gehört (sonst würde eine Meldung eine fremde/ältere Abfrage
    // überschreiben).
    getLocal([KEYS.lookupResult]).then((data) => {
      const stored = data[KEYS.lookupResult];
      if (!stored || stored.requestId !== requestId) return;
      active.set(requestId, stored);
      mergeStep(stored, stepId, stepState);
    });
  }

  // Abschnitt + Klartext für die Anzeige. phase treibt zusätzlich die
  // Annahme-Erkennung im Panel: alles außer "queued" heißt „der Worker lebt".
  function setPhase(requestId, phase, note) {
    const result = active.get(requestId);
    if (!result || result.status !== "running") return;
    result.phase = phase;
    result.note = note || "";
    writeResult(result);
  }

  function resetSteps(requestId, kind) {
    const result = active.get(requestId);
    if (!result) return;
    result.steps = initSteps(kind);
    writeResult(result);
  }

  // Lebenszeichen: hält den Worker wach (jeder chrome.*-Aufruf setzt Chromes
  // Leerlauf-Uhr zurück) UND frischt updatedAt auf.
  function startHeartbeat(requestId) {
    const everyMs = LOOKUPS.heartbeatMs || 10000;
    let stopped = false;
    const beat = () => {
      if (stopped) return;
      try {
        if (chrome.runtime && typeof chrome.runtime.getPlatformInfo === "function") {
          chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError);
        }
      } catch (error) { /* egal – das Auffrischen unten zählt genauso */ }
      const result = active.get(requestId);
      if (result && result.status === "running") writeResult(result);
    };
    let handle = null;
    try {
      if (typeof setInterval === "function") handle = setInterval(beat, everyMs);
    } catch (error) { handle = null; }
    return () => {
      stopped = true;
      try { if (handle != null && typeof clearInterval === "function") clearInterval(handle); }
      catch (error) { /* egal */ }
    };
  }

  // ---------------------------------------------------------------------------
  // Dashboard-Tab vorbereiten
  // ---------------------------------------------------------------------------

  function originOf(url) {
    const match = String(url || "").match(/^https?:\/\/[^/]+/i);
    return match ? match[0] : "";
  }

  function sameLocation(a, b) {
    const strip = (value) => String(value || "").split("#")[0].split("?")[0].replace(/\/+$/, "");
    return strip(a) === strip(b);
  }

  // Sucht offene Tabs des Dashboards. Zwei Wege, damit eine Eigenheit der
  // Musterabfrage nicht dazu führt, dass gar nichts gefunden UND nichts geöffnet
  // wird: erst per url-Muster, sonst alle Tabs holen und selbst nach der Origin
  // filtern.
  async function findDashboardTabs(dash) {
    const byPattern = await queryTabs({ url: dash.urlMatch });
    if (byPattern.length) return byPattern;
    const origin = originOf(dash.openUrl);
    if (!origin) return [];
    const all = await queryTabs({});
    return all.filter((tab) => String(tab.url || "").indexOf(origin) === 0);
  }

  // Wartet, bis der Tab fertig geladen ist: onUpdated-Ereignis UND Polling des
  // Status, damit ein bereits fertiger Tab nicht in den vollen Timeout läuft.
  //
  // options.expectNavigation: Es wurde gerade eine Navigation ausgelöst. Chrome
  // meldet den Tab dann für einen Moment noch als "complete" (die alte Seite
  // steht ja noch) – dieses "complete" darf nicht als „fertig" gelten, sonst
  // automatisieren wir die Seite VOR dem Zurücksetzen.
  function waitForTabLoad(tabId, timeout, options) {
    const minWaitMs = options && options.expectNavigation ? 1200 : 0;
    const limit = timeout || 20000;
    return new Promise((resolve) => {
      let done = false;
      let poll = null;
      let sawLoading = false;
      const start = Date.now();
      const finish = () => {
        if (done) return;
        done = true;
        if (poll) clearTimeout(poll);
        try { chrome.tabs.onUpdated.removeListener(listener); } catch (error) { /* egal */ }
        resolve();
      };
      const listener = (id, info) => {
        if (id !== tabId) return;
        if (info.status === "loading") sawLoading = true;
        if (info.status === "complete") finish();
      };
      try { chrome.tabs.onUpdated.addListener(listener); } catch (error) { /* Polling reicht */ }
      const check = () => {
        if (done) return;
        getTab(tabId).then((tab) => {
          if (done) return;
          if (!tab) return finish();                       // Tab weg – nicht endlos warten
          if (tab.status === "loading") sawLoading = true;
          if (tab.status === "complete" && (sawLoading || Date.now() - start >= minWaitMs)) return finish();
          if (Date.now() - start >= limit) return finish();
          poll = setTimeout(check, 300);
        });
      };
      check();
      setTimeout(finish, limit);
    });
  }

  // Erreichbarkeits- und Bereitschafts-Ping ans deklarative Content-Script.
  //   alive = ein Script mit gültigem Kontext antwortet
  //   ready = auf der Seite steht wirklich das Dashboard (readySelectors)
  // Die Unterscheidung ist der Unterschied zwischen „bitte Tab neu laden" und
  // „bitte im Dashboard anmelden" – vorher lief beides in denselben
  // nichtssagenden Timeout.
  async function probeContentScript(tabId, timeoutMs) {
    const res = await Promise.race([
      sendTabMessage(tabId, { type: "sc-ping" }),
      sleep(timeoutMs || 2500).then(() => ({ __timeout: true }))
    ]);
    if (!res || res.__timeout || !res.ok || !res.pong) return { alive: false, ready: false };
    // ready/loadedAt fehlen bei einem älteren, noch nicht neu geladenen
    // Content-Script – dann nicht blockieren, sondern es versuchen lassen.
    return { alive: true, ready: res.ready !== false, loadedAt: res.loadedAt || 0, url: res.url || "" };
  }

  // minLoadedAt: Nur ein Content-Script akzeptieren, das NACH dem Zurücksetzen
  // gestartet ist. Ohne diese Schranke könnte das noch lebende Script der alten
  // Seite den Ping beantworten und wir würden den Zustand automatisieren, den
  // wir gerade verwerfen wollten.
  async function waitForDashboardReady(tabId, timeoutMs, minLoadedAt) {
    const deadline = Date.now() + (timeoutMs || 25000);
    const since = minLoadedAt || 0;
    let sawAlive = false;
    while (Date.now() < deadline) {
      const probe = await probeContentScript(tabId, 2500);
      const fresh = !since || !probe.loadedAt || probe.loadedAt >= since;
      if (probe.alive && fresh) {
        sawAlive = true;
        if (probe.ready) return { ok: true };
      }
      await sleep(600);
    }
    return { ok: false, sawAlive };
  }

  // Findet/öffnet den Tab, holt ihn in den Vordergrund, setzt ihn auf die
  // Startseite zurück und wartet auf ein frisches, bereites Content-Script.
  async function prepareDashboardTab(dash, requestId) {
    setPhase(requestId, "tab", "Dashboard-Tab öffnen …");

    const tabs = await findDashboardTabs(dash);
    let tabId;
    let created = false;
    if (tabs.length) {
      const preferred = tabs.find((tab) => tab.active) || tabs[0];
      tabId = preferred.id;
    } else {
      const tab = await createTab({ url: dash.openUrl, active: true });
      if (!tab || typeof tab.id !== "number") {
        log("chrome.tabs.create lieferte keinen Tab.");
        return {
          ok: false,
          retryable: false,
          error: `Der Tab „${dash.openUrl}" konnte nicht geöffnet werden. Bitte die Extension in chrome://extensions neu laden und den Jira-Tab mit F5 aktualisieren.`
        };
      }
      tabId = tab.id;
      created = true;
    }
    log(`Tab ${created ? "geöffnet" : "gefunden"}: id=${tabId}`);

    const before = await getTab(tabId);
    // Vordergrund – ohne das drosselt Chrome die Timer des Scrapers.
    await updateTab(tabId, { active: true });
    if (before && before.windowId != null) await focusWindow(before.windowId);

    // Definierter Ausgangszustand. Ein frisch geöffneter Tab lädt die Startseite
    // ohnehin schon.
    const resetAt = Date.now();
    if (!created) {
      setPhase(requestId, "reset", "Dashboard zurücksetzen …");
      const current = (before && before.url) || "";
      if (sameLocation(current, dash.openUrl)) await reloadTab(tabId);
      else await updateTab(tabId, { url: dash.openUrl });
    }

    await waitForTabLoad(tabId, LOOKUPS.tabLoadTimeoutMs, { expectNavigation: !created });

    setPhase(requestId, "ready", "Auf das Dashboard warten …");
    const ready = await waitForDashboardReady(tabId, LOOKUPS.readyTimeoutMs, created ? 0 : resetAt);
    if (!ready.ok) {
      // Antwortet ein Script, steht dort nur nicht das Dashboard, ist die
      // wahrscheinlichste Ursache eine Login-/SSO-Seite. Antwortet gar nichts,
      // fehlt das Content-Script (Extension frisch geladen, Seite blockt).
      const error = ready.sawAlive
        ? `Im Tab „${dash.openUrl}" ist das Dashboard nicht zu sehen. Bist du dort angemeldet? Bitte im Tab anmelden und erneut „Nachschlagen" drücken.`
        : `Der Dashboard-Tab „${dash.openUrl}" meldet sich nicht. Bitte prüfen, ob die Seite dort lädt, und die Extension in chrome://extensions neu laden.`;
      return { ok: false, retryable: true, error, tabId };
    }

    return { ok: true, tabId };
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

  // ---------------------------------------------------------------------------
  // Winback: Kündigungsticket direkt öffnen
  //
  // Steht der Kunde auf der Churnliste, ist der nächste Handgriff immer derselbe:
  // das Kündigungsticket aufmachen und nachlesen, woran es lag. Die Churnliste
  // führt die Ticketnummer selbst (Spalte „JIRA Ticket-Nr."), also wird das
  // erspart. Im geöffneten Vorgang läuft das Panel ohnehin an und erstellt die
  // KI-Gesprächsvorbereitung – mit der Kündigungsursache aus dieser Abfrage als
  // Kontext (siehe ui.js/churnContextForTicket).
  // ---------------------------------------------------------------------------

  function churnTicketUrl(data) {
    const cases = (data && data.cases) || [];
    const hit = cases.find((entry) => entry && (entry.jiraHref || entry.jiraTicket));
    if (!hit) return "";
    if (hit.jiraHref) return hit.jiraHref;
    const shared = app.shared || {};
    return typeof shared.jiraTicketUrl === "function" ? shared.jiraTicketUrl(hit.jiraTicket) : "";
  }

  async function openChurnTicket(data) {
    const url = churnTicketUrl(data);
    if (!/^https?:\/\//i.test(url)) return "";
    // Bereits offen? Dann diesen Tab nach vorn holen statt einen zweiten zu öffnen.
    const all = await queryTabs({});
    const existing = all.find((tab) => sameLocation(tab.url, url));
    if (existing) {
      await updateTab(existing.id, { active: true });
      if (existing.windowId != null) await focusWindow(existing.windowId);
      log(`Kündigungsticket bereits offen – in den Vordergrund geholt: ${url}`);
      return url;
    }
    const tab = await createTab({ url, active: true });
    log(`Kündigungsticket geöffnet: ${url}`);
    return tab ? url : "";
  }

  // Bringt den Fokus zurück auf den Tab, aus dem der Auftrag kam (normalerweise
  // Jira) – der Bearbeiter soll dort weiterarbeiten, wo er geklickt hat.
  async function restoreFocus(callerTabId, dashboardTabId) {
    if (typeof callerTabId !== "number" || callerTabId === dashboardTabId) return;
    const tab = await getTab(callerTabId);
    if (!tab) return;
    await updateTab(callerTabId, { active: true });
    if (tab.windowId != null) await focusWindow(tab.windowId);
  }

  // ---------------------------------------------------------------------------
  // Der Lauf
  // ---------------------------------------------------------------------------

  async function runLookup(request) {
    const req = request || {};
    const requestId = req.requestId || `lk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const kind = req.kind;
    const customerNumber = String(req.customerNumber || "").trim();
    const source = req.source || "panel";
    const callerTabId = typeof req.callerTabId === "number" ? req.callerTabId : null;
    const dash = LOOKUPS[kind];
    const base = {
      requestId, kind, customerNumber, source,
      steps: initSteps(kind), data: null, error: "", note: "", phase: "accepted"
    };
    log(`Auftrag: kind=${kind} kunde=${customerNumber} quelle=${source} id=${requestId}`);

    const fail = (error) => {
      const latest = active.get(requestId) || base;
      writeResult(Object.assign({}, latest, { status: "error", error, note: "", phase: "done" }));
      return { ok: false, error, requestId };
    };

    // Gate: Master-Schalter (technische Absicherung; Dialog sitzt im Panel).
    const stored = await getLocal([KEYS.settings]);
    const settings = stored[KEYS.settings] || {};
    if (settings.enableLookups !== true) {
      log("Abbruch: enableLookups ist AUS.");
      writeResult(Object.assign({}, base, { status: "error", error: "Netz-Auskunft ist ausgeschaltet – erst in den Einstellungen aktivieren.", phase: "done" }));
      return { ok: false, error: "disabled", requestId };
    }
    if (!dash) {
      writeResult(Object.assign({}, base, { status: "error", error: `Unbekannte Abfrageart: ${kind}`, phase: "done" }));
      return { ok: false, error: "unknown-kind", requestId };
    }
    if (!customerNumber) {
      writeResult(Object.assign({}, base, { status: "error", error: "Keine Kundennummer erkannt.", phase: "done" }));
      return { ok: false, error: "no-customer", requestId };
    }

    // Höchstens eine Abfrage gleichzeitig. Zwei parallele Läufe würden sich
    // denselben Dashboard-Tab teilen und sich gegenseitig die Navigation
    // wegziehen – aus zwei Aufträgen würden zwei falsche Ergebnisse. Der Schutz
    // sitzt hier und nicht in der Auftragsannahme, damit er auch für den Weg
    // über die Bridge (bridge.js ruft runLookup direkt) gilt.
    if (runningRequestId && runningRequestId !== requestId) {
      log(`Abbruch: ${runningRequestId} läuft bereits.`);
      writeResult(Object.assign({}, base, {
        status: "error", phase: "done",
        error: "Es läuft bereits eine Abfrage. Bitte warten, bis sie fertig ist, und dann erneut versuchen."
      }));
      return { ok: false, error: "busy", requestId };
    }
    runningRequestId = requestId;

    // Ab hier gilt der Auftrag als angenommen: das Panel sieht phase != "queued"
    // und weiß, dass der Hintergrund-Dienst lebt.
    writeResult(Object.assign({}, base, { status: "running" }));

    const attempts = Math.max(1, LOOKUPS.attempts || 1);
    const stopHeartbeat = startHeartbeat(requestId);
    let dashboardTabId = null;
    // Wurde am Ende das Kündigungsticket geöffnet, bleibt der Fokus dort – die
    // Rückkehr zum Ausgangs-Tab würde es sofort wieder verdecken.
    let keepFocus = false;
    try {
      for (let attempt = 1; attempt <= attempts; attempt++) {
        if (attempt > 1) {
          log(`Zweiter Anlauf (${attempt}/${attempts}).`);
          resetSteps(requestId, kind);
          setPhase(requestId, "retry", `Neuer Anlauf (${attempt}/${attempts}) …`);
        }

        const prep = await prepareDashboardTab(dash, requestId);
        if (prep.tabId != null) dashboardTabId = prep.tabId;
        if (!prep.ok) {
          if (prep.retryable && attempt < attempts) continue;
          return fail(prep.error);
        }

        setPhase(requestId, "run", "");
        const response = await callContentScript(
          prep.tabId,
          `sc-lookup-${kind}`,
          { requestId, customerNumber, address: req.address || "" },
          LOOKUPS.lookupTimeoutMs
        );

        if (response && response.ok) {
          const latest = active.get(requestId) || base;
          // Ergebnis ZUERST schreiben, erst danach das Ticket öffnen. Der Tab,
          // der gleich aufgeht, liest die Kündigungsdaten aus genau diesem
          // Storage-Eintrag, um daraus die Winback-Vorbereitung zu bauen – wäre
          // er noch nicht da, liefe dort eine Vorbereitung ohne Kündigungsgrund.
          writeResult(Object.assign({}, latest, {
            status: "ok", data: response.data, error: "", note: "", phase: "done", openedTicket: ""
          }));

          // Kündiger gefunden: das zugehörige Ticket gleich aufmachen (Winback).
          // Der Fokus bleibt dann dort – deshalb entfällt die Rückkehr zum
          // Ausgangs-Tab, sie würde das gerade Geöffnete sofort wieder verdecken.
          if (kind === "churn" && response.data && response.data.found) {
            const openedTicket = await openChurnTicket(response.data);
            if (openedTicket) {
              keepFocus = true;
              const current = active.get(requestId);
              if (current) writeResult(Object.assign({}, current, { openedTicket }));
            }
          }
          return { ok: true, data: response.data, requestId };
        }

        let error = (response && response.error) || "Abfrage fehlgeschlagen.";
        // Die Gegenstelle ist verschwunden (SPA-Neuaufbau, Sitzungserneuerung) –
        // das ist der Fall, für den der zweite Anlauf existiert.
        if (TRANSPORT_ERROR.test(error) && attempt < attempts) {
          log(`Transportfehler („${error}") – noch ein Anlauf.`);
          continue;
        }
        if (/zeitüberschreitung|keine antwort/i.test(error)) {
          error += ` (Das Dashboard „${dash.openUrl}" hat nicht wie erwartet reagiert. Bitte den Tab während der Abfrage im Vordergrund lassen und erneut versuchen.)`;
        }
        return fail(error);
      }
      return fail("Abfrage fehlgeschlagen.");
    } catch (error) {
      // Letzte Rettungsleine: ein unerwarteter Fehler darf das Panel nicht auf
      // „läuft" stehen lassen. Lieber eine hässliche, aber sichtbare Meldung.
      log("Unerwarteter Fehler:", error);
      return fail(`Unerwarteter Fehler in der Netz-Auskunft: ${(error && error.message) || error}`);
    } finally {
      if (runningRequestId === requestId) runningRequestId = null;
      stopHeartbeat();
      // Nicht awaiten: der Fokuswechsel ist Komfort und darf das Ergebnis nicht
      // verzögern oder – wenn der Ausgangs-Tab inzwischen zu ist – verschlucken.
      if (!keepFocus) restoreFocus(callerTabId, dashboardTabId);
    }
  }

  // ---------------------------------------------------------------------------
  // Auftragsannahme: Nachricht ODER Storage – beides landet hier
  // ---------------------------------------------------------------------------

  // Nimmt einen Auftrag an, entfernt ihn aus der Warteschlange und führt ihn aus.
  // Gegen Doppelstart gesichert (Nachricht und Storage-Ereignis treffen oft beide
  // ein) und gegen Wiederbelebung uralter Aufträge nach einem Worker-Neustart.
  async function claimJob(request, origin) {
    const req = request || {};
    const requestId = req.requestId;
    if (!requestId) return null;
    if (claimedIds.has(requestId)) return null;
    if (req.createdAt && Date.now() - req.createdAt > PENDING_MAX_AGE_MS) {
      log(`Auftrag ${requestId} ist zu alt – verworfen.`);
      await removeLocal([KEYS.lookupRequest]);
      return null;
    }
    claimedIds.add(requestId);
    // Aus der Warteschlange nehmen, bevor gearbeitet wird: sonst könnte ein
    // Worker-Neustart mitten im Lauf denselben Auftrag ein zweites Mal starten.
    await removeLocal([KEYS.lookupRequest]);

    log(`Auftrag ${requestId} angenommen (${origin}).`);
    try {
      return await runLookup(req);
    } catch (error) {
      log("claimJob: unerwarteter Fehler:", error);
      return null;
    }
  }

  // Offener Auftrag aus dem Storage (Worker-Start oder verpasste Nachricht).
  async function claimPendingJob(origin) {
    const data = await getLocal([KEYS.lookupRequest]);
    const pending = data[KEYS.lookupRequest];
    if (!pending || !pending.requestId) return null;
    return claimJob(pending, origin);
  }

  // ---------------------------------------------------------------------------
  // Selbstauskunft
  //
  // „Es passiert gar nichts" ist die schlechteste aller Fehlermeldungen, weil
  // die Ursache an einer von vier Stellen liegen kann, die man alle nicht sieht:
  // Dienst läuft nicht, Schalter aus, kein Dashboard-Tab, kein Content-Script.
  // Diese Auskunft prüft alle vier und liefert sie ans Panel – ohne irgendetwas
  // zu automatisieren und ohne Kundennummer.
  // ---------------------------------------------------------------------------

  async function diagnose() {
    const report = { checkedAt: Date.now(), dashboards: [] };
    const stored = await getLocal([KEYS.settings]);
    report.enableLookups = (stored[KEYS.settings] || {}).enableLookups === true;
    report.tabsApi = Boolean(chrome.tabs && typeof chrome.tabs.create === "function");

    const kinds = Object.keys(LOOKUPS).filter((key) => LOOKUPS[key] && LOOKUPS[key].openUrl);
    for (const kind of kinds) {
      const dash = LOOKUPS[kind];
      const entry = { kind, label: dash.label || kind, url: dash.openUrl, tabs: 0, script: "kein Tab offen" };
      const tabs = await findDashboardTabs(dash);
      entry.tabs = tabs.length;
      if (tabs.length) {
        const probe = await probeContentScript(tabs[0].id, 2500);
        if (!probe.alive) entry.script = "Tab offen, aber das Lese-Script antwortet nicht (Tab neu laden)";
        else if (!probe.ready) entry.script = "Script bereit, aber kein Dashboard sichtbar (angemeldet?)";
        else entry.script = "bereit";
      }
      report.dashboards.push(entry);
    }
    return report;
  }

  // ---------------------------------------------------------------------------
  // Verdrahtung
  // ---------------------------------------------------------------------------

  try {
    // Weg 1: Zuruf aus dem Panel. Schnell, aber ohne Zustellgarantie.
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message) return undefined;
      if (message.type === "sc-lookup-step" && message.requestId) {
        applyStep(message.requestId, message.step, message.state);
        return undefined;
      }
      if (message.type === "sc-lookup-diagnose") {
        // Allein DASS hier geantwortet wird, ist die halbe Auskunft: dann läuft
        // der Hintergrund-Dienst.
        diagnose().then((report) => {
          try { sendResponse({ ok: true, report }); } catch (error) { /* Port schon zu */ }
        });
        return true; // asynchrone Antwort
      }
      if (message.type === "sc-run-lookup" && message.request) {
        // Die Tab-Id des Absenders wandert mit, damit der Fokus am Ende dorthin
        // zurückkehrt (nur der Worker kennt sie – das Panel nicht).
        const senderTabId = sender && sender.tab && typeof sender.tab.id === "number" ? sender.tab.id : null;
        claimJob(Object.assign({}, message.request, { callerTabId: senderTabId }), "Nachricht");
        // Quittung: das Panel weiß dadurch sofort, dass der Dienst lebt.
        try { sendResponse({ ok: true, received: true }); } catch (error) { /* Port schon zu */ }
        return undefined;
      }
      return undefined;
    });
  } catch (error) {
    // Kein chrome.runtime (Node-Test) – reine Logik bleibt über app.lookup testbar.
  }

  try {
    // Weg 2: der Auftrag liegt im Storage. Eine Storage-Änderung weckt den
    // Service-Worker zuverlässig – das ist der Weg, der auch dann trägt, wenn
    // die Nachricht ins Leere ging.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes) return;
      const entry = changes[KEYS.lookupRequest];
      if (!entry || !entry.newValue) return;
      claimJob(entry.newValue, "Storage");
    });
  } catch (error) { /* kein chrome.storage (Node-Test) */ }

  // Weg 3: beim Start nachsehen, ob etwas liegen geblieben ist (Worker war beim
  // Klick beendet und wurde erst durch die Storage-Änderung geweckt).
  try {
    if (chrome.storage && chrome.storage.local) claimPendingJob("Worker-Start");
  } catch (error) { /* kein chrome.storage (Node-Test) */ }

  app.lookup = {
    runLookup, initSteps, applyStep, waitForTabLoad,
    prepareDashboardTab, claimJob, claimPendingJob, diagnose
  };
  log("lookup.js geladen – bereit für sc-run-lookup / lookupRequest.");
})();
