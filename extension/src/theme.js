(function initStadtnetzCRMTheme() {
  "use strict";

  globalThis.StadtnetzCRM = globalThis.StadtnetzCRM || {};

  // Rollenbasierte Farb-Tokens, abgebildet auf die bestehenden --sc-*-Variablen
  // in styles/content.css (#stadtnetzcrm-root). Dasselbe Rollen-Set wird von
  // src/lib/theme.ts (CRM-Web-App) verwendet, damit beide Seiten dasselbe
  // gespeicherte Theme-Schema teilen können.
  const ROLE_TO_VAR = {
    ink: "--sc-ink",
    muted: "--sc-muted",
    line: "--sc-line",
    surface: "--sc-surface",
    soft: "--sc-soft",
    accent: "--sc-blue",
    accentDark: "--sc-blue-dark",
    success: "--sc-success",
    warning: "--sc-warning",
    danger: "--sc-danger",
    amber: "--sc-amber",
    amberSoft: "--sc-amber-soft"
  };

  const PRESETS = {
    // Entspricht 1:1 den bisherigen Werten in content.css :root — Default bleibt
    // dadurch für alle, die das Theme nie anfassen, garantiert pixelgleich.
    jira: {
      ink: "#172b4d", muted: "#5e6c84", line: "#dfe1e6", surface: "#ffffff",
      soft: "#f7f8fa", accent: "#0c66e4", accentDark: "#0055cc",
      success: "#216e4e", warning: "#974f0c", danger: "#ae2e24",
      amber: "#b26a00", amberSoft: "#fff4e5"
    },
    // Zweites Preset: TNG-Markenfarben statt Jira-Blau.
    crm: {
      ink: "#182230", muted: "#5b6b7f", line: "#dde3ea", surface: "#ffffff",
      soft: "#f4f7fa", accent: "#00336e", accentDark: "#00234c",
      success: "#1c7a4d", warning: "#b2670a", danger: "#b23a2e",
      amber: "#f18700", amberSoft: "#fff1e0"
    }
  };

  const DEFAULT_THEME = { presetId: "jira", overrides: {} };

  function resolveThemeColors(themeState) {
    const preset = PRESETS[themeState && themeState.presetId] || PRESETS.jira;
    return { ...preset, ...(themeState && themeState.overrides) };
  }

  // Setzt die Farb-Variablen als Inline-Style direkt am Root-Element. Das
  // Root-Element selbst wird von ui.js nie ersetzt (nur sein innerHTML) —
  // die Inline-Styles überleben also jedes Re-Rendering automatisch.
  //
  // WICHTIG: content.css definiert für jede dieser Variablen auch einen
  // @media(prefers-color-scheme:dark)-Wert. Ein Inline-Style gewinnt gegen
  // Media-Query-Regeln IMMER, unabhängig vom aktuellen OS-Farbmodus – ein
  // pauschal für alle Rollen gesetzter Inline-Wert würde den automatischen
  // Hell/Dunkel-Wechsel für JEDEN Nutzer kaputt machen, nicht nur für den, der
  // etwas anpasst. Deshalb: nur Rollen anfassen, die tatsächlich vom
  // Standard abweichen (eigenes Preset ODER eine konkrete Override-Rolle);
  // alle anderen Rollen bleiben unangetastet unter Kontrolle des Stylesheets
  // (removeProperty räumt einen zuvor gesetzten Wert wieder weg, z. B. bei
  // "Zurücksetzen").
  function applyTheme(rootEl, themeState) {
    if (!rootEl) return;
    const state = themeState || DEFAULT_THEME;
    const presetChanged = state.presetId && state.presetId !== "jira";
    const colors = resolveThemeColors(state);
    Object.keys(ROLE_TO_VAR).forEach((role) => {
      const touched = presetChanged || (state.overrides && Object.prototype.hasOwnProperty.call(state.overrides, role));
      if (touched) rootEl.style.setProperty(ROLE_TO_VAR[role], colors[role]);
      else rootEl.style.removeProperty(ROLE_TO_VAR[role]);
    });
  }

  // Räumt einen aus dem Storage geladenen (oder von woanders kommenden) Wert
  // auf: unbekannte Preset-Ids fallen auf "jira" zurück, unbekannte/leere
  // Override-Rollen werden verworfen, damit kein fremder/veralteter Schlüssel
  // durchsickert.
  function normalizeThemeState(raw) {
    if (!raw || typeof raw !== "object") return { presetId: "jira", overrides: {} };
    const presetId = PRESETS[raw.presetId] ? raw.presetId : "jira";
    const rawOverrides = (raw.overrides && typeof raw.overrides === "object") ? raw.overrides : {};
    const overrides = {};
    Object.keys(rawOverrides).forEach((role) => {
      if (ROLE_TO_VAR[role] && typeof rawOverrides[role] === "string" && rawOverrides[role]) {
        overrides[role] = rawOverrides[role];
      }
    });
    return { presetId, overrides };
  }

  // ---------------------------------------------------------------------------
  // Übernahme des CRM-Farbschemas (src/lib/palette.ts)
  // ---------------------------------------------------------------------------
  //
  // Beide Seiten benutzen ein rollenbasiertes Schema, aber NICHT dasselbe: das
  // CRM kennt background/textPrimary/textMuted/border, die Extension
  // soft/ink/muted/line. Schlimmer noch, die Preset-Namen kollidieren mit
  // unterschiedlicher Bedeutung — "crm" heißt hier #00336e (TNG-Navy), im CRM
  // dagegen #0066b3. Ein direktes Durchreichen des gespeicherten Zustands
  // würde also falsche Farben setzen. Deshalb wird die CRM-Palette hier zuerst
  // zu konkreten Farbwerten aufgelöst und dann Rolle für Rolle übersetzt.
  //
  // Die CRM-Presets sind bewusst dupliziert: die Extension hat keinen
  // Build-Schritt und kann nicht aus src/lib/palette.ts importieren. Ein
  // geteiltes Paket wäre Stufe 4 aus KONZEPT-INTEGRATION.md. Ändert sich dort
  // ein Preset, muss es hier nachgezogen werden — die Tests in
  // test/theme-crm.test.js halten die Werte fest.
  const CRM_ROLE_TO_ROLE = {
    accent: "accent",
    accentDark: "accentDark",
    surface: "surface",
    background: "soft",
    textPrimary: "ink",
    textMuted: "muted",
    border: "line",
    success: "success",
    warning: "warning",
    danger: "danger"
  };

  const CRM_PRESETS = {
    crm: {
      accent: "#0066b3", accentDark: "#004a85", background: "#f2f3f7",
      surface: "#ffffff", textPrimary: "#1d1d1f", textMuted: "#5e5e63",
      border: "#e2e2e6", success: "#34c759", warning: "#ff9500",
      danger: "#ff3b30"
    },
    jira: {
      accent: "#0c66e4", accentDark: "#0055cc", background: "#f7f8fa",
      surface: "#ffffff", textPrimary: "#172b4d", textMuted: "#5e6c84",
      border: "#dfe1e6", success: "#216e4e", warning: "#974f0c",
      danger: "#ae2e24"
    }
  };

  /** Standard-Preset der CRM-Seite — Abweichung davon heißt "der Nutzer hat gewählt". */
  const CRM_DEFAULT_PRESET = "crm";

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || "").trim());
    if (!m) return null;
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }

  function mixWithWhite(rgb, amount) {
    const mix = (c) => Math.round(c + (255 - c) * amount);
    return `rgb(${mix(rgb[0])}, ${mix(rgb[1])}, ${mix(rgb[2])})`;
  }

  function resolveCrmPaletteColors(palette) {
    const presetId = palette && CRM_PRESETS[palette.presetId] ? palette.presetId : CRM_DEFAULT_PRESET;
    const overrides = (palette && palette.overrides && typeof palette.overrides === "object")
      ? palette.overrides
      : {};
    return { ...CRM_PRESETS[presetId], ...overrides };
  }

  /**
   * CRM-Palette → Theme-Zustand dieser Extension.
   *
   * Übersetzt werden nur die Rollen, die im CRM tatsächlich vom Standard
   * abweichen — genau dieselbe Regel, die applyTheme() oben und applyPalette()
   * im CRM anwenden. Grund: content.css definiert für jede Rolle einen
   * @media(prefers-color-scheme:dark)-Wert, und ein Inline-Style gewinnt dagegen
   * immer. Würden hier pauschal alle zehn Rollen gesetzt, wäre der automatische
   * Dunkelmodus des Panels tot — auch für jemanden, der im CRM nie eine Farbe
   * angefasst hat. Bei unveränderter CRM-Palette kommt darum bewusst ein leeres
   * Override-Objekt heraus, und die Extension bleibt bei ihren eigenen Farben.
   *
   * `presetId` bleibt "jira": die übersetzten Farben reisen als Overrides, weil
   * es kein Extension-Preset gibt, das der CRM-Auswahl entspricht.
   */
  function crmPaletteToTheme(palette) {
    const presetId = palette && CRM_PRESETS[palette.presetId] ? palette.presetId : CRM_DEFAULT_PRESET;
    const rawOverrides = (palette && palette.overrides && typeof palette.overrides === "object")
      ? palette.overrides
      : {};
    const presetChanged = presetId !== CRM_DEFAULT_PRESET;
    const colors = resolveCrmPaletteColors(palette);
    const overrides = {};

    Object.keys(CRM_ROLE_TO_ROLE).forEach((crmRole) => {
      const touched = presetChanged || Object.prototype.hasOwnProperty.call(rawOverrides, crmRole);
      if (!touched) return;
      const value = colors[crmRole];
      if (typeof value !== "string" || !value) return;
      overrides[CRM_ROLE_TO_ROLE[crmRole]] = value;
    });

    // amber/amberSoft haben im CRM keine Entsprechung (dort trägt "warning"
    // beides). Aus der Warnfarbe abgeleitet, damit die Hinweisflächen im Panel
    // nicht als einzige in der alten Farbe stehen bleiben. Nur bei Hex-Werten —
    // sonst lieber unangetastet lassen als etwas Falsches zu berechnen.
    if (overrides.warning) {
      const rgb = hexToRgb(overrides.warning);
      if (rgb) {
        overrides.amber = overrides.warning;
        overrides.amberSoft = mixWithWhite(rgb, 0.88);
      }
    }

    return { presetId: "jira", overrides };
  }

  globalThis.StadtnetzCRM.themeEngine = {
    PRESETS,
    DEFAULT_THEME,
    ROLE_TO_VAR,
    CRM_PRESETS,
    CRM_ROLE_TO_ROLE,
    resolveThemeColors,
    resolveCrmPaletteColors,
    crmPaletteToTheme,
    applyTheme,
    normalizeThemeState
  };
})();
