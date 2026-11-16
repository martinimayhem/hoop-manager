// Quick League: the saved leagues (3 slots) and a new one (league, opponent, names).

import { useState } from 'react';
import { LEAGUES, type LeagueId } from '../../../game/league/leagues';
import { createQuickLeague, runAiPicks, type QuickLeague } from '../../../game/league/quickLeague';
import { clearSlot, listSlots, type SlotInfo } from '../../../game/league/saves';
import { browserStorage } from './storage';

export function LeagueMenu({ onOpen, onBack }: { onOpen: (league: QuickLeague, slot: number) => void; onBack: () => void }) {
  const [slots, setSlots] = useState<SlotInfo[]>(() => listSlots(browserStorage));
  const [league, setLeague] = useState<LeagueId>('pro');
  const [mode, setMode] = useState<'ai' | 'pvp'>('ai');
  const [names, setNames] = useState<[string, string]>(['Player 1', 'Player 2']);
  const firstEmpty = slots.findIndex((s) => s.status === 'empty');
  const [slot, setSlot] = useState(firstEmpty >= 0 ? firstEmpty : 0);

  const start = () => {
    const used = slots[slot].status !== 'empty';
    if (used && !window.confirm(`Slot ${slot + 1} already has a save. Start a new league over it?`)) return;
    const humans = mode === 'ai' ? [names[0].trim() || 'Player 1'] : [names[0].trim() || 'Player 1', names[1].trim() || 'Player 2'];
    const q = runAiPicks(createQuickLeague(league, humans, Date.now() >>> 0));
    onOpen(q, slot);
  };

  return (
    <div className="menu">
      <div className="row">
        <button onClick={onBack}>◀ Back</button>
        <div className="title" style={{ fontSize: 34 }}>
          Quick <span>League</span>
        </div>
      </div>
      <div className="muted">Eight teams, a snake draft, fourteen matchdays. Play your matches live (or let the computer play them) and climb the table.</div>

      <div className="panel">
        <h3>Saved leagues</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {slots.map((s) => (
            <div key={s.slot} className="row">
              <b style={{ width: 60 }}>Slot {s.slot + 1}</b>
              {s.status === 'ok' ? (
                <>
                  <span style={{ flex: 1 }}>
                    {s.label} <span className="muted small">· saved {new Date(s.savedAt).toLocaleString()}</span>
                  </span>
                  <button className="primary" onClick={() => onOpen(s.data, s.slot)}>
                    Continue ▶
                  </button>
                  <button
                    onClick={() => {
                      if (!window.confirm(`Delete the save in slot ${s.slot + 1}? This can't be undone.`)) return;
                      clearSlot(browserStorage, s.slot);
                      setSlots(listSlots(browserStorage));
                    }}
                  >
                    Delete
                  </button>
                </>
              ) : s.status === 'empty' ? (
                <span className="muted" style={{ flex: 1 }}>
                  Empty
                </span>
              ) : (
                <>
                  <span className="muted" style={{ flex: 1 }}>
                    {s.message}
                  </span>
                  <button
                    onClick={() => {
                      if (!window.confirm(`Clear slot ${s.slot + 1}?`)) return;
                      clearSlot(browserStorage, s.slot);
                      setSlots(listSlots(browserStorage));
                    }}
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>New league</h3>
        <div className="choice-grid">
          {(Object.keys(LEAGUES) as LeagueId[]).map((id) => (
            <button key={id} className={`choice ${league === id ? 'active' : ''}`} onClick={() => setLeague(id)}>
              <b>{LEAGUES[id].name}</b>
              <small>
                {LEAGUES[id].budget} credits. {LEAGUES[id].blurb}
              </small>
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>Who's playing</h3>
        <div className="choice-grid">
          <button className={`choice ${mode === 'ai' ? 'active' : ''}`} onClick={() => setMode('ai')}>
            <b>Just me</b>
            <small>You and seven computer teams.</small>
          </button>
          <button className={`choice ${mode === 'pvp' ? 'active' : ''}`} onClick={() => setMode('pvp')}>
            <b>Two players (same keyboard)</b>
            <small>You both join the league with six computer teams. When you meet, it's a hot-seat match.</small>
          </button>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <input value={names[0]} onChange={(e) => setNames([e.target.value, names[1]])} style={{ flex: 1, borderColor: 'var(--home)' }} />
          {mode === 'pvp' && <input value={names[1]} onChange={(e) => setNames([names[0], e.target.value])} style={{ flex: 1, borderColor: 'var(--away)' }} />}
        </div>
      </div>

      <div className="panel row">
        <h3 style={{ margin: 0 }}>Save in</h3>
        {slots.map((s) => (
          <button key={s.slot} className={slot === s.slot ? 'active' : ''} onClick={() => setSlot(s.slot)}>
            Slot {s.slot + 1}
            {s.status !== 'empty' ? ' (used)' : ''}
          </button>
        ))}
        <div className="spacer" />
        <button className="primary" onClick={start}>
          Start the draft ▶
        </button>
      </div>
    </div>
  );
}
