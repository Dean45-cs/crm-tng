"use strict";

// Test für renderer/boot.js – das Startbild und der Weg vom leeren Fenster zum
// fertigen Cockpit.
//
// Warum das einen eigenen Test wert ist: das Fenster hat keinen Rahmen, keine
// Titelleiste und kein Dock-Symbol. Was hier schiefgeht, sieht für den
// Bearbeiter immer gleich aus – eine dunkle Fläche, die nichts tut. Drei Zusagen
// hält der Test deshalb fest:
//
//   1. Nach dem Start ist das Startbild wieder weg. Bliebe es liegen, läge eine
//      unsichtbare Ebene über dem Panel und schluckte jeden Klick.
//   2. Scheitert der Start, sagt das Fenster das – mit einem Weg nach vorn.
//      Ohne Meldung stünde die Ursache nur in den DevTools.
//   3. Die Tastenkombination zum Zurückholen steht auf dem Startbild, und zwar
//      die, die der Hauptprozess tatsächlich registriert hat.
//
// Ausführen mit: node test/boot.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RENDERER = path.join(__dirname, "..", "renderer");
const EXTENSION = path.join(__dirname, "..", "..", "extension", "src");

const OVERLAY = {
  alwaysOnTop: true,
  opacity: 1,
  clickThrough: false,
  toggleShortcut: "Command+Shift+Space",
  clickThroughShortcut: "Command+Shift+D"
};

// Die Knoten des Startbilds aus index.html – mehr aus dem DOM braucht boot.js
// nicht (der Anfasser fehlt bewusst: dafür ist er abgesichert).
const BOOT_ROLES = ["hud-boot", "hud-boot-step", "hud-boot-shortcut", "hud-boot-version", "hud-boot-retry"];

function makeNode(role) {
  const classes = new Set();
  return {
    role,
    textContent: "",
    hidden: true,
    removed: false,
    listeners: {},
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
    },
    addEventListener(type, handler) { (this.listeners[type] = this.listeners[type] || []).push(handler); },
    click() { (this.listeners.click || []).forEach((handler) => handler()); },
    remove() { this.removed = true; }
  };
}

function loadBoot({ state, withBootScreen = true, withBridge = true } = {}) {
  const nodes = {};
  if (withBootScreen) BOOT_ROLES.forEach((role) => { nodes[role] = makeNode(role); });

  const mounts = [];
  const reloads = [];
  let now = 0;
  let seq = 0;
  const timers = [];

  // CONFIG und shared kommen aus den echten Dateien der Extension (dort steht
  // auch die Kürzel-Liste) – eine Attrappe hätte den Tastenteil des Starts nur
  // vorgetäuscht.
  const app = {
    ui: {
      mount: () => { mounts.push(true); return Promise.resolve(); },
      refresh() {},
      rerender() {},
      loadCapabilities() {}
    },
    jiraReader: { setTicket: () => false },
    hudNotes: { init() {}, isOpen: () => false, toggle() {}, refreshContext() {} }
  };

  const sandbox = {
    StadtnetzCRM: app,
    console: { error() {}, log() {} },
    navigator: { platform: "MacIntel" },
    document: {
      querySelector: (selector) => {
        const match = /\[data-role='([^']+)'\]/.exec(selector);
        return (match && nodes[match[1]]) || null;
      },
      addEventListener() {}
    },
    location: { reload: () => reloads.push(true) },
    setTimeout: (fn, ms) => { timers.push({ fn, at: now + (Number(ms) || 0), id: ++seq }); return seq; },
    clearTimeout: (id) => {
      const index = timers.findIndex((timer) => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
    addEventListener() {},
    hud: withBridge ? {
      state: () => (typeof state === "function" ? state() : Promise.resolve(state)),
      onStatus() {}, onTicket() {}, onOverlay() {}, onStorageChanged() {},
      command() {}
    } : undefined
  };
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION, "config.js"), "utf8"), sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION, "shared.js"), "utf8"), sandbox);
  // hud-host.js liefert unter anderem die Schreibweise der Tastenkombination –
  // dieselbe Quelle wie in den Einstellungen, deshalb hier die echte Datei.
  vm.runInContext(fs.readFileSync(path.join(RENDERER, "hud-host.js"), "utf8"), sandbox);
  vm.runInContext(fs.readFileSync(path.join(RENDERER, "boot.js"), "utf8"), sandbox);

  return {
    nodes,
    mounts,
    reloads,
    // Virtuelle Uhr: das Startbild bleibt bewusst eine Mindestzeit stehen, und
    // ein Test soll darauf nicht wirklich warten müssen.
    advance(ms) {
      now += ms;
      for (;;) {
        const due = timers.filter((timer) => timer.at <= now).sort((a, b) => a.at - b.at)[0];
        if (!due) return;
        timers.splice(timers.indexOf(due), 1);
        due.fn();
      }
    },
    settle: () => new Promise((resolve) => setImmediate(resolve))
  };
}

const READY = {
  overlay: OVERLAY,
  version: "0.1.0",
  connected: true,
  ticket: null,
  notes: [],
  notesDraft: ""
};

async function run() {
  // --- 1. Normaler Start ---------------------------------------------------
  {
    const env = loadBoot({ state: READY });
    const boot = env.nodes["hud-boot"];

    // Solange der Aufbau läuft, hält das Startbild die Fläche.
    assert.strictEqual(boot.removed, false, "während des Starts bleibt das Startbild stehen");

    await env.settle();
    await env.settle();
    assert.strictEqual(env.mounts.length, 1, "das Cockpit wird aufgebaut");
    assert.ok(/Chrome/.test(env.nodes["hud-boot-step"].textContent), "es sagt, worauf gewartet wurde");
    assert.strictEqual(env.nodes["hud-boot-version"].textContent, "Version 0.1.0");
    // Die verbindliche Angabe kommt aus dem Hauptprozess, nicht aus dem HTML.
    assert.strictEqual(env.nodes["hud-boot-shortcut"].textContent, "⌘⇧Leertaste",
      "die Tastenkombination steht in der Schreibweise der Tastatur");

    env.advance(1000);
    assert.ok(boot.classList.contains("is-done"), "das Startbild blendet aus");
    // Erst nach dem Überblenden ist es wirklich weg.
    env.advance(1000);
    assert.strictEqual(boot.removed, true,
      "und wird entfernt – eine unsichtbare Ebene über dem Panel schluckte sonst jeden Klick");
  }

  // --- 2. Ohne Chrome startet die Auskunft trotzdem ------------------------
  {
    const env = loadBoot({ state: { ...READY, connected: false } });
    await env.settle();
    await env.settle();
    assert.strictEqual(env.mounts.length, 1, "auch ohne Chrome wird aufgebaut");
    assert.ok(/Notizen/.test(env.nodes["hud-boot-step"].textContent),
      "der Grund steht dabei, sonst wirkt der Start gescheitert");
    env.advance(1000);
    env.advance(1000);
    assert.strictEqual(env.nodes["hud-boot"].removed, true);
  }

  // --- 3. Scheitert der Start, sagt das Fenster das ------------------------
  {
    const env = loadBoot({ state: () => Promise.reject(new Error("Bridge weg")) });
    await env.settle();
    await env.settle();

    const boot = env.nodes["hud-boot"];
    assert.ok(boot.classList.contains("is-error"), "der Fehlschlag ist sichtbar");
    assert.ok(/Bridge weg/.test(env.nodes["hud-boot-step"].textContent), "mit der Ursache im Klartext");
    assert.strictEqual(env.nodes["hud-boot-retry"].hidden, false, "und einem Weg nach vorn");
    assert.strictEqual(boot.removed, false, "das Startbild verschwindet nicht über der Fehlermeldung");

    env.nodes["hud-boot-retry"].click();
    assert.strictEqual(env.reloads.length, 1, "der Knopf startet das Fenster neu");
  }

  // --- 4. Bleibt der Start hängen, bleibt es nicht beim Drehen ------------
  {
    // Kommt aus dem Hauptprozess nie eine Antwort, wartete das Fenster ewig –
    // sichtbar wäre nur ein Balken, der sich bewegt.
    const env = loadBoot({ state: () => new Promise(() => {}) });
    await env.settle();

    assert.strictEqual(env.nodes["hud-boot-retry"].hidden, true, "eine Weile ist Warten normal");
    env.advance(10000);
    assert.ok(env.nodes["hud-boot"].classList.contains("is-error"), "danach wird es gemeldet");
    assert.strictEqual(env.nodes["hud-boot-retry"].hidden, false, "mit Weg nach vorn");
  }

  // --- 5. Ein zäher Start ist kein gescheiterter ---------------------------
  {
    // Kommt die Antwort doch noch, darf die Hänger-Meldung nicht über dem
    // fertigen Cockpit stehen bleiben – sonst hält man eine laufende Auskunft
    // für kaputt und startet sie neu.
    let resolveState = null;
    const env = loadBoot({ state: () => new Promise((resolve) => { resolveState = resolve; }) });
    await env.settle();
    env.advance(10000);
    assert.ok(env.nodes["hud-boot"].classList.contains("is-error"), "Ausgangslage: es klemmt");

    resolveState(READY);
    await env.settle();
    await env.settle();
    assert.ok(!env.nodes["hud-boot"].classList.contains("is-error"), "die Meldung wird zurückgenommen");
    assert.strictEqual(env.nodes["hud-boot-retry"].hidden, true, "und der Knopf verschwindet wieder");
    env.advance(1000);
    env.advance(1000);
    assert.strictEqual(env.nodes["hud-boot"].removed, true, "das Startbild macht Platz");
  }

  // --- 6. Fehlt die Brücke, zerschellt es nicht still ----------------------
  {
    const env = loadBoot({ withBridge: false });
    await env.settle();
    assert.ok(env.nodes["hud-boot"].classList.contains("is-error"),
      "ohne preload.js sagt das Fenster, dass es nicht vollständig geladen ist");
    assert.strictEqual(env.mounts.length, 0);
  }

  // --- 7. Ohne Startbild läuft der Start trotzdem durch -------------------
  {
    // Das Startbild ist eine Zutat des Fensters, keine Bedingung: der Aufbau
    // des Cockpits darf nicht daran hängen, dass es gefunden wird.
    const env = loadBoot({ state: READY, withBootScreen: false });
    await env.settle();
    await env.settle();
    assert.strictEqual(env.mounts.length, 1, "das Cockpit steht auch ohne Startbild");
  }

  console.log("boot.test.js: alle Szenarien bestanden.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
