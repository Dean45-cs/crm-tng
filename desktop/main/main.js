"use strict";

// Stadtnetz CRM Copilot als Desktop-App.
//
// Das Fenster ist rahmenlos und bleibt über allen anderen: dasselbe Cockpit
// wie bisher im Jira-Tab, nur eben immer sichtbar und unabhängig davon, welche
// Seite gerade im Vordergrund ist. Die Chrome-Extension bleibt bestehen und
// liefert weiterhin Ticketdaten und die lokale KI (Gemini Nano gibt es nur in
// Chrome selbst, siehe README).

const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, shell, nativeImage, screen } = require("electron");
const path = require("path");
const fs = require("fs");

const { Store } = require("./store");
const { Bridge } = require("./bridge");

const DEFAULT_PORT = 8777;
const MIN_WIDTH = 360;
const MIN_HEIGHT = 420;
const DEFAULT_BOUNDS = { width: 420, height: 760 };

// Nur eine Instanz: zwei HUDs würden sich um den Port und um die
// Extension-Verbindung streiten.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

let store = null;
let bridge = null;
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
    // Bewusst nicht transparent: das Fenster ist ohnehin durchgehend gefüllt,
    // und transparente rahmenlose Fenster lassen sich auf macOS nur noch
    // hakelig in der Größe ändern.
    backgroundColor: "#ffffff",
    resizable: true,
    skipTaskbar: false,
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
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow() {
  if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) return win.hide();
  showWindow();
}

// --- Tray ------------------------------------------------------------------

function rebuildTrayMenu() {
  if (!tray) return;
  const connected = bridge && bridge.connected;
  tray.setToolTip(connected ? "Stadtnetz CRM Copilot – mit Chrome verbunden" : "Stadtnetz CRM Copilot – wartet auf Chrome");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: connected ? "Mit Chrome verbunden" : "Wartet auf Chrome…", enabled: false },
    { type: "separator" },
    { label: "Cockpit anzeigen", click: showWindow },
    {
      label: "Immer im Vordergrund",
      type: "checkbox",
      checked: store.hudGet("alwaysOnTop", true),
      click: (item) => setAlwaysOnTop(item.checked)
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
    alwaysOnTop: store.hudGet("alwaysOnTop", true),
    notes: store.hudGet("notes", []),
    notesDraft: store.hudGet("notesDraft", ""),
    platform: process.platform,
    version: app.getVersion()
  }));

  ipcMain.on("hud:notes", (event, notes) => store.hudSet("notes", Array.isArray(notes) ? notes : []));
  ipcMain.on("hud:notes-draft", (event, text) => store.hudSet("notesDraft", typeof text === "string" ? text : ""));

  ipcMain.on("hud:command", (event, message) => {
    const name = message && message.name;
    const args = (message && message.args) || {};
    switch (name) {
      case "hide":
        if (win && !win.isDestroyed()) win.hide();
        return;
      case "minimize":
        if (win && !win.isDestroyed()) win.minimize();
        return;
      case "always-on-top":
        setAlwaysOnTop(args.enabled);
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

// --- Start -----------------------------------------------------------------

app.on("second-instance", showWindow);

app.whenReady().then(async () => {
  store = new Store(app.getPath("userData"));

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

  bridge = new Bridge({
    store,
    port: Number(process.env.HUD_PORT) || DEFAULT_PORT,
    onStatus: rebuildTrayMenu,
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
  createWindow();
  createTray();

  const accelerator = process.platform === "darwin" ? "Command+Shift+Space" : "Control+Shift+Space";
  globalShortcut.register(accelerator, toggleWindow);

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
});
