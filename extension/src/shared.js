(function initSharedHelpers() {
  "use strict";

  // globalThis statt window: identisch im Content-Script, aber auch im
  // Hintergrund-Service-Worker (src/background.js) verfügbar, der kein window
  // kennt. So teilen sich Content-Scripts und Worker dieselben Helfer.
  globalThis.StadtnetzCRM = globalThis.StadtnetzCRM || {};
  const app = globalThis.StadtnetzCRM;

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Wird die Extension neu geladen, verliert ein bereits laufendes
  // Content-Script seinen Chrome-Kontext ("Extension context invalidated").
  // Alle Storage-Zugriffe laufen deshalb über diese Guard und scheitern still.
  function extensionAlive() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch (error) {
      return false;
    }
  }

  // Summe der wartenden Anrufer über alle Gruppen. Einzige Quelle der Wahrheit
  // für die Jira-Seite, das timio-Cockpit und das Symbolleisten-Badge – gibt
  // null zurück, wenn (noch) keine Wartefeld-Daten vorliegen.
  function queueTotalWaiting(queueStats) {
    if (!queueStats || !Array.isArray(queueStats.groups) || !queueStats.groups.length) return null;
    return queueStats.groups.reduce(
      (sum, group) => sum + (typeof group.waiting === "number" ? group.waiting : 0),
      0
    );
  }

  // Wartefeld-Daten gelten als veraltet, wenn sie älter als staleAfterMs sind
  // (z. B. weil kein timio-Portal-Tab mehr offen/sichtbar ist).
  function queueIsStale(queueStats, staleAfterMs, now) {
    if (!queueStats || !queueStats.updatedAt) return true;
    return ((now || Date.now()) - queueStats.updatedAt) > staleAfterMs;
  }

  // Alter veralteter Wartefeld-Daten in Minuten (0 = frisch oder keine Daten –
  // dann ist kein Veraltet-Hinweis nötig).
  function queueStaleMinutes(queueStats, staleAfterMs, now) {
    if (!queueStats || !queueStats.updatedAt) return 0;
    const ts = now || Date.now();
    if (!queueIsStale(queueStats, staleAfterMs, ts)) return 0;
    return Math.max(1, Math.round((ts - queueStats.updatedAt) / 60000));
  }

  // Ordnet die im Call gemeldete Gruppe einer Portal-Gruppe zu (Teilstring in
  // beide Richtungen, da timio die Namen unterschiedlich lang anzeigen kann).
  function groupsMatch(groupName, callGroup) {
    if (!groupName || !callGroup) return false;
    const a = String(groupName).toLocaleLowerCase("de-DE");
    const b = String(callGroup).toLocaleLowerCase("de-DE");
    return a.includes(b) || b.includes(a);
  }

  // ---------------------------------------------------------------------------
  // Wartefeld-Erkennung (Portal-Ansicht). Liegt hier statt in timio-content.js,
  // damit auch der Hintergrund-Service-Worker (src/background.js) sie über
  // chrome.scripting.executeScript direkt im timio-Tab ausführen kann – ohne
  // auf den (im Hintergrund gethrottelten oder discardeten) setInterval des
  // Content-Scripts angewiesen zu sein. Es werden ausschließlich Gruppennamen
  // und Zähler gelesen – keine Namen oder Nummern anderer Personen.
  // ---------------------------------------------------------------------------

  const MAX_QUEUE_GROUPS = 8;
  const NOT_A_GROUP_NAME = /^(agenten|wartefeld|ansage|option|aus|an|kontakt|neue gruppe|gruppen|kacheln|sortieren|portal|willkommen|verbunden|im wartefeld|anrufe eingang.*|<keine>)$/i;

  function pageLines(text) {
    return String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
  }

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

  // "m:ss" bzw. "h:mm:ss" – für Gesprächsdauer-Anzeigen.
  function formatDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  // Anzeige-Label + CSS-Klasse für den Call-Status. Beide Cockpits (Jira-Seite
  // und timio-Seite) nutzen dieselben Klassennamen. Der Modus ändert nur die
  // Beschriftung: ausgehend "klingelt" es nicht, sondern es wird gewählt.
  function callStatusMeta(status, mode) {
    const outbound = mode === "outbound";
    if (status === "ringing") {
      return { label: outbound ? "↗ Wählt …" : "☎ Klingelt", cls: "is-ringing" };
    }
    if (status === "ended") return { label: "Beendet", cls: "is-ended" };
    return { label: outbound ? "↗ Im Gespräch" : "● Im Gespräch", cls: "is-connected" };
  }

  // Timer-Text fürs Cockpit: leer beim Klingeln, feste Enddauer nach dem
  // Auflegen, sonst live tickende Gesprächsdauer ab connectedAtMs.
  function callTimerText(call, connectedAtMs) {
    if (!call || call.status === "ringing") return "";
    if (call.status === "ended") return call.finalDuration || "";
    return formatDuration(Date.now() - (connectedAtMs || Date.now()));
  }

  // ---------------------------------------------------------------------------
  // Arbeitsrichtung (Inbound/Outbound)
  //
  // timio zeigt bei ausgehenden Anrufen denselben Call-Screen wie bei
  // eingehenden – die Richtung steht nirgends im Seitentext. Sie wird deshalb
  // nicht geraten, sondern vom Bearbeiter gesetzt und hier nur normalisiert.
  // ---------------------------------------------------------------------------

  const CALL_MODES = {
    inbound: { id: "inbound", label: "Eingehend", short: "Ein", icon: "☎", cls: "is-inbound" },
    outbound: { id: "outbound", label: "Ausgehend", short: "Aus", icon: "↗", cls: "is-outbound" }
  };

  function callModeMeta(mode) {
    return CALL_MODES[mode] || CALL_MODES.inbound;
  }

  function isOutbound(mode) {
    return callModeMeta(mode).id === "outbound";
  }

  // ---------------------------------------------------------------------------
  // Rückrufliste (Wiedervorlage)
  //
  // Bewusst getrennt von timios eigener Anrufliste: hier stehen ausschließlich
  // Rückrufe, die der Bearbeiter selbst aufgenommen hat. Weil Einträge
  // Rufnummern enthalten, also personenbezogene Daten, sind Deckelung und
  // automatisches Ausmisten Teil des Datenmodells und nicht optional.
  // ---------------------------------------------------------------------------

  function outboundConfig() {
    const config = (globalThis.StadtnetzCRM && globalThis.StadtnetzCRM.CONFIG) || {};
    return config.outbound || {};
  }

  // Rufnummer in wählbarer Form: timio zeigt "+49 (176) 34573586", gewählt
  // wird "+4917634573586". Ein führendes + bleibt erhalten, alles andere
  // außer Ziffern fällt weg.
  function normalizePhone(value) {
    const raw = String(value == null ? "" : value).trim();
    if (!raw) return "";
    const digits = raw.replace(/\D/g, "");
    if (!digits) return "";
    return raw.startsWith("+") ? `+${digits}` : digits;
  }

  // Wann der nächste Versuch fällig ist, gestaffelt nach bisherigen Versuchen.
  // Nach dem letzten Staffel-Eintrag bleibt es beim größten Abstand.
  function nextRetryAt(attempts, now) {
    const delays = outboundConfig().retryDelaysMs || [7200000, 86400000, 259200000];
    const index = Math.min(Math.max(0, Number(attempts) || 0), delays.length - 1);
    return (now || Date.now()) + delays[index];
  }

  // Wirft erledigte Einträge sowie alles, dessen Fälligkeit lange vorbei ist,
  // weg und deckelt die Liste. Sortiert nach Fälligkeit, damit die UI und der
  // Service-Worker dieselbe Reihenfolge sehen.
  function pruneCallbacks(items, now) {
    if (!Array.isArray(items)) return [];
    const config = outboundConfig();
    const maxItems = config.maxCallbacks || 100;
    const keepMs = (config.keepDoneDays || 30) * 86400000;
    const ts = now || Date.now();
    return items
      .filter((item) => item && item.id && !item.done)
      .filter((item) => typeof item.dueAt !== "number" || ts - item.dueAt <= keepMs)
      .sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0))
      .slice(0, maxItems);
  }

  // Fällige Rückrufe – Grundlage für Badge und Erinnerung.
  function dueCallbacks(items, now) {
    const ts = now || Date.now();
    if (!Array.isArray(items)) return [];
    return items.filter((item) => item && !item.done && typeof item.dueAt === "number" && item.dueAt <= ts);
  }

  // ---------------------------------------------------------------------------
  // Sprung von der Kundennummer zum Jira-Ticket
  //
  // Die Extension kann Jira nicht durchsuchen (sie liest nur die sichtbare
  // Seite), aber sie kann eine Suche als Link öffnen. Im Outbound-Modus ist
  // das der kritische Pfad: timio nennt beim Verbinden die Kundennummer, das
  // passende Ticket muss sofort auffindbar sein.
  // ---------------------------------------------------------------------------

  function customerSearchUrl(customerNumber, jqlTemplate) {
    const query = String(customerNumber == null ? "" : customerNumber).trim();
    if (!query) return "";
    const config = (globalThis.StadtnetzCRM && globalThis.StadtnetzCRM.CONFIG) || {};
    const jira = config.jira || {};
    const template = (jqlTemplate || "").trim() || jira.customerSearchJql || 'text ~ "{q}"';
    // Anführungszeichen im Wert würden den JQL-String sprengen.
    const safeQuery = query.replace(/"/g, "");
    const jql = template.replace(/\{q\}/g, safeQuery);
    const base = (jira.baseUrl || "").replace(/\/+$/, "");
    return `${base}/issues/?jql=${encodeURIComponent(jql)}`;
  }

  // Direkter Sprung zu einem bekannten Ticket-Key (aus der customer_card-RPC,
  // siehe supabase.js) – im Unterschied zu customerSearchUrl oben keine Suche,
  // sondern die fertige Browse-URL, weil das Ticket schon feststeht.
  function jiraTicketUrl(ticket) {
    const key = String(ticket == null ? "" : ticket).trim();
    if (!key) return "";
    const config = (globalThis.StadtnetzCRM && globalThis.StadtnetzCRM.CONFIG) || {};
    const base = ((config.jira && config.jira.baseUrl) || "").replace(/\/+$/, "");
    return `${base}/browse/${encodeURIComponent(key)}`;
  }

  // ---------------------------------------------------------------------------
  // Ticketstand für die Kundenakte
  //
  // In der Kundenakte soll auf einen Blick stehen, ob das Anliegen hinter einer
  // Ticket-Zusammenfassung noch läuft. Jira-Statusnamen sind pro Projekt frei
  // konfigurierbar – gespeichert wird deshalb nicht der Status selbst, sondern
  // nur die Frage "erledigt oder nicht", abgeleitet aus dem sichtbaren
  // Statustext (der Originaltext wandert zusätzlich in Klammern mit, damit die
  // Ableitung nachvollziehbar bleibt).
  //
  // Ein unbekannter oder unbekannt benannter Status gilt bewusst als offen:
  // ein fälschlich als erledigt vermerktes Anliegen fällt in der Akte hinten
  // runter, ein fälschlich offenes fällt spätestens beim Lesen auf.
  // ---------------------------------------------------------------------------

  const CLOSED_STATUS = /erledigt|gel(ö|oe)st|geschlossen|abgeschlossen|fertig|behoben|abgebrochen|storniert|abgelehnt|verworfen|done|closed|resolved|complete|cancel|reject/;
  // Wiedereröffnet enthält "eröffnet", nicht "erledigt" – wird aber vorab
  // geprüft, falls ein Workflow "Erledigt (wiedereröffnet)" o. Ä. anzeigt.
  const REOPENED_STATUS = /wieder\s*er(ö|oe)ffnet|erneut\s+ge(ö|oe)ffnet|reopened/;

  function ticketResolution(status) {
    const raw = String(status == null ? "" : status).trim();
    const value = raw.toLocaleLowerCase("de-DE");
    // "Nicht sichtbar" ist der Platzhalter des Jira-Readers (jiraReader.UNKNOWN)
    // für ein Feld, das im Ticket gar nicht auslesbar war.
    if (!value || value === "nicht sichtbar") return { id: "unbekannt", label: "Unbekannt", raw: "" };
    if (REOPENED_STATUS.test(value)) return { id: "offen", label: "Offen", raw };
    if (CLOSED_STATUS.test(value)) return { id: "geschlossen", label: "Geschlossen", raw };
    return { id: "offen", label: "Offen", raw };
  }

  // Kurzes deutsches Datum ("21.7.2026") für die Kundenakte – ohne Uhrzeit,
  // da first_seen_at/last_contact_at hier nur zur groben Einordnung dienen.
  function formatDateDE(iso) {
    if (!iso) return "unbekannt";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "unbekannt" : d.toLocaleDateString("de-DE");
  }

  // ---------------------------------------------------------------------------
  // Provisions-Mathematik — lebt jetzt in commission.js (Stufe 4,
  // KONZEPT-INTEGRATION.md: "gemeinsames Paket für Typen und
  // Provisionslogik"), von dort per Default-Import auch im CRM genutzt
  // (src/lib/utils.ts). Hier nur noch dünne, lazy auflösende Wrapper, damit
  // bestehende Aufrufer (timio-content.js, ui.js) unverändert
  // `shared.calcContractCommission(...)` etc. aufrufen können. Lazy statt
  // Direktreferenz beim IIFE-Eval, damit Tests, die shared.js ohne
  // commission.js laden, nicht schon beim Laden crashen.
  // ---------------------------------------------------------------------------

  function commissionApi() {
    return (globalThis.StadtnetzCRM && globalThis.StadtnetzCRM.commission) || {};
  }

  function getProductCommission(settings, productName) {
    return (commissionApi().getProductCommission || (() => 0))(settings, productName);
  }

  function calcContractCommission(contract, settings) {
    return (commissionApi().calcContractCommission || (() => 0))(contract, settings);
  }

  function calcTariffCommission(change, settings) {
    return (commissionApi().calcTariffCommission || (() => 0))(change, settings);
  }

  function groupProductsByCategory(products) {
    return (commissionApi().groupProductsByCategory || (() => []))(products);
  }

  // Heutiges Datum als YYYY-MM-DD in lokaler Zeit (nicht UTC) — Vorbelegung
  // für Vertragsdatum/Tarifwechseldatum im Abschluss-Panel.
  function todayIso() {
    const d = new Date();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${month}-${day}`;
  }

  app.shared = {
    escapeHtml,
    extensionAlive,
    queueTotalWaiting,
    queueIsStale,
    queueStaleMinutes,
    groupsMatch,
    parseQueueGroups,
    formatDuration,
    callStatusMeta,
    callTimerText,
    callModeMeta,
    isOutbound,
    normalizePhone,
    nextRetryAt,
    pruneCallbacks,
    dueCallbacks,
    customerSearchUrl,
    jiraTicketUrl,
    ticketResolution,
    formatDateDE,
    getProductCommission,
    calcContractCommission,
    calcTariffCommission,
    groupProductsByCategory,
    todayIso
  };
})();
