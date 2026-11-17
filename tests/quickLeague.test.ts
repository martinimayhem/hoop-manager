// Slice 5a, the Quick League (SEASON_SPEC Part 2, R10.5, R11.2): one test per scenario.

import { describe, expect, it } from 'vitest';
import { composite, positionGroup } from '../src/engine/ratings';
import { createRng } from '../src/engine/rng';
import { simulateMatch } from '../src/engine/match';
import { aiGamePlan } from '../src/game/ai';
import { aiDraftPick } from '../src/game/ai';
import { GROUPS, MIN_PER_GROUP, ROSTER_SIZE, canPick } from '../src/game/draft';
import { LEAGUES, MIN_PER_POSITION, POOL_SIZE, leaguePool, type LeagueId } from '../src/game/league/leagues';
import {
  MATCHDAYS,
  SCOUT_MIN_HALF,
  autoDraftRest,
  canSignMinimum,
  completeMatchday,
  createLeague,
  createQuickLeague,
  finishDraft,
  humanGames,
  takeOver,
  humanSignMinimum,
  poolOf,
  fixtures,
  recordFrom,
  draftOf,
  draftTurn,
  humanPick,
  runAiPicks,
  scoutAccuracy,
  table,
  teamOf,
  type QuickLeague,
} from '../src/game/league/quickLeague';
import { listSlots, readSlot, writeSlot, SAVE_FORMAT, type SaveStorage } from '../src/game/league/saves';
import { doubleRoundRobin, longestRun } from '../src/game/league/schedule';
import { standings, type GameRecord } from '../src/game/league/standings';
import { nameSource } from '../src/game/names';
import { slug } from '../src/game/pool';
import { scoutAttr } from '../src/game/scouting';

/** A whole draft, the human picking as the AI would for him. */
function drafted(league: LeagueId, seed: number, humans = ['You']): QuickLeague {
  let q = runAiPicks(createQuickLeague(league, humans, seed));
  for (let turn = draftTurn(q); turn !== null; turn = draftTurn(q)) {
    const id = aiDraftPick(draftOf(q), turn, createRng(seed + q.draft.pickNo));
    q = humanPick(q, id!);
  }
  return q;
}

function memoryStorage(): SaveStorage & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v), removeItem: (k) => void delete data[k] };
}

describe('names (R10.5)', () => {
  it('WHEN 20,000 names are asked for THEN 20,000 different names and ids come back', () => {
    const taken = new Set<string>();
    const ids = new Set<string>();
    const make = nameSource(['Abe', 'Bo', 'Cal'], ['Hoopes', 'Rimsby', 'Tipton', 'Velvet'], 7, taken, ids, slug);
    const names = Array.from({ length: 20000 }, () => make());
    expect(new Set(names).size).toBe(20000);
    expect(new Set(names.map(slug)).size).toBe(20000);
  });
  it('WHEN it is called twice with the same seed THEN it returns the same names', () => {
    const run = () => {
      const make = nameSource(['Abe', 'Bo'], ['Hoopes', 'Rimsby'], 11, new Set(), new Set(), slug);
      return Array.from({ length: 9 }, () => make());
    };
    expect(run()).toEqual(run());
  });
});

describe('league pools (R2.1)', () => {
  for (const id of Object.keys(LEAGUES) as LeagueId[]) {
    it(`WHEN the ${id} pool is built THEN it has ${POOL_SIZE} unique players and at least ${MIN_PER_POSITION} per position`, () => {
      const pool = leaguePool(id);
      expect(pool.length).toBe(POOL_SIZE);
      expect(new Set(pool.map((p) => p.player.id)).size).toBe(POOL_SIZE);
      expect(new Set(pool.map((p) => p.player.name)).size).toBe(POOL_SIZE);
      for (const pos of ['PG', 'SG', 'SF', 'PF', 'C']) expect(pool.filter((p) => p.player.position === pos).length).toBeGreaterThanOrEqual(MIN_PER_POSITION);
    });
  }
  it('WHEN the same league is built twice THEN both pools are identical', () => {
    expect(leaguePool('pro').map((p) => p.player)).toEqual(leaguePool('pro').map((p) => p.player));
  });
  it('WHEN the player picks Pro THEN every team has a budget of 100', () => {
    const q = createQuickLeague('pro', ['You'], 1);
    expect(q.draft.teams.every((t) => t.budgetLeft === 100)).toBe(true);
  });
});

describe('snake draft for 8 teams (R2.2)', () => {
  for (const id of Object.keys(LEAGUES) as LeagueId[]) {
    it(`WHEN the ${id} draft ends THEN every team has 12 players, 2+ per group, within budget`, () => {
      const q = drafted(id, 42);
      expect(q.phase).toBe('season');
      const pool = new Map(leaguePool(id).map((p) => [p.player.id, p]));
      for (const t of q.draft.teams) {
        expect(t.picks.length).toBe(ROSTER_SIZE);
        expect(t.budgetLeft).toBeGreaterThanOrEqual(0);
        for (const g of GROUPS) expect(t.picks.filter((pid) => positionGroup(pool.get(pid)!.player.position) === g).length).toBeGreaterThanOrEqual(MIN_PER_GROUP);
      }
    });
  }
  it('WHEN 100 seeded drafts are run THEN the weakest team is within 6 points of the league average (top-8 overall)', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const q = drafted('pro', seed);
      const strength = q.teams.map((_, i) => {
        const overall = teamOf(q, i).players.map((p) => composite(p).overall).sort((a, b) => b - a);
        return overall.slice(0, 8).reduce((s, x) => s + x, 0) / 8;
      });
      const avg = strength.reduce((s, x) => s + x, 0) / strength.length;
      expect(avg - Math.min(...strength), `seed ${seed}`).toBeLessThanOrEqual(6);
    }
  }, 120_000);
  it('WHEN a human takes the three dearest players first THEN he can always still pick, and the draft finishes with every team full and within budget', () => {
    let q = runAiPicks(createQuickLeague('pro', ['You'], 21));
    for (let k = 0; k < 3; k++) {
      const d = draftOf(q);
      const dearest = d.pool.filter((p) => !(p.player.id in d.owner)).sort((a, b) => b.price - a.price);
      const id = dearest.find((p) => canPick(d, draftTurn(q)!, p.player.id).ok)!.player.id;
      q = humanPick(q, id);
    }
    // Then always the dearest he may take, or a minimum signing when nothing fits.
    for (let turn = draftTurn(q); turn !== null; turn = draftTurn(q)) {
      const d = draftOf(q);
      const ok = d.pool.filter((p) => canPick(d, turn, p.player.id).ok).sort((a, b) => b.price - a.price);
      expect(ok.length > 0 || canSignMinimum(q), `pick ${d.pickNo}`).toBe(true);
      q = ok.length ? humanPick(q, ok[0].player.id) : humanSignMinimum(q);
    }
    expect(q.phase).toBe('season');
    for (const t of q.draft.teams) {
      expect(t.picks.length).toBe(ROSTER_SIZE);
      expect(t.budgetLeft).toBeGreaterThanOrEqual(0);
    }
    expect(q.draft.log?.length).toBe(96);
  });
  it('WHEN a human auto-drafts the rest THEN his roster fills and the draft runs to the end', () => {
    const q = autoDraftRest(runAiPicks(createQuickLeague('legends', ['You'], 8)));
    expect(q.phase).toBe('season');
    expect(q.draft.teams[0].picks.length).toBe(ROSTER_SIZE);
  });
  it('WHEN a league with minimum signings is saved THEN it loads, its extra players included', () => {
    let q = runAiPicks(createQuickLeague('pro', ['You'], 30));
    q = humanSignMinimum(q);
    expect(q.draft.extras?.length).toBeGreaterThan(0);
    const st = memoryStorage();
    writeSlot(st, 0, q);
    const slot = readSlot(st, 0);
    expect(slot.status).toBe('ok');
    if (slot.status === 'ok') expect(poolOf(slot.data).length).toBe(POOL_SIZE + (q.draft.extras?.length ?? 0));
  });
  it('WHEN it is not a human pick THEN a human pick is refused', () => {
    const q = drafted('pro', 3);
    expect(() => humanPick(q, leaguePool('pro')[0].player.id)).toThrow();
  });
});

describe('schedule (R2.3)', () => {
  it('WHEN a schedule is made THEN 56 games, each pair twice (home and away), once per matchday, runs of at most 2', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = doubleRoundRobin(8, seed);
      expect(s.length).toBe(MATCHDAYS);
      expect(s.flat().length).toBe(56);
      for (const day of s) expect(new Set(day.flatMap((f) => [f.home, f.away])).size).toBe(8);
      const seen = new Set(s.flat().map((f) => `${f.home}-${f.away}`));
      for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) if (a !== b) expect(seen.has(`${a}-${b}`)).toBe(true);
      expect(longestRun(s, 8)).toBeLessThanOrEqual(2);
    }
  });
});

describe('table and tiebreakers (R2.5)', () => {
  const game = (matchday: number, home: number, away: number, hs: number, as: number): GameRecord => ({ matchday, home, away, seed: 0, score: [hs, as], overtime: false, lines: [[], []] });
  it('WHEN A and B are level on wins and A won both games between them THEN A ranks above B', () => {
    // A beats B twice, B beats C three times by a lot, A and C split: A and B both have 3 wins.
    const records = [game(0, 0, 1, 90, 80), game(1, 1, 0, 70, 75), game(2, 1, 2, 120, 60), game(3, 0, 2, 80, 79), game(4, 2, 0, 90, 70), game(5, 2, 1, 50, 100), game(6, 1, 2, 110, 60)];
    const t = standings(['a', 'b', 'c'], records);
    // A and B: 3 wins each; B has the better point difference overall, but A won the meetings.
    const a = t.findIndex((r) => r.team === 0);
    const b = t.findIndex((r) => r.team === 1);
    expect(t[a].won).toBe(t[b].won);
    expect(a).toBeLessThan(b);
  });
  it('WHEN the same results are entered in another order THEN the table is identical', () => {
    const records = [game(0, 0, 1, 90, 80), game(0, 2, 3, 70, 75), game(1, 1, 2, 88, 81), game(1, 3, 0, 60, 66), game(2, 0, 2, 70, 71), game(2, 1, 3, 99, 98)];
    expect(standings(['a', 'b', 'c', 'd'], [...records].reverse())).toEqual(standings(['a', 'b', 'c', 'd'], records));
  });
  it('WHEN a team wins 3 in a row THEN its streak is W3; WHEN the leader is 9-3 and a team 7-5 THEN it is 2 behind', () => {
    const rows = standings(['a', 'b'], [game(0, 0, 1, 1, 0), game(1, 0, 1, 1, 0), game(2, 0, 1, 1, 0)]);
    expect(rows[0].streak).toBe('W3');
    expect(rows[1].streak).toBe('L3');
    expect(rows[1].behind).toBe(3);
  });
});

describe('a whole season (R2.4)', () => {
  it('WHEN 14 matchdays are played THEN 56 games are recorded and the season is over; the same seed gives the same season', () => {
    const play = () => {
      let q = drafted('pro', 9);
      while (q.phase === 'season') q = completeMatchday(q);
      return q;
    };
    const a = play();
    expect(a.phase).toBe('finished');
    expect(a.records.length).toBe(56);
    expect(table(a).reduce((s, r) => s + r.played, 0)).toBe(112);
    expect(play().records).toEqual(a.records);
  }, 120_000);
});

describe('a live match recorded the right way round', () => {
  it('WHEN the human is the away team (side 0 of the live match) THEN the record still has the home score first', () => {
    const q = drafted('pro', 12);
    const f = fixtures(q)[0];
    const away = teamOf(q, f.away);
    const home = teamOf(q, f.home);
    const rng = createRng(1);
    // The away team on side 0, as a human away team plays it live.
    const result = simulateMatch(away, home, aiGamePlan(away, home, rng), aiGamePlan(home, away, rng), 77);
    const r = recordFrom(q.matchday, f, 77, result.state, [f.away, f.home]);
    expect(r.score).toEqual([result.state.teams[1].score, result.state.teams[0].score]);
    expect(r.lines[0].map((l) => l[0]).sort()).toEqual(home.players.map((p) => p.id).sort());
  }, 60_000);
});

describe('scouting improves as you meet teams (R2.6)', () => {
  it('WHEN the human meets a team a second time THEN its ranges are narrower, and never under 6 wide', () => {
    let q = drafted('pro', 5);
    const opp = (day: number) => {
      const f = q.schedule[day].find((x) => x.home === 0 || x.away === 0)!;
      return f.home === 0 ? f.away : f.home;
    };
    const target = opp(0);
    const before = scoutAccuracy(q, 0, target);
    q = completeMatchday(q);
    const after = scoutAccuracy(q, 0, target);
    expect(after).toBeGreaterThan(before);
    for (const p of teamOf(q, target).players) {
      const r = scoutAttr(p, 'three', 99, 0.99, SCOUT_MIN_HALF);
      expect(r.hi - r.lo).toBeGreaterThanOrEqual(6);
    }
  }, 60_000);
});

describe('saves (R11.2)', () => {
  it('WHEN a league is saved and the page reloads THEN it loads exactly as it was', () => {
    const st = memoryStorage();
    let q = drafted('street', 4);
    q = completeMatchday(q);
    expect(writeSlot(st, 0, q)).toBe(true);
    const slot = readSlot(st, 0);
    expect(slot.status).toBe('ok');
    if (slot.status === 'ok') expect(slot.data).toEqual(q);
  }, 60_000);
  it('WHEN a save is from a newer version THEN it is not loaded; WHEN one is unreadable THEN it is reported and the others still load', () => {
    const st = memoryStorage();
    writeSlot(st, 0, createQuickLeague('pro', ['You'], 1));
    st.data['hm.save.1'] = JSON.stringify({ format: SAVE_FORMAT + 1, kind: 'quick', savedAt: '', data: {} });
    st.data['hm.save.2'] = '{not json';
    const slots = listSlots(st);
    expect(slots.map((s) => s.status)).toEqual(['ok', 'newer', 'broken']);
  });
  it('WHEN a save names a player the game no longer has THEN the slot is incompatible', () => {
    const st = memoryStorage();
    const q = createQuickLeague('pro', ['You'], 1);
    writeSlot(st, 0, { ...q, draft: { ...q.draft, owner: { 'no-such-player': 0 } } });
    expect(readSlot(st, 0).status).toBe('incompatible');
  });
});

describe('a new game: choose the league, then the club', () => {
  it('WHEN a new league is made THEN all eight clubs have full, legal squads and the season is ready; the player takes over the club he chooses', () => {
    for (const id of ['street', 'pro', 'legends'] as LeagueId[]) {
      const q = createLeague(id, 11);
      expect(q.phase).toBe('season');
      expect(q.teams).toHaveLength(8);
      expect(q.teams.every((t) => t.human === null)).toBe(true);
      for (const t of q.draft.teams) expect(t.picks).toHaveLength(ROSTER_SIZE);
      const mine = takeOver(q, 5, 'Sam');
      expect(mine.teams.map((t) => t.human)).toEqual([null, null, null, null, null, 0, null, null]);
      expect(mine.manager).toBe('Sam');
      expect(humanGames(mine)).toHaveLength(1);
    }
  });
  it('WHEN an old save stopped mid-draft is opened THEN the computer finishes the draft, the player picks too', () => {
    const q = runAiPicks(createQuickLeague('pro', ['Old Club'], 3));
    expect(q.phase).toBe('draft');
    const done = finishDraft(q);
    expect(done.phase).toBe('season');
    for (const t of done.draft.teams) expect(t.picks).toHaveLength(ROSTER_SIZE);
  });
});
