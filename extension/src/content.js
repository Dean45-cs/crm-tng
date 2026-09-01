(function startStadtnetzCRM() {
  "use strict";

  const app = window.StadtnetzCRM;
  const { CONFIG } = app;
  const HUD_LAUNCHER_ID = "stadtnetzcrm-hud-launcher";
  let lastUrl = "";

  function isIssueView() {
    return /\/browse\/[A-Z][A-Z0-9_]+-\d+/i.test(window.location.pathname) || Boolean(document.querySelector("#summary-val, #key-val"));
  }

  function removePanel() {
    const root = document.getElementById(CONFIG.rootId);
    if (root) root.remove();
  }

  // --- Auskunft hervorholen --------------------------------------------------

  // Solange die Desktop-App läuft, ist die Seite ohne Cockpit – und ein
  // ausgeblendetes Overlay wäre von hier aus nicht mehr erreichbar. Diese
  // Sprechblase tritt deshalb an die Stelle des Panel-Knopfes: ein Klick holt
  // die Auskunft nach vorn (über den Worker, siehe hud-bridge.js). Dieselbe
  // Ecke, dieselbe Form wie der gewohnte Knopf – nur mit anderem Ziel.
  function showHud(button) {
    let answered = false;
    const missed = () => {
      if (answered) return;
      answered = true;
      // Passiert praktisch nur im Moment des Abbruchs: fällt die App weg, meldet
      // hud-agent.js das ohnehin und die Sprechblase weicht wieder dem Panel.
      const label = button.lastChild;
      const before = label.textContent;
      label.textContent = "Nicht erreichbar";
      window.setTimeout(() => { label.textContent = before; }, 2000);
    };
    try {
      chrome.runtime.sendMessage({ type: "sc-hud-show" }, (response) => {
        void chrome.runtime.lastError;
        if (response && response.ok) { answered = true; return; }
        missed();
      });
    } catch (error) {
      missed();
    }
  }

  function buildHudLauncher() {
    const button = document.createElement("button");
    button.id = HUD_LAUNCHER_ID;
    button.type = "button";
    // Das systemweite Kürzel gehört der App; hier ist nur die Voreinstellung
    // bekannt (wurde sie auf dem Gerät geändert, steht der geltende Wert in den
    // Einstellungen der Auskunft).
    const shortcut = app.shared.hotkeyLabel(app.shared.hotkeyDefault("toggleOverlay"));
    button.title = `Die Auskunft läuft als Overlay auf dem Schreibtisch. Klick holt sie nach vorn${shortcut ? ` – ebenso die Tastenkombination ${shortcut}` : ""}.`;
    button.setAttribute("aria-label", "Auskunft einblenden");
    const mark = document.createElement("span");
    mark.textContent = "▣";
    const label = document.createElement("span");
    label.textContent = "Auskunft";
    button.appendChild(mark);
    button.appendChild(label);
    button.addEventListener("click", () => showHud(button));
    return button;
  }

  function syncHudLauncher() {
    const existing = document.getElementById(HUD_LAUNCHER_ID);
    if (!app.hudTakeover) {
      if (existing) existing.remove();
      return;
    }
    // Jira baut beim Wechsel des Vorgangs Teile der Seite neu auf – deshalb bei
    // jedem Durchlauf prüfen, ob die Sprechblase noch da ist.
    if (existing && existing.isConnected) return;
    document.body.appendChild(buildHudLauncher());
  }

  function syncWithJiraView() {
    syncHudLauncher();

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
