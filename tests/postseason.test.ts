// The whole season and the next one (slice brief W2b §9): postseason formats, cups, the calendar,
// promotion and relegation, licences and wildcards, Key moments, and the same season from the same
// seed (also across a save in the postseason).

import { beforeAll, describe, expect, it } from 'vitest';
import { createWorld } from '../src/game/world/generate';
import { takeOver } from '../src/game/world/query';
import { memoryStore, readWorld, writeWorld } from '../src/game/world/saves';
import type { World } from '../src/game/world/types';
import { advance, inputFor, matchFor, plansFor, playOf, simulateInputs, startSeason, table } from '../src/game/season/play';
import { BL_AMERICA, BL_EUROPE, BL_FINAL, FF_FINAL, FF_SEMIS, cupEntries, cupsOf, homeOrder, tieScore, tierOf } from '../src/game/season/post';
import { LICENCE_WINDOW, movements, startNextSeason } from '../src/game/season/rollover';
import { playToNextStop, LIVE_FROM } from '../src/game/season/keymoments';
import { stepPossession } from '../src/engine/match';
import type { MatchState } from '../src/engine/types';
import type { SeasonGame, Tie } from '../src/game/season/types';

const start = () => {
  const w = createWorld(11);
  return startSeason(takeOver(w, w.competitions.find((c) => c.id === BL_EUROPE)!.clubs[0]));
};

let done: World;
let midPost: World | null = null;

beforeAll(async () => {
  done = (
    await advance(start(), simulateInputs, {
      mode: 'toEnd',
      // A snapshot in the middle of the postseason, for the save-and-load test.
      onDay: (w) => {
        if (!midPost && (playOf(w).ties ?? []).some((t) => t.comp === BL_AMERICA && t.round === 'r1')) midPost = w;
      },
    })
  ).w;
}, 300_000);

const ties = (comp: string, round?: string) => (playOf(done).ties ?? []).filter((t) => t.comp === comp && (!round || t.round === round));
const order = (comp: string) => table(done, comp).map((r) => r.club);
const gamesOf = (t: Tie) => t.games.map((id) => playOf(done).games[id]);
const played = (t: Tie) => gamesOf(t).filter((g) => !g.off);

describe('the postseason formats', () => {
  it('WHEN the Big League America ends THEN 1–6 go through, 7–10 play in (7 v 8, then its loser v the 9 v 10 winner), and best-of-7 rounds follow', () => {
    const o = order(BL_AMERICA);
    const pa = ties(BL_AMERICA, 'playin-a');
    expect(pa.map((t) => [t.a, t.b])).toEqual([
      [o[6], o[7]],
      [o[8], o[9]],
    ]);
    const pb = ties(BL_AMERICA, 'playin-b')[0];
    expect(new Set([pb.a, pb.b])).toEqual(new Set([pa[0].a === pa[0].winner ? pa[0].b : pa[0].a, pa[1].winner]));
    const r1 = ties(BL_AMERICA, 'r1');
    expect(r1).toHaveLength(4);
    const seeds = [...o.slice(0, 6), pa[0].winner, pb.winner];
    expect(r1.map((t) => [t.a, t.b])).toEqual([0, 1, 2, 3].map((i) => [seeds[i], seeds[7 - i]]));
    for (const t of [...r1, ...ties(BL_AMERICA, 'r2'), ...ties(BL_AMERICA, 'cf')]) {
      expect(t.bestOf).toBe(7);
      const wins = tieScore(playOf(done).games, t);
      expect(Math.max(...Object.values(wins))).toBe(4);
      expect(played(t).length).toBeGreaterThanOrEqual(4);
      expect(played(t).length).toBeLessThanOrEqual(7);
    }
    expect(ties(BL_AMERICA, 'r2')).toHaveLength(2);
    expect(ties(BL_AMERICA, 'cf')).toHaveLength(1);
  });

  it('WHEN a series is played THEN the better-placed club has the extra home game (2-2-1-1-1, 2-2-1, 1-1-1)', () => {
    expect(homeOrder(7)).toEqual([true, true, false, false, true, false, true]);
    expect(homeOrder(5)).toEqual([true, true, false, false, true]);
    expect(homeOrder(3)).toEqual([true, false, true]);
    for (const t of (playOf(done).ties ?? []).filter((x) => x.bestOf > 1)) {
      const want = homeOrder(t.bestOf);
      gamesOf(t).forEach((g, i) => expect(g.home).toBe(want[i] ? t.a : t.b));
    }
  });

  it('WHEN the Big League Europe ends THEN the same play-in, best-of-5 quarter-finals and a Final Four weekend of single games', () => {
    expect(ties(BL_EUROPE, 'playin-a')).toHaveLength(2);
    const qf = ties(BL_EUROPE, 'qf');
    expect(qf).toHaveLength(4);
    for (const t of qf) expect(t.bestOf).toBe(5);
    const ff = ties(BL_EUROPE, 'ff');
    expect(ff).toHaveLength(2);
    expect(ties(BL_EUROPE, 'ff-final')).toHaveLength(1);
    for (const t of [...ff, ...ties(BL_EUROPE, 'ff-final')]) expect(t.bestOf).toBe(1);
    // One venue: the Final Four's games are all at the host's arena when it plays.
    const games = [...ff, ...ties(BL_EUROPE, 'ff-final')].flatMap(gamesOf);
    expect(new Set(games.map((g) => g.day)).size).toBe(2);
  });

  it('WHEN both conference champions are known THEN the one-game Final, hosted by Europe in an even season', () => {
    const f = ties(BL_FINAL)[0];
    expect(f.bestOf).toBe(1);
    expect(f.a).toBe(done.season % 2 === 0 ? ties(BL_EUROPE, 'ff-final')[0].winner : ties(BL_AMERICA, 'cf')[0].winner);
    expect(gamesOf(f)[0].home).toBe(f.a);
    const known = Math.max(ties(BL_EUROPE, 'ff-final')[0].decided!, ties(BL_AMERICA, 'cf')[0].decided!);
    expect(gamesOf(f)[0].day).toBeGreaterThanOrEqual(known + 7);
  });

  it('WHEN a national first tier ends THEN the top 8: best-of-3 quarter- and semi-finals and a best-of-5 final after the Europe Final Four', () => {
    for (const c of done.competitions.filter((x) => x.kind === 'nationalLeague' && x.tier === 1)) {
      const o = order(c.id);
      const qf = ties(c.id, 'qf');
      expect(qf.map((t) => [t.a, t.b])).toEqual([0, 1, 2, 3].map((i) => [o[i], o[7 - i]]));
      for (const t of [...qf, ...ties(c.id, 'sf')]) expect(t.bestOf).toBe(3);
      const final = ties(c.id, 'final')[0];
      expect(final.bestOf).toBe(5);
      expect(gamesOf(final)[0].day).toBeGreaterThan(gamesOf(ties(BL_EUROPE, 'ff-final')[0])[0].day);
    }
  });

  it('WHEN a US division or national second tier ends THEN places 2–5 play single games, 2 v 5 and 3 v 4, then the final', () => {
    for (const c of done.competitions.filter((x) => x.kind === 'usDivision' || (x.kind === 'nationalLeague' && x.tier === 2))) {
      const o = order(c.id);
      expect(ties(c.id, 'promo').map((t) => [t.a, t.b])).toEqual([
        [o[1], o[4]],
        [o[2], o[3]],
      ]);
      const f = ties(c.id, 'promo-final')[0];
      expect(f.bestOf).toBe(1);
      expect(o.indexOf(f.a)).toBeLessThan(o.indexOf(f.b));
    }
  });
});

describe('cups', () => {
  it('WHEN the America Cup starts THEN the 4 weakest Division 4 clubs play 2 preliminary games, leaving 64', () => {
    const cup = cupsOf(done).find((c) => c.id === 'cup-america')!;
    expect(cup.clubs).toHaveLength(66);
    const prelim = ties('cup-america', 'prelim');
    expect(prelim).toHaveLength(2);
    for (const t of prelim) expect([tierOf(done, t.a), tierOf(done, t.b)]).toEqual([4, 4]);
    expect(ties('cup-america', 'r64')).toHaveLength(32);
    expect(ties('cup-america', 'r32')).toHaveLength(16);
  });

  it('WHEN a national cup starts THEN the 16 lowest play round 1 and the 8 best first-tier clubs join in the last 16; Portugal: 8 in round 1, the top 4 in the quarter-finals', () => {
    for (const cup of cupsOf(done).filter((c) => c.region === 'europe')) {
      const e = cupEntries(done, cup);
      if (cup.country === 'PT') {
        expect(e.first).toHaveLength(8);
        expect(e.joins.qf).toHaveLength(4);
        expect(ties(cup.id, 'cr1')).toHaveLength(4);
      } else {
        expect(cup.clubs).toHaveLength(24);
        expect(e.first).toHaveLength(16);
        expect(e.joins.r16).toHaveLength(8);
        for (const c of e.joins.r16) expect(tierOf(done, c)).toBe(1);
        expect(ties(cup.id, 'cr1')).toHaveLength(8);
        expect(ties(cup.id, 'r16')).toHaveLength(8);
      }
      expect(ties(cup.id, 'qf')).toHaveLength(4);
      expect(ties(cup.id, 'ff-final')).toHaveLength(1);
    }
  });

  it('WHEN a cup tie is drawn THEN the lower-tier club is at home', () => {
    for (const t of (playOf(done).ties ?? []).filter((x) => x.comp.startsWith('cup-') && !x.round.startsWith('ff'))) {
      const g = gamesOf(t)[0];
      expect(tierOf(done, g.home)).toBeGreaterThanOrEqual(tierOf(done, g.away));
    }
  });
});

describe('the calendar', () => {
  it('WHEN the whole season is laid out THEN no club plays twice on a day and every club has a day between games', () => {
    const byClub = new Map<string, number[]>();
    for (const g of playOf(done).games.filter((x) => !x.off)) for (const c of [g.home, g.away]) byClub.set(c, [...(byClub.get(c) ?? []), g.day]);
    for (const days of byClub.values()) {
      days.sort((a, b) => a - b);
      for (let i = 1; i < days.length; i++) expect(days[i] - days[i - 1]).toBeGreaterThanOrEqual(2);
    }
  });

  it('WHEN a Final Four weekend comes THEN its clubs have no league game that weekend', () => {
    const games = playOf(done).games.filter((g) => !g.off);
    for (const t of (playOf(done).ties ?? []).filter((x) => x.round === 'ff' && x.comp.startsWith('cup-'))) {
      for (const c of [t.a, t.b]) {
        const league = games.filter((g) => !g.stage && (g.home === c || g.away === c) && g.day >= FF_SEMIS - 1 && g.day <= FF_FINAL + 1);
        expect(league).toEqual([]);
      }
    }
  });
});

describe('the next season', () => {
  let next: World;
  beforeAll(() => {
    next = startNextSeason(done);
  });

  it('WHEN the season ends THEN the bottom 2 go down and the champion and playoff winner go up, every league keeps its size', () => {
    const m = movements(done);
    for (const c of next.competitions) {
      const want = c.id === BL_AMERICA ? 18 : c.id === BL_EUROPE ? 12 : c.kind === 'usDivision' ? 16 : 12;
      expect(c.clubs).toHaveLength(want);
    }
    const am = order(BL_AMERICA);
    for (const c of am.slice(-2)) expect(next.competitions.find((x) => x.id === 'us-division-2')!.clubs).toContain(c);
    const d2 = order('us-division-2');
    expect(next.competitions.find((x) => x.id === BL_AMERICA)!.clubs).toContain(d2[0]);
    expect(m.moves.filter((x) => x.up)).toHaveLength(m.moves.filter((x) => !x.up).length);
  });

  it('WHEN a licence club finishes bottom of its national league THEN it is not relegated, and Portugal stays one tier', () => {
    const m = movements(done);
    for (const mv of m.moves.filter((x) => !x.up)) expect(done.clubs.find((c) => c.id === mv.club)!.licence).not.toBe('licence');
    const pt = next.competitions.filter((c) => c.country === 'PT');
    expect(pt).toHaveLength(1);
    expect(new Set(pt[0].clubs)).toEqual(new Set(done.competitions.find((c) => c.country === 'PT')!.clubs));
  });

  it('WHEN a licence club has its third bottom-2 finish within 5 seasons THEN it loses the licence to the best wildcard club, and Big League Europe keeps 12', () => {
    const eu = order(BL_EUROPE);
    const lic = eu.slice(-2).find((c) => done.clubs.find((x) => x.id === c)!.licence === 'licence');
    if (!lic) return;
    const twoBefore = (w: World, seasons: number[]): World => ({ ...w, clubs: w.clubs.map((c) => (c.id === lic ? { ...c, bottomTwoSeasons: seasons, bottomTwoFinishes: seasons.length } : c)) });
    const struck = movements(twoBefore(done, [done.season - 1, done.season - 3]));
    expect(struck.licenceLost).toContain(lic);
    expect(struck.licenceWon).toHaveLength(struck.licenceLost.length);
    // Older finishes don't count: outside the last 5 seasons.
    const old = movements(twoBefore(done, [done.season - LICENCE_WINDOW, done.season - 3]));
    expect(old.licenceLost).not.toContain(lic);
    const after = startNextSeason(twoBefore(done, [done.season - 1, done.season - 3]));
    expect(after.clubs.find((c) => c.id === lic)!.licence).toBe(null);
    expect(after.competitions.find((c) => c.id === BL_EUROPE)!.clubs).toHaveLength(12);
    expect(after.clubs.filter((c) => c.licence === 'licence')).toHaveLength(10);
    expect(after.clubs.filter((c) => c.licence === 'wildcard')).toHaveLength(2);
  });

  it('WHEN wildcards are picked THEN national champions without a licence come first, then the best national-league records', () => {
    const m = movements(done);
    expect(m.wildcards).toHaveLength(2);
    const titles = done.competitions.filter((c) => c.kind === 'nationalLeague' && c.tier === 1).map((c) => m.champions[c.id]);
    const record = (c: string) => {
      const league = done.competitions.find((x) => x.kind === 'nationalLeague' && x.tier === 1 && x.clubs.includes(c))!;
      return table(done, league.id).find((r) => r.club === c)!;
    };
    const unlicensedTitles = titles.filter((c) => done.clubs.find((x) => x.id === c)!.licence !== 'licence').sort((a, b) => record(b).pct - record(a).pct || record(b).diff - record(a).diff);
    for (const c of unlicensedTitles.slice(0, 2)) expect(m.wildcards).toContain(c);
    // With fewer than 2 such champions, the rest are the best records among the others.
    if (unlicensedTitles.length < 2) expect(m.wildcards.slice(0, unlicensedTitles.length)).toEqual(unlicensedTitles);
    for (const c of m.wildcards) expect(next.clubs.find((x) => x.id === c)!.licence).toBe('wildcard');
  });

  it('WHEN the next season starts THEN new schedules, tables and stats start again, and the season is archived', () => {
    const p = playOf(next);
    expect(next.season).toBe(done.season + 1);
    expect(p.phase).toBe('before');
    expect(p.games.every((g) => !g.score)).toBe(true);
    expect(Object.keys(p.stats)).toEqual([]);
    const a = next.history![next.history!.length - 1];
    expect(a.season).toBe(done.season);
    expect(a.champions[BL_FINAL]).toBe(ties(BL_FINAL)[0].winner);
    expect(a.results.length).toBe(playOf(done).games.filter((g) => !g.off && g.score).length);
    const someone = Object.values(next.players).find((wp) => wp.career?.length)!;
    expect(someone.career![0].season).toBe(done.season);
  });
});

describe('Key moments', () => {
  it('WHEN no changes are made at the breaks THEN the match reaches the live part exactly as Simulate has it at that moment', () => {
    const w = start();
    for (const g of playOf(w).games.slice(0, 6) as SeasonGame[]) {
      const inp = inputFor(w, g);
      const plans = plansFor(inp);
      const km = matchFor(inp, plans);
      let stop = playToNextStop(km);
      while (stop.kind === 'break') stop = playToNextStop(km);
      // Simulate's match, stepped to the same moment.
      const sim: MatchState = matchFor(inp, plans);
      while (!sim.finished && !(sim.quarter >= 4 && sim.clock <= LIVE_FROM)) stepPossession(sim);
      if (stop.kind === 'final') while (!sim.finished) stepPossession(sim);
      expect(km.teams.map((t) => t.score)).toEqual(sim.teams.map((t) => t.score));
      expect(JSON.stringify(km.teams.map((t) => t.players))).toBe(JSON.stringify(sim.teams.map((t) => t.players)));
      expect(km.events.length).toBe(sim.events.length);
    }
  });
});

describe('the same seasons', () => {
  it('WHEN the same seed is played again THEN the same season', async () => {
    const again = (await advance(start(), simulateInputs, { mode: 'toEnd' })).w;
    expect(playOf(again).games.map((g) => [g.home, g.away, g.day, g.score ?? null, g.off ?? false])).toEqual(playOf(done).games.map((g) => [g.home, g.away, g.day, g.score ?? null, g.off ?? false]));
  }, 300_000);

  it('WHEN a career is saved in the postseason and loaded THEN it plays on identically', async () => {
    expect(midPost).not.toBeNull();
    const store = memoryStore();
    expect(await writeWorld(store, 0, midPost!)).toBe(true);
    const r = await readWorld(store, 0);
    if (r.status !== 'ok') throw new Error(r.status);
    const fromSave = (await advance(r.data, simulateInputs, { mode: 'toEnd' })).w;
    expect(playOf(fromSave).games.map((g) => g.score ?? null)).toEqual(playOf(done).games.map((g) => g.score ?? null));
    expect(playOf(fromSave).ties).toEqual(playOf(done).ties);
  }, 300_000);
});
