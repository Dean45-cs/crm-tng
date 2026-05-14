import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Plus, FileSignature, ArrowLeftRight, StickyNote, X } from 'lucide-react';
import { ContractForm } from './ContractForm';
import { TariffChangeForm } from './TariffChangeForm';
import { NoteForm } from './NoteForm';
import type { Contract, Note, TariffChange } from '../types';

type FormKind = 'contract' | 'tariff' | 'note' | null;

export interface QuickAddPrefill {
  customerNumber: string;
  customerName: string;
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

  const ctx: QuickAddCtx = {
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
  };

  // Cmd/Ctrl + N → Vertrag, Cmd/Ctrl + T → Tarifwechsel, Cmd/Ctrl + Shift + N → Notiz
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'n' && e.shiftKey) {
        e.preventDefault();
        ctx.openNewNote();
      } else if (k === 'n') {
        e.preventDefault();
        ctx.openNewContract();
      } else if (k === 't') {
        e.preventDefault();
        ctx.openNewTariff();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Ctx.Provider value={ctx}>
      {children}

      <div className="fab-wrap">
        {menuOpen && (
          <div className="fab-menu">
            <FabItem
              icon={<FileSignature size={16} />}
              label="Vertrag"
              hint="⌘N"
              onClick={() => ctx.openNewContract()}
              color="bg-blue"
            />
            <FabItem
              icon={<ArrowLeftRight size={16} />}
              label="Tarifwechsel"
              hint="⌘T"
              onClick={() => ctx.openNewTariff()}
              color="bg-orange"
            />
            <FabItem
              icon={<StickyNote size={16} />}
              label="Notiz"
              hint="⌘⇧N"
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
