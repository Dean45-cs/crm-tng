"use strict";

// Mitteilungen der Auskunft — als eigenes Fenster, nicht als System-Meldung.
//
// Warum nicht Electrons `Notification`: die reicht an das Betriebssystem
// durch, und dort sieht sie überall anders aus — auf dem Mac das bekannte
// Banner oben rechts, unter Windows eine eckige Kachel unten rechts im
// Info-Center. Gefordert war dieselbe Optik auf beiden Systemen. Ein eigenes
// rahmenloses Fenster, das die Banner selbst zeichnet, liefert genau das: eine
// HTML-Fläche sieht unter Windows aus wie auf dem Mac.
//
// Das Fenster verhält sich wie die Mitteilungszentrale: oben rechts am Rand
// des Arbeitsbereichs, ohne Rahmen, ohne Eintrag in der Taskleiste, immer
// obenauf, nie fokussierbar (es darf einem nie die Tastatur wegnehmen) — und
// nur so groß, wie die Banner gerade brauchen. Liegt nichts an, ist es weg.

const { BrowserWindow, screen } = require("electron");
const path = require("path");

// Maße des Stapels. Die Breite ist fest (wie am Mac), die Höhe meldet der
// Renderer, sobald er weiß, wie hoch sein Inhalt wirklich ist.
const WIDTH = 372;
const MARGIN = 14;
const MIN_HEIGHT = 8;

// So lange steht ein Banner, wenn niemand es anfasst. Der Renderer zählt
// selbst herunter (und hält an, solange die Maus darauf liegt) — hier steht
// nur der Wert, den er dafür bekommt.
const DISMISS_MS = 6500;

class Notifications {
  /**
   * @param {object} options
   * @param {() => void} options.onActivate  Klick auf ein Banner: HUD nach vorn.
   * @param {(url: string) => void} options.onOpenUrl  Klick mit Ziel-Adresse.
   */
  constructor({ onActivate, onOpenUrl } = {}) {
    this.win = null;
    this.onActivate = onActivate || (() => {});
    this.onOpenUrl = onOpenUrl || (() => {});
    // Was gezeigt werden soll, bevor das Fenster geladen ist. Ohne diesen
    // Puffer ginge die allererste Meldung verloren — genau die, die man beim
    // Ausprobieren als Erstes auslöst.
    this.queue = [];
    this.ready = false;
  }

  /** Das Fenster gibt es erst, wenn wirklich etwas zu melden ist. */
  ensureWindow() {
    if (this.win && !this.win.isDestroyed()) return this.win;

    const area = screen.getPrimaryDisplay().workArea;
    this.win = new BrowserWindow({
      width: WIDTH,
      height: MIN_HEIGHT,
      x: area.x + area.width - WIDTH - MARGIN,
      y: area.y + MARGIN,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      // Eine Mitteilung darf niemandem die Tastatur wegnehmen: wer gerade in
      // einem Ticket tippt, soll weitertippen können, während das Banner
      // erscheint. Klicken lässt es sich trotzdem (acceptFirstMouse).
      focusable: false,
      acceptFirstMouse: true,
      title: "Mitteilungen",
      webPreferences: {
        preload: path.join(__dirname, "..", "preload", "notify-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    // Über allem, auch über einem Vollbild-Space — sonst käme die Meldung
    // ausgerechnet dann nicht an, wenn jemand konzentriert im Vollbild
    // arbeitet. "screen-saver" statt "floating": das eigentliche HUD liegt auf
    // "floating", und die Mitteilung soll auch darüber liegen.
    this.win.setAlwaysOnTop(true, "screen-saver");
    if (process.platform === "darwin") {
      this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    this.win.loadFile(path.join(__dirname, "..", "renderer", "notify.html"));
    this.win.on("closed", () => {
      this.win = null;
      this.ready = false;
    });

    return this.win;
  }

  /**
   * Der Renderer meldet sich, sobald er zeichnen kann. Alles, was in der
   * Zwischenzeit aufgelaufen ist, geht jetzt raus.
   */
  markReady() {
    this.ready = true;
    const pending = this.queue;
    this.queue = [];
    pending.forEach((item) => this.send(item));
  }

  send(item) {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.webContents.send("notify:add", item);
  }

  /**
   * Eine Mitteilung anzeigen.
   * @param {object} item
   * @param {string} item.title
   * @param {string} [item.body]
   * @param {"info"|"success"|"warn"|"danger"} [item.tone]
   * @param {string} [item.url]  Beim Klick im Browser öffnen (statt HUD nach vorn).
   */
  show(item) {
    if (!item || !item.title) return;
    const payload = {
      id: `n${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
      title: String(item.title),
      body: item.body ? String(item.body) : "",
      tone: ["info", "success", "warn", "danger"].indexOf(item.tone) >= 0 ? item.tone : "info",
      url: typeof item.url === "string" && /^https?:\/\//i.test(item.url) ? item.url : "",
      dismissMs: DISMISS_MS
    };

    this.ensureWindow();
    if (this.ready) this.send(payload);
    else this.queue.push(payload);
  }

  /**
   * Höhe an den Inhalt anpassen. Der Renderer misst, weil nur er weiß, wie
   * viele Zeilen ein Text am Ende umbricht.
   *
   * Höhe 0 heißt: nichts mehr da. Dann wird das Fenster versteckt statt auf
   * Null gesetzt — ein unsichtbares Fenster mit Restgröße würde sonst weiter
   * Klicks auf den Schreibtisch abfangen.
   */
  setHeight(height) {
    if (!this.win || this.win.isDestroyed()) return;
    const value = Math.max(0, Math.round(Number(height) || 0));
    if (value <= 0) {
      if (this.win.isVisible()) this.win.hide();
      return;
    }

    // Am Arbeitsbereich des Bildschirms ausrichten, auf dem der Mauszeiger
    // gerade ist: bei zwei Monitoren erwartet man die Meldung dort, wo man
    // hinsieht — nicht immer auf dem Hauptbildschirm.
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;
    const capped = Math.min(value, area.height - 2 * MARGIN);
    this.win.setBounds({
      x: area.x + area.width - WIDTH - MARGIN,
      y: area.y + MARGIN,
      width: WIDTH,
      height: capped
    });
    // showInactive statt show: das Fenster taucht auf, ohne den Fokus an sich
    // zu reißen.
    if (!this.win.isVisible()) this.win.showInactive();
  }

  /** Klick auf ein Banner: entweder die Adresse öffnen oder das HUD nach vorn. */
  activate(url) {
    if (url) this.onOpenUrl(url);
    else this.onActivate();
  }

  close() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.ready = false;
  }
}

module.exports = { Notifications, NOTIFY_WIDTH: WIDTH, NOTIFY_DISMISS_MS: DISMISS_MS };
