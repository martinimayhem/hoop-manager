// Small shared helpers for reading and stamping MatchState.

import { composite, fatigueFactor, slotFactor, type Composite } from './ratings';
import type { MatchEvent, MatchState, Player, PlayerGameState, Side, Team } from './types';

export function other(side: Side): Side {
  return side === 0 ? 1 : 0;
}

export function emit(s: MatchState, ev: MatchEvent): void {
  s.events.push({ ...ev, quarter: s.quarter, clock: s.clock, score: [s.teams[0].score, s.teams[1].score] });
}

const rosterCache = new WeakMap<Team, Map<string, Player>>();

export function rosterMap(team: Team): Map<string, Player> {
  let map = rosterCache.get(team);
  if (!map) {
    map = new Map(team.players.map((p) => [p.id, p]));
    rosterCache.set(team, map);
  }
  return map;
}

export function playerOf(s: MatchState, side: Side, id: string): Player {
  const p = rosterMap(s.teams[side].team).get(id);
  if (!p) throw new Error(`Unknown player ${id} on side ${side}`);
  return p;
}

export function pstate(s: MatchState, side: Side, id: string): PlayerGameState {
  return s.teams[side].players[id];
}

export type RatingKey = keyof Composite;

/** A player's rating right now: base composite × fatigue × out-of-position penalty. */
export function eff(s: MatchState, side: Side, id: string, key: RatingKey): number {
  const player = playerOf(s, side, id);
  const slot = s.teams[side].lineup.indexOf(id);
  const factor = fatigueFactor(pstate(s, side, id).energy) * (slot >= 0 ? slotFactor(player.position, slot) : 1);
  return composite(player)[key] * factor;
}

export function teamAvg(s: MatchState, side: Side, key: RatingKey): number {
  const lineup = s.teams[side].lineup;
  return lineup.reduce((sum, id) => sum + eff(s, side, id, key), 0) / lineup.length;
}

/** Weighted towards the best players on court (for things one or two players dominate, like boards). */
export function teamTop(s: MatchState, side: Side, key: RatingKey): number {
  const values = s.teams[side].lineup.map((id) => eff(s, side, id, key)).sort((a, b) => b - a);
  const weights = [0.3, 0.25, 0.2, 0.15, 0.1];
  return values.reduce((sum, v, i) => sum + v * weights[i], 0);
}

/** The on-court player the offence would go to in a big moment: best overall, discounted for fatigue. */
export function starOnCourt(s: MatchState, side: Side): string {
  return bestOnCourt(s, side, 'overall');
}

/** The on-court player with the highest value of a rating. */
export function bestOnCourt(s: MatchState, side: Side, key: RatingKey): string {
  let best = s.teams[side].lineup[0];
  let bestValue = -Infinity;
  for (const id of s.teams[side].lineup) {
    const v = eff(s, side, id, key);
    if (v > bestValue) {
      bestValue = v;
      best = id;
    }
  }
  return best;
}
