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

/** Breite, auf die ein Widget ohne eigenes minW beim Auffüllen schrumpfen darf. */
const DEFAULT_MIN_SPAN = 3;

function minSpanFor(def: WidgetDef): number {
  return clampSpan(def.minW ?? DEFAULT_MIN_SPAN);
}

type Slot = { id: string; w: number; min: number };

/**
 * Wunschbreiten in ein lückenloses Layout übersetzen: die Widgets werden in
 * ihrer Reihenfolge zu Zeilen gepackt, und jede Zeile füllt am Ende exakt
 * GRID_COLUMNS Spalten. Passt das nächste Widget nicht mehr ganz in die Zeile,
 * wird es auf den Rest geschrumpft (solange seine Mindestbreite das hergibt),
 * sonst beginnt eine neue Zeile und die alte wird gleichmäßig aufgezogen.
 * Dadurch bleibt rechts nie ein Loch stehen — auch nicht nach dem Ausblenden
 * eines Widgets oder beim Laden alter, „krummer" Layouts.
 *
 * `priorityId` ist das gerade gezogene Widget: es bekommt seine Wunschbreite
 * und nimmt den Platz von den linken Nachbarn (nie unter deren Mindestbreite),
 * damit sich Ziehen 1:1 anfühlt statt vom Nachbarn blockiert zu werden.
 *
 * Die Funktion ist idempotent: auf ein bereits gepacktes Layout angewendet
 * ändert sie nichts. Gespeichert werden weiterhin die Wunschbreiten.
 */
export function packRows(
  defs: WidgetDef[],
  items: GridItem[],
  priorityId?: string | null,
): GridItem[] {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const rows: Slot[][] = [];
  let row: Slot[] = [];
  let used = 0;

  const closeRow = () => {
    if (row.length === 0) return;
    rows.push(row);
    row = [];
    used = 0;
  };

  for (const it of items) {
    const def = byId.get(it.id);
    if (!def || it.hidden) continue;
    const min = minSpanFor(def);
    const want = Math.max(min, clampSpan(it.w ?? def.defaultW));

    if (row.length > 0 && it.id === priorityId && want > GRID_COLUMNS - used) {
      let need = want - (GRID_COLUMNS - used);
      for (let i = row.length - 1; i >= 0 && need > 0; i--) {
        const give = Math.min(need, row[i].w - row[i].min);
        row[i].w -= give;
        used -= give;
        need -= give;
      }
    }

    const rem = GRID_COLUMNS - used;
    if (row.length === 0) {
      row.push({ id: it.id, w: want, min });
      used = want;
    } else if (want <= rem) {
      row.push({ id: it.id, w: want, min });
      used += want;
    } else if (rem >= min) {
      // Rest exakt auffüllen statt eine Lücke zu lassen.
      row.push({ id: it.id, w: rem, min });
      used = GRID_COLUMNS;
    } else {
      closeRow();
      row.push({ id: it.id, w: want, min });
      used = want;
    }
  }
  closeRow();

  const packed = new Map<string, number>();
  for (const r of rows) {
    let sum = r.reduce((s, c) => s + c.w, 0);
    // Restspalten reihum verteilen, breitestes Widget zuerst — so bleiben die
    // Größenverhältnisse erhalten und die Zeile endet bündig.
    const order = r
      .map((c, i) => ({ c, i }))
      .sort((a, b) => b.c.w - a.c.w || a.i - b.i)
      .map((x) => x.c);
    for (let k = 0; sum < GRID_COLUMNS; k++) {
      order[k % order.length].w += 1;
      sum += 1;
    }
    for (const c of r) packed.set(c.id, c.w);
  }

  return items.map((it) => {
    const w = packed.get(it.id);
    return w === undefined || w === it.w ? it : { ...it, w };
  });
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
