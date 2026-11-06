// Draft rules: budget, roster size, position-group minimums, free and snake modes.
// State is immutable so React can hold it directly.

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
  owner: Record<string, 0 | 1>;
  teams: [DraftTeam, DraftTeam];
  /** Number of picks made so far (snake order). */
  pickNo: number;
}

export type TeamSetup = Pick<DraftTeam, 'name' | 'abbr' | 'controller'>;

export function createDraft(mode: DraftMode, pool: PoolPlayer[], teams: readonly [TeamSetup, TeamSetup]): DraftState {
  return {
    mode,
    pool,
    owner: {},
    teams: [
      { ...teams[0], picks: [], budgetLeft: BUDGET },
      { ...teams[1], picks: [], budgetLeft: BUDGET },
    ],
    pickNo: 0,
  };
}

export function findPool(state: DraftState, id: string): PoolPlayer {
  const p = state.pool.find((x) => x.player.id === id);
  if (!p) throw new Error(`Unknown player ${id}`);
  return p;
}

export function groupCounts(state: DraftState, team: 0 | 1): Record<PositionGroup, number> {
  const counts: Record<PositionGroup, number> = { guard: 0, wing: 0, big: 0 };
  for (const id of state.teams[team].picks) counts[positionGroup(findPool(state, id).player.position)]++;
  return counts;
}

/** Snake order: 0,1,1,0,0,1,1,0… skipping a team that is already full. */
export function currentTurn(state: DraftState): 0 | 1 | null {
  if (isComplete(state)) return null;
  if (state.mode === 'free') return null;
  const round = Math.floor(state.pickNo / 2);
  const first: 0 | 1 = round % 2 === 0 ? 0 : 1;
  const turn: 0 | 1 = state.pickNo % 2 === 0 ? first : first === 0 ? 1 : 0;
  if (state.teams[turn].picks.length >= ROSTER_SIZE) return turn === 0 ? 1 : 0;
  return turn;
}

export function isTeamComplete(state: DraftState, team: 0 | 1): boolean {
  return state.teams[team].picks.length >= ROSTER_SIZE;
}

export function isComplete(state: DraftState): boolean {
  return isTeamComplete(state, 0) && isTeamComplete(state, 1);
}

/** Cheapest total for `n` more players from what is still on the market (excluding one id). */
function cheapestFill(state: DraftState, n: number, excludeId: string): number {
  if (n <= 0) return 0;
  const prices = state.pool
    .filter((p) => !(p.player.id in state.owner) && p.player.id !== excludeId)
    .map((p) => p.price)
    .sort((a, b) => a - b);
  return prices.slice(0, n).reduce((s, x) => s + x, 0);
}

export interface PickCheck {
  ok: boolean;
  reason?: string;
}

export function canPick(state: DraftState, team: 0 | 1, id: string): PickCheck {
  const t = state.teams[team];
  if (id in state.owner) return { ok: false, reason: 'Already signed' };
  if (t.picks.length >= ROSTER_SIZE) return { ok: false, reason: 'Roster full' };
  if (state.mode === 'snake' && currentTurn(state) !== team) return { ok: false, reason: 'Not your pick' };
  const p = findPool(state, id);
  if (p.price > t.budgetLeft) return { ok: false, reason: 'Too expensive' };
  const slotsAfter = ROSTER_SIZE - t.picks.length - 1;
  if (t.budgetLeft - p.price < cheapestFill(state, slotsAfter, id)) {
    return { ok: false, reason: 'Would leave too little budget to fill the roster' };
  }
  const counts = groupCounts(state, team);
  counts[positionGroup(p.player.position)]++;
  const stillNeeded = GROUPS.reduce((s, g) => s + Math.max(0, MIN_PER_GROUP - counts[g]), 0);
  if (stillNeeded > slotsAfter) return { ok: false, reason: `Need at least ${MIN_PER_GROUP} guards, wings and bigs` };
  return { ok: true };
}

export function pick(state: DraftState, team: 0 | 1, id: string): DraftState {
  const check = canPick(state, team, id);
  if (!check.ok) throw new Error(check.reason);
  const p = findPool(state, id);
  const teams = [...state.teams] as [DraftTeam, DraftTeam];
  teams[team] = { ...teams[team], picks: [...teams[team].picks, id], budgetLeft: teams[team].budgetLeft - p.price };
  return { ...state, teams, owner: { ...state.owner, [id]: team }, pickNo: state.pickNo + 1 };
}

/** Releases a player back to the market (free draft only). */
export function release(state: DraftState, team: 0 | 1, id: string): DraftState {
  if (state.mode !== 'free' || state.owner[id] !== team) return state;
  const p = findPool(state, id);
  const teams = [...state.teams] as [DraftTeam, DraftTeam];
  teams[team] = { ...teams[team], picks: teams[team].picks.filter((x) => x !== id), budgetLeft: teams[team].budgetLeft + p.price };
  const owner = { ...state.owner };
  delete owner[id];
  return { ...state, teams, owner, pickNo: state.pickNo - 1 };
}

/** Converts a drafted roster into an engine Team, fixing duplicate jersey numbers. */
export function toTeam(state: DraftState, team: 0 | 1, id: string): Team {
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
