import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { GripVertical, X, Plus, RotateCcw } from 'lucide-react';
import {
  GRID_COLUMNS,
  clampSpan,
  resolveLayout,
  loadLayout,
  saveLayout,
  clearLayout,
  type GridItem,
  type WidgetDef,
} from '../lib/gridLayout';

type Props = {
  storageKey: string;
  widgets: WidgetDef[];
  editing: boolean;
};

/**
 * Anpassbares Widget-Grid für das Dashboard. Im Bearbeitungsmodus lassen sich
 * Widgets per Drag umsortieren, an der rechten Kante in der Breite ziehen,
 * ausblenden und wieder hinzufügen. Ohne Bearbeitung rendert es exakt die
 * Widgets in gespeicherter Reihenfolge/Breite — Standard = das heutige Layout.
 */
export function CustomizableGrid({ storageKey, widgets, editing }: Props) {
  const [items, setItems] = useState<GridItem[]>(() => resolveLayout(widgets, loadLayout(storageKey)));

  // Widget-Set kann sich ändern (neue/entfernte Widgets) — beim Wechsel der
  // Id-Menge neu abgleichen, ohne die persönliche Reihenfolge zu verlieren.
  // Offizielles React-Muster „Zustand beim Rendern anpassen" (per State-Vergleich,
  // nicht per Ref).
  const idSignature = widgets.map((w) => w.id).join('|');
  const [prevSignature, setPrevSignature] = useState(idSignature);
  if (prevSignature !== idSignature) {
    setPrevSignature(idSignature);
    setItems((prev) => resolveLayout(widgets, { items: prev }));
  }

  const defById = useMemo(() => new Map(widgets.map((w) => [w.id, w])), [widgets]);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragId = useRef<string | null>(null);
  const resize = useRef<{ id: string; startX: number; startW: number; colW: number } | null>(null);

  const commit = (next: GridItem[]) => {
    setItems(next);
    saveLayout(storageKey, next);
  };

  // --- Umsortieren (HTML5 Drag&Drop) ---------------------------------------
  const reorder = (from: string, to: string) => {
    setItems((prev) => {
      const arr = prev.slice();
      const fi = arr.findIndex((x) => x.id === from);
      const ti = arr.findIndex((x) => x.id === to);
      if (fi < 0 || ti < 0 || fi === ti) return prev;
      const [moved] = arr.splice(fi, 1);
      arr.splice(ti, 0, moved);
      return arr;
    });
  };

  // --- Breite ändern (Pointer-Events mit Pointer-Capture) ------------------
  const startResize = (id: string, startW: number) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const cont = containerRef.current;
    if (!cont) return;
    resize.current = { id, startX: e.clientX, startW, colW: cont.clientWidth / GRID_COLUMNS };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onResizeMove = (e: ReactPointerEvent) => {
    const r = resize.current;
    if (!r) return;
    const delta = Math.round((e.clientX - r.startX) / r.colW);
    const minW = defById.get(r.id)?.minW ?? 1;
    const w = Math.max(minW, clampSpan(r.startW + delta));
    setItems((prev) => prev.map((it) => (it.id === r.id ? { ...it, w } : it)));
  };
  const endResize = () => {
    if (!resize.current) return;
    resize.current = null;
    setItems((prev) => {
      saveLayout(storageKey, prev);
      return prev;
    });
  };

  const setHidden = (id: string, hidden: boolean) =>
    commit(items.map((it) => (it.id === id ? { ...it, hidden } : it)));

  const reset = () => {
    clearLayout(storageKey);
    setItems(resolveLayout(widgets, null));
  };

  const visible = items.filter((it) => !it.hidden && defById.has(it.id));
  const hidden = items.filter((it) => it.hidden && defById.has(it.id));

  return (
    <>
      {editing && (
        <div className="cgrid-toolbar">
          <span>Layout anpassen: Widgets ziehen zum Sortieren, an der rechten Kante breiter/schmaler ziehen, ✕ blendet aus.</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
            <RotateCcw size={14} /> Zurücksetzen
          </button>
        </div>
      )}

      {editing && hidden.length > 0 && (
        <div className="cgrid-tray">
          <span className="muted">Ausgeblendet:</span>
          {hidden.map((it) => {
            const def = defById.get(it.id)!;
            return (
              <button key={it.id} type="button" className="cgrid-readd" onClick={() => setHidden(it.id, false)}>
                <Plus size={13} /> {def.title}
              </button>
            );
          })}
        </div>
      )}

      <div className={`cgrid${editing ? ' is-editing' : ''}`} ref={containerRef}>
        {visible.map((it) => {
          const def = defById.get(it.id)!;
          return (
            <div
              key={it.id}
              className="cgrid-item"
              style={{ gridColumn: `span ${it.w}` }}
              onDragOver={editing ? (e) => { e.preventDefault(); const f = dragId.current; if (f && f !== it.id) reorder(f, it.id); } : undefined}
            >
              {editing && (
                <div
                  className="cgrid-bar"
                  draggable
                  onDragStart={(e) => { dragId.current = it.id; e.dataTransfer.effectAllowed = 'move'; }}
                  onDragEnd={() => { dragId.current = null; saveLayout(storageKey, items); }}
                >
                  <span className="cgrid-handle"><GripVertical size={14} /> {def.title}</span>
                  <button type="button" className="cgrid-hide" title="Ausblenden" onClick={() => setHidden(it.id, true)}>
                    <X size={14} />
                  </button>
                </div>
              )}
              <div className="cgrid-body">{def.render()}</div>
              {editing && (
                <div
                  className="cgrid-resize"
                  title="Breite ändern"
                  onPointerDown={startResize(it.id, it.w)}
                  onPointerMove={onResizeMove}
                  onPointerUp={endResize}
                  onPointerCancel={endResize}
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
