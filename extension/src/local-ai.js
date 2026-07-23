(function initLocalAi() {
  "use strict";

  const app = window.StadtnetzCRM;
  const AI = (app.CONFIG && app.CONFIG.ai) || {};

  // Erwartete Sprachen. Eingaben können deutsch oder englisch sein
  // (Tickets, Kundentexte), Ausgaben immer deutsch.
  const EXPECTED = {
    expectedInputs: [{ type: "text", languages: ["de", "en"] }],
    expectedOutputs: [{ type: "text", languages: ["de"] }]
  };
  const MAX_CONTEXT_CHARS = 12000;
  const MAX_DESCRIPTION_CHARS = 4000; // Obergrenze für die Beschreibung, damit Platz für Kommentare bleibt
  const MAX_COMMENT_CHARS = 1500;     // Obergrenze pro einzelnem Kommentar

  const STATUS = {
    UNSUPPORTED: "unsupported",   // Chrome kennt die API nicht
    UNAVAILABLE: "unavailable",   // Gerät/Modell nicht nutzbar
    DOWNLOADABLE: "downloadable", // Modell muss erst lokal geladen werden
    DOWNLOADING: "downloading",   // Modell lädt gerade
    AVAILABLE: "available",       // einsatzbereit
    OK: "ok",
    ERROR: "error"
  };

  // Zugriff auf den globalen On-Device-Konstruktor. Der Outbound-Modus braucht
  // nur noch die Prompt API (LanguageModel) – für die Gesprächsvorbereitung und
  // die interne Abschluss-Notiz. Die spezialisierten Companion-APIs
  // (Summarizer/Rewriter/Proofreader/Translator) gehörten zu den entfallenen
  // Support-Funktionen (E-Mail/Kommentar/Übersetzung) und werden nicht mehr genutzt.
  const globals = {
    prompt: () => globalThis.LanguageModel
  };

  // ---------------------------------------------------------------------------
  // Hilfsfunktionen
  // ---------------------------------------------------------------------------

  function clip(value, maxLength) {
    const text = String(value == null ? "" : value).trim();
    return text.length > maxLength ? `${text.slice(0, maxLength)}\n[gekürzt]` : text;
  }

  function isUsable(status) {
    return status === STATUS.DOWNLOADABLE || status === STATUS.DOWNLOADING || status === STATUS.AVAILABLE;
  }

  function analysisTemp() {
    return AI.temperature && typeof AI.temperature.analysis === "number" ? AI.temperature.analysis : undefined;
  }

  function draftTemp() {
    return AI.temperature && typeof AI.temperature.draft === "number" ? AI.temperature.draft : undefined;
  }

  // Baut die create()-Optionen inkl. Download-Fortschritt und Abbruch-Signal.
  function createOptions(base, opts) {
    const options = { ...base };
    if (opts && opts.signal) options.signal = opts.signal;
    if (opts && typeof opts.onDownload === "function") {
      options.monitor = (monitor) => {
        monitor.addEventListener("downloadprogress", (event) => {
          opts.onDownload(Math.round((event.loaded || 0) * 100));
        });
      };
    }
    return options;
  }

  function stripCodeFence(text) {
    return String(text || "")
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
  }

  function safeJson(text) {
    const cleaned = stripCodeFence(text);
    try {
      return JSON.parse(cleaned);
    } catch (error) {
      // Manche Modelle rahmen JSON mit Fließtext ein – ersten {...}-Block versuchen.
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch (innerError) { return null; }
      }
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Prompt API (Kern für alle Text- und Analyseaufgaben)
  // ---------------------------------------------------------------------------

  async function promptAvailability() {
    const model = globals.prompt();
    if (!model || typeof model.availability !== "function") return STATUS.UNSUPPORTED;
    // Erst mit Sprach-Hinweisen prüfen. Manche Chrome-Versionen melden für eine
    // nicht offiziell gelistete AUSGABE-Sprache (z. B. "de") fälschlich
    // "unavailable", obwohl das Modell vorhanden ist und Deutsch problemlos
    // erzeugt. Dann ohne die Hinweise erneut prüfen, statt die KI fälschlich als
    // nicht verfügbar zu melden.
    try {
      const strict = await model.availability(EXPECTED);
      if (strict && strict !== STATUS.UNAVAILABLE) return strict;
    } catch (error) {
      // Optionen evtl. nicht akzeptiert – unten schlicht prüfen.
    }
    try {
      return await model.availability();
    } catch (error) {
      return STATUS.UNAVAILABLE;
    }
  }

  // Zulässige Modellparameter (Temperatur/topK) einmalig ermitteln und cachen.
  let cachedParams;
  async function modelParams() {
    if (cachedParams !== undefined) return cachedParams;
    const model = globals.prompt();
    try {
      cachedParams = model && typeof model.params === "function" ? await model.params() : null;
    } catch (error) {
      cachedParams = null;
    }
    return cachedParams;
  }

  async function createPromptSession(opts = {}) {
    const model = globals.prompt();
    const system = [AI.systemPrompt || "Du bist ein hilfreicher Assistent. Antworte auf Deutsch."];
    if (opts.agentContext) system.push(opts.agentContext);
    const base = {
      ...EXPECTED,
      initialPrompts: [{ role: "system", content: system.join("\n\n") }]
    };

    // Temperatur nur setzen, wenn das Modell gültige Parameter meldet –
    // temperature und topK müssen gemeinsam gesetzt werden. Ein niedriger topK
    // (z. B. 1 = greedy) macht Analyse-/JSON-Aufgaben deterministischer und
    // formattreuer; Entwürfe dürfen etwas mehr Varianz haben (Default-topK).
    if (typeof opts.temperature === "number") {
      const params = await modelParams();
      if (params && typeof params.maxTemperature === "number") {
        base.temperature = Math.max(0, Math.min(opts.temperature, params.maxTemperature));
        const desiredTopK = typeof opts.topK === "number" ? opts.topK : (params.defaultTopK || 3);
        const maxTopK = typeof params.maxTopK === "number" ? params.maxTopK : desiredTopK;
        base.topK = Math.max(1, Math.min(desiredTopK, maxTopK));
      }
    }
    try {
      return await model.create(createOptions(base, opts));
    } catch (error) {
      // Scheitert das Erstellen an den Sprach-Hinweisen (expectedInputs/-Outputs)
      // – dieselbe Chrome-Eigenheit wie bei availability(), nur beim Anlegen der
      // Sitzung –, ohne diese Hinweise erneut versuchen. Die Sprache gibt der
      // System-Prompt ohnehin vor.
      if (!base.expectedInputs && !base.expectedOutputs) throw error;
      const withoutLangs = { ...base };
      delete withoutLangs.expectedInputs;
      delete withoutLangs.expectedOutputs;
      return await model.create(createOptions(withoutLangs, opts));
    }
  }

  // Baut aus den lokalen Bearbeiter-/Firmenangaben einen System-Zusatz.
  function agentContext(agent) {
    if (!agent) return "";
    const lines = [];
    if (agent.name) lines.push(`Name des Bearbeiters: ${clip(agent.name, 120)}`);
    if (agent.company) lines.push(`Unternehmen: ${clip(agent.company, 160)}`);
    if (!lines.length) return "";
    return `Angaben zum Anrufer/Bearbeiter (verwende sie statt Platzhaltern wie [Name]):\n${lines.join("\n")}`;
  }

  // Führt einen Prompt aus und streamt Teilergebnisse an onChunk.
  async function runStreaming(session, promptText, onChunk, signal) {
    if (typeof session.promptStreaming !== "function") {
      const full = await session.prompt(promptText, signal ? { signal } : undefined);
      const text = String(full || "").trim();
      if (typeof onChunk === "function") onChunk(text);
      return text;
    }
    const stream = session.promptStreaming(promptText, signal ? { signal } : undefined);
    let acc = "";
    for await (const chunk of stream) {
      acc += chunk; // Chrome liefert inkrementelle Deltas.
      if (typeof onChunk === "function") onChunk(acc);
    }
    return acc.trim();
  }

  // Ein-Schuss-Prompt mit erzwungenem JSON-Schema (responseConstraint).
  async function promptJson(promptText, schema, opts) {
    let session;
    try {
      session = await createPromptSession(opts);
      const options = { responseConstraint: schema };
      if (opts && opts.signal) options.signal = opts.signal;
      const raw = await session.prompt(promptText, options);
      return safeJson(raw);
    } finally {
      if (session && typeof session.destroy === "function") session.destroy();
    }
  }

  // ---------------------------------------------------------------------------
  // Ticket-Kontext für die Prompts
  // ---------------------------------------------------------------------------

  // Baut den Kommentar-Block budget-bewusst: Bei langen Tickets sind die
  // NEUESTEN Kommentare (aktuelle Kundennachricht, letzter Stand) am wichtigsten.
  // Deshalb von neu nach alt aufnehmen, solange das Budget reicht, alte notfalls
  // auslassen – statt (wie ein reines Abschneiden am Ende) genau die aktuellen
  // Kommentare zu verlieren. Ausgabe bleibt chronologisch.
  function buildCommentBlock(comments, budget) {
    if (!comments.length) return "Keine sichtbaren Kommentare.";
    const kept = [];
    let used = 0;
    let droppedCount = 0;
    for (let i = comments.length - 1; i >= 0; i--) {
      const entry = clip(comments[i], MAX_COMMENT_CHARS);
      const cost = entry.length + 20; // grober Zuschlag für Label/Leerzeilen
      if (used + cost > budget && kept.length >= 1) {
        droppedCount = i + 1; // Kommentare 0..i werden ausgelassen
        break;
      }
      kept.push(entry);
      used += cost;
    }
    kept.reverse(); // wieder in chronologischer Reihenfolge
    const lines = kept.map((text, idx) => `Kommentar ${droppedCount + idx + 1}: ${text}`);
    if (droppedCount) {
      lines.unshift(`[${droppedCount} ältere Kommentar(e) ausgelassen – Fokus auf die neuesten]`);
    }
    return lines.join("\n\n");
  }

  function ticketContext(ticket) {
    if (!ticket) return "Keine Ticketdaten sichtbar.";
    const comments = Array.isArray(ticket.comments) ? ticket.comments : [];

    const meta = [
      `Ticketnummer: ${ticket.key}`,
      `Titel: ${ticket.summary}`,
      `Status: ${ticket.status}`,
      `Priorität: ${ticket.priority}`,
      `Typ: ${ticket.issueType}`,
      `Kundenreferenz: ${ticket.customerReference}`,
      `Kundenname: ${ticket.customerName}`,
      `Bearbeiter: ${ticket.assignee}`
    ].join("\n");
    const descBlock = `Beschreibung:\n${clip(ticket.description, MAX_DESCRIPTION_CHARS) || "Keine Beschreibung."}`;

    // Was nach Metadaten und Beschreibung übrig ist, steht den Kommentaren zur
    // Verfügung – aber mindestens genug für den neuesten Kommentar.
    const commentBudget = Math.max(MAX_COMMENT_CHARS, MAX_CONTEXT_CHARS - meta.length - descBlock.length - 60);
    const commentBlock = buildCommentBlock(comments, commentBudget);

    const context = [meta, "", descBlock, "", "Sichtbare Kommentare:", commentBlock].join("\n");
    return clip(context, MAX_CONTEXT_CHARS);
  }

  function fenced(label, value) {
    return `--- ${label} ---\n${clip(value, MAX_CONTEXT_CHARS)}\n--- ENDE ${label} ---`;
  }

  // ---------------------------------------------------------------------------
  // Öffentliche KI-Funktionen (Outbound)
  // ---------------------------------------------------------------------------

  // Verfügbarkeit der lokalen KI insgesamt (Prompt API ist die Voraussetzung).
  async function capabilities() {
    const status = await promptAvailability();
    return {
      status,
      usable: isUsable(status),
      needsDownload: status === STATUS.DOWNLOADABLE,
      downloading: status === STATUS.DOWNLOADING
    };
  }

  // Vorbereitung eines ausgehenden Anrufs. Anders als eingehend gibt es keine
  // Vorlaufzeit – timio wählt selbst aus seiner Anrufliste. Deshalb läuft das
  // hier vorab und deterministisch (topK 1), damit beim Verbinden ohne Warten
  // dasteht, was zu besprechen ist.
  async function prepareCall(input, opts = {}) {
    const { ticket, agent } = input || {};
    const status = await promptAvailability();
    if (!isUsable(status)) return { status };

    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["ziel", "punkte", "fragen", "einwaende"],
      properties: {
        ziel: { type: "string" },
        punkte: { type: "array", minItems: 2, maxItems: 3, items: { type: "string" } },
        fragen: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
        einwaende: {
          type: "array",
          minItems: 0,
          maxItems: 2,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["einwand", "antwort"],
            properties: { einwand: { type: "string" }, antwort: { type: "string" } }
          }
        }
      }
    };

    const promptText = [
      "Bereite ein ausgehendes Telefonat mit dem Kunden zu diesem Ticket vor.",
      "Der Bearbeiter ruft den Kunden an – nicht umgekehrt. Er muss also selbst erklären, warum er anruft.",
      "ziel: in einem Satz, was mit diesem Anruf konkret erreicht werden soll.",
      "punkte: 2 bis 3 Stichpunkte, die der Bearbeiter aktiv ansprechen muss (Sachstand, Zusagen, Änderungen).",
      "fragen: 1 bis 3 Fragen, die im Ticket offen sind und nur der Kunde beantworten kann.",
      "einwaende: bis zu 2 realistisch zu erwartende Einwände mit jeweils einer kurzen, sachlichen Antwort.",
      "Ist eine Information nicht belegt, formuliere sie als Frage statt als Behauptung.",
      "",
      fenced("TICKETDATEN", ticketContext(ticket))
    ].join("\n");

    const data = await promptJson(promptText, schema, {
      ...opts,
      temperature: analysisTemp(),
      topK: 1,
      agentContext: agentContext(agent)
    });
    if (!data) return { status: STATUS.ERROR };
    return { status: STATUS.OK, data };
  }

  // Aus den Gesprächsstichpunkten des Bearbeiters eine polierte interne
  // CRM-Notiz zum Ergebnis eines ausgehenden Anrufs formulieren. Ersetzt die
  // frühere Support-Kommentar-/E-Mail-Formulierung: im Outbound-Betrieb wird nur
  // noch eine interne Notiz gebraucht, die den Gesprächsausgang festhält und am
  // Gesprächsende ins CRM (bzw. per Zwischenablage nach Jira) wandert.
  async function draftCallNote(input, opts = {}) {
    const { ticket, note, agent } = input || {};
    const status = await promptAvailability();
    if (!isUsable(status)) return { status };

    let session;
    try {
      session = await createPromptSession({ ...opts, temperature: draftTemp(), agentContext: agentContext(agent) });
      const promptText = [
        "Formuliere aus den Gesprächsstichpunkten eine knappe interne CRM-Notiz zum Ergebnis eines ausgehenden Anrufs.",
        "Nutze die Ticketdaten nur als Kontext und die Stichpunkte des Bearbeiters als Hauptinhalt.",
        "Struktur mit genau diesen vier Zeilen (jeweils ein bis zwei Sätze):",
        "Anlass: …",
        "Besprochen: …",
        "Ergebnis: …",
        "Nächster Schritt: …",
        "Wird ein Rückruf oder Termin erwähnt, nenne Datum/Uhrzeit. Fehlt eine Angabe, schreibe [ergänzen].",
        "",
        "Beispiel NUR für die Form (Inhalt NICHT übernehmen, immer aus Stichpunkten und Ticket schöpfen):",
        "Anlass: Ausbau im Gebiet abgeschlossen, Kunde auf Tarifwechsel angesprochen.",
        "Besprochen: Aktuellen Tarif und Upgrade-Optionen erläutert.",
        "Ergebnis: Kunde interessiert, möchte Angebot per Mail.",
        "Nächster Schritt: Angebot bis [ergänzen] senden.",
        "",
        fenced("GESPRÄCHSSTICHPUNKTE", note || "(keine Stichpunkte – formuliere aus dem Ticketkontext)"),
        "",
        fenced("TICKETDATEN", ticketContext(ticket))
      ].join("\n");
      const text = await runStreaming(session, promptText, opts.onChunk, opts.signal);
      return { status: STATUS.OK, text };
    } finally {
      if (session && typeof session.destroy === "function") session.destroy();
    }
  }

  app.localAi = {
    STATUS,
    capabilities,
    prepareCall,
    draftCallNote
  };
})();
