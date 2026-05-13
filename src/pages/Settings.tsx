import { useState } from 'react';
import { Save, RotateCcw, Download, Upload, Trash2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { formatCurrency } from '../lib/utils';

export function Settings() {
  const {
    settings,
    updateSettings,
    updateCommissionRate,
    contracts,
    tariffChanges,
    notes,
  } = useStore();

  const [agentName, setAgentName] = useState(settings.agentName);
  const [target, setTarget] = useState(settings.monthlyTarget);
  const [jiraBaseUrl, setJiraBaseUrl] = useState(settings.jiraBaseUrl);
  const [saved, setSaved] = useState(false);

  const saveGeneral = () => {
    updateSettings({
      agentName,
      monthlyTarget: target,
      jiraBaseUrl,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const exportAll = () => {
    const data = {
      contracts,
      tariffChanges,
      notes,
      settings,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crm-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (!confirm('Aktuelle Daten überschreiben?')) return;
        const raw = localStorage.getItem('crm-tng-store');
        const state = raw ? JSON.parse(raw) : { state: {}, version: 0 };
        state.state = {
          contracts: data.contracts ?? [],
          tariffChanges: data.tariffChanges ?? [],
          notes: data.notes ?? [],
          settings: data.settings ?? settings,
        };
        localStorage.setItem('crm-tng-store', JSON.stringify(state));
        window.location.reload();
      } catch {
        alert('Ungültige Datei.');
      }
    };
    reader.readAsText(file);
  };

  const clearAll = () => {
    if (!confirm('Wirklich ALLE Daten löschen? Dies kann nicht rückgängig gemacht werden!')) return;
    localStorage.removeItem('crm-tng-store');
    window.location.reload();
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Einstellungen</h2>
          <p>Provisionssätze, Ziele und Daten verwalten.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 className="section-title">Allgemein</h3>
        <div className="form-grid">
          <div className="field">
            <label>Dein Name</label>
            <input
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="Vor- & Nachname"
            />
          </div>
          <div className="field">
            <label>Monatsziel (€)</label>
            <input
              type="number"
              step="50"
              value={target}
              onChange={(e) => setTarget(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="field full">
            <label>Jira Basis-URL</label>
            <input
              value={jiraBaseUrl}
              onChange={(e) => setJiraBaseUrl(e.target.value)}
              placeholder="https://jira.tng.de/browse/"
            />
            <span className="muted" style={{ fontSize: 11.5 }}>
              Ticketnummern werden an diese URL gehängt (z.B. TNG-1234).
            </span>
          </div>
        </div>
        <div className="row end" style={{ marginTop: 14 }}>
          {saved && <span className="muted" style={{ color: 'var(--green)' }}>Gespeichert ✓</span>}
          <button className="btn btn-primary" onClick={saveGeneral}>
            <Save size={14} /> Speichern
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row between" style={{ marginBottom: 4 }}>
          <h3 className="section-title" style={{ margin: 0 }}>Provisionssätze</h3>
          <span className="muted">In Euro pro Vorgang</span>
        </div>
        <p className="muted" style={{ marginBottom: 14 }}>
          Konfiguriere deine Provision je Produkt für Neuabschlüsse und Tarifwechsel.
        </p>
        <div className="table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Produkt</th>
                <th style={{ textAlign: 'right' }}>Neuvertrag (€)</th>
                <th style={{ textAlign: 'right' }}>Tarifwechsel (€)</th>
                <th style={{ textAlign: 'right' }}>Vorschau</th>
              </tr>
            </thead>
            <tbody>
              {settings.commissionRates.map((r) => (
                <tr key={r.product}>
                  <td>{r.product}</td>
                  <td style={{ textAlign: 'right' }}>
                    <input
                      type="number"
                      step="0.5"
                      value={r.newContract}
                      onChange={(e) =>
                        updateCommissionRate(r.product, {
                          newContract: parseFloat(e.target.value) || 0,
                        })
                      }
                      style={{
                        width: 90,
                        padding: '5px 8px',
                        borderRadius: 6,
                        border: '1px solid var(--border-strong)',
                        textAlign: 'right',
                        background: 'var(--bg-card)',
                      }}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <input
                      type="number"
                      step="0.5"
                      value={r.tariffChange}
                      onChange={(e) =>
                        updateCommissionRate(r.product, {
                          tariffChange: parseFloat(e.target.value) || 0,
                        })
                      }
                      style={{
                        width: 90,
                        padding: '5px 8px',
                        borderRadius: 6,
                        border: '1px solid var(--border-strong)',
                        textAlign: 'right',
                        background: 'var(--bg-card)',
                      }}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }} className="muted">
                    {formatCurrency(r.newContract)} / {formatCurrency(r.tariffChange)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">Daten</h3>
        <p className="muted" style={{ marginBottom: 14 }}>
          Aktuelle Datenbestände: {contracts.length} Verträge, {tariffChanges.length} Tarifwechsel,{' '}
          {notes.length} Notizen. Alle Daten werden lokal in deinem Browser gespeichert.
        </p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn" onClick={exportAll}>
            <Download size={14} /> Backup exportieren
          </button>
          <label className="btn" style={{ cursor: 'pointer' }}>
            <Upload size={14} /> Backup importieren
            <input
              type="file"
              accept="application/json"
              onChange={importAll}
              style={{ display: 'none' }}
            />
          </label>
          <button className="btn btn-danger" onClick={clearAll}>
            <Trash2 size={14} /> Alle Daten löschen
          </button>
          <button
            className="btn"
            onClick={() => {
              if (confirm('Provisionssätze auf Standard zurücksetzen?')) {
                window.location.reload();
              }
            }}
            style={{ display: 'none' }}
          >
            <RotateCcw size={14} /> Reset
          </button>
        </div>
      </div>
    </div>
  );
}
