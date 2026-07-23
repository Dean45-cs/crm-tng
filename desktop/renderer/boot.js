"use strict";

// Startet das Fenster: Panel aufbauen, Titelleiste verdrahten, auf Meldungen
// aus Chrome reagieren. Alles Fachliche steckt weiterhin in ui.js – hier steht
// nur, was ein eigenes Fenster zusätzlich braucht.

(function boot() {
  const app = window.StadtnetzCRM;

  const dot = document.querySelector("[data-role='hud-dot']");
  const contextLabel = document.querySelector("[data-role='hud-context']");
  const offline = document.querySelector("[data-role='hud-offline']");
  const pinButton = document.querySelector("[data-hud='pin']");
  const notesButton = document.querySelector("[data-hud='notes']");

  let connected = false;

  // --- Verbindungsanzeige --------------------------------------------------

  // Wie weit das Panel von oben wegrücken muss. Der Offline-Hinweis bricht je
  // nach Fensterbreite auf zwei oder drei Zeilen um – eine feste Zahl im CSS
  // würde ihn mal überdecken und mal eine Lücke lassen.
  function updateOffset() {
    const titlebar = document.querySelector(".hud-titlebar").offsetHeight;
    const banner = offline.hidden ? 0 : offline.offsetHeight;
    document.body.style.setProperty("--hud-offset", `${titlebar + banner}px`);
  }

  function setConnected(value) {
    connected = Boolean(value);
    dot.classList.toggle("is-connected", connected);
    dot.classList.toggle("is-offline", !connected);
    dot.title = connected ? "Mit Chrome verbunden" : "Chrome ist nicht verbunden";
    offline.hidden = connected;
    updateOffset();
  }

  window.addEventListener("resize", updateOffset);

  function setContext(ticket) {
    const key = ticket && ticket.key && ticket.key !== app.jiraReader.UNKNOWN ? ticket.key : "";
    contextLabel.textContent = key || (connected ? "kein Vorgang offen" : "");
    contextLabel.title = ticket && ticket.summary && ticket.summary !== app.jiraReader.UNKNOWN ? ticket.summary : "";
  }

  // --- Titelleiste ---------------------------------------------------------

  function setPinned(pinned) {
    pinButton.classList.toggle("is-active", Boolean(pinned));
    pinButton.title = pinned ? "Immer im Vordergrund (an)" : "Immer im Vordergrund (aus)";
  }

  document.querySelector(".hud-actions").addEventListener("click", (event) => {
    const button = event.target.closest("[data-hud]");
    if (!button) return;
    switch (button.dataset.hud) {
      case "notes":
        app.hudNotes.toggle();
        notesButton.classList.toggle("is-active", app.hudNotes.isOpen());
        return;
      case "pin": {
        const next = !pinButton.classList.contains("is-active");
        setPinned(next);
        window.hud.command("always-on-top", { enabled: next });
        return;
      }
      case "minimize":
        window.hud.command("minimize", {});
        return;
      case "hide":
        window.hud.command("hide", {});
        return;
      default:
    }
  });

  // Notizen sind das, wofür man das Fenster mitten im Gespräch anspringt –
  // deshalb eine eigene Tastenkombination.
  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
      event.preventDefault();
      app.hudNotes.toggle();
      notesButton.classList.toggle("is-active", app.hudNotes.isOpen());
      return;
    }
    if (event.key === "Escape" && app.hudNotes.isOpen()) {
      app.hudNotes.toggle(false);
      notesButton.classList.remove("is-active");
    }
  });

  // --- Meldungen aus Chrome ------------------------------------------------

  window.hud.onStatus((status) => {
    setConnected(status && status.connected);
    setContext(app.jiraReader.read());
  });

  window.hud.onTicket((ticket) => {
    // setTicket meldet nur echte Wechsel – nur dann muss das Panel neu lesen.
    if (!app.jiraReader.setTicket(ticket)) return;
    setContext(app.jiraReader.read());
    app.ui.refresh();
    if (app.hudNotes.isOpen()) app.hudNotes.refreshContext();
  });

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
    setConnected(initial.connected);
    setPinned(initial.alwaysOnTop);
    app.jiraReader.setTicket(initial.ticket);

    app.hudNotes.init({ notes: initial.notes, draft: initial.notesDraft });

    // mount() liest den gespiegelten Storage, baut das Panel und startet die
    // Fähigkeitsprüfung der KI – exakt wie im Jira-Tab.
    await app.ui.mount();
    setContext(app.jiraReader.read());
  });
})();
