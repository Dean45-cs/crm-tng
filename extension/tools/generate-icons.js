"use strict";

// Erzeugt die Extension-Icons (icons/icon16|32|48|128.png) ohne externe
// Abhängigkeiten – reines Node mit `zlib` fürs PNG-Encoding. Motiv: ein in der
// Markenfarbe gefülltes, abgerundetes Quadrat mit einem weißen Ring (steht für
// „Anruf/Warteschlange"). Neu ausführen mit: node tools/generate-icons.js
//
// Die eigentliche Wartefeld-Zahl legt der Service-Worker als Badge über dieses
// Icon (siehe src/background.js).

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const BRAND = { r: 0x0c, g: 0x66, b: 0xe4 }; // #0C66E4
const WHITE = { r: 0xff, g: 0xff, b: 0xff };

// --- PNG-Encoder (RGBA, 8 bit) ---------------------------------------------

const CRC_TABLE = (() => {
  const table = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // Filter „None" pro Scanline
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // Bittiefe
  ihdr[9] = 6;  // Farbtyp RGBA
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

// --- Motiv ------------------------------------------------------------------

// Weiche Kante: 1 innerhalb der Form, 0 außerhalb, dazwischen linear (Antialias).
function coverage(dist, edge) {
  if (dist <= edge - 1) return 1;
  if (dist >= edge + 1) return 0;
  return (edge + 1 - dist) / 2;
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const radius = size * 0.22;          // Eckenradius des abgerundeten Quadrats
  const inset = size * 0.06;           // Rand rund ums Quadrat
  const ringOuter = size * 0.34;
  const ringInner = size * 0.19;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Abstand zum abgerundeten Quadrat (signed distance, grob).
      const dx = Math.abs(x - c) - (c - inset - radius);
      const dy = Math.abs(y - c) - (c - inset - radius);
      const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
      const squareCov = coverage(outside, radius);

      // Weißer Ring in der Mitte.
      const rDist = Math.hypot(x - c, y - c);
      const ringCov = Math.min(coverage(rDist, ringOuter), 1 - coverage(rDist, ringInner));

      let col = { r: 0, g: 0, b: 0 };
      let alpha = 0;
      if (squareCov > 0) {
        const ring = Math.max(0, Math.min(1, ringCov));
        col = {
          r: Math.round(BRAND.r * (1 - ring) + WHITE.r * ring),
          g: Math.round(BRAND.g * (1 - ring) + WHITE.g * ring),
          b: Math.round(BRAND.b * (1 - ring) + WHITE.b * ring)
        };
        alpha = Math.round(255 * squareCov);
      }
      const i = (y * size + x) * 4;
      rgba[i] = col.r;
      rgba[i + 1] = col.g;
      rgba[i + 2] = col.b;
      rgba[i + 3] = alpha;
    }
  }
  return encodePng(size, size, rgba);
}

// --- Ausgabe ----------------------------------------------------------------

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
[16, 32, 48, 128].forEach((size) => {
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, drawIcon(size));
  console.log(`icon${size}.png geschrieben (${fs.statSync(file).size} Bytes)`);
});
