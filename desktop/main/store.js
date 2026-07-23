"use strict";

// Persistenter Spiegel von chrome.storage.local plus die HUD-eigenen
// Einstellungen (Fensterposition, Notizen). Zwei getrennte Dateien, weil sie
// unterschiedlich schutzbedürftig sind: `mirror.json` enthält Anruf- und
// Kundendaten aus der Extension, `hud.json` nur Fenster- und Bedienzustand.
//
// Warum überhaupt spiegeln: das HUD soll auch dann etwas anzeigen können, wenn
// Chrome gerade nicht läuft (frisch gestartet, Neustart, Absturz). Ohne Spiegel
// wäre das Fenster bis zur ersten Verbindung leer.

const fs = require("fs");
const path = require("path");

function atomicWrite(file, text) {
  // Erst daneben schreiben, dann umbenennen: ein Absturz mitten im Schreiben
  // hinterlässt so keine halbe Datei, sondern den vorherigen Stand.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, file);
}

class JsonFile {
  constructor(file, fallback) {
    this.file = file;
    this.data = fallback;
    this.writeTimer = null;
    this.load(fallback);
  }

  load(fallback) {
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") this.data = parsed;
    } catch (error) {
      this.data = fallback;
    }
  }

  // Gebündeltes Schreiben: Wartefeld-Zahlen und der Anruf-Timer ändern sich im
  // Sekundentakt, die Platte muss das nicht jedes Mal mitmachen.
  schedulePersist() {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.persistNow();
    }, 400);
  }

  persistNow() {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      atomicWrite(this.file, JSON.stringify(this.data));
    } catch (error) { /* nicht schreibbar – der Spiegel ist verzichtbar */ }
  }
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.mirror = new JsonFile(path.join(dir, "mirror.json"), {});
    this.hud = new JsonFile(path.join(dir, "hud.json"), {});
  }

  // --- Storage-Spiegel (Schlüssel/Wert wie chrome.storage.local) -----------

  snapshot() {
    return { ...this.mirror.data };
  }

  get(keys) {
    if (!keys) return this.snapshot();
    const list = Array.isArray(keys) ? keys : [keys];
    const out = {};
    list.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(this.mirror.data, key)) out[key] = this.mirror.data[key];
    });
    return out;
  }

  set(payload) {
    if (!payload || typeof payload !== "object") return {};
    const changes = {};
    Object.keys(payload).forEach((key) => {
      const next = payload[key];
      // Nur echte Wertänderungen weitermelden – sonst rendert das HUD bei
      // jedem Sekunden-Tick der Extension komplett neu.
      if (JSON.stringify(this.mirror.data[key]) === JSON.stringify(next)) return;
      changes[key] = { oldValue: this.mirror.data[key], newValue: next };
      this.mirror.data[key] = next;
    });
    if (Object.keys(changes).length) this.mirror.schedulePersist();
    return changes;
  }

  remove(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    const changes = {};
    list.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(this.mirror.data, key)) return;
      changes[key] = { oldValue: this.mirror.data[key], newValue: undefined };
      delete this.mirror.data[key];
    });
    if (Object.keys(changes).length) this.mirror.schedulePersist();
    return changes;
  }

  // Vollständiger Stand aus der Extension: ersetzt den Spiegel, meldet aber
  // nur die tatsächlichen Unterschiede – so bleibt das HUD ruhig, wenn sich
  // beim Verbindungsaufbau nichts geändert hat.
  replaceAll(data) {
    const next = data && typeof data === "object" ? data : {};
    const changes = {};
    const keys = new Set([...Object.keys(this.mirror.data), ...Object.keys(next)]);
    keys.forEach((key) => {
      const before = this.mirror.data[key];
      const after = next[key];
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      changes[key] = { oldValue: before, newValue: after };
    });
    this.mirror.data = { ...next };
    if (Object.keys(changes).length) this.mirror.schedulePersist();
    return changes;
  }

  // --- HUD-eigene Einstellungen -------------------------------------------

  hudGet(key, fallback) {
    return Object.prototype.hasOwnProperty.call(this.hud.data, key) ? this.hud.data[key] : fallback;
  }

  hudSet(key, value) {
    this.hud.data[key] = value;
    this.hud.schedulePersist();
  }

  flush() {
    this.mirror.persistNow();
    this.hud.persistNow();
  }
}

module.exports = { Store };
