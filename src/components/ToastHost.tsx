import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { useToast, type ToastKind } from '../store/useToast';

const ICON: Record<ToastKind, React.ReactNode> = {
  success: <CheckCircle2 size={17} />,
  error: <XCircle size={17} />,
  info: <Info size={17} />,
};

export function ToastHost() {
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" role="region" aria-label="Benachrichtigungen">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.kind}`}
          role="alert"
          aria-live="polite"
        >
          <span className="toast-icon">{ICON[t.kind]}</span>
          <span className="toast-msg">{t.msg}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                // Erst schließen, dann ausführen: die Meldung soll nicht noch
                // einmal anklickbar sein, während die Aktion läuft.
                dismiss(t.id);
                t.action!.run();
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            className="toast-close"
            onClick={() => dismiss(t.id)}
            aria-label="Schließen"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
