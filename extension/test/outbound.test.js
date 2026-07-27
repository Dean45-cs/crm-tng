"use strict";

// Outbound-Modus: geteilte Helfer (Arbeitsrichtung, Rückrufliste,
// Kundennummer-Suche), das modusabhängige Symbolleisten-Badge samt
// Rückruf-Erinnerung und die Gesprächsvorbereitung der lokalen KI.
//
// Hintergrund: timio hat eine eigene Anrufliste und wählt selbst, sobald sich
// der Bearbeiter auf "bereit" stellt. Der Call-Screen sieht dabei genauso aus
// wie bei eingehenden Anrufen – die Richtung kommt deshalb nicht aus dem
// Seitentext, sondern aus dem Modus-Schalter. Genau diese Weiche wird hier
// geprüft, zusammen mit der Rückkopplungsgefahr im Service-Worker.
//
// Ausführen mit: node test/outbound.test.js

const assert = require("assert");
const { makeSandbox, makeWorkerSandbox, loadScripts } = require("./support/stub-env");

function loadShared() {
  const env = makeSandbox();
  loadScripts(env.sandbox, ["src/config.js", "src/shared.js"]);
  return {
    env,
    shared: env.sandbox.StadtnetzCRM.shared,
    CONFIG: env.sandbox.StadtnetzCRM.CONFIG
  };
}

function loadWorker() {
  const env = makeWorkerSandbox();
  loadScripts(env.sandbox, ["src/config.js", "src/shared.js", "src/background.js"]);
  const app = env.sandbox.StadtnetzCRM;
  return { env, bg: app.background, KEYS: app.CONFIG.storageKeys, BADGE: app.CONFIG.badge };
}

async function run() {
  // --- Arbeitsrichtung normalisieren ---------------------------------------
  {
    const { shared } = loadShared();

    assert.strictEqual(shared.callModeMeta("outbound").id, "outbound", "outbound wird erkannt");
    assert.strictEqual(shared.callModeMeta("inbound").id, "inbound", "inbound wird erkannt");
    // Ein unbekannter oder fehlender Wert darf nie in einen dritten Zustand
    // laufen – im Zweifel gilt eingehend, das ist der Normalbetrieb.
    assert.strictEqual(shared.callModeMeta(undefined).id, "inbound", "ohne Wert gilt eingehend");
    assert.strictEqual(shared.callModeMeta("quatsch").id, "inbound", "Müll fällt auf eingehend zurück");
    assert.strictEqual(shared.isOutbound("outbound"), true, "isOutbound erkennt ausgehend");
    assert.strictEqual(shared.isOutbound(null), false, "isOutbound ist bei Müll false");

    // Der Status-Text unterscheidet die Richtung: ausgehend klingelt nichts.
    assert.ok(shared.callStatusMeta("ringing", "outbound").label.includes("Wählt"), "ausgehend wird gewählt statt geklingelt");
    assert.ok(shared.callStatusMeta("ringing", "inbound").label.includes("Klingelt"), "eingehend klingelt es");
    assert.strictEqual(shared.callStatusMeta("ringing").cls, "is-ringing", "CSS-Klasse bleibt richtungsunabhängig");
  }

  // --- Rufnummern normalisieren --------------------------------------------
  {
    const { shared } = loadShared();
    assert.strictEqual(shared.normalizePhone("+49 (176) 34573586"), "+4917634573586", "timio-Format wird wählbar");
    assert.strictEqual(shared.normalizePhone("0176 / 345 735-86"), "017634573586", "nationales Format wird wählbar");
    assert.strictEqual(shared.normalizePhone(""), "", "leer bleibt leer");
    assert.strictEqual(shared.normalizePhone("keine Nummer"), "", "Text ohne Ziffern ergibt nichts");
  }

  // --- Wiedervorlage: Abstände eskalieren ----------------------------------
  {
    const { shared, CONFIG } = loadShared();
    const now = 1000000;
    const delays = CONFIG.outbound.retryDelaysMs;

    assert.strictEqual(shared.nextRetryAt(0, now), now + delays[0], "erster Versuch: kürzester Abstand");
    assert.strictEqual(shared.nextRetryAt(1, now), now + delays[1], "zweiter Versuch: größerer Abstand");
    assert.strictEqual(shared.nextRetryAt(2, now), now + delays[2], "dritter Versuch: größter Abstand");
    // Danach nicht weiter eskalieren, sondern beim größten Abstand bleiben.
    assert.strictEqual(shared.nextRetryAt(99, now), now + delays[delays.length - 1], "darüber bleibt es beim größten Abstand");
  }

  // --- Rückrufliste ausmisten und deckeln ----------------------------------
  {
    const { shared, CONFIG } = loadShared();
    const now = Date.now();
    const day = 86400000;
    const keepDays = CONFIG.outbound.keepDoneDays;

    const pruned = shared.pruneCallbacks([
      { id: "a", dueAt: now + day },
      { id: "b", dueAt: now - 60000 },
      { id: "erledigt", dueAt: now, done: true },
      { id: "uralt", dueAt: now - (keepDays + 1) * day },
      { id: "", dueAt: now },      // ohne id: unbrauchbar
      null
    ], now);

    const ids = pruned.map((item) => item.id);
    assert.deepStrictEqual(ids, ["b", "a"], "sortiert nach Fälligkeit, ohne erledigte/uralte/kaputte Einträge");

    // Datensparsamkeit: die Liste enthält Rufnummern und darf nicht wachsen.
    const many = [];
    for (let i = 0; i < CONFIG.outbound.maxCallbacks + 25; i++) many.push({ id: `x${i}`, dueAt: now + i });
    assert.strictEqual(shared.pruneCallbacks(many, now).length, CONFIG.outbound.maxCallbacks, "Liste wird hart gedeckelt");
    // Längenvergleich statt deepStrictEqual: ein im vm erzeugtes [] hat einen
    // anderen Prototyp als das [] dieses Test-Realms (siehe shared.test.js).
    assert.strictEqual(shared.pruneCallbacks(null, now).length, 0, "kein Array ergibt eine leere Liste");
  }

  // --- Fällige Rückrufe -----------------------------------------------------
  {
    const { shared } = loadShared();
    const now = Date.now();
    const items = [
      { id: "faellig", dueAt: now - 1000 },
      { id: "spaeter", dueAt: now + 60000 },
      { id: "erledigt", dueAt: now - 5000, done: true },
      { id: "ohne-termin" }
    ];
    const due = shared.dueCallbacks(items, now).map((item) => item.id);
    assert.deepStrictEqual(due, ["faellig"], "nur wirklich fällige, offene Einträge mit Termin");
  }

  // --- Kundennummer-Suche ---------------------------------------------------
  {
    const { shared, CONFIG } = loadShared();

    const url = shared.customerSearchUrl("287246");
    assert.ok(url.startsWith(`${CONFIG.jira.baseUrl}/issues/?jql=`), "zeigt auf die Jira-Suche");
    assert.ok(decodeURIComponent(url).includes("287246"), "die Kundennummer landet im JQL");

    // Eigene Vorlage aus den Einstellungen hat Vorrang.
    const own = decodeURIComponent(shared.customerSearchUrl("287246", '"Oikonomikos-ID" ~ "{q}"'));
    assert.ok(own.includes('"Oikonomikos-ID" ~ "287246"'), "eigene JQL-Vorlage wird verwendet");

    // Anführungszeichen im Wert würden den JQL-String sprengen.
    const injected = decodeURIComponent(shared.customerSearchUrl('12" OR key = "X-1'));
    assert.ok(!injected.includes('12" OR'), "Anführungszeichen werden entfernt, der JQL bleibt heil");

    assert.strictEqual(shared.customerSearchUrl(""), "", "ohne Kundennummer gibt es keinen Link");
  }

  // --- Badge: fällige Rückrufe drängen -------------------------------------
  {
    const { bg, BADGE } = loadWorker();
    const now = Date.now();
    const callbacks = { items: [
      { id: "a", dueAt: now - 1000, ticketKey: "TNG-1", reason: "Nicht erreicht" },
      { id: "b", dueAt: now + 600000, ticketKey: "TNG-2" }
    ] };

    // Im reinen Outbound-Betrieb bedient der Bearbeiter kein Wartefeld – die
    // drängende Zahl sind die fälligen Wiedervorlagen.
    const due = bg.computeBadge(null, now, { callbacks });
    assert.strictEqual(due.text, "1", "das Badge zählt die fälligen Rückrufe");
    assert.strictEqual(due.color, BADGE.colorDue, "das Badge ist bernsteinfarben");
    assert.ok(due.title.includes("TNG-1"), "der Tooltip nennt den fälligen Vorgang");

    // Kein fälliger Rückruf: leeres Badge.
    const none = bg.computeBadge(null, now, { callbacks: { items: [] } });
    assert.strictEqual(none.text, "", "ohne fällige Rückrufe bleibt das Badge leer");
    assert.strictEqual(none.color, BADGE.colorDue, "die Badge-Farbe bleibt bernstein");

    // Ein aktiver Anruf erscheint im Tooltip.
    const onCall = bg.computeBadge({ status: "connected", callerName: "Anna", updatedAt: now }, now, { callbacks });
    assert.ok(onCall.title.includes("Im Gespräch: Anna"), "der aktive Anruf steht im Tooltip");
  }

  // --- Erinnerung je Rückruf genau einmal -----------------------------------
  {
    const { bg } = loadWorker();
    const now = Date.now();
    const items = [
      { id: "a", dueAt: now - 1000 },
      { id: "b", dueAt: now - 1000, notifiedAt: now - 500 },
      { id: "c", dueAt: now + 60000 }
    ];
    const pending = bg.callbacksToNotify({ items }, now, true).map((item) => item.id);
    assert.deepStrictEqual(pending, ["a"], "nur fällige Einträge ohne bisherige Meldung");
    assert.strictEqual(bg.callbacksToNotify({ items }, now, false).length, 0, "abgeschaltet wird gar nicht gemeldet");
  }

  // --- Ende-zu-Ende: Meldung, Merker, keine Rückkopplung --------------------
  {
    const { env, bg, KEYS } = loadWorker();
    const now = Date.now();
    env.storage[KEYS.callMode] = "outbound";
    env.storage[KEYS.settings] = { notifyCallbacks: true };
    env.storage[KEYS.callbacks] = { items: [{ id: "a", dueAt: now - 1000, ticketKey: "TNG-1", customerName: "Muster" }] };

    await bg.refresh({ notify: true });
    assert.strictEqual(env.calls.notifications.length, 1, "der fällige Rückruf meldet sich genau einmal");
    assert.ok(env.calls.notifications[0].id.startsWith("sc-callback:"), "eigene Notification-ID je Rückruf");
    assert.strictEqual(env.calls.badgeText.slice(-1)[0], "1", "das Badge zeigt den fälligen Rückruf");

    // Der Merker sitzt am Eintrag selbst und überlebt damit den Worker-Neustart.
    const stored = env.storage[KEYS.callbacks].items[0];
    assert.ok(stored.notifiedAt, "notifiedAt wurde am Eintrag vermerkt");

    // Genau hier lauert die Rückkopplung: der Worker hört auf callbacks UND
    // schreibt den Schlüssel selbst. Ein zweiter Durchlauf darf deshalb weder
    // erneut melden noch erneut schreiben – sonst dreht sich das endlos.
    const writesBefore = JSON.stringify(env.storage[KEYS.callbacks]);
    await bg.refresh({ notify: true });
    assert.strictEqual(env.calls.notifications.length, 1, "der zweite Durchlauf meldet nicht noch einmal");
    assert.strictEqual(JSON.stringify(env.storage[KEYS.callbacks]), writesBefore, "und schreibt nicht erneut – die Schleife endet");
  }

  // --- Gesprächsvorbereitung der lokalen KI ---------------------------------
  {
    const env = makeSandbox();
    loadScripts(env.sandbox, ["src/config.js", "src/shared.js", "src/local-ai.js"]);
    const captured = [];
    const createdOptions = [];
    env.sandbox.LanguageModel = {
      availability: async () => "available",
      params: async () => ({ maxTemperature: 2, defaultTopK: 8, maxTopK: 128 }),
      create: async (options) => {
        createdOptions.push(options);
        return {
          prompt: async (text) => {
            captured.push(text);
            return JSON.stringify({
              ziel: "Fehlende Zählernummer erfragen",
              punkte: ["Stand der Prüfung nennen", "Zusage vom 12.07. bestätigen"],
              fragen: ["Wie lautet die Zählernummer?"],
              einwaende: [{ einwand: "Keine Zeit", antwort: "Wann darf ich zurückrufen?" }]
            });
          },
          destroy() {}
        };
      }
    };
    const localAi = env.sandbox.StadtnetzCRM.localAi;

    const ticket = { key: "TNG-1", summary: "Zähler", description: "Kunde meldet fehlende Ablesung", comments: [] };
    const result = await localAi.prepareCall({ ticket, agent: { name: "Kevin" } });

    assert.strictEqual(result.status, "ok", "die Vorbereitung liefert ein Ergebnis");
    assert.strictEqual(result.data.ziel, "Fehlende Zählernummer erfragen", "das Anrufziel kommt durch");
    assert.strictEqual(result.data.punkte.length, 2, "die Gesprächspunkte kommen durch");

    const prompt = captured.join("\n");
    // Entscheidend fürs Ergebnis: das Modell muss wissen, wer hier anruft.
    assert.ok(/ruft den Kunden an/i.test(prompt), "der Prompt stellt klar, dass der Bearbeiter anruft");
    assert.ok(prompt.includes("Kunde meldet fehlende Ablesung"), "die Ticketdaten stecken im Prompt");
    // Analyse-Aufgabe: formattreu statt kreativ.
    assert.ok(createdOptions.some((options) => options.topK === 1), "läuft deterministisch mit topK 1");
  }

  // --- Ohne lokales Modell sauber abbrechen ---------------------------------
  {
    const env = makeSandbox();
    loadScripts(env.sandbox, ["src/config.js", "src/shared.js", "src/local-ai.js"]);
    // Echte Timer: die Verfügbarkeitsprüfung fasst bei "unavailable" einmal kurz
    // nach (siehe unten), und die Sandbox-Timer feuern nicht von selbst.
    env.sandbox.setTimeout = (fn, ms) => setTimeout(fn, ms);
    env.sandbox.clearTimeout = (id) => clearTimeout(id);
    let probes = 0;
    env.sandbox.LanguageModel = {
      availability: async () => { probes++; return "unavailable"; },
      create: async () => { throw new Error("darf nicht passieren"); }
    };
    const result = await env.sandbox.StadtnetzCRM.localAi.prepareCall({ ticket: { key: "TNG-1" } });
    assert.strictEqual(result.status, "unavailable", "ohne Modell wird der Status durchgereicht");
    assert.strictEqual(result.data, undefined, "und es werden keine Daten erfunden");
    // Ein einzelnes "unavailable" ist oft nur ein schlechter Moment (Modell wird
    // gerade geladen/entladen). Deshalb wird nachgefasst, bevor die Oberfläche
    // die KI als nicht nutzbar meldet.
    assert.ok(probes > 1, "bei „unavailable“ wird nachgefasst statt sofort aufzugeben");
  }

  // --- Ein vorübergehendes „unavailable“ darf die KI nicht abschalten -------
  // Der Fall aus dem Betrieb: die erste Aufgabe läuft, danach meldet Chrome
  // kurzzeitig "unavailable" (Modell beschäftigt / wird nachgeladen). Früher
  // hieß das für jede weitere Aufgabe „Modell nicht nutzbar" – obwohl es
  // nachweislich eben noch gearbeitet hat. Jetzt wird es trotzdem versucht.
  {
    const env = makeSandbox();
    loadScripts(env.sandbox, ["src/config.js", "src/shared.js", "src/local-ai.js"]);
    env.sandbox.setTimeout = (fn, ms) => setTimeout(fn, ms);
    env.sandbox.clearTimeout = (id) => clearTimeout(id);

    let status = "available";
    const answer = JSON.stringify({ ziel: "Z", punkte: ["a", "b"], fragen: ["f"], einwaende: [] });
    env.sandbox.LanguageModel = {
      availability: async () => status,
      params: async () => ({ maxTemperature: 2, defaultTopK: 8, maxTopK: 128 }),
      create: async () => ({ prompt: async () => answer, destroy() {} })
    };
    const localAi = env.sandbox.StadtnetzCRM.localAi;
    const ticket = { key: "TNG-2", summary: "S", description: "D", comments: [] };

    const first = await localAi.prepareCall({ ticket });
    assert.strictEqual(first.status, "ok", "der erste Lauf klappt");

    status = "unavailable"; // Chrome hat gerade einen schlechten Moment
    const second = await localAi.prepareCall({ ticket });
    assert.strictEqual(second.status, "ok", "der zweite Lauf wird trotzdem versucht – und klappt");

    const caps = await localAi.capabilities();
    assert.strictEqual(caps.usable, true, "die Oberfläche bleibt bedienbar");
    assert.strictEqual(caps.provenWorking, true, "erkennbar daran, dass das Modell hier schon gearbeitet hat");
  }

  console.log("outbound.test.js: alle Szenarien bestanden.");
}

run().catch((error) => { console.error(error); process.exit(1); });
