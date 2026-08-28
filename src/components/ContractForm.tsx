import { useEffect, useId, useMemo, useState } from 'react';
import { Plus, X, AlertTriangle, Coins, ClipboardCopy } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { Modal } from './Modal';
import { ProductPicker } from './ProductPicker';
import {
  formatCurrency,
  getProductCommission,
  today,
  contractEndDate,
  buildContractJiraDoc,
  copyToClipboard,
} from '../lib/utils';
import { isJiraTicket, normalizeJiraTicket, findDuplicateCustomer } from '../lib/validation';
import { toast } from '../store/useToast';
import type { Contract, ContractStatus, ProductType } from '../types';
import type { QuickAddPrefill } from './QuickAdd';

type Draft = Omit<Contract, 'id' | 'createdAt'>;

const emptyDraft = (): Draft => ({
  customerNumber: '',
  customerName: '',
  products: ['Fibrefamily'],
  contractDate: today(),
  status: 'aktiv',
  jiraTicket: '',
  followUpDate: '',
  laufzeitMonate: null,
  notes: '',
});

interface Props {
  open: boolean;
  editing?: Contract | null;
  prefill?: QuickAddPrefill | null;
  onClose: () => void;
}

export function ContractForm({ open, editing, prefill, onClose }: Props) {
  const { addContract, updateContract, settings, contracts, tariffChanges } = useStore();
  // Provisions-Vorschau misst gegen das PERSÖNLICHE Monatsziel (AuthUser.monthlyTarget
  // ist überall die Quelle der Wahrheit, siehe teamStats.ts), nicht gegen den
  // globalen Settings-Wert.
  const currentUser = useAuth((s) => s.getCurrentUser());
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showMore, setShowMore] = useState(false);
  const [addingProduct, setAddingProduct] = useState<ProductType>('Waipu TV');
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
        products: editing.products.length > 0 ? editing.products : ['Fibrefamily'],
        contractDate: editing.contractDate,
        status: editing.status,
        jiraTicket: editing.jiraTicket,
        followUpDate: editing.followUpDate ?? '',
        laufzeitMonate: editing.laufzeitMonate ?? null,
        notes: editing.notes ?? '',
      });
      setShowMore(true);
      setErrors({});
    } else {
      const base = emptyDraft();
      if (prefill?.customerNumber) base.customerNumber = prefill.customerNumber;
      if (prefill?.customerName) base.customerName = prefill.customerName;
      if (prefill?.products?.length) base.products = prefill.products;
      if (prefill?.notes) base.notes = prefill.notes;
      setDraft(base);
      setShowMore(false);
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

  const totalCommission = useMemo(
    () =>
      draft.products.reduce(
        (sum, p) => sum + getProductCommission(settings, p),
        0,
      ),
    [draft.products, settings],
  );

  const trimDraft = (): Draft => ({
    ...draft,
    customerNumber: draft.customerNumber.trim(),
    customerName: draft.customerName.trim(),
    jiraTicket: normalizeJiraTicket(draft.jiraTicket),
    notes: draft.notes?.trim() || '',
  });

  const validateCore = (trimmed: Draft): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (!trimmed.customerNumber) errs.customerNumber = 'Bitte Kundennummer eingeben.';
    if (!trimmed.customerName) errs.customerName = 'Bitte Kundenname eingeben.';
    if (trimmed.products.length === 0) errs.products = 'Mindestens ein Produkt wählen.';
    if (!trimmed.contractDate) errs.contractDate = 'Bitte ein Datum angeben.';
    return errs;
  };

  const save = () => {
    const trimmed = trimDraft();
    const errs = validateCore(trimmed);
    if (!isJiraTicket(trimmed.jiraTicket)) errs.jiraTicket = 'Ungültiges Format – z.B. TNG-1234.';
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    if (editing) updateContract(editing.id, trimmed);
    else addContract(trimmed);
    onClose();
  };

  const copyDoc = async () => {
    const trimmed = trimDraft();
    const errs = validateCore(trimmed);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    const doc = buildContractJiraDoc(trimmed, settings);
    const ok = await copyToClipboard(doc);
    if (ok) toast.success('Dokumentation in die Zwischenablage kopiert.');
    else toast.error('Kopieren fehlgeschlagen – bitte manuell markieren.');
  };

  const updateProductAt = (idx: number, p: ProductType) => {
    update({ products: draft.products.map((x, i) => (i === idx ? p : x)) });
  };

  const removeProductAt = (idx: number) => {
    if (draft.products.length <= 1) return;
    update({ products: draft.products.filter((_, i) => i !== idx) });
  };

  const addProduct = () => {
    update({ products: [...draft.products, addingProduct] });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Vertrag bearbeiten' : 'Neuer Vertrag'}
      subtitle="Mehrere Produkte für einen Bundle-Verkauf einfach hinzufügen."
      footer={
        <>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={copyDoc}
            title="Vertragsdaten als Text kopieren, zum Einfügen ins Jira-Ticket"
            style={{ marginRight: 'auto' }}
          >
            <ClipboardCopy size={14} /> Jira-Doku kopieren
          </button>
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
                    aria-label="Produkt entfernen"
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
          {/* Provisions-Vorschau */}
          <div className="commission-preview">
            <div className="commission-preview-header">
              <Coins size={14} />
              Provisions-Vorschau
            </div>
            {draft.products.map((p, i) => {
              const com = getProductCommission(settings, p);
              return (
                <div key={i} className="commission-preview-row">
                  <span>{p}</span>
                  <span>+ {formatCurrency(com)}</span>
                </div>
              );
            })}
            <div className="commission-preview-total" key={totalCommission}>
              <span>Gesamt</span>
              <span>{formatCurrency(totalCommission)}</span>
            </div>
            {(currentUser?.monthlyTarget ?? 0) > 0 && (
              <div className="commission-preview-target">
                = {Math.round((totalCommission / (currentUser?.monthlyTarget ?? 0)) * 100)} % deines Monatsziels
              </div>
            )}
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
            aria-invalid={!!errors.contractDate}
            aria-describedby={errors.contractDate ? `${fid}-date-err` : undefined}
            value={draft.contractDate}
            onChange={(e) => update({ contractDate: e.target.value })}
          />
          {errors.contractDate && (
            <div className="field-error" id={`${fid}-date-err`}>{errors.contractDate}</div>
          )}
        </div>
        <div className="field">
          <label htmlFor={`${fid}-laufzeit`}>Laufzeit</label>
          <select
            id={`${fid}-laufzeit`}
            value={draft.laufzeitMonate ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              update({ laufzeitMonate: v === '' ? null : (Number(v) as 12 | 24) });
            }}
          >
            <option value="">Unbefristet</option>
            <option value="12">12 Monate</option>
            <option value="24">24 Monate</option>
          </select>
          {draft.laufzeitMonate && draft.contractDate && (
            <span className="muted" style={{ fontSize: 12 }}>
              Vertragsende:{' '}
              {contractEndDate({ ...draft, id: '', createdAt: '' })?.toLocaleDateString('de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              }) ?? '–'}
            </span>
          )}
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
              <label htmlFor={`${fid}-status`}>Status</label>
              <select
                id={`${fid}-status`}
                value={draft.status}
                onChange={(e) => update({ status: e.target.value as ContractStatus })}
              >
                <option value="aktiv">Aktiv</option>
                <option value="offen">Offen</option>
                <option value="storniert">Storniert</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${fid}-followup`}>Wiedervorlage</label>
              <input
                id={`${fid}-followup`}
                type="date"
                value={draft.followUpDate}
                onChange={(e) => update({ followUpDate: e.target.value })}
              />
            </div>
            <div className="field full">
              <label htmlFor={`${fid}-notes`}>Notiz</label>
              <textarea
                id={`${fid}-notes`}
                value={draft.notes}
                onChange={(e) => update({ notes: e.target.value })}
                placeholder="Optional"
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
