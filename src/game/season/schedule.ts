// The regular season's schedules (slice brief W2a §1, WORLD_SPEC §1.1), each game on its day.
//
// - Big League (30 clubs, both conferences): 40 games each. Every club meets every other once (a
//   single round-robin, 29 rounds), plus 11 more against its own conference (Europe: a second
//   round-robin of its 12; America: 11 of the 17 rounds of its 18). 20 at home: a pair that meets
//   twice has one home game each; the single games are given home sides along an Euler circuit, so
//   every club has exactly as many at home as away.
// - US Divisions 2–4 (16): double round-robin, 30 games. National leagues (12): 22 games.
// Days (calendar.ts): Big League midweek, US divisions and national second tiers on Saturday, national
// first tiers (Portugal's one tier too) on Sunday, so a Big League Europe club never plays twice on a
// day and always has a day between games.

import { createRng, next } from '../../engine/rng';
import { doubleRoundRobin } from '../league/schedule';
import type { World } from '../world/types';
import { BIG_LEAGUE_LAST_WEEK, CUP_WEEKS, NATIONAL_LAST_WEEK, SAT, SUN, TUE, THU, US_LAST_WEEK, WED, dayOf, isBigLeagueDoubleWeek } from './calendar';
import { BIG_LEAGUE, type SeasonGame } from './types';

/** A small, stable hash for seeds. */
export function mix(...xs: number[]): number {
  let h = 2166136261;
  for (const x of xs) h = Math.imul(h ^ (x >>> 0), 16777619) ^ (h >>> 13);
  return h >>> 0;
}

/** A string's hash (competition ids into seeds). */
function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const rng = createRng(seed);
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next(rng) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The circle method: n - 1 rounds in which every pair of `ids` meets once (n even). */
function circle<T>(ids: readonly T[]): [T, T][][] {
  const n = ids.length;
  const ring = ids.slice(1);
  const rounds: [T, T][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const round: [T, T][] = [[ids[0], ring[0]]];
    for (let i = 1; i < n / 2; i++) round.push([ring[i], ring[n - 1 - i]]);
    rounds.push(round);
    ring.unshift(ring.pop()!);
  }
  return rounds;
}

/** Weekends of weeks 0..last that are not cup weekends. */
function weekends(last: number): number[] {
  return Array.from({ length: last + 1 }, (_, w) => w).filter((w) => !CUP_WEEKS.includes(w));
}

/** `count` of `slots`, spread evenly from the first to the last. */
function spread(slots: number[], count: number): number[] {
  if (count > slots.length) throw new Error('Not enough dates for the rounds');
  return Array.from({ length: count }, (_, i) => slots[Math.round((i * (slots.length - 1)) / Math.max(1, count - 1))]);
}

/** The Big League's 40 midweek days. */
export function bigLeagueDays(): number[] {
  const days: number[] = [];
  for (let w = 0; w <= BIG_LEAGUE_LAST_WEEK; w++) {
    if (isBigLeagueDoubleWeek(w)) days.push(dayOf(w, TUE), dayOf(w, THU));
    else days.push(dayOf(w, WED));
  }
  return days;
}

interface Pairing {
  a: string;
  b: string;
  round: number;
}

/**
 * Home sides for the Big League: a pair that meets twice has one home game each; the remaining
 * single games form a graph in which every club has an even number of games (18), so walking an
 * Euler circuit and putting the club the walk leaves at home gives each exactly half at home.
 */
function orientBigLeague(pairs: Pairing[], seed: number): { home: string; away: string; round: number }[] {
  const rng = createRng(seed);
  const key = (p: Pairing) => (p.a < p.b ? `${p.a}|${p.b}` : `${p.b}|${p.a}`);
  const byPair = new Map<string, Pairing[]>();
  for (const p of pairs) byPair.set(key(p), [...(byPair.get(key(p)) ?? []), p]);
  const out: { home: string; away: string; round: number }[] = [];
  const singles: Pairing[] = [];
  for (const games of byPair.values()) {
    if (games.length === 2) {
      const [first, second] = [...games].sort((x, y) => x.round - y.round);
      const aFirst = next(rng) < 0.5;
      out.push({ home: aFirst ? first.a : first.b, away: aFirst ? first.b : first.a, round: first.round });
      out.push({ home: aFirst ? first.b : first.a, away: aFirst ? first.a : first.b, round: second.round });
    } else singles.push(...games);
  }
  // Hierholzer's walk over the single games.
  const adj = new Map<string, number[]>();
  singles.forEach((p, i) => {
    adj.set(p.a, [...(adj.get(p.a) ?? []), i]);
    adj.set(p.b, [...(adj.get(p.b) ?? []), i]);
  });
  const used = new Array(singles.length).fill(false);
  const ptr = new Map<string, number>();
  for (const start of [...adj.keys()].sort()) {
    const stack: string[] = [start];
    while (stack.length) {
      const v = stack[stack.length - 1];
      const list = adj.get(v)!;
      let i = ptr.get(v) ?? 0;
      while (i < list.length && used[list[i]]) i++;
      ptr.set(v, i);
      if (i === list.length) {
        stack.pop();
        continue;
      }
      const e = list[i];
      used[e] = true;
      const p = singles[e];
      const to = p.a === v ? p.b : p.a;
      out.push({ home: v, away: to, round: p.round });
      stack.push(to);
    }
  }
  return out;
}

/** The Big League's 40 rounds: the single round-robin of all 30, then the conference games, spread among them. */
function bigLeague(w: World, seed: number): { home: string; away: string; day: number }[] {
  const america = w.competitions.find((c) => c.kind === 'bigLeague' && c.region === 'america');
  const europe = w.competitions.find((c) => c.kind === 'bigLeague' && c.region === 'europe');
  if (!america || !europe) return [];
  const all = shuffled([...america.clubs, ...europe.clubs], mix(seed, 1));
  const everyone = shuffled(circle(all), mix(seed, 2));
  const eu = circle(shuffled(europe.clubs, mix(seed, 3)));
  const am = shuffled(circle(shuffled(america.clubs, mix(seed, 4))), mix(seed, 5)).slice(0, eu.length);
  const extra = eu.map((r, i) => [...r, ...am[i]]);
  // Where the 11 conference rounds go among the 40: spread through the season.
  const total = everyone.length + extra.length;
  const extraAt = new Set(extra.map((_, i) => Math.round(((i + 0.5) * total) / extra.length)));
  const rounds: [string, string][][] = [];
  let e = 0;
  let r = 0;
  for (let i = 0; i < total; i++) rounds.push(extraAt.has(i) && e < extra.length ? extra[e++] : r < everyone.length ? everyone[r++] : extra[e++]);
  const pairs = rounds.flatMap((round, i) => round.map(([a, b]) => ({ a, b, round: i })));
  const days = bigLeagueDays();
  return orientBigLeague(pairs, mix(seed, 6)).map((g) => ({ home: g.home, away: g.away, day: days[g.round] }));
}

/** A double round-robin league, one round a week on `wd`, its rounds on these weeks. */
function league(clubs: string[], weeks: number[], wd: number, seed: number): { home: string; away: string; day: number }[] {
  const order = shuffled(clubs, mix(seed, 1));
  const rounds = doubleRoundRobin(order.length, mix(seed, 2));
  const at = spread(weeks, rounds.length);
  return rounds.flatMap((round, i) => round.map((f) => ({ home: order[f.home], away: order[f.away], day: dayOf(at[i], wd) })));
}

/** Every game of the regular season, in day order (then competition), with its seed. */
export function buildSchedule(w: World): SeasonGame[] {
  const base = mix(w.seed, w.season, 0x5ea5);
  const games: { comp: string; home: string; away: string; day: number }[] = [];
  for (const g of bigLeague(w, mix(base, 1))) games.push({ comp: BIG_LEAGUE, ...g });
  for (const c of w.competitions) {
    if (c.kind === 'usDivision') for (const g of league(c.clubs, weekends(US_LAST_WEEK), SAT, mix(base, hashOf(c.id)))) games.push({ comp: c.id, ...g });
    if (c.kind === 'nationalLeague') for (const g of league(c.clubs, weekends(NATIONAL_LAST_WEEK), c.tier === 1 ? SUN : SAT, mix(base, hashOf(c.id)))) games.push({ comp: c.id, ...g });
  }
  const compOrder = (id: string) => (id === BIG_LEAGUE ? '' : id);
  games.sort((a, b) => a.day - b.day || compOrder(a.comp).localeCompare(compOrder(b.comp)) || a.home.localeCompare(b.home));
  return games.map((g, id) => ({ id, ...g, seed: mix(base, 0x9a3e, id) }));
}
