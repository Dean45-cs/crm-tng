"use strict";

// Minimaler WebSocket-Server (RFC 6455) auf 127.0.0.1 – bewusst ohne npm-
// Abhängigkeit, denn beide Seiten dieser Verbindung stammen aus diesem Repo:
// hier der Electron-Hauptprozess, dort der Service-Worker der Extension. Wir
// brauchen deshalb keine der Ausbaustufen, für die man sonst zu `ws` greift
// (permessage-deflate, Subprotokolle, Multi-Client-Broadcast über Netzwerk).
//
// Implementiert ist genau das, was diese eine Verbindung braucht:
// Handshake, Text-Frames (auch fragmentiert und über 64 KB), Ping/Pong und
// ein sauberes Close. Binärframes lehnen wir ab – das Protokoll ist JSON.

const http = require("http");
const crypto = require("crypto");

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const OP_CONTINUATION = 0x0;
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

// Obergrenze pro Nachricht. KI-Antworten sind Text im niedrigen KB-Bereich,
// 16 MB sind also reichlich – die Grenze schützt nur davor, dass ein Fehler
// auf der Gegenseite den Speicher volllaufen lässt.
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

function acceptValue(key) {
  return crypto.createHash("sha1").update(key + GUID).digest("base64");
}

// Baut einen unmaskierten Server-Frame. Nur der Client muss maskieren.
function encodeFrame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload || ""), "utf8");
  const length = body.length;

  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode; // FIN + Opcode
  return Buffer.concat([header, body]);
}

class WsConnection {
  constructor(socket, server) {
    this.socket = socket;
    this.server = server;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    // Puffer für fragmentierte Nachrichten (FIN=0 + Continuation-Frames).
    this.fragments = [];
    this.fragmentOpcode = null;
    this.isAlive = true;

    socket.on("data", (chunk) => this.onData(chunk));
    socket.on("error", () => this.destroy());
    socket.on("close", () => this.destroy());
    // "end" nicht vergessen: schließt die Gegenseite ordentlich (Chrome beendet
    // den Service-Worker), kommt ein FIN und danach – je nach Halbduplex-
    // Einstellung des Sockets – womöglich gar kein "close" mehr. Ohne diesen
    // Zweig bliebe die Verbindung als vermeintlich offen stehen.
    socket.on("end", () => this.destroy());
  }

  onData(chunk) {
    if (this.closed) return;
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    // Solange lesen, bis ein Frame unvollständig ist – TCP liefert keine
    // Frame-Grenzen, ein `data`-Ereignis kann null, ein oder viele Frames sein.
    for (;;) {
      const frame = this.readFrame();
      if (!frame) return;
      this.handleFrame(frame);
      if (this.closed) return;
    }
  }

  readFrame() {
    const buf = this.buffer;
    if (buf.length < 2) return null;

    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let length = buf[1] & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (buf.length < offset + 2) return null;
      length = buf.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buf.length < offset + 8) return null;
      const big = buf.readBigUInt64BE(offset);
      if (big > BigInt(MAX_MESSAGE_BYTES)) {
        this.close(1009, "Nachricht zu groß");
        return null;
      }
      length = Number(big);
      offset += 8;
    }

    let mask = null;
    if (masked) {
      if (buf.length < offset + 4) return null;
      mask = buf.subarray(offset, offset + 4);
      offset += 4;
    }

    if (buf.length < offset + length) return null;

    const payload = Buffer.from(buf.subarray(offset, offset + length));
    if (mask) {
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    }
    this.buffer = buf.subarray(offset + length);
    return { fin, opcode, payload };
  }

  handleFrame(frame) {
    switch (frame.opcode) {
      case OP_PING:
        this.send(OP_PONG, frame.payload);
        return;
      case OP_PONG:
        this.isAlive = true;
        return;
      case OP_CLOSE:
        this.close(1000, "");
        return;
      case OP_BINARY:
        this.close(1003, "Nur Text-Frames");
        return;
      case OP_TEXT:
      case OP_CONTINUATION:
        break;
      default:
        this.close(1002, "Unbekannter Opcode");
        return;
    }

    if (frame.opcode === OP_TEXT) {
      if (this.fragmentOpcode !== null) return this.close(1002, "Verschachtelte Fragmente");
      if (frame.fin) return this.emitMessage(frame.payload);
      this.fragmentOpcode = OP_TEXT;
      this.fragments = [frame.payload];
      return;
    }

    // Continuation
    if (this.fragmentOpcode === null) return this.close(1002, "Continuation ohne Start");
    this.fragments.push(frame.payload);
    const total = this.fragments.reduce((sum, part) => sum + part.length, 0);
    if (total > MAX_MESSAGE_BYTES) return this.close(1009, "Nachricht zu groß");
    if (!frame.fin) return;
    const complete = Buffer.concat(this.fragments);
    this.fragments = [];
    this.fragmentOpcode = null;
    this.emitMessage(complete);
  }

  emitMessage(payload) {
    let message;
    try {
      message = JSON.parse(payload.toString("utf8"));
    } catch (error) {
      return; // kein JSON – die Gegenseite ist nicht unsere Extension
    }
    this.server.onMessage(this, message);
  }

  send(opcode, payload) {
    if (this.closed || this.socket.destroyed) return false;
    try {
      this.socket.write(encodeFrame(opcode, payload));
      return true;
    } catch (error) {
      this.destroy();
      return false;
    }
  }

  sendJson(message) {
    return this.send(OP_TEXT, JSON.stringify(message));
  }

  ping() {
    this.isAlive = false;
    this.send(OP_PING, Buffer.alloc(0));
  }

  close(code, reason) {
    if (this.closed) return;
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason || "", "utf8"));
    payload.writeUInt16BE(code || 1000, 0);
    if (reason) payload.write(reason, 2, "utf8");
    this.send(OP_CLOSE, payload);
    this.destroy();
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    try { this.socket.destroy(); } catch (error) { /* schon zu */ }
    this.server.onDisconnect(this);
  }
}

class WsServer {
  constructor(options = {}) {
    this.host = options.host || "127.0.0.1";
    this.port = options.port || 8777;
    // Entscheidet anhand des Origin-Headers, wer sich verbinden darf (siehe
    // onUpgrade). Ohne Prüfer wird jede lokale Verbindung angenommen.
    this.verifyOrigin = options.verifyOrigin || (() => true);
    // Optionaler Mitschrieb der Verbindungsversuche (Diagnose). Ohne Logger ein
    // No-Op – im Normalbetrieb wird nichts geschrieben.
    this.log = typeof options.log === "function" ? options.log : () => {};
    this.connections = new Set();
    this.handlers = { message: () => {}, connect: () => {}, disconnect: () => {} };

    this.http = http.createServer((req, res) => {
      // Ein reiner HTTP-Aufruf ist entweder ein Fehlgriff oder der
      // Erreichbarkeits-Check der Extension.
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ app: "stadtnetz-crm-hud", ok: true }));
    });
    this.http.on("upgrade", (req, socket, head) => this.onUpgrade(req, socket, head));

    // Alle 20 s ein Ping: erkennt eingeschlafene Verbindungen (Chrome hat den
    // Service-Worker beendet, Rechner war im Standby) verlässlicher als das
    // TCP-Timeout und hält den Worker zugleich wach.
    this.heartbeat = setInterval(() => {
      this.connections.forEach((conn) => {
        if (!conn.isAlive) return conn.destroy();
        conn.ping();
      });
    }, 20000);
  }

  onUpgrade(req, socket) {
    const key = req.headers["sec-websocket-key"];
    const isWebSocket = String(req.headers.upgrade || "").toLowerCase() === "websocket";
    if (!isWebSocket || !key) {
      this.log(`abgelehnt: kein WebSocket-Upgrade (origin=${req.headers.origin || "-"})`);
      socket.destroy();
      return;
    }
    // Nur lokale Verbindungen. Der Server lauscht ohnehin auf 127.0.0.1, das
    // hier ist der Riegel für den Fall, dass die Bindung mal weiter gefasst wird.
    const remote = socket.remoteAddress || "";
    if (remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1") {
      this.log(`abgelehnt: nicht-lokale Adresse ${remote}`);
      socket.destroy();
      return;
    }
    // Ohne diese Prüfung könnte jede beliebige Webseite, die im Browser offen
    // ist, sich per ws://127.0.0.1 anhängen und die Kundendaten mitlesen –
    // localhost ist für Webseiten nicht gesperrt. Der Origin-Header wird vom
    // Browser gesetzt und ist von Seitencode nicht fälschbar; erlaubt ist
    // deshalb nur die Extension selbst (chrome-extension://…).
    if (!this.verifyOrigin(req.headers.origin || "")) {
      this.log(`abgelehnt: Origin nicht erlaubt (origin=${req.headers.origin || "-"})`);
      socket.destroy();
      return;
    }
    this.log(`angenommen: ${req.headers.origin}`);

    socket.setNoDelay(true);
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptValue(key)}`,
      "\r\n"
    ].join("\r\n"));

    const conn = new WsConnection(socket, this);
    this.connections.add(conn);
    this.handlers.connect(conn);
  }

  onMessage(conn, message) {
    this.handlers.message(conn, message);
  }

  onDisconnect(conn) {
    if (!this.connections.delete(conn)) return;
    this.handlers.disconnect(conn);
  }

  on(event, handler) {
    this.handlers[event] = handler;
    return this;
  }

  broadcast(message) {
    const text = JSON.stringify(message);
    this.connections.forEach((conn) => conn.send(OP_TEXT, text));
  }

  get clientCount() {
    return this.connections.size;
  }

  listen() {
    return new Promise((resolve, reject) => {
      this.http.once("error", reject);
      this.http.listen(this.port, this.host, () => {
        this.http.removeListener("error", reject);
        resolve(this.port);
      });
    });
  }

  close() {
    clearInterval(this.heartbeat);
    this.connections.forEach((conn) => conn.close(1001, "App beendet"));
    try { this.http.close(); } catch (error) { /* lief nicht */ }
  }
}

module.exports = { WsServer, encodeFrame };
