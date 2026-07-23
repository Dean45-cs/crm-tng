"use strict";

// Ersatz für extension/src/jira-reader.js im HUD.
//
// Das Original liest den Jira-Vorgang direkt aus dem DOM der Seite – ein
// eigenes Fenster hat dieses DOM nicht. Gelesen wird deshalb weiterhin in
// Chrome (extension/src/hud-agent.js ruft dort denselben jiraReader.read()
// auf) und das Ergebnis kommt über die Bridge herein. Hier liegt nur noch der
// zuletzt gemeldete Stand, denn ui.js erwartet read() synchron.

(function initJiraReaderShim() {
  const app = window.StadtnetzCRM;
  const UNKNOWN = "Nicht sichtbar";

  // Was das HUD zeigt, solange in Chrome kein Vorgang offen ist. Gleiche Form
  // wie ein echter Lesevorgang, damit ui.js keinen Sonderfall braucht.
  function emptyTicket() {
    return {
      key: UNKNOWN,
      summary: UNKNOWN,
      priority: UNKNOWN,
      status: UNKNOWN,
      issueType: UNKNOWN,
      customerReference: UNKNOWN,
      customerName: UNKNOWN,
      assignee: UNKNOWN,
      reporter: UNKNOWN,
      description: UNKNOWN,
      latestInformation: UNKNOWN,
      commentCount: 0,
      comments: []
    };
  }

  let current = emptyTicket();
  const subscribers = new Set();

  function read() {
    return current;
  }

  function setTicket(ticket) {
    const next = ticket && ticket.key ? ticket : emptyTicket();
    // Gleicher Inhalt, kein Ereignis: Chrome meldet den Vorgang bei jedem
    // Nachlese-Durchlauf erneut, das Panel soll deswegen nicht neu bauen.
    if (JSON.stringify(next) === JSON.stringify(current)) return false;
    current = next;
    subscribers.forEach((fn) => {
      try {
        fn(current);
      } catch (error) {
        console.error("[hud] Fehler beim Verarbeiten eines Ticketwechsels", error);
      }
    });
    return true;
  }

  app.jiraReader = {
    read,
    UNKNOWN,
    // Nur fürs HUD: die Bridge schiebt neue Stände herein, boot.js hängt sich
    // dran, um das Panel zu aktualisieren.
    setTicket,
    onChange: (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    hasTicket: () => current.key !== UNKNOWN
  };
})();
