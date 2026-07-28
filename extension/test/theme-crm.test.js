"use strict";

// Rollen-Mapping CRM-Palette → Extension-Theme (src/theme.js).
//
// Der Kern der Sache: beide Seiten benutzen ein rollenbasiertes Schema, aber
// nicht dasselbe — und die Preset-Namen kollidieren mit UNTERSCHIEDLICHER
// Bedeutung ("crm" ist hier #00336e, im CRM #0066b3). Diese Tests halten
// deshalb sowohl die Übersetzung als auch die konkreten CRM-Preset-Werte fest,
// die in src/theme.js dupliziert liegen (die Extension hat keinen Build-Schritt
// und kann src/lib/palette.ts nicht importieren). Ändert sich dort ein Preset,
// schlägt hier ein Test fehl statt die Farben still auseinanderlaufen zu lassen.
//
// Ausführen mit: node test/theme-crm.test.js

const assert = require("assert");
const { makeWorkerSandbox, loadScripts } = require("./support/stub-env");

function load() {
  const env = makeWorkerSandbox();
  loadScripts(env.sandbox, ["src/theme.js"]);
  return env.sandbox.StadtnetzCRM.themeEngine;
}

function run() {
  const engine = load();
  const { crmPaletteToTheme, CRM_PRESETS, ROLE_TO_VAR } = engine;

  // Die Objekte kommen aus der vm-Sandbox und haben ein anderes
  // Object.prototype als der Testprozess — assert.deepStrictEqual würde daran
  // scheitern. Deshalb über die Schlüssel/Werte vergleichen.
  const keysOf = (obj) => Object.keys(obj).sort();
  const plain = (obj) => JSON.parse(JSON.stringify(obj));

  // --- Standardfall: nichts angefasst → nichts übernehmen -------------------
  // Wichtig fürs Verhalten, nicht bloß Kosmetik: content.css definiert für jede
  // Rolle einen prefers-color-scheme:dark-Wert, und ein Inline-Style gewinnt
  // dagegen immer. Würde hier pauschal übersetzt, wäre der Dunkelmodus des
  // Panels für JEDEN kaputt, der im CRM nie eine Farbe gewählt hat.
  {
    const t = crmPaletteToTheme({ presetId: "crm", overrides: {} });
    assert.deepStrictEqual(keysOf(t.overrides), [], "unveränderte CRM-Palette darf nichts überschreiben");
    assert.strictEqual(t.presetId, "jira");
  }
  {
    const t = crmPaletteToTheme(null);
    assert.deepStrictEqual(keysOf(t.overrides), [], "fehlende Palette verhält sich wie der Standard");
  }

  // --- Anderes Preset → alle Rollen übersetzen ------------------------------
  {
    const t = crmPaletteToTheme({ presetId: "jira", overrides: {} });
    assert.strictEqual(t.overrides.ink, CRM_PRESETS.jira.textPrimary, "textPrimary → ink");
    assert.strictEqual(t.overrides.muted, CRM_PRESETS.jira.textMuted, "textMuted → muted");
    assert.strictEqual(t.overrides.line, CRM_PRESETS.jira.border, "border → line");
    assert.strictEqual(t.overrides.soft, CRM_PRESETS.jira.background, "background → soft");
    assert.strictEqual(t.overrides.surface, CRM_PRESETS.jira.surface, "surface → surface");
    assert.strictEqual(t.overrides.accent, CRM_PRESETS.jira.accent);
    assert.strictEqual(t.overrides.accentDark, CRM_PRESETS.jira.accentDark);
  }

  // --- Namensgleiche Presets bedeuten NICHT dasselbe ------------------------
  // Der eigentliche Grund, warum es dieses Mapping überhaupt gibt: ein direktes
  // Durchreichen von presetId würde hier stillschweigend die falschen Farben
  // setzen.
  {
    const extensionCrmAccent = engine.PRESETS.crm.accent;
    assert.strictEqual(extensionCrmAccent, "#00336e", "Extension-Preset 'crm' ist TNG-Navy");
    assert.strictEqual(CRM_PRESETS.crm.accent, "#0066b3", "CRM-Preset 'crm' ist das hellere TNG-Blau");
    assert.notStrictEqual(extensionCrmAccent, CRM_PRESETS.crm.accent);
  }

  // --- Einzelne Overrides bei Standard-Preset -------------------------------
  {
    const t = crmPaletteToTheme({ presetId: "crm", overrides: { accent: "#ff0000" } });
    assert.deepStrictEqual(keysOf(t.overrides), ["accent"], "nur die angefasste Rolle reist mit");
    assert.strictEqual(t.overrides.accent, "#ff0000");
  }

  // --- amber/amberSoft werden aus warning abgeleitet ------------------------
  // Das CRM kennt diese Rollen nicht; ohne Ableitung blieben die Hinweisflächen
  // des Panels als einzige in der alten Farbe stehen.
  {
    const t = crmPaletteToTheme({ presetId: "crm", overrides: { warning: "#ff9500" } });
    assert.strictEqual(t.overrides.warning, "#ff9500");
    assert.strictEqual(t.overrides.amber, "#ff9500", "amber folgt der Warnfarbe");
    // 88 % Richtung Weiß — liegt dicht am Extension-Standard #fff4e5, damit
    // die Hinweisflächen ihre gewohnte Leichtigkeit behalten.
    assert.strictEqual(t.overrides.amberSoft, "rgb(255, 242, 224)", "amberSoft ist die aufgehellte Warnfarbe");
  }
  {
    // Ohne warning-Änderung darf amber nicht angefasst werden.
    const t = crmPaletteToTheme({ presetId: "crm", overrides: { accent: "#123456" } });
    assert.strictEqual(t.overrides.amber, undefined);
    assert.strictEqual(t.overrides.amberSoft, undefined);
  }
  {
    // Nicht-Hex (theoretisch aus einem fremden Client) darf keine kaputte
    // Farbe berechnen — dann lieber amber unangetastet lassen.
    const t = crmPaletteToTheme({ presetId: "crm", overrides: { warning: "rgba(1,2,3,0.5)" } });
    assert.strictEqual(t.overrides.warning, "rgba(1,2,3,0.5)");
    assert.strictEqual(t.overrides.amber, undefined);
  }

  // --- Robustheit gegen Müll aus der Datenbank ------------------------------
  {
    const t = crmPaletteToTheme({ presetId: "gibt-es-nicht", overrides: { unbekannteRolle: "#fff" } });
    assert.deepStrictEqual(keysOf(t.overrides), [], "unbekanntes Preset fällt auf den CRM-Standard zurück");
  }
  {
    const t = crmPaletteToTheme({ presetId: "jira", overrides: null });
    assert.strictEqual(t.overrides.ink, CRM_PRESETS.jira.textPrimary, "overrides=null darf nicht werfen");
  }
  {
    const t = crmPaletteToTheme({ presetId: "crm", overrides: { accent: 42 } });
    assert.deepStrictEqual(keysOf(t.overrides), [], "nicht-string-Werte werden verworfen");
  }

  // --- Jede übersetzte Rolle muss eine CSS-Variable haben -------------------
  // Sonst schriebe applyTheme() ins Leere.
  {
    const t = crmPaletteToTheme({ presetId: "jira", overrides: { warning: "#ff9500" } });
    Object.keys(t.overrides).forEach((role) => {
      assert.ok(ROLE_TO_VAR[role], `Rolle '${role}' hat keine --sc-Variable`);
    });
  }

  // --- Das Ergebnis übersteht normalizeThemeState() ------------------------
  // ui.js lädt den zwischengespeicherten Stand beim Start durch diesen Filter;
  // fiele dabei etwas heraus, sähe das Panel nach einem Neustart anders aus.
  {
    const t = crmPaletteToTheme({ presetId: "jira", overrides: { warning: "#ff9500" } });
    assert.deepStrictEqual(plain(engine.normalizeThemeState(t)), plain(t), "Rundreise durch normalizeThemeState");
  }

  console.log("theme-crm.test.js: alle Prüfungen bestanden");
}

run();
