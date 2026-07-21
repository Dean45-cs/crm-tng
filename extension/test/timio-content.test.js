"use strict";

// Smoke-Test für src/timio-content.js: Call-Erkennung und das Idle-
// Wartefeld-Widget. Läuft ohne Browser via Node `vm` gegen die echten
// Quelldateien (siehe test/support/stub-env.js). Ausführen mit:
//   node test/timio-content.test.js
// Neue Szenarien bitte hier ergänzen statt ein neues Wegwerf-Skript zu
// schreiben.

const assert = require("assert");
const { makeSandbox, loadScripts } = require("./support/stub-env");

function run() {
  const env = makeSandbox();
  loadScripts(env.sandbox, ["src/config.js", "src/shared.js", "src/timio-content.js"]);

  // 1) Idle, noch keine Wartefeld-Daten bekannt -> kein Overlay.
  env.setPageText("Portal Willkommen");
  env.tick();
  assert.strictEqual(env.getOverlay(), null, "kein Overlay, solange keine Wartefeld-Daten bekannt sind");

  // 2) Idle, Portal-Tab sichtbar mit Wartefeld-Daten -> Idle-Widget erscheint.
  env.setPageText([
    "TNG GFIZ Bestellhotline",
    "Agenten",
    "3",
    "Wartefeld",
    "2",
    "1:23",
    "0:45",
    "Anrufe Eingang Aktuell",
    "2",
    "Im Wartefeld"
  ].join("\n"));
  env.tick();
  assert.ok(env.getOverlay(), "Idle-Wartefeld-Widget erscheint, sobald Wartefeld-Daten bekannt sind");
  assert.ok(env.getOverlay().innerHTML.includes("Wartefeld"), "Idle-Widget zeigt das Label \"Wartefeld\"");

  // 3) Weg vom Portal-Tab (Daten bleiben gecacht) -> Widget bleibt sichtbar.
  env.setPageText("Willkommen");
  env.tick();
  assert.ok(env.getOverlay(), "Idle-Widget bleibt mit gecachten Daten sichtbar, auch außerhalb des Portal-Tabs");

  // 4) Eingehender Anruf -> Anrufkarte ersetzt das Idle-Widget.
  env.setPageText([
    "AB",
    "Anna Beispiel",
    "Beispiel",
    "+49 (176) 34573586",
    "Eingehender Anruf",
    "Gruppe: TNG GFIZ Bestellhotline",
    "Wartezeit: 0:12",
    "Kundennummer: 12345"
  ].join("\n"));
  env.tick();
  assert.ok(env.getOverlay().innerHTML.includes("Klingelt"), "während des Klingelns wird die Anrufkarte gezeigt, nicht das Idle-Widget");

  // 5) Anruf endet, Seite wird wieder idle -> Idle-Widget erscheint erneut.
  env.setPageText("Willkommen");
  env.tick();
  assert.ok(env.getOverlay(), "Idle-Widget erscheint nach Anrufende wieder");
  assert.ok(env.getOverlay().innerHTML.includes("Wartefeld"), "das wiedererschienene Widget ist das Idle-Wartefeld-Widget");

  // 6) Idle-Widget per ×-Button schließen -> sofort ausgeblendet.
  env.clickControl("close");
  env.tick();
  assert.strictEqual(env.getOverlay(), null, "Idle-Widget verschwindet nach Klick auf Schließen");

  // 7) Neuer Anruf + Ende startet einen frischen Idle-Abschnitt -> Widget erscheint wieder.
  env.setPageText([
    "AB",
    "Anna Beispiel",
    "Beispiel",
    "+49 (176) 34573586",
    "Eingehender Anruf",
    "Gruppe: TNG GFIZ Bestellhotline",
    "Wartezeit: 0:12",
    "Kundennummer: 12345"
  ].join("\n"));
  env.tick();
  env.setPageText("Willkommen");
  env.tick();
  assert.ok(env.getOverlay(), "Idle-Widget erscheint nach einem frischen Idle-Abschnitt wieder, auch nach vorherigem Dismiss");

  // --- Outbound ------------------------------------------------------------
  // timio wählt aus seiner eigenen Anrufliste selbst; ein solcher Anruf ist
  // ohne Klingel-Phase sofort verbunden. Das ist ein Indiz für "ausgehend" –
  // umgeschaltet wird aber nur über den Modus-Schalter.

  // 8) Direkt verbunden ohne Klingeln -> likelyOutbound wird gemeldet.
  const KEYS = env.sandbox.SupportCopilot.CONFIG.storageKeys;
  env.setPageText([
    "CD",
    "Carl Demo",
    "Demo",
    "+49 (170) 1234567",
    "Gruppe: TNG GFIZ Ausbaustatus",
    "Wartezeit: 0:00",
    "Kundennummer: 287246"
  ].join("\n"));
  env.tick();
  assert.strictEqual(env.storage[KEYS.activeCall].status, "connected", "ohne Klingeln wird direkt verbunden erkannt");
  assert.strictEqual(env.storage[KEYS.activeCall].likelyOutbound, true, "ein Anruf ohne Klingel-Phase wirkt ausgehend");

  // 9) Ein normaler eingehender Anruf darf das Indiz NICHT setzen.
  env.setPageText("Willkommen");
  env.tick();
  env.setPageText([
    "AB",
    "Anna Beispiel",
    "Beispiel",
    "+49 (176) 34573586",
    "Eingehender Anruf",
    "Gruppe: TNG GFIZ Bestellhotline",
    "Wartezeit: 0:12",
    "Kundennummer: 12345"
  ].join("\n"));
  env.tick();
  assert.strictEqual(env.storage[KEYS.activeCall].likelyOutbound, false, "ein geklingelter Anruf wirkt nicht ausgehend");
  // Auch nach dem Annehmen bleibt die Klingel-Herkunft erhalten.
  env.setPageText([
    "AB",
    "Anna Beispiel",
    "Beispiel",
    "+49 (176) 34573586",
    "Gruppe: TNG GFIZ Bestellhotline",
    "Wartezeit: 0:12",
    "Kundennummer: 12345"
  ].join("\n"));
  env.tick();
  assert.strictEqual(env.storage[KEYS.activeCall].likelyOutbound, false, "nach dem Annehmen bleibt der Anruf eingehend");

  // 10) Der Modus-Schalter im Overlay schreibt die Richtung in den Storage,
  //     damit das Jira-Panel sofort nachzieht.
  env.clickControl("mode-outbound");
  assert.strictEqual(env.storage[KEYS.callMode], "outbound", "der Schalter veröffentlicht die Arbeitsrichtung");
  assert.ok(env.getOverlay().innerHTML.includes("Im Gespräch"), "die Anrufkarte bleibt sichtbar");

  env.clickControl("mode-inbound");
  assert.strictEqual(env.storage[KEYS.callMode], "inbound", "zurückschalten funktioniert ebenso");

  // 11) Gesprächsergebnis: in timio geklickt, in Jira verarbeitet. Das
  //     Content-Script legt es nur als Staffelstab in den Storage.
  //     "not-reached" existiert nur im Outbound-Wortschatz (Stufe 3) — für
  //     dieses Szenario zurück auf outbound schalten.
  env.clickControl("mode-outbound");
  env.setPageText([
    "AB",
    "Anna Beispiel",
    "+49 (176) 34573586",
    "Beendet",
    "Dauer: 2:13",
    "Gruppe: TNG GFIZ Bestellhotline",
    "Kundennummer: 12345"
  ].join("\n"));
  env.tick();
  env.clickControl("outcome", { outcome: "not-reached" });
  const outcome = env.storage[KEYS.callOutcome];
  assert.ok(outcome, "das Ergebnis wird für die Jira-Seite hinterlegt");
  assert.strictEqual(outcome.outcomeId, "not-reached", "die geklickte Ergebnis-ID kommt an");
  assert.strictEqual(outcome.customerNumber, "12345", "die Kundennummer des Gesprächs wird mitgegeben");

  // Unbekannte IDs dürfen nichts auslösen (Schutz vor kaputtem Markup).
  env.storage[KEYS.callOutcome] = null;
  env.clickControl("outcome", { outcome: "gibt-es-nicht" });
  assert.strictEqual(env.storage[KEYS.callOutcome], null, "eine unbekannte Ergebnis-ID wird ignoriert");

  console.log("timio-content.test.js: alle Szenarien bestanden.");
}

// Anruf-Schreibpfad (Stufe 2, KONZEPT-INTEGRATION.md): eigener, async
// Durchlauf mit injiziertem supabaseClient-Stub statt des echten Moduls, um
// startCall()/endCall() ohne echtes Netzwerk zu beobachten. Bewusst eine
// eigene Funktion statt Teil von run() oben, weil dafür await nötig ist
// (die Extension schreibt fire-and-forget, ohne auf die Antwort zu warten).
async function runCallsWritePath() {
  const env = makeSandbox();
  loadScripts(env.sandbox, ["src/config.js", "src/shared.js"]);

  const startCalls = [];
  const endCalls = [];
  env.sandbox.SupportCopilot.supabaseClient = {
    customerCard: async () => ({ ok: false, reason: "not-configured" }),
    startCall: async (payload) => {
      startCalls.push(payload);
      return { ok: true, id: `db-${startCalls.length}` };
    },
    endCall: async (id, patch) => {
      endCalls.push({ id, ...patch });
      return { ok: true };
    }
  };

  loadScripts(env.sandbox, ["src/timio-content.js"]);
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  // 1) Eingehender Anruf klingelt -> genau ein startCall(), Richtung inbound.
  env.setPageText([
    "AB", "Anna Beispiel", "Beispiel", "+49 (176) 34573586",
    "Eingehender Anruf",
    "Gruppe: TNG GFIZ Bestellhotline",
    "Wartezeit: 0:12",
    "Kundennummer: 12345"
  ].join("\n"));
  env.tick();
  await flush();
  assert.strictEqual(startCalls.length, 1, "ein Anruf löst genau einen startCall() aus");
  assert.strictEqual(startCalls[0].direction, "inbound");
  assert.strictEqual(startCalls[0].customerNumber, "12345");

  // Erneutes tick() beim selben Anruf löst KEINEN zweiten startCall() aus (Dedup).
  env.tick();
  await flush();
  assert.strictEqual(startCalls.length, 1, "derselbe Anruf löst startCall() nur einmal aus");

  // 2) Anruf verbindet, dann endet mit fester Dauer -> genau ein endCall()
  //    mit korrekt aus "mm:ss" geparster Sekundenzahl.
  env.setPageText([
    "AB", "Anna Beispiel", "Beispiel", "+49 (176) 34573586",
    "Beendet",
    "Dauer: 3:12",
    "Gruppe: TNG GFIZ Bestellhotline",
    "Kundennummer: 12345"
  ].join("\n"));
  env.tick();
  await flush();
  assert.strictEqual(endCalls.length, 1, "Anrufende mit \"Beendet\"-Screen löst genau einen endCall() aus");
  assert.strictEqual(endCalls[0].id, "db-1");
  assert.strictEqual(endCalls[0].durationS, 192, "\"3:12\" wird korrekt in Sekunden umgerechnet");

  // 3) Zurück zu idle -> KEIN zusätzlicher endCall() (Anruf war schon sauber beendet).
  env.setPageText("Willkommen");
  env.tick();
  await flush();
  assert.strictEqual(endCalls.length, 1, "ein bereits sauber beendeter Anruf wird beim Idle-Reset nicht nochmal abgeschlossen");

  // 4) Neuer Anruf klingelt und wird abgebrochen, bevor er angenommen wird
  //    (kein "Beendet"-Screen) -> der Idle-Reset schließt ihn best-effort ab,
  //    statt die Zeile für immer "aktiv" zu lassen.
  env.setPageText([
    "CD", "Chris Demo", "Demo", "+49 (176) 99999999",
    "Eingehender Anruf",
    "Gruppe: TNG GFIZ Bestellhotline",
    "Wartezeit: 0:03",
    "Kundennummer: 54321"
  ].join("\n"));
  env.tick();
  await flush();
  assert.strictEqual(startCalls.length, 2, "der zweite Anruf löst einen eigenen startCall() aus");

  env.setPageText("Willkommen");
  env.tick();
  await flush();
  assert.strictEqual(endCalls.length, 2, "ein abgebrochener Anruf ohne Beendet-Screen wird beim Idle-Reset best-effort abgeschlossen");
  assert.strictEqual(endCalls[1].id, "db-2");
  assert.strictEqual(endCalls[1].durationS, null, "ohne jemals verbunden gewesen zu sein ist keine Dauer bekannt");

  console.log("timio-content.test.js (Anruf-Schreibpfad): alle Szenarien bestanden.");
}

// Abschluss-Panel (Stufe 3, KONZEPT-INTEGRATION.md) — eigener, async
// Durchlauf mit injiziertem supabaseClient-Stub, gleiche Technik wie
// runCallsWritePath() oben.
async function runCloseoutWritePath() {
  const env = makeSandbox();
  loadScripts(env.sandbox, ["src/config.js", "src/shared.js"]);

  const inserted = { notiz: [], lead: [], vertrag: [], tarifwechsel: [] };
  const sharedSettingsFixture = {
    products: [
      { name: "Fibrelight", category: "Privat", commission: 7.5 },
      { name: "Basic 1000", category: "Business", commission: 40 }
    ],
    tariffCommission: {
      sidegrade: { mvlz_gt3: 0, mvlz_lt3: 5, outside_mvlz: 5 },
      upgrade: { mvlz_gt3: 5, mvlz_lt3: 7.5, outside_mvlz: 7.5 }
    }
  };
  env.sandbox.SupportCopilot.supabaseClient = {
    customerCard: async () => ({ ok: false, reason: "not-configured" }),
    startCall: async () => ({ ok: true, id: "call-1" }),
    endCall: async () => ({ ok: true }),
    fetchSharedSettings: async () => ({ ok: true, data: sharedSettingsFixture }),
    insertNote: async (fields) => { inserted.notiz.push(fields); return { ok: true, id: "note-1" }; },
    insertLead: async (fields) => { inserted.lead.push(fields); return { ok: true, id: "lead-1" }; },
    insertContract: async (fields) => { inserted.vertrag.push(fields); return { ok: true, id: "contract-1" }; },
    insertTariffChange: async (fields) => { inserted.tarifwechsel.push(fields); return { ok: true, id: "tariff-1" }; }
  };

  loadScripts(env.sandbox, ["src/timio-content.js"]);
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  // 1) Outbound "Mailbox" (kein echter Gesprächsinhalt) -> kein Abschluss-Panel.
  env.setPageText([
    "AB", "Anna Beispiel", "+49 (176) 34573586",
    "Eingehender Anruf",
    "Gruppe: TNG GFIZ Bestellhotline",
    "Kundennummer: 12345"
  ].join("\n"));
  env.tick();
  env.clickControl("mode-outbound");
  env.setPageText([
    "AB", "Anna Beispiel", "+49 (176) 34573586",
    "Beendet",
    "Dauer: 1:00",
    "Gruppe: TNG GFIZ Bestellhotline",
    "Kundennummer: 12345"
  ].join("\n"));
  env.tick();
  env.clickControl("outcome", { outcome: "mailbox" });
  assert.ok(!env.getOverlay().innerHTML.includes("tc-closeout"), "Mailbox hat keinen Gesprächsinhalt und öffnet kein Abschluss-Panel");

  // 2) Outbound "Erreicht & geklärt" -> Panel öffnet mit Notiz vorausgewählt.
  env.clickControl("outcome", { outcome: "reached-done" });
  assert.ok(env.getOverlay().innerHTML.includes("tc-closeout"), "\"Erreicht & geklärt\" öffnet das Abschluss-Panel");
  assert.ok(env.getOverlay().innerHTML.includes('data-role="closeout-title"'), "Notiz ist der Standard-Eintragstyp");

  // 3) Inbound-Anruf ohne jeden Klick -> Panel öffnet automatisch.
  env.clickControl("mode-inbound");
  env.setPageText([
    "CD", "Chris Demo", "+49 (176) 99999999",
    "Eingehender Anruf",
    "Gruppe: TNG GFIZ Bestellhotline",
    "Kundennummer: 54321"
  ].join("\n"));
  env.tick();
  env.setPageText([
    "CD", "Chris Demo", "+49 (176) 99999999",
    "Beendet",
    "Dauer: 0:45",
    "Gruppe: TNG GFIZ Bestellhotline",
    "Kundennummer: 54321"
  ].join("\n"));
  env.tick();
  assert.ok(env.getOverlay().innerHTML.includes("tc-closeout"), "Inbound öffnet das Panel ohne Klick auf einen Outcome-Button");

  // Dedup: ein Typwechsel bleibt über weitere ticks() hinweg erhalten, statt
  // beim nächsten Tick auf den Default zurückgesetzt zu werden.
  env.clickControl("closeout-type", { value: "lead" });
  env.tick();
  env.tick();
  assert.ok(env.getOverlay().innerHTML.includes('data-role="closeout-topic"'), "Typwechsel auf Lead übersteht weitere ticks() (kein erneutes Öffnen)");

  // 4) Typ auf Vertrag wechseln, Produkt togglen, absenden -> insertContract
  //    genau einmal mit den erwarteten Feldern.
  env.clickControl("closeout-type", { value: "vertrag" });
  await flush();
  env.clickControl("closeout-toggle-product", { product: "Fibrelight" });
  assert.ok(env.getOverlay().innerHTML.includes("7.50"), "Provisions-Vorschau zeigt die Summe der gewählten Produkte");
  env.clickControl("closeout-submit");
  await flush();
  assert.strictEqual(inserted.vertrag.length, 1, "genau ein insertContract()-Aufruf");
  assert.strictEqual(inserted.vertrag[0].customerNumber, "54321");
  assert.deepStrictEqual(Array.from(inserted.vertrag[0].products), ["Fibrelight"]);
  assert.strictEqual(inserted.vertrag[0].contractStatus, "aktiv", "Default-Status");

  console.log("timio-content.test.js (Abschluss-Panel): alle Szenarien bestanden.");
}

run();
runCallsWritePath();
runCloseoutWritePath();
