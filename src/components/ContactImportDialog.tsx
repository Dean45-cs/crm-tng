import { useMemo, useRef, useState } from 'react';
import { Upload, FileSpreadsheet, ClipboardPaste, AlertTriangle, Check } from 'lucide-react';
import { Modal } from './Modal';
import { useStore } from '../store/useStore';
import {
  parseFile,
  parseDelimited,
  autoMapColumns,
  buildContacts,
  CONTACT_FIELDS,
  type ParsedTable,
  type ColumnMapping,
  type ContactField,
} from '../lib/listImport';
import type { Campaign } from '../types';

interface Props {
  campaign: Campaign;
  onClose: () => void;
}

const PREVIEW_ROWS = 5;

/**
 * Import einer Anrufliste in eine Kampagne — aus einer Excel-/CSV-Datei oder
 * direkt aus der Zwischenablage. Die Spalten werden automatisch zugeordnet und
 * lassen sich vor dem Import korrigieren.
 */
export function ContactImportDialog({ campaign, onClose }: Props) {
  const { outboundContacts, importContacts } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const [table, setTable] = useState<ParsedTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [sourceName, setSourceName] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Was in dieser Kampagne schon liegt — damit ein zweiter Import derselben
  // Liste nichts doppelt anlegt.
  const existingKeys = useMemo(
    () =>
      new Set(
        outboundContacts
          .filter((c) => c.campaignId === campaign.id)
          .map((c) => c.dedupeKey),
      ),
    [outboundContacts, campaign.id],
  );

  const result = useMemo(
    () => (table ? buildContacts(table, mapping, existingKeys) : null),
    [table, mapping, existingKeys],
  );

  const accept = (parsed: ParsedTable, name: string) => {
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setError('In der Datei wurden keine Datenzeilen gefunden.');
      return;
    }
    setTable(parsed);
    setMapping(autoMapColumns(parsed.headers));
    setSourceName(name);
    setError('');
  };

  const onFile = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      accept(await parseFile(file), file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Die Datei konnte nicht gelesen werden.');
    } finally {
      setBusy(false);
    }
  };

  const onPaste = () => {
    if (!pasteText.trim()) return;
    try {
      accept(parseDelimited(pasteText), 'Zwischenablage');
      setShowPaste(false);
    } catch {
      setError('Der eingefügte Text konnte nicht gelesen werden.');
    }
  };

  const setField = (field: ContactField, value: string) => {
    setMapping((m) => {
      const next = { ...m };
      if (value === '') delete next[field];
      else {
        const idx = Number(value);
        // Eine Spalte kann nur einem Feld gehören — sonst landet sie doppelt.
        for (const key of Object.keys(next) as ContactField[]) {
          if (next[key] === idx) delete next[key];
        }
        next[field] = idx;
      }
      return next;
    });
  };

  const runImport = async () => {
    if (!result || result.contacts.length === 0) return;
    setBusy(true);
    await importContacts(campaign.id, result.contacts);
    setBusy(false);
    onClose();
  };

  const hasName = mapping.customerName !== undefined || mapping.lastName !== undefined;

  return (
    <Modal
      open
      onClose={onClose}
      title="Anrufliste importieren"
      subtitle={`Kampagne „${campaign.name}"`}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button
            className="btn btn-primary"
            onClick={runImport}
            disabled={busy || !result || result.contacts.length === 0}
          >
            {result && result.contacts.length > 0
              ? `${result.contacts.length} Kontakte importieren`
              : 'Importieren'}
          </button>
        </>
      }
    >
      {!table && (
        <div className="import-drop">
          <FileSpreadsheet size={30} strokeWidth={1.4} className="empty-icon" />
          <h4>Excel- oder CSV-Datei auswählen</h4>
          <p className="muted">
            Unterstützt werden .xlsx und .csv. Die erste Zeile muss die
            Spaltenüberschriften enthalten.
          </p>
          <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              <Upload size={14} /> Datei wählen
            </button>
            <button className="btn" onClick={() => setShowPaste((v) => !v)}>
              <ClipboardPaste size={14} /> Aus Excel einfügen
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv,.txt,.tsv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = '';
            }}
          />

          {showPaste && (
            <div className="field full" style={{ marginTop: 14, textAlign: 'left' }}>
              <label htmlFor="import-paste">
                Zeilen aus Excel kopieren und hier einfügen
              </label>
              <textarea
                id="import-paste"
                rows={6}
                value={pasteText}
                autoFocus
                placeholder={'Name\tTelefon\tOrt\nHans Meier\t0431 123456\tKiel'}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <button
                className="btn btn-sm btn-primary"
                style={{ marginTop: 8 }}
                onClick={onPaste}
              >
                Übernehmen
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="field-error" style={{ marginTop: 10 }}>
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {table && result && (
        <>
          <div className="import-source">
            <FileSpreadsheet size={14} />
            <span>
              <strong>{sourceName}</strong> · {table.rows.length} Zeilen
            </span>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setTable(null);
                setError('');
              }}
            >
              Andere Datei
            </button>
          </div>

          <div className="section-title" style={{ marginTop: 14 }}>
            Spalten zuordnen
          </div>
          <div className="import-map-grid">
            {CONTACT_FIELDS.map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={`map-${f.key}`}>
                  {f.label}
                  {f.key === 'customerName' && ' *'}
                </label>
                <select
                  id={`map-${f.key}`}
                  value={mapping[f.key] ?? ''}
                  onChange={(e) => setField(f.key, e.target.value)}
                >
                  <option value="">— nicht importieren —</option>
                  {table.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Spalte ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {!hasName && (
            <div className="field-error" style={{ marginTop: 8 }}>
              <AlertTriangle size={13} /> Ohne Namensspalte kann nicht importiert
              werden — bitte „Name" oder „Nachname" zuordnen.
            </div>
          )}

          <div className="section-title" style={{ marginTop: 16 }}>
            Vorschau
          </div>
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Telefon</th>
                  <th>KdNr.</th>
                  <th>Ort</th>
                  <th>Info</th>
                </tr>
              </thead>
              <tbody>
                {result.contacts.slice(0, PREVIEW_ROWS).map((c) => (
                  <tr key={c.dedupeKey}>
                    <td>{c.customerName}</td>
                    <td>{c.phone ?? '–'}</td>
                    <td>{c.customerNumber ?? '–'}</td>
                    <td>{[c.zip, c.city].filter(Boolean).join(' ') || '–'}</td>
                    <td className="muted">{c.info ?? '–'}</td>
                  </tr>
                ))}
                {result.contacts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      Keine neuen Kontakte in dieser Datei.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="import-summary">
            <span className="badge badge-green">
              <Check size={12} /> {result.contacts.length} neu
            </span>
            {result.duplicatesExisting > 0 && (
              <span className="badge badge-blue">
                {result.duplicatesExisting} bereits in der Kampagne
              </span>
            )}
            {result.duplicatesInFile > 0 && (
              <span className="badge badge-blue">
                {result.duplicatesInFile} Dubletten in der Datei
              </span>
            )}
            {result.withoutPhone > 0 && (
              <span className="badge badge-orange">
                {result.withoutPhone} ohne Telefonnummer
              </span>
            )}
            {result.skipped > 0 && (
              <span className="badge badge-red">{result.skipped} ohne Namen</span>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
