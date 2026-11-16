// Draft rules: budget, roster size, position-group minimums, free and snake modes.
// State is immutable so React can hold it directly. Two teams for a single match; any number for a
// league (the Quick League's 8-team snake draft).

import { positionGroup, type PositionGroup } from '../engine/ratings';
import type { Player, Team } from '../engine/types';
import { BUDGET } from './pricing';
import type { PoolPlayer } from './pool';

export const ROSTER_SIZE = 12;
export const MIN_PER_GROUP = 2;
export const GROUPS: PositionGroup[] = ['guard', 'wing', 'big'];

export type DraftMode = 'free' | 'snake';
export type Controller = 'human' | 'ai';

export interface DraftTeam {
  name: string;
  abbr: string;
  controller: Controller;
  picks: string[];
  budgetLeft: number;
}

export interface DraftState {
  mode: DraftMode;
  pool: PoolPlayer[];
  /** playerId → team index */
  owner: Record<string, number>;
  teams: DraftTeam[];
  /** Number of picks made so far (snake order). */
  pickNo: number;
  /** Snake: the first round's order of team indexes (the next round reverses it, and so on). */
  order: number[];
}

export type TeamSetup = Pick<DraftTeam, 'name' | 'abbr' | 'controller'>;

export function createDraft(mode: DraftMode, pool: PoolPlayer[], teams: readonly TeamSetup[], budget = BUDGET, order: number[] = teams.map((_, i) => i)): DraftState {
  return {
    mode,
    pool,
    owner: {},
    teams: teams.map((t) => ({ ...t, picks: [], budgetLeft: budget })),
    pickNo: 0,
    order,
  };
}

export function findPool(state: DraftState, id: string): PoolPlayer {
  const p = state.pool.find((x) => x.player.id === id);
  if (!p) throw new Error(`Unknown player ${id}`);
  return p;
}

export function groupCounts(state: DraftState, team: number): Record<PositionGroup, number> {
  const counts: Record<PositionGroup, number> = { guard: 0, wing: 0, big: 0 };
  for (const id of state.teams[team].picks) counts[positionGroup(findPool(state, id).player.position)]++;
  return counts;
}

/**
 * Snake order: the first round in `order`, the next reversed, and so on (two teams: 0,1,1,0,0,1…),
 * skipping a team that is already full.
 */
export function currentTurn(state: DraftState): number | null {
  if (isComplete(state)) return null;
  if (state.mode === 'free') return null;
  const n = state.teams.length;
  for (let k = state.pickNo; k < state.pickNo + n * 2; k++) {
    const round = Math.floor(k / n);
    const at = k % n;
    const turn = state.order[round % 2 === 0 ? at : n - 1 - at];
    if (state.teams[turn].picks.length < ROSTER_SIZE) return turn;
  }
  return null;
}

export function isTeamComplete(state: DraftState, team: number): boolean {
  return state.teams[team].picks.length >= ROSTER_SIZE;
}

export function isComplete(state: DraftState): boolean {
  return state.teams.every((_, i) => isTeamComplete(state, i));
}

/**
 * What `n` more players will cost at least, from what is still on the market (excluding one id).
 * Two teams: the cheapest `n`. More teams (a league): every team's remaining slots will use up the
 * cheapest R players there are (R: all teams' open slots), shared out as a snake draft shares them:
 * this team's `n` at evenly spread ranks among those R. Exact by the last round, fair before it.
 */
function cheapestFill(state: DraftState, n: number, excludeId: string, team: number): number {
  if (n <= 0) return 0;
  const prices = state.pool
    .filter((p) => !(p.player.id in state.owner) && p.player.id !== excludeId)
    .map((p) => p.price)
    .sort((a, b) => a - b);
  if (state.teams.length <= 2) return prices.slice(0, n).reduce((s, x) => s + x, 0);
  const open = state.teams.reduce((s, t, i) => s + (i === team ? n : Math.max(0, ROSTER_SIZE - t.picks.length)), 0);
  const upTo = Math.min(prices.length, open);
  let sum = 0;
  for (let j = 1; j <= n; j++) sum += prices[Math.min(upTo, Math.ceil((j * upTo) / n)) - 1] ?? 0;
  return sum;
}

export interface PickCheck {
  ok: boolean;
  reason?: string;
}

export function canPick(state: DraftState, team: number, id: string): PickCheck {
  const t = state.teams[team];
  if (id in state.owner) return { ok: false, reason: 'Already signed' };
  if (t.picks.length >= ROSTER_SIZE) return { ok: false, reason: 'Roster full' };
  if (state.mode === 'snake' && currentTurn(state) !== team) return { ok: false, reason: 'Not your pick' };
  const p = findPool(state, id);
  if (p.price > t.budgetLeft) return { ok: false, reason: 'Too expensive' };
  const slotsAfter = ROSTER_SIZE - t.picks.length - 1;
  if (t.budgetLeft - p.price < cheapestFill(state, slotsAfter, id, team)) {
    return { ok: false, reason: 'Would leave too little budget to fill the roster' };
  }
  const counts = groupCounts(state, team);
  counts[positionGroup(p.player.position)]++;
  const stillNeeded = GROUPS.reduce((s, g) => s + Math.max(0, MIN_PER_GROUP - counts[g]), 0);
  if (stillNeeded > slotsAfter) return { ok: false, reason: `Need at least ${MIN_PER_GROUP} guards, wings and bigs` };
  return { ok: true };
}

export function pick(state: DraftState, team: number, id: string): DraftState {
  const check = canPick(state, team, id);
  if (!check.ok) throw new Error(check.reason);
  const p = findPool(state, id);
  const teams = [...state.teams];
  teams[team] = { ...teams[team], picks: [...teams[team].picks, id], budgetLeft: teams[team].budgetLeft - p.price };
  return { ...state, teams, owner: { ...state.owner, [id]: team }, pickNo: state.pickNo + 1 };
}

/** Releases a player back to the market (free draft only). */
export function release(state: DraftState, team: number, id: string): DraftState {
  if (state.mode !== 'free' || state.owner[id] !== team) return state;
  const p = findPool(state, id);
  const teams = [...state.teams];
  teams[team] = { ...teams[team], picks: teams[team].picks.filter((x) => x !== id), budgetLeft: teams[team].budgetLeft + p.price };
  const owner = { ...state.owner };
  delete owner[id];
  return { ...state, teams, owner, pickNo: state.pickNo - 1 };
}

/** Converts a drafted roster into an engine Team, fixing duplicate jersey numbers. */
export function toTeam(state: DraftState, team: number, id: string): Team {
  const t = state.teams[team];
  const used = new Set<number>();
  const players: Player[] = t.picks.map((pid) => {
    const base = findPool(state, pid).player;
    let number = base.number;
    while (used.has(number)) number = (number + 1) % 100;
    used.add(number);
    return { ...base, number };
  });
  return { id, name: t.name, abbr: t.abbr, players, execution: 1 };
}
