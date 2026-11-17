// The assistant's live tips: what is shown is true now, in today's words, and recent.

import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../src/data/teams';
import { createMatch, stepPossession } from '../src/engine/match';
import { unansweredRun } from '../src/game/ai';
import { TIP_FRESH_S, assistantTips, createTipMemory, currentTips, type Tip } from '../src/game/assistant';

describe('assistant tips', () => {
  it('WHEN a run has been answered THEN the tip about it is no longer shown; no tip shown is older than its time', () => {
    let runTips = 0;
    let shownAfterAnswered = 0;
    let stale = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const s = createMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, DEFAULT_PLANS.ham, DEFAULT_PLANS.sky, seed);
      const memory = createTipMemory();
      let tips: Tip[] = [];
      while (!s.finished) {
        stepPossession(s);
        const fresh = assistantTips(s, memory);
        runTips += fresh.filter((t) => t.key === 'run').length;
        tips = [...fresh, ...tips];
        for (const side of [0, 1] as const) {
          const shown = currentTips(s, memory, tips, side);
          if (unansweredRun(s, side) < 8 && shown.some((t) => t.key === 'run')) shownAfterAnswered++;
          stale += shown.filter((t) => (s.quarter - t.quarter) * 720 + (t.clock - s.clock) > TIP_FRESH_S).length;
          // Today's words: the run tip names the run as it stands now.
          for (const t of shown) if (t.key === 'run') expect(t.text).toContain(`${unansweredRun(s, side)}-0`);
        }
      }
    }
    expect(runTips).toBeGreaterThan(0);
    expect(shownAfterAnswered).toBe(0);
    expect(stale).toBe(0);
  });
});
