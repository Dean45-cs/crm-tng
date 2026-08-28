import { useId, useState } from 'react';
import { Modal } from './Modal';
import { useStore } from '../store/useStore';
import type { Campaign, CampaignCallType, ProductType } from '../types';

interface Props {
  onClose: () => void;
  /** Gesetzt = Bearbeiten, sonst Neuanlage. */
  campaign?: Campaign;
}

const CALL_TYPE_LABEL: Record<CampaignCallType, string> = {
  churn: 'Churn — Widerrufe & Kündigungen',
  welcome: 'Welcome — Willkommensanruf',
  prl: 'PRL — Postrückläufer',
  dupe: 'Dupe — Dubletten-Check',
  bvw: 'BVW — Bauverweigerer',
  courtesy: 'Courtesy — Aktivierungsunterstützung',
  other: 'Sonstige',
};

/**
 * Modal-Formular zum Erstellen/Bearbeiten einer Kampagne. Der call_type
 * bestimmt in der Extension automatisch, welcher Gesprächsleitfaden und
 * welche Einwandkarten angezeigt werden (siehe extension/src/config.js).
 */
export function CampaignForm({ onClose, campaign }: Props) {
  const fid = useId();
  const { addCampaign, updateCampaign, settings } = useStore();
  const editing = !!campaign;

  const [name, setName] = useState(campaign?.name ?? '');
  const [callType, setCallType] = useState<CampaignCallType>(campaign?.callType ?? 'churn');
  const [active, setActive] = useState(campaign?.active ?? true);
  const [bonusTermin, setBonusTermin] = useState(String(campaign?.bonusTermin ?? 0));
  const [bonusAbschluss, setBonusAbschluss] = useState(String(campaign?.bonusAbschluss ?? 0));
  const [maxAttempts, setMaxAttempts] = useState(String(campaign?.maxAttempts ?? 3));
  const [startDate, setStartDate] = useState(campaign?.startDate ?? '');
  const [endDate, setEndDate] = useState(campaign?.endDate ?? '');
  const [targetProduct, setTargetProduct] = useState<string>(campaign?.targetProduct ?? '');
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');

  const save = () => {
    const cleanName = name.trim();
    if (!cleanName) {
      setError('Bitte einen Namen eingeben.');
      return;
    }
    const termin = parseFloat(bonusTermin.replace(',', '.')) || 0;
    const abschluss = parseFloat(bonusAbschluss.replace(',', '.')) || 0;
    const attempts = parseInt(maxAttempts, 10);

    if (termin < 0 || abschluss < 0) {
      setListError('Prämien dürfen nicht negativ sein.');
      return;
    }
    if (!Number.isFinite(attempts) || attempts < 1 || attempts > 20) {
      setListError('Bitte zwischen 1 und 20 Versuchen wählen.');
      return;
    }
    if (startDate && endDate && endDate < startDate) {
      setListError('Das Ende darf nicht vor dem Start liegen.');
      return;
    }

    const payload = {
      name: cleanName,
      callType,
      active,
      bonusTermin: termin,
      bonusAbschluss: abschluss,
      maxAttempts: attempts,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      targetProduct: (targetProduct || undefined) as ProductType | undefined,
    };
    if (campaign) updateCampaign(campaign.id, payload);
    else addCampaign(payload);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Kampagne bearbeiten' : 'Kampagne erstellen'}
      subtitle="Bestimmt automatisch Gesprächsleitfaden & Einwandkarten in der Extension."
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={save}>
            Speichern
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field full">
          <label htmlFor={`${fid}-name`}>Name *</label>
          <input
            id={`${fid}-name`}
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError('');
            }}
            aria-invalid={!!error}
            aria-describedby={error ? `${fid}-name-err` : undefined}
            placeholder="z.B. Kündigerrückgewinnung Q3"
          />
          {error && (
            <div className="field-error" id={`${fid}-name-err`}>
              {error}
            </div>
          )}
        </div>

        <div className="field full">
          <label htmlFor={`${fid}-calltype`}>Call-Typ</label>
          <select
            id={`${fid}-calltype`}
            value={callType}
            onChange={(e) => setCallType(e.target.value as CampaignCallType)}
          >
            {(Object.keys(CALL_TYPE_LABEL) as CampaignCallType[]).map((t) => (
              <option key={t} value={t}>
                {CALL_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>

        <div className="field full">
          <div className="section-title">Anrufliste</div>
          <div className="setup-hint">
            Nur nötig, wenn zu dieser Kampagne eine Liste abtelefoniert wird.
            Die Liste selbst wird in der Kampagnen-Verwaltung importiert.
          </div>
        </div>

        <div className="field">
          <label htmlFor={`${fid}-bonus-termin`}>Prämie je Termin (€)</label>
          <input
            id={`${fid}-bonus-termin`}
            inputMode="decimal"
            value={bonusTermin}
            onChange={(e) => {
              setBonusTermin(e.target.value);
              setListError('');
            }}
          />
        </div>

        <div className="field">
          <label htmlFor={`${fid}-bonus-abschluss`}>Prämie je Abschluss (€)</label>
          <input
            id={`${fid}-bonus-abschluss`}
            inputMode="decimal"
            value={bonusAbschluss}
            onChange={(e) => {
              setBonusAbschluss(e.target.value);
              setListError('');
            }}
          />
        </div>

        <div className="field">
          <label htmlFor={`${fid}-attempts`}>Versuche je Kontakt</label>
          <input
            id={`${fid}-attempts`}
            type="number"
            min={1}
            max={20}
            value={maxAttempts}
            onChange={(e) => {
              setMaxAttempts(e.target.value);
              setListError('');
            }}
          />
        </div>

        <div className="field">
          <label htmlFor={`${fid}-product`}>Zielprodukt</label>
          <select
            id={`${fid}-product`}
            value={targetProduct}
            onChange={(e) => setTargetProduct(e.target.value)}
          >
            <option value="">— keines —</option>
            {settings.products.map((pr) => (
              <option key={pr.name} value={pr.name}>
                {pr.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor={`${fid}-start`}>Start</label>
          <input
            id={`${fid}-start`}
            type="date"
            value={startDate}
            max={endDate || undefined}
            onChange={(e) => {
              setStartDate(e.target.value);
              setListError('');
            }}
          />
        </div>

        <div className="field">
          <label htmlFor={`${fid}-end`}>Ende</label>
          <input
            id={`${fid}-end`}
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => {
              setEndDate(e.target.value);
              setListError('');
            }}
          />
        </div>

        {listError && (
          <div className="field full">
            <div className="field-error">{listError}</div>
          </div>
        )}

        <div className="field full">
          <div className="setup-hint">
            Prämien gelten zusätzlich zur normalen Vertragsprovision. Je Kontakt
            zählt immer nur das aktuelle Ergebnis — aus einem Termin, der zum
            Abschluss wird, entsteht keine doppelte Prämie.
          </div>
        </div>

        <div className="field full">
          <label className="row between" style={{ cursor: 'pointer' }}>
            <span>Aktiv — im Schichtplan zuweisbar</span>
            <span className="switch">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              <span className="switch-track">
                <span className="switch-thumb" />
              </span>
            </span>
          </label>
        </div>
      </div>
    </Modal>
  );
}
