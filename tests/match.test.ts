import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../src/data/teams';
import { createMatch, makePlan, setGamePlan, simulateMatch, stepPossession } from '../src/engine/match';

const play = (seed: number) => simulateMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, DEFAULT_PLANS.ham, DEFAULT_PLANS.sky, seed);

describe('match', () => {
  it('replays identically from the same seed', () => {
    const a = play(42);
    const b = play(42);
    expect(a.state.events).toEqual(b.state.events);
    expect(a.box).toEqual(b.box);
  });

  it('different seeds give different games', () => {
    expect(play(1).state.events).not.toEqual(play(2).state.events);
  });

  it('always finishes with a winner and plausible scores', () => {
    for (let seed = 0; seed < 40; seed++) {
      const { box, state, winner } = play(seed);
      expect(state.finished).toBe(true);
      expect(state.quarter).toBeGreaterThanOrEqual(4);
      expect(box.teams[0].score).not.toBe(box.teams[1].score);
      expect(box.teams[winner].score).toBeGreaterThan(box.teams[1 - winner].score);
      for (const t of box.teams) {
        expect(t.score).toBeGreaterThan(65);
        expect(t.score).toBeLessThan(170);
        expect(t.extras.possessions).toBeGreaterThan(80);
        expect(t.extras.possessions).toBeLessThan(125);
      }
    }
  });

  it('box score adds up', () => {
    for (let seed = 100; seed < 120; seed++) {
      const { box, state } = play(seed);
      const gameSeconds = 4 * 720 + Math.max(0, state.quarter - 4) * 300;
      for (const t of box.teams) {
        const st = t.totals;
        expect(st.pts).toBe(t.score);
        expect(st.pts).toBe(2 * st.fgm + st.tpm + st.ftm);
        expect(t.quarterPoints.reduce((a, b) => a + b, 0)).toBe(t.score);
        expect(st.seconds).toBeCloseTo(5 * gameSeconds, 3);
        for (const line of t.players) {
          expect(line.stats.fgm).toBeLessThanOrEqual(line.stats.fga);
          expect(line.stats.tpa).toBeLessThanOrEqual(line.stats.fga);
          expect(line.stats.pf).toBeLessThanOrEqual(6);
        }
      }
    }
  });

  it('keeps five players on court and never plays a fouled-out player', () => {
    for (let seed = 200; seed < 230; seed++) {
      const s = createMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, DEFAULT_PLANS.ham, DEFAULT_PLANS.sky, seed);
      while (!s.finished) {
        stepPossession(s);
        for (const team of s.teams) {
          expect(new Set(team.lineup).size).toBe(5);
          for (const id of team.lineup) expect(team.players[id].fouledOut).toBe(false);
        }
      }
    }
  });

  it('starters play the most, but nobody plays the whole game', () => {
    let starterSeconds = 0;
    let starters = 0;
    let maxSeconds = 0;
    for (let seed = 300; seed < 340; seed++) {
      for (const t of play(seed).box.teams) {
        for (const line of t.players) {
          if (line.starter) {
            starterSeconds += line.stats.seconds;
            starters++;
          }
          maxSeconds = Math.max(maxSeconds, line.stats.seconds);
        }
      }
    }
    const avgMinutes = starterSeconds / starters / 60;
    expect(avgMinutes).toBeGreaterThan(28);
    expect(avgMinutes).toBeLessThan(40);
    expect(maxSeconds / 60).toBeLessThan(48);
  });

  it('setGamePlan swaps the lineup and the tactics mid-game', () => {
    const s = createMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, DEFAULT_PLANS.ham, DEFAULT_PLANS.sky, 5);
    for (let i = 0; i < 30; i++) stepPossession(s);
    const plan = makePlan(HARBOR_HAMMERS, { defence: 'zone', starters: DEFAULT_PLANS.ham.bench.slice(0, 5) });
    setGamePlan(s, 0, plan);
    expect(s.teams[0].plan.defence).toBe('zone');
    expect([...s.teams[0].lineup].sort()).toEqual([...plan.starters].sort());
    while (!s.finished) stepPossession(s);
  });
});
