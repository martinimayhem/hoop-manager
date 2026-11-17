// The game's own "are you sure?" box, in place of the browser's: a title, what will happen, and two
// buttons. Escape cancels, Enter confirms. `danger` for something that cannot be undone (deleting a save).

import { useEffect, useState, type ReactNode } from 'react';

export interface ConfirmOptions {
  title: string;
  body: ReactNode;
  confirm: string;
  cancel?: string;
  danger?: boolean;
}

/** `ask(options, then)` opens the box; `then` runs only if the player confirms. Render `dialog` somewhere on the screen. */
export function useConfirm(): { ask: (o: ConfirmOptions, then: () => void) => void; dialog: ReactNode } {
  const [open, setOpen] = useState<{ o: ConfirmOptions; then: () => void } | null>(null);
  const close = () => setOpen(null);
  const yes = () => {
    const then = open?.then;
    setOpen(null);
    then?.();
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Enter') {
        e.preventDefault();
        yes();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const dialog = open ? (
    <div className="overlay confirm-overlay" onClick={close}>
      <div className="panel confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="confirm-title">{open.o.title}</h3>
        <div className="confirm-body">{open.o.body}</div>
        <div className="confirm-actions">
          <button onClick={close}>{open.o.cancel ?? 'Cancel'}</button>
          <button className={open.o.danger ? 'danger' : 'primary'} autoFocus onClick={yes}>
            {open.o.confirm}
          </button>
        </div>
      </div>
    </div>
  ) : null;
  return { ask: (o, then) => setOpen({ o, then }), dialog };
}
