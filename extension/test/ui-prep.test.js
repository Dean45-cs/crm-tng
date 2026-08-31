"use strict";

// Vorbereitungs-Tab im Jira-Panel (src/ui.js). Geprüft werden die beiden
// Dinge, die dort vor dem Wählen entscheiden, ob der Bearbeiter sprechfähig
// ist:
//
//   1. Die KI-Gesprächsvorbereitung kennt den Anruftyp. Sie las früher nur das
//      Ticket und schrieb für jede Kampagne dieselbe Sachstands-Vorbereitung —
//      auch für Welcome oder BVW, wo der Bearbeiter etwas ganz anderes will.
//      Ein Wechsel des Typs muss die zwischengespeicherte Vorbereitung
//      verwerfen, sonst steht die Vorbereitung des falschen Anlasses da.
//   2. Das Widget „Kunde & Vorgeschichte": Kundenakte und bisherige Anrufe
//      standen bisher nur im Call-Cockpit, also erst WÄHREND des Gesprächs.
//      Der offene Rückruf muss auch ohne CRM-Anmeldung erscheinen — er liegt
//      lokal, und „schon zweimal vergeblich versucht" ist die wichtigste
//      Zeile im ganzen Tab.
//
// Ausführen mit: node test/ui-prep.test.js

const assert = require("assert");
const { makePanelSandbox, loadScripts } = require("./support/stub-env");

// supabase.js wird bewusst NICHT geladen: ui.js liest app.supabaseClient beim
// Laden einmalig in eine Konstante, also muss der Stub vorher stehen.
const SCRIPTS_BEFORE_UI = [
  "src/config.js",
  "src/shared.js",
  "src/ai-cache.js",
  "src/jira-reader.js",
  "src/rules.js",
  "src/local-ai.js",
  "src/theme.js"
];

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

const CARD = {
  customerNumber: "287246",
  name: "Erika Mustermann",
  phone: "0431 1234567",
  firstSeenAt: "2024-03-12T10:00:00.000Z",
  lastContactAt: "2026-08-04T09:30:00.000Z",
  contractCount: 2,
  tariffChangeCount: 1,
  noteCount: 3,
  leadCount: 0,
  jiraTicket: "TNG-999"
};

const CALLS = [
  { id: "c1", startedAt: "2026-08-28T12:32:00.000Z", durationS: 252, direction: "outbound", disposition: "gehalten", outcome: "", jiraTicket: "" },
  { id: "c2", startedAt: "2026-08-26T07:15:00.000Z", durationS: 22, direction: "outbound", disposition: "rueckruf", outcome: "", jiraTicket: "" }
];

// Ein klingelnder Anruf liefert die Kundennummer, ohne (wie „connected") den
// aktiven Tab auf Gespräch umzuschalten — die Vorbereitung bleibt sichtbar.
function ringingCall(number) {
  return { status: "ringing", customerNumber: number, callerName: "Test", updatedAt: Date.now() };
}

async function mountPanel(options) {
  const opts = options || {};
  const env = makePanelSandbox();
  loadScripts(env.sandbox, SCRIPTS_BEFORE_UI);
  const app = env.sandbox.StadtnetzCRM;
  const KEYS = app.CONFIG.storageKeys;

  const seen = { card: [], calls: [] };
  app.supabaseClient = {
    customerCard: async (number) => {
      seen.card.push(number);
      return opts.cardResult || { ok: true, data: CARD };
    },
    recentCalls: async (number, limit) => {
      seen.calls.push([number, limit]);
      return opts.callsResult || { ok: true, rows: CALLS };
    },
    fetchCurrentShift: async () => ({ ok: false }),
    logout() {}
  };

  Object.assign(env.storage, opts.storage ? opts.storage(KEYS) : {});
  loadScripts(env.sandbox, ["src/ui.js"]);
  await app.ui.mount();
  await settle();
  await settle();
  return { env, app, KEYS, CONFIG: app.CONFIG, seen };
}

async function run() {
  // --- 1. Kundenakte und Vorgeschichte stehen VOR dem Gespräch -------------
  {
    const { env, seen } = await mountPanel({
      storage: (KEYS) => ({ [KEYS.activeCall]: ringingCall("287246") })
    });
    const html = env.html();

    assert.deepStrictEqual(seen.card, ["287246"], "die Akte wird zur erkannten Kundennummer geladen");
    assert.deepStrictEqual(seen.calls, [["287246", 3]], "und dazu die letzten Anrufe");

    assert.ok(html.includes("Kunde &amp; Vorgeschichte"), "das Widget steht im Vorbereitungs-Tab");
    assert.ok(html.includes("Erika Mustermann"), "mit dem Kundennamen");
    assert.ok(html.includes("2 Verträge") && html.includes("3 Notizen"), "und den Bestandszahlen");
    // Einzahl/Mehrzahl: „1 Wechsel", nicht „1 Wechsels" — und leadCount 0
    // taucht gar nicht erst auf, statt als „0 Leads" Platz zu belegen.
    assert.ok(html.includes("1 Wechsel") && !html.includes("Leads"), "Zahlwörter stehen in der richtigen Form");
    assert.ok(html.includes("Kunde seit"), "Erstkontakt wird gezeigt");
    // lastContactAt liefert die customer_card-Funktion seit jeher mit, wurde
    // aber in keiner Ansicht genutzt.
    assert.ok(html.includes("zuletzt"), "und der letzte Kontakt");
    assert.ok(html.includes("Zuletzt telefoniert"), "die Anruf-Vorgeschichte ist da");
    assert.ok(html.includes("gehalten") && html.includes("Rückruf"), "mit den Dispositionen in Klartext");
    assert.ok(html.includes("4:12 Min."), "und der Gesprächsdauer");
  }

  // --- 2. Ohne CRM-Anmeldung: Hinweis statt leerem Kasten ------------------
  {
    const { env, seen } = await mountPanel({
      storage: (KEYS) => ({ [KEYS.activeCall]: ringingCall("287246") }),
      cardResult: { ok: false, reason: "not-logged-in" },
      callsResult: { ok: false, reason: "not-logged-in" }
    });
    const html = env.html();
    assert.strictEqual(seen.card.length, 1, "es wird trotzdem genau einmal versucht");
    assert.ok(html.includes("fehlt die CRM-Anmeldung"), "der Grund steht im Klartext da");
    assert.ok(!html.includes("Erika Mustermann"), "und keine Kundendaten von irgendwoher");
  }

  // --- 3. Der offene Rückruf braucht kein Supabase -------------------------
  //     Er liegt lokal — ohne Anmeldung ist er die einzige, aber wichtigste
  //     Information des Widgets.
  {
    const { env } = await mountPanel({
      storage: (KEYS) => ({
        [KEYS.activeCall]: ringingCall("287246"),
        [KEYS.callbacks]: {
          items: [{
            id: "cb-1", ticketKey: "TNG-1592568", ticketSummary: "Kündigung prüfen",
            customerName: "Erika Mustermann", customerReference: "287246", phone: "",
            reason: "Mailbox erreicht", dueAt: Date.now() - 60000, attempts: 2,
            lastOutcome: "", notifiedAt: 0, done: false, createdAt: Date.now() - 7200000
          }],
          updatedAt: Date.now()
        }
      }),
      cardResult: { ok: false, reason: "not-logged-in" },
      callsResult: { ok: false, reason: "not-logged-in" }
    });
    const html = env.html();
    assert.ok(html.includes("Rückruf ist fällig"), "der überfällige Rückruf steht ganz oben");
    assert.ok(html.includes("2. Versuch"), "samt Zahl der bisherigen Versuche");
    assert.ok(html.includes("Mailbox erreicht"), "und dem Grund von damals");
  }

  // --- 4. Kein Kunde, kein Rückruf: das Widget erscheint gar nicht ---------
  {
    const { env, seen } = await mountPanel({});
    assert.strictEqual(seen.card.length, 0, "ohne Kundennummer wird nichts nachgeschlagen");
    assert.ok(!env.html().includes("Kunde &amp; Vorgeschichte"), "und kein leerer Rahmen gezeichnet");
  }

  // --- 5. Der Anruftyp steht sichtbar an der Gesprächsvorbereitung ---------
  //     Die Vorbereitung liest sich je nach Typ völlig anders — ohne diese
  //     Angabe wäre nicht erkennbar, ob gerade der richtige eingestellt ist.
  {
    const { env, app, CONFIG } = await mountPanel({});
    assert.ok(env.html().includes("Gesprächsvorbereitung"), "das Vorbereitungs-Widget ist da");
    // Ohne geladene Schicht gilt der Standard „churn".
    assert.ok(
      env.html().includes(`<span class="sc-prep-type">${CONFIG.callTypeLabels.churn}</span>`),
      "der geltende Anruftyp ist an der Überschrift ausgewiesen"
    );

    // Der Platzhaltertext vor dem ersten Lauf nennt das Ziel dieses Typs. Er
    // erscheint nur bei nutzbarer KI — sonst steht dort die Absage.
    app.localAi.capabilities = async () => ({ status: "available", usable: true, provenWorking: true });
    // Die Zusammenfassung läuft in AUTO_RUN_TASKS vor der Vorbereitung. Hängt
    // sie, bleibt die Vorbereitung auf „noch nicht gelaufen" stehen — genau der
    // Zustand, in dem der Erklärtext sichtbar ist.
    app.localAi.summarize = () => new Promise(() => {});
    env.click("recheck-ai");
    await settle();
    await settle();
    assert.ok(env.html().includes(CONFIG.callPrepBriefs.churn.ziel), "und wozu dieser Anruftyp führen soll");
  }

  // --- 6. Ein Typwechsel baut die Vorbereitung neu -------------------------
  //     Der Typ steckt im Prompt; eine für Churn geschriebene Vorbereitung ist
  //     für einen Welcome-Anruf schlicht falsch und darf nicht stehen bleiben.
  {
    const { env, app, CONFIG } = await mountPanel({});
    const prepCalls = [];
    app.localAi.capabilities = async () => ({ status: "available", usable: true, provenWorking: true });
    app.localAi.prepareCall = async (input) => {
      prepCalls.push(input.callType);
      return { status: "ok", data: { ziel: `Ziel für ${input.callType}`, punkte: [], fragen: [], einwaende: [] } };
    };

    env.click("recheck-ai");
    await settle();
    await settle();
    assert.deepStrictEqual(prepCalls, ["churn"], "der erste Lauf nutzt den geltenden Typ");
    assert.ok(env.html().includes("Ziel für churn"), "und das Ergebnis steht im Panel");

    // Umschalten im Gespräch-Tab — die Vorbereitung liegt im Vorbereitungs-Tab.
    env.click("set-call-type", { callType: "welcome" });
    await settle();
    await settle();
    assert.deepStrictEqual(prepCalls, ["churn", "welcome"], "der Wechsel stößt eine neue Vorbereitung an");
    assert.ok(env.html().includes("Ziel für welcome"), "die alte Vorbereitung wurde ersetzt");
    assert.ok(env.html().includes(CONFIG.callTypeLabels.welcome), "und der ausgewiesene Typ zieht mit");

    // Zurückschalten darf nicht endlos neu rechnen: churn ist bereits im Cache,
    // aber unter dem alten prepKey — genau ein weiterer Lauf, dann Ruhe.
    env.click("set-call-type", { callType: "churn" });
    await settle();
    await settle();
    assert.deepStrictEqual(prepCalls, ["churn", "welcome", "churn"], "zurück auf churn rechnet einmal neu");
    env.tick();
    await settle();
    assert.strictEqual(prepCalls.length, 3, "und danach läuft nichts mehr im Leerlauf");
  }

  console.log("ui-prep.test.js: alle Szenarien bestanden.");
}

run().catch((error) => { console.error(error); process.exit(1); });
