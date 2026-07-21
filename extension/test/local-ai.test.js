"use strict";

// Test für die KI-Schicht (src/local-ai.js) – konkret die Nano-Optimierungen:
// (1) Kontext-Priorisierung (neueste Kommentare überleben das Budget, alte
// werden ausgelassen), (2) Few-Shot-Beispiele in den Entwurfs-Prompts,
// (3) niedriger topK für Analyse-Aufgaben. Ein Fake-LanguageModel fängt den
// tatsächlich an das Modell übergebenen Prompt/Optionen ab – so lässt sich das
// Prompt-Engineering ohne echtes Modell prüfen.
//
// Ausführen mit: node test/local-ai.test.js

const assert = require("assert");
const { makeSandbox, loadScripts } = require("./support/stub-env");

const TRIAGE_JSON = JSON.stringify({
  stimmung: "neutral",
  dringlichkeit: "mittel",
  kategorie: "Frage",
  kundenwunsch: "Kunde möchte eine Rückmeldung zum Stand.",
  naechsterSchritt: "Status prüfen und zurückmelden."
});

function setup(jsonResponse) {
  const env = makeSandbox();
  loadScripts(env.sandbox, ["src/config.js", "src/shared.js", "src/local-ai.js"]);
  const captured = [];        // an das Modell übergebene Prompt-Texte
  const createdOptions = [];   // an model.create übergebene Optionen (temperature/topK)
  env.sandbox.LanguageModel = {
    availability: async () => "available",
    params: async () => ({ maxTemperature: 2, defaultTopK: 8, maxTopK: 128 }),
    create: async (options) => {
      createdOptions.push(options);
      return {
        prompt: async (text) => { captured.push(text); return jsonResponse || "Teilantwort"; },
        promptStreaming: (text) => {
          captured.push(text);
          return (async function* () { yield "Teilantwort"; })();
        },
        destroy() {}
      };
    }
  };
  return { localAi: env.sandbox.StadtnetzCRM.localAi, captured, createdOptions };
}

function ticketWithManyComments(count) {
  const comments = [];
  for (let i = 0; i < count; i++) {
    let marker = `KOMMENTAR_${i}`;
    if (i === 0) marker = "MARKER_OLDEST";
    if (i === count - 1) marker = "MARKER_NEWEST";
    comments.push(`${marker} ${"Fülltext ".repeat(150)}`); // ~1350 Zeichen je Kommentar
  }
  return {
    key: "SUP-1", summary: "Testticket", status: "Offen", priority: "Mittel",
    issueType: "Frage", customerReference: "K-1", customerName: "Kunde", assignee: "Bearbeiter",
    description: "Kurze Beschreibung.", comments
  };
}

async function run() {
  // 1) Kontext-Priorisierung: bei zu vielen langen Kommentaren bleibt der
  //    neueste erhalten, der älteste wird ausgelassen.
  {
    const { localAi, captured } = setup();
    await localAi.summarize(ticketWithManyComments(20));
    const prompt = captured.join("\n");
    assert.ok(prompt.includes("MARKER_NEWEST"), "neuester Kommentar bleibt im Kontext erhalten");
    assert.ok(!prompt.includes("MARKER_OLDEST"), "ältester Kommentar wird bei Budgetüberschreitung ausgelassen");
    assert.ok(prompt.includes("ausgelassen"), "Hinweis auf ausgelassene ältere Kommentare ist enthalten");
  }

  // 2) Kleines Ticket: nichts wird ausgelassen, alle Kommentare sind da.
  {
    const { localAi, captured } = setup();
    await localAi.summarize({
      key: "SUP-2", summary: "Klein", status: "Offen", priority: "Niedrig", issueType: "Frage",
      customerReference: "K-2", customerName: "K", assignee: "B",
      description: "Kurz.", comments: ["MARKER_OLDEST kurz", "MARKER_NEWEST kurz"]
    });
    const prompt = captured.join("\n");
    assert.ok(prompt.includes("MARKER_OLDEST") && prompt.includes("MARKER_NEWEST"), "kleines Ticket: alle Kommentare bleiben");
    assert.ok(!prompt.includes("ausgelassen"), "kleines Ticket: kein Auslassen-Hinweis");
  }

  // 3) Few-Shot-Beispiel im Kommentar-Entwurf.
  {
    const { localAi, captured } = setup();
    await localAi.draftComment({ ticket: ticketWithManyComments(2), note: "Rückruf erledigt", tone: "professionell" });
    const prompt = captured.join("\n");
    assert.ok(prompt.includes("Beispiel NUR für die Form"), "Kommentar-Entwurf enthält ein Form-Beispiel");
    assert.ok(prompt.includes("doppelte Abbuchung"), "das konkrete Beispiel ist im Prompt");
  }

  // 4) Few-Shot-Beispiel im E-Mail-Entwurf.
  {
    const { localAi, captured } = setup();
    await localAi.draftEmail({ ticket: ticketWithManyComments(2), note: "Zwischenstand", tone: "freundlich", language: "de" });
    const prompt = captured.join("\n");
    assert.ok(prompt.includes("Beispiel NUR für die Form"), "E-Mail-Entwurf enthält ein Form-Beispiel");
    assert.ok(prompt.includes("Update zu Ihrem Anliegen"), "das E-Mail-Beispiel ist im Prompt");
  }

  // 5) Analyse-Aufgabe nutzt topK=1 (deterministisch), Entwurf nicht.
  {
    const analysis = setup();
    await analysis.localAi.summarize(ticketWithManyComments(2));
    assert.ok(analysis.createdOptions.some((o) => o.topK === 1), "Zusammenfassung läuft mit topK=1");

    const draft = setup();
    await draft.localAi.draftComment({ ticket: ticketWithManyComments(2), note: "x", tone: "professionell" });
    assert.ok(draft.createdOptions.every((o) => o.topK !== 1), "Entwurf läuft NICHT mit topK=1 (mehr Varianz erlaubt)");
  }

  // 6) Triage liefert aus gültigem JSON strukturierte Daten.
  {
    const { localAi } = setup(TRIAGE_JSON);
    const result = await localAi.triage(ticketWithManyComments(2));
    assert.strictEqual(result.status, "ok", "Triage-Status ok");
    assert.strictEqual(result.data.kategorie, "Frage", "Triage liefert die Kategorie zurück");
  }

  console.log("local-ai.test.js: alle Szenarien bestanden.");
}

run().catch((error) => { console.error(error); process.exit(1); });
