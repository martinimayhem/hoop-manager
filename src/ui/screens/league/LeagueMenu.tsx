// Saved games: continue one or delete one (3 slots). A new game starts from the main menu: choose the
// league, then the club.

import { useState } from 'react';
import type { QuickLeague } from '../../../game/league/quickLeague';
import { clearSlot, listSlots, summarise, type SlotInfo } from '../../../game/league/saves';
import { browserStorage } from './storage';
import { useConfirm } from '../../components/Confirm';
import { NextIcon } from '../../icons';
import { TopBar } from '../../components/TopBar';


function savedWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function LeagueMenu({ onOpen, onNew }: { onOpen: (league: QuickLeague, slot: number) => void; /** A new game: the main menu, where new games start. */ onNew: () => void }) {
  const [slots, setSlots] = useState<SlotInfo[]>(() => listSlots(browserStorage));

  const confirm = useConfirm();
  const clear = (slot: number, what: string) =>
    confirm.ask({ title: `Delete ${what}?`, body: `The save in slot ${slot + 1} is gone for good: this can't be undone.`, confirm: 'Delete', cancel: 'Keep it', danger: true }, () => {
      clearSlot(browserStorage, slot);
      setSlots(listSlots(browserStorage));
    });

  return (
    <div className="menu ql">
      <TopBar crumbs={[{ label: 'Saved games', route: { s: 'saves' } }]} />
      {confirm.dialog}
      <div className="title" style={{ fontSize: 34 }}>
        Saved <span>games</span>
      </div>
      <div className="muted">Your games save themselves as you play. A new game starts from the main menu.</div>

      <div className="ql-slots">
        {slots.map((s) => {
          if (s.status === 'ok') {
            const x = summarise(s.data);
            return (
              <div key={s.slot} className="panel ql-slot">
                <div className="ql-slot-no">Slot {s.slot + 1}</div>
                <div className="ql-slot-main">
                  <div className="ql-club">{x.club}</div>
                  <div className="ql-meta">
                    {x.league}
                    {x.manager ? ` · manager ${x.manager}` : ''}
                  </div>
                  <div className="ql-progress">{x.progress}</div>
                  <div className="muted small">Saved {savedWhen(s.savedAt)}</div>
                </div>
                <div className="ql-slot-actions">
                  <button className="primary" onClick={() => onOpen(s.data, s.slot)}>
                    Continue <NextIcon />
                  </button>
                  <button className="small ql-delete" onClick={() => clear(s.slot, `${x.club} (${x.league})`)}>
                    Delete
                  </button>
                </div>
              </div>
            );
          }
          if (s.status === 'empty') {
            return (
              <div key={s.slot} className="panel ql-slot empty">
                <div className="ql-slot-no">Slot {s.slot + 1}</div>
                <div className="ql-slot-main muted">Empty</div>
                <div className="ql-slot-actions">
                  <button onClick={onNew}>
                    New game <NextIcon />
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div key={s.slot} className="panel ql-slot empty">
              <div className="ql-slot-no">Slot {s.slot + 1}</div>
              <div className="ql-slot-main muted">{s.message}</div>
              <div className="ql-slot-actions">
                <button className="small ql-delete" onClick={() => clear(s.slot, 'this save')}>
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
