"use strict";

// Schmale, fest verdrahtete Brücke ins Fenster. Der Renderer bekommt weder
// `require` noch Node-Globals – er sieht nur die Handvoll Aufrufe, die das
// Cockpit tatsächlich braucht.

const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel) {
  return (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld("hud", {
  // Einmaliger Startzustand: gespiegelter Storage, letztes Ticket,
  // Verbindungslage, Notizen.
  state: () => ipcRenderer.invoke("hud:state"),

  storageGet: (keys) => ipcRenderer.invoke("hud:storage-get", keys),
  storageSet: (payload) => ipcRenderer.send("hud:storage-set", payload),
  storageRemove: (keys) => ipcRenderer.send("hud:storage-remove", keys),

  // Liefert true, wenn der Aufruf bei Chrome angekommen ist. false heißt:
  // keine Extension verbunden, es wird keine Antwort folgen.
  aiCall: (request) => ipcRenderer.invoke("hud:ai-call", request),
  aiAbort: (id) => ipcRenderer.send("hud:ai-abort", id),

  saveNotes: (notes) => ipcRenderer.send("hud:notes", notes),
  saveNotesDraft: (text) => ipcRenderer.send("hud:notes-draft", text),
  command: (name, args) => ipcRenderer.send("hud:command", { name, args }),

  // Eine Mitteilung anzeigen: { title, body, tone, url }. Gezeichnet wird sie
  // im eigenen Fenster der App (main/notifications.js), damit sie auf Mac und
  // Windows gleich aussieht.
  notify: (item) => ipcRenderer.send("hud:notify", item),

  onStorageSnapshot: subscribe("hud:storage-snapshot"),
  onStorageChanged: subscribe("hud:storage-changed"),
  onTicket: subscribe("hud:ticket"),
  onStatus: subscribe("hud:status"),
  onAi: subscribe("hud:ai"),
  // Overlay-Schalter, die auch außerhalb des Panels umgelegt werden können
  // (Tray-Menü, Tastenkombination) – das Panel muss den Haken sonst nicht
  // mitbekommen und zeigte einen veralteten Stand.
  onOverlay: subscribe("hud:overlay"),

  // Ein Anruf, gemeldet von myApps über das URL-Schema (siehe main.js). Kommt
  // als { id, nr, name, uri, dir, ev, receivedAt } – alles außer receivedAt
  // kann fehlen, je nachdem, welche Platzhalter in myApps eingetragen sind.
  onCall: subscribe("hud:call")
});
