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

  globalThis.StadtnetzCRM.themeEngine = {
    PRESETS,
    DEFAULT_THEME,
    ROLE_TO_VAR,
    resolveThemeColors,
    applyTheme,
    normalizeThemeState
  };
})();
