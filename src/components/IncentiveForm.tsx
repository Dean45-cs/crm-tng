import { useId, useState } from 'react';
import { Modal } from './Modal';
import { useStore } from '../store/useStore';
import type {
  Incentive,
  IncentiveMechanic,
  IncentiveMetric,
  IncentivePeriod,
} from '../types';

interface Props {
  onClose: () => void;
  /** Gesetzt = Bearbeiten, sonst Neuanlage. */
  incentive?: Incentive;
}

const MECHANIC_LABEL: Record<IncentiveMechanic, string> = {
  goal: 'Zielprämie — wer das Ziel erreicht, gewinnt',
  competition: 'Wettbewerb — nur Platz 1 gewinnt',
};
const METRIC_LABEL: Record<IncentiveMetric, string> = {
  commission: 'Provision (€)',
  contracts: 'Anzahl Verträge',
  deals: 'Abschlüsse gesamt (Verträge + Tarifwechsel)',
};
const PERIOD_LABEL: Record<IncentivePeriod, string> = {
  weekly: 'Wöchentlich',
  monthly: 'Monatlich',
};

/**
 * Modal-Formular zum Erstellen/Bearbeiten eines Incentives. Wird nur gerendert,
 * solange es offen sein soll — die Aufrufstelle keyt es pro Incentive, damit
 * die Felder direkt aus den Props initialisiert werden.
 */
export function IncentiveForm({ onClose, incentive }: Props) {
  const fid = useId();
  const { addIncentive, updateIncentive } = useStore();
  const editing = !!incentive;

  const [title, setTitle] = useState(incentive?.title ?? '');
  const [mechanic, setMechanic] = useState<IncentiveMechanic>(
    incentive?.mechanic ?? 'goal',
  );
  const [metric, setMetric] = useState<IncentiveMetric>(
    incentive?.metric ?? 'commission',
  );
  const [period, setPeriod] = useState<IncentivePeriod>(
    incentive?.period ?? 'weekly',
  );
  const [target, setTarget] = useState(
    incentive?.target ? String(incentive.target) : '',
  );
  const [reward, setReward] = useState(incentive?.reward ?? '');
  const [active, setActive] = useState(incentive?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const clearError = (key: string) =>
    setErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });

  const save = () => {
    const cleanTitle = title.trim();
    const cleanReward = reward.trim();
    const targetNum = parseFloat(target) || 0;

    const errs: Record<string, string> = {};
    if (!cleanTitle) errs.title = 'Bitte einen Titel eingeben.';
    if (!cleanReward) errs.reward = 'Bitte eine Belohnung eingeben.';
    if (mechanic === 'goal' && targetNum <= 0)
      errs.target = 'Bitte ein Ziel größer als 0 eingeben.';
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    const payload = {
      title: cleanTitle,
      mechanic,
      metric,
      period,
      target: mechanic === 'goal' ? targetNum : 0,
      reward: cleanReward,
      active,
    };
    if (incentive) updateIncentive(incentive.id, payload);
    else addIncentive(payload);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Incentive bearbeiten' : 'Incentive erstellen'}
      subtitle="Ein Team-Ziel mit Belohnung für diese Woche oder diesen Monat."
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
          <label htmlFor={`${fid}-title`}>Titel *</label>
          <input
            id={`${fid}-title`}
            autoFocus
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              clearError('title');
            }}
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? `${fid}-title-err` : undefined}
            placeholder="z.B. Sprint-Woche"
          />
          {errors.title && (
            <div className="field-error" id={`${fid}-title-err`}>
              {errors.title}
            </div>
          )}
        </div>

        <div className="field">
          <label htmlFor={`${fid}-mechanic`}>Mechanik</label>
          <select
            id={`${fid}-mechanic`}
            value={mechanic}
            onChange={(e) => setMechanic(e.target.value as IncentiveMechanic)}
          >
            {(Object.keys(MECHANIC_LABEL) as IncentiveMechanic[]).map((m) => (
              <option key={m} value={m}>
                {MECHANIC_LABEL[m]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor={`${fid}-period`}>Zeitraum</label>
          <select
            id={`${fid}-period`}
            value={period}
            onChange={(e) => setPeriod(e.target.value as IncentivePeriod)}
          >
            {(Object.keys(PERIOD_LABEL) as IncentivePeriod[]).map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABEL[p]}
              </option>
            ))}
          </select>
        </div>

        <div className={mechanic === 'goal' ? 'field' : 'field full'}>
          <label htmlFor={`${fid}-metric`}>Zielgröße</label>
          <select
            id={`${fid}-metric`}
            value={metric}
            onChange={(e) => setMetric(e.target.value as IncentiveMetric)}
          >
            {(Object.keys(METRIC_LABEL) as IncentiveMetric[]).map((m) => (
              <option key={m} value={m}>
                {METRIC_LABEL[m]}
              </option>
            ))}
          </select>
        </div>

        {mechanic === 'goal' && (
          <div className="field">
            <label htmlFor={`${fid}-target`}>
              Ziel * {metric === 'commission' ? '(€)' : '(Anzahl)'}
            </label>
            <input
              id={`${fid}-target`}
              type="number"
              min="1"
              step={metric === 'commission' ? '10' : '1'}
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                clearError('target');
              }}
              aria-invalid={!!errors.target}
              aria-describedby={errors.target ? `${fid}-target-err` : undefined}
              placeholder={metric === 'commission' ? 'z.B. 500' : 'z.B. 5'}
            />
            {errors.target && (
              <div className="field-error" id={`${fid}-target-err`}>
                {errors.target}
              </div>
            )}
          </div>
        )}

        <div className="field full">
          <label htmlFor={`${fid}-reward`}>Belohnung *</label>
          <input
            id={`${fid}-reward`}
            value={reward}
            onChange={(e) => {
              setReward(e.target.value);
              clearError('reward');
            }}
            aria-invalid={!!errors.reward}
            aria-describedby={errors.reward ? `${fid}-reward-err` : undefined}
            placeholder="z.B. 50 € Gutschein"
          />
          {errors.reward && (
            <div className="field-error" id={`${fid}-reward-err`}>
              {errors.reward}
            </div>
          )}
        </div>

        <div className="field full">
          <label className="row between" style={{ cursor: 'pointer' }}>
            <span>Aktiv — für das Team sichtbar</span>
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
