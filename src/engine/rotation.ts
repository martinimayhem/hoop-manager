// Automatic substitutions at dead balls: tired players, foul trouble, foul-outs,
// and starters coming back once rested. Follows the game plan's priority order.

import { positionGroup, positionIndex } from './ratings';
import { emit, playerOf } from './state';
import type { MatchState, Side, SubReason } from './types';

const SUB_OUT_ENERGY = 58;
const CLOSING_SUB_OUT_ENERGY = 35;
const SUB_IN_ENERGY = 72;
const STARTER_RETURN_ENERGY = 88;
const CLOSING_STARTER_RETURN_ENERGY = 60;
const CLOSING_SECONDS = 300;

function isClosing(s: MatchState): boolean {
  return s.quarter >= 4 && s.clock <= CLOSING_SECONDS;
}

/** Q1: 2 fouls, Q2: 3, Q3: 4, Q4: 5 (until closing time), overtime: never. */
export function inFoulTrouble(s: MatchState, side: Side, id: string): boolean {
  if (s.quarter >= 5 || (s.quarter === 4 && isClosing(s))) return false;
  return s.teams[side].players[id].fouls >= s.quarter + 1;
}

export function sortLineup(s: MatchState, side: Side): void {
  const team = s.teams[side];
  team.lineup.sort((a, b) => positionIndex(playerOf(s, side, a).position) - positionIndex(playerOf(s, side, b).position));
}

function fit(s: MatchState, side: Side, outId: string, inId: string): number {
  const a = playerOf(s, side, outId).position;
  const b = playerOf(s, side, inId).position;
  if (a === b) return 3;
  if (positionGroup(a) === positionGroup(b)) return 2;
  return Math.abs(positionIndex(a) - positionIndex(b)) === 1 ? 1 : 0;
}

function substitute(s: MatchState, side: Side, outId: string, inId: string, reason: SubReason): void {
  const team = s.teams[side];
  team.lineup[team.lineup.indexOf(outId)] = inId;
  sortLineup(s, side);
  emit(s, { type: 'sub', side, inId, outId, reason });
}

/** Best available bench player to replace `outId`, or null. `forced` relaxes the energy and depth rules. */
function findReplacement(s: MatchState, side: Side, outId: string, forced: boolean): string | null {
  const team = s.teams[side];
  const order = [...team.plan.starters, ...team.plan.bench];
  const everyone = team.team.players.map((p) => p.id);
  const pool = forced ? [...order, ...everyone.filter((id) => !order.includes(id))] : order;
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const id of pool) {
    const ps = team.players[id];
    if (team.lineup.includes(id) || ps.fouledOut) continue;
    if (!forced && (ps.energy < SUB_IN_ENERGY || inFoulTrouble(s, side, id))) continue;
    const priority = order.indexOf(id);
    const score = fit(s, side, outId, id) * 2 - (priority < 0 ? 30 : priority * 0.25) + ps.energy / 25 - (inFoulTrouble(s, side, id) ? 5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

export function updateRotation(s: MatchState, side: Side): void {
  const team = s.teams[side];
  const closing = isClosing(s);

  // 1. Take off fouled-out, foul-troubled and exhausted players.
  for (const id of [...team.lineup]) {
    const ps = team.players[id];
    let reason: SubReason | null = null;
    if (ps.fouledOut) reason = ps.ejected ? 'ejected' : 'foulOut';
    else if (inFoulTrouble(s, side, id)) reason = 'fouls';
    else if (ps.energy < (closing ? CLOSING_SUB_OUT_ENERGY : SUB_OUT_ENERGY)) reason = 'fatigue';
    if (!reason) continue;
    const replacement = findReplacement(s, side, id, reason === 'foulOut' || reason === 'ejected');
    if (replacement) substitute(s, side, id, replacement, reason);
  }

  // 2. Bring rested starters back in for the lowest-priority player at a similar position.
  const returnEnergy = closing ? CLOSING_STARTER_RETURN_ENERGY : STARTER_RETURN_ENERGY;
  for (const starter of team.plan.starters) {
    const ps = team.players[starter];
    if (team.lineup.includes(starter) || ps.fouledOut || inFoulTrouble(s, side, starter)) continue;
    if (ps.energy < returnEnergy) continue;
    let outId: string | null = null;
    let bestScore = -Infinity;
    for (const id of team.lineup) {
      if (team.plan.starters.includes(id)) continue;
      const score = fit(s, side, id, starter) * 2 + team.plan.bench.indexOf(id) * 0.25 - team.players[id].energy / 50;
      if (score > bestScore) {
        bestScore = score;
        outId = id;
      }
    }
    if (outId) substitute(s, side, outId, starter, 'rotation');
  }
}
