import { useMemo } from 'react';
import { Printer, ArrowLeft } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { useRouter } from '../router';
import {
  calcContractCommission,
  calcTariffCommission,
  formatCurrency,
  formatDate,
  isSameMonth,
  TARIFF_TYPE_LABEL,
  TARIFF_CONTEXT_LABEL,
} from '../lib/utils';
import { TngMark } from '../components/TngLogo';

export function MonthlyReport() {
  const { contracts, tariffChanges, settings } = useStore();
  const currentUser = useAuth((s) => s.getCurrentUser());
  const { navigate } = useRouter();

  // Persönlicher Monatsabschluss: nur die eigenen Vorgänge. Der Bericht trägt
  // den Namen der angemeldeten Person und misst gegen IHR Monatsziel — Team-
  // Zahlen gehören in den Team-Bericht (Chef-Bereich).
  const myKey = currentUser?.key;

  const monthContracts = useMemo(
    () =>
      contracts
        .filter((c) => (!myKey || c.createdBy === myKey) && isSameMonth(c.contractDate))
        .sort((a, b) => a.contractDate.localeCompare(b.contractDate)),
    [contracts, myKey],
  );

  const monthTariffs = useMemo(
    () =>
      tariffChanges
        .filter((t) => (!myKey || t.createdBy === myKey) && isSameMonth(t.changeDate))
        .sort((a, b) => a.changeDate.localeCompare(b.changeDate)),
    [tariffChanges, myKey],
  );

  const contractsTotal = monthContracts.reduce(
    (s, c) => s + calcContractCommission(c, settings),
    0,
  );
  const tariffsTotal = monthTariffs.reduce(
    (s, t) => s + calcTariffCommission(t, settings),
    0,
  );
  const grandTotal = contractsTotal + tariffsTotal;
  const target = settings.monthlyTarget || 0;
  const targetReached = target > 0 ? Math.round((grandTotal / target) * 100) : 0;

  const monthName = new Date().toLocaleDateString('de-DE', {
    month: 'long',
    year: 'numeric',
  });

  const generatedOn = new Date().toLocaleDateString('de-DE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  const activeContracts = monthContracts.filter((c) => c.status !== 'storniert').length;
  // Abschlüsse = aktive/offene Verträge + Tarifwechsel (Stornos zählen nicht).
  const totalDeals = activeContracts + monthTariffs.length;

  return (
    <div className="report-shell">
      <div className="report-actions no-print">
        <button className="btn" onClick={() => navigate({ name: 'dashboard' })}>
          <ArrowLeft size={14} /> Zurück
        </button>
        <button className="btn btn-primary" onClick={() => window.print()}>
          <Printer size={14} /> Drucken / Als PDF speichern
        </button>
      </div>

      <div className="report-page">
        <header className="report-header">
          <div>
            <div className="report-title">Monatsabschluss</div>
            <div className="report-subtitle">
              {monthName.charAt(0).toUpperCase() + monthName.slice(1)} ·{' '}
              {currentUser?.displayName ?? '–'}
            </div>
          </div>
          <div className="report-brand">
            <TngMark height={24} color="#0066b3" />
            <div className="report-brand-name">TNG Stadtnetz GmbH</div>
          </div>
        </header>

        <section className="report-kpis">
          <div className="report-kpi">
            <div className="report-kpi-label">Provision Gesamt</div>
            <div className="report-kpi-value">{formatCurrency(grandTotal)}</div>
          </div>
          <div className="report-kpi">
            <div className="report-kpi-label">Monatsziel</div>
            <div className="report-kpi-value">{formatCurrency(target)}</div>
          </div>
          <div className="report-kpi">
            <div className="report-kpi-label">Zielerreichung</div>
            <div className="report-kpi-value">
              {target > 0 ? `${targetReached} %` : '–'}
            </div>
          </div>
          <div className="report-kpi">
            <div className="report-kpi-label">Abschlüsse</div>
            <div className="report-kpi-value">{totalDeals}</div>
            <div className="report-kpi-sub">
              {activeContracts} Verträge · {monthTariffs.length} Tarifwechsel
            </div>
          </div>
        </section>

        <section className="report-section">
          <h3 className="report-section-title">
            Neuverträge
            <span className="report-section-meta">
              {monthContracts.length} · {formatCurrency(contractsTotal)}
            </span>
          </h3>
          {monthContracts.length === 0 ? (
            <div className="report-empty">Keine Neuverträge in diesem Monat.</div>
          ) : (
            <table className="report-table">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Datum</th>
                  <th style={{ width: 90 }}>KdNr.</th>
                  <th>Kunde</th>
                  <th>Produkte</th>
                  <th style={{ width: 90 }}>Status</th>
                  <th style={{ width: 100, textAlign: 'right' }}>Provision</th>
                </tr>
              </thead>
              <tbody>
                {monthContracts.map((c) => (
                  <tr key={c.id}>
                    <td>{formatDate(c.contractDate)}</td>
                    <td>
                      <code style={{ fontSize: 11 }}>{c.customerNumber}</code>
                    </td>
                    <td>{c.customerName}</td>
                    <td style={{ fontSize: 12 }}>{c.products.join(', ')}</td>
                    <td style={{ fontSize: 12, textTransform: 'capitalize' }}>
                      {c.status}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {formatCurrency(calcContractCommission(c, settings))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} style={{ textAlign: 'right', fontWeight: 500 }}>
                    Zwischensumme Neuverträge
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>
                    {formatCurrency(contractsTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>

        <section className="report-section">
          <h3 className="report-section-title">
            Tarifwechsel
            <span className="report-section-meta">
              {monthTariffs.length} · {formatCurrency(tariffsTotal)}
            </span>
          </h3>
          {monthTariffs.length === 0 ? (
            <div className="report-empty">Keine Tarifwechsel in diesem Monat.</div>
          ) : (
            <table className="report-table">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Datum</th>
                  <th style={{ width: 90 }}>KdNr.</th>
                  <th>Kunde</th>
                  <th style={{ width: 110 }}>Art</th>
                  <th>MVLZ</th>
                  <th style={{ width: 100, textAlign: 'right' }}>Provision</th>
                </tr>
              </thead>
              <tbody>
                {monthTariffs.map((t) => (
                  <tr key={t.id}>
                    <td>{formatDate(t.changeDate)}</td>
                    <td>
                      <code style={{ fontSize: 11 }}>{t.customerNumber}</code>
                    </td>
                    <td>{t.customerName}</td>
                    <td style={{ fontSize: 12 }}>{TARIFF_TYPE_LABEL[t.changeType]}</td>
                    <td style={{ fontSize: 12 }}>{TARIFF_CONTEXT_LABEL[t.context]}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {formatCurrency(calcTariffCommission(t, settings))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} style={{ textAlign: 'right', fontWeight: 500 }}>
                    Zwischensumme Tarifwechsel
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>
                    {formatCurrency(tariffsTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>

        <section className="report-grand-total">
          <span>Provision Gesamt</span>
          <strong>{formatCurrency(grandTotal)}</strong>
        </section>

        <footer className="report-footer">
          Erstellt am {generatedOn} · TNG Stadtnetz CRM
        </footer>
      </div>
    </div>
  );
}
