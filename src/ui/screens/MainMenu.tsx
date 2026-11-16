import { useState } from 'react';
import type { Speed } from '../match/controller';
import type { Setup } from '../App';

/** Where the court view choice is remembered in this browser (shared with the match screen's toggle). */
export const VIEW_3D_KEY = 'hm.view3d';

/** The view to start with: ?view=3d or ?view=2d in the address, else the last one used, else 2D. */
function startView(): Setup['view'] {
  const asked = new URLSearchParams(window.location.search).get('view');
  if (asked === '3d' || asked === '2d') return asked;
  try {
    return localStorage.getItem(VIEW_3D_KEY) === '1' ? '3d' : '2d';
  } catch {
    return '2d';
  }
}

export function MainMenu({ onStart, onLeague }: { onStart: (setup: Setup) => void; onLeague: () => void }) {
  const [mode, setMode] = useState<Setup['mode']>('ai');
  const [draft, setDraft] = useState<Setup['draft']>('free');
  const [names, setNames] = useState<[string, string]>(['Player 1', 'Player 2']);
  const [speed, setSpeed] = useState<Speed>('normal');
  const [view, setView] = useState<Setup['view']>(startView);

  const effectiveDraft = mode === 'pvp' && draft === 'free' ? 'snake' : draft;
  const awayName = mode === 'ai' ? 'Robo Ballers' : names[1];

  return (
    <div className="menu">
      <div>
        <div className="title">
          Hoop <span>Manager</span>
        </div>
        <div className="muted">Build a squad on a budget, scout the opponent, set your tactics, and out-coach the other bench.</div>
      </div>
      <div className="panel row">
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0 }}>Quick League</h3>
          <div className="muted small">A whole season: 8 teams, a snake draft, 14 matchdays and a league table. Saved as you go.</div>
        </div>
        <button className="primary" onClick={onLeague}>
          Quick League ▶
        </button>
      </div>
      <h3 style={{ margin: '4px 0 0' }}>Or a single match</h3>

      <div className="panel">
        <h3>Opponent</h3>
        <div className="choice-grid">
          <button className={`choice ${mode === 'ai' ? 'active' : ''}`} onClick={() => setMode('ai')}>
            <b>vs Computer</b>
            <small>You against the AI coach.</small>
          </button>
          <button className={`choice ${mode === 'pvp' ? 'active' : ''}`} onClick={() => setMode('pvp')}>
            <b>vs Player (same keyboard)</b>
            <small>Hot-seat. Player 1 calls timeouts with Q, Player 2 with P.</small>
          </button>
        </div>
      </div>

      <div className="panel">
        <h3>Team names</h3>
        <div className="row">
          <input value={names[0]} onChange={(e) => setNames([e.target.value, names[1]])} style={{ flex: 1, borderColor: 'var(--home)' }} />
          <input
            value={awayName}
            disabled={mode === 'ai'}
            onChange={(e) => setNames([names[0], e.target.value])}
            style={{ flex: 1, borderColor: 'var(--away)' }}
          />
        </div>
      </div>

      <div className="panel">
        <h3>Squads</h3>
        <div className="choice-grid">
          <button className={`choice ${effectiveDraft === 'free' ? 'active' : ''}`} disabled={mode === 'pvp'} onClick={() => setDraft('free')}>
            <b>Free draft</b>
            <small>Spend 100 credits on 12 players. The AI shops first, so hunt for bargains.</small>
          </button>
          <button className={`choice ${effectiveDraft === 'snake' ? 'active' : ''}`} onClick={() => setDraft('snake')}>
            <b>Snake draft</b>
            <small>Take turns picking from one shared pool (1-2-2-1…). Still 100 credits each.</small>
          </button>
          <button className={`choice ${effectiveDraft === 'quick' ? 'active' : ''}`} onClick={() => setDraft('quick')}>
            <b>Quick match</b>
            <small>Skip the draft: Harbor Hammers (big &amp; slow) vs Skyline Sparks (small &amp; fast).</small>
          </button>
        </div>
      </div>

      <div className="panel">
        <h3>Court view</h3>
        <div className="choice-grid">
          <button className={`choice ${view === '2d' ? 'active' : ''}`} onClick={() => setView('2d')}>
            <b>2D</b>
            <small>The classic court, seen from above the corner.</small>
          </button>
          <button className={`choice ${view === '3d' ? 'active' : ''}`} onClick={() => setView('3d')}>
            <b>3D (beta)</b>
            <small>The same game on a 3D court: drag to turn it, scroll to zoom. You can switch during the match.</small>
          </button>
        </div>
      </div>

      <div className="panel row">
        <h3 style={{ margin: 0 }}>Match speed</h3>
        <button className={speed === 'normal' ? 'active' : ''} onClick={() => setSpeed('normal')}>
          Normal (~7.5 min per quarter)
        </button>
        <button className={speed === 'fast' ? 'active' : ''} onClick={() => setSpeed('fast')}>
          Fast (~4 min per quarter)
        </button>
        <div className="spacer" />
        <button
          className="primary"
          onClick={() =>
            onStart({
              mode,
              draft: effectiveDraft,
              names: [names[0].trim() || 'Player 1', (mode === 'ai' ? awayName : names[1].trim()) || 'Player 2'],
              speed,
              view,
            })
          }
        >
          Start ▶
        </button>
      </div>
    </div>
  );
}
