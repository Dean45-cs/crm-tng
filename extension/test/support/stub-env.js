"use strict";

// Stubs, um die Content-Scripts und den Hintergrund-Service-Worker der
// Extension ohne echten Browser per Node `vm` auszuführen. Lädt die echten
// src/*.js Dateien in derselben Reihenfolge wie manifest.json, damit Tests
// gegen die tatsächliche Konfiguration/Helper-Implementierung laufen statt
// gegen eine von Hand gepflegte Näherung.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO_ROOT = path.join(__dirname, "..", "..");

// Ein "Bus" simuliert das extension-weite chrome.storage.local: mehrere
// Sandboxes (= mehrere Tabs / Content-Script + Service-Worker derselben
// Extension) können sich einen Bus teilen, um chrome.storage.onChanged-
// Propagation zwischen ihnen zu testen.
function createBus() {
  return { storage: {}, listeners: [] };
}

function makeStorageArea(bus) {
  return {
    set(payload) {
      const changes = {};
      Object.keys(payload).forEach((key) => {
        changes[key] = { oldValue: bus.storage[key], newValue: payload[key] };
      });
      Object.assign(bus.storage, payload);
      bus.listeners.forEach((fn) => fn(changes, "local"));
    },
    get(keys, cb) {
      const keyList = Array.isArray(keys) ? keys : [keys];
      const result = {};
      keyList.forEach((key) => { if (key in bus.storage) result[key] = bus.storage[key]; });
      cb(result);
    },
    remove(keys) {
      const keyList = Array.isArray(keys) ? keys : [keys];
      const changes = {};
      keyList.forEach((key) => {
        changes[key] = { oldValue: bus.storage[key], newValue: undefined };
        delete bus.storage[key];
      });
      bus.listeners.forEach((fn) => fn(changes, "local"));
    }
  };
}

function makeChromeStub(bus) {
  return {
    runtime: { id: "test-extension", getURL: (p) => p },
    storage: {
      local: makeStorageArea(bus),
      onChanged: { addListener(fn) { bus.listeners.push(fn); } }
    }
  };
}

// ---------------------------------------------------------------------------
// Content-Script-Sandbox: das Global-Objekt IST window (wie im echten
// Content-Script gilt window === globalThis), damit auf globalThis gesetzte
// Werte (config.js/shared.js) und auf window gelesene Werte (ui.js/timio) auf
// dasselbe Objekt zeigen.
// ---------------------------------------------------------------------------

function makeSandbox(bus) {
  const sharedBus = bus || createBus();
  // Mehrere gleichzeitig angehängte Roots (Call-Cockpit UND Befehlspalette,
  // Stufe 4) — deshalb ein children-Array statt einer Einzelreferenz.
  // getOverlay() gibt weiterhin den zuletzt angehängten Root zurück
  // (in reinen Cockpit-Tests ist das wie bisher das Cockpit-Overlay).
  const rootChildren = [];
  let lastAppended = null;
  let tickFn = null;
  let docKeydownHandler = null;
  const openedUrls = [];
  // Steuerbare Timer: window.setTimeout im Content-Script (nur die
  // Palette-Debounce nutzt es) feuert nicht von selbst — flushTimers()
  // führt die anstehenden Rückrufe aus.
  const timers = [];
  let timerSeq = 0;

  function makeElement() {
    return {
      id: "",
      innerHTML: "",
      value: "",
      style: {},
      _listeners: {},
      appendChild() {},
      addEventListener(type, fn) { this._listeners[type] = fn; },
      querySelector() { return null; },
      focus() {},
      setSelectionRange() {},
      remove() {
        const idx = rootChildren.indexOf(this);
        if (idx >= 0) rootChildren.splice(idx, 1);
        if (lastAppended === this) lastAppended = rootChildren[rootChildren.length - 1] || null;
      }
    };
  }

  const documentStub = {
    body: {
      innerText: "",
      appendChild(el) { rootChildren.push(el); lastAppended = el; }
    },
    getElementById(id) {
      return rootChildren.find((el) => el && el.id === id) || null;
    },
    createElement() { return makeElement(); },
    addEventListener(type, fn) { if (type === "keydown") docKeydownHandler = fn; },
    removeEventListener(type) { if (type === "keydown") docKeydownHandler = null; }
  };

  const globalObj = {
    innerWidth: 1200,
    innerHeight: 800,
    clearInterval() {},
    setInterval(fn) { tickFn = fn; return 1; },
    setTimeout(fn) { timerSeq += 1; timers.push({ id: timerSeq, fn }); return timerSeq; },
    clearTimeout(id) {
      const idx = timers.findIndex((t) => t.id === id);
      if (idx >= 0) timers.splice(idx, 1);
    },
    addEventListener() {},
    removeEventListener() {},
    // Die Kundennummer-Suche öffnet die Jira-Trefferliste in einem neuen Tab.
    open(url) { openedUrls.push(url); return null; },
    document: documentStub,
    chrome: makeChromeStub(sharedBus),
    console
  };
  globalObj.window = globalObj; // window === globalThis, wie im Content-Script
  vm.createContext(globalObj);

  return {
    sandbox: globalObj,
    bus: sharedBus,
    storage: sharedBus.storage,
    setPageText(text) { documentStub.body.innerText = text; },
    tick() {
      if (!tickFn) throw new Error("tick() vor setInterval aufgerufen – erst Script(s) laden");
      tickFn();
    },
    getOverlay() { return lastAppended; },
    getElementById(id) { return documentStub.getElementById(id); },
    openedUrls,
    // Führt die anstehenden window.setTimeout-Rückrufe aus (z. B. die
    // Palette-Debounce). Gibt die Rückgabewerte zurück, damit ein
    // async-Rückruf per await abgewartet werden kann.
    flushTimers() {
      const pending = timers.splice(0, timers.length);
      return pending.map((t) => t.fn());
    },
    // Simuliert einen dokumentweiten Tastendruck (⌘K/Enter/Escape/Pfeile für
    // die Befehlspalette).
    fireKeydown(event) {
      if (docKeydownHandler) docKeydownHandler(event);
    },
    // extraDataset ergänzt weitere data-Attribute des geklickten Controls
    // (z. B. { outcome: "not-reached" } für die Ergebnis-Buttons).
    clickControl(act, extraDataset) {
      const overlayEl = lastAppended;
      if (!overlayEl) return;
      const handler = overlayEl._listeners && overlayEl._listeners.click;
      if (!handler) return;
      const dataset = Object.assign({ act }, extraDataset || {});
      const target = { closest: (sel) => (sel === "[data-act]" ? { dataset } : null) };
      handler({ target });
    }
  };
}

// ---------------------------------------------------------------------------
// Service-Worker-Sandbox: kein window/document, dafür die vom Worker genutzten
// chrome-APIs (action/alarms/notifications/tabs/windows) als aufzeichnende
// Stubs. importScripts ist ein No-Op – config.js/shared.js werden im Test
// vorab per loadScripts geladen.
// ---------------------------------------------------------------------------

function makeWorkerSandbox(bus) {
  const sharedBus = bus || createBus();
  const chromeStub = makeChromeStub(sharedBus);
  const calls = { badgeText: [], badgeColor: [], title: [], notifications: [], tabsUpdated: [], tabsCreated: [], alarms: [] };

  chromeStub.action = {
    setBadgeText(arg) { calls.badgeText.push(arg.text); },
    setBadgeBackgroundColor(arg) { calls.badgeColor.push(arg.color); },
    setBadgeTextColor() {},
    setTitle(arg) { calls.title.push(arg.title); },
    onClicked: { addListener(fn) { chromeStub.action._onClicked = fn; } }
  };
  chromeStub.alarms = {
    create(name, info) { calls.alarms.push({ name, info }); },
    onAlarm: { addListener(fn) { chromeStub.alarms._onAlarm = fn; } }
  };
  chromeStub.notifications = {
    create(id, opts, cb) { calls.notifications.push({ id, opts }); if (cb) cb(id); },
    onClicked: { addListener(fn) { chromeStub.notifications._onClicked = fn; } }
  };
  chromeStub.tabs = {
    query(info, cb) { cb((sharedBus.timioTabs || [])); },
    update(id, info) { calls.tabsUpdated.push({ id, info }); },
    create(info) { calls.tabsCreated.push(info); }
  };
  chromeStub.windows = { update() {} };
  chromeStub.runtime.onInstalled = { addListener(fn) { chromeStub.runtime._onInstalled = fn; } };
  chromeStub.runtime.onStartup = { addListener(fn) { chromeStub.runtime._onStartup = fn; } };

  const globalObj = {
    self: null,
    chrome: chromeStub,
    console,
    importScripts() {}, // No-Op: config/shared werden vorab geladen
    setTimeout() { return 0; },
    clearTimeout() {},
    Date
  };
  globalObj.self = globalObj;
  vm.createContext(globalObj);

  return {
    sandbox: globalObj,
    bus: sharedBus,
    storage: sharedBus.storage,
    calls,
    chrome: chromeStub
  };
}

// ---------------------------------------------------------------------------
// Panel-Sandbox für src/ui.js (Jira-Seite). Braucht mehr DOM als die
// timio-Sandbox: ui.js legt sein Root-Element selbst an, rendert per innerHTML
// und hängt seine Listener per Delegation an genau dieses Element.
//
// Absichtlich flach gehalten: querySelector liefert null, wodurch el() und
// syncInputsFromDom() zu No-Ops werden – beide sind im Produktivcode ohnehin
// gegen fehlende Knoten abgesichert. Geprüft wird damit das gerenderte Markup
// und der Zustandsfluss, nicht das Verhalten echter Eingabefelder.
// ---------------------------------------------------------------------------

function makePanelElement(tag) {
  return {
    tagName: tag,
    id: "",
    innerHTML: "",
    textContent: "",
    value: "",
    style: {},
    dataset: {},
    children: [],
    _parent: null,
    _listeners: {},
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild(child) { child._parent = this; this.children.push(child); return child; },
    // Splice aus dem Elternteil, damit ein entfernter Root (z. B. die
    // geschlossene Befehlspalette) danach nicht mehr über getElementById
    // gefunden wird.
    remove() {
      if (this._parent) {
        const idx = this._parent.children.indexOf(this);
        if (idx >= 0) this._parent.children.splice(idx, 1);
        this._parent = null;
      }
    },
    addEventListener(type, fn) { this._listeners[type] = fn; },
    removeEventListener() {},
    focus() {},
    setSelectionRange() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    contains() { return false; },
    closest() { return null; },
    getClientRects() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 40 }; }
  };
}

function makePanelSandbox(options) {
  const opts = options || {};
  const sharedBus = opts.bus || createBus();
  const body = makePanelElement("body");
  let docKeydownHandler = null;
  const timers = [];
  let timerSeq = 0;

  const documentStub = {
    body,
    activeElement: null,
    getElementById(id) { return body.children.find((child) => child.id === id) || null; },
    createElement(tag) { return makePanelElement(tag); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(type, fn) { if (type === "keydown") docKeydownHandler = fn; },
    removeEventListener(type) { if (type === "keydown") docKeydownHandler = null; }
  };

  const openedUrls = [];
  const messages = [];
  const copied = [];

  const globalObj = {
    document: documentStub,
    // Der Ticket-Key wird aus dem Pfad gelesen (jiraReader.ticketKey).
    location: { pathname: opts.pathname || "/browse/TNG-1592568" },
    navigator: { clipboard: { writeText: async (text) => { copied.push(text); } } },
    innerWidth: 1400,
    innerHeight: 900,
    // Steuerbare Timer (nur die Palette-Debounce nutzt window.setTimeout in
    // einer testrelevanten Weise) — flushTimers() führt sie aus.
    setTimeout(fn) { timerSeq += 1; timers.push({ id: timerSeq, fn }); return timerSeq; },
    clearTimeout(id) {
      const idx = timers.findIndex((t) => t.id === id);
      if (idx >= 0) timers.splice(idx, 1);
    },
    setInterval() { return 1; },
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
    open(url) { openedUrls.push(url); return null; },
    confirm: () => true,
    // Jede KI-Aufgabe in ui.js läuft an einem AbortController (Ticketwechsel
    // bricht sie ab). Ein vm-Kontext erbt die Globals des Realms nicht.
    AbortController,
    chrome: makeChromeStub(sharedBus),
    console
  };
  globalObj.window = globalObj;
  globalObj.chrome.runtime.sendMessage = (message) => { messages.push(message); };
  vm.createContext(globalObj);

  function root(sandboxGlobal) {
    const rootId = sandboxGlobal.StadtnetzCRM.CONFIG.rootId;
    return documentStub.getElementById(rootId);
  }

  return {
    sandbox: globalObj,
    bus: sharedBus,
    storage: sharedBus.storage,
    openedUrls,
    messages,
    copied,
    root: () => root(globalObj),
    getElementById(id) { return documentStub.getElementById(id); },
    html: () => {
      const el = root(globalObj);
      return el ? el.innerHTML : "";
    },
    // Führt anstehende window.setTimeout-Rückrufe aus (z. B. Palette-Debounce);
    // gibt deren Rückgaben zurück, damit async-Rückrufe abgewartet werden können.
    flushTimers() {
      const pending = timers.splice(0, timers.length);
      return pending.map((t) => t.fn());
    },
    // Simuliert einen dokumentweiten Tastendruck (⌘K/Enter/… für die Palette).
    fireKeydown(event) {
      if (docKeydownHandler) docKeydownHandler(event);
    },
    // Simuliert einen Klick auf ein Control mit data-action (Delegation am
    // Root-Element, genau wie im echten Panel).
    click(action, extraDataset) {
      const el = root(globalObj);
      if (!el) throw new Error("click() vor mount() aufgerufen");
      const handler = el._listeners && el._listeners.click;
      if (!handler) throw new Error("kein Klick-Listener registriert");
      const dataset = Object.assign({ action }, extraDataset || {});
      return handler({ target: { closest: (sel) => (sel === "[data-action]" ? { dataset } : null) } });
    }
  };
}

// Führt die angegebenen Dateien (repo-relative Pfade) der Reihe nach im selben
// vm-Kontext aus, wie manifest.json sie lädt.
function loadScripts(sandbox, relativePaths) {
  relativePaths.forEach((relativePath) => {
    const code = fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
    vm.runInContext(code, sandbox);
  });
}

module.exports = { makeSandbox, makeWorkerSandbox, makePanelSandbox, loadScripts, createBus };
