import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { Modal } from './Modal';
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
  const [showMore, setShowMore] = useState(false);

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
    } else {
      const base = emptyDraft();
      if (prefill?.customerNumber) base.customerNumber = prefill.customerNumber;
      if (prefill?.customerName) base.customerName = prefill.customerName;
      setDraft(base);
      setShowMore(!!(prefill?.customerNumber || prefill?.customerName));
    }
  }, [open, editing, prefill]);

  const valid = draft.title.trim().length > 0 && draft.content.trim().length > 0;

  const save = () => {
    if (!valid) return;
    if (editing) {
      updateNote(editing.id, draft);
    } else {
      addNote(draft);
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Notiz bearbeiten' : 'Neue Notiz'}
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
        <div className="field full">
          <label>Titel *</label>
          <input
            autoFocus
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="z.B. Rückruf wegen Glasfaserausbau"
          />
        </div>
        <div className="field full">
          <label>Inhalt *</label>
          <textarea
            rows={5}
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            placeholder="Was ist passiert? Was muss erledigt werden?"
          />
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
              <label>Kundennummer</label>
              <input
                value={draft.customerNumber}
                onChange={(e) =>
                  setDraft({ ...draft, customerNumber: e.target.value })
                }
                placeholder="optional"
              />
            </div>
            <div className="field">
              <label>Kundenname</label>
              <input
                value={draft.customerName}
                onChange={(e) =>
                  setDraft({ ...draft, customerName: e.target.value })
                }
                placeholder="optional"
              />
            </div>
            <div className="field full">
              <label>Jira-Vorgang</label>
              <input
                value={draft.jiraTicket}
                onChange={(e) =>
                  setDraft({ ...draft, jiraTicket: e.target.value })
                }
                placeholder="z.B. TNG-1234"
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
