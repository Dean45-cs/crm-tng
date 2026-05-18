import { useId, useState } from 'react';
import { Modal } from './Modal';
import { useStore } from '../store/useStore';
import { today } from '../lib/utils';
import type { Lead, LeadStatus } from '../types';

export interface LeadPrefill {
  customerName?: string;
  customerNumber?: string;
  phone?: string;
  topic?: string;
  followUpDate?: string;
}

interface Props {
  onClose: () => void;
  /** Gesetzt = Bearbeiten, sonst Neuanlage. */
  lead?: Lead;
  /** Vorbelegung bei Neuanlage (z.B. aus einer Vertragsverlängerung). */
  prefill?: LeadPrefill;
}

const STATUS_LABEL: Record<LeadStatus, string> = {
  neu: 'Neu',
  inBearbeitung: 'In Bearbeitung',
  gewonnen: 'Gewonnen',
  verloren: 'Verloren',
};

/**
 * Modal-Formular zum Anlegen/Bearbeiten eines Leads. Die Aufrufstelle keyt
 * die Komponente, damit die Felder direkt aus den Props initialisiert werden.
 */
export function LeadForm({ onClose, lead, prefill }: Props) {
  const fid = useId();
  const { addLead, updateLead } = useStore();
  const editing = !!lead;

  const [customerName, setCustomerName] = useState(
    lead?.customerName ?? prefill?.customerName ?? '',
  );
  const [customerNumber, setCustomerNumber] = useState(
    lead?.customerNumber ?? prefill?.customerNumber ?? '',
  );
  const [phone, setPhone] = useState(lead?.phone ?? prefill?.phone ?? '');
  const [topic, setTopic] = useState(lead?.topic ?? prefill?.topic ?? '');
  const [status, setStatus] = useState<LeadStatus>(lead?.status ?? 'neu');
  const [followUpDate, setFollowUpDate] = useState(
    lead?.followUpDate ?? prefill?.followUpDate ?? today(),
  );
  const [notes, setNotes] = useState(lead?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const clearError = (key: string) =>
    setErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });

  const save = () => {
    const cleanName = customerName.trim();
    const errs: Record<string, string> = {};
    if (!cleanName) errs.customerName = 'Bitte einen Namen eingeben.';
    if (!followUpDate) errs.followUpDate = 'Bitte ein Wiedervorlage-Datum wählen.';
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    const payload = {
      customerName: cleanName,
      customerNumber: customerNumber.trim(),
      phone: phone.trim(),
      topic: topic.trim(),
      status,
      followUpDate,
      notes: notes.trim(),
    };
    if (lead) updateLead(lead.id, payload);
    else addLead(payload);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Lead bearbeiten' : 'Neuer Lead'}
      subtitle="Ein Vertriebs-Lead mit Wiedervorlage — für das ganze Team sichtbar."
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={save}>
            Speichern
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field">
          <label htmlFor={`${fid}-name`}>Name *</label>
          <input
            id={`${fid}-name`}
            autoFocus
            value={customerName}
            onChange={(e) => {
              setCustomerName(e.target.value);
              clearError('customerName');
            }}
            aria-invalid={!!errors.customerName}
            aria-describedby={errors.customerName ? `${fid}-name-err` : undefined}
            placeholder="Max Mustermann"
          />
          {errors.customerName && (
            <div className="field-error" id={`${fid}-name-err`}>
              {errors.customerName}
            </div>
          )}
        </div>

        <div className="field">
          <label htmlFor={`${fid}-kdnr`}>Kundennummer</label>
          <input
            id={`${fid}-kdnr`}
            value={customerNumber}
            onChange={(e) => setCustomerNumber(e.target.value)}
            placeholder="optional, z.B. 1234567"
          />
        </div>

        <div className="field">
          <label htmlFor={`${fid}-phone`}>Telefon</label>
          <input
            id={`${fid}-phone`}
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="optional, z.B. 0431 1234567"
          />
        </div>

        <div className="field">
          <label htmlFor={`${fid}-followup`}>Wiedervorlage *</label>
          <input
            id={`${fid}-followup`}
            type="date"
            value={followUpDate}
            onChange={(e) => {
              setFollowUpDate(e.target.value);
              clearError('followUpDate');
            }}
            aria-invalid={!!errors.followUpDate}
            aria-describedby={errors.followUpDate ? `${fid}-followup-err` : undefined}
          />
          {errors.followUpDate && (
            <div className="field-error" id={`${fid}-followup-err`}>
              {errors.followUpDate}
            </div>
          )}
        </div>

        <div className="field full">
          <label htmlFor={`${fid}-topic`}>Thema / Anliegen</label>
          <input
            id={`${fid}-topic`}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="z.B. Vertragsverlängerung, Interesse an Glasfaser"
          />
        </div>

        <div className="field full">
          <label htmlFor={`${fid}-status`}>Status</label>
          <select
            id={`${fid}-status`}
            value={status}
            onChange={(e) => setStatus(e.target.value as LeadStatus)}
          >
            {(Object.keys(STATUS_LABEL) as LeadStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="field full">
          <label htmlFor={`${fid}-notes`}>Notiz</label>
          <textarea
            id={`${fid}-notes`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>
    </Modal>
  );
}
