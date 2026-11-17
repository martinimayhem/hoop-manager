// Competition rules (SEASON_SPEC R3.5): a player fouls out on his 6th foul under NBA rules (the
// default), on his 5th under FIBA rules (Career, Europe).

import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../src/data/teams';
import { simulateMatch } from '../src/engine/match';
import { FIBA_RULES, NBA_RULES, type MatchRules } from '../src/engine/types';

function foulOuts(rules: MatchRules | undefined, games: number): { fouls: number[]; overLimit: number } {
  const fouls: number[] = [];
  let overLimit = 0;
  for (let seed = 1; seed <= games; seed++) {
    const r = simulateMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, DEFAULT_PLANS.ham, DEFAULT_PLANS.sky, seed, rules);
    const limit = (rules ?? NBA_RULES).foulLimit;
    for (const t of r.state.teams) {
      for (const ps of Object.values(t.players)) {
        if (ps.fouledOut && !ps.ejected) fouls.push(ps.fouls);
        if (ps.fouls > limit) overLimit++;
      }
    }
  }
  return { fouls, overLimit };
}

describe('foul limits', () => {
  it('WHEN a match is played under FIBA rules THEN players foul out on their 5th foul, and nobody has more than 5', () => {
    const { fouls, overLimit } = foulOuts(FIBA_RULES, 200);
    expect(fouls.length).toBeGreaterThan(0);
    expect(new Set(fouls)).toEqual(new Set([5]));
    expect(overLimit).toBe(0);
  });
  it('WHEN a match is played under NBA rules (the default) THEN players foul out on their 6th foul, and nobody has more than 6', () => {
    const { fouls, overLimit } = foulOuts(undefined, 200);
    expect(fouls.every((f) => f === 6)).toBe(true);
    expect(overLimit).toBe(0);
  });
  it('WHEN NBA rules are passed explicitly THEN the match is the same as with no rules given', () => {
    const a = simulateMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, DEFAULT_PLANS.ham, DEFAULT_PLANS.sky, 9);
    const b = simulateMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, DEFAULT_PLANS.ham, DEFAULT_PLANS.sky, 9, NBA_RULES);
    expect(b.state.events).toEqual(a.state.events);
  });
});
