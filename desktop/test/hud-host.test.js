"use strict";

// Das Overlay auf dem Schreibtisch (renderer/hud-host.js).
//
// Kernzusagen dieses Umbaus:
//   1. Ohne Gastgeber (also in Chrome) ändert sich am Panel nichts – kein
//      Verbindungspunkt, kein Notizknopf, kein Overlay-Abschnitt.
//   2. Mit Gastgeber trägt der Panelkopf den Verbindungspunkt und den
//      Notizknopf – und sonst nichts Fensterartiges.
//   3. Was früher als Fensterknopf oben rechts saß (immer im Vordergrund,
//      ausblenden), steht in den Einstellungen und wirkt sofort.
//   4. Das Fenster selbst hat keine Titelleiste mehr.
//
// Ausführen mit: node test/hud-host.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { makePanelSandbox, loadScripts } = require("../../extension/test/support/stub-env");

// Pfade sind repo-relativ zu extension/ (so lädt loadScripts) – die
// Renderer-Dateien der App liegen daneben.
const SCRIPTS = [
  "src/config.js",
  "src/shared.js",
  "src/ai-cache.js",
  "src/jira-reader.js",
  "src/rules.js",
  "src/local-ai.js",
  "src/theme.js",
  "src/ui.js"
];

const HUD_HOST = "../desktop/renderer/hud-host.js";

const OVERLAY = {
  alwaysOnTop: true,
  opacity: 1,
  clickThrough: false,
  autoStart: true,
  packaged: true,
  // Systemweite Kürzel in der gemeinsamen Schreibweise (CONFIG.hotkeys).
  hotkeys: { toggleOverlay: "Mod+Shift+Space", clickThrough: "Mod+Shift+D" },
  hotkeyErrors: {}
};

async function mount(options) {
  const opts = options || {};
  const env = makePanelSandbox();
  const commands = [];

  // Attrappe der Electron-Brücke: uns interessiert nur, was das Panel dem
  // Fenster aufträgt.
  env.sandbox.hud = {
    command: (name, args) => commands.push({ name, args })
  };

  loadScripts(env.sandbox, SCRIPTS);

  if (opts.withHost !== false) {
    // notes.js braucht die echte Brücke und Supabase – hier reicht die
    // Zustandsfrage, die hud-host.js stellt.
    env.sandbox.StadtnetzCRM.hudNotes = { isOpen: () => false, toggle() {} };
    loadScripts(env.sandbox, [HUD_HOST]);
    env.sandbox.StadtnetzCRM.hudHost.setOverlay({ ...OVERLAY, ...(opts.overlay || {}) });
    env.sandbox.StadtnetzCRM.hudHost.setConnected(opts.connected !== false);
  }

  await env.sandbox.StadtnetzCRM.ui.mount();
  return { env, commands, host: env.sandbox.StadtnetzCRM.hudHost };
}

// Ein Eingabe-Ereignis am Panel (Checkbox/Regler) – ui.js hört per Delegation
// am Wurzelelement.
function fireInput(env, role, props) {
  const handler = env.root()._listeners.input;
  assert.ok(handler, "Panel hört auf input-Ereignisse");
  handler({ target: Object.assign({ dataset: { role } }, props || {}) });
}

async function run() {
  // --- 1. Ohne Gastgeber bleibt das Panel das Panel ------------------------
  {
    const { env } = await mount({ withHost: false });
    const html = env.html();
    assert.ok(!html.includes("hud-dot"), "kein Verbindungspunkt in Chrome");
    assert.ok(!html.includes('data-action="hud-notes"'), "kein Notizknopf in Chrome");
    env.click("toggle-settings");
    assert.ok(!env.html().includes("hud-always-on-top"), "kein Overlay-Abschnitt in Chrome");
    // Der Panelkopf trägt weiterhin seinen eigenen Minimieren-Knopf – in der
    // Seite ist er die einzige Möglichkeit, das Panel wegzuklappen.
    assert.ok(env.html().includes('data-action="close-panel"'), "Panel behält seinen Minimieren-Knopf in der Seite");
  }

  // --- 2. Mit Gastgeber: Kopf trägt Punkt und Notizknopf -------------------
  {
    const { env } = await mount();
    const html = env.html();
    assert.ok(html.includes("hud-dot is-connected"), "verbundener Zustand am Punkt sichtbar");
    assert.ok(html.includes('data-action="hud-notes"'), "Notizknopf sitzt im Panelkopf");
    assert.ok(!html.includes("hud-offline"), "kein Offline-Hinweis, solange Chrome verbunden ist");
  }

  // --- 3. Ohne Chrome: Hinweis als Banner im Panel -------------------------
  {
    const { env } = await mount({ connected: false });
    assert.ok(env.html().includes("hud-offline"), "getrennter Zustand erklärt sich im Panel");
    assert.ok(env.html().includes("hud-dot is-offline"), "Punkt zeigt getrennt");
    // Ohne Chrome gibt es weder lokale KI noch etwas zum erneut Prüfen – der
    // KI-Hinweis würde dieselbe Ursache ein zweites Mal melden.
    assert.ok(!env.html().includes("sc-ai-banner"), "keine zweite Warnung für dieselbe Ursache");
  }

  // --- 4. Fensterknöpfe stehen jetzt in den Einstellungen ------------------
  {
    const { env, commands } = await mount();
    env.click("toggle-settings");
    const html = env.html();
    assert.ok(html.includes("Immer im Vordergrund"), "Vordergrund-Schalter in den Einstellungen");
    assert.ok(html.includes("Klicks durchreichen"), "Klick-Durchlässigkeit in den Einstellungen");
    assert.ok(html.includes('data-action="hud-hide"'), "Ausblenden steht als Zeile in den Einstellungen");
    assert.ok(html.includes('data-action="hud-quit"'), "Beenden steht als Zeile in den Einstellungen");
    // Die Tastenkombination muss dabeistehen: ausgeblendet ist das Overlay
    // sonst nicht mehr auffindbar.
    assert.ok(html.includes("Leertaste"), "Tastenkombination zum Zurückholen steht dabei");

    // Sofort wirksam, ohne Speichern-Knopf: es sind Fenster-Schalter, keine
    // Formularfelder.
    fireInput(env, "hud-always-on-top", { checked: false });
    assert.strictEqual(JSON.stringify(commands.pop()), JSON.stringify({ name: "always-on-top", args: { enabled: false } }));

    fireInput(env, "hud-click-through", { checked: true });
    assert.strictEqual(JSON.stringify(commands.pop()), JSON.stringify({ name: "click-through", args: { enabled: true } }));

    // Ohne Autostart ist die Auskunft nach jedem Neustart des Rechners weg –
    // und ohne laufende App führt kein Weg aus Chrome zu ihr zurück.
    assert.ok(html.includes("Beim Anmelden starten"), "Autostart steht in den Einstellungen");
    fireInput(env, "hud-auto-start", { checked: true });
    assert.strictEqual(JSON.stringify(commands.pop()), JSON.stringify({ name: "auto-start", args: { enabled: true } }));

    fireInput(env, "hud-opacity", { value: "70" });
    assert.strictEqual(JSON.stringify(commands.pop()), JSON.stringify({ name: "opacity", args: { value: 0.7 } }));

    env.click("hud-hide");
    assert.strictEqual(JSON.stringify(commands.pop()), JSON.stringify({ name: "hide", args: {} }));
  }

  // --- 5. Fremd umgelegte Schalter kommen im Panel an ----------------------
  {
    const { env, host } = await mount();
    env.click("toggle-settings");
    assert.ok(!env.html().includes('data-role="hud-click-through" checked'), "Ausgangslage: Klicks kommen an");
    // Tray-Menü oder Tastenkombination – das Panel hat davon nichts mitbekommen.
    host.setOverlay({ ...OVERLAY, clickThrough: true });
    assert.ok(env.html().includes('data-role="hud-click-through" checked'), "umgelegter Schalter erscheint im Panel");
  }

  // --- 6. Das Fenster selbst hat keine Titelleiste mehr --------------------
  {
    const html = fs.readFileSync(path.join(__dirname, "..", "renderer", "index.html"), "utf8");
    assert.ok(!html.includes("hud-titlebar"), "keine eigene Titelleiste");
    assert.ok(!/data-hud="(hide|minimize|pin)"/.test(html), "keine Fensterknöpfe über der Auskunft");
    assert.ok(html.includes('data-role="hud-resize"'), "Anfasser für die Größe ist da");
  }

  // --- 7. Startbild: sichtbar ab dem ersten Bild ---------------------------
  {
    // Es muss im HTML stehen und darf nicht erst von JavaScript gebaut werden:
    // gerade der Fall „Skript kommt nicht durch" ist der, für den es da ist.
    const html = fs.readFileSync(path.join(__dirname, "..", "renderer", "index.html"), "utf8");
    assert.ok(html.includes('data-role="hud-boot"'), "das Startbild steht im HTML");
    assert.ok(html.includes('data-role="hud-boot-step"'), "es sagt, worauf gewartet wird");
    assert.ok(html.includes('data-role="hud-boot-retry"'), "und bietet einen Ausweg, wenn der Start hängt");
    assert.ok(html.indexOf('data-role="hud-boot"') < html.indexOf('<script src="boot.js">'),
      "das Startbild steht vor den Skripten – sonst käme es zu spät");
    // Der Weg zurück gehört auf das Startbild: es ist die einzige Ansicht, die
    // jede Sitzung einmal zu sehen bekommt.
    assert.ok(html.includes("Leertaste"), "die Tastenkombination steht dabei");
  }

  // --- 8. Wege zurück zur ausgeblendeten Auskunft --------------------------
  {
    const { env } = await mount();
    env.click("toggle-settings");
    const html = env.html();
    // Ausgeblendet ist die Auskunft nur so wiederzufinden – und wer den Weg
    // nicht kennt, hält sie für abgestürzt. Die Einstellungen müssen deshalb
    // alle Wege nennen, nicht nur die Tastenkombination.
    assert.ok(/Menü-\/Infoleiste/.test(html), "das Symbol in der Menü-/Infoleiste steht dabei");
    assert.ok(/Erweiterung in Chrome/.test(html), "der Klick auf das Symbol der Erweiterung steht dabei");
  }

  // --- 9. Tastenkürzel: im Fenster stehen auch die systemweiten -----------
  {
    const { env, commands, host } = await mount();
    env.click("toggle-settings");
    const html = env.html();

    assert.ok(html.includes("Tastenkürzel"), "der Abschnitt steht im Fenster");
    // Genau das ist der Unterschied zum Chrome-Tab: die beiden systemweiten
    // Kürzel registriert der Hauptprozess, also gehören sie hierhin.
    assert.ok(html.includes('data-hotkey="toggleOverlay"'), "Ein-/ausblenden ist belegbar");
    assert.ok(html.includes('data-hotkey="clickThrough"'), "Klicks durchreichen ist belegbar");
    assert.ok(html.includes('data-hotkey="palette"'), "und die Panel-Kürzel ebenso");
    assert.ok(html.includes("⌘⇧Leertaste"), "die geltende Belegung steht dabei");

    // Aufnehmen: der Auftrag geht an den Hauptprozess, nicht in den Storage –
    // systemweit registrieren kann nur er.
    const root = env.root();
    root._listeners.click({
      target: { closest: () => ({ dataset: { action: "capture-hotkey", hotkey: "toggleOverlay" } }) }
    });
    env.fireKeydown({ key: "F8", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
      preventDefault() {}, stopPropagation() {} });
    assert.strictEqual(JSON.stringify(commands.pop()),
      JSON.stringify({ name: "set-hotkey", args: { id: "toggleOverlay", binding: "F8" } }));

    // Was der Hauptprozess zurückmeldet, steht in der Zeile – auch ein „geht
    // nicht", sonst suchte man den Fehler bei sich.
    host.setOverlay({ ...OVERLAY, hotkeyErrors: { toggleOverlay: "Diese Taste ist auf diesem Gerät schon belegt." } });
    assert.ok(env.html().includes("schon belegt"), "eine abgelehnte Taste wird gemeldet");
  }

  // --- Einrichtungskarte der Telefonanlage ---------------------------------
  //
  // Ihr Zweck ist nicht das Einrichten, sondern das Nachsehen: bleiben die
  // Anrufe eines Tages aus, muss hier stehen, woran es liegt. Geprüft wird
  // deshalb vor allem, dass sie die Fälle AUSEINANDERHÄLT.
  {
    const { env, commands, host } = await mount();
    env.click("toggle-settings");

    assert.ok(env.html().includes("Telefonanlage (myApps)"), "die Karte steht in den Einstellungen");
    assert.ok(env.html().includes("Noch nie etwas empfangen"), "ohne Meldungen sagt sie das auch");

    // Die Adresse ist Sache des Hauptprozesses (dort steht das Schema). Meldet
    // er keine, wird auch keine angezeigt – lieber gar keine als eine falsche,
    // die jemand in myApps einträgt.
    assert.ok(!env.html().includes('data-role="hud-phone-url"'), "ohne gemeldete Adresse kein leeres Feld");
    host.setPhone({ url: "stadtnetzcrm://call?id=$c&nr=$I&name=$d" });
    assert.ok(env.html().includes("stadtnetzcrm://call"), "gemeldet erscheint sie zum Kopieren");
    assert.ok(env.html().includes("name=$d"), "samt dem Platzhalter, an dem die Kundenerkennung hängt");

    // Der Testanruf geht durch dieselbe Strecke wie ein echter Anruf.
    env.click("hud-phone-test");
    assert.strictEqual(commands.pop().name, "call-test", "der Testanruf-Knopf löst ihn im Hauptprozess aus");

    // Meldungen kommen an, aber es entsteht kein Gespräch: das ist der Fall,
    // den man ohne Hinweis bei myApps suchen würde – und dort liegt er nicht.
    host.setPhone({ received: 4, lastReceivedAt: Date.now(), calls: 0, recognized: 0, protocolRegistered: true, url: "stadtnetzcrm://call?id=$c&nr=$I&name=$d", platform: "darwin", telHandler: "myApps" });
    assert.ok(env.html().includes("4 Meldungen angenommen"), "die Zählung steht da");
    assert.ok(env.html().includes("liegt es nicht an myApps"), "und die Unterscheidung, wo der Fehler NICHT liegt");

    // Gespräche entstehen, aber nie mit erkanntem Kunden: dann fehlt $d.
    host.setPhone({ received: 6, lastReceivedAt: Date.now(), calls: 6, recognized: 0 });
    assert.ok(env.html().includes("name=$d"), "der Hinweis nennt den fehlenden Platzhalter");

    // macOS mit FaceTime als Standard: der Anrufen-Knopf ginge ins Leere.
    host.setPhone({ platform: "darwin", telHandler: "FaceTime" });
    assert.ok(env.html().includes("Standard für Telefonate"), "die einmalige macOS-Einstellung steht dabei");
    assert.ok(host.dialHint().includes("FaceTime"), "und der Klick auf „Anrufen“ sagt es noch einmal");

    host.setPhone({ platform: "darwin", telHandler: "myApps" });
    assert.strictEqual(host.dialHint(), "", "ist es richtig eingestellt, schweigt der Hinweis");

    // Wählen geht durch den Hauptprozess – der Renderer baut keine tel:-Adresse.
    host.dial("+4970310000000");
    assert.strictEqual(JSON.stringify(commands.pop()),
      JSON.stringify({ name: "dial", args: { number: "+4970310000000" } }));
  }

  console.log("hud-host.test.js: alle Szenarien bestanden.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
