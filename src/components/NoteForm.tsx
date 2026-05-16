import { useEffect, useId, useState } from 'react';
import { useStore } from '../store/useStore';
import { Modal } from './Modal';
import { isJiraTicket, normalizeJiraTicket } from '../lib/validation';
import type { Note } from '../types';
import type { QuickAddPrefill } from './QuickAdd';

type Draft = Omit<Note, 'id' | 'createdAt' | 'updatedAt'>;

const emptyDraft = (): Draft => ({
  customerNumber: '',
  customerName: '',
  title: '',
  content: '',
  jiraTicket: '',
});

interface Props {
  open: boolean;
  editing?: Note | null;
  prefill?: QuickAddPrefill | null;
  onClose: () => void;
}

export function NoteForm({ open, editing, prefill, onClose }: Props) {
  const { addNote, updateNote } = useStore();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showMore, setShowMore] = useState(false);
  const fid = useId();

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setDraft({
        customerNumber: editing.customerNumber ?? '',
        customerName: editing.customerName ?? '',
        title: editing.title,
        content: editing.content,
        jiraTicket: editing.jiraTicket ?? '',
      });
      setShowMore(
        !!(editing.customerNumber || editing.customerName || editing.jiraTicket),
      );
      setErrors({});
    } else {
      const base = emptyDraft();
      if (prefill?.customerNumber) base.customerNumber = prefill.customerNumber;
      if (prefill?.customerName) base.customerName = prefill.customerName;
      setDraft(base);
      setShowMore(!!(prefill?.customerNumber || prefill?.customerName));
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

  const save = () => {
    const trimmed: Draft = {
      customerNumber: draft.customerNumber?.trim() || '',
      customerName: draft.customerName?.trim() || '',
      title: draft.title.trim(),
      content: draft.content.trim(),
      jiraTicket: normalizeJiraTicket(draft.jiraTicket ?? ''),
    };
    const errs: Record<string, string> = {};
    if (!trimmed.title) errs.title = 'Bitte einen Titel eingeben.';
    if (!trimmed.content) errs.content = 'Bitte einen Inhalt eingeben.';
    if (!isJiraTicket(trimmed.jiraTicket ?? '')) errs.jiraTicket = 'Ungültiges Format – z.B. TNG-1234.';
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    if (editing) updateNote(editing.id, trimmed);
    else addNote(trimmed);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Notiz bearbeiten' : 'Neue Notiz'}
      subtitle={
        editing
          ? 'Inhalt anpassen und speichern.'
          : 'Schnelle Notiz zu Vorgängen, Kunden oder Tickets.'
      }
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
        <div className="field full">
          <label htmlFor={`${fid}-title`}>Titel *</label>
          <input
            id={`${fid}-title`}
            autoFocus
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? `${fid}-title-err` : undefined}
            value={draft.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="z.B. Rückruf wegen Glasfaserausbau"
          />
          {errors.title && (
            <div className="field-error" id={`${fid}-title-err`}>{errors.title}</div>
          )}
        </div>
        <div className="field full">
          <label htmlFor={`${fid}-content`}>Inhalt *</label>
          <textarea
            id={`${fid}-content`}
            rows={5}
            aria-invalid={!!errors.content}
            aria-describedby={errors.content ? `${fid}-content-err` : undefined}
            value={draft.content}
            onChange={(e) => update({ content: e.target.value })}
            placeholder="Was ist passiert? Was muss erledigt werden?"
          />
          {errors.content && (
            <div className="field-error" id={`${fid}-content-err`}>{errors.content}</div>
          )}
        </div>

        {!showMore && (
          <div className="field full">
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => setShowMore(true)}
              style={{ alignSelf: 'flex-start' }}
            >
              + Kunde oder Jira verknüpfen
            </button>
          </div>
        )}

        {showMore && (
          <>
            <div className="field">
              <label htmlFor={`${fid}-kdnr`}>Kundennummer</label>
              <input
                id={`${fid}-kdnr`}
                value={draft.customerNumber}
                onChange={(e) => update({ customerNumber: e.target.value })}
                placeholder="optional"
              />
            </div>
            <div className="field">
              <label htmlFor={`${fid}-name`}>Kundenname</label>
              <input
                id={`${fid}-name`}
                value={draft.customerName}
                onChange={(e) => update({ customerName: e.target.value })}
                placeholder="optional"
              />
            </div>
            <div className="field full">
              <label htmlFor={`${fid}-jira`}>Jira-Vorgang</label>
              <input
                id={`${fid}-jira`}
                aria-invalid={!!errors.jiraTicket}
                aria-describedby={errors.jiraTicket ? `${fid}-jira-err` : undefined}
                value={draft.jiraTicket}
                onChange={(e) => update({ jiraTicket: e.target.value })}
                onBlur={() => update({ jiraTicket: normalizeJiraTicket(draft.jiraTicket ?? '') })}
                placeholder="z.B. TNG-1234"
              />
              {errors.jiraTicket && (
                <div className="field-error" id={`${fid}-jira-err`}>{errors.jiraTicket}</div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
