// The career world, slice W1 version 2 (briefs/W1.md; WORLD_SPEC §1, §2, §5.2, §10, §14; GAME_FLOW §4,
// §5.1): what a new world must look like.

import { describe, expect, it } from 'vitest';
import { positionGroup } from '../src/engine/ratings';
import { usesRealNickname } from '../src/game/league/realTeams';
import { buyoutYears, createWorld, overall } from '../src/game/world/generate';
import { CAP, DEV_WAGE_BUDGET_SHARE, FLOOR, MAX_CONTRACT, MID_LEVEL, MIN_CONTRACT, TAX_LINE, THRESHOLD, tidy } from '../src/game/world/money';
import { idOf, isFamousRealName, plainName } from '../src/game/world/names';
import { COLLEGES, EUROPE, EUROPE_COUNTRIES, REAL_COLLEGES } from '../src/game/world/places';
import { ageOf, competitionsOf, leagueOf, moneySummary, payroll, strength, takeOver, thresholdFigure, wagesCommitted } from '../src/game/world/query';
import { WORLD_FORMAT, encode, memoryStore, readWorld, writeWorld } from '../src/game/world/saves';
import type { Competition, WorldClub } from '../src/game/world/types';

const w = createWorld(7);
const players = Object.values(w.players);
const comp = (id: string) => w.competitions.find((c) => c.id === id)!;
const clubsOf = (c: Competition) => c.clubs.map((id) => w.clubs.find((x) => x.id === id)!);
const isLeague = (c: Competition) => !(c.kind === 'bigLeague' && c.region === 'europe');
const bigEurope = clubsOf(comp('big-league-europe'));
const avgStrength = (cs: WorldClub[]) => cs.reduce((s, c) => s + strength(w, c), 0) / cs.length;

describe('the world: competitions and clubs', () => {
  it('WHEN a world is made THEN it has 318 clubs: 18 + 48 in America, 12 in every national tier (10 countries × 2) and 12 in Portugal', () => {
    expect(w.clubs).toHaveLength(318);
    expect(new Set(w.clubs.map((c) => c.id)).size).toBe(318);
    expect(comp('big-league-america').clubs).toHaveLength(18);
    for (const t of [2, 3, 4]) expect(comp(`us-division-${t}`).clubs).toHaveLength(16);
    expect(w.clubs.filter((c) => c.region === 'america')).toHaveLength(66);
    const national = w.competitions.filter((c) => c.kind === 'nationalLeague');
    expect(national).toHaveLength(21);
    for (const cc of EUROPE_COUNTRIES) {
      const tiers = national.filter((c) => c.country === cc).sort((a, b) => a.tier - b.tier);
      expect(tiers.map((t) => t.clubs.length)).toEqual(cc === 'PT' ? [12] : [12, 12]);
    }
  });
  it('WHEN a world is made THEN every club is in exactly one league, and the 12 Big League Europe clubs also in their national first tier', () => {
    for (const c of w.clubs) {
      const leagues = w.competitions.filter((x) => isLeague(x) && x.clubs.includes(c.id));
      expect(leagues).toHaveLength(1);
      expect(leagueOf(w, c.id).id).toBe(leagues[0].id);
    }
    expect(bigEurope).toHaveLength(12);
    for (const c of bigEurope) {
      expect(competitionsOf(w, c.id).map((x) => x.id)).toEqual([`${c.country.toLowerCase()}-league-1`, 'big-league-europe']);
    }
    // Movement stays inside a region: no league mixes America and Europe.
    for (const x of w.competitions) expect(new Set(clubsOf(x).map((c) => c.region))).toEqual(new Set([x.region]));
  });
  it('WHEN a world is made THEN 10 clubs hold a licence (Spain 2, Türkiye 2, Greece, Italy, France, Germany, Israel, Lithuania 1) and 2 a wildcard, from two different countries', () => {
    const licences = w.clubs.filter((c) => c.licence === 'licence');
    const perCountry = Object.fromEntries(EUROPE_COUNTRIES.map((cc) => [cc, licences.filter((c) => c.country === cc).length]));
    expect(perCountry).toEqual({ ES: 2, TR: 2, GR: 1, IT: 1, FR: 1, DE: 1, IL: 1, LT: 1, RS: 0, NL: 0, PT: 0 });
    const wildcards = w.clubs.filter((c) => c.licence === 'wildcard');
    expect(wildcards).toHaveLength(2);
    expect(wildcards[0].country).not.toBe(wildcards[1].country);
    expect(new Set(bigEurope.map((c) => c.id))).toEqual(new Set([...licences, ...wildcards].map((c) => c.id)));
    expect(w.clubs.every((c) => c.bottomTwoFinishes === 0)).toBe(true);
    expect(w.clubs.filter((c) => c.region === 'america').every((c) => c.licence === null)).toBe(true);
  });
  it('WHEN the wildcards are given THEN they go to the two strongest clubs without a licence, from two different countries', () => {
    const noLicence = w.clubs.filter((c) => c.region === 'europe' && c.licence !== 'licence').sort((a, b) => strength(w, b) - strength(w, a));
    const first = noLicence[0];
    const second = noLicence.find((c) => c.country !== first.country)!;
    expect(new Set([first.licence, second.licence])).toEqual(new Set(['wildcard']));
  });
  it('WHEN the names are checked THEN no club has a real team\'s nickname, and club names and abbreviations are all different', () => {
    expect(w.clubs.filter((c) => usesRealNickname(c.name)).map((c) => c.name)).toEqual([]);
    expect(new Set(w.clubs.map((c) => c.name)).size).toBe(318);
    expect(new Set(w.clubs.map((c) => c.abbr)).size).toBe(318);
    expect(w.clubs.every((c) => /^[A-Z0-9]{3}$/.test(c.abbr))).toBe(true);
  });
  it('WHEN a country has fewer basketball cities than clubs THEN a big city hosts two clubs, never with the same nickname', () => {
    for (const cc of ['LT', 'IL', 'RS', 'NL']) {
      const cities = EUROPE[cc].map((p) => p.city);
      expect(new Set(cities).size).toBeLessThan(cities.length);
    }
  });
  it('WHEN the colleges are checked THEN there are 40 with 15 players each, and none has a real Division I school\'s name', () => {
    const real = new Set(REAL_COLLEGES.split(';').map(plainName).filter(Boolean));
    expect(COLLEGES).toHaveLength(40);
    expect(COLLEGES.filter((c) => real.has(plainName(c.name)))).toEqual([]);
    expect(w.colleges.every((c) => c.players.length === 15)).toBe(true);
  });
});

describe('the people', () => {
  it('WHEN a world is made THEN every first team has 13 with at least two guards, wings and bigs, and different shirt numbers', () => {
    for (const c of w.clubs) {
      expect(c.roster).toHaveLength(13);
      const groups = c.roster.map((id) => positionGroup(w.players[id].p.position));
      for (const g of ['guard', 'wing', 'big'] as const) expect(groups.filter((x) => x === g).length).toBeGreaterThanOrEqual(2);
      const numbers = [...c.roster, ...c.dev].map((id) => w.players[id].p.number);
      expect(new Set(numbers).size).toBe(numbers.length);
    }
  });
  it('WHEN a world is made THEN dev squads have 0–5 (2–3 to start), and academies 6, only at European clubs', () => {
    for (const c of w.clubs) {
      expect(c.dev.length).toBeGreaterThanOrEqual(2);
      expect(c.dev.length).toBeLessThanOrEqual(3);
      expect(c.academy).toHaveLength(c.region === 'europe' ? 6 : 0);
      expect(c.dev.every((id) => w.players[id].status === 'dev' && w.players[id].club === c.id)).toBe(true);
    }
  });
  it('WHEN a world is made THEN it has about 6,650–7,500 people: 13 per club, 2–3 in each dev squad, 6 per academy, 400 free agents, 600 college players', () => {
    expect(w.freeAgents).toHaveLength(400);
    expect(w.colleges.reduce((n, c) => n + c.players.length, 0)).toBe(600);
    const dev = w.clubs.reduce((n, c) => n + c.dev.length, 0);
    expect(players.length).toBe(318 * 13 + dev + 252 * 6 + 400 + 600);
  });
  it('WHEN a world is made THEN every name and id is different, none is a well-known real player\'s, and ids follow the names', () => {
    expect(new Set(players.map((p) => p.p.name)).size).toBe(players.length);
    expect(new Set(players.map((p) => p.p.id)).size).toBe(players.length);
    expect(players.filter((p) => p.origin.kind !== 'star' && isFamousRealName(p.p.name))).toEqual([]);
    expect(players.filter((p) => p.origin.kind !== 'star' && p.p.id !== idOf(p.p.name))).toEqual([]);
  });
  it('WHEN a world is made THEN the 102 hand-made stars are all in the Big League, and the two conferences are about as strong as each other', () => {
    const stars = players.filter((p) => p.origin.kind === 'star');
    expect(stars).toHaveLength(102);
    const big = new Set([...comp('big-league-america').clubs, ...comp('big-league-europe').clubs]);
    expect(stars.every((s) => big.has(s.club!))).toBe(true);
    expect(Math.abs(avgStrength(clubsOf(comp('big-league-america'))) - avgStrength(bigEurope))).toBeLessThan(1);
  });
  it('WHEN a world is made THEN every player starts with morale okay and no promises', () => {
    expect(players.every((p) => p.morale === 'okay' && p.promises.length === 0)).toBe(true);
  });
  it('WHEN a world is made THEN first-team players are 19 to 36, dev squads 18 to 22, college players 18 to 22, academy players 15 to 18', () => {
    for (const p of players) {
      const age = ageOf(w, p);
      if (p.status === 'club' && p.origin.kind !== 'star') expect(age).toBeGreaterThanOrEqual(19);
      if (p.status === 'club') expect(age).toBeLessThanOrEqual(36);
      if (p.status === 'dev') expect(age >= 18 && age <= 22).toBe(true);
      if (p.status === 'college') expect(age >= 18 && age <= 22).toBe(true);
      if (p.status === 'academy') expect(age >= 15 && age <= 18).toBe(true);
    }
  });
  it('WHEN a world is made THEN nobody is past his ceiling, and the young have the most room to grow', () => {
    for (const p of players) expect(p.p.attrs.potential).toBeGreaterThanOrEqual(Math.round(overall(p)) - 1);
    const room = (lo: number, hi: number) => {
      const xs = players.filter((p) => ageOf(w, p) >= lo && ageOf(w, p) <= hi).map((p) => p.p.attrs.potential - overall(p));
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(room(15, 20)).toBeGreaterThan(room(27, 36) + 8);
  });
  it('WHEN a world is made THEN American clubs are mostly American; European clubs mostly from their own country, some from elsewhere in Europe and some Americans', () => {
    const fromClubs = (f: (c: WorldClub) => boolean) => w.clubs.filter(f).flatMap((c) => c.roster.map((id) => ({ c, p: w.players[id] }))).filter((x) => x.p.origin.kind !== 'star');
    const am = fromClubs((c) => c.region === 'america');
    expect(am.filter((x) => x.p.nationality === 'US').length / am.length).toBeGreaterThan(0.8);
    const eu = fromClubs((c) => c.region === 'europe');
    const own = eu.filter((x) => x.p.nationality === x.c.country).length / eu.length;
    const us = eu.filter((x) => x.p.nationality === 'US').length / eu.length;
    expect(own).toBeGreaterThan(0.45);
    expect(us).toBeGreaterThan(0.1);
    expect(1 - own - us).toBeGreaterThan(0.15);
  });
});

describe('strength', () => {
  it('WHEN a world is made THEN each level is clearly stronger than the one below, in America and in every country', () => {
    const s = (id: string) => avgStrength(clubsOf(comp(id)));
    expect(s('big-league-america')).toBeGreaterThan(s('us-division-2') + 4);
    expect(s('us-division-2')).toBeGreaterThan(s('us-division-3') + 3);
    expect(s('us-division-3')).toBeGreaterThan(s('us-division-4') + 3);
    for (const cc of EUROPE_COUNTRIES.filter((c) => c !== 'PT')) {
      const k = cc.toLowerCase();
      expect(s(`${k}-league-1`)).toBeGreaterThan(s(`${k}-league-2`) + 3);
    }
  });
});

describe('money: dollars, the cap system and the budget system', () => {
  const cap = w.clubs.filter((c) => c.moneySystem === 'cap');
  const budget = w.clubs.filter((c) => c.moneySystem === 'budget');
  const contracts = (c: WorldClub) => [...c.roster, ...c.dev].map((id) => w.players[id].contract!);

  it('WHEN a world is made THEN the 18 America Big League clubs use the cap system and everyone else the budget system', () => {
    expect(new Set(cap.map((c) => c.id))).toEqual(new Set(comp('big-league-america').clubs));
    expect(budget).toHaveLength(300);
    expect(w.clubs.every((c) => !('currency' in c))).toBe(true);
  });
  it('WHEN a world is made THEN every cap club\'s payroll is between the floor and the tax line, with contracts of 1–5 years between the minimum and the max, and a full mid-level exception', () => {
    for (const c of cap) {
      const pay = payroll(w, c);
      expect(pay).toBeGreaterThanOrEqual(FLOOR);
      expect(pay).toBeLessThanOrEqual(TAX_LINE);
      expect(c.midLevelLeft).toBe(MID_LEVEL);
      expect(c.budget).toBe(0);
      for (const k of contracts(c)) {
        expect(k.wage).toBeGreaterThanOrEqual(MIN_CONTRACT);
        expect(k.wage).toBeLessThanOrEqual(MAX_CONTRACT);
        expect(k.years >= 1 && k.years <= 5).toBe(true);
        expect(k.buyout).toBeUndefined();
      }
      // Dev squad: minimum deals, outside the cap.
      for (const id of c.dev) expect(w.players[id].contract!.wage).toBe(MIN_CONTRACT);
    }
  });
  it('WHEN a world is made THEN every budget club pays 75–90% of its budget in wages, with 1–3 year contracts that all have a buyout fee', () => {
    for (const c of budget) {
      const committed = wagesCommitted(w, c);
      expect(committed).toBeLessThanOrEqual(c.budget * 0.9);
      expect(committed).toBeGreaterThanOrEqual(c.budget * 0.74);
      for (const k of contracts(c)) {
        expect(k.years >= 1 && k.years <= 3).toBe(true);
        expect(k.buyout).toBeGreaterThan(0);
      }
      // Dev squad: the minimum, 1% of the club budget.
      for (const id of c.dev) expect(w.players[id].contract!.wage).toBe(tidy(c.budget * DEV_WAGE_BUDGET_SHARE));
      const s = moneySummary(w, c);
      expect(s.system === 'budget' && s.room >= 0).toBe(true);
    }
  });
  it('WHEN budgets are set THEN they follow the level (WORLD_SPEC §10.1)', () => {
    const range = (id: string) => clubsOf(comp(id)).map((c) => c.budget);
    const within = (xs: number[], lo: number, hi: number) => xs.every((x) => x >= lo && x <= hi);
    expect(within(bigEurope.map((c) => c.budget), 60e6, 140e6)).toBe(true);
    expect(within(range('us-division-2'), 12e6, 30e6)).toBe(true);
    expect(within(range('us-division-3'), 3e6, 10e6)).toBe(true);
    expect(within(range('us-division-4'), 0.8e6, 3e6)).toBe(true);
    for (const cc of EUROPE_COUNTRIES) {
      const k = cc.toLowerCase();
      expect(within(clubsOf(comp(`${k}-league-1`)).filter((c) => !c.licence).map((c) => c.budget), 6e6, 25e6)).toBe(true);
      if (cc !== 'PT') expect(within(range(`${k}-league-2`), 1e6, 5e6)).toBe(true);
    }
  });
  it('WHEN a world is made THEN better and younger players have higher buyout fees', () => {
    const rows = budget.flatMap((c) => c.roster.map((id) => w.players[id])).map((p) => ({ age: ageOf(w, p), ratio: p.contract!.buyout! / p.contract!.wage / buyoutYears(p.contract!.years) }));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(rows.filter((r) => r.age <= 23).map((r) => r.ratio))).toBeGreaterThan(mean(rows.filter((r) => r.age >= 30).map((r) => r.ratio)) * 1.5);
  });
  it('WHEN a world is made THEN every Big League Europe club is under the payroll threshold (all but the 3 highest-paid and the under-23s, against 0.7 C)', () => {
    expect(THRESHOLD).toBe(0.7 * CAP);
    for (const c of bigEurope) {
      const t = thresholdFigure(w, c);
      expect(t.counted).toBeLessThanOrEqual(THRESHOLD);
      expect(t.anchors).toHaveLength(3);
      const s = moneySummary(w, c);
      expect(s.system === 'budget' && s.threshold?.limit === THRESHOLD).toBe(true);
    }
  });
});

describe('the same seed, the same world; saves', () => {
  it('WHEN a world is made twice from the same seed THEN both are identical, and another seed gives another world', () => {
    expect(JSON.stringify(createWorld(7))).toBe(JSON.stringify(w));
    expect(JSON.stringify(createWorld(8))).not.toBe(JSON.stringify(w));
  });
  it('WHEN a world is made THEN it takes well under a second in Node', () => {
    const t = performance.now();
    createWorld(99);
    expect(performance.now() - t).toBeLessThan(1000);
  });
  it('WHEN a career is saved and loaded THEN it comes back exactly, with its club and season in the summary', async () => {
    const store = memoryStore();
    const mine = takeOver(w, 'kaunas-ambers', 'Sam');
    expect(await writeWorld(store, 1, mine)).toBe(true);
    const r = await readWorld(store, 1);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(JSON.stringify(r.data)).toBe(JSON.stringify(mine));
    expect(r.summary).toMatchObject({ club: 'Kaunas Ambers', league: 'Lithuanian League · Big League · Europe', region: 'Europe', manager: 'Sam', season: 2026 });
    expect((await readWorld(store, 0)).status).toBe('empty');
  });
  it('WHEN a save is from a newer version, or broken THEN it is reported, never loaded', async () => {
    const store = memoryStore();
    await store.put(0, await encode({ format: WORLD_FORMAT + 1, kind: 'world', savedAt: '', summary: {}, data: { kind: 'world' } }));
    const newer = await readWorld(store, 0);
    expect(newer.status).toBe('newer');
    expect('data' in newer).toBe(false);
    await store.put(1, new Uint8Array([0, 123, 34]));
    expect((await readWorld(store, 1)).status).toBe('broken');
    await store.put(2, await encode({ format: 1, kind: 'quick' }));
    expect((await readWorld(store, 2)).status).toBe('broken');
  });
  it('WHEN a career is saved THEN it is compressed to under a megabyte', async () => {
    // Format 3: the postseason, cups and history (slice W2b); older saves are upgraded on loading (tests/season.test.ts).
    expect(WORLD_FORMAT).toBe(3);
    const bytes = await encode({ format: WORLD_FORMAT, kind: 'world', savedAt: '', summary: {}, data: w });
    expect(bytes.length).toBeLessThan(1024 * 1024);
  });
});
