"use strict";

// Stadtnetz CRM Copilot als Bildschirm-Overlay.
//
// Kein Programmfenster, sondern eine Einblendung: rahmenlos, ohne Schatten und
// ohne Systemrahmen, ohne Eintrag im Dock/in der Taskleiste und ohne eigene
// Titelleiste – es liegt einfach über der Arbeitsoberfläche, so wie ein
// Spiel-Overlay über dem Spiel. Es gibt deshalb auch keinen Schließen-Knopf am
// oberen Rand: aus- und einblenden macht die Tastenkombination (und die
// Overlay-Einstellungen im Panel selbst), beendet wird über das Tray-Symbol.
//
// Angezeigt wird dasselbe Cockpit wie im Jira-Tab. Die Chrome-Extension bleibt
// bestehen und liefert weiterhin Ticketdaten und die lokale KI (Gemini Nano
// gibt es nur in Chrome selbst, siehe README).

const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, shell, nativeImage, screen, nativeTheme, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

const { Store } = require("./store");
const { Bridge } = require("./bridge");
const { Notifications } = require("./notifications");

const DEFAULT_PORT = 8777;
const MIN_WIDTH = 360;
const MIN_HEIGHT = 420;
const DEFAULT_BOUNDS = { width: 420, height: 760 };

// Ein Overlay darf nie in einen Zustand geraten, aus dem man es nicht mehr
// herausholt. Beide Tastenkombinationen gelten systemweit, auch wenn das
// Overlay gerade keine Klicks annimmt – zusammen mit dem Tray-Menü sind das
// die Rettungsanker.
//
// Welche Tasten das sind, steht in der gemeinsamen Kürzel-Liste
// (extension/src/config.js, scope "global") und ist in den Einstellungen
// änderbar; die geänderte Fassung liegt je Gerät im eigenen Speicher. Die
// Schreibweise ("Mod+Shift+Space") übersetzt shared.js nach Electron.
const GLOBAL_HOTKEY_IDS = ["toggleOverlay", "clickThrough"];

const MIN_OPACITY = 0.35;

// Nur eine Instanz: zwei HUDs würden sich um den Port und um die
// Extension-Verbindung streiten.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

let store = null;
let bridge = null;
let notifications = null;
let win = null;
let tray = null;
let quitting = false;

// Im Paket liegt die Extension unter resources/extension (siehe build.extraResources
// in package.json), in der Entwicklung daneben im Repo. Das HUD lädt von dort
// unverändert dieselben Skripte und Styles, die auch in Chrome laufen – es gibt
// bewusst keine zweite Kopie, die auseinanderlaufen könnte.
function extensionDir() {
  const packaged = path.join(process.resourcesPath || "", "extension");
  if (fs.existsSync(path.join(packaged, "src", "ui.js"))) return packaged;
  return path.join(__dirname, "..", "..", "extension");
}

function iconPath(size) {
  return path.join(extensionDir(), "icons", `icon${size}.png`);
}

// Die Kürzel-Liste und die Umsetzung ihres Formats liegen dort, wo auch das
// Panel sie liest (extension/src) – der Hauptprozess lädt genau dieselben
// Dateien statt einer zweiten Kopie. Beide sind reine Skripte ohne Abhängigkeit
// zu Chrome oder zum DOM; sie hängen ihr Ergebnis an globalThis.
let sharedCache = null;
function sharedApi() {
  if (!sharedCache) {
    require(path.join(extensionDir(), "src", "config.js"));
    require(path.join(extensionDir(), "src", "shared.js"));
    sharedCache = globalThis.StadtnetzCRM;
  }
  return sharedCache;
}

// --- Fenster ---------------------------------------------------------------

function savedBounds() {
  const saved = store.hudGet("bounds", null);
  if (!saved || typeof saved.width !== "number") return null;
  // Ein Fenster, das auf einem inzwischen abgezogenen zweiten Monitor lag,
  // wäre sonst unerreichbar – dann lieber zurück auf die Standardposition.
  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return saved.x < area.x + area.width && saved.x + saved.width > area.x
      && saved.y < area.y + area.height && saved.y + saved.height > area.y;
  });
  return visible ? saved : null;
}

function defaultBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    width: DEFAULT_BOUNDS.width,
    height: Math.min(DEFAULT_BOUNDS.height, area.height - 60),
    x: area.x + area.width - DEFAULT_BOUNDS.width - 24,
    y: area.y + 32
  };
}

function persistBounds() {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  store.hudSet("bounds", win.getBounds());
}

function createWindow() {
  const bounds = savedBounds() || defaultBounds();

  win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    frame: false,
    // Transparent, damit die abgerundeten Ecken des Panels wirklich abgerundet
    // aussehen und nicht in einem grauen Rechteck sitzen. Der Preis: macOS
    // lässt transparente rahmenlose Fenster an den Kanten nur noch hakelig
    // anfassen – deshalb hat das Panel unten rechts einen eigenen Anfasser,
    // der die Größe über "resize-by" setzt (siehe unten).
    transparent: true,
    backgroundColor: "#00000000",
    // Ohne Systemschatten: ein Schlagschatten ist das, was eine Einblendung am
    // ehesten wieder wie ein Fenster aussehen lässt. Abgehoben wird über die
    // Kante des Panels (siehe hud.css).
    hasShadow: false,
    resizable: true,
    // Kein Eintrag in Taskleiste bzw. Fensterliste – ein Overlay ist kein
    // Programm, zwischen dem man hin- und herschaltet.
    skipTaskbar: true,
    title: "Stadtnetz CRM Copilot",
    // Entscheidend für ein Fenster, das immer im Vordergrund über Chrome
    // schwebt: ohne diese Option behandelt macOS einen Klick auf das (nicht
    // fokussierte) HUD nur als "Fenster aktivieren" und schluckt ihn – der Knopf
    // reagiert erst beim zweiten Klick, und beim Überfahren erscheint der
    // Stopp-Cursor. Mit acceptFirstMouse greift schon der erste Klick.
    acceptFirstMouse: true,
    icon: process.platform === "win32" ? iconPath(128) : undefined,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Der Renderer lädt extension/src/* per file:// aus einem Ordner
      // außerhalb von renderer/ – das erlaubt erst diese Einstellung.
      webSecurity: true,
      spellcheck: true
    }
  });

  setAlwaysOnTop(store.hudGet("alwaysOnTop", true));
  setOpacity(store.hudGet("opacity", 1));
  setClickThrough(store.hudGet("clickThrough", false));
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  win.once("ready-to-show", () => {
    win.show();
    if (!process.argv.includes("--hud-dev")) return;
    win.webContents.openDevTools({ mode: "detach" });
    // Damit Fehler aus dem Fenster auch im Terminal auftauchen und nicht nur
    // in den DevTools – sonst sieht man beim Start nach dem Rechten und
    // übersieht genau das, was schiefging.
    // Die Signatur des Ereignisses hat sich zwischen den Electron-Versionen
    // geändert (früher einzelne Argumente, heute ein Objekt) – beides abfangen.
    win.webContents.on("console-message", (...params) => {
      const details = params[0] && typeof params[0] === "object" && "message" in params[0] ? params[0] : null;
      const level = details ? details.level : params[1];
      const message = details ? details.message : params[2];
      console.log(`[renderer/${level}] ${message}`);
    });
  });

  // Links (Kundenakte im CRM, Jira-Ticket, timio) gehören in den echten
  // Browser, nicht in ein zweites Electron-Fenster.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file://")) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  win.on("resize", persistBounds);
  win.on("move", persistBounds);

  // Schließen heißt verstecken: das Cockpit soll im Hintergrund weiterlaufen
  // und Anrufe mitbekommen. Beendet wird über das Tray-Menü.
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    persistBounds();
    win.hide();
  });

  bridge.attachWindow(win);
}

function setAlwaysOnTop(enabled) {
  store.hudSet("alwaysOnTop", Boolean(enabled));
  if (!win || win.isDestroyed()) return;
  // "floating" reicht, damit das Fenster über normalen Fenstern liegt, aber
  // Menüs und Dialoge des Systems nicht verdeckt.
  win.setAlwaysOnTop(Boolean(enabled), "floating");
  if (process.platform === "darwin") {
    // Damit das HUD auch sichtbar bleibt, wenn man in einen Vollbild-Space
    // wechselt (Jira im Vollbild ist bei euch der Normalfall).
    win.setVisibleOnAllWorkspaces(Boolean(enabled), { visibleOnFullScreen: true });
  }
  rebuildTrayMenu();
  broadcastOverlay();
}

// Dieselben Schalter gibt es an drei Stellen (Panel, Tray, Tastenkombination).
// Wer nicht ausgelöst hat, muss den neuen Stand trotzdem erfahren.
function broadcastOverlay() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("hud:overlay", overlayState());
}

// Durchscheinend: bei der Netz-Auskunft schaut man oft auf das, was darunter
// liegt (Dashboard, Ticketliste). Untergrenze, damit das Overlay nicht
// versehentlich unsichtbar gestellt wird und dann "weg" scheint.
function setOpacity(value) {
  const clamped = Math.min(1, Math.max(MIN_OPACITY, Number(value) || 1));
  store.hudSet("opacity", clamped);
  if (win && !win.isDestroyed()) win.setOpacity(clamped);
  broadcastOverlay();
  return clamped;
}

// Klicks durchreichen: das Overlay ist dann nur noch Anzeige, die Maus greift
// durch auf das Fenster darunter. Herausgeholt wird es über die
// Tastenkombination oder das Tray-Menü – im Panel selbst käme kein Klick mehr
// an, deshalb steht der Schalter im Einstellungstext ausdrücklich mit
// Tastenkombination dabei.
function setClickThrough(enabled) {
  const value = Boolean(enabled);
  store.hudSet("clickThrough", value);
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(value, { forward: true });
    // Ohne Fokus lässt sich sonst weder tippen noch scrollen, sobald man
    // zurückschaltet.
    if (!value) win.focus();
  }
  rebuildTrayMenu();
  broadcastOverlay();
  return value;
}

// Beim Anmelden mitstarten. Das ist für ein Overlay keine Bequemlichkeit,
// sondern der Unterschied zwischen „da" und „nicht da": die App hat kein
// Dock-Symbol und keinen Eintrag im Programmumschalter – wer sie einmal beendet
// hat (oder neu gestartet ist), findet sie nur wieder, wenn er weiß, wo sie
// liegt. Und ohne laufende App führt auch kein Weg aus Chrome zu ihr: die
// Erweiterung kann eine Verbindung aufbauen, aber kein Programm starten.
//
// Gefragt wird das System, nicht der eigene Speicher: den Eintrag kann man auch
// in den Systemeinstellungen wegnehmen, und dann stimmte ein eigener Merker
// nicht mehr.
function autoStartEnabled() {
  try {
    return Boolean(app.getLoginItemSettings().openAtLogin);
  } catch (error) {
    return false;
  }
}

function setAutoStart(enabled) {
  const value = Boolean(enabled);
  // Eine ausdrückliche Entscheidung – sie hält den Selbsteintrag unten davon ab,
  // sie beim nächsten Start wieder umzuwerfen.
  store.hudSet("autoStartChoice", value);
  try {
    app.setLoginItemSettings({ openAtLogin: value });
  } catch (error) {
    // Ein gesperrter Rechner kann das verweigern – dann bleibt es beim Handstart.
    console.error(`Autostart konnte nicht gesetzt werden: ${error.message}`);
  }
  rebuildTrayMenu();
  broadcastOverlay();
  return autoStartEnabled();
}

// Beim allerersten Start trägt sich die App selbst ein.
//
// Das ist die Voreinstellung und nicht bloß eine Bequemlichkeit: die App wird im
// Team verteilt, und dort kann niemand voraussetzen, dass jede Person nach der
// Installation noch in die Systemeinstellungen geht. Ohne Anmeldeobjekt ist die
// Auskunft nach dem ersten Neustart des Rechners weg – ohne Dock-Symbol, ohne
// Fenster, und aus Chrome heraus unerreichbar, weil eine Erweiterung kein
// Programm starten kann. Genau das ist der Zustand, in dem „das HUD lässt sich
// nicht öffnen" entsteht.
//
// Genau einmal: wer den Schalter umlegt, hat entschieden (autoStartChoice), und
// diese Entscheidung wird nie überschrieben.
function ensureAutoStart() {
  // Aus dem Quellstand heraus (`npm start`) trüge sich Electron selbst ein –
  // das brächte niemandem etwas und hinterließe einen falschen Eintrag.
  if (!app.isPackaged) return;
  if (store.hudGet("autoStartChoice", null) !== null) return;
  store.hudSet("autoStartChoice", true);
  try {
    app.setLoginItemSettings({ openAtLogin: true });
  } catch (error) {
    console.error(`Autostart konnte nicht eingerichtet werden: ${error.message}`);
  }
}

// Aus dem Ordner heraus, in den das Programm gehört.
//
// Nach dem Ziehen aus dem Installationsabbild liegt die App oft in „Downloads"
// oder wird direkt aus dem Abbild gestartet. Beides trägt sich als Anmeldeobjekt
// zwar ein, zeigt aber auf einen Pfad, den es beim nächsten Anmelden vielleicht
// nicht mehr gibt – die Auskunft startet dann stillschweigend nie wieder.
// Deshalb einmalig anbieten, sich selbst an den richtigen Ort zu legen.
function ensureInApplicationsFolder() {
  if (process.platform !== "darwin" || !app.isPackaged) return false;
  if (typeof app.isInApplicationsFolder !== "function" || app.isInApplicationsFolder()) return false;
  if (store.hudGet("moveDeclined", false)) return false;

  const answer = dialog.showMessageBoxSync({
    type: "question",
    buttons: ["In den Programme-Ordner legen", "Hier lassen"],
    defaultId: 0,
    cancelId: 1,
    title: "Stadtnetz CRM Copilot",
    message: "Die Auskunft in den Programme-Ordner legen?",
    detail: "Von dort startet sie bei jeder Anmeldung zuverlässig und ist über die Spotlight-Suche zu finden. Bleibt sie, wo sie jetzt liegt, kann sie beim nächsten Anmelden fehlen – etwa wenn der Ordner aufgeräumt oder das Installationsabbild ausgeworfen wurde."
  });

  if (answer !== 0) {
    store.hudSet("moveDeclined", true);
    return false;
  }

  try {
    // Erst die Einmal-Sperre abgeben, dann verschieben: der Umzug startet die
    // App am neuen Ort neu, und diese frische Instanz käme sonst nicht herein,
    // solange die hier noch am Beenden ist. Sie würde sich still verabschieden –
    // die App hätte sich dann installiert und wäre danach einfach nicht da.
    // Genau dieser Zustand ist beim Ausprobieren aufgetreten.
    if (typeof app.releaseSingleInstanceLock === "function") app.releaseSingleInstanceLock();
    // Verschiebt und startet neu; ab hier läuft diese Instanz nicht weiter.
    const moved = app.moveToApplicationsFolder();
    // Nicht verschoben (im Dialog abgebrochen): die Sperre wieder holen, sonst
    // liefe diese Instanz ohne Schutz gegen eine zweite weiter.
    if (!moved) app.requestSingleInstanceLock();
    return moved;
  } catch (error) {
    app.requestSingleInstanceLock();
    dialog.showMessageBoxSync({
      type: "warning",
      title: "Stadtnetz CRM Copilot",
      message: "Das Verschieben hat nicht geklappt.",
      detail: `${error.message}\n\nBitte die App von Hand in den Programme-Ordner ziehen.`
    });
    return false;
  }
}

// --- Systemweite Tastenkürzel ----------------------------------------------

// Was gerade gilt: die eigene Angabe, sonst die Voreinstellung aus der
// gemeinsamen Liste. Je Gerät gespeichert, denn welche Tasten frei sind, hängt
// am Rechner (ein anderes Programm kann eine belegen).
function globalHotkey(id) {
  const saved = store.hudGet("hotkeys", {}) || {};
  return sharedApi().shared.hotkeyFor(id, saved);
}

// Kürzel, die das System nicht hergibt. Ohne diese Rückmeldung stünde in den
// Einstellungen eine Taste, die nachweislich nichts tut – und man suchte den
// Fehler bei sich statt beim Programm, das sie schon belegt.
const globalHotkeyErrors = {};

function applyGlobalHotkeys() {
  const { shared } = sharedApi();
  const handlers = {
    toggleOverlay: toggleWindow,
    clickThrough: () => setClickThrough(!store.hudGet("clickThrough", false))
  };

  globalShortcut.unregisterAll();
  GLOBAL_HOTKEY_IDS.forEach((id) => {
    delete globalHotkeyErrors[id];
    const binding = globalHotkey(id);
    // Leer heißt bewusst abgeschaltet – dann gibt es dieses Kürzel eben nicht.
    if (!binding) return;
    const accelerator = shared.hotkeyToAccelerator(binding);
    let ok;
    try {
      ok = globalShortcut.register(accelerator, handlers[id]);
    } catch (error) {
      // Unbrauchbare Kombination (z. B. nur eine Zusatztaste) – Electron wirft.
      ok = false;
    }
    if (!ok) globalHotkeyErrors[id] = "Diese Taste ist auf diesem Gerät schon belegt – bitte eine andere wählen.";
  });

  rebuildTrayMenu();
  broadcastOverlay();
}

function setGlobalHotkey(id, binding) {
  if (GLOBAL_HOTKEY_IDS.indexOf(id) < 0) return;
  const { shared } = sharedApi();
  const saved = { ...(store.hudGet("hotkeys", {}) || {}) };
  const value = typeof binding === "string" ? binding : "";
  // Zurück auf die Voreinstellung heißt: keine eigene Angabe mehr (sonst
  // bliebe eine Kopie stehen, die eine spätere Änderung der Liste aussitzt).
  if (value === shared.hotkeyDefault(id)) delete saved[id];
  else saved[id] = value;
  store.hudSet("hotkeys", saved);
  applyGlobalHotkeys();
}

function overlayState() {
  const hotkeys = {};
  GLOBAL_HOTKEY_IDS.forEach((id) => { hotkeys[id] = globalHotkey(id); });
  return {
    alwaysOnTop: store.hudGet("alwaysOnTop", true),
    opacity: store.hudGet("opacity", 1),
    clickThrough: store.hudGet("clickThrough", false),
    autoStart: autoStartEnabled(),
    // In der Entwicklung (`npm start`) trüge sich Electron selbst als
    // Anmeldeobjekt ein, nicht die App – das Panel sagt das dann dazu, statt
    // einen Schalter anzubieten, der etwas anderes bewirkt als er verspricht.
    packaged: app.isPackaged,
    hotkeys,
    hotkeyErrors: { ...globalHotkeyErrors }
  };
}

// Größe ändern ohne Systemrahmen: der Anfasser unten rechts im Panel schickt
// die Verschiebung seit dem letzten Ereignis, hier wird sie auf die aktuellen
// Fensterkanten addiert. Position bleibt, es wächst nach rechts/unten.
function resizeBy(dx, dy) {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  win.setBounds({
    x: bounds.x,
    y: bounds.y,
    width: Math.max(MIN_WIDTH, Math.round(bounds.width + (Number(dx) || 0))),
    height: Math.max(MIN_HEIGHT, Math.round(bounds.height + (Number(dy) || 0)))
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  // Ohne Dock-Symbol ist die App unter macOS ein Hilfsprogramm – ein reines
  // win.focus() macht ihr Fenster dann nicht zuverlässig zum Tastaturfenster,
  // und in die Notizen ließe sich nichts tippen.
  if (process.platform === "darwin" && typeof app.focus === "function") app.focus({ steal: true });
  win.focus();
}

// Ein-/Ausblenden wie bei einem Spiel-Overlay: sichtbar heißt weg, weg heißt
// da. Bewusst nicht mehr am Fokus festgemacht – ein Overlay hat den Fokus
// meistens nicht (und bei durchgereichten Klicks nie), die Taste hätte es dann
// nie ausgeblendet.
function toggleWindow() {
  if (win && !win.isDestroyed() && win.isVisible()) return win.hide();
  showWindow();
}

// --- Tray ------------------------------------------------------------------

// Electron erwartet im Menü seine eigene Schreibweise; undefined heißt „keine
// Beschriftung", und genau das ist bei einem abgeschalteten Kürzel richtig.
function trayAccelerator(id) {
  const binding = globalHotkey(id);
  return binding ? sharedApi().shared.hotkeyToAccelerator(binding) : undefined;
}

function rebuildTrayMenu() {
  if (!tray) return;
  const connected = bridge && bridge.connected;
  tray.setToolTip(connected ? "Stadtnetz CRM Copilot – mit Chrome verbunden" : "Stadtnetz CRM Copilot – wartet auf Chrome");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: connected ? "Mit Chrome verbunden" : "Wartet auf Chrome…", enabled: false },
    { type: "separator" },
    // accelerator im Tray-Menü ist nur Beschriftung – registriert sind die
    // Kürzel über applyGlobalHotkeys(). Ein leeres Kürzel (abgeschaltet) darf
    // hier deshalb auch keinen Text zeigen.
    { label: "Auskunft einblenden", accelerator: trayAccelerator("toggleOverlay"), click: showWindow },
    {
      label: "Immer im Vordergrund",
      type: "checkbox",
      checked: store.hudGet("alwaysOnTop", true),
      click: (item) => setAlwaysOnTop(item.checked)
    },
    {
      // Zweiter Rettungsanker neben der Tastenkombination: wer die Klicks
      // durchgereicht hat, kommt hier immer wieder heraus.
      label: "Klicks durchreichen",
      type: "checkbox",
      accelerator: trayAccelerator("clickThrough"),
      checked: store.hudGet("clickThrough", false),
      click: (item) => setClickThrough(item.checked)
    },
    {
      label: "Beim Anmelden starten",
      type: "checkbox",
      checked: autoStartEnabled(),
      click: (item) => setAutoStart(item.checked)
    },
    { type: "separator" },
    { label: "Beenden", click: () => { quitting = true; app.quit(); } }
  ]));
}

function createTray() {
  const image = nativeImage.createFromPath(iconPath(16));
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.on("click", toggleWindow);
  rebuildTrayMenu();
}

// --- IPC -------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle("hud:storage-get", (event, keys) => bridge.storageGet(keys));
  ipcMain.on("hud:storage-set", (event, payload) => bridge.storageSet(payload));
  ipcMain.on("hud:storage-remove", (event, keys) => bridge.storageRemove(keys));

  ipcMain.handle("hud:ai-call", (event, request) => bridge.aiCall(request));
  ipcMain.on("hud:ai-abort", (event, id) => bridge.aiAbort(id));

  ipcMain.handle("hud:state", () => ({
    connected: bridge.connected,
    ticket: bridge.ticket,
    storage: bridge.storageGet(null),
    overlay: overlayState(),
    notes: store.hudGet("notes", []),
    notesDraft: store.hudGet("notesDraft", ""),
    platform: process.platform,
    version: app.getVersion()
  }));

  ipcMain.on("hud:notes", (event, notes) => store.hudSet("notes", Array.isArray(notes) ? notes : []));
  ipcMain.on("hud:notes-draft", (event, text) => store.hudSet("notesDraft", typeof text === "string" ? text : ""));

  // Mitteilungen: aus dem Panel heraus ("hud:notify") und aus dem
  // Mitteilungsfenster zurück (Höhe, Klick).
  ipcMain.on("hud:notify", (event, item) => notifications.show(item));
  ipcMain.on("notify:ready", () => notifications.markReady());
  ipcMain.on("notify:height", (event, height) => notifications.setHeight(height));
  ipcMain.on("notify:activate", (event, url) => notifications.activate(url));

  ipcMain.on("hud:command", (event, message) => {
    const name = message && message.name;
    const args = (message && message.args) || {};
    switch (name) {
      case "hide":
        if (win && !win.isDestroyed()) win.hide();
        return;
      case "always-on-top":
        setAlwaysOnTop(args.enabled);
        return;
      case "opacity":
        setOpacity(args.value);
        return;
      case "click-through":
        setClickThrough(args.enabled);
        return;
      case "auto-start":
        setAutoStart(args.enabled);
        return;
      case "set-hotkey":
        setGlobalHotkey(args.id, args.binding);
        return;
      case "resize-by":
        resizeBy(args.dx, args.dy);
        return;
      case "quit":
        quitting = true;
        app.quit();
        return;
      case "open-external":
        if (/^https?:\/\//i.test(args.url || "")) shell.openExternal(args.url);
        return;
      default:
        // Alles Übrige ist ein Auftrag an die Extension (z. B. timio-Tab nach
        // vorn holen) – dort sitzt der Zugriff auf die Chrome-Tabs.
        bridge.command(name, args);
    }
  });
}

// --- Erscheinungsbild als Overlay -------------------------------------------

// Kein Dock-Symbol und kein Eintrag im Programmumschalter: erst damit hört die
// Auskunft auf, sich wie ein zweites Programm neben Chrome anzufühlen. Sie ist
// dann nur noch über das Tray-Symbol und die Tastenkombination erreichbar –
// beides bleibt bestehen, egal wie das Fenster gerade steht.
function hideFromDock() {
  if (process.platform !== "darwin" || !app.dock) return;
  app.dock.hide();
}

// Ohne Dock-Symbol ist die App unter macOS ein Hilfsprogramm ohne Menüleiste –
// und damit wären Kopieren/Einfügen/Rückgängig im Notizfeld weg, weil deren
// Tastenkürzel über das Programmmenü laufen. Ein Menü nur mit diesen Rollen
// hält sie am Leben, ohne sichtbar zu werden.
function installEditMenu() {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [{ role: "quit" }] },
    {
      label: "Bearbeiten",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" },
        { role: "selectAll" }
      ]
    }
  ]));
}

// --- Start -----------------------------------------------------------------

app.on("second-instance", showWindow);

app.whenReady().then(async () => {
  // Das Overlay ist immer hell – auch auf einem Rechner, der gerade im dunklen
  // Modus läuft. Der Grund ist nicht Geschmack, sondern Wiedererkennung: die
  // Auskunft soll aussehen wie das CRM, und dessen Werkseinstellung ist hell
  // (siehe den Kopf von renderer/hud.css, wo das Designsystem aus src/index.css
  // aufs Panel übersetzt ist). Der Systemfarbe zu folgen hieße, mal wie das CRM
  // und mal wie etwas anderes auszusehen; der Theme-Wahl des CRM zu folgen wäre
  // das Richtige, ist aber noch nicht verdrahtet.
  //
  // Technisch hängt daran mehr als die Optik: nur so greift in renderer/ der
  // Hell-Block aus extension/styles/content.css, auf dem hud.css aufsetzt –
  // sonst blieben dort Reste des Dunkelblocks stehen. Wer sich in den
  // Einstellungen ein eigenes Theme einfärbt, überschreibt die Farbrollen
  // weiterhin über theme.js per Inline-Stil.
  nativeTheme.themeSource = "light";

  // Windows ordnet Fenster und Meldungen über diese Kennung einer Anwendung
  // zu. Ohne sie stünde an einer System-Meldung „Electron" statt des
  // Produktnamens, und ein angehefteter Eintrag in der Taskleiste zeigte auf
  // das falsche Programm. Muss zur appId in package.json (build.appId) passen.
  if (process.platform === "win32") app.setAppUserModelId("de.stadtnetz.crm.hud");

  store = new Store(app.getPath("userData"));

  // Beides gehört vor alles Übrige: das Verschieben startet die App neu, und
  // dann wäre jede Vorbereitung davor umsonst gewesen (und der Port doppelt
  // belegt).
  if (ensureInApplicationsFolder()) return;
  ensureAutoStart();

  // Verbindungs-Diagnose: hält die letzten Andock-Versuche der Extension fest
  // (angenommen/abgelehnt inkl. Grund), damit "wird nicht grün" nachvollziehbar
  // wird, ohne die Service-Worker-Konsole in Chrome öffnen zu müssen. Die Datei
  // liegt im Benutzerprofil der App.
  const debugLogPath = path.join(app.getPath("userData"), "hud-debug.log");
  const bridgeLog = (line) => {
    try {
      fs.appendFileSync(debugLogPath, `${new Date().toISOString()}  ${line}\n`);
    } catch (error) { /* nicht schreibbar – Diagnose ist verzichtbar */ }
  };

  // Mitteilungen als eigenes Fenster statt System-Meldung — gleiche Optik auf
  // Mac und Windows (siehe main/notifications.js). Ein Klick holt die Auskunft
  // nach vorn; trägt die Meldung eine Adresse, geht die in den echten Browser.
  notifications = new Notifications({
    onActivate: () => showWindow(),
    onOpenUrl: (url) => shell.openExternal(url)
  });

  bridge = new Bridge({
    store,
    port: Number(process.env.HUD_PORT) || DEFAULT_PORT,
    onStatus: rebuildTrayMenu,
    // Meldungen aus Chrome: die Extension weiß von Anrufen, Schichtwechseln
    // und Kampagnen, das Fenster zeichnet sie.
    onNotify: (item) => notifications.show(item),
    // Der Rückweg aus Chrome: dort ist das Panel abgebaut, solange die App
    // läuft – ohne diesen Haken bliebe eine ausgeblendete Auskunft nur über
    // Tastenkombination und Tray erreichbar, und wer beides nicht kennt, hält
    // die App für weg.
    onShow: () => showWindow(),
    log: bridgeLog
  });

  try {
    await bridge.listen();
  } catch (error) {
    // Belegter Port: meistens ein zweites HUD oder ein anderer Dienst. Das
    // Fenster startet trotzdem – es zeigt dann eben "nicht verbunden".
    console.error(`HUD-Bridge konnte Port nicht öffnen: ${error.message}`);
  }

  registerIpc();
  installEditMenu();
  hideFromDock();
  createWindow();
  createTray();

  applyGlobalHotkeys();

  app.on("activate", showWindow);
});

app.on("window-all-closed", () => {
  // Nichts tun: Das HUD lebt im Tray weiter, auch wenn das Fenster zu ist.
});

app.on("before-quit", () => {
  quitting = true;
  persistBounds();
  store.flush();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (bridge) bridge.close();
  if (notifications) notifications.close();
});
