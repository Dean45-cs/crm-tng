"use strict";

// Startet das Overlay: Panel aufbauen und auf Meldungen aus Chrome reagieren.
// Alles Fachliche steckt weiterhin in ui.js, alles Overlay-Eigene in
// hud-host.js – hier steht nur das Zusammenspiel.

(function boot() {
  const app = window.StadtnetzCRM;
  const host = app.hudHost;

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
  // deshalb eine eigene Tastenkombination.
  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
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

  window.hud.state().then(async (initial) => {
    host.setOverlay(initial.overlay);
    host.setVersion(initial.version);
    host.setConnected(initial.connected);
    app.jiraReader.setTicket(initial.ticket);

    app.hudNotes.init({ notes: initial.notes, draft: initial.notesDraft });

    // mount() liest den gespiegelten Storage, baut das Panel und startet die
    // Fähigkeitsprüfung der KI – exakt wie im Jira-Tab.
    await app.ui.mount();
  });
})();
