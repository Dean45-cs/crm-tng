import { useMemo, useState, useEffect } from 'react';
import { Plus, Search, Pencil, Trash2, Download, ArrowRight, Sheet, Loader2, Check } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import {
  calcTariffCommission,
  exportCsv,
  formatCurrency,
  formatDate,
  TARIFF_CONTEXT_LABEL,
  TARIFF_TYPE_LABEL,
} from '../lib/utils';
import { JiraLink } from '../components/JiraLink';
import { useQuickAdd } from '../components/QuickAdd';
import { exportTariffChange } from '../lib/sharepointGraph';
import type { TariffChange } from '../types';

export function TariffChanges() {
  const { tariffChanges, settings, deleteTariffChange, markTariffChangeExported } = useStore();
  const { getCurrentUser } = useAuth();
  const { openNewTariff, editTariff } = useQuickAdd();
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);
  const [bulkExporting, setBulkExporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const agentName = getCurrentUser()?.displayName ?? settings.agentName;
  const spConfigured = !!(settings.spClientId && settings.spTenantId && settings.spFilePath);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return [...tariffChanges]
      .filter((t) =>
        !q
          ? true
          : t.customerName.toLowerCase().includes(q) ||
            t.customerNumber.toLowerCase().includes(q) ||
            t.jiraTicket.toLowerCase().includes(q) ||
            TARIFF_TYPE_LABEL[t.changeType].toLowerCase().includes(q),
      )
      .sort((a, b) => b.changeDate.localeCompare(a.changeDate));
  }, [tariffChanges, search]);

  const unexported = tariffChanges.filter((t) => !t.exportedAt);

  const remove = (id: string) => {
    if (confirm('Tarifwechsel wirklich löschen?')) deleteTariffChange(id);
  };

  const exportCsvData = () => {
    exportCsv(
      `tarifwechsel-${new Date().toISOString().slice(0, 10)}.csv`,
      filtered.map((t) => ({
        Datum: formatDate(t.changeDate),
        Kundennummer: t.customerNumber,
        Kunde: t.customerName,
        Wechselart: TARIFF_TYPE_LABEL[t.changeType],
        MVLZ: TARIFF_CONTEXT_LABEL[t.context],
        'Alter Tarif': t.oldProduct ?? '',
        'Neuer Tarif': t.newProduct ?? '',
        Jira: t.jiraTicket,
        'Provision (€)': calcTariffCommission(t, settings),
        Notizen: t.notes ?? '',
      })),
    );
  };

  const handleExport = async (t: TariffChange) => {
    setExporting(t.id);
    try {
      await exportTariffChange(
        t, agentName,
        settings.spClientId, settings.spTenantId,
        settings.spFilePath, settings.spSheetName,
      );
      markTariffChangeExported(t.id);
      setToast('Eintrag erfolgreich in SharePoint-Excel eingetragen.');
    } catch (e) {
      setToast(`Fehler: ${(e as Error).message}`);
    } finally {
      setExporting(null);
    }
  };

  const handleExportAll = async () => {
    if (unexported.length === 0) return;
    setBulkExporting(true);
    let successCount = 0;
    let lastError = '';
    for (const t of unexported) {
      try {
        await exportTariffChange(
          t, agentName,
          settings.spClientId, settings.spTenantId,
          settings.spFilePath, settings.spSheetName,
        );
        markTariffChangeExported(t.id);
        successCount++;
      } catch (e) {
        lastError = (e as Error).message;
      }
    }
    setBulkExporting(false);
    if (lastError) {
      setToast(`${successCount} eingetragen, Fehler: ${lastError}`);
    } else {
      setToast(`${successCount} Einträge erfolgreich in SharePoint-Excel eingetragen.`);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Tarifwechsel</h2>
          <p>Sidegrade/VVL oder Upgrade – Provision wird automatisch berechnet.</p>
        </div>
        <div className="row">
          {spConfigured && (
            <button
              className="btn sharepoint-btn"
              onClick={handleExportAll}
              disabled={bulkExporting || unexported.length === 0}
              title={unexported.length === 0 ? 'Alle bereits exportiert' : `${unexported.length} neue Einträge exportieren`}
            >
              {bulkExporting ? <Loader2 size={14} className="spin" /> : <Sheet size={14} />}
              {unexported.length > 0 ? `${unexported.length} → Excel` : 'Alle exportiert'}
            </button>
          )}
          <button className="btn" onClick={exportCsvData} disabled={filtered.length === 0}>
            <Download size={14} /> CSV
          </button>
          <button className="btn btn-primary" onClick={openNewTariff}>
            <Plus size={14} /> Neuer Tarifwechsel
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="search-bar">
            <Search size={14} />
            <input
              placeholder="Kunde, Kundennummer, Jira..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="muted" style={{ marginLeft: 'auto' }}>
            {filtered.length} von {tariffChanges.length}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty">
          <h3>Noch keine Tarifwechsel</h3>
          <p>Tippe unten rechts auf <strong>+</strong> oder hier:</p>
          <button className="btn btn-primary" onClick={openNewTariff} style={{ marginTop: 12 }}>
            <Plus size={14} /> Neuer Tarifwechsel
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Datum</th>
                <th>KdNr.</th>
                <th>Kunde</th>
                <th>Art</th>
                <th>MVLZ</th>
                <th>Tarife</th>
                <th>Jira</th>
                <th style={{ textAlign: 'right' }}>Provision</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td>{formatDate(t.changeDate)}</td>
                  <td><code style={{ fontSize: 12 }}>{t.customerNumber}</code></td>
                  <td>{t.customerName}</td>
                  <td>
                    <span className={`badge ${t.changeType === 'upgrade' ? 'badge-green' : 'badge-blue'}`}>
                      {TARIFF_TYPE_LABEL[t.changeType]}
                    </span>
                  </td>
                  <td style={{ fontSize: 12.5 }}>{TARIFF_CONTEXT_LABEL[t.context]}</td>
                  <td>
                    {t.oldProduct && t.newProduct ? (
                      <div className="row" style={{ gap: 4 }}>
                        <span className="muted" style={{ fontSize: 12 }}>{t.oldProduct}</span>
                        <ArrowRight size={11} style={{ color: 'var(--text-tertiary)' }} />
                        <span style={{ fontSize: 12.5, fontWeight: 500 }}>{t.newProduct}</span>
                      </div>
                    ) : (
                      <span className="muted">–</span>
                    )}
                  </td>
                  <td><JiraLink ticket={t.jiraTicket} /></td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    {formatCurrency(calcTariffCommission(t, settings))}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="row end">
                      {spConfigured && (
                        <button
                          className={`btn btn-ghost btn-sm sharepoint-row-btn${t.exportedAt ? ' exported' : ''}`}
                          title={t.exportedAt ? `Exportiert am ${formatDate(t.exportedAt.slice(0, 10))}` : 'In SharePoint-Excel eintragen'}
                          onClick={() => handleExport(t)}
                          disabled={exporting === t.id}
                        >
                          {exporting === t.id
                            ? <Loader2 size={13} className="spin" />
                            : t.exportedAt
                              ? <Check size={13} style={{ color: 'var(--green)' }} />
                              : <Sheet size={13} />}
                        </button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => editTariff(t)}>
                        <Pencil size={13} />
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => remove(t.id)}>
                        <Trash2 size={13} color="var(--red)" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <div className="sp-toast">
          {toast}
        </div>
      )}
    </div>
  );
}
