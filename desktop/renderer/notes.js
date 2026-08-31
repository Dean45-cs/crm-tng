"use strict";

// Notizen – die eine Funktion, die es nur in der Desktop-App gibt.
//
// Gedacht als Schmierzettel während des Gesprächs: schnell etwas festhalten,
// ohne vorher ein Formular auszufüllen. Kunde und Ticket setzt die App selbst
// aus dem laufenden Anruf bzw. dem offenen Vorgang ein.
//
// Gespeichert wird zuerst lokal (mit Chrome hat das nichts zu tun, Notizen
// funktionieren also auch, wenn der Browser zu ist). Von dort lässt sich eine
// Notiz mit einem Klick in die Kundenakte übernehmen – dieselbe notes-Tabelle,
// die auch das CRM und die Ticket-Zusammenfassung nutzen.

(function initHudNotes() {
  const app = window.StadtnetzCRM;
  const { CONFIG, shared } = app;
  const supabaseClient = app.supabaseClient;
  const escapeHtml = shared.escapeHtml;

  const MAX_NOTES = 200;
  const AUTOSAVE_MS = 700;

  const state = {
    notes: [],
    draft: "",
    customerNumber: "",
    customerName: "",
    ticketKey: "",
    open: false,
    hint: { text: "", kind: "" },
    busyId: ""
  };

  let saveTimer = null;
  let container = null;

  // --- Speicher ------------------------------------------------------------

  function persist() {
    window.hud.saveNotes(state.notes);
  }

  function scheduleDraftKeep() {
    // Der angefangene Satz überlebt einen Neustart – wer mitten im Gespräch
    // tippt, soll ihn nicht verlieren, weil das Fenster zugeht. Verzögert,
    // damit nicht jeder Tastendruck auf die Platte geht.
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      window.hud.saveNotesDraft(state.draft);
    }, AUTOSAVE_MS);
  }

  // --- Kontext (Anruf/Ticket) ---------------------------------------------

  // Woher Kunde und Ticket kommen: läuft gerade ein Gespräch, gilt die dort
  // nachgeschlagene Kundenakte; sonst der in Chrome geöffnete Vorgang.
  async function refreshContext() {
    const data = await window.hud.storageGet([
      CONFIG.storageKeys.customerCard,
      CONFIG.storageKeys.activeCall,
      CONFIG.storageKeys.ticketContext
    ]);

    const card = data[CONFIG.storageKeys.customerCard];
    const call = data[CONFIG.storageKeys.activeCall];
    const ticketContext = data[CONFIG.storageKeys.ticketContext];
    const ticket = app.jiraReader.hasTicket() ? app.jiraReader.read() : null;

    // Die Kundenakte gilt nur für DAS Gespräch, zu dem sie nachgeschlagen
    // wurde. Ohne diese Prüfung trüge eine Notiz im nächsten Anruf noch die
    // Kundennummer des vorigen — und niemand sähe es ihr an.
    //
    // Gelesen wird `customerNumber` und `data.name`, also genau das, was
    // geschrieben wird (timio-content.js writeCustomerCard, ui.js
    // ensureCustomerCardForCall). Vorher stand hier `card.customer` — einen
    // solchen Schlüssel legt niemand an, die Zuordnung aus dem Gespräch kam
    // also nie zustande und fiel stillschweigend auf das Jira-Ticket zurück.
    const callId = call && (call.callId || call.connectedAt || call.updatedAt);
    const liveCall = call && call.status && call.status !== "idle";
    const cardFitsCall = card && liveCall && (!card.callId || !callId || card.callId === callId);

    state.customerNumber = (cardFitsCall && card.customerNumber) || "";
    state.customerName = (cardFitsCall && card.data && card.data.name) || (cardFitsCall && call.callerName) || "";

    if (!state.customerNumber && ticket && ticket.customerReference !== app.jiraReader.UNKNOWN) {
      state.customerNumber = ticket.customerReference || "";
      state.customerName = ticket.customerName !== app.jiraReader.UNKNOWN ? ticket.customerName || "" : "";
    }

    state.ticketKey = (ticket && ticket.key !== app.jiraReader.UNKNOWN ? ticket.key : "")
      || (ticketContext && ticketContext.key)
      || "";

    render();
  }

  // --- Notizen ------------------------------------------------------------

  function addNote() {
    const text = state.draft.trim();
    if (!text) return;
    state.notes.unshift({
      id: `n-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      text,
      customerNumber: state.customerNumber || "",
      customerName: state.customerName || "",
      ticketKey: state.ticketKey || "",
      createdAt: Date.now(),
      syncedAt: null
    });
    state.notes = state.notes.slice(0, MAX_NOTES);
    state.draft = "";
    state.hint = { text: "", kind: "" };
    persist();
    window.hud.saveNotesDraft("");
    render();
  }

  function deleteNote(id) {
    state.notes = state.notes.filter((note) => note.id !== id);
    persist();
    render();
  }

  async function copyNote(id) {
    const note = state.notes.find((item) => item.id === id);
    if (!note) return;
    try {
      await navigator.clipboard.writeText(note.text);
      state.hint = { text: "In die Zwischenablage kopiert.", kind: "ok" };
    } catch (error) {
      state.hint = { text: "Kopieren hat nicht geklappt.", kind: "error" };
    }
    render();
  }

  // Übernahme in die Kundenakte. Ohne Kundennummer hätte die Notiz keine Akte,
  // in der sie auftauchen könnte – dann bleibt sie bewusst lokal.
  async function syncNote(id) {
    const note = state.notes.find((item) => item.id === id);
    if (!note || state.busyId) return;

    if (!note.customerNumber) {
      state.hint = { text: "Ohne Kundennummer gibt es keine Akte, in die die Notiz gehört.", kind: "error" };
      return render();
    }

    state.busyId = id;
    state.hint = { text: "Wird in die Kundenakte geschrieben…", kind: "" };
    render();

    const result = await supabaseClient.insertNote({
      customerNumber: note.customerNumber,
      customerName: note.customerName,
      title: note.ticketKey ? `Gesprächsnotiz ${note.ticketKey}` : "Gesprächsnotiz",
      content: note.text,
      jiraTicket: note.ticketKey || null
    }).catch((error) => ({ ok: false, reason: "error", error: String((error && error.message) || error) }));

    state.busyId = "";
    if (result && result.ok) {
      note.syncedAt = Date.now();
      state.hint = { text: "In der Kundenakte gespeichert.", kind: "ok" };
      persist();
    } else {
      state.hint = { text: reasonText(result), kind: "error" };
    }
    render();
  }

  function reasonText(result) {
    switch (result && result.reason) {
      case "not-logged-in":
        return "Nicht am CRM angemeldet – Anmeldung in den Einstellungen des Panels.";
      case "not-configured":
        return "Für das CRM ist keine Verbindung hinterlegt.";
      case "network":
        return "Das CRM war nicht erreichbar. Die Notiz bleibt lokal gespeichert.";
      default:
        return (result && result.error) || "Das Speichern im CRM ist fehlgeschlagen.";
    }
  }

  // --- Darstellung ---------------------------------------------------------

  function contextLabel() {
    const parts = [];
    if (state.customerNumber) parts.push(`Kunde ${state.customerNumber}${state.customerName ? ` · ${state.customerName}` : ""}`);
    if (state.ticketKey) parts.push(state.ticketKey);
    return parts.length ? parts.join(" · ") : "Kein Kunde und kein Vorgang erkannt";
  }

  function noteTime(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    const time = date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    return sameDay ? time : `${date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} ${time}`;
  }

  function noteMarkup(note) {
    const context = [note.customerNumber ? `Kunde ${note.customerNumber}` : "", note.ticketKey]
      .filter(Boolean).join(" · ");
    const busy = state.busyId === note.id;
    return `
      <article class="hud-note">
        <div class="hud-note-meta">
          <span>${escapeHtml(context || "ohne Zuordnung")}</span>
          <span>${escapeHtml(noteTime(note.createdAt))}${note.syncedAt ? " · in der Akte" : ""}</span>
        </div>
        <div class="hud-note-text">${escapeHtml(note.text)}</div>
        <div class="hud-note-actions">
          ${note.syncedAt ? "" : `<button type="button" class="hud-chip" data-note-action="sync" data-id="${note.id}" ${busy ? "disabled" : ""}>${busy ? "…" : "In die Kundenakte"}</button>`}
          <button type="button" class="hud-chip" data-note-action="copy" data-id="${note.id}">Kopieren</button>
          <button type="button" class="hud-chip hud-chip--danger" data-note-action="delete" data-id="${note.id}">Löschen</button>
        </div>
      </article>`;
  }

  function render() {
    if (!container) return;
    container.hidden = !state.open;
    if (!state.open) return;

    const active = document.activeElement;
    const keepFocus = active && active.dataset && active.dataset.noteField === "draft";
    const selection = keepFocus && typeof active.selectionStart === "number"
      ? { start: active.selectionStart, end: active.selectionEnd }
      : null;

    container.innerHTML = `
      <div class="hud-notes-head">
        <div>
          <strong>Notizen</strong>
          <div class="hud-notes-context">${escapeHtml(contextLabel())}</div>
        </div>
        <button type="button" class="hud-chip" data-note-action="close">Schließen</button>
      </div>
      <div class="hud-notes-editor">
        <textarea data-note-field="draft" placeholder="Während des Gesprächs mitschreiben… (Strg/Cmd+Enter speichert)">${escapeHtml(state.draft)}</textarea>
        <div class="hud-notes-row">
          <button type="button" class="hud-chip hud-chip--primary" data-note-action="add" ${state.draft.trim() ? "" : "disabled"}>Notiz sichern</button>
          <span class="hud-notes-hint ${state.hint.kind === "error" ? "is-error" : ""} ${state.hint.kind === "ok" ? "is-ok" : ""}">${escapeHtml(state.hint.text)}</span>
        </div>
      </div>
      <div class="hud-notes-list">
        ${state.notes.length ? state.notes.map(noteMarkup).join("") : '<div class="hud-empty">Noch keine Notizen.</div>'}
      </div>`;

    if (keepFocus) {
      const field = container.querySelector("[data-note-field='draft']");
      if (field) {
        field.focus({ preventScroll: true });
        if (selection) field.setSelectionRange(selection.start, selection.end);
      }
    }
  }

  // --- Bedienung -----------------------------------------------------------

  function handleClick(event) {
    const button = event.target.closest("[data-note-action]");
    if (!button) return;
    const id = button.dataset.id || "";
    switch (button.dataset.noteAction) {
      case "add": return addNote();
      case "close": return toggle(false);
      case "sync": return syncNote(id);
      case "copy": return copyNote(id);
      case "delete": return deleteNote(id);
      default:
    }
  }

  function handleInput(event) {
    if (!event.target.dataset || event.target.dataset.noteField !== "draft") return;
    const wasEmpty = !state.draft.trim();
    state.draft = event.target.value;
    scheduleDraftKeep();
    // Nur neu zeichnen, wenn sich am Zustand der Schaltfläche etwas ändert –
    // sonst würde das Feld bei jedem Tastendruck neu aufgebaut.
    if (wasEmpty !== !state.draft.trim()) render();
  }

  function handleKeydown(event) {
    // Konfigurierbar wie alles andere (CONFIG.hotkeys, id "saveNote").
    if (app.shared.hotkeyMatches(event, app.ui.hotkey("saveNote"))) {
      event.preventDefault();
      addNote();
    }
  }

  function toggle(next) {
    state.open = typeof next === "boolean" ? next : !state.open;
    render();
    if (!state.open) return;
    refreshContext();
    const field = container.querySelector("[data-note-field='draft']");
    if (field) field.focus();
  }

  function init({ notes, draft } = {}) {
    state.notes = Array.isArray(notes) ? notes : [];
    state.draft = typeof draft === "string" ? draft : "";

    container = document.createElement("section");
    container.className = "hud-notes";
    container.hidden = true;
    container.setAttribute("aria-label", "Notizen");
    document.body.appendChild(container);

    container.addEventListener("click", handleClick);
    container.addEventListener("input", handleInput);
    container.addEventListener("keydown", handleKeydown);

    render();
  }

  app.hudNotes = { init, toggle, refreshContext, isOpen: () => state.open };
})();
