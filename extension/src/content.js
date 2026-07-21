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
    if (!isIssueView()) {
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

  syncWithJiraView();
  observeNavigation();
})();
