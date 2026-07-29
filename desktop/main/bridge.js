"use strict";

// Vermittlung zwischen der Chrome-Extension (WebSocket) und dem HUD-Fenster
// (IPC). Der Hauptprozess ist dabei bewusst dumm: er spiegelt Storage, reicht
// KI-Aufrufe durch und merkt sich Schreibvorgänge, solange Chrome weg ist.
// Die gesamte Fachlogik bleibt dort, wo sie heute schon liegt – in
// extension/src/ui.js im Fenster und in extension/src/local-ai.js in Chrome.

const { WsServer } = require("./ws-server");

// Nachrichten Extension → HUD
const IN = {
  HELLO: "hello",
  SNAPSHOT: "storage-snapshot",
  CHANGED: "storage-changed",
  TICKET: "ticket",
  AI_RESULT: "ai-result",
  AI_CHUNK: "ai-chunk",
  AI_DOWNLOAD: "ai-download",
  // Der einzige Auftrag, den Chrome der App erteilt: „hol dich nach vorn".
  // Läuft die App, baut der Jira-Tab sein eigenes Panel ab (hud-agent.js) –
  // ohne diesen Weg gäbe es aus Chrome heraus keine Möglichkeit mehr, an die
  // Auskunft zu kommen, wenn sie gerade ausgeblendet ist.
  SHOW: "show",
  // Eine Mitteilung anzeigen. Chrome weiß von Dingen, die die App nicht sieht
  // (eingehender Anruf, Schichtwechsel aus dem CRM) – gezeichnet wird sie im
  // eigenen Mitteilungsfenster der App, damit sie auf Mac und Windows gleich
  // aussieht (siehe main/notifications.js).
  NOTIFY: "notify"
};

// Nachrichten HUD → Extension
const OUT = {
  SYNC: "sync",
  SET: "storage-set",
  REMOVE: "storage-remove",
  AI_CALL: "ai-call",
  AI_ABORT: "ai-abort",
  CMD: "cmd"
};

class Bridge {
  constructor({ store, port, onStatus, onShow, onNotify, log }) {
    this.store = store;
    this.onStatus = onStatus || (() => {});
    this.onShow = onShow || (() => {});
    this.onNotify = onNotify || (() => {});
    this.log = typeof log === "function" ? log : () => {};
    this.window = null;

    // Schreibvorgänge, die entstanden sind, während Chrome nicht verbunden war
    // (HUD allein gestartet, Chrome neu gestartet). Sie gehen beim nächsten
    // Verbindungsaufbau raus, bevor wir den frischen Stand anfordern.
    this.pending = [];
    this.ticket = null;
    this.extension = null;

    this.server = new WsServer({ port, verifyOrigin: (origin) => this.verifyOrigin(origin), log: this.log });
    this.server
      .on("connect", (conn) => this.onConnect(conn))
      .on("disconnect", (conn) => this.onDisconnect(conn))
      .on("message", (conn, message) => this.onMessage(conn, message));
  }

  listen() {
    return this.server.listen();
  }

  // Erlaubt ausschließlich Chrome-Extensions. Das ist der eigentliche Schutz:
  // eine beliebige Webseite im Browser hätte den Origin ihrer Domain
  // (https://…) und käme damit nicht durch – nur so kann sie sich nicht per
  // ws://127.0.0.1 anhängen und die Kundendaten mitlesen. Der Origin-Header
  // wird vom Browser gesetzt und ist von Seitencode nicht fälschbar.
  //
  // Bewusst NICHT auf eine einzelne Extension-ID festgenagelt: das würde bei
  // jeder Neuinstallation der Extension (dann ändert sich die ID) zu einer
  // stillen Abweisung führen – ein Fallstrick ohne echten Sicherheitsgewinn,
  // denn wer eine eigene Extension installieren kann, hat den Rechner ohnehin.
  verifyOrigin(origin) {
    return /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
  }

  attachWindow(window) {
    this.window = window;
  }

  toRenderer(channel, payload) {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send(channel, payload);
  }

  get connected() {
    return Boolean(this.extension);
  }

  emitStatus() {
    const status = { connected: this.connected, ticket: this.ticket };
    this.toRenderer("hud:status", status);
    this.onStatus(status);
  }

  // --- Verbindung ----------------------------------------------------------

  onConnect(conn) {
    // Nur eine Extension gleichzeitig. Ein zweites Chrome-Profil, das sich
    // dazuschaltet, würde denselben Storage doppelt spiegeln – die ältere
    // Verbindung fliegt deshalb raus.
    if (this.extension && this.extension !== conn) this.extension.close(1000, "Andere Instanz übernimmt");
    this.extension = conn;

    const queued = this.pending.splice(0);
    queued.forEach((message) => conn.sendJson(message));
    conn.sendJson({ t: OUT.SYNC });
    this.emitStatus();
  }

  onDisconnect(conn) {
    if (this.extension !== conn) return;
    this.extension = null;
    // Das zuletzt gelesene Ticket bleibt stehen: es ist der letzte bekannte
    // Stand und immer noch nützlicher als ein leeres Panel. Dass er nicht mehr
    // live ist, zeigt die Verbindungsanzeige.
    this.emitStatus();
  }

  onMessage(conn, message) {
    if (!message || typeof message.t !== "string") return;
    switch (message.t) {
      case IN.HELLO:
        this.extension = conn;
        this.emitStatus();
        return;

      case IN.SNAPSHOT: {
        const changes = this.store.replaceAll(message.data);
        if (Object.keys(changes).length) this.toRenderer("hud:storage-changed", changes);
        this.toRenderer("hud:storage-snapshot", this.store.snapshot());
        return;
      }

      case IN.CHANGED: {
        const payload = {};
        const removals = [];
        Object.keys(message.changes || {}).forEach((key) => {
          const change = message.changes[key];
          if (change && Object.prototype.hasOwnProperty.call(change, "newValue") && change.newValue !== undefined) {
            payload[key] = change.newValue;
          } else {
            removals.push(key);
          }
        });
        const changes = { ...this.store.set(payload), ...this.store.remove(removals) };
        if (Object.keys(changes).length) this.toRenderer("hud:storage-changed", changes);
        return;
      }

      case IN.TICKET:
        this.ticket = message.ticket || null;
        this.toRenderer("hud:ticket", this.ticket);
        this.emitStatus();
        return;

      case IN.AI_RESULT:
      case IN.AI_CHUNK:
      case IN.AI_DOWNLOAD:
        this.toRenderer("hud:ai", message);
        return;

      // Angefordert wird das aus Chrome (Klick auf das Symbol der Erweiterung
      // oder auf die Sprechblase im Jira-Tab). Was „nach vorn holen" genau
      // bedeutet, entscheidet main.js – hier wird nur weitergereicht.
      case IN.SHOW:
        this.onShow();
        return;

      // Inhalt kommt aus Chrome, das Aussehen aus der App. Was fehlt oder
      // Unsinn ist, fängt notifications.show() ab – die Verbindung ist zwar
      // auf localhost beschränkt und prüft die Herkunft, aber eine Nachricht
      // von außen bleibt eine Nachricht von außen.
      case IN.NOTIFY:
        this.onNotify(message.item || message);
        return;

      default:
        return;
    }
  }

  // --- Vom HUD kommend -----------------------------------------------------

  sendToExtension(message, { queue = false } = {}) {
    if (this.extension && this.extension.sendJson(message)) return true;
    if (queue) this.pending.push(message);
    return false;
  }

  storageGet(keys) {
    return this.store.get(keys);
  }

  storageSet(payload) {
    const changes = this.store.set(payload);
    // Erst lokal anwenden, dann weiterreichen: das Fenster soll auf einen Klick
    // sofort reagieren und nicht erst, wenn Chrome geantwortet hat.
    if (Object.keys(changes).length) this.toRenderer("hud:storage-changed", changes);
    this.sendToExtension({ t: OUT.SET, payload }, { queue: true });
    return changes;
  }

  storageRemove(keys) {
    const changes = this.store.remove(keys);
    if (Object.keys(changes).length) this.toRenderer("hud:storage-changed", changes);
    this.sendToExtension({ t: OUT.REMOVE, keys }, { queue: true });
    return changes;
  }

  // Gibt false zurück, wenn Chrome nicht verbunden ist – der Aufrufer im
  // Fenster antwortet dann selbst mit "lokale KI nicht verfügbar", statt auf
  // eine Antwort zu warten, die nie kommt.
  aiCall(request) {
    return this.sendToExtension({ t: OUT.AI_CALL, ...request });
  }

  aiAbort(id) {
    this.sendToExtension({ t: OUT.AI_ABORT, id });
  }

  command(name, args) {
    // Kommandos wie "timio-Tab nach vorn" ergeben ohne Chrome keinen Sinn –
    // deshalb nicht einreihen, sondern verwerfen.
    return this.sendToExtension({ t: OUT.CMD, name, args: args || {} });
  }

  close() {
    this.server.close();
  }
}

module.exports = { Bridge, IN, OUT };
