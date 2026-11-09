// Statistical checks that tactics move outcomes in the direction the counter system promises.
// Each compares totals over many seeded games with only one setting changed.

import { describe, expect, it } from 'vitest';
import { HARBOR_HAMMERS, SKYLINE_SPARKS, mirrorTeam } from '../src/data/teams';
import { createMatch, makePlan, simulateMatch, type MatchResult } from '../src/engine/match';
import { playPossession } from '../src/engine/possession';
import { composite } from '../src/engine/ratings';
import { pressTurnoverChance } from '../src/engine/tactics';
import type { GamePlan, Team } from '../src/engine/types';

const GAMES = 120;

/** Sums a stat over GAMES mirror games where only the plan tweaks differ. */
function total(team: Team, home: Partial<GamePlan>, away: Partial<GamePlan>, stat: (r: MatchResult) => number): number {
  const opponent = mirrorTeam(team, 'OPP');
  let sum = 0;
  for (let seed = 0; seed < GAMES; seed++) {
    sum += stat(simulateMatch(team, opponent, makePlan(team, home), makePlan(opponent, away), seed));
  }
  return sum;
}

const homeBox = (r: MatchResult) => r.box.teams[0];

describe('single possession', () => {
  it('runs clock and hands the ball over', () => {
    const s = createMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, makePlan(HARBOR_HAMMERS), makePlan(SKYLINE_SPARKS), 3);
    const before = s.clock;
    const offence = s.possession;
    playPossession(s);
    expect(s.clock).toBeLessThan(before);
    expect(s.possession).not.toBe(offence);
    expect(s.teams[offence].extras.possessions).toBe(1);
  });
});

describe('counters', () => {
  it('zone defence cuts paint scoring', () => {
    const paint = (r: MatchResult) => homeBox(r).extras.paintPts;
    const vsMan = total(HARBOR_HAMMERS, { offence: 'inside' }, { defence: 'man' }, paint);
    const vsZone = total(HARBOR_HAMMERS, { offence: 'inside' }, { defence: 'zone' }, paint);
    expect(vsZone).toBeLessThan(vsMan * 0.95);
  });

  it('good shooters punish a zone from three', () => {
    const threes = (r: MatchResult) => homeBox(r).totals.tpm;
    const vsMan = total(SKYLINE_SPARKS, { offence: 'three' }, { defence: 'man' }, threes);
    const vsZone = total(SKYLINE_SPARKS, { offence: 'three' }, { defence: 'zone' }, threes);
    expect(vsZone).toBeGreaterThan(vsMan * 1.03);
  });

  it('the press forces turnovers, more so against poor ball handlers', () => {
    const tov = (r: MatchResult) => homeBox(r).totals.tov;
    const hamVsMan = total(HARBOR_HAMMERS, {}, { defence: 'man' }, tov);
    const hamVsPress = total(HARBOR_HAMMERS, {}, { defence: 'press' }, tov);
    const skyVsMan = total(SKYLINE_SPARKS, {}, { defence: 'man' }, tov);
    const skyVsPress = total(SKYLINE_SPARKS, {}, { defence: 'press' }, tov);
    expect(hamVsPress).toBeGreaterThan(hamVsMan * 1.1);
    expect(skyVsPress).toBeGreaterThan(skyVsMan * 1.1);
    // The two rosters handle the ball only about five points apart: under a turnover a game, less
    // than the noise in 120 games, so the effect of ball handling is checked on the press itself.
    expect(pressTurnoverChance(55, 1)).toBeGreaterThan(pressTurnoverChance(65, 1) + 0.01);
    expect(pressTurnoverChance(65, 1)).toBeGreaterThan(pressTurnoverChance(80, 1) + 0.02);
  });

  it('pressing tires the pressing team out', () => {
    const starterSeconds = (r: MatchResult) =>
      r.box.teams[0].players.filter((l) => l.starter).reduce((sum, l) => sum + l.stats.seconds, 0);
    const man = total(HARBOR_HAMMERS, { defence: 'man' }, {}, starterSeconds);
    const press = total(HARBOR_HAMMERS, { defence: 'press' }, {}, starterSeconds);
    expect(press).toBeLessThan(man);
  });

  it('fast tempo means more possessions than slow', () => {
    const poss = (r: MatchResult) => homeBox(r).extras.possessions;
    const slow = total(SKYLINE_SPARKS, { tempo: 'slow' }, { tempo: 'slow' }, poss);
    const fast = total(SKYLINE_SPARKS, { tempo: 'fast' }, { tempo: 'fast' }, poss);
    expect(fast).toBeGreaterThan(slow * 1.15);
  });

  it('fast-break focus produces more fast-break points', () => {
    const fb = (r: MatchResult) => homeBox(r).extras.fastBreakPts;
    const balanced = total(SKYLINE_SPARKS, { offence: 'balanced' }, {}, fb);
    const running = total(SKYLINE_SPARKS, { offence: 'fastBreak' }, {}, fb);
    expect(running).toBeGreaterThan(balanced * 1.3);
  });

  it('inside focus wins more offensive rebounds than leaking out', () => {
    const oreb = (r: MatchResult) => homeBox(r).totals.oreb;
    const inside = total(HARBOR_HAMMERS, { offence: 'inside' }, {}, oreb);
    const running = total(HARBOR_HAMMERS, { offence: 'fastBreak' }, {}, oreb);
    expect(inside).toBeGreaterThan(running);
  });

  it('double-teaming the star lowers the star\'s scoring', () => {
    const star = [...SKYLINE_SPARKS.players].sort((a, b) => composite(b).overall - composite(a).overall)[0];
    const starPts = (r: MatchResult) => homeBox(r).players.find((l) => l.player.id === star.id)!.stats.pts;
    const normal = total(SKYLINE_SPARKS, {}, {}, starPts);
    const doubled = total(SKYLINE_SPARKS, {}, { keyMatchup: { kind: 'double', targetId: star.id } }, starPts);
    expect(doubled).toBeLessThan(normal * 0.95);
  });
});

describe('fast breaks', () => {
  it('an open finish, with nobody back or after the last defender commits, goes in about nine times in ten', () => {
    let open = 0;
    let made = 0;
    let paint = 0;
    let chaseDowns = 0;
    let otherBlocks = 0;
    for (let seed = 0; seed < GAMES; seed++) {
      const r = simulateMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, makePlan(HARBOR_HAMMERS), makePlan(SKYLINE_SPARKS), seed);
      let openNext = false;
      let situation = '';
      for (const e of r.state.events) {
        if (e.type === 'transition') {
          situation = e.attack ? e.situation : '';
          openNext = situation === 'lane';
        } else if (e.type === 'transitionRead') openNext = e.read === 'defenderCommits';
        else if (e.type === 'shot') {
          if (situation && openNext && e.shotType === 'fastBreak') {
            open++;
            if (e.made) made++;
            if (e.zone !== 'restricted') paint++;
            if (e.chaseDown) chaseDowns++;
            else if (e.blockerId) otherBlocks++;
          }
          situation = '';
          openNext = false;
        }
      }
    }
    expect(open).toBeGreaterThan(500);
    expect(made / open).toBeGreaterThan(0.84);
    expect(made / open).toBeLessThan(0.93);
    // Always at the rim, and only ever blocked from behind, now and then.
    expect(paint).toBe(0);
    expect(otherBlocks).toBe(0);
    expect(chaseDowns).toBeGreaterThan(0);
    expect(chaseDowns / open).toBeLessThan(0.04);
  });
});
