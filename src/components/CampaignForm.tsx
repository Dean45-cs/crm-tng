import { useId, useState } from 'react';
import { Modal } from './Modal';
import { useStore } from '../store/useStore';
import type { Campaign, CampaignCallType } from '../types';

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
  const { addCampaign, updateCampaign } = useStore();
  const editing = !!campaign;

  const [name, setName] = useState(campaign?.name ?? '');
  const [callType, setCallType] = useState<CampaignCallType>(campaign?.callType ?? 'churn');
  const [active, setActive] = useState(campaign?.active ?? true);
  const [error, setError] = useState('');

  const save = () => {
    const cleanName = name.trim();
    if (!cleanName) {
      setError('Bitte einen Namen eingeben.');
      return;
    }
    const payload = { name: cleanName, callType, active };
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
