// Dev only (open the app with ?break, or ?break=2 for halftime, &seed=N): a match played straight to
// a quarter break, showing the break screen, to check its layout without playing to it.

import { useReducer, useState } from 'react';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../../data/teams';
import { BreakScreen } from '../components/BreakScreen';
import { LiveMatch } from '../match/controller';

function breakAfter(quarter: number, seed: number): LiveMatch {
  const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], seed, ['human', 'ai'], 'fast');
  for (let i = 0; i < 2_000_000; i++) {
    m.tick(0.25);
    // Played out, not shown: the preview only wants the numbers at the break.
    m.highlights = false;
    if (m.phase === 'break' && m.breakQuarter >= quarter) break;
    if (m.phase === 'break' || m.phase === 'timeout') m.resume();
    if (m.phase === 'clutch') while (m.clutch) m.submitClutch(m.clutch.pending[0], null);
    if (m.phase === 'argue') m.letItGo();
  }
  return m;
}

export function BreakPreview() {
  const params = new URLSearchParams(window.location.search);
  const [m] = useState(() => breakAfter(Number(params.get('break')) || 1, Number(params.get('seed')) || 3));
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  return <BreakScreen m={m} controllers={['human', 'ai']} onDone={rerender} />;
}
