import { describe, expect, it } from 'vitest';
import { HARBOR_HAMMERS, SKYLINE_SPARKS } from '../src/data/teams';
import { staminaFactor, tickFatigue } from '../src/engine/fatigue';
import { createMatch, makePlan } from '../src/engine/match';
import { fatigueFactor } from '../src/engine/ratings';

function fresh(homeDefence: 'man' | 'press' = 'man') {
  return createMatch(
    HARBOR_HAMMERS,
    SKYLINE_SPARKS,
    makePlan(HARBOR_HAMMERS, { defence: homeDefence }),
    makePlan(SKYLINE_SPARKS),
    1,
  );
}

describe('fatigue', () => {
  it('drains players on court and counts their minutes', () => {
    const s = fresh();
    const starter = s.teams[0].lineup[0];
    tickFatigue(s, 120);
    expect(s.teams[0].players[starter].energy).toBeLessThan(100);
    expect(s.teams[0].players[starter].stats.seconds).toBe(120);
  });

  it('recovers players on the bench', () => {
    const s = fresh();
    const benchId = s.teams[0].plan.bench[0];
    s.teams[0].players[benchId].energy = 50;
    tickFatigue(s, 60);
    expect(s.teams[0].players[benchId].energy).toBeGreaterThan(50);
    expect(s.teams[0].players[benchId].stats.seconds).toBe(0);
  });

  it('pressing costs more energy than man defence', () => {
    const man = fresh('man');
    const press = fresh('press');
    tickFatigue(man, 300);
    tickFatigue(press, 300);
    const id = man.teams[0].lineup[2];
    expect(press.teams[0].players[id].energy).toBeLessThan(man.teams[0].players[id].energy);
  });

  it('better stamina drains slower, and tired players perform worse', () => {
    expect(staminaFactor(90)).toBeLessThan(staminaFactor(50));
    expect(fatigueFactor(100)).toBe(1);
    expect(fatigueFactor(40)).toBeLessThan(fatigueFactor(70));
  });
});
