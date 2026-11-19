// A career season as saved (slice brief W2a): every game of the regular season on its day, the
// results so far, the players' season totals, your club's box scores and game plan, and the inbox.
// Plain data inside the World, saved with it.

import type { GamePlan, PlayerStats, TeamExtras } from '../../engine/types';

/** The Big League's games (both conferences play one schedule; each conference has its own table). */
export const BIG_LEAGUE = 'big-league';

export interface SeasonGame {
  /** Its place in the season's list (games are in day order). */
  id: number;
  /** The competition: a US division's or national league's id, or BIG_LEAGUE. */
  comp: string;
  /** Days from the season's first day (day 0, a Saturday). */
  day: number;
  home: string;
  away: string;
  /** The game's own seed (WORLD_SPEC §14: every match stores its seed). */
  seed: number;
  /** Home score, away score, once played. */
  score?: [number, number];
  ot?: boolean;
}

/** The order of a player's numbers in a box score line and in his season totals (after games played). */
export const STAT_KEYS = ['seconds', 'pts', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov', 'pf', 'tf', 'plusMinus'] as const satisfies readonly (keyof PlayerStats)[];

/** One player's line: his id, then his numbers in STAT_KEYS order. */
export type BoxLine = [string, ...number[]];

/** One side of a game's box score, as stored for your club's games. */
export interface BoxSide {
  starters: string[];
  quarterPoints: number[];
  extras: TeamExtras;
  lines: BoxLine[];
}

export interface InboxItem {
  day: number;
  kind: 'start' | 'result' | 'end';
  text: string;
  /** The game it is about. */
  game?: number;
}

export type SeasonPhase = 'before' | 'regular' | 'review';

export interface SeasonPlay {
  /** before: the day before the first; regular: the regular season; review: it is over (W2b goes on from here). */
  phase: SeasonPhase;
  /** Today: -1 before the season, then days from the first day. */
  day: number;
  /** Whether today's games have all been played. */
  done: boolean;
  games: SeasonGame[];
  /** Season totals by competition and player: games played, then STAT_KEYS. */
  stats: Record<string, Record<string, number[]>>;
  /** Full box scores of your club's games, by game id. Other games are played again from their seed. */
  boxes: Record<number, [BoxSide, BoxSide]>;
  inbox: InboxItem[];
  /** Your game plan and rotation over the whole first team (13): the last of the bench does not dress. */
  plan: GamePlan | null;
  /** How you played your last game (the next one starts with the same choice: GAME_FLOW §3.4). */
  mode: 'watch' | 'simulate';
}
