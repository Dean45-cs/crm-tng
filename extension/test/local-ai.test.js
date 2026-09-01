"use strict";

// Test für die KI-Schicht (src/local-ai.js) im Outbound-Betrieb. Geprüft werden
// die drei Funktionen und ihr Prompt-Engineering:
// (1) summarize – Vier-Punkte-Struktur und Kontext-Priorisierung (neueste
//     Kommentare überleben das Budget),
// (2) prepareCall – deterministischer topK=1 und strukturierte JSON-Rückgabe,
// (3) draftCallNote – Few-Shot-Beispiel im Prompt und mehr Varianz (topK ≠ 1).
// Ein Fake-LanguageModel fängt den an das Modell übergebenen Prompt/Optionen ab.
//
// Ausführen mit: node test/local-ai.test.js

const assert = require("assert");
const { makeSandbox, loadScripts } = require("./support/stub-env");

const PREP_JSON = JSON.stringify({
  ziel: "Kunden über den Ausbaustand informieren und Tarifwechsel anbieten.",
  punkte: ["Ausbau abgeschlossen", "Upgrade-Optionen erläutern"],
  fragen: ["Ist Interesse an einem schnelleren Tarif vorhanden?"],
  einwaende: [{ einwand: "Ich habe gerade keine Zeit", antwort: "Kein Problem, wann darf ich zurückrufen?" }]
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
    const { localAi, captured } = setup(PREP_JSON);
    await localAi.prepareCall({ ticket: ticketWithManyComments(20) });
    const prompt = captured.join("\n");
    assert.ok(prompt.includes("MARKER_NEWEST"), "neuester Kommentar bleibt im Kontext erhalten");
    assert.ok(!prompt.includes("MARKER_OLDEST"), "ältester Kommentar wird bei Budgetüberschreitung ausgelassen");
    assert.ok(prompt.includes("ausgelassen"), "Hinweis auf ausgelassene ältere Kommentare ist enthalten");
  }

  // 2) Kleines Ticket: nichts wird ausgelassen, alle Kommentare sind da.
  {
    const { localAi, captured } = setup(PREP_JSON);
    await localAi.prepareCall({ ticket: {
      key: "SUP-2", summary: "Klein", status: "Offen", priority: "Niedrig", issueType: "Frage",
      customerReference: "K-2", customerName: "K", assignee: "B",
      description: "Kurz.", comments: ["MARKER_OLDEST kurz", "MARKER_NEWEST kurz"]
    } });
    const prompt = captured.join("\n");
    assert.ok(prompt.includes("MARKER_OLDEST") && prompt.includes("MARKER_NEWEST"), "kleines Ticket: alle Kommentare bleiben");
    assert.ok(!prompt.includes("ausgelassen"), "kleines Ticket: kein Auslassen-Hinweis");
  }

  // 3) prepareCall liefert aus gültigem JSON strukturierte Daten und läuft
  //    deterministisch (topK=1).
  {
    const { localAi, createdOptions } = setup(PREP_JSON);
    const result = await localAi.prepareCall({ ticket: ticketWithManyComments(2) });
    assert.strictEqual(result.status, "ok", "prepareCall-Status ok");
    assert.strictEqual(result.data.ziel, "Kunden über den Ausbaustand informieren und Tarifwechsel anbieten.", "prepareCall liefert das Ziel zurück");
    assert.ok(Array.isArray(result.data.punkte) && result.data.punkte.length >= 2, "prepareCall liefert Gesprächspunkte");
    assert.ok(createdOptions.some((o) => o.topK === 1), "Gesprächsvorbereitung läuft mit topK=1");
  }

  // 4) draftCallNote enthält ein Form-Beispiel und läuft mit mehr Varianz.
  {
    const { localAi, captured, createdOptions } = setup();
    await localAi.draftCallNote({ ticket: ticketWithManyComments(2), note: "Kunde interessiert, Angebot per Mail" });
    const prompt = captured.join("\n");
    assert.ok(prompt.includes("Beispiel NUR für die Form"), "Notiz-Entwurf enthält ein Form-Beispiel");
    assert.ok(prompt.includes("Ausbau im Gebiet abgeschlossen"), "das konkrete Beispiel ist im Prompt");
    assert.ok(createdOptions.every((o) => o.topK !== 1), "Notiz-Entwurf läuft NICHT mit topK=1 (mehr Varianz erlaubt)");
  }

  // 5) summarize fordert die vier festen Punkte an, streamt die Antwort und
  //    läuft deterministisch (topK=1).
  {
    const { localAi, captured, createdOptions } = setup();
    const chunks = [];
    const result = await localAi.summarize(ticketWithManyComments(2), { onChunk: (acc) => chunks.push(acc) });
    assert.strictEqual(result.status, "ok", "summarize-Status ok");
    assert.ok(result.text.includes("Teilantwort"), "summarize liefert den Modelltext zurück");
    assert.ok(chunks.length > 0, "Teilergebnisse werden an onChunk gestreamt");
    const prompt = captured.join("\n");
    ["Anliegen:", "Bisheriger Stand:", "Kundenergebnis/Zusage:", "Nächster Schritt:"].forEach((label) => {
      assert.ok(prompt.includes(label), `der Prompt fordert das Label "${label}"`);
    });
    assert.ok(createdOptions.some((o) => o.topK === 1), "Zusammenfassung läuft mit topK=1");
  }

  // 6) capabilities meldet Verfügbarkeit ohne Companion-API-Flags.
  {
    const { localAi } = setup();
    const caps = await localAi.capabilities();
    assert.strictEqual(caps.usable, true, "capabilities meldet nutzbar");
    assert.ok(!("hasRewriter" in caps), "keine Companion-API-Flags mehr");
  }

  // 7) Der Anruftyp steht im Prompt und richtet die Vorbereitung aus. Ohne ihn
  //    bereitete die KI jede Kampagne als allgemeines Sachstandsgespräch vor.
  {
    const { localAi, captured } = setup(PREP_JSON);
    await localAi.prepareCall({
      ticket: ticketWithManyComments(2),
      callType: "welcome",
      campaignName: "Welcome KW35"
    });
    const prompt = captured.join("\n");
    assert.ok(prompt.includes("ANRUFTYP"), "der Anruftyp steht als eigener Block im Prompt");
    assert.ok(prompt.includes("Welcome KW35"), "die Kampagne der Schicht wird mitgegeben");
    assert.ok(prompt.includes("Der Kunde hat NICHT gekündigt"), "die Welcome-Regeln stehen im Prompt");
    assert.ok(!prompt.includes("(Sachstand, Zusagen, Änderungen)"), "die Punkte werden am Anruftyp ausgerichtet, nicht am Sachstand");
  }

  // 8) Ohne Anruftyp bleibt der Prompt unverändert wie vorher — der Block ist
  //    additiv, ein Aufruf ohne callType darf nicht schlechter werden.
  {
    const { localAi, captured } = setup(PREP_JSON);
    await localAi.prepareCall({ ticket: ticketWithManyComments(2) });
    const prompt = captured.join("\n");
    assert.ok(!prompt.includes("ANRUFTYP"), "ohne callType gibt es keinen Anruftyp-Block");
    assert.ok(prompt.includes("(Sachstand, Zusagen, Änderungen)"), "ohne Anruftyp gilt weiter die alte Punkte-Anweisung");
  }

  // 9) Eine belegte Kündigung schlägt den Anruftyp: auch ein Welcome-Anlass
  //    wird dann als Rückgewinnung vorbereitet.
  {
    const { localAi, captured } = setup(PREP_JSON);
    await localAi.prepareCall({
      ticket: ticketWithManyComments(2),
      callType: "welcome",
      churn: { ursache: "Preis zu hoch", vertrag: "V-1" }
    });
    const prompt = captured.join("\n");
    assert.ok(prompt.includes("ANRUFTYP"), "der Anruftyp steht trotzdem im Prompt");
    assert.ok(prompt.includes("RÜCKGEWINNUNGSGESPRÄCH"), "die Kündigung übersteuert ihn");
    assert.ok(prompt.includes("Das geht dem Anruftyp oben vor"), "und die Rangfolge ist ausdrücklich benannt");
  }

  // 10) Unbekannter Call-Typ (Kampagne ohne Brief): kein Block, kein Absturz.
  {
    const { localAi, captured } = setup(PREP_JSON);
    const result = await localAi.prepareCall({ ticket: ticketWithManyComments(2), callType: "gibtsnicht" });
    assert.strictEqual(result.status, "ok", "unbekannter Typ bricht die Vorbereitung nicht ab");
    assert.ok(!captured.join("\n").includes("ANRUFTYP"), "und erzeugt keinen leeren Anruftyp-Block");
  }

  console.log("local-ai.test.js: alle Szenarien bestanden.");
}

run().catch((error) => { console.error(error); process.exit(1); });
