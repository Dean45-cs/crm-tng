// Persönliches Dashboard-Layout (Phase 4/5): Reihenfolge, Breite (Spalten-Span)
// und Sichtbarkeit der Dashboard-Widgets. Bewusst KEIN freies Pixel-Grid:
// die Dashboard-Karten sind inhaltsgetrieben (Charts, Listen) und haben keine
// feste Höhe — anpassbar sind daher Reihenfolge, Breite und Sichtbarkeit.
// react-grid-layout scheidet unter React 19 aus (hängt an react-draggable →
// ReactDOM.findDOMNode, in React 19 entfernt); deshalb eine eigene, schlanke
// Umsetzung. Standard = das heutige Layout, alles sichtbar — rein opt-in, lokal.

export type GridItem = { id: string; w: number; hidden?: boolean };
export type GridLayout = { items: GridItem[] };

export const GRID_COLUMNS = 12;

/** Definition eines Widgets, wie das Dashboard es der Grid-Komponente übergibt. */
export type WidgetDef = {
  id: string;
  title: string;
  /** Standard-Breite in Spalten (1..GRID_COLUMNS). */
  defaultW: number;
  /** Kleinste sinnvolle Breite (z. B. ein Chart nicht schmaler als halbe Breite). */
  minW?: number;
  render: () => import('react').ReactNode;
};

export function clampSpan(w: number): number {
  if (!Number.isFinite(w)) return GRID_COLUMNS;
  return Math.max(1, Math.min(GRID_COLUMNS, Math.round(w)));
}

/**
 * Gespeichertes Layout mit den aktuellen Widget-Definitionen abgleichen:
 * bekannte Reihenfolge zuerst, neue Widgets hinten angehängt, unbekannte
 * (entfernte) verworfen. Robust gegen später hinzugefügte/entfernte Widgets.
 */
export function resolveLayout(defs: WidgetDef[], stored: GridLayout | null): GridItem[] {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const items: GridItem[] = [];
  if (stored && Array.isArray(stored.items)) {
    for (const it of stored.items) {
      const def = byId.get(it.id);
      if (!def || seen.has(it.id)) continue;
      seen.add(it.id);
      items.push({ id: it.id, w: clampSpan(it.w ?? def.defaultW), hidden: Boolean(it.hidden) });
    }
  }
  for (const def of defs) {
    if (seen.has(def.id)) continue;
    items.push({ id: def.id, w: clampSpan(def.defaultW) });
  }
  return items;
}

export function loadLayout(storageKey: string): GridLayout | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.items) ? (parsed as GridLayout) : null;
  } catch {
    return null;
  }
}

export function saveLayout(storageKey: string, items: GridItem[]): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ items }));
  } catch {
    /* Speicher voll / nicht verfügbar — Layout bleibt dann nur für die Sitzung. */
  }
}

export function clearLayout(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    /* egal */
  }
}
