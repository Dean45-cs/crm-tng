import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { Modal } from './Modal';
import { ProductPicker } from './ProductPicker';
import { formatCurrency, getProductCommission, today } from '../lib/utils';
import type { Contract, ContractStatus, ProductType } from '../types';

type Draft = Omit<Contract, 'id' | 'createdAt'>;

const emptyDraft = (): Draft => ({
  customerNumber: '',
  customerName: '',
  products: ['Fibrefamily'],
  contractDate: today(),
  status: 'aktiv',
  jiraTicket: '',
  followUpDate: '',
  notes: '',
});

interface Props {
  open: boolean;
  editing?: Contract | null;
  onClose: () => void;
}

export function ContractForm({ open, editing, onClose }: Props) {
  const { addContract, updateContract, settings, contracts, tariffChanges } = useStore();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [showMore, setShowMore] = useState(false);
  const [addingProduct, setAddingProduct] = useState<ProductType>('Waipu TV');
  const [kdnrFocused, setKdnrFocused] = useState(false);

  const knownCustomers = useMemo(() => {
    const map = new Map<string, string>();
    contracts.forEach((c) => {
      if (c.customerNumber && c.customerName) map.set(c.customerNumber, c.customerName);
    });
    tariffChanges.forEach((t) => {
      if (t.customerNumber && t.customerName && !map.has(t.customerNumber)) {
        map.set(t.customerNumber, t.customerName);
      }
    });
    return Array.from(map.entries()).map(([kdnr, name]) => ({ kdnr, name }));
  }, [contracts, tariffChanges]);

  const suggestions = useMemo(() => {
    const q = draft.customerNumber.trim().toLowerCase();
    if (!q) return [];
    return knownCustomers
      .filter((c) => c.kdnr.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
      .filter((c) => c.kdnr !== draft.customerNumber || c.name !== draft.customerName)
      .slice(0, 6);
  }, [knownCustomers, draft.customerNumber, draft.customerName]);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setDraft({
        customerNumber: editing.customerNumber,
        customerName: editing.customerName,
        products: editing.products.length > 0 ? editing.products : ['Fibrefamily'],
        contractDate: editing.contractDate,
        status: editing.status,
        jiraTicket: editing.jiraTicket,
        followUpDate: editing.followUpDate ?? '',
        notes: editing.notes ?? '',
      });
      setShowMore(true);
    } else {
      setDraft(emptyDraft());
      setShowMore(false);
    }
  }, [open, editing]);

  const totalCommission = useMemo(
    () =>
      draft.products.reduce(
        (sum, p) => sum + getProductCommission(settings, p),
        0,
      ),
    [draft.products, settings],
  );

  const valid =
    draft.customerNumber.trim().length > 0 &&
    draft.customerName.trim().length > 0 &&
    draft.products.length > 0;

  const save = () => {
    if (!valid) return;
    if (editing) updateContract(editing.id, draft);
    else addContract(draft);
    onClose();
  };

  const updateProductAt = (idx: number, p: ProductType) => {
    setDraft({
      ...draft,
      products: draft.products.map((x, i) => (i === idx ? p : x)),
    });
  };

  const removeProductAt = (idx: number) => {
    if (draft.products.length <= 1) return;
    setDraft({
      ...draft,
      products: draft.products.filter((_, i) => i !== idx),
    });
  };

  const addProduct = () => {
    setDraft({ ...draft, products: [...draft.products, addingProduct] });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Vertrag bearbeiten' : 'Neuer Vertrag'}
      subtitle="Mehrere Produkte für einen Bundle-Verkauf einfach hinzufügen."
      footer={
        <>
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={save} disabled={!valid}>
            Speichern
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field">
          <label>Kundennummer *</label>
          <div className="typeahead-wrap">
            <input
              autoFocus
              value={draft.customerNumber}
              onChange={(e) =>
                setDraft({ ...draft, customerNumber: e.target.value })
              }
              onFocus={() => setKdnrFocused(true)}
              onBlur={() => setTimeout(() => setKdnrFocused(false), 150)}
              placeholder="z.B. 1234567"
              autoComplete="off"
            />
            {kdnrFocused && suggestions.length > 0 && (
              <div className="typeahead-dropdown">
                {suggestions.map((s) => (
                  <button
                    key={s.kdnr}
                    type="button"
                    className="typeahead-item"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setDraft({
                        ...draft,
                        customerNumber: s.kdnr,
                        customerName: s.name,
                      });
                      setKdnrFocused(false);
                    }}
                  >
                    <code className="typeahead-kdnr">{s.kdnr}</code>
                    <span className="typeahead-name">{s.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="field">
          <label>Kunde *</label>
          <input
            value={draft.customerName}
            onChange={(e) =>
              setDraft({ ...draft, customerName: e.target.value })
            }
            placeholder="Max Mustermann"
          />
        </div>

        <div className="field full">
          <label>Produkte ({draft.products.length})</label>
          <div className="bundle-list">
            {draft.products.map((p, i) => (
              <div key={i} className="bundle-row">
                <div style={{ flex: 1 }}>
                  <ProductPicker
                    value={p}
                    onChange={(np) => updateProductAt(i, np)}
                  />
                </div>
                {draft.products.length > 1 && (
                  <button
                    className="icon-btn"
                    type="button"
                    onClick={() => removeProductAt(i)}
                    title="Produkt entfernen"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
            <div className="bundle-row">
              <div style={{ flex: 1 }}>
                <ProductPicker
                  value={addingProduct}
                  onChange={(p) => setAddingProduct(p)}
                />
              </div>
              <button
                className="btn btn-sm"
                type="button"
                onClick={addProduct}
                title="Produkt hinzufügen"
              >
                <Plus size={13} /> Hinzufügen
              </button>
            </div>
          </div>
          <div className="bundle-total">
            <span className="muted" style={{ fontSize: 12.5 }}>
              Gesamtprovision
            </span>
            <strong style={{ color: 'var(--tng-blue-dark)' }}>
              {formatCurrency(totalCommission)}
            </strong>
          </div>
        </div>

        <div className="field">
          <label>Jira-Vorgang</label>
          <input
            value={draft.jiraTicket}
            onChange={(e) =>
              setDraft({ ...draft, jiraTicket: e.target.value })
            }
            placeholder="z.B. TNG-1234"
          />
        </div>
        <div className="field">
          <label>Datum</label>
          <input
            type="date"
            value={draft.contractDate}
            onChange={(e) =>
              setDraft({ ...draft, contractDate: e.target.value })
            }
          />
        </div>

        {!showMore && (
          <div className="field full">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowMore(true)}
              type="button"
              style={{ alignSelf: 'flex-start' }}
            >
              + Mehr Angaben (Status, Wiedervorlage, Notiz)
            </button>
          </div>
        )}

        {showMore && (
          <>
            <div className="field">
              <label>Status</label>
              <select
                value={draft.status}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    status: e.target.value as ContractStatus,
                  })
                }
              >
                <option value="aktiv">Aktiv</option>
                <option value="offen">Offen</option>
                <option value="storniert">Storniert</option>
              </select>
            </div>
            <div className="field">
              <label>Wiedervorlage</label>
              <input
                type="date"
                value={draft.followUpDate}
                onChange={(e) =>
                  setDraft({ ...draft, followUpDate: e.target.value })
                }
              />
            </div>
            <div className="field full">
              <label>Notiz</label>
              <textarea
                value={draft.notes}
                onChange={(e) =>
                  setDraft({ ...draft, notes: e.target.value })
                }
                placeholder="Optional"
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
