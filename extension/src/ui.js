(function initUi() {
  "use strict";

  const app = window.StadtnetzCRM;
  const { CONFIG, jiraReader, rules, aiCache, shared } = app;
  const {
    escapeHtml, extensionAlive, formatDuration, callTimerText,
    normalizePhone, nextRetryAt, pruneCallbacks, customerSearchUrl,
    jiraTicketUrl, formatDateDE, calcContractCommission, calcTariffCommission,
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
    // Vier Bereiche entlang des ausgehenden Gesprächs (siehe CONFIG.tabs):
    // prep · talk · close · callbacks.
    activeTab: "prep",
    settings: { ...CONFIG.settingsDefaults },
    settingsOpen: false,
    activeCall: null, // Signal von timio-content.js über chrome.storage, siehe currentActiveCall()
    // Arbeitsrichtung ist im reinen Outbound-Betrieb konstant. Der Wert bleibt
    // im State, weil geteilte Helfer (shared.callStatusMeta, callModeMeta) ihn
    // erwarten; ein Richtungsschalter existiert nicht mehr.
    callMode: "outbound",
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
    // einem Anruf (siehe CONFIG.storageKeys.customerCard).
    customerCard: null,
    // Netz-Auskunft (aktive Dashboard-Abfrage). `result` wird aus
    // storageKeys.lookupResult gespiegelt (vom Worker/lookup.js geschrieben),
    // `confirm` hält die ausstehende Bestätigung { kind, customerNumber } – die
    // kritische Aktion wird VOR jedem Lauf im Panel bestätigt. `customerInput`
    // ist die (optional manuell überschriebene) Kundennummer für die Abfrage.
    lookup: { result: null, confirm: null, customerInput: "" },
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
    // Befehlspalette (Stufe 4, KONZEPT-INTEGRATION.md): ⌘K-Schnellsuche,
    // eigener DOM-Root unabhängig vom Panel.
    palette: null,
    ai: {
      caps: null,           // Ergebnis von localAi.capabilities()
      busy: "",             // Name der gerade laufenden KI-Aufgabe ("" = frei)
      download: 0,          // Download-Fortschritt in Prozent
      controller: null,     // AbortController der laufenden Aufgabe
      error: "",

      // Freies Mitschreib-Notizfeld während des Gesprächs.
      callNotes: "",
      // Aus den Stichpunkten formulierte interne Notiz (lokale KI, draftCallNote).
      callDraft: { status: "idle", text: "" },
      // Gesprächsvorbereitung für ausgehende Anrufe: Ziel, Punkte, Fragen,
      // Einwände. Läuft automatisch vorab, damit sie fertig ist, bevor timio wählt.
      callPrep: { status: "idle", data: null }
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
      [CONFIG.storageKeys.activeTab]: state.activeTab
    });
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
      // Anrufziel und Gesprächspunkte wandern mit ins timio-Cockpit: bei
      // ausgehenden Anrufen sitzt der Bearbeiter dort und hat keine Zeit,
      // erst nach Jira zu wechseln.
      aiCallPrep: state.ai.callPrep.status === "ok" ? (state.ai.callPrep.data || null) : null,
      updatedAt: Date.now()
    };
    const signature = JSON.stringify([payload.key, payload.summary, payload.status, payload.priority, payload.customerReference, payload.aiCallPrep]);
    if (signature === lastTicketContextSignature) return;
    lastTicketContextSignature = signature;
    safeLocalSet({ [CONFIG.storageKeys.ticketContext]: payload });
  }

  // Bearbeiter-/Firmenangaben für die KI (leere Felder werden ignoriert).
  function agentForAi() {
    return {
      name: state.settings.agentName,
      company: state.settings.company
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

  // Reiner Outbound-Betrieb: es gibt keinen Richtungsschalter und keinen
  // Inbound-Pfad mehr. outboundMode() bleibt als Funktion erhalten, weil viele
  // Helfer sie abfragen – sie ist jetzt konstant wahr.
  function outboundMode() {
    return true;
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

    return `
      <div class="sc-call-banner ${hasMismatch ? "is-mismatch" : ""} ${ended ? "is-ended" : ""}">
        <div class="sc-call-banner-main">
          <span class="sc-call-banner-status">${escapeHtml(statusLabel)}</span>
          <strong>${escapeHtml(nameLine)}</strong>
          ${!ringing ? `<span data-role="active-call-timer" class="sc-call-banner-timer">${escapeHtml(timer)}</span>` : ""}
        </div>
        <p class="sc-call-banner-details">${escapeHtml(details)}</p>
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
        state.activeTab = "talk";
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

    if (mini) {
      return `
        <div class="sc-cockpit sc-cockpit--mini ${status.className}" data-role="cockpit" role="status" style="${cockpitPositionStyle()}">
          <div class="sc-cockpit-header" data-role="cockpit-drag" title="Zum Verschieben ziehen">
            <span class="sc-cockpit-status">${escapeHtml(status.label)}</span>
            <strong class="sc-cockpit-mini-name">${escapeHtml(nameLine)}</strong>
            <span class="sc-cockpit-timer" data-role="overlay-call-timer">${escapeHtml(timer)}</span>
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
    // Ausgehend zuerst das, was zählt: "was will ich von dieser Person"
    // (Vorbereitung), dann der Ticket-Abgleich, dann Ergebnis und Abschluss.
    const blocks = `${renderCockpitPrep()}${renderCockpitTicket(call)}${renderOutcomeBar(call, "sc-cockpit-outcome")}${renderCloseoutPanel(call)}`;

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
            ${renderKundenakte(call)}
            ${renderCustomerSearchButton(call, "sc-cockpit-search")}
          </div>
          ${blocks}
        </div>
      </div>`;
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
    // Im HUD (Desktop-App) läuft die lokale KI nicht hier, sondern ferngesteuert
    // in Chrome. Meldet der Shim `offline`, ist NICHT das Modell das Problem,
    // sondern die fehlende Verbindung zur Extension/zum Jira-Tab. Dann eine
    // konkrete, behebbare Anweisung zeigen statt des irreführenden
    // „in diesem Chrome nicht verfügbar".
    if (state.ai.caps && state.ai.caps.offline) {
      return "Keine Verbindung zur Chrome-Erweiterung. Chrome mit geöffnetem Jira-Vorgang starten; nach einem Neuladen der Erweiterung auch den Jira-Tab neu laden (F5).";
    }
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
      const detected = lookupCustomerNumber();
      const fieldValue = state.lookup.customerInput || detected;
      const running = state.lookup.result && state.lookup.result.status === "running";
      const hint = detected
        ? `Kundennummer aus dem Ticket/Anruf übernommen – bei Bedarf überschreiben.`
        : `Auf diesem Ticket wurde keine Kundennummer automatisch erkannt – hier eintragen.`;
      body = `
        <p class="sc-section-intro">Öffnet und automatisiert dafür das jeweilige Dashboard. Vor jeder Abfrage wird bestätigt.</p>
        <label class="sc-input-label">Kundennummer
          <input class="sc-text-input" data-role="lookup-customer" value="${escapeHtml(fieldValue)}" placeholder="z. B. 287246" ${running ? "disabled" : ""}>
          <small class="sc-input-hint">${escapeHtml(hint)}</small>
        </label>
        <div class="sc-inline-actions">
          <button class="sc-primary-button" type="button" data-action="lookup-baustatus" ${running ? "disabled" : ""}>Baustatus nachschlagen</button>
          <button class="sc-secondary-button" type="button" data-action="lookup-churn" ${running ? "disabled" : ""}>Kündiger-Status prüfen</button>
        </div>
        ${renderLookupResult(state.lookup.result)}`;
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

  // Tab „Vorbereitung": alles, was VOR dem ausgehenden Gespräch auf den Schirm
  // gehört – Ticketkontext, KI-Gesprächsvorbereitung (Ziel/Punkte/Fragen/
  // Einwände), der Ein-Klick-Sprung von der Kundennummer zum Ticket und die
  // optionale Netz-Auskunft. timio wählt selbst, also muss das hier fertig
  // stehen, bevor verbunden wird.
  function renderPrep() {
    const ticket = state.ticket;
    const ref = ticket && known(ticket.customerReference) ? ticket.customerReference.trim() : "";
    return `
      ${renderAiBanner()}
      <section class="sc-section" aria-label="Ticketkontext">
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
          ${ticketRow("Kunden-ID / Referenz", ticket.customerReference)}
          ${ticketRow("Kundenname", ticket.customerName)}
        </div>
        ${ref ? `<button class="sc-secondary-button" type="button" data-action="search-customer" data-customer="${escapeHtml(ref)}">Ticket zu Kundennummer ${escapeHtml(ref)} suchen</button>` : ""}
      </section>
      ${renderCallPrep()}
      ${renderNetzauskunft()}`;
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
          <button class="sc-text-button" type="button" data-action="use-call-draft">In den Abschluss übernehmen</button>
        </div>`;
    }
    const disabled = !aiUsable() || anyBusy();
    return `
      <section class="sc-section sc-ai-card">
        <div class="sc-section-title-row">
          <h3>Notizen → interne Notiz</h3>
          <span class="sc-local-label">lokale KI</span>
        </div>
        <p class="sc-section-intro">Tippe während des Gesprächs Stichworte. Nach einer Tipppause macht die lokale KI daraus eine saubere interne Notiz für den CRM-Abschluss.</p>
        <textarea class="sc-comment-draft sc-note-input" data-role="call-notes" placeholder="Stichworte aus dem Gespräch …">${escapeHtml(state.ai.callNotes)}</textarea>
        <button class="sc-primary-button" type="button" data-action="clean-call-notes" ${disabled ? "disabled" : ""}>${running ? "KI arbeitet …" : "In interne Notiz umwandeln"}</button>
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
    return (CONFIG.outbound && CONFIG.outbound.outcomes) || [];
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
    // Ergebnisse mit echtem Gesprächsinhalt öffnen das Abschluss-Panel und
    // wechseln in den Abschluss-Tab; reine Erreichbarkeits-Ergebnisse (Mailbox,
    // nicht erreicht …) bleiben im Gespräch-Tab.
    if (outcome.opensPanel) {
      state.activeTab = "close";
      openCloseout("notiz", call, outcome.seed);
    } else {
      state.activeTab = "talk";
    }
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

  // Der aktive Anruf ist im Outbound-Betrieb der Ausgangspunkt: timio wählt
  // selbst, also ist die erste Frage immer, wer gerade dran ist und ob das
  // offene Ticket dazu passt. Das Abschluss-Panel liegt im eigenen Tab
  // „Abschluss"; hier steht nur der Gesprächskontext plus Ergebnis-Leiste.
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

  // Tab „Gespräch": Kontext des laufenden Anrufs, Leitfaden + Einwandkarten,
  // das Mitschreib-Notizfeld (→ lokale KI formuliert die interne Notiz) und die
  // Ergebnis-Leiste nach dem Auflegen.
  function renderTalk() {
    return `
      ${renderActiveCallCard()}
      ${renderCallGuide()}
      ${renderCallDraft()}`;
  }

  // Tab „Abschluss": der CRM-Eintrag zum Gespräch (Notiz/Lead/Vertrag/
  // Tarifwechsel). Ein Gesprächsergebnis mit Inhalt öffnet das Panel
  // automatisch; ohne offenes Panel bieten wir den manuellen Einstieg an.
  function renderClose() {
    const call = currentActiveCall();
    const panel = renderCloseoutPanel(call);
    if (panel) return panel;
    const ticket = state.ticket;
    const hasTicket = ticket && known(ticket.key);
    return `
      <section class="sc-section">
        <div class="sc-section-title-row">
          <h3>Abschluss erfassen</h3>
          <span class="sc-local-label">ins CRM</span>
        </div>
        <p class="sc-section-intro">Ergebnis des Gesprächs direkt ins CRM schreiben: Notiz, Lead, Vertrag oder Tarifwechsel – inklusive Provisionsrechnung. Über die Ergebnis-Leiste im Tab „Gespräch" öffnet sich das passende Formular nach dem Auflegen automatisch; hier kannst du auch ohne aktiven Anruf einen Eintrag beginnen.</p>
        <div class="sc-inline-actions">
          <button class="sc-primary-button" type="button" data-action="closeout-start" data-value="notiz">Neuer Eintrag</button>
        </div>
        ${hasTicket ? "" : `<p class="sc-ai-message">Kein Jira-Ticket erkannt – Ticket/Kundennummer werden dann nicht vorbefüllt.</p>`}
      </section>`;
  }

  // Tab „Rückrufe": die selbst vereinbarte Wiedervorlageliste.
  function renderCallbacksTab() {
    return renderCallbackList();
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
        <p class="sc-section-intro">Diese Angaben fließen in die KI-Gesprächsvorbereitung und die Abschluss-Notiz ein, damit sie ohne Platzhalter fertig sind. Sie bleiben ausschließlich in deinem Chrome-Profil.</p>
        <label class="sc-input-label">Dein Name
          <input class="sc-text-input" data-role="set-agent-name" value="${escapeHtml(s.agentName)}" placeholder="z. B. Max Muster">
        </label>
        <label class="sc-input-label">Unternehmen / Team
          <input class="sc-text-input" data-role="set-company" value="${escapeHtml(s.company)}" placeholder="z. B. TNG Vertrieb">
        </label>
        <label class="sc-check-label">
          <input type="checkbox" data-role="set-notify-callbacks" ${s.notifyCallbacks !== false ? "checked" : ""}>
          <span>Benachrichtigen, wenn ein Rückruf fällig wird<small>Lokale Desktop-Meldung je Eintrag genau einmal, sobald der vereinbarte Zeitpunkt erreicht ist.</small></span>
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
        <p class="sc-section-intro">Alle Daten dieser Extension (Einstellungen, KI-Gesprächsvorbereitung pro Ticket, Anruf-Status und Rückrufliste) liegen ausschließlich lokal in deinem Chrome-Profil. Es gibt keinen Server und keine Übertragung. Hier kannst du alles vollständig löschen.</p>
        <button class="sc-secondary-button sc-danger-button" type="button" data-action="wipe-data">Alle lokal gespeicherten Daten löschen</button>
      </section>`;
  }

  // Recht auf Löschung, lokal umgesetzt: entfernt sämtliche Storage-Schlüssel
  // der Extension und setzt den Arbeitsspeicher-Zustand auf Werkseinstellung.
  function wipeAllData() {
    if (!window.confirm("Wirklich alle lokal gespeicherten Daten von Stadtnetz CRM Outbound löschen? (Einstellungen, KI-Ergebnisse, Anruf-Status, Rückrufliste)")) return;
    safeLocalRemove(Object.values(CONFIG.storageKeys));
    lastTicketContextSignature = null;
    aiCache.init(null);
    state.settings = { ...CONFIG.settingsDefaults };
    state.activeCall = null;
    state.callOverlay = { mode: "full", pos: null, dismissedForCallId: null };
    state.callMode = "outbound";
    state.callbacks = [];
    state.supabaseSession = null;
    state.supabaseAuth = { name: "", pin: "", busy: false, error: "" };
    state.customerCard = null;
    state.lookup = { result: null, confirm: null, customerInput: "" };
    state.bridgeState = null;
    state.closeout = null;
    state.sharedSettings = { status: "idle", data: null, error: "" };
    if (state.ticket) hydrateAiFromCache(state.ticket);
    render();
    toast("Alle lokalen Daten wurden gelöscht.");
  }

  function activeContent() {
    switch (state.activeTab) {
      case "talk": return renderTalk();
      case "close": return renderClose();
      case "callbacks": return renderCallbacksTab();
      default: return renderPrep();
    }
  }

  function rootMarkup() {
    const tabs = CONFIG.tabs.map((tab) => `
      <button class="sc-tab ${state.activeTab === tab.id ? "is-active" : ""}" type="button" role="tab" aria-selected="${state.activeTab === tab.id}" data-action="switch-tab" data-tab="${tab.id}">${escapeHtml(tab.label)}</button>`).join("");
    return `
      ${renderCallCockpit()}
      <button class="sc-launcher ${state.isOpen ? "is-hidden" : ""}" type="button" data-action="open-panel" aria-label="Stadtnetz CRM Outbound öffnen">
        <span>Out</span><span>bound</span>
      </button>
      <aside class="sc-panel ${state.isOpen ? "is-open" : ""}" aria-label="Stadtnetz CRM Outbound">
        <header class="sc-panel-header">
          <div>
            <span class="sc-eyebrow">Stadtnetz CRM · Outbound · lokale KI</span>
            <strong>Anrufen. Abschließen.</strong>
          </div>
          <div class="sc-header-actions">
            <button class="sc-icon-button ${state.settingsOpen ? "is-active" : ""}" type="button" data-action="toggle-settings" title="Einstellungen" aria-label="Einstellungen">⚙</button>
            <button class="sc-icon-button" type="button" data-action="refresh" title="Ticketdaten aktualisieren" aria-label="Ticketdaten aktualisieren">↻</button>
            <button class="sc-icon-button" type="button" data-action="close-panel" title="Panel minimieren" aria-label="Panel minimieren">×</button>
          </div>
        </header>
        ${renderBridgeBanner()}
        ${renderActiveCallBanner()}
        ${state.settingsOpen ? "" : `<nav class="sc-tabs" role="tablist" aria-label="Bereiche">${tabs}</nav>`}
        <main class="sc-panel-content">${state.settingsOpen ? renderSettings() : activeContent()}</main>
        <footer class="sc-panel-footer">Verarbeitet Ticketdaten ausschließlich lokal – On-Device-KI, kein Cloud-Dienst.</footer>
        <div class="sc-toast" role="status" aria-live="polite"></div>
      </aside>`;
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
    const callNotes = value("call-notes"); if (callNotes !== undefined) state.ai.callNotes = callNotes;
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

  // Die einzige automatisch mitlaufende KI-Aufgabe: die Gesprächsvorbereitung.
  // timio wählt selbst, also muss sie fertig sein, bevor verbunden wird.
  const AUTO_RUN_TASKS = [
    { isDone: () => autoRunSatisfied(state.ai.callPrep), run: generateCallPrep }
  ];

  // Startet die nächste offene Auto-Aufgabe, aber nur wenn das Modell bereits
  // vorhanden ist (kein ungefragter Download) und aktuell nichts anderes läuft.
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
      const result = await localAi.prepareCall({ ticket: state.ticket, agent: agentForAi() }, { signal, onDownload });
      if (result && result.status === S.OK) cacheField("callPrep", { status: "ok", data: result.data });
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

  // Setzt den Aufräum-Lauf für die Gesprächsnotizen tatsächlich in Gang.
  // Geht davon aus, dass die Notiz bereits geprüft/nicht leer ist.
  async function runCallClean() {
    if (!aiUsable() || !state.ai.callNotes.trim()) return;
    const previous = state.ai.callDraft;
    const signal = beginRun("callclean");
    state.ai.callDraft = { status: "loading", text: "" };
    render();
    try {
      const result = await localAi.draftCallNote({ ticket: state.ticket, note: state.ai.callNotes, agent: agentForAi() }, {
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
  // Klick-/Eingabe-Handling
  // ---------------------------------------------------------------------------

  // Die aus den Gesprächsstichpunkten formulierte Notiz in den Abschluss
  // übernehmen (CRM-Eintrag), statt sie wie früher in einen Jira-Kommentar.
  function useCallDraft() {
    if (!state.ai.callDraft.text) return;
    const call = currentActiveCall();
    openCloseout(state.closeout ? state.closeout.entryType : "notiz", call, state.ai.callDraft.text);
    state.activeTab = "close";
    persistUiState();
    render();
    toast("In den Abschluss übernommen.");
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
      notifyCallbacks: checked("set-notify-callbacks"),
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

  // Netz-Auskunft: Schritt 1 – Bestätigung anfordern (kritische Aktion). Der
  // eigentliche Lauf startet erst nach „Ja" in confirmLookup().
  function promptLookup(kind) {
    if (state.settings.enableLookups !== true) {
      toast("Netz-Auskunft ist ausgeschaltet – erst in den Einstellungen aktivieren.");
      return;
    }
    // Live aus dem Feld lesen (falls der Nutzer gerade getippt hat und der
    // input-Handler den State noch nicht gespiegelt hat), sonst State/Erkennung.
    const container = root();
    const node = container && container.querySelector("[data-role='lookup-customer']");
    const typed = node && node.value ? node.value.trim() : "";
    const number = typed || (state.lookup.customerInput || "").trim() || lookupCustomerNumber();
    try { console.log("[Netz-Auskunft] promptLookup", kind, "enabled=", state.settings.enableLookups, "nr=", number); } catch (e) { /* egal */ }
    if (!number) { toast("Bitte eine Kundennummer eingeben."); return; }
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

    // Häufigste Ursache für „es passiert nichts": die Extension wurde neu
    // geladen, der Jira-Tab aber nicht – dann ist der Content-Script-Kontext
    // ungültig und chrome.runtime.sendMessage wirft. Das darf NICHT still
    // scheitern, sonst hängt die Anzeige ewig bei „läuft".
    const reloadHint = {
      requestId, kind: confirm.kind, customerNumber: confirm.customerNumber,
      status: "error",
      steps: (dash.steps || []).map((step) => ({ id: step.id, state: "pending" })),
      data: null,
      error: "Verbindung zur Extension verloren – bitte den Jira-Tab neu laden (F5) und erneut versuchen. (Nach dem Neuladen der Extension muss auch der Jira-Tab neu geladen werden.)"
    };
    try { console.log("[Netz-Auskunft] confirmLookup alive=", extensionAlive(), "kind=", confirm.kind, "nr=", confirm.customerNumber); } catch (e) { /* egal */ }
    if (!extensionAlive()) {
      state.lookup.result = reloadHint;
      render();
      toast("Bitte Jira-Tab neu laden (F5).");
      return;
    }

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
      try { console.log("[Netz-Auskunft] sende sc-run-lookup an den Worker …", requestId); } catch (e) { /* egal */ }
      chrome.runtime.sendMessage({
        type: "sc-run-lookup",
        request: { kind: confirm.kind, customerNumber: confirm.customerNumber, source: "panel", requestId }
      }, () => {
        // Fire-and-forget: „message port closed" ist erwartbar (keine Antwort).
        // Andere Fehler deuten auf einen fehlenden Empfänger (Worker/lookup.js
        // nicht geladen) – dann sichtbar auf Reload hinweisen.
        const err = chrome.runtime.lastError;
        if (err && !/message port closed/i.test(err.message || "")) {
          state.lookup.result = reloadHint;
          render();
        }
      });
    } catch (error) {
      state.lookup.result = reloadHint;
      render();
      toast("Bitte Jira-Tab neu laden (F5).");
      return;
    }
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
      case "enable-ai": enableAi(); return;
      case "dismiss-call-overlay": dismissCallOverlay(); return;
      case "toggle-cockpit-mode": toggleCockpitMode(); return;
      case "wipe-data": wipeAllData(); return;
      case "clean-call-notes": cleanCallNotes(); return;
      case "copy-call-draft": copyText(state.ai.callDraft.text, "Notiz kopiert."); return;
      case "use-call-draft": useCallDraft(); return;
      case "copy-call-phase": { const phase = activeCallPhases()[Number(control.dataset.phaseIndex)]; if (phase) copyText(phase.prompt, "Gesprächsbaustein kopiert."); return; }
      case "copy-objection": { const card = activeObjectionCards()[Number(control.dataset.objectionIndex)]; if (card) copyText(card.text, "Antwort kopiert."); return; }
      case "search-customer": openCustomerSearch(control.dataset.customer); return;
      case "generate-call-prep": generateCallPrep(); return;
      case "copy-call-prep": copyText(callPrepAsText(), "Gesprächsvorbereitung kopiert."); return;
      case "call-outcome": applyOutcome(control.dataset.outcome); return;
      case "closeout-start": openCloseout("notiz", currentActiveCall(), ""); return;
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
    if (role === "call-notes") { state.ai.callNotes = event.target.value; scheduleAutoCallClean(); }
    else if (role === "set-agent-name") state.settings.agentName = event.target.value;
    else if (role === "set-company") state.settings.company = event.target.value;
    else if (role === "set-customer-jql") state.settings.customerSearchJql = event.target.value;
    else if (role === "set-supabase-url") state.settings.supabaseUrl = event.target.value;
    else if (role === "set-supabase-anon-key") state.settings.supabaseAnonKey = event.target.value;
    else if (role === "set-bridge-token") state.settings.bridgeToken = event.target.value;
    else if (role === "lookup-customer") state.lookup.customerInput = event.target.value;
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
    state.ai.callNotes = "";
    state.ai.callDraft = { status: "idle", text: "" };
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
      CONFIG.storageKeys.settings,
      CONFIG.storageKeys.aiCache,
      CONFIG.storageKeys.activeCall,
      CONFIG.storageKeys.callOverlay,
      CONFIG.storageKeys.callbacks,
      CONFIG.storageKeys.supabaseSession,
      CONFIG.storageKeys.customerCard,
      CONFIG.storageKeys.lookupResult,
      CONFIG.storageKeys.bridgeState
    ]);
    if (typeof saved[CONFIG.storageKeys.isOpen] === "boolean") state.isOpen = saved[CONFIG.storageKeys.isOpen];
    if (CONFIG.tabs.some((tab) => tab.id === saved[CONFIG.storageKeys.activeTab])) state.activeTab = saved[CONFIG.storageKeys.activeTab];
    if (saved[CONFIG.storageKeys.settings] && typeof saved[CONFIG.storageKeys.settings] === "object") {
      state.settings = { ...CONFIG.settingsDefaults, ...saved[CONFIG.storageKeys.settings] };
    }
    aiCache.init(saved[CONFIG.storageKeys.aiCache]);
    state.activeCall = saved[CONFIG.storageKeys.activeCall] || null;
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
