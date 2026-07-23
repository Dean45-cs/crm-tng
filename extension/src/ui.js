(function initUi() {
  "use strict";

  const app = window.StadtnetzCRM;
  const { CONFIG, jiraReader, rules, aiCache, shared } = app;
  const {
    escapeHtml, extensionAlive, formatDuration, callTimerText,
    callModeMeta, isOutbound, normalizePhone, nextRetryAt, pruneCallbacks, customerSearchUrl,
    jiraTicketUrl, ticketResolution, formatDateDE, calcContractCommission, calcTariffCommission,
    groupProductsByCategory, todayIso
  } = shared;
  const AI = CONFIG.ai;
  const localAi = app.localAi;
  const supabaseClient = app.supabaseClient;
  const S = (localAi && localAi.STATUS) || {};

  // Auto-Aufräumen der Gesprächsnotizen: erst nach einer Tipppause, nie
  // während des Tippens selbst.
  const CALL_AUTO_CLEAN_DELAY_MS = 1500;
  const CALL_AUTO_CLEAN_MIN_CHARS = 12;
  let callAutoCleanTimer = null;

  const state = {
    ticket: null,
    isOpen: true,
    activeTab: "overview",
    tone: AI.defaultTone,
    settings: { ...CONFIG.settingsDefaults },
    settingsOpen: false,
    emailTemplates: [],
    emailEditor: { isOpen: false, templateId: null },
    activeCall: null, // Signal von timio-content.js über chrome.storage, siehe currentActiveCall()
    queueStats: null, // Wartefeld-Zahlen aus dem timio-Portal (nur Gruppen + Zähler)
    // Arbeitsrichtung. timio zeigt bei ausgehenden Anrufen denselben
    // Call-Screen wie bei eingehenden – die Richtung setzt der Bearbeiter
    // selbst über den Schalter im Panel-Kopf bzw. im timio-Cockpit.
    callMode: "inbound",
    // Eigene Rückrufliste (Wiedervorlage). Getrennt von timios Anrufliste:
    // hier stehen nur selbst vereinbarte Rückrufe.
    callbacks: [],
    // Call-Cockpit: dauerhaftes Overlay während des Gesprächs. Position und
    // Modus (voll/minimiert) bleiben lokal gespeichert erhalten.
    callOverlay: { mode: "full", pos: null, dismissedForCallId: null },
    // Eigene Supabase-Session der Extension (Stufe 1, KONZEPT-INTEGRATION.md,
    // Option a: eigener Login, unabhängig von der CRM-Tab-Session).
    supabaseSession: null,
    // Login-Formular in den Einstellungen — bewusst NICHT persistiert, die PIN
    // geht nur an den Auth-Endpoint und wird danach verworfen.
    supabaseAuth: { name: "", pin: "", busy: false, error: "" },
    // Zuletzt nachgeschlagene Kundenakte, geschrieben von timio-content.js bei
    // eingehendem Anruf (siehe CONFIG.storageKeys.customerCard).
    customerCard: null,
    // Netz-Auskunft (aktive Dashboard-Abfrage). `result` wird aus
    // storageKeys.lookupResult gespiegelt (vom Worker/lookup.js geschrieben),
    // `confirm` hält die ausstehende Bestätigung { kind, customerNumber } – die
    // kritische Aktion wird VOR jedem Lauf im Panel bestätigt.
    lookup: { result: null, confirm: null },
    // Zustand der WebSocket-Bridge (aus storageKeys.bridgeState) für das
    // „Bridge aktiv"-Banner.
    bridgeState: null,
    // Abschluss-Panel (Stufe 3, KONZEPT-INTEGRATION.md): { callId, entryType,
    // fields, status, error }. Eigene Instanz, unabhängig vom Gegenstück in
    // timio-content.js — siehe dortige Kommentare für die Feld-Semantik.
    closeout: null,
    // Produktkatalog + Provisions-Matrix für Vertrag/Tarifwechsel im
    // Abschluss-Panel.
    sharedSettings: { status: "idle", data: null, error: "" },
    // Übernahme der Ticket-Zusammenfassung in die Kundenakte:
    // { status: "idle"|"saving"|"ok"|"no-customer"|"error", error, signature,
    //   customerNumber, resolution, created }. signature ist der Fingerabdruck
    //  dessen, was zuletzt geschrieben wurde – gleicher Stand, kein zweiter
    // Schreibvorgang.
    crmNote: { status: "idle", error: "", signature: "", customerNumber: "", resolution: "", created: false },
    // Befehlspalette (Stufe 4, KONZEPT-INTEGRATION.md): ⌘K-Schnellsuche,
    // eigener DOM-Root unabhängig vom Panel. { open, query, groups, status,
    // error, activeIdx } oder null. Eigene Instanz, unabhängig vom Gegenstück
    // in timio-content.js.
    palette: null,
    ai: {
      replyLanguage: "de",
      caps: null,           // Ergebnis von localAi.capabilities()
      busy: "",             // Name der gerade laufenden KI-Aufgabe ("" = frei)
      download: 0,          // Download-Fortschritt in Prozent
      controller: null,     // AbortController der laufenden Aufgabe
      error: "",

      summary: { status: "idle", text: "" },
      triage: { status: "idle", data: null },
      advice: { status: "idle", text: "" },
      documentation: { status: "idle", text: "" },

      note: "",             // Notiz/Absicht des Bearbeiters
      draft: "",            // aktueller Entwurf (Kommentar oder E-Mail-Text)
      draftKind: "comment", // "comment" | "email"
      emailSubject: "",
      review: { status: "idle", checks: [], improved: "" },

      callNotes: "",
      callDraft: { status: "idle", text: "" },
      // Gesprächsvorbereitung für ausgehende Anrufe: Ziel, Punkte, Fragen,
      // Einwände. Läuft im Outbound-Modus automatisch vorab, damit sie fertig
      // ist, bevor timio wählt.
      callPrep: { status: "idle", data: null },
      translation: { status: "idle", text: "", language: "" },

      handoff: {
        department: "",
        note: "",
        comment: { status: "idle", text: "" },
        email: { status: "idle", subject: "", body: "" }
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Grundhelfer
  // ---------------------------------------------------------------------------

  function root() {
    return document.getElementById(CONFIG.rootId);
  }

  function el(role) {
    const container = root();
    return container ? container.querySelector(`[data-role='${role}']`) : null;
  }

  function escapeWithBreaks(value) {
    return escapeHtml(value).replace(/\n/g, "<br>");
  }

  function safeLocalSet(payload) {
    if (!extensionAlive()) return;
    try {
      if (chrome.storage && chrome.storage.local) chrome.storage.local.set(payload);
    } catch (error) { /* alte Instanz – nicht mehr schreiben */ }
  }

  function safeLocalRemove(keys) {
    if (!extensionAlive()) return;
    try {
      if (chrome.storage && chrome.storage.local) chrome.storage.local.remove(keys);
    } catch (error) { /* alte Instanz – nicht mehr schreiben */ }
  }

  function localStorageGet(keys) {
    return new Promise((resolve) => {
      if (!extensionAlive() || !chrome.storage || !chrome.storage.local) return resolve({});
      try {
        chrome.storage.local.get(keys, (data) => resolve(data || {}));
      } catch (error) {
        resolve({});
      }
    });
  }

  function persistUiState() {
    safeLocalSet({
      [CONFIG.storageKeys.isOpen]: state.isOpen,
      [CONFIG.storageKeys.activeTab]: state.activeTab,
      [CONFIG.storageKeys.tone]: state.tone
    });
  }

  function persistEmailTemplates() {
    safeLocalSet({ [CONFIG.storageKeys.emailTemplates]: state.emailTemplates });
  }

  function persistSettings() {
    safeLocalSet({ [CONFIG.storageKeys.settings]: state.settings });
  }

  // Veröffentlicht das aktuell geöffnete Ticket (inkl. KI-Zusammenfassung)
  // lokal per Storage, damit das Call-Cockpit auf der timio-Seite den
  // Ticket-Abgleich und den Kontext anzeigen kann. Bleibt im Chrome-Profil.
  let lastTicketContextSignature = null;
  function publishTicketContext() {
    const t = state.ticket;
    if (!t || !known(t.key)) return;
    const payload = {
      key: t.key,
      summary: known(t.summary) ? t.summary : "",
      status: known(t.status) ? t.status : "",
      priority: known(t.priority) ? t.priority : "",
      customerReference: known(t.customerReference) ? t.customerReference : "",
      customerName: known(t.customerName) ? t.customerName : "",
      aiSummary: state.ai.summary.status === "ok" ? (state.ai.summary.text || "") : "",
      // Anrufziel und Gesprächspunkte wandern mit ins timio-Cockpit: bei
      // ausgehenden Anrufen sitzt der Bearbeiter dort und hat keine Zeit,
      // erst nach Jira zu wechseln.
      aiCallPrep: state.ai.callPrep.status === "ok" ? (state.ai.callPrep.data || null) : null,
      updatedAt: Date.now()
    };
    const signature = JSON.stringify([payload.key, payload.summary, payload.status, payload.priority, payload.customerReference, payload.aiSummary, payload.aiCallPrep]);
    if (signature === lastTicketContextSignature) return;
    lastTicketContextSignature = signature;
    safeLocalSet({ [CONFIG.storageKeys.ticketContext]: payload });
  }

  // Bearbeiter-/Firmenangaben für KI-Entwürfe (leere Felder werden ignoriert).
  function agentForAi() {
    return {
      name: state.settings.agentName,
      company: state.settings.company,
      signature: state.settings.signature
    };
  }

  function known(value) {
    return value && value !== jiraReader.UNKNOWN;
  }

  // ---------------------------------------------------------------------------
  // Aktiver timio-Call (Cross-Tab-Signal über chrome.storage, siehe timio-content.js)
  // ---------------------------------------------------------------------------

  function isCallStale(call) {
    if (!call || !call.updatedAt) return true;
    const staleAfter = (CONFIG.call && CONFIG.call.staleAfterMs) || 15000;
    return Date.now() - call.updatedAt > staleAfter;
  }

  // Liefert den aktiven Call nur, wenn er (noch) plausibel aktuell ist – ohne
  // frisches Update (z. B. timio-Tab geschlossen) gilt er als beendet.
  function currentActiveCall() {
    if (!state.activeCall || state.activeCall.status === "idle") return null;
    if (isCallStale(state.activeCall)) return null;
    return state.activeCall;
  }

  // ---------------------------------------------------------------------------
  // Arbeitsrichtung (Inbound/Outbound)
  //
  // Ausgehend wird grundlegend anders gearbeitet: timio hat eine eigene
  // Anrufliste und wählt selbst, sobald sich der Bearbeiter auf "bereit"
  // stellt. Es bleibt also keine Vorbereitungszeit – der Kontext muss schon
  // fertig dastehen, wenn das Gespräch beginnt. Da der Call-Screen in timio in
  // beide Richtungen gleich aussieht, wird die Richtung nicht erraten, sondern
  // hier gesetzt und über den Storage mit dem timio-Cockpit geteilt.
  // ---------------------------------------------------------------------------

  function outboundMode() {
    return isOutbound(state.callMode);
  }

  function setCallMode(mode) {
    const next = callModeMeta(mode).id;
    if (next === state.callMode) return;
    syncInputsFromDom();
    state.callMode = next;
    safeLocalSet({ [CONFIG.storageKeys.callMode]: next });
    render();
    // Die Gesprächsvorbereitung läuft nur im Outbound-Modus automatisch mit.
    maybeAutoRun();
  }

  function renderModeSwitch() {
    const outbound = outboundMode();
    return `
      <div class="sc-mode-switch" role="group" aria-label="Arbeitsrichtung">
        <button class="${outbound ? "" : "is-active"}" type="button" data-action="set-call-mode" data-mode="inbound" aria-pressed="${!outbound}" title="Eingehende Anrufe: Kunden rufen an">☎ Eingehend</button>
        <button class="${outbound ? "is-active" : ""}" type="button" data-action="set-call-mode" data-mode="outbound" aria-pressed="${outbound}" title="Ausgehende Anrufe: timio wählt aus seiner Anrufliste">↗ Ausgehend</button>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Rückrufliste (Wiedervorlage)
  //
  // Bewusst getrennt von timios eigener Anrufliste – hier stehen nur Rückrufe,
  // die der Bearbeiter selbst vereinbart hat. Weil Einträge Rufnummern
  // enthalten, entstehen sie ausschließlich durch eine bewusste Aktion und
  // werden gedeckelt sowie automatisch ausgemistet (pruneCallbacks).
  // ---------------------------------------------------------------------------

  function persistCallbacks() {
    state.callbacks = pruneCallbacks(state.callbacks, Date.now());
    safeLocalSet({
      [CONFIG.storageKeys.callbacks]: { items: state.callbacks, updatedAt: Date.now() }
    });
  }

  function callbackForTicket(ticketKey) {
    return state.callbacks.find((item) => item.ticketKey === ticketKey) || null;
  }

  // Legt einen Rückruf an oder – wenn für dasselbe Ticket schon einer offen ist
  // – zählt den Versuch hoch und schiebt die Fälligkeit weiter. So entstehen
  // beim wiederholten Nichterreichen keine Dubletten.
  function upsertCallback(entry) {
    const now = Date.now();
    const existing = entry.ticketKey ? callbackForTicket(entry.ticketKey) : null;
    if (existing) {
      existing.attempts = (existing.attempts || 0) + (entry.countsAsAttempt ? 1 : 0);
      existing.dueAt = entry.dueAt || nextRetryAt(existing.attempts, now);
      existing.reason = entry.reason || existing.reason;
      existing.phone = entry.phone || existing.phone;
      existing.lastOutcome = entry.lastOutcome || existing.lastOutcome;
      existing.notifiedAt = 0; // neue Fälligkeit darf erneut erinnern
      persistCallbacks();
      return existing;
    }
    const created = {
      id: `cb-${now}-${Math.random().toString(36).slice(2, 8)}`,
      ticketKey: entry.ticketKey || "",
      ticketSummary: entry.ticketSummary || "",
      customerName: entry.customerName || "",
      customerReference: entry.customerReference || "",
      phone: entry.phone || "",
      reason: entry.reason || "",
      dueAt: entry.dueAt || nextRetryAt(entry.countsAsAttempt ? 1 : 0, now),
      attempts: entry.countsAsAttempt ? 1 : 0,
      lastOutcome: entry.lastOutcome || "",
      notifiedAt: 0,
      done: false,
      createdAt: now
    };
    state.callbacks = state.callbacks.concat([created]);
    persistCallbacks();
    return created;
  }

  // Nimmt das gerade offene Ticket auf – und, falls parallel telefoniert wird,
  // gleich die Rufnummer des Gesprächspartners.
  function addCurrentTicketToCallbacks() {
    const t = state.ticket;
    if (!t || !known(t.key)) {
      toast("Kein Ticket erkannt – Rückruf kann nicht zugeordnet werden.");
      return;
    }
    const call = currentActiveCall();
    upsertCallback({
      ticketKey: t.key,
      ticketSummary: known(t.summary) ? t.summary : "",
      customerName: known(t.customerName) ? t.customerName : "",
      customerReference: known(t.customerReference) ? t.customerReference : "",
      phone: (call && call.callerNumber) || ticketPhoneNumber(t),
      reason: "Manuell aufgenommen",
      dueAt: nextRetryAt(0, Date.now())
    });
    render();
    toast("Auf die Rückrufliste gesetzt.");
  }

  // Sucht eine Rufnummer im sichtbaren Tickettext. Bewusst nur als Vorschlag –
  // steht dort keine, bleibt das Feld leer und wird von Hand ergänzt.
  const TICKET_PHONE_PATTERN = /(\+\d{1,3}[\s/-]?\(?\d{1,5}\)?[\d\s/-]{4,}\d|\b0\d{2,5}[\s/-]?[\d\s/-]{5,}\d)/;
  function ticketPhoneNumber(ticket) {
    const haystack = [ticket.description, ticket.latestInformation].filter(known).join("\n");
    const match = haystack.match(TICKET_PHONE_PATTERN);
    return match ? match[0].trim() : "";
  }

  function snoozeCallback(id, ms) {
    const entry = state.callbacks.find((item) => item.id === id);
    if (!entry) return;
    entry.dueAt = Date.now() + ms;
    entry.notifiedAt = 0;
    persistCallbacks();
    render();
    toast("Rückruf verschoben.");
  }

  function completeCallback(id) {
    const entry = state.callbacks.find((item) => item.id === id);
    if (!entry) return;
    entry.done = true;
    persistCallbacks(); // pruneCallbacks entfernt erledigte Einträge sofort
    render();
    toast("Rückruf erledigt.");
  }

  // Wählen heißt hier: Nummer in die Zwischenablage und ab in den timio-Tab.
  // Bewusst kein schreibender Zugriff auf timio – dessen DOM ist nicht
  // bekannt, und genau darauf beruht die Robustheit der ganzen Integration.
  async function dialCallback(id) {
    const entry = state.callbacks.find((item) => item.id === id);
    if (!entry) return;
    const number = normalizePhone(entry.phone);
    if (!number) {
      toast("Für diesen Eintrag ist keine Rufnummer hinterlegt.");
      return;
    }
    await copyText(number, `${number} kopiert – in timio einfügen und wählen.`);
    try {
      if (chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: "focus-timio" });
      }
    } catch (error) { /* Worker nicht erreichbar – Nummer liegt trotzdem bereit */ }
  }

  function openCustomerSearch(customerNumber) {
    const url = customerSearchUrl(customerNumber, state.settings.customerSearchJql);
    if (!url) {
      toast("Keine Kundennummer bekannt.");
      return;
    }
    window.open(url, "_blank", "noopener");
  }

  // ---------------------------------------------------------------------------
  // Wartefeld (Live-Zahlen aus dem timio-Portal, siehe timio-content.js).
  // Die Rechenlogik (Summe, Veraltung, Gruppen-Matching, Dauer-Formatierung)
  // liegt zentral in shared.js – hier nur die Anbindung an den Panel-State.
  // ---------------------------------------------------------------------------

  function queueStaleAfterMs() {
    return (CONFIG.call && CONFIG.call.queueStaleAfterMs) || 30000;
  }

  function queueTotalWaiting() {
    return shared.queueTotalWaiting(state.queueStats);
  }

  function queueGroupMatchesCall(groupName, call) {
    return shared.groupsMatch(groupName, call && call.group);
  }

  function queueStaleLabel() {
    const minutes = shared.queueStaleMinutes(state.queueStats, queueStaleAfterMs());
    return minutes ? `Stand: vor ${minutes} min – timio-Portal geöffnet lassen` : "";
  }

  function queueMarkup() {
    const q = state.queueStats;
    if (!q || !Array.isArray(q.groups) || !q.groups.length) {
      return `<p class="sc-queue-empty">Keine Wartefeld-Daten – das timio-Portal (Tab „Portal“) muss dafür geöffnet sein.</p>`;
    }
    const call = currentActiveCall();
    const total = queueTotalWaiting();
    const chips = q.groups.map((group) => {
      const isCallGroup = queueGroupMatchesCall(group.name, call);
      const hasWaiting = typeof group.waiting === "number" && group.waiting > 0;
      const title = group.avgWait ? `Ø Wartezeit ${group.avgWait}` : "";
      return `
        <span class="sc-queue-chip ${isCallGroup ? "is-call-group" : ""} ${hasWaiting ? "has-waiting" : ""}" title="${escapeHtml(title)}">
          ${escapeHtml(group.name)}
          <b>${typeof group.waiting === "number" ? group.waiting : "–"}</b>
        </span>`;
    }).join("");
    const staleLabel = queueStaleLabel();
    return `
      <div class="sc-queue-head">
        <span>Im Wartefeld</span>
        <strong class="${total > 0 ? "has-waiting" : ""}">${total === null ? "–" : total}</strong>
        <em data-role="queue-stale">${escapeHtml(staleLabel)}</em>
      </div>
      <div class="sc-queue-chips">${chips}</div>`;
  }

  // Aktualisiert alle sichtbaren Wartefeld-Anzeigen gezielt im DOM, ohne das
  // ganze Panel neu zu rendern (die Zahlen kommen alle paar Sekunden herein).
  function refreshQueueNodes() {
    const markup = queueMarkup();
    ["overlay-queues", "queue-overview"].forEach((role) => {
      const node = el(role);
      if (node) node.innerHTML = markup;
    });
    const bannerNode = el("banner-queue");
    if (bannerNode) {
      const total = queueTotalWaiting();
      bannerNode.textContent = total === null ? "" : ` · Wartefeld ${total}`;
    }
    const miniNode = el("cockpit-mini-queue");
    if (miniNode) {
      const total = queueTotalWaiting();
      miniNode.textContent = total === null ? "–" : String(total);
      miniNode.classList.toggle("has-waiting", Boolean(total));
    }
  }

  function renderActiveCallBanner() {
    const call = currentActiveCall();
    if (!call) return "";

    const ringing = call.status === "ringing";
    const ended = call.status === "ended";
    const hasMismatch = !ringing && !ended
      && known(state.ticket && state.ticket.customerReference)
      && call.customerNumber
      && state.ticket.customerReference.trim() !== call.customerNumber.trim();

    const statusLabel = shared.callStatusMeta(call.status, state.callMode).label;
    const nameLine = call.callerName || call.callerNumber || "Unbekannter Anrufer";
    const details = [
      call.callerNumber,
      call.customerNumber ? `Kundennummer ${call.customerNumber}` : "",
      call.group
    ].filter(Boolean).join(" · ");
    const timer = callTimerText(call, call.connectedAt);
    const total = queueTotalWaiting();
    const queueSuffix = total === null ? "" : ` · Wartefeld ${total}`;

    return `
      <div class="sc-call-banner ${hasMismatch ? "is-mismatch" : ""} ${ended ? "is-ended" : ""}">
        <div class="sc-call-banner-main">
          <span class="sc-call-banner-status">${escapeHtml(statusLabel)}</span>
          <strong>${escapeHtml(nameLine)}</strong>
          ${!ringing ? `<span data-role="active-call-timer" class="sc-call-banner-timer">${escapeHtml(timer)}</span>` : ""}
        </div>
        <p class="sc-call-banner-details">${escapeHtml(details)}<span data-role="banner-queue">${escapeHtml(queueSuffix)}</span></p>
        ${hasMismatch ? `<p class="sc-call-banner-warning">Passt nicht zum offenen Ticket (Kundenreferenz ${escapeHtml(state.ticket.customerReference)}).</p>` : ""}
      </div>`;
  }

  // Reagiert auf ein neues Storage-Signal von timio-content.js: aktualisiert
  // den State, zeigt das Call-Cockpit ab dem Klingeln und wechselt beim
  // Annehmen automatisch in den Call-Tab (nur beim Übergang, nicht bei jedem
  // Update).
  function handleActiveCallChange(newValue) {
    const previousStatus = state.activeCall && state.activeCall.status;
    state.activeCall = newValue || null;
    const status = state.activeCall && state.activeCall.status;

    if (status === "ringing" || status === "connected") {
      window.clearTimeout(cockpitEndedTimer);
      // Beim Annehmen wieder einblenden, auch wenn das Klingeln weggeklickt wurde.
      if (status === "connected" && previousStatus !== "connected") {
        state.callOverlay.dismissedForCallId = null;
        state.settingsOpen = false;
        state.activeTab = "call";
        persistUiState();
      }
    }
    if (status === "ended" && previousStatus !== "ended") {
      scheduleCockpitEndedHide();
      // Eingehende Anrufe bekommen das Abschluss-Panel ohne Klick — anders
      // als bei ausgehenden Anrufen gibt es keinen "niemand erreicht"-Fall
      // (Stufe 3, KONZEPT-INTEGRATION.md). previousStatus !== "ended" sorgt
      // hier bereits dafür, dass das pro Anruf nur einmal passiert.
      if (!outboundMode()) openCloseout("notiz", state.activeCall, "");
    }
    render();
  }

  // ---------------------------------------------------------------------------
  // Call-Cockpit: dauerhaftes Overlay während des Gesprächs. Zeigt Anrufer,
  // Gesprächsdauer, Wartefeld-Zahlen und den Abgleich mit dem offenen Ticket –
  // sichtbar unabhängig davon, ob das Panel geöffnet ist. Verschiebbar und
  // minimierbar, Position bleibt lokal gespeichert.
  // ---------------------------------------------------------------------------

  let cockpitEndedTimer = null;

  function callIdOf(call) {
    return (call && (call.callId || call.connectedAt || call.updatedAt)) || null;
  }

  function cockpitVisible() {
    const call = currentActiveCall();
    if (!call) return false;
    return callIdOf(call) !== state.callOverlay.dismissedForCallId;
  }

  function dismissCallOverlay() {
    const call = currentActiveCall();
    state.callOverlay.dismissedForCallId = callIdOf(call) || "none";
    render();
  }

  function toggleCockpitMode() {
    state.callOverlay.mode = state.callOverlay.mode === "mini" ? "full" : "mini";
    persistCockpitPrefs();
    render();
  }

  function persistCockpitPrefs() {
    safeLocalSet({
      [CONFIG.storageKeys.callOverlay]: { mode: state.callOverlay.mode, pos: state.callOverlay.pos }
    });
  }

  // Nach dem Auflegen bleibt das Cockpit kurz stehen (letzter Blick auf Dauer
  // und Kundennummer für die Doku) und räumt sich dann selbst weg.
  function scheduleCockpitEndedHide() {
    window.clearTimeout(cockpitEndedTimer);
    const hideAfter = (CONFIG.call && CONFIG.call.endedOverlayMs) || 12000;
    cockpitEndedTimer = window.setTimeout(() => {
      const call = currentActiveCall();
      if (call && call.status === "ended") {
        const closeoutPending = state.closeout && state.closeout.callId === callIdOf(call) && state.closeout.status !== "done";
        if (closeoutPending) {
          // Nicht ausblenden, solange das Abschluss-Panel offen und
          // ungespeichert ist — sonst gingen unvollständige Eingaben
          // verloren. Später erneut prüfen, falls doch noch abgeschlossen wird.
          scheduleCockpitEndedHide();
          return;
        }
        state.callOverlay.dismissedForCallId = callIdOf(call);
        render();
      }
    }, hideAfter);
  }

  function cockpitPositionStyle() {
    const pos = state.callOverlay.pos;
    if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return "";
    const x = Math.min(Math.max(0, pos.x), Math.max(0, window.innerWidth - 90));
    const y = Math.min(Math.max(0, pos.y), Math.max(0, window.innerHeight - 60));
    return `left:${x}px;top:${y}px;right:auto;`;
  }

  function cockpitStatus(call) {
    const meta = shared.callStatusMeta(call.status, state.callMode);
    return { label: meta.label, className: `${meta.cls} ${outboundMode() ? "is-outbound" : ""}` };
  }

  // Anrufziel und Gesprächspunkte aus der lokalen Vorbereitung – im
  // Outbound-Modus das Erste, was auf den Schirm gehört.
  function renderCockpitPrep() {
    const prep = state.ai.callPrep;
    if (prep.status !== "ok" || !prep.data || !prep.data.ziel) return "";
    const points = Array.isArray(prep.data.punkte) ? prep.data.punkte.slice(0, 3) : [];
    return `
      <div class="sc-cockpit-prep">
        <p class="sc-cockpit-prep-goal"><span>Ziel</span> ${escapeHtml(prep.data.ziel)}</p>
        ${points.length ? `<ul>${points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>` : ""}
      </div>`;
  }

  // Ein Klick von der Kundennummer zur Jira-Trefferliste. Die Extension kann
  // Jira nicht durchsuchen, aber sie kann eine Suche öffnen – im
  // Outbound-Modus der schnellste Weg zum passenden Ticket.
  function renderCustomerSearchButton(call, className) {
    const number = (call && call.customerNumber || "").trim();
    if (!number) return "";
    return `<button class="${className}" type="button" data-action="search-customer" data-customer="${escapeHtml(number)}">Ticket zu Kundennummer ${escapeHtml(number)} suchen</button>`;
  }

  function cockpitTimerText(call) {
    return callTimerText(call, call.connectedAt);
  }

  // Abgleich Anrufer ↔ offenes Ticket: "match" (Kundennummer passt),
  // "mismatch" (offenes Ticket gehört zu einem anderen Kunden) oder
  // "unknown" (kein Vergleich möglich).
  function cockpitTicketMatch(call) {
    const reference = state.ticket && state.ticket.customerReference;
    if (!known(reference) || !call.customerNumber) return "unknown";
    return reference.trim() === call.customerNumber.trim() ? "match" : "mismatch";
  }

  function renderCockpitTicket(call) {
    const match = cockpitTicketMatch(call);
    if (match === "unknown") {
      return `<p class="sc-cockpit-hint">Kein Kundenabgleich möglich – Ticket mit passender Kundennummer in Jira öffnen, dann erscheint der Kontext hier.</p>`;
    }
    if (match === "mismatch") {
      return `<p class="sc-cockpit-mismatch">⚠ Offenes Ticket ${escapeHtml(state.ticket.key)} gehört zu Kundenreferenz ${escapeHtml(state.ticket.customerReference)} – Anrufer hat Kundennummer ${escapeHtml(call.customerNumber)}. Richtiges Ticket öffnen!</p>`;
    }
    const t = state.ticket;
    const summaryText = state.ai.summary.status === "ok" && state.ai.summary.text ? state.ai.summary.text : "";
    const warnings = rules.ticketWarnings(t);
    return `
      <div class="sc-cockpit-ticket">
        <div class="sc-call-overlay-ticket">
          <span class="sc-ticket-key">${escapeHtml(t.key)} ✓ passt zum Anrufer</span>
          <strong>${escapeHtml(t.summary)}</strong>
        </div>
        <div class="sc-badge-row">
          <span class="sc-badge sc-badge--status ${statusClass(t.status)}">${escapeHtml(t.status)}</span>
          <span class="sc-badge sc-badge--priority ${priorityClass(t.priority)}">${escapeHtml(t.priority)}</span>
        </div>
        ${summaryText
          ? `<div class="sc-ai-result sc-cockpit-summary">${escapeHtml(summaryText)}</div>`
          : `<p class="sc-cockpit-hint">Noch keine KI-Zusammenfassung für dieses Ticket erstellt.</p>`}
        ${warnings.length ? renderChecks(warnings.map((text) => ({ level: "warning", text })), "") : ""}
      </div>`;
  }

  // Kundenakte aus dem CRM (Stufe 1, KONZEPT-INTEGRATION.md): Name,
  // Kontaktdaten, Vorgangszählung und – falls vorhanden – ein direkter
  // Ticket-Link. Macht die JQL-Suche unten überflüssig, sobald sie greift,
  // ersetzt sie aber nicht (Lookup kann fehlschlagen: nicht angemeldet,
  // Kunde unbekannt, offline). Der Lookup selbst läuft in timio-content.js;
  // hier wird nur das über chrome.storage veröffentlichte Ergebnis angezeigt.
  function renderKundenakte(call) {
    const number = (call && call.customerNumber || "").trim();
    const card = state.customerCard;
    if (!number || !card || card.customerNumber !== number) return "";

    if (card.status === "loading") {
      return `<div class="sc-cockpit-akte sc-cockpit-akte-loading">Kundenakte wird geladen …</div>`;
    }
    if (card.status === "not-configured") {
      return "";
    }
    if (card.status === "not-logged-in") {
      return `<div class="sc-cockpit-akte sc-cockpit-akte-hint">Kundenakte: nicht bei Supabase angemeldet (Einstellungen ⚙).</div>`;
    }
    if (card.status === "not-found") {
      return `<div class="sc-cockpit-akte sc-cockpit-akte-hint">Kundennummer ${escapeHtml(number)} im CRM noch nicht bekannt.</div>`;
    }
    if (card.status !== "ok" || !card.data) {
      return `<div class="sc-cockpit-akte sc-cockpit-akte-hint">Kundenakte gerade nicht abrufbar.</div>`;
    }

    const d = card.data;
    const jiraButton = d.jiraTicket
      ? `<a class="sc-cockpit-akte-jira" href="${escapeHtml(jiraTicketUrl(d.jiraTicket))}" target="_blank" rel="noopener">Ticket ${escapeHtml(d.jiraTicket)} öffnen</a>`
      : "";
    return `
      <div class="sc-cockpit-akte">
        <div class="sc-cockpit-akte-head">${escapeHtml(d.name || "Unbenannt")}${d.phone ? ` · ${escapeHtml(d.phone)}` : ""}</div>
        <div class="sc-cockpit-akte-counts">
          <span>${d.contractCount} Vertr.</span>
          <span>${d.tariffChangeCount} Wechsel</span>
          <span>${d.noteCount} Notizen</span>
          <span>Seit ${escapeHtml(formatDateDE(d.firstSeenAt))}</span>
        </div>
        ${jiraButton}
      </div>`;
  }

  function renderCallCockpit() {
    const call = currentActiveCall();
    if (!call || !cockpitVisible()) return "";

    const status = cockpitStatus(call);
    const timer = cockpitTimerText(call);
    const nameLine = call.callerName || call.callerNumber || "Unbekannter Anrufer";
    const mini = state.callOverlay.mode === "mini";
    const totalWaiting = queueTotalWaiting();

    if (mini) {
      return `
        <div class="sc-cockpit sc-cockpit--mini ${status.className}" data-role="cockpit" role="status" style="${cockpitPositionStyle()}">
          <div class="sc-cockpit-header" data-role="cockpit-drag" title="Zum Verschieben ziehen">
            <span class="sc-cockpit-status">${escapeHtml(status.label)}</span>
            <strong class="sc-cockpit-mini-name">${escapeHtml(nameLine)}</strong>
            <span class="sc-cockpit-timer" data-role="overlay-call-timer">${escapeHtml(timer)}</span>
            <span class="sc-cockpit-mini-queue ${totalWaiting ? "has-waiting" : ""}" data-role="cockpit-mini-queue" title="Anrufe im Wartefeld">${totalWaiting === null ? "–" : totalWaiting}</span>
            <button class="sc-icon-button" type="button" data-action="toggle-cockpit-mode" title="Cockpit ausklappen" aria-label="Cockpit ausklappen">▢</button>
            <button class="sc-icon-button" type="button" data-action="dismiss-call-overlay" title="Für diesen Anruf ausblenden" aria-label="Schließen">×</button>
          </div>
        </div>`;
    }

    const subLine = [
      call.callerNumber,
      call.customerNumber ? `Kundennummer ${call.customerNumber}` : "",
      call.group
    ].filter(Boolean).join(" · ");
    // Ausgehend hat niemand gewartet – die Wartezeit-Zeile wäre dort falsch.
    const outbound = outboundMode();
    const waitInfo = !outbound && call.status !== "ended" && call.waitTime
      ? `<p class="sc-cockpit-wait">Kunde wartete ${escapeHtml(call.waitTime)} in der Leitung.</p>`
      : "";
    // Reihenfolge folgt dem, was in der jeweiligen Richtung zuerst zählt:
    // ausgehend "was will ich von dieser Person", eingehend "wer wartet noch".
    const blocks = outbound
      ? `${renderCockpitPrep()}${renderCockpitTicket(call)}${renderOutcomeBar(call, "sc-cockpit-outcome")}${renderCloseoutPanel(call)}<div class="sc-cockpit-queues" data-role="overlay-queues">${queueMarkup()}</div>`
      : `<div class="sc-cockpit-queues" data-role="overlay-queues">${queueMarkup()}</div>${renderCockpitTicket(call)}${renderOutcomeBar(call, "sc-cockpit-outcome")}${renderCloseoutPanel(call)}`;

    return `
      <div class="sc-cockpit ${status.className}" data-role="cockpit" role="status" style="${cockpitPositionStyle()}">
        <div class="sc-cockpit-header" data-role="cockpit-drag" title="Zum Verschieben ziehen">
          <span class="sc-cockpit-status">${escapeHtml(status.label)}</span>
          <span class="sc-cockpit-timer" data-role="overlay-call-timer">${escapeHtml(timer)}</span>
          <button class="sc-icon-button" type="button" data-action="toggle-cockpit-mode" title="Minimieren" aria-label="Minimieren">–</button>
          <button class="sc-icon-button" type="button" data-action="dismiss-call-overlay" title="Für diesen Anruf ausblenden" aria-label="Schließen">×</button>
        </div>
        <div class="sc-cockpit-body">
          <div class="sc-cockpit-caller">
            <strong>${escapeHtml(nameLine)}</strong>
            ${subLine ? `<p>${escapeHtml(subLine)}</p>` : ""}
            ${waitInfo}
            ${renderKundenakte(call)}
            ${renderCustomerSearchButton(call, "sc-cockpit-search")}
            ${renderOutboundHint(call)}
          </div>
          ${blocks}
        </div>
      </div>`;
  }

  // Hinweis statt Automatik: Ein Anruf, der ohne Klingeln direkt verbunden ist,
  // stammt typischerweise aus timios eigener Anrufliste. Das ist ein Indiz –
  // umgeschaltet wird nur auf Klick.
  function renderOutboundHint(call) {
    if (outboundMode() || !call || !call.likelyOutbound) return "";
    return `<button class="sc-cockpit-hint-switch" type="button" data-action="set-call-mode" data-mode="outbound">Wirkt ausgehend – auf Outbound umschalten?</button>`;
  }

  // Läuft unabhängig von render()/KI-Läufen im Sekundentakt: aktualisiert nur
  // die Timer-Texte direkt im DOM (kein Full-Render nötig), räumt verwaiste
  // Calls auf (kein frisches Update mehr – z. B. timio-Tab abgestürzt) und
  // hält die Veraltet-Anzeige der Wartefeld-Daten aktuell.
  function tickActiveCallTimer() {
    const call = currentActiveCall();
    if (!call) {
      if (state.activeCall) {
        state.activeCall = null;
        // Verwaiste Anruferdaten auch aus dem lokalen Storage entfernen
        // (Datensparsamkeit: Name/Nummer nicht liegen lassen).
        safeLocalRemove(CONFIG.storageKeys.activeCall);
        render();
      }
      return;
    }
    if (call.status === "connected" && call.connectedAt) {
      const text = formatDuration(Date.now() - call.connectedAt);
      const bannerNode = el("active-call-timer");
      if (bannerNode) bannerNode.textContent = text;
      const overlayNode = el("overlay-call-timer");
      if (overlayNode) overlayNode.textContent = text;
    }
    const staleNode = el("queue-stale");
    if (staleNode) staleNode.textContent = queueStaleLabel();
  }

  // Verschieben des Cockpits per Maus/Touch (Pointer Events). Startet nur auf
  // der Kopfzeile, nicht auf deren Buttons.
  function startCockpitDrag(event) {
    const handle = event.target.closest("[data-role='cockpit-drag']");
    if (!handle || event.target.closest("button")) return;
    const card = event.target.closest("[data-role='cockpit']");
    if (!card) return;
    event.preventDefault();

    const rect = card.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;

    const onMove = (moveEvent) => {
      const x = Math.min(Math.max(0, moveEvent.clientX - offsetX), Math.max(0, window.innerWidth - 90));
      const y = Math.min(Math.max(0, moveEvent.clientY - offsetY), Math.max(0, window.innerHeight - 60));
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;
      card.style.right = "auto";
      state.callOverlay.pos = { x, y };
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      persistCockpitPrefs();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function priorityClass(priority) {
    const value = (priority || "").toLocaleLowerCase("de-DE");
    if (/schwer|hoch|highest|high|blocker/.test(value)) return "is-high";
    if (/mittel|medium/.test(value)) return "is-medium";
    return "is-neutral";
  }

  function statusClass(status) {
    const value = (status || "").toLocaleLowerCase("de-DE");
    if (/erledigt|geschlossen|done|resolved/.test(value)) return "is-done";
    if (/wart|pending/.test(value)) return "is-waiting";
    if (/bearbeitung|fortschritt|progress/.test(value)) return "is-progress";
    return "is-open";
  }

  // ---------------------------------------------------------------------------
  // KI-Status-Helfer
  // ---------------------------------------------------------------------------

  function aiUsable() {
    return Boolean(state.ai.caps && state.ai.caps.usable);
  }

  function aiUnavailableMessage(status) {
    switch (status) {
      case S.UNSUPPORTED:
        return "Lokale KI ist in diesem Chrome nicht verfügbar. Es wird ausdrücklich kein Cloud-Dienst als Ersatz genutzt.";
      case S.UNAVAILABLE:
        return "Das lokale KI-Modell ist auf diesem Gerät derzeit nicht nutzbar.";
      case S.DOWNLOADING:
        return "Das lokale KI-Modell wird geladen. Bitte kurz warten und danach erneut starten.";
      case S.DOWNLOADABLE:
        return "Das lokale KI-Modell muss einmalig geladen werden. Dabei werden nur Modelldaten heruntergeladen – keine Ticketinhalte.";
      case S.ERROR:
        return "Die lokale KI hat kein verwertbares Ergebnis geliefert. Bitte erneut versuchen.";
      default:
        return "Die lokale KI ist gerade nicht verfügbar.";
    }
  }

  function busyOn(name) {
    return state.ai.busy === name;
  }

  // Vergleicht den beim letzten Generieren gespeicherten Fingerprint mit dem
  // aktuellen Ticketinhalt. Rein render-time berechnet, kein eigener State.
  function isStale(aiField) {
    if (!state.ticket || !aiField || aiField.status !== "ok" || !aiField.fingerprint) return false;
    return aiField.fingerprint !== aiCache.fingerprint(state.ticket);
  }

  function staleBadge(aiField) {
    return isStale(aiField) ? `<span class="sc-badge sc-badge--stale">Ticket aktualisiert</span>` : "";
  }

  function regenerateLabel(aiField, running, hasResult, freshLabel, regenerateText) {
    if (running) return "KI arbeitet …";
    if (isStale(aiField)) return "Ticket aktualisiert — neu erstellen";
    return hasResult ? regenerateText : freshLabel;
  }

  function anyBusy() {
    return Boolean(state.ai.busy);
  }

  // Startet einen neuen KI-Lauf, bricht einen evtl. laufenden ab.
  function beginRun(name) {
    if (state.ai.controller) {
      try { state.ai.controller.abort(); } catch (error) { /* ignorieren */ }
    }
    state.ai.controller = new AbortController();
    state.ai.busy = name;
    state.ai.error = "";
    return state.ai.controller.signal;
  }

  // Setzt den Lauf-Status nur zurück, wenn dieser Lauf noch der aktuelle ist.
  // So kann der finally-Block eines abgebrochenen Laufs den neuen nicht stören.
  function endRun(signal) {
    if (!state.ai.controller || state.ai.controller.signal !== signal) return;
    state.ai.busy = "";
    state.ai.controller = null;
    state.ai.download = 0;
  }

  function isAbort(error) {
    return error && (error.name === "AbortError" || error.name === "NotSupportedError" && /abort/i.test(error.message || ""));
  }

  function onDownload(percent) {
    state.ai.download = percent;
    const label = el("ai-download");
    if (label) label.textContent = `Modell wird geladen … ${percent}%`;
  }

  // ---------------------------------------------------------------------------
  // Rendering: Kopf & Tabs
  // ---------------------------------------------------------------------------

  function renderChecks(checks, emptyText, emptyLevel) {
    if (!checks.length) {
      return `<p class="sc-empty-state sc-empty-state--${emptyLevel || "ok"}">${escapeHtml(emptyText)}</p>`;
    }
    return `<ul class="sc-check-list">${checks.map((check) => `
      <li class="sc-check sc-check--${check.level}">
        <span aria-hidden="true">${check.level === "ok" ? "✓" : check.level === "blocker" ? "!" : "i"}</span>
        <span>${escapeHtml(check.text)}</span>
      </li>`).join("")}</ul>`;
  }

  function ticketRow(label, value) {
    return `
      <div class="sc-ticket-row">
        <span>${escapeHtml(label)}</span>
        <strong title="${escapeHtml(value)}">${escapeHtml(value)}</strong>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Rendering: KI-Banner (Verfügbarkeit / Modell laden)
  // ---------------------------------------------------------------------------

  function renderAiBanner() {
    const caps = state.ai.caps;
    if (!caps) {
      return `<div class="sc-ai-banner is-checking"><span class="sc-spinner" aria-hidden="true"></span>Lokale KI wird geprüft …</div>`;
    }
    if (caps.usable && caps.status === S.AVAILABLE) {
      return "";
    }
    if (caps.status === S.DOWNLOADABLE) {
      const loading = busyOn("enable");
      return `
        <div class="sc-ai-banner is-download">
          <div>
            <strong>Lokale KI einsatzbereit machen</strong>
            <p data-role="ai-download">${loading ? `Modell wird geladen … ${state.ai.download}%` : "Das On-Device-Modell wird einmalig lokal geladen. Keine Ticketdaten verlassen den Browser."}</p>
          </div>
          <button class="sc-primary-button" type="button" data-action="enable-ai" ${loading ? "disabled" : ""}>${loading ? "Lädt …" : "Modell laden"}</button>
        </div>`;
    }
    return `<div class="sc-ai-banner is-warn"><span aria-hidden="true">!</span>${escapeHtml(aiUnavailableMessage(caps.status))}</div>`;
  }

  // ---------------------------------------------------------------------------
  // Tab: Übersicht
  // ---------------------------------------------------------------------------

  function stimmungClass(value) {
    if (value === "verärgert" || value === "negativ") return "is-bad";
    if (value === "positiv") return "is-good";
    return "is-neutral";
  }

  function dringlichkeitClass(value) {
    if (value === "hoch") return "is-bad";
    if (value === "mittel") return "is-mid";
    return "is-good";
  }

  // Liefert die Triage-Daten zurück, wenn das Ticket eskalationsverdächtig ist.
  function escalationFlag() {
    const t = state.ai.triage;
    if (t.status !== "ok" || !t.data) return null;
    const hot = t.data.stimmung === "verärgert" || t.data.stimmung === "negativ" || t.data.dringlichkeit === "hoch";
    return hot ? t.data : null;
  }

  function renderEscalation() {
    const d = escalationFlag();
    if (!d) return "";
    const reasons = [];
    if (d.stimmung === "verärgert" || d.stimmung === "negativ") reasons.push(`Stimmung: ${d.stimmung}`);
    if (d.dringlichkeit === "hoch") reasons.push("hohe Dringlichkeit");
    return `
      <section class="sc-section sc-escalation">
        <div class="sc-escalation-head">
          <span class="sc-escalation-icon" aria-hidden="true">!</span>
          <div>
            <strong>Aufmerksamkeit empfohlen</strong>
            <p>${escapeHtml(reasons.join(" · "))}. Kunde zeitnah und deeskalierend beantworten.</p>
          </div>
        </div>
        <button class="sc-primary-button" type="button" data-action="deescalate" ${anyBusy() ? "disabled" : ""}>Deeskalierend antworten</button>
      </section>`;
  }

  function renderTriage() {
    const t = state.ai.triage;
    const running = busyOn("triage");

    let inner;
    if (running) {
      inner = `<div class="sc-inline-loading"><span class="sc-spinner" aria-hidden="true"></span>KI ordnet das Ticket ein …</div>`;
    } else if (t.status === "ok" && t.data) {
      const d = t.data;
      inner = `
        <div class="sc-triage-chips">
          <span class="sc-triage-chip ${stimmungClass(d.stimmung)}">Stimmung: ${escapeHtml(d.stimmung)}</span>
          <span class="sc-triage-chip ${dringlichkeitClass(d.dringlichkeit)}">Dringlichkeit: ${escapeHtml(d.dringlichkeit)}</span>
          <span class="sc-triage-chip is-neutral">${escapeHtml(d.kategorie)}</span>
        </div>
        <p class="sc-triage-line"><strong>Kundenwunsch:</strong> ${escapeHtml(d.kundenwunsch)}</p>
        <p class="sc-triage-line"><strong>Empfohlen:</strong> ${escapeHtml(d.naechsterSchritt)}</p>`;
    } else if (t.status === "error") {
      inner = `<p class="sc-ai-message">${escapeHtml(aiUnavailableMessage(S.ERROR))}</p>`;
    } else if (!aiUsable()) {
      inner = `<p class="sc-ai-message">${escapeHtml(aiUnavailableMessage(state.ai.caps ? state.ai.caps.status : ""))}</p>`;
    } else {
      inner = `<p class="sc-ai-message">Automatische Einordnung von Stimmung, Dringlichkeit und Kundenwunsch – vollständig lokal.</p>`;
    }

    const canRun = aiUsable() && !anyBusy();
    return `
      <section class="sc-section sc-ai-card">
        <div class="sc-section-title-row">
          <h3>KI-Einordnung</h3>
          ${staleBadge(t)}
          <span class="sc-local-label">lokale KI</span>
        </div>
        ${inner}
        <button class="sc-secondary-button" type="button" data-action="run-triage" ${canRun ? "" : "disabled"}>${regenerateLabel(t, running, t.status === "ok", "Ticket einordnen", "Neu einordnen")}</button>
      </section>`;
  }

  function renderSummary() {
    const s = state.ai.summary;
    const running = busyOn("summary");
    const hasText = s.status === "ok" && s.text;

    let body;
    if (hasText || running) {
      body = `<div class="sc-ai-result" data-role="summary-out">${escapeHtml(s.text)}</div>`;
    } else if (s.status === "error" || (state.ai.caps && !aiUsable())) {
      body = `<p class="sc-ai-message">${escapeHtml(aiUnavailableMessage(s.status === "error" ? S.ERROR : state.ai.caps.status))}</p>`;
    } else {
      body = `<p class="sc-ai-message">Vier klare Punkte: Anliegen, Stand, Kundenergebnis und nächster Schritt – aus Beschreibung und sichtbaren Kommentaren.</p>`;
    }

    const canRun = aiUsable() && !anyBusy();
    return `
      <section class="sc-section sc-ai-card">
        <div class="sc-section-title-row">
          <h3>Ticket-Zusammenfassung</h3>
          ${staleBadge(s)}
          <span class="sc-local-label">lokale KI</span>
        </div>
        ${body}
        ${hasText && !running ? renderSummaryCrmStatus() : ""}
        <button class="sc-primary-button" type="button" data-action="generate-summary" ${canRun ? "" : "disabled"}>${regenerateLabel(s, running, hasText, "Zusammenfassung erstellen", "Zusammenfassung erneuern")}</button>
      </section>`;
  }

  function renderDocumentation() {
    const d = state.ai.documentation;
    const running = busyOn("documentation");
    const hasText = d.status === "ok" && d.text;

    let body;
    if (hasText || running) {
      body = `<div class="sc-ai-result" data-role="documentation-out">${escapeHtml(d.text)}</div>`;
      if (hasText && !running) {
        body += `
          <div class="sc-inline-actions">
            <button class="sc-secondary-button" type="button" data-action="copy-documentation">Kopieren</button>
            <button class="sc-text-button" type="button" data-action="use-documentation">Als Kommentar-Entwurf übernehmen</button>
          </div>`;
      }
    } else if (d.status === "error" || (state.ai.caps && !aiUsable())) {
      body = `<p class="sc-ai-message">${escapeHtml(aiUnavailableMessage(d.status === "error" ? S.ERROR : state.ai.caps.status))}</p>`;
    } else {
      body = `<p class="sc-ai-message">Ein vollständiger Übergabetext (Anliegen, Verlauf, Stand, Fakten, offene Punkte, nächster Schritt), damit jeder Kollege das Ticket ohne Rückfrage übernehmen kann.</p>`;
    }

    const canRun = aiUsable() && !anyBusy();
    return `
      <section class="sc-section sc-ai-card">
        <div class="sc-section-title-row">
          <h3>Team-Doku</h3>
          ${staleBadge(d)}
          <span class="sc-local-label">lokale KI</span>
        </div>
        ${body}
        <button class="sc-primary-button" type="button" data-action="generate-documentation" ${canRun ? "" : "disabled"}>${regenerateLabel(d, running, hasText, "Doku erstellen", "Doku erneuern")}</button>
      </section>`;
  }

  function renderTranslation() {
    const tr = state.ai.translation;
    const running = busyOn("translate");
    // Nur anbieten, wenn KI nutzbar ist und eine Beschreibung existiert.
    if (!aiUsable() || !known(state.ticket.description)) return "";

    const foreign = tr.language && tr.language !== "de";
    let body = "";
    if (running) {
      body = `<div class="sc-inline-loading"><span class="sc-spinner" aria-hidden="true"></span>Übersetzt …</div>`;
    } else if (tr.status === "ok" && tr.text) {
      body = `<div class="sc-ai-result" data-role="translation-out">${escapeHtml(tr.text)}</div>`;
    } else if (foreign) {
      body = `<p class="sc-ai-message">Kundentext scheint nicht auf Deutsch zu sein (${escapeHtml(tr.language)}).</p>`;
    }

    const label = tr.status === "ok" && tr.text ? "Erneut übersetzen" : "Beschreibung ins Deutsche übersetzen";
    return `
      <section class="sc-section sc-ai-card">
        <div class="sc-section-title-row">
          <h3>Übersetzung</h3>
          <span class="sc-local-label">lokale KI</span>
        </div>
        ${body}
        <button class="sc-secondary-button" type="button" data-action="translate-description" ${anyBusy() ? "disabled" : ""}>${label}</button>
      </section>`;
  }

  // Kompakte "Nächster Schritt"-Karte (früher ein eigenes Tab): sofortige
  // Regel-Empfehlung als Schnellstart plus KI-Handlungsempfehlung darunter.
  function renderNextStepCard() {
    const recommendation = rules.nextStep(state.ticket);
    const advice = state.ai.advice;
    const running = busyOn("advice");

    let aiBody;
    if (running || (advice.status === "ok" && advice.text)) {
      aiBody = `<div class="sc-ai-result" data-role="advice-out">${escapeHtml(advice.text)}</div>`;
    } else if (advice.status === "error" || (state.ai.caps && !aiUsable())) {
      aiBody = `<p class="sc-ai-message">${escapeHtml(aiUnavailableMessage(advice.status === "error" ? S.ERROR : state.ai.caps.status))}</p>`;
    } else {
      aiBody = `<p class="sc-ai-message">Die KI liest Status, Beschreibung und Kommentare und schlägt 2–4 konkrete Schritte vor.</p>`;
    }
    const canRun = aiUsable() && !anyBusy();

    return `
      <section class="sc-section sc-ai-card">
        <div class="sc-section-title-row">
          <h3>Nächster Schritt</h3>
          ${staleBadge(advice)}
          <span class="sc-local-label">lokale KI</span>
        </div>
        <div class="sc-quickrule">
          <span class="sc-eyebrow">Schnellregel</span>
          <p><strong>${escapeHtml(recommendation.title)}.</strong> ${escapeHtml(recommendation.text)}</p>
          <button class="sc-text-button" type="button" data-action="apply-suggestion" data-intent-id="${escapeHtml(recommendation.intentId || "")}">${escapeHtml(recommendation.action)} →</button>
        </div>
        ${aiBody}
        <button class="sc-secondary-button" type="button" data-action="generate-advice" ${canRun ? "" : "disabled"}>${regenerateLabel(advice, running, advice.status === "ok", "Vorgehen empfehlen", "Empfehlung erneuern")}</button>
      </section>`;
  }

  // ---------------------------------------------------------------------------
  // Netz-Auskunft (aktive Dashboard-Abfrage: Baustatus/FTTX + Kündiger/GFIZ)
  //
  // Kritisch, weil hier – anders als sonst – ein fremdes System AUTOMATISIERT
  // statt nur gelesen wird. Deshalb: Master-Schalter (state.settings.enableLookups,
  // Standard AUS) UND eine Bestätigung vor JEDEM Lauf. Ausgelöst wird der Lauf
  // im Hintergrund-Worker (lookup.js) per sc-run-lookup; Fortschritt/Ergebnis
  // kommen über storageKeys.lookupResult zurück.
  // ---------------------------------------------------------------------------

  // Kundennummer für die Abfrage: bevorzugt aus einem aktiven Anruf, sonst aus
  // der Kundenreferenz des offenen Tickets (Oikonomikos-Feld).
  function lookupCustomerNumber() {
    const call = currentActiveCall();
    const fromCall = call && (call.customerNumber || "").trim();
    if (fromCall) return fromCall;
    const ref = state.ticket && state.ticket.customerReference;
    return known(ref) ? ref.trim() : "";
  }

  function renderLookupSteps(result) {
    const dash = (CONFIG.lookups && CONFIG.lookups[result.kind]) || {};
    const defs = dash.steps || [];
    const byId = {};
    (result.steps || []).forEach((step) => { byId[step.id] = step.state; });
    const icon = (st) => (st === "done" ? "✓" : st === "active" ? "…" : "·");
    return `<ul class="sc-lookup-steps">${defs.map((d) => {
      const st = byId[d.id] || "pending";
      return `<li class="is-${st}"><span class="sc-lookup-step-icon">${icon(st)}</span>${escapeHtml(d.label)}</li>`;
    }).join("")}</ul>`;
  }

  function renderBaustatusCard(data) {
    if (!data || !data.found) return `<p class="sc-ai-message">Kein Baustatus-Treffer zu dieser Kundennummer gefunden.</p>`;
    const rows = [
      ["Vertrag", data.contract],
      ["Vertragsstatus", data.contractStatus],
      ["Line Status", data.lineStatus],
      ["Ausbauphase", data.buildingPhase],
      ["Gebäudetyp", data.buildingType],
      ["KVZ", data.kvz && data.kvz.value],
      ["Adresse", data.address]
    ].filter((entry) => entry[1]);
    const timelines = data.timelines || {};
    const hasTime = (v) => v && v !== "Keine Zeiten vorhanden";
    const timeRows = [
      ["Tiefbau", hasTime(timelines.tiefbau) ? timelines.tiefbau : ""],
      ["LWL", hasTime(timelines.lwl) ? timelines.lwl : ""]
    ].filter((entry) => entry[1]);
    const contacts = data.contacts || {};
    const contactRows = [
      ["Begehung", contacts.begehung],
      ["Hausanschluss", contacts.hausanschluss],
      ["LWL-Installation", contacts.lwl]
    ].filter((entry) => entry[1]);
    return `
      <div class="sc-ticket-grid">${rows.map((entry) => ticketRow(entry[0], entry[1])).join("")}</div>
      ${hasTime(data.phasePredictions) ? `<p class="sc-lookup-note">${escapeWithBreaks(data.phasePredictions)}</p>` : ""}
      ${timeRows.length ? `<div class="sc-ticket-grid">${timeRows.map((entry) => ticketRow(entry[0], entry[1])).join("")}</div>` : ""}
      ${contactRows.length ? `<div class="sc-lookup-contacts"><span class="sc-eyebrow">Externe Firmen</span><div class="sc-ticket-grid">${contactRows.map((entry) => ticketRow(entry[0], entry[1])).join("")}</div></div>` : ""}`;
  }

  function renderChurnCard(data) {
    if (!data || !data.found) return `<p class="sc-ai-message sc-lookup-ok">Kein Kündiger-/Churn-Vorgang zu dieser Kundennummer gefunden.</p>`;
    return `
      <p class="sc-lookup-note">${data.count} ${data.count === 1 ? "Vorgang" : "Vorgänge"} gefunden.</p>
      <ul class="sc-lookup-churn">${data.cases.map((c) => `
        <li>
          <div class="sc-lookup-churn-head">${escapeHtml(c.vertrag || "—")}${c.geschaeftsfall ? ` · ${escapeHtml(c.geschaeftsfall)}` : ""}</div>
          ${c.ursache ? `<div class="sc-lookup-churn-sub">${escapeHtml(c.ursache)}${c.eingang ? ` · ${escapeHtml(c.eingang)}` : ""}</div>` : ""}
          ${c.jiraTicket ? `<a class="sc-text-button" href="${escapeHtml(c.jiraHref || jiraTicketUrl(c.jiraTicket))}" target="_blank" rel="noopener">${escapeHtml(c.jiraTicket)} öffnen</a>` : ""}
          ${c.kommentar ? `<div class="sc-lookup-churn-comment">${escapeWithBreaks(c.kommentar)}</div>` : ""}
        </li>`).join("")}</ul>`;
  }

  function renderLookupResult(result) {
    if (!result) return "";
    const dash = (CONFIG.lookups && CONFIG.lookups[result.kind]) || {};
    if (result.status === "running") {
      return `<div class="sc-lookup-progress"><p class="sc-eyebrow">${escapeHtml(dash.label || "Abfrage")} · läuft …</p>${renderLookupSteps(result)}</div>`;
    }
    if (result.status === "error") {
      return `<div class="sc-lookup-progress">${renderLookupSteps(result)}<p class="sc-ai-message sc-lookup-error">${escapeHtml(result.error || "Abfrage fehlgeschlagen.")}</p></div>`;
    }
    if (result.status === "ok") {
      const data = result.data || {};
      return `<div class="sc-lookup-card"><span class="sc-eyebrow">${escapeHtml(dash.label || "Ergebnis")}${result.customerNumber ? ` · ${escapeHtml(result.customerNumber)}` : ""}</span>${result.kind === "baustatus" ? renderBaustatusCard(data) : renderChurnCard(data)}</div>`;
    }
    return "";
  }

  function renderLookupConfirm(confirm) {
    const dash = (CONFIG.lookups && CONFIG.lookups[confirm.kind]) || {};
    return `
      <div class="sc-lookup-confirm">
        <p><strong>Aktive Abfrage bestätigen.</strong> Dies öffnet und automatisiert das Dashboard <em>${escapeHtml(dash.label || confirm.kind)}</em> und liest Daten zu Kundennummer <strong>${escapeHtml(confirm.customerNumber)}</strong>. Das verlässt bewusst das „liest nur"-Prinzip der Extension.</p>
        <div class="sc-inline-actions">
          <button class="sc-primary-button" type="button" data-action="lookup-confirm">Ja, nachschlagen</button>
          <button class="sc-secondary-button" type="button" data-action="lookup-cancel">Abbrechen</button>
        </div>
      </div>`;
  }

  // Dauerhaftes Banner, solange die Bridge verbunden ist – die Extension kann
  // dann von außen zu Abfragen veranlasst werden, das soll sichtbar bleiben.
  function renderBridgeBanner() {
    const bs = state.bridgeState;
    if (!bs || !bs.connected) return "";
    return `<div class="sc-bridge-banner" role="status">🔌 Bridge aktiv – ein externes Frontend kann über diese Extension Abfragen auslösen.</div>`;
  }

  function renderNetzauskunft() {
    const enabled = state.settings.enableLookups === true;
    let body;
    if (!enabled) {
      body = `<p class="sc-ai-message">Aktive Abfragen der internen Dashboards (Baustatus, Kündiger-Status) sind ausgeschaltet. <button class="sc-text-button" type="button" data-action="open-lookup-settings">In den Einstellungen aktivieren</button></p>`;
    } else if (state.lookup.confirm) {
      body = renderLookupConfirm(state.lookup.confirm);
    } else {
      const number = lookupCustomerNumber();
      const running = state.lookup.result && state.lookup.result.status === "running";
      const actions = number
        ? `
          <p class="sc-section-intro">Schlägt zu Kundennummer <strong>${escapeHtml(number)}</strong> nach – öffnet und automatisiert dafür das jeweilige Dashboard. Vor jeder Abfrage wird bestätigt.</p>
          <div class="sc-inline-actions">
            <button class="sc-primary-button" type="button" data-action="lookup-baustatus" ${running ? "disabled" : ""}>Baustatus nachschlagen</button>
            <button class="sc-secondary-button" type="button" data-action="lookup-churn" ${running ? "disabled" : ""}>Kündiger-Status prüfen</button>
          </div>`
        : `<p class="sc-ai-message">Keine Kundennummer erkannt – weder aus dem Ticket (Kunden-ID) noch aus einem aktiven Anruf. Ohne Kundennummer ist keine Abfrage möglich.</p>`;
      body = actions + renderLookupResult(state.lookup.result);
    }
    return `
      <section class="sc-section sc-netzauskunft">
        <div class="sc-section-title-row">
          <h3>Netz-Auskunft</h3>
          <span class="sc-local-label sc-local-label--warn">aktive Abfrage</span>
        </div>
        ${body}
      </section>`;
  }

  function renderOverview() {
    const ticket = state.ticket;
    const warnings = rules.ticketWarnings(ticket);
    return `
      ${renderAiBanner()}
      <section class="sc-section" aria-label="Ticketübersicht">
        <div class="sc-issue-heading">
          <span class="sc-ticket-key">${escapeHtml(ticket.key)}</span>
          <h2>${escapeHtml(ticket.summary)}</h2>
        </div>
        <div class="sc-badge-row">
          <span class="sc-badge sc-badge--status ${statusClass(ticket.status)}">${escapeHtml(ticket.status)}</span>
          <span class="sc-badge sc-badge--priority ${priorityClass(ticket.priority)}">${escapeHtml(ticket.priority)}</span>
        </div>
        <div class="sc-ticket-grid">
          ${ticketRow("Typ", ticket.issueType)}
          ${ticketRow("Bearbeiter", ticket.assignee)}
          ${ticketRow("Autor", ticket.reporter)}
          ${ticketRow("Kunden-ID / Referenz", ticket.customerReference)}
          ${ticketRow("Kundenname", ticket.customerName)}
        </div>
      </section>
      ${renderEscalation()}
      ${renderTriage()}
      ${renderNextStepCard()}
      ${renderSummary()}
      ${renderDocumentation()}
      ${renderTranslation()}
      ${renderNetzauskunft()}
      <section class="sc-section">
        <h3>Hinweise vor der Bearbeitung</h3>
        ${renderChecks(warnings.map((text) => ({ level: "warning", text })), "Alle sichtbaren Basisinformationen sind vorhanden.")}
      </section>`;
  }

  // ---------------------------------------------------------------------------
  // Tab: Antwort (KI-Entwürfe)
  // ---------------------------------------------------------------------------

  function renderToneRow() {
    return `<div class="sc-tone-row" role="group" aria-label="Tonalität">${AI.tones.map((tone) => `
      <button class="sc-chip ${state.tone === tone.id ? "is-active" : ""}" type="button" data-action="set-tone" data-tone="${tone.id}">${escapeHtml(tone.label)}</button>`).join("")}</div>`;
  }

  function renderReview() {
    const review = state.ai.review;
    if (busyOn("review")) {
      return `<div class="sc-inline-loading"><span class="sc-spinner" aria-hidden="true"></span>KI prüft den Entwurf …</div>`;
    }
    if (review.status !== "ok" && review.status !== "fallback") return "";
    const checks = review.checks || [];
    const improvedBlock = review.improved
      ? `<div class="sc-review-improved">
          <div class="sc-section-title-row"><h4>KI-Vorschlag</h4></div>
          <div class="sc-ai-result">${escapeHtml(review.improved)}</div>
          <button class="sc-secondary-button" type="button" data-action="apply-review">Vorschlag übernehmen</button>
        </div>`
      : "";
    return `
      <div class="sc-quality-results">
        ${renderChecks(checks, "Der Entwurf wirkt vollständig.", "ok")}
        ${improvedBlock}
      </div>`;
  }

  function renderHandoff() {
    const h = state.ai.handoff;
    const running = busyOn("handoff");
    const disabledAll = !aiUsable() || anyBusy();
    const hasComment = h.comment.status === "ok" && h.comment.text;
    const hasEmail = h.email.status === "ok" && (h.email.subject || h.email.body);
    const departmentLabel = h.department.trim() || "Fachabteilung";

    return `
      <section class="sc-section sc-ai-card">
        <div class="sc-section-title-row">
          <h3>An Fachabteilung weiterleiten</h3>
          <span class="sc-local-label">lokale KI</span>
        </div>
        <p class="sc-section-intro">Erstellt in einem Schritt eine Kunden-Info-Mail zur Weiterleitung und einen internen Kommentar mit ToDo für die Fachabteilung.</p>
        <label class="sc-input-label">Fachabteilung
          <input class="sc-text-input" data-role="handoff-department" value="${escapeHtml(h.department)}" placeholder="z. B. Buchhaltung, IT, Logistik">
        </label>
        <textarea class="sc-comment-draft sc-note-input" data-role="handoff-note" placeholder="Zusätzliche Hinweise für die Fachabteilung (optional) – was genau soll geprüft werden?">${escapeHtml(h.note)}</textarea>
        <button class="sc-primary-button" type="button" data-action="generate-handoff" ${disabledAll ? "disabled" : ""}>${running ? "KI arbeitet …" : "Weiterleitung erstellen"}</button>

        ${(running || hasComment) ? `
          <div class="sc-email-editor">
            <h4>Interner Kommentar (für ${escapeHtml(departmentLabel)})</h4>
            <textarea class="sc-comment-draft" data-role="handoff-comment" placeholder="Kommentar für die Fachabteilung …">${escapeHtml(h.comment.text)}</textarea>
            <div class="sc-inline-actions">
              <button class="sc-secondary-button" type="button" data-action="copy-handoff-comment">Kommentar kopieren</button>
              <button class="sc-text-button" type="button" data-action="use-handoff-comment">Als Kommentar-Entwurf übernehmen</button>
            </div>
          </div>` : ""}

        ${(running || hasEmail) ? `
          <div class="sc-email-editor">
            <h4>Kunden-E-Mail</h4>
            <label class="sc-input-label">Betreff
              <input class="sc-text-input" data-role="handoff-email-subject" value="${escapeHtml(h.email.subject)}" placeholder="Betreff …">
            </label>
            <textarea class="sc-comment-draft sc-email-body" data-role="handoff-email-body" placeholder="E-Mail-Text …">${escapeHtml(h.email.body)}</textarea>
            <div class="sc-inline-actions">
              <button class="sc-secondary-button" type="button" data-action="copy-handoff-email">E-Mail kopieren</button>
              <button class="sc-text-button" type="button" data-action="use-handoff-email">Als E-Mail-Entwurf übernehmen</button>
            </div>
          </div>` : ""}
      </section>`;
  }

  function renderReply() {
    const busyDraft = busyOn("comment") || busyOn("email");
    const isEmail = state.ai.draftKind === "email";
    const draftLabel = isEmail ? "E-Mail-Entwurf" : "Kommentar-Entwurf";
    const disabledAll = !aiUsable() || anyBusy();

    return `
      ${renderHandoff()}
      <section class="sc-section sc-ai-card">
        <div class="sc-section-title-row">
          <h3>Antwort-Assistent</h3>
          <span class="sc-local-label">lokale KI</span>
        </div>
        <p class="sc-section-intro">Stichworte genügen. Die KI formuliert daraus einen Jira-Kommentar oder eine Kunden-E-Mail – nur aus sichtbaren Ticketdaten und deiner Notiz.</p>
        <div class="sc-chip-row">${AI.intents.map((intent) => `
          <button class="sc-chip" type="button" data-action="use-intent" data-intent-id="${escapeHtml(intent.id)}">${escapeHtml(intent.label)}</button>`).join("")}</div>
        <textarea class="sc-comment-draft sc-note-input" data-role="note" placeholder="Was möchtest du dokumentieren? Stichworte reichen – z. B. „Rückruf morgen 14 Uhr, Kunde braucht Rechnungskopie“ …">${escapeHtml(state.ai.note)}</textarea>
        <div class="sc-inline-actions">
          <button class="sc-primary-button" type="button" data-action="draft-comment" ${disabledAll ? "disabled" : ""}>${busyOn("comment") ? "KI arbeitet …" : "Jira-Kommentar entwerfen"}</button>
          <button class="sc-secondary-button" type="button" data-action="draft-email" ${disabledAll ? "disabled" : ""}>${busyOn("email") ? "KI arbeitet …" : "Kunden-E-Mail entwerfen"}</button>
        </div>
        <div class="sc-lang-row">
          <span class="sc-lang-label">E-Mail-Sprache</span>
          ${AI.replyLanguages.map((lang) => `
            <button class="sc-chip sc-chip--sm ${state.ai.replyLanguage === lang.id ? "is-active" : ""}" type="button" data-action="set-language" data-language="${escapeHtml(lang.id)}">${escapeHtml(lang.label)}</button>`).join("")}
        </div>
      </section>

      <section class="sc-section sc-draft-section">
        <div class="sc-section-title-row">
          <h3>${escapeHtml(draftLabel)}</h3>
          <span class="sc-local-label">${isEmail ? "E-Mail" : "Kommentar"}</span>
        </div>
        <p class="sc-section-intro">Ton wählen, Text feinschleifen und anschließend in Jira bzw. die E-Mail kopieren.</p>
        ${renderToneRow()}
        ${isEmail ? `<label class="sc-input-label">Betreff
          <input class="sc-text-input" data-role="draft-subject" value="${escapeHtml(state.ai.emailSubject)}" placeholder="Betreff …">
        </label>` : ""}
        <textarea class="sc-comment-draft" data-role="draft" placeholder="Hier entsteht dein Entwurf – oder schreibe direkt los …">${escapeHtml(state.ai.draft)}</textarea>
        <div class="sc-toolbar">
          <button class="sc-tool-button" type="button" data-action="rewrite-draft" ${disabledAll ? "disabled" : ""}>${busyOn("rewrite") ? "…" : "Umschreiben"}</button>
          <button class="sc-tool-button" type="button" data-action="proofread-draft" ${disabledAll ? "disabled" : ""}>${busyOn("proofread") ? "…" : "Korrektur lesen"}</button>
          <button class="sc-tool-button" type="button" data-action="review-draft" ${anyBusy() ? "disabled" : ""}>${busyOn("review") ? "…" : "Qualität prüfen"}</button>
          <button class="sc-tool-button is-primary" type="button" data-action="copy-draft">Kopieren</button>
        </div>
        ${renderReview()}
      </section>

      ${renderEmailTemplates()}`;
  }

  // ---------------------------------------------------------------------------
  // E-Mail-Vorlagen (lokale CRUD, bleibt bestehen)
  // ---------------------------------------------------------------------------

  function renderEmailTemplateCard(template) {
    return `
      <article class="sc-email-template-card">
        <div>
          <h4>${escapeHtml(template.title)}</h4>
          <p><strong>Betreff:</strong> ${escapeHtml(template.subject || "Ohne Betreff")}</p>
        </div>
        <div class="sc-email-template-actions">
          <button class="sc-secondary-button" type="button" data-action="copy-email-template" data-email-id="${escapeHtml(template.id)}">E-Mail kopieren</button>
          <button class="sc-text-button" type="button" data-action="edit-email-template" data-email-id="${escapeHtml(template.id)}">Bearbeiten</button>
          <button class="sc-text-button sc-text-button--danger" type="button" data-action="delete-email-template" data-email-id="${escapeHtml(template.id)}">Löschen</button>
        </div>
      </article>`;
  }

  function renderEmailEditor() {
    if (!state.emailEditor.isOpen) {
      return `<button class="sc-secondary-button" type="button" data-action="open-email-editor">Neue E-Mail-Vorlage anlegen</button>`;
    }
    const existing = state.emailTemplates.find((template) => template.id === state.emailEditor.templateId);
    const template = existing || { title: "", subject: "", body: "" };
    return `
      <div class="sc-email-editor">
        <h4>${existing ? "E-Mail-Vorlage bearbeiten" : "Neue E-Mail-Vorlage"}</h4>
        <label class="sc-input-label">Name der Vorlage
          <input class="sc-text-input" data-role="email-title" value="${escapeHtml(template.title)}" placeholder="z. B. Rückmeldung nach Prüfung">
        </label>
        <label class="sc-input-label">Betreff
          <input class="sc-text-input" data-role="email-subject" value="${escapeHtml(template.subject)}" placeholder="z. B. Update zu Ihrem Anliegen">
        </label>
        <label class="sc-input-label">E-Mail-Text
          <textarea class="sc-comment-draft sc-email-body" data-role="email-body" placeholder="E-Mail-Text eingeben …">${escapeHtml(template.body)}</textarea>
        </label>
        <p class="sc-placeholder-help">Platzhalter: <code>[Kundenname]</code>, <code>[Kundennummer]</code>, <code>[Ticketnummer]</code>, <code>[Tickettitel]</code>, <code>[Anliegen]</code>, <code>[Bearbeiter]</code>.</p>
        <div class="sc-inline-actions">
          <button class="sc-secondary-button" type="button" data-action="close-email-editor">Abbrechen</button>
          <button class="sc-primary-button" type="button" data-action="save-email-template">Lokal speichern</button>
        </div>
      </div>`;
  }

  function renderEmailTemplates() {
    const empty = `<p class="sc-empty-state">Noch keine eigene E-Mail-Vorlage gespeichert.</p>`;
    return `
      <section class="sc-section sc-email-section">
        <div class="sc-section-title-row">
          <h3>Gespeicherte E-Mail-Vorlagen</h3>
          <span class="sc-local-label">nur lokal</span>
        </div>
        <div class="sc-email-template-list">${state.emailTemplates.length ? state.emailTemplates.map(renderEmailTemplateCard).join("") : empty}</div>
        ${renderEmailEditor()}
      </section>`;
  }

  // ---------------------------------------------------------------------------
  // Tab: Call-Hilfe
  // ---------------------------------------------------------------------------

  function renderCallDraft() {
    const cd = state.ai.callDraft;
    const running = busyOn("callclean");
    let body = "";
    if (running || (cd.status === "ok" && cd.text)) {
      body = `<div class="sc-ai-result" data-role="calldraft-out">${escapeHtml(cd.text)}</div>
        <div class="sc-inline-actions">
          <button class="sc-secondary-button" type="button" data-action="copy-call-draft">Kopieren</button>
          <button class="sc-text-button" type="button" data-action="use-call-draft">In Antwort übernehmen</button>
        </div>`;
    }
    const disabled = !aiUsable() || anyBusy();
    return `
      <section class="sc-section sc-ai-card">
        <div class="sc-section-title-row">
          <h3>Notizen → sauberer Kommentar</h3>
          <span class="sc-local-label">lokale KI</span>
        </div>
        <p class="sc-section-intro">Tippe während des Gesprächs Stichworte. Die KI macht daraus einen strukturierten Jira-Kommentar.</p>
        <textarea class="sc-comment-draft sc-note-input" data-role="call-notes" placeholder="Stichworte aus dem Gespräch …">${escapeHtml(state.ai.callNotes)}</textarea>
        <button class="sc-primary-button" type="button" data-action="clean-call-notes" ${disabled ? "disabled" : ""}>${running ? "KI arbeitet …" : "In sauberen Kommentar umwandeln"}</button>
        ${body}
      </section>`;
  }

  // Aktiver Leitfaden bzw. aktive Einwandkarten. Beide Listen sind
  // modusabhängig – die Kopier-Buttons indizieren deshalb bewusst in genau
  // diese Funktionen und nicht mehr in eine feste Config-Liste.
  function activeCallPhases() {
    const guides = CONFIG.callGuides || {};
    return (outboundMode() ? guides.outbound : guides.inbound) || [];
  }

  function activeObjectionCards() {
    const cards = CONFIG.objectionCards || {};
    return (outboundMode() ? cards.outbound : cards.inbound) || [];
  }

  // --- Gesprächsvorbereitung (lokale KI) -------------------------------------

  function renderCallPrep() {
    const prep = state.ai.callPrep;
    const running = busyOn("callprep");
    let body = "";
    if (running) {
      body = `<div class="sc-inline-loading"><span class="sc-spinner"></span>Bereitet das Gespräch vor …</div>`;
    } else if (prep.status === "ok" && prep.data) {
      const d = prep.data;
      const points = Array.isArray(d.punkte) ? d.punkte : [];
      const questions = Array.isArray(d.fragen) ? d.fragen : [];
      const objections = Array.isArray(d.einwaende) ? d.einwaende : [];
      body = `
        <div class="sc-prep">
          ${d.ziel ? `<p class="sc-prep-goal"><span>Ziel des Anrufs</span>${escapeHtml(d.ziel)}</p>` : ""}
          ${points.length ? `<div class="sc-prep-block"><h4>Das will ich ansprechen</h4><ul>${points.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul></div>` : ""}
          ${questions.length ? `<div class="sc-prep-block"><h4>Das muss ich fragen</h4><ul>${questions.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ul></div>` : ""}
          ${objections.length ? `<div class="sc-prep-block"><h4>Damit ist zu rechnen</h4>${objections.map((o) => `
            <div class="sc-prep-objection">
              <strong>${escapeHtml(o.einwand || "")}</strong>
              <p>${escapeHtml(o.antwort || "")}</p>
            </div>`).join("")}</div>` : ""}
        </div>
        <div class="sc-inline-actions">
          <button class="sc-secondary-button" type="button" data-action="copy-call-prep">Vorbereitung kopieren</button>
        </div>`;
    } else if (prep.status === "error" || (state.ai.caps && !aiUsable())) {
      body = `<p class="sc-ai-message">${escapeHtml(aiUnavailableMessage(prep.status === "error" ? S.ERROR : state.ai.caps.status))}</p>`;
    } else {
      body = `<p class="sc-ai-message">Aus dem Ticket entstehen Anrufziel, Gesprächspunkte, offene Fragen und die zu erwartenden Einwände – damit du beim Verbinden sofort sprechfähig bist.</p>`;
    }
    const hasResult = prep.status === "ok" && Boolean(prep.data);
    const canRun = aiUsable() && !anyBusy();
    return `
      <section class="sc-section sc-ai-card">
        <div class="sc-section-title-row">
          <h3>Gesprächsvorbereitung</h3>
          ${staleBadge(prep)}
          <span class="sc-local-label">lokale KI</span>
        </div>
        ${body}
        <button class="sc-primary-button" type="button" data-action="generate-call-prep" ${canRun ? "" : "disabled"}>${regenerateLabel(prep, running, hasResult, "Gespräch vorbereiten", "Vorbereitung erneuern")}</button>
      </section>`;
  }

  // --- Gesprächsergebnis ------------------------------------------------------

  // Eingehend und ausgehend haben eigene Wortschätze (Stufe 3,
  // KONZEPT-INTEGRATION.md) — "Mailbox"/"Falsche Nummer" ergeben bei einem
  // eingehenden Anruf keinen Sinn.
  function activeOutcomes() {
    const cfg = outboundMode() ? CONFIG.outbound : CONFIG.inbound;
    return (cfg && cfg.outcomes) || [];
  }

  // Erscheint nach dem Auflegen. Ein Klick füllt die Gesprächsnotiz vor, lässt
  // die lokale KI daraus den Jira-Kommentar bauen und legt bei Nichterreichen
  // gleich die Wiedervorlage an.
  function renderOutcomeBar(call, className) {
    const outcomes = activeOutcomes();
    if (!call || call.status !== "ended" || !outcomes.length) return "";
    const buttons = outcomes.map((outcome) =>
      `<button class="sc-outcome-button" type="button" data-action="call-outcome" data-outcome="${escapeHtml(outcome.id)}">${escapeHtml(outcome.label)}</button>`
    ).join("");
    return `
      <div class="sc-outcome ${className || ""}">
        <span class="sc-outcome-label">Wie ist das Gespräch ausgegangen?</span>
        <div class="sc-outcome-buttons">${buttons}</div>
      </div>`;
  }

  // Verarbeitet ein Ergebnis – egal ob hier oder im timio-Cockpit geklickt.
  function applyOutcome(outcomeId, context) {
    const outcome = activeOutcomes().find((entry) => entry.id === outcomeId);
    if (!outcome) return;
    const call = context || currentActiveCall() || {};

    syncInputsFromDom();
    const existing = state.ai.callNotes.trim();
    state.ai.callNotes = existing ? `${existing}\n${outcome.seed}` : outcome.seed;
    state.settingsOpen = false;
    state.activeTab = "call";
    persistUiState();
    // "Ergebnis festhalten" öffnet für Optionen mit echtem Gesprächsinhalt
    // zusätzlich das Abschluss-Panel — das "fehlende Ziel" des Staffelstabs
    // (KONZEPT-INTEGRATION.md, Stufe 3).
    if (outcome.opensPanel) openCloseout("notiz", call, outcome.seed);

    let scheduled = null;
    if (outcome.followUp) {
      const t = state.ticket;
      scheduled = upsertCallback({
        ticketKey: t && known(t.key) ? t.key : "",
        ticketSummary: t && known(t.summary) ? t.summary : "",
        customerName: (t && known(t.customerName) ? t.customerName : "") || call.callerName || "",
        customerReference: (t && known(t.customerReference) ? t.customerReference : "") || call.customerNumber || "",
        phone: call.callerNumber || (t ? ticketPhoneNumber(t) : ""),
        reason: outcome.label,
        lastOutcome: outcome.id,
        countsAsAttempt: true
      });
    }

    render();
    if (scheduled) {
      const maxAttempts = (CONFIG.outbound && CONFIG.outbound.maxAttempts) || 3;
      toast(scheduled.attempts >= maxAttempts
        ? `${outcome.label} – ${scheduled.attempts}. Versuch. Erwäge den schriftlichen Weg.`
        : `${outcome.label} – Wiedervorlage ${formatDueLabel(scheduled.dueAt)} angelegt.`);
    }
    // Kommentar-Entwurf im Anschluss, damit der Toast nicht überschrieben wird.
    runCallClean();
  }

  // ---------------------------------------------------------------------------
  // Abschluss-Panel (Stufe 3, KONZEPT-INTEGRATION.md) — "Ein Gespräch, eine
  // Erfassung". Eigene Instanz, unabhängig vom Gegenstück in
  // timio-content.js — geteilt werden nur die reinen Helfer in shared.js und
  // die Payload-Form in supabase.js.
  // ---------------------------------------------------------------------------

  const CLOSEOUT_TYPE_LABEL = { notiz: "Notiz", lead: "Lead", vertrag: "Vertrag", tarifwechsel: "Tarifwechsel" };
  const CLOSEOUT_LEAD_STATUS = [["neu", "Neu"], ["inBearbeitung", "In Bearbeitung"], ["gewonnen", "Gewonnen"], ["verloren", "Verloren"]];
  const CLOSEOUT_LEAD_PRIORITY = [["normal", "Normal"], ["hoch", "Hoch"], ["dringend", "Dringend"]];
  const CLOSEOUT_CONTRACT_STATUS = [["offen", "Offen"], ["aktiv", "Aktiv"], ["storniert", "Storniert"]];
  const CLOSEOUT_LAUFZEIT = [[12, "12 Monate"], [24, "24 Monate"], [null, "Unbefristet"]];
  const CLOSEOUT_TARIFF_TYPE = [["sidegrade", "Sidegrade / VVL"], ["upgrade", "Upgrade"]];
  // Labels 1:1 aus TARIFF_CONTEXT_LABEL, src/lib/utils.ts (CRM-Repo).
  const CLOSEOUT_TARIFF_CONTEXT = [
    ["mvlz_gt3", "Restlaufzeit > 3 Monate"],
    ["mvlz_lt3", "Restlaufzeit < 3 Monate"],
    ["outside_mvlz", "Außerhalb MVLZ"]
  ];

  // Inhalt bevorzugt aus dem KI-Entwurf (state.ai.callDraft, derselbe Text
  // wie für den Jira-Kommentar — kein zweiter KI-Prompt), sonst aus dem
  // übergebenen Seed, sonst aus den rohen Gesprächsnotizen.
  function defaultCloseoutFields(call, seedText) {
    const card = state.customerCard && state.customerCard.status === "ok" ? state.customerCard.data : null;
    const ticket = state.ticket;
    const ticketKey = ticket && known(ticket.key) ? ticket.key : "";
    const aiText = state.ai.callDraft && state.ai.callDraft.status === "ok" ? state.ai.callDraft.text : "";
    return {
      title: `Telefonat${ticketKey ? " zu " + ticketKey : ""}`,
      content: aiText || seedText || state.ai.callNotes || "",
      contentTouched: false,
      customerName: (card && card.name) || (call && call.callerName) || (ticket && known(ticket.customerName) ? ticket.customerName : "") || "",
      customerNumber: (call && call.customerNumber) || (ticket && known(ticket.customerReference) ? ticket.customerReference : "") || "",
      phone: (call && call.callerNumber) || "",
      topic: ticket && known(ticket.summary) ? ticket.summary : "",
      status: "neu",
      priority: "normal",
      followUpDate: "",
      products: [],
      contractDate: todayIso(),
      contractStatus: "aktiv",
      laufzeitMonate: null,
      changeType: null,
      context: null,
      oldProduct: "",
      newProduct: "",
      changeDate: todayIso(),
      notes: "",
      jiraTicket: ticketKey
    };
  }

  // Öffnet das Panel für den aktuellen Anruf. Ist es für diesen Anruf schon
  // offen, wird NICHT zurückgesetzt — nur ein noch unangetasteter
  // content-Text wird nachträglich befüllt (z. B. wenn der KI-Entwurf erst
  // eintrifft, nachdem der Bearbeiter das Panel schon manuell geöffnet hat),
  // damit weder ein späterer Klick noch ein später eintreffender KI-Text
  // bereits Getipptes überschreibt.
  function openCloseout(entryType, call, seedText) {
    const id = callIdOf(call);
    if (!state.closeout || state.closeout.callId !== id) {
      state.closeout = {
        callId: id,
        entryType,
        fields: defaultCloseoutFields(call, seedText),
        status: "idle",
        error: ""
      };
    } else if (!state.closeout.fields.contentTouched) {
      const aiText = state.ai.callDraft && state.ai.callDraft.status === "ok" ? state.ai.callDraft.text : "";
      if (aiText || seedText) state.closeout.fields.content = aiText || seedText;
    }
    if (entryType === "vertrag" || entryType === "tarifwechsel") maybeLoadSharedSettings();
    render();
  }

  function maybeLoadSharedSettings(opts) {
    if (!supabaseClient) return;
    const forceRefresh = Boolean(opts && opts.forceRefresh);
    if (state.sharedSettings.status === "loading") return;
    if (!forceRefresh && state.sharedSettings.status === "ok") return;
    state.sharedSettings = { status: "loading", data: state.sharedSettings.data, error: "" };
    render();
    supabaseClient.fetchSharedSettings({ forceRefresh }).then((res) => {
      state.sharedSettings = res.ok
        ? { status: "ok", data: res.data, error: "" }
        : { status: res.reason === "not-logged-in" ? "not-logged-in" : "error", data: state.sharedSettings.data, error: res.error || "" };
      render();
    }).catch((error) => {
      state.sharedSettings = { status: "error", data: state.sharedSettings.data, error: String((error && error.message) || error) };
      render();
    });
  }

  async function submitCloseout() {
    if (!state.closeout || !supabaseClient) return;
    syncInputsFromDom();
    const submittedCallId = state.closeout.callId;
    const entryType = state.closeout.entryType;
    const fields = state.closeout.fields;
    state.closeout.status = "saving";
    state.closeout.error = "";
    render();

    let res;
    if (entryType === "notiz") res = await supabaseClient.insertNote(fields);
    else if (entryType === "lead") res = await supabaseClient.insertLead(fields);
    else if (entryType === "vertrag") res = await supabaseClient.insertContract(fields);
    else if (entryType === "tarifwechsel") res = await supabaseClient.insertTariffChange(fields);
    else return;

    // Anruf ist inzwischen vorbei oder ein neuer hat begonnen — das Ergebnis
    // gehört dann nicht mehr zum aktuell sichtbaren Panel.
    if (!state.closeout || state.closeout.callId !== submittedCallId) return;

    if (res.ok) {
      state.closeout.status = "done";
      toast(`${CLOSEOUT_TYPE_LABEL[entryType]} gespeichert.`);
    } else {
      state.closeout.status = "error";
      state.closeout.error = res.reason === "not-logged-in"
        ? "Nicht bei Supabase angemeldet."
        : (res.error || "Speichern fehlgeschlagen.");
    }
    render();
  }

  function closeoutStatusLine() {
    if (state.sharedSettings.status === "loading") return `<p class="sc-cockpit-hint">Produktkatalog wird geladen …</p>`;
    if (state.sharedSettings.status === "not-logged-in") return `<p class="sc-cockpit-hint">Nicht bei Supabase angemeldet — Produktkatalog nicht verfügbar.</p>`;
    if (state.sharedSettings.status === "error") {
      return `<p class="sc-cockpit-hint">Produktkatalog gerade nicht abrufbar. <button type="button" class="sc-link-button" data-action="closeout-refresh-settings">Erneut versuchen</button></p>`;
    }
    return "";
  }

  function productDatalistMarkup() {
    const products = (state.sharedSettings.data && state.sharedSettings.data.products) || [];
    return `<datalist id="sc-closeout-products">${products.map((p) => `<option value="${escapeHtml(p.name)}"></option>`).join("")}</datalist>`;
  }

  function closeoutChipGroup(action, options, currentValue) {
    return `<div class="sc-closeout-chipgroup">${options.map(([id, label]) =>
      `<button type="button" class="sc-chip ${currentValue === id ? "is-active" : ""}" data-action="${action}" data-value="${id === null ? "" : escapeHtml(String(id))}">${escapeHtml(label)}</button>`
    ).join("")}</div>`;
  }

  function closeoutProductPickerMarkup(fields) {
    if (state.sharedSettings.status !== "ok") return "";
    const groups = groupProductsByCategory(state.sharedSettings.data.products);
    return groups.map((group) => `
      <div class="sc-closeout-product-group">
        <span class="sc-closeout-product-cat">${escapeHtml(group.category)}</span>
        <div class="sc-closeout-product-chips">
          ${group.products.map((p) => {
            const active = fields.products.includes(p.name);
            return `<button type="button" class="sc-chip ${active ? "is-active" : ""}" data-action="closeout-toggle-product" data-product="${escapeHtml(p.name)}">${escapeHtml(p.name)} · ${Number(p.commission).toFixed(2)} €</button>`;
          }).join("")}
        </div>
      </div>`).join("");
  }

  function closeoutNotizFieldsMarkup(fields) {
    return `
      <label class="sc-input-label">Titel
        <input class="sc-text-input" data-role="closeout-title" value="${escapeHtml(fields.title)}">
      </label>
      <label class="sc-input-label">Inhalt
        <textarea class="sc-comment-draft" data-role="closeout-content" rows="4">${escapeHtml(fields.content)}</textarea>
      </label>`;
  }

  function closeoutLeadFieldsMarkup(fields) {
    return `
      <label class="sc-input-label">Anliegen
        <input class="sc-text-input" data-role="closeout-topic" value="${escapeHtml(fields.topic)}">
      </label>
      <label class="sc-input-label">Telefon
        <input class="sc-text-input" data-role="closeout-phone" value="${escapeHtml(fields.phone)}">
      </label>
      ${closeoutChipGroup("closeout-set-lead-status", CLOSEOUT_LEAD_STATUS, fields.status)}
      ${closeoutChipGroup("closeout-set-lead-priority", CLOSEOUT_LEAD_PRIORITY, fields.priority)}
      <label class="sc-input-label">Wiedervorlage
        <input class="sc-text-input" type="date" data-role="closeout-followup-date" value="${escapeHtml(fields.followUpDate)}">
      </label>
      <label class="sc-input-label">Notizen
        <textarea class="sc-comment-draft" data-role="closeout-notes" rows="3">${escapeHtml(fields.notes)}</textarea>
      </label>`;
  }

  function closeoutVertragFieldsMarkup(fields) {
    return `
      <label class="sc-input-label">Vertragsdatum
        <input class="sc-text-input" type="date" data-role="closeout-contract-date" value="${escapeHtml(fields.contractDate)}">
      </label>
      ${closeoutChipGroup("closeout-set-contract-status", CLOSEOUT_CONTRACT_STATUS, fields.contractStatus)}
      ${closeoutChipGroup("closeout-set-contract-laufzeit", CLOSEOUT_LAUFZEIT, fields.laufzeitMonate)}
      ${closeoutStatusLine()}
      <div class="sc-closeout-products">${closeoutProductPickerMarkup(fields)}</div>
      <label class="sc-input-label">Wiedervorlage
        <input class="sc-text-input" type="date" data-role="closeout-followup-date" value="${escapeHtml(fields.followUpDate)}">
      </label>
      <label class="sc-input-label">Notizen
        <textarea class="sc-comment-draft" data-role="closeout-notes" rows="3">${escapeHtml(fields.notes)}</textarea>
      </label>`;
  }

  function closeoutTarifwechselFieldsMarkup(fields) {
    return `
      <label class="sc-input-label">Wechseldatum
        <input class="sc-text-input" type="date" data-role="closeout-change-date" value="${escapeHtml(fields.changeDate)}">
      </label>
      ${closeoutChipGroup("closeout-set-tarif-changetype", CLOSEOUT_TARIFF_TYPE, fields.changeType)}
      ${closeoutChipGroup("closeout-set-tarif-context", CLOSEOUT_TARIFF_CONTEXT, fields.context)}
      ${closeoutStatusLine()}
      <label class="sc-input-label">Altes Produkt
        <input class="sc-text-input" list="sc-closeout-products" data-role="closeout-old-product" value="${escapeHtml(fields.oldProduct)}">
      </label>
      <label class="sc-input-label">Neues Produkt
        <input class="sc-text-input" list="sc-closeout-products" data-role="closeout-new-product" value="${escapeHtml(fields.newProduct)}">
      </label>
      ${productDatalistMarkup()}
      <label class="sc-input-label">Notizen
        <textarea class="sc-comment-draft" data-role="closeout-notes" rows="3">${escapeHtml(fields.notes)}</textarea>
      </label>`;
  }

  function closeoutCommissionMarkup(entryType, fields) {
    if (entryType === "vertrag") {
      const total = calcContractCommission({ products: fields.products, status: fields.contractStatus }, state.sharedSettings.data || {});
      return `<div class="sc-closeout-commission">Provision: <strong>${total.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</strong></div>`;
    }
    if (entryType === "tarifwechsel") {
      const canCalc = fields.changeType && fields.context;
      const total = canCalc ? calcTariffCommission({ changeType: fields.changeType, context: fields.context }, state.sharedSettings.data || {}) : null;
      return `<div class="sc-closeout-commission">Provision: <strong>${total === null ? "–" : total.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"}</strong></div>`;
    }
    return "";
  }

  function renderCloseoutPanel(call) {
    if (!state.closeout || state.closeout.callId !== callIdOf(call)) return "";
    const { entryType, fields, status, error } = state.closeout;

    if (status === "done") {
      return `<div class="sc-closeout sc-closeout-done">✓ ${escapeHtml(CLOSEOUT_TYPE_LABEL[entryType] || entryType)} gespeichert.</div>`;
    }

    const typeButtons = ["notiz", "lead", "vertrag", "tarifwechsel"].map((type) =>
      `<button type="button" class="sc-chip ${entryType === type ? "is-active" : ""}" data-action="closeout-type" data-value="${type}">${CLOSEOUT_TYPE_LABEL[type]}</button>`
    ).join("");

    let fieldsMarkup = "";
    let submitDisabled = false;
    if (entryType === "notiz") fieldsMarkup = closeoutNotizFieldsMarkup(fields);
    else if (entryType === "lead") fieldsMarkup = closeoutLeadFieldsMarkup(fields);
    else if (entryType === "vertrag") { fieldsMarkup = closeoutVertragFieldsMarkup(fields); submitDisabled = state.sharedSettings.status !== "ok"; }
    else if (entryType === "tarifwechsel") { fieldsMarkup = closeoutTarifwechselFieldsMarkup(fields); submitDisabled = state.sharedSettings.status !== "ok"; }

    return `
      <div class="sc-closeout">
        <div class="sc-closeout-head"><span class="sc-closeout-title">Abschluss erfassen</span></div>
        <div class="sc-closeout-chipgroup">${typeButtons}</div>
        <label class="sc-input-label">Kundenname
          <input class="sc-text-input" data-role="closeout-customer-name" value="${escapeHtml(fields.customerName)}">
        </label>
        <label class="sc-input-label">Kundennummer
          <input class="sc-text-input" data-role="closeout-customer-number" value="${escapeHtml(fields.customerNumber)}">
        </label>
        ${fieldsMarkup}
        <label class="sc-input-label">Jira-Ticket
          <input class="sc-text-input" data-role="closeout-jira-ticket" value="${escapeHtml(fields.jiraTicket)}">
        </label>
        ${closeoutCommissionMarkup(entryType, fields)}
        ${error ? `<p class="sc-cockpit-mismatch">${escapeHtml(error)}</p>` : ""}
        <button type="button" class="sc-primary-button" data-action="closeout-submit" ${status === "saving" || submitDisabled ? "disabled" : ""}>${status === "saving" ? "Speichert …" : "Speichern"}</button>
      </div>`;
  }

  // --- Rückrufliste -----------------------------------------------------------

  function formatDueLabel(dueAt) {
    if (typeof dueAt !== "number") return "";
    const diff = dueAt - Date.now();
    if (diff <= 0) return "jetzt fällig";
    const minutes = Math.round(diff / 60000);
    if (minutes < 60) return `in ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `in ${hours} h`;
    return `in ${Math.round(hours / 24)} Tagen`;
  }

  function renderCallbackList() {
    const now = Date.now();
    const items = pruneCallbacks(state.callbacks, now);
    const ticketKey = state.ticket && known(state.ticket.key) ? state.ticket.key : "";
    const alreadyListed = ticketKey && items.some((item) => item.ticketKey === ticketKey);

    const rows = items.map((item) => {
      const overdue = typeof item.dueAt === "number" && item.dueAt <= now;
      const phone = normalizePhone(item.phone);
      const meta = [
        item.customerName,
        item.customerReference ? `Kundennummer ${item.customerReference}` : "",
        item.attempts ? `${item.attempts}. Versuch` : ""
      ].filter(Boolean).join(" · ");
      return `
        <li class="sc-callback ${overdue ? "is-due" : ""}">
          <div class="sc-callback-main">
            <div>
              <strong>${escapeHtml(item.ticketSummary || item.ticketKey || "Rückruf")}</strong>
              ${meta ? `<p class="sc-callback-meta">${escapeHtml(meta)}</p>` : ""}
              ${item.reason ? `<p class="sc-callback-reason">${escapeHtml(item.reason)}</p>` : ""}
            </div>
            <span class="sc-callback-due">${escapeHtml(formatDueLabel(item.dueAt))}</span>
          </div>
          <div class="sc-callback-actions">
            <button class="sc-secondary-button" type="button" data-action="dial-callback" data-callback-id="${escapeHtml(item.id)}" ${phone ? "" : "disabled"} title="${phone ? `${escapeHtml(phone)} kopieren und timio öffnen` : "Keine Rufnummer hinterlegt"}">Nummer &amp; timio</button>
            ${item.ticketKey ? `<a class="sc-text-button" href="${escapeHtml((CONFIG.jira && CONFIG.jira.baseUrl) || "")}/browse/${escapeHtml(item.ticketKey)}" target="_blank" rel="noopener">${escapeHtml(item.ticketKey)}</a>` : ""}
            <button class="sc-text-button" type="button" data-action="snooze-callback" data-callback-id="${escapeHtml(item.id)}" data-snooze="3600000">+1 h</button>
            <button class="sc-text-button" type="button" data-action="snooze-callback" data-callback-id="${escapeHtml(item.id)}" data-snooze="86400000">morgen</button>
            <button class="sc-text-button" type="button" data-action="complete-callback" data-callback-id="${escapeHtml(item.id)}">erledigt</button>
          </div>
        </li>`;
    }).join("");

    return `
      <section class="sc-section">
        <div class="sc-section-title-row">
          <h3>Rückrufe${items.length ? ` (${items.length})` : ""}</h3>
          <span class="sc-local-label">nur lokal</span>
        </div>
        <p class="sc-section-intro">Eigene Wiedervorlage für vereinbarte Rückrufe – unabhängig von der Anrufliste in timio. Fällige Einträge melden sich auch über das Symbolleisten-Icon.</p>
        ${items.length ? `<ul class="sc-callback-list">${rows}</ul>` : `<p class="sc-queue-empty">Keine offenen Rückrufe.</p>`}
        <button class="sc-secondary-button" type="button" data-action="add-callback" ${ticketKey && !alreadyListed ? "" : "disabled"}>
          ${alreadyListed ? "Dieses Ticket steht bereits auf der Liste" : "Offenes Ticket auf die Rückrufliste setzen"}
        </button>
      </section>`;
  }

  function renderCallGuide() {
    const phases = activeCallPhases();
    const cards = activeObjectionCards();
    const noteTemplate = outboundMode()
      ? "Angerufen: [Kundenname]\nAnlass: [Warum habe ich angerufen?]\nBesprochen: [Wichtigste Punkte]\nErgebnis: [Was wurde geklärt / zugesagt?]\nNächster Schritt: [Wer macht was bis wann?]"
      : "Gespräch mit: [Kundenname]\nAnliegen: [Worum ging es?]\nBesprochen: [Wichtigste Punkte]\nErgebnis: [Was wurde geklärt / zugesagt?]\nNächster Schritt: [Wer macht was bis wann?]";
    return `
      <section class="sc-section">
        <div class="sc-section-title-row">
          <h3>Gesprächsleitfaden${outboundMode() ? " (ausgehend)" : ""}</h3>
          <button class="sc-icon-button" type="button" data-action="copy-call-note" title="Notizvorlage kopieren" aria-label="Notizvorlage kopieren">⧉</button>
        </div>
        <div class="sc-call-list">
          ${phases.map((phase, index) => `
            <details class="sc-call-phase" ${index === 0 ? "open" : ""}>
              <summary>${escapeHtml(phase.title)}</summary>
              <p>${escapeHtml(phase.prompt)}</p>
              <button class="sc-text-button" type="button" data-action="copy-call-phase" data-phase-index="${index}">Satz kopieren</button>
            </details>`).join("")}
        </div>
      </section>
      <section class="sc-section">
        <h3>Einwandkarten</h3>
        <div class="sc-objection-list">
          ${cards.map((card, index) => `
            <article class="sc-objection-card">
              <h4>${escapeHtml(card.title)}</h4>
              <p>${escapeHtml(card.text)}</p>
              <button class="sc-text-button" type="button" data-action="copy-objection" data-objection-index="${index}">Antwort kopieren</button>
            </article>`).join("")}
        </div>
        <input type="hidden" data-role="call-note" value="${escapeHtml(noteTemplate)}">
      </section>`;
  }

  function renderQueueSection() {
    return `
      <section class="sc-section">
        <div class="sc-section-title-row">
          <h3>Wartefeld live</h3>
          <span class="sc-local-label">aus timio</span>
        </div>
        <div data-role="queue-overview">${queueMarkup()}</div>
      </section>`;
  }

  // Der aktive Anruf war in diesem Tab bisher unsichtbar. Ausgehend ist er der
  // Ausgangspunkt: timio wählt selbst, also ist die erste Frage immer, wer da
  // gerade dran ist und ob das offene Ticket dazu passt.
  function renderActiveCallCard() {
    const call = currentActiveCall();
    if (!call) return "";
    const meta = shared.callStatusMeta(call.status, state.callMode);
    const nameLine = call.callerName || call.callerNumber || "Unbekannter Gesprächspartner";
    const details = [
      call.callerNumber,
      call.customerNumber ? `Kundennummer ${call.customerNumber}` : "",
      call.group
    ].filter(Boolean).join(" · ");
    return `
      <section class="sc-section sc-active-call ${meta.cls}">
        <div class="sc-section-title-row">
          <h3>${escapeHtml(meta.label)}</h3>
          <span class="sc-local-label">aus timio</span>
        </div>
        <strong>${escapeHtml(nameLine)}</strong>
        ${details ? `<p class="sc-callback-meta">${escapeHtml(details)}</p>` : ""}
        ${renderCustomerSearchButton(call, "sc-secondary-button")}
        ${renderOutcomeBar(call)}
        ${renderCloseoutPanel(call)}
      </section>`;
  }

  // Reihenfolge folgt der Arbeitsrichtung: ausgehend zuerst der Gesprächs-
  // partner und die Vorbereitung, eingehend zuerst das Wartefeld.
  function renderCall() {
    if (outboundMode()) {
      return `
        ${renderActiveCallCard()}
        ${renderCallPrep()}
        ${renderCallDraft()}
        ${renderCallbackList()}
        ${renderCallGuide()}
        ${renderQueueSection()}`;
    }
    return `
      ${renderQueueSection()}
      ${renderActiveCallCard()}
      ${renderCallDraft()}
      ${renderCallbackList()}
      ${renderCallGuide()}`;
  }

  // ---------------------------------------------------------------------------
  // Zusammenbau
  // ---------------------------------------------------------------------------

  // Login/Logout der Extension-eigenen Supabase-Session (Stufe 1,
  // KONZEPT-INTEGRATION.md, Option a). Bewusst außerhalb von state.settings
  // gehalten und nicht Teil von saveSettings()/persistSettings() — die PIN
  // geht nur an den Auth-Endpoint und wird danach sofort verworfen, nie
  // persistiert.
  function renderSupabaseLoginSection() {
    const auth = state.supabaseAuth;
    if (state.supabaseSession) {
      const label = state.supabaseSession.displayName || state.supabaseSession.email || "unbekannt";
      return `
        <section class="sc-section">
          <div class="sc-section-title-row">
            <h3>CRM-Anmeldung (Kundenakte)</h3>
            <span class="sc-local-label">eigene Sitzung</span>
          </div>
          <p class="sc-section-intro">Angemeldet als <strong>${escapeHtml(label)}</strong>. Diese Sitzung ist unabhängig vom CRM-Tab und wird nur für die Kundenakte beim Anruf genutzt.</p>
          <div class="sc-inline-actions">
            <button class="sc-secondary-button" type="button" data-action="supabase-logout">Abmelden</button>
          </div>
        </section>`;
    }
    return `
      <section class="sc-section">
        <div class="sc-section-title-row">
          <h3>CRM-Anmeldung (Kundenakte)</h3>
          <span class="sc-local-label">eigene Sitzung</span>
        </div>
        <p class="sc-section-intro">Mit denselben Zugangsdaten wie im CRM anmelden, damit ein eingehender Anruf im timio- und im Jira-Cockpit die Kundenakte zeigt (Name, Verträge, letztes Ticket). Ohne Anmeldung funktioniert die Extension wie bisher.</p>
        <label class="sc-input-label">Name
          <input class="sc-text-input" data-role="sb-login-name" value="${escapeHtml(auth.name)}" placeholder="wie im CRM-Login" autocomplete="username">
        </label>
        <label class="sc-input-label">PIN
          <input class="sc-text-input" type="password" inputmode="numeric" data-role="sb-login-pin" value="${escapeHtml(auth.pin)}" placeholder="4-stellig" autocomplete="current-password">
        </label>
        ${auth.error ? `<p class="sc-cockpit-mismatch">${escapeHtml(auth.error)}</p>` : ""}
        <div class="sc-inline-actions">
          <button class="sc-primary-button" type="button" data-action="supabase-login" ${auth.busy ? "disabled" : ""}>${auth.busy ? "Meldet an …" : "Anmelden"}</button>
        </div>
      </section>`;
  }

  function renderSettings() {
    const s = state.settings;
    return `
      ${renderSupabaseLoginSection()}
      <section class="sc-section">
        <div class="sc-section-title-row">
          <h3>Einstellungen</h3>
          <span class="sc-local-label">nur lokal</span>
        </div>
        <p class="sc-section-intro">Diese Angaben fließen in KI-Entwürfe ein, damit Kommentare und E-Mails ohne Platzhalter fertig sind. Sie bleiben ausschließlich in deinem Chrome-Profil.</p>
        <label class="sc-input-label">Dein Name
          <input class="sc-text-input" data-role="set-agent-name" value="${escapeHtml(s.agentName)}" placeholder="z. B. Max Muster">
        </label>
        <label class="sc-input-label">Unternehmen / Team
          <input class="sc-text-input" data-role="set-company" value="${escapeHtml(s.company)}" placeholder="z. B. ennit Support">
        </label>
        <label class="sc-input-label">E-Mail-Signatur
          <textarea class="sc-comment-draft sc-email-body" data-role="set-signature" placeholder="Freundliche Grüße&#10;Max Muster&#10;ennit Support">${escapeHtml(s.signature)}</textarea>
        </label>
        <label class="sc-check-label">
          <input type="checkbox" data-role="set-notify-waiting" ${s.notifyWaiting !== false ? "checked" : ""}>
          <span>Benachrichtigen, wenn jemand ins Wartefeld kommt<small>Lokale Desktop-Meldung, sobald aus einem leeren Wartefeld ein Anruf wartet – so musst du das Wartefeld nicht im Blick behalten. Die Wartefeld-Zahl steht ohnehin immer als Badge auf dem Symbolleisten-Icon.</small></span>
        </label>
        <label class="sc-check-label">
          <input type="checkbox" data-role="set-notify-callbacks" ${s.notifyCallbacks !== false ? "checked" : ""}>
          <span>Benachrichtigen, wenn ein Rückruf fällig wird<small>Lokale Desktop-Meldung je Eintrag genau einmal, sobald der vereinbarte Zeitpunkt erreicht ist.</small></span>
        </label>
        <label class="sc-check-label">
          <input type="checkbox" data-role="set-sync-summary" ${s.syncTicketSummaryToCrm !== false ? "checked" : ""}>
          <span>Ticket-Zusammenfassung in die Kundenakte schreiben<small>Jede fertige Zusammenfassung landet als Notiz in der Kundenakte des CRM – eine je Ticket, beim erneuten Zusammenfassen aktualisiert, mit dem Vermerk, ob das Ticket offen oder geschlossen ist. Nur bei erkannter Kundennummer und bestehender CRM-Anmeldung.</small></span>
        </label>
        <label class="sc-input-label">Jira-Suche nach Kundennummer (JQL)
          <input class="sc-text-input" data-role="set-customer-jql" value="${escapeHtml(s.customerSearchJql || "")}" placeholder='${escapeHtml((CONFIG.jira && CONFIG.jira.customerSearchJql) || "")}'>
          <small class="sc-input-hint">Für den Sprung von der Kundennummer zum Ticket. <code>{q}</code> wird durch die Kundennummer ersetzt. Leer lassen nutzt den voreingestellten Abgleich auf dem Oikonomikos-Feld; hier nur überschreiben, falls sich der Feldname mal ändert.</small>
        </label>
        <label class="sc-input-label">Supabase-Projekt-URL (Kundenakte)
          <input class="sc-text-input" data-role="set-supabase-url" value="${escapeHtml(s.supabaseUrl || "")}" placeholder="${escapeHtml((CONFIG.supabase && CONFIG.supabase.url) || "")}">
        </label>
        <label class="sc-input-label">Supabase Anon Key (Kundenakte)
          <input class="sc-text-input" data-role="set-supabase-anon-key" value="${escapeHtml(s.supabaseAnonKey || "")}" placeholder="${escapeHtml((CONFIG.supabase && CONFIG.supabase.anonKey) || "")}">
          <small class="sc-input-hint">Nur nötig, falls ein anderes Supabase-Projekt als das voreingestellte genutzt wird – dieselben Werte wie im CRM-Setup-Screen.</small>
        </label>
        <div class="sc-inline-actions">
          <button class="sc-secondary-button" type="button" data-action="close-settings">Zurück</button>
          <button class="sc-primary-button" type="button" data-action="save-settings">Speichern</button>
        </div>
      </section>
      <section class="sc-section">
        <div class="sc-section-title-row">
          <h3>Netz-Auskunft (aktive Abfragen)</h3>
          <span class="sc-local-label sc-local-label--warn">kritisch</span>
        </div>
        <p class="sc-section-intro">Anders als der Rest der Extension liest die Netz-Auskunft nicht nur die sichtbare Seite, sondern <strong>öffnet und automatisiert interne Dashboards</strong> (Baustatus/FTTX, Kündiger/GFIZ), um Daten zu einer Kundennummer zu holen. Standardmäßig aus. Ist sie an, wird vor jeder einzelnen Abfrage zusätzlich im Panel bestätigt. Bitte nur mit entsprechender Freigabe nutzen.</p>
        <label class="sc-check-label">
          <input type="checkbox" data-role="set-enable-lookups" ${s.enableLookups === true ? "checked" : ""}>
          <span>Baustatus- und Kündiger-Abfrage erlauben<small>Schaltet die Buttons „Baustatus nachschlagen" / „Kündiger-Status prüfen" in der Übersicht frei. Jede Abfrage öffnet den passenden Dashboard-Tab und automatisiert ihn.</small></span>
        </label>
        <label class="sc-check-label">
          <input type="checkbox" data-role="set-enable-bridge" ${s.enableBridge === true ? "checked" : ""}>
          <span>WebSocket-Bridge für externe Abfragen erlauben<small>Lässt ein externes Frontend (server/baustatus_bridge.py, nur 127.0.0.1) Abfragen über diese Extension auslösen. Benötigt zusätzlich die Freigabe oben. Solange aktiv, zeigt das Panel ein „Bridge aktiv"-Banner.</small></span>
        </label>
        <label class="sc-input-label">Bridge-Token
          <input class="sc-text-input" data-role="set-bridge-token" value="${escapeHtml(s.bridgeToken || "")}" placeholder="dasselbe wie BRIDGE_TOKEN des Servers">
          <small class="sc-input-hint">Muss mit dem <code>BRIDGE_TOKEN</code> übereinstimmen, mit dem der lokale Server gestartet wurde. Ohne passendes Token wird die Verbindung abgelehnt.</small>
        </label>
      </section>
      <section class="sc-section">
        <div class="sc-section-title-row">
          <h3>Daten &amp; Datenschutz</h3>
          <span class="sc-local-label">nur lokal</span>
        </div>
        <p class="sc-section-intro">Alle Daten dieser Extension (Einstellungen, E-Mail-Vorlagen, KI-Ergebnisse pro Ticket, Anruf- und Wartefeld-Status) liegen ausschließlich lokal in deinem Chrome-Profil. Es gibt keinen Server und keine Übertragung. Hier kannst du alles vollständig löschen.</p>
        <button class="sc-secondary-button sc-danger-button" type="button" data-action="wipe-data">Alle lokal gespeicherten Daten löschen</button>
      </section>`;
  }

  // Recht auf Löschung, lokal umgesetzt: entfernt sämtliche Storage-Schlüssel
  // der Extension und setzt den Arbeitsspeicher-Zustand auf Werkseinstellung.
  function wipeAllData() {
    if (!window.confirm("Wirklich alle lokal gespeicherten Daten von Stadtnetz CRM Copilot löschen? (Einstellungen, Vorlagen, KI-Ergebnisse, Anruf-Status)")) return;
    safeLocalRemove(Object.values(CONFIG.storageKeys));
    lastTicketContextSignature = null;
    aiCache.init(null);
    state.settings = { ...CONFIG.settingsDefaults };
    state.emailTemplates = CONFIG.emailTemplates.map((template) => ({ ...template }));
    state.tone = AI.defaultTone;
    state.activeCall = null;
    state.queueStats = null;
    state.callOverlay = { mode: "full", pos: null, dismissedForCallId: null };
    state.callMode = "inbound";
    state.callbacks = [];
    state.supabaseSession = null;
    state.supabaseAuth = { name: "", pin: "", busy: false, error: "" };
    state.customerCard = null;
    state.lookup = { result: null, confirm: null };
    state.bridgeState = null;
    state.closeout = null;
    state.sharedSettings = { status: "idle", data: null, error: "" };
    state.crmNote = { status: "idle", error: "", signature: "", customerNumber: "", resolution: "", created: false };
    if (state.ticket) hydrateAiFromCache(state.ticket);
    render();
    toast("Alle lokalen Daten wurden gelöscht.");
  }

  function activeContent() {
    switch (state.activeTab) {
      case "reply": return renderReply();
      case "call": return renderCall();
      default: return renderOverview();
    }
  }

  function rootMarkup() {
    // Der Call-Tab heißt im Outbound-Modus anders – so ist die eingestellte
    // Richtung auch dann sichtbar, wenn der Schalter gerade nicht im Blick ist.
    const tabs = CONFIG.tabs.map((tab) => {
      const label = tab.id === "call" && outboundMode() ? "Outbound" : tab.label;
      return `
      <button class="sc-tab ${state.activeTab === tab.id ? "is-active" : ""}" type="button" role="tab" aria-selected="${state.activeTab === tab.id}" data-action="switch-tab" data-tab="${tab.id}">${escapeHtml(label)}</button>`;
    }).join("");
    return `
      ${renderCallCockpit()}
      <button class="sc-launcher ${state.isOpen ? "is-hidden" : ""}" type="button" data-action="open-panel" aria-label="Stadtnetz CRM Copilot öffnen">
        <span>AI</span><span>Copilot</span>
      </button>
      <aside class="sc-panel ${state.isOpen ? "is-open" : ""}" aria-label="Stadtnetz CRM Copilot">
        <header class="sc-panel-header">
          <div>
            <span class="sc-eyebrow">Stadtnetz CRM Copilot · lokale KI</span>
            <strong>Smart dokumentieren.</strong>
          </div>
          <div class="sc-header-actions">
            <button class="sc-icon-button ${state.settingsOpen ? "is-active" : ""}" type="button" data-action="toggle-settings" title="Einstellungen" aria-label="Einstellungen">⚙</button>
            <button class="sc-icon-button" type="button" data-action="refresh" title="Ticketdaten aktualisieren" aria-label="Ticketdaten aktualisieren">↻</button>
            <button class="sc-icon-button" type="button" data-action="close-panel" title="Panel minimieren" aria-label="Panel minimieren">×</button>
          </div>
        </header>
        ${renderModeSwitch()}
        ${renderBridgeBanner()}
        ${renderActiveCallBanner()}
        ${state.settingsOpen ? "" : `<nav class="sc-tabs" role="tablist" aria-label="Bereiche">${tabs}</nav>`}
        <main class="sc-panel-content">${state.settingsOpen ? renderSettings() : activeContent()}</main>
        <footer class="sc-panel-footer">Verarbeitet Ticketdaten ausschließlich lokal – On-Device-KI, kein Cloud-Dienst.</footer>
        <div class="sc-toast" role="status" aria-live="polite"></div>
      </aside>`;
  }

  // ---------------------------------------------------------------------------
  // Ticket-Zusammenfassung in die Kundenakte
  //
  // Eine Zusammenfassung, die nur im Panel steht, ist nach dem Schließen des
  // Tabs weg. Sie gehört dorthin, wo später jemand ohne Jira-Zugang nachsieht:
  // in die Kundenakte des CRM — zusammen mit der Angabe, ob das Ticket noch
  // offen oder schon geschlossen ist. Geschrieben wird eine einzige Notiz je
  // Ticket; beim erneuten Zusammenfassen aktualisiert
  // supabase.upsertTicketSummaryNote() dieselbe Zeile.
  //
  // Drei Voraussetzungen, die bewusst nicht umgangen werden: eine Kundennummer
  // aus dem Oikonomikos-Feld (ohne sie hätte die Notiz keine Akte), eine
  // CRM-Anmeldung und der Schalter in den Einstellungen. Fehlt eine davon,
  // bleibt es bei der Anzeige im Panel – die Zusammenfassung selbst
  // funktioniert unverändert.
  // ---------------------------------------------------------------------------

  function summaryCrmPayload() {
    const t = state.ticket;
    const summaryText = state.ai.summary.status === "ok" ? (state.ai.summary.text || "").trim() : "";
    if (!t || !known(t.key) || !summaryText) return null;
    // Kundennummer ausschließlich aus dem Ticket: die zuletzt geladene
    // Kundenakte im Speicher kann von einem parallelen Anruf stammen und würde
    // die Notiz sonst in die falsche Akte schreiben. Deren Name wird nur
    // übernommen, wenn beide Kundennummern übereinstimmen.
    const customerNumber = known(t.customerReference) ? t.customerReference : "";
    const card = state.customerCard && state.customerCard.status === "ok" ? state.customerCard.data : null;
    const cardMatches = Boolean(card && card.customerNumber && card.customerNumber === customerNumber);
    return {
      ticketKey: t.key,
      ticketTitle: known(t.summary) ? t.summary : "",
      customerNumber,
      customerName: (known(t.customerName) ? t.customerName : "") || (cardMatches ? card.name : "") || "",
      resolution: ticketResolution(known(t.status) ? t.status : ""),
      summary: summaryText
    };
  }

  // Fingerabdruck des Stands, der in der Akte landen würde. Ändert er sich
  // nicht, wird auch nicht erneut geschrieben.
  function crmNoteSignature(payload) {
    return JSON.stringify([payload.ticketKey, payload.customerNumber, payload.resolution.id, payload.summary]);
  }

  function crmNoteErrorText(res) {
    if (res.reason === "not-logged-in") return "Nicht am CRM angemeldet (Einstellungen ⚙).";
    if (res.reason === "not-configured") return "Keine CRM-Verbindung hinterlegt (Einstellungen ⚙).";
    if (res.reason === "network") return "CRM gerade nicht erreichbar.";
    return res.error || "Speichern in der Kundenakte fehlgeschlagen.";
  }

  async function syncSummaryToCrm(opts) {
    const manual = Boolean(opts && opts.manual);
    if (!supabaseClient) {
      if (manual) toast("Kundenakte nicht verfügbar – keine CRM-Verbindung konfiguriert.");
      return;
    }
    if (!manual && state.settings.syncTicketSummaryToCrm === false) return;

    const payload = summaryCrmPayload();
    if (!payload) {
      if (manual) toast("Erst eine Zusammenfassung erstellen.");
      return;
    }
    if (!payload.customerNumber) {
      state.crmNote = { status: "no-customer", error: "", signature: "", customerNumber: "", resolution: payload.resolution.id, created: false };
      if (manual) toast("Keine Kundennummer im Ticket – die Notiz hätte keine Akte.");
      render();
      return;
    }

    const signature = crmNoteSignature(payload);
    // Automatisch nur einmal je Stand: nicht doppelt schreiben und nach einem
    // Fehler nicht in einer Schleife erneut versuchen (dafür gibt es den
    // Button). Ein manueller Klick darf dagegen jederzeit erneut schreiben.
    if (!manual && state.crmNote.signature === signature && state.crmNote.status !== "idle") return;
    if (state.crmNote.status === "saving" && state.crmNote.signature === signature) return;

    state.crmNote = { status: "saving", error: "", signature, customerNumber: payload.customerNumber, resolution: payload.resolution.id, created: false };
    render();

    const res = await supabaseClient.upsertTicketSummaryNote(payload);
    // Zwischenzeitlich anderes Ticket oder neue Zusammenfassung: das Ergebnis
    // gehört dann nicht mehr zum aktuell angezeigten Stand.
    if (state.crmNote.signature !== signature) return;

    if (res.ok) {
      state.crmNote = { status: "ok", error: "", signature, customerNumber: payload.customerNumber, resolution: payload.resolution.id, created: Boolean(res.created) };
      if (manual) toast(res.created ? "In der Kundenakte gespeichert." : "Kundenakte aktualisiert.");
    } else {
      state.crmNote = { status: "error", error: crmNoteErrorText(res), signature, customerNumber: payload.customerNumber, resolution: payload.resolution.id, created: false };
    }
    render();
  }

  const CRM_RESOLUTION_LABEL = {
    offen: "Ticket offen",
    geschlossen: "Ticket geschlossen",
    unbekannt: "Ticketstand unbekannt"
  };

  function renderSummaryCrmStatus() {
    if (!supabaseClient) return "";
    const n = state.crmNote;
    const button = (label) => `<button class="sc-text-button" type="button" data-action="save-summary-to-crm">${label}</button>`;

    if (n.status === "saving") return `<p class="sc-cockpit-hint">Kundenakte wird aktualisiert …</p>`;
    if (n.status === "ok") {
      const stand = CRM_RESOLUTION_LABEL[n.resolution] || CRM_RESOLUTION_LABEL.unbekannt;
      return `<p class="sc-cockpit-hint">✓ Kundenakte ${escapeHtml(n.customerNumber)} ${n.created ? "ergänzt" : "aktualisiert"} · ${escapeHtml(stand)}. ${button("Erneut schreiben")}</p>`;
    }
    if (n.status === "no-customer") {
      return `<p class="sc-cockpit-hint">Keine Kundennummer im Ticket – nichts in der Kundenakte gespeichert.</p>`;
    }
    if (n.status === "error") {
      return `<p class="sc-cockpit-hint">Kundenakte: ${escapeHtml(n.error)} ${button("Erneut versuchen")}</p>`;
    }
    return `<p class="sc-cockpit-hint">${button("In die Kundenakte schreiben")}</p>`;
  }

  // ---------------------------------------------------------------------------
  // Befehlspalette (Stufe 4, KONZEPT-INTEGRATION.md) — ⌘K/Ctrl+K, eigener
  // DOM-Root unabhängig vom Panel (jederzeit auslösbar). Eigenständige, aber
  // verhaltensgleiche Umsetzung zum Gegenstück in timio-content.js — geteilt
  // wird nur supabase.searchWorkspace(). Ein Treffer öffnet die passende
  // Kundenakte im CRM über den Deep-Link aus src/router.tsx (CRM-Repo).
  // ---------------------------------------------------------------------------

  const PALETTE_ID = "sc-jira-palette";
  const PALETTE_MIN_QUERY_LENGTH = 2;
  const PALETTE_DEBOUNCE_MS = 250;
  let paletteSearchTimer = null;
  let paletteKeydownBound = false;

  function paletteRoot() {
    return document.getElementById(PALETTE_ID);
  }

  function paletteFlatItems() {
    const groups = (state.palette && state.palette.groups) || [];
    const flat = [];
    groups.forEach((g) => (g.items || []).forEach((item) => flat.push(item)));
    return flat;
  }

  function openCrmDeepLink(customerNumber) {
    if (!customerNumber) return;
    const base = ((CONFIG.crm && CONFIG.crm.baseUrl) || "").replace(/\/+$/, "");
    window.open(`${base}/?kdnr=${encodeURIComponent(customerNumber)}`, "_blank");
    closePalette();
  }

  function openPalette() {
    state.palette = { open: true, query: "", groups: [], status: "idle", error: "", activeIdx: 0 };
    renderPalette();
  }

  function closePalette() {
    if (paletteSearchTimer) { window.clearTimeout(paletteSearchTimer); paletteSearchTimer = null; }
    state.palette = null;
    renderPalette();
  }

  // Debounced, damit nicht jeder Tastendruck die vier parallelen Requests von
  // searchWorkspace() auslöst. Veraltete Antworten (Nutzer tippt weiter,
  // während die Antwort unterwegs ist) werden verworfen.
  function schedulePaletteSearch() {
    if (paletteSearchTimer) { window.clearTimeout(paletteSearchTimer); paletteSearchTimer = null; }
    const query = state.palette.query.trim();
    if (query.length < PALETTE_MIN_QUERY_LENGTH) {
      state.palette.status = "idle";
      state.palette.groups = [];
      updatePaletteResults();
      return;
    }
    state.palette.status = "loading";
    updatePaletteResults();
    paletteSearchTimer = window.setTimeout(async () => {
      if (!state.palette || !supabaseClient) return;
      const activeQuery = state.palette.query.trim();
      const res = await supabaseClient.searchWorkspace(activeQuery);
      if (!state.palette || state.palette.query.trim() !== activeQuery) return; // veraltete Antwort
      if (res.ok) {
        state.palette.status = "ok";
        state.palette.groups = res.groups;
      } else {
        state.palette.status = res.reason === "not-logged-in" ? "not-logged-in" : "error";
        state.palette.error = res.error || "";
      }
      state.palette.activeIdx = 0;
      updatePaletteResults();
    }, PALETTE_DEBOUNCE_MS);
  }

  function paletteResultsMarkup() {
    if (!state.palette) return "";
    const q = state.palette.query.trim();
    if (q.length < PALETTE_MIN_QUERY_LENGTH) return `<p class="sc-palette-hint">Mindestens ${PALETTE_MIN_QUERY_LENGTH} Zeichen eingeben …</p>`;
    if (state.palette.status === "loading") return `<p class="sc-palette-hint">Suche …</p>`;
    if (state.palette.status === "not-logged-in") return `<p class="sc-palette-hint">Nicht bei Stadtnetz CRM angemeldet.</p>`;
    if (state.palette.status === "error") return `<p class="sc-palette-hint">Suche gerade nicht möglich${state.palette.error ? ": " + escapeHtml(state.palette.error) : "."}</p>`;
    const groups = state.palette.groups || [];
    if (!groups.length) return `<p class="sc-palette-hint">Keine Treffer für „${escapeHtml(q)}".</p>`;

    let idx = -1;
    return groups.map((g) => `
      <div class="sc-palette-group">${escapeHtml(g.group)}</div>
      ${(g.items || []).map((item) => {
        idx += 1;
        const active = idx === state.palette.activeIdx;
        return `
          <button type="button" class="sc-palette-item ${active ? "is-active" : ""}" data-palette-item data-customer="${escapeHtml(item.customerNumber || "")}">
            <span class="sc-palette-item-label">${escapeHtml(item.label || "")}</span>
            <span class="sc-palette-item-sub">${escapeHtml(item.sub || "")}</span>
          </button>`;
      }).join("")}
    `).join("");
  }

  function paletteMarkup() {
    return `
      <div class="sc-palette-backdrop" data-action="palette-backdrop">
        <div class="sc-palette" role="dialog" aria-modal="true" aria-label="Schnellsuche">
          <div class="sc-palette-input-row">
            <input type="text" data-role="palette-query" placeholder="Kunden, Verträge, Tarifwechsel, Notizen suchen …" value="${escapeHtml(state.palette.query)}" autocomplete="off">
            <button type="button" class="sc-palette-close" data-action="palette-close" aria-label="Schließen">×</button>
          </div>
          <div data-tid="palette-results">${paletteResultsMarkup()}</div>
        </div>
      </div>`;
  }

  // Nur die Ergebnisliste patchen, nicht die ganze Palette neu bauen — sonst
  // verlöre das fokussierte Eingabefeld bei jedem Suchergebnis den Cursor.
  function updatePaletteResults() {
    const rootEl = paletteRoot();
    if (!rootEl) return;
    const resultsEl = rootEl.querySelector("[data-tid='palette-results']");
    if (resultsEl) resultsEl.innerHTML = paletteResultsMarkup();
  }

  function renderPalette() {
    let rootEl = paletteRoot();
    if (!state.palette || !state.palette.open) {
      if (rootEl) rootEl.remove();
      return;
    }
    if (!rootEl) {
      rootEl = document.createElement("div");
      rootEl.id = PALETTE_ID;
      document.body.appendChild(rootEl);
      rootEl.addEventListener("click", onPaletteClick);
      rootEl.addEventListener("input", onPaletteInput);
    }
    rootEl.innerHTML = paletteMarkup();
    const inputEl = rootEl.querySelector("[data-role='palette-query']");
    if (inputEl && typeof inputEl.focus === "function") {
      inputEl.focus();
      if (typeof inputEl.setSelectionRange === "function") {
        const len = inputEl.value.length;
        inputEl.setSelectionRange(len, len);
      }
    }
  }

  function onPaletteClick(event) {
    const target = event.target;
    const item = target.closest && target.closest("[data-palette-item]");
    if (item) { openCrmDeepLink(item.dataset.customer); return; }
    const closeBtn = target.closest && target.closest("[data-action='palette-close']");
    if (closeBtn) { closePalette(); return; }
    const backdrop = target.closest && target.closest("[data-action='palette-backdrop']");
    if (backdrop && target === backdrop) { closePalette(); }
  }

  // Freitext direkt in den State, OHNE Re-Render — das Eingabefeld zeigt den
  // Tastendruck bereits nativ (gleiches Muster wie call-notes im Panel).
  function onPaletteInput(event) {
    if (!state.palette) return;
    const role = event.target && event.target.dataset && event.target.dataset.role;
    if (role !== "palette-query") return;
    state.palette.query = event.target.value;
    state.palette.activeIdx = 0;
    schedulePaletteSearch();
  }

  function onGlobalKeydown(event) {
    // Nach einem Extension-Reload arbeitet die alte Instanz auf einem toten
    // Chrome-Kontext — dann die Palette gar nicht erst öffnen (der Listener
    // lässt sich ohne eigenen Shutdown-Pfad in ui.js nicht sauber abmelden).
    if (!extensionAlive()) return;
    const isToggleCombo = (event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === "k";
    if (isToggleCombo) {
      event.preventDefault();
      if (state.palette && state.palette.open) closePalette(); else openPalette();
      return;
    }
    if (!state.palette || !state.palette.open) return;
    if (event.key === "Escape") { event.preventDefault(); closePalette(); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const total = paletteFlatItems().length;
      if (!total) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      state.palette.activeIdx = (state.palette.activeIdx + delta + total) % total;
      updatePaletteResults();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = paletteFlatItems()[state.palette.activeIdx];
      if (item) openCrmDeepLink(item.customerNumber);
    }
  }

  // Einmalig registrieren: mount() kann bei Ticketwechseln mehrfach laufen
  // (content.js entfernt und mountet das Panel neu), der dokumentweite
  // Listener soll sich dabei nicht stapeln.
  function bindPaletteHotkey() {
    if (paletteKeydownBound) return;
    paletteKeydownBound = true;
    document.addEventListener("keydown", onGlobalKeydown);
  }

  // Baut das Panel komplett neu auf. Damit ein Re-Render (z. B. durch das
  // automatische Aufräumen im Hintergrund) niemals eine laufende Eingabe
  // unterbricht, werden Fokus und Cursor-Position des gerade aktiven
  // Eingabefelds über den Neuaufbau hinweg erhalten.
  function render() {
    const container = root();
    if (!container) return;

    const active = document.activeElement;
    let focusRole = null;
    let selection = null;
    if (active && container.contains(active) && active.dataset && active.dataset.role) {
      focusRole = active.dataset.role;
      if (typeof active.selectionStart === "number") {
        selection = { start: active.selectionStart, end: active.selectionEnd };
      }
    }

    container.innerHTML = rootMarkup();

    if (focusRole) {
      const next = container.querySelector(`[data-role='${focusRole}']`);
      if (next) {
        next.focus({ preventScroll: true });
        if (selection && typeof next.setSelectionRange === "function") {
          next.setSelectionRange(selection.start, selection.end);
        }
      }
    }
  }

  function toast(message) {
    const element = document.querySelector(`#${CONFIG.rootId} .sc-toast`);
    if (!element) return;
    element.textContent = message;
    element.classList.add("is-visible");
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => element.classList.remove("is-visible"), 2600);
  }

  async function copyText(value, successMessage) {
    const text = (value || "").trim();
    if (!text) {
      toast("Es gibt noch keinen Text zum Kopieren.");
      return false;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      const fallback = document.createElement("textarea");
      fallback.value = text;
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.appendChild(fallback);
      fallback.select();
      document.execCommand("copy");
      fallback.remove();
    }
    toast(successMessage || "In die Zwischenablage kopiert.");
    return true;
  }

  // Liest editierbare Felder aus dem DOM in den State, bevor neu gerendert wird.
  function syncInputsFromDom() {
    const container = root();
    if (!container) return;
    const value = (role) => {
      const node = container.querySelector(`[data-role='${role}']`);
      return node ? node.value : undefined;
    };
    const note = value("note"); if (note !== undefined) state.ai.note = note;
    const draft = value("draft"); if (draft !== undefined) state.ai.draft = draft;
    const subject = value("draft-subject"); if (subject !== undefined) state.ai.emailSubject = subject;
    const callNotes = value("call-notes"); if (callNotes !== undefined) state.ai.callNotes = callNotes;
    const handoffDepartment = value("handoff-department"); if (handoffDepartment !== undefined) state.ai.handoff.department = handoffDepartment;
    const handoffNote = value("handoff-note"); if (handoffNote !== undefined) state.ai.handoff.note = handoffNote;
    const handoffComment = value("handoff-comment"); if (handoffComment !== undefined) state.ai.handoff.comment.text = handoffComment;
    const handoffEmailSubject = value("handoff-email-subject"); if (handoffEmailSubject !== undefined) state.ai.handoff.email.subject = handoffEmailSubject;
    const handoffEmailBody = value("handoff-email-body"); if (handoffEmailBody !== undefined) state.ai.handoff.email.body = handoffEmailBody;
  }

  // ---------------------------------------------------------------------------
  // KI-Aktionen
  // ---------------------------------------------------------------------------

  function ensureAi() {
    if (!localAi) {
      state.ai.caps = { usable: false, status: S.UNSUPPORTED };
      return false;
    }
    return true;
  }

  async function loadCapabilities() {
    if (!ensureAi()) { render(); return; }
    try {
      state.ai.caps = await localAi.capabilities();
    } catch (error) {
      state.ai.caps = { usable: false, status: S.UNAVAILABLE };
    }
    render();
    maybeAutoRun();
  }

  // Ein Ergebnis gilt für den Auto-Lauf als erledigt, wenn es entweder
  // aktuell ist, oder wenn es zuletzt fehlgeschlagen ist (kein automatischer
  // Retry-Loop – Fehlversuche bleiben manuell erneut anstoßbar).
  function autoRunSatisfied(field) {
    return field.status === "error" || (field.status === "ok" && !isStale(field));
  }

  const AUTO_RUN_TASKS = [
    { isDone: () => autoRunSatisfied(state.ai.triage), run: runTriage },
    { isDone: () => autoRunSatisfied(state.ai.summary), run: generateSummary },
    // Nur im Outbound-Modus: dort wählt timio selbst, die Vorbereitung muss
    // also fertig sein, bevor das Gespräch beginnt. Eingehend wäre sie
    // sinnlose Modell-Last.
    { isDone: () => !outboundMode() || autoRunSatisfied(state.ai.callPrep), run: generateCallPrep },
    { isDone: () => autoRunSatisfied(state.ai.documentation), run: generateDocumentation }
  ];

  // Arbeitet Einordnung, Zusammenfassung und Doku nacheinander im Hintergrund
  // ab, aber nur wenn das Modell bereits vorhanden ist (kein ungefragter
  // Download) und aktuell nichts anderes läuft. Jeder Aufruf startet höchstens
  // die nächste offene Aufgabe; die Erfolgspfade rufen maybeAutoRun() erneut
  // auf, wodurch sich die Kette selbst fortsetzt.
  function maybeAutoRun() {
    if (!aiUsable()) return;
    if (state.ai.caps.status !== S.AVAILABLE) return;
    if (anyBusy()) return;
    const next = AUTO_RUN_TASKS.find((task) => !task.isDone());
    if (next) next.run();
  }

  async function enableAi() {
    if (!ensureAi()) return;
    const signal = beginRun("enable");
    render();
    try {
      // Ein leichter Lauf stößt den Modell-Download an und zeigt Fortschritt.
      const result = await localAi.triage(state.ticket, { signal, onDownload });
      if (result && result.status === S.OK) cacheField("triage", { status: "ok", data: result.data });
      state.ai.caps = await localAi.capabilities();
    } catch (error) {
      if (!isAbort(error)) state.ai.caps = await safeCaps();
    } finally {
      endRun(signal);
      render();
      maybeAutoRun();
    }
  }

  async function safeCaps() {
    try { return await localAi.capabilities(); } catch (error) { return { usable: false, status: S.UNAVAILABLE }; }
  }

  // Cached die aktuelle Feld-Instanz mit Fingerprint des jetzigen Tickets ab
  // und schreibt sie in den persistenten Cache.
  function cacheField(fieldName, value) {
    const cached = { ...value, fingerprint: aiCache.fingerprint(state.ticket), generatedAt: Date.now() };
    state.ai[fieldName] = cached;
    aiCache.saveField(state.ticket.key, fieldName, cached);
    // Neue Zusammenfassung auch dem timio-Cockpit bereitstellen.
    publishTicketContext();
  }

  async function runTriage() {
    if (!aiUsable()) return;
    const previous = state.ai.triage;
    const signal = beginRun("triage");
    render();
    try {
      const result = await localAi.triage(state.ticket, { signal, onDownload });
      if (result.status === "ok") cacheField("triage", { status: "ok", data: result.data });
      else state.ai.triage = { status: result.status === S.OK ? "ok" : "error", data: result.data || null };
    } catch (error) {
      state.ai.triage = isAbort(error) ? previous : { status: "error", data: null };
    } finally {
      endRun(signal);
      render();
      maybeAutoRun();
    }
  }

  async function generateSummary() {
    if (!aiUsable()) return;
    const previous = state.ai.summary;
    const signal = beginRun("summary");
    state.ai.summary = { status: "loading", text: "" };
    render();
    try {
      const result = await localAi.summarize(state.ticket, {
        signal,
        onDownload,
        onChunk: (acc) => { const out = el("summary-out"); if (out) out.textContent = acc; }
      });
      if (result.status === S.AVAILABLE) {
        cacheField("summary", { status: "ok", text: result.text });
        // Frisch zusammengefasst heißt: der Stand in der Kundenakte ist alt.
        // Bewusst nicht abgewartet – die Zusammenfassung steht ja schon da;
        // ein Fehler beim Schreiben zeigt sich an der Karte, nicht als
        // unbehandelte Rejection.
        syncSummaryToCrm().catch(() => {});
      } else {
        state.ai.summary = { status: "error", text: "" };
      }
    } catch (error) {
      state.ai.summary = isAbort(error) ? previous : { status: "error", text: "" };
    } finally {
      endRun(signal);
      render();
      maybeAutoRun();
    }
  }

  async function generateAdvice() {
    if (!aiUsable()) return;
    const previous = state.ai.advice;
    const signal = beginRun("advice");
    state.ai.advice = { status: "loading", text: "" };
    render();
    try {
      const result = await localAi.advise(state.ticket, {
        signal,
        onDownload,
        onChunk: (acc) => { const out = el("advice-out"); if (out) out.textContent = acc; }
      });
      if (result.status === S.OK) cacheField("advice", { status: "ok", text: result.text });
      else state.ai.advice = { status: "error", text: "" };
    } catch (error) {
      state.ai.advice = isAbort(error) ? previous : { status: "error", text: "" };
    } finally {
      endRun(signal);
      render();
    }
  }

  async function generateDocumentation() {
    if (!aiUsable()) return;
    const previous = state.ai.documentation;
    const previousDoc = previous.status === "ok" ? previous.text : "";
    const signal = beginRun("documentation");
    state.ai.documentation = { status: "loading", text: "" };
    render();
    try {
      const result = await localAi.documentTicket(state.ticket, {
        signal,
        onDownload,
        previousDoc,
        onChunk: (acc) => { const out = el("documentation-out"); if (out) out.textContent = acc; }
      });
      if (result.status === S.OK) cacheField("documentation", { status: "ok", text: result.text });
      else state.ai.documentation = { status: "error", text: "" };
    } catch (error) {
      state.ai.documentation = isAbort(error) ? previous : { status: "error", text: "" };
    } finally {
      endRun(signal);
      render();
      maybeAutoRun();
    }
  }

  function useDocumentationAsComment() {
    if (!state.ai.documentation.text) return;
    state.ai.draftKind = "comment";
    state.ai.draft = state.ai.documentation.text;
    state.activeTab = "reply";
    persistUiState();
    render();
    toast("In den Antwort-Tab übernommen.");
  }

  // Erstellt in einem Zug den internen ToDo-Kommentar für die Fachabteilung
  // und die Kunden-Info-Mail. Läuft als ein zusammenhängender KI-Lauf, damit
  // beide Teile unter demselben Busy-Status/Abbruch-Signal entstehen.
  async function generateHandoff() {
    if (!aiUsable()) return;
    syncInputsFromDom();
    const department = state.ai.handoff.department.trim();
    if (!department) { toast("Bitte zuerst eine Fachabteilung angeben."); return; }

    const previousComment = state.ai.handoff.comment;
    const previousEmail = state.ai.handoff.email;
    const signal = beginRun("handoff");
    state.ai.handoff.comment = { status: "loading", text: "" };
    state.ai.handoff.email = { status: "loading", subject: "", body: "" };
    render();

    try {
      const commentResult = await localAi.draftHandoffComment(
        { ticket: state.ticket, department, note: state.ai.handoff.note, agent: agentForAi() },
        { signal, onDownload, onChunk: (acc) => { const out = el("handoff-comment"); if (out) out.value = acc; } }
      );
      state.ai.handoff.comment = commentResult.status === S.OK
        ? { status: "ok", text: commentResult.text }
        : { status: "error", text: "" };
      render();

      const emailResult = await localAi.draftHandoffEmail(
        { ticket: state.ticket, department, note: state.ai.handoff.note, agent: agentForAi(), language: state.ai.replyLanguage },
        {
          signal, onDownload,
          onChunk: (acc) => {
            const parsed = { subject: "", body: acc };
            const match = acc.match(/^\s*Betreff:\s*(.*)$/im);
            const out = el("handoff-email-body");
            const subj = el("handoff-email-subject");
            if (match) {
              parsed.subject = match[1].trim();
              parsed.body = acc.slice(match.index + match[0].length).replace(/^\s+/, "");
            }
            if (subj && parsed.subject) subj.value = parsed.subject;
            if (out) out.value = parsed.body;
          }
        }
      );
      state.ai.handoff.email = emailResult.status === S.OK
        ? { status: "ok", subject: emailResult.subject, body: emailResult.body || emailResult.raw || "" }
        : { status: "error", subject: "", body: "" };
    } catch (error) {
      if (isAbort(error)) {
        state.ai.handoff.comment = previousComment;
        state.ai.handoff.email = previousEmail;
      } else {
        if (state.ai.handoff.comment.status === "loading") state.ai.handoff.comment = { status: "error", text: "" };
        if (state.ai.handoff.email.status === "loading") state.ai.handoff.email = { status: "error", subject: "", body: "" };
      }
    } finally {
      endRun(signal);
      render();
    }
  }

  function useHandoffComment() {
    syncInputsFromDom();
    if (!state.ai.handoff.comment.text) return;
    state.ai.draftKind = "comment";
    state.ai.draft = state.ai.handoff.comment.text;
    render();
    toast("Als Kommentar-Entwurf übernommen.");
  }

  function useHandoffEmail() {
    syncInputsFromDom();
    const h = state.ai.handoff.email;
    if (!h.body && !h.subject) return;
    state.ai.draftKind = "email";
    state.ai.emailSubject = h.subject;
    state.ai.draft = h.body;
    render();
    toast("Als E-Mail-Entwurf übernommen.");
  }

  async function translateDescription() {
    if (!aiUsable()) return;
    const signal = beginRun("translate");
    state.ai.translation = { ...state.ai.translation, status: "loading", text: "" };
    render();
    try {
      const detection = await localAi.detectLanguage(state.ticket.description);
      const source = detection.language || "";
      state.ai.translation.language = source;
      const result = await localAi.translate(state.ticket.description, {
        target: "de",
        source: source && source !== "de" ? source : undefined,
        signal,
        onChunk: (acc) => { const out = el("translation-out"); if (out) out.textContent = acc; }
      });
      state.ai.translation = { status: result.status === S.OK ? "ok" : "error", text: result.text || "", language: source };
    } catch (error) {
      if (!isAbort(error)) state.ai.translation = { ...state.ai.translation, status: "error" };
    } finally {
      endRun(signal);
      render();
    }
  }

  async function draft(kind) {
    if (!aiUsable()) return;
    syncInputsFromDom();
    const name = kind === "email" ? "email" : "comment";
    const signal = beginRun(name);
    state.ai.draftKind = kind === "email" ? "email" : "comment";
    state.ai.draft = "";
    if (kind === "email") state.ai.emailSubject = "";
    state.ai.review = { status: "idle", checks: [], improved: "" };
    render();

    const onChunk = (acc) => { const out = el("draft"); if (out) out.value = acc; };
    try {
      if (kind === "email") {
        const result = await localAi.draftEmail({ ticket: state.ticket, note: state.ai.note, tone: state.tone, agent: agentForAi(), language: state.ai.replyLanguage }, {
          signal, onDownload,
          onChunk: (acc) => {
            const parsed = { subject: "", body: acc };
            const match = acc.match(/^\s*Betreff:\s*(.*)$/im);
            const out = el("draft");
            const subj = el("draft-subject");
            if (match) {
              parsed.subject = match[1].trim();
              parsed.body = acc.slice(match.index + match[0].length).replace(/^\s+/, "");
            }
            if (subj && parsed.subject) subj.value = parsed.subject;
            if (out) out.value = parsed.body;
          }
        });
        if (result.status === S.OK) {
          state.ai.emailSubject = result.subject || state.ai.emailSubject;
          state.ai.draft = result.body || result.raw || "";
        } else {
          state.ai.error = aiUnavailableMessage(result.status);
        }
      } else {
        const result = await localAi.draftComment({ ticket: state.ticket, note: state.ai.note, tone: state.tone, agent: agentForAi() }, { signal, onDownload, onChunk });
        if (result.status === S.OK) state.ai.draft = result.text;
        else state.ai.error = aiUnavailableMessage(result.status);
      }
    } catch (error) {
      if (!isAbort(error)) { state.ai.error = "Die lokale KI konnte den Entwurf nicht erstellen."; toast(state.ai.error); }
    } finally {
      endRun(signal);
      render();
    }
  }

  async function rewriteDraft() {
    if (!aiUsable()) return;
    syncInputsFromDom();
    if (!state.ai.draft.trim()) { toast("Bitte zuerst einen Entwurf erstellen oder eingeben."); return; }
    const signal = beginRun("rewrite");
    render();
    const onChunk = (acc) => { const out = el("draft"); if (out) out.value = acc; };
    try {
      const result = await localAi.rewrite(state.ai.draft, { tone: state.tone, signal, onDownload, onChunk });
      if (result.status === S.OK && result.text) state.ai.draft = result.text;
      else toast(aiUnavailableMessage(result.status));
    } catch (error) {
      if (!isAbort(error)) toast("Umschreiben nicht möglich.");
    } finally {
      endRun(signal);
      render();
    }
  }

  async function proofreadDraft() {
    if (!aiUsable()) return;
    syncInputsFromDom();
    if (!state.ai.draft.trim()) { toast("Bitte zuerst einen Entwurf erstellen oder eingeben."); return; }
    const signal = beginRun("proofread");
    render();
    const onChunk = (acc) => { const out = el("draft"); if (out) out.value = acc; };
    try {
      const result = await localAi.proofread(state.ai.draft, { signal, onDownload, onChunk });
      if (result.status === S.OK && result.text) { state.ai.draft = result.text; toast("Korrektur gelesen."); }
      else toast(aiUnavailableMessage(result.status));
    } catch (error) {
      if (!isAbort(error)) toast("Korrektur nicht möglich.");
    } finally {
      endRun(signal);
      render();
    }
  }

  async function reviewDraft() {
    syncInputsFromDom();
    const text = state.ai.draft.trim();
    if (!text) { toast("Bitte zuerst einen Entwurf erstellen oder eingeben."); return; }

    // Sofortiges, deterministisches Feedback als Fallback.
    if (!aiUsable()) {
      state.ai.review = { status: "fallback", checks: rules.commentQuality(text), improved: "" };
      render();
      return;
    }

    const signal = beginRun("review");
    render();
    try {
      const result = await localAi.reviewDraft(text, state.ticket, { signal, onDownload });
      if (result.status === S.OK) state.ai.review = { status: "ok", checks: result.checks, improved: result.improved };
      else state.ai.review = { status: "fallback", checks: rules.commentQuality(text), improved: "" };
    } catch (error) {
      if (!isAbort(error)) state.ai.review = { status: "fallback", checks: rules.commentQuality(text), improved: "" };
    } finally {
      endRun(signal);
      render();
    }
  }

  // Setzt den Aufräum-Lauf für die Gesprächsnotizen tatsächlich in Gang.
  // Geht davon aus, dass die Notiz bereits geprüft/nicht leer ist.
  async function runCallClean() {
    if (!aiUsable() || !state.ai.callNotes.trim()) return;
    const previous = state.ai.callDraft;
    const signal = beginRun("callclean");
    state.ai.callDraft = { status: "loading", text: "" };
    render();
    try {
      const result = await localAi.draftComment({ ticket: state.ticket, note: state.ai.callNotes, tone: state.tone, agent: agentForAi() }, {
        signal, onDownload,
        onChunk: (acc) => { const out = el("calldraft-out"); if (out) out.textContent = acc; }
      });
      state.ai.callDraft = result.status === S.OK ? { status: "ok", text: result.text } : { status: "error", text: "" };
    } catch (error) {
      state.ai.callDraft = isAbort(error) ? previous : { status: "error", text: "" };
    } finally {
      endRun(signal);
      render();
    }
  }

  // Gesprächsvorbereitung für ausgehende Anrufe. Wird im Outbound-Modus
  // automatisch mitgezogen, damit sie fertig ist, bevor timio wählt – nach dem
  // Verbinden bleibt dafür keine Zeit mehr.
  async function generateCallPrep() {
    if (!aiUsable()) return;
    const previous = state.ai.callPrep;
    const signal = beginRun("callprep");
    state.ai.callPrep = { status: "loading", data: null };
    render();
    try {
      const result = await localAi.prepareCall({ ticket: state.ticket, agent: agentForAi() }, { signal, onDownload });
      if (result.status === S.OK) cacheField("callPrep", { status: "ok", data: result.data });
      else state.ai.callPrep = { status: "error", data: null };
    } catch (error) {
      state.ai.callPrep = isAbort(error) ? previous : { status: "error", data: null };
    } finally {
      endRun(signal);
      render();
      maybeAutoRun();
    }
  }

  function callPrepAsText() {
    const d = state.ai.callPrep.data;
    if (!d) return "";
    const lines = [];
    if (d.ziel) lines.push(`Ziel: ${d.ziel}`);
    if (Array.isArray(d.punkte) && d.punkte.length) {
      lines.push("Ansprechen:", ...d.punkte.map((point) => `- ${point}`));
    }
    if (Array.isArray(d.fragen) && d.fragen.length) {
      lines.push("Fragen:", ...d.fragen.map((question) => `- ${question}`));
    }
    if (Array.isArray(d.einwaende) && d.einwaende.length) {
      lines.push("Mögliche Einwände:", ...d.einwaende.map((o) => `- ${o.einwand} → ${o.antwort}`));
    }
    return lines.join("\n");
  }

  // Manueller Button-Klick: meldet fehlenden Text explizit zurück.
  function cleanCallNotes() {
    syncInputsFromDom();
    window.clearTimeout(callAutoCleanTimer);
    if (!state.ai.callNotes.trim()) { toast("Bitte zuerst Stichworte eingeben."); return; }
    runCallClean();
  }

  // Wird bei jeder Eingabe in die Gesprächsnotiz aufgerufen. Setzt den Timer
  // bei jedem Tastendruck zurück, sodass der Aufräum-Lauf erst startet, wenn
  // wirklich eine Tipppause entsteht – tippen ist dadurch nie blockiert oder
  // unterbrochen (der Fokus im Textfeld bleibt über render() hinweg erhalten,
  // siehe render()). Läuft bereits ein Aufräum-Lauf, wenn eine neue Pause
  // beginnt, wird er durch beginRun() automatisch sauber abgelöst.
  function scheduleAutoCallClean() {
    window.clearTimeout(callAutoCleanTimer);
    callAutoCleanTimer = window.setTimeout(() => {
      if (state.ai.callNotes.trim().length < CALL_AUTO_CLEAN_MIN_CHARS) return;
      runCallClean();
    }, CALL_AUTO_CLEAN_DELAY_MS);
  }

  // ---------------------------------------------------------------------------
  // E-Mail-Vorlagen-Logik
  // ---------------------------------------------------------------------------

  function ticketValueForEmail(value) {
    return known(value) ? value : "[bitte ergänzen]";
  }

  function fillEmailPlaceholders(value) {
    const ticket = state.ticket;
    const placeholders = {
      "[Kundenname]": ticketValueForEmail(ticket.customerName),
      "[Kundennummer]": ticketValueForEmail(ticket.customerReference),
      "[Ticketnummer]": ticketValueForEmail(ticket.key),
      "[Tickettitel]": ticketValueForEmail(ticket.summary),
      "[Anliegen]": ticketValueForEmail(ticket.description),
      "[Bearbeiter]": ticketValueForEmail(ticket.assignee)
    };
    return Object.entries(placeholders).reduce(
      (result, [placeholder, replacement]) => result.split(placeholder).join(replacement),
      value || ""
    );
  }

  function copyEmailTemplate(templateId) {
    const template = state.emailTemplates.find((entry) => entry.id === templateId);
    if (!template) return;
    const subject = fillEmailPlaceholders(template.subject);
    const body = fillEmailPlaceholders(template.body);
    copyText(`Betreff: ${subject}\n\n${body}`, `E-Mail „${template.title}“ kopiert.`);
  }

  function readEmailEditorFromDom() {
    const container = root();
    const value = (role) => {
      const field = container && container.querySelector(`[data-role='${role}']`);
      return field ? field.value.trim() : "";
    };
    return { title: value("email-title"), subject: value("email-subject"), body: value("email-body") };
  }

  function saveEmailTemplate() {
    const values = readEmailEditorFromDom();
    if (!values.title || !values.subject || !values.body) {
      toast("Bitte Name, Betreff und E-Mail-Text ausfüllen.");
      return;
    }
    const existingId = state.emailEditor.templateId;
    const template = { id: existingId || `email-${Date.now()}-${Math.random().toString(16).slice(2)}`, ...values };
    state.emailTemplates = existingId
      ? state.emailTemplates.map((entry) => entry.id === existingId ? template : entry)
      : [...state.emailTemplates, template];
    state.emailEditor = { isOpen: false, templateId: null };
    persistEmailTemplates();
    render();
    toast("E-Mail-Vorlage lokal gespeichert.");
  }

  function deleteEmailTemplate(templateId) {
    const template = state.emailTemplates.find((entry) => entry.id === templateId);
    if (!template || !window.confirm(`E-Mail-Vorlage „${template.title}“ wirklich löschen?`)) return;
    state.emailTemplates = state.emailTemplates.filter((entry) => entry.id !== templateId);
    state.emailEditor = { isOpen: false, templateId: null };
    persistEmailTemplates();
    render();
    toast("E-Mail-Vorlage gelöscht.");
  }

  // ---------------------------------------------------------------------------
  // Klick-/Eingabe-Handling
  // ---------------------------------------------------------------------------

  function useIntent(intentId) {
    const intent = AI.intents.find((entry) => entry.id === intentId);
    if (!intent) return;
    syncInputsFromDom();
    const existing = state.ai.note.trim();
    state.ai.note = existing ? `${existing}\n${intent.seed}` : intent.seed;
    render();
    const note = el("note");
    if (note) { note.focus(); note.selectionStart = note.value.length; }
  }

  function copyDraft() {
    syncInputsFromDom();
    if (state.ai.draftKind === "email") {
      const subject = state.ai.emailSubject.trim();
      const body = state.ai.draft.trim();
      copyText(subject ? `Betreff: ${subject}\n\n${body}` : body, "E-Mail-Entwurf kopiert.");
    } else {
      copyText(state.ai.draft, "Kommentar kopiert.");
    }
  }

  function applyReview() {
    if (!state.ai.review.improved) return;
    state.ai.draft = state.ai.review.improved;
    state.ai.review = { status: "idle", checks: [], improved: "" };
    render();
    toast("Vorschlag übernommen.");
  }

  function useCallDraft() {
    if (!state.ai.callDraft.text) return;
    state.ai.draftKind = "comment";
    state.ai.draft = state.ai.callDraft.text;
    state.activeTab = "reply";
    persistUiState();
    render();
    toast("In den Antwort-Tab übernommen.");
  }

  function deescalate() {
    const d = escalationFlag();
    syncInputsFromDom();
    state.settingsOpen = false;
    state.activeTab = "reply";
    state.ai.draftKind = "email";
    const wish = d && d.kundenwunsch ? ` Anliegen des Kunden: ${d.kundenwunsch}.` : "";
    state.ai.note = `Deeskalierende Antwort: Verständnis und Bedauern für die Unannehmlichkeiten ausdrücken, das Anliegen ernst nehmen und einen klaren nächsten Schritt mit Zeitangabe nennen.${wish}`;
    persistUiState();
    render();
    draft("email");
  }

  async function handleSupabaseLogin() {
    const name = state.supabaseAuth.name.trim();
    const pin = state.supabaseAuth.pin.trim();
    if (!supabaseClient) {
      state.supabaseAuth.error = "Supabase-Modul nicht geladen – Extension neu laden.";
      render();
      return;
    }
    if (!name || !pin) {
      state.supabaseAuth.error = "Name und PIN eingeben.";
      render();
      return;
    }
    state.supabaseAuth.busy = true;
    state.supabaseAuth.error = "";
    render();

    const res = await supabaseClient.login(name, pin);
    if (res.ok) {
      state.supabaseSession = res.session;
      state.supabaseAuth = { name: "", pin: "", busy: false, error: "" };
      toast(`Angemeldet als ${res.session.displayName || name}.`);
    } else {
      state.supabaseAuth.busy = false;
      state.supabaseAuth.error =
        res.reason === "not-configured" ? "Supabase-Projekt noch nicht konfiguriert (siehe unten)." :
        res.reason === "invalid-credentials" ? "Falscher Name oder PIN." :
        `Anmeldung fehlgeschlagen${res.error ? `: ${res.error}` : "."}`;
    }
    render();
  }

  function handleSupabaseLogout() {
    if (supabaseClient) supabaseClient.logout();
    state.supabaseSession = null;
    toast("Von Supabase abgemeldet.");
    render();
  }

  function saveSettings() {
    const container = root();
    const value = (role) => {
      const node = container && container.querySelector(`[data-role='${role}']`);
      return node ? node.value.trim() : "";
    };
    const checked = (role) => {
      const node = container && container.querySelector(`[data-role='${role}']`);
      return node ? Boolean(node.checked) : true;
    };
    // Wie checked(), aber Fallback FALSE – für Freigabe-Flags, bei denen ein
    // fehlendes Feld niemals „an" bedeuten darf (Netz-Auskunft/Bridge).
    const checkedStrict = (role) => {
      const node = container && container.querySelector(`[data-role='${role}']`);
      return node ? Boolean(node.checked) : false;
    };
    // Achtung: hier wird komplett neu aufgebaut, nicht gemerged. Jedes neue
    // Einstellungsfeld muss also auch hier auftauchen, sonst ist es nach dem
    // nächsten Speichern weg.
    state.settings = {
      agentName: value("set-agent-name"),
      company: value("set-company"),
      signature: value("set-signature"),
      notifyWaiting: checked("set-notify-waiting"),
      notifyCallbacks: checked("set-notify-callbacks"),
      syncTicketSummaryToCrm: checked("set-sync-summary"),
      customerSearchJql: value("set-customer-jql"),
      supabaseUrl: value("set-supabase-url"),
      supabaseAnonKey: value("set-supabase-anon-key"),
      // Kritische Schalter: bewusst mit Fallback false, falls das Feld mal fehlt
      // (checked() defaultet auf true – für ein Freigabe-Flag wäre das falsch).
      enableLookups: checkedStrict("set-enable-lookups"),
      enableBridge: checkedStrict("set-enable-bridge"),
      bridgeToken: value("set-bridge-token")
    };
    persistSettings();
    state.settingsOpen = false;
    render();
    toast("Einstellungen lokal gespeichert.");
  }

  // Schnellregel-Klick: in den Antwort-Tab wechseln und – falls die Regel eine
  // Intent-ID mitliefert (rules.nextStep) – die passende Notiz-Vorlage einsetzen.
  function applySuggestion(intentId) {
    state.activeTab = "reply";
    persistUiState();
    const intent = intentId && AI.intents.find((entry) => entry.id === intentId);
    if (intent) state.ai.note = intent.seed;
    render();
  }

  // Netz-Auskunft: Schritt 1 – Bestätigung anfordern (kritische Aktion). Der
  // eigentliche Lauf startet erst nach „Ja" in confirmLookup().
  function promptLookup(kind) {
    if (state.settings.enableLookups !== true) {
      toast("Netz-Auskunft ist ausgeschaltet – erst in den Einstellungen aktivieren.");
      return;
    }
    const number = lookupCustomerNumber();
    if (!number) { toast("Keine Kundennummer erkannt."); return; }
    state.lookup.confirm = { kind, customerNumber: number };
    render();
  }

  // Schritt 2 – bestätigt: Auftrag an den Hintergrund-Worker (lookup.js) und
  // optimistisch einen „läuft"-Zustand anzeigen; Fortschritt/Ergebnis kommen
  // über storageKeys.lookupResult zurück.
  function confirmLookup() {
    const confirm = state.lookup.confirm;
    if (!confirm) return;
    state.lookup.confirm = null;
    const dash = (CONFIG.lookups && CONFIG.lookups[confirm.kind]) || {};
    const requestId = `lk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    state.lookup.result = {
      requestId,
      kind: confirm.kind,
      customerNumber: confirm.customerNumber,
      status: "running",
      steps: (dash.steps || []).map((step) => ({ id: step.id, state: "pending" })),
      data: null,
      error: ""
    };
    try {
      if (chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          type: "sc-run-lookup",
          request: { kind: confirm.kind, customerNumber: confirm.customerNumber, source: "panel", requestId }
        }, () => void chrome.runtime.lastError);
      }
    } catch (error) { /* Worker nicht erreichbar – Ergebnis bleibt bei „läuft" */ }
    render();
    toast("Abfrage gestartet …");
  }

  function cancelLookup() {
    state.lookup.confirm = null;
    render();
  }

  async function handleClick(event) {
    const control = event.target.closest("[data-action]");
    if (!control) return;
    const action = control.dataset.action;

    switch (action) {
      case "open-panel":
      case "close-panel":
        state.isOpen = action === "open-panel";
        persistUiState();
        render();
        return;
      case "switch-tab":
        syncInputsFromDom();
        state.activeTab = control.dataset.tab;
        persistUiState();
        render();
        return;
      case "refresh":
        refreshTicket();
        toast("Ticketdaten aktualisiert.");
        return;
      case "toggle-settings":
        syncInputsFromDom();
        state.settingsOpen = !state.settingsOpen;
        render();
        return;
      case "close-settings":
        state.settingsOpen = false;
        render();
        return;
      case "save-settings": saveSettings(); return;
      case "supabase-login": await handleSupabaseLogin(); return;
      case "supabase-logout": handleSupabaseLogout(); return;
      case "deescalate": deescalate(); return;
      case "set-language":
        syncInputsFromDom();
        state.ai.replyLanguage = control.dataset.language;
        render();
        return;
      case "enable-ai": enableAi(); return;
      case "run-triage": runTriage(); return;
      case "generate-summary": generateSummary(); return;
      case "save-summary-to-crm": await syncSummaryToCrm({ manual: true }); return;
      case "generate-documentation": generateDocumentation(); return;
      case "copy-documentation": copyText(state.ai.documentation.text, "Doku kopiert."); return;
      case "use-documentation": useDocumentationAsComment(); return;
      case "generate-advice": generateAdvice(); return;
      case "translate-description": translateDescription(); return;
      case "generate-handoff": generateHandoff(); return;
      case "dismiss-call-overlay": dismissCallOverlay(); return;
      case "toggle-cockpit-mode": toggleCockpitMode(); return;
      case "wipe-data": wipeAllData(); return;
      case "copy-handoff-comment": syncInputsFromDom(); copyText(state.ai.handoff.comment.text, "Kommentar kopiert."); return;
      case "copy-handoff-email": {
        syncInputsFromDom();
        const subject = state.ai.handoff.email.subject.trim();
        const body = state.ai.handoff.email.body.trim();
        copyText(subject ? `Betreff: ${subject}\n\n${body}` : body, "E-Mail kopiert.");
        return;
      }
      case "use-handoff-comment": useHandoffComment(); return;
      case "use-handoff-email": useHandoffEmail(); return;
      case "set-tone":
        syncInputsFromDom();
        state.tone = control.dataset.tone;
        persistUiState();
        render();
        return;
      case "use-intent": useIntent(control.dataset.intentId); return;
      case "draft-comment": draft("comment"); return;
      case "draft-email": draft("email"); return;
      case "rewrite-draft": rewriteDraft(); return;
      case "proofread-draft": proofreadDraft(); return;
      case "review-draft": reviewDraft(); return;
      case "apply-review": applyReview(); return;
      case "copy-draft": copyDraft(); return;
      case "clean-call-notes": cleanCallNotes(); return;
      case "copy-call-draft": copyText(state.ai.callDraft.text, "Kommentar kopiert."); return;
      case "use-call-draft": useCallDraft(); return;
      case "copy-email-template": copyEmailTemplate(control.dataset.emailId); return;
      case "open-email-editor": state.emailEditor = { isOpen: true, templateId: null }; render(); return;
      case "edit-email-template": state.emailEditor = { isOpen: true, templateId: control.dataset.emailId }; render(); return;
      case "close-email-editor": state.emailEditor = { isOpen: false, templateId: null }; render(); return;
      case "save-email-template": saveEmailTemplate(); return;
      case "delete-email-template": deleteEmailTemplate(control.dataset.emailId); return;
      case "copy-call-note": { const note = el("call-note"); copyText(note && note.value, "Gesprächsnotiz kopiert."); return; }
      // Wichtig: in den AKTIVEN Leitfaden indizieren, nicht in eine feste
      // Liste – sonst kopieren die Buttons im Outbound-Modus Inbound-Sätze.
      case "copy-call-phase": { const phase = activeCallPhases()[Number(control.dataset.phaseIndex)]; if (phase) copyText(phase.prompt, "Gesprächsbaustein kopiert."); return; }
      case "copy-objection": { const card = activeObjectionCards()[Number(control.dataset.objectionIndex)]; if (card) copyText(card.text, "Antwort kopiert."); return; }
      case "apply-suggestion": applySuggestion(control.dataset.intentId); return;
      case "set-call-mode": setCallMode(control.dataset.mode); return;
      case "search-customer": openCustomerSearch(control.dataset.customer); return;
      case "generate-call-prep": generateCallPrep(); return;
      case "copy-call-prep": copyText(callPrepAsText(), "Gesprächsvorbereitung kopiert."); return;
      case "call-outcome": applyOutcome(control.dataset.outcome); return;
      case "closeout-type":
        if (state.closeout) {
          state.closeout.entryType = control.dataset.value;
          if (control.dataset.value === "vertrag" || control.dataset.value === "tarifwechsel") maybeLoadSharedSettings();
          render();
        }
        return;
      case "closeout-toggle-product": {
        if (state.closeout) {
          const name = control.dataset.product;
          const products = state.closeout.fields.products;
          const idx = products.indexOf(name);
          if (idx >= 0) products.splice(idx, 1); else products.push(name);
          render();
        }
        return;
      }
      case "closeout-set-lead-status":
        if (state.closeout) { state.closeout.fields.status = control.dataset.value; render(); }
        return;
      case "closeout-set-lead-priority":
        if (state.closeout) { state.closeout.fields.priority = control.dataset.value; render(); }
        return;
      case "closeout-set-contract-status":
        if (state.closeout) { state.closeout.fields.contractStatus = control.dataset.value; render(); }
        return;
      case "closeout-set-contract-laufzeit":
        if (state.closeout) {
          state.closeout.fields.laufzeitMonate = control.dataset.value ? Number(control.dataset.value) : null;
          render();
        }
        return;
      case "closeout-set-tarif-changetype":
        if (state.closeout) { state.closeout.fields.changeType = control.dataset.value; render(); }
        return;
      case "closeout-set-tarif-context":
        if (state.closeout) { state.closeout.fields.context = control.dataset.value; render(); }
        return;
      case "closeout-refresh-settings": maybeLoadSharedSettings({ forceRefresh: true }); return;
      case "closeout-submit": await submitCloseout(); return;
      case "lookup-baustatus": promptLookup("baustatus"); return;
      case "lookup-churn": promptLookup("churn"); return;
      case "lookup-confirm": confirmLookup(); return;
      case "lookup-cancel": cancelLookup(); return;
      case "open-lookup-settings":
        state.settingsOpen = true;
        render();
        return;
      case "add-callback": addCurrentTicketToCallbacks(); return;
      case "dial-callback": dialCallback(control.dataset.callbackId); return;
      case "snooze-callback": snoozeCallback(control.dataset.callbackId, Number(control.dataset.snooze) || 3600000); return;
      case "complete-callback": completeCallback(control.dataset.callbackId); return;
      default: return;
    }
  }

  // Textareas direkt in den State spiegeln (verhindert Verlust bei Re-Render).
  function handleInput(event) {
    const role = event.target && event.target.dataset && event.target.dataset.role;
    if (role === "note") state.ai.note = event.target.value;
    else if (role === "draft") state.ai.draft = event.target.value;
    else if (role === "draft-subject") state.ai.emailSubject = event.target.value;
    else if (role === "call-notes") { state.ai.callNotes = event.target.value; scheduleAutoCallClean(); }
    else if (role === "handoff-department") state.ai.handoff.department = event.target.value;
    else if (role === "handoff-note") state.ai.handoff.note = event.target.value;
    else if (role === "handoff-comment") state.ai.handoff.comment.text = event.target.value;
    else if (role === "handoff-email-subject") state.ai.handoff.email.subject = event.target.value;
    else if (role === "handoff-email-body") state.ai.handoff.email.body = event.target.value;
    else if (role === "set-agent-name") state.settings.agentName = event.target.value;
    else if (role === "set-company") state.settings.company = event.target.value;
    else if (role === "set-signature") state.settings.signature = event.target.value;
    else if (role === "set-customer-jql") state.settings.customerSearchJql = event.target.value;
    else if (role === "set-supabase-url") state.settings.supabaseUrl = event.target.value;
    else if (role === "set-supabase-anon-key") state.settings.supabaseAnonKey = event.target.value;
    else if (role === "sb-login-name") state.supabaseAuth.name = event.target.value;
    else if (role === "sb-login-pin") state.supabaseAuth.pin = event.target.value;
    else if (role && role.indexOf("closeout-") === 0 && state.closeout) {
      const f = state.closeout.fields;
      const value = event.target.value;
      if (role === "closeout-title") f.title = value;
      else if (role === "closeout-content") { f.content = value; f.contentTouched = true; }
      else if (role === "closeout-customer-name") f.customerName = value;
      else if (role === "closeout-customer-number") f.customerNumber = value;
      else if (role === "closeout-phone") f.phone = value;
      else if (role === "closeout-topic") f.topic = value;
      else if (role === "closeout-notes") f.notes = value;
      else if (role === "closeout-jira-ticket") f.jiraTicket = value;
      else if (role === "closeout-old-product") f.oldProduct = value;
      else if (role === "closeout-new-product") f.newProduct = value;
      else if (role === "closeout-followup-date") f.followUpDate = value;
      else if (role === "closeout-contract-date") f.contractDate = value;
      else if (role === "closeout-change-date") f.changeDate = value;
    }
  }

  // ---------------------------------------------------------------------------
  // Lebenszyklus
  // ---------------------------------------------------------------------------

  // Befüllt die KI-Ergebnisfelder aus dem lokalen Cache für dieses Ticket
  // (oder mit "idle", falls noch nichts generiert wurde).
  function hydrateAiFromCache(ticket) {
    const entry = aiCache.getEntry(ticket.key);
    state.ai.summary = (entry && entry.summary) || { status: "idle", text: "" };
    state.ai.triage = (entry && entry.triage) || { status: "idle", data: null };
    state.ai.advice = (entry && entry.advice) || { status: "idle", text: "" };
    state.ai.documentation = (entry && entry.documentation) || { status: "idle", text: "" };
    state.ai.callPrep = (entry && entry.callPrep) || { status: "idle", data: null };
  }

  function onTicketChanged(nextTicket) {
    window.clearTimeout(callAutoCleanTimer);
    if (state.ai.controller) { try { state.ai.controller.abort(); } catch (error) { /* ignorieren */ } }
    state.ai.busy = "";
    state.ai.controller = null;
    state.ai.download = 0;
    state.ai.error = "";
    hydrateAiFromCache(nextTicket);
    // Der Aktenstand gehört zum vorherigen Ticket – für das neue ist noch
    // nichts geschrieben (die zwischengespeicherte Zusammenfassung wurde beim
    // damaligen Erstellen bereits übernommen).
    state.crmNote = { status: "idle", error: "", signature: "", customerNumber: "", resolution: "", created: false };
    state.ai.review = { status: "idle", checks: [], improved: "" };
    state.ai.translation = { status: "idle", text: "", language: "" };
    state.ai.note = "";
    state.ai.draft = "";
    state.ai.emailSubject = "";
    state.ai.draftKind = "comment";
    state.ai.callNotes = "";
    state.ai.callDraft = { status: "idle", text: "" };
    state.ai.handoff = {
      department: "",
      note: "",
      comment: { status: "idle", text: "" },
      email: { status: "idle", subject: "", body: "" }
    };
  }

  function refreshTicket() {
    syncInputsFromDom();
    const previousKey = state.ticket ? state.ticket.key : null;
    const nextTicket = jiraReader.read();
    state.ticket = nextTicket;
    // Bei echtem Ticketwechsel Entwurfsfelder zurücksetzen und KI-Ergebnisse
    // aus dem Cache für das neue Ticket laden (statt sie zu verwerfen).
    if (nextTicket.key !== previousKey) onTicketChanged(nextTicket);
    publishTicketContext();
    render();
    maybeAutoRun();
  }

  async function mount() {
    let container = root();
    if (container) return;

    container = document.createElement("div");
    container.id = CONFIG.rootId;
    document.body.appendChild(container);

    const saved = await localStorageGet([
      CONFIG.storageKeys.isOpen,
      CONFIG.storageKeys.activeTab,
      CONFIG.storageKeys.tone,
      CONFIG.storageKeys.emailTemplates,
      CONFIG.storageKeys.settings,
      CONFIG.storageKeys.aiCache,
      CONFIG.storageKeys.activeCall,
      CONFIG.storageKeys.queueStats,
      CONFIG.storageKeys.callOverlay,
      CONFIG.storageKeys.callMode,
      CONFIG.storageKeys.callbacks,
      CONFIG.storageKeys.supabaseSession,
      CONFIG.storageKeys.customerCard,
      CONFIG.storageKeys.lookupResult,
      CONFIG.storageKeys.bridgeState
    ]);
    if (typeof saved[CONFIG.storageKeys.isOpen] === "boolean") state.isOpen = saved[CONFIG.storageKeys.isOpen];
    if (CONFIG.tabs.some((tab) => tab.id === saved[CONFIG.storageKeys.activeTab])) state.activeTab = saved[CONFIG.storageKeys.activeTab];
    if (AI.tones.some((tone) => tone.id === saved[CONFIG.storageKeys.tone])) state.tone = saved[CONFIG.storageKeys.tone];
    if (saved[CONFIG.storageKeys.settings] && typeof saved[CONFIG.storageKeys.settings] === "object") {
      state.settings = { ...CONFIG.settingsDefaults, ...saved[CONFIG.storageKeys.settings] };
    }
    state.emailTemplates = Array.isArray(saved[CONFIG.storageKeys.emailTemplates])
      ? saved[CONFIG.storageKeys.emailTemplates]
      : CONFIG.emailTemplates.map((template) => ({ ...template }));
    aiCache.init(saved[CONFIG.storageKeys.aiCache]);
    state.activeCall = saved[CONFIG.storageKeys.activeCall] || null;
    state.queueStats = saved[CONFIG.storageKeys.queueStats] || null;
    state.callMode = callModeMeta(saved[CONFIG.storageKeys.callMode]).id;
    // Beim Laden gleich ausmisten: erledigte und lang überfällige Einträge
    // verschwinden, ohne dass jemand aufräumen muss (Datensparsamkeit).
    const savedCallbacks = saved[CONFIG.storageKeys.callbacks];
    state.callbacks = pruneCallbacks(savedCallbacks && savedCallbacks.items, Date.now());
    const overlayPrefs = saved[CONFIG.storageKeys.callOverlay];
    if (overlayPrefs && typeof overlayPrefs === "object") {
      if (overlayPrefs.mode === "mini" || overlayPrefs.mode === "full") state.callOverlay.mode = overlayPrefs.mode;
      if (overlayPrefs.pos && typeof overlayPrefs.pos.x === "number" && typeof overlayPrefs.pos.y === "number") {
        state.callOverlay.pos = overlayPrefs.pos;
      }
    }
    state.supabaseSession = saved[CONFIG.storageKeys.supabaseSession] || null;
    state.customerCard = saved[CONFIG.storageKeys.customerCard] || null;
    state.lookup.result = saved[CONFIG.storageKeys.lookupResult] || null;
    state.bridgeState = saved[CONFIG.storageKeys.bridgeState] || null;

    state.ticket = jiraReader.read();
    hydrateAiFromCache(state.ticket);
    publishTicketContext();
    render();
    container.addEventListener("click", handleClick);
    container.addEventListener("input", handleInput);
    container.addEventListener("pointerdown", startCockpitDrag);
    bindPaletteHotkey();

    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        if (Object.prototype.hasOwnProperty.call(changes, CONFIG.storageKeys.activeCall)) {
          handleActiveCallChange(changes[CONFIG.storageKeys.activeCall].newValue);
        }
        if (Object.prototype.hasOwnProperty.call(changes, CONFIG.storageKeys.queueStats)) {
          // Wartefeld-Zahlen kommen alle paar Sekunden – nur die betroffenen
          // DOM-Knoten aktualisieren statt das ganze Panel neu zu bauen.
          state.queueStats = changes[CONFIG.storageKeys.queueStats].newValue || null;
          refreshQueueNodes();
        }
        // Der Modus kann auch im timio-Cockpit umgelegt worden sein.
        if (Object.prototype.hasOwnProperty.call(changes, CONFIG.storageKeys.callMode)) {
          const next = callModeMeta(changes[CONFIG.storageKeys.callMode].newValue).id;
          if (next !== state.callMode) {
            state.callMode = next;
            render();
            maybeAutoRun();
          }
        }
        // Rückrufliste: der Service-Worker vermerkt dort, dass er erinnert hat.
        if (Object.prototype.hasOwnProperty.call(changes, CONFIG.storageKeys.callbacks)) {
          const next = changes[CONFIG.storageKeys.callbacks].newValue;
          state.callbacks = pruneCallbacks(next && next.items, Date.now());
          render();
        }
        // Gesprächsergebnis, das in timio geklickt wurde: dort läuft keine KI,
        // deshalb wird es hier verarbeitet und der Staffelstab sofort wieder
        // weggeräumt (er enthält Anrufdaten).
        if (Object.prototype.hasOwnProperty.call(changes, CONFIG.storageKeys.callOutcome)) {
          const outcome = changes[CONFIG.storageKeys.callOutcome].newValue;
          if (outcome && outcome.outcomeId) {
            safeLocalRemove(CONFIG.storageKeys.callOutcome);
            applyOutcome(outcome.outcomeId, {
              callerName: outcome.callerName,
              callerNumber: outcome.callerNumber,
              customerNumber: outcome.customerNumber
            });
          }
        }
        // Kundenakte: von timio-content.js bei eingehendem Anruf geschrieben,
        // hier nur zum Anzeigen im Jira-Cockpit übernommen.
        if (Object.prototype.hasOwnProperty.call(changes, CONFIG.storageKeys.customerCard)) {
          state.customerCard = changes[CONFIG.storageKeys.customerCard].newValue || null;
          render();
        }
        // Netz-Auskunft: Fortschritt/Ergebnis der aktiven Abfrage, geschrieben
        // vom Hintergrund-Worker (lookup.js). Nur übernehmen, wenn es zur gerade
        // laufenden Anfrage gehört (oder keine läuft), damit ein alter Eintrag
        // eines anderen Tabs die aktuelle Anzeige nicht überschreibt.
        if (Object.prototype.hasOwnProperty.call(changes, CONFIG.storageKeys.lookupResult)) {
          const next = changes[CONFIG.storageKeys.lookupResult].newValue || null;
          const current = state.lookup.result;
          if (!next || !current || !current.requestId || next.requestId === current.requestId) {
            state.lookup.result = next;
            render();
          }
        }
        // WebSocket-Bridge: an/aus für das „Bridge aktiv"-Banner.
        if (Object.prototype.hasOwnProperty.call(changes, CONFIG.storageKeys.bridgeState)) {
          state.bridgeState = changes[CONFIG.storageKeys.bridgeState].newValue || null;
          render();
        }
        // Supabase-Session kann auch im anderen Cockpit (timio-Seite hat
        // keine eigene UI dafür, aber ein zweiter Jira-Tab) an-/abgemeldet
        // worden sein.
        if (Object.prototype.hasOwnProperty.call(changes, CONFIG.storageKeys.supabaseSession)) {
          state.supabaseSession = changes[CONFIG.storageKeys.supabaseSession].newValue || null;
          if (state.settingsOpen) render();
        }
      });
    }
    window.setInterval(tickActiveCallTimer, 1000);

    loadCapabilities();
  }

  app.ui = {
    mount,
    refresh: refreshTicket
  };
})();
