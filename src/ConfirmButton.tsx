import { useRef, type ReactNode } from 'react';

/**
 * A button that asks first in an in-app dialog (instead of the browser's confirm()). Escape, Cancel or a
 * click beside the dialog closes it; `ask = false` acts right away.
 */
export function ConfirmButton({
  className,
  disabled,
  children,
  title,
  message,
  confirmLabel,
  danger = false,
  ask = true,
  onConfirm,
}: {
  className: string;
  disabled?: boolean;
  children: ReactNode;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  ask?: boolean;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className={className} disabled={disabled} onClick={() => (ask ? dialog.current?.showModal() : onConfirm())}>
        {children}
      </button>
      {/* The dialog box fills the <dialog> element, so a click that lands on the element itself is on the backdrop. */}
      <dialog ref={dialog} className="confirm" onClick={(e) => e.target === dialog.current && dialog.current.close()}>
        <div className="confirm-box">
          <h2>{title}</h2>
          <p className="muted">{message}</p>
          <div className="actions">
            <button className="ghost" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button
              className={danger ? 'danger-fill' : 'primary'}
              autoFocus
              onClick={() => {
                dialog.current?.close();
                onConfirm();
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
