/**
 * Schichtzeiten und Schichtarten — einzige gemeinsame Quelle für Extension
 * (dieses File, direkt als Content-Script geladen, siehe manifest.json) und CRM
 * (`src/lib/shifts.ts` importiert diese Datei direkt statt eine eigene Kopie
 * zu pflegen). Gleiches Muster wie commission.js: reines UMD-artiges Script,
 * das sich per `globalThis` (Browser) oder `module.exports` (Node/Vite)
 * exportiert — kein Build-Schritt für die Extension nötig.
 *
 * Warum geteilt und nicht je Seite definiert: Cockpit und CRM zeigen beide an,
 * welche Schicht gerade läuft und wie lange noch. Stünden die Zeiten zweimal
 * da, wäre die erste Änderung der Betriebszeiten sofort ein Widerspruch
 * zwischen den beiden Oberflächen — und zwar einer, den niemand bemerkt, bis
 * sich jemand auf die falsche Zahl verlässt.
 *
 * @typedef {import("../../src/types").ShiftType} ShiftType
 */
(function () {
  "use strict";

  const hm = (h, m) => h * 60 + m;

  /**
   * Arbeitszeit je Schichtart, in Minuten seit Mitternacht. Schichtarten ohne
   * Eintrag (frei, Urlaub, Krank, Schulung) haben kein Zeitfenster.
   */
  const SHIFT_TIMES = {
    frueh: { startMin: hm(7, 45), endMin: hm(16, 15) },
    spaet: { startMin: hm(8, 45), endMin: hm(17, 15) }
  };

  /**
   * Metadaten je Schichtart. `working` entscheidet überall, ob ein Tag als
   * Arbeitstag zählt — in der Besetzung, in der Σ-Spalte und im Cockpit.
   */
  const SHIFT_META = {
    frueh:    { label: "Früh",     short: "F",   working: true,  absence: false, tone: "frueh" },
    spaet:    { label: "Spät",     short: "S",   working: true,  absence: false, tone: "spaet" },
    frei:     { label: "Frei",     short: "–",   working: false, absence: false, tone: "frei" },
    urlaub:   { label: "Urlaub",   short: "U",   working: false, absence: true,  tone: "urlaub" },
    krank:    { label: "Krank",    short: "K",   working: false, absence: true,  tone: "krank" },
    schulung: { label: "Schulung", short: "Sch", working: false, absence: true,  tone: "schulung" }
  };

  /** Reihenfolge für Werkzeugleisten und Legenden — Arbeit zuerst. */
  const SHIFT_ORDER = ["frueh", "spaet", "frei", "urlaub", "krank", "schulung"];

  /**
   * Unbekannte Schichtart fällt auf „frei" zurück statt zu werfen: ein alter
   * Client soll an einer neu eingeführten Art nicht zerbrechen.
   * @param {ShiftType|null|undefined} t
   */
  function shiftMeta(t) {
    return (t && SHIFT_META[t]) || SHIFT_META.frei;
  }

  /** @param {ShiftType|null|undefined} t */
  function isWorking(t) {
    return shiftMeta(t).working;
  }

  /** 465 → "07:45" */
  function formatMinutes(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  /** "07:45 – 16:15", oder null bei Schichtarten ohne Zeitfenster. */
  function shiftTimeLabel(t) {
    const range = SHIFT_TIMES[t];
    return range ? `${formatMinutes(range.startMin)} – ${formatMinutes(range.endMin)}` : null;
  }

  /**
   * Wo im Schichtfenster steht der Tag gerade?
   *
   * `nowMin` wird übergeben statt intern aus `new Date()` gelesen, damit die
   * Funktion rein und ohne Zeitmanipulation testbar bleibt.
   *
   * @param {ShiftType} t
   * @param {number} nowMin Minuten seit Mitternacht
   * @returns {{phase: "before"|"running"|"after", progress: number, minutesLeft: number}|null}
   */
  function shiftProgress(t, nowMin) {
    const range = SHIFT_TIMES[t];
    if (!range) return null;
    if (nowMin < range.startMin) {
      return { phase: "before", progress: 0, minutesLeft: range.startMin - nowMin };
    }
    if (nowMin >= range.endMin) {
      return { phase: "after", progress: 1, minutesLeft: 0 };
    }
    const span = range.endMin - range.startMin;
    return {
      phase: "running",
      progress: (nowMin - range.startMin) / span,
      minutesLeft: range.endMin - nowMin
    };
  }

  /** 135 → "2:15 Std."; unter einer Stunde nur Minuten. */
  function formatDuration(minutes) {
    const m = Math.max(0, Math.round(minutes));
    if (m < 60) return `${m} Min.`;
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} Std.`;
  }

  /** Minuten seit Mitternacht für ein Date — Gegenstück zu `nowMin`. */
  function minutesOfDay(d) {
    const dt = d || new Date();
    return dt.getHours() * 60 + dt.getMinutes();
  }

  const api = {
    SHIFT_TIMES,
    SHIFT_META,
    SHIFT_ORDER,
    shiftMeta,
    isWorking,
    formatMinutes,
    shiftTimeLabel,
    shiftProgress,
    formatDuration,
    minutesOfDay
  };

  // Siehe commission.js: beide Export-Formen nebeneinander, weil dieselbe
  // Datei als klassisches Content-Script, als ESM-Seiteneffekt-Import (Vite/
  // Vitest) und per require() (Extension-Tests) geladen wird.
  globalThis.StadtnetzCRM = globalThis.StadtnetzCRM || {};
  globalThis.StadtnetzCRM.shiftTime = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
