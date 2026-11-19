// Which save slot a new game goes in, asked only when every slot is in use: after you press Manage,
// not before (owner, 19 Nov 2026). Choosing a slot is the decision (the game saved there is replaced);
// X, Escape or a tap outside cancel (GAME_FLOW §6.1b rule 9).

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { NextIcon } from '../icons';

export interface SlotChoice {
  slot: number;
  /** "Zwolle Hanzemen". */
  title: string;
  /** "Dutch League · season 2026–27". */
  detail: string;
}

export function SlotPicker({ heading, choices, onPick, onClose }: { heading: string; choices: SlotChoice[]; onPick: (slot: number) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="overlay slot-picker" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel slot-picker-box" role="dialog" aria-label={heading}>
        <div className="slot-picker-head">
          <h3>{heading}</h3>
          <button className="brk-close" onClick={onClose} aria-label="Close" title="Close">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <p className="muted">All three slots are in use. The game saved in the slot you choose is replaced, for good.</p>
        <div className="slot-picker-list">
          {choices.map((c) => (
            <button key={c.slot} className="mm-career-slot" onClick={() => onPick(c.slot)}>
              <span>
                <b>
                  Slot {c.slot + 1} · {c.title}
                </b>
                <small className="muted">{c.detail}</small>
              </span>
              <span className="mm-go">
                Replace <NextIcon />
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
