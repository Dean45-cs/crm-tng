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

  onStorageSnapshot: subscribe("hud:storage-snapshot"),
  onStorageChanged: subscribe("hud:storage-changed"),
  onTicket: subscribe("hud:ticket"),
  onStatus: subscribe("hud:status"),
  onAi: subscribe("hud:ai")
});
