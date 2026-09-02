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

const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, shell, nativeImage, screen, nativeTheme, dialog, powerMonitor } = require("electron");
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

// Anrufe aus myApps (innovaphone).
//
// myApps kann unter „Einstellungen · Externe Anwendungen" bei einem
// Anruf-Ereignis eine Webadresse öffnen und dabei Platzhalter ersetzen. Genau
// das ist unser Draht zur Telefonanlage – die einzige Alternative wäre, das
// Fenster eines fremden Programms auszulesen, und myApps läuft als
// eigenständige App, nicht als Seite im Browser.
//
// Ein eigenes URL-Schema statt eines Pfads auf die App: unter macOS ist es
// nicht verlässlich, einem .app-Bundle Argumente mitzugeben (je nachdem, wie
// der Aufrufer startet, kommen sie gar nicht an). Eine URL reicht das System
// dagegen sauber an die registrierte – auch schon laufende – App durch.
//
// Was myApps liefert (Hilfe im Dialog): $n Rufnummer, $N national, $I
// international (+49…), $u URI, $d Displayname, $c Conference-ID. Die
// Conference-ID ist der wertvollste Teil: eine stabile Kennung pro Gespräch,
// an der sich wiederholte Aufrufe als derselbe Anruf erkennen lassen.
const { PROTOCOL: CALL_PROTOCOL, parseCallUrl, callUrlFromArgv } = require("./call-url");
const { parseLsof, parseNetstat, isMediaSocket, createMediaWatcher } = require("./media-watch");
const { createTraceCursor } = require("./call-trace");

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

// --- Anrufe aus myApps -----------------------------------------------------
//
// Eine Meldung kommt als `stadtnetzcrm://call?id=…&nr=…` herein – je nach
// System auf zwei Wegen (open-url unter macOS, als Argument unter Windows) und
// zu jedem Zeitpunkt, auch als allererstes noch vor dem Fenster. Alles davon
// endet hier und geht von hier aus als EINE Nachricht an das Panel, das den
// Rest macht (renderer/hud-host.js).

// Zwischenlager für Meldungen, die eintreffen, bevor das Panel steht. Genau der
// Fall, den man am wenigsten verlieren darf: ein Anruf, der die App erst
// startet, meldet sich, während der Renderer noch lädt.
let pendingCalls = [];
let rendererReady = false;

function deliverCall(call) {
  if (!rendererReady || !win || win.isDestroyed()) {
    // Mehr als eine Handvoll ist kein Rückstand, sondern ein Fehler – dann
    // lieber die ältesten fallen lassen als unbegrenzt sammeln.
    pendingCalls = pendingCalls.concat(call).slice(-5);
    return;
  }
  win.webContents.send("hud:call", call);
}

function flushPendingCalls() {
  if (!pendingCalls.length) return;
  const queued = pendingCalls;
  pendingCalls = [];
  // Aufgestaut heißt: die Meldung kam, bevor es ein Fenster gab – der Anruf hat
  // die App also gerade erst gestartet. handleCallUrl konnte damals nicht nach
  // vorn holen, was es noch nicht gab; hier ist der Nachholtermin. Ohne das
  // liefe der wichtigste Fall ins Leere: ein Anruf kommt, die App startet, und
  // die Auskunft bleibt unsichtbar.
  showWindow();
  queued.forEach(deliverCall);
}

/**
 * Nimmt eine URL an, egal woher. Holt das Fenster nach vorn: Ein Anruf ist der
 * Moment, in dem die Auskunft gebraucht wird – ausgeblendet nützt sie nichts.
 */
function handleCallUrl(raw, options) {
  const call = parseCallUrl(raw);
  if (!call) return false;
  // Die Test-Markierung kommt ausdrücklich NICHT aus der Adresse: sonst könnte
  // ein fremdes Programm Anrufe als Testanrufe kennzeichnen und damit an der
  // Anrufhistorie vorbeischleusen. Sie wird hier gesetzt, und nur hier.
  if (options && options.test) call.test = true;
  if (app.isReady()) showWindow();
  recordCallUrl(call);
  deliverCall(call);
  return true;
}

// --- Was die Einrichtungskarte anzeigt --------------------------------------
//
// Ohne Zählung ist „es kommt nichts an" nicht von „es ruft gerade niemand an"
// zu unterscheiden — und das ist bei einer Anbindung, die man einmal einträgt
// und danach nie wieder ansieht, der einzige Fehler, mit dem zu rechnen ist.
//
// Zwei Zahlen mit verschiedener Aussage: `received` zählt, was an der Tür
// ankam, `calls` zählt, was daraus im Panel geworden ist. Klaffen sie
// auseinander, liegt es nicht an myApps.

const PHONE_STATS_DEFAULT = {
  received: 0, lastReceivedAt: 0, calls: 0, recognized: 0, lastCallAt: 0, lastTestAt: 0,
  // Das Gespraechsende (siehe main/media-watch.js). Aus demselben Grund
  // gezaehlt wie die Anrufe selbst: eine Erkennung, die sich bei Unklarheit
  // still selbst abschaltet, ist sonst nicht von einer kaputten zu
  // unterscheiden.
  mediaSeen: 0, autoEnds: 0, lastMediaAt: 0, lastEndReason: "",
  // Ereignisse aus dem Protokoll von myApps – zeigt, ob die Protokollierung
  // dort eingeschaltet ist. Ohne sie kommt hier nie etwas an.
  traceEvents: 0
};

// Meldungen, die eintreffen, bevor es den Store gibt. Das ist kein Randfall,
// sondern der wichtigste: ein Anruf, der die App überhaupt erst startet, kommt
// über open-url herein, bevor app.whenReady() den Store angelegt hat. Ohne
// dieses Zwischenlager zählte die Einrichtungskarte ausgerechnet den Anruf
// nicht, der beweist, dass die Anbindung steht.
let pendingPhoneEvents = [];

function phoneStats() {
  const saved = store ? store.hudGet("phoneStats", null) : null;
  return { ...PHONE_STATS_DEFAULT, ...(saved && typeof saved === "object" ? saved : {}) };
}

function updatePhoneStats(apply) {
  if (!store) {
    pendingPhoneEvents = pendingPhoneEvents.concat(apply).slice(-20);
    return;
  }
  const stats = phoneStats();
  apply(stats);
  store.hudSet("phoneStats", stats);
  pushPhoneState();
}

function flushPhoneEvents() {
  if (!pendingPhoneEvents.length || !store) return;
  const queued = pendingPhoneEvents;
  pendingPhoneEvents = [];
  const stats = phoneStats();
  queued.forEach((apply) => apply(stats));
  store.hudSet("phoneStats", stats);
  pushPhoneState();
}

function recordCallUrl(call) {
  // Ein Testanruf zählt bewusst NICHT als empfangene Meldung: sonst stünde in
  // der Karte, es seien Anrufe angekommen, obwohl sie nur selbst geklopft hat.
  // Er bekommt seine eigene Zeile.
  const now = Date.now();
  if (call && call.test) {
    updatePhoneStats((stats) => { stats.lastTestAt = now; });
    return;
  }
  updatePhoneStats((stats) => {
    stats.received += 1;
    stats.lastReceivedAt = now;
  });
}

/** Rückmeldung aus dem Panel: aus der Meldung ist ein Gespräch geworden. */
function recordCallSeen(event) {
  if (!event || event.test) return;

  // Wie ein Gespräch geendet hat. Das gehört nicht in die Anrufhistorie – dort
  // zählt die Dauer, nicht wie wir sie erfahren haben – aber sehr wohl in die
  // Einrichtungskarte: eine Erkennung, die sich bei Unklarheit selbst
  // abschaltet, ist sonst nicht von einer kaputten zu unterscheiden.
  if (event.type === "call-end") {
    logLine(`call-end: ${event.reason} (Medien gesehen: ${event.sawMedia ? "ja" : "nein"}, ${event.durationS}s)`);
    updatePhoneStats((stats) => {
      stats.lastEndReason = String(event.reason || "");
      if (event.reason === "aufgelegt-erkannt") stats.autoEnds += 1;
    });
    return;
  }

  if (event.type !== "call") return;
  const now = Date.now();
  updatePhoneStats((stats) => {
    stats.calls += 1;
    if (event.recognized) stats.recognized += 1;
    stats.lastCallAt = now;
  });
}

/**
 * Die Adresse, die in myApps einzutragen ist. An einer Stelle gebaut, damit
 * die Einrichtungskarte nicht eine andere anzeigt, als call-url.js versteht.
 */
function callUrlTemplate() {
  return `${CALL_PROTOCOL}://call?id=$c&nr=$I&name=$d`;
}

function testCallUrl() {
  // Bewusst eine Kundennummer, die es nicht gibt: der Selbsttest soll zeigen,
  // dass die Strecke steht — nicht die Akte eines echten Kunden aufreißen.
  return `${CALL_PROTOCOL}://call?id=selbsttest-${Date.now()}&nr=%2B4970310000000&name=${encodeURIComponent("PK 000000 Testanruf")}`;
}

/**
 * Als was ein Anruf gilt, dessen Richtung sonst nirgends herkommt.
 *
 * myApps liefert sie nicht (dieselbe Konfiguration für ankommend und abgehend),
 * und aus dem Gesprächsverlauf ist sie nicht ableitbar. Sie steht deshalb hier
 * — als Einstellung, die man sehen und ändern kann.
 *
 * Vorher hing das an einem Storage-Schlüssel aus der Zeit vor dem
 * Outbound-Umbau. Den setzt seitdem niemand mehr, ein alter Wert stand aber
 * weiter darin — und machte aus jedem Anruf einen eingehenden, ohne dass
 * irgendwo etwas aufgelaufen wäre. Eine Einstellung, die niemand mehr ändern
 * kann, ist keine Einstellung, sondern eine Falle.
 */
function phoneDirection() {
  return store && store.hudGet("phoneDirection", "outbound") === "inbound" ? "inbound" : "outbound";
}

function setPhoneDirection(value) {
  if (!store) return;
  store.hudSet("phoneDirection", value === "inbound" ? "inbound" : "outbound");
  pushPhoneState();
}

function phoneState() {
  return {
    ...phoneStats(),
    direction: phoneDirection(),
    url: callUrlTemplate(),
    // Ist das Schema überhaupt bei uns registriert? Aus dem Quellstand heraus
    // trägt sich Electron ein, nicht die App – dann steht hier zwar „ja", aber
    // verlassen sollte man sich darauf erst im gepackten Paket.
    protocolRegistered: safeCall(() => app.isDefaultProtocolClient(CALL_PROTOCOL), false),
    packaged: app.isPackaged,
    // Wer tel:-Adressen bekommt. Unter macOS ist das ab Werk FaceTime, und
    // dann klingelt beim Wählen nichts in der Telefonanlage – ohne diese
    // Anzeige wäre das ein Rätsel ohne Hinweis.
    telHandler: safeCall(() => app.getApplicationNameForProtocol("tel://"), ""),
    platform: process.platform,
    // Die letzte Messung am Medien-Socket, für den Prüfknopf. null heißt: noch
    // nie gemessen – nicht „nichts gefunden".
    mediaProbe: mediaProbeResult,
    // Ob das Protokoll von myApps gefunden wird. Ohne eingeschaltete
    // Protokollierung existiert es zwar, wächst aber nicht.
    trace: traceState()
  };
}

function safeCall(fn, fallback) {
  try {
    const value = fn();
    return value === undefined || value === null ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function pushPhoneState() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("hud:phone", phoneState());
}

/**
 * Wählen über die Telefonanlage. Eigener Befehl statt „open-external", das
 * absichtlich nur https?:// durchlässt — hier wird eine zweite, eng gefasste
 * Tür aufgemacht: nur Ziffern, höchstens ein führendes Plus. Die Adresse baut
 * der Hauptprozess selbst, damit aus dem Fenster keine beliebige URL an die
 * Systemschale gereicht werden kann.
 */
function dial(number) {
  const cleaned = String(number == null ? "" : number).replace(/[\s()\/.-]/g, "");
  if (!/^\+?[0-9]{3,20}$/.test(cleaned)) return false;
  shell.openExternal(`tel:${cleaned}`);
  return true;
}

/**
 * Eine Zeile in die Protokolldatei im Benutzerprofil (hud-debug.log) — dieselbe
 * Datei, in der auch die Andock-Versuche der Extension landen.
 *
 * Wird vor `app.whenReady()` aufgerufen, gibt es noch keinen userData-Pfad;
 * dann fällt die Zeile weg. Diagnose ist verzichtbar, die App nicht.
 */
function logLine(line) {
  try {
    fs.appendFileSync(
      path.join(app.getPath("userData"), "hud-debug.log"),
      `${new Date().toISOString()}  ${line}\n`
    );
  } catch (error) { /* nicht schreibbar oder noch kein Pfad */ }
}

// --- Das Protokoll von myApps mitlesen ---------------------------------------
//
// Die maßgebliche Quelle für Klingeln, Abheben und Auflegen — siehe
// main/call-trace.js für die Messung, die belegt, warum der Medien-Socket dafür
// nicht ausreicht. Gelesen wird nur, was seit dem letzten Blick dazugekommen
// ist; die Vergangenheit der Datei geht uns nichts an.

const TRACE_PATHS = [
  // macOS: myApps läuft in einem Sandbox-Container. Lesbar ist die Datei
  // trotzdem – sie gehört demselben Benutzer.
  () => path.join(app.getPath("home"), "Library/Containers/com.innovaphone.myapps/Data/Documents/trace.txt"),
  // Windows: NICHT geprüft. Findet sich nichts, bleibt die Erkennung schlicht
  // aus, statt an einem geratenen Pfad zu scheitern.
  () => path.join(process.env.APPDATA || "", "innovaphone", "myApps", "trace.txt"),
  () => path.join(process.env.LOCALAPPDATA || "", "innovaphone", "myApps", "trace.txt")
];

const TRACE_POLL_MS = 1000;
// Mehr als das lesen wir pro Runde nicht nach. Schreibt myApps mit allen
// Kennzeichen, wächst die Datei schnell – und ein Rückstand darf nicht dazu
// führen, dass wir Megabytes in den Hauptprozess ziehen.
const TRACE_MAX_CHUNK = 512 * 1024;

let tracePath = null;
let traceTimer = null;
// Rotation, Blockgrenzen und halbe Zeilen stecken im Lesezeiger — dort sind sie
// ohne laufendes Fenster prüfbar (test/call-trace.test.js). Hier bleibt nur die
// Datei-Ein-/Ausgabe.
const traceCursor = createTraceCursor({ maxChunk: TRACE_MAX_CHUNK });

function resolveTracePath() {
  if (tracePath && fs.existsSync(tracePath)) return tracePath;
  tracePath = null;
  for (const build of TRACE_PATHS) {
    try {
      const candidate = build();
      if (candidate && fs.existsSync(candidate)) { tracePath = candidate; break; }
    } catch (error) { /* nächster Kandidat */ }
  }
  return tracePath;
}

function traceSize() {
  const file = resolveTracePath();
  if (!file) return null;
  try {
    return fs.statSync(file).size;
  } catch (error) {
    return null;
  }
}

/** Nachlesen, was seit dem letzten Mal dazugekommen ist. */
function readTraceDelta() {
  const file = resolveTracePath();
  if (!file) return [];

  const size = traceSize();
  if (size === null) return [];

  const range = traceCursor.plan(size);
  if (!range) return [];

  let text;
  try {
    const fd = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(range.to - range.from);
      fs.readSync(fd, buffer, 0, buffer.length, range.from);
      text = buffer.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    // Nicht lesbar: der Lesezeiger bleibt stehen, damit beim nächsten Versuch
    // genau dieselbe Stelle noch einmal drankommt statt übersprungen zu werden.
    return [];
  }

  return traceCursor.accept(text, range.to);
}

/**
 * Mitgelesen wird NUR während eines Gesprächs — dasselbe Fenster wie beim
 * Medien-Socket. Beim Einschalten setzen wir den Lesezeiger ans Ende: was vor
 * diesem Anruf im Protokoll stand, ist Vergangenheit.
 */
function setTraceWatch(on) {
  if (!on) {
    if (traceTimer) clearInterval(traceTimer);
    traceTimer = null;
    return;
  }
  if (traceTimer) return;

  traceCursor.reset(traceSize() || 0);

  // Der ganze Takt in einem try: ein einziger unerwarteter Fehler — eine kaputte
  // Zeile, eine Datei, die verschwindet — darf den Wächter nicht für immer
  // anhalten. Er würde sonst mitten in der Schicht verstummen, ohne dass
  // irgendwo etwas aufliefe, und die Anrufe liefen wieder ins Nichts.
  traceTimer = setInterval(() => {
    try {
      const events = readTraceDelta();
      if (!events.length) return;
      updatePhoneStats((stats) => { stats.traceEvents += events.length; });
      events.forEach((event) => {
        logLine(`trace: ${event.kind} ${event.id}${event.reason ? ` reason=${event.reason}` : ""}`);
        if (win && !win.isDestroyed()) win.webContents.send("hud:call-trace", event);
      });
    } catch (error) {
      logLine(`trace: Takt fehlgeschlagen – ${String((error && error.message) || error)}`);
    }
  }, TRACE_POLL_MS);
}

/** Für die Einrichtungskarte: ist das Protokoll überhaupt da und wächst es? */
function traceState() {
  const file = resolveTracePath();
  if (!file) return { found: false, path: "", size: 0, mtime: 0 };
  try {
    const stat = fs.statSync(file);
    return { found: true, path: file, size: stat.size, mtime: stat.mtimeMs };
  } catch (error) {
    return { found: false, path: file, size: 0, mtime: 0 };
  }
}

// --- Das Gesprächsende erkennen ---------------------------------------------
//
// myApps meldet einen Anruf genau einmal und beim Auflegen gar nicht (der Beleg
// steht in main/media-watch.js). Beobachtet wird stattdessen der Medien-Socket:
// solange gesprochen wird, hat myApps UDP-Sockets offen, im Leerlauf keinen
// einzigen.
//
// Gefragt wird das Betriebssystem, und dafür braucht es zum ersten Mal ein
// fremdes Programm im laufenden Hauptprozess. Deshalb eng geschnürt, in
// derselben Machart wie dial(): feste Programmpfade, feste Argumentliste, kein
// shell, ein Zeitlimit – und als einziger veränderlicher Teil eine PID, die wir
// selbst ermittelt und als Zahl geprüft haben.

const { execFile } = require("child_process");

// Wie der Prozess heißt. Unter macOS gemessen: „myapps". Der Windows-Name ist
// nicht geprüft, deshalb mehrere Kandidaten – und ohne Treffer bleibt die
// Erkennung schlicht aus, statt etwas zu raten.
const MYAPPS_PROCESS_NAMES = ["myapps", "myApps", "myapps.exe", "myApps.exe"];

const MEDIA_POLL_MS = 1000;
// Großzügig: lsof muss alle Dateideskriptoren des Prozesses durchgehen und
// braucht unter Last spürbar länger. Ein Zeitlimit erzeugt eine Messung ohne
// Ergebnis — und davon will man möglichst wenige.
const PROBE_TIMEOUT_MS = 5000;

let myAppsPid = 0;
let mediaTimer = null;
let mediaWatcher = null;
let mediaProbeResult = null;

/**
 * execFile als Versprechen, mit Zeitlimit. Ein Fehlschlag ist kein Ausnahmefall
 * — deshalb kommt der Exit-Code mit heraus und nicht nur „hat geklappt".
 *
 * Der Unterschied trägt die ganze Erkennung: `lsof` meldet Code 1, wenn es
 * nichts anzuzeigen gibt, und genau das ist der Normalfall zwischen zwei
 * Gesprächen. Würde man das als Fehler lesen, hörte die Erkennung im Leerlauf
 * auf; würde man umgekehrt JEDEN Fehlschlag als „nichts gefunden" lesen, könnte
 * ein kaputtes lsof ein laufendes Gespräch beenden. Beides wäre still.
 */
function run(file, args) {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
        resolve({
          code: error ? (typeof error.code === "number" ? error.code : -1) : 0,
          out: String(stdout || ""),
          err: String(stderr || ""),
          error: error ? String(error.message || error) : ""
        });
      });
    } catch (error) {
      resolve({ code: -1, out: "", err: "", error: String(error && error.message ? error.message : error) });
    }
  });
}

/**
 * Die PID von myApps. Gemerkt, aber neu gesucht, sobald eine Messung ins Leere
 * läuft – myApps darf zwischendurch neu starten, ohne dass die Erkennung für
 * den Rest der Sitzung blind bleibt.
 */
async function resolveMyAppsPid() {
  if (myAppsPid > 0) return myAppsPid;

  if (process.platform === "win32") {
    const root = process.env.SystemRoot || "C:\\Windows";
    for (const name of MYAPPS_PROCESS_NAMES) {
      if (!name.toLowerCase().endsWith(".exe")) continue;
      const result = await run(`${root}\\System32\\tasklist.exe`,
        ["/FI", `IMAGENAME eq ${name}`, "/NH", "/FO", "CSV"]);
      const match = result.out.match(/^"[^"]+","(\d+)"/m);
      if (match) { myAppsPid = Number(match[1]); return myAppsPid; }
    }
    return 0;
  }

  // -i, weil die Schreibweise des Prozessnamens nichts ist, worauf man sich
  // über Fassungen hinweg verlassen sollte.
  const result = await run("/usr/bin/pgrep", ["-i", "-x", "myapps"]);
  const first = result.out.split("\n").map((line) => line.trim()).find((line) => /^\d+$/.test(line));
  myAppsPid = first ? Number(first) : 0;
  return myAppsPid;
}

/**
 * Eine Messung: welche Sockets hat myApps gerade offen?
 *
 * `ok: false` heißt ausdrücklich „nicht gemessen", nicht „nichts gefunden" –
 * der Unterschied entscheidet darüber, ob ein Gespräch beendet werden darf.
 */
async function probeMedia() {
  const pid = await resolveMyAppsPid();
  if (!Number.isInteger(pid) || pid <= 0) {
    // Kein Messfehler, sondern eine Auskunft: ohne myApps gibt es keine
    // Sprachverbindung, das laufende Gespräch ist vorbei.
    return { ok: false, gone: true, pid: 0, sockets: [], error: "myApps läuft nicht" };
  }

  const result = process.platform === "win32"
    ? await run(`${process.env.SystemRoot || "C:\\Windows"}\\System32\\netstat.exe`, ["-ano", "-p", "UDP"])
    : await run("/usr/sbin/lsof", ["-nP", "-a", "-p", String(pid), "-i", "-F", "pcfnP"]);

  // Code 0 heißt „gemessen, hier ist die Liste"; Code 1 bei lsof heißt
  // „gemessen, die Liste ist leer" – der Normalfall, wenn der Prozess gerade
  // keinen einzigen Socket offen hat. Alles andere ist NICHT gemessen: ein
  // fehlendes Programm, ein Zeitlimit, ein Rechteproblem. Daran darf kein
  // Gespräch enden, deshalb geht das als ok:false heraus.
  const measured = result.code === 0 || (result.code === 1 && !result.err.trim());
  if (!measured) {
    myAppsPid = 0;
    return { ok: false, pid, sockets: [], error: result.error || result.err.trim() || "Messung fehlgeschlagen" };
  }

  const sockets = process.platform === "win32"
    ? parseNetstat(result.out, pid)
    : parseLsof(result.out);

  // Keine einzige Zeile, obwohl wir eine PID hatten: myApps ist vermutlich
  // beendet worden. Beim nächsten Mal neu suchen – und das Gespräch darf enden,
  // denn ohne myApps spricht niemand mehr.
  if (!sockets.length) myAppsPid = 0;

  return { ok: true, pid, sockets, error: "" };
}

/** Die Messung so aufbereiten, wie die Einrichtungskarte sie zeigt. */
function describeProbe(result) {
  const sockets = (result && result.sockets) || [];
  return {
    at: Date.now(),
    ok: !!(result && result.ok),
    pid: (result && result.pid) || 0,
    sockets: sockets.length,
    media: sockets.filter(isMediaSocket).length,
    error: (result && result.error) || "",
    platform: process.platform
  };
}

function sendMedia(state) {
  // In die Protokolldatei, nicht nur ins Fenster: wenn das Auflegen einmal
  // nicht erkannt wird, ist hinterher sonst nicht zu unterscheiden, ob die
  // Messung ausblieb, etwas anderes meldete, oder ob das Panel sie ignoriert
  // hat. hud-debug.log liegt in userData.
  logLine(`media: ${state}`);
  // Gezählt wird nur das Auftauchen. Ein „idle" heißt für sich genommen gar
  // nichts – es steht auch vor dem Abheben und nach jedem Gespräch. Ob daraus
  // ein Ende wurde, weiß nur call-session.js, und das meldet es als Ereignis.
  if (state === "media") {
    updatePhoneStats((stats) => { stats.mediaSeen += 1; stats.lastMediaAt = Date.now(); });
  }
  if (!win || win.isDestroyed()) return;
  win.webContents.send("hud:media", { state, at: Date.now() });
}

/**
 * Gemessen wird NUR, solange ein Gespräch läuft. Das Panel schaltet ein und
 * aus – im Leerlauf kostet die Erkennung damit nichts.
 */
function setMediaWatch(on) {
  if (!on) {
    if (mediaTimer) clearInterval(mediaTimer);
    mediaTimer = null;
    mediaWatcher = null;
    return;
  }
  if (mediaTimer) return;

  mediaWatcher = createMediaWatcher({
    probe: async () => {
      const result = await probeMedia();
      mediaProbeResult = describeProbe(result);
      // Nur den Fehlerfall protokollieren, nicht jede der ~60 Messungen pro
      // Gespräch: eine Protokolldatei, die im Sekundentakt wächst, liest
      // hinterher niemand.
      if (!result.ok && !result.gone) logLine(`media-probe fehlgeschlagen: ${result.error}`);
      return result;
    },
    onChange: sendMedia
  });

  const tick = () => {
    try {
      mediaWatcher.tick().catch(() => {});
    } catch (error) { /* s. o.: ein Takt darf nie den Wächter mitnehmen */ }
  };
  tick();
  mediaTimer = setInterval(tick, MEDIA_POLL_MS);
}

/** Der Prüfknopf in der Einrichtungskarte: eine einzelne Messung. */
async function probeMediaOnce() {
  mediaProbeResult = describeProbe(await probeMedia());
  pushPhoneState();
}

/**
 * Was ein Gespräch von außen unterbricht. Gesperrter Bildschirm oder
 * schlafender Rechner heißt: hier spricht niemand mehr. Kostet nichts und
 * stimmt immer – anders als die Beobachtung der Sockets braucht das keinen
 * Beweis.
 */
function watchPowerEvents() {
  const stop = (reason) => () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send("hud:call-interrupt", { reason });
  };
  safeCall(() => powerMonitor.on("lock-screen", stop("gesperrt")), null);
  safeCall(() => powerMonitor.on("suspend", stop("ruhezustand")), null);
  safeCall(() => powerMonitor.on("shutdown", stop("herunterfahren")), null);
}

// Muss so früh wie möglich stehen: unter macOS kann open-url schon feuern,
// bevor die App bereit ist (wenn der Anruf sie überhaupt erst startet).
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleCallUrl(url);
});

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

  // Der Renderer holt sich seinen Startzustand genau einmal beim Aufbau – das
  // ist zugleich das verlässlichste Lebenszeichen, das es gibt. Ab hier hört
  // jemand zu, also darf Aufgestautes raus (eine Anruf-Meldung, die die App
  // erst gestartet hat).
  ipcMain.handle("hud:state", () => {
    rendererReady = true;
    setImmediate(flushPendingCalls);
    return {
      connected: bridge.connected,
      ticket: bridge.ticket,
      storage: bridge.storageGet(null),
      overlay: overlayState(),
      notes: store.hudGet("notes", []),
      notesDraft: store.hudGet("notesDraft", ""),
      platform: process.platform,
      version: app.getVersion(),
      phone: phoneState()
    };
  });

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
      case "dial":
        dial(args.number);
        return;
      case "call-test":
        // Der Selbsttest der Einrichtungskarte. Geht durch dieselbe Strecke wie
        // ein echter Anruf – ein Test, der einen eigenen Weg nimmt, prüft den
        // Weg nicht, den es zu prüfen gilt.
        handleCallUrl(testCallUrl(), { test: true });
        return;
      case "call-seen":
        recordCallSeen(args);
        return;
      case "phone-direction":
        setPhoneDirection(args.value);
        return;
      case "call-media-watch":
        // Das Panel sagt, ob gerade ein Gespräch läuft. Nur dann wird gemessen.
        setMediaWatch(!!(args && args.on));
        setTraceWatch(!!(args && args.on));
        return;
      case "media-probe":
        probeMediaOnce();
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

// Ein zweiter Start ist unter Windows der Normalfall für eine Anruf-Meldung:
// dort öffnet das System die URL, indem es die App erneut aufruft, und die
// Einmal-Sperre schickt die Argumente hierher. Vorher hat diese Zeile nur das
// Fenster nach vorn geholt und alles Mitgeschickte weggeworfen.
app.on("second-instance", (event, argv) => {
  const url = callUrlFromArgv(argv);
  if (url) handleCallUrl(url);
  showWindow();
});

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

  // Das Schema anmelden, über das myApps die Anrufe meldet. Im gepackten Paket
  // steht es zusätzlich fest in den Metadaten (build.protocols in package.json)
  // – das hier ist der Weg für den Quellstand und für Windows, wo die
  // Registrierung im Benutzerprofil hängt. Aus dem Quellstand heraus trägt sich
  // Electron selbst ein, nicht die App: zum Ausprobieren reicht das, verlassen
  // sollte man sich darauf nicht.
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(CALL_PROTOCOL);
  } else if (process.platform === "win32") {
    app.setAsDefaultProtocolClient(CALL_PROTOCOL, process.execPath, [path.resolve(process.argv[1] || ".")]);
  } else {
    app.setAsDefaultProtocolClient(CALL_PROTOCOL);
  }

  // Kaltstart unter Windows/Linux: dort steht die URL im eigenen Aufruf, es gab
  // also weder open-url noch second-instance. Ohne das ginge genau der Anruf
  // verloren, der die App gestartet hat.
  const startupCallUrl = callUrlFromArgv(process.argv);
  if (startupCallUrl) handleCallUrl(startupCallUrl);

  store = new Store(app.getPath("userData"));
  // Jetzt erst gibt es einen Ort zum Zählen – nachholen, was der Kaltstart
  // schon gebracht hat (siehe pendingPhoneEvents).
  flushPhoneEvents();

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
  watchPowerEvents();
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
