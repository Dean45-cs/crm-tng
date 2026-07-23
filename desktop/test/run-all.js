"use strict";

// Führt alle *.test.js in test/ nacheinander aus und meldet einen von 0
// abweichenden Exit-Code, falls eines fehlschlägt. Ausführen mit:
//   npm test
//
// Bewusst dasselbe Vorgehen wie in extension/test/run-all.js: reines Node, kein
// Test-Framework als Abhängigkeit.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const dir = __dirname;
const tests = fs.readdirSync(dir).filter((name) => name.endsWith(".test.js")).sort();

let failed = 0;
tests.forEach((name) => {
  try {
    execFileSync(process.execPath, [path.join(dir, name)], { stdio: "inherit" });
  } catch (error) {
    failed++;
  }
});

if (failed) {
  console.error(`\n${failed} von ${tests.length} Testdatei(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log(`\nAlle ${tests.length} Testdateien bestanden.`);
