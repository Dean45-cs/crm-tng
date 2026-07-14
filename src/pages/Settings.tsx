import { useState, useEffect } from 'react';
import { Save, Download, Trophy, Sheet, Loader2, CheckCircle, XCircle, Sun, Moon, Monitor, Sparkles } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { useOnboarding } from '../store/useOnboarding';
import { formatCurrency, TARIFF_CONTEXT_LABEL, TARIFF_TYPE_LABEL } from '../lib/utils';
import { spSignOut, spGetAccount, testConnection } from '../lib/sharepointGraph';
import { getStoredTheme, setTheme, type ThemePref } from '../lib/theme';
import type {
  ProductCategory,
  TariffChangeType,
  TariffContext,
} from '../types';
import type { AccountInfo } from '@azure/msal-browser';

const CATS: ProductCategory[] = ['Privat', 'Business', 'Zusatz'];

const THEME_OPTIONS: { value: ThemePref; label: string; icon: typeof Sun; hint: string }[] = [
  { value: 'light', label: 'Hell', icon: Sun, hint: 'Immer heller Modus' },
  { value: 'dark', label: 'Dunkel', icon: Moon, hint: 'Immer dunkler Modus' },
  { value: 'system', label: 'System', icon: Monitor, hint: 'Folgt dem Gerät' },
];

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

  const [target, setTarget] = useState(settings.monthlyTarget);
  const [syncedTarget, setSyncedTarget] = useState(settings.monthlyTarget);
  const [saved, setSaved] = useState(false);
  const [theme, setThemeState] = useState<ThemePref>(getStoredTheme());

  const chooseTheme = (t: ThemePref) => {
    setTheme(t);
    setThemeState(t);
  };

  const [spClientId, setSpClientId] = useState(settings.spClientId);
  const [spTenantId, setSpTenantId] = useState(settings.spTenantId);
  const [spFilePath, setSpFilePath] = useState(settings.spFilePath);
  const [spSheetName, setSpSheetName] = useState(settings.spSheetName || 'Tabelle1');
  const [spAccount, setSpAccount] = useState<AccountInfo | null>(null);
  const [spLoading, setSpLoading] = useState(false);
  const [spError, setSpError] = useState<string | null>(null);

  useEffect(() => {
    if (settings.spClientId && settings.spTenantId) {
      spGetAccount(settings.spClientId, settings.spTenantId)
        .then(setSpAccount)
        .catch(() => setSpAccount(null));
    }
  }, [settings.spClientId, settings.spTenantId]);

  // settings lädt asynchron aus Supabase nach. Ändert sich das Monatsziel im
  // Store, das Eingabefeld nachziehen — sonst überschriebe „Speichern" den
  // echten Wert mit einem veralteten. Anpassung im Render (kein Effekt).
  if (settings.monthlyTarget !== syncedTarget) {
    setSyncedTarget(settings.monthlyTarget);
    setTarget(settings.monthlyTarget);
  }

  // Gleiches Spiel für die SharePoint-Felder: kommen die gespeicherten Werte
  // erst nach dem Seitenaufbau an, die Eingabefelder nachziehen.
  const spSnapshot = `${settings.spClientId}|${settings.spTenantId}|${settings.spFilePath}|${settings.spSheetName}`;
  const [syncedSp, setSyncedSp] = useState(spSnapshot);
  if (spSnapshot !== syncedSp) {
    setSyncedSp(spSnapshot);
    setSpClientId(settings.spClientId);
    setSpTenantId(settings.spTenantId);
    setSpFilePath(settings.spFilePath);
    setSpSheetName(settings.spSheetName || 'Tabelle1');
  }

  const saveSharePoint = () => {
    updateSettings({ spClientId, spTenantId, spFilePath, spSheetName });
  };

  const connectSharePoint = async () => {
    setSpLoading(true);
    setSpError(null);
    try {
      saveSharePoint();
      const { account } = await testConnection(spClientId, spTenantId, spFilePath, spSheetName);
      setSpAccount(account);
    } catch (e) {
      setSpError((e as Error).message);
    } finally {
      setSpLoading(false);
    }
  };

  const disconnectSharePoint = async () => {
    setSpLoading(true);
    try {
      await spSignOut(settings.spClientId, settings.spTenantId);
      setSpAccount(null);
    } catch {
      setSpAccount(null);
    } finally {
      setSpLoading(false);
    }
  };

  const saveGeneral = () => {
    updateSettings({
      monthlyTarget: target,
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

      <div className="widget" style={{ marginBottom: 10 }}>
        <h3 className="widget-title">Erscheinungsbild</h3>
        <p className="muted" style={{ marginBottom: 10 }}>
          Farbschema der App. „System" übernimmt automatisch die Einstellung deines Geräts.
        </p>
        <div className="theme-seg" role="group" aria-label="Farbschema">
          {THEME_OPTIONS.map(({ value, label, icon: Icon, hint }) => (
            <button
              key={value}
              type="button"
              className={`theme-seg-btn${theme === value ? ' active' : ''}`}
              aria-pressed={theme === value}
              onClick={() => chooseTheme(value)}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span className="theme-seg-label">{label}</span>
              <span className="theme-seg-hint">{hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="widget" style={{ marginBottom: 10 }}>
        <h3 className="widget-title">Allgemein</h3>
        <div className="form-grid">
          <div className="field">
            <label>Dein Name</label>
            <input value={currentUser?.displayName ?? ''} disabled readOnly />
            <span className="muted" style={{ fontSize: 12 }}>
              Wird vom Anmeldenamen übernommen.
            </span>
          </div>
          <div className="field">
            <label>Monatsziel (€)</label>
            <input
              type="number"
              step="10"
              min="0"
              value={target}
              onChange={(e) => setTarget(Math.max(0, parseFloat(e.target.value) || 0))}
            />
          </div>
        </div>
        <div className="row end" style={{ marginTop: 10 }}>
          {saved && <span className="muted" style={{ color: 'var(--green)' }}>Gespeichert ✓</span>}
          <button className="btn btn-primary" onClick={saveGeneral}>
            <Save size={14} /> Speichern
          </button>
        </div>
      </div>

      <div className="widget" style={{ marginBottom: 10 }}>
        <h3 className="widget-title">
          <Sparkles size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
          Einführungstour
        </h3>
        <div className="row between" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              Die geführte Tour erklärt alle Funktionen Schritt für Schritt — ideal auch, um das
              CRM Kolleg:innen zu zeigen. Du startest sie hier oder jederzeit mit{' '}
              <kbd className="settings-kbd">.</kbd> + <kbd className="settings-kbd">o</kbd>{' '}
              (gleichzeitig gedrückt).
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => useOnboarding.getState().start()}>
            <Sparkles size={14} /> Tour starten
          </button>
        </div>
      </div>

      <div className="widget" style={{ marginBottom: 10 }}>
        <h3 className="widget-title">
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

      <div className="widget" style={{ marginBottom: 10 }}>
        <h3 className="widget-title">Provision pro Produkt</h3>
        <p className="muted" style={{ marginBottom: 10 }}>
          Werte aus dem TNG-Provisionskatalog (Version 1.2 ab 01.03.2026). Du kannst sie anpassen.
        </p>

        {CATS.map((cat) => (
          <div key={cat} style={{ marginBottom: 12 }}>
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
                            min="0"
                            className="commission-input"
                            value={p.commission}
                            onChange={(e) =>
                              updateProductCommission(
                                p.name,
                                Math.max(0, parseFloat(e.target.value) || 0),
                              )
                            }
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

      <div className="widget" style={{ marginBottom: 10 }}>
        <h3 className="widget-title">Provision Tarifwechsel</h3>
        <p className="muted" style={{ marginBottom: 10 }}>
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
                        min="0"
                        className="commission-input"
                        value={settings.tariffCommission[t][c]}
                        onChange={(e) =>
                          updateMatrix(t, c, Math.max(0, parseFloat(e.target.value) || 0))
                        }
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

      <div className="widget" style={{ marginBottom: 10 }}>
        <h3 className="widget-title">
          <Sheet size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
          SharePoint Excel-Export
        </h3>
        <p className="muted" style={{ marginBottom: 10 }}>
          Trägt Tarifwechsel per Knopfdruck automatisch in die SharePoint-Excel-Tabelle ein.
          Einmalig Azure-App-ID eintragen – danach reicht ein Klick.
        </p>

        <div className="form-grid">
          <div className="field">
            <label>Azure Client ID</label>
            <input
              value={spClientId}
              onChange={(e) => setSpClientId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label>Azure Tenant ID</label>
            <input
              value={spTenantId}
              onChange={(e) => setSpTenantId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label>Dateipfad (relativ zur SharePoint-Bibliothek)</label>
            <input
              value={spFilePath}
              onChange={(e) => setSpFilePath(e.target.value)}
              placeholder="Allgemein/Tarifwechsel.xlsx"
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label>Tabellenblatt</label>
            <input
              value={spSheetName}
              onChange={(e) => setSpSheetName(e.target.value)}
              placeholder="Tabelle1"
            />
          </div>
        </div>

        <div className="row" style={{ marginTop: 10, gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {spAccount ? (
            <>
              <span className="sp-status sp-status-ok">
                <CheckCircle size={13} />
                Verbunden als {spAccount.username}
              </span>
              <button className="btn" onClick={disconnectSharePoint} disabled={spLoading}>
                Abmelden
              </button>
            </>
          ) : (
            <button
              className="btn sharepoint-btn"
              onClick={connectSharePoint}
              disabled={spLoading || !spClientId || !spTenantId || !spFilePath}
            >
              {spLoading ? <Loader2 size={14} className="spin" /> : <Sheet size={14} />}
              Verbindung testen & anmelden
            </button>
          )}
          {!spAccount && (
            <button className="btn" onClick={saveSharePoint}>
              <Save size={14} /> Speichern
            </button>
          )}
          {spError && (
            <span className="sp-status sp-status-err">
              <XCircle size={13} /> {spError}
            </span>
          )}
        </div>

        <div className="sp-hint">
          <strong>Einrichtung (einmalig):</strong> Azure-Portal → App-Registrierungen → Neue Registrierung →
          Plattform „Single-Page Application", Redirect-URI: <code>{window.location.origin}</code> →
          API-Berechtigung: <code>Files.ReadWrite</code> (delegiert). Danach Client-ID und Tenant-ID hier eintragen.
        </div>
      </div>

      <div className="widget">
        <h3 className="widget-title">Daten</h3>
        <p className="muted" style={{ marginBottom: 10 }}>
          {contracts.length} Verträge · {tariffChanges.length} Tarifwechsel · {notes.length} Notizen.
          Alle Daten werden zentral in der Cloud gespeichert und im Team synchronisiert.
        </p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn" onClick={exportAll}>
            <Download size={14} /> Backup exportieren (JSON)
          </button>
        </div>
      </div>
    </div>
  );
}
