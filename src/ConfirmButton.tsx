import { useRef, type ReactNode } from 'react';
import { useButtonReaction } from './sakuga';

/**
 * The Sakuga button for one of the app's button class lists: `primary` (or `danger-fill`, red) is a primary
 * button, anything else a secondary one; `danger` makes it red, `small` smaller.
 */
export function buttonLook(className: string): { primary: boolean; className: string | undefined } {
  const classes = className.split(/\s+/);
  const look = [(classes.includes('danger') || classes.includes('danger-fill')) && 'danger', classes.includes('small') && 'small'].filter(Boolean).join(' ');
  return { primary: classes.includes('primary') || classes.includes('danger-fill'), className: look || undefined };
}

/**
 * A button that asks first in an in-app dialog (instead of the browser's confirm()). Escape, Cancel or a
 * click beside the dialog closes it; `ask = false` acts right away. `className` picks its look (buttonLook).
 */
export function ConfirmButton({
  className,
  disabled = false,
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
  const confirm = useRef<SakugaButtonElement>(null);
  const reaction = useButtonReaction();
  const { primary, className: look } = buttonLook(className);
  return (
    <>
      {/* A primary trigger stays enabled-looking through its press (an action that disables it right away would fade the impact). */}
      <sakuga-button
        variant={primary ? undefined : 'secondary'}
        className={look}
        disabled={disabled && !(primary && reaction.held)}
        onClick={() => {
          if (disabled) return;
          if (primary) reaction.pressed();
          if (!ask) return onConfirm();
          dialog.current?.showModal();
          confirm.current?.focus();
        }}
      >
        {children}
      </sakuga-button>
      {/* The dialog box fills the <dialog> element, so a click that lands on the element itself is on the backdrop. */}
      <dialog ref={dialog} className="confirm" onClick={(e) => e.target === dialog.current && dialog.current.close()}>
        <div className="confirm-box">
          <h2>{title}</h2>
          <p className="muted">{message}</p>
          <div className="actions">
            <sakuga-button variant="secondary" onClick={() => dialog.current?.close()}>
              Cancel
            </sakuga-button>
            <sakuga-button
              ref={confirm}
              className={danger ? 'danger' : undefined}
              onClick={() => {
                dialog.current?.close();
                onConfirm();
              }}
            >
              {confirmLabel}
            </sakuga-button>
          </div>
        </div>
      </dialog>
    </>
  );
}
