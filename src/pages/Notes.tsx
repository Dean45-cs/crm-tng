import { useMemo, useState } from 'react';
import { Plus, Search, Pencil, Trash2, User, Calendar } from 'lucide-react';
import { useStore } from '../store/useStore';
import type { Note } from '../types';
import { formatDate } from '../lib/utils';
import { Modal } from '../components/Modal';
import { JiraLink } from '../components/JiraLink';

type Draft = Omit<Note, 'id' | 'createdAt' | 'updatedAt'>;

const emptyDraft = (): Draft => ({
  customerNumber: '',
  customerName: '',
  title: '',
  content: '',
  jiraTicket: '',
});

export function Notes() {
  const { notes, addNote, updateNote, deleteNote } = useStore();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return [...notes]
      .filter((n) =>
        !q
          ? true
          : n.title.toLowerCase().includes(q) ||
            n.content.toLowerCase().includes(q) ||
            (n.customerName ?? '').toLowerCase().includes(q) ||
            (n.customerNumber ?? '').toLowerCase().includes(q) ||
            (n.jiraTicket ?? '').toLowerCase().includes(q),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [notes, search]);

  const openNew = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setOpen(true);
  };

  const openEdit = (n: Note) => {
    setEditingId(n.id);
    setDraft({
      customerNumber: n.customerNumber ?? '',
      customerName: n.customerName ?? '',
      title: n.title,
      content: n.content,
      jiraTicket: n.jiraTicket ?? '',
    });
    setOpen(true);
  };

  const save = () => {
    if (!draft.title.trim() || !draft.content.trim()) return;
    if (editingId) {
      updateNote(editingId, draft);
    } else {
      addNote(draft);
    }
    setOpen(false);
  };

  const remove = (id: string) => {
    if (confirm('Notiz wirklich löschen?')) deleteNote(id);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Notizen</h2>
          <p>Schnelle Notizen zu Kunden, Vorgängen und Verkäufen.</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          <Plus size={14} /> Neue Notiz
        </button>
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="search-bar">
            <Search size={14} />
            <input
              placeholder="Titel, Inhalt, Kunde, Jira..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="muted" style={{ marginLeft: 'auto' }}>
            {filtered.length} von {notes.length}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty">
          <h3>Keine Notizen</h3>
          <p>Halte hier wichtige Infos zu deinen Kunden fest.</p>
          <button className="btn btn-primary" onClick={openNew} style={{ marginTop: 12 }}>
            <Plus size={14} /> Neue Notiz
          </button>
        </div>
      ) : (
        <div className="notes-grid">
          {filtered.map((n) => (
            <div key={n.id} className="note-card">
              <div className="row between">
                <h4>{n.title}</h4>
                <div className="row" style={{ gap: 2 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => openEdit(n)}>
                    <Pencil size={12} />
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => remove(n.id)}>
                    <Trash2 size={12} color="var(--red)" />
                  </button>
                </div>
              </div>
              <div className="body">{n.content}</div>
              <div className="meta">
                {n.customerName && (
                  <span className="row" style={{ gap: 3 }}>
                    <User size={11} /> {n.customerName}
                    {n.customerNumber && ` (${n.customerNumber})`}
                  </span>
                )}
                {n.jiraTicket && <JiraLink ticket={n.jiraTicket} />}
                <span className="row" style={{ gap: 3, marginLeft: 'auto' }}>
                  <Calendar size={11} />
                  {formatDate(n.updatedAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? 'Notiz bearbeiten' : 'Neue Notiz'}
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>
              Abbrechen
            </button>
            <button className="btn btn-primary" onClick={save}>
              Speichern
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field full">
            <label>Titel *</label>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="z.B. Rückruf wegen Glasfaserausbau"
            />
          </div>
          <div className="field">
            <label>Kundennummer</label>
            <input
              value={draft.customerNumber}
              onChange={(e) => setDraft({ ...draft, customerNumber: e.target.value })}
              placeholder="optional"
            />
          </div>
          <div className="field">
            <label>Kundenname</label>
            <input
              value={draft.customerName}
              onChange={(e) => setDraft({ ...draft, customerName: e.target.value })}
              placeholder="optional"
            />
          </div>
          <div className="field full">
            <label>Jira-Vorgang</label>
            <input
              value={draft.jiraTicket}
              onChange={(e) => setDraft({ ...draft, jiraTicket: e.target.value })}
              placeholder="z.B. TNG-1234"
            />
          </div>
          <div className="field full">
            <label>Inhalt *</label>
            <textarea
              rows={6}
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              placeholder="Was ist passiert? Was muss erledigt werden?"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
