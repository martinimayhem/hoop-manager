// Match lifecycle: create, step one possession at a time, or simulate to the end.
// Stepping lets the UI (Phase 2) pause for timeouts and change the game plan.

import { HALFTIME_RECOVERY, QUARTER_BREAK_RECOVERY, restAll } from './fatigue';
import { playPossession } from './possession';
import { composite } from './ratings';
import { chance, createRng } from './rng';
import { sortLineup, updateRotation } from './rotation';
import { emit, other, playerOf } from './state';
import { buildBoxScore, emptyExtras, emptyStats, type BoxScore } from './stats';
import type { GamePlan, MatchState, Side, Team, TeamGameState, TimedEvent } from './types';

export const QUARTER_SECONDS = 720;
export const OVERTIME_SECONDS = 300;
/** FIBA rules: 2 timeouts in the first half, 3 in the second (max 2 in the last 2 minutes), 1 per overtime. Unused ones expire. */
export const TIMEOUTS_FIRST_HALF = 2;
export const TIMEOUTS_SECOND_HALF = 3;
export const TIMEOUTS_OVERTIME = 1;
export const LATE_TIMEOUT_LIMIT = 2;
const LATE_WINDOW_SECONDS = 120;

/** How many timeouts a team gets for the period it is in (for display). */
export function timeoutAllowance(quarter: number): number {
  return quarter <= 2 ? TIMEOUTS_FIRST_HALF : quarter <= 4 ? TIMEOUTS_SECOND_HALF : TIMEOUTS_OVERTIME;
}

function inLateWindow(s: MatchState): boolean {
  return s.quarter === 4 && s.clock <= LATE_WINDOW_SECONDS;
}

/** Whether a side may call a timeout right now. */
export function canCallTimeout(s: MatchState, side: Side): boolean {
  const team = s.teams[side];
  if (s.finished || team.timeoutsLeft <= 0) return false;
  return !(inLateWindow(s) && team.lateTimeoutsUsed >= LATE_TIMEOUT_LIMIT);
}

/** Builds a game plan with a sensible rotation: best player per position starts, rest by overall. */
export function makePlan(team: Team, tactics: Partial<Omit<GamePlan, 'starters' | 'bench'>> & Partial<Pick<GamePlan, 'starters' | 'bench'>> = {}): GamePlan {
  const byOverall = [...team.players].sort((a, b) => composite(b).overall - composite(a).overall);
  const starters =
    tactics.starters ??
    (['PG', 'SG', 'SF', 'PF', 'C'] as const).map((pos) => {
      const p = byOverall.find((x) => x.position === pos) ?? byOverall[0];
      byOverall.splice(byOverall.indexOf(p), 1);
      return p.id;
    });
  const bench = tactics.bench ?? byOverall.filter((p) => !starters.includes(p.id)).map((p) => p.id);
  return {
    starters,
    bench,
    offence: tactics.offence ?? 'balanced',
    defence: tactics.defence ?? 'man',
    tempo: tactics.tempo ?? 'normal',
    keyMatchup: tactics.keyMatchup ?? { kind: 'none' },
  };
}

export function validatePlan(team: Team, plan: GamePlan): void {
  const ids = new Set(team.players.map((p) => p.id));
  if (plan.starters.length !== 5 || new Set(plan.starters).size !== 5) throw new Error(`${team.abbr}: need exactly 5 distinct starters`);
  for (const id of [...plan.starters, ...plan.bench]) if (!ids.has(id)) throw new Error(`${team.abbr}: unknown player ${id}`);
  const km = plan.keyMatchup;
  if (km.kind === 'assign' && !ids.has(km.defenderId)) throw new Error(`${team.abbr}: unknown key-matchup defender ${km.defenderId}`);
}

function teamState(team: Team, plan: GamePlan): TeamGameState {
  validatePlan(team, plan);
  return {
    team,
    plan,
    players: Object.fromEntries(team.players.map((p) => [p.id, { id: p.id, energy: 100, fouls: 0, fouledOut: false, stats: emptyStats() }])),
    lineup: [...plan.starters],
    score: 0,
    quarterPoints: [0, 0, 0, 0],
    quarterFouls: 0,
    lateFouls: 0,
    timeoutsLeft: TIMEOUTS_FIRST_HALF,
    lateTimeoutsUsed: 0,
    extras: emptyExtras(),
    morale: 0,
  };
}

export function createMatch(home: Team, away: Team, homePlan: GamePlan, awayPlan: GamePlan, seed: number): MatchState {
  const s: MatchState = {
    seed,
    rng: createRng(seed),
    quarter: 1,
    clock: QUARTER_SECONDS,
    possession: 0,
    tipWinner: 0,
    teams: [teamState(home, homePlan), teamState(away, awayPlan)],
    momentum: 0,
    transition: 'none',
    nextTransition: null,
    calls: null,
    events: [],
    finished: false,
  };
  sortLineup(s, 0);
  sortLineup(s, 1);
  // Opening tip: the taller centre has the edge.
  const jumper = (side: Side) => composite(playerOf(s, side, s.teams[side].lineup[4])).height;
  s.tipWinner = chance(s.rng, 0.5 + (jumper(0) - jumper(1)) * 0.01) ? 0 : 1;
  s.possession = s.tipWinner;
  emit(s, { type: 'quarterStart', quarter: 1 });
  return s;
}

/** Advances the match by one possession (or a period break). Returns the events it produced. */
export function stepPossession(s: MatchState): TimedEvent[] {
  if (s.finished) return [];
  const start = s.events.length;
  if (s.clock <= 0) {
    endPeriod(s);
  } else {
    playPossession(s);
    updateRotation(s, 0);
    updateRotation(s, 1);
  }
  return s.events.slice(start);
}

function endPeriod(s: MatchState): void {
  emit(s, { type: 'quarterEnd', quarter: s.quarter });
  const [h, a] = [s.teams[0].score, s.teams[1].score];
  if (s.quarter >= 4 && h !== a) {
    s.finished = true;
    emit(s, { type: 'gameEnd', winner: h > a ? 0 : 1 });
    return;
  }
  s.quarter++;
  s.clock = s.quarter <= 4 ? QUARTER_SECONDS : OVERTIME_SECONDS;
  s.transition = 'none';
  restAll(s, s.quarter === 3 ? HALFTIME_RECOVERY : QUARTER_BREAK_RECOVERY);
  for (const team of s.teams) {
    team.quarterFouls = 0;
    team.lateFouls = 0;
    if (s.quarter === 3) team.timeoutsLeft = TIMEOUTS_SECOND_HALF;
    if (s.quarter >= 5) team.timeoutsLeft = TIMEOUTS_OVERTIME;
    if (team.quarterPoints.length < s.quarter) team.quarterPoints.push(0);
  }
  // Possession arrow: Q2/Q3 go to the side that lost the tip, Q4 back to the winner; overtime is a fresh jump.
  if (s.quarter === 2 || s.quarter === 3) s.possession = other(s.tipWinner);
  else if (s.quarter === 4) s.possession = s.tipWinner;
  else s.possession = chance(s.rng, 0.5) ? 0 : 1;
  updateRotation(s, 0);
  updateRotation(s, 1);
  emit(s, { type: 'quarterStart', quarter: s.quarter });
}

/**
 * Replaces a side's game plan mid-match (timeouts, quarter breaks).
 * The new starters take the floor immediately; anyone unavailable is covered by the rotation.
 */
export function setGamePlan(s: MatchState, side: Side, plan: GamePlan): void {
  const team = s.teams[side];
  validatePlan(team.team, plan);
  team.plan = plan;
  const before = [...team.lineup];
  team.lineup = [...plan.starters];
  sortLineup(s, side);
  for (const id of team.lineup) {
    if (!before.includes(id)) {
      const outId = before.find((b) => !team.lineup.includes(b))!;
      before[before.indexOf(outId)] = id;
      emit(s, { type: 'sub', side, inId: id, outId, reason: 'rotation' });
    }
  }
  updateRotation(s, side);
}

export const TIMEOUT_ENERGY = 8;

/**
 * A team calls a timeout at a dead ball: kills the opponent's momentum and gives everyone on court a breather.
 * Returns false if the team may not call one now. Plan changes are made separately with setGamePlan.
 */
export function callTimeout(s: MatchState, side: Side): boolean {
  const team = s.teams[side];
  if (!canCallTimeout(s, side)) return false;
  team.timeoutsLeft--;
  if (inLateWindow(s)) team.lateTimeoutsUsed++;
  s.momentum *= 0.3;
  for (const t of s.teams) for (const id of t.lineup) t.players[id].energy = Math.min(100, t.players[id].energy + TIMEOUT_ENERGY);
  emit(s, { type: 'timeout', side, remaining: team.timeoutsLeft });
  return true;
}

export interface MatchResult {
  state: MatchState;
  box: BoxScore;
  winner: Side;
}

export function simulateMatch(home: Team, away: Team, homePlan: GamePlan, awayPlan: GamePlan, seed: number): MatchResult {
  const s = createMatch(home, away, homePlan, awayPlan, seed);
  let guard = 0;
  while (!s.finished) {
    stepPossession(s);
    if (++guard > 5000) throw new Error('Match did not finish');
  }
  return { state: s, box: buildBoxScore(s), winner: s.teams[0].score > s.teams[1].score ? 0 : 1 };
}
