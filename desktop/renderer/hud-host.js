"use strict";

// Was das Panel nur auf dem Schreibtisch braucht.
//
// Das Panel selbst (extension/src/ui.js) ist an beiden Orten dasselbe. Damit
// dort keine Fenster-Logik landet, fragt es an ein paar Stellen bei einem
// optionalen Gastgeber nach – das ist diese Datei. In Chrome gibt es sie nicht,
// dort bleiben genau diese Stellen leer.
//
// Der Gastgeber liefert:
//   headerStatus()  – Verbindungspunkt links im Panelkopf
//   headerActions() – zusätzlicher Knopf (Notizen)
//   banner()        – Hinweis, wenn Chrome nicht verbunden ist
//   settings()      – Abschnitt „Overlay" in den Einstellungen
//   handleAction()/handleInput() – deren Bedienung
//
// Bewusst kein Schließen-Knopf und kein Minimieren: das Overlay ist keine
// Anwendung, die man schließt. Ausblenden steht als Zeile in den Einstellungen
// und liegt auf einer systemweiten Tastenkombination.

(function initHudHost() {
  const app = window.StadtnetzCRM;
  const escapeHtml = app.shared.escapeHtml;

  const state = {
    connected: false,
    version: "",
    overlay: {
      alwaysOnTop: true,
      opacity: 1,
      clickThrough: false,
      autoStart: false,
      packaged: true,
      // Systemweite Tastenkürzel je id, plus die, die dieses Gerät nicht
      // hergibt (schon von einem anderen Programm belegt).
      hotkeys: {},
      hotkeyErrors: {}
    }
  };

  // --- Darstellungshilfen ----------------------------------------------------

  // Beschriftung eines Kürzels ("Mod+Shift+Space" → "⌘⇧Leertaste"). Dieselbe
  // Umsetzung wie im Panel – deshalb aus shared.js und nicht noch einmal hier.
  function shortcutLabel(binding) {
    return app.shared.hotkeyLabel(binding || "");
  }

  // Was systemweit gilt – gesetzt wird es im Hauptprozess, hier steht nur der
  // zuletzt gemeldete Stand (siehe setOverlay).
  function globalHotkey(id) {
    return (state.overlay.hotkeys && state.overlay.hotkeys[id]) || "";
  }

  function globalHotkeyError(id) {
    return (state.overlay.hotkeyErrors && state.overlay.hotkeyErrors[id]) || "";
  }

  // Das Panel hat ein neues Kürzel aufgenommen. Registrieren kann es nur der
  // Hauptprozess; die Antwort kommt als frischer Overlay-Zustand zurück (dort
  // steht dann auch, wenn die Taste schon belegt ist).
  function setGlobalHotkey(id, binding) {
    window.hud.command("set-hotkey", { id, binding });
  }

  function opacityPercent() {
    return Math.round((Number(state.overlay.opacity) || 1) * 100);
  }

  // --- Haken, die ui.js aufruft ----------------------------------------------

  function headerStatus() {
    const cls = state.connected ? "is-connected" : "is-offline";
    const title = state.connected ? "Mit Chrome verbunden" : "Chrome ist nicht verbunden";
    return `<span class="hud-dot ${cls}" title="${title}"></span>`;
  }

  function headerActions() {
    const open = app.hudNotes && app.hudNotes.isOpen();
    // Die Taste steht in den Einstellungen und ist änderbar – der Knopf darf
    // deshalb keine feste behaupten.
    const key = shortcutLabel(app.ui.hotkey("notes"));
    return `<button class="sc-icon-button ${open ? "is-active" : ""}" type="button" data-action="hud-notes" title="Notizen${key ? ` (${escapeHtml(key)})` : ""}" aria-label="Notizen">✎</button>`;
  }

  function banner() {
    if (state.connected) return "";
    // Zwei Zeilen, nicht mehr: derselbe Hinweis steht ausführlich noch einmal in
    // der Karte darunter, und ein mehrzeiliger Block belegte im schmalen Overlay
    // ein Drittel der Höhe. Die Feststellung steht ganz da, die Begründung wird
    // nach einer Zeile abgeschnitten (hud.css) – per title bleibt sie trotzdem
    // lesbar, ohne Platz zu kosten.
    const detail = "Ticketdaten und die lokale KI kommen aus der Extension – bitte Chrome mit einem Jira-Tab öffnen. Notizen funktionieren auch so.";
    return `
      <div class="hud-offline">
        <strong>Chrome ist nicht verbunden.</strong>
        <span title="${escapeHtml(detail)}">${escapeHtml(detail)}</span>
      </div>`;
  }

  function settings() {
    const o = state.overlay;
    // Beide Kürzel sind änderbar (Einstellungen → Tastenkürzel) – hier steht
    // deshalb, was gerade gilt, nicht ein fest verdrahteter Text.
    const toggle = shortcutLabel(globalHotkey("toggleOverlay"));
    const clickThrough = shortcutLabel(globalHotkey("clickThrough"));
    return `
      <section class="sc-section">
        <div class="sc-section-title-row">
          <h3>Overlay</h3>
          <span class="sc-local-label">nur dieses Gerät</span>
        </div>
        <p class="sc-section-intro">Die Auskunft liegt über der Arbeitsoberfläche statt in einem eigenen Fenster: kein Eintrag im Dock, keine Titelleiste, kein Kreuz oben rechts. Verschoben wird sie am Kopf des Panels, in der Größe geändert am Anfasser unten rechts.</p>
        <label class="sc-check-label">
          <input type="checkbox" data-role="hud-always-on-top" ${o.alwaysOnTop ? "checked" : ""}>
          <span>Immer im Vordergrund<small>Bleibt über allen Fenstern und auch beim Wechsel in einen Vollbild-Bereich sichtbar. Aus heißt: liegt hinter dem Fenster, in dem gerade gearbeitet wird.</small></span>
        </label>
        <label class="sc-check-label">
          <input type="checkbox" data-role="hud-click-through" ${o.clickThrough ? "checked" : ""}>
          <span>Klicks durchreichen<small>Die Auskunft ist dann nur noch Anzeige, die Maus greift durch auf das Fenster darunter. Zurück geht es ${clickThrough ? `mit <strong>${escapeHtml(clickThrough)}</strong> oder ` : ""}über das Symbol in der Menü-/Infoleiste – im Panel selbst käme kein Klick mehr an.</small></span>
        </label>
        <label class="sc-check-label">
          <input type="checkbox" data-role="hud-auto-start" ${o.autoStart ? "checked" : ""} ${o.packaged ? "" : "disabled"}>
          <span>Beim Anmelden starten<small>${o.packaged
            ? "Ab Werk an, und das aus gutem Grund: ausgeschaltet ist die Auskunft nach dem nächsten Neustart weg – sie hat kein Dock-Symbol, und aus Chrome heraus lässt sich ein nicht laufendes Programm nicht starten. Was hier steht, gilt; die App legt den Schalter nie wieder von selbst um."
            : "Nur in der installierten App: aus dem Quellstand heraus trüge sich Electron selbst als Anmeldeobjekt ein."}</small></span>
        </label>
        <label class="sc-input-label">Deckkraft
          <input type="range" class="hud-range" data-role="hud-opacity" min="35" max="100" step="5" value="${opacityPercent()}" aria-label="Deckkraft">
          <small class="sc-input-hint"><span data-role="hud-opacity-value">${opacityPercent()} %</span> – durchscheinend lässt sich lesen, was darunter liegt.</small>
        </label>
        <div class="sc-inline-actions hud-overlay-actions">
          <button class="sc-secondary-button" type="button" data-action="hud-hide">Ausblenden${toggle ? ` (${escapeHtml(toggle)})` : ""}</button>
          <button class="sc-secondary-button sc-danger-button" type="button" data-action="hud-quit">Beenden</button>
        </div>
        <p class="sc-input-hint">Ausgeblendet läuft die Auskunft weiter und meldet fällige Rückrufe. Zurück holen sie: ${toggle ? `<strong>${escapeHtml(toggle)}</strong>, ` : ""}das Symbol in der Menü-/Infoleiste, ein Klick auf das Symbol der Erweiterung in Chrome oder die Sprechblase „Auskunft“ unten rechts im Jira-Tab. Beendet heißt: bis zum nächsten Start keine Anrufanzeige und keine Erinnerungen.</p>
        ${state.version ? `<p class="sc-input-hint hud-version">Stadtnetz CRM Copilot ${escapeHtml(state.version)}</p>` : ""}
      </section>`;
  }

  function handleAction(action) {
    switch (action) {
      case "hud-notes":
        app.hudNotes.toggle();
        app.ui.rerender();
        return true;
      case "hud-hide":
        window.hud.command("hide", {});
        return true;
      case "hud-quit":
        // Beenden nimmt die Anrufanzeige und die Rückruf-Erinnerungen mit –
        // das ist mehr, als der Knopf vermuten lässt.
        if (window.confirm("Stadtnetz CRM Copilot beenden? Anrufanzeige und Rückruf-Erinnerungen sind dann bis zum nächsten Start aus.")) {
          window.hud.command("quit", {});
        }
        return true;
      default:
        return false;
    }
  }

  function handleInput(role, target) {
    if (role === "hud-always-on-top") {
      state.overlay.alwaysOnTop = target.checked;
      window.hud.command("always-on-top", { enabled: target.checked });
      return true;
    }
    if (role === "hud-click-through") {
      state.overlay.clickThrough = target.checked;
      window.hud.command("click-through", { enabled: target.checked });
      return true;
    }
    if (role === "hud-auto-start") {
      state.overlay.autoStart = target.checked;
      window.hud.command("auto-start", { enabled: target.checked });
      return true;
    }
    if (role === "hud-opacity") {
      state.overlay.opacity = (Number(target.value) || 100) / 100;
      window.hud.command("opacity", { value: state.overlay.opacity });
      syncOpacityLabel();
      return true;
    }
    return false;
  }

  // --- Zustand von außen -----------------------------------------------------

  // Beim Ziehen des Reglers darf nicht neu gezeichnet werden: der Regler unter
  // dem Finger würde durch ein frisches Element ersetzt und das Ziehen bräche
  // ab. Die Deckkraft ändert ohnehin nur das Panel selbst – der zurückgemeldete
  // Wert ist also immer der, den wir gerade geschickt haben, und die Beschriftung
  // reicht.
  function syncOpacityLabel() {
    const label = document.querySelector("[data-role='hud-opacity-value']");
    if (label) label.textContent = `${opacityPercent()} %`;
  }

  function setOverlay(next) {
    if (!next || typeof next !== "object") return;
    const before = state.overlay;
    state.overlay = { ...before, ...next };
    const changedBesidesOpacity = ["alwaysOnTop", "clickThrough", "autoStart", "packaged"]
      .some((key) => before[key] !== state.overlay[key])
      // Kürzel kommen als Objekt – da zählt der Inhalt, nicht die Kennung.
      || JSON.stringify(before.hotkeys) !== JSON.stringify(state.overlay.hotkeys)
      || JSON.stringify(before.hotkeyErrors) !== JSON.stringify(state.overlay.hotkeyErrors);
    if (changedBesidesOpacity) app.ui.rerender();
    else syncOpacityLabel();
  }

  function setConnected(value) {
    const next = Boolean(value);
    if (next === state.connected) return false;
    state.connected = next;
    app.ui.rerender();
    return true;
  }

  function setVersion(value) {
    state.version = typeof value === "string" ? value : "";
  }

  app.hudHost = {
    headerStatus,
    headerActions,
    banner,
    settings,
    handleAction,
    handleInput,
    setOverlay,
    setConnected,
    setVersion,
    isConnected: () => state.connected,
    // Auch das Startbild nennt die Tastenkombination – und zwar in derselben
    // Schreibweise wie die Einstellungen (boot.js).
    shortcutLabel,
    // Systemweite Tastenkürzel: ui.js zeigt sie in den Einstellungen an und
    // reicht Änderungen hierüber an den Hauptprozess weiter.
    globalHotkey,
    globalHotkeyError,
    setGlobalHotkey
  };
})();
