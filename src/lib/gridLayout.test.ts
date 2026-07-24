import { describe, it, expect } from 'vitest';
import { clampSpan, resolveLayout, GRID_COLUMNS, type WidgetDef, type GridLayout } from './gridLayout';

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
