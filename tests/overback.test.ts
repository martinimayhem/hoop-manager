// Over and back: once the offence has the ball over half court it may not go back into the
// backcourt, by a pass, a dribble or a bounce. Played through the live controller, as the camera
// sees it, against the press (where it went wrong most: a pass thrown to a teammate still coming
// up from the backcourt, caught before he was over).

import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../src/data/teams';
import { COURT, HALF_X } from '../src/engine/court';
import type { Tempo } from '../src/engine/types';
import { beatAt, type Script } from '../src/ui/court/animation';
import type { Motion } from '../src/ui/court/motion';
import { LiveMatch } from '../src/ui/match/controller';

function overAndBack(seed: number, tempo: Tempo): string[] {
  const plan = (p: typeof DEFAULT_PLANS.ham) => ({ ...p, tempo, defence: 'press' as const });
  const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [plan(DEFAULT_PLANS.ham), plan(DEFAULT_PLANS.sky)], seed, ['ai', 'ai'], 'normal');
  m.highlights = false;
  const inner = m as unknown as { script: Script | null; durations: number[]; t: number; motion: Motion; lastFrame: { ball: { x: number; z: number } } | null };
  const found: string[] = [];
  let seen: Script | null = null;
  let front = false;
  let over = false;
  for (let i = 0; i < 600000 && m.phase !== 'final'; i++) {
    m.tick(1 / 30);
    m.drainFx();
    if (m.phase === 'timeout' || m.phase === 'break') m.resume();
    const sc = inner.script;
    if (!sc) continue;
    if (sc !== seen) {
      seen = sc;
      front = false;
      over = false;
    }
    const beat = sc.beats[beatAt(sc, inner.durations, inner.t).index];
    const ball = inner.lastFrame?.ball;
    if (over || !ball || beat.dead) continue;
    // Team control ends with a shot, or with the defence getting a hand on it.
    if (beat.ball.kind === 'fromPlayer' && beat.ball.style !== 'throw') {
      over = true;
      continue;
    }
    const h = m.holderKey();
    if (h && !h.startsWith(`${sc.offence}:`)) {
      over = true;
      continue;
    }
    const up = (x: number) => (sc.dir === 1 ? x : COURT.w - x);
    const hp = h ? inner.motion.pos[h] : null;
    if (!front) {
      front = !!hp && up(hp.x) > HALF_X + 0.3 && up(ball.x) > HALF_X + 0.3;
      continue;
    }
    if ((hp && up(hp.x) < HALF_X - 0.1) || (ball.z < 0.4 && up(ball.x) < HALF_X - 0.1)) {
      found.push(`Q${sc.quarter} ${m.clock.toFixed(0)}s: ${h} at ${hp ? up(hp.x).toFixed(1) : '-'} m, ball at ${up(ball.x).toFixed(1)} m (half court ${HALF_X})`);
      over = true;
    }
  }
  expect(m.phase).toBe('final');
  return found;
}

describe('over and back', () => {
  it('once over half court the ball never goes back: no pass to a teammate still in the backcourt, no dribble back over', () => {
    // It was 10 and 7 in these two matches.
    for (const [seed, tempo] of [[3, 'slow'], [3, 'fast']] as const) expect(overAndBack(seed, tempo)).toEqual([]);
  }, 300000);
});
