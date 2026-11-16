// The Quick League (SEASON_SPEC Part 2): one 8-team league, a snake draft at the start, 14
// matchdays. Pure logic: the state is plain data (it is what gets saved), and every function returns
// a new state. The engine decides every match; everything random comes from the league's seed, so the
// same save and the same choices give the same season.

import { simulateMatch } from '../../engine/match';
import { createRng, next } from '../../engine/rng';
import type { MatchState, Team } from '../../engine/types';
import { buildBoxScore } from '../../engine/stats';
import { aiDraftPick, aiGamePlan } from '../ai';
import { canPick, createDraft, currentTurn, isComplete, pick, toTeam, type DraftState, type DraftTeam } from '../draft';
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
  /** null for an AI team; 0 or 1 for Player 1 or Player 2. */
  human: 0 | 1 | null;
}

/** The draft as saved: everything but the pool (rebuilt from the league). */
export interface SavedDraft {
  owner: Record<string, number>;
  teams: DraftTeam[];
  pickNo: number;
  order: number[];
}

export interface QuickLeague {
  kind: 'quick';
  seed: number;
  league: LeagueId;
  teams: LeagueTeam[];
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

/** A new league: the humans' teams, the league's AI teams, and a seeded first-round draft order. */
export function createQuickLeague(league: LeagueId, humanNames: string[], seed: number): QuickLeague {
  if (humanNames.length < 1 || humanNames.length > 2) throw new Error('createQuickLeague: 1 or 2 humans');
  const def = LEAGUES[league];
  const humans: LeagueTeam[] = humanNames.map((name, i) => ({ id: `you-${i + 1}`, name, abbr: abbrFor(name), human: i as 0 | 1 }));
  const ai: LeagueTeam[] = def.teams.slice(0, TEAMS - humans.length).map((t) => ({ id: `ai-${t.abbr.toLowerCase()}`, name: t.name, abbr: t.abbr, human: null }));
  const teams = [...humans, ...ai];
  const rng = createRng(mix(seed, 1));
  const order = teams.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next(rng) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const d = createDraft('snake', leaguePool(league), teams.map((t) => ({ name: t.name, abbr: t.abbr, controller: t.human === null ? 'ai' : 'human' })), def.budget, order);
  return { kind: 'quick', seed, league, teams, draft: saveDraft(d), phase: 'draft', schedule: [], matchday: 0, records: [] };
}

function saveDraft(d: DraftState): SavedDraft {
  return { owner: d.owner, teams: d.teams, pickNo: d.pickNo, order: d.order };
}

/** The draft with its pool, to use the draft rules on. */
export function draftOf(q: QuickLeague): DraftState {
  return { mode: 'snake', pool: leaguePool(q.league), ...q.draft };
}

/** Whose pick it is (team index), or null once the draft is done. */
export function draftTurn(q: QuickLeague): number | null {
  return q.phase === 'draft' ? currentTurn(draftOf(q)) : null;
}

/** When the draft is complete: the schedule is made and the season starts. */
function afterPick(q: QuickLeague, d: DraftState): QuickLeague {
  const next: QuickLeague = { ...q, draft: saveDraft(d) };
  if (!isComplete(d)) return next;
  return { ...next, phase: 'season', schedule: doubleRoundRobin(TEAMS, mix(q.seed, 2)), matchday: 0 };
}

/** The AI teams pick until it is a human's turn (or the draft is over). Deterministic per pick. */
export function runAiPicks(q: QuickLeague): QuickLeague {
  let d = draftOf(q);
  for (let turn = currentTurn(d); turn !== null && q.teams[turn].human === null; turn = currentTurn(d)) {
    const id = aiDraftPick(d, turn, createRng(mix(q.seed, 3, d.pickNo)));
    if (!id) throw new Error(`AI team ${q.teams[turn].name} could not pick`);
    d = pick(d, turn, id);
  }
  return afterPick(q, d);
}

/** A human's pick (it must be his turn), then the AI's picks up to the next human turn. */
export function humanPick(q: QuickLeague, playerId: string): QuickLeague {
  const d = draftOf(q);
  const turn = currentTurn(d);
  if (turn === null || q.teams[turn].human === null) throw new Error('Not a human pick');
  const check = canPick(d, turn, playerId);
  if (!check.ok) throw new Error(check.reason);
  return runAiPicks(afterPick(q, pick(d, turn, playerId)));
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
