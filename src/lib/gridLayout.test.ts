import { describe, it, expect } from 'vitest';
import { clampSpan, packRows, resolveLayout, GRID_COLUMNS, type WidgetDef, type GridItem, type GridLayout } from './gridLayout';

// Minimal-Widgets: render wird von der Auflösung nicht aufgerufen, daher null.
function def(id: string, defaultW = 6): WidgetDef {
  return { id, title: id, defaultW, render: () => null };
}

const DEFS: WidgetDef[] = [def('a', 5), def('b', 7), def('c', 6)];

describe('clampSpan', () => {
  it('begrenzt auf 1..GRID_COLUMNS', () => {
    expect(clampSpan(0)).toBe(1);
    expect(clampSpan(-3)).toBe(1);
    expect(clampSpan(99)).toBe(GRID_COLUMNS);
    expect(clampSpan(6)).toBe(6);
  });

  it('rundet und fängt NaN ab', () => {
    expect(clampSpan(4.4)).toBe(4);
    expect(clampSpan(4.6)).toBe(5);
    expect(clampSpan(Number.NaN)).toBe(GRID_COLUMNS);
  });
});

describe('resolveLayout', () => {
  it('ohne gespeichertes Layout gilt die Definitions-Reihenfolge mit Standardbreiten', () => {
    const items = resolveLayout(DEFS, null);
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(items.map((i) => i.w)).toEqual([5, 7, 6]);
    expect(items.every((i) => !i.hidden)).toBe(true);
  });

  it('respektiert gespeicherte Reihenfolge, Breite und Sichtbarkeit', () => {
    const stored: GridLayout = { items: [{ id: 'c', w: 8 }, { id: 'a', w: 4, hidden: true }, { id: 'b', w: 7 }] };
    const items = resolveLayout(DEFS, stored);
    expect(items.map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect(items.find((i) => i.id === 'c')?.w).toBe(8);
    expect(items.find((i) => i.id === 'a')?.hidden).toBe(true);
  });

  it('verwirft unbekannte (entfernte) Widgets aus dem Speicher', () => {
    const stored: GridLayout = { items: [{ id: 'weg', w: 6 }, { id: 'a', w: 5 }] };
    const items = resolveLayout(DEFS, stored);
    expect(items.map((i) => i.id)).not.toContain('weg');
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('hängt neue (später hinzugekommene) Widgets hinten an', () => {
    const stored: GridLayout = { items: [{ id: 'b', w: 7 }] };
    const items = resolveLayout(DEFS, stored);
    // b zuerst (gespeichert), dann a und c als neue hinten in Definitions-Reihenfolge
    expect(items.map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });

  it('begrenzt gespeicherte Breiten auf den gültigen Bereich', () => {
    const stored: GridLayout = { items: [{ id: 'a', w: 99 }, { id: 'b', w: 0 }, { id: 'c', w: 6 }] };
    const items = resolveLayout(DEFS, stored);
    expect(items.find((i) => i.id === 'a')?.w).toBe(GRID_COLUMNS);
    expect(items.find((i) => i.id === 'b')?.w).toBe(1);
  });

  it('ignoriert doppelte Ids im Speicher', () => {
    const stored: GridLayout = { items: [{ id: 'a', w: 5 }, { id: 'a', w: 9 }, { id: 'b', w: 7 }] };
    const items = resolveLayout(DEFS, stored);
    expect(items.filter((i) => i.id === 'a')).toHaveLength(1);
    expect(items.find((i) => i.id === 'a')?.w).toBe(5);
  });
});

describe('packRows', () => {
  // Zeilen aus dem gepackten Ergebnis rekonstruieren (greedy, wie das CSS-Grid
  // umbricht) — jede Zeile muss exakt GRID_COLUMNS breit sein.
  function rowsOf(items: GridItem[]): GridItem[][] {
    const rows: GridItem[][] = [];
    let row: GridItem[] = [];
    let used = 0;
    for (const it of items.filter((i) => !i.hidden)) {
      if (used + it.w > GRID_COLUMNS) {
        rows.push(row);
        row = [];
        used = 0;
      }
      row.push(it);
      used += it.w;
    }
    if (row.length) rows.push(row);
    return rows;
  }

  function expectNoGaps(items: GridItem[]) {
    for (const row of rowsOf(items)) {
      expect(row.reduce((s, i) => s + i.w, 0)).toBe(GRID_COLUMNS);
    }
  }

  const M: WidgetDef[] = [
    { ...def('a', 6), minW: 4 },
    { ...def('b', 6), minW: 4 },
    { ...def('c', 6), minW: 4 },
  ];

  it('füllt eine angebrochene Zeile bis zum Rand auf', () => {
    // 8 + 6 passt nicht in eine Zeile: b schrumpft auf den Rest statt umzubrechen.
    const items = packRows(M, [{ id: 'a', w: 8 }, { id: 'b', w: 6 }, { id: 'c', w: 6 }]);
    expect(items.map((i) => i.w)).toEqual([8, 4, 12]);
    expectNoGaps(items);
  });

  it('zieht eine allein stehende Zeile auf die volle Breite', () => {
    const items = packRows(M, [{ id: 'a', w: 7 }, { id: 'b', w: 7 }, { id: 'c', w: 5 }]);
    // b schrumpft auf den Rest (5 ≥ minW 4) und bleibt neben a; c steht allein
    // in der zweiten Zeile und wird deshalb auf volle Breite gezogen.
    expect(items.map((i) => i.w)).toEqual([7, 5, 12]);
    expectNoGaps(items);
  });

  it('verteilt den Rest gleichmäßig, wenn nichts mehr nachrückt', () => {
    const items = packRows(M, [{ id: 'a', w: 4 }, { id: 'b', w: 4 }]);
    expect(items.map((i) => i.w)).toEqual([6, 6]);
    expectNoGaps(items);
  });

  it('lässt keine Lücke, wenn ein Widget ausgeblendet ist', () => {
    const items = packRows(M, [{ id: 'a', w: 6 }, { id: 'b', w: 6, hidden: true }, { id: 'c', w: 6 }]);
    expect(items.map((i) => i.w)).toEqual([6, 6, 6]);
    // Das ausgeblendete b behält seine Breite für das spätere Wiedereinblenden.
    expect(items.find((i) => i.id === 'b')?.w).toBe(6);
    expectNoGaps(items);
  });

  it('gibt dem gezogenen Widget Vorrang und nimmt Platz vom linken Nachbarn', () => {
    // b wird gezogen: a gibt bis zu seiner Mindestbreite (4) ab.
    const items = packRows(M, [{ id: 'a', w: 6 }, { id: 'b', w: 9 }, { id: 'c', w: 6 }], 'b');
    expect(items.map((i) => i.w)).toEqual([4, 8, 12]);
    expectNoGaps(items);
  });

  it('respektiert die Mindestbreite auch beim Auffüllen', () => {
    const defs: WidgetDef[] = [{ ...def('a', 10), minW: 4 }, { ...def('b', 6), minW: 6 }];
    const items = packRows(defs, [{ id: 'a', w: 10 }, { id: 'b', w: 6 }]);
    // Rest wäre 2, b darf aber nicht unter 6 ⇒ eigene Zeile, beide voll.
    expect(items.map((i) => i.w)).toEqual([12, 12]);
    expectNoGaps(items);
  });

  it('ist idempotent', () => {
    const once = packRows(M, [{ id: 'a', w: 8 }, { id: 'b', w: 6 }, { id: 'c', w: 5 }]);
    expect(packRows(M, once)).toEqual(once);
  });

  it('ignoriert Einträge ohne Definition', () => {
    const items = packRows(M, [{ id: 'weg', w: 6 }, { id: 'a', w: 6 }, { id: 'b', w: 6 }]);
    expect(items.find((i) => i.id === 'weg')?.w).toBe(6);
    expect(items.filter((i) => i.id !== 'weg').map((i) => i.w)).toEqual([6, 6]);
  });

  it('lässt das Standard-Layout des Dashboards unverändert', () => {
    const dash: WidgetDef[] = [
      { ...def('target', 5), minW: 4 },
      { ...def('kpis', 7), minW: 4 },
      { ...def('chart', 6), minW: 4 },
      { ...def('followups', 6), minW: 4 },
      { ...def('recent', 6), minW: 4 },
      { ...def('topproducts', 6), minW: 4 },
    ];
    const items = resolveLayout(dash, null);
    expect(packRows(dash, items)).toEqual(items);
  });
});
