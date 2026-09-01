"use strict";

// Das Mitteilungsfenster: nimmt Banner entgegen, zeichnet sie, misst sich
// selbst und meldet die Höhe zurück. Sonst nichts — alle Entscheidungen
// darüber, WAS gemeldet wird, fallen im Hauptprozess (main/notifications.js).
//
// Die Höhe zurückzumelden ist der Kern: das Fenster ist rahmenlos und
// durchsichtig, also gibt es keine Fenstergröße, an der sich der Inhalt
// ausrichten könnte — es ist genau andersherum. Ein zu großes Fenster fienge
// Klicks ab, die dem Schreibtisch gehören.

(function notifyWindow() {
  const api = window.hudNotify;
  const stack = document.querySelector("[data-role='stack']");
  if (!api || !stack) return;

  // So viele liegen höchstens übereinander; darunter fällt das älteste heraus.
  const MAX_VISIBLE = 4;
  // Muss zur Ausblend-Animation in notify.css passen: erst wenn sie durch ist,
  // darf die Karte aus dem DOM.
  const LEAVE_MS = 220;

  const entries = new Map();

  /** Wortmarke als Inline-SVG — das Fenster lädt bewusst keine Bilddateien. */
  function markSvg() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    // Glocke, schlicht gezeichnet: dasselbe Zeichen wie an der Glocke im CRM.
    path.setAttribute(
      "d",
      "M12 3a5.5 5.5 0 0 0-5.5 5.5v3.2L5 15h14l-1.5-3.3V8.5A5.5 5.5 0 0 0 12 3Zm0 18a2.4 2.4 0 0 0 2.35-2h-4.7A2.4 2.4 0 0 0 12 21Z"
    );
    path.setAttribute("fill", "#fff");
    svg.appendChild(path);
    return svg;
  }

  function measure() {
    // scrollHeight statt getBoundingClientRect: der Stapel wächst über die
    // aktuelle Fensterhöhe hinaus, und genau diese Wunschhöhe wird gebraucht.
    const height = stack.children.length === 0 ? 0 : stack.scrollHeight + 2;
    api.setHeight(height);
  }

  function remove(id) {
    const entry = entries.get(id);
    if (!entry || entry.leaving) return;
    entry.leaving = true;
    window.clearTimeout(entry.timer);
    entry.el.classList.add("is-leaving");
    window.setTimeout(() => {
      entry.el.remove();
      entries.delete(id);
      measure();
    }, LEAVE_MS);
  }

  function arm(entry, ms) {
    window.clearTimeout(entry.timer);
    entry.timer = window.setTimeout(() => remove(entry.id), ms);
  }

  function build(item) {
    const el = document.createElement("div");
    el.className = `banner tone-${item.tone}`;

    const body = document.createElement("button");
    body.type = "button";
    body.className = "banner-body";

    const icon = document.createElement("span");
    icon.className = "banner-icon";
    icon.appendChild(markSvg());

    const text = document.createElement("span");
    text.className = "banner-text";

    const head = document.createElement("span");
    head.className = "banner-head";
    const title = document.createElement("span");
    title.className = "banner-title";
    title.textContent = item.title;
    const time = document.createElement("span");
    time.className = "banner-time";
    time.textContent = "jetzt";
    head.appendChild(title);
    head.appendChild(time);
    text.appendChild(head);

    if (item.body) {
      const msg = document.createElement("span");
      msg.className = "banner-msg";
      msg.textContent = item.body;
      text.appendChild(msg);
    }

    body.appendChild(icon);
    body.appendChild(text);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "banner-close";
    close.setAttribute("aria-label", "Mitteilung ausblenden");
    close.textContent = "✕";

    el.appendChild(body);
    el.appendChild(close);

    return { el, body, close, time };
  }

  api.onAdd((item) => {
    if (!item || !item.id) return;

    const parts = build(item);
    const entry = { id: item.id, el: parts.el, timer: 0, leaving: false, shownAt: Date.now() };
    entries.set(item.id, entry);

    parts.body.addEventListener("click", () => {
      api.activate(item.url);
      remove(item.id);
    });
    parts.close.addEventListener("click", (event) => {
      // Sonst löste der Klick zusätzlich das Banner darunter aus.
      event.stopPropagation();
      remove(item.id);
    });

    // Solange die Maus darauf liegt, läuft die Uhr nicht: wer gerade liest,
    // soll das Banner nicht mitten im Satz verlieren.
    parts.el.addEventListener("mouseenter", () => window.clearTimeout(entry.timer));
    parts.el.addEventListener("mouseleave", () => arm(entry, item.dismissMs));

    stack.appendChild(parts.el);

    // Ältestes verdrängen, wenn der Stapel zu hoch wird.
    //
    // Gezählt werden die Einträge, die NICHT schon ausblenden — nicht die
    // Kinder im DOM. remove() blendet nämlich nur aus; die Karte selbst
    // verschwindet erst nach der Animation. Über die DOM-Kinder gezählt sähe
    // die Schleife ihre eigene Wirkung nie und liefe endlos, sobald das fünfte
    // Banner ankommt.
    const living = () => Array.from(entries.values()).filter((e) => !e.leaving);
    let alive = living();
    while (alive.length > MAX_VISIBLE) {
      remove(alive[0].id);
      alive = living();
    }

    arm(entry, item.dismissMs);
    measure();
  });

  // Die Zeitangabe mitlaufen lassen — ein Banner, das jemand liegen lässt,
  // sagt sonst noch nach zehn Minuten „jetzt".
  window.setInterval(() => {
    entries.forEach((entry) => {
      const minutes = Math.floor((Date.now() - entry.shownAt) / 60000);
      const label = entry.el.querySelector(".banner-time");
      if (label) label.textContent = minutes < 1 ? "jetzt" : `vor ${minutes} Min.`;
    });
  }, 30000);

  api.ready();
  measure();
})();
