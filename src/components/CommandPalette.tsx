import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Search,
  FileSignature,
  ArrowLeftRight,
  StickyNote,
  Users,
  LayoutDashboard,
  Trophy,
  Target,
  Settings as SettingsIcon,
  Plus,
  CornerDownLeft,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useRouter, type Route } from '../router';
import { useQuickAdd } from './QuickAdd';
import { buildCustomerSummaries, formatCurrency } from '../lib/utils';

interface CmdItem {
  id: string;
  group: string;
  icon: ReactNode;
  label: string;
  sub?: string;
  run: () => void;
}

export function CommandPalette() {
  const { contracts, tariffChanges, notes, settings } = useStore();
  const { navigate } = useRouter();
  const { openNewContract, openNewTariff, openNewNote, editContract, editTariff, editNote } =
    useQuickAdd();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const openPalette = useCallback(() => {
    setQuery('');
    setActiveIdx(0);
    setOpen(true);
  }, []);
  const closePalette = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (openRef.current) closePalette();
        else openPalette();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openPalette, closePalette]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const customers = useMemo(
    () => buildCustomerSummaries(contracts, tariffChanges, notes, settings),
    [contracts, tariffChanges, notes, settings],
  );

  const items: CmdItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const close = () => setOpen(false);
    const go = (r: Route) => () => {
      navigate(r);
      close();
    };

    const navItems: CmdItem[] = [
      { id: 'nav-dashboard', group: 'Navigation', icon: <LayoutDashboard size={15} />, label: 'Dashboard', run: go({ name: 'dashboard' }) },
      { id: 'nav-leads', group: 'Navigation', icon: <Target size={15} />, label: 'Leads', run: go({ name: 'leads' }) },
      { id: 'nav-contracts', group: 'Navigation', icon: <FileSignature size={15} />, label: 'Verträge', run: go({ name: 'contracts' }) },
      { id: 'nav-tariff', group: 'Navigation', icon: <ArrowLeftRight size={15} />, label: 'Tarifwechsel', run: go({ name: 'tariff' }) },
      { id: 'nav-notes', group: 'Navigation', icon: <StickyNote size={15} />, label: 'Notizen', run: go({ name: 'notes' }) },
      { id: 'nav-customers', group: 'Navigation', icon: <Users size={15} />, label: 'Kunden', run: go({ name: 'customers' }) },
      { id: 'nav-leaderboard', group: 'Navigation', icon: <Trophy size={15} />, label: 'Leaderboard', run: go({ name: 'leaderboard' }) },
      { id: 'nav-settings', group: 'Navigation', icon: <SettingsIcon size={15} />, label: 'Einstellungen', run: go({ name: 'settings' }) },
    ];

    const newItems: CmdItem[] = [
      { id: 'new-contract', group: 'Neu anlegen', icon: <Plus size={15} />, label: 'Neuer Vertrag', run: () => { openNewContract(); close(); } },
      { id: 'new-tariff', group: 'Neu anlegen', icon: <Plus size={15} />, label: 'Neuer Tarifwechsel', run: () => { openNewTariff(); close(); } },
      { id: 'new-note', group: 'Neu anlegen', icon: <Plus size={15} />, label: 'Neue Notiz', run: () => { openNewNote(); close(); } },
    ];

    if (!q) return [...newItems, ...navItems];

    const matches = (s: string) => s.toLowerCase().includes(q);

    const customerItems: CmdItem[] = customers
      .filter((c) => matches(c.customerName) || matches(c.customerNumber))
      .slice(0, 6)
      .map((c) => ({
        id: `cust-${c.customerNumber}`,
        group: 'Kunden',
        icon: <Users size={15} />,
        label: c.customerName || c.customerNumber,
        sub: `KdNr. ${c.customerNumber} · ${formatCurrency(c.totalCommission)}`,
        run: () => {
          navigate({ name: 'customer', kdnr: c.customerNumber });
          close();
        },
      }));

    const contractItems: CmdItem[] = contracts
      .filter((c) => matches(c.customerName) || matches(c.customerNumber) || matches(c.jiraTicket) || c.products.some(matches))
      .slice(0, 5)
      .map((c) => ({
        id: `contract-${c.id}`,
        group: 'Verträge',
        icon: <FileSignature size={15} />,
        label: c.customerName || c.customerNumber,
        sub: `${c.products.join(', ')} · ${c.contractDate}`,
        run: () => { editContract(c); close(); },
      }));

    const tariffItems: CmdItem[] = tariffChanges
      .filter((t) => matches(t.customerName) || matches(t.customerNumber) || matches(t.jiraTicket))
      .slice(0, 5)
      .map((t) => ({
        id: `tariff-${t.id}`,
        group: 'Tarifwechsel',
        icon: <ArrowLeftRight size={15} />,
        label: t.customerName || t.customerNumber,
        sub: `KdNr. ${t.customerNumber} · ${t.changeDate}`,
        run: () => { editTariff(t); close(); },
      }));

    const noteItems: CmdItem[] = notes
      .filter((n) => matches(n.title) || matches(n.content) || matches(n.customerName ?? '') || matches(n.jiraTicket ?? ''))
      .slice(0, 5)
      .map((n) => ({
        id: `note-${n.id}`,
        group: 'Notizen',
        icon: <StickyNote size={15} />,
        label: n.title,
        sub: n.customerName || n.content.slice(0, 48),
        run: () => { editNote(n); close(); },
      }));

    const navMatches = navItems.filter((n) => matches(n.label));

    return [...customerItems, ...contractItems, ...tariffItems, ...noteItems, ...navMatches];
  }, [query, customers, contracts, tariffChanges, notes, navigate, openNewContract, openNewTariff, openNewNote, editContract, editTariff, editNote]);

  const safeIdx = items.length === 0 ? 0 : Math.min(activeIdx, items.length - 1);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [safeIdx]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(items.length === 0 ? 0 : (safeIdx + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(items.length === 0 ? 0 : (safeIdx - 1 + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[safeIdx]?.run();
    }
  };

  let lastGroup = '';

  return (
    <div className="cmdk-backdrop" onClick={() => setOpen(false)}>
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Schnellsuche"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="cmdk-input-row">
          <Search size={17} />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Kunden, Verträge, Tarifwechsel, Notizen suchen …"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            role="combobox"
            aria-expanded
            aria-controls="cmdk-list"
            aria-autocomplete="list"
            autoComplete="off"
          />
          <kbd className="cmdk-kbd">Esc</kbd>
        </div>

        <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef}>
          {items.length === 0 ? (
            <div className="cmdk-empty">Keine Treffer für „{query}".</div>
          ) : (
            items.map((item, idx) => {
              const showGroup = item.group !== lastGroup;
              lastGroup = item.group;
              return (
                <div key={item.id}>
                  {showGroup && <div className="cmdk-group">{item.group}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={idx === safeIdx}
                    data-active={idx === safeIdx}
                    className={`cmdk-item ${idx === safeIdx ? 'active' : ''}`}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => item.run()}
                  >
                    <span className="cmdk-item-icon">{item.icon}</span>
                    <span className="cmdk-item-text">
                      <span className="cmdk-item-label">{item.label}</span>
                      {item.sub && <span className="cmdk-item-sub">{item.sub}</span>}
                    </span>
                    {idx === safeIdx && (
                      <CornerDownLeft size={13} className="cmdk-item-enter" />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="cmdk-footer">
          <span><kbd className="cmdk-kbd">↑</kbd><kbd className="cmdk-kbd">↓</kbd> navigieren</span>
          <span><kbd className="cmdk-kbd">↵</kbd> öffnen</span>
          <span className="cmdk-footer-hint"><kbd className="cmdk-kbd">⌘</kbd><kbd className="cmdk-kbd">K</kbd> Schnellsuche</span>
        </div>
      </div>
    </div>
  );
}
