// A double round-robin (SEASON_SPEC R2.3): every pair of teams meets once at home and once away;
// matchdays n..2n-2 mirror 1..n-1 with home and away swapped; nobody has more than 2 home or 2 away
// games in a row. Made by the circle method (one team fixed, the others turning round it), with the
// home sides chosen so no streak gets longer than two. Deterministic for a seed.

import { createRng, next } from '../../engine/rng';

export interface Fixture {
  home: number;
  away: number;
}

/** Matchdays, each a list of fixtures by team index. */
export type Schedule = Fixture[][];

/** The longest run of home (or away) games any team has. */
export function longestRun(schedule: Schedule, teams: number): number {
  let worst = 0;
  for (let t = 0; t < teams; t++) {
    let run = 0;
    let last: boolean | null = null;
    for (const day of schedule) {
      const f = day.find((x) => x.home === t || x.away === t);
      if (!f) continue;
      const home = f.home === t;
      run = home === last ? run + 1 : 1;
      last = home;
      worst = Math.max(worst, run);
    }
  }
  return worst;
}

/** The first half's pairings by the circle method, for `n` teams (n even), in a seeded order. */
function rounds(n: number, slots: number[]): [number, number][][] {
  const out: [number, number][][] = [];
  const ring = slots.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const round: [number, number][] = [[slots[0], ring[0]]];
    for (let i = 1; i < n / 2; i++) round.push([ring[i], ring[n - 1 - i]]);
    out.push(round);
    ring.unshift(ring.pop()!);
  }
  return out;
}

/**
 * A double round-robin for `n` teams (even). Tries seeded orders and home choices until no team has
 * more than 2 home or away games in a row across the whole season (the mirror included); a valid one
 * is found within a few tries for 8 teams.
 */
export function doubleRoundRobin(n: number, seed: number): Schedule {
  if (n % 2 !== 0 || n < 2) throw new Error('doubleRoundRobin: an even number of teams');
  const rng = createRng(seed);
  for (let attempt = 0; attempt < 5000; attempt++) {
    const slots = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(next(rng) * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    // Home sides, round by round: whoever has been away more lately is at home, ties by a coin.
    const lastHome: (boolean | null)[] = Array(n).fill(null);
    const runs: number[] = Array(n).fill(0);
    const first: Fixture[][] = rounds(n, slots).map((round) =>
      round.map(([a, b]) => {
        const aWants = lastHome[a] === false ? runs[a] : lastHome[a] === true ? -runs[a] : 0;
        const bWants = lastHome[b] === false ? runs[b] : lastHome[b] === true ? -runs[b] : 0;
        const aHome = aWants !== bWants ? aWants > bWants : next(rng) < 0.5;
        const f = aHome ? { home: a, away: b } : { home: b, away: a };
        for (const [t, h] of [[f.home, true], [f.away, false]] as const) {
          runs[t] = lastHome[t] === h ? runs[t] + 1 : 1;
          lastHome[t] = h;
        }
        return f;
      }),
    );
    const schedule = [...first, ...first.map((day) => day.map((f) => ({ home: f.away, away: f.home })))];
    if (longestRun(schedule, n) <= 2) return schedule;
  }
  throw new Error('doubleRoundRobin: no schedule found');
}
