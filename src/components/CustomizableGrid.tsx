import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { GripVertical, X, Plus, RotateCcw } from 'lucide-react';
import {
  GRID_COLUMNS,
  clampSpan,
  packRows,
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
 *
 * Gespeichert werden die Wunschbreiten; gerendert wird das daraus per packRows
 * berechnete lückenlose Layout. Deshalb kann keine Anordnung entstehen, die
 * rechts ein Loch stehen lässt, und ein Zurückziehen führt exakt auf den
 * vorherigen Zustand (die Wunschbreite bleibt erhalten, auch wenn ein Nachbar
 * zwischenzeitlich geschrumpft dargestellt wurde).
 */
export function CustomizableGrid({ storageKey, widgets, editing }: Props) {
  const [items, setItems] = useState<GridItem[]>(() => resolveLayout(widgets, loadLayout(storageKey)));
  // Spiegel des aktuellen Stands: alle Änderungen laufen über apply(), damit
  // Drag/Resize aus dem jeweils frischen Stand rechnen und Speichern ohne
  // Seiteneffekt im State-Updater auskommt.
  const itemsRef = useRef(items);

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
  // Spiegel nach jedem Commit nachziehen — Refs dürfen nicht im Render
  // gelesen/geschrieben werden.
  useLayoutEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const defById = useMemo(() => new Map(widgets.map((w) => [w.id, w])), [widgets]);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragId = useRef<string | null>(null);
  const resize = useRef<{ id: string; startX: number; startW: number; colW: number } | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const apply = useCallback(
    (next: GridItem[], persist: boolean) => {
      itemsRef.current = next;
      setItems(next);
      if (persist) saveLayout(storageKey, next);
    },
    [storageKey],
  );

  // --- Umsortieren (HTML5 Drag&Drop) ---------------------------------------
  const reorder = (from: string, to: string) => {
    const arr = itemsRef.current.slice();
    const fi = arr.findIndex((x) => x.id === from);
    const ti = arr.findIndex((x) => x.id === to);
    if (fi < 0 || ti < 0 || fi === ti) return;
    const [moved] = arr.splice(fi, 1);
    arr.splice(ti, 0, moved);
    apply(arr, false);
  };

  // --- Breite ändern (Pointer-Events mit Pointer-Capture) ------------------
  const startResize = (id: string, startW: number) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const cont = containerRef.current;
    if (!cont) return;
    resize.current = { id, startX: e.clientX, startW, colW: cont.clientWidth / GRID_COLUMNS };
    setResizingId(id);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onResizeMove = (e: ReactPointerEvent) => {
    const r = resize.current;
    if (!r) return;
    const delta = Math.round((e.clientX - r.startX) / r.colW);
    const minW = defById.get(r.id)?.minW ?? 1;
    const w = Math.max(minW, clampSpan(r.startW + delta));
    apply(
      itemsRef.current.map((it) => (it.id === r.id ? { ...it, w } : it)),
      false,
    );
  };
  const endResize = () => {
    if (!resize.current) return;
    const id = resize.current.id;
    resize.current = null;
    setResizingId(null);
    // Wunschbreiten auf die tatsächlich gerenderte Breite normalisieren, damit
    // ein späterer Zug dort weitermacht, wo das Widget optisch steht. Mit
    // derselben Priorität wie beim Ziehen — sonst springt das Layout beim
    // Loslassen zurück.
    apply(packRows(widgets, itemsRef.current, id), true);
  };

  const setHidden = (id: string, hidden: boolean) =>
    apply(
      itemsRef.current.map((it) => (it.id === id ? { ...it, hidden } : it)),
      true,
    );

  const reset = () => {
    clearLayout(storageKey);
    apply(resolveLayout(widgets, null), false);
  };

  // Gerendert wird immer das gepackte Layout — jede Zeile füllt exakt 12
  // Spalten, es bleibt also nie eine Lücke am Zeilenende.
  const packed = useMemo(() => packRows(widgets, items, resizingId), [widgets, items, resizingId]);
  const visible = packed.filter((it) => !it.hidden && defById.has(it.id));
  const hidden = packed.filter((it) => it.hidden && defById.has(it.id));

  return (
    <>
      {editing && (
        <div className="cgrid-toolbar">
          <span>
            Layout anpassen: Widgets ziehen zum Sortieren, an der rechten Kante breiter/schmaler ziehen, ✕ blendet aus.
            Die Zeilen füllen sich automatisch auf — es bleibt keine Lücke.
          </span>
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
              className={`cgrid-item${draggingId === it.id ? ' is-dragging' : ''}${resizingId === it.id ? ' is-resizing' : ''}`}
              style={{ gridColumn: `span ${it.w}` }}
              onDragOver={editing ? (e) => { e.preventDefault(); const f = dragId.current; if (f && f !== it.id) reorder(f, it.id); } : undefined}
            >
              {editing && (
                <div
                  className="cgrid-bar"
                  draggable
                  onDragStart={(e) => { dragId.current = it.id; setDraggingId(it.id); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragEnd={() => { dragId.current = null; setDraggingId(null); apply(itemsRef.current, true); }}
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
