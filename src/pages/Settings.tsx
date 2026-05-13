import { useState } from 'react';
import { Save, Download, Upload, Trash2, Trophy } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { formatCurrency, TARIFF_CONTEXT_LABEL, TARIFF_TYPE_LABEL } from '../lib/utils';
import type {
  ProductCategory,
  TariffChangeType,
  TariffContext,
} from '../types';

const CATS: ProductCategory[] = ['Privat', 'Business', 'Zusatz'];

export function Settings() {
  const {
    settings,
    updateSettings,
    updateProductCommission,
    updateTariffCommission,
    contracts,
    tariffChanges,
    notes,
  } = useStore();

  const { getCurrentUser, setLeaderboardOptIn } = useAuth();
  const currentUser = getCurrentUser();

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
        const state = raw ? JSON.parse(raw) : { state: {}, version: 2 };
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

  const updateMatrix = (
    type: TariffChangeType,
    ctx: TariffContext,
    value: number,
  ) => {
    updateTariffCommission({
      ...settings.tariffCommission,
      [type]: {
        ...settings.tariffCommission[type],
        [ctx]: value,
      },
    });
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Einstellungen</h2>
          <p>Provisionssätze (TNG Provisionskatalog), Monatsziel und Daten.</p>
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
              step="10"
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
        <h3 className="section-title">
          <Trophy size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
          Leaderboard
        </h3>
        <div className="row between" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
              Im Ranking sichtbar sein
            </div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.4 }}>
              Wenn aktiviert, sehen andere Nutzer deine Provisionssummen im
              Leaderboard. Ist es aus, bleibst du anonym – du selbst siehst
              deine Zahlen aber weiterhin.
            </div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={currentUser?.leaderboardOptIn ?? true}
              onChange={(e) => setLeaderboardOptIn(e.target.checked)}
            />
            <span className="switch-track">
              <span className="switch-thumb" />
            </span>
          </label>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 className="section-title">Provision pro Produkt</h3>
        <p className="muted" style={{ marginBottom: 14 }}>
          Werte aus dem TNG-Provisionskatalog (Version 1.2 ab 01.03.2026). Du kannst sie anpassen.
        </p>

        {CATS.map((cat) => (
          <div key={cat} style={{ marginBottom: 18 }}>
            <div className="row" style={{ marginBottom: 8, gap: 8 }}>
              <span className={`cat-chip cat-${cat}`}>{cat}</span>
            </div>
            <div className="table-wrap">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Produkt</th>
                    <th style={{ textAlign: 'right', width: 160 }}>Provision (€)</th>
                  </tr>
                </thead>
                <tbody>
                  {settings.products
                    .filter((p) => p.category === cat)
                    .map((p) => (
                      <tr key={p.name}>
                        <td>{p.name}</td>
                        <td style={{ textAlign: 'right' }}>
                          <input
                            type="number"
                            step="0.5"
                            value={p.commission}
                            onChange={(e) =>
                              updateProductCommission(
                                p.name,
                                parseFloat(e.target.value) || 0,
                              )
                            }
                            style={{
                              width: 100,
                              padding: '5px 8px',
                              borderRadius: 6,
                              border: '1px solid var(--border-strong)',
                              textAlign: 'right',
                              background: 'var(--bg-card)',
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 className="section-title">Provision Tarifwechsel</h3>
        <p className="muted" style={{ marginBottom: 14 }}>
          Provisionsmatrix nach Wechselart und MVLZ-Situation.
        </p>
        <div className="table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Wechselart</th>
                {(['mvlz_gt3', 'mvlz_lt3', 'outside_mvlz'] as TariffContext[]).map((c) => (
                  <th key={c} style={{ textAlign: 'right' }}>
                    {TARIFF_CONTEXT_LABEL[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['sidegrade', 'upgrade'] as TariffChangeType[]).map((t) => (
                <tr key={t}>
                  <td>{TARIFF_TYPE_LABEL[t]}</td>
                  {(['mvlz_gt3', 'mvlz_lt3', 'outside_mvlz'] as TariffContext[]).map((c) => (
                    <td key={c} style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        step="0.5"
                        value={settings.tariffCommission[t][c]}
                        onChange={(e) =>
                          updateMatrix(t, c, parseFloat(e.target.value) || 0)
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
                      <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>
                        {formatCurrency(settings.tariffCommission[t][c])}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">Daten</h3>
        <p className="muted" style={{ marginBottom: 14 }}>
          {contracts.length} Verträge · {tariffChanges.length} Tarifwechsel · {notes.length} Notizen.
          Daten liegen lokal im Browser.
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
        </div>
      </div>
    </div>
  );
}
