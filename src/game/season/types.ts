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
  /** Not the regular season: a play-in, playoff or Final game, or a cup tie (slice W2b). */
  stage?: 'playin' | 'playoff' | 'final' | 'cup';
  /** The tie (series or single game) it belongs to. */
  tie?: string;
  /** "First round, game 3", "Cup quarter-final". */
  label?: string;
  /** A series game not needed (the series was decided before it): kept so ids stay put, never played. */
  off?: true;
}

/** A knockout pairing: a play-in game, a playoff series, a cup tie. */
export interface Tie {
  id: string;
  /** The competition (a league's id for its playoffs; 'big-league-final'; a cup's id). */
  comp: string;
  /** The round's key ('playin-a', 'r1', 'qf', 'sf', 'final', 'r64' …). */
  round: string;
  /** The better-placed club (the extra home game) and the other. */
  a: string;
  b: string;
  bestOf: number;
  games: number[];
  winner?: string;
  /** The day it was decided. */
  decided?: number;
}

/** Something Continue stops for in the postseason and the cups (GAME_FLOW §3.3, slice W2b §5). */
export interface Moment {
  kind: 'post' | 'draw' | 'out' | 'over';
  title: string;
  lines: string[];
  day: number;
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
  kind: 'start' | 'result' | 'end' | 'draw' | 'post' | 'news';
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
  mode: 'watch' | 'simulate' | 'keyMoments';
  /** Play-ins, playoffs, Finals and cup ties so far (slice W2b). */
  ties?: Tie[];
  /** Knockout rounds already made, by competition and round (so each is made once). */
  made?: Record<string, true>;
  /** What Continue stopped for, until you read it. */
  moment?: Moment | null;
  /** A season started before cups existed (a W2a save) has none. */
  noCups?: true;
}

/** A season gone by (slice W2b §7): kept small. */
export interface SeasonArchive {
  season: number;
  /** Final regular-season tables: [club, won, lost, points for, points against], in order. */
  tables: Record<string, [string, number, number, number, number][]>;
  /** Who won what: a league's champion (its title), the Big League, each cup. */
  champions: Record<string, string>;
  promoted: string[];
  relegated: string[];
  licenceLost: string[];
  wildcards: string[];
  /** Every game: [competition, day, home, away, home score, away score, stage or ''], in order. */
  results: [string, number, string, string, number, number, string][];
  /** Box scores kept: your games and every Final, by the game's place in `results`. */
  boxes: Record<number, [BoxSide, BoxSide]>;
  /** Your club that season. */
  human?: string;
}
