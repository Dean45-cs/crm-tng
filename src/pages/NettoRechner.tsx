import { useMemo, useState } from 'react';
import { Calculator, Wallet, Info, ArrowDown } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import {
  calcContractCommission,
  calcTariffCommission,
  formatCurrency,
  isSameMonth,
} from '../lib/utils';
import {
  estimateNet,
  clampRate,
  loadNettoRate,
  saveNettoRate,
  RATE_PRESETS,
} from '../lib/netto';

/**
 * Kleiner Brutto-Netto-Rechner: schätzt, was von der (Brutto-)Provision
 * nach Steuern und Sozialabgaben ungefähr übrig bleibt. Der persönliche
 * Abzugssatz wird pro Gerät gemerkt.
 */
export function NettoRechner() {
  const contracts = useStore((s) => s.contracts);
  const tariffChanges = useStore((s) => s.tariffChanges);
  const settings = useStore((s) => s.settings);
  const currentUser = useAuth((s) => s.getCurrentUser());

  const monthCommission = useMemo(() => {
    const mine = currentUser?.key;
    if (!mine) return 0;
    return (
      contracts
        .filter((c) => c.createdBy === mine && isSameMonth(c.contractDate))
        .reduce((s, c) => s + calcContractCommission(c, settings), 0) +
      tariffChanges
        .filter((t) => t.createdBy === mine && isSameMonth(t.changeDate))
        .reduce((s, t) => s + calcTariffCommission(t, settings), 0)
    );
  }, [contracts, tariffChanges, settings, currentUser]);

  const [grossInput, setGrossInput] = useState<string>('');
  const [rate, setRate] = useState<number>(() => loadNettoRate());

  const gross = parseFloat(grossInput.replace(',', '.')) || 0;
  const { net, deductions } = estimateNet(gross, rate);
  const netPct = gross > 0 ? Math.round((net / gross) * 100) : 100 - rate;

  const chooseRate = (r: number) => {
    const clamped = clampRate(r);
    setRate(clamped);
    saveNettoRate(clamped);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Netto-Rechner</h2>
          <p>Was von deiner Provision nach Abzügen ungefähr übrig bleibt.</p>
        </div>
      </div>

      <div className="netto-layout">
        <div className="widget netto-card">
          <h3 className="widget-title">
            <Calculator size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
            Brutto → Netto
          </h3>

          <div className="field">
            <label>Brutto-Provision (€)</label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="10"
              placeholder="z. B. 450"
              value={grossInput}
              onChange={(e) => setGrossInput(e.target.value)}
              autoFocus
            />
          </div>

          <button
            className="btn btn-sm netto-fill-btn"
            onClick={() => setGrossInput(String(Math.round(monthCommission * 100) / 100))}
            disabled={monthCommission <= 0}
          >
            <Wallet size={13} /> Meine Monatsprovision übernehmen (
            {formatCurrency(monthCommission)})
          </button>

          <div className="field" style={{ marginTop: 18 }}>
            <label>Persönlicher Abzugssatz (%)</label>
            <div className="netto-rate-row">
              <input
                type="number"
                min="0"
                max="70"
                step="1"
                value={rate}
                onChange={(e) => chooseRate(parseFloat(e.target.value))}
                style={{ width: 90 }}
              />
              <div className="netto-presets">
                {RATE_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`netto-preset ${rate === p ? 'active' : ''}`}
                    onClick={() => chooseRate(p)}
                  >
                    {p} %
                  </button>
                ))}
              </div>
            </div>
            <span className="muted" style={{ fontSize: 12 }}>
              Wird gemerkt — Steuern + Sozialabgaben zusammen, je nach Steuerklasse.
            </span>
          </div>
        </div>

        <div className="widget netto-result">
          <div className="netto-result-brutto">
            <span>Brutto</span>
            <strong>{formatCurrency(gross)}</strong>
          </div>
          <div className="netto-result-arrow">
            <ArrowDown size={15} />
            <span>− {formatCurrency(deductions)} Abzüge ({rate} %)</span>
          </div>
          <div className="netto-result-netto">
            <span>Netto ca.</span>
            <strong>{formatCurrency(net)}</strong>
          </div>

          <div className="netto-bar" role="img" aria-label={`${netPct} % bleiben netto`}>
            <div className="netto-bar-net" style={{ width: `${netPct}%` }} />
          </div>
          <div className="netto-bar-legend">
            <span>
              <i className="netto-dot net" /> Netto {netPct} %
            </span>
            <span>
              <i className="netto-dot deduct" /> Abzüge {100 - netPct} %
            </span>
          </div>

          <div className="netto-disclaimer">
            <Info size={13} />
            <span>
              Grobe Schätzung, keine Steuerberatung: Der tatsächliche Abzug hängt von
              Steuerklasse, Jahreseinkommen, Kirchensteuer und Krankenkasse ab.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
