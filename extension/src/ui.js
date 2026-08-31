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
  const localAi = app.localAi;
  const supabaseClient = app.supabaseClient;
  // theme.js ist eine eigene Datei im Ladepfad (manifest.json / index.html).
  // Fehlt sie aus irgendeinem Grund (unvollständiges Paket, alter Cache), darf
  // das NICHT das ganze Panel lahmlegen – ohne diesen Fallback würde mount()
  // an themeEngine.* werfen und das HUD/Panel bliebe leer. Dann eben ohne
  // Theme-Anpassung weiterlaufen (Standardfarben aus dem Stylesheet).
  const themeEngine = app.themeEngine || {
    ROLE_TO_VAR: {},
    resolveThemeColors: () => ({}),
    applyTheme: () => {},
    normalizeThemeState: (raw) =>
      (raw && typeof raw === "object" && raw.presetId
        ? { presetId: raw.presetId, overrides: (raw.overrides && typeof raw.overrides === "object") ? raw.overrides : {} }
        : { presetId: "jira", overrides: {} })
  };
  const S = (localAi && localAi.STATUS) || {};

  // Gastgeber-Haken für die Desktop-App.
  //
  // Dasselbe Panel läuft an zwei Orten: als Overlay in der Jira-Seite und als
  // Overlay auf dem Schreibtisch (desktop/). Was nur der Schreibtisch hat
  // (Verbindungspunkt, Notizen, Overlay-Einstellungen), soll trotzdem nicht in
  // dieser Datei landen – sonst wandert Fenster-Logik in die Extension, wo es
  // sie nicht gibt. Stattdessen setzt desktop/renderer/hud-host.js ein Objekt
  // an app.hudHost; hier wird an den passenden Stellen nur nachgefragt. In
  // Chrome bleibt app.hudHost undefiniert und alles rendert unverändert.
  //
  // Bewusst als Funktion (nicht als Konstante beim Laden): hud-host.js wird
  // nach ui.js geladen, eine Kopie beim Start wäre immer null.
  function hudHost() {
    return app.hudHost || null;
  }

  // Ruft einen Markup-Haken auf. Fällt er aus, kostet das ein Stück Anzeige –
  // nicht das ganze Panel.
  function hostHtml(name) {
    const host = hudHost();
    if (!host || typeof host[name] !== "function") return "";
    try {
      return host[name]() || "";
    } catch (error) {
      return "";
    }
  }

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
    // Persönliches Farbschema des Panels (Phase 1 der Layout-/Theme-Anpassung).
    // Getrennt von state.settings, weil saveSettings() dessen Objekt komplett
    // neu aufbaut statt zu mergen — Theme-Werte würden das nicht überleben.
    theme: { presetId: "jira", overrides: {} },
    // Übernahme des CRM-Farbschemas (opt-in). `cached` hält das bereits
    // übersetzte Ergebnis, damit der Kaltstart ohne Netz richtig aussieht;
    // `status`/`error` sind rein transient für die Anzeige in den Einstellungen.
    themeSync: { useCrm: false, cached: null, at: 0, status: "idle", error: "" },
    // Eigene Tastenkürzel: nur die Abweichungen von CONFIG.hotkeys.
    // `capture` ist rein transient – die id der Zeile, die gerade auf einen
    // Tastendruck wartet, plus eine Meldung, wenn er nicht angenommen wurde.
    hotkeys: {},
    hotkeyCapture: { id: "", error: "" },
    // Widget-Layout der Tabs (Phase 3). `customizeMode` ist der transiente
    // Bearbeitungsmodus (nicht persistiert). `tabs[tabId]` = { order, hidden }
    // hält die persönliche Reihenfolge/Sichtbarkeit; leer = Standard.
    layout: { customizeMode: false, tabs: {} },
    // Kurzmeldung unten im Panel. Sie gehört in den State und nicht nur ins
    // DOM: render() baut das Panel komplett neu auf, und das Toast-Element
    // wurde dabei jedes Mal leer neu erzeugt. Wer nach dem Klick noch etwas
    // gerendert hat (die Ergebnis-Erfassung tut das gleich zweimal, asynchron),
    // löschte die Meldung, bevor sie jemand lesen konnte – der Knopf sah dann
    // aus, als hätte er nichts getan.
    toast: { text: "", until: 0 },
    activeCall: null, // Signal von timio-content.js über chrome.storage, siehe currentActiveCall()
    // Arbeitsrichtung ist im reinen Outbound-Betrieb konstant. Der Wert bleibt
    // im State, weil geteilte Helfer (shared.callStatusMeta, callModeMeta) ihn
    // erwarten; ein Richtungsschalter existiert nicht mehr.
    callMode: "outbound",
    // Call-Typ-Routing (Outbound-Umbau): bestimmt Leitfaden & Einwandkarten.
    //   shift    — aus fetchCurrentShift() geladene Kampagne (call_type) der
    //              heutigen Schicht; null = keine Schicht/Kampagne hinterlegt.
    //   override — manuell im Cockpit gewählter Typ; hat Vorrang vor der Schicht,
    //              damit der Bearbeiter bei Bedarf abweichen kann.
    // Effektiver Typ via activeCallType(): override ?? shift.callType ?? "churn".
    shift: { loaded: false, callType: null, campaignId: null, campaignName: null, shiftType: null },
    callTypeOverride: null,
    // Abgehakte Leitfaden-Schritte (nur lokal, pro Sitzung), Schlüssel
    // "<callType>:<index>". Früher nur für die Welcome-Checkliste — der
    // Leitfaden ist inzwischen für jeden Call-Typ ein Schrittwerk, deshalb
    // gilt das Abhaken überall.
    checkedPhases: {},
    // Gesprächsleitfaden als Schrittwerk: welcher Schritt je Call-Typ gerade
    // dran ist. `showAll` klappt die alte Gesamtliste auf (zum Nachschlagen
    // außerhalb des Gesprächsflusses). Beides bewusst nur im Arbeitsspeicher:
    // ein neues Gespräch fängt vorne an (siehe handleActiveCallChange).
    guide: { step: {}, showAll: false },
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
    // Kundenakte + Anruf-Vorgeschichte für den Vorbereitungs-Tab. Bewusst
    // getrennt von customerCard oben: die kommt vom timio-Cockpit und gilt für
    // einen LAUFENDEN Anruf. Hier wird VOR dem Wählen zur Kundennummer des
    // Tickets nachgeschlagen — das ist ein anderer Zeitpunkt und eine andere
    // Nummer. `number` ist zugleich der Schlüssel gegen Doppel-Lookups.
    prepCustomer: { number: "", status: "idle", card: null, calls: [], error: "" },
    // Netz-Auskunft (aktive Dashboard-Abfrage). `result` wird aus
    // storageKeys.lookupResult gespiegelt (vom Worker/lookup.js geschrieben),
    // `confirm` hält die ausstehende Bestätigung { kind, customerNumber } – die
    // kritische Aktion wird VOR jedem Lauf im Panel bestätigt. `customerInput`
    // ist die (optional manuell überschriebene) Kundennummer für die Abfrage.
    // diagnose: Ergebnis der Selbstauskunft des Hintergrund-Dienstes
    // („Verbindung prüfen“) – nur Anzeige, nichts wird dabei automatisiert.
    lookup: { result: null, confirm: null, customerInput: "", diagnose: null },
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
      // Wann die Verfügbarkeit zuletzt geprüft wurde und ob gerade geprüft wird.
      // Grundlage der Selbstheilung (maybeRecheckAi): ein negatives Ergebnis
      // gilt nur befristet, damit eine kurzzeitige Störung nicht dauerhaft alle
      // KI-Funktionen sperrt.
      capsCheckedAt: 0,
      capsChecking: false,
      busy: "",             // Name der gerade laufenden KI-Aufgabe ("" = frei)
      download: 0,          // Download-Fortschritt in Prozent
      controller: null,     // AbortController der laufenden Aufgabe
      error: "",

      // Freies Mitschreib-Notizfeld während des Gesprächs.
      callNotes: "",
      // Aus den Stichpunkten formulierte interne Notiz (lokale KI, draftCallNote).
      callDraft: { status: "idle", text: "" },
      // Ticket-Zusammenfassung in vier Punkten (Anliegen, Stand, Ergebnis,
      // nächster Schritt). Läuft automatisch beim Öffnen eines Tickets und
      // landet als aiSummary im timio-Cockpit.
      summary: { status: "idle", text: "" },
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

  function persistTheme() {
    safeLocalSet({ [CONFIG.storageKeys.theme]: state.theme });
  }

  function persistHotkeys() {
    safeLocalSet({ [CONFIG.storageKeys.hotkeys]: state.hotkeys });
  }

  /** Was für diese id gerade gilt (eigene Einstellung, sonst Voreinstellung). */
  function hotkey(id) {
    return shared.hotkeyFor(id, state.hotkeys);
  }

  function persistThemeSync() {
    // Nur das Dauerhafte sichern — status/error sind Anzeigezustand.
    safeLocalSet({
      [CONFIG.storageKeys.themeSync]: {
        useCrm: state.themeSync.useCrm,
        cached: state.themeSync.cached,
        at: state.themeSync.at
      }
    });
  }

  /**
   * Das Theme, das gerade gelten soll. Ist die CRM-Übernahme an UND liegt ein
   * übersetztes Schema vor, gewinnt dieses; sonst das lokal im Panel gewählte.
   *
   * Bewusst als Ableitung statt state.theme zu überschreiben: schaltet jemand
   * die Übernahme wieder aus, steht die eigene Auswahl unversehrt da.
   */
  function effectiveTheme() {
    if (state.themeSync.useCrm && state.themeSync.cached) return state.themeSync.cached;
    return state.theme;
  }

  function applyCurrentTheme(target) {
    themeEngine.applyTheme(target || root(), effectiveTheme());
  }

  /**
   * Holt das CRM-Farbschema und übersetzt es ins Rollen-Schema dieser
   * Extension. `silent` unterdrückt Toasts — für den Abgleich beim Start, der
   * ungefragt läuft.
   */
  async function refreshCrmTheme(options) {
    const silent = Boolean(options && options.silent);
    if (!supabaseClient || typeof supabaseClient.fetchUserAppearance !== "function") {
      state.themeSync.status = "error";
      state.themeSync.error = "Diese Version kann das CRM-Schema nicht lesen.";
      if (!silent) render();
      return;
    }

    state.themeSync.status = "loading";
    state.themeSync.error = "";
    if (!silent) render();

    const res = await supabaseClient.fetchUserAppearance();
    if (!res || !res.ok) {
      state.themeSync.status = "error";
      state.themeSync.error =
        (res && res.reason === "not-logged-in") ? "Nicht im CRM angemeldet." :
        (res && res.reason === "not-configured") ? "Supabase ist nicht eingerichtet." :
        (res && res.error) || "Abruf fehlgeschlagen.";
      // Ein gescheiterter Abgleich lässt das zuletzt übernommene Schema stehen,
      // statt das Panel auf Standardfarben zurückspringen zu lassen.
      render();
      if (!silent) toast(`Farbschema: ${state.themeSync.error}`);
      return;
    }

    const palette = res.data && res.data.palette;
    state.themeSync.cached = themeEngine.crmPaletteToTheme(palette);
    state.themeSync.at = Date.now();
    state.themeSync.status = "ok";
    persistThemeSync();
    applyCurrentTheme();
    render();
    if (!silent) {
      const count = Object.keys(state.themeSync.cached.overrides).length;
      toast(count > 0
        ? "Farbschema aus dem CRM übernommen."
        : "Im CRM ist das Standard-Schema eingestellt — das Panel bleibt bei seinen Farben.");
    }
  }

  function toggleCrmTheme(nextOn) {
    state.themeSync.useCrm = Boolean(nextOn);
    persistThemeSync();
    applyCurrentTheme();
    render();
    if (state.themeSync.useCrm) void refreshCrmTheme({ silent: false });
  }

  function persistLayout() {
    // Nur die persönliche Reihenfolge/Sichtbarkeit sichern, nicht den transienten
    // Bearbeitungsmodus.
    safeLocalSet({ [CONFIG.storageKeys.layout]: { tabs: state.layout.tabs } });
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
      // KI-Zusammenfassung fürs timio-Cockpit: während des Gesprächs hat der
      // Bearbeiter keine Zeit, erst das ganze Ticket zu lesen.
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
    const previousId = callIdOf(state.activeCall);
    state.activeCall = newValue || null;
    const status = state.activeCall && state.activeCall.status;
    // Ein anderes Gespräch heißt: Leitfaden von vorn. Ohne das stünde man beim
    // nächsten Kunden mitten in Schritt 5 eines fremden Gesprächs — der
    // Fortschritt ist die Aussage des Schrittwerks und darf nicht überhängen.
    const nextId = callIdOf(state.activeCall);
    if (nextId && nextId !== previousId) resetGuide();

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
    // lookupCustomerNumber() nimmt die Nummer des laufenden Anrufs vor die des
    // Tickets. Ohne Nachladen stünde im Widget die neue Kundennummer über der
    // Akte des vorigen Kunden.
    maybePrepCustomer();
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

  // „Aufgelegt" — der Bearbeiter beendet das Gespräch von Hand.
  //
  // Bei timio war das nie nötig: das Content-Script sah den Beendet-Bildschirm
  // und meldete das Ende selbst. Die Telefonanlage über myApps meldet dagegen
  // nur den ANFANG eines Gesprächs (siehe desktop/renderer/myapps-calls.js) —
  // ohne diesen Knopf liefe der Anruf im Cockpit weiter, während der Kunde
  // längst aufgelegt hat, und die Dauer in der Historie wäre erfunden.
  //
  // Geschrieben wird nur der gemeinsame Storage-Schlüssel: wer die Zeile in
  // Supabase geöffnet hat, schließt sie auch (er allein kennt ihre ID). Der
  // Statuswechsel auf "ended" ist zugleich das Signal, das die Ergebnis-
  // Erfassung aufklappt — Auflegen und Erfassen sind derselbe Handgriff.
  function endCurrentCall() {
    const call = currentActiveCall();
    if (!call || call.status === "ended") return;

    const startedAt = call.connectedAt || call.updatedAt || Date.now();
    const payload = {
      ...call,
      status: "ended",
      updatedAt: Date.now(),
      // Sekunden, wie sie auch timio liefert – daraus wird duration_s.
      // Nicht als Sekundenzahl: shared.callTimerText() gibt finalDuration
      // unverändert aus – eine 2 stünde dann als "2" im Gesprächskopf statt als
      // "0:02". Dasselbe Format, das timio geschrieben hat.
      finalDuration: formatDuration(Date.now() - startedAt),
      endedByUser: true
    };
    safeLocalSet({ [CONFIG.storageKeys.activeCall]: payload });
    // Nicht auf den Rückweg über storage.onChanged warten: der Knopf soll
    // sofort reagieren, sonst drückt man ihn ein zweites Mal.
    handleActiveCallChange(payload);
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

  // Der aktuelle Leitfaden-Schritt auch im schwebenden Cockpit. Es ist die
  // Fläche, die während des Gesprächs sichtbar bleibt, wenn das Panel
  // zugeklappt oder von timio verdeckt ist — bisher stand dort alles außer der
  // Antwort auf die eigentliche Frage: „was sage ich als Nächstes?".
  function renderCockpitGuide() {
    const phases = activeCallPhases();
    if (!phases.length) return "";
    const current = guideStep();
    const phase = phases[current];
    if (!phase) return "";
    const isLast = current >= phases.length - 1;
    return `
      <div class="sc-cockpit-guide">
        <div class="sc-cockpit-guide-head">
          <span>Schritt ${current + 1}/${phases.length}</span>
          <strong>${escapeHtml(phase.title)}</strong>
        </div>
        <p>${escapeHtml(phase.prompt)}</p>
        <button class="sc-text-button" type="button" data-action="guide-next">${isLast ? "Abhaken" : "Erledigt & weiter →"}</button>
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

    if (mini) {
      return `
        <div class="sc-cockpit sc-cockpit--mini ${status.className}" data-role="cockpit" role="status" style="${cockpitPositionStyle()}">
          <div class="sc-cockpit-header" data-role="cockpit-drag" title="Zum Verschieben ziehen">
            <span class="sc-cockpit-status">${escapeHtml(status.label)}</span>
            <strong class="sc-cockpit-mini-name">${escapeHtml(nameLine)}</strong>
            <span class="sc-cockpit-timer" data-role="overlay-call-timer">${escapeHtml(timer)}</span>
            ${call.status === "ended" ? "" : `<button class="sc-hangup-button" type="button" data-action="end-call" title="Gespräch beenden">Aufgelegt</button>`}
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
    const blocks = `${renderCockpitPrep()}${renderCockpitGuide()}${renderCockpitTicket(call)}${renderOutcomeBar(call, "sc-cockpit-outcome")}${renderCloseoutPanel(call)}`;

    return `
      <div class="sc-cockpit ${status.className}" data-role="cockpit" role="status" style="${cockpitPositionStyle()}">
        <div class="sc-cockpit-header" data-role="cockpit-drag" title="Zum Verschieben ziehen">
          <span class="sc-cockpit-status">${escapeHtml(status.label)}</span>
          <span class="sc-cockpit-timer" data-role="overlay-call-timer">${escapeHtml(timer)}</span>
          ${call.status === "ended" ? "" : `<button class="sc-hangup-button" type="button" data-action="end-call" title="Gespräch beenden – danach kommt die Ergebnis-Erfassung">Aufgelegt</button>`}
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
  // Sicherheitsnetz gegen ein ewig bei „läuft" hängendes Panel: meldet sich der
  // Hintergrund-Worker über die Watchdog-Frist nicht mit Fortschritt oder
  // Ergebnis (z. B. Worker beendet, Dashboard-Tab unerreichbar, Nachricht nie
  // angekommen), wird der Zustand mit einer klaren, umsetzbaren Meldung auf
  // Fehler gesetzt. Der Worker frischt updatedAt in seinem Heartbeat-Takt auf
  // (CONFIG.lookups.heartbeatMs), also greift der Watchdog nur bei echter Stille
  // – nicht während eines langsamen, aber laufenden Vorgangs. Die Schwelle kommt
  // deshalb aus derselben Konfiguration wie der Takt: würde sie darunter liegen,
  // bräche das Panel jeden normalen Lauf ab.
  // Beide Fristen zur Laufzeit aus der CONFIG lesen (nicht beim Laden einfrieren),
  // damit sie an einer Stelle stehen und anpassbar bleiben.
  function lookupWatchdogMs() {
    const lookups = CONFIG.lookups || {};
    return typeof lookups.watchdogMs === "number" ? lookups.watchdogMs : 45000;
  }
  function lookupAckMs() {
    const lookups = CONFIG.lookups || {};
    return typeof lookups.ackTimeoutMs === "number" ? lookups.ackTimeoutMs : 8000;
  }

  // Der Hintergrund-Worker quittiert die Annahme sofort (phase != "queued").
  // Bleibt sie aus, LÄUFT DER DIENST NICHT – das ist der Zustand, in dem früher
  // gar nichts passierte (kein Tab, keine Meldung) und das Panel bis zum
  // Timeout „läuft" zeigte. Hier wird daraus eine Ansage, die man befolgen kann.
  function maybeExpireUnacceptedLookup() {
    const result = state.lookup.result;
    if (!result || result.status !== "running") return false;
    // Nur der selbst gesetzte Wartezustand zählt. Ein Ergebnis ohne phase stammt
    // aus einer älteren Sitzung – dafür ist der normale Watchdog zuständig.
    if (result.phase !== "queued") return false;
    const queuedAt = result.queuedAt || result.updatedAt || 0;
    if (!queuedAt || Date.now() - queuedAt <= lookupAckMs()) return false;
    state.lookup.result = Object.assign({}, result, {
      status: "error",
      phase: "done",
      note: "",
      error: "Der Hintergrund-Dienst der Extension hat den Auftrag nicht angenommen – er läuft vermutlich nicht. Bitte chrome://extensions öffnen, bei „Stadtnetz CRM Outbound“ auf „Neu laden“ klicken und danach diesen Jira-Tab mit F5 aktualisieren. Zeigt die Karte dort einen Fehler unter „Service Worker“, bitte diesen Text melden."
    });
    // Der liegengebliebene Auftrag darf nicht später von einem startenden Worker
    // aufgegriffen werden und unvermittelt ein Dashboard öffnen.
    safeLocalRemove(CONFIG.storageKeys.lookupRequest);
    render();
    return true;
  }

  function maybeExpireStuckLookup() {
    if (maybeExpireUnacceptedLookup()) return;
    const result = state.lookup.result;
    if (!result || result.status !== "running") return;
    const last = result.updatedAt || 0;
    if (!last || Date.now() - last <= lookupWatchdogMs()) return;
    state.lookup.result = Object.assign({}, result, {
      status: "error",
      error: "Zeitüberschreitung: Die Abfrage hat sich nicht mehr gemeldet. Meist ist der Hintergrund-Dienst der Extension beendet worden – bitte diesen Jira-Tab neu laden (F5) und erneut versuchen. Bleibt es dabei, in chrome://extensions unter „Service Worker“ nach Fehlern sehen."
    });
    render();
  }

  function tickActiveCallTimer() {
    // Läuft prozessweit im Sekundentakt – zuerst der Lookup-Watchdog und die
    // Selbstheilung der KI-Verfügbarkeit, damit beide auch dann greifen, wenn
    // gerade kein Anruf aktiv ist (früher Rücksprung unten).
    maybeExpireStuckLookup();
    maybeRecheckAi();
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
      // Der Kontextkopf im Tab „Gespräch" hat einen eigenen Platz für die
      // Dauer – dieselbe Zahl, ohne dass dafür neu gerendert werden muss.
      const headNode = el("call-head-timer");
      if (headNode) headNode.textContent = text;
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

  // Für die Bedienbarkeit zählt nicht der letzte Prüfstand, sondern ob ein
  // Versuch überhaupt Sinn haben kann. Alles außer „dieses Chrome kennt die API
  // nicht" kann vorübergehend sein (Verbindung weg, Modell gerade beschäftigt) –
  // dann bleibt der Knopf bedienbar und die Aktion prüft selbst noch einmal nach
  // (ensureAiUsable). Vorher sperrte ein einziges negatives Prüfergebnis alle
  // KI-Knöpfe dauerhaft, ohne Weg zurück außer Neustart.
  function aiActionable() {
    if (aiUsable()) return true;
    const caps = state.ai.caps;
    if (!caps) return false; // Prüfung läuft noch
    return caps.status !== S.UNSUPPORTED || Boolean(caps.offline) || Boolean(caps.transient);
  }

  function aiUnavailableMessage(status) {
    // Im HUD (Desktop-App) läuft die lokale KI nicht hier, sondern ferngesteuert
    // in Chrome. Meldet der Shim `offline`, ist NICHT das Modell das Problem,
    // sondern die fehlende Verbindung zur Extension/zum Jira-Tab. Dann eine
    // konkrete, behebbare Anweisung zeigen statt des irreführenden
    // „in diesem Chrome nicht verfügbar".
    if (state.ai.caps && state.ai.caps.offline) {
      const reason = state.ai.caps.reason ? ` (${state.ai.caps.reason})` : "";
      return `Keine Verbindung zur Chrome-Erweiterung${reason}. Chrome mit geöffnetem Jira-Vorgang starten; nach einem Neuladen der Erweiterung auch den Jira-Tab neu laden (F5). Es wird automatisch erneut geprüft.`;
    }
    // Die Prüfung selbst ist gescheitert (Verbindung/Zeitüberschreitung) – das
    // sagt nichts über das Modell aus und darf nicht als „Gerät kann das nicht"
    // erscheinen. Im HUD ist das der häufigste Fall: Chrome läuft, aber der
    // Jira-Tab ist gerade nicht ansprechbar.
    if (state.ai.caps && state.ai.caps.transient) {
      const reason = state.ai.caps.reason ? ` (${state.ai.caps.reason})` : "";
      return `Die lokale KI war gerade nicht erreichbar${reason}. Das heißt nicht, dass das Modell fehlt – es wird automatisch erneut geprüft. Läuft Chrome mit einem geöffneten Jira-Vorgang? Nach einem Neuladen der Erweiterung muss auch der Jira-Tab neu geladen werden (F5).`;
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

  // Ein Feld ohne Wert bleibt sichtbar, bekommt aber einen Gedankenstrich:
  // „Kunden-ID / Referenz —" ist eine Aussage (auf diesem Ticket steht keine),
  // eine Zeile mit leerer rechter Hälfte sah dagegen nach einem Fehler aus.
  function ticketRow(label, value) {
    const text = String(value == null ? "" : value).trim();
    return `
      <div class="sc-ticket-row">
        <span>${escapeHtml(label)}</span>
        ${text
          ? `<strong title="${escapeHtml(text)}">${escapeHtml(text)}</strong>`
          : `<strong class="is-empty" aria-label="nicht angegeben">—</strong>`}
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Rendering: KI-Banner (Verfügbarkeit / Modell laden)
  // ---------------------------------------------------------------------------

  function renderAiBanner() {
    // Auf dem Schreibtisch sagt der Gastgeber schon oben im Panel, dass Chrome
    // fehlt – und ohne Chrome gibt es dort weder KI noch etwas zum erneut
    // Prüfen. Zwei Warnungen für dieselbe Ursache sind eine zu viel.
    const host = hudHost();
    if (host && typeof host.isConnected === "function" && !host.isConnected()) return "";
    const caps = state.ai.caps;
    if (!caps) {
      return `<div class="sc-ai-banner is-checking"><span class="sc-spinner" aria-hidden="true"></span>Lokale KI wird geprüft …</div>`;
    }
    if (state.ai.capsChecking) {
      return `<div class="sc-ai-banner is-checking"><span class="sc-spinner" aria-hidden="true"></span>Lokale KI wird erneut geprüft …</div>`;
    }
    if (caps.usable && caps.status === S.AVAILABLE) {
      return "";
    }
    // Chrome meldet gerade kein "available", das Modell hat hier aber vor Kurzem
    // gearbeitet. Dann nicht sperren, sondern es beim nächsten Auftrag versuchen –
    // die Meldung ist ein Hinweis, keine Absage.
    if (caps.usable && caps.provenWorking) {
      return `<div class="sc-ai-banner is-checking">Die lokale KI meldet sich gerade zögerlich – die nächste Aufgabe wird trotzdem versucht.</div>`;
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
    return `
      <div class="sc-ai-banner is-warn">
        <span aria-hidden="true">!</span>
        <div>
          <p>${escapeHtml(aiUnavailableMessage(caps.status))}</p>
          <button class="sc-text-button" type="button" data-action="recheck-ai">Erneut prüfen</button>
        </div>
      </div>`;
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

  function renderChurnCard(data, result) {
    if (!data || !data.found) return `<p class="sc-ai-message sc-lookup-ok">Kein Kündiger-/Churn-Vorgang zu dieser Kundennummer gefunden.</p>`;
    const opened = result && result.openedTicket;
    return `
      <p class="sc-lookup-note">${data.count} ${data.count === 1 ? "Vorgang" : "Vorgänge"} gefunden.</p>
      ${opened ? `<p class="sc-ai-message sc-lookup-ok">Das Kündigungsticket wurde geöffnet – dort läuft die Gesprächsvorbereitung mit dem Kündigungsgrund als Kontext.</p>` : ""}
      <ul class="sc-lookup-churn">${data.cases.map((c) => `
        <li>
          <div class="sc-lookup-churn-head">${escapeHtml(c.vertrag || "—")}${c.geschaeftsfall ? ` · ${escapeHtml(c.geschaeftsfall)}` : ""}</div>
          ${c.ursache ? `<div class="sc-lookup-churn-sub"><strong>Grund:</strong> ${escapeHtml(c.ursache)}${c.eingang ? ` · ${escapeHtml(c.eingang)}` : ""}</div>` : ""}
          ${c.winback || c.dealcloser ? `<div class="sc-lookup-churn-sub">${c.winback ? `Winback: ${escapeHtml(c.winback)}` : ""}${c.winback && c.dealcloser ? " · " : ""}${c.dealcloser ? `bereits angeboten: ${escapeHtml(c.dealcloser)}` : ""}</div>` : ""}
          ${c.jiraTicket ? `<a class="sc-text-button" href="${escapeHtml(c.jiraHref || jiraTicketUrl(c.jiraTicket))}" target="_blank" rel="noopener">${escapeHtml(c.jiraTicket)} öffnen</a>` : ""}
          ${c.kommentar ? `<div class="sc-lookup-churn-comment">${escapeWithBreaks(c.kommentar)}</div>` : ""}
        </li>`).join("")}</ul>`;
  }

  function renderLookupResult(result) {
    if (!result) return "";
    const dash = (CONFIG.lookups && CONFIG.lookups[result.kind]) || {};
    if (result.status === "running") {
      // result.note ist der Abschnitt, in dem der Worker gerade steckt
      // (Tab vorbereiten, auf das Dashboard warten, zweiter Anlauf). Ohne ihn
      // sah die Vorbereitungsphase – vor dem ersten abgehakten Schritt – wie
      // Stillstand aus.
      return `<div class="sc-lookup-progress">
          <p class="sc-eyebrow">${escapeHtml(dash.label || "Abfrage")} · läuft …</p>
          ${result.note ? `<p class="sc-lookup-note">${escapeHtml(result.note)}</p>` : ""}
          ${renderLookupSteps(result)}
          <p class="sc-input-hint">Das Dashboard läuft im Vordergrund weiter – bitte den Tab währenddessen nicht wechseln. Danach springt der Fokus von selbst hierher zurück.</p>
        </div>`;
    }
    if (result.status === "error") {
      return `<div class="sc-lookup-progress">${renderLookupSteps(result)}<p class="sc-ai-message sc-lookup-error">${escapeHtml(result.error || "Abfrage fehlgeschlagen.")}</p></div>`;
    }
    if (result.status === "ok") {
      const data = result.data || {};
      return `<div class="sc-lookup-card"><span class="sc-eyebrow">${escapeHtml(dash.label || "Ergebnis")}${result.customerNumber ? ` · ${escapeHtml(result.customerNumber)}` : ""}</span>${result.kind === "baustatus" ? renderBaustatusCard(data) : renderChurnCard(data, result)}</div>`;
    }
    return "";
  }

  function renderLookupConfirm(confirm) {
    const dash = (CONFIG.lookups && CONFIG.lookups[confirm.kind]) || {};
    return `
      <div class="sc-lookup-confirm">
        <p><strong>Aktive Abfrage bestätigen.</strong> Dies öffnet und automatisiert das Dashboard <em>${escapeHtml(dash.label || confirm.kind)}</em> und liest Daten zu Kundennummer <strong>${escapeHtml(confirm.customerNumber)}</strong>. Das verlässt bewusst das „liest nur"-Prinzip der Extension.</p>
        <p class="sc-input-hint">Der Dashboard-Tab wird dafür in den Vordergrund geholt und auf die Startseite zurückgesetzt (nur so läuft die Abfrage zuverlässig — im Hintergrund bremst Chrome die Seite aus). Nicht gespeicherte Eingaben in diesem Tab gehen dabei verloren. Danach kommt der Fokus hierher zurück.</p>
        <div class="sc-inline-actions">
          <button class="sc-primary-button" type="button" data-action="lookup-confirm">Ja, nachschlagen</button>
          <button class="sc-secondary-button" type="button" data-action="lookup-cancel">Abbrechen</button>
        </div>
      </div>`;
  }

  // Selbstauskunft des Hintergrund-Dienstes: beantwortet in vier Zeilen, warum
  // eine Abfrage nicht losläuft – statt den Bearbeiter raten zu lassen.
  function renderLookupDiagnose(diagnose) {
    if (!diagnose) return "";
    if (diagnose.status === "running") {
      return `<p class="sc-ai-message"><span class="sc-spinner" aria-hidden="true"></span> Verbindung wird geprüft …</p>`;
    }
    if (diagnose.status === "error") {
      return `<p class="sc-ai-message sc-lookup-error">${escapeHtml(diagnose.error)}</p>`;
    }
    const report = diagnose.report || {};
    const rows = [
      ["Hintergrund-Dienst", "läuft"],
      ["Freigabe (Netz-Auskunft)", report.enableLookups ? "an" : "AUS – in den Einstellungen aktivieren"],
      ["Tab-Berechtigung", report.tabsApi ? "vorhanden" : "FEHLT – Extension neu laden"]
    ];
    (report.dashboards || []).forEach((entry) => {
      rows.push([entry.label, `${entry.tabs} Tab(s) offen · ${entry.script}`]);
    });
    return `
      <div class="sc-lookup-card">
        <span class="sc-eyebrow">Verbindungsprüfung</span>
        <div class="sc-ticket-grid">${rows.map((entry) => ticketRow(entry[0], entry[1])).join("")}</div>
        <p class="sc-input-hint">Ist hier alles in Ordnung und die Abfrage läuft trotzdem nicht, hilft der Blick in chrome://extensions unter „Service Worker“.</p>
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
          <button class="sc-text-button" type="button" data-action="lookup-diagnose" ${running ? "disabled" : ""}>Verbindung prüfen</button>
        </div>
        ${renderLookupDiagnose(state.lookup.diagnose)}
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
  // Ticketkontext als eigenständiges Widget (Phase 3), damit es ein-/ausblendbar
  // und umsortierbar ist wie die übrigen Prep-Abschnitte.
  function renderTicketContextWidget() {
    const ticket = state.ticket;
    if (!ticket) return "";
    const ref = known(ticket.customerReference) ? ticket.customerReference.trim() : "";
    return `
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
      </section>`;
  }

  // --- Kunde & Vorgeschichte (Vorbereitungs-Tab) -----------------------------
  //
  // Beantwortet die Frage, die vor dem Wählen zuerst kommt: Mit wem habe ich es
  // zu tun, und ist hier schon jemand drangewesen? Beides stand bisher nur im
  // Call-Cockpit — also erst, wenn das Gespräch bereits läuft und es zum Lesen
  // zu spät ist.
  //
  // Zwei Quellen mit unterschiedlicher Verfügbarkeit: die Kundenakte und die
  // Anrufhistorie brauchen eine CRM-Anmeldung, der offene Rückruf liegt lokal.
  // Deshalb wird der Rückruf immer gezeigt, auch ohne Anmeldung — ein „schon
  // zweimal vergeblich versucht" ist die wichtigste Zeile im ganzen Widget.

  /** Offener Rückruf zum offenen Ticket bzw. zur erkannten Kundennummer. */
  function prepCallbackEntry() {
    const items = pruneCallbacks(state.callbacks, Date.now()).filter((item) => !item.done);
    if (!items.length) return null;
    const key = state.ticket && known(state.ticket.key) ? state.ticket.key : "";
    if (key) {
      const byTicket = items.find((item) => item.ticketKey === key);
      if (byTicket) return byTicket;
    }
    const number = lookupCustomerNumber();
    if (!number) return null;
    return items.find((item) => (item.customerReference || "").trim() === number) || null;
  }

  /** "28.08., 14:32" – Datum und Uhrzeit eines vergangenen Anrufs. */
  function formatCallStamp(iso) {
    const ms = Date.parse(iso || "");
    if (!Number.isFinite(ms)) return "";
    return new Date(ms).toLocaleString("de-DE", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
    });
  }

  /** "4:12" – Gesprächsdauer in Minuten:Sekunden. */
  function formatCallDuration(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    if (!total) return "";
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")} Min.`;
  }

  function renderPrepCallHistory() {
    const pc = state.prepCustomer;
    if (!pc.calls.length) return "";
    const labels = (CONFIG.outbound && CONFIG.outbound.dispositionLabels) || {};
    const rows = pc.calls.map((call) => {
      const meta = [
        formatCallDuration(call.durationS),
        call.disposition ? (labels[call.disposition] || call.disposition) : ""
      ].filter(Boolean).join(" · ");
      return `
        <li class="sc-prepcust-call">
          <span class="sc-prepcust-call-when">${escapeHtml(formatCallStamp(call.startedAt))}</span>
          ${meta ? `<span class="sc-prepcust-call-meta">${escapeHtml(meta)}</span>` : ""}
        </li>`;
    }).join("");
    return `
      <div class="sc-prepcust-block">
        <span class="sc-eyebrow">Zuletzt telefoniert</span>
        <ul class="sc-prepcust-calls">${rows}</ul>
      </div>`;
  }

  function renderPrepCallbackHint(entry) {
    if (!entry) return "";
    const overdue = typeof entry.dueAt === "number" && entry.dueAt <= Date.now();
    const meta = [
      entry.attempts ? `${entry.attempts}. Versuch` : "",
      entry.lastOutcome,
      entry.reason
    ].filter(Boolean).join(" · ");
    return `
      <div class="sc-prepcust-callback ${overdue ? "is-due" : ""}">
        <strong>${overdue ? "Rückruf ist fällig" : `Rückruf ${escapeHtml(formatDueLabel(entry.dueAt))}`}</strong>
        ${meta ? `<p>${escapeHtml(meta)}</p>` : ""}
      </div>`;
  }

  function renderPrepCustomerBody(number) {
    const pc = state.prepCustomer;
    // Ohne Kundennummer bleibt der Rumpf leer, statt das zu melden: die
    // Netz-Auskunft im selben Tab sagt bereits „keine Kundennummer erkannt",
    // und zweimal dieselbe Absage ist ein Kasten zu viel. Bleibt auch der
    // Rückruf aus, verschwindet das Widget ganz (renderCustomerContextWidget).
    if (!number) return "";
    if (pc.status === "loading") {
      return `<div class="sc-inline-loading"><span class="sc-spinner"></span>Kundenakte wird geladen …</div>`;
    }
    if (pc.status === "not-configured") return "";
    if (pc.status === "not-logged-in") {
      return `<p class="sc-ai-message">Für Akte und Vorgeschichte fehlt die CRM-Anmeldung. <button class="sc-text-button" type="button" data-action="toggle-settings">In den Einstellungen anmelden</button></p>`;
    }
    if (pc.status === "not-found") {
      return `<p class="sc-ai-message">Kundennummer ${escapeHtml(number)} ist im CRM noch nicht bekannt – dieser Anruf ist der erste dokumentierte Kontakt.</p>`;
    }
    if (pc.status === "error") {
      return `<p class="sc-ai-message">Kundenakte gerade nicht abrufbar${pc.error ? ` (${escapeHtml(pc.error)})` : ""}. <button class="sc-text-button" type="button" data-action="reload-prep-customer">Erneut versuchen</button></p>`;
    }
    if (pc.status !== "ok" || !pc.card) return "";

    const d = pc.card;
    const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const counts = [
      count(d.contractCount, "Vertrag", "Verträge"),
      count(d.tariffChangeCount, "Wechsel", "Wechsel"),
      count(d.noteCount, "Notiz", "Notizen"),
      d.leadCount ? count(d.leadCount, "Lead", "Leads") : ""
    ].filter(Boolean).join(" · ");
    const dates = [
      d.firstSeenAt ? `Kunde seit ${formatDateDE(d.firstSeenAt)}` : "",
      // Der letzte Kontakt liefert die Antwort auf "haben wir uns kürzlich
      // gehört?" und stand bisher in keiner Ansicht, obwohl customer_card ihn
      // seit jeher mitliefert.
      d.lastContactAt ? `zuletzt ${formatDateDE(d.lastContactAt)}` : ""
    ].filter(Boolean).join(" · ");

    return `
      <div class="sc-prepcust-head">
        <strong>${escapeHtml(d.name || "Unbenannt")}</strong>
        ${d.phone ? `<span class="sc-prepcust-phone">${escapeHtml(d.phone)}</span>` : ""}
      </div>
      <p class="sc-prepcust-counts">${escapeHtml(counts)}</p>
      ${dates ? `<p class="sc-prepcust-dates">${escapeHtml(dates)}</p>` : ""}
      ${d.jiraTicket && d.jiraTicket !== (state.ticket && state.ticket.key)
        ? `<a class="sc-text-button" href="${escapeHtml(jiraTicketUrl(d.jiraTicket))}" target="_blank" rel="noopener">Letztes Ticket ${escapeHtml(d.jiraTicket)} öffnen</a>`
        : ""}
      ${renderPrepCallHistory()}`;
  }

  function renderCustomerContextWidget() {
    const number = lookupCustomerNumber();
    const callback = prepCallbackEntry();
    const body = renderPrepCustomerBody(number);
    // Ganz ohne Inhalt gar nicht erst erscheinen: ein leerer Rahmen im
    // Vorbereitungs-Tab kostet Platz und sagt nichts.
    if (!body && !callback) return "";
    return `
      <section class="sc-section sc-prepcust" aria-label="Kunde und Vorgeschichte">
        <div class="sc-section-title-row">
          <h3>Kunde &amp; Vorgeschichte</h3>
          ${number ? `<span class="sc-local-label">${escapeHtml(number)}</span>` : ""}
        </div>
        ${renderPrepCallbackHint(callback)}
        ${body}
      </section>`;
  }

  // ---------------------------------------------------------------------------
  // Tab: Call-Hilfe
  // ---------------------------------------------------------------------------

  // Bausteine fürs Mitschreiben: gemeinsame zuerst, dann die des Call-Typs.
  // Ein Klick hängt eine Zeile mit Uhrzeit an — im Gespräch ist Tippen die
  // teuerste Bewegung.
  function activeNoteChips() {
    const chips = CONFIG.noteChips || {};
    const common = Array.isArray(chips.common) ? chips.common : [];
    const perType = Array.isArray(chips[activeCallType()]) ? chips[activeCallType()] : [];
    return common.concat(perType);
  }

  function noteChipById(id) {
    return activeNoteChips().find((chip) => chip.id === id) || null;
  }

  /** "14:32" – die Uhrzeit, unter der die Zeile in der Notiz steht. */
  function noteClock() {
    return new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }

  /**
   * Baustein an die Gesprächsnotiz anhängen.
   *
   * Erst aus dem DOM einlesen (sonst ginge verloren, was seit dem letzten
   * Rendern getippt wurde), dann anhängen. Bewusst OHNE die automatische
   * KI-Umwandlung anzustoßen: die Bausteine sind das Gerüst, die KI läuft
   * danach auf Zuruf — sonst rechnete sie bei jedem Klick neu.
   */
  function appendNoteChip(id) {
    const chip = noteChipById(id);
    if (!chip) return;
    syncInputsFromDom();
    const line = `[${noteClock()}] ${chip.text}`;
    const existing = state.ai.callNotes.replace(/\s+$/, "");
    state.ai.callNotes = existing ? `${existing}\n${line}` : line;
    render();
    // Endet der Baustein offen ("Einwand Preis: "), gehört der Cursor genau
    // dorthin – dann tippt man den Rest weiter, ohne erst zu klicken.
    if (/[:\s]$/.test(chip.text)) focusNotesEnd();
    else toast(`Notiert: ${chip.label}`);
  }

  function focusNotesEnd() {
    const node = el("call-notes");
    if (!node) return;
    node.focus();
    if (typeof node.setSelectionRange === "function") {
      const end = String(node.value || "").length;
      node.setSelectionRange(end, end);
    }
  }

  /** Letzte Zeile zurücknehmen – der Weg zurück nach einem Fehlklick. */
  function removeLastNoteLine() {
    syncInputsFromDom();
    const lines = state.ai.callNotes.split("\n");
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (!lines.length) { toast("Die Notiz ist schon leer."); return; }
    lines.pop();
    state.ai.callNotes = lines.join("\n");
    render();
  }

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
    const disabled = !aiActionable() || anyBusy();
    const chips = activeNoteChips();
    const chipRow = chips.length
      ? `<div class="sc-note-chips">${chips.map((chip) =>
          `<button class="sc-note-chip" type="button" data-action="note-chip" data-chip="${escapeHtml(chip.id)}" title="${escapeHtml(chip.text)}">${escapeHtml(chip.label)}</button>`
        ).join("")}</div>`
      : "";
    return `
      <section class="sc-section sc-ai-card">
        <div class="sc-section-title-row">
          <h3>Mitschreiben</h3>
          <span class="sc-local-label">lokale KI</span>
        </div>
        <p class="sc-section-intro">Klicken statt tippen: jeder Baustein hängt eine Zeile mit Uhrzeit an. Nach einer Tipppause macht die lokale KI daraus eine saubere interne Notiz für den Abschluss.</p>
        ${chipRow}
        <textarea class="sc-comment-draft sc-note-input" data-role="call-notes" placeholder="Stichworte aus dem Gespräch …">${escapeHtml(state.ai.callNotes)}</textarea>
        <div class="sc-inline-actions">
          <button class="sc-primary-button" type="button" data-action="clean-call-notes" ${disabled ? "disabled" : ""}>${running ? "KI arbeitet …" : "In interne Notiz umwandeln"}</button>
          <button class="sc-text-button" type="button" data-action="note-undo">Letzte Zeile zurück</button>
        </div>
        ${body}
      </section>`;
  }

  // Effektiver Call-Typ: manueller Override zuerst, sonst die Kampagne der
  // heutigen Schicht, sonst "churn" als sicherer Standard. Jeder Typ mit
  // eigenem Leitfaden in CONFIG.callGuides wird direkt genommen (churn,
  // welcome, prl, dupe, bvw, courtesy); Kampagnen ohne eigenen Leitfaden
  // ("other") fallen auf churn zurück.
  function activeCallType() {
    const raw = state.callTypeOverride || (state.shift && state.shift.callType) || "churn";
    return (CONFIG.callGuides && CONFIG.callGuides[raw]) ? raw : "churn";
  }

  // Aktiver Leitfaden bzw. aktive Einwandkarten — nach Call-Typ (siehe
  // CONFIG.callGuides/objectionCards). Die Kopier-Buttons indizieren bewusst
  // in genau diese Funktionen und nicht in eine feste Config-Liste.
  function activeCallPhases() {
    const guides = CONFIG.callGuides || {};
    return guides[activeCallType()] || [];
  }

  function activeObjectionCards() {
    const cards = CONFIG.objectionCards || {};
    return cards[activeCallType()] || [];
  }

  // ---------------------------------------------------------------------------
  // Gesprächsleitfaden als Schrittwerk
  //
  // Früher lagen alle Phasen als zugeklappte Aufklapp-Abschnitte untereinander:
  // wer im Gespräch ist, liest keine Liste und klappt nichts auf. Jetzt ist
  // immer GENAU EIN Schritt groß und offen, der Rest steht als Fortschrittsleiste
  // darüber. Der Zustand ist bewusst je Call-Typ getrennt — ein Wechsel des
  // Typs (Kampagne/Override) springt nicht mitten in einen fremden Leitfaden.
  // ---------------------------------------------------------------------------

  function phaseKey(type, index) {
    return `${type}:${index}`;
  }

  /** Aktueller Schritt des laufenden Call-Typs, immer im gültigen Bereich. */
  function guideStep() {
    const total = activeCallPhases().length;
    if (!total) return 0;
    const raw = state.guide.step[activeCallType()] || 0;
    return Math.min(Math.max(0, raw), total - 1);
  }

  function setGuideStep(index) {
    const total = activeCallPhases().length;
    if (!total) return;
    state.guide.step[activeCallType()] = Math.min(Math.max(0, index), total - 1);
  }

  function isPhaseDone(index) {
    return Boolean(state.checkedPhases[phaseKey(activeCallType(), index)]);
  }

  function guideDoneCount() {
    return activeCallPhases().filter((_, i) => isPhaseDone(i)).length;
  }

  /**
   * Einen Schritt weiter oder zurück. `markDone` hakt den verlassenen Schritt
   * ab — das ist der Normalfall („Erledigt & weiter"), damit Fortschritt ohne
   * einen zweiten Klick entsteht. Am Ende der Liste wird nur noch abgehakt,
   * nicht umgebrochen: ein Sprung zurück auf Schritt 1 mitten im Gespräch wäre
   * schlimmer als ein stehender letzter Schritt.
   */
  function advanceGuide(delta, markDone) {
    const phases = activeCallPhases();
    if (!phases.length) return;
    const current = guideStep();
    if (markDone && delta > 0) state.checkedPhases[phaseKey(activeCallType(), current)] = true;
    setGuideStep(current + delta);
  }

  /** Neues Gespräch: Leitfaden von vorn, nichts abgehakt. */
  function resetGuide() {
    state.guide.step = {};
    state.guide.showAll = false;
    state.checkedPhases = {};
  }

  // --- Ticket-Zusammenfassung (lokale KI) -------------------------------------

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

    const canRun = aiActionable() && !anyBusy();
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

  // --- Gesprächsvorbereitung (lokale KI) -------------------------------------

  function renderCallPrep() {
    const prep = state.ai.callPrep;
    const running = busyOn("callprep");
    let body;
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
      const brief = (CONFIG.callPrepBriefs || {})[activeCallType()];
      body = `<p class="sc-ai-message">Aus dem Ticket entstehen Anrufziel, Gesprächspunkte, offene Fragen und die zu erwartenden Einwände – damit du beim Verbinden sofort sprechfähig bist.${
        brief && brief.ziel ? ` Ausgerichtet auf den eingestellten Anruftyp: ${escapeHtml(brief.ziel)}` : ""
      }</p>`;
    }
    const hasResult = prep.status === "ok" && Boolean(prep.data);
    const canRun = aiActionable() && !anyBusy();
    // Für welchen Anlass die Vorbereitung geschrieben ist. Sie liest sich je
    // nach Anruftyp völlig anders (local-ai.js callTypeContext) — ohne diese
    // Zeile wäre nicht erkennbar, ob gerade der richtige Typ eingestellt ist.
    const typeLabel = (CONFIG.callTypeLabels || {})[activeCallType()] || "";
    return `
      <section class="sc-section sc-ai-card">
        <div class="sc-section-title-row">
          <h3>Gesprächsvorbereitung</h3>
          ${typeLabel ? `<span class="sc-prep-type">${escapeHtml(typeLabel)}</span>` : ""}
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

  // Schreibt Disposition + Kampagne auf den calls-Datensatz (Migration 021) —
  // die Grundlage für Save-Rate und Kampagnen-Performance im Team-Dashboard.
  // Die Zeilen-ID kommt aus dem geteilten activeCall-Signal, das
  // timio-content.js schreibt (siehe persistCall dort). Best-effort: schlägt es
  // fehl, bleibt der Anruf ohne Disposition — der CRM-Eintrag entsteht trotzdem.
  function recordOutcomeDisposition(outcome, call) {
    if (!supabaseClient || !outcome || !outcome.disposition) return;
    const rowId = call && call.dbCallId;
    if (!rowId) return;
    supabaseClient.patchCallDisposition(rowId, {
      disposition: outcome.disposition,
      campaignId: (state.shift && state.shift.campaignId) || undefined
    }).catch(() => {});
  }

  // Verarbeitet ein Ergebnis – egal ob hier oder im timio-Cockpit geklickt.
  // `options.alreadyRecorded` markiert den Weg über den Storage-Staffelstab:
  // dort hat das timio-Cockpit die Disposition schon selbst geschrieben.
  function applyOutcome(outcomeId, context, options) {
    const outcome = activeOutcomes().find((entry) => entry.id === outcomeId);
    if (!outcome) return;
    const call = context || currentActiveCall() || {};
    if (!(options && options.alreadyRecorded)) recordOutcomeDisposition(outcome, currentActiveCall());

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
      // Bei „gekündigt" verlangt der Abschluss zusätzlich einen Kündigungsgrund
      // (Migration 021) — dieselbe Regel wie im timio-Cockpit, damit die
      // Kündigungsgrund-Auswertung nicht davon abhängt, wo geklickt wurde.
      // openCloseout() hat state.closeout gerade für genau dieses Ergebnis
      // angelegt bzw. beibehalten, deshalb ohne weiteren Abgleich.
      if (state.closeout) {
        state.closeout.disposition = outcome.disposition || null;
        state.closeout.needsReason = Boolean(outcome.needsReason);
      }
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
    } else {
      // Ohne Wiedervorlage gab es bisher gar keine Quittung. „Falsche Nummer"
      // und „Kein Interesse" öffnen auch kein Abschluss-Panel und wechseln den
      // Bereich nicht – nach dem Klick passierte sichtbar schlicht nichts,
      // obwohl das Ergebnis erfasst wurde. Ein Knopf, der stumm bleibt, gilt
      // als kaputt, und zwar zu Recht.
      toast(`${outcome.label} – Ergebnis erfasst.`);
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
      jiraTicket: ticketKey,
      // Kündigungsgrund (Migration 021) — nur sichtbar, wenn die gewählte
      // Ergebnis-Option „gekündigt" war (state.closeout.needsReason).
      cancellationReason: ""
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

    // Kündigungsgrund nachtragen (Migration 021): war das Ergebnis „gekündigt",
    // wird der hier erfasste Grund zusätzlich auf den calls-Datensatz
    // geschrieben. Best-effort, unabhängig vom Erfolg des CRM-Eintrags —
    // spiegelt submitCloseout() im timio-Cockpit.
    if (state.closeout && state.closeout.needsReason && supabaseClient) {
      const rowId = (currentActiveCall() || {}).dbCallId;
      const reason = (fields.cancellationReason || "").trim();
      if (rowId && reason) {
        supabaseClient.patchCallDisposition(rowId, {
          disposition: state.closeout.disposition || "gekuendigt",
          cancellationReason: reason,
          campaignId: (state.shift && state.shift.campaignId) || undefined
        }).catch(() => {});
      }
    }

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
        ${state.closeout.needsReason ? `
        <label class="sc-input-label">Kündigungsgrund
          <input class="sc-text-input" data-role="closeout-cancellation-reason" value="${escapeHtml(fields.cancellationReason || "")}" placeholder="z.B. zu teuer, Umzug, Wettbewerber">
        </label>` : ""}
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

  // Kopfzeile mit Call-Typ-Badge: zeigt den aktiven Typ und woher er stammt
  // (Kampagne der Schicht oder manuell), plus einen Umschalter als Override.
  function renderCallTypeBadge() {
    const type = activeCallType();
    const overridden = Boolean(state.callTypeOverride);
    const shift = state.shift || {};
    let source;
    if (overridden) {
      source = "manuell gewählt";
    } else if (shift.callType && shift.campaignName) {
      source = `Kampagne: ${escapeHtml(shift.campaignName)}`;
    } else if (shift.loaded) {
      source = "keine Kampagne heute – Standard";
    } else {
      source = "Schicht wird geladen …";
    }
    const btn = (id, label) =>
      `<button class="sc-calltype-toggle ${type === id ? "is-active" : ""}" type="button" data-action="set-call-type" data-call-type="${id}" aria-pressed="${type === id}">${label}</button>`;
    // Ein Umschalter je vorhandenem Leitfaden — neue Kampagnen tauchen
    // automatisch auf, sobald sie in CONFIG.callGuides stehen.
    const labels = CONFIG.callTypeLabels || {};
    const switchHtml = Object.keys(CONFIG.callGuides || {})
      .map((id) => btn(id, labels[id] || id))
      .join("");
    return `
      <div class="sc-calltype">
        <div class="sc-calltype-switch">${switchHtml}</div>
        <span class="sc-calltype-source">${source}</span>
        ${renderShiftClock()}
      </div>`;
  }

  /**
   * Restzeit der laufenden Schicht im Cockpit.
   *
   * Dieselbe Rechnung wie im CRM-Dashboard — beide lesen SHIFT_TIMES aus
   * shift-time.js, damit Cockpit und CRM nicht unterschiedliche Feierabende
   * behaupten. Ohne geladene Schicht oder außerhalb einer Arbeitsschicht
   * bleibt die Anzeige leer statt „0 Min." zu behaupten.
   */
  function renderShiftClock() {
    const st = globalThis.StadtnetzCRM && globalThis.StadtnetzCRM.shiftTime;
    const shift = state.shift || {};
    if (!st || !shift.loaded || !shift.shiftType) return "";
    const progress = st.shiftProgress(shift.shiftType, st.minutesOfDay());
    if (!progress) return "";

    const meta = st.shiftMeta(shift.shiftType);
    let text;
    if (progress.phase === "before") {
      text = `${meta.label} beginnt in ${st.formatDuration(progress.minutesLeft)}`;
    } else if (progress.phase === "running") {
      text = `${meta.label} · noch ${st.formatDuration(progress.minutesLeft)}`;
    } else {
      text = `${meta.label} beendet`;
    }
    const pct = Math.round(progress.progress * 100);
    return `
      <span class="sc-shift-clock" title="${escapeHtml(st.shiftTimeLabel(shift.shiftType) || "")}">
        <span class="sc-shift-clock-track"><span class="sc-shift-clock-fill" style="width:${pct}%"></span></span>
        <span class="sc-shift-clock-text">${escapeHtml(text)}</span>
      </span>`;
  }

  // Ein Schritt der Fortschrittsleiste: erledigt (✓), gerade dran oder noch
  // offen. Anklickbar, damit man auch springen kann — Gespräche laufen nicht
  // immer in der gedachten Reihenfolge.
  function renderGuideRail(phases, current) {
    return phases.map((phase, index) => {
      const done = isPhaseDone(index);
      const cls = `sc-guide-pip ${done ? "is-done" : ""} ${index === current ? "is-current" : ""}`;
      return `<button class="${cls}" type="button" data-action="guide-step" data-phase-index="${index}"
        title="${escapeHtml(phase.title)}" aria-label="${escapeHtml(phase.title)}" aria-current="${index === current}">${done ? "✓" : index + 1}</button>`;
    }).join("");
  }

  // Die alte Gesamtliste — jetzt eingeklappt hinter „Alle Schritte". Zum
  // Nachschlagen zwischen zwei Gesprächen bleibt sie der schnellere Weg.
  function renderGuideAll(phases) {
    return `
      <div class="sc-call-list">
        ${phases.map((phase, index) => {
          const done = isPhaseDone(index);
          return `
            <details class="sc-call-phase ${done ? "is-done" : ""}">
              <summary>${escapeHtml(phase.title)}</summary>
              <p>${escapeHtml(phase.prompt)}</p>
              <button class="sc-text-button" type="button" data-action="guide-step" data-phase-index="${index}">Hier weitermachen</button>
            </details>`;
        }).join("")}
      </div>`;
  }

  function renderCallGuide() {
    const phases = activeCallPhases();
    const cards = activeObjectionCards();
    const noteTemplate =
      "Angerufen: [Kundenname]\nAnlass: [Warum habe ich angerufen?]\nBesprochen: [Wichtigste Punkte]\nErgebnis: [Was wurde geklärt / zugesagt?]\nNächster Schritt: [Wer macht was bis wann?]";

    const current = guideStep();
    const phase = phases[current];
    const done = guideDoneCount();
    const isLast = current >= phases.length - 1;
    const next = phases[current + 1];
    const nextKey = shared.hotkeyLabel(hotkey("guideNext"));
    const prevKey = shared.hotkeyLabel(hotkey("guidePrev"));

    const stepper = phase
      ? `
        <div class="sc-guide">
          <div class="sc-guide-head">
            <span class="sc-guide-count">Schritt ${current + 1} von ${phases.length}</span>
            <span class="sc-guide-done">${done} erledigt</span>
          </div>
          <div class="sc-guide-rail">${renderGuideRail(phases, current)}</div>
          <article class="sc-guide-current ${isPhaseDone(current) ? "is-done" : ""}">
            <h4><button class="sc-checklist-box ${isPhaseDone(current) ? "is-checked" : ""}" type="button" data-action="toggle-phase" data-phase-index="${current}" aria-pressed="${isPhaseDone(current)}" title="Abhaken">${isPhaseDone(current) ? "✓" : ""}</button>${escapeHtml(phase.title)}</h4>
            <p>${escapeHtml(phase.prompt)}</p>
          </article>
          <div class="sc-guide-actions">
            <button class="sc-guide-back" type="button" data-action="guide-prev" ${current === 0 ? "disabled" : ""}
              title="Ein Schritt zurück${prevKey ? ` (${escapeHtml(prevKey)})` : ""}" aria-label="Ein Schritt zurück">←</button>
            <button class="sc-primary-button sc-guide-next" type="button" data-action="guide-next"
              title="${isLast ? "Letzten Schritt abhaken" : "Abhaken und weiter"}${nextKey ? ` (${escapeHtml(nextKey)})` : ""}">${isLast ? "Abhaken" : "Erledigt & weiter"}</button>
            <button class="sc-text-button sc-guide-copy" type="button" data-action="copy-call-phase" data-phase-index="${current}">Satz kopieren</button>
          </div>
          ${next ? `<p class="sc-guide-next-hint">Als Nächstes: ${escapeHtml(next.title)}</p>` : `<p class="sc-guide-next-hint">Letzter Schritt — danach das Ergebnis erfassen.</p>`}
        </div>`
      : `<p class="sc-ai-message">Für diesen Call-Typ ist kein Leitfaden hinterlegt.</p>`;

    return `
      <section class="sc-section">
        <div class="sc-section-title-row">
          <h3>Gesprächsleitfaden</h3>
          <button class="sc-icon-button" type="button" data-action="copy-call-note" title="Notizvorlage kopieren" aria-label="Notizvorlage kopieren">⧉</button>
        </div>
        ${renderCallTypeBadge()}
        ${stepper}
        <button class="sc-text-button sc-guide-toggle" type="button" data-action="guide-toggle-all">${state.guide.showAll ? "Alle Schritte ausblenden" : `Alle ${phases.length} Schritte zeigen`}</button>
        ${state.guide.showAll ? renderGuideAll(phases) : ""}
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

  // ---------------------------------------------------------------------------
  // Kontextkopf im Tab „Gespräch"
  //
  // Bisher stand hier eine Visitenkarte mit Name, Nummer und Ergebnisleiste –
  // alles Weitere (Ticket-Abgleich, Kundenakte, Anrufziel) lag im schwebenden
  // Cockpit oder in einem anderen Tab. Wer telefoniert, wechselt keine Tabs:
  // was während des Sprechens im Blick sein muss, steht jetzt an einer Stelle
  // und in dieser Reihenfolge – wer ist dran, passt das offene Ticket, was
  // weiß das CRM, was will ich von dieser Person.
  // ---------------------------------------------------------------------------

  // Abgleich Anrufer ↔ offenes Ticket als eine Aussage statt als Tabelle.
  function renderCallTicketLine(call) {
    const match = cockpitTicketMatch(call);
    if (match === "mismatch") {
      return `<p class="sc-callhead-line is-mismatch">⚠ Offenes Ticket ${escapeHtml(state.ticket.key)} gehört zu Kundenreferenz ${escapeHtml(state.ticket.customerReference)} — nicht zu diesem Anrufer.</p>`;
    }
    if (match === "match") {
      const t = state.ticket;
      return `<p class="sc-callhead-line is-match">✓ ${escapeHtml(t.key)} passt: ${escapeHtml(t.summary)}</p>`;
    }
    return `<p class="sc-callhead-line is-unknown">Kein Ticket-Abgleich möglich — Vorgang mit passender Kundennummer öffnen.</p>`;
  }

  // Anrufziel aus der Vorbereitung: die Antwort auf „warum rufe ich an".
  function renderCallGoalLine() {
    const prep = state.ai.callPrep;
    if (prep.status !== "ok" || !prep.data || !prep.data.ziel) return "";
    return `<p class="sc-callhead-goal"><span>Ziel</span>${escapeHtml(prep.data.ziel)}</p>`;
  }

  // Ohne aktives Gespräch bleibt der Kopf stehen und sagt, worauf er wartet –
  // sonst wäre der Tab kopflos und man wüsste nicht, welcher Vorgang geladen ist.
  function renderCallHeadIdle() {
    const t = state.ticket;
    const hasTicket = t && known(t.key);
    return `
      <section class="sc-section sc-callhead is-idle" aria-label="Gesprächskontext">
        <div class="sc-callhead-top">
          <span class="sc-callhead-status">Kein Gespräch aktiv</span>
        </div>
        ${hasTicket
          ? `<strong class="sc-callhead-name">${escapeHtml(known(t.customerName) ? t.customerName : t.summary)}</strong>
             <p class="sc-callhead-meta">${escapeHtml(t.key)}${known(t.customerReference) ? ` · Kundennummer ${escapeHtml(t.customerReference)}` : ""}</p>`
          : `<p class="sc-callhead-meta">Kein Vorgang geöffnet. Sobald timio wählt, steht hier, mit wem du sprichst.</p>`}
        ${renderCallGoalLine()}
      </section>`;
  }

  function renderActiveCallCard() {
    const call = currentActiveCall();
    if (!call) return renderCallHeadIdle();
    const meta = shared.callStatusMeta(call.status, state.callMode);
    const nameLine = call.callerName || call.callerNumber || "Unbekannter Gesprächspartner";
    const timer = callTimerText(call, call.connectedAt);
    const details = [
      call.callerNumber,
      call.customerNumber ? `Kundennummer ${call.customerNumber}` : "",
      call.group
    ].filter(Boolean).join(" · ");
    return `
      <section class="sc-section sc-callhead sc-active-call ${meta.cls}" aria-label="Gesprächskontext">
        <div class="sc-callhead-top">
          <span class="sc-callhead-status">${escapeHtml(meta.label)}</span>
          ${timer ? `<span class="sc-callhead-timer" data-role="call-head-timer">${escapeHtml(timer)}</span>` : ""}
          <span class="sc-local-label">aus timio</span>
        </div>
        <strong class="sc-callhead-name">${escapeHtml(nameLine)}</strong>
        ${details ? `<p class="sc-callhead-meta">${escapeHtml(details)}</p>` : ""}
        ${renderCallTicketLine(call)}
        ${renderKundenakte(call)}
        ${renderCallGoalLine()}
        <div class="sc-inline-actions sc-callhead-actions">
          ${renderCustomerSearchButton(call, "sc-secondary-button")}
          <button class="sc-text-button" type="button" data-action="add-callback">Rückruf notieren</button>
        </div>
        ${renderOutcomeBar(call)}
      </section>`;
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

  // Sichtbare Farbrollen im Theme-Editor + deutsche Labels. amberSoft bleibt
  // bewusst ausgeblendet (abgeleitete Hintergrundfarbe des Outbound-Akzents,
  // ändert sich selten unabhängig von "amber").
  const THEME_COLOR_FIELDS = [
    ["accent", "Akzentfarbe"],
    ["accentDark", "Akzentfarbe (dunkel)"],
    ["surface", "Hintergrund"],
    ["soft", "Hintergrund (weich)"],
    ["ink", "Text"],
    ["muted", "Text (gedämpft)"],
    ["line", "Rahmen"],
    ["success", "Erfolg"],
    ["warning", "Warnung"],
    ["danger", "Fehler"],
    ["amber", "Outbound-Akzent"]
  ];

  /** Statuszeile der CRM-Übernahme — sagt, woher die Farben gerade kommen. */
  function crmThemeStatusText() {
    const sync = state.themeSync;
    if (sync.status === "loading") return "Wird abgeglichen …";
    if (sync.status === "error") return sync.error || "Abgleich fehlgeschlagen.";
    if (!sync.cached) return "Noch nicht abgeglichen.";
    const count = Object.keys(sync.cached.overrides).length;
    if (count === 0) return "Im CRM ist das Standard-Schema eingestellt — hier gelten die Panel-Farben.";
    const when = sync.at ? new Date(sync.at).toLocaleString("de-DE") : "";
    return `${count} Farbrollen aus dem CRM übernommen${when ? ` · Stand ${when}` : ""}.`;
  }

  function renderThemeSection() {
    const useCrm = state.themeSync.useCrm;
    // Die Swatches zeigen, was tatsächlich gilt — bei aktiver Übernahme also
    // die CRM-Farben, nicht die (weiterhin gespeicherte) lokale Auswahl.
    const theme = effectiveTheme();
    const colors = themeEngine.resolveThemeColors(theme);
    const locked = useCrm ? " disabled" : "";
    return `
      <section class="sc-section">
        <div class="sc-section-title-row">
          <h3>Darstellung</h3>
          <span class="sc-local-label">${useCrm ? "aus dem CRM" : "nur lokal"}</span>
        </div>
        <label class="sc-check-label">
          <input type="checkbox" data-action="toggle-theme-from-crm" ${useCrm ? "checked" : ""}>
          <span>Farbschema aus dem CRM übernehmen<small>Übernimmt die im CRM unter „Einstellungen → Darstellung" gewählten Farben, damit Panel und CRM gleich aussehen. Hell/Dunkel richtet sich weiterhin nach dem Betriebssystem.</small></span>
        </label>
        ${useCrm ? `
        <div class="sc-theme-sync">
          <span class="sc-theme-sync-status">${escapeHtml(crmThemeStatusText())}</span>
          <button class="sc-theme-preset" type="button" data-action="refresh-crm-theme"${state.themeSync.status === "loading" ? " disabled" : ""}>Jetzt abgleichen</button>
        </div>` : ""}
        <div class="sc-theme-presets">
          <button class="sc-theme-preset ${!useCrm && theme.presetId === "jira" ? "is-active" : ""}" type="button" data-action="set-theme-preset" data-preset="jira"${locked}>Jira</button>
          <button class="sc-theme-preset ${!useCrm && theme.presetId === "crm" ? "is-active" : ""}" type="button" data-action="set-theme-preset" data-preset="crm"${locked}>CRM</button>
          <button class="sc-theme-preset" type="button" data-action="reset-theme"${locked}>Zurücksetzen</button>
        </div>
        <div class="sc-theme-colors">
          ${THEME_COLOR_FIELDS.map(([role, label]) => `
            <label class="sc-theme-swatch" title="${escapeHtml(label)}">
              <input type="color" data-role="set-theme-color-${role}" value="${colors[role]}" aria-label="${escapeHtml(label)}"${locked}>
              <span>${label}</span>
            </label>`).join("")}
        </div>
      </section>`;
  }

  // --- Tastenkürzel ---------------------------------------------------------

  // Systemweite Kürzel registriert die Desktop-App, nicht die Seite. In Chrome
  // gibt es sie deshalb gar nicht – dort werden ihre Zeilen weggelassen, statt
  // Schalter anzubieten, die nichts bewirken.
  function globalHotkeysAvailable() {
    const host = hudHost();
    return Boolean(host && typeof host.globalHotkey === "function");
  }

  function hotkeyRows() {
    return shared.hotkeyDefs().filter((def) => def.scope !== "global" || globalHotkeysAvailable());
  }

  /** Wie bei hotkey(), aber systemweite kommen aus dem Speicher der App. */
  function hotkeyValue(def) {
    if (def.scope !== "global") return hotkey(def.id);
    const host = hudHost();
    // Ohne Gastgeber (also in Chrome) ist der wahre Stand nicht bekannt – dort
    // gilt für die Kollisionsprüfung die Voreinstellung. Besser als gar nichts:
    // die systemweiten Kürzel greifen auch im Browser, und wer sich hier ⌘⇧Space
    // auf die Palette legte, bekäme statt ihrer die Auskunft.
    return host ? host.globalHotkey(def.id) : shared.hotkeyDefault(def.id);
  }

  // Warum ein Kürzel nicht wirkt, obwohl es dasteht: ein anderes Programm hat
  // es systemweit belegt (die Desktop-App meldet das zurück). Ohne diesen
  // Hinweis sucht man den Fehler bei sich.
  function hotkeyProblem(def) {
    if (def.scope !== "global") return "";
    const host = hudHost();
    return (typeof host.globalHotkeyError === "function" && host.globalHotkeyError(def.id)) || "";
  }

  function renderHotkeyRow(def) {
    const capturing = state.hotkeyCapture.id === def.id;
    const binding = hotkeyValue(def);
    const label = binding ? shared.hotkeyLabel(binding) : "aus";
    const problem = hotkeyProblem(def);
    const changed = binding !== def.default;
    return `
      <div class="sc-hotkey-row ${capturing ? "is-capturing" : ""}">
        <div class="sc-hotkey-text">
          <strong>${escapeHtml(def.label)}</strong>
          <small>${escapeHtml(def.hint)}${def.scope === "global" ? " Gilt nur auf diesem Gerät." : ""}</small>
          ${capturing && state.hotkeyCapture.error ? `<small class="sc-hotkey-error">${escapeHtml(state.hotkeyCapture.error)}</small>` : ""}
          ${!capturing && problem ? `<small class="sc-hotkey-error">${escapeHtml(problem)}</small>` : ""}
        </div>
        <button class="sc-hotkey-key ${capturing ? "is-capturing" : ""} ${binding ? "" : "is-off"}" type="button"
                data-action="capture-hotkey" data-hotkey="${escapeHtml(def.id)}"
                title="Anklicken und die gewünschte Tastenkombination drücken">${capturing ? "Taste drücken …" : escapeHtml(label)}</button>
        <button class="sc-icon-button sc-hotkey-reset" type="button" data-action="reset-hotkey" data-hotkey="${escapeHtml(def.id)}"
                title="Auf ${escapeHtml(shared.hotkeyLabel(def.default))} zurücksetzen" aria-label="Zurücksetzen"${changed ? "" : " disabled"}>↺</button>
      </div>`;
  }

  function renderHotkeySection() {
    const rows = hotkeyRows();
    if (!rows.length) return "";
    return `
      <section class="sc-section">
        <div class="sc-section-title-row">
          <h3>Tastenkürzel</h3>
          <span class="sc-local-label">nur lokal</span>
        </div>
        <p class="sc-section-intro">Anklicken und die gewünschte Kombination drücken. <strong>Esc</strong> bricht ab, <strong>Rücktaste</strong> schaltet ein Kürzel ganz aus. Doppelt vergeben geht nicht – die Meldung sagt dann, wer die Taste schon hat.</p>
        ${rows.map(renderHotkeyRow).join("")}
        <div class="sc-inline-actions">
          <button class="sc-secondary-button" type="button" data-action="reset-hotkeys">Alle zurücksetzen</button>
        </div>
      </section>`;
  }

  // Während einer Aufnahme gehört jeder Tastendruck der Zeile – sonst löste man
  // beim Belegen genau die Aktion aus, die man gerade umlegen will.
  function captureHotkeyFromEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    const id = state.hotkeyCapture.id;
    if (event.key === "Escape") {
      state.hotkeyCapture = { id: "", error: "" };
      render();
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      applyHotkey(id, "");
      return;
    }
    const binding = shared.hotkeyFromEvent(event);
    // Nur Zusatztasten gedrückt: weiter warten, das ist noch kein Kürzel.
    if (binding) applyHotkey(id, binding);
  }

  function applyHotkey(id, binding) {
    const def = shared.hotkeyDefs().find((entry) => entry.id === id);
    if (!def) return;

    // Gegen alles prüfen, was gerade gilt – auch gegen die systemweiten, denn
    // die schlucken den Tastendruck, bevor das Panel ihn sieht.
    const current = {};
    shared.hotkeyDefs().forEach((entry) => { current[entry.id] = hotkeyValue(entry); });
    const clash = binding ? shared.hotkeyConflict(id, binding, current) : "";
    if (clash) {
      const other = shared.hotkeyDefs().find((entry) => entry.id === clash);
      state.hotkeyCapture = { id, error: `Schon belegt: ${(other && other.label) || clash}` };
      render();
      return;
    }

    if (def.scope === "global") {
      hudHost().setGlobalHotkey(id, binding);
    } else if (binding === def.default) {
      // Zurück auf die Voreinstellung heißt: keine eigene Angabe mehr. Sonst
      // bliebe eine Kopie stehen, die eine spätere Änderung der Voreinstellung
      // still aussitzt.
      delete state.hotkeys[id];
      persistHotkeys();
    } else {
      state.hotkeys[id] = binding;
      persistHotkeys();
    }
    state.hotkeyCapture = { id: "", error: "" };
    render();
  }

  function resetHotkey(id) {
    const def = shared.hotkeyDefs().find((entry) => entry.id === id);
    if (!def) return;
    applyHotkey(id, def.default);
  }

  function resetAllHotkeys() {
    shared.hotkeyDefs().forEach((def) => {
      if (def.scope === "global") {
        if (globalHotkeysAvailable()) hudHost().setGlobalHotkey(def.id, def.default);
        return;
      }
      delete state.hotkeys[def.id];
    });
    persistHotkeys();
    state.hotkeyCapture = { id: "", error: "" };
    render();
    toast("Tastenkürzel zurückgesetzt.");
  }

  function renderSettings() {
    const s = state.settings;
    return `
      ${hostHtml("settings")}
      ${renderHotkeySection()}
      ${renderSupabaseLoginSection()}
      ${renderThemeSection()}
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
        <p class="sc-section-intro">Alle Daten dieser Extension (Einstellungen, KI-Gesprächsvorbereitung pro Ticket, Anruf-Status und Rückrufliste) liegen ausschließlich lokal in deinem Chrome-Profil. Die KI läuft auf dem Gerät, es gibt keinen Cloud-Dienst und keine Übertragung. Hier kannst du alles vollständig löschen.</p>
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
    state.theme = { presetId: "jira", overrides: {} };
    state.themeSync = { useCrm: false, cached: null, at: 0, status: "idle", error: "" };
    applyCurrentTheme();
    state.layout = { customizeMode: false, tabs: {} };
    state.activeCall = null;
    state.callOverlay = { mode: "full", pos: null, dismissedForCallId: null };
    state.callMode = "outbound";
    state.callbacks = [];
    state.supabaseSession = null;
    state.supabaseAuth = { name: "", pin: "", busy: false, error: "" };
    state.customerCard = null;
    state.lookup = { result: null, confirm: null, customerInput: "", diagnose: null };
    state.bridgeState = null;
    state.closeout = null;
    state.sharedSettings = { status: "idle", data: null, error: "" };
    if (state.ticket) hydrateAiFromCache(state.ticket);
    render();
    toast("Alle lokalen Daten wurden gelöscht.");
  }

  // ---------------------------------------------------------------------------
  // Widget-Layout (Phase 3): die Tabs „prep" und „talk" bestehen aus mehreren
  // eigenständigen Abschnitten. Im Anpassen-Modus lassen sie sich ausblenden und
  // umsortieren. Standard = Reihenfolge unten, nichts ausgeblendet — wer nichts
  // anpasst, sieht exakt die bisherige Ansicht.
  // ---------------------------------------------------------------------------

  const WIDGET_REGISTRY = {
    prep: [
      { id: "ticket-context", label: "Ticketkontext", render: renderTicketContextWidget },
      { id: "customer-context", label: "Kunde & Vorgeschichte", render: renderCustomerContextWidget },
      { id: "summary", label: "Ticket-Zusammenfassung", render: renderSummary },
      { id: "call-prep", label: "Gesprächsvorbereitung", render: renderCallPrep },
      { id: "netzauskunft", label: "Netz-Auskunft", render: renderNetzauskunft }
    ],
    talk: [
      { id: "active-call", label: "Gesprächskontext", render: renderActiveCallCard },
      { id: "call-guide", label: "Leitfaden & Einwände", render: renderCallGuide },
      { id: "call-draft", label: "Mitschreiben", render: renderCallDraft }
    ]
  };

  function widgetById(tabId, id) {
    return (WIDGET_REGISTRY[tabId] || []).find((w) => w.id === id) || null;
  }

  // Auflösung: gespeicherte Reihenfolge zuerst (nur bekannte Ids), neue Widgets
  // hinten angehängt, ausgeblendete gefiltert. Robust gegen später entfernte
  // oder hinzugefügte Widgets.
  function resolveTabLayout(tabId) {
    const registry = WIDGET_REGISTRY[tabId] || [];
    const ids = registry.map((w) => w.id);
    const stored = state.layout && state.layout.tabs && state.layout.tabs[tabId];
    const order = [];
    if (stored && Array.isArray(stored.order)) {
      stored.order.forEach((id) => { if (ids.indexOf(id) >= 0 && order.indexOf(id) < 0) order.push(id); });
    }
    ids.forEach((id) => { if (order.indexOf(id) < 0) order.push(id); });
    const hidden = (stored && Array.isArray(stored.hidden)) ? stored.hidden.filter((id) => ids.indexOf(id) >= 0) : [];
    return { order, hidden };
  }

  function setTabLayout(tabId, next) {
    state.layout.tabs[tabId] = { order: next.order.slice(), hidden: next.hidden.slice() };
    persistLayout();
    render();
  }

  function moveWidget(tabId, id, dir) {
    const s = resolveTabLayout(tabId);
    const i = s.order.indexOf(id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= s.order.length) return;
    const order = s.order.slice();
    const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    setTabLayout(tabId, { order, hidden: s.hidden });
  }

  function hideWidget(tabId, id) {
    const s = resolveTabLayout(tabId);
    if (s.hidden.indexOf(id) < 0) s.hidden.push(id);
    setTabLayout(tabId, s);
  }

  function showWidget(tabId, id) {
    const s = resolveTabLayout(tabId);
    setTabLayout(tabId, { order: s.order, hidden: s.hidden.filter((x) => x !== id) });
  }

  function resetLayout() {
    state.layout.tabs = {};
    persistLayout();
    render();
  }

  // Ein Widget im Anpassen-Modus mit Werkzeugleiste (verschieben/ausblenden)
  // umhüllen; außerhalb des Modus unverändert das nackte Markup ausliefern,
  // damit die Standardansicht pixelgleich bleibt.
  function wrapWidget(tabId, w, editing) {
    const html = w.render();
    if (!editing) return html || "";
    const body = html || `<section class="sc-section sc-widget-empty">Zurzeit ohne Inhalt.</section>`;
    return `
      <div class="sc-widget-shell" data-widget-id="${w.id}">
        <div class="sc-widget-bar">
          <span class="sc-widget-name">${escapeHtml(w.label)}</span>
          <span class="sc-widget-tools">
            <button class="sc-widget-tool" type="button" data-action="widget-move" data-tab="${tabId}" data-widget="${w.id}" data-dir="up" title="Nach oben" aria-label="Nach oben">↑</button>
            <button class="sc-widget-tool" type="button" data-action="widget-move" data-tab="${tabId}" data-widget="${w.id}" data-dir="down" title="Nach unten" aria-label="Nach unten">↓</button>
            <button class="sc-widget-tool sc-widget-tool--hide" type="button" data-action="widget-hide" data-tab="${tabId}" data-widget="${w.id}" title="Ausblenden" aria-label="Ausblenden">✕</button>
          </span>
        </div>
        ${body}
      </div>`;
  }

  // Kopfleiste des Anpassen-Modus: erklärt den Modus und bietet ausgeblendete
  // Widgets zum Wieder-Einblenden sowie „Zurücksetzen" / „Fertig".
  function renderWidgetEditor(tabId) {
    const { hidden } = resolveTabLayout(tabId);
    const chips = hidden.map((id) => {
      const w = widgetById(tabId, id);
      return w ? `<button class="sc-widget-readd" type="button" data-action="widget-show" data-tab="${tabId}" data-widget="${w.id}">+ ${escapeHtml(w.label)}</button>` : "";
    }).join("");
    return `
      <div class="sc-widget-editor">
        <div class="sc-widget-editor-head">
          <span>Layout anpassen: Widgets verschieben (↑↓) oder ausblenden (✕).</span>
          <div class="sc-inline-actions">
            <button class="sc-text-button" type="button" data-action="reset-layout">Zurücksetzen</button>
            <button class="sc-primary-button" type="button" data-action="toggle-customize">Fertig</button>
          </div>
        </div>
        ${hidden.length ? `<div class="sc-widget-hidden-tray"><span class="sc-eyebrow">Ausgeblendet</span>${chips}</div>` : ""}
      </div>`;
  }

  // Baut einen Tab aus seinem Widget-Registry zusammen (Reihenfolge/Sichtbarkeit
  // aus state.layout). `leading` ist optionaler Inhalt vor den Widgets (z. B. der
  // KI-Statusbanner im Prep-Tab), der nicht anpassbar ist.
  function renderTabWidgets(tabId, leading) {
    const editing = state.layout.customizeMode;
    const { order, hidden } = resolveTabLayout(tabId);
    const parts = order
      .filter((id) => hidden.indexOf(id) < 0)
      .map((id) => { const w = widgetById(tabId, id); return w ? wrapWidget(tabId, w, editing) : ""; })
      .join("");
    return `${editing ? renderWidgetEditor(tabId) : ""}${leading || ""}${parts}`;
  }

  // Hinweis im Anpassen-Modus für Tabs ohne anpassbare Widgets.
  function customizeNote() {
    return state.layout.customizeMode
      ? `<div class="sc-widget-editor"><div class="sc-widget-editor-head"><span>Dieser Bereich hat keine anpassbaren Widgets.</span><button class="sc-primary-button" type="button" data-action="toggle-customize">Fertig</button></div></div>`
      : "";
  }

  function activeContent() {
    switch (state.activeTab) {
      case "talk": return renderTabWidgets("talk");
      case "close": return customizeNote() + renderClose();
      case "callbacks": return customizeNote() + renderCallbacksTab();
      default: return renderTabWidgets("prep", renderAiBanner());
    }
  }

  // Woran man im Kopf erkennt, worüber man gerade spricht: der offene Vorgang,
  // ersatzweise die Kampagne der Schicht. Bewusst knapp – der Kopf ist eine
  // Zeile, keine Visitenkarte.
  function headerContext() {
    const ticket = state.ticket;
    if (ticket && ticket.key && ticket.key !== jiraReader.UNKNOWN) return ticket.key;
    if (state.shift && state.shift.campaignName) return state.shift.campaignName;
    return "";
  }

  function rootMarkup() {
    const tabs = CONFIG.tabs.map((tab) => `
      <button class="sc-tab ${state.activeTab === tab.id ? "is-active" : ""}" type="button" role="tab" aria-selected="${state.activeTab === tab.id}" data-action="switch-tab" data-tab="${tab.id}">${escapeHtml(tab.label)}</button>`).join("");
    const context = headerContext();
    return `
      ${renderCallCockpit()}
      <button class="sc-launcher ${state.isOpen ? "is-hidden" : ""}" type="button" data-action="open-panel" aria-label="Stadtnetz CRM Outbound öffnen">
        <span>Out</span><span>bound</span>
      </button>
      <aside class="sc-panel ${state.isOpen ? "is-open" : ""}" aria-label="Stadtnetz CRM Outbound">
        <header class="sc-panel-header">
          <div class="sc-panel-id">
            ${hostHtml("headerStatus")}
            <span class="sc-panel-name">Outbound</span>
            ${context ? `<span class="sc-panel-context" title="${escapeHtml(context)}">${escapeHtml(context)}</span>` : ""}
          </div>
          <div class="sc-header-actions">
            ${hostHtml("headerActions")}
            ${state.settingsOpen ? "" : `<button class="sc-icon-button ${state.layout.customizeMode ? "is-active" : ""}" type="button" data-action="toggle-customize" title="Layout anpassen" aria-label="Layout anpassen">▦</button>`}
            <button class="sc-icon-button ${state.settingsOpen ? "is-active" : ""}" type="button" data-action="toggle-settings" title="Einstellungen" aria-label="Einstellungen">⚙</button>
            <button class="sc-icon-button" type="button" data-action="refresh" title="Ticketdaten aktualisieren" aria-label="Ticketdaten aktualisieren">↻</button>
            <button class="sc-icon-button" type="button" data-action="close-panel" title="Panel minimieren" aria-label="Panel minimieren">×</button>
          </div>
        </header>
        ${hostHtml("banner")}
        ${renderBridgeBanner()}
        ${renderActiveCallBanner()}
        ${state.settingsOpen ? "" : `<nav class="sc-tabs" role="tablist" aria-label="Bereiche">${tabs}</nav>`}
        <main class="sc-panel-content">${state.settingsOpen ? renderSettings() : activeContent()}</main>
        <div class="sc-toast ${toastVisible() ? "is-visible" : ""}" role="status" aria-live="polite">${escapeHtml(toastVisible() ? state.toast.text : "")}</div>
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

  // Steht der Fokus in einem Eingabefeld? Dann gehört der Tastendruck dorthin.
  function isTypingTarget(target) {
    if (!target) return false;
    const tag = String(target.tagName || "").toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable === true;
  }

  function onGlobalKeydown(event) {
    // Nach einem Extension-Reload arbeitet die alte Instanz auf einem toten
    // Chrome-Kontext — dann die Palette gar nicht erst öffnen (der Listener
    // lässt sich ohne eigenen Shutdown-Pfad in ui.js nicht sauber abmelden).
    if (!extensionAlive()) return;
    // Nimmt eine Zeile in den Einstellungen gerade ein Kürzel auf, gehört ihr
    // jeder Tastendruck.
    if (state.hotkeyCapture.id) { captureHotkeyFromEvent(event); return; }
    const isToggleCombo = shared.hotkeyMatches(event, hotkey("palette"));
    if (isToggleCombo) {
      event.preventDefault();
      if (state.palette && state.palette.open) closePalette(); else openPalette();
      return;
    }
    // Leitfaden weiterschalten, ohne zur Maus zu greifen — das ist der Punkt
    // eines Schrittwerks. Nicht, während in einem Feld getippt wird: dort
    // gehören dieselben Tasten der Textbearbeitung (Zeilenanfang/-ende).
    if (!isTypingTarget(event.target)) {
      if (shared.hotkeyMatches(event, hotkey("guideNext"))) {
        event.preventDefault();
        advanceGuide(1, true);
        render();
        return;
      }
      if (shared.hotkeyMatches(event, hotkey("guidePrev"))) {
        event.preventDefault();
        advanceGuide(-1, false);
        render();
        return;
      }
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
  // Bereiche mit eigener Bildlaufleiste. Sie werden beim Neuaufbau des Panels
  // neu erzeugt und stünden danach wieder ganz oben – deshalb wird ihre Position
  // gesichert und zurückgesetzt.
  const SCROLL_KEEPERS = [".sc-panel-content", ".sc-cockpit-body", ".sc-cockpit-summary", "[data-keep-scroll]"];

  function captureScroll(container) {
    const saved = [];
    SCROLL_KEEPERS.forEach((selector) => {
      let nodes;
      try { nodes = container.querySelectorAll(selector); } catch (error) { return; }
      Array.prototype.forEach.call(nodes || [], (node, index) => {
        if (node && node.scrollTop) saved.push({ selector, index, top: node.scrollTop });
      });
    });
    return saved;
  }

  function restoreScroll(container, saved) {
    saved.forEach((entry) => {
      let nodes;
      try { nodes = container.querySelectorAll(entry.selector); } catch (error) { return; }
      const node = nodes && nodes[entry.index];
      // Ist der Inhalt kürzer geworden, begrenzt der Browser den Wert selbst.
      if (node) node.scrollTop = entry.top;
    });
  }

  // Zuletzt geschriebenes Markup. Ein Neuaufbau, der exakt dasselbe erzeugt, wird
  // übersprungen: er würde nur flackern, den Fokus stören und die Bildlaufposition
  // zurücksetzen. Das ist der Normalfall, seit der Hintergrund-Dienst während
  // einer Abfrage im Takt Lebenszeichen schreibt – jedes davon löste bisher einen
  // vollständigen Neuaufbau aus, und das Panel sprang nach oben.
  let lastMarkup = null;

  function render() {
    const container = root();
    if (!container) return;

    const markup = rootMarkup();
    if (markup === lastMarkup) return;
    lastMarkup = markup;

    const active = document.activeElement;
    let focusRole = null;
    let selection = null;
    if (active && container.contains(active) && active.dataset && active.dataset.role) {
      focusRole = active.dataset.role;
      if (typeof active.selectionStart === "number") {
        selection = { start: active.selectionStart, end: active.selectionEnd };
      }
    }
    const scroll = captureScroll(container);

    container.innerHTML = markup;

    restoreScroll(container, scroll);

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

  const TOAST_MS = 2600;

  function toastVisible() {
    return Boolean(state.toast.text) && Date.now() < state.toast.until;
  }

  function toast(message) {
    state.toast = { text: String(message || ""), until: Date.now() + TOAST_MS };
    // Sofort ins bestehende DOM, ohne den Umweg über ein volles render(): der
    // Klick soll ohne Flackern quittiert werden. Ein späteres render() zeichnet
    // dieselbe Meldung aus dem State nach.
    const element = document.querySelector(`#${CONFIG.rootId} .sc-toast`);
    if (element) {
      element.textContent = state.toast.text;
      element.classList.add("is-visible");
    }
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => {
      state.toast = { text: "", until: 0 };
      const current = document.querySelector(`#${CONFIG.rootId} .sc-toast`);
      if (current) current.classList.remove("is-visible");
    }, TOAST_MS);
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

  // Wie lange ein negatives Prüfergebnis gilt, bevor von selbst neu geprüft wird.
  function aiRecheckMs() {
    const ai = CONFIG.ai || {};
    return typeof ai.recheckMs === "number" ? ai.recheckMs : 30000;
  }

  async function loadCapabilities(options) {
    const autoRun = !options || options.autoRun !== false;
    if (!ensureAi()) { render(); return; }
    if (state.ai.capsChecking) return;
    state.ai.capsChecking = true;
    try {
      state.ai.caps = await localAi.capabilities();
    } catch (error) {
      // WICHTIG: Ein Fehler beim PRÜFEN ist keine Aussage über das Modell. Im
      // HUD läuft die KI ferngesteuert in Chrome – bricht diese Verbindung
      // (kein Jira-Tab, Tab nach einem Extension-Reload stumm, keine Antwort),
      // landete hier früher "unavailable" und das Fenster meldete „Das lokale
      // KI-Modell ist auf diesem Gerät derzeit nicht nutzbar." Der Zustand blieb
      // hängen, alle KI-Knöpfe blieben grau — bis zum Neustart. Deshalb wird der
      // Fehler als vorübergehend markiert, im Klartext benannt und automatisch
      // erneut geprüft.
      state.ai.caps = {
        usable: false,
        status: S.UNAVAILABLE,
        transient: true,
        reason: String((error && error.message) || error || "")
      };
    } finally {
      state.ai.capsChecking = false;
      state.ai.capsCheckedAt = Date.now();
    }
    render();
    if (autoRun) maybeAutoRun();
  }

  // Schreibt gerade jemand in ein Feld des Panels? Dann ist kein guter Moment
  // für ein Neu-Rendern.
  function isTypingInPanel() {
    try {
      const node = document.activeElement;
      if (!node) return false;
      const tag = String(node.tagName || "").toLowerCase();
      if (tag !== "input" && tag !== "textarea") return false;
      const container = root();
      return Boolean(container && container.contains(node));
    } catch (error) {
      return false;
    }
  }

  // Ein „nicht nutzbar" darf nie endgültig sein, solange die Ursache auch eine
  // vorübergehende sein kann (Verbindung weg, Modell gerade beschäftigt, lädt
  // noch). Läuft im Sekundentakt mit (tickActiveCallTimer) und heilt den
  // Zustand von selbst, ohne dass jemand neu laden muss.
  function maybeRecheckAi() {
    const caps = state.ai.caps;
    if (!caps || aiUsable() || anyBusy() || state.ai.capsChecking) return;
    // Kennt dieses Chrome die API schlicht nicht, gibt es nichts zu heilen.
    if (caps.status === S.UNSUPPORTED && !caps.offline && !caps.transient) return;
    if (Date.now() - (state.ai.capsCheckedAt || 0) < aiRecheckMs()) return;
    // Nicht mitten ins Tippen rendern: die Prüfung baut das Panel neu auf und
    // würde den Cursor aus dem Notizfeld reißen. Sie hat es nicht eilig.
    if (isTypingInPanel()) return;
    loadCapabilities();
  }

  // Vor einer KI-Aktion: sagt der letzte Stand „nicht nutzbar", einmal frisch
  // nachsehen statt die Aktion stillschweigend zu verschlucken. Ohne autoRun,
  // sonst startet die Prüfung die Aufgabe nebenher ein zweites Mal.
  async function ensureAiUsable() {
    if (aiUsable()) return true;
    await loadCapabilities({ autoRun: false });
    if (aiUsable()) return true;
    toast(aiUnavailableMessage(state.ai.caps && state.ai.caps.status));
    return false;
  }

  // Ein Ergebnis gilt für den Auto-Lauf als erledigt, wenn es entweder
  // aktuell ist, oder wenn es zuletzt fehlgeschlagen ist (kein automatischer
  // Retry-Loop – Fehlversuche bleiben manuell erneut anstoßbar).
  // Kennzeichen des Kündigungs-Kontexts, mit dem eine Vorbereitung erstellt
  // wurde. Kommt der Kontext erst später dazu (die Churn-Abfrage öffnet das
  // Ticket ja gerade erst), ist eine zwischengespeicherte Vorbereitung ohne ihn
  // nicht mehr die richtige – sie kennt den Kündigungsgrund nicht.
  function churnKey() {
    const churn = churnContextForTicket();
    if (!churn) return "";
    return [churn.vertrag, churn.ursache, churn.winback, churn.dealcloser].filter(Boolean).join("|");
  }

  // Fingerabdruck des Kontexts, mit dem eine Gesprächsvorbereitung gebaut
  // wurde: Kündigungsdaten UND Anruftyp. Der Typ gehört dazu, seit die KI ihn
  // kennt (local-ai.js callTypeContext) – schaltet der Bearbeiter von Churn auf
  // Welcome um, ist die zwischengespeicherte Vorbereitung für den falschen
  // Anlass geschrieben und muss neu. Alte Cache-Einträge ohne dieses Feld
  // ergeben "" und werden dadurch von selbst als veraltet erkannt.
  function prepKey() {
    return `${activeCallType()}::${churnKey()}`;
  }

  function autoRunSatisfied(field, prepAware) {
    if (field.status === "error") return true;
    if (field.status !== "ok" || isStale(field)) return false;
    // Die Gesprächsvorbereitung hängt an Kündigungs-Kontext und Anruftyp:
    // kommt der Kündigungsgrund erst später dazu oder wechselt der Typ, muss
    // sie neu. Die Zusammenfassung kennt keinen solchen Kontext – für sie zählt
    // nur der Fingerprint des Tickets (isStale oben).
    if (!prepAware) return true;
    return (field.prepKey || "") === prepKey();
  }

  // Die automatisch mitlaufenden KI-Aufgaben: erst die Zusammenfassung (das
  // timio-Cockpit zeigt sie während des Gesprächs), dann die Vorbereitung –
  // timio wählt selbst, also muss sie fertig sein, bevor verbunden wird.
  const AUTO_RUN_TASKS = [
    { isDone: () => autoRunSatisfied(state.ai.summary, false), run: generateSummary },
    { isDone: () => autoRunSatisfied(state.ai.callPrep, true), run: generateCallPrep }
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

  // ---------------------------------------------------------------------------
  // Kundenakte + Anruf-Vorgeschichte laden (Widget "Kunde & Vorgeschichte")
  //
  // Nach demselben Muster wie maybeAutoRun(): wird NACH dem Rendern angestoßen,
  // nie aus einer Render-Funktion heraus – ein Lookup, den das Zeichnen
  // auslöst, liefe bei jedem erneuten Zeichnen wieder los.
  //
  // state.prepCustomer.number ist der Schlüssel: solange die erkannte
  // Kundennummer dieselbe ist, passiert nichts mehr. Ein Ticketwechsel setzt
  // damit von selbst einen neuen Lauf an.
  // ---------------------------------------------------------------------------

  function maybePrepCustomer() {
    // Nicht jeder Gastgeber bringt den vollen Supabase-Client mit: das HUD
    // reicht ui.js einen eigenen, und ein älteres Bündel kennt recentCalls
    // nicht. Ohne diese Prüfung risse ein fehlender Aufruf das ganze Panel auf.
    if (!supabaseClient || typeof supabaseClient.customerCard !== "function") return;
    const number = lookupCustomerNumber();
    if (!number) {
      // Ticket ohne Kundennummer: alten Stand verwerfen, sonst zeigte das
      // Widget die Akte des vorigen Kunden zu diesem Ticket.
      if (state.prepCustomer.number) {
        state.prepCustomer = { number: "", status: "idle", card: null, calls: [], error: "" };
        render();
      }
      return;
    }
    if (state.prepCustomer.number === number && state.prepCustomer.status !== "idle") return;
    loadPrepCustomer(number);
  }

  async function loadPrepCustomer(number) {
    state.prepCustomer = { number, status: "loading", card: null, calls: [], error: "" };
    render();

    // Akte und Historie parallel: die Historie ist auch dann interessant, wenn
    // der Kunde in der Akte (noch) nicht auftaucht. Beide Aufrufe sind
    // best-effort — ein Netzfehler darf hier nichts weiter als dieses eine
    // Widget kosten.
    const [cardRes, callsRes] = await Promise.all([
      Promise.resolve()
        .then(() => supabaseClient.customerCard(number))
        .catch((error) => ({ ok: false, reason: "network", error: String((error && error.message) || error) })),
      Promise.resolve()
        .then(() => (typeof supabaseClient.recentCalls === "function"
          ? supabaseClient.recentCalls(number, 3)
          : { ok: false, reason: "unsupported" }))
        .catch(() => ({ ok: false, reason: "network" }))
    ]);

    // Zwischenzeitlicher Ticketwechsel: die Antwort gehört zu einem anderen
    // Kunden als dem jetzt offenen und wird verworfen.
    if (state.prepCustomer.number !== number) return;

    const calls = (callsRes && callsRes.ok && callsRes.rows) || [];
    if (cardRes && cardRes.ok) {
      state.prepCustomer = cardRes.data
        ? { number, status: "ok", card: cardRes.data, calls, error: "" }
        : { number, status: "not-found", card: null, calls, error: "" };
    } else {
      const reason = (cardRes && cardRes.reason) || "error";
      const status = reason === "not-configured" || reason === "not-logged-in" ? reason : "error";
      state.prepCustomer = { number, status, card: null, calls, error: (cardRes && cardRes.error) || "" };
    }
    render();
  }

  async function enableAi() {
    if (!ensureAi()) return;
    const signal = beginRun("enable");
    render();
    try {
      // Ein leichter Lauf stößt den Modell-Download an und zeigt Fortschritt.
      const result = await localAi.prepareCall(callPrepInput(), { signal, onDownload });
      if (result && result.status === S.OK) cacheField("callPrep", { status: "ok", data: result.data, prepKey: prepKey() });
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
    try {
      return await localAi.capabilities();
    } catch (error) {
      // Wie in loadCapabilities: eine gescheiterte PRÜFUNG ist kein Urteil über
      // das Modell und darf die KI nicht dauerhaft sperren.
      return { usable: false, status: S.UNAVAILABLE, transient: true, reason: String((error && error.message) || error || "") };
    }
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
    if (!state.ai.callNotes.trim()) return;
    if (!(await ensureAiUsable())) return;
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

  // Ticket-Zusammenfassung. Läuft automatisch beim Öffnen eines Tickets mit:
  // das timio-Cockpit und das Call-Cockpit zeigen sie während des Gesprächs,
  // ohne dass jemand erst einen Knopf drücken muss.
  async function generateSummary() {
    if (!(await ensureAiUsable())) return;
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
      if (result.status === S.OK) cacheField("summary", { status: "ok", text: result.text });
      else state.ai.summary = { status: "error", text: "" };
    } catch (error) {
      state.ai.summary = isAbort(error) ? previous : { status: "error", text: "" };
    } finally {
      endRun(signal);
      render();
      maybeAutoRun();
    }
  }

  // Gesprächsvorbereitung für ausgehende Anrufe. Wird im Outbound-Modus
  // automatisch mitgezogen, damit sie fertig ist, bevor timio wählt – nach dem
  // Verbinden bleibt dafür keine Zeit mehr.
  // Passt der zuletzt abgefragte Kündigungsvorgang zum gerade offenen Ticket?
  // Dann fließt er als Kontext in die Gesprächsvorbereitung – das Ergebnis ist
  // kein allgemeiner Sachstands-Anruf mehr, sondern ein Rückgewinnungsgespräch
  // mit dem konkreten Kündigungsgrund. Der Vorgang liegt im geteilten Storage,
  // steht also auch in dem Tab bereit, den die Abfrage gerade geöffnet hat.
  function churnContextForTicket() {
    const result = state.lookup.result;
    if (!result || result.kind !== "churn" || result.status !== "ok") return null;
    const cases = (result.data && result.data.cases) || [];
    if (!cases.length || !state.ticket) return null;
    const key = (state.ticket.key || "").trim().toUpperCase();
    // Erst über die Ticketnummer (eindeutig), sonst über die Kundennummer.
    const byTicket = cases.find((entry) => (entry.jiraTicket || "").trim().toUpperCase() === key);
    if (byTicket) return byTicket;
    const reference = known(state.ticket.customerReference) ? state.ticket.customerReference.trim() : "";
    if (reference && result.customerNumber && reference === String(result.customerNumber).trim()) return cases[0];
    return null;
  }

  // Alles, was die lokale KI für die Vorbereitung braucht – an einer Stelle,
  // damit der reguläre Lauf und der Aufwärm-Lauf beim Modell-Download nicht
  // auseinanderlaufen können.
  function callPrepInput() {
    return {
      ticket: state.ticket,
      agent: agentForAi(),
      churn: churnContextForTicket(),
      callType: activeCallType(),
      campaignName: (state.shift && state.shift.campaignName) || ""
    };
  }

  async function generateCallPrep() {
    if (!(await ensureAiUsable())) return;
    const previous = state.ai.callPrep;
    const signal = beginRun("callprep");
    state.ai.callPrep = { status: "loading", data: null };
    render();
    try {
      const result = await localAi.prepareCall(callPrepInput(), { signal, onDownload });
      // prepKey mitspeichern: so ist erkennbar, ob die Vorbereitung den
      // Kündigungsgrund und den aktuellen Anruftyp schon kannte oder noch von
      // vorher stammt.
      if (result.status === S.OK) cacheField("callPrep", { status: "ok", data: result.data, prepKey: prepKey() });
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
      // Der Lookup ist ohne Sitzung abgelehnt worden; jetzt darf er wieder.
      state.prepCustomer = { number: "", status: "idle", card: null, calls: [], error: "" };
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
    // Kundendaten gehören zur Sitzung – mit ihr verschwinden sie auch aus der
    // Ansicht, statt bis zum nächsten Ticketwechsel stehen zu bleiben.
    state.prepCustomer = { number: "", status: "idle", card: null, calls: [], error: "" };
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

  // Schritt 2 – bestätigt: Auftrag an den Hintergrund-Worker (lookup.js).
  //
  // Der Auftrag geht auf ZWEI Wegen raus, und das ist der Kern der Sache:
  //   (a) als Eintrag in chrome.storage.local (storageKeys.lookupRequest) und
  //   (b) als Nachricht (schnell, aber ohne Zustellgarantie).
  // chrome.runtime.sendMessage ist ein Zuruf: schläft der Worker gerade, wurde er
  // beendet oder ist er beim Laden gescheitert, verschwindet die Nachricht
  // spurlos – dann passierte GAR NICHTS, nicht einmal ein Tab ging auf. Eine
  // Storage-Änderung weckt den Service-Worker dagegen zuverlässig; er findet den
  // Auftrag dort und holt ihn nach.
  //
  // Und weil auch das schiefgehen kann, muss der Worker die Annahme quittieren
  // (phase != "queued"). Bleibt sie aus, sagt das Panel nach ackTimeoutMs klar,
  // was zu tun ist – statt eine Minute lang „läuft" anzuzeigen.
  function confirmLookup() {
    const confirm = state.lookup.confirm;
    if (!confirm) return;
    state.lookup.confirm = null;
    const dash = (CONFIG.lookups && CONFIG.lookups[confirm.kind]) || {};
    const requestId = `lk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const request = {
      requestId,
      kind: confirm.kind,
      customerNumber: confirm.customerNumber,
      source: "panel",
      createdAt: Date.now()
    };

    // Ist der Content-Script-Kontext ungültig (Extension neu geladen, Jira-Tab
    // nicht), geht weder Storage noch Nachricht – das muss sichtbar scheitern.
    if (!extensionAlive()) {
      state.lookup.result = {
        requestId, kind: confirm.kind, customerNumber: confirm.customerNumber,
        status: "error",
        steps: (dash.steps || []).map((step) => ({ id: step.id, state: "pending" })),
        data: null,
        error: "Verbindung zur Extension verloren – bitte den Jira-Tab neu laden (F5) und erneut versuchen. (Nach dem Neuladen der Extension muss auch der Jira-Tab neu geladen werden.)"
      };
      render();
      toast("Bitte Jira-Tab neu laden (F5).");
      return;
    }

    state.lookup.result = {
      requestId,
      kind: confirm.kind,
      customerNumber: confirm.customerNumber,
      status: "running",
      // "queued" = abgeschickt, aber noch nicht vom Worker angenommen. Der
      // Worker setzt beim Annehmen sofort eine andere phase; genau daran erkennt
      // das Panel, ob der Hintergrund-Dienst überhaupt läuft.
      phase: "queued",
      note: "Auftrag wird an den Hintergrund-Dienst übergeben …",
      steps: (dash.steps || []).map((step) => ({ id: step.id, state: "pending" })),
      data: null,
      error: "",
      // Start für den Watchdog (maybeExpireStuckLookup) und für die
      // Annahme-Frist (siehe unten).
      updatedAt: Date.now(),
      queuedAt: Date.now()
    };

    // (a) Der verlässliche Weg: liegt im Storage, weckt den Worker.
    safeLocalSet({ [CONFIG.storageKeys.lookupRequest]: request });
    // (b) Der schnelle Weg. Fehler hier sind unkritisch – (a) trägt den Auftrag.
    try {
      chrome.runtime.sendMessage({ type: "sc-run-lookup", request }, () => {
        void chrome.runtime.lastError;
      });
    } catch (error) { /* Storage-Weg genügt */ }

    render();
    toast("Abfrage gestartet …");
  }

  // „Verbindung prüfen": fragt den Hintergrund-Dienst nach seiner Selbstauskunft.
  // Bleibt die Antwort aus, ist das bereits das Ergebnis – dann läuft er nicht.
  // Das ersetzt das Rätselraten bei „ich klicke und es passiert nichts".
  function runLookupDiagnose() {
    state.lookup.diagnose = { status: "running", report: null, error: "" };
    render();

    const finish = (next) => {
      if (!state.lookup.diagnose || state.lookup.diagnose.status !== "running") return;
      state.lookup.diagnose = next;
      render();
    };
    const deadMessage = "Der Hintergrund-Dienst der Extension antwortet nicht. Bitte chrome://extensions öffnen, bei „Stadtnetz CRM Outbound“ auf „Neu laden“ klicken und danach diesen Jira-Tab mit F5 aktualisieren.";

    if (!extensionAlive()) {
      finish({ status: "error", report: null, error: "Verbindung zur Extension verloren – bitte diesen Jira-Tab neu laden (F5)." });
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: "sc-lookup-diagnose" }, (response) => {
        const err = chrome.runtime.lastError;
        if (err || !response || !response.ok) {
          finish({ status: "error", report: null, error: deadMessage });
          return;
        }
        finish({ status: "ok", report: response.report, error: "" });
      });
    } catch (error) {
      finish({ status: "error", report: null, error: deadMessage });
      return;
    }
    // Antwortet niemand, kommt auch kein Rückruf – deshalb eine eigene Frist.
    window.setTimeout(() => finish({ status: "error", report: null, error: deadMessage }), 6000);
  }

  function cancelLookup() {
    state.lookup.confirm = null;
    render();
  }

  async function handleClick(event) {
    const control = event.target.closest("[data-action]");
    if (!control) return;
    const action = control.dataset.action;

    // Erst der Gastgeber (Desktop-App): Overlay-Knöpfe kennt nur er. Meldet er
    // "erledigt", ist der Klick abgearbeitet.
    const host = hudHost();
    if (host && typeof host.handleAction === "function" && host.handleAction(action, control)) return;

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
        // Eine offene Aufnahme gehört zur Ansicht, nicht zum Zustand – beim
        // Verlassen der Einstellungen läge sie sonst still weiter und schluckte
        // den nächsten Tastendruck.
        state.hotkeyCapture = { id: "", error: "" };
        render();
        return;
      case "capture-hotkey":
        state.hotkeyCapture = {
          // Nochmal derselbe Knopf: Aufnahme abbrechen.
          id: state.hotkeyCapture.id === control.dataset.hotkey ? "" : control.dataset.hotkey,
          error: ""
        };
        render();
        return;
      case "reset-hotkey":
        resetHotkey(control.dataset.hotkey);
        return;
      case "reset-hotkeys":
        resetAllHotkeys();
        return;
      case "close-settings":
        state.settingsOpen = false;
        render();
        return;
      case "save-settings": saveSettings(); return;
      case "set-theme-preset": {
        if (state.themeSync.useCrm) return; // Auswahl gesperrt, solange das CRM führt
        state.theme.presetId = control.dataset.preset === "crm" ? "crm" : "jira";
        applyCurrentTheme();
        persistTheme();
        render();
        return;
      }
      case "reset-theme": {
        if (state.themeSync.useCrm) return;
        state.theme = { presetId: "jira", overrides: {} };
        applyCurrentTheme();
        persistTheme();
        render();
        return;
      }
      case "toggle-theme-from-crm":
        toggleCrmTheme(control.checked);
        return;
      case "refresh-crm-theme":
        await refreshCrmTheme({ silent: false });
        return;
      case "toggle-customize":
        state.layout.customizeMode = !state.layout.customizeMode;
        if (state.layout.customizeMode) state.settingsOpen = false;
        render();
        return;
      case "widget-move": moveWidget(control.dataset.tab, control.dataset.widget, control.dataset.dir); return;
      case "widget-hide": hideWidget(control.dataset.tab, control.dataset.widget); return;
      case "widget-show": showWidget(control.dataset.tab, control.dataset.widget); return;
      case "reset-layout": resetLayout(); return;
      case "reload-prep-customer":
        state.prepCustomer = { number: "", status: "idle", card: null, calls: [], error: "" };
        maybePrepCustomer();
        return;
      case "supabase-login": await handleSupabaseLogin(); return;
      case "supabase-logout": handleSupabaseLogout(); return;
      case "enable-ai": enableAi(); return;
      case "recheck-ai": loadCapabilities(); render(); return;
      case "end-call": endCurrentCall(); return;
      case "dismiss-call-overlay": dismissCallOverlay(); return;
      case "toggle-cockpit-mode": toggleCockpitMode(); return;
      case "wipe-data": wipeAllData(); return;
      case "clean-call-notes": cleanCallNotes(); return;
      case "copy-call-draft": copyText(state.ai.callDraft.text, "Notiz kopiert."); return;
      case "use-call-draft": useCallDraft(); return;
      case "copy-call-phase": { const phase = activeCallPhases()[Number(control.dataset.phaseIndex)]; if (phase) copyText(phase.prompt, "Gesprächsbaustein kopiert."); return; }
      case "copy-objection": { const card = activeObjectionCards()[Number(control.dataset.objectionIndex)]; if (card) copyText(card.text, "Antwort kopiert."); return; }
      case "set-call-type": {
        const requested = control.dataset.callType;
        const next = (CONFIG.callGuides && CONFIG.callGuides[requested]) ? requested : "churn";
        // Override nur setzen, wenn er von der Schicht abweicht — deckt sich der
        // Klick mit der Kampagne, wird der Override gelöscht (zurück zu „auto").
        const fromShift = (state.shift && state.shift.callType) || "churn";
        state.callTypeOverride = next === fromShift ? null : next;
        render();
        // Der Typ steckt im Prompt der Gesprächsvorbereitung (prepKey), also
        // ist die bisherige jetzt für den falschen Anlass geschrieben.
        // maybeAutoRun() erkennt das über autoRunSatisfied() und baut sie neu –
        // ohne dass der Bearbeiter daran denken muss.
        maybeAutoRun();
        return;
      }
      case "toggle-phase": {
        const key = phaseKey(activeCallType(), Number(control.dataset.phaseIndex));
        state.checkedPhases[key] = !state.checkedPhases[key];
        render();
        return;
      }
      case "guide-next": advanceGuide(1, true); render(); return;
      case "guide-prev": advanceGuide(-1, false); render(); return;
      case "guide-step":
        setGuideStep(Number(control.dataset.phaseIndex));
        // Ein Sprung aus der Gesamtliste heraus soll den Schritt auch zeigen –
        // sonst passierte sichtbar nichts, weil die Liste den Kopf verdeckt.
        state.guide.showAll = false;
        render();
        return;
      case "guide-toggle-all": state.guide.showAll = !state.guide.showAll; render(); return;
      case "note-chip": appendNoteChip(control.dataset.chip); return;
      case "note-undo": removeLastNoteLine(); return;
      case "search-customer": openCustomerSearch(control.dataset.customer); return;
      case "generate-summary": generateSummary(); return;
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
      case "lookup-diagnose": runLookupDiagnose(); return;
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
    const host = hudHost();
    if (host && typeof host.handleInput === "function" && host.handleInput(role, event.target)) return;
    if (role === "call-notes") { state.ai.callNotes = event.target.value; scheduleAutoCallClean(); }
    else if (role === "set-agent-name") state.settings.agentName = event.target.value;
    else if (role === "set-company") state.settings.company = event.target.value;
    else if (role === "set-customer-jql") state.settings.customerSearchJql = event.target.value;
    else if (role === "set-supabase-url") state.settings.supabaseUrl = event.target.value;
    else if (role === "set-supabase-anon-key") state.settings.supabaseAnonKey = event.target.value;
    else if (role === "set-bridge-token") state.settings.bridgeToken = event.target.value;
    else if (role && role.indexOf("set-theme-color-") === 0) {
      // Solange das CRM führt, ist die eigene Farbwahl gesperrt — sonst
      // schriebe ein Klick eine Farbe in state.theme, die niemand sieht.
      if (state.themeSync.useCrm) return;
      const themeRole = role.slice("set-theme-color-".length);
      if (themeEngine.ROLE_TO_VAR[themeRole]) {
        state.theme.overrides[themeRole] = event.target.value;
        applyCurrentTheme();
        persistTheme();
      }
    }
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
      else if (role === "closeout-cancellation-reason") f.cancellationReason = value;
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
    maybePrepCustomer();
  }

  async function mount() {
    let container = root();
    if (container) return;

    container = document.createElement("div");
    container.id = CONFIG.rootId;
    document.body.appendChild(container);
    // Frisches, leeres Wurzelelement: der Markup-Cache aus einer früheren
    // Einbindung gilt nicht mehr. Ohne dieses Zurücksetzen hielte render() das
    // Markup für unverändert und das Panel bliebe leer.
    lastMarkup = null;

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
      CONFIG.storageKeys.bridgeState,
      CONFIG.storageKeys.theme,
      CONFIG.storageKeys.themeSync,
      CONFIG.storageKeys.layout,
      CONFIG.storageKeys.hotkeys
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
    state.theme = themeEngine.normalizeThemeState(saved[CONFIG.storageKeys.theme]);
    const savedSync = saved[CONFIG.storageKeys.themeSync];
    if (savedSync && typeof savedSync === "object") {
      state.themeSync.useCrm = savedSync.useCrm === true;
      state.themeSync.cached = savedSync.cached
        ? themeEngine.normalizeThemeState(savedSync.cached)
        : null;
      state.themeSync.at = typeof savedSync.at === "number" ? savedSync.at : 0;
    }
    // Zuerst der zwischengespeicherte Stand: das Panel steht sofort in den
    // richtigen Farben, auch offline. Der Abgleich läuft danach im Hintergrund
    // und zeichnet bei einer Änderung neu.
    applyCurrentTheme(container);
    const savedLayout = saved[CONFIG.storageKeys.layout];
    if (savedLayout && typeof savedLayout === "object" && savedLayout.tabs && typeof savedLayout.tabs === "object") {
      state.layout.tabs = savedLayout.tabs;
    }
    const savedHotkeys = saved[CONFIG.storageKeys.hotkeys];
    if (savedHotkeys && typeof savedHotkeys === "object") state.hotkeys = { ...savedHotkeys };

    state.ticket = jiraReader.read();
    hydrateAiFromCache(state.ticket);
    publishTicketContext();
    render();
    container.addEventListener("click", handleClick);
    container.addEventListener("input", handleInput);
    container.addEventListener("pointerdown", startCockpitDrag);
    bindPaletteHotkey();

    // Prozessweit gebundene Listener/Timer (nur EINMAL, siehe unten).
    bindGlobalListenersOnce();

    loadCapabilities();
    loadShift();
    maybePrepCustomer();
    // Farbschema stillschweigend nachziehen, falls die Übernahme an ist. Kein
    // await: der Panel-Aufbau darf nicht auf das Netz warten — bis die Antwort
    // da ist, gilt der zwischengespeicherte Stand von oben.
    if (state.themeSync.useCrm) void refreshCrmTheme({ silent: true });
  }

  // Bug-Historie: die folgenden Registrierungen standen früher direkt in
  // mount(). Da content.js bei jeder Jira-SPA-Navigation weg vom Ticket
  // removePanel() (löscht den DOM-Root) und beim Zurückkehren erneut mount()
  // aufruft, wurde bei JEDEM Ticketwechsel ein weiterer storage.onChanged-
  // Listener und ein weiterer setInterval registriert — ohne Teardown. Über
  // einen Arbeitstag akkumulierten sich N Listener; ein einzelnes in timio
  // geklicktes Gesprächsergebnis feuerte applyOutcome() dann N-fach (doppelter
  // Notiztext, doppelte/hochgezählte Rückrufe). Diese Registrierungen hängen
  // nicht am DOM-Root (render()/tickActiveCallTimer() no-open, wenn kein Root
  // da ist), gehören also genau einmal pro Seiten-Kontext gebunden.
  let globalListenersBound = false;
  function bindGlobalListenersOnce() {
    if (globalListenersBound) return;
    globalListenersBound = true;

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
            }, { alreadyRecorded: true });
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
        // worden sein. Bei Login die Schicht (neu) laden.
        if (Object.prototype.hasOwnProperty.call(changes, CONFIG.storageKeys.supabaseSession)) {
          const nextSession = changes[CONFIG.storageKeys.supabaseSession].newValue || null;
          const wasLoggedIn = Boolean(state.supabaseSession);
          state.supabaseSession = nextSession;
          if (nextSession && !wasLoggedIn) loadShift();
          if (state.settingsOpen) render();
        }
      });
    }
    window.setInterval(tickActiveCallTimer, 1000);
    // Schicht/Kampagne regelmäßig nachziehen — siehe loadShift().
    window.setInterval(loadShift, (CONFIG.shift && CONFIG.shift.refreshMs) || 300000);
  }

  // Lädt die heutige Schicht + Kampagne des eingeloggten Agenten und leitet
  // daraus den Call-Typ fürs Skript-Routing ab (siehe activeCallType()).
  // Best-effort: ohne Login/Schicht bleibt state.shift.callType null und das
  // Cockpit fällt auf den Standard (churn) bzw. den manuellen Umschalter zurück.
  //
  // Wird zusätzlich periodisch aufgefrischt (siehe bindGlobalListenersOnce):
  // der Chef ändert die Zuordnung im CRM, während dieser Tab offen bleibt —
  // ohne Auffrischung liefe der Leitfaden bis zum nächsten Reload auf der
  // Kampagne von heute früh (und nach Mitternacht auf der von gestern).
  async function loadShift() {
    if (!supabaseClient || !state.supabaseSession) {
      state.shift = { loaded: true, callType: null, campaignId: null, campaignName: null, shiftType: null };
      render();
      return;
    }
    try {
      const res = await supabaseClient.fetchCurrentShift();
      if (res && res.ok) {
        const d = res.data || {};
        state.shift = {
          loaded: true,
          callType: d.callType || null,
          campaignId: d.campaignId || null,
          campaignName: d.campaignName || null,
          shiftType: d.shiftType || null
        };
      } else {
        state.shift.loaded = true;
      }
    } catch (error) {
      state.shift.loaded = true;
    }
    render();
  }

  app.ui = {
    mount,
    refresh: refreshTicket,
    // Neu zeichnen, ohne das Ticket erneut zu lesen: das braucht der Gastgeber,
    // wenn sich nur bei ihm etwas geändert hat (Verbindung, Overlay-Schalter).
    rerender: render,
    loadCapabilities,
    // Tastenkürzel: das Panel hält den gespeicherten Stand, andere Teile der
    // Auskunft (Notizen, Startbild) fragen hier nach, statt eine zweite Kopie
    // zu führen.
    hotkey,
    isCapturingHotkey: () => Boolean(state.hotkeyCapture.id)
  };
})();
