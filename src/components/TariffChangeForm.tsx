import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { Modal } from './Modal';
import { ProductPicker } from './ProductPicker';
import {
  formatCurrency,
  TARIFF_CONTEXT_LABEL,
  TARIFF_TYPE_LABEL,
  today,
} from '../lib/utils';
import type {
  TariffChange,
  TariffChangeType,
  TariffContext,
  ProductType,
} from '../types';

type Draft = Omit<TariffChange, 'id' | 'createdAt'>;

const emptyDraft = (): Draft => ({
  customerNumber: '',
  customerName: '',
  changeType: 'upgrade',
  context: 'mvlz_gt3',
  oldProduct: undefined,
  newProduct: undefined,
  changeDate: today(),
  jiraTicket: '',
  notes: '',
});

interface Props {
  open: boolean;
  editing?: TariffChange | null;
  onClose: () => void;
}

export function TariffChangeForm({ open, editing, onClose }: Props) {
  const { addTariffChange, updateTariffChange, settings, contracts, tariffChanges } = useStore();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [showProducts, setShowProducts] = useState(false);
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
        changeType: editing.changeType,
        context: editing.context,
        oldProduct: editing.oldProduct,
        newProduct: editing.newProduct,
        changeDate: editing.changeDate,
        jiraTicket: editing.jiraTicket,
        notes: editing.notes ?? '',
      });
      setShowProducts(!!editing.oldProduct || !!editing.newProduct);
    } else {
      setDraft(emptyDraft());
      setShowProducts(false);
    }
  }, [open, editing]);

  const commission = useMemo(
    () => settings.tariffCommission[draft.changeType][draft.context],
    [settings, draft.changeType, draft.context],
  );

  const valid =
    draft.customerNumber.trim().length > 0 &&
    draft.customerName.trim().length > 0;

  const save = () => {
    if (!valid) return;
    if (editing) {
      updateTariffChange(editing.id, draft);
    } else {
      addTariffChange(draft);
    }
    onClose();
  };

  const TYPE_OPTS: TariffChangeType[] = ['sidegrade', 'upgrade'];
  const CTX_OPTS: TariffContext[] = ['mvlz_gt3', 'mvlz_lt3', 'outside_mvlz'];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Tarifwechsel bearbeiten' : 'Neuer Tarifwechsel'}
      subtitle="Wähle den Typ und die MVLZ-Situation – die Provision wird automatisch berechnet."
      footer={
        <>
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={!valid}
          >
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
          <label>Wechselart</label>
          <div className="seg-group">
            {TYPE_OPTS.map((t) => (
              <button
                key={t}
                type="button"
                className={`seg ${draft.changeType === t ? 'active' : ''}`}
                onClick={() => setDraft({ ...draft, changeType: t })}
              >
                {TARIFF_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        <div className="field full">
          <label>MVLZ-Situation</label>
          <div className="seg-group">
            {CTX_OPTS.map((c) => (
              <button
                key={c}
                type="button"
                className={`seg ${draft.context === c ? 'active' : ''}`}
                onClick={() => setDraft({ ...draft, context: c })}
              >
                {TARIFF_CONTEXT_LABEL[c]}
              </button>
            ))}
          </div>
        </div>

        <div className="field full">
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              background:
                'linear-gradient(135deg, rgba(0,102,179,0.08), rgba(0,163,224,0.08))',
              border: '1px solid rgba(0,102,179,0.18)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Provision (automatisch)
            </span>
            <strong style={{ fontSize: 18, color: 'var(--tng-blue-dark)' }}>
              {formatCurrency(commission)}
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
            value={draft.changeDate}
            onChange={(e) =>
              setDraft({ ...draft, changeDate: e.target.value })
            }
          />
        </div>

        {!showProducts && (
          <div className="field full">
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => setShowProducts(true)}
              style={{ alignSelf: 'flex-start' }}
            >
              + Tarife angeben (optional)
            </button>
          </div>
        )}

        {showProducts && (
          <>
            <div className="field">
              <label>Alter Tarif</label>
              <ProductPicker
                value={draft.oldProduct ?? 'Fibrelight'}
                onChange={(p: ProductType) =>
                  setDraft({ ...draft, oldProduct: p })
                }
              />
            </div>
            <div className="field">
              <label>Neuer Tarif</label>
              <ProductPicker
                value={draft.newProduct ?? 'Fibrepro'}
                onChange={(p: ProductType) =>
                  setDraft({ ...draft, newProduct: p })
                }
              />
            </div>
          </>
        )}

        <div className="field full">
          <label>Notiz</label>
          <textarea
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="Optional"
          />
        </div>
      </div>
    </Modal>
  );
}
