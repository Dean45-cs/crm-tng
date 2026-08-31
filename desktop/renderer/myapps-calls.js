"use strict";

// Anrufe aus myApps (innovaphone) — die Telefonanlage als Quelle.
//
// In Chrome liest extension/src/timio-content.js die Anrufe aus dem DOM des
// timio-Portals. Das geht hier nicht: myApps läuft als eigenständige App, nicht
// als Seite im Browser. Stattdessen meldet myApps selbst — unter
// „Einstellungen · Externe Anwendungen" lässt sich eine Webadresse hinterlegen,
// die bei einem Anruf geöffnet wird, mit Platzhaltern für Nummer, Name und
// Conference-ID. main.js nimmt sie über ein eigenes URL-Schema an und reicht
// sie hierher weiter.
//
// Daraus wird GENAU DAS, was timio-content.js auch schreibt: der Schlüssel
// activeCall im gemeinsamen Storage und eine Zeile in `calls`. Damit reagiert
// alles Übrige unverändert — Call-Cockpit, Kundenakte, Ergebnis erfassen, die
// Live-Anrufleiste im CRM. Es gibt bewusst keine zweite Anruf-Pipeline neben
// der bestehenden.
//
// Was myApps liefert und was nicht (nachgesehen im innovaphone-Wiki,
// „Integrate External Apps in innovaphone UC clients"):
//   ✓ Rufnummer ($I international, $n roh), Displayname ($d), Conference-ID ($c)
//   ✓ Der Displayname trägt die Kundennummer mit sich, wenn die Anlage den
//     Anrufer kennt: „PK 182962 Daniel Ratcliffe". Das ist der Hauptweg zur
//     Kundenakte — siehe shared.parseCustomerLabel().
//   ✗ die Richtung. Der Dialog kennt vier Felder (Name, URL, Parameter,
//     Autostart) und keine Trennung nach ankommend/abgehend; ausgelöst wird
//     „upon incoming and outgoing call". Sie kommt deshalb aus dem eigenen
//     Wählen oder bleibt bei der Voreinstellung.
//   ✗ das Gesprächsende. Es gibt kein Ereignis dafür — und das ist nicht bloß
//     im Wiki nachgelesen, sondern in innovaphones ausgeliefertem Code:
//     PhoneCallExternalApplication.js startet die externe Anwendung 100 ms nach
//     Aufbau des Gesprächsfensters, und beim Auflegen räumt dieselbe Datei nur
//     ihre Knöpfe weg.
//
//     Erkannt wird es trotzdem, nur eben nicht gemeldet, sondern beobachtet:
//     main/media-watch.js sieht dem Medien-Socket von myApps zu (gemessen:
//     0 UDP im Leerlauf UND beim Klingeln, 6 beim Abgehobenen, 0 nach dem
//     Auflegen). Beendet wird ein Gespräch nur, wenn für genau dieses Gespräch
//     vorher Medien da waren — sonst bleibt es beim alten Weg: „Aufgelegt",
//     der nächste Anruf, die Sicherheitsgrenze in call-session.js.
//
// Diese Datei ist nur die Verdrahtung. Der Verlauf eines Gesprächs — Anfang,
// Auffrischen, Ende, Dauer — steht in call-session.js, weil man ihn dort ohne
// laufendes Fenster prüfen kann.

(function initMyAppsCalls() {
  const app = window.StadtnetzCRM;
  // Ohne Brücke (Test-Sandbox) oder ohne die neue Fassung des Preloads gibt es
  // hier nichts zu tun – das Panel läuft dann einfach ohne Anlagen-Anbindung.
  if (!app || !window.hud || typeof window.hud.onCall !== "function") return;
  if (typeof app.createCallSession !== "function") {
    console.error("[myapps] call-session.js fehlt – die Anlagen-Anbindung bleibt aus");
    return;
  }

  const CONFIG = app.CONFIG;
  const supabaseClient = app.supabaseClient;

  // DER PUNKT, an dem diese Anbindung sonst still gescheitert wäre: das Panel
  // hält einen Anruf für verwaist, wenn sein Eintrag älter als
  // CONFIG.call.staleAfterMs (15 s) ist – gedacht gegen einen geschlossenen
  // timio-Tab, der kein „idle" mehr melden konnte. timio schreibt deshalb im
  // Sekundentakt weiter, weil es die Seite ohnehin abfragt.
  //
  // myApps meldet sich dagegen GENAU EINMAL pro Anruf. Ohne eigenen Herzschlag
  // wäre das Cockpit also nach fünfzehn Sekunden mitten im Gespräch wieder weg
  // – und zwar ohne Fehlermeldung, einfach verschwunden.
  const HEARTBEAT_MS = (CONFIG.call && CONFIG.call.heartbeatMs) || 4000;
  let heartbeat = null;

  // --- Zustand, den die Sitzung von außen braucht ----------------------------

  // Die Arbeitsrichtung kommt aus den Einstellungen der App (⚙ →
  // Telefonanlage), NICHT mehr aus dem Storage-Schlüssel callMode.
  //
  // Der stammt aus der Zeit vor dem Outbound-Umbau, als es im Panel einen
  // Richtungsschalter gab. Den gibt es nicht mehr, geschrieben hat den
  // Schlüssel seitdem niemand — aber ein alter Wert stand weiter darin, und
  // der hat gewonnen: jeder über die Anlage gemeldete Anruf landete als
  // eingehend in der Auswertung. Kein Fehler, keine Meldung, nur eine falsche
  // Zahl. Genau deshalb steht die Richtung jetzt an einer Stelle, die man
  // sehen und ändern kann.

  // Gespiegelt statt bei jedem Anruf gelesen: chrome.storage antwortet
  // asynchron, die Meldung der Anlage muss aber sofort verarbeitet werden.
  let pendingDial = null;

  function storageSet(payload) {
    try {
      chrome.storage.local.set(payload);
    } catch (error) {
      console.error("[myapps] Anruf konnte nicht im Storage abgelegt werden", error);
    }
  }

  function storageRemove(keys) {
    try {
      chrome.storage.local.remove(keys);
    } catch (error) { /* s. o. */ }
  }

  try {
    chrome.storage.local.get([CONFIG.storageKeys.pendingDial], (data) => {
      pendingDial = (data && data[CONFIG.storageKeys.pendingDial]) || null;
    });
  } catch (error) { /* Storage noch nicht da – dann bleibt es beim leeren Merkposten */ }

  function defaultDirection() {
    const host = app.hudHost;
    return host && typeof host.defaultCallDirection === "function" ? host.defaultCallDirection() : "outbound";
  }

  // --- Die Sitzung -----------------------------------------------------------

  const session = app.createCallSession({
    now: () => Date.now(),
    publish: (payload) => storageSet({ [CONFIG.storageKeys.activeCall]: payload }),
    startRow: supabaseClient ? (fields) => supabaseClient.startCall(fields) : null,
    endRow: supabaseClient ? (id, fields) => supabaseClient.endCall(id, fields) : null,
    pendingDial: () => pendingDial,
    clearPendingDial: () => {
      pendingDial = null;
      storageRemove(CONFIG.storageKeys.pendingDial);
    },
    defaultDirection,
    // Für die Einrichtungskarte: ohne Zählung ist „es kommt nichts an" nicht
    // von „es ruft gerade niemand an" zu unterscheiden.
    onEvent: (event) => {
      try {
        window.hud.command("call-seen", event);
      } catch (error) { /* ältere Fassung des Hauptprozesses – dann eben ohne Zählung */ }
    }
  });

  function startHeartbeat() {
    stopHeartbeat();
    heartbeat = window.setInterval(() => {
      if (!session.heartbeat()) stopHeartbeat();
    }, HEARTBEAT_MS);
    watchMedia(true);
  }

  function stopHeartbeat() {
    if (heartbeat) window.clearInterval(heartbeat);
    heartbeat = null;
    watchMedia(false);
  }

  // Gemessen wird nur, solange ein Gespräch läuft — im Leerlauf kostet die
  // Ende-Erkennung damit nichts. Der Hauptprozess fragt dafür das
  // Betriebssystem, deshalb wird ihm ausdrücklich gesagt, wann.
  function watchMedia(on) {
    try {
      window.hud.command("call-media-watch", { on: !!on });
    } catch (error) { /* ältere Fassung des Hauptprozesses – dann eben ohne Erkennung */ }
  }

  // --- Was von außen hereinkommt ---------------------------------------------

  try {
    chrome.storage.onChanged.addListener((changes) => {
      if (Object.prototype.hasOwnProperty.call(changes, CONFIG.storageKeys.pendingDial)) {
        pendingDial = changes[CONFIG.storageKeys.pendingDial].newValue || null;
      }

      if (!Object.prototype.hasOwnProperty.call(changes, CONFIG.storageKeys.activeCall)) return;
      const next = changes[CONFIG.storageKeys.activeCall].newValue;
      if (!next) return;

      // „Aufgelegt" im Panel. Das Ende steht damit schon im Storage – hier
      // bleibt, die Zeile in der Historie zu schließen und den Herzschlag
      // abzustellen. Ohne das schriebe er den Anruf im nächsten Takt wieder auf
      // „läuft", und das Gespräch ließe sich gar nicht beenden.
      if (next.status === "ended") {
        if (session.endedByPanel(next)) stopHeartbeat();
        return;
      }

      // Das Panel hat einen Kunden zugeordnet (Rufnummernsuche oder von Hand).
      // Ohne Übernahme putzte der nächste Herzschlag sie wieder weg.
      if (next.customerNumber) session.assignCustomer(next);
    });
  } catch (error) { /* s. o. */ }

  window.hud.onCall((msg) => {
    const active = session.report(msg);
    if (active) startHeartbeat();
    else stopHeartbeat();
  });

  // Das Gesprächsende, beobachtet am Medien-Socket von myApps
  // (main/media-watch.js). Ein Anruf endet hier nur, wenn für ihn vorher
  // Medien gesehen wurden — die Entscheidung dazu steht in call-session.js,
  // nicht hier. Diese Datei bleibt Verdrahtung.
  if (typeof window.hud.onMedia === "function") {
    window.hud.onMedia((msg) => {
      if (!msg) return;
      // Ein Rückgabewert heißt: das Gespräch ist beendet — nur dann darf der
      // Herzschlag weg. Gäbe mediaState() auch beim ERKENNEN der Medien etwas
      // zurück, hörte das Auffrischen von activeCall genau dann auf, wenn das
      // Gespräch beginnt, und das Panel würfe den Anruf nach staleAfterMs als
      // verwaist weg. Genau das ist einmal passiert; die Regel steht in
      // call-session.js und wird dort geprüft.
      if (session.mediaState(msg.state)) stopHeartbeat();
    });
  }

  // Gesperrter Bildschirm oder Ruhezustand. Anders als der Medien-Socket
  // braucht das keinen Beweis: dort spricht niemand mehr.
  if (typeof window.hud.onCallInterrupt === "function") {
    window.hud.onCallInterrupt((msg) => {
      if (session.interrupted(msg && msg.reason)) stopHeartbeat();
    });
  }
})();
