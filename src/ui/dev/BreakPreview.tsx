// Dev only (open the app with ?break, or ?break=2 for halftime, &seed=N): a match played straight to
// a quarter break, showing the break screen, to check its layout without playing to it. ?gamecast
// shows the stats under the court instead, as they are after the break, at a tall screen's size.

import { useReducer, useState } from 'react';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../../data/teams';
import { BreakScreen } from '../components/BreakScreen';
import { ResultScreen } from '../screens/ResultScreen';
import { CourtOverlays, Gamecast } from '../components/Gamecast';
import { LiveMatch } from '../match/controller';

function breakAfter(quarter: number, seed: number, toEnd = false): LiveMatch {
  const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], seed, ['human', 'ai'], 'fast');
  for (let i = 0; i < 2_000_000; i++) {
    // Highlights on: most possessions are worked out without being animated, so it gets there fast.
    m.tick(0.25);
    if (m.phase === 'final' || (!toEnd && m.phase === 'break' && m.breakQuarter >= quarter)) break;
    if (m.phase === 'break' || m.phase === 'timeout') m.resume();
    if (m.phase === 'clutch') while (m.clutch) m.submitClutch(m.clutch.pending[0], null);
    if (m.phase === 'argue') m.letItGo();
  }
  return m;
}

export function BreakPreview() {
  const params = new URLSearchParams(window.location.search);
  const gamecast = params.has('gamecast');
  if (params.has('result')) return <ResultPreview seed={Number(params.get('seed')) || 3} />;
  const [m] = useState(() => breakAfter(Number(params.get(gamecast ? 'gamecast' : 'break')) || (gamecast ? 2 : 1), Number(params.get('seed')) || 3));
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  if (gamecast) {
    return (
      <div className="match" style={{ display: 'block', height: 'auto', padding: 16 }}>
        <div className="court-box" style={{ width: 1040, aspectRatio: '2 / 1', margin: '0 auto 10px' }}>
          <CourtOverlays m={m} humanSides={[0]} />
        </div>
        <div style={{ width: 1040, height: 300, margin: '0 auto' }}>
          <Gamecast m={m} />
        </div>
      </div>
    );
  }
  return <BreakScreen m={m} controllers={['human', 'ai']} onDone={rerender} />;
}

/** ?result: a whole match played out, and the result screen. */
function ResultPreview({ seed }: { seed: number }) {
  const [m] = useState(() => breakAfter(5, seed, true));
  return (
    <div className="app">
      <ResultScreen match={m} onRematch={() => undefined} onMenu={() => undefined} />
    </div>
  );
}
