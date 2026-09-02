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
    },
    // Stand der Telefonanlage (siehe phoneState() in main/main.js).
    phone: {
      received: 0, lastReceivedAt: 0, calls: 0, recognized: 0, lastCallAt: 0, lastTestAt: 0,
      url: "", protocolRegistered: false, packaged: true, telHandler: "", platform: "",
      direction: "outbound"
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

  // „vor 3 min" statt eines Zeitstempels: die Frage an dieser Stelle lautet
  // nicht „wann", sondern „gerade eben oder noch nie".
  function agoLabel(timestamp) {
    if (!timestamp) return "";
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 60) return "gerade eben";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `vor ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `vor ${hours} h`;
    return `vor ${Math.round(hours / 24)} Tagen`;
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
      </section>
      ${phoneSettings()}`;
  }

  // Die Einrichtungskarte der Telefonanlage.
  //
  // Sie steht hier und nicht im Panel, weil es sie nur auf dem Schreibtisch
  // gibt — in Chrome kommt kein Anruf über ein URL-Schema an.
  //
  // Ihr eigentlicher Zweck ist nicht das Einrichten, sondern das Nachsehen:
  // Wer die Adresse einmal in myApps eingetragen hat, sieht sie nie wieder an.
  // Bleiben die Anrufe eines Tages aus, ist ohne diese Karte nicht zu
  // unterscheiden, ob die Anlage nichts meldet, ob das Schema nicht mehr
  // registriert ist oder ob schlicht niemand anruft.
  function phoneSettings() {
    const p = state.phone;
    const mac = p.platform === "darwin";
    // Unter macOS bekommt FaceTime tel:-Adressen ab Werk. Dann wählt der Knopf
    // ins Leere, und niemand käme von selbst auf die Ursache.
    const telOk = !mac || /myapps/i.test(p.telHandler || "");

    const received = p.received
      ? `${p.received} Meldung${p.received === 1 ? "" : "en"} angenommen, zuletzt ${agoLabel(p.lastReceivedAt)}`
      : "Noch nie etwas empfangen.";
    const calls = p.calls
      ? `Daraus ${p.calls} Gespräch${p.calls === 1 ? "" : "e"}, Kunde erkannt bei ${p.recognized} davon.`
      : "";
    // Der Testanruf steht bewusst in einer eigenen Zeile und nicht in der
    // Zählung: sonst stünde dort, es seien Anrufe angekommen, obwohl die App
    // nur bei sich selbst geklopft hat.
    const test = p.lastTestAt ? `Testanruf ${agoLabel(p.lastTestAt)}.` : "";
    // Zwei Zahlen, die auseinanderklaffen können: kommt etwas an, wird aber
    // kein Gespräch daraus, liegt es nicht an myApps.
    const stuck = p.received > 0 && p.calls === 0
      ? `<p class="sc-input-hint sc-hint-warn">Es kommen Meldungen an, aber im Panel entsteht kein Gespräch. Dann liegt es nicht an myApps.</p>`
      : "";
    const unrecognized = p.calls > 2 && p.recognized === 0
      ? `<p class="sc-input-hint sc-hint-warn">Bei keinem Gespräch war ein Kunde erkennbar. Steht <code>name=$d</code> in der Adresse?</p>`
      : "";

    // Das Gesprächsende. myApps meldet es nicht, deshalb wird es beobachtet
    // (main/media-watch.js) — und deshalb muss hier stehen, ob das auf DIESEM
    // Rechner je funktioniert hat. Die Erkennung schaltet sich bei Unklarheit
    // selbst ab; ohne diese Zeile wäre das von „kaputt" nicht zu unterscheiden.
    const ende = p.autoEnds
      ? `${p.autoEnds}× automatisch erkannt`
      : (p.mediaSeen ? "Gespräch erkannt, Auflegen noch nicht" : "Noch nie erkannt");
    const endeOk = p.autoEnds > 0;
    const probe = p.mediaProbe;
    const probeText = !probe
      ? ""
      : (!probe.ok
        ? `Zuletzt geprüft: ${escapeHtml(probe.error || "myApps nicht gefunden")}.`
        : `Zuletzt geprüft: myApps läuft, ${probe.media} Medien-Verbindung${probe.media === 1 ? "" : "en"} offen${probe.media ? "" : " – richtig, solange kein Gespräch läuft"}.`);
    // Erst warnen, wenn es etwas zu warnen gibt: nach ein paar Gesprächen ohne
    // ein einziges erkanntes Ende.
    // Das Protokoll von myApps ist die maßgebliche Quelle (main/call-trace.js).
    // Ob es wirklich gelesen wird, muss hier stehen: ohne eingeschaltete
    // Protokollierung existiert die Datei zwar, wächst aber nicht — die
    // Erkennung fiele still auf den ungenaueren Weg zurück, und niemand merkte
    // es. Genau solche Ausfälle sind die schlimmen.
    const trace = p.trace || {};
    const traceOk = p.traceEvents > 0;
    const traceText = traceOk
      ? `${p.traceEvents} Ereignisse gelesen — Klingeln, Abheben und Auflegen kommen von der Anlage`
      : (trace.found
        ? "Datei gefunden, aber noch nichts gelesen"
        : "Protokolldatei von myApps nicht gefunden");
    const traceWarn = !traceOk && p.calls > 2
      ? `<p class="sc-input-hint sc-hint-warn">Ohne das Protokoll von myApps ist nicht zu unterscheiden, ob abgehoben wurde — Erreichbarkeit und echte Gesprächsdauer bleiben dann leer, und das Auflegen wird nur geschätzt. ${
        trace.found
          ? "Die Datei ist da, aber die Protokollierung ist offenbar aus: in myApps die Trace-Kennzeichen einschalten (Maske <code>0x856000001</code>, enthält Signaling)."
          : "Läuft myApps auf diesem Rechner?"
      }</p>`
      : "";

    const endeWarn = p.calls > 2 && p.autoEnds === 0 && p.mediaSeen === 0
      ? `<p class="sc-input-hint sc-hint-warn">Das Auflegen wurde noch nie von selbst erkannt – auf diesem Rechner greift die Beobachtung offenbar nicht. Es bleibt beim Knopf „Aufgelegt“; kaputt ist dadurch nichts.</p>`
      : "";

    return `
      <section class="sc-section">
        <div class="sc-section-title-row">
          <h3>Telefonanlage (myApps)</h3>
          <span class="sc-local-label">nur dieses Gerät</span>
        </div>
        <p class="sc-section-intro">myApps meldet jeden Anruf an die Auskunft, indem es eine Adresse öffnet. Einzutragen in myApps unter <strong>Einstellungen · Externe Anwendungen · Anwendung für eine Aktion hinzufügen</strong>. Kein Pfad auf die App – unter macOS kommen Argumente an einem App-Bundle nicht verlässlich an, eine Adresse dagegen schon.</p>

        ${p.url ? `<label class="sc-input-label">Adresse (Feld „URL")
          <input class="sc-text-input" data-role="hud-phone-url" value="${escapeHtml(p.url)}" readonly>
          <small class="sc-input-hint"><code>$c</code> Anruf-Kennung, <code>$I</code> Rufnummer international, <code>$d</code> Displayname. <strong>$d ist der wichtigste Teil:</strong> daran hängt die Kundenerkennung – kennt die Anlage den Anrufer, steht dort „PK 182962 Daniel Ratcliffe“, und die Kundenakte ist ohne Suchen da. Feld „Parameter" leer lassen, „Autostart" nach Belieben.</small>
        </label>` : `<p class="sc-input-hint sc-hint-warn">Die App hat keine Adresse gemeldet – vermutlich eine ältere Fassung. Lieber keine anzeigen als eine falsche, die jemand einträgt.</p>`}
        <div class="sc-inline-actions">
          ${p.url ? `<button class="sc-secondary-button" type="button" data-action="hud-phone-copy">Adresse kopieren</button>` : ""}
          <button class="sc-secondary-button" type="button" data-action="hud-phone-test">Testanruf</button>
        </div>

        <ul class="sc-phone-status">
          <li class="${p.protocolRegistered ? "is-ok" : "is-warn"}">
            <strong>URL-Schema:</strong> ${p.protocolRegistered ? "registriert" : "nicht registriert"}
            ${p.packaged ? "" : "<small>Aus dem Quellstand heraus trägt sich Electron ein, nicht die App – zum Ausprobieren reicht das, verlassen sollte man sich darauf erst im gepackten Paket.</small>"}
          </li>
          <li class="${p.received ? "is-ok" : ""}"><strong>Empfangen:</strong> ${escapeHtml(received)}${calls || test ? ` <small>${escapeHtml([calls, test].filter(Boolean).join(" "))}</small>` : ""}</li>
          <li class="${telOk ? "is-ok" : "is-warn"}">
            <strong>Wählen:</strong> ${p.telHandler ? `tel:-Adressen gehen an „${escapeHtml(p.telHandler)}“` : "kein Programm für tel:-Adressen gefunden"}
            ${telOk ? "" : "<small>Damit der Anrufen-Knopf wirkt, muss myApps sie bekommen: FaceTime öffnen → Menü „FaceTime“ → „Einstellungen…“ → „Standard für Telefonate“ auf myApps. Einmalig, Apple bietet das nirgends sonst an.</small>"}
          </li>
          <li class="${traceOk ? "is-ok" : ""}">
            <strong>Protokoll von myApps:</strong> ${escapeHtml(traceText)}
          </li>
          <li class="${endeOk ? "is-ok" : ""}">
            <strong>Gesprächsende:</strong> ${escapeHtml(ende)}
            ${probeText ? `<small>${probeText}</small>` : ""}
          </li>
        </ul>
        <div class="sc-inline-actions">
          <button class="sc-secondary-button" type="button" data-action="hud-media-probe">Erkennung prüfen</button>
        </div>
        ${stuck}
        ${unrecognized}
        ${endeWarn}
        ${traceWarn}

        <p class="sc-input-hint">Zwei Dinge meldet myApps nicht, und das ist keine Einstellungssache. <strong>Das Gesprächsende:</strong> die Adresse wird beim Anruf geöffnet, beim Auflegen passiert nichts. Erkannt wird es trotzdem – die App sieht nach, ob myApps noch eine Sprachverbindung offen hat. Klappt das auf einem Rechner nicht, bleibt es beim Knopf „Aufgelegt“, und es endet nichts von selbst. <strong>Die Richtung:</strong> dieselbe Adresse wird für ankommende wie abgehende Anrufe geöffnet.</p>

        <label class="sc-input-label">Anrufe gelten als
          <select class="sc-text-input" data-role="hud-phone-direction">
            <option value="outbound" ${p.direction === "inbound" ? "" : "selected"}>ausgehend</option>
            <option value="inbound" ${p.direction === "inbound" ? "selected" : ""}>eingehend</option>
          </select>
          <small class="sc-input-hint">Gilt für Anrufe, deren Richtung sonst nirgends herkommt – also für die meisten. Wer aus der Auskunft heraus wählt, gilt unabhängig davon als ausgehend; das wissen wir sicher, weil wir es ausgelöst haben. Die Angabe landet als <code>direction</code> auf jedem Anruf in der Auswertung.</small>
        </label>
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
      case "hud-phone-copy":
        app.ui.copyText(state.phone.url, "Adresse kopiert – in myApps unter „Externe Anwendungen“ einfügen.");
        return true;
      case "hud-phone-test":
        window.hud.command("call-test", {});
        return true;
      case "hud-media-probe":
        // Eine einzelne Messung. Die Antwort kommt über hud:phone zurück und
        // zeichnet die Karte neu – ohne sie wäre „erkennt nichts" nicht von
        // „es läuft gerade kein Gespräch" zu unterscheiden.
        window.hud.command("media-probe", {});
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
    if (role === "hud-phone-direction") {
      state.phone.direction = target.value === "inbound" ? "inbound" : "outbound";
      window.hud.command("phone-direction", { value: state.phone.direction });
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

  function setPhone(next) {
    if (!next || typeof next !== "object") return;
    state.phone = { ...state.phone, ...next };
    app.ui.rerender();
  }

  // Wählen kann nur der Hauptprozess (shell.openExternal auf eine tel:-Adresse).
  // In Chrome gibt es diesen Gastgeber nicht, deshalb fragt das Panel hier
  // nach, statt einen Knopf anzubieten, der dort nichts täte.
  function canDial() {
    return true;
  }

  function dial(number) {
    window.hud.command("dial", { number });
  }

  /**
   * Leer, wenn das Wählen wirken sollte – sonst der Grund, warum nicht.
   *
   * Unter macOS bekommt FaceTime tel:-Adressen ab Werk. Der Knopf öffnet dann
   * FaceTime statt zu wählen, und ohne diesen Satz sucht man den Fehler in der
   * Auskunft. Geprüft wird nur, was das System wirklich sagt
   * (app.getApplicationNameForProtocol) – ein anderes Softphone kann durchaus
   * gewollt sein, deshalb wird nicht verboten, sondern gesagt.
   */
  function dialHint() {
    const p = state.phone;
    if (p.platform !== "darwin") return "";
    if (!p.telHandler) return "";
    if (/myapps/i.test(p.telHandler)) return "";
    return `tel:-Adressen gehen an „${p.telHandler}“, nicht an myApps (⚙ → Telefonanlage).`;
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
    setPhone,
    setConnected,
    setVersion,
    // Wählen über die Telefonanlage – siehe dialNumber() in extension/src/ui.js.
    canDial,
    dial,
    dialHint,
    // Als was ein Anruf gilt, dessen Richtung die Anlage nicht mitliefert.
    // Gelesen von desktop/renderer/myapps-calls.js.
    defaultCallDirection: () => (state.phone.direction === "inbound" ? "inbound" : "outbound"),
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
