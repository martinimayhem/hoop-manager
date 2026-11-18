// Reading the career world: leagues, squads, ages, strength. Pure functions over World.

import { REGION_NAME, type Region } from '../league/leagues';
import { overall } from './generate';
import type { Tier, World, WorldClub, WorldPlayer } from './types';

export { overall };

/** "Big League · America", "US Division 2", "Euro Division 3". */
export function leagueLabel(region: Region, tier: Tier): string {
  if (tier === 1) return `Big League · ${REGION_NAME[region]}`;
  return `${region === 'america' ? 'US' : 'Euro'} Division ${tier}`;
}

/** Short: "Big League", "Division 2". */
export function tierLabel(tier: Tier): string {
  return tier === 1 ? 'Big League' : `Division ${tier}`;
}

export function clubById(w: World, id: string): WorldClub | undefined {
  return w.clubs.find((c) => c.id === id);
}

/** A region's league in a tier: its 16 clubs, strongest first. */
export function leagueClubs(w: World, region: Region, tier: Tier): WorldClub[] {
  return w.clubs.filter((c) => c.region === region && c.tier === tier).sort((a, b) => strength(w, b) - strength(w, a) || a.name.localeCompare(b.name));
}

export function ageOf(w: World, wp: WorldPlayer): number {
  return w.season - wp.born;
}

export function squad(w: World, club: WorldClub): WorldPlayer[] {
  return club.roster.map((id) => w.players[id]).sort((a, b) => overall(b) - overall(a));
}

/** How strong a squad is: the average overall of its best eight. */
export function strength(w: World, club: WorldClub): number {
  const best = club.roster.map((id) => overall(w.players[id])).sort((a, b) => b - a).slice(0, 8);
  return best.reduce((a, b) => a + b, 0) / Math.max(1, best.length);
}

/** What a club pays its squad this season, in its currency. */
export function payroll(w: World, club: WorldClub): number {
  return club.roster.reduce((sum, id) => sum + (w.players[id].contract?.wage ?? 0), 0);
}

/** The player takes over a club, with his name as manager. */
export function takeOver(w: World, clubId: string, manager?: string): World {
  return { ...w, human: { club: clubId, ...(manager ? { manager } : {}) } };
}

/** Where a player is: his club, college, academy, or free agency. */
export function whereIs(w: World, wp: WorldPlayer): string {
  if (wp.status === 'club') return clubById(w, wp.club!)?.name ?? '?';
  if (wp.status === 'academy') return `${clubById(w, wp.club!)?.name ?? '?'} academy`;
  if (wp.status === 'college') return `${w.colleges.find((c) => c.id === wp.college)?.name ?? '?'}, year ${wp.collegeYear}`;
  return 'Free agent';
}
