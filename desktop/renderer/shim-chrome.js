"use strict";

// Ein `chrome`-Objekt für den Electron-Renderer.
//
// extension/src/ui.js, supabase.js und ai-cache.js laufen hier unverändert –
// sie sollen nicht wissen, ob sie in einem Chrome-Tab oder im HUD-Fenster
// stecken. Gebraucht wird davon nur ein sehr kleiner Ausschnitt:
// storage.local.get/set/remove, storage.onChanged und runtime.sendMessage.
// Alles davon geht über den Hauptprozess an die Extension und wird dort auf
// das echte chrome.storage.local gelegt.

(function initChromeShim() {
  const listeners = new Set();

  function notify(changes) {
    if (!changes || !Object.keys(changes).length) return;
    listeners.forEach((listener) => {
      try {
        listener(changes, "local");
      } catch (error) {
        console.error("[hud] Fehler in einem storage.onChanged-Listener", error);
      }
    });
  }

  window.hud.onStorageChanged(notify);

  // Der volle Stand nach einem (Wieder-)Verbindungsaufbau kommt als Snapshot.
  // Die Unterschiede daraus hat der Hauptprozess bereits als storage-changed
  // geschickt – hier ist also nichts weiter zu tun, außer ihn zu ignorieren.
  window.hud.onStorageSnapshot(() => {});

  const local = {
    get(keys, callback) {
      // Chrome erlaubt string | string[] | object | null. ui.js nutzt Arrays,
      // supabase.js einzelne Strings – beides muss funktionieren.
      const request = keys && typeof keys === "object" && !Array.isArray(keys) ? Object.keys(keys) : keys;
      const promise = window.hud.storageGet(request === undefined ? null : request).then((data) => {
        // Bei einem Objekt als Argument sind dessen Werte die Vorgaben.
        if (keys && typeof keys === "object" && !Array.isArray(keys)) return { ...keys, ...data };
        return data || {};
      });
      if (typeof callback === "function") {
        promise.then(callback, () => callback({}));
        return undefined;
      }
      return promise;
    },

    set(payload, callback) {
      window.hud.storageSet(payload || {});
      if (typeof callback === "function") callback();
      return Promise.resolve();
    },

    remove(keys, callback) {
      window.hud.storageRemove(Array.isArray(keys) ? keys : [keys]);
      if (typeof callback === "function") callback();
      return Promise.resolve();
    }
  };

  window.chrome = window.chrome || {};

  window.chrome.storage = {
    local,
    // Die Extension nutzt sync nirgends; der Platzhalter verhindert nur
    // Abstürze, falls das später doch dazukommt.
    sync: local,
    onChanged: {
      addListener: (listener) => listeners.add(listener),
      removeListener: (listener) => listeners.delete(listener)
    }
  };

  window.chrome.runtime = {
    // extensionAlive() in shared.js prüft genau darauf. Im HUD ist der Kontext
    // immer gültig – das Fenster wird nicht wie ein Content-Script unter den
    // Füßen weggezogen.
    id: "stadtnetz-crm-hud",
    lastError: undefined,
    getURL: (relative) => `../../extension/${String(relative || "").replace(/^\/+/, "")}`,
    sendMessage(message, callback) {
      // Nachrichten an den Service-Worker (aktuell nur "focus-timio") gehen
      // über die Bridge an Chrome, denn nur dort gibt es chrome.tabs.
      const type = (message && message.type) || "";
      if (type) window.hud.command(type, message || {});
      if (typeof callback === "function") callback(undefined);
    },
    onMessage: {
      addListener: () => {},
      removeListener: () => {}
    }
  };
})();
