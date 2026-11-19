// Club names (SEASON_SPEC R3.2): real cities, invented nicknames, never a real team's. And America and
// Europe never share a league (WORLD_SPEC §1.2).

import { describe, expect, it } from 'vitest';
import { LEAGUES, REGIONS } from '../src/game/league/leagues';
import { createLeague } from '../src/game/league/quickLeague';
import { usesRealNickname } from '../src/game/league/realTeams';
import { AMERICA, EUROPE } from '../src/game/world/places';

const lists = () => Object.values(LEAGUES).flatMap((l) => REGIONS.map((r) => ({ league: l.id, region: r, teams: l.teams[r] })));

describe('club names', () => {
  it("WHEN the club list is checked THEN no nickname is a real team's (case and spaces ignored)", () => {
    const clubs = lists().flatMap((l) => l.teams.map((t) => t.name));
    expect(clubs.filter(usesRealNickname)).toEqual([]);
  });
  it('WHEN a name uses a real nickname THEN the check finds it, however it is written', () => {
    expect(usesRealNickname('Rotterdam Lakers')).toBe(true);
    expect(usesRealNickname('Oslo red sox')).toBe(true);
    expect(usesRealNickname('Lyon TrailBlazers')).toBe(true);
    expect(usesRealNickname('Bologna Towers')).toBe(true);
    expect(usesRealNickname('Rotterdam Kites')).toBe(false);
  });
  it('WHEN a league is made THEN its clubs and abbreviations are all different', () => {
    for (const l of lists()) {
      expect(l.teams).toHaveLength(8);
      expect(new Set(l.teams.map((t) => t.name)).size).toBe(l.teams.length);
      expect(new Set(l.teams.map((t) => t.abbr)).size).toBe(l.teams.length);
    }
  });
});

describe('America and Europe never share a league', () => {
  const american = new Set(AMERICA.map((p) => p.city));
  const european = new Set(Object.values(EUROPE).flatMap((ps) => ps.map((p) => p.city)));
  const cityOf = (name: string) => [...american, ...european].filter((c) => name.startsWith(`${c} `)).sort((a, b) => b.length - a.length)[0];
  it("WHEN a Quick League's club lists are checked THEN every American list has only American cities and every European list only European ones", () => {
    for (const l of lists()) {
      const wrong = l.teams.filter((t) => !(l.region === 'america' ? american : european).has(cityOf(t.name) ?? ''));
      expect(wrong.map((t) => `${l.league}/${l.region}: ${t.name}`)).toEqual([]);
    }
  });
  it('WHEN a Quick League is made in a region THEN all eight clubs are from that region, and it remembers the region', () => {
    for (const id of Object.keys(LEAGUES) as (keyof typeof LEAGUES)[]) {
      for (const region of REGIONS) {
        const q = createLeague(id, 5, region);
        expect(q.region).toBe(region);
        const cities = q.teams.map((t) => cityOf(t.name));
        expect(cities.every((c) => (region === 'america' ? american : european).has(c ?? ''))).toBe(true);
      }
    }
  });
});
