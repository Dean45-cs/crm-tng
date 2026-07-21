(function initTimioContent() {
  "use strict";

  const app = window.StadtnetzCRM;
  const CONFIG = app.CONFIG;
  const {
    escapeHtml, extensionAlive, queueTotalWaiting, queueStaleMinutes, groupsMatch,
    callStatusMeta, callTimerText, callModeMeta, isOutbound, customerSearchUrl,
    jiraTicketUrl, formatDateDE, calcContractCommission,
    calcTariffCommission, groupProductsByCategory, todayIso
  } = app.shared;
  const supabaseClient = app.supabaseClient;
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
    // Die Befehlspalette hängt an einem eigenen DOM-Root und einem
    // dokumentweiten Listener — beide würden die alte Instanz sonst
    // überleben und nach einem Extension-Reload auf einem toten
    // Chrome-Kontext suchen.
    document.removeEventListener("keydown", onGlobalKeydown);
    const palette = document.getElementById(PALETTE_ID);
    if (palette) palette.remove();
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
  // Zuletzt vergebene callId. Date.now() hat nur Millisekunden-Auflösung —
  // folgen zwei Anrufe schnell genug aufeinander, bekämen sie dieselbe ID und
  // jedes Dedup, das auf callId-Gleichheit prüft (Kundenakte, Anruf-Schreibpfad,
  // Abschluss-Panel), hielte den zweiten Anruf fälschlich für den ersten.
  // Die ID ist überall ein opaker Schlüssel, nie ein Zeitstempel — deshalb ist
  // ein Hochzählen bei Gleichstand unbedenklich und garantiert Eindeutigkeit.
  let lastAssignedCallId = 0;
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
        if (callId <= lastAssignedCallId) callId = lastAssignedCallId + 1;
        lastAssignedCallId = callId;
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
    // Anruf ohne "Beendet"-Screen abgeschlossen (z. B. aufgelegt, bevor
    // angenommen wurde – dafür gibt es keine Gnadenfrist wie oben bei
    // CONNECTED). Best-effort abschließen, sonst bliebe die DB-Zeile für
    // immer "aktiv" und würde die Live-Anrufleiste im CRM verstopfen.
    if (supabaseClient && dbCallId && callEndedForId !== callId) {
      const orphanCallId = dbCallId;
      const approxDurationS = connectedAt ? Math.round((Date.now() - connectedAt) / 1000) : null;
      supabaseClient.endCall(orphanCallId, {
        endedAt: new Date().toISOString(),
        durationS: approxDurationS
      }).catch(() => {});
    }
    publicStatus = STATUS.IDLE;
    graceUntil = 0;
    lastDetails = null;
    connectedAt = null;
    callId = null;
    endedAt = null;
    cameFromRinging = false;
    // Nächster Anruf soll wieder frisch nachschlagen, nicht die Kundenakte
    // des vorigen Gesprächs kurz weiterzeigen.
    customerCardState = null;
    customerCardLookupKey = null;
    dbCallId = null;
    callStartedForId = null;
    callEndedForId = null;
    closeoutState = null;
    closeoutOpenedForId = null;
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

  // Kundenakte (Stufe 1, KONZEPT-INTEGRATION.md): { callId, customerNumber,
  // status: "loading"|"ok"|"not-found"|"not-logged-in"|"not-configured"|
  // "network"|"error", data, error, updatedAt }. Wird hier ausgelöst (der
  // Anruf mit Kundennummer entsteht in timio) und in chrome.storage.local
  // veröffentlicht, damit ui.js (Jira-Seite) sie ebenfalls anzeigen kann.
  let customerCardState = null;
  let customerCardLookupKey = null; // "<callId>:<customerNumber>" – ein Lookup pro Anruf+Nummer

  // Anruf-Schreibpfad (Stufe 2, KONZEPT-INTEGRATION.md): dbCallId ist die
  // Supabase-Zeilen-ID des aktuellen Anrufs, sobald startCall() erfolgreich
  // war. callStartedForId/callEndedForId dedupen Start/Abschluss pro lokalem
  // callId – exakt das Muster von customerCardLookupKey oben.
  let dbCallId = null;
  let callStartedForId = null;
  let callEndedForId = null;

  // Abschluss-Panel (Stufe 3, KONZEPT-INTEGRATION.md): { callId, entryType:
  // "notiz"|"lead"|"vertrag"|"tarifwechsel", fields, status: "idle"|"saving"|
  // "done"|"error", error }. fields ist ein flaches Superset aller vier Typen
  // und wird beim Typwechsel NIE geleert. closeoutOpenedForId dedupliziert das
  // automatische Öffnen bei eingehenden Anrufen (kein Klick nötig).
  let closeoutState = null;
  let closeoutOpenedForId = null;
  // Produktkatalog + Provisions-Matrix — überlebt über Anrufe hinweg als
  // Modul-Cache (ändert sich selten), deshalb NICHT im Idle-Reset gelöscht.
  let sharedSettingsState = { status: "idle", data: null, error: "" };

  // Befehlspalette (Stufe 4, KONZEPT-INTEGRATION.md): unabhängig vom
  // Call-Cockpit, muss jederzeit auslösbar sein — deshalb NICHT im
  // Idle-Reset gelöscht, genau wie sharedSettingsState oben.
  let paletteState = null; // { open, query, groups, status, error, activeIdx } | null
  let paletteSearchTimer = null;

  function writeCustomerCard(next) {
    customerCardState = next;
    storageSet({ [CONFIG.storageKeys.customerCard]: next });
  }

  // Löst pro Anruf+Kundennummer genau einen Lookup aus. Degradiert überall
  // sauber: kein supabaseClient (Skript-Ladereihenfolge kaputt), keine
  // Kundennummer erkannt, oder der Anruf ist schon vorbei → einfach nichts tun.
  function maybeLookupCustomer(call) {
    if (!supabaseClient || !call || call.status === STATUS.IDLE || !callId) return;
    const number = (call.customerNumber || "").trim();
    if (!number) return;
    const lookupCallId = callId;
    const key = `${lookupCallId}:${number}`;
    if (customerCardLookupKey === key) return;
    customerCardLookupKey = key;

    writeCustomerCard({
      callId: lookupCallId, customerNumber: number, status: "loading",
      data: null, error: "", updatedAt: Date.now()
    });

    supabaseClient.customerCard(number).then((res) => {
      if (stopped || customerCardLookupKey !== key) return;
      const status = res.ok ? (res.data ? "ok" : "not-found") : (res.reason || "error");
      writeCustomerCard({
        callId: lookupCallId, customerNumber: number, status,
        data: res.ok ? res.data : null, error: res.ok ? "" : (res.error || ""), updatedAt: Date.now()
      });
      renderOverlay(lastDetails || { status: STATUS.IDLE });
    }).catch((error) => {
      if (stopped || customerCardLookupKey !== key) return;
      writeCustomerCard({
        callId: lookupCallId, customerNumber: number, status: "error",
        data: null, error: String((error && error.message) || error), updatedAt: Date.now()
      });
      renderOverlay(lastDetails || { status: STATUS.IDLE });
    });
  }

  // "3:12" → 192, "1:01:01" → 3661. timio zeigt die Enddauer nur als Text
  // ("Dauer: mm:ss" bzw. h:mm:ss, siehe readCallDetails/finalDuration) – für
  // calls.duration_s (int, Sekunden) muss das zurückgerechnet werden.
  function parseDurationToSeconds(text) {
    if (!text) return null;
    const parts = String(text).split(":").map((p) => Number(p));
    if (!parts.length || parts.some((p) => !Number.isFinite(p))) return null;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return null;
  }

  // Legt einmal pro Anruf eine calls-Zeile an, sobald er sichtbar wird
  // (klingelt/verbindet). Richtung kommt aus dem aktuellen callMode – der ist
  // beim Klingeln nicht immer schon korrekt gesetzt (siehe outboundHintMarkup),
  // aber ein Best-Effort-Wert jetzt ist besser, als auf eine Bestätigung zu
  // warten, die bei den meisten Anrufen nie kommt.
  function maybeStartCall(call) {
    if (!supabaseClient || !call || call.status === STATUS.IDLE || !callId) return;
    if (callStartedForId === callId) return;
    callStartedForId = callId;
    const startedCallId = callId;

    supabaseClient.startCall({
      customerNumber: (call.customerNumber || "").trim() || undefined,
      callerName: (call.callerName || "").trim() || undefined,
      callerNumber: (call.callerNumber || "").trim() || undefined,
      direction: isOutbound(callMode) ? "outbound" : "inbound",
      queueGroup: (call.group || "").trim() || undefined
    }).then((res) => {
      // Anruf ist inzwischen vorbei oder ein neuer hat begonnen — die
      // zurückkommende ID gehört dann nicht mehr zum aktuellen Gespräch.
      if (stopped || callId !== startedCallId) return;
      if (res.ok) dbCallId = res.id;
    }).catch(() => {});
  }

  // Schließt die Anruf-Zeile ab, sobald der "Beendet"-Screen eine feste
  // Enddauer zeigt. Der Fall ohne "Beendet"-Screen (aufgelegt, bevor
  // angenommen wurde) wird best-effort im Idle-Reset von resolveCallState()
  // abgeschlossen, s. dort.
  function maybeEndCall(call) {
    if (!supabaseClient || !call || call.status !== STATUS.ENDED || !dbCallId) return;
    if (callEndedForId === callId) return;
    callEndedForId = callId;
    supabaseClient.endCall(dbCallId, {
      endedAt: new Date().toISOString(),
      durationS: parseDurationToSeconds(call.finalDuration)
    }).catch(() => {});
  }

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

  // Kundenakte aus dem CRM (Stufe 1, KONZEPT-INTEGRATION.md): Name,
  // Kontaktdaten, Vorgangszählung und – falls vorhanden – ein direkter
  // Ticket-Link. Macht die JQL-Suche unten überflüssig, sobald sie greift,
  // ersetzt sie aber nicht (Lookup kann fehlschlagen: nicht angemeldet,
  // Kunde unbekannt, offline).
  function kundenakteMarkup(call) {
    if (!call || !call.customerNumber) return "";
    const number = call.customerNumber.trim();
    if (!number || !customerCardState || customerCardState.customerNumber !== number) return "";
    const state = customerCardState;

    if (state.status === "loading") {
      return `<div class="tc-akte tc-akte-loading">Kundenakte wird geladen …</div>`;
    }
    if (state.status === "not-configured") {
      return "";
    }
    if (state.status === "not-logged-in") {
      return `<div class="tc-akte tc-akte-hint">Kundenakte: nicht bei Supabase angemeldet (Einstellungen ⚙).</div>`;
    }
    if (state.status === "not-found") {
      return `<div class="tc-akte tc-akte-hint">Kundennummer ${escapeHtml(number)} im CRM noch nicht bekannt.</div>`;
    }
    if (state.status !== "ok" || !state.data) {
      return `<div class="tc-akte tc-akte-hint">Kundenakte gerade nicht abrufbar.</div>`;
    }

    const d = state.data;
    const jiraButton = d.jiraTicket
      ? `<a class="tc-akte-jira" href="${escapeHtml(jiraTicketUrl(d.jiraTicket))}" target="_blank" rel="noopener">Ticket ${escapeHtml(d.jiraTicket)} öffnen</a>`
      : "";
    return `
      <div class="tc-akte">
        <div class="tc-akte-head">${escapeHtml(d.name || "Unbenannt")}${d.phone ? ` · ${escapeHtml(d.phone)}` : ""}</div>
        <div class="tc-akte-counts">
          <span>${d.contractCount} Vertr.</span>
          <span>${d.tariffChangeCount} Wechsel</span>
          <span>${d.noteCount} Notizen</span>
          <span>Seit ${escapeHtml(formatDateDE(d.firstSeenAt))}</span>
        </div>
        ${jiraButton}
      </div>`;
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
  // daraus den Kommentar und legt ggf. die Wiedervorlage an. Eingehend und
  // ausgehend haben eigene Wortschätze (Stufe 3, KONZEPT-INTEGRATION.md) —
  // "Mailbox"/"Falsche Nummer" ergeben bei einem eingehenden Anruf keinen Sinn.
  function activeOutcomes() {
    const cfg = isOutbound(callMode) ? CONFIG.outbound : CONFIG.inbound;
    return (cfg && cfg.outcomes) || [];
  }

  function outcomeBarMarkup(call) {
    const outcomes = activeOutcomes();
    if (call.status !== STATUS.ENDED || !outcomes.length) return "";
    if (outcomeSentForCallId === callId) {
      return `<p class="tc-outcome-done">Ergebnis übernommen – Kommentar-Entwurf wartet in Jira.</p>`;
    }
    const buttons = outcomes.map((outcome) =>
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
    const outcome = activeOutcomes().find((o) => o.id === outcomeId);
    if (!outcome) return;
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
    // "Ergebnis festhalten" öffnet für Optionen mit echtem Gesprächsinhalt
    // zusätzlich das Abschluss-Panel — das ist das "fehlende Ziel" des
    // Staffelstabs (KONZEPT-INTEGRATION.md, Stufe 3).
    if (outcome.opensPanel) openCloseout("notiz", call, outcome.seed);
    lastOverlaySignature = null;
    renderOverlay(call);
  }

  // ---------------------------------------------------------------------------
  // Abschluss-Panel (Stufe 3, KONZEPT-INTEGRATION.md) — "Ein Gespräch, eine
  // Erfassung". Erzeugt am Ende eines Anrufs einen echten CRM-Eintrag (Notiz,
  // Lead, Vertrag oder Tarifwechsel), statt den Anruf dreimal an drei Stellen
  // zu dokumentieren.
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

  function defaultCloseoutFields(call, seedText) {
    const card = customerCardState && customerCardState.status === "ok" ? customerCardState.data : null;
    const ticketKey = (ticketContext && ticketContext.key) || "";
    return {
      title: `Telefonat${ticketKey ? " zu " + ticketKey : ""}`,
      content: seedText || "",
      contentTouched: false,
      customerName: (card && card.name) || (call && call.callerName) || "",
      customerNumber: (call && call.customerNumber) || "",
      phone: (call && call.callerNumber) || "",
      topic: (ticketContext && ticketContext.summary) || "",
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
  // offen (z. B. automatisch bei Inbound, siehe maybeOpenCloseoutPanel), wird
  // NICHT zurückgesetzt — nur ein noch unangetasteter content-Text wird
  // nachträglich mit dem Seed einer geklickten Ergebnis-Option befüllt, damit
  // ein Klick nach dem automatischen Öffnen nichts bereits Getipptes überschreibt.
  function openCloseout(entryType, call, seedText) {
    if (!closeoutState || closeoutState.callId !== callId) {
      closeoutState = {
        callId,
        entryType,
        fields: defaultCloseoutFields(call, seedText),
        status: "idle",
        error: ""
      };
    } else if (seedText && !closeoutState.fields.contentTouched) {
      closeoutState.fields.content = seedText;
    }
    if (entryType === "vertrag" || entryType === "tarifwechsel") maybeLoadSharedSettings();
    if (overlayPrefs.mode === "mini") {
      overlayPrefs.mode = "full";
      persistOverlayPrefs();
    }
    lastOverlaySignature = null;
    renderOverlay(call);
  }

  // Eingehende Anrufe bekommen das Panel ohne Klick — anders als bei
  // ausgehenden Anrufen gibt es keinen "niemand erreicht"-Fall, ein Anrufer
  // hat per Definition immer ein Anliegen.
  function maybeOpenCloseoutPanel(call) {
    if (isOutbound(callMode)) return;
    if (!call || call.status !== STATUS.ENDED || !callId) return;
    if (closeoutOpenedForId === callId) return;
    closeoutOpenedForId = callId;
    openCloseout("notiz", call, "");
  }

  function setCloseoutField(key, value) {
    if (!closeoutState) return;
    closeoutState.fields[key] = value;
    lastOverlaySignature = null;
    renderOverlay(lastDetails || { status: STATUS.IDLE });
  }

  function maybeLoadSharedSettings(opts) {
    if (!supabaseClient) return;
    const forceRefresh = Boolean(opts && opts.forceRefresh);
    if (sharedSettingsState.status === "loading") return;
    if (!forceRefresh && sharedSettingsState.status === "ok") return;
    sharedSettingsState = { status: "loading", data: sharedSettingsState.data, error: "" };
    lastOverlaySignature = null;
    renderOverlay(lastDetails || { status: STATUS.IDLE });
    supabaseClient.fetchSharedSettings({ forceRefresh }).then((res) => {
      if (stopped) return;
      sharedSettingsState = res.ok
        ? { status: "ok", data: res.data, error: "" }
        : { status: res.reason === "not-logged-in" ? "not-logged-in" : "error", data: sharedSettingsState.data, error: res.error || "" };
      lastOverlaySignature = null;
      renderOverlay(lastDetails || { status: STATUS.IDLE });
    }).catch((error) => {
      if (stopped) return;
      sharedSettingsState = { status: "error", data: sharedSettingsState.data, error: String((error && error.message) || error) };
      lastOverlaySignature = null;
      renderOverlay(lastDetails || { status: STATUS.IDLE });
    });
  }

  async function submitCloseout() {
    if (!closeoutState || !supabaseClient) return;
    const submittedCallId = closeoutState.callId;
    const entryType = closeoutState.entryType;
    const fields = closeoutState.fields;
    closeoutState.status = "saving";
    closeoutState.error = "";
    lastOverlaySignature = null;
    renderOverlay(lastDetails || { status: STATUS.IDLE });

    let res;
    if (entryType === "notiz") res = await supabaseClient.insertNote(fields);
    else if (entryType === "lead") res = await supabaseClient.insertLead(fields);
    else if (entryType === "vertrag") res = await supabaseClient.insertContract(fields);
    else if (entryType === "tarifwechsel") res = await supabaseClient.insertTariffChange(fields);
    else return;

    // Anruf ist inzwischen vorbei oder ein neuer hat begonnen — das Ergebnis
    // gehört dann nicht mehr zum aktuell sichtbaren Panel.
    if (stopped || !closeoutState || closeoutState.callId !== submittedCallId) return;

    if (res.ok) {
      closeoutState.status = "done";
    } else {
      closeoutState.status = "error";
      closeoutState.error = res.reason === "not-logged-in"
        ? "Nicht bei Supabase angemeldet."
        : (res.error || "Speichern fehlgeschlagen.");
    }
    lastOverlaySignature = null;
    renderOverlay(lastDetails || { status: STATUS.IDLE });
  }

  function closeoutStatusLine() {
    if (sharedSettingsState.status === "loading") return `<p class="tc-hint">Produktkatalog wird geladen …</p>`;
    if (sharedSettingsState.status === "not-logged-in") return `<p class="tc-hint">Nicht bei Supabase angemeldet — Produktkatalog nicht verfügbar.</p>`;
    if (sharedSettingsState.status === "error") {
      return `<p class="tc-hint">Produktkatalog gerade nicht abrufbar. <button type="button" class="tc-link-btn" data-act="closeout-refresh-settings">Erneut versuchen</button></p>`;
    }
    return "";
  }

  function productDatalistMarkup() {
    const products = (sharedSettingsState.data && sharedSettingsState.data.products) || [];
    return `<datalist id="tc-closeout-products">${products.map((p) => `<option value="${escapeHtml(p.name)}"></option>`).join("")}</datalist>`;
  }

  function closeoutChipGroup(act, options, currentValue) {
    return `<div class="tc-closeout-chipgroup">${options.map(([id, label]) =>
      `<button type="button" class="tc-chip-btn ${currentValue === id ? "is-active" : ""}" data-act="${act}" data-value="${id === null ? "" : escapeHtml(String(id))}">${escapeHtml(label)}</button>`
    ).join("")}</div>`;
  }

  function closeoutProductPickerMarkup(fields) {
    if (sharedSettingsState.status !== "ok") return "";
    const groups = groupProductsByCategory(sharedSettingsState.data.products);
    return groups.map((group) => `
      <div class="tc-closeout-product-group">
        <span class="tc-closeout-product-cat">${escapeHtml(group.category)}</span>
        <div class="tc-closeout-product-chips">
          ${group.products.map((p) => {
            const active = fields.products.includes(p.name);
            return `<button type="button" class="tc-chip-btn ${active ? "is-active" : ""}" data-act="closeout-toggle-product" data-product="${escapeHtml(p.name)}">${escapeHtml(p.name)} · ${Number(p.commission).toFixed(2)} €</button>`;
          }).join("")}
        </div>
      </div>`).join("");
  }

  function closeoutNotizFieldsMarkup(fields) {
    return `
      <label class="tc-closeout-label">Titel
        <input type="text" data-role="closeout-title" value="${escapeHtml(fields.title)}">
      </label>
      <label class="tc-closeout-label">Inhalt
        <textarea data-role="closeout-content" rows="4">${escapeHtml(fields.content)}</textarea>
      </label>`;
  }

  function closeoutLeadFieldsMarkup(fields) {
    return `
      <label class="tc-closeout-label">Anliegen
        <input type="text" data-role="closeout-topic" value="${escapeHtml(fields.topic)}">
      </label>
      <label class="tc-closeout-label">Telefon
        <input type="text" data-role="closeout-phone" value="${escapeHtml(fields.phone)}">
      </label>
      ${closeoutChipGroup("closeout-set-lead-status", CLOSEOUT_LEAD_STATUS, fields.status)}
      ${closeoutChipGroup("closeout-set-lead-priority", CLOSEOUT_LEAD_PRIORITY, fields.priority)}
      <label class="tc-closeout-label">Wiedervorlage
        <input type="date" data-role="closeout-followup-date" value="${escapeHtml(fields.followUpDate)}">
      </label>
      <label class="tc-closeout-label">Notizen
        <textarea data-role="closeout-notes" rows="3">${escapeHtml(fields.notes)}</textarea>
      </label>`;
  }

  function closeoutVertragFieldsMarkup(fields) {
    return `
      <label class="tc-closeout-label">Vertragsdatum
        <input type="date" data-role="closeout-contract-date" value="${escapeHtml(fields.contractDate)}">
      </label>
      ${closeoutChipGroup("closeout-set-contract-status", CLOSEOUT_CONTRACT_STATUS, fields.contractStatus)}
      ${closeoutChipGroup("closeout-set-contract-laufzeit", CLOSEOUT_LAUFZEIT, fields.laufzeitMonate)}
      ${closeoutStatusLine()}
      <div class="tc-closeout-products">${closeoutProductPickerMarkup(fields)}</div>
      <label class="tc-closeout-label">Wiedervorlage
        <input type="date" data-role="closeout-followup-date" value="${escapeHtml(fields.followUpDate)}">
      </label>
      <label class="tc-closeout-label">Notizen
        <textarea data-role="closeout-notes" rows="3">${escapeHtml(fields.notes)}</textarea>
      </label>`;
  }

  function closeoutTarifwechselFieldsMarkup(fields) {
    return `
      <label class="tc-closeout-label">Wechseldatum
        <input type="date" data-role="closeout-change-date" value="${escapeHtml(fields.changeDate)}">
      </label>
      ${closeoutChipGroup("closeout-set-tarif-changetype", CLOSEOUT_TARIFF_TYPE, fields.changeType)}
      ${closeoutChipGroup("closeout-set-tarif-context", CLOSEOUT_TARIFF_CONTEXT, fields.context)}
      ${closeoutStatusLine()}
      <label class="tc-closeout-label">Altes Produkt
        <input type="text" list="tc-closeout-products" data-role="closeout-old-product" value="${escapeHtml(fields.oldProduct)}">
      </label>
      <label class="tc-closeout-label">Neues Produkt
        <input type="text" list="tc-closeout-products" data-role="closeout-new-product" value="${escapeHtml(fields.newProduct)}">
      </label>
      ${productDatalistMarkup()}
      <label class="tc-closeout-label">Notizen
        <textarea data-role="closeout-notes" rows="3">${escapeHtml(fields.notes)}</textarea>
      </label>`;
  }

  function closeoutCommissionMarkup(entryType, fields) {
    if (entryType === "vertrag") {
      const total = calcContractCommission({ products: fields.products, status: fields.contractStatus }, sharedSettingsState.data || {});
      return `<div class="tc-closeout-commission">Provision: <strong>${total.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</strong></div>`;
    }
    if (entryType === "tarifwechsel") {
      const canCalc = fields.changeType && fields.context;
      const total = canCalc ? calcTariffCommission({ changeType: fields.changeType, context: fields.context }, sharedSettingsState.data || {}) : null;
      return `<div class="tc-closeout-commission">Provision: <strong>${total === null ? "–" : total.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"}</strong></div>`;
    }
    return "";
  }

  function closeoutPanelMarkup(call) {
    if (!closeoutState || closeoutState.callId !== callId) return "";
    const { entryType, fields, status, error } = closeoutState;

    if (status === "done") {
      return `<div class="tc-closeout tc-closeout-done">✓ ${escapeHtml(CLOSEOUT_TYPE_LABEL[entryType] || entryType)} gespeichert.</div>`;
    }

    const typeButtons = ["notiz", "lead", "vertrag", "tarifwechsel"].map((type) =>
      `<button type="button" class="tc-chip-btn ${entryType === type ? "is-active" : ""}" data-act="closeout-type" data-value="${type}">${CLOSEOUT_TYPE_LABEL[type]}</button>`
    ).join("");

    let fieldsMarkup = "";
    let submitDisabled = false;
    if (entryType === "notiz") fieldsMarkup = closeoutNotizFieldsMarkup(fields);
    else if (entryType === "lead") fieldsMarkup = closeoutLeadFieldsMarkup(fields);
    else if (entryType === "vertrag") { fieldsMarkup = closeoutVertragFieldsMarkup(fields); submitDisabled = sharedSettingsState.status !== "ok"; }
    else if (entryType === "tarifwechsel") { fieldsMarkup = closeoutTarifwechselFieldsMarkup(fields); submitDisabled = sharedSettingsState.status !== "ok"; }

    return `
      <div class="tc-closeout">
        <div class="tc-closeout-head"><span class="tc-closeout-title">Abschluss erfassen</span></div>
        <div class="tc-closeout-chipgroup">${typeButtons}</div>
        <label class="tc-closeout-label">Kundenname
          <input type="text" data-role="closeout-customer-name" value="${escapeHtml(fields.customerName)}">
        </label>
        <label class="tc-closeout-label">Kundennummer
          <input type="text" data-role="closeout-customer-number" value="${escapeHtml(fields.customerNumber)}">
        </label>
        ${fieldsMarkup}
        <label class="tc-closeout-label">Jira-Ticket
          <input type="text" data-role="closeout-jira-ticket" value="${escapeHtml(fields.jiraTicket)}">
        </label>
        ${closeoutCommissionMarkup(entryType, fields)}
        ${error ? `<p class="tc-closeout-error">${escapeHtml(error)}</p>` : ""}
        <button type="button" class="tc-closeout-submit" data-act="closeout-submit" ${status === "saving" || submitDisabled ? "disabled" : ""}>${status === "saving" ? "Speichert …" : "Speichern"}</button>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Befehlspalette (Stufe 4, KONZEPT-INTEGRATION.md) — ⌘K/Ctrl+K, unabhängig
  // vom Call-Cockpit (eigener DOM-Root, jederzeit auslösbar, nicht nur
  // während eines Anrufs). Sucht live über supabase.searchWorkspace() gegen
  // Kunden/Verträge/Tarifwechsel/Notizen; ein Treffer öffnet die passende
  // Kundenakte im CRM über den Deep-Link aus src/router.tsx (CRM-Repo).
  // ---------------------------------------------------------------------------

  const PALETTE_ID = "sc-timio-palette";
  const PALETTE_MIN_QUERY_LENGTH = 2;
  const PALETTE_DEBOUNCE_MS = 250;

  function paletteFlatItems() {
    const groups = (paletteState && paletteState.groups) || [];
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
    paletteState = { open: true, query: "", groups: [], status: "idle", error: "", activeIdx: 0 };
    renderPalette();
  }

  function closePalette() {
    if (paletteSearchTimer) { window.clearTimeout(paletteSearchTimer); paletteSearchTimer = null; }
    paletteState = null;
    renderPalette();
  }

  // Debounced statt bei jedem Tastendruck zu suchen — schont die vier
  // parallelen Netzwerk-Requests von searchWorkspace(). Ergebnis wird
  // verworfen, falls der Suchbegriff sich inzwischen geändert hat (Nutzer hat
  // weitergetippt, während die Antwort noch unterwegs war).
  function schedulePaletteSearch() {
    if (paletteSearchTimer) { window.clearTimeout(paletteSearchTimer); paletteSearchTimer = null; }
    const query = paletteState.query.trim();
    if (query.length < PALETTE_MIN_QUERY_LENGTH) {
      paletteState.status = "idle";
      paletteState.groups = [];
      updatePaletteResults();
      return;
    }
    paletteState.status = "loading";
    updatePaletteResults();
    paletteSearchTimer = window.setTimeout(async () => {
      if (!paletteState || !supabaseClient) return;
      const activeQuery = paletteState.query.trim();
      const res = await supabaseClient.searchWorkspace(activeQuery);
      if (!paletteState || paletteState.query.trim() !== activeQuery) return; // veraltete Antwort
      if (res.ok) {
        paletteState.status = "ok";
        paletteState.groups = res.groups;
      } else {
        paletteState.status = res.reason === "not-logged-in" ? "not-logged-in" : "error";
        paletteState.error = res.error || "";
      }
      paletteState.activeIdx = 0;
      updatePaletteResults();
    }, PALETTE_DEBOUNCE_MS);
  }

  function paletteResultsMarkup() {
    if (!paletteState) return "";
    const q = paletteState.query.trim();
    if (q.length < PALETTE_MIN_QUERY_LENGTH) return `<p class="tc-hint">Mindestens ${PALETTE_MIN_QUERY_LENGTH} Zeichen eingeben …</p>`;
    if (paletteState.status === "loading") return `<p class="tc-hint">Suche …</p>`;
    if (paletteState.status === "not-logged-in") return `<p class="tc-hint">Nicht bei Stadtnetz CRM angemeldet.</p>`;
    if (paletteState.status === "error") return `<p class="tc-hint">Suche gerade nicht möglich${paletteState.error ? ": " + escapeHtml(paletteState.error) : "."}</p>`;
    const groups = paletteState.groups || [];
    if (!groups.length) return `<p class="tc-hint">Keine Treffer für „${escapeHtml(q)}".</p>`;

    let idx = -1;
    return groups.map((g) => `
      <div class="tc-palette-group">${escapeHtml(g.group)}</div>
      ${(g.items || []).map((item) => {
        idx += 1;
        const active = idx === paletteState.activeIdx;
        return `
          <button type="button" class="tc-palette-item ${active ? "is-active" : ""}" data-palette-item data-customer="${escapeHtml(item.customerNumber || "")}">
            <span class="tc-palette-item-label">${escapeHtml(item.label || "")}</span>
            <span class="tc-palette-item-sub">${escapeHtml(item.sub || "")}</span>
          </button>`;
      }).join("")}
    `).join("");
  }

  function paletteMarkup() {
    const q = paletteState.query;
    return `
      <div class="tc-palette-backdrop" data-act="palette-backdrop">
        <div class="tc-palette" role="dialog" aria-modal="true" aria-label="Schnellsuche">
          <div class="tc-palette-input-row">
            <input type="text" data-role="palette-query" placeholder="Kunden, Verträge, Tarifwechsel, Notizen suchen …" value="${escapeHtml(q)}" autocomplete="off">
            <button type="button" class="tc-palette-close" data-act="palette-close" aria-label="Schließen">×</button>
          </div>
          <div data-tid="palette-results">${paletteResultsMarkup()}</div>
        </div>
      </div>`;
  }

  // Nur die Ergebnisliste patchen (nicht die ganze Palette neu aufbauen) —
  // sonst würde das fokussierte Eingabefeld bei jedem Suchergebnis (und bei
  // jedem Tastendruck, s. onPaletteInput) neu erzeugt und den Fokus/Cursor
  // verlieren. Gleiches Prinzip wie beim Timer-Patch in renderOverlay().
  function updatePaletteResults() {
    const root = document.getElementById(PALETTE_ID);
    if (!root) return;
    const resultsEl = root.querySelector("[data-tid='palette-results']");
    if (resultsEl) resultsEl.innerHTML = paletteResultsMarkup();
  }

  function renderPalette() {
    let root = document.getElementById(PALETTE_ID);
    if (!paletteState || !paletteState.open) {
      if (root) root.remove();
      return;
    }
    if (!root) {
      root = document.createElement("div");
      root.id = PALETTE_ID;
      document.body.appendChild(root);
      root.addEventListener("click", onPaletteClick);
      root.addEventListener("input", onPaletteInput);
    }
    root.innerHTML = paletteMarkup();
    const inputEl = root.querySelector("[data-role='palette-query']");
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
    const closeBtn = target.closest && target.closest("[data-act='palette-close']");
    if (closeBtn) { closePalette(); return; }
    const backdrop = target.closest && target.closest("[data-act='palette-backdrop']");
    if (backdrop && target === backdrop) { closePalette(); }
  }

  // Freitext direkt ins State-Objekt, OHNE renderPalette()/updatePaletteResults()
  // synchron aufzurufen — das Eingabefeld zeigt den Tastendruck bereits nativ.
  function onPaletteInput(event) {
    if (!paletteState) return;
    const role = event.target && event.target.dataset && event.target.dataset.role;
    if (role !== "palette-query") return;
    paletteState.query = event.target.value;
    paletteState.activeIdx = 0;
    schedulePaletteSearch();
  }

  function onGlobalKeydown(event) {
    if (stopped) return;
    const isToggleCombo = (event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === "k";
    if (isToggleCombo) {
      event.preventDefault();
      if (paletteState && paletteState.open) closePalette(); else openPalette();
      return;
    }
    if (!paletteState || !paletteState.open) return;
    if (event.key === "Escape") { event.preventDefault(); closePalette(); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const total = paletteFlatItems().length;
      if (!total) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      paletteState.activeIdx = (paletteState.activeIdx + delta + total) % total;
      updatePaletteResults();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = paletteFlatItems()[paletteState.activeIdx];
      if (item) openCrmDeepLink(item.customerNumber);
    }
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
      ? `${callPrepMarkup()}${ticketBlockMarkup(call)}${outcomeBarMarkup(call)}${closeoutPanelMarkup(call)}<div class="tc-queue">${queueBlockMarkup(call)}</div>`
      : `<div class="tc-queue">${queueBlockMarkup(call)}</div>${ticketBlockMarkup(call)}${outcomeBarMarkup(call)}${closeoutPanelMarkup(call)}`;

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
            ${kundenakteMarkup(call)}
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
    if (act === "closeout-type") {
      if (closeoutState) {
        closeoutState.entryType = control.dataset.value;
        if (control.dataset.value === "vertrag" || control.dataset.value === "tarifwechsel") maybeLoadSharedSettings();
        lastOverlaySignature = null;
        renderOverlay(lastDetails || { status: STATUS.IDLE });
      }
      return;
    }
    if (act === "closeout-toggle-product") {
      if (closeoutState) {
        const name = control.dataset.product;
        const products = closeoutState.fields.products;
        const idx = products.indexOf(name);
        if (idx >= 0) products.splice(idx, 1); else products.push(name);
        lastOverlaySignature = null;
        renderOverlay(lastDetails || { status: STATUS.IDLE });
      }
      return;
    }
    if (act === "closeout-set-lead-status") { setCloseoutField("status", control.dataset.value); return; }
    if (act === "closeout-set-lead-priority") { setCloseoutField("priority", control.dataset.value); return; }
    if (act === "closeout-set-contract-status") { setCloseoutField("contractStatus", control.dataset.value); return; }
    if (act === "closeout-set-contract-laufzeit") {
      setCloseoutField("laufzeitMonate", control.dataset.value ? Number(control.dataset.value) : null);
      return;
    }
    if (act === "closeout-set-tarif-changetype") { setCloseoutField("changeType", control.dataset.value); return; }
    if (act === "closeout-set-tarif-context") { setCloseoutField("context", control.dataset.value); return; }
    if (act === "closeout-refresh-settings") { maybeLoadSharedSettings({ forceRefresh: true }); return; }
    if (act === "closeout-submit") { submitCloseout(); return; }
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

  // Nur die NICHT-Freitext-Bestandteile des Abschluss-Panels — Werte aus
  // freien Texteingaben dürfen hier bewusst nicht auftauchen (siehe
  // onOverlayInput unten), sonst würde jeder Tastendruck den Signaturwert
  // ändern und innerHTML bei jedem tick() neu aufbauen, was Fokus und Cursor
  // aus dem gerade bearbeiteten Feld wirft.
  function closeoutSignaturePart() {
    if (!closeoutState || closeoutState.callId !== callId) return null;
    const f = closeoutState.fields;
    return [
      closeoutState.entryType, closeoutState.status, closeoutState.error,
      f.products, f.status, f.priority, f.contractStatus, f.laufzeitMonate, f.changeType, f.context,
      sharedSettingsState.status
    ];
  }

  // Freitextfelder des Abschluss-Panels direkt ins State-Objekt schreiben,
  // OHNE renderOverlay() aufzurufen — das DOM zeigt den Tastendruck bereits
  // nativ, ein Re-Render würde nur unnötig innerHTML neu aufbauen (siehe
  // closeoutSignaturePart oben) und den Cursor aus dem Feld werfen.
  function onOverlayInput(event) {
    if (!closeoutState) return;
    const role = event.target && event.target.dataset && event.target.dataset.role;
    if (!role || role.indexOf("closeout-") !== 0) return;
    const value = event.target.value;
    const f = closeoutState.fields;
    switch (role) {
      case "closeout-title": f.title = value; break;
      case "closeout-content": f.content = value; f.contentTouched = true; break;
      case "closeout-customer-name": f.customerName = value; break;
      case "closeout-customer-number": f.customerNumber = value; break;
      case "closeout-phone": f.phone = value; break;
      case "closeout-topic": f.topic = value; break;
      case "closeout-notes": f.notes = value; break;
      case "closeout-jira-ticket": f.jiraTicket = value; break;
      case "closeout-old-product": f.oldProduct = value; break;
      case "closeout-new-product": f.newProduct = value; break;
      case "closeout-followup-date": f.followUpDate = value; break;
      case "closeout-contract-date": f.contractDate = value; break;
      case "closeout-change-date": f.changeDate = value; break;
      default: break;
    }
  }

  function renderOverlay(call) {
    if (stopped) return;
    // Nach dem Auflegen blendet sich das Cockpit selbst aus – im
    // Outbound-Modus später, weil dort noch das Gesprächsergebnis erfasst wird
    // (nach dem Erfassen greift wieder das kurze Fenster). Ist das
    // Abschluss-Panel offen und noch nicht gespeichert, wird gar nicht erst
    // automatisch ausgeblendet – sonst gingen unvollständig ausgefüllte
    // Vertrags-/Tarifwechsel-Formulare kommentarlos verloren.
    const closeoutPending = closeoutState && closeoutState.callId === callId && closeoutState.status !== "done";
    const endedWindow = closeoutPending
      ? Infinity
      : (isOutbound(callMode) && outcomeSentForCallId !== callId ? ENDED_OUTBOUND_OVERLAY_MS : ENDED_OVERLAY_MS);
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
      root.addEventListener("input", onOverlayInput);
    }

    // Wartefeld inhaltsbasiert in die Signatur aufnehmen (nicht nur updatedAt):
    // zwei Updates innerhalb derselben Millisekunde trügen sonst denselben
    // Zeitstempel und die neue Zahl würde nie gezeichnet.
    const signature = callVisible
      ? JSON.stringify([
          "call", call.status, call.callerName, call.callerNumber, call.customerNumber, call.group,
          overlayPrefs.mode, callMode, looksOutbound(call), outcomeSentForCallId === callId,
          queueStats,
          ticketContext && [ticketContext.key, ticketContext.aiSummary, ticketContext.customerReference, ticketContext.aiCallPrep],
          closeoutSignaturePart()
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
    maybeLookupCustomer(callState);
    maybeStartCall(callState);
    maybeEndCall(callState);
    maybeOpenCloseoutPanel(callState);
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

  // Befehlspalette: einmalig registriert, unabhängig vom Call-Cockpit-Overlay
  // (dessen eigene Listener erst beim ersten Rendern des Overlays entstehen).
  document.addEventListener("keydown", onGlobalKeydown);

  intervalId = window.setInterval(tick, POLL_MS);
  tick();
})();
