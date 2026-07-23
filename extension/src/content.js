(function startStadtnetzCRM() {
  "use strict";

  const app = window.StadtnetzCRM;
  const { CONFIG } = app;
  let lastUrl = "";

  function isIssueView() {
    return /\/browse\/[A-Z][A-Z0-9_]+-\d+/i.test(window.location.pathname) || Boolean(document.querySelector("#summary-val, #key-val"));
  }

  function removePanel() {
    const root = document.getElementById(CONFIG.rootId);
    if (root) root.remove();
  }

  function syncWithJiraView() {
    // Läuft die Desktop-App, gehört das Cockpit dorthin (siehe hud-agent.js).
    // Das Panel wird dann nicht nur ausgeblendet, sondern gar nicht erst
    // aufgebaut – sonst liefen beide Fassungen parallel und würden dieselben
    // KI-Aufgaben doppelt starten.
    if (!isIssueView() || app.hudTakeover) {
      removePanel();
      return;
    }

    app.ui.mount();
    // Zwei Nachlese-Durchläufe: Jira baut Details/Kommentare teils verzögert
    // auf – der zweite Durchlauf fängt langsam ladende Felder ein.
    window.setTimeout(() => app.ui.refresh(), 900);
    window.setTimeout(() => app.ui.refresh(), 2600);
  }

  function observeNavigation() {
    lastUrl = window.location.href;
    window.setInterval(() => {
      if (window.location.href === lastUrl) return;
      lastUrl = window.location.href;
      syncWithJiraView();
    }, 800);
  }

  // hud-agent.js meldet über diesen Weg, dass die App gestartet oder beendet
  // wurde – das Panel verschwindet bzw. kommt zurück, ohne die Seite neu zu laden.
  app.content = { sync: syncWithJiraView };

  syncWithJiraView();
  observeNavigation();
})();
