"use strict";

// Startet das Overlay: Panel aufbauen und auf Meldungen aus Chrome reagieren.
// Alles Fachliche steckt weiterhin in ui.js, alles Overlay-Eigene in
// hud-host.js – hier steht nur das Zusammenspiel.

(function boot() {
  const app = window.StadtnetzCRM;
  const host = app.hudHost;

  // --- Startbild -----------------------------------------------------------

  // Ein Fenster ohne Titelleiste, das noch nichts anzeigt, ist von einem
  // abgestürzten nicht zu unterscheiden. Das Startbild (index.html) hält die
  // Fläche, bis das Panel steht – und übernimmt zwei Aufgaben mit:
  //   1. Es sagt, worauf gerade gewartet wird (Chrome-Abgleich, Panelaufbau).
  //   2. Es nennt die Tastenkombination, mit der man die Auskunft zurückholt.
  //      Das ist die einzige Stelle, die jede Sitzung einmal zu sehen bekommt.
  const bootScreen = (function initBootScreen() {
    const root = document.querySelector("[data-role='hud-boot']");
    const stepText = document.querySelector("[data-role='hud-boot-step']");
    const shortcut = document.querySelector("[data-role='hud-boot-shortcut']");
    const version = document.querySelector("[data-role='hud-boot-version']");
    const retry = document.querySelector("[data-role='hud-boot-retry']");

    // Ohne Startbild (Test-Umgebung) tun alle Aufrufe nichts – der Start selbst
    // darf davon nicht abhängen.
    if (!root) {
      const noop = () => {};
      return { step: noop, setVersion: noop, setShortcut: noop, fail: noop, done: noop };
    }

    const started = Date.now();
    // Kürzer als das hier taugt ein Startbild nicht: ein Aufblitzen für zwei
    // Bilder ist unruhiger als gar keines.
    const MIN_VISIBLE_MS = 420;
    // So lange darf es still sein. Gemessen wird die Stille zwischen zwei
    // Schritten, nicht die Gesamtdauer: ein langsamer, aber vorankommender Start
    // ist kein Fehler – einer, bei dem nichts mehr passiert, schon.
    const SILENCE_MS = 9000;
    // Steht fest, wie es ausgegangen ist ("ok" oder "fehler"), fasst nichts mehr
    // am Startbild an.
    let outcome = null;
    let watchdog = null;

    if (retry) retry.addEventListener("click", () => window.location.reload());

    function armWatchdog() {
      window.clearTimeout(watchdog);
      watchdog = window.setTimeout(() => {
        if (outcome) return;
        // Kein endgültiges Scheitern: der Start läuft weiter. Deshalb nur die
        // Anzeige umstellen – meldet sich der nächste Schritt doch noch, nimmt
        // step() das wieder zurück.
        showStuck();
      }, SILENCE_MS);
    }

    function showStuck() {
      root.classList.add("is-error");
      stepText.textContent = "Der Start dauert ungewöhnlich lange.";
      if (retry) retry.hidden = false;
    }

    function step(text) {
      if (outcome) return;
      // Es geht weiter: eine stehen gebliebene Hänger-Meldung wäre jetzt falsch.
      root.classList.remove("is-error");
      if (retry) retry.hidden = true;
      stepText.textContent = text;
      armWatchdog();
    }

    function setVersion(value) {
      version.textContent = value ? `Version ${value}` : "";
    }

    function setShortcut(label) {
      if (label) shortcut.textContent = label;
    }

    function fail(message) {
      outcome = "fehler";
      window.clearTimeout(watchdog);
      root.classList.add("is-error");
      stepText.textContent = message;
      if (retry) retry.hidden = false;
    }

    function done() {
      if (outcome) return;
      outcome = "ok";
      window.clearTimeout(watchdog);
      const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - started));
      window.setTimeout(() => {
        root.classList.add("is-done");
        // Nach dem Ausblenden wirklich weg: sonst bliebe eine unsichtbare
        // Ebene über dem Panel liegen und schluckte das Ziehen am Kopf.
        window.setTimeout(() => root.remove(), 320);
      }, wait);
    }

    armWatchdog();

    // Im HTML steht die Mac-Schreibweise, damit im ersten Bild etwas Richtiges
    // steht. Sofort ersetzt durch die Voreinstellung aus der gemeinsamen
    // Kürzel-Liste (die kennt auch die Windows-Schreibweise); die verbindliche
    // Angabe – womöglich ein eigenes Kürzel – kommt gleich darauf aus dem
    // Hauptprozess (siehe start()).
    setShortcut(host.shortcutLabel(app.shared.hotkeyDefault("toggleOverlay")));

    return { step, setVersion, setShortcut, fail, done };
  })();

  // Ohne die Brücke aus dem Hauptprozess (preload/preload.js) läuft hier keine
  // einzige Zeile durch. Das gehört gesagt, statt schon beim Verdrahten still
  // zu zerschellen und ein leeres Startbild stehen zu lassen.
  if (!window.hud) {
    bootScreen.fail("Das Fenster wurde nicht vollständig geladen.");
    return;
  }

  // --- Verbindungsanzeige --------------------------------------------------

  function setConnected(value) {
    const wasReconnected = Boolean(value) && !host.isConnected();
    host.setConnected(value);
    // Nach einer Trennung (Chrome/Extension neu geladen o.ä.) merkt sich ui.js
    // den offline-Status der KI-Fähigkeiten dauerhaft, bis neu geprüft wird –
    // sonst blieben alle KI-Buttons grau, obwohl die Verbindung längst wieder
    // steht. Bei jeder Rückkehr also einmal neu prüfen.
    if (wasReconnected && app.ui.loadCapabilities) app.ui.loadCapabilities();
  }

  // --- Notizen -------------------------------------------------------------

  function toggleNotes(force) {
    app.hudNotes.toggle(force);
    app.ui.rerender();
  }

  // Notizen sind das, wofür man das Overlay mitten im Gespräch anspringt –
  // deshalb eine eigene Tastenkombination. Welche, steht in den Einstellungen
  // (CONFIG.hotkeys, id "notes"); ui.js hält den geänderten Stand.
  window.addEventListener("keydown", (event) => {
    // Während in den Einstellungen ein Kürzel aufgenommen wird, gehört der
    // Tastendruck dorthin – sonst klappte beim Belegen der Notizblock auf.
    if (app.ui.isCapturingHotkey && app.ui.isCapturingHotkey()) return;
    if (app.shared.hotkeyMatches(event, app.ui.hotkey("notes"))) {
      event.preventDefault();
      toggleNotes();
      return;
    }
    if (event.key === "Escape" && app.hudNotes.isOpen()) toggleNotes(false);
  });

  // --- Größe ändern ---------------------------------------------------------

  // Ohne Systemrahmen gibt es keine Fensterkanten zum Anfassen (und bei einem
  // transparenten Fenster trifft man sie unter macOS ohnehin kaum). Der
  // Anfasser unten rechts schickt stattdessen die Mausbewegung ans Fenster.
  (function bindResizeGrip() {
    const grip = document.querySelector("[data-role='hud-resize']");
    if (!grip) return;
    let last = null;

    grip.addEventListener("pointerdown", (event) => {
      last = { x: event.screenX, y: event.screenY };
      grip.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    grip.addEventListener("pointermove", (event) => {
      if (!last) return;
      const dx = event.screenX - last.x;
      const dy = event.screenY - last.y;
      if (!dx && !dy) return;
      last = { x: event.screenX, y: event.screenY };
      window.hud.command("resize-by", { dx, dy });
    });

    const stop = (event) => {
      if (!last) return;
      last = null;
      try { grip.releasePointerCapture(event.pointerId); } catch (error) { /* schon weg */ }
    };
    grip.addEventListener("pointerup", stop);
    grip.addEventListener("pointercancel", stop);
  })();

  // --- Meldungen aus Chrome / aus dem Fenster -------------------------------

  window.hud.onStatus((status) => setConnected(status && status.connected));

  window.hud.onTicket((ticket) => {
    // setTicket meldet nur echte Wechsel – nur dann muss das Panel neu lesen.
    if (!app.jiraReader.setTicket(ticket)) return;
    app.ui.refresh();
    if (app.hudNotes.isOpen()) app.hudNotes.refreshContext();
  });

  // Overlay-Schalter können auch außerhalb des Panels umgelegt werden
  // (Tray-Menü, systemweite Tastenkombination).
  window.hud.onOverlay((overlay) => host.setOverlay(overlay));

  // Ein neuer Anruf oder eine frisch nachgeschlagene Kundenakte ändert, wem
  // eine Notiz zugeordnet wird – der Notizbereich muss das mitbekommen.
  const CONTEXT_KEYS = [
    app.CONFIG.storageKeys.customerCard,
    app.CONFIG.storageKeys.activeCall,
    app.CONFIG.storageKeys.ticketContext
  ];
  window.hud.onStorageChanged((changes) => {
    if (!app.hudNotes.isOpen()) return;
    if (!CONTEXT_KEYS.some((key) => Object.prototype.hasOwnProperty.call(changes, key))) return;
    app.hudNotes.refreshContext();
  });

  // --- Start ---------------------------------------------------------------

  async function start() {
    bootScreen.step("Stand aus Chrome wird geholt …");
    const initial = await window.hud.state();

    host.setOverlay(initial.overlay);
    host.setVersion(initial.version);
    host.setConnected(initial.connected);
    app.jiraReader.setTicket(initial.ticket);

    bootScreen.setVersion(initial.version);
    bootScreen.setShortcut(host.shortcutLabel(host.globalHotkey("toggleOverlay")));
    // Ohne Chrome startet die Auskunft trotzdem – das gehört hierhin, sonst
    // liest man es erst im Panel und hält den Start solange für gescheitert.
    bootScreen.step(initial.connected
      ? "Mit Chrome verbunden – Cockpit wird aufgebaut …"
      : "Ohne Chrome – Notizen stehen trotzdem bereit …");

    app.hudNotes.init({ notes: initial.notes, draft: initial.notesDraft });

    // mount() liest den gespiegelten Storage, baut das Panel und startet die
    // Fähigkeitsprüfung der KI – exakt wie im Jira-Tab.
    await app.ui.mount();
    bootScreen.done();
  }

  start().catch((error) => {
    // Fehlgeschlagen heißt hier: das Panel steht nicht. Ohne Meldung bliebe ein
    // leeres Fenster stehen, das niemand deuten kann – die Ursache stünde nur
    // in den DevTools, die im Alltag keiner offen hat.
    console.error("Start des Cockpits fehlgeschlagen:", error);
    bootScreen.fail(`Der Start ist fehlgeschlagen: ${(error && error.message) || error}`);
  });
})();
