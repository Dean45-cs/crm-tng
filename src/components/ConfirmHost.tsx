import { Modal } from './Modal';
import { useConfirm } from '../store/useConfirm';

/**
 * Rendert den aktiven Bestätigungsdialog (siehe useConfirm / confirmDialog).
 * Einmalig im App-Baum gemountet — Aufrufe erfolgen imperativ über
 * confirmDialog(...). Nutzt den Modal-Fokus-Trap und Escape-Handling.
 */
export function ConfirmHost() {
  const current = useConfirm((s) => s.current);
  const respond = useConfirm((s) => s.respond);

  if (!current) return null;

  return (
    <Modal
      open
      title={current.title}
      onClose={() => respond(false)}
      footer={
        <>
          <button className="btn" onClick={() => respond(false)}>
            {current.cancelLabel ?? 'Abbrechen'}
          </button>
          <button
            className={`btn ${current.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => respond(true)}
            autoFocus
          >
            {current.confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      {current.message && <p className="modal-subtitle" style={{ margin: 0 }}>{current.message}</p>}
    </Modal>
  );
}
