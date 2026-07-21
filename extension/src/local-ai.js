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
  const MAX_PREVIOUS_DOC_CHARS = 3000;
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

  // Zugriff auf die globalen On-Device-Konstruktoren. In Erweiterungskontexten
  // ist mindestens die Prompt API (LanguageModel) verfügbar; die spezialisierten
  // APIs werden opportunistisch genutzt, wenn Chrome sie bereitstellt.
  const globals = {
    prompt: () => globalThis.LanguageModel,
    summarizer: () => globalThis.Summarizer,
    rewriter: () => globalThis.Rewriter,
    proofreader: () => globalThis.Proofreader,
    translator: () => globalThis.Translator,
    detector: () => globalThis.LanguageDetector
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
    try {
      return await model.availability(EXPECTED);
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
    return model.create(createOptions(base, opts));
  }

  // Baut aus den lokalen Bearbeiter-/Firmenangaben einen System-Zusatz.
  function agentContext(agent) {
    if (!agent) return "";
    const lines = [];
    if (agent.name) lines.push(`Name des Bearbeiters: ${clip(agent.name, 120)}`);
    if (agent.company) lines.push(`Unternehmen: ${clip(agent.company, 160)}`);
    if (agent.signature) lines.push(`Diese E-Mail-Signatur unverändert ans Ende von E-Mails setzen:\n${clip(agent.signature, 400)}`);
    if (!lines.length) return "";
    return `Angaben zum Absender (verwende sie statt Platzhaltern wie [Name]):\n${lines.join("\n")}`;
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
  // Öffentliche KI-Funktionen
  // ---------------------------------------------------------------------------

  // Verfügbarkeit der lokalen KI insgesamt (Prompt API ist die Voraussetzung).
  async function capabilities() {
    const status = await promptAvailability();
    return {
      status,
      usable: isUsable(status),
      needsDownload: status === STATUS.DOWNLOADABLE,
      downloading: status === STATUS.DOWNLOADING,
      hasSummarizer: Boolean(globals.summarizer()),
      hasRewriter: Boolean(globals.rewriter()),
      hasProofreader: Boolean(globals.proofreader()),
      hasTranslator: Boolean(globals.translator()),
      hasDetector: Boolean(globals.detector())
    };
  }

  // Streamende Ticket-Zusammenfassung in vier festen Punkten.
  async function summarize(ticket, opts = {}) {
    const status = await promptAvailability();
    if (!isUsable(status)) return { status };

    let session;
    try {
      session = await createPromptSession({ ...opts, temperature: analysisTemp(), topK: 1 });
      const promptText = [
        "Fasse dieses Jira-Ticket für die interne Bearbeitung zusammen.",
        "Antworte mit genau vier Zeilen, jeweils beginnend mit dem Label:",
        "Anliegen: …",
        "Bisheriger Stand: …",
        "Kundenergebnis/Zusage: …",
        "Nächster Schritt: …",
        "Ist ein Punkt nicht dokumentiert, schreibe 'Nicht dokumentiert'.",
        "",
        fenced("TICKETDATEN", ticketContext(ticket))
      ].join("\n");
      const text = await runStreaming(session, promptText, opts.onChunk, opts.signal);
      return { status: STATUS.AVAILABLE, text };
    } finally {
      if (session && typeof session.destroy === "function") session.destroy();
    }
  }

  // Automatische Einordnung: Stimmung, Dringlichkeit, Kategorie, Kundenwunsch.
  async function triage(ticket, opts = {}) {
    const status = await promptAvailability();
    if (!isUsable(status)) return { status };

    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["stimmung", "dringlichkeit", "kategorie", "kundenwunsch", "naechsterSchritt"],
      properties: {
        stimmung: { type: "string", enum: ["positiv", "neutral", "negativ", "verärgert"] },
        dringlichkeit: { type: "string", enum: ["niedrig", "mittel", "hoch"] },
        kategorie: { type: "string", enum: ["Frage", "Störung", "Änderungswunsch", "Reklamation", "Information", "Sonstiges"] },
        kundenwunsch: { type: "string" },
        naechsterSchritt: { type: "string" }
      }
    };
    const promptText = [
      "Analysiere das folgende Support-Ticket und ordne es ein.",
      "kundenwunsch: in einem kurzen Satz, was der Kunde erreichen möchte.",
      "naechsterSchritt: der aus Sicht des Supports sinnvollste nächste Schritt in einem kurzen Satz.",
      "",
      fenced("TICKETDATEN", ticketContext(ticket))
    ].join("\n");

    const data = await promptJson(promptText, schema, { ...opts, temperature: analysisTemp(), topK: 1 });
    if (!data) return { status: STATUS.ERROR };
    return { status: STATUS.OK, data };
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

  // Entwurf eines internen Jira-Kommentars aus der Notiz des Bearbeiters.
  async function draftComment(input, opts = {}) {
    const { ticket, note, tone, agent } = input || {};
    const status = await promptAvailability();
    if (!isUsable(status)) return { status };

    const toneHint = toneInstruction(tone);
    let session;
    try {
      session = await createPromptSession({ ...opts, temperature: draftTemp(), agentContext: agentContext(agent) });
      const promptText = [
        "Formuliere einen internen Jira-Kommentar zur Dokumentation des Bearbeitungsstands.",
        "Nutze die Ticketdaten als Kontext und die Notiz des Bearbeiters als Hauptinhalt.",
        "Struktur mit genau diesen vier Zeilen (jeweils ein bis zwei Sätze):",
        "Anliegen: …",
        "Besprochen/Stand: …",
        "Ergebnis: …",
        "Nächster Schritt: …",
        toneHint,
        "Wird ein Rückruf oder Termin erwähnt, nenne Datum/Uhrzeit. Fehlt eine Angabe, schreibe [ergänzen].",
        "",
        "Beispiel NUR für die Form (Inhalt NICHT übernehmen, immer aus Notiz und Ticket schöpfen):",
        "Anliegen: Kunde meldet doppelte Abbuchung der März-Rechnung.",
        "Besprochen/Stand: Buchungen geprüft, Dublette bestätigt.",
        "Ergebnis: Storno der Doppelbuchung veranlasst.",
        "Nächster Schritt: Korrigierte Rechnung bis [ergänzen] an den Kunden senden.",
        "",
        fenced("NOTIZ DES BEARBEITERS", note || "(keine Notiz – formuliere aus dem Ticketkontext)"),
        "",
        fenced("TICKETDATEN", ticketContext(ticket))
      ].join("\n");
      const text = await runStreaming(session, promptText, opts.onChunk, opts.signal);
      return { status: STATUS.OK, text };
    } finally {
      if (session && typeof session.destroy === "function") session.destroy();
    }
  }

  // Entwurf einer Kunden-E-Mail (Betreff + Text) aus der Notiz des Bearbeiters.
  async function draftEmail(input, opts = {}) {
    const { ticket, note, tone, agent, language } = input || {};
    const status = await promptAvailability();
    if (!isUsable(status)) return { status };

    const toneHint = toneInstruction(tone);
    const langLabel = languageLabel(language);
    let session;
    try {
      session = await createPromptSession({ ...opts, temperature: draftTemp(), agentContext: agentContext(agent) });
      const promptText = [
        `Formuliere eine freundliche, professionelle Kunden-E-Mail auf ${langLabel}.`,
        "Erste Zeile exakt 'Betreff: …', dann eine Leerzeile, dann der E-Mail-Text mit Anrede und Grußformel.",
        toneHint,
        agent && agent.signature ? "Beende die E-Mail mit der angegebenen Signatur." : "Beende die E-Mail mit einer passenden Grußformel und dem Namen des Bearbeiters, falls bekannt.",
        "Keine internen Vermutungen, keine ticketinternen Details. Fehlt eine unverzichtbare Angabe, schreibe [bitte ergänzen].",
        "",
        "Beispiel NUR für die Form (Inhalt NICHT übernehmen):",
        "Betreff: Update zu Ihrem Anliegen [Ticketnummer]",
        "",
        "Guten Tag [Kundenname],",
        "vielen Dank für Ihre Rückmeldung. Wir haben [Sachverhalt] geprüft und [Ergebnis].",
        "Nächster Schritt: [ergänzen].",
        "",
        "Freundliche Grüße",
        "[Name]",
        "",
        fenced("NOTIZ DES BEARBEITERS", note || "(keine Notiz – formuliere einen freundlichen Zwischenstand)"),
        "",
        fenced("TICKETDATEN", ticketContext(ticket))
      ].join("\n");

      let raw = "";
      const relay = typeof opts.onChunk === "function" ? (acc) => { raw = acc; opts.onChunk(acc); } : undefined;
      raw = await runStreaming(session, promptText, relay, opts.signal);
      const parsed = splitEmail(raw);
      return { status: STATUS.OK, subject: parsed.subject, body: parsed.body, raw };
    } finally {
      if (session && typeof session.destroy === "function") session.destroy();
    }
  }

  // Interner Kommentar zur Weiterleitung an eine Fachabteilung: Kontext plus
  // explizites ToDo, damit die Abteilung ohne Rückfrage übernehmen kann.
  async function draftHandoffComment(input, opts = {}) {
    const { ticket, department, note, agent } = input || {};
    const status = await promptAvailability();
    if (!isUsable(status)) return { status };

    let session;
    try {
      session = await createPromptSession({ ...opts, temperature: draftTemp(), agentContext: agentContext(agent) });
      const promptText = [
        `Formuliere einen internen Jira-Kommentar zur Weitergabe dieses Tickets an die Fachabteilung "${clip(department, 120)}".`,
        "Die Fachabteilung kennt das Ticket noch nicht. Nutze die Ticketdaten und ggf. die Notiz des Bearbeiters als Kontext.",
        "Struktur mit genau diesen drei Zeilen:",
        "Kontext: ein bis zwei Sätze, worum es geht und warum weitergegeben wird.",
        `ToDo für ${clip(department, 120)}: maximal 3 konkrete, umsetzbare Stichpunkte, jeweils beginnend mit '- '.`,
        "Rückmeldung erwartet bis: Datum/Frist, falls in Ticket oder Notiz genannt, sonst 'nicht festgelegt'.",
        "Erfinde keine Fakten. Fehlt eine Angabe, schreibe 'nicht dokumentiert'.",
        "",
        fenced("NOTIZ DES BEARBEITERS", note || "(keine zusätzliche Notiz – ToDo aus dem Ticketkontext ableiten)"),
        "",
        fenced("TICKETDATEN", ticketContext(ticket))
      ].join("\n");
      const text = await runStreaming(session, promptText, opts.onChunk, opts.signal);
      return { status: STATUS.OK, text };
    } finally {
      if (session && typeof session.destroy === "function") session.destroy();
    }
  }

  // Kunden-E-Mail zur Weiterleitung: informiert nur, dass und an wen
  // weitergegeben wurde – keine internen Details.
  async function draftHandoffEmail(input, opts = {}) {
    const { ticket, department, note, agent, language } = input || {};
    const status = await promptAvailability();
    if (!isUsable(status)) return { status };

    const langLabel = languageLabel(language);
    let session;
    try {
      session = await createPromptSession({ ...opts, temperature: draftTemp(), agentContext: agentContext(agent) });
      const promptText = [
        `Formuliere eine kurze, freundliche Kunden-E-Mail auf ${langLabel}, die informiert, dass das Anliegen zur weiteren`,
        `Bearbeitung an die zuständige Fachabteilung "${clip(department, 120)}" weitergeleitet wurde.`,
        "Erste Zeile exakt 'Betreff: …', dann eine Leerzeile, dann der E-Mail-Text mit Anrede und Grußformel.",
        "Keine internen Details, keine Namen von Kolleg:innen oder Abteilungsinterna außer dem genannten Abteilungsnamen.",
        "Erwähne, dass sich die Fachabteilung meldet, sobald es Neuigkeiten gibt.",
        agent && agent.signature ? "Beende die E-Mail mit der angegebenen Signatur." : "Beende die E-Mail mit einer passenden Grußformel und dem Namen des Bearbeiters, falls bekannt.",
        "Fehlt eine unverzichtbare Angabe, schreibe [bitte ergänzen].",
        "",
        fenced("NOTIZ DES BEARBEITERS", note || "(keine zusätzliche Notiz)"),
        "",
        fenced("TICKETDATEN", ticketContext(ticket))
      ].join("\n");

      let raw = "";
      const relay = typeof opts.onChunk === "function" ? (acc) => { raw = acc; opts.onChunk(acc); } : undefined;
      raw = await runStreaming(session, promptText, relay, opts.signal);
      const parsed = splitEmail(raw);
      return { status: STATUS.OK, subject: parsed.subject, body: parsed.body, raw };
    } finally {
      if (session && typeof session.destroy === "function") session.destroy();
    }
  }

  function splitEmail(raw) {
    const text = String(raw || "").trim();
    const match = text.match(/^\s*Betreff:\s*(.*)$/im);
    if (!match) return { subject: "", body: text };
    const subject = match[1].trim();
    const body = text.slice(match.index + match[0].length).replace(/^\s+/, "");
    return { subject, body };
  }

  // KI-Qualitätscheck eines Kommentars inkl. verbesserter Fassung.
  async function reviewDraft(text, ticket, opts = {}) {
    const status = await promptAvailability();
    if (!isUsable(status)) return { status };
    if (!String(text || "").trim()) return { status: STATUS.OK, checks: [], improved: "" };

    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["bewertung", "verbessert"],
      properties: {
        bewertung: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["punkt", "status", "hinweis"],
            properties: {
              punkt: { type: "string", enum: ["Zusammenfassung", "Ergebnis", "Nächster Schritt", "Rückrufzeit", "Ton"] },
              status: { type: "string", enum: ["ok", "fehlt", "unklar"] },
              hinweis: { type: "string" }
            }
          }
        },
        verbessert: { type: "string" }
      }
    };
    const promptText = [
      "Prüfe den folgenden Support-Kommentar auf Vollständigkeit und professionellen Ton.",
      "Bewerte diese Punkte: Zusammenfassung des Anliegens, Ergebnis, nächster Schritt,",
      "Rückrufzeit (nur falls ein Rückruf/Termin erwähnt wird) und Ton.",
      "status ist 'ok', 'fehlt' oder 'unklar'. hinweis: ein kurzer, konkreter Verbesserungshinweis.",
      "verbessert: eine überarbeitete, vollständige und professionelle Fassung des Kommentars.",
      "",
      fenced("KOMMENTAR", text),
      "",
      fenced("TICKETKONTEXT", ticketContext(ticket))
    ].join("\n");

    const data = await promptJson(promptText, schema, { ...opts, temperature: analysisTemp(), topK: 1 });
    if (!data || !Array.isArray(data.bewertung)) return { status: STATUS.ERROR };
    const checks = data.bewertung.map((entry) => ({
      level: entry.status === "ok" ? "ok" : entry.status === "fehlt" ? "warning" : "warning",
      text: `${entry.punkt}: ${entry.hinweis}`
    }));
    return { status: STATUS.OK, checks, improved: String(data.verbessert || "").trim() };
  }

  // Streamende Handlungsempfehlung: konkrete nächste Schritte für den Bearbeiter.
  async function advise(ticket, opts = {}) {
    const status = await promptAvailability();
    if (!isUsable(status)) return { status };

    let session;
    try {
      session = await createPromptSession({ ...opts, temperature: analysisTemp(), topK: 1 });
      const promptText = [
        "Empfiehl dem Support-Bearbeiter das konkrete Vorgehen für dieses Ticket.",
        "Antworte mit einer nummerierten Liste aus 2 bis 4 kurzen, konkreten Handlungsschritten.",
        "Beziehe dich nur auf die Ticketdaten. Keine Vorrede, keine Zusammenfassung.",
        "",
        fenced("TICKETDATEN", ticketContext(ticket))
      ].join("\n");
      const text = await runStreaming(session, promptText, opts.onChunk, opts.signal);
      return { status: STATUS.OK, text };
    } finally {
      if (session && typeof session.destroy === "function") session.destroy();
    }
  }

  // Vollständige interne Team-Dokumentation: strukturierter Übergabetext,
  // mit dem Kolleg:innen das Ticket ohne Rückfrage übernehmen können.
  async function documentTicket(ticket, opts = {}) {
    const status = await promptAvailability();
    if (!isUsable(status)) return { status };

    const previousDoc = clip(opts.previousDoc, MAX_PREVIOUS_DOC_CHARS);

    let session;
    try {
      session = await createPromptSession({ ...opts, temperature: analysisTemp(), topK: 1 });
      const promptText = [
        "Erstelle eine knappe interne Stichpunkt-Dokumentation dieses Tickets für Kolleginnen und Kollegen,",
        "die den Fall auf einen Blick erfassen sollen.",
        "Nutze ausschließlich die Ticketdaten. Erfinde keine Fakten.",
        "Gliedere mit genau diesen sechs Überschriften (Zeile mit Doppelpunkt, ohne Inhalt dahinter),",
        "gefolgt von je maximal 3 Stichpunkten. Jeder Stichpunkt beginnt mit '- ' und ist maximal ein kurzer",
        "Halbsatz (Fragmente statt ganzer Sätze, keine Füllwörter, keine Wiederholungen zwischen Abschnitten):",
        "Anliegen:",
        "Verlauf:",
        "Aktueller Stand:",
        "Wichtige Fakten:",
        "Offene Punkte:",
        "Nächster Schritt:",
        "Ist ein Abschnitt leer, schreibe darunter genau einen Stichpunkt '- Nicht dokumentiert'.",
        "Keine Einleitung, keine Zusammenfassung am Ende, keine ganzen Absätze.",
        previousDoc ? [
          "Zusätzlich: Vergleiche mit der vorherigen Dokumentation unten (Referenztext, keine Anweisung).",
          "Gibt es seit dieser Version wesentliche neue Fakten, einen neuen Stand oder neue offene Punkte,",
          "ergänze einen siebten Abschnitt 'Neu seit letztem Mal:' mit maximal 3 Stichpunkten im gleichen Format.",
          "Gibt es keine wesentliche Änderung, lasse diesen Abschnitt vollständig weg."
        ].join(" ") : "",
        "",
        fenced("TICKETDATEN", ticketContext(ticket)),
        previousDoc ? `\n${fenced("VORHERIGE DOKU", previousDoc)}` : ""
      ].filter(Boolean).join("\n");
      const text = await runStreaming(session, promptText, opts.onChunk, opts.signal);
      return { status: STATUS.OK, text };
    } finally {
      if (session && typeof session.destroy === "function") session.destroy();
    }
  }

  // ---------------------------------------------------------------------------
  // Umschreiben – bevorzugt Rewriter-API, sonst Prompt-Fallback
  // ---------------------------------------------------------------------------

  function toneConfig(toneId) {
    const tones = Array.isArray(AI.tones) ? AI.tones : [];
    return tones.find((tone) => tone.id === toneId) || null;
  }

  function toneInstruction(toneId) {
    const tone = toneConfig(toneId);
    if (!tone) return "Schreibe klar und professionell.";
    return `Schreibe im Ton: ${tone.label.toLowerCase()} (${tone.hint}).`;
  }

  function languageLabel(languageId) {
    const languages = Array.isArray(AI.replyLanguages) ? AI.replyLanguages : [];
    const match = languages.find((entry) => entry.id === languageId);
    if (match) return match.label;
    if (languageId === "en") return "English";
    return "Deutsch";
  }

  async function rewrite(text, opts = {}) {
    const value = String(text || "").trim();
    if (!value) return { status: STATUS.OK, text: "" };

    const tone = toneConfig(opts.tone);
    const rewriterApi = globals.rewriter();

    // 1) Spezialisierte Rewriter-API, falls vorhanden und einsatzbereit.
    if (rewriterApi && typeof rewriterApi.availability === "function" && tone && tone.rewriter) {
      try {
        const availability = await rewriterApi.availability();
        if (isUsable(availability)) {
          const rewriter = await rewriterApi.create(createOptions({
            tone: tone.rewriter.tone || "as-is",
            length: tone.rewriter.length || "as-is",
            format: "plain-text",
            sharedContext: "Support-Kommunikation, Deutsch, sachlich und höflich."
          }, opts));
          try {
            const result = await rewriter.rewrite(value, opts.signal ? { signal: opts.signal } : undefined);
            return { status: STATUS.OK, text: String(result || "").trim() };
          } finally {
            if (typeof rewriter.destroy === "function") rewriter.destroy();
          }
        }
      } catch (error) {
        // Fällt unten auf die Prompt API zurück.
      }
    }

    // 2) Fallback über die Prompt API.
    const status = await promptAvailability();
    if (!isUsable(status)) return { status };
    let session;
    try {
      session = await createPromptSession(opts);
      const promptText = [
        `Schreibe den folgenden Text um. ${toneInstruction(opts.tone)}`,
        "Erhalte die Aussage und alle Fakten. Gib nur den umgeschriebenen Text aus, ohne Vorrede.",
        "",
        fenced("TEXT", value)
      ].join("\n");
      const result = await runStreaming(session, promptText, opts.onChunk, opts.signal);
      return { status: STATUS.OK, text: result };
    } finally {
      if (session && typeof session.destroy === "function") session.destroy();
    }
  }

  // ---------------------------------------------------------------------------
  // Korrektur lesen – bevorzugt Proofreader-API, sonst Prompt-Fallback
  // ---------------------------------------------------------------------------

  async function proofread(text, opts = {}) {
    const value = String(text || "").trim();
    if (!value) return { status: STATUS.OK, text: "" };

    const proofreaderApi = globals.proofreader();
    if (proofreaderApi && typeof proofreaderApi.availability === "function") {
      try {
        const availability = await proofreaderApi.availability();
        if (isUsable(availability)) {
          const proofreader = await proofreaderApi.create(createOptions({
            expectedInputLanguages: ["de"]
          }, opts));
          try {
            const result = await proofreader.proofread(value);
            return { status: STATUS.OK, text: String((result && result.corrected) || value).trim() };
          } finally {
            if (typeof proofreader.destroy === "function") proofreader.destroy();
          }
        }
      } catch (error) {
        // Fällt unten auf die Prompt API zurück.
      }
    }

    const status = await promptAvailability();
    if (!isUsable(status)) return { status };
    let session;
    try {
      session = await createPromptSession(opts);
      const promptText = [
        "Korrigiere Rechtschreibung, Grammatik und Zeichensetzung des folgenden Textes.",
        "Ändere Inhalt, Ton und Formulierung so wenig wie möglich. Gib nur den korrigierten Text aus.",
        "",
        fenced("TEXT", value)
      ].join("\n");
      const result = await runStreaming(session, promptText, opts.onChunk, opts.signal);
      return { status: STATUS.OK, text: result };
    } finally {
      if (session && typeof session.destroy === "function") session.destroy();
    }
  }

  // ---------------------------------------------------------------------------
  // Sprache erkennen & übersetzen
  // ---------------------------------------------------------------------------

  async function detectLanguage(text) {
    const value = String(text || "").trim();
    if (!value) return { status: STATUS.OK, language: "", confidence: 0 };

    const detectorApi = globals.detector();
    if (detectorApi && typeof detectorApi.create === "function") {
      try {
        const availability = await detectorApi.availability();
        if (isUsable(availability)) {
          const detector = await detectorApi.create();
          try {
            const results = await detector.detect(value);
            const best = Array.isArray(results) && results[0];
            if (best) return { status: STATUS.OK, language: best.detectedLanguage, confidence: best.confidence };
          } finally {
            if (typeof detector.destroy === "function") detector.destroy();
          }
        }
      } catch (error) {
        // ignorieren – Sprache bleibt unbekannt
      }
    }
    return { status: STATUS.OK, language: "", confidence: 0 };
  }

  async function translate(text, opts = {}) {
    const value = String(text || "").trim();
    const target = opts.target || "de";
    if (!value) return { status: STATUS.OK, text: "" };

    const translatorApi = globals.translator();
    if (translatorApi && opts.source) {
      try {
        const availability = await translatorApi.availability({ sourceLanguage: opts.source, targetLanguage: target });
        if (isUsable(availability)) {
          const translator = await translatorApi.create(createOptions({ sourceLanguage: opts.source, targetLanguage: target }, opts));
          try {
            const result = await translator.translate(value);
            return { status: STATUS.OK, text: String(result || "").trim() };
          } finally {
            if (typeof translator.destroy === "function") translator.destroy();
          }
        }
      } catch (error) {
        // Fällt unten auf die Prompt API zurück.
      }
    }

    const status = await promptAvailability();
    if (!isUsable(status)) return { status };
    let session;
    try {
      session = await createPromptSession(opts);
      const targetLabel = target === "de" ? "Deutsch" : target;
      const promptText = [
        `Übersetze den folgenden Text nach ${targetLabel}. Gib nur die Übersetzung aus, ohne Vorrede.`,
        "",
        fenced("TEXT", value)
      ].join("\n");
      const result = await runStreaming(session, promptText, opts.onChunk, opts.signal);
      return { status: STATUS.OK, text: result };
    } finally {
      if (session && typeof session.destroy === "function") session.destroy();
    }
  }

  app.localAi = {
    STATUS,
    capabilities,
    summarize,
    triage,
    prepareCall,
    advise,
    documentTicket,
    draftComment,
    draftEmail,
    draftHandoffComment,
    draftHandoffEmail,
    reviewDraft,
    rewrite,
    proofread,
    detectLanguage,
    translate
  };
})();
