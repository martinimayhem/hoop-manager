// Energy drain on court and recovery on the bench.

import { playerOf } from './state';
import type { MatchState, Side } from './types';

const DRAIN_PER_SECOND = 0.062; // ≈3.7 energy per minute on court at normal tempo
const RECOVER_PER_SECOND = 0.075; // ≈4.5 per minute on the bench
export const QUARTER_BREAK_RECOVERY = 6;
export const HALFTIME_RECOVERY = 18;

const TEMPO_PACE = { slow: 0.9, normal: 1, fast: 1.08 } as const;

/**
 * How hard the game works a team's players. The pace both teams play at tires everyone
 * (a fast team drags a slow team into a track meet); pressing and running cost extra on top.
 */
export function workload(s: MatchState, side: Side): number {
  const plan = s.teams[side].plan;
  const pace = (TEMPO_PACE[s.teams[0].plan.tempo] + TEMPO_PACE[s.teams[1].plan.tempo]) / 2;
  let w = pace * TEMPO_PACE[plan.tempo];
  if (plan.defence === 'press') w *= 1.3;
  if (plan.offence === 'fastBreak') w *= 1.1;
  return w;
}

/** Stamina 50 → ×1.08, 80 → ×0.91, 95 → ×0.83. */
export function staminaFactor(stamina: number): number {
  return 1.355 - 0.0055 * stamina;
}

/** Advances time for both teams: drains the five on court, recovers the bench, counts minutes. */
export function tickFatigue(s: MatchState, seconds: number): void {
  for (const side of [0, 1] as const) {
    const team = s.teams[side];
    const w = workload(s, side);
    for (const id of team.team.players.map((p) => p.id)) {
      const ps = team.players[id];
      if (team.lineup.includes(id)) {
        ps.energy -= seconds * DRAIN_PER_SECOND * w * staminaFactor(playerOf(s, side, id).attrs.stamina);
        ps.stats.seconds += seconds;
      } else {
        ps.energy += seconds * RECOVER_PER_SECOND;
      }
      ps.energy = Math.max(0, Math.min(100, ps.energy));
    }
  }
}

/** Extra drain for the player who carried the possession (usage). */
export function usageDrain(s: MatchState, side: Side, id: string, amount = 0.3): void {
  const ps = s.teams[side].players[id];
  ps.energy = Math.max(0, ps.energy - amount);
}

export function restAll(s: MatchState, amount: number): void {
  for (const team of s.teams) {
    for (const ps of Object.values(team.players)) ps.energy = Math.min(100, ps.energy + amount);
  }
}
