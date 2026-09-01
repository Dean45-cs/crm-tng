"use strict";

// Erzeugt das Programmsymbol der Desktop-App: build/icon.png in 1024 × 1024.
// electron-builder macht daraus beim Paketieren selbst .icns (macOS) und .ico
// (Windows) – ohne diese Datei trägt die App das Standard-Electron-Symbol, und
// im Team sucht dann jeder nach einem grauen Atom statt nach dem Stadtnetz-Blau.
//
// Gezeichnet wird mit demselben Code wie die Extension-Icons
// (extension/tools/generate-icons.js) – ein Motiv, zwei Auslieferungen.
//
// Neu erzeugen mit: node tools/generate-app-icon.js

const fs = require("fs");
const path = require("path");

const { drawIcon } = require("../../extension/tools/generate-icons");

const SIZE = 1024;
const outDir = path.join(__dirname, "..", "build");
const outFile = path.join(outDir, "icon.png");

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, drawIcon(SIZE));
console.log(`build/icon.png geschrieben (${SIZE}×${SIZE}, ${fs.statSync(outFile).size} Bytes)`);
