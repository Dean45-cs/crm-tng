"use strict";

// Minimaler WebSocket-Client für die Tests. Spielt die Chrome-Extension nach –
// insbesondere mit dem Origin-Header, denn genau daran entscheidet der Server,
// wer sich verbinden darf.

const http = require("http");
const crypto = require("crypto");

const DEFAULT_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

function maskedTextFrame(text) {
  const body = Buffer.from(text, "utf8");
  const mask = crypto.randomBytes(4);
  let header;
  if (body.length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | body.length;
  } else if (body.length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  header[0] = 0x81; // FIN + Text
  const masked = Buffer.from(body);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

function connect(port, { origin = DEFAULT_ORIGIN } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64"),
      "Sec-WebSocket-Version": "13"
    };
    if (origin) headers.Origin = origin;

    const request = http.request({ host: "127.0.0.1", port, path: "/", headers });

    request.on("upgrade", (res, socket, head) => {
      const messages = [];
      const waiters = [];
      let buffer = Buffer.alloc(0);

      function ingest(chunk) {
        buffer = Buffer.concat([buffer, chunk]);
        for (;;) {
          if (buffer.length < 2) return;
          const opcode = buffer[0] & 0x0f;
          let length = buffer[1] & 0x7f;
          let offset = 2;
          if (length === 126) {
            if (buffer.length < 4) return;
            length = buffer.readUInt16BE(2);
            offset = 4;
          } else if (length === 127) {
            if (buffer.length < 10) return;
            length = Number(buffer.readBigUInt64BE(2));
            offset = 10;
          }
          if (buffer.length < offset + length) return;
          const payload = buffer.subarray(offset, offset + length).toString("utf8");
          buffer = buffer.subarray(offset + length);
          if (opcode !== 0x1) continue;
          const message = JSON.parse(payload);
          messages.push(message);
          const waiter = waiters.find((entry) => entry.match(message));
          if (waiter) {
            waiters.splice(waiters.indexOf(waiter), 1);
            waiter.resolve(message);
          }
        }
      }

      socket.on("data", ingest);
      // Frames, die im selben TCP-Paket wie die Handshake-Antwort ankommen,
      // stehen bereits in `head` und lösen kein `data`-Ereignis mehr aus.
      if (head && head.length) ingest(head);

      resolve({
        messages,
        send: (message) => socket.write(maskedTextFrame(JSON.stringify(message))),
        // Wartet auf die erste Nachricht eines Typs – auch wenn sie schon
        // eingetroffen ist, bevor gewartet wurde.
        waitFor(type, timeoutMs = 2000) {
          const match = (message) => message.t === type;
          const already = messages.find(match);
          if (already) return Promise.resolve(already);
          return new Promise((res, rej) => {
            const entry = { match, resolve: res };
            waiters.push(entry);
            setTimeout(() => {
              const idx = waiters.indexOf(entry);
              if (idx >= 0) waiters.splice(idx, 1);
              rej(new Error(`Zeitüberschreitung beim Warten auf "${type}"`));
            }, timeoutMs).unref();
          });
        },
        // Sauber beenden (FIN), damit die Gegenseite es sofort merkt. Ein
        // hartes destroy() bliebe unbemerkt, bis der Heartbeat zuschlägt –
        // genau wie ein abgestürztes Chrome.
        close: () => socket.end(),
        kill: () => socket.destroy()
      });
    });

    request.on("response", (res) => reject(new Error(`kein Upgrade, Status ${res.statusCode}`)));
    request.on("error", reject);
    request.end();
  });
}

module.exports = { connect, DEFAULT_ORIGIN };
