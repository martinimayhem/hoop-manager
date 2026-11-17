// The Quick League (SEASON_SPEC Part 2): one 8-team league, a snake draft at the start, 14
// matchdays. Pure logic: the state is plain data (it is what gets saved), and every function returns
// a new state. The engine decides every match; everything random comes from the league's seed, so the
// same save and the same choices give the same season.

import { simulateMatch } from '../../engine/match';
import { createRng, next } from '../../engine/rng';
import type { MatchState, Team } from '../../engine/types';
import { buildBoxScore } from '../../engine/stats';
import { positionGroup, type PositionGroup } from '../../engine/ratings';
import type { Position } from '../../engine/types';
import { aiDraftPick, aiGamePlan } from '../ai';
import { canPick, createDraft, currentTurn, GROUPS, groupCounts, isComplete, MIN_PER_GROUP, pick, ROSTER_SIZE, toTeam, type DraftState, type DraftTeam } from '../draft';
import { journeymen, playerPool, type PoolPlayer } from '../pool';
import { MIN_PRICE } from '../pricing';
import { DEFAULT_SCOUT_ACCURACY } from '../scouting';
import { LEAGUES, leaguePool, type LeagueId } from './leagues';
import { doubleRoundRobin, type Fixture, type Schedule } from './schedule';
import { standings, type GameRecord, type PlayerLineRecord, type TableRow } from './standings';

export const TEAMS = 8;
export const MATCHDAYS = 14;

export interface LeagueTeam {
  /** Stable id (the table's last tiebreaker). */
  id: string;
  name: string;
  abbr: string;
  /** null for an AI team; 0 for the player's team. */
  human: 0 | null;
}

/** The draft as saved: everything but the pool (rebuilt from the league). */
export interface SavedDraft {
  owner: Record<string, number>;
  teams: DraftTeam[];
  pickNo: number;
  order: number[];
  /** Minimum-contract players signed during the draft (not in the league's pool, so saved). */
  extras?: PoolPlayer[];
  /** Every pick in order: which team took whom. */
  log?: { team: number; id: string }[];
}

export interface QuickLeague {
  kind: 'quick';
  seed: number;
  league: LeagueId;
  teams: LeagueTeam[];
  /** The player's own name, as manager of his club (older saves have none). */
  manager?: string;
  draft: SavedDraft;
  phase: 'draft' | 'season' | 'finished';
  schedule: Schedule;
  /** The next matchday to play (0-based); MATCHDAYS when the season is over. */
  matchday: number;
  records: GameRecord[];
}

/** A small, stable hash for seeds. */
function mix(...xs: number[]): number {
  let h = 2166136261;
  for (const x of xs) h = Math.imul(h ^ (x >>> 0), 16777619) ^ (h >>> 13);
  return h >>> 0;
}

function abbrFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const a = words.length >= 2 ? words.slice(0, 3).map((w) => w[0]).join('') : name.slice(0, 3);
  return a.toUpperCase().padEnd(3, 'X').slice(0, 3);
}

/** A new league: the player's team, the league's AI teams, and a seeded first-round draft order. */
/** `humanNames`: the player's club name. `manager`: his own name. */
export function createQuickLeague(league: LeagueId, humanNames: string[], seed: number, manager?: string): QuickLeague {
  if (humanNames.length !== 1) throw new Error('createQuickLeague: one player');
  const def = LEAGUES[league];
  const humans: LeagueTeam[] = humanNames.map((name, i) => ({ id: `you-${i + 1}`, name, abbr: abbrFor(name), human: 0 as const }));
  const ai: LeagueTeam[] = def.teams.slice(0, TEAMS - humans.length).map((t) => ({ id: `ai-${t.abbr.toLowerCase()}`, name: t.name, abbr: t.abbr, human: null }));
  const teams = [...humans, ...ai];
  const rng = createRng(mix(seed, 1));
  const order = teams.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next(rng) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const d = createDraft('snake', leaguePool(league), teams.map((t) => ({ name: t.name, abbr: t.abbr, controller: t.human === null ? 'ai' : 'human' })), def.budget, order);
  return { kind: 'quick', seed, league, teams, ...(manager ? { manager } : {}), draft: saveDraft(d), phase: 'draft', schedule: [], matchday: 0, records: [] };
}

function saveDraft(d: DraftState, prev?: SavedDraft): SavedDraft {
  return { owner: d.owner, teams: d.teams, pickNo: d.pickNo, order: d.order, extras: prev?.extras ?? [], log: prev?.log ?? [] };
}

/** The league's pool and any minimum-contract players signed so far. */
export function poolOf(q: QuickLeague): PoolPlayer[] {
  return q.draft.extras?.length ? [...leaguePool(q.league), ...q.draft.extras] : leaguePool(q.league);
}

/** The draft with its pool, to use the draft rules on. */
export function draftOf(q: QuickLeague): DraftState {
  const { owner, teams, pickNo, order } = q.draft;
  return { mode: 'snake', pool: poolOf(q), owner, teams, pickNo, order };
}

/** A pick, with the draft rules, recorded in the log. */
function take(q: QuickLeague, team: number, id: string): QuickLeague {
  const d = pick(draftOf(q), team, id);
  return { ...q, draft: { ...saveDraft(d, q.draft), log: [...(q.draft.log ?? []), { team, id }] } };
}

/** The position a team's minimum signing plays: a group it is short of, else its thinnest position. */
function minimumPosition(d: DraftState, team: number): Position {
  const counts = groupCounts(d, team);
  const short = GROUPS.find((g) => counts[g] < MIN_PER_GROUP);
  const byGroup: Record<PositionGroup, Position> = { guard: 'PG', wing: 'SF', big: 'C' };
  if (short) return byGroup[short];
  const held: Record<Position, number> = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
  for (const id of d.teams[team].picks) held[d.pool.find((p) => p.player.id === id)!.player.position]++;
  return (Object.keys(held) as Position[]).sort((a, b) => held[a] - held[b])[0];
}

/**
 * Signs a minimum-contract player for the team whose pick it is: a journeyman made for the purpose,
 * at MIN_PRICE, in a position the team needs. Always possible while the team has a credit for each
 * empty spot (the league budget rule), so no team can ever be left unable to fill its roster.
 */
export function signMinimum(q: QuickLeague): QuickLeague {
  const d = draftOf(q);
  const team = currentTurn(d);
  if (team === null) throw new Error('No pick to make');
  const t = d.teams[team];
  if (t.budgetLeft < MIN_PRICE || t.picks.length >= ROSTER_SIZE) throw new Error('Cannot sign a minimum player');
  const pos = minimumPosition(d, team);
  const usedNames = new Set([...playerPool(), ...d.pool].map((p) => p.player.name));
  const usedIds = new Set([...playerPool(), ...d.pool].map((p) => p.player.id));
  const [made] = journeymen(1, mix(q.seed, 6, q.draft.extras?.length ?? 0), usedNames, { positions: [pos], quality: [34, 44], usedIds });
  const extra: PoolPlayer = { ...made, player: { ...made.player, archetype: 'Minimum contract' }, price: MIN_PRICE };
  const withExtra: QuickLeague = { ...q, draft: { ...q.draft, extras: [...(q.draft.extras ?? []), extra] } };
  return afterPick(take(withExtra, team, extra.player.id));
}

/** Whether the team whose pick it is can sign a minimum-contract player now. */
export function canSignMinimum(q: QuickLeague): boolean {
  const d = draftOf(q);
  const team = currentTurn(d);
  return team !== null && d.teams[team].budgetLeft >= MIN_PRICE && d.teams[team].picks.length < ROSTER_SIZE;
}

/** Whose pick it is (team index), or null once the draft is done. */
export function draftTurn(q: QuickLeague): number | null {
  return q.phase === 'draft' ? currentTurn(draftOf(q)) : null;
}

/** When the draft is complete: the schedule is made and the season starts. */
function afterPick(q: QuickLeague): QuickLeague {
  if (!isComplete(draftOf(q))) return q;
  return { ...q, phase: 'season', schedule: doubleRoundRobin(TEAMS, mix(q.seed, 2)), matchday: 0 };
}

/** The pick the AI would make for the team whose turn it is (a minimum signing if nothing fits). */
function aiTurn(q: QuickLeague): QuickLeague {
  const d = draftOf(q);
  const turn = currentTurn(d)!;
  const id = aiDraftPick(d, turn, createRng(mix(q.seed, 3, d.pickNo)));
  return id ? afterPick(take(q, turn, id)) : signMinimum(q);
}

/**
 * A new league: all eight clubs, their squads put together by the computer (the same draft rules,
 * every pick the AI's), the season ready to start. The player then takes over one of them.
 */
export function createLeague(league: LeagueId, seed: number): QuickLeague {
  const def = LEAGUES[league];
  const teams: LeagueTeam[] = def.teams.slice(0, TEAMS).map((t) => ({ id: `ai-${t.abbr.toLowerCase()}`, name: t.name, abbr: t.abbr, human: null }));
  const rng = createRng(mix(seed, 1));
  const order = teams.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next(rng) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const d = createDraft('snake', leaguePool(league), teams.map((t) => ({ name: t.name, abbr: t.abbr, controller: 'ai' as const })), def.budget, order);
  return finishDraft({ kind: 'quick', seed, league, teams, draft: saveDraft(d), phase: 'draft', schedule: [], matchday: 0, records: [] });
}

/** The player takes over a club (its squad as it is), with his own name as manager. */
export function takeOver(q: QuickLeague, team: number, manager?: string): QuickLeague {
  const teams = q.teams.map((t, i) => ({ ...t, human: i === team ? (0 as const) : null }));
  return { ...q, teams, ...(manager ? { manager } : {}) };
}

/** Every pick left made by the computer, the player's club's too (an old save stopped mid-draft). */
export function finishDraft(q: QuickLeague): QuickLeague {
  let s = q;
  while (draftTurn(s) !== null) s = aiTurn(s);
  return s;
}

/** The AI teams pick until it is a human's turn (or the draft is over). Deterministic per pick. */
export function runAiPicks(q: QuickLeague): QuickLeague {
  let s = q;
  for (let turn = draftTurn(s); turn !== null && s.teams[turn].human === null; turn = draftTurn(s)) s = aiTurn(s);
  return s;
}

/** A human's pick (it must be his turn), then the AI's picks up to the next human turn. */
export function humanPick(q: QuickLeague, playerId: string): QuickLeague {
  const d = draftOf(q);
  const turn = currentTurn(d);
  if (turn === null || q.teams[turn].human === null) throw new Error('Not a human pick');
  const check = canPick(d, turn, playerId);
  if (!check.ok) throw new Error(check.reason);
  return runAiPicks(afterPick(take(q, turn, playerId)));
}

/** A human signs a minimum-contract player on his turn, then the AI picks. */
export function humanSignMinimum(q: QuickLeague): QuickLeague {
  const turn = draftTurn(q);
  if (turn === null || q.teams[turn].human === null) throw new Error('Not a human pick');
  return runAiPicks(signMinimum(q));
}

/** Auto-pick: the AI's choice for the human whose pick it is, then the AI's picks. */
export function autoPick(q: QuickLeague): QuickLeague {
  const turn = draftTurn(q);
  if (turn === null || q.teams[turn].human === null) throw new Error('Not a human pick');
  return runAiPicks(aiTurn(q));
}

/** Auto-draft: the AI picks the rest of this human's roster (the other human still picks his own). */
export function autoDraftRest(q: QuickLeague): QuickLeague {
  const turn = draftTurn(q);
  if (turn === null) return q;
  const who = q.teams[turn].human;
  if (who === null) throw new Error('Not a human pick');
  let s = q;
  for (let t = draftTurn(s); t !== null && s.teams[t].human === who; t = draftTurn(s)) s = autoPick(s);
  return s;
}

/** Minimum-contract players are worth knowing about in a group check (exported for the screen). */
export function groupOf(p: PoolPlayer): PositionGroup {
  return positionGroup(p.player.position);
}

/** A team as the engine plays it. */
export function teamOf(q: QuickLeague, index: number): Team {
  return toTeam(draftOf(q), index, q.teams[index].id);
}

/** A game's seed, from the league's seed, the matchday and the game. */
export function gameSeed(q: QuickLeague, matchday: number, game: number): number {
  return mix(q.seed, 4, matchday, game);
}

/** The current matchday's fixtures. */
export function fixtures(q: QuickLeague): Fixture[] {
  return q.phase === 'season' ? q.schedule[q.matchday] : [];
}

/** The current matchday's games with a human team in them (game index and fixture). */
export function humanGames(q: QuickLeague): { game: number; fixture: Fixture }[] {
  return fixtures(q)
    .map((fixture, game) => ({ game, fixture }))
    .filter(({ fixture }) => q.teams[fixture.home].human !== null || q.teams[fixture.away].human !== null);
}

/** A finished match as a record. `sides`: the team index on each side of the match state. */
export function recordFrom(matchday: number, fixture: Fixture, seed: number, state: MatchState, sides: [number, number]): GameRecord {
  const box = buildBoxScore(state);
  const sideOf = (team: number) => (sides[0] === team ? 0 : 1);
  const lines = (team: number): PlayerLineRecord[] =>
    box.teams[sideOf(team)].players.map((l) => {
      const s = l.stats;
      return [l.player.id, Math.round(s.seconds), s.pts, s.oreb + s.dreb, s.ast, s.stl, s.blk, s.tov, s.pf];
    });
  const score = (team: number) => state.teams[sideOf(team)].score;
  return {
    matchday,
    home: fixture.home,
    away: fixture.away,
    seed,
    score: [score(fixture.home), score(fixture.away)],
    overtime: state.quarter > 4,
    lines: [lines(fixture.home), lines(fixture.away)],
  };
}

/** A game played by the engine with both plans from the AI (the AI coaches, or "sim my match"). */
export function simulateGame(q: QuickLeague, game: number): GameRecord {
  const fixture = fixtures(q)[game];
  const seed = gameSeed(q, q.matchday, game);
  const home = teamOf(q, fixture.home);
  const away = teamOf(q, fixture.away);
  const rng = createRng(mix(seed, 5));
  const result = simulateMatch(home, away, aiGamePlan(home, away, rng), aiGamePlan(away, home, rng), seed);
  return recordFrom(q.matchday, fixture, seed, result.state, [fixture.home, fixture.away]);
}

/**
 * Ends the current matchday: the humans' games as played (`played`, by game index; any human game
 * left out is simulated), every other game simulated, and on to the next matchday.
 */
export function completeMatchday(q: QuickLeague, played: Record<number, GameRecord> = {}): QuickLeague {
  if (q.phase !== 'season') throw new Error('No matchday to play');
  const records = fixtures(q).map((_, game) => played[game] ?? simulateGame(q, game));
  const matchday = q.matchday + 1;
  return { ...q, records: [...q.records, ...records], matchday, phase: matchday >= MATCHDAYS ? 'finished' : 'season' };
}

/** The table, from every game played so far. */
export function table(q: QuickLeague): TableRow[] {
  return standings(
    q.teams.map((t) => t.id),
    q.records,
  );
}

/**
 * How well a human knows an opponent: the more often he has played it, the narrower its scouting
 * ranges (SEASON_SPEC R2.6), never exact (see SCOUT_MIN_HALF).
 */
export function scoutAccuracy(q: QuickLeague, us: number, them: number): number {
  const met = q.records.filter((g) => (g.home === us && g.away === them) || (g.home === them && g.away === us)).length;
  return Math.min(0.85, DEFAULT_SCOUT_ACCURACY + 0.12 * met);
}

/** A scouting range is never narrower than this either side of the value (6 points wide in all). */
export const SCOUT_MIN_HALF = 3;
