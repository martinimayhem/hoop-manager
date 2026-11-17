// Club names (SEASON_SPEC R3.2): real cities, invented nicknames, never a real team's.

import { describe, expect, it } from 'vitest';
import { LEAGUES } from '../src/game/league/leagues';
import { usesRealNickname } from '../src/game/league/realTeams';

describe('club names', () => {
  it("WHEN the club list is checked THEN no nickname is a real team's (case and spaces ignored)", () => {
    const clubs = Object.values(LEAGUES).flatMap((l) => l.teams.map((t) => t.name));
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
    for (const l of Object.values(LEAGUES)) {
      expect(new Set(l.teams.map((t) => t.name)).size).toBe(l.teams.length);
      expect(new Set(l.teams.map((t) => t.abbr)).size).toBe(l.teams.length);
    }
  });
});
