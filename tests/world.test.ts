// The career world, slice W1 (WORLD_SPEC §1, §2, §5, §10, §14): what a new world must look like.

import { describe, expect, it } from 'vitest';
import { positionGroup } from '../src/engine/ratings';
import { REGIONS } from '../src/game/league/leagues';
import { usesRealNickname } from '../src/game/league/realTeams';
import { createWorld, overall } from '../src/game/world/generate';
import { idOf, isFamousRealName, plainName } from '../src/game/world/names';
import { COLLEGES, PLACES, REAL_COLLEGES } from '../src/game/world/places';
import { leagueClubs, payroll, strength, takeOver } from '../src/game/world/query';
import { WORLD_FORMAT, encode, memoryStore, readWorld, writeWorld } from '../src/game/world/saves';
import { TIERS } from '../src/game/world/types';

const w = createWorld(7);
const players = Object.values(w.players);

describe('the world: two regions, four tiers, 16 clubs in every league', () => {
  it('WHEN a world is made THEN it has 128 clubs, 64 per region, 16 in each league, each in exactly one', () => {
    expect(w.clubs).toHaveLength(128);
    for (const r of REGIONS) {
      expect(w.clubs.filter((c) => c.region === r)).toHaveLength(64);
      for (const t of TIERS) expect(leagueClubs(w, r, t)).toHaveLength(16);
    }
    expect(new Set(w.clubs.map((c) => c.id)).size).toBe(128);
  });
  it('WHEN a world is made THEN American and European clubs never share a league, and each has its own currency', () => {
    for (const c of w.clubs) {
      expect(c.region === 'america' ? c.country === 'US' : c.country !== 'US').toBe(true);
      expect(c.currency).toBe(c.region === 'america' ? 'USD' : 'EUR');
    }
    const cities = (r: 'america' | 'europe') => new Set(PLACES[r].map((p) => p.city));
    for (const city of cities('america')) expect(cities('europe').has(city)).toBe(false);
  });
  it('WHEN the names are checked THEN no club has a real team\'s nickname, and names and abbreviations are all different', () => {
    expect(w.clubs.filter((c) => usesRealNickname(c.name)).map((c) => c.name)).toEqual([]);
    expect(new Set(w.clubs.map((c) => c.name)).size).toBe(128);
    expect(new Set(w.clubs.map((c) => c.abbr)).size).toBe(128);
  });
  it('WHEN the colleges are checked THEN there are 40 and none has a real Division I school\'s name', () => {
    const real = new Set(REAL_COLLEGES.split(';').map(plainName).filter(Boolean));
    expect(COLLEGES).toHaveLength(40);
    expect(COLLEGES.filter((c) => real.has(plainName(c.name)))).toEqual([]);
    expect(w.colleges.every((c) => c.players.length === 15)).toBe(true);
  });
});

describe('the people', () => {
  it('WHEN a world is made THEN it has about 2,850 people: 13 per club, about 200 free agents, 600 college and 384 academy players', () => {
    expect(w.clubs.every((c) => c.roster.length === 13)).toBe(true);
    expect(w.freeAgents).toHaveLength(200);
    expect(w.colleges.reduce((n, c) => n + c.players.length, 0)).toBe(600);
    expect(w.clubs.filter((c) => c.region === 'europe').every((c) => c.academy.length === 6)).toBe(true);
    expect(w.clubs.filter((c) => c.region === 'america').every((c) => c.academy.length === 0)).toBe(true);
    expect(players.length).toBe(128 * 13 + 200 + 600 + 64 * 6);
  });
  it('WHEN a world is made THEN every name and id is different, none is a well-known real player\'s, and ids follow the names', () => {
    expect(new Set(players.map((p) => p.p.name)).size).toBe(players.length);
    expect(new Set(players.map((p) => p.p.id)).size).toBe(players.length);
    expect(players.filter((p) => p.origin.kind !== 'star' && isFamousRealName(p.p.name))).toEqual([]);
    expect(players.filter((p) => p.origin.kind !== 'star' && p.p.id !== idOf(p.p.name))).toEqual([]);
  });
  it('WHEN a world is made THEN the 102 hand-made stars are all in the Big League, split evenly between the conferences', () => {
    const stars = players.filter((p) => p.origin.kind === 'star');
    expect(stars).toHaveLength(102);
    const clubOf = (id: string) => w.clubs.find((c) => c.id === id)!;
    expect(stars.every((s) => clubOf(s.club!).tier === 1)).toBe(true);
    const inAmerica = stars.filter((s) => clubOf(s.club!).region === 'america').length;
    expect(Math.abs(inAmerica - (102 - inAmerica))).toBeLessThanOrEqual(2);
  });
  it('WHEN a world is made THEN every squad has at least two guards, wings and bigs, and different shirt numbers', () => {
    for (const c of w.clubs) {
      const groups = c.roster.map((id) => positionGroup(w.players[id].p.position));
      for (const g of ['guard', 'wing', 'big'] as const) expect(groups.filter((x) => x === g).length).toBeGreaterThanOrEqual(2);
      expect(new Set(c.roster.map((id) => w.players[id].p.number)).size).toBe(13);
    }
  });
  it('WHEN a world is made THEN club players are 19 to 36, college players 18 to 22, academy players 15 to 18', () => {
    const age = (p: (typeof players)[number]) => w.season - p.born;
    for (const p of players) {
      if (p.status === 'club' && p.origin.kind !== 'star') expect(age(p)).toBeGreaterThanOrEqual(19);
      if (p.status === 'club') expect(age(p)).toBeLessThanOrEqual(36);
      if (p.status === 'college') expect(age(p) >= 18 && age(p) <= 22).toBe(true);
      if (p.status === 'academy') expect(age(p) >= 15 && age(p) <= 18).toBe(true);
    }
  });
  it('WHEN a world is made THEN nobody is past his ceiling, and the young have the most room to grow', () => {
    for (const p of players) expect(p.p.attrs.potential).toBeGreaterThanOrEqual(Math.round(overall(p)) - 1);
    const room = (lo: number, hi: number) => {
      const xs = players.filter((p) => w.season - p.born >= lo && w.season - p.born <= hi).map((p) => p.p.attrs.potential - overall(p));
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(room(15, 20)).toBeGreaterThan(room(27, 36) + 8);
  });
  it('WHEN a world is made THEN American clubs are mostly American, European clubs mostly European with some Americans', () => {
    const share = (region: 'america' | 'europe', f: (n: string) => boolean) => {
      const ps = w.clubs.filter((c) => c.region === region).flatMap((c) => c.roster.map((id) => w.players[id])).filter((p) => p.origin.kind !== 'star');
      return ps.filter((p) => f(p.nationality)).length / ps.length;
    };
    expect(share('america', (n) => n === 'US')).toBeGreaterThan(0.8);
    expect(share('europe', (n) => n !== 'US')).toBeGreaterThan(0.7);
    expect(share('europe', (n) => n === 'US')).toBeGreaterThan(0.1);
  });
});

describe('strength and money', () => {
  it('WHEN a world is made THEN each tier is clearly stronger than the one below, in both regions', () => {
    for (const r of REGIONS) {
      const avg = (t: 1 | 2 | 3 | 4) => leagueClubs(w, r, t).reduce((s, c) => s + strength(w, c), 0) / 16;
      expect(avg(1)).toBeGreaterThan(avg(2) + 4);
      expect(avg(2)).toBeGreaterThan(avg(3) + 3);
      expect(avg(3)).toBeGreaterThan(avg(4) + 3);
    }
  });
  it('WHEN a world is made THEN the two Big League conferences are about as strong as each other (America v Europe Finals)', () => {
    const conf = (r: 'america' | 'europe') => leagueClubs(w, r, 1).reduce((s, c) => s + strength(w, c), 0) / 16;
    expect(Math.abs(conf('america') - conf('europe'))).toBeLessThan(1);
  });
  it('WHEN a world is made THEN every club pays its squad within its wage budget, and budgets follow the tier', () => {
    for (const c of w.clubs) {
      expect(payroll(w, c)).toBeLessThanOrEqual(c.budget.wages);
      expect(c.roster.every((id) => (w.players[id].contract?.wage ?? 0) > 0)).toBe(true);
    }
    const median = (t: number) => {
      const b = w.clubs.filter((c) => c.region === 'america' && c.tier === t).map((c) => c.budget.wages).sort((a, b) => a - b);
      return b[8];
    };
    expect(median(1)).toBeGreaterThan(60e6);
    expect(median(2)).toBeGreaterThan(10e6);
    expect(median(4)).toBeLessThan(3e6);
  });
});

describe('the same seed, the same world; saves', () => {
  it('WHEN a world is made twice from the same seed THEN both are identical, and another seed gives another world', () => {
    expect(JSON.stringify(createWorld(7))).toBe(JSON.stringify(w));
    expect(JSON.stringify(createWorld(8))).not.toBe(JSON.stringify(w));
  });
  it('WHEN a world is made THEN it takes well under a second', () => {
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
    expect(r.summary).toMatchObject({ club: 'Kaunas Ambers', league: 'Big League · Europe', manager: 'Sam', season: 2026 });
    expect((await readWorld(store, 0)).status).toBe('empty');
  });
  it('WHEN a save is from a newer version, or broken THEN it is reported, never loaded', async () => {
    const store = memoryStore();
    await store.put(0, await encode({ format: WORLD_FORMAT + 1, kind: 'world', savedAt: '', summary: {}, data: { kind: 'world' } }));
    expect((await readWorld(store, 0)).status).toBe('newer');
    await store.put(1, new Uint8Array([0, 123, 34]));
    expect((await readWorld(store, 1)).status).toBe('broken');
    await store.put(2, await encode({ format: 1, kind: 'quick' }));
    expect((await readWorld(store, 2)).status).toBe('broken');
  });
  it('WHEN a career is saved THEN it is compressed to a few hundred kilobytes', async () => {
    const bytes = await encode({ format: WORLD_FORMAT, kind: 'world', savedAt: '', summary: {}, data: w });
    expect(bytes.length).toBeLessThan(600 * 1024);
  });
});
