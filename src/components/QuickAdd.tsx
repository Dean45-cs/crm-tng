import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, FileSignature, ArrowLeftRight, StickyNote, X } from 'lucide-react';
import { ContractForm } from './ContractForm';
import { TariffChangeForm } from './TariffChangeForm';
import { NoteForm } from './NoteForm';
import type { Contract, Note, ProductType, TariffChange } from '../types';
import {
  getStoredHotkeys,
  hotkeyLabel,
  hotkeyMatches,
  onHotkeysChange,
  resolveHotkey,
  type HotkeyMap,
} from '../lib/hotkeys';

type FormKind = 'contract' | 'tariff' | 'note' | null;

export interface QuickAddPrefill {
  customerNumber: string;
  customerName: string;
  /** Vorbelegte Produkte, z.B. das Zielprodukt einer Outbound-Kampagne */
  products?: ProductType[];
  /** Vorbelegte Notiz, z.B. Herkunft des Abschlusses */
  notes?: string;
}

interface QuickAddCtx {
  openNewContract: (prefill?: QuickAddPrefill) => void;
  openNewTariff: (prefill?: QuickAddPrefill) => void;
  openNewNote: (prefill?: QuickAddPrefill) => void;
  editContract: (c: Contract) => void;
  editTariff: (t: TariffChange) => void;
  editNote: (n: Note) => void;
}

const Ctx = createContext<QuickAddCtx | null>(null);

// Context-Hook bewusst neben dem Provider — der Fast-Refresh-Hinweis ist
// nur eine Dev-DX-Warnung und ohne Laufzeit-Auswirkung.
// eslint-disable-next-line react-refresh/only-export-components
export const useQuickAdd = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useQuickAdd must be used within QuickAddProvider');
  return c;
};

export function QuickAddProvider({ children }: { children: ReactNode }) {
  const [form, setForm] = useState<FormKind>(null);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [editingTariff, setEditingTariff] = useState<TariffChange | null>(null);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [prefill, setPrefill] = useState<QuickAddPrefill | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const close = useCallback(() => {
    setForm(null);
    setEditingContract(null);
    setEditingTariff(null);
    setEditingNote(null);
    setPrefill(null);
  }, []);

  // Stabile Referenz — alle Aktionen nutzen nur useState-Setter (selbst stabil),
  // damit Konsumenten wie CommandPalette nicht bei jedem Render neu memoisieren.
  const ctx: QuickAddCtx = useMemo(
    () => ({
      openNewContract: (p) => {
        setEditingContract(null);
        setPrefill(p ?? null);
        setForm('contract');
        setMenuOpen(false);
      },
      openNewTariff: (p) => {
        setEditingTariff(null);
        setPrefill(p ?? null);
        setForm('tariff');
        setMenuOpen(false);
      },
      openNewNote: (p) => {
        setEditingNote(null);
        setPrefill(p ?? null);
        setForm('note');
        setMenuOpen(false);
      },
      editContract: (c) => { setEditingContract(c); setPrefill(null); setForm('contract'); },
      editTariff: (t) => { setEditingTariff(t); setPrefill(null); setForm('tariff'); },
      editNote: (n) => { setEditingNote(n); setPrefill(null); setForm('note'); },
    }),
    [],
  );

  // Welche Tasten das sind, steht in den Einstellungen (lib/hotkeys.ts).
  const [hotkeys, setHotkeysState] = useState<HotkeyMap>(getStoredHotkeys);
  useEffect(() => onHotkeysChange(setHotkeysState), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Reihenfolge zählt nicht, weil hotkeyMatches die Zusatztasten exakt
      // vergleicht: ⌘⇧N ist nie zugleich ⌘N.
      const actions: [string, () => void][] = [
        [resolveHotkey('newNote', hotkeys), ctx.openNewNote],
        [resolveHotkey('newContract', hotkeys), ctx.openNewContract],
        [resolveHotkey('newTariff', hotkeys), ctx.openNewTariff],
      ];
      for (const [binding, run] of actions) {
        if (!hotkeyMatches(e, binding)) continue;
        e.preventDefault();
        run();
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [ctx, hotkeys]);

  return (
    <Ctx.Provider value={ctx}>
      {children}

      <div className="fab-wrap">
        {menuOpen && (
          <div className="fab-menu">
            <FabItem
              icon={<FileSignature size={16} />}
              label="Vertrag"
              hint={hotkeyLabel(resolveHotkey('newContract', hotkeys))}
              onClick={() => ctx.openNewContract()}
              color="bg-blue"
            />
            <FabItem
              icon={<ArrowLeftRight size={16} />}
              label="Tarifwechsel"
              hint={hotkeyLabel(resolveHotkey('newTariff', hotkeys))}
              onClick={() => ctx.openNewTariff()}
              color="bg-orange"
            />
            <FabItem
              icon={<StickyNote size={16} />}
              label="Notiz"
              hint={hotkeyLabel(resolveHotkey('newNote', hotkeys))}
              onClick={() => ctx.openNewNote()}
              color="bg-purple"
            />
          </div>
        )}
        <button
          className={`fab ${menuOpen ? 'open' : ''}`}
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Schnell hinzufügen"
          title="Schnell hinzufügen"
        >
          {menuOpen ? <X size={22} /> : <Plus size={22} />}
        </button>
      </div>

      <ContractForm
        open={form === 'contract'}
        editing={editingContract}
        prefill={prefill}
        onClose={close}
      />
      <TariffChangeForm
        open={form === 'tariff'}
        editing={editingTariff}
        prefill={prefill}
        onClose={close}
      />
      <NoteForm
        open={form === 'note'}
        editing={editingNote}
        prefill={prefill}
        onClose={close}
      />
    </Ctx.Provider>
  );
}

function FabItem({
  icon,
  label,
  hint,
  onClick,
  color,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  color: string;
}) {
  return (
    <button className="fab-item" onClick={onClick}>
      <span className={`fab-item-icon ${color}`}>{icon}</span>
      <span className="fab-item-label">{label}</span>
      {hint && <span className="fab-item-hint">{hint}</span>}
    </button>
  );
}
