// Travelling, as the camera sees it: plays two whole matches through the live controller (the same
// animation and movement code as the game, without drawing) with the debug check on, and counts every
// time a player with the ball in his hands, not dribbling, strays more than his two steps (1.2 m) from
// where he gathered it. Dead balls and throw-ins are not in play, so they are not counted.

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../src/data/teams';
import { LiveMatch, type TravelReport } from '../src/ui/match/controller';

function play(seed: number): TravelReport[] {
  const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], seed, ['ai', 'ai'], 'normal');
  m.highlights = false;
  m.debugTravels = true;
  for (let i = 0; i < 400000 && m.phase !== 'final'; i++) {
    m.tick(1 / 30);
    m.drainFx();
    if (m.phase === 'timeout' || m.phase === 'break') m.resume();
  }
  expect(m.phase).toBe('final');
  return m.travels;
}

describe('travelling', () => {
  it('nobody walks with the ball: two steps from the gather, or a pivot, then pass, shoot or dribble', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const travels = [...play(3), ...play(4)];
    warn.mockRestore();
    const bySituation: Record<string, number> = {};
    for (const t of travels) bySituation[t.how] = (bySituation[t.how] ?? 0) + 1;
    console.log(JSON.stringify({ travels: travels.length, bySituation, worst: travels.slice(0, 5) }));
    // Was 136 over these two matches: catches on the move (126), rebounds walked to the rim (7).
    expect(travels).toEqual([]);
  }, 300000);
});
