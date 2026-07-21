(function initUi() {
  "use strict";

  const app = window.SupportCopilot;
  const { CONFIG, jiraReader, rules, aiCache, shared } = app;
  const {
    escapeHtml, extensionAlive, formatDuration, callTimerText,
    callModeMeta, isOutbound, normalizePhone, nextRetryAt, pruneCallbacks, customerSearchUrl
  } = shared;
  const AI = CONFIG.ai;
  const localAi = app.localAi;
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
      ? `${renderCockpitPrep()}${renderCockpitTicket(call)}${renderOutcomeBar(call, "sc-cockpit-outcome")}<div class="sc-cockpit-queues" data-role="overlay-queues">${queueMarkup()}</div>`
      : `<div class="sc-cockpit-queues" data-role="overlay-queues">${queueMarkup()}</div>${renderCockpitTicket(call)}${renderOutcomeBar(call, "sc-cockpit-outcome")}`;

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

  const OUTCOMES = (CONFIG.outbound && CONFIG.outbound.outcomes) || [];

  // Erscheint nach dem Auflegen. Ein Klick füllt die Gesprächsnotiz vor, lässt
  // die lokale KI daraus den Jira-Kommentar bauen und legt bei Nichterreichen
  // gleich die Wiedervorlage an.
  function renderOutcomeBar(call, className) {
    if (!call || call.status !== "ended" || !OUTCOMES.length) return "";
    const buttons = OUTCOMES.map((outcome) =>
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
    const outcome = OUTCOMES.find((entry) => entry.id === outcomeId);
    if (!outcome) return;
    const call = context || currentActiveCall() || {};

    syncInputsFromDom();
    const existing = state.ai.callNotes.trim();
    state.ai.callNotes = existing ? `${existing}\n${outcome.seed}` : outcome.seed;
    state.settingsOpen = false;
    state.activeTab = "call";
    persistUiState();

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

  function renderSettings() {
    const s = state.settings;
    return `
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
        <label class="sc-input-label">Jira-Suche nach Kundennummer (JQL)
          <input class="sc-text-input" data-role="set-customer-jql" value="${escapeHtml(s.customerSearchJql || "")}" placeholder='${escapeHtml((CONFIG.jira && CONFIG.jira.customerSearchJql) || "")}'>
          <small class="sc-input-hint">Für den Sprung von der Kundennummer zum Ticket. <code>{q}</code> wird durch die Kundennummer ersetzt. Leer lassen nutzt die Volltextsuche; kennst du den Feldnamen, ist z. B. <code>"Oikonomikos-ID" ~ "{q}"</code> deutlich treffsicherer.</small>
        </label>
        <div class="sc-inline-actions">
          <button class="sc-secondary-button" type="button" data-action="close-settings">Zurück</button>
          <button class="sc-primary-button" type="button" data-action="save-settings">Speichern</button>
        </div>
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
    if (!window.confirm("Wirklich alle lokal gespeicherten Daten des Support Copilot löschen? (Einstellungen, Vorlagen, KI-Ergebnisse, Anruf-Status)")) return;
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
      <button class="sc-launcher ${state.isOpen ? "is-hidden" : ""}" type="button" data-action="open-panel" aria-label="Support Copilot öffnen">
        <span>AI</span><span>Copilot</span>
      </button>
      <aside class="sc-panel ${state.isOpen ? "is-open" : ""}" aria-label="Support Copilot">
        <header class="sc-panel-header">
          <div>
            <span class="sc-eyebrow">Support Copilot · lokale KI</span>
            <strong>Smart dokumentieren.</strong>
          </div>
          <div class="sc-header-actions">
            <button class="sc-icon-button ${state.settingsOpen ? "is-active" : ""}" type="button" data-action="toggle-settings" title="Einstellungen" aria-label="Einstellungen">⚙</button>
            <button class="sc-icon-button" type="button" data-action="refresh" title="Ticketdaten aktualisieren" aria-label="Ticketdaten aktualisieren">↻</button>
            <button class="sc-icon-button" type="button" data-action="close-panel" title="Panel minimieren" aria-label="Panel minimieren">×</button>
          </div>
        </header>
        ${renderModeSwitch()}
        ${renderActiveCallBanner()}
        ${state.settingsOpen ? "" : `<nav class="sc-tabs" role="tablist" aria-label="Bereiche">${tabs}</nav>`}
        <main class="sc-panel-content">${state.settingsOpen ? renderSettings() : activeContent()}</main>
        <footer class="sc-panel-footer">Verarbeitet Ticketdaten ausschließlich lokal – On-Device-KI, kein Cloud-Dienst.</footer>
        <div class="sc-toast" role="status" aria-live="polite"></div>
      </aside>`;
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
      if (result.status === S.AVAILABLE) cacheField("summary", { status: "ok", text: result.text });
      else state.ai.summary = { status: "error", text: "" };
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
    // Achtung: hier wird komplett neu aufgebaut, nicht gemerged. Jedes neue
    // Einstellungsfeld muss also auch hier auftauchen, sonst ist es nach dem
    // nächsten Speichern weg.
    state.settings = {
      agentName: value("set-agent-name"),
      company: value("set-company"),
      signature: value("set-signature"),
      notifyWaiting: checked("set-notify-waiting"),
      notifyCallbacks: checked("set-notify-callbacks"),
      customerSearchJql: value("set-customer-jql")
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
      case "deescalate": deescalate(); return;
      case "set-language":
        syncInputsFromDom();
        state.ai.replyLanguage = control.dataset.language;
        render();
        return;
      case "enable-ai": enableAi(); return;
      case "run-triage": runTriage(); return;
      case "generate-summary": generateSummary(); return;
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
      CONFIG.storageKeys.callbacks
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

    state.ticket = jiraReader.read();
    hydrateAiFromCache(state.ticket);
    publishTicketContext();
    render();
    container.addEventListener("click", handleClick);
    container.addEventListener("input", handleInput);
    container.addEventListener("pointerdown", startCockpitDrag);

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
