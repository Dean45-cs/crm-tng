"use strict";

// Anrufe aus myApps (innovaphone) — die Telefonanlage als Quelle.
//
// In Chrome liest extension/src/timio-content.js die Anrufe aus dem DOM des
// timio-Portals. Das geht hier nicht: myApps läuft als eigenständige App, nicht
// als Seite im Browser. Stattdessen meldet myApps selbst — unter
// „Einstellungen · Externe Anwendungen" lässt sich eine Webadresse hinterlegen,
// die bei einem Anruf-Ereignis geöffnet wird, mit Platzhaltern für Nummer,
// Name und Conference-ID. main.js nimmt sie über ein eigenes URL-Schema an und
// reicht sie hierher weiter.
//
// Diese Datei macht daraus GENAU DAS, was timio-content.js auch schreibt: den
// Schlüssel activeCall im gemeinsamen Storage und eine Zeile in `calls`. Damit
// reagiert alles Übrige unverändert — Call-Cockpit, Kundenakte, Ergebnis
// erfassen, die Live-Anrufleiste im CRM. Es gibt bewusst keine zweite
// Anruf-Pipeline neben der bestehenden.
//
// Was myApps liefert und was nicht:
//   ✓ Rufnummer ($I international, $n roh), Displayname ($d), Conference-ID ($c)
//   ✗ die Richtung — alle Platzhalter heißen „des Anrufers". Deshalb wie bei
//     timio: der Inbound/Outbound-Schalter im Panel entscheidet, außer die URL
//     sagt es ausdrücklich (dir=in|out).
//   ✗ das Gesprächsende — solange myApps dafür keine eigene Aktion anbietet,
//     endet ein Anruf hier erst, wenn der nächste beginnt (oder nach der
//     Sicherheitsgrenze unten). Wer in myApps eine zweite Aktion fürs Auflegen
//     einrichten kann, hängt dort ev=end an die URL, dann stimmt auch die Dauer.

(function initMyAppsCalls() {
  const app = window.StadtnetzCRM;
  // Ohne Brücke (Test-Sandbox) oder ohne die neue Fassung des Preloads gibt es
  // hier nichts zu tun – das Panel läuft dann einfach ohne Anlagen-Anbindung.
  if (!app || !window.hud || typeof window.hud.onCall !== "function") return;

  const CONFIG = app.CONFIG;
  const shared = app.shared;
  const supabaseClient = app.supabaseClient;

  // Ein Anruf ohne Ende-Meldung darf nicht ewig als „läuft" dastehen: er würde
  // in der Live-Anrufleiste des CRM hängen bleiben. Dieselbe Grenze, ab der das
  // CRM einen offenen Anruf ohnehin nicht mehr als aktiv zählt.
  const MAX_CALL_MS = 2 * 60 * 60 * 1000;

  // DER PUNKT, an dem diese Anbindung sonst still gescheitert wäre: das Panel
  // hält einen Anruf für verwaist, wenn sein Eintrag älter als
  // CONFIG.call.staleAfterMs (15 s) ist – gedacht gegen einen geschlossenen
  // timio-Tab, der kein „idle" mehr melden konnte. timio schreibt deshalb im
  // Sekundentakt weiter, weil es die Seite ohnehin abfragt.
  //
  // myApps meldet sich dagegen GENAU EINMAL pro Anruf. Ohne eigenen Herzschlag
  // wäre das Cockpit also nach fünfzehn Sekunden mitten im Gespräch wieder weg
  // – und zwar ohne Fehlermeldung, einfach verschwunden. Derselbe Takt wie in
  // timio-content.js, damit sich beide Quellen gleich anfühlen.
  const HEARTBEAT_MS = (CONFIG.call && CONFIG.call.heartbeatMs) || 4000;
  let heartbeat = null;

  function startHeartbeat() {
    stopHeartbeat();
    heartbeat = window.setInterval(() => {
      if (!current) return stopHeartbeat();
      expireIfStale();
      // Nur die Frische auffrischen – Status und Kennungen bleiben, damit das
      // Panel darin keinen neuen Anruf sieht (callId bleibt gleich).
      if (current) publish("connected");
    }, HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    if (heartbeat) window.clearInterval(heartbeat);
    heartbeat = null;
  }

  // Der laufende Anruf, so wie ihn myApps gemeldet hat. null heißt: keiner.
  let current = null;

  // Der Inbound/Outbound-Schalter. Gespiegelt statt bei jedem Anruf gelesen:
  // wenn die Meldung hereinkommt, soll geschrieben werden und nicht gewartet.
  let callMode = "inbound";

  function readCallMode() {
    try {
      chrome.storage.local.get([CONFIG.storageKeys.callMode], (data) => {
        const value = data && data[CONFIG.storageKeys.callMode];
        if (value) callMode = shared.callModeMeta(value).id;
      });
    } catch (error) { /* Storage noch nicht da – dann bleibt die Voreinstellung */ }
  }

  readCallMode();
  try {
    chrome.storage.onChanged.addListener((changes) => {
      if (Object.prototype.hasOwnProperty.call(changes, CONFIG.storageKeys.callMode)) {
        callMode = shared.callModeMeta(changes[CONFIG.storageKeys.callMode].newValue).id;
      }

      // „Aufgelegt" im Panel. Das Ende steht damit schon im Storage – hier
      // bleibt, die Zeile in der Historie zu schließen und den Herzschlag
      // abzustellen. Ohne das schriebe er den Anruf im nächsten Takt wieder auf
      // „läuft", und das Gespräch ließe sich gar nicht beenden.
      if (!Object.prototype.hasOwnProperty.call(changes, CONFIG.storageKeys.activeCall)) return;
      const next = changes[CONFIG.storageKeys.activeCall].newValue;
      if (!current || !next || next.status !== "ended") return;
      if (next.callId && next.callId !== current.callId) return;
      closeRow(typeof next.finalDuration === "number" ? next.finalDuration : durationSeconds());
    });
  } catch (error) { /* s. o. */ }

  function storageSet(payload) {
    try {
      chrome.storage.local.set(payload);
    } catch (error) {
      console.error("[myapps] Anruf konnte nicht im Storage abgelegt werden", error);
    }
  }

  /**
   * Die Richtung. Ausdrückliche Angabe aus der URL gewinnt – nur so lässt sich
   * in myApps je Aktion (ankommend/abgehend) eine eigene Adresse hinterlegen,
   * falls es dort getrennte Aktionen gibt. Sonst gilt der Schalter im Panel.
   */
  function directionOf(msg) {
    const explicit = String((msg && msg.dir) || "").toLowerCase();
    if (explicit === "out" || explicit === "outbound") return "outbound";
    if (explicit === "in" || explicit === "inbound") return "inbound";
    return shared.isOutbound(callMode) ? "outbound" : "inbound";
  }

  /** Der Storage-Schlüssel activeCall in genau der Form, die ui.js erwartet. */
  function payloadFor(status) {
    if (!current) return null;
    const payload = {
      status,
      callerName: current.name,
      callerNumber: current.number,
      // myApps kennt unsere Kundennummer nicht – die Zuordnung passiert im
      // Panel über die Rufnummer, wie bei einem unbekannten Anrufer in timio.
      customerNumber: "",
      group: "",
      updatedAt: Date.now(),
      likelyOutbound: current.direction === "outbound",
      callId: current.callId,
      // Herkunft und Anlagen-Kennung wandern mit: das Panel kann so eine
      // myApps-Meldung von einer timio-Meldung unterscheiden, ohne zu raten.
      source: "myapps",
      externalId: current.externalId
    };
    if (status === "connected") payload.connectedAt = current.startedAt;
    if (status === "ended") payload.finalDuration = durationSeconds();
    if (current.dbCallId) payload.dbCallId = current.dbCallId;
    return payload;
  }

  function durationSeconds() {
    if (!current || !current.startedAt) return null;
    return Math.max(0, Math.round((Date.now() - current.startedAt) / 1000));
  }

  function publish(status) {
    const payload = payloadFor(status);
    if (payload) storageSet({ [CONFIG.storageKeys.activeCall]: payload });
  }

  // --- Anfang und Ende -------------------------------------------------------

  function begin(msg) {
    const startedAt = Date.now();
    current = {
      callId: `myapps-${startedAt}`,
      externalId: msg.id || "",
      // $I (international, +49…) ist das Format, in dem Rufnummern verglichen
      // werden; main.js reicht durch, was in myApps eingetragen ist.
      number: msg.nr || "",
      name: msg.name || "",
      direction: directionOf(msg),
      startedAt,
      dbCallId: null
    };

    publish(msg.ev === "ring" ? "ringing" : "connected");
    startHeartbeat();
    record();
  }

  /** Legt die Zeile in `calls` an – derselbe Aufruf wie aus timio heraus. */
  function record() {
    if (!supabaseClient || !current) return;
    const forCallId = current.callId;

    supabaseClient.startCall({
      callerName: current.name || undefined,
      callerNumber: current.number || undefined,
      direction: current.direction,
      // Die Conference-ID der Anlage. Ohne sie liefe jeder wiederholte Aufruf
      // für dasselbe Gespräch auf eine zweite Zeile hinaus.
      externalId: current.externalId || undefined
    }).then((res) => {
      if (!res || !res.ok || !res.id) return;
      // Inzwischen ein anderer Anruf: die Zeile gehört trotzdem geschlossen,
      // sonst bliebe sie für immer ohne ended_at stehen.
      if (!current || current.callId !== forCallId) {
        supabaseClient.endCall(res.id, { endedAt: new Date().toISOString(), durationS: null }).catch(() => {});
        return;
      }
      current.dbCallId = res.id;
      // Die Zeilen-ID muss ins Panel: nur damit kann das Gesprächsergebnis
      // später auf denselben Datensatz geschrieben werden.
      publish("connected");
    }).catch(() => {});
  }

  function finish() {
    if (!current) return;
    publish("ended");
    closeRow(durationSeconds());
  }

  /**
   * Schließt die Zeile in `calls` und räumt auf. Getrennt von finish(), weil das
   * Ende auf zwei Wegen kommt: entweder von hier (ev=end aus myApps, neuer
   * Anruf, Sicherheitsgrenze) — dann muss der Statuswechsel noch geschrieben
   * werden — oder vom Panel, wenn jemand „Aufgelegt" drückt. Dann steht er
   * schon im Storage, und ein zweites Schreiben wäre nur Lärm.
   */
  function closeRow(durationS) {
    if (!current) return;
    stopHeartbeat();
    const ending = current;
    current = null;

    if (supabaseClient && ending.dbCallId) {
      supabaseClient.endCall(ending.dbCallId, {
        endedAt: new Date().toISOString(),
        durationS: typeof durationS === "number" ? durationS : null
      }).catch(() => {});
    }
  }

  /** Zu lange offen – siehe MAX_CALL_MS. */
  function expireIfStale() {
    if (!current || !current.startedAt) return;
    if (Date.now() - current.startedAt < MAX_CALL_MS) return;
    finish();
  }

  // --- Die Meldung aus myApps ------------------------------------------------

  window.hud.onCall((msg) => {
    if (!msg) return;
    expireIfStale();

    if (msg.ev === "end") {
      finish();
      return;
    }

    // Derselbe Anruf noch einmal (myApps meldet je nach Aktion mehrfach): nur
    // auffrischen, was inzwischen dazugekommen ist – auf keinen Fall eine
    // zweite Zeile anlegen.
    if (current && msg.id && current.externalId && current.externalId === msg.id) {
      if (msg.nr) current.number = msg.nr;
      if (msg.name) current.name = msg.name;
      publish("connected");
      return;
    }

    // Ein neuer Anruf beendet den vorherigen. Ohne Ende-Meldung von myApps ist
    // das der einzige verlässliche Zeitpunkt, an dem feststeht, dass das
    // vorige Gespräch vorbei ist.
    if (current) finish();
    begin(msg);
  });
})();
