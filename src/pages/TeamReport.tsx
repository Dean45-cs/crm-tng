import { useMemo } from 'react';
import { Printer, ArrowLeft, Lock } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { useRouter } from '../router';
import { formatCurrency } from '../lib/utils';
import { agentStats, attainmentPct } from '../lib/teamStats';
import { TngMark } from '../components/TngLogo';

export function TeamReport() {
  const { contracts, tariffChanges, settings } = useStore();
  const { users, isManager } = useAuth();
  const { navigate } = useRouter();

  const rows = useMemo(() => {
    return Object.values(users)
      .map((u) => {
        const stats = agentStats(u.key, contracts, tariffChanges, settings);
        return {
          key: u.key,
          displayName: u.displayName,
          target: u.monthlyTarget,
          stats,
          attainment: attainmentPct(stats.monthCommission, u.monthlyTarget),
        };
      })
      .sort((a, b) => b.stats.monthCommission - a.stats.monthCommission);
  }, [users, contracts, tariffChanges, settings]);

  const totals = useMemo(() => {
    const commission = rows.reduce((s, r) => s + r.stats.monthCommission, 0);
    const targetSum = rows.reduce((s, r) => s + r.target, 0);
    const contractCount = rows.reduce((s, r) => s + r.stats.monthContracts, 0);
    const tariffCount = rows.reduce((s, r) => s + r.stats.monthTariffs, 0);
    return {
      commission,
      targetSum,
      contractCount,
      tariffCount,
      deals: contractCount + tariffCount,
      attainment: attainmentPct(commission, targetSum),
    };
  }, [rows]);

  if (!isManager()) {
    return (
      <div className="widget empty">
        <Lock size={32} strokeWidth={1.4} className="empty-icon" />
        <h3>Kein Zugriff</h3>
        <p>Der Team-Bericht ist nur für Chefs sichtbar.</p>
      </div>
    );
  }

  const monthName = new Date().toLocaleDateString('de-DE', {
    month: 'long',
    year: 'numeric',
  });
  const generatedOn = new Date().toLocaleDateString('de-DE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="report-shell">
      <div className="report-actions no-print">
        <button className="btn" onClick={() => navigate({ name: 'teamdashboard' })}>
          <ArrowLeft size={14} /> Zurück
        </button>
        <button className="btn btn-primary" onClick={() => window.print()}>
          <Printer size={14} /> Drucken / Als PDF speichern
        </button>
      </div>

      <div className="report-page">
        <header className="report-header">
          <div>
            <div className="report-title">Team-Monatsabschluss</div>
            <div className="report-subtitle">
              {monthName.charAt(0).toUpperCase() + monthName.slice(1)} · Gesamtes Team
            </div>
          </div>
          <div className="report-brand">
            <TngMark height={24} color="#0066b3" />
            <div className="report-brand-name">TNG Stadtnetz GmbH</div>
          </div>
        </header>

        <section className="report-kpis">
          <div className="report-kpi">
            <div className="report-kpi-label">Provision Team</div>
            <div className="report-kpi-value">{formatCurrency(totals.commission)}</div>
          </div>
          <div className="report-kpi">
            <div className="report-kpi-label">Summe Monatsziele</div>
            <div className="report-kpi-value">{formatCurrency(totals.targetSum)}</div>
          </div>
          <div className="report-kpi">
            <div className="report-kpi-label">Zielerreichung</div>
            <div className="report-kpi-value">
              {totals.attainment === null ? '–' : `${totals.attainment} %`}
            </div>
          </div>
          <div className="report-kpi">
            <div className="report-kpi-label">Abschlüsse</div>
            <div className="report-kpi-value">{totals.deals}</div>
            <div className="report-kpi-sub">
              {totals.contractCount} Verträge · {totals.tariffCount} Tarifwechsel
            </div>
          </div>
        </section>

        <section className="report-section">
          <h3 className="report-section-title">
            Leistung pro Mitarbeiter:in
            <span className="report-section-meta">
              {rows.length} {rows.length === 1 ? 'Person' : 'Personen'}
            </span>
          </h3>
          {rows.length === 0 ? (
            <div className="report-empty">Keine Mitarbeitenden erfasst.</div>
          ) : (
            <table className="report-table">
              <thead>
                <tr>
                  <th>Mitarbeiter:in</th>
                  <th style={{ width: 90, textAlign: 'right' }}>Verträge</th>
                  <th style={{ width: 100, textAlign: 'right' }}>Tarifwechsel</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Monatsziel</th>
                  <th style={{ width: 90, textAlign: 'right' }}>Ziel %</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Provision</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.displayName}</td>
                    <td style={{ textAlign: 'right' }}>{r.stats.monthContracts}</td>
                    <td style={{ textAlign: 'right' }}>{r.stats.monthTariffs}</td>
                    <td style={{ textAlign: 'right' }}>
                      {r.target > 0 ? formatCurrency(r.target) : '–'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {r.attainment === null ? '–' : `${r.attainment} %`}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {formatCurrency(r.stats.monthCommission)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} style={{ textAlign: 'right', fontWeight: 500 }}>
                    Provision Team gesamt
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>
                    {formatCurrency(totals.commission)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>

        <section className="report-grand-total">
          <span>Provision Team</span>
          <strong>{formatCurrency(totals.commission)}</strong>
        </section>

        <footer className="report-footer">
          Erstellt am {generatedOn} · TNG Stadtnetz CRM
        </footer>
      </div>
    </div>
  );
}
