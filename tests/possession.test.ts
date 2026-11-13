// Statistical checks that tactics move outcomes in the direction the counter system promises.
// Each compares totals over many seeded games with only one setting changed.

import { describe, expect, it } from 'vitest';
import { HARBOR_HAMMERS, SKYLINE_SPARKS, mirrorTeam } from '../src/data/teams';
import { createMatch, makePlan, simulateMatch, type MatchResult } from '../src/engine/match';
import { playPossession } from '../src/engine/possession';
import { composite } from '../src/engine/ratings';
import { pressTurnoverChance } from '../src/engine/tactics';
import { createRng } from '../src/engine/rng';
import { DOUBLE_WORTH, aiGamePlan, bestDoubleTarget, doubleTeamWorth } from '../src/game/ai';
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

describe('double team', () => {
  const best = (t: Team) => [...t.players].sort((a, b) => composite(b).overall - composite(a).overall)[0];
  const weakStarter = (t: Team) => [...t.players].slice(0, 5).sort((a, b) => composite(a).overall - composite(b).overall)[0];
  const withAttrs = (t: Team, id: string, patch: Partial<Team['players'][number]['attrs']>): Team => ({
    ...mirrorTeam(t, 'MOD'),
    players: t.players.map((p) => (p.id === id ? { ...p, attrs: { ...p.attrs, ...patch } } : p)),
  });
  /** Points per 100 possessions `off` scores against `def`, with `def` doubling `target` or not. */
  const ortg = (off: Team, def: Team, target: string | null, games = 300) => {
    let pts = 0;
    let poss = 0;
    for (let seed = 1; seed <= games; seed++) {
      const r = simulateMatch(def, off, makePlan(def, { keyMatchup: target ? { kind: 'double', targetId: target } : { kind: 'none' } }), makePlan(off), seed);
      pts += r.state.teams[1].score;
      poss += r.state.teams[1].extras.possessions;
    }
    return (100 * pts) / poss;
  };
  const change = (off: Team, def: Team, target: string) => ortg(off, def, target) - ortg(off, def, null);

  it('pays against a scorer who cannot pass, among poor shooters', () => {
    const star = best(HARBOR_HAMMERS);
    const scorer = withAttrs(HARBOR_HAMMERS, star.id, { layup: 95, dunk: 95, shooting: 85, speed: 80, passing: 35, dribbling: 45, tactics: 45 });
    // Measured about -4.6 per 100 possessions.
    expect(change(scorer, mirrorTeam(SKYLINE_SPARKS, 'D'), star.id)).toBeLessThan(-2.5);
  }, 120000);

  it('costs against a playmaker among shooters, and against a player who is no threat', () => {
    const star = best(SKYLINE_SPARKS);
    const playmaker = withAttrs(SKYLINE_SPARKS, star.id, { passing: 95, dribbling: 92, tactics: 92, three: 90, shooting: 88 });
    // Measured about +2.9 and +3.4 per 100 possessions.
    expect(change(playmaker, mirrorTeam(HARBOR_HAMMERS, 'D'), star.id)).toBeGreaterThan(1.2);
    expect(change(HARBOR_HAMMERS, mirrorTeam(SKYLINE_SPARKS, 'D'), weakStarter(HARBOR_HAMMERS).id)).toBeGreaterThan(1.5);
  }, 120000);

  it('the AI and the assistant only double when it pays', () => {
    const star = best(HARBOR_HAMMERS);
    const scorer = withAttrs(HARBOR_HAMMERS, star.id, { layup: 95, dunk: 95, shooting: 85, speed: 80, passing: 35, dribbling: 45, tactics: 45 });
    const five = (t: Team) => [...t.players].sort((a, b) => composite(b).overall - composite(a).overall).slice(0, 5);
    expect(doubleTeamWorth(scorer.players.find((p) => p.id === star.id)!, five(scorer))).toBeGreaterThan(DOUBLE_WORTH);
    // Their playmaker among shooters, and anyone who is not their biggest threat: not worth it.
    expect(bestDoubleTarget(SKYLINE_SPARKS).worth).toBeLessThan(DOUBLE_WORTH);
    expect(doubleTeamWorth(weakStarter(HARBOR_HAMMERS), five(HARBOR_HAMMERS))).toBeLessThan(0);
    // The AI's plan against them follows.
    let doubles = 0;
    for (let i = 0; i < 20; i++) if (aiGamePlan(mirrorTeam(SKYLINE_SPARKS, 'D'), SKYLINE_SPARKS, createRng(i)).keyMatchup.kind === 'double') doubles++;
    expect(doubles).toBe(0);
    for (let i = 0; i < 20; i++) if (aiGamePlan(mirrorTeam(SKYLINE_SPARKS, 'D'), scorer, createRng(i)).keyMatchup.kind === 'double') doubles++;
    expect(doubles).toBeGreaterThan(10);
  });
});

describe('rebounds: where the ball goes decides who gets it', () => {
  /** Every rebound over many games, with the miss that led to it and the rebounder's position. */
  const sample = (() => {
    let rows: { offensive: boolean; long: boolean | undefined; zone: string; position: string; shooter: boolean; plan: string }[] | null = null;
    return () => {
      if (rows) return rows;
      rows = [];
      for (let seed = 0; seed < 200; seed++) {
        const home = seed % 2 === 0 ? HARBOR_HAMMERS : SKYLINE_SPARKS;
        const away = mirrorTeam(home, 'OPP');
        const offence = (['inside', 'three', 'balanced', 'pickAndRoll', 'fastBreak'] as const)[seed % 5];
        const r = simulateMatch(home, away, makePlan(home, { offence }), makePlan(away, {}), seed);
        const teams = [home, away];
        let miss: { zone: string; shooter: string } | null = null;
        for (const ev of r.state.events) {
          if (ev.type === 'shot' && !ev.made) miss = { zone: ev.zone, shooter: ev.shooterId };
          else if (ev.type === 'freeThrow' && !ev.made && !ev.technical) miss = { zone: 'ft', shooter: ev.shooterId };
          else if (ev.type === 'rebound' && miss) {
            const p = teams[ev.side].players.find((x) => x.id === ev.playerId)!;
            const land = (ev as { land?: { long: boolean } }).land;
            rows.push({ offensive: ev.offensive, long: land?.long, zone: miss.zone, position: p.position, shooter: ev.offensive && ev.playerId === miss.shooter, plan: ev.side === 0 ? offence : 'balanced' });
            miss = null;
          }
        }
      }
      return rows;
    };
  })();

  it('every rebound says where it came down: long or short', () => {
    const rows = sample();
    expect(rows.length).toBeGreaterThan(10000);
    expect(rows.filter((r) => r.long === undefined)).toEqual([]);
  }, 300000);

  it('about a quarter of misses are rebounded by the offence, as in the NBA', () => {
    const rows = sample().filter((r) => r.zone !== 'ft');
    const rate = rows.filter((r) => r.offensive).length / rows.length;
    console.log(`offensive rebound rate ${(rate * 100).toFixed(1)}%`);
    expect(rate).toBeGreaterThan(0.22);
    expect(rate).toBeLessThan(0.28);
  }, 300000);

  it('centres and power forwards get clearly the most rebounds', () => {
    const rows = sample();
    const by = (pos: string) => rows.filter((r) => r.position === pos).length;
    const counts = Object.fromEntries(['PG', 'SG', 'SF', 'PF', 'C'].map((p) => [p, by(p)]));
    console.log(JSON.stringify(counts));
    const wing = Math.max(counts.PG, counts.SG, counts.SF);
    expect(counts.C).toBeGreaterThan(wing * 1.4);
    expect(counts.PF).toBeGreaterThan(wing * 1.2);
  }, 300000);

  it('threes come off long, shots at the rim short; guards get the long ones', () => {
    const rows = sample();
    const longShare = (zones: string[]) => {
      const z = rows.filter((r) => zones.includes(r.zone));
      return z.filter((r) => r.long).length / z.length;
    };
    const threes = longShare(['corner3', 'aboveBreak3']);
    const inside = longShare(['restricted', 'paint']);
    const guardThrees = rows.filter((r) => (r.position === 'PG' || r.position === 'SG') && (r.zone === 'corner3' || r.zone === 'aboveBreak3'));
    const guardLong = guardThrees.filter((r) => r.long).length;
    console.log(JSON.stringify({ threesLong: threes.toFixed(2), insideLong: inside.toFixed(2), guardLongOffThrees: guardLong, guardShortOffThrees: guardThrees.length - guardLong }));
    expect(threes).toBeGreaterThan(0.45);
    expect(inside).toBeLessThan(0.2);
    expect(guardLong).toBeGreaterThan(guardThrees.length - guardLong);
  }, 300000);

  it('the shooter rarely gets his own long miss', () => {
    const rows = sample().filter((r) => r.long && r.offensive);
    const own = rows.filter((r) => r.shooter).length / rows.length;
    console.log(`own long misses ${(own * 100).toFixed(1)}% of long offensive rebounds`);
    expect(own).toBeLessThan(0.12);
  }, 300000);

  it('an Inside attack gets more offensive rebounds than a Three attack', () => {
    // The home side plays each attack in 40 of the 200 games; its offensive rebounds by attack.
    const rows = sample().filter((r) => r.offensive);
    const inside = rows.filter((r) => r.plan === 'inside').length;
    const three = rows.filter((r) => r.plan === 'three').length;
    console.log(JSON.stringify({ insideOreb: inside, threeOreb: three }));
    expect(inside).toBeGreaterThan(three);
  }, 300000);
});
