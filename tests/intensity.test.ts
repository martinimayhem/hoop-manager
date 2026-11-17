// Defensive intensity (GamePlan.aggression): aggressive trades fouls for pressure, careful the other
// way round, and 'normal' changes nothing.

import { describe, expect, it } from 'vitest';
import { HARBOR_HAMMERS, SKYLINE_SPARKS, mirrorTeam } from '../src/data/teams';
import { makePlan, simulateMatch } from '../src/engine/match';
import type { Aggression, Team } from '../src/engine/types';
import { intensityFor } from '../src/game/ai';

function totals(aggression: Aggression, opponent: Team, games = 120) {
  const us = mirrorTeam(SKYLINE_SPARKS, 'SK2');
  let fouls = 0;
  let forced = 0;
  for (let seed = 1; seed <= games; seed++) {
    const r = simulateMatch(us, opponent, makePlan(us, { aggression }), makePlan(opponent), seed);
    fouls += r.box.teams[0].totals.pf;
    forced += r.box.teams[1].totals.tov;
  }
  return { fouls: fouls / games, forced: forced / games };
}

describe('defensive intensity', () => {
  it('WHEN a team defends aggressively THEN it fouls more than a careful one, and forces more turnovers from poor ball handlers', () => {
    const careful = totals('careful', HARBOR_HAMMERS);
    const aggressive = totals('aggressive', HARBOR_HAMMERS);
    expect(aggressive.fouls).toBeGreaterThan(careful.fouls + 5);
    expect(aggressive.forced).toBeGreaterThan(careful.forced + 1.5);
  });
  it("WHEN a plan's intensity is normal THEN the match is the same as a plan without it", () => {
    const a = simulateMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, makePlan(HARBOR_HAMMERS), makePlan(SKYLINE_SPARKS), 4);
    const b = simulateMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, makePlan(HARBOR_HAMMERS, { aggression: 'normal' }), makePlan(SKYLINE_SPARKS, { aggression: 'normal' }), 4);
    expect(b.state.events).toEqual(a.state.events);
  });
  it('WHEN the opponent handles the ball poorly THEN the AI defends aggressively; WHEN it is sure-handed and makes its free throws THEN carefully', () => {
    expect(intensityFor(HARBOR_HAMMERS).aggression).toBe('aggressive');
    const sure: Team = { ...SKYLINE_SPARKS, players: SKYLINE_SPARKS.players.map((p) => ({ ...p, attrs: { ...p.attrs, dribbling: 95, passing: 95, freeThrow: 92 } })) };
    expect(intensityFor(sure).aggression).toBe('careful');
  });
});
