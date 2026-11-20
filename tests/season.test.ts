// The regular season (slice brief W2a §6): schedules, tables, the same season from the same seed (also
// across a save), and season totals that add up to the box scores.

import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/game/world/generate';
import { takeOver } from '../src/game/world/query';
import { memoryStore, readWorld, writeWorld } from '../src/game/world/saves';
import type { World } from '../src/game/world/types';
import { FIBA_RULES, NBA_RULES } from '../src/engine/types';
import {
  advance,
  applyOutputs,
  boxOf,
  closeDay,
  humanGameToday,
  inputsToday,
  inputFor,
  outputFrom,
  playInput,
  nextDay,
  playOf,
  rulesFor,
  simulateInputs,
  standingsOf,
  startSeason,
  table,
} from '../src/game/season/play';
import { BIG_LEAGUE, STAT_KEYS, type SeasonGame } from '../src/game/season/types';
import { weekday } from '../src/game/season/calendar';

const base = createWorld(11);
const blEurope = base.competitions.find((c) => c.kind === 'bigLeague' && c.region === 'europe')!;
const blAmerica = base.competitions.find((c) => c.kind === 'bigLeague' && c.region === 'america')!;
const world = startSeason(takeOver(base, blEurope.clubs[0]));
const games = playOf(world).games;

const count = (xs: SeasonGame[], club: string) => xs.filter((g) => g.home === club || g.away === club);
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Plays `days` days from where the world is, every game simulated. */
async function playDays(w: World, days: number): Promise<World> {
  let cur = w;
  for (let i = 0; i < days; i++) {
    if (playOf(cur).phase === 'before') {
      cur = (await advance(cur, simulateInputs)).w;
      continue;
    }
    const inputs = inputsToday(cur);
    cur = closeDay(applyOutputs(cur, simulateInputs(inputs)));
    cur = nextDay(cur);
  }
  return cur;
}

describe('schedules', () => {
  it('WHEN the Big League is made THEN every club plays 40: every other club once, 11 more in its conference, 20 at home', () => {
    const bl = games.filter((g) => g.comp === BIG_LEAGUE);
    expect(bl).toHaveLength(600);
    const pairs = new Map<string, SeasonGame[]>();
    for (const g of bl) pairs.set(pairKey(g.home, g.away), [...(pairs.get(pairKey(g.home, g.away)) ?? []), g]);
    for (const club of [...blAmerica.clubs, ...blEurope.clubs]) {
      const mine = count(bl, club);
      expect(mine).toHaveLength(40);
      expect(mine.filter((g) => g.home === club)).toHaveLength(20);
      const conf = blAmerica.clubs.includes(club) ? blAmerica.clubs : blEurope.clubs;
      const others = [...blAmerica.clubs, ...blEurope.clubs].filter((c) => c !== club);
      // Every other club at least once; twice only inside the conference, and 11 such pairs.
      const twice = others.filter((o) => (pairs.get(pairKey(club, o))?.length ?? 0) === 2);
      expect(others.every((o) => (pairs.get(pairKey(club, o))?.length ?? 0) >= 1)).toBe(true);
      expect(others.every((o) => (pairs.get(pairKey(club, o))?.length ?? 0) <= 2)).toBe(true);
      expect(twice).toHaveLength(11);
      expect(twice.every((o) => conf.includes(o))).toBe(true);
      // A pair that meets twice: once at each club.
      for (const o of twice) expect(new Set(pairs.get(pairKey(club, o))!.map((g) => g.home)).size).toBe(2);
    }
  });

  it('WHEN the US divisions and national leagues are made THEN a double round-robin: 30 or 22 games, half at home, every pair home and away', () => {
    for (const c of base.competitions.filter((x) => x.kind === 'usDivision' || x.kind === 'nationalLeague')) {
      const mine = games.filter((g) => g.comp === c.id);
      const n = c.clubs.length;
      expect(mine).toHaveLength(n * (n - 1));
      for (const club of c.clubs) {
        expect(count(mine, club)).toHaveLength(c.kind === 'usDivision' ? 30 : 22);
        expect(mine.filter((g) => g.home === club)).toHaveLength(n - 1);
        for (const o of c.clubs.filter((x) => x !== club)) expect(mine.filter((g) => g.home === club && g.away === o)).toHaveLength(1);
      }
    }
  });

  it('WHEN the season is laid out THEN no club plays twice on a day, Big League games are midweek and the rest at the weekend', () => {
    const byClubDay = new Set<string>();
    for (const g of games) {
      for (const c of [g.home, g.away]) {
        const k = `${c}@${g.day}`;
        expect(byClubDay.has(k)).toBe(false);
        byClubDay.add(k);
      }
      const wd = weekday(g.day);
      if (g.comp === BIG_LEAGUE) expect([3, 4, 5]).toContain(wd);
      else expect([0, 1]).toContain(wd);
    }
  });

  it('WHEN a Big League Europe club plays both competitions THEN there is always at least a day between its games', () => {
    for (const club of blEurope.clubs) {
      const days = count(games, club)
        .map((g) => g.day)
        .sort((a, b) => a - b);
      expect(days.length).toBe(62);
      for (let i = 1; i < days.length; i++) expect(days[i] - days[i - 1]).toBeGreaterThanOrEqual(2);
    }
  });

  it('WHEN a game is played THEN national leagues use FIBA rules, US divisions NBA rules, and a Big League game its home club region', () => {
    const nat = games.find((g) => base.competitions.find((c) => c.id === g.comp)?.kind === 'nationalLeague')!;
    const us = games.find((g) => base.competitions.find((c) => c.id === g.comp)?.kind === 'usDivision')!;
    const inEurope = games.find((g) => g.comp === BIG_LEAGUE && blEurope.clubs.includes(g.home) && blAmerica.clubs.includes(g.away))!;
    const inAmerica = games.find((g) => g.comp === BIG_LEAGUE && blAmerica.clubs.includes(g.home) && blEurope.clubs.includes(g.away))!;
    expect(rulesFor(world, nat)).toEqual(FIBA_RULES);
    expect(rulesFor(world, us)).toEqual(NBA_RULES);
    expect(rulesFor(world, inEurope)).toEqual(FIBA_RULES);
    expect(rulesFor(world, inAmerica)).toEqual(NBA_RULES);
  });
});

describe('tables', () => {
  const g = (id: number, home: string, away: string, hs: number, as: number): SeasonGame => ({ id, comp: 'x', day: id, home, away, seed: 0, score: [hs, as] });

  it('WHEN games are played THEN wins and losses add up, and the order is by win %', () => {
    const played = [g(0, 'a', 'b', 90, 80), g(1, 'c', 'd', 70, 75), g(2, 'a', 'c', 88, 86), g(3, 'b', 'd', 99, 70)];
    const rows = standingsOf(['a', 'b', 'c', 'd'], played);
    expect(rows.reduce((s, r) => s + r.won, 0)).toBe(played.length);
    expect(rows.reduce((s, r) => s + r.lost, 0)).toBe(played.length);
    for (const r of rows) expect(r.won + r.lost).toBe(r.played);
    expect(rows[0].club).toBe('a');
    expect(rows.map((r) => r.pct)).toEqual([...rows.map((r) => r.pct)].sort((x, y) => y - x));
  });

  it('WHEN two clubs have the same win % THEN head-to-head decides before points difference', () => {
    // b beat a once; a has the far better points difference; both 1-1.
    const played = [g(0, 'b', 'a', 80, 79), g(1, 'a', 'c', 120, 60), g(2, 'd', 'b', 100, 50)];
    const rows = standingsOf(['a', 'b', 'c', 'd'], played);
    const order = rows.map((r) => r.club);
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('a'));
  });

  it('WHEN head-to-head is level THEN points difference decides', () => {
    const played = [g(0, 'a', 'b', 80, 70), g(1, 'b', 'a', 80, 70), g(2, 'a', 'c', 100, 60), g(3, 'b', 'd', 81, 80)];
    const rows = standingsOf(['a', 'b', 'c', 'd'], played);
    const order = rows.map((r) => r.club);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
  });

  it('WHEN a week has been played THEN every table adds up', async () => {
    const w = await playDays(world, 8);
    for (const c of w.competitions.filter((x) => x.kind !== 'cup')) {
      const rows = table(w, c.id);
      expect(rows).toHaveLength(c.clubs.length);
      for (const r of rows) expect(r.won + r.lost).toBe(r.played);
      if (c.kind !== 'bigLeague') expect(rows.reduce((s, r) => s + r.won, 0)).toBe(rows.reduce((s, r) => s + r.lost, 0));
    }
  });
});

describe('the same season', () => {
  it('WHEN the same seed is played twice THEN the same results', async () => {
    const a = await playDays(startSeason(takeOver(createWorld(11), blEurope.clubs[0])), 6);
    const b = await playDays(world, 6);
    expect(playOf(a).games.map((x) => x.score ?? null)).toEqual(playOf(b).games.map((x) => x.score ?? null));
  }, 60_000);

  it('WHEN a career is saved mid-season and loaded THEN it plays on identically', async () => {
    const half = await playDays(world, 5);
    const store = memoryStore();
    expect(await writeWorld(store, 0, half)).toBe(true);
    const loaded = await readWorld(store, 0);
    if (loaded.status !== 'ok') throw new Error('not loaded');
    const fromSave = await playDays(loaded.data, 4);
    const straight = await playDays(half, 4);
    expect(playOf(fromSave).games.map((x) => x.score ?? null)).toEqual(playOf(straight).games.map((x) => x.score ?? null));
    expect(playOf(fromSave).stats).toEqual(playOf(straight).stats);
  }, 60_000);

  it('WHEN Continue runs THEN it stops on the first day, then on your game day', async () => {
    const r1 = await advance(world, simulateInputs);
    expect(['firstDay', 'gameDay']).toContain(r1.stop);
    expect(playOf(r1.w).day).toBe(0);
    const r2 = r1.stop === 'gameDay' ? r1 : await advance(r1.w, simulateInputs);
    expect(r2.stop).toBe('gameDay');
    expect(humanGameToday(r2.w)).toBeTruthy();
  });
});

describe('season stats', () => {
  it('WHEN games are played THEN every player season totals equal the sum of his box score lines', async () => {
    const w = await playDays(world, 8);
    const p = playOf(w);
    const sums = new Map<string, number[]>();
    for (const g of p.games.filter((x) => x.score)) {
      // Kept box scores (yours), and the others played again from their seed: the same score.
      const box = boxOf(w, g) ?? outputFrom(g.id, playInput(inputFor(w, g))).sides;
      expect([box[0].lines, box[1].lines].map((ls) => ls.reduce((s, l) => s + (l[2] as number), 0))).toEqual(g.score);
      for (const side of box)
        for (const [id, ...nums] of side.lines) {
          const k = `${g.comp}|${id}`;
          const prev = sums.get(k) ?? new Array(STAT_KEYS.length + 1).fill(0);
          sums.set(
            k,
            prev.map((v, i) => (i === 0 ? v + (nums[0] > 0 ? 1 : 0) : v + nums[i - 1])),
          );
        }
    }
    let checked = 0;
    for (const [k, totals] of sums) {
      const [comp, id] = k.split('|');
      expect(p.stats[comp][id]).toEqual(totals);
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
  }, 60_000);

  it('WHEN a W1 save (format 1) is loaded THEN it gets its season', async () => {
    const store = memoryStore();
    const { encode } = await import('../src/game/world/saves');
    const w1 = takeOver(base, blAmerica.clubs[0]);
    await store.put(0, await encode({ format: 1, kind: 'world', savedAt: 'x', summary: {}, data: w1 }));
    const r = await readWorld(store, 0);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(playOf(r.data).phase).toBe('before');
    expect(playOf(r.data).games).toHaveLength(games.length);
  });
});
