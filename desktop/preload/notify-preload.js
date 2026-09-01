"use strict";

// Brücke ins Mitteilungsfenster. Noch schmaler als die des Panels: das Fenster
// zeigt Banner an und meldet zurück, wie hoch sie sind und ob jemand geklickt
// hat. Mehr braucht es dort nicht.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hudNotify", {
  /** Der Renderer kann zeichnen — Aufgestautes darf kommen. */
  ready: () => ipcRenderer.send("notify:ready"),

  /** Gemessene Gesamthöhe des Stapels; 0 heißt „nichts mehr da". */
  setHeight: (height) => ipcRenderer.send("notify:height", height),

  /** Klick auf ein Banner. url ist leer, wenn nur das HUD nach vorn soll. */
  activate: (url) => ipcRenderer.send("notify:activate", url || ""),

  onAdd: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (event, payload) => handler(payload);
    ipcRenderer.on("notify:add", listener);
    return () => ipcRenderer.removeListener("notify:add", listener);
  }
});
