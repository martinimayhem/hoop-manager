// Reading the career world: competitions, squads, ages, strength, money. Pure functions over World.

import { overall, thresholdCounted } from './generate';
import { ANCHORS, CAP, FLOOR, HARD_CEILING, TAX_LINE, THRESHOLD } from './money';
import type { Competition, World, WorldClub, WorldPlayer } from './types';

export { overall };

interface Index {
  clubs: Map<string, WorldClub>;
  comps: Map<string, Competition>;
  /** Club id → its competitions, its league first. */
  of: Map<string, Competition[]>;
}
const indexes = new WeakMap<World, Index>();

function index(w: World): Index {
  let ix = indexes.get(w);
  if (ix && ix.clubs.size === w.clubs.length) return ix;
  const of = new Map<string, Competition[]>();
  for (const comp of w.competitions) for (const id of comp.clubs) of.set(id, [...(of.get(id) ?? []), comp]);
  // The league first: Big League Europe is the club's second competition.
  for (const list of of.values()) list.sort((a, b) => Number(isBigLeagueEurope(a)) - Number(isBigLeagueEurope(b)));
  ix = { clubs: new Map(w.clubs.map((c) => [c.id, c])), comps: new Map(w.competitions.map((c) => [c.id, c])), of };
  indexes.set(w, ix);
  return ix;
}

const isBigLeagueEurope = (c: Competition) => c.kind === 'bigLeague' && c.region === 'europe';

export function clubById(w: World, id: string): WorldClub | undefined {
  return index(w).clubs.get(id);
}

export function competitionById(w: World, id: string): Competition | undefined {
  return index(w).comps.get(id);
}

/** A club's competitions: its league first, then (Big League Europe clubs) the Big League. */
export function competitionsOf(w: World, clubId: string): Competition[] {
  return index(w).of.get(clubId) ?? [];
}

/** The one league a club plays in all season: the America Big League, a US division, or its national league. */
export function leagueOf(w: World, clubId: string): Competition {
  return competitionsOf(w, clubId)[0];
}

/** Whether a club plays in the Big League (either conference). */
export function inBigLeague(w: World, clubId: string): boolean {
  return competitionsOf(w, clubId).some((c) => c.kind === 'bigLeague');
}

export function ageOf(w: World, wp: WorldPlayer): number {
  return w.season - wp.born;
}

const players = (w: World, ids: string[]) => ids.map((id) => w.players[id]).sort((a, b) => overall(b) - overall(a));

/** The first team, best first. */
export function squad(w: World, club: WorldClub): WorldPlayer[] {
  return players(w, club.roster);
}
export function devSquad(w: World, club: WorldClub): WorldPlayer[] {
  return players(w, club.dev);
}
export function academy(w: World, club: WorldClub): WorldPlayer[] {
  return players(w, club.academy);
}

/** How strong a squad is: the average overall of its best eight. */
export function strength(w: World, club: WorldClub): number {
  const best = club.roster.map((id) => overall(w.players[id])).sort((a, b) => b - a).slice(0, 8);
  return best.reduce((a, b) => a + b, 0) / Math.max(1, best.length);
}

const wageOf = (w: World, id: string) => w.players[id].contract?.wage ?? 0;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** What a club pays its first team this season (the cap payroll; dev-squad minimum deals are outside it). */
export function payroll(w: World, club: WorldClub): number {
  return sum(club.roster.map((id) => wageOf(w, id)));
}

/** First-team wages already promised for next season (contracts with more than this season left). */
export function payrollNextSeason(w: World, club: WorldClub): number {
  return sum(club.roster.filter((id) => (w.players[id].contract?.years ?? 0) > 1).map((id) => wageOf(w, id)));
}

/** Budget clubs: every wage the club budget pays (first team and dev squad). */
export function wagesCommitted(w: World, club: WorldClub): number {
  return payroll(w, club) + sum(club.dev.map((id) => wageOf(w, id)));
}

/** Big League Europe clubs: what counts towards the payroll threshold, and the anchor players left out. */
export function thresholdFigure(w: World, club: WorldClub): { counted: number; anchors: WorldPlayer[] } {
  const first = club.roster.map((id) => w.players[id]);
  const { sum: counted } = thresholdCounted(first.map((wp) => ({ wage: wp.contract?.wage ?? 0, age: ageOf(w, wp) })));
  const anchors = first
    .map((wp, i) => ({ wp, i }))
    .sort((a, b) => (b.wp.contract?.wage ?? 0) - (a.wp.contract?.wage ?? 0) || a.i - b.i)
    .slice(0, ANCHORS)
    .map((x) => x.wp);
  return { counted, anchors };
}

// ---------------------------------------------------------------------------
// Stars (GAME_FLOW §6.5): ability and potential as 0.5–5 half stars, compared with the league the
// club plays in. Big League clubs (both conferences, one league) are compared with the whole Big
// League, also the Europe clubs that play their national league too (owner's answer, 18 Nov 2026).

export interface StarScale {
  /** "the Big League", "US Division 4", "the Spanish League 2". */
  label: string;
  mean: number;
  sd: number;
}
const scales = new WeakMap<World, Map<string, StarScale>>();

/** The scale a club's players are measured on: its league's first-team overalls. */
export function starScale(w: World, clubId: string): StarScale {
  const big = inBigLeague(w, clubId);
  const comps = big ? w.competitions.filter((c) => c.kind === 'bigLeague') : [leagueOf(w, clubId)].filter(Boolean);
  const key = big ? 'big-league' : (comps[0]?.id ?? 'world');
  let byKey = scales.get(w);
  if (!byKey) scales.set(w, (byKey = new Map()));
  let s = byKey.get(key);
  if (!s) {
    const clubIds = comps.length ? comps.flatMap((c) => c.clubs) : w.clubs.map((c) => c.id);
    const ovrs = clubIds.flatMap((id) => clubById(w, id)!.roster.map((pid) => overall(w.players[pid])));
    const mean = ovrs.reduce((a, b) => a + b, 0) / ovrs.length;
    const sd = Math.sqrt(ovrs.reduce((a, b) => a + (b - mean) ** 2, 0) / ovrs.length) || 1;
    const label = big ? 'the Big League' : comps[0] ? comps[0].name : 'all clubs';
    s = { label, mean, sd };
    byKey.set(key, s);
  }
  return s;
}

/**
 * A rating as half stars on a scale: a league's average first-team player is about 2.5–3 stars, one
 * standard deviation better one star more; 0.5 to 5.
 */
export function toStars(value: number, s: StarScale): number {
  const stars = 2.75 + (value - s.mean) / s.sd;
  return Math.max(0.5, Math.min(5, Math.round(stars * 2) / 2));
}

export type MoneySummary =
  | { system: 'cap'; payroll: number; next: number; space: number; floor: number; cap: number; tax: number; ceiling: number; midLevel: number }
  | { system: 'budget'; budget: number; committed: number; next: number; room: number; threshold: { counted: number; limit: number; anchors: WorldPlayer[] } | null };

/** A club's money at a glance (GAME_FLOW §4.4): cap space, or budget room. */
export function moneySummary(w: World, club: WorldClub): MoneySummary {
  const pay = payroll(w, club);
  const next = payrollNextSeason(w, club);
  if (club.moneySystem === 'cap') return { system: 'cap', payroll: pay, next, space: CAP - pay, floor: FLOOR, cap: CAP, tax: TAX_LINE, ceiling: HARD_CEILING, midLevel: club.midLevelLeft };
  const committed = wagesCommitted(w, club);
  const t = club.licence ? thresholdFigure(w, club) : null;
  return {
    system: 'budget',
    budget: club.budget,
    committed,
    next: next + sum(club.dev.filter((id) => (w.players[id].contract?.years ?? 0) > 1).map((id) => wageOf(w, id))),
    room: club.budget - committed,
    threshold: t ? { counted: t.counted, limit: THRESHOLD, anchors: t.anchors } : null,
  };
}

/** A competition's table before the season: every club 0–0, in name order (all level). */
export function standings(w: World, comp: Competition): { club: WorldClub; w: number; l: number }[] {
  return comp.clubs
    .map((id) => clubById(w, id)!)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((club) => ({ club, w: 0, l: 0 }));
}

/** Where a club stands in a competition: "=1st" while everyone is level. */
export function positionIn(w: World, comp: Competition, clubId: string): string {
  const rows = standings(w, comp);
  const me = rows.find((r) => r.club.id === clubId);
  if (!me) return '—';
  const above = rows.filter((r) => r.w - r.l > me.w - me.l).length;
  const level = rows.filter((r) => r.w - r.l === me.w - me.l).length;
  return `${level > 1 ? '=' : ''}${ordinal(above + 1)}`;
}

export function ordinal(n: number): string {
  return `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
}

/** You take over a club, with your name as manager. */
export function takeOver(w: World, clubId: string, manager?: string): World {
  return { ...w, human: { club: clubId, ...(manager ? { manager } : {}) } };
}

/** Where a player is: his club, its dev squad or academy, his college, or free agency. */
export function whereIs(w: World, wp: WorldPlayer): string {
  const club = wp.club ? clubById(w, wp.club)?.name ?? '?' : '?';
  if (wp.status === 'club') return club;
  if (wp.status === 'dev') return `${club} dev squad`;
  if (wp.status === 'academy') return `${club} academy`;
  if (wp.status === 'college') return `${w.colleges.find((c) => c.id === wp.college)?.name ?? '?'}, year ${wp.collegeYear}`;
  return 'Free agent';
}
