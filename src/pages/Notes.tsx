import { useMemo, useState } from 'react';
import { Plus, Search, Pencil, Trash2, User, Calendar } from 'lucide-react';
import { useStore } from '../store/useStore';
import { formatDate } from '../lib/utils';
import { JiraLink } from '../components/JiraLink';
import { useQuickAdd } from '../components/QuickAdd';

export function Notes() {
  const { notes, deleteNote } = useStore();
  const { openNewNote, editNote } = useQuickAdd();
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
        <button className="btn btn-primary" onClick={openNewNote}>
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
          <p>Tippe unten rechts auf <strong>+</strong> oder hier:</p>
          <button className="btn btn-primary" onClick={openNewNote} style={{ marginTop: 12 }}>
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
                  <button className="btn btn-ghost btn-sm" onClick={() => editNote(n)}>
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
    </div>
  );
}
