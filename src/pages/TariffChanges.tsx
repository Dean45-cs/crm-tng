import { useMemo, useState } from 'react';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Download,
  ArrowRight,
  Sheet,
  Loader2,
  Check,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ArrowLeftRight,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { toast } from '../store/useToast';
import {
  calcTariffCommission,
  exportCsv,
  formatCurrency,
  formatDate,
  TARIFF_CONTEXT_LABEL,
  TARIFF_TYPE_LABEL,
} from '../lib/utils';
import { JiraLink } from '../components/JiraLink';
import { SkeletonTable } from '../components/Skeleton';
import { useQuickAdd } from '../components/QuickAdd';
import { confirmDialog } from '../store/useConfirm';
import { exportTariffChange } from '../lib/sharepointGraph';
import type { TariffChange } from '../types';

type SortKey = 'date' | 'customer' | 'commission';
type SortDir = 'asc' | 'desc';

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown size={12} className="sort-icon" />;
  return dir === 'desc' ? (
    <ChevronDown size={12} className="sort-icon active" />
  ) : (
    <ChevronUp size={12} className="sort-icon active" />
  );
}

export function TariffChanges() {
  const { tariffChanges, settings, deleteTariffChange, markTariffChangeExported, loaded } = useStore();
  const { getCurrentUser } = useAuth();
  const { openNewTariff, editTariff } = useQuickAdd();
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);
  const [bulkExporting, setBulkExporting] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const agentName = getCurrentUser()?.displayName ?? '';
  const spConfigured = !!(settings.spClientId && settings.spTenantId && settings.spFilePath);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list = tariffChanges.filter((t) =>
      !q
        ? true
        : t.customerName.toLowerCase().includes(q) ||
          t.customerNumber.toLowerCase().includes(q) ||
          t.jiraTicket.toLowerCase().includes(q) ||
          TARIFF_TYPE_LABEL[t.changeType].toLowerCase().includes(q),
    );

    const sign = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortKey === 'date') return sign * a.changeDate.localeCompare(b.changeDate);
      if (sortKey === 'customer') return sign * a.customerName.localeCompare(b.customerName, 'de');
      const ca = calcTariffCommission(a, settings);
      const cb = calcTariffCommission(b, settings);
      return sign * (ca - cb);
    });
  }, [tariffChanges, search, sortKey, sortDir, settings]);

  const filteredTotal = useMemo(
    () => filtered.reduce((s, t) => s + calcTariffCommission(t, settings), 0),
    [filtered, settings],
  );

  const unexported = tariffChanges.filter((t) => !t.exportedAt);

  const remove = async (id: string) => {
    const ok = await confirmDialog({
      title: 'Tarifwechsel löschen?',
      message: 'Dieser Tarifwechsel wird dauerhaft entfernt.',
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (ok) deleteTariffChange(id);
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
      toast.success('Eintrag erfolgreich in SharePoint-Excel eingetragen.');
    } catch (e) {
      toast.error(`Export fehlgeschlagen: ${(e as Error).message}`);
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
      toast.error(`${successCount} eingetragen, Fehler: ${lastError}`);
    } else {
      toast.success(`${successCount} Einträge erfolgreich in SharePoint-Excel eingetragen.`);
    }
  };

  if (!loaded) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h2>Tarifwechsel</h2>
            <p>Sidegrade/VVL oder Upgrade – Provision wird automatisch berechnet.</p>
          </div>
        </div>
        <SkeletonTable rows={7} cols={9} />
      </div>
    );
  }

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
          <button className="btn btn-primary" onClick={() => openNewTariff()}>
            <Plus size={14} /> Neuer Tarifwechsel
          </button>
        </div>
      </div>

      <div className="widget" style={{ padding: 14, marginBottom: 14 }}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="search-bar">
            <Search size={14} />
            <input
              placeholder="Kunde, Kundennummer, Jira..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div
            className="row"
            style={{ marginLeft: 'auto', gap: 12, alignItems: 'center' }}
          >
            <span className="muted">
              {filtered.length} von {tariffChanges.length}
            </span>
            <span
              style={{
                fontWeight: 600,
                color: 'var(--tng-blue-dark)',
                fontSize: 13,
              }}
            >
              Σ {formatCurrency(filteredTotal)}
            </span>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="widget empty">
          <ArrowLeftRight size={32} strokeWidth={1.4} className="empty-icon" />
          <h3>{search ? 'Keine Treffer' : 'Noch keine Tarifwechsel'}</h3>
          <p>
            {search
              ? 'Versuche es mit einem anderen Suchbegriff.'
              : 'Erfasse einen Tarifwechsel – Sidegrade oder Upgrade.'}
          </p>
          {!search && (
            <button
              className="btn btn-primary"
              onClick={() => openNewTariff()}
              style={{ marginTop: 14 }}
            >
              <Plus size={14} /> Neuer Tarifwechsel
            </button>
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th aria-sort={ariaSort('date')}>
                  <button className="sort-th" onClick={() => toggleSort('date')}>
                    Datum <SortIcon active={sortKey === 'date'} dir={sortDir} />
                  </button>
                </th>
                <th>KdNr.</th>
                <th aria-sort={ariaSort('customer')}>
                  <button className="sort-th" onClick={() => toggleSort('customer')}>
                    Kunde <SortIcon active={sortKey === 'customer'} dir={sortDir} />
                  </button>
                </th>
                <th>Art</th>
                <th>MVLZ</th>
                <th>Tarife</th>
                <th>Jira</th>
                <th style={{ textAlign: 'right' }} aria-sort={ariaSort('commission')}>
                  <button
                    className="sort-th"
                    onClick={() => toggleSort('commission')}
                    style={{ marginLeft: 'auto' }}
                  >
                    Provision <SortIcon active={sortKey === 'commission'} dir={sortDir} />
                  </button>
                </th>
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
            <tfoot>
              <tr className="table-footer-row">
                <td colSpan={7} style={{ textAlign: 'right' }}>
                  {filtered.length} Tarifwechsel · Provision gesamt
                </td>
                <td style={{ textAlign: 'right', color: 'var(--tng-blue-dark)' }}>
                  {formatCurrency(filteredTotal)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
