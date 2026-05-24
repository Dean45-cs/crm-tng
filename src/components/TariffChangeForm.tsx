import { useEffect, useId, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { Modal } from './Modal';
import { ProductPicker } from './ProductPicker';
import {
  formatCurrency,
  TARIFF_CONTEXT_LABEL,
  TARIFF_TYPE_LABEL,
  today,
} from '../lib/utils';
import { isJiraTicket, normalizeJiraTicket, findDuplicateCustomer } from '../lib/validation';
import type {
  TariffChange,
  TariffChangeType,
  TariffContext,
  ProductType,
} from '../types';
import type { QuickAddPrefill } from './QuickAdd';

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
  prefill?: QuickAddPrefill | null;
  onClose: () => void;
}

export function TariffChangeForm({ open, editing, prefill, onClose }: Props) {
  const { addTariffChange, updateTariffChange, settings, contracts, tariffChanges } = useStore();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showProducts, setShowProducts] = useState(false);
  const [kdnrFocused, setKdnrFocused] = useState(false);
  const fid = useId();

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

  const duplicateName = useMemo(
    () => findDuplicateCustomer(draft.customerNumber, draft.customerName, contracts, tariffChanges),
    [draft.customerNumber, draft.customerName, contracts, tariffChanges],
  );

  useEffect(() => {
    if (!open) return;
    if (editing) {
      // Bewusster Formular-Reset beim Öffnen / Datensatzwechsel — synchrones
      // setState ist hier korrekt (Sync auf die open/editing/prefill-Props).
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
      setErrors({});
    } else {
      const base = emptyDraft();
      if (prefill?.customerNumber) base.customerNumber = prefill.customerNumber;
      if (prefill?.customerName) base.customerName = prefill.customerName;
      setDraft(base);
      setShowProducts(false);
      setErrors({});
    }
  }, [open, editing, prefill]);

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setErrors((e) => {
      if (Object.keys(e).length === 0) return e;
      const next = { ...e };
      Object.keys(patch).forEach((k) => delete next[k]);
      return next;
    });
  };

  const commission = useMemo(
    () => settings.tariffCommission[draft.changeType][draft.context],
    [settings, draft.changeType, draft.context],
  );

  const save = () => {
    const trimmed: Draft = {
      ...draft,
      customerNumber: draft.customerNumber.trim(),
      customerName: draft.customerName.trim(),
      jiraTicket: normalizeJiraTicket(draft.jiraTicket),
      notes: draft.notes?.trim() || '',
    };
    const errs: Record<string, string> = {};
    if (!trimmed.customerNumber) errs.customerNumber = 'Bitte Kundennummer eingeben.';
    if (!trimmed.customerName) errs.customerName = 'Bitte Kundenname eingeben.';
    if (!isJiraTicket(trimmed.jiraTicket)) errs.jiraTicket = 'Ungültiges Format – z.B. TNG-1234.';
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    if (editing) updateTariffChange(editing.id, trimmed);
    else addTariffChange(trimmed);
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
          <button className="btn btn-primary" onClick={save}>
            Speichern
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field">
          <label htmlFor={`${fid}-kdnr`}>Kundennummer *</label>
          <div className="typeahead-wrap">
            <input
              id={`${fid}-kdnr`}
              autoFocus
              role="combobox"
              aria-expanded={kdnrFocused && suggestions.length > 0}
              aria-controls={`${fid}-kdnr-list`}
              aria-autocomplete="list"
              aria-invalid={!!errors.customerNumber}
              aria-describedby={errors.customerNumber ? `${fid}-kdnr-err` : undefined}
              value={draft.customerNumber}
              onChange={(e) => update({ customerNumber: e.target.value })}
              onFocus={() => setKdnrFocused(true)}
              onBlur={() => setTimeout(() => setKdnrFocused(false), 150)}
              placeholder="z.B. 1234567"
              autoComplete="off"
            />
            {kdnrFocused && suggestions.length > 0 && (
              <div className="typeahead-dropdown" role="listbox" id={`${fid}-kdnr-list`}>
                {suggestions.map((s) => (
                  <button
                    key={s.kdnr}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="typeahead-item"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      update({ customerNumber: s.kdnr, customerName: s.name });
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
          {errors.customerNumber && (
            <div className="field-error" id={`${fid}-kdnr-err`}>{errors.customerNumber}</div>
          )}
        </div>
        <div className="field">
          <label htmlFor={`${fid}-name`}>Kunde *</label>
          <input
            id={`${fid}-name`}
            aria-invalid={!!errors.customerName}
            aria-describedby={errors.customerName ? `${fid}-name-err` : undefined}
            value={draft.customerName}
            onChange={(e) => update({ customerName: e.target.value })}
            placeholder="Max Mustermann"
          />
          {errors.customerName && (
            <div className="field-error" id={`${fid}-name-err`}>{errors.customerName}</div>
          )}
          {!errors.customerName && duplicateName && (
            <div className="field-warning">
              <AlertTriangle size={12} />
              KdNr. bereits bekannt als „{duplicateName}".
            </div>
          )}
        </div>

        <div className="field full">
          <label>Wechselart</label>
          <div className="seg-group">
            {TYPE_OPTS.map((t) => (
              <button
                key={t}
                type="button"
                className={`seg ${draft.changeType === t ? 'active' : ''}`}
                onClick={() => update({ changeType: t })}
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
                onClick={() => update({ context: c })}
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
          <label htmlFor={`${fid}-jira`}>Jira-Vorgang</label>
          <input
            id={`${fid}-jira`}
            aria-invalid={!!errors.jiraTicket}
            aria-describedby={errors.jiraTicket ? `${fid}-jira-err` : undefined}
            value={draft.jiraTicket}
            onChange={(e) => update({ jiraTicket: e.target.value })}
            onBlur={() => update({ jiraTicket: normalizeJiraTicket(draft.jiraTicket) })}
            placeholder="z.B. TNG-1234"
          />
          {errors.jiraTicket && (
            <div className="field-error" id={`${fid}-jira-err`}>{errors.jiraTicket}</div>
          )}
        </div>
        <div className="field">
          <label htmlFor={`${fid}-date`}>Datum</label>
          <input
            id={`${fid}-date`}
            type="date"
            value={draft.changeDate}
            onChange={(e) => update({ changeDate: e.target.value })}
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
                onChange={(p: ProductType) => update({ oldProduct: p })}
              />
            </div>
            <div className="field">
              <label>Neuer Tarif</label>
              <ProductPicker
                value={draft.newProduct ?? 'Fibrepro'}
                onChange={(p: ProductType) => update({ newProduct: p })}
              />
            </div>
          </>
        )}

        <div className="field full">
          <label htmlFor={`${fid}-notes`}>Notiz</label>
          <textarea
            id={`${fid}-notes`}
            value={draft.notes}
            onChange={(e) => update({ notes: e.target.value })}
            placeholder="Optional"
          />
        </div>
      </div>
    </Modal>
  );
}
