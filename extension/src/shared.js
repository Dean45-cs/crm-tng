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

  // ---------------------------------------------------------------------------
  // Tastenkürzel
  //
  // Ein Kürzel ist eine Zeichenkette wie "Mod+Shift+K": Teile mit "+" verbunden,
  // Reihenfolge Mod, Ctrl, Alt, Shift, Taste. „Mod" ist die Befehlstaste auf
  // macOS und Strg auf Windows/Linux – deshalb steht in der Konfiguration je
  // Kürzel nur eine Angabe und nicht zwei, die auseinanderlaufen können.
  //
  // Diese vier Funktionen sind der einzige Ort, an dem das Format ausgelegt
  // wird: erkennen (aus einem Tastendruck), vergleichen (passt ein Tastendruck),
  // beschriften (⌘⇧K bzw. Strg+Umschalt+K) und übersetzen (für Electrons
  // systemweite Kürzel). Die Liste der Kürzel selbst steht in config.js.
  // ---------------------------------------------------------------------------

  // Reine Zusatztasten sind für sich noch kein Kürzel – solange sie allein
  // gedrückt sind, wartet die Aufnahme weiter.
  const HOTKEY_DEAD_KEYS = ["Meta", "Control", "Alt", "Shift", "AltGraph", "CapsLock", "Dead", "OS", "Unidentified"];

  function isMacPlatform() {
    const platform = (globalThis.navigator && (globalThis.navigator.platform || globalThis.navigator.userAgent)) || "";
    return /Mac|iPhone|iPad/.test(String(platform));
  }

  // Einheitliche Schreibweise der Taste selbst: Buchstaben groß, Leertaste als
  // "Space", alles Übrige so, wie der Browser es nennt ("Enter", "F5", "ArrowUp").
  function normalizeHotkeyKey(key) {
    const value = String(key == null ? "" : key);
    if (!value) return "";
    if (value === " " || value === "Spacebar") return "Space";
    if (value.length === 1) return value.toUpperCase();
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  // Aus einem Tastendruck ein Kürzel machen (für die Aufnahme in den
  // Einstellungen). Leer, solange nur Zusatztasten gedrückt sind.
  function hotkeyFromEvent(event) {
    if (!event) return "";
    const key = normalizeHotkeyKey(event.key);
    if (!key || HOTKEY_DEAD_KEYS.indexOf(String(event.key)) >= 0) return "";

    const mac = isMacPlatform();
    const parts = [];
    if (mac ? event.metaKey : event.ctrlKey) parts.push("Mod");
    // Auf dem Mac ist Strg eine eigene Taste neben der Befehlstaste; auf
    // Windows IST Strg die Modifikator-Taste und taucht deshalb nur als "Mod" auf.
    if (mac && event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    parts.push(key);
    return parts.join("+");
  }

  function parseHotkey(binding) {
    const parts = String(binding || "").split("+").filter(Boolean);
    const key = parts.pop() || "";
    return {
      key,
      mod: parts.indexOf("Mod") >= 0,
      ctrl: parts.indexOf("Ctrl") >= 0,
      alt: parts.indexOf("Alt") >= 0,
      shift: parts.indexOf("Shift") >= 0
    };
  }

  // Passt dieser Tastendruck zu diesem Kürzel? Ein leeres Kürzel passt nie –
  // so schaltet man ein Kürzel ab, ohne den Verbraucher anfassen zu müssen.
  function hotkeyMatches(event, binding) {
    if (!event || !binding) return false;
    const want = parseHotkey(binding);
    if (!want.key) return false;
    const mac = isMacPlatform();
    if (Boolean(mac ? event.metaKey : event.ctrlKey) !== want.mod) return false;
    if (mac && Boolean(event.ctrlKey) !== want.ctrl) return false;
    if (Boolean(event.altKey) !== want.alt) return false;
    if (Boolean(event.shiftKey) !== want.shift) return false;
    return normalizeHotkeyKey(event.key) === want.key;
  }

  // Für die Anzeige: auf dem Mac die Zeichen, die auf den Tasten stehen, sonst
  // ausgeschriebene Namen.
  function hotkeyLabel(binding) {
    if (!binding) return "";
    const mac = isMacPlatform();
    const parts = String(binding).split("+").map((part) => {
      if (part === "Mod") return mac ? "⌘" : "Strg";
      if (part === "Ctrl") return mac ? "⌃" : "Strg";
      if (part === "Alt") return mac ? "⌥" : "Alt";
      if (part === "Shift") return mac ? "⇧" : "Umschalt";
      if (part === "Space") return "Leertaste";
      if (part === "Enter") return mac ? "⏎" : "Enter";
      if (part === "Escape") return "Esc";
      return part;
    });
    return parts.join(mac ? "" : "+");
  }

  // Übersetzung in Electrons Schreibweise für systemweite Kürzel
  // (globalShortcut.register). Nur dort gebraucht, steht aber hier, damit
  // Format und Übersetzung beieinanderliegen.
  function hotkeyToAccelerator(binding) {
    if (!binding) return "";
    return String(binding).split("+").map((part) => {
      if (part === "Mod") return "CommandOrControl";
      if (part === "Ctrl") return "Control";
      return part;
    }).join("+");
  }

  // Nachschlagen, was für eine id gerade gilt: die eigene Einstellung, sonst die
  // Voreinstellung aus config.js. Ein ausdrücklich leerer Eintrag bleibt leer –
  // das ist „abgeschaltet" und darf nicht auf die Voreinstellung zurückfallen.
  function hotkeyDefs() {
    return (app.CONFIG && app.CONFIG.hotkeys) || [];
  }

  function hotkeyDefault(id) {
    const def = hotkeyDefs().find((entry) => entry.id === id);
    return def ? def.default : "";
  }

  function hotkeyFor(id, overrides) {
    const map = overrides || {};
    return Object.prototype.hasOwnProperty.call(map, id) ? String(map[id] || "") : hotkeyDefault(id);
  }

  // Belegt ein anderes Kürzel dieselbe Taste? Bewusst über alle Bereiche hinweg
  // geprüft: in der Auskunft greifen Panel-, Fenster- und systemweite Kürzel
  // gleichzeitig, und ein systemweites schluckt den Tastendruck, bevor das
  // Panel ihn je sieht. Zwei gleiche Kürzel sind deshalb immer ein Fehler.
  function hotkeyConflict(id, binding, overrides) {
    if (!binding) return "";
    const clash = hotkeyDefs().find((def) => def.id !== id && hotkeyFor(def.id, overrides) === binding);
    return clash ? clash.id : "";
  }

  // ---------------------------------------------------------------------------
  // Netz-Auskunft: DOM-Automatisierungs-Helfer (Baustatus/FTTX + Churn/GFIZ)
  //
  // Diese Helfer fassen das DOM erst zur LAUFZEIT an (in den Scraper-Content-
  // Scripts), nicht beim Laden – deshalb ist ihre Definition auch im Worker
  // (importScripts) unkritisch, obwohl er kein `document`/`window` hat. Sie
  // ersetzen die je Datei duplizierten Helfer aus dem ursprünglichen Scraper
  // (content_fttx.js/content_gfiz.js) durch eine gemeinsame, getestete Quelle.
  //
  // Die eigentliche Extraktion bleibt in den Content-Scripts; die REINEN Parser
  // (parseChurn/parseBaustatus) darunter sind DOM-frei und damit unit-testbar
  // (Muster wie parseQueueGroups oben).
  // ---------------------------------------------------------------------------

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Pollt condition() bis truthy oder Timeout. Gibt den Rückgabewert von
  // condition() zurück (z. B. das gefundene Element) bzw. null bei Timeout.
  //
  // Zusätzlich zum Polling hängt ein MutationObserver am Dokument, der bei jeder
  // DOM-Änderung sofort erneut prüft. Das ist kein Beschleuniger, sondern der
  // Grund, warum die Netz-Auskunft überhaupt zuverlässig läuft: Chrome drosselt
  // setTimeout in einem NICHT sichtbaren Tab auf mindestens eine Sekunde und
  // nach einigen Minuten im Hintergrund auf einen Aufruf pro Minute
  // ("intensive throttling"). Reines Polling mit 150 ms verhungert dort, jede
  // Wartebedingung läuft in ihren Timeout und der ganze Lauf scheitert.
  // Mutations-Ereignisse sind von der Drosselung nicht betroffen.
  // (Der Worker holt den Dashboard-Tab zusätzlich in den Vordergrund – siehe
  // lookup.js. Dieser Observer ist die zweite Verteidigungslinie, falls der
  // Bearbeiter während des Laufs doch wegklickt.)
  function waitForCondition(condition, timeoutMs, intervalMs) {
    const timeout = typeof timeoutMs === "number" ? timeoutMs : 5000;
    const interval = typeof intervalMs === "number" ? intervalMs : 150;
    return new Promise((resolve) => {
      const start = Date.now();
      let done = false;
      let timer = null;
      let observer = null;

      const finish = (value) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        if (observer) { try { observer.disconnect(); } catch (error) { /* egal */ } }
        resolve(value);
      };

      const check = () => {
        if (done) return;
        if (timer) { clearTimeout(timer); timer = null; }
        let result = null;
        // Wirft die Bedingung, gilt sie schlicht als noch nicht erfüllt.
        try { result = condition(); } catch (error) { /* weiter warten */ }
        if (result) return finish(result);
        if (Date.now() - start >= timeout) return finish(null);
        timer = setTimeout(check, interval);
      };

      if (typeof MutationObserver === "function" && typeof document !== "undefined" && document.documentElement) {
        try {
          observer = new MutationObserver(() => check());
          observer.observe(document.documentElement, {
            childList: true, subtree: true, attributes: true, characterData: true
          });
        } catch (error) {
          observer = null;
        }
      }

      check();
    });
  }

  // Sichtbar im Sinne von „anklickbar/beschreibbar": hat eine Box im Layout.
  // getClientRects allein ist zu streng – ein Tab, der noch nie im Vordergrund
  // war, hat unter Umständen kein fertiges Layout. offsetParent deckt das ab.
  function isVisible(element) {
    if (!element) return false;
    try {
      if (element.getClientRects && element.getClientRects().length) return true;
      return Boolean(element.offsetParent);
    } catch (error) {
      return false;
    }
  }

  // Setzt den Wert eines von React kontrollierten Inputs so, dass React die
  // Änderung mitbekommt: über den nativen Value-Setter des Prototyps plus
  // input/change-Events. Ant Design reagiert zusätzlich auf Tastaturereignisse,
  // deshalb werden diese für jeden Buchstaben nachgereicht.
  function reactSetValue(input, value) {
    if (!input) return;
    const proto = (typeof window !== "undefined" && window.HTMLInputElement && window.HTMLInputElement.prototype) || null;
    const descriptor = proto && Object.getOwnPropertyDescriptor(proto, "value");
    const nativeSetter = descriptor && descriptor.set;
    const text = value == null ? "" : String(value);
    if (nativeSetter) nativeSetter.call(input, text);
    else input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (text) {
      try { input.focus(); } catch (error) { /* nicht fokussierbar */ }
      for (const char of text) {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
      }
    }
  }

  // Wartet, bis die von getCount() gelieferte Zeilenzahl für quietMs stabil
  // bleibt (Tabelle „fertig geladen"), spätestens bis timeoutMs. Gibt die
  // letzte bekannte Zahl zurück. getCount() kann eine reine Zählfunktion sein –
  // dadurch ohne echtes DOM testbar.
  function waitForStableRows(getCount, options) {
    const opts = options || {};
    const intervalMs = typeof opts.intervalMs === "number" ? opts.intervalMs : 250;
    const quietMs = typeof opts.quietMs === "number" ? opts.quietMs : 500;
    const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 2500;
    return new Promise((resolve) => {
      const start = Date.now();
      let prev = -1;
      let stableSince = 0;
      const tick = () => {
        let n = prev;
        // Wirft das Zählen, bleibt der zuletzt bekannte Stand stehen.
        try { n = getCount(); } catch (error) { /* prev behalten */ }
        const now = Date.now();
        if (n === prev) {
          if (stableSince && now - stableSince >= quietMs) return resolve(n);
        } else {
          prev = n;
          stableSince = now;
        }
        if (now - start >= timeoutMs) return resolve(prev < 0 ? 0 : prev);
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  // ---------------------------------------------------------------------------
  // Reine Parser (DOM-frei, testbar)
  // ---------------------------------------------------------------------------

  function cleanText(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  // Normalisiert das Churn-Ergebnis (gfiz-dash). Eingabe ist das rohe Objekt des
  // Content-Scripts: { found, kundennummer, rows:[{vertrag, geschaeftsfall,
  // ursache, eingang, jiraTicket, jiraHref, kommentar}] }. Ausgabe ist eine
  // aufgeräumte Anzeigeform mit Fallzähler.
  // ---------------------------------------------------------------------------
  // Churnliste: Spaltenzuordnung
  //
  // Die Liste hat je nach Rechten/Filtern unterschiedlich viele Spalten, und Ant
  // Design schiebt bei breiten Tabellen eine Auswahlspalte davor. Feste
  // Zellindizes gehen deshalb verlässlich daneben — und zwar STILL: dann steht
  // der Winback-Status im Feld „Grund" und die Ticketnummer nirgends. Zugeordnet
  // wird deshalb über die Kopftexte.
  //
  // Muster je Spalte in ABSTEIGENDER Genauigkeit: sie werden der Reihe nach über
  // alle Kopfzellen probiert, damit ein weites Muster keine Spalte klaut
  // („Zeitstempel Änderung" darf nicht als Kündigungsdatum durchgehen).
  // Echte Kopfzeile (Stand 2026-07): Vertrag · Kundennummer · Zeitstempel
  // Änderung · Winback Status · Ursache Real · JIRA Ticket-Nr. · Rückruf Bitte ·
  // Dealcloser.
  // ---------------------------------------------------------------------------

  const CHURN_COLUMNS = [
    { key: "vertrag", match: [/^vertrag$/, /vertragsnummer/, /^contract/], child: "button" },
    { key: "kundennummer", match: [/kundennummer|kunden-nr|client ?id/] },
    { key: "eingang", match: [/zeitstempel/, /^eingang/, /eingangsdatum/, /received/, /^datum/] },
    { key: "winback", match: [/winback/], child: ".ant-select-selection-item" },
    { key: "ursache", match: [/^ursache/, /k(ü|ue)ndigungsgrund/, /^grund/, /reason/], child: ".ant-select-selection-item" },
    { key: "geschaeftsfall", match: [/gesch(ä|ae)ftsfall/, /vorgangsart/, /business ?case/], child: ".ant-select-selection-item" },
    { key: "jira", match: [/^jira/, /jira/, /ticket/, /^vorgang$/] },
    { key: "dealcloser", match: [/dealcloser|deal ?closer/], child: ".ant-select-selection-item" },
    { key: "kommentar", match: [/kommentar/, /bemerkung/, /notiz/, /comment/], child: ".w-64" }
  ];

  // headers: Kopftexte je Spaltenindex (Lücken erlaubt, z. B. die Auswahlspalte).
  // cellCount: Zellen einer Datenzeile – ist sie länger als der Kopf, sitzt davor
  // eine zusätzliche Spalte und alles verschiebt sich um die Differenz.
  // Rückgabe: { key -> Zellindex } nur für erkannte Spalten.
  function mapChurnColumns(headers, cellCount) {
    const list = Array.isArray(headers) ? headers : [];
    const normalized = list.map((text) => String(text == null ? "" : text).replace(/\s+/g, " ").trim().toLowerCase());
    const offset = typeof cellCount === "number" && cellCount > normalized.length
      ? cellCount - normalized.length
      : 0;
    const map = {};
    CHURN_COLUMNS.forEach((column) => {
      for (const pattern of column.match) {
        const index = normalized.findIndex((text) => text && pattern.test(text));
        if (index >= 0) { map[column.key] = index + offset; return; }
      }
    });
    return map;
  }

  // Ticketnummer aus einem beliebigen Text. Der zuverlässigste Weg zur
  // JIRA-Nummer führt NICHT über die Spalte, sondern über die Form selbst
  // (TNG-1407030) bzw. den Link – das trifft auch dann, wenn die Spalte anders
  // heißt, verschoben ist oder gar nicht erkannt wurde.
  const JIRA_KEY = /\b[A-Z][A-Z0-9_]{1,9}-\d{2,}\b/;

  function findJiraKey(text) {
    const match = String(text == null ? "" : text).match(JIRA_KEY);
    return match ? match[0] : "";
  }

  function parseChurn(raw) {
    const input = raw || {};
    const rows = Array.isArray(input.rows) ? input.rows : [];
    const cases = rows
      .map((row) => ({
        vertrag: cleanText(row && row.vertrag),
        geschaeftsfall: cleanText(row && row.geschaeftsfall),
        ursache: cleanText(row && row.ursache),
        eingang: cleanText(row && row.eingang),
        // Stand der Rückgewinnung und ein bereits gemachtes Angebot – für das
        // Winback-Gespräch die zwei wichtigsten Felder neben der Ursache.
        winback: cleanText(row && row.winback),
        dealcloser: cleanText(row && row.dealcloser),
        jiraTicket: cleanText(row && row.jiraTicket),
        jiraHref: (row && row.jiraHref) || "",
        kommentar: cleanText(row && row.kommentar)
      }))
      // Ein Eintrag zählt nur, wenn wenigstens Vertrag oder Geschäftsfall dranstehen.
      .filter((row) => row.vertrag || row.geschaeftsfall || row.ursache);
    return {
      found: cases.length > 0,
      customerNumber: cleanText(input.kundennummer),
      count: cases.length,
      cases
    };
  }

  // Normalisiert die FTTX/Baustatus-Rohfelder (fttx-dash) in ein Anzeigemodell.
  // Eingabe ist das Feld-Objekt des Content-Scripts (Schlüssel wie "Vertrag",
  // "Vertragsstatus", "Line Status", "Ausbauphas", "KVZ"/"KVZ_COLOR",
  // "Building Type", "Adresse", "BG Firma"/"HAB Firma"/"LWL Firma",
  // "Tiefbau Timeline"/"LWL Timeline", "Phase Predictions").
  function parseBaustatus(raw) {
    const f = raw || {};
    const val = (key) => cleanText(f[key]);
    const model = {
      contract: val("Vertrag"),
      contractStatus: val("Vertragsstatus"),
      lineStatus: val("Line Status"),
      buildingPhase: val("Ausbauphas") || val("Ausbauphase"),
      buildingType: val("Building Type"),
      address: cleanText(f["Adresse"]),
      kvz: {
        value: val("KVZ"),
        color: ["red", "yellow", "green"].includes(f["KVZ_COLOR"]) ? f["KVZ_COLOR"] : ""
      },
      contacts: {
        begehung: val("BG Firma"),
        hausanschluss: val("HAB Firma"),
        lwl: val("LWL Firma")
      },
      timelines: {
        tiefbau: cleanText(f["Tiefbau Timeline"]),
        lwl: cleanText(f["LWL Timeline"])
      },
      phasePredictions: cleanText(f["Phase Predictions"])
    };
    const found = Boolean(
      model.contract || model.contractStatus || model.lineStatus ||
      model.buildingPhase || model.address
    );
    return { found, ...model };
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
    todayIso,
    // Tastenkürzel
    hotkeyFromEvent,
    hotkeyMatches,
    hotkeyLabel,
    hotkeyToAccelerator,
    normalizeHotkeyKey,
    hotkeyDefs,
    hotkeyDefault,
    hotkeyFor,
    hotkeyConflict,
    // Netz-Auskunft: DOM-Helfer + reine Parser
    sleep,
    waitForCondition,
    isVisible,
    reactSetValue,
    waitForStableRows,
    CHURN_COLUMNS,
    mapChurnColumns,
    findJiraKey,
    parseChurn,
    parseBaustatus
  };
})();
