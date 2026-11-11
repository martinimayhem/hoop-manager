// Core data types for the match engine. Pure data: no behaviour lives here.

import type { CourtSide, ShotZone } from './court';

export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';
export const POSITIONS: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

/** All ratings on a 1–99 scale. Height and weight live on the player as real values. */
export interface Attributes {
  speed: number;
  stamina: number;
  shooting: number; // mid-range
  three: number;
  freeThrow: number;
  layup: number;
  dunk: number;
  passing: number;
  dribbling: number;
  rebounding: number;
  tactics: number; // basketball IQ / defensive awareness
  injuryProneness: number;
  potential: number;
}

export interface Player {
  id: string;
  name: string;
  number: number;
  position: Position;
  archetype: string;
  heightCm: number;
  weightKg: number;
  attrs: Attributes;
}

export interface Team {
  id: string;
  name: string;
  abbr: string;
  players: Player[];
  /** How well the team executes its tactics. 1.0 = neutral; Phase 4 derives this from the head coach. */
  execution: number;
}

// ---------------------------------------------------------------------------
// Game plan

export type OffensiveFocus = 'inside' | 'balanced' | 'three' | 'pickAndRoll' | 'fastBreak';
export type DefenceScheme = 'man' | 'zone' | 'press';
export type Tempo = 'slow' | 'normal' | 'fast';

export const OFFENSIVE_FOCI: readonly OffensiveFocus[] = ['inside', 'balanced', 'three', 'pickAndRoll', 'fastBreak'];
export const DEFENCE_SCHEMES: readonly DefenceScheme[] = ['man', 'zone', 'press'];
export const TEMPOS: readonly Tempo[] = ['slow', 'normal', 'fast'];

export type KeyMatchup =
  | { kind: 'none' }
  | { kind: 'assign'; defenderId: string; targetId: string }
  | { kind: 'double'; targetId: string };

export interface GamePlan {
  /** Exactly 5 player ids. */
  starters: string[];
  /** Bench in minutes-priority order. Players not listed only play when nobody else can. */
  bench: string[];
  offence: OffensiveFocus;
  defence: DefenceScheme;
  tempo: Tempo;
  keyMatchup: KeyMatchup;
}

// ---------------------------------------------------------------------------
// Match state

/** 0 = home, 1 = away. */
export type Side = 0 | 1;

export interface PlayerStats {
  seconds: number;
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  /** Technical fouls. */
  tf: number;
  plusMinus: number;
}

export interface PlayerGameState {
  id: string;
  /** 0–100. Drains on court, recovers on the bench. */
  energy: number;
  fouls: number;
  fouledOut: boolean;
  /** Technical fouls; at two he is ejected (and counts as out, like a player who fouled out). */
  technicals: number;
  ejected: boolean;
  stats: PlayerStats;
}

export interface TeamExtras {
  possessions: number;
  paintPts: number;
  fastBreakPts: number;
  secondChancePts: number;
}

export interface TeamGameState {
  team: Team;
  plan: GamePlan;
  players: Record<string, PlayerGameState>;
  /** The five on court, kept sorted by position (slot 0 = PG … slot 4 = C). */
  lineup: string[];
  score: number;
  quarterPoints: number[];
  quarterFouls: number;
  /** Team fouls in the last two minutes of this period (NBA: the second one there is a penalty). */
  lateFouls: number;
  timeoutsLeft: number;
  /** Timeouts used in the last two minutes of Q4 (FIBA allows two). */
  lateTimeoutsUsed: number;
  extras: TeamExtras;
  /** -1..1 from team talks; nudges shot quality and fades over a quarter. */
  morale: number;
  /** Technical fouls on the coach; at two he is ejected and his assistant takes over. */
  coachTechnicals: number;
  coachEjected: boolean;
}

export type ShotType =
  | 'post'
  | 'drive'
  | 'pnrRoll'
  | 'pnrPull'
  | 'mid'
  | 'three'
  | 'fastBreak'
  | 'pressBreak'
  | 'putback';

export type TurnoverCause = 'steal' | 'badPass' | 'travel' | 'offensiveFoul' | 'pressTrap' | 'shotClock';
export type SubReason = 'fatigue' | 'fouls' | 'foulOut' | 'ejected' | 'rotation';

export type MatchEvent =
  | { type: 'quarterStart'; quarter: number }
  | { type: 'quarterEnd'; quarter: number }
  | { type: 'gameEnd'; winner: Side }
  | {
      type: 'shot';
      side: Side;
      shooterId: string;
      shotType: ShotType;
      /** Where on the floor it was taken: the zone decides the points. */
      zone: ShotZone;
      /** Which side of the floor, as the shooter attacks the basket: left is the y < MID_Y side. */
      courtSide: CourtSide;
      points: 2 | 3;
      made: boolean;
      /** Taken with the shot clock nearly out. */
      lateClock?: boolean;
      /** Taken as the quarter ran out. */
      buzzer?: boolean;
      assistId?: string;
      blockerId?: string;
      /** The block came from behind, on a break with nobody back. */
      chaseDown?: boolean;
      andOne?: boolean;
      dunk?: boolean;
    }
  /** After a defensive rebound, `back` is how many of the other side got back in time: 0 to 3. */
  | { type: 'rebound'; side: Side; playerId: string; offensive: boolean; back?: number }
  /** After a steal, `back` is how many of the side that lost it got back in time: 0 to 3. */
  | { type: 'turnover'; side: Side; playerId: string; cause: TurnoverCause; stealerId?: string; back?: number }
  | { type: 'foul'; side: Side; playerId: string; onId: string; shooting: boolean; bonus: boolean }
  /** `technical`: the one shot for a technical foul (nobody in the lane, and play goes on as before). */
  | { type: 'freeThrow'; side: Side; shooterId: string; made: boolean; attempt: number; of: number; technical?: boolean }
  /** A technical foul on `side`: on a player, or with no player on the coach. A second one is an ejection. */
  | { type: 'technical'; side: Side; playerId?: string; ejected?: boolean }
  /** The coach of `side` argues the call: the bench is fired up, or (technical: true) the official has heard enough. */
  | { type: 'argue'; side: Side; technical: boolean }
  | { type: 'fastBreak'; side: Side; leaderId: string }
  /** Out of a rebound or a steal they got ahead of the defence, and whether the ball handler takes it. */
  | { type: 'transition'; side: Side; handlerId: string; situation: TransitionSituation; attack: boolean }
  /** How an attack in transition plays out: the lane closes, or the last defender commits to the ball. */
  | { type: 'transitionRead'; side: Side; handlerId: string; read: 'laneClosed' | 'defenderCommits'; then: TransitionFinish }
  | { type: 'pressBroken'; side: Side; handlerId: string }
  | { type: 'doubleTeam'; side: Side; targetId: string; passedToId?: string }
  | { type: 'sub'; side: Side; inId: string; outId: string; reason: SubReason }
  | { type: 'foulOut'; side: Side; playerId: string }
  /** `stoppedRun`: the other side had the momentum, and this is what the timeout was for. */
  | { type: 'timeout'; side: Side; remaining: number; stoppedRun?: boolean }
  | { type: 'playCall'; side: Side; role: 'offence' | 'defence'; call: OffenceCall | DefenceCall };

/** Every event is stamped with when it happened, and the score and the momentum after it. */
export type TimedEvent = MatchEvent & { quarter: number; clock: number; score: [number, number]; momentum?: number };

export interface RngState {
  state: number;
}

export type Transition = 'none' | 'rebound' | 'steal';

/** What the offence has in transition: an open lane to the rim, or more attackers than defenders back. */
export type TransitionSituation = 'lane' | 'twoOnOne' | 'threeOnTwo';
/**
 * What the side that has just won the ball has in front of it, decided the moment it wins it: who
 * pushes it, the numbers, and whether he goes; or no advantage at all, the defence back in time.
 */
export type TransitionPlan =
  | { handlerId: string; situation: TransitionSituation; attack: boolean }
  | { situation: 'none' };
/** How many defenders got back for each situation. */
export const DEFENDERS_BACK: Record<TransitionSituation | 'none', number> = { lane: 0, twoOnOne: 1, threeOnTwo: 2, none: 3 };
/** What the ball handler does with it: finish (through contact if the lane closed), dish to the open man, kick out for three, or pull back out. */
export type TransitionFinish = 'finish' | 'dish' | 'kick' | 'pullBack';

/** A set play the offence calls for one possession. */
export type OffenceCall = 'isoStar' | 'pickAndRoll' | 'kickOut' | 'postUp' | 'runClock';
/** A defensive call for one possession. */
export type DefenceCall = 'doubleStar' | 'packPaint' | 'denyThree' | 'foul';

export interface PossessionCalls {
  offence?: OffenceCall;
  defence?: DefenceCall;
  /** This side's coach argues the first foul called against his team this possession. */
  argue?: Side;
}

export interface MatchState {
  seed: number;
  rng: RngState;
  quarter: number; // 1–4, 5+ = overtime
  clock: number; // seconds left in the period
  possession: Side;
  /** Which side won the opening tip; drives the quarter-start possession arrow. */
  tipWinner: Side;
  teams: [TeamGameState, TeamGameState];
  /** -1..1, positive favours home. */
  momentum: number;
  /** How the current possession started, for fast-break chances. */
  transition: Transition;
  /** What the side that just won the ball has in front of it, decided as it won it. */
  nextTransition: TransitionPlan | null;
  /** Which coaches are people: they argue a call when they choose to; the others now and then on their own. */
  humanCoach?: [boolean, boolean];
  /** Set plays called for the next possession only (clutch moments). */
  calls: PossessionCalls | null;
  events: TimedEvent[];
  finished: boolean;
}
