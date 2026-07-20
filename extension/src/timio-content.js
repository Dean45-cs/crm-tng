(function initTimioContent() {
  "use strict";

  const app = window.SupportCopilot;
  const CONFIG = app.CONFIG;
  const {
    escapeHtml, extensionAlive, queueTotalWaiting, queueStaleMinutes, groupsMatch,
    callStatusMeta, callTimerText, callModeMeta, isOutbound, customerSearchUrl
  } = app.shared;
  const CALL_CONFIG = CONFIG.call || {};
  const POLL_MS = CALL_CONFIG.pollMs || 1000;
  const HEARTBEAT_MS = CALL_CONFIG.heartbeatMs || 4000;
  const CONNECTED_GRACE_MS = CALL_CONFIG.connectedGraceMs || 20000;
  const QUEUE_HEARTBEAT_MS = CALL_CONFIG.queueHeartbeatMs || 10000;
  const QUEUE_STALE_MS = CALL_CONFIG.queueStaleAfterMs || 30000;
  const ENDED_OVERLAY_MS = CALL_CONFIG.endedOverlayMs || 12000;
  const ENDED_OUTBOUND_OVERLAY_MS = CALL_CONFIG.endedOutboundOverlayMs || 45000;
  const MAX_QUEUE_GROUPS = 8;

  const STATUS = { IDLE: "idle", RINGING: "ringing", CONNECTED: "connected", ENDED: "ended" };

  // Deutsches Rufnummernformat wie in timio angezeigt, z. B. "+49 (176) 34573586".
  // Bewusst großzügig gehalten – im Zweifel lieber ein Treffer zu viel als keiner.
  const PHONE_PATTERN = /\+\d{1,3}\s?\(?\d{1,5}\)?[\d\s-]{4,}\d/;

  // WICHTIG: timio läuft hinter einem Login, den diese Extension nie selbst
  // durchführt. Die Erkennung basiert ausschließlich auf sichtbarem Seitentext
  // (kein Mithören, keine Audiodaten): Call-Screens über die Labels
  // "Eingehender Anruf" / "Kundennummer:" / "Beendet", das Portal über die
  // Kachel-Beschriftungen "Agenten" / "Wartefeld" / "Anrufe Eingang …
  // Im Wartefeld". Struktur verifiziert anhand echter Screenshots
  // (Portal 17.07.2026; Klingel-Toast, Gesprächsansicht und "Beendet"-Karte
  // 16./17.07.2026). Aufbau der Anrufkarte in allen drei Zuständen:
  //   [Initialen] / Vorname Nachname / Nachname / +49 … / (Timer bzw.
  //   "Beendet" + "Dauer: mm:ss") / Gruppe: … / Wartezeit: … / Kundennummer: …

  // ---------------------------------------------------------------------------
  // Lebenszyklus: Wird die Extension neu geladen, verliert das alte
  // Content-Script seinen Chrome-Kontext ("Extension context invalidated").
  // Die alte Instanz beendet sich dann sauber, statt Fehler zu werfen.
  // ---------------------------------------------------------------------------

  let stopped = false;
  let intervalId = null;

  function shutdown() {
    if (stopped) return;
    stopped = true;
    if (intervalId) window.clearInterval(intervalId);
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
  }

  function storageSet(payload) {
    if (stopped) return;
    if (!extensionAlive()) { shutdown(); return; }
    try {
      if (chrome.storage && chrome.storage.local) chrome.storage.local.set(payload);
    } catch (error) {
      shutdown();
    }
  }

  // ---------------------------------------------------------------------------
  // Gemeinsame Helfer
  // ---------------------------------------------------------------------------

  function pageText() {
    return (document.body && document.body.innerText) || "";
  }

  function pageLines(text) {
    return text.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  function escapeForRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function extractAfterLabel(text, label) {
    const match = text.match(new RegExp(`${escapeForRegExp(label)}\\s*([^\\n]+)`));
    return match ? match[1].trim() : "";
  }

  // ---------------------------------------------------------------------------
  // Anruf-Erkennung (Call-Screens)
  // ---------------------------------------------------------------------------

  // Verortet die Anrufkarte im Seitentext: Die Rufnummer des Anrufers steht
  // wenige Zeilen VOR dem "Gruppe:"-Label. So werden andere Nummern auf der
  // Seite (z. B. "Meine letzten Unterhaltungen" auf der Willkommen-Seite oder
  // das Rufnummer-Feld im timio-Formular) nie mit dem Anrufer verwechselt.
  function locateCallCard(lines) {
    const groupIdx = lines.findIndex((line) => /^gruppe\s*:/i.test(line));
    if (groupIdx > 0) {
      for (let back = 1; back <= 6; back++) {
        const idx = groupIdx - back;
        if (idx < 0) break;
        const match = lines[idx].match(PHONE_PATTERN);
        if (match) return { phoneIdx: idx, callerNumber: match[0].trim() };
      }
    }
    // Fallback: erste Nummer kurz nach der Überschrift "Eingehender Anruf".
    const ringIdx = lines.findIndex((line) => /^eingehender anruf$/i.test(line));
    if (ringIdx >= 0) {
      for (let i = ringIdx + 1; i <= ringIdx + 6 && i < lines.length; i++) {
        const match = lines[i].match(PHONE_PATTERN);
        if (match) return { phoneIdx: i, callerNumber: match[0].trim() };
      }
    }
    return { phoneIdx: -1, callerNumber: "" };
  }

  // Bester Kandidat für den Anrufernamen: die längste, nicht labelartige Zeile
  // in den drei Zeilen vor der Rufnummer der Anrufkarte (dort stehen
  // Avatar-Initialen, "Vorname Nachname" und "Nachname" untereinander).
  function extractCallerName(lines, phoneIdx) {
    if (phoneIdx < 0) return "";
    let best = "";
    for (let back = 1; back <= 3; back++) {
      const idx = phoneIdx - back;
      if (idx < 0) break;
      const candidate = lines[idx];
      if (!candidate || candidate.includes(":") || candidate.includes("@")) continue;
      if (/^eingehender anruf$/i.test(candidate) || PHONE_PATTERN.test(candidate) || /^[\d\s]+$/.test(candidate)) continue;
      if (candidate.length > best.length) best = candidate;
    }
    return best;
  }

  // Reihenfolge wichtig: Der "Beendet"-Screen enthält weiterhin "Kundennummer:",
  // muss also vor der Connected-Prüfung erkannt werden.
  function detectRawStatus(text) {
    if (/eingehender anruf/i.test(text)) return STATUS.RINGING;
    if (/\bbeendet\b/i.test(text)) return STATUS.ENDED;
    if (/kundennummer\s*:/i.test(text)) return STATUS.CONNECTED;
    return STATUS.IDLE;
  }

  function readCallDetails(text, status) {
    const lines = pageLines(text);
    const card = locateCallCard(lines);
    const durationMatch = text.match(/Dauer:\s*([\d:]+)/i);

    return {
      status,
      callerName: extractCallerName(lines, card.phoneIdx),
      callerNumber: card.callerNumber,
      customerNumber: extractAfterLabel(text, "Kundennummer:"),
      group: extractAfterLabel(text, "Gruppe:"),
      // Wie lange der Kunde vor der Annahme in der Leitung gewartet hat.
      waitTime: extractAfterLabel(text, "Wartezeit:"),
      // Feste Endgesprächsdauer aus dem "Beendet"-Screen, statt sie (falsch)
      // über connectedAt weiterzuticken.
      finalDuration: status === STATUS.ENDED && durationMatch ? durationMatch[1] : ""
    };
  }

  // Zustandsmaschine über den rohen Text-Markern:
  // - "Beendet" zählt nur direkt nach einem echten Anruf als Gesprächsende.
  // - Verschwinden die Call-Marker während eines Gesprächs (z. B. weil der
  //   Bearbeiter in timio auf den Portal-Tab wechselt), bleibt der Status für
  //   eine Schonfrist "verbunden" statt sofort auf idle zu fallen.
  let publicStatus = STATUS.IDLE;
  let graceUntil = 0;
  let lastDetails = null;
  let callId = null;
  let connectedAt = null;
  let endedAt = null;
  let idleDismissed = false;
  // Kam der Anruf über eine Klingel-Phase? Ein Gespräch, das ohne Klingeln
  // direkt auf "verbunden" springt, ist typisch für timios eigene Anrufliste,
  // die selbst wählt. Das ist ein Indiz für einen ausgehenden Anruf – mehr
  // nicht: umgeschaltet wird ausschließlich per Klick des Bearbeiters.
  let cameFromRinging = false;

  function resolveCallState() {
    const text = pageText();
    const raw = detectRawStatus(text);
    const wasIdle = publicStatus === STATUS.IDLE;

    if (raw === STATUS.RINGING || raw === STATUS.CONNECTED) {
      if (publicStatus === STATUS.IDLE || publicStatus === STATUS.ENDED) {
        callId = Date.now();
        connectedAt = null;
        cameFromRinging = raw === STATUS.RINGING;
      }
      if (raw === STATUS.RINGING) cameFromRinging = true;
      publicStatus = raw;
      graceUntil = 0;
      endedAt = null;
      lastDetails = readCallDetails(text, raw);
      if (raw === STATUS.CONNECTED && !connectedAt) connectedAt = Date.now();
      return lastDetails;
    }

    if (raw === STATUS.ENDED) {
      if (publicStatus === STATUS.RINGING || publicStatus === STATUS.CONNECTED || publicStatus === STATUS.ENDED) {
        if (publicStatus !== STATUS.ENDED) endedAt = Date.now();
        publicStatus = STATUS.ENDED;
        graceUntil = 0;
        const details = readCallDetails(text, STATUS.ENDED);
        // Anruferdaten vom Gespräch behalten, falls der End-Screen sie nicht
        // mehr vollständig anzeigt.
        lastDetails = {
          ...details,
          callerName: details.callerName || (lastDetails && lastDetails.callerName) || "",
          callerNumber: details.callerNumber || (lastDetails && lastDetails.callerNumber) || "",
          customerNumber: details.customerNumber || (lastDetails && lastDetails.customerNumber) || "",
          group: details.group || (lastDetails && lastDetails.group) || ""
        };
        return lastDetails;
      }
      return { status: STATUS.IDLE };
    }

    // Keine Call-Marker sichtbar.
    if (publicStatus === STATUS.CONNECTED) {
      if (!graceUntil) graceUntil = Date.now() + CONNECTED_GRACE_MS;
      if (Date.now() < graceUntil) {
        return { ...(lastDetails || {}), status: STATUS.CONNECTED };
      }
    }
    if (!wasIdle) idleDismissed = false;
    publicStatus = STATUS.IDLE;
    graceUntil = 0;
    lastDetails = null;
    connectedAt = null;
    callId = null;
    endedAt = null;
    cameFromRinging = false;
    return { status: STATUS.IDLE };
  }

  // Indiz, kein Beweis: ohne Klingel-Phase verbunden spricht für einen
  // ausgehenden Anruf. Die Oberfläche bietet daraufhin nur den Moduswechsel an.
  function looksOutbound(state) {
    return Boolean(state && state.status !== STATUS.IDLE && !cameFromRinging);
  }

  // ---------------------------------------------------------------------------
  // Wartefeld-Erkennung (Portal-Ansicht). Es werden ausschließlich
  // Gruppennamen und Zähler gelesen – keine Namen oder Nummern anderer Personen.
  // ---------------------------------------------------------------------------

  const NOT_A_GROUP_NAME = /^(agenten|wartefeld|ansage|option|aus|an|kontakt|neue gruppe|gruppen|kacheln|sortieren|portal|willkommen|verbunden|im wartefeld|anrufe eingang.*|<keine>)$/i;

  function isPlausibleGroupName(line) {
    if (!line || line.length < 2 || line.length > 60) return false;
    if (NOT_A_GROUP_NAME.test(line)) return false;
    if (/^[\d\s:./+-]+$/.test(line)) return false; // nur Zahlen/Zeiten/Nummern
    return /[a-zäöüß]/i.test(line);
  }

  function extractWaiting(block) {
    // Bevorzugt die Kachel "Anrufe Eingang Aktuell / <Zahl> / Im Wartefeld".
    for (let i = 0; i < block.length; i++) {
      if (!/^anrufe eingang/i.test(block[i])) continue;
      for (let j = i + 1; j <= i + 3 && j < block.length; j++) {
        if (/^\d{1,3}$/.test(block[j])) return Number(block[j]);
      }
    }
    // Fallback: erste alleinstehende Zahl nach dem "Wartefeld"-Label.
    const idx = block.findIndex((line) => /^wartefeld$/i.test(line));
    if (idx >= 0) {
      for (let j = idx + 1; j <= idx + 4 && j < block.length; j++) {
        if (/^\d{1,3}$/.test(block[j])) return Number(block[j]);
      }
    }
    return null;
  }

  function extractWaitTimes(block) {
    const idx = block.findIndex((line) => /^wartefeld$/i.test(line));
    if (idx < 0) return [];
    const times = [];
    for (let j = idx + 1; j <= idx + 6 && j < block.length; j++) {
      const match = block[j].match(/^\d{1,2}:\d{2}(?::\d{2})?$/);
      if (match) times.push(match[0]);
      if (times.length === 2) break;
    }
    return times;
  }

  function parseQueueGroups(text) {
    const lines = pageLines(text);
    const agentIdxs = [];
    lines.forEach((line, i) => { if (/^agenten$/i.test(line)) agentIdxs.push(i); });

    const groups = [];
    for (let g = 0; g < agentIdxs.length && groups.length < MAX_QUEUE_GROUPS; g++) {
      const start = agentIdxs[g];
      const nextStart = g + 1 < agentIdxs.length ? agentIdxs[g + 1] : lines.length + 1;
      // Die Zeile direkt vor dem nächsten "Agenten"-Label ist bereits der Name
      // der nächsten Gruppe – daher -1.
      const block = lines.slice(start, Math.max(start, nextStart - 1));
      const nameCandidate = start > 0 ? lines[start - 1] : "";
      const name = isPlausibleGroupName(nameCandidate) ? nameCandidate : `Warteschlange ${g + 1}`;
      const waiting = extractWaiting(block);
      if (waiting === null) continue; // Ohne Zähler kein verwertbarer Eintrag.
      const times = extractWaitTimes(block);
      groups.push({
        name: name.slice(0, 60),
        waiting,
        currentWait: times[0] || "",
        avgWait: times[1] || ""
      });
    }
    return groups;
  }

  // ---------------------------------------------------------------------------
  // Persistenz (nur bei Änderung oder als Heartbeat – kein Dauerfeuer)
  // ---------------------------------------------------------------------------

  let lastCallSignature = null;
  let lastCallWriteAt = 0;
  let lastQueueSignature = null;
  let lastQueueWriteAt = 0;
  let queueStats = null;    // letzter bekannter Stand (eigener Write oder anderer Tab)
  let ticketContext = null; // von der Jira-Seite veröffentlichtes offenes Ticket
  let callMode = "inbound"; // Arbeitsrichtung, vom Bearbeiter gesetzt
  let customerSearchJql = ""; // optionale eigene JQL-Vorlage aus den Einstellungen

  function callSignatureOf(state) {
    return [state.status, state.callerNumber, state.customerNumber, state.finalDuration, looksOutbound(state)].join("|");
  }

  function persistCall(state) {
    const payload = { ...state, updatedAt: Date.now(), likelyOutbound: looksOutbound(state) };
    if (state.status === STATUS.CONNECTED) {
      payload.connectedAt = connectedAt || Date.now();
    }
    if (state.status !== STATUS.IDLE && callId) {
      payload.callId = callId;
    }
    storageSet({ [CONFIG.storageKeys.activeCall]: payload });
    lastCallSignature = callSignatureOf(state);
    lastCallWriteAt = Date.now();
  }

  function persistQueues(groups) {
    queueStats = { updatedAt: Date.now(), groups };
    storageSet({ [CONFIG.storageKeys.queueStats]: queueStats });
    lastQueueSignature = JSON.stringify(groups);
    lastQueueWriteAt = Date.now();
  }

  // ---------------------------------------------------------------------------
  // Call-Cockpit direkt in timio: Während des Telefonats arbeitet der
  // Bearbeiter hier (Notizfeld, Formular) – deshalb erscheinen Wartefeld und
  // Jira-Ticket-Kontext auch auf dieser Seite, nicht nur in Jira.
  // ---------------------------------------------------------------------------

  const OVERLAY_ID = "sc-timio-cockpit";
  let overlayPrefs = { mode: "full", pos: null };
  let dismissedForCallId = null;
  let lastOverlaySignature = null;

  function persistOverlayPrefs() {
    storageSet({ [CONFIG.storageKeys.timioOverlay]: overlayPrefs });
  }

  // Der Moduswechsel muss auch hier erreichbar sein: während des Gesprächs
  // arbeitet der Bearbeiter in timio, nicht in Jira. Geschrieben wird nur der
  // gemeinsame Storage-Schlüssel – das Jira-Panel zieht über seinen
  // onChanged-Listener innerhalb einer Sekunde nach.
  function setCallMode(mode) {
    const next = callModeMeta(mode).id;
    if (next === callMode) return;
    callMode = next;
    storageSet({ [CONFIG.storageKeys.callMode]: next });
    lastOverlaySignature = null;
    renderOverlay(lastDetails || { status: STATUS.IDLE });
  }

  function modeSwitchMarkup() {
    const outbound = isOutbound(callMode);
    return `
      <span class="tc-mode" role="group" aria-label="Arbeitsrichtung">
        <button type="button" data-act="mode-inbound" class="${outbound ? "" : "is-active"}" title="Eingehende Anrufe" aria-pressed="${!outbound}">☎</button>
        <button type="button" data-act="mode-outbound" class="${outbound ? "is-active" : ""}" title="Ausgehende Anrufe" aria-pressed="${outbound}">↗</button>
      </span>`;
  }

  // Hinweis statt Automatik: Springt ein Anruf ohne Klingeln direkt auf
  // "verbunden", ist das ein Indiz für einen ausgehenden Anruf. Umgeschaltet
  // wird trotzdem nur auf Klick.
  function outboundHintMarkup(call) {
    if (isOutbound(callMode) || !looksOutbound(call)) return "";
    return `<button type="button" class="tc-hint-switch" data-act="mode-outbound">Wirkt ausgehend – auf Outbound umschalten?</button>`;
  }

  // Sprung von der Kundennummer zur Jira-Trefferliste. Die Extension kann
  // Jira nicht durchsuchen, aber eine Suche öffnen – im Outbound-Modus der
  // schnellste Weg zum passenden Ticket.
  function customerSearchMarkup(call) {
    if (!call || !call.customerNumber) return "";
    const number = call.customerNumber.trim();
    if (!number) return "";
    return `<button type="button" class="tc-search" data-act="search-customer">Ticket zu Kundennummer ${escapeHtml(number)} suchen</button>`;
  }

  function openCustomerSearch(call) {
    const url = customerSearchUrl(call && call.customerNumber, customerSearchJql);
    if (!url) return;
    window.open(url, "_blank", "noopener");
  }

  // Gesprächsergebnis direkt nach dem Auflegen – hier, wo der Bearbeiter
  // gerade sitzt. Die lokale KI läuft aber auf der Jira-Seite, deshalb wird
  // der Klick nur als Staffelstab in den Storage gelegt; das Panel formuliert
  // daraus den Kommentar und legt ggf. die Wiedervorlage an.
  const OUTCOMES = (CONFIG.outbound && CONFIG.outbound.outcomes) || [];

  function outcomeBarMarkup(call) {
    if (call.status !== STATUS.ENDED || !OUTCOMES.length) return "";
    if (outcomeSentForCallId === callId) {
      return `<p class="tc-outcome-done">Ergebnis übernommen – Kommentar-Entwurf wartet in Jira.</p>`;
    }
    const buttons = OUTCOMES.map((outcome) =>
      `<button type="button" data-act="outcome" data-outcome="${escapeHtml(outcome.id)}">${escapeHtml(outcome.label)}</button>`
    ).join("");
    return `
      <div class="tc-outcome">
        <span class="tc-outcome-label">Ergebnis festhalten</span>
        <div class="tc-outcome-buttons">${buttons}</div>
      </div>`;
  }

  let outcomeSentForCallId = null;

  function sendOutcome(outcomeId, call) {
    if (!OUTCOMES.some((outcome) => outcome.id === outcomeId)) return;
    outcomeSentForCallId = callId;
    storageSet({
      [CONFIG.storageKeys.callOutcome]: {
        outcomeId,
        callId,
        mode: callMode,
        callerName: (call && call.callerName) || "",
        callerNumber: (call && call.callerNumber) || "",
        customerNumber: (call && call.customerNumber) || "",
        createdAt: Date.now()
      }
    });
    lastOverlaySignature = null;
    renderOverlay(call);
  }

  function queueTotal() {
    return queueTotalWaiting(queueStats);
  }

  function queueStaleText() {
    const minutes = queueStaleMinutes(queueStats, QUEUE_STALE_MS);
    return minutes ? `Stand: vor ${minutes} min (Portal-Tab zeigen für live)` : "";
  }

  function queueBlockMarkup(call) {
    if (!queueStats || !Array.isArray(queueStats.groups) || !queueStats.groups.length) {
      return `<p class="tc-hint">Wartefeld unbekannt – einmal den Portal-Tab öffnen.</p>`;
    }
    const total = queueTotal();
    const chips = queueStats.groups.map((group) => {
      const isCallGroup = groupsMatch(group.name, call.group);
      const hasWaiting = typeof group.waiting === "number" && group.waiting > 0;
      return `<span class="tc-chip ${isCallGroup ? "is-call-group" : ""} ${hasWaiting ? "has-waiting" : ""}">${escapeHtml(group.name)} <b>${typeof group.waiting === "number" ? group.waiting : "–"}</b></span>`;
    }).join("");
    const stale = queueStaleText();
    return `
      <div class="tc-queue-head"><span>Im Wartefeld</span><strong class="${total > 0 ? "has-waiting" : ""}">${total === null ? "–" : total}</strong>${stale ? `<em>${escapeHtml(stale)}</em>` : ""}</div>
      <div class="tc-chips">${chips}</div>`;
  }

  function ticketBlockMarkup(call) {
    if (!ticketContext || !ticketContext.key) {
      return `<p class="tc-hint">Kein Jira-Ticket erkannt – Ticket in Jira öffnen, dann erscheint der Kontext hier.</p>`;
    }
    const reference = (ticketContext.customerReference || "").trim();
    const referenceKnown = reference && reference !== "Nicht sichtbar";
    const comparable = referenceKnown && call.customerNumber;
    if (comparable && reference !== call.customerNumber.trim()) {
      return `<p class="tc-mismatch">⚠ Offenes Jira-Ticket ${escapeHtml(ticketContext.key)} gehört zu Kundenreferenz ${escapeHtml(reference)} – Anrufer hat ${escapeHtml(call.customerNumber)}. Richtiges Ticket öffnen!</p>`;
    }
    const matches = comparable && reference === call.customerNumber.trim();
    const summary = (ticketContext.aiSummary || "").trim();
    return `
      <div class="tc-ticket">
        <div class="tc-ticket-key">${escapeHtml(ticketContext.key)}${matches ? " ✓ passt zum Anrufer" : ""}</div>
        <strong>${escapeHtml(ticketContext.summary || "")}</strong>
        <p class="tc-ticket-meta">${escapeHtml([ticketContext.status, ticketContext.priority].filter(Boolean).join(" · "))}</p>
        ${summary ? `<div class="tc-summary">${escapeHtml(summary)}</div>` : `<p class="tc-hint">Noch keine KI-Zusammenfassung vorhanden.</p>`}
        ${matches ? "" : `<p class="tc-hint">Kein Kundennummern-Abgleich möglich – Anzeige ist das zuletzt geöffnete Ticket.</p>`}
      </div>`;
  }

  function timerText(call) {
    return callTimerText(call, connectedAt);
  }

  function statusMeta(call) {
    return callStatusMeta(call.status, callMode);
  }

  // Anrufziel und Gesprächspunkte aus der lokalen KI-Vorbereitung, die die
  // Jira-Seite mitveröffentlicht. Steht bei ausgehenden Anrufen im
  // Vordergrund: timio wählt selbst, es bleibt keine Vorbereitungszeit.
  function callPrepMarkup() {
    const prep = ticketContext && ticketContext.aiCallPrep;
    if (!prep || !prep.ziel) return "";
    const points = Array.isArray(prep.punkte) ? prep.punkte.slice(0, 3) : [];
    const questions = Array.isArray(prep.fragen) ? prep.fragen.slice(0, 3) : [];
    return `
      <div class="tc-prep">
        <div class="tc-prep-goal"><span>Ziel</span> ${escapeHtml(prep.ziel)}</div>
        ${points.length ? `<ul class="tc-prep-list">${points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>` : ""}
        ${questions.length ? `<div class="tc-prep-questions"><span>Fragen</span><ul>${questions.map((question) => `<li>${escapeHtml(question)}</li>`).join("")}</ul></div>` : ""}
      </div>`;
  }

  function overlayMarkup(call) {
    const meta = statusMeta(call);
    const nameLine = call.callerName || call.callerNumber || "Unbekannter Anrufer";
    const mini = overlayPrefs.mode === "mini";
    const total = queueTotal();
    const outbound = isOutbound(callMode);

    const headButtons = `
      <button type="button" data-act="mode" title="${mini ? "Ausklappen" : "Minimieren"}" aria-label="${mini ? "Ausklappen" : "Minimieren"}">${mini ? "▢" : "–"}</button>
      <button type="button" data-act="close" title="Für diesen Anruf ausblenden" aria-label="Schließen">×</button>`;

    if (mini) {
      return `
        <div class="tc-card tc-mini ${meta.cls} ${outbound ? "is-outbound" : ""}">
          <div class="tc-head" data-tid="drag" title="Zum Verschieben ziehen">
            <span class="tc-status">${escapeHtml(meta.label)}</span>
            <span class="tc-mini-name">${escapeHtml(nameLine)}</span>
            <span class="tc-timer" data-tid="timer">${escapeHtml(timerText(call))}</span>
            <span class="tc-mini-queue ${total ? "has-waiting" : ""}" title="Anrufe im Wartefeld">${total === null ? "–" : total}</span>
            ${headButtons}
          </div>
        </div>`;
    }

    // Ausgehend hat der Kunde nicht gewartet – die Wartezeit-Zeile wäre dort
    // schlicht falsch.
    const subLine = [
      call.callerNumber,
      call.customerNumber ? `Kundennummer ${call.customerNumber}` : "",
      call.group
    ].filter(Boolean).join(" · ");
    const waitInfo = !outbound && call.status !== STATUS.ENDED && call.waitTime
      ? `<p class="tc-wait">Kunde wartete ${escapeHtml(call.waitTime)} in der Leitung.</p>` : "";

    // Reihenfolge folgt dem Blickverlauf: ausgehend zählt zuerst, was ich von
    // dieser Person will; eingehend zuerst, wer da ist und wer noch wartet.
    const blocks = outbound
      ? `${callPrepMarkup()}${ticketBlockMarkup(call)}${outcomeBarMarkup(call)}<div class="tc-queue">${queueBlockMarkup(call)}</div>`
      : `<div class="tc-queue">${queueBlockMarkup(call)}</div>${ticketBlockMarkup(call)}${outcomeBarMarkup(call)}`;

    return `
      <div class="tc-card ${meta.cls} ${outbound ? "is-outbound" : ""}">
        <div class="tc-head" data-tid="drag" title="Zum Verschieben ziehen">
          <span class="tc-status">${escapeHtml(meta.label)}</span>
          <span class="tc-timer" data-tid="timer">${escapeHtml(timerText(call))}</span>
          ${modeSwitchMarkup()}
          ${headButtons}
        </div>
        <div class="tc-body">
          <div class="tc-caller">
            <strong>${escapeHtml(nameLine)}</strong>
            ${subLine ? `<p>${escapeHtml(subLine)}</p>` : ""}
            ${waitInfo}
            ${customerSearchMarkup(call)}
            ${outboundHintMarkup(call)}
          </div>
          ${blocks}
        </div>
      </div>`;
  }

  function applyOverlayPosition(root) {
    const pos = overlayPrefs.pos;
    if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return;
    root.style.left = `${Math.min(Math.max(0, pos.x), Math.max(0, window.innerWidth - 90))}px`;
    root.style.top = `${Math.min(Math.max(0, pos.y), Math.max(0, window.innerHeight - 50))}px`;
    root.style.right = "auto";
  }

  function onOverlayClick(event) {
    const control = event.target.closest("[data-act]");
    if (!control) return;
    const act = control.dataset.act;
    if (act === "mode-inbound" || act === "mode-outbound") {
      setCallMode(act === "mode-outbound" ? "outbound" : "inbound");
      return;
    }
    if (act === "search-customer") {
      openCustomerSearch(lastDetails);
      return;
    }
    if (act === "outcome") {
      sendOutcome(control.dataset.outcome, lastDetails || { status: STATUS.ENDED });
      return;
    }
    if (control.dataset.act === "close") {
      const inCall = lastDetails && lastDetails.status !== STATUS.IDLE && callId;
      if (inCall) {
        dismissedForCallId = callId || "none";
      } else {
        idleDismissed = true;
      }
      lastOverlaySignature = null;
      renderOverlay(lastDetails || { status: STATUS.IDLE });
    } else if (control.dataset.act === "mode") {
      overlayPrefs.mode = overlayPrefs.mode === "mini" ? "full" : "mini";
      persistOverlayPrefs();
      lastOverlaySignature = null;
      renderOverlay(lastDetails || { status: STATUS.IDLE });
    }
  }

  function onOverlayPointerDown(event) {
    const handle = event.target.closest("[data-tid='drag']");
    if (!handle || event.target.closest("button")) return;
    const root = document.getElementById(OVERLAY_ID);
    if (!root) return;
    event.preventDefault();
    const rect = root.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const onMove = (moveEvent) => {
      const x = Math.min(Math.max(0, moveEvent.clientX - offsetX), Math.max(0, window.innerWidth - 90));
      const y = Math.min(Math.max(0, moveEvent.clientY - offsetY), Math.max(0, window.innerHeight - 50));
      root.style.left = `${x}px`;
      root.style.top = `${y}px`;
      root.style.right = "auto";
      overlayPrefs.pos = { x, y };
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      persistOverlayPrefs();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  // Wartefeld-Widget außerhalb eines Anrufs: bleibt sichtbar, solange timio
  // offen ist und Wartefeld-Daten vorliegen. Bewusst unabhängig vom
  // Verfügbarkeits-Status oben in timio (Nutzerwunsch, 2026-07-17: die
  // Warteschlange soll immer zu sehen sein, nicht nur während eines Anrufs).
  function idleQueueMarkup() {
    const mini = overlayPrefs.mode === "mini";
    const total = queueTotal();
    const headButtons = `
      <button type="button" data-act="mode" title="${mini ? "Ausklappen" : "Minimieren"}" aria-label="${mini ? "Ausklappen" : "Minimieren"}">${mini ? "▢" : "–"}</button>
      <button type="button" data-act="close" title="Ausblenden" aria-label="Schließen">×</button>`;

    if (mini) {
      return `
        <div class="tc-card tc-mini tc-idle">
          <div class="tc-head" data-tid="drag" title="Zum Verschieben ziehen">
            <span class="tc-status">Wartefeld</span>
            <span class="tc-mini-queue ${total ? "has-waiting" : ""}" title="Anrufe im Wartefeld">${total === null ? "–" : total}</span>
            ${headButtons}
          </div>
        </div>`;
    }

    // Der Moduswechsel gehört auch zwischen zwei Gesprächen hierher: die
    // Richtung wird typischerweise vor dem Umstellen auf "bereit" gesetzt.
    return `
      <div class="tc-card tc-idle ${isOutbound(callMode) ? "is-outbound" : ""}">
        <div class="tc-head" data-tid="drag" title="Zum Verschieben ziehen">
          <span class="tc-status">${isOutbound(callMode) ? "Ausgehend" : "Wartefeld"}</span>
          ${modeSwitchMarkup()}
          ${headButtons}
        </div>
        <div class="tc-body">
          <div class="tc-queue">${queueBlockMarkup({ group: "" })}</div>
        </div>
      </div>`;
  }

  function renderOverlay(call) {
    if (stopped) return;
    // Nach dem Auflegen blendet sich das Cockpit selbst aus – im
    // Outbound-Modus später, weil dort noch das Gesprächsergebnis erfasst wird
    // (nach dem Erfassen greift wieder das kurze Fenster).
    const endedWindow = isOutbound(callMode) && outcomeSentForCallId !== callId
      ? ENDED_OUTBOUND_OVERLAY_MS
      : ENDED_OVERLAY_MS;
    if (call.status === STATUS.ENDED && endedAt && Date.now() - endedAt > endedWindow) {
      dismissedForCallId = callId || dismissedForCallId;
    }
    const callVisible = call.status !== STATUS.IDLE && callId && callId !== dismissedForCallId;
    const hasQueueData = queueStats && Array.isArray(queueStats.groups) && queueStats.groups.length > 0;
    const idleQueueVisible = !callVisible && hasQueueData && !idleDismissed;
    const visible = callVisible || idleQueueVisible;

    let root = document.getElementById(OVERLAY_ID);
    if (!visible) {
      if (root) root.remove();
      lastOverlaySignature = null;
      return;
    }
    if (!root) {
      root = document.createElement("div");
      root.id = OVERLAY_ID;
      document.body.appendChild(root);
      root.addEventListener("click", onOverlayClick);
      root.addEventListener("pointerdown", onOverlayPointerDown);
    }

    // Wartefeld inhaltsbasiert in die Signatur aufnehmen (nicht nur updatedAt):
    // zwei Updates innerhalb derselben Millisekunde trügen sonst denselben
    // Zeitstempel und die neue Zahl würde nie gezeichnet.
    const signature = callVisible
      ? JSON.stringify([
          "call", call.status, call.callerName, call.callerNumber, call.customerNumber, call.group,
          overlayPrefs.mode, callMode, looksOutbound(call), outcomeSentForCallId === callId,
          queueStats,
          ticketContext && [ticketContext.key, ticketContext.aiSummary, ticketContext.customerReference, ticketContext.aiCallPrep]
        ])
      : JSON.stringify(["idle", overlayPrefs.mode, callMode, queueStats]);
    if (signature !== lastOverlaySignature) {
      lastOverlaySignature = signature;
      root.innerHTML = callVisible ? overlayMarkup(call) : idleQueueMarkup();
      applyOverlayPosition(root);
    }
    if (callVisible) {
      const timerNode = root.querySelector("[data-tid='timer']");
      if (timerNode) timerNode.textContent = timerText(call);
    }
  }

  // ---------------------------------------------------------------------------
  // Hauptschleife
  // ---------------------------------------------------------------------------

  function tick() {
    if (stopped) return;
    if (!extensionAlive()) { shutdown(); return; }

    const callState = resolveCallState();
    const callSignature = callSignatureOf(callState);
    const callHeartbeatDue = callState.status !== STATUS.IDLE
      && (Date.now() - lastCallWriteAt) >= HEARTBEAT_MS;
    if (callSignature !== lastCallSignature || callHeartbeatDue) {
      persistCall(callState);
    }

    // Wartefeld nur schreiben, wenn das Portal tatsächlich sichtbar ist
    // (sonst würden leere Daten den letzten bekannten Stand überschreiben).
    const groups = parseQueueGroups(pageText());
    if (groups.length) {
      const queueSignature = JSON.stringify(groups);
      const queueHeartbeatDue = (Date.now() - lastQueueWriteAt) >= QUEUE_HEARTBEAT_MS;
      if (queueSignature !== lastQueueSignature || queueHeartbeatDue) {
        persistQueues(groups);
      }
    }

    renderOverlay(callState);
  }

  // Initialen Stand laden (Wartefeld ggf. von anderem Tab, Ticket von Jira,
  // gemerkte Overlay-Position) und auf Änderungen der Jira-Seite hören.
  try {
    chrome.storage.local.get([
      CONFIG.storageKeys.queueStats,
      CONFIG.storageKeys.ticketContext,
      CONFIG.storageKeys.timioOverlay,
      CONFIG.storageKeys.callMode,
      CONFIG.storageKeys.settings
    ], (data) => {
      if (stopped || !data) return;
      queueStats = data[CONFIG.storageKeys.queueStats] || queueStats;
      ticketContext = data[CONFIG.storageKeys.ticketContext] || null;
      callMode = callModeMeta(data[CONFIG.storageKeys.callMode]).id;
      const settings = data[CONFIG.storageKeys.settings];
      if (settings && typeof settings === "object") customerSearchJql = settings.customerSearchJql || "";
      const prefs = data[CONFIG.storageKeys.timioOverlay];
      if (prefs && typeof prefs === "object") {
        if (prefs.mode === "mini" || prefs.mode === "full") overlayPrefs.mode = prefs.mode;
        if (prefs.pos && typeof prefs.pos.x === "number" && typeof prefs.pos.y === "number") overlayPrefs.pos = prefs.pos;
      }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (stopped || area !== "local") return;
      if (Object.prototype.hasOwnProperty.call(changes, CONFIG.storageKeys.ticketContext)) {
        ticketContext = changes[CONFIG.storageKeys.ticketContext].newValue || null;
      }
      if (Object.prototype.hasOwnProperty.call(changes, CONFIG.storageKeys.queueStats)) {
        queueStats = changes[CONFIG.storageKeys.queueStats].newValue || queueStats;
      }
      // Der Modus kann auch im Jira-Panel umgelegt worden sein – beide Seiten
      // zeigen denselben Schalter und müssen sofort übereinstimmen.
      if (Object.prototype.hasOwnProperty.call(changes, CONFIG.storageKeys.callMode)) {
        callMode = callModeMeta(changes[CONFIG.storageKeys.callMode].newValue).id;
        lastOverlaySignature = null;
      }
      if (Object.prototype.hasOwnProperty.call(changes, CONFIG.storageKeys.settings)) {
        const next = changes[CONFIG.storageKeys.settings].newValue;
        customerSearchJql = (next && next.customerSearchJql) || "";
      }
    });
  } catch (error) {
    // Chrome-Kontext nicht verfügbar – Script beendet sich beim nächsten Tick.
  }

  // Beim Schließen des timio-Tabs die Anruferdaten sofort aufräumen, statt sie
  // als verwaisten Eintrag im lokalen Storage liegen zu lassen (Datensparsamkeit).
  // Läuft parallel ein zweiter timio-Tab mit aktivem Call, stellt dessen
  // Heartbeat den Zustand innerhalb weniger Sekunden wieder her.
  window.addEventListener("pagehide", () => {
    storageSet({ [CONFIG.storageKeys.activeCall]: { status: STATUS.IDLE, updatedAt: Date.now() } });
  });

  intervalId = window.setInterval(tick, POLL_MS);
  tick();
})();
