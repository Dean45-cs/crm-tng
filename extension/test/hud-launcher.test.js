"use strict";

// Test für src/content.js – die Sprechblase „Auskunft", mit der man das
// Overlay der Desktop-App aus der Seite heraus hervorholt.
//
// Warum das einen eigenen Test wert ist: läuft die App, baut content.js das
// Panel in der Jira-Seite ab (hud-agent.js gibt das vor). Damit ist die
// Sprechblase der einzige Weg, der in Chrome noch zur Auskunft führt – wenn
// sie fehlt oder stehen bleibt, hält der Bearbeiter eine ausgeblendete App für
// abgestürzt bzw. klickt in der Seite auf einen Knopf, hinter dem nichts mehr
// steckt. Beides fällt beim Lesen des Codes nicht auf.
//
// Ausführen mit: node test/hud-launcher.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO_ROOT = path.join(__dirname, "..", "..");
const LAUNCHER_ID = "stadtnetzcrm-hud-launcher";

// Sehr kleine DOM-Attrappe: content.js legt genau ein Element an, hängt es an
// den Seitenkörper und nimmt es wieder weg. Mehr braucht der Test nicht.
function makeElement(tag) {
  return {
    tagName: tag,
    id: "",
    type: "",
    title: "",
    textContent: "",
    isConnected: false,
    childNodes: [],
    attributes: {},
    listeners: {},
    get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(type, handler) { (this.listeners[type] = this.listeners[type] || []).push(handler); },
    appendChild(child) {
      this.childNodes.push(child);
      child.isConnected = true;
      child.parentNode = this;
      return child;
    },
    remove() {
      const parent = this.parentNode;
      if (!parent) return;
      parent.childNodes = parent.childNodes.filter((node) => node !== this);
      this.parentNode = null;
      this.isConnected = false;
    },
    click() { (this.listeners.click || []).forEach((handler) => handler()); }
  };
}

function loadContent({ pathname = "/browse/SUP-1", respond } = {}) {
  const body = makeElement("body");
  const mounts = [];
  const sent = [];

  // CONFIG und shared kommen aus den echten Dateien: der Hinweistext der
  // Sprechblase nennt die Tastenkombination aus der gemeinsamen Kürzel-Liste.
  const app = {
    ui: { mount: () => mounts.push(true), refresh() {} }
  };

  const find = (node, id) => {
    if (node.id === id) return node;
    for (const child of node.childNodes) {
      const hit = find(child, id);
      if (hit) return hit;
    }
    return null;
  };

  const timers = [];
  const globalObj = {
    StadtnetzCRM: app,
    console,
    navigator: { platform: "MacIntel" },
    location: { pathname, href: `https://jira.ennit.de${pathname}` },
    document: {
      body,
      createElement: makeElement,
      getElementById: (id) => find(body, id),
      querySelector: () => null
    },
    setInterval: () => 1,
    clearInterval() {},
    // Fällige Timer werden im Test von Hand ausgelöst – sonst hinge er an der
    // Rückstellung der Beschriftung.
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout() {},
    chrome: {
      runtime: {
        lastError: undefined,
        sendMessage(message, cb) {
          sent.push(message);
          if (cb) cb(respond ? respond(message) : { ok: true });
        }
      }
    }
  };
  globalObj.window = globalObj;
  vm.createContext(globalObj);
  ["config.js", "shared.js", "content.js"].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(REPO_ROOT, "extension/src", file), "utf8"), globalObj);
  });

  return {
    app,
    sent,
    mounts,
    body,
    launcher: () => find(body, LAUNCHER_ID),
    runTimers: () => { const due = timers.splice(0); due.forEach((fn) => fn()); }
  };
}

function run() {
  // --- Ohne App bleibt die Seite, wie sie war ------------------------------
  {
    const env = loadContent();
    assert.strictEqual(env.launcher(), null, "ohne laufende App keine Sprechblase");
    assert.strictEqual(env.mounts.length, 1, "das Panel wird ganz normal aufgebaut");
  }

  // --- Mit App: Panel weg, Sprechblase da ----------------------------------
  {
    const env = loadContent();

    // Das meldet hud-agent.js, sobald die App sich verbindet.
    env.app.hudTakeover = true;
    env.app.content.sync();

    const launcher = env.launcher();
    assert.ok(launcher, "die Sprechblase tritt an die Stelle des Panels");
    assert.strictEqual(env.mounts.length, 1, "das Panel wird nicht zusätzlich aufgebaut");
    assert.strictEqual(launcher.attributes["aria-label"], "Auskunft einblenden");
    // Die Tastenkombination gehört dazu: sie ist der Weg, der auch dann noch
    // funktioniert, wenn Chrome gerade nicht im Vordergrund ist.
    assert.ok(/Leertaste/.test(launcher.title), "der Hinweis nennt die Tastenkombination");

    // Zweiter Durchlauf (Jira wechselt den Vorgang): keine zweite Sprechblase.
    env.app.content.sync();
    assert.strictEqual(env.body.childNodes.filter((node) => node.id === LAUNCHER_ID).length, 1,
      "sie wird nicht bei jedem Durchlauf erneut angehängt");
  }

  // --- Der Klick holt die Auskunft nach vorn -------------------------------
  {
    const env = loadContent();
    env.app.hudTakeover = true;
    env.app.content.sync();

    env.launcher().click();
    const shows = env.sent.filter((message) => message.type === "sc-hud-show");
    assert.strictEqual(shows.length, 1, "der Klick beauftragt den Worker");
  }

  // --- Antwortet niemand, sagt die Sprechblase das -------------------------
  {
    const env = loadContent({ respond: () => ({ ok: false }) });
    env.app.hudTakeover = true;
    env.app.content.sync();

    const launcher = env.launcher();
    launcher.click();
    assert.strictEqual(launcher.lastChild.textContent, "Nicht erreichbar",
      "ein wirkungsloser Klick darf nicht wie ein wirksamer aussehen");

    // …und danach ist sie wieder normal benutzbar.
    env.runTimers();
    assert.strictEqual(launcher.lastChild.textContent, "Auskunft", "die Beschriftung kommt zurück");
  }

  // --- Endet die App, kommt das Panel zurück -------------------------------
  {
    const env = loadContent();
    env.app.hudTakeover = true;
    env.app.content.sync();
    assert.ok(env.launcher(), "Ausgangslage: App läuft");

    env.app.hudTakeover = false;
    env.app.content.sync();
    assert.strictEqual(env.launcher(), null, "eine Sprechblase ohne App führte ins Leere");
    assert.strictEqual(env.mounts.length, 2, "das Panel gehört wieder in die Seite");
  }

  // --- Auch außerhalb eines Vorgangs erreichbar ----------------------------
  {
    // Auf der Vorgangsliste gab es nie ein Panel – die Auskunft ist dort aber
    // genauso nützlich, und ausgeblendet wäre sie sonst unerreichbar.
    const env = loadContent({ pathname: "/issues/?filter=-1" });
    env.app.hudTakeover = true;
    env.app.content.sync();
    assert.ok(env.launcher(), "die Sprechblase gilt für die ganze Jira-Seite");
    assert.strictEqual(env.mounts.length, 0, "ohne Vorgang trotzdem kein Panel");
  }

  console.log("hud-launcher.test.js: alle Szenarien bestanden.");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
