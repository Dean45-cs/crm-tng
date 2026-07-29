"use strict";

// Das Mitteilungsfenster (renderer/notify.js).
//
// Geprüft wird das, was man am fertigen Fenster nicht sieht und was still
// schiefgeht:
//   1. Die gemeldete Höhe. Das Fenster ist rahmenlos und durchsichtig — es
//      richtet sich nach dem Inhalt, nicht umgekehrt. Meldet der Renderer eine
//      Höhe, obwohl nichts mehr da ist, fängt eine unsichtbare Fläche
//      dauerhaft Klicks auf dem Schreibtisch ab.
//   2. Dass der Stapel nach oben begrenzt bleibt.
//   3. Dass ein Klick die Auskunft holt und das Banner verschwinden lässt,
//      der Schließen-Knopf aber nur schließt.
//
// Ausführen mit: node test/notify.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// --- Ein DOM, gerade groß genug -------------------------------------------
// Der gemeinsame Prüfstand der Extension (test/support/stub-env.js) ist
// bewusst flach: sein querySelector liefert immer null. notify.js baut aber
// echte Knoten und misst den Stapel — dafür braucht es Kinder, Klassenlisten
// und Ereignisse.

function makeElement(tag) {
  const el = {
    tagName: String(tag || "div").toUpperCase(),
    className: "",
    textContent: "",
    type: "",
    children: [],
    attributes: {},
    _listeners: {},
    _parent: null,
    classList: {
      add(name) {
        if (!el.className.split(/\s+/).includes(name)) el.className = `${el.className} ${name}`.trim();
      },
      remove(name) {
        el.className = el.className.split(/\s+/).filter((c) => c && c !== name).join(" ");
      },
      contains: (name) => el.className.split(/\s+/).includes(name)
    },
    setAttribute(name, value) { el.attributes[name] = String(value); },
    appendChild(child) {
      child._parent = el;
      el.children.push(child);
      return child;
    },
    remove() {
      if (!el._parent) return;
      const i = el._parent.children.indexOf(el);
      if (i >= 0) el._parent.children.splice(i, 1);
      el._parent = null;
    },
    addEventListener(type, fn) { el._listeners[type] = fn; },
    /** Im Test ausgelöstes Ereignis. */
    fire(type, event) {
      if (el._listeners[type]) el._listeners[type](event || { stopPropagation() {} });
    },
    querySelector(selector) {
      const wanted = selector.replace(/^\./, "");
      const walk = (node) => {
        for (const child of node.children) {
          if (child.className.split(/\s+/).includes(wanted)) return child;
          const deeper = walk(child);
          if (deeper) return deeper;
        }
        return null;
      };
      return walk(el);
    },
    /** Ersten Nachfahren mit dieser Klasse finden — Abkürzung für die Tests. */
    find(className) { return el.querySelector(`.${className}`); }
  };
  Object.defineProperty(el, "firstElementChild", { get: () => el.children[0] || null });
  return el;
}

function makeEnv() {
  const stack = makeElement("div");
  stack.className = "stack";
  // Jedes Banner zählt hier 70 Pixel plus die Lücken — die echten Werte kennt
  // nur der Browser, für die Zusage „0 heißt weg" reicht ein Ersatzmaß.
  Object.defineProperty(stack, "scrollHeight", {
    get: () => (stack.children.length === 0 ? 0 : stack.children.length * 70 + (stack.children.length - 1) * 9)
  });

  const heights = [];
  const activated = [];
  let addHandler = null;
  let timerSeq = 1;
  const timers = new Map();

  const win = {
    hudNotify: {
      ready() {},
      setHeight: (h) => heights.push(h),
      activate: (url) => activated.push(url),
      onAdd(handler) { addHandler = handler; return () => {}; }
    },
    setTimeout(fn, ms) {
      const id = timerSeq++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { return 0; },
    document: {
      querySelector: (selector) => (selector.includes("stack") ? stack : null),
      createElement: (tag) => makeElement(tag),
      createElementNS: (ns, tag) => makeElement(tag)
    }
  };
  win.window = win;

  const source = fs.readFileSync(path.join(__dirname, "..", "renderer", "notify.js"), "utf8");
  vm.runInNewContext(source, win, { filename: "notify.js" });

  return {
    stack,
    heights,
    activated,
    add: (item) => addHandler(item),
    /** Alle wartenden Zeitgeber auslösen (Ausblenden nach Ablauf/Animation). */
    flush() {
      for (let round = 0; round < 5; round++) {
        const due = Array.from(timers.entries());
        if (due.length === 0) return;
        due.forEach(([id, timer]) => {
          timers.delete(id);
          timer.fn();
        });
      }
    },
    pendingTimers: () => timers.size
  };
}

const banner = (id, extra) =>
  Object.assign({ id, title: `Titel ${id}`, body: "Text", tone: "info", url: "", dismissMs: 6500 }, extra || {});

function run() {
  // --- Höhe: der Kern ------------------------------------------------------
  {
    const env = makeEnv();
    // Beim Start ist nichts da — und genau das muss gemeldet werden, sonst
    // bliebe das Fenster in Startgröße über dem Schreibtisch liegen.
    assert.strictEqual(env.heights[0], 0, "leerer Stapel meldet Höhe 0");

    env.add(banner("a"));
    assert.strictEqual(env.stack.children.length, 1);
    assert.ok(env.heights[env.heights.length - 1] > 0, "mit Inhalt wird eine echte Höhe gemeldet");

    env.add(banner("b"));
    const zwei = env.heights[env.heights.length - 1];
    assert.ok(zwei > 70, "zwei Banner sind höher als eines");

    // Alles ausblenden lassen: erst der Ablauf, dann die Animation.
    env.flush();
    assert.strictEqual(env.stack.children.length, 0, "nach Ablauf ist der Stapel leer");
    assert.strictEqual(env.heights[env.heights.length - 1], 0, "und meldet wieder 0");
  }

  // --- Der Stapel bleibt begrenzt -----------------------------------------
  {
    const env = makeEnv();
    ["a", "b", "c", "d", "e", "f"].forEach((id) => env.add(banner(id)));

    // Die beiden ältesten sind im Ausblenden — sie hängen noch im DOM, bis die
    // Animation durch ist. Gezählt wird deshalb, was nicht ausblendet.
    const obenauf = env.stack.children.filter((c) => !c.classList.contains("is-leaving"));
    assert.strictEqual(obenauf.length, 4, "höchstens vier liegen gleichzeitig obenauf");
    assert.strictEqual(obenauf[0].find("banner-title").textContent, "Titel c", "verdrängt wird das älteste");

    env.flush();
    assert.strictEqual(env.stack.children.length, 0);
  }

  // --- Klick ---------------------------------------------------------------
  {
    const env = makeEnv();
    env.add(banner("a"));
    const card = env.stack.children[0];

    card.find("banner-body").fire("click");
    assert.deepStrictEqual(env.activated, [""], "ohne Adresse: nur die Auskunft nach vorn");
    env.flush();
    assert.strictEqual(env.stack.children.length, 0, "das angeklickte Banner geht weg");
  }

  {
    const env = makeEnv();
    env.add(banner("a", { url: "https://example.invalid/ticket" }));
    env.stack.children[0].find("banner-body").fire("click");
    assert.deepStrictEqual(
      env.activated,
      ["https://example.invalid/ticket"],
      "mit Adresse wird sie durchgereicht"
    );
  }

  // --- Schließen ist kein Klick aufs Banner --------------------------------
  {
    const env = makeEnv();
    env.add(banner("a"));
    let stopped = false;
    env.stack.children[0].find("banner-close").fire("click", { stopPropagation: () => { stopped = true; } });
    assert.ok(stopped, "der Klick darf nicht zusätzlich das Banner darunter auslösen");
    assert.deepStrictEqual(env.activated, [], "Schließen holt die Auskunft nicht nach vorn");
    env.flush();
    assert.strictEqual(env.stack.children.length, 0);
  }

  // --- Überfahren hält die Uhr an ------------------------------------------
  {
    const env = makeEnv();
    env.add(banner("a"));
    const card = env.stack.children[0];
    card.fire("mouseenter");
    assert.strictEqual(env.pendingTimers(), 0, "beim Überfahren läuft keine Uhr mehr");
    card.fire("mouseleave");
    assert.strictEqual(env.pendingTimers(), 1, "danach läuft sie wieder");
  }

  // --- Unbrauchbares ignorieren -------------------------------------------
  {
    const env = makeEnv();
    env.add(null);
    env.add({ title: "ohne ID" });
    assert.strictEqual(env.stack.children.length, 0, "ohne ID wird nichts gezeichnet");
  }

  console.log("notify.test.js: alle Szenarien bestanden.");
}

run();
