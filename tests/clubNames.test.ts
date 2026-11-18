// Club names (SEASON_SPEC R3.2): real cities, invented nicknames, never a real team's.

import { describe, expect, it } from 'vitest';
import { LEAGUES, REGIONS } from '../src/game/league/leagues';
import { createLeague } from '../src/game/league/quickLeague';
import { usesRealNickname } from '../src/game/league/realTeams';

describe('club names', () => {
  it("WHEN the club list is checked THEN no nickname is a real team's (case and spaces ignored)", () => {
    const clubs = Object.values(LEAGUES).flatMap((l) => REGIONS.flatMap((r) => l.teams[r].map((t) => t.name)));
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
    for (const l of Object.values(LEAGUES))
      for (const r of REGIONS) {
        expect(new Set(l.teams[r].map((t) => t.name)).size).toBe(l.teams[r].length);
        expect(new Set(l.teams[r].map((t) => t.abbr)).size).toBe(l.teams[r].length);
      }
  });
  it('WHEN the club lists are checked THEN every club is in one league of one region only, and no city plays in both regions', () => {
    const city = (name: string) => name.split(' ').slice(0, -1).join(' ');
    const all = Object.values(LEAGUES).flatMap((l) => REGIONS.flatMap((r) => l.teams[r].map((t) => ({ r, name: t.name }))));
    expect(new Set(all.map((c) => c.name)).size).toBe(all.length);
    const american = new Set(all.filter((c) => c.r === 'america').map((c) => city(c.name)));
    expect(all.filter((c) => c.r === 'europe' && american.has(city(c.name)))).toEqual([]);
  });
  it('WHEN a European league is made THEN all eight clubs are European (and an American one, American)', () => {
    for (const id of Object.keys(LEAGUES) as (keyof typeof LEAGUES)[])
      for (const r of REGIONS) {
        const q = createLeague(id, r, 5);
        expect(q.region).toBe(r);
        expect(q.teams.map((t) => t.name).sort()).toEqual(LEAGUES[id].teams[r].map((t) => t.name).sort());
      }
  });
});
