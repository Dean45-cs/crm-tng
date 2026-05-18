import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Users } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useRouter } from '../router';
import { buildCustomerSummaries, formatCurrency } from '../lib/utils';

export function CustomerSearchBar() {
  const { contracts, tariffChanges, notes, settings } = useStore();
  const { navigate } = useRouter();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const customers = useMemo(
    () => buildCustomerSummaries(contracts, tariffChanges, notes, settings),
    [contracts, tariffChanges, notes, settings],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return customers
      .filter(
        (c) =>
          c.customerName.toLowerCase().includes(q) ||
          c.customerNumber.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [customers, query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = useCallback(
    (kdnr: string) => {
      navigate({ name: 'customer', kdnr });
      setQuery('');
      setOpen(false);
    },
    [navigate],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={wrapRef} className="header-search-wrap">
      <div className="header-search-row">
        <Search size={14} className="header-search-icon" />
        <input
          ref={inputRef}
          className="header-search-input"
          placeholder="Kunden suchen …"
          value={query}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => { if (query) setOpen(true); }}
          onKeyDown={handleKeyDown}
        />
      </div>

      {open && results.length > 0 && (
        <div className="header-search-dropdown">
          {results.map((c) => (
            <button
              key={c.customerNumber}
              className="header-search-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(c.customerNumber)}
            >
              <Users size={13} className="header-search-item-icon" />
              <div className="header-search-item-text">
                <span className="header-search-item-name">{c.customerName}</span>
                <span className="header-search-item-meta">
                  KdNr. {c.customerNumber} · {formatCurrency(c.totalCommission)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
