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
  monthKey,
  monthLabel,
  TARIFF_TYPE_LABEL,
  TARIFF_CONTEXT_LABEL,
} from '../lib/utils';
import { TngMark } from '../components/TngLogo';

/**
 * Monatsbericht als einreichbares Management-Dokument: automatische
 * Zusammenfassung, Kennzahlen mit Vormonatsvergleich, 6-Monats-Verlauf,
 * Highlights, Detailtabellen und Unterschriften-Block — druck-/PDF-fertig.
 */
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

  // ── Vormonat für den Vergleich ────────────────────────────────────────────
  const prevRef = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return d;
  }, []);
  const prevTotal = useMemo(
    () =>
      contracts
        .filter((c) => isSameMonth(c.contractDate, prevRef))
        .reduce((s, c) => s + calcContractCommission(c, settings), 0) +
      tariffChanges
        .filter((t) => isSameMonth(t.changeDate, prevRef))
        .reduce((s, t) => s + calcTariffCommission(t, settings), 0),
    [contracts, tariffChanges, settings, prevRef],
  );
  const trendPct =
    prevTotal > 0
      ? Math.round(((grandTotal - prevTotal) / prevTotal) * 100)
      : grandTotal > 0
        ? 100
        : 0;

  // ── Kennzahlen ────────────────────────────────────────────────────────────
  const activeContracts = monthContracts.filter((c) => c.status !== 'storniert');
  const cancelled = monthContracts.filter((c) => c.status === 'storniert');
  const totalDeals = activeContracts.length + monthTariffs.length;
  const avgPerDeal = totalDeals > 0 ? grandTotal / totalDeals : 0;

  // Neukunden: Kundennummern, deren allererster (nicht stornierter) Vertrag
  // in diesen Monat fällt — Stornos zählen nicht als gewonnene Kunden.
  const newCustomers = useMemo(() => {
    const firstByCustomer = new Map<string, string>();
    for (const c of contracts) {
      if (c.status === 'storniert') continue;
      const prev = firstByCustomer.get(c.customerNumber);
      if (!prev || c.contractDate < prev) firstByCustomer.set(c.customerNumber, c.contractDate);
    }
    const seen = new Set<string>();
    for (const c of monthContracts) {
      if (c.status === 'storniert') continue;
      if (firstByCustomer.get(c.customerNumber) === c.contractDate) seen.add(c.customerNumber);
    }
    return seen.size;
  }, [contracts, monthContracts]);

  // Größter Einzelabschluss des Monats
  const biggestDeal = useMemo(() => {
    let best: { name: string; amount: number; kind: string } | null = null;
    for (const c of activeContracts) {
      const v = calcContractCommission(c, settings);
      if (!best || v > best.amount) best = { name: c.customerName, amount: v, kind: 'Neuvertrag' };
    }
    for (const t of monthTariffs) {
      const v = calcTariffCommission(t, settings);
      if (!best || v > best.amount) best = { name: t.customerName, amount: v, kind: 'Tarifwechsel' };
    }
    return best;
  }, [activeContracts, monthTariffs, settings]);

  // Top-Produkte des Monats
  const topProducts = useMemo(() => {
    const map = new Map<string, { count: number; commission: number }>();
    for (const c of activeContracts) {
      for (const p of c.products) {
        const e = map.get(p) ?? { count: 0, commission: 0 };
        e.count += 1;
        e.commission += settings.products.find((x) => x.name === p)?.commission ?? 0;
        map.set(p, e);
      }
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [activeContracts, settings]);

  // 6-Monats-Verlauf (inkl. aktuellem Monat)
  const history = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => {
        const offset = -5 + i;
        const ref = new Date();
        ref.setDate(1);
        ref.setMonth(ref.getMonth() + offset);
        const key = monthKey(ref.toISOString());
        const sum =
          contracts
            .filter((c) => monthKey(c.contractDate) === key)
            .reduce((s, c) => s + calcContractCommission(c, settings), 0) +
          tariffChanges
            .filter((t) => monthKey(t.changeDate) === key)
            .reduce((s, t) => s + calcTariffCommission(t, settings), 0);
        return { label: monthLabel(offset), sum };
      }),
    [contracts, tariffChanges, settings],
  );

  const monthName = new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const generatedOn = new Date().toLocaleDateString('de-DE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const prevMonthName = prevRef.toLocaleDateString('de-DE', { month: 'long' });

  // ── Automatische Management-Zusammenfassung ──────────────────────────────
  const summaryParts: string[] = [];
  summaryParts.push(
    `Im ${monthName} wurden ${totalDeals} Abschlüsse erzielt (${activeContracts.length} Neuverträge, ${monthTariffs.length} Tarifwechsel) mit einer Gesamtprovision von ${formatCurrency(grandTotal)}.`,
  );
  if (prevTotal > 0) {
    summaryParts.push(
      trendPct >= 0
        ? `Das entspricht einer Steigerung von ${trendPct} % gegenüber ${prevMonthName} (${formatCurrency(prevTotal)}).`
        : `Das liegt ${Math.abs(trendPct)} % unter dem Ergebnis von ${prevMonthName} (${formatCurrency(prevTotal)}).`,
    );
  }
  if (target > 0) {
    summaryParts.push(
      targetReached >= 100
        ? `Das Monatsziel von ${formatCurrency(target)} wurde mit ${targetReached} % übertroffen.`
        : `Das Monatsziel von ${formatCurrency(target)} ist zu ${targetReached} % erreicht.`,
    );
  }
  if (newCustomers > 0) {
    summaryParts.push(
      `${newCustomers} ${newCustomers === 1 ? 'Kunde wurde' : 'Kunden wurden'} neu gewonnen.`,
    );
  }
  if (topProducts[0]) {
    summaryParts.push(
      `Stärkstes Produkt: ${topProducts[0].name} (${topProducts[0].count}×).`,
    );
  }

  const historyMax = Math.max(1, ...history.map((h) => h.sum));

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
            <div className="report-doc-type">Vertriebsbericht · Monatsabschluss</div>
            <div className="report-title">
              {monthName.charAt(0).toUpperCase() + monthName.slice(1)}
            </div>
            <div className="report-meta">
              <span>
                <em>Erstellt von</em> {currentUser?.displayName ?? '–'}
              </span>
              <span>
                <em>Erstellt am</em> {generatedOn}
              </span>
              <span>
                <em>Quelle</em> TNG Stadtnetz CRM
              </span>
            </div>
          </div>
          <div className="report-brand">
            <TngMark height={24} color="#0066b3" />
            <div className="report-brand-name">TNG Stadtnetz GmbH</div>
          </div>
        </header>

        <section className="report-summary">
          <div className="report-summary-label">Zusammenfassung</div>
          <p>{summaryParts.join(' ')}</p>
        </section>

        <section className="report-kpis">
          <div className="report-kpi">
            <div className="report-kpi-label">Provision gesamt</div>
            <div className="report-kpi-value">{formatCurrency(grandTotal)}</div>
            <div className={`report-kpi-sub ${trendPct >= 0 ? 'pos' : 'neg'}`}>
              {prevTotal > 0
                ? `${trendPct >= 0 ? '+' : ''}${trendPct} % vs. ${prevMonthName}`
                : 'kein Vormonatswert'}
            </div>
          </div>
          <div className="report-kpi">
            <div className="report-kpi-label">Zielerreichung</div>
            <div className="report-kpi-value">
              {target > 0 ? `${targetReached} %` : '–'}
            </div>
            {target > 0 && (
              <div className="report-progress">
                <div
                  className="report-progress-fill"
                  style={{ width: `${Math.min(100, targetReached)}%` }}
                />
              </div>
            )}
            <div className="report-kpi-sub">Ziel: {formatCurrency(target)}</div>
          </div>
          <div className="report-kpi">
            <div className="report-kpi-label">Abschlüsse</div>
            <div className="report-kpi-value">{totalDeals}</div>
            <div className="report-kpi-sub">
              {activeContracts.length} Verträge · {monthTariffs.length} Tarifwechsel
            </div>
          </div>
          <div className="report-kpi">
            <div className="report-kpi-label">Ø je Abschluss</div>
            <div className="report-kpi-value">{formatCurrency(avgPerDeal)}</div>
            <div className="report-kpi-sub">
              {newCustomers} Neukunde{newCustomers === 1 ? '' : 'n'}
              {cancelled.length > 0 ? ` · ${cancelled.length} Storno` : ' · 0 Stornos'}
            </div>
          </div>
        </section>

        <div className="report-two-col">
          <section className="report-section">
            <h3 className="report-section-title">Provisionsverlauf</h3>
            <div className="report-chart">
              {history.map((h, i) => {
                const pct = Math.round((h.sum / historyMax) * 100);
                const isCurrent = i === history.length - 1;
                return (
                  <div key={h.label} className="report-chart-col">
                    <div className="report-chart-value">
                      {h.sum > 0 ? Math.round(h.sum) + ' €' : '–'}
                    </div>
                    <div className="report-chart-track">
                      <div
                        className={`report-chart-bar ${isCurrent ? 'current' : ''}`}
                        style={{ height: `${Math.max(3, pct)}%` }}
                      />
                    </div>
                    <div className={`report-chart-label ${isCurrent ? 'current' : ''}`}>
                      {h.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="report-section">
            <h3 className="report-section-title">Top-Produkte</h3>
            {topProducts.length === 0 ? (
              <div className="report-empty">Keine Produktverkäufe in diesem Monat.</div>
            ) : (
              <table className="report-table report-table-compact">
                <thead>
                  <tr>
                    <th>Produkt</th>
                    <th style={{ textAlign: 'right', width: 60 }}>Anzahl</th>
                    <th style={{ textAlign: 'right', width: 90 }}>Provision</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((p) => (
                    <tr key={p.name}>
                      <td>{p.name}</td>
                      <td style={{ textAlign: 'right' }}>{p.count}×</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        {formatCurrency(p.commission)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {biggestDeal && (
              <div className="report-highlight">
                <em>Größter Einzelabschluss:</em> {biggestDeal.name} ·{' '}
                {formatCurrency(biggestDeal.amount)} ({biggestDeal.kind})
              </div>
            )}
          </section>
        </div>

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
            <table className="report-table report-table-compact">
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
                  <tr key={c.id} className={c.status === 'storniert' ? 'report-row-cancelled' : ''}>
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
            <table className="report-table report-table-compact">
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
          <span>Provision gesamt · {monthName}</span>
          <strong>{formatCurrency(grandTotal)}</strong>
        </section>

        <section className="report-signatures">
          <div className="report-signature">
            <div className="report-signature-line" />
            <div className="report-signature-label">
              {currentUser?.displayName ?? 'Mitarbeiter:in'} · Datum
            </div>
          </div>
          <div className="report-signature">
            <div className="report-signature-line" />
            <div className="report-signature-label">Vorgesetzte:r (Kenntnis genommen) · Datum</div>
          </div>
        </section>

        <footer className="report-footer">
          Vertraulich – nur für den internen Gebrauch · Automatisch erstellt aus dem TNG
          Stadtnetz CRM am {generatedOn}
        </footer>
      </div>
    </div>
  );
}
