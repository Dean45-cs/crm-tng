import { type ReactNode, useEffect, useId, useRef } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ title, subtitle, open, onClose, children, footer }: Props) {
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Immer der aktuelle onClose — so muss der Fokus-Trap-Effekt nicht von
  // onClose abhängen und wird nicht bei jedem Eltern-Render neu aufgebaut.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(
        modalRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      ).filter((el) => el.offsetParent !== null);

    // Initialfokus: erstes fokussierbares Element, falls nichts via autoFocus griff.
    const t = window.setTimeout(() => {
      if (!modalRef.current?.contains(document.activeElement)) {
        focusables()[0]?.focus();
      }
    }, 0);

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !modalRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', handler);
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId}>{title}</h3>
        {subtitle && <div className="modal-subtitle">{subtitle}</div>}
        {children}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
