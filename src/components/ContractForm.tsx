import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { Modal } from './Modal';
import { ProductPicker } from './ProductPicker';
import { today } from '../lib/utils';
import type { Contract, ContractStatus, ProductType } from '../types';

type Draft = Omit<Contract, 'id' | 'createdAt'>;

const emptyDraft = (): Draft => ({
  customerNumber: '',
  customerName: '',
  product: 'Fibrefamily',
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
  const { addContract, updateContract } = useStore();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setDraft({
        customerNumber: editing.customerNumber,
        customerName: editing.customerName,
        product: editing.product,
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

  const valid =
    draft.customerNumber.trim().length > 0 &&
    draft.customerName.trim().length > 0;

  const save = () => {
    if (!valid) return;
    if (editing) {
      updateContract(editing.id, draft);
    } else {
      addContract(draft);
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Vertrag bearbeiten' : 'Neuer Vertrag'}
      subtitle="Nur die wichtigsten Daten – mehr kannst du später ergänzen."
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
          <input
            autoFocus
            value={draft.customerNumber}
            onChange={(e) =>
              setDraft({ ...draft, customerNumber: e.target.value })
            }
            placeholder="z.B. 1234567"
          />
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
          <label>Produkt</label>
          <ProductPicker
            value={draft.product}
            onChange={(p: ProductType) => setDraft({ ...draft, product: p })}
          />
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
