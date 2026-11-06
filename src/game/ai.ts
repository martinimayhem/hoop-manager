// The AI coach: drafting, choosing a game plan, calling timeouts and adjusting in-game.
// It plays by the same rules as a human and only reads public match information.

import { canCallTimeout, makePlan } from '../engine/match';
import { composite, fatigueFactor, positionGroup } from '../engine/ratings';
import { chance, next, weighted } from '../engine/rng';
import { inFoulTrouble } from '../engine/rotation';
import { other } from '../engine/state';
import {
  DEFENCE_SCHEMES,
  OFFENSIVE_FOCI,
  TEMPOS,
  type DefenceScheme,
  type GamePlan,
  type MatchState,
  type OffensiveFocus,
  type Player,
  type RngState,
  type Side,
  type Team,
  type Tempo,
} from '../engine/types';
import { canPick, currentTurn, findPool, groupCounts, isTeamComplete, pick, ROSTER_SIZE, type DraftState } from './draft';
import { DEFAULT_SCOUT_ACCURACY, scoutAttr, type AttrKey } from './scouting';

// ---------------------------------------------------------------------------
// Draft

/** What the AI believes a player's overall is: the midpoint of its scouting ranges. */
function perceivedOverall(state: DraftState, id: string): number {
  const p = findPool(state, id);
  const keys: AttrKey[] = ['speed', 'shooting', 'three', 'layup', 'passing', 'dribbling', 'rebounding', 'tactics'];
  let error = 0;
  for (const k of keys) {
    const r = scoutAttr(p.player, k, p.hype, DEFAULT_SCOUT_ACCURACY);
    error += (r.lo + r.hi) / 2 - p.player.attrs[k];
  }
  return composite(p.player).overall + error / keys.length;
}

export function aiDraftPick(state: DraftState, team: 0 | 1, rng: RngState): string | null {
  const t = state.teams[team];
  const slotsLeft = ROSTER_SIZE - t.picks.length;
  if (slotsLeft <= 0) return null;
  const counts = groupCounts(state, team);
  const positionsHeld = new Set(t.picks.map((id) => findPool(state, id).player.position));
  const fairShare = t.budgetLeft / slotsLeft;
  const candidates = state.pool.filter((p) => canPick(state, team, p.player.id).ok);
  if (candidates.length === 0) return null;
  let best = candidates[0].player.id;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const group = positionGroup(c.player.position);
    let score = perceivedOverall(state, c.player.id);
    if (counts[group] < 2) score += 4;
    if (counts[group] >= 4) score -= 5 * (counts[group] - 3);
    if (!positionsHeld.has(c.player.position) && t.picks.length < 8) score += 3;
    score -= Math.max(0, c.price - fairShare * 1.8) * 0.45;
    score += next(rng) * 3;
    if (score > bestScore) {
      bestScore = score;
      best = c.player.id;
    }
  }
  return best;
}

/** Fills the AI's whole roster at once (free draft). */
export function aiDraftAll(state: DraftState, team: 0 | 1, rng: RngState): DraftState {
  let s = state;
  while (!isTeamComplete(s, team)) {
    const id = aiDraftPick(s, team, rng);
    if (!id) break;
    s = pick(s, team, id);
  }
  return s;
}

/** Makes AI picks in a snake draft until it is a human's turn (or the draft is over). */
export function aiSnakeTurns(state: DraftState, rng: RngState): DraftState {
  let s = state;
  for (let turn = currentTurn(s); turn !== null && s.teams[turn].controller === 'ai'; turn = currentTurn(s)) {
    const id = aiDraftPick(s, turn, rng);
    if (!id) break;
    s = pick(s, turn, id);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Game plan

export interface Tendencies {
  offence: Record<OffensiveFocus, number>;
  defence: Record<DefenceScheme, number>;
  tempo: Record<Tempo, number>;
}

interface Profile {
  three: number;
  inside: number;
  speed: number;
  stamina: number;
  iq: number;
  playmaking: number;
  ballSecurity: number;
  rebounding: number;
  rimProtection: number;
  perimeterD: number;
  bestHandler: number;
  bestRoller: number;
}

function starters(team: Team): Player[] {
  const plan = makePlan(team);
  return plan.starters.map((id) => team.players.find((p) => p.id === id)!);
}

export function profile(team: Team): Profile {
  const five = starters(team);
  const avg = (f: (p: Player) => number) => five.reduce((s, p) => s + f(p), 0) / five.length;
  const c = (p: Player) => composite(p);
  const top3 = (f: (p: Player) => number) => [...five].map(f).sort((a, b) => b - a).slice(0, 3).reduce((s, x) => s + x, 0) / 3;
  return {
    three: top3((p) => c(p).three),
    inside: top3((p) => c(p).insideScoring),
    speed: avg((p) => p.attrs.speed),
    stamina: avg((p) => p.attrs.stamina),
    iq: avg((p) => p.attrs.tactics),
    playmaking: avg((p) => c(p).playmaking),
    ballSecurity: avg((p) => c(p).ballSecurity),
    rebounding: avg((p) => c(p).rebounding),
    rimProtection: Math.max(...five.map((p) => c(p).rimProtection)),
    perimeterD: avg((p) => c(p).perimeterD),
    bestHandler: Math.max(...five.map((p) => c(p).playmaking)),
    bestRoller: Math.max(...five.filter((p) => p.position === 'PF' || p.position === 'C').map((p) => c(p).rollFinish), 0),
  };
}

function softmax<K extends string>(scores: Record<K, number>, temperature: number): Record<K, number> {
  const keys = Object.keys(scores) as K[];
  const exps = keys.map((k) => Math.exp(scores[k] / temperature));
  const total = exps.reduce((s, x) => s + x, 0);
  return Object.fromEntries(keys.map((k, i) => [k, exps[i] / total])) as Record<K, number>;
}

/** How likely a coach of this roster is to pick each option. Used by the AI and by scouting reports. */
export function planTendencies(team: Team, opponent?: Team): Tendencies {
  const me = profile(team);
  const opp = opponent ? profile(opponent) : null;
  const athleticism = (me.speed + me.stamina) / 2;

  const offence: Record<OffensiveFocus, number> = {
    balanced: 4,
    three: (me.three - 68) * 0.9 + (me.playmaking - 65) * 0.3 - (opp ? (opp.perimeterD - 70) * 0.3 : 0),
    inside: (me.inside - 72) * 0.9 + (me.rebounding - 65) * 0.3 - (opp ? (opp.rimProtection - 80) * 0.4 : 0),
    pickAndRoll: (me.bestHandler - 72) * 0.5 + (me.bestRoller - 72) * 0.5 + (opp ? (65 - opp.speed) * 0.2 : 0),
    fastBreak: (me.speed - 72) * 0.9 + (me.stamina - 75) * 0.3 + (opp ? (me.speed - opp.speed) * 0.3 : 0),
  };
  const defence: Record<DefenceScheme, number> = {
    man: 4 + (me.perimeterD - 68) * 0.3,
    zone: (me.rimProtection - 78) * 0.3 + (opp ? (opp.inside - opp.three) * 0.35 : 0),
    press: (athleticism - 78) * 0.4 + (opp ? (68 - opp.ballSecurity) * 0.6 : -2),
  };
  const tempo: Record<Tempo, number> = {
    normal: 3,
    fast: (athleticism - 74) * 0.6 + (opp ? (athleticism - (opp.speed + opp.stamina) / 2) * 0.3 : 0),
    slow: (72 - athleticism) * 0.6 + (me.iq - 72) * 0.3,
  };
  return { offence: softmax(offence, 3), defence: softmax(defence, 3), tempo: softmax(tempo, 3) };
}

function sample<K extends string>(dist: Record<K, number>, rng: RngState): K {
  const keys = Object.keys(dist) as K[];
  return weighted(rng, keys, (k) => dist[k]);
}

export function aiGamePlan(team: Team, opponent: Team, rng: RngState): GamePlan {
  const t = planTendencies(team, opponent);
  const oppStars = [...opponent.players].sort((a, b) => composite(b).overall - composite(a).overall);
  const gap = composite(oppStars[0]).overall - composite(oppStars[1]).overall;
  return makePlan(team, {
    offence: sample(t.offence, rng),
    defence: sample(t.defence, rng),
    tempo: sample(t.tempo, rng),
    keyMatchup: gap >= 5 && chance(rng, 0.6) ? { kind: 'double', targetId: oppStars[0].id } : { kind: 'none' },
  });
}

// ---------------------------------------------------------------------------
// In-game

/** Points the opponent has scored since this side last scored. */
export function unansweredRun(s: MatchState, side: Side): number {
  let run = 0;
  for (let i = s.events.length - 1; i >= 0; i--) {
    const ev = s.events[i];
    if (ev.type === 'timeout' || ev.type === 'quarterStart') break;
    if (ev.type !== 'shot' && ev.type !== 'freeThrow') continue;
    if (!ev.made) continue;
    if (ev.side === side) break;
    run += ev.type === 'shot' ? ev.points : 1;
  }
  return run;
}

export function aiShouldTimeout(s: MatchState, side: Side, possessionsSinceLast: number): boolean {
  const team = s.teams[side];
  if (!canCallTimeout(s, side) || possessionsSinceLast < 8) return false;
  const lateGame = s.quarter >= 4 && s.clock < 180;
  // Timeouts expire at halftime, so spend first-half ones freely; keep one for the finish in the second half.
  const reserve = s.quarter === 3 || (s.quarter === 4 && s.clock > 180) ? 1 : 0;
  const run = unansweredRun(s, side);
  if (team.timeoutsLeft > reserve && run >= 8) return true;
  const margin = team.score - s.teams[other(side)].score;
  if (lateGame && margin < 0 && margin >= -6 && run >= 4) return true;
  const tired = team.lineup.filter((id) => team.players[id].energy < 50).length;
  return team.timeoutsLeft > reserve + 1 && tired >= 3;
}

/** Picks the five who should be on court now: best per position, discounted for fatigue and fouls. */
export function freshestFive(s: MatchState, side: Side): string[] {
  const team = s.teams[side];
  const value = (p: Player) => {
    const ps = team.players[p.id];
    if (ps.fouledOut) return -Infinity;
    return composite(p).overall * fatigueFactor(ps.energy) - (inFoulTrouble(s, side, p.id) ? 15 : 0) - (ps.energy < 60 ? 10 : 0);
  };
  const remaining = [...team.team.players].filter((p) => value(p) > -Infinity).sort((a, b) => value(b) - value(a));
  const five: string[] = [];
  for (const pos of ['PG', 'SG', 'SF', 'PF', 'C'] as const) {
    const choice = remaining.find((p) => p.position === pos) ?? remaining[0];
    if (!choice) break;
    five.push(choice.id);
    remaining.splice(remaining.indexOf(choice), 1);
  }
  return five;
}

export interface Breakdown {
  pts: number;
  paint: number;
  threesMade: number;
  threesTried: number;
  turnovers: number;
  pressBroken: number;
}

/** What one side did over the last `possessions` of its own possessions (approximately, from events). */
export function recentBreakdown(s: MatchState, side: Side, events = s.events.length, fromIndex = 0): Breakdown {
  const b: Breakdown = { pts: 0, paint: 0, threesMade: 0, threesTried: 0, turnovers: 0, pressBroken: 0 };
  for (let i = fromIndex; i < events; i++) {
    const ev = s.events[i];
    if (ev.type === 'shot' && ev.side === side) {
      if (ev.points === 3) {
        b.threesTried++;
        if (ev.made) b.threesMade++;
      }
      if (ev.made) {
        b.pts += ev.points;
        if (ev.shotType !== 'three' && ev.shotType !== 'mid' && ev.shotType !== 'pnrPull') b.paint += 2;
      }
    } else if (ev.type === 'freeThrow' && ev.side === side && ev.made) b.pts++;
    else if (ev.type === 'turnover' && ev.side === side) b.turnovers++;
    else if (ev.type === 'pressBroken' && ev.side === side) b.pressBroken++;
  }
  return b;
}

/** Rule-based adjustments at a timeout or break. Returns a new plan. */
export function aiAdjustPlan(s: MatchState, side: Side): GamePlan {
  const team = s.teams[side];
  const opp = other(side);
  const plan: GamePlan = { ...team.plan };
  const from = Math.max(0, s.events.length - 120);
  const theirs = recentBreakdown(s, opp, s.events.length, from);
  const ours = recentBreakdown(s, side, s.events.length, from);

  // Defence: shut the door they're walking through.
  if (theirs.pts > 0 && theirs.paint / theirs.pts > 0.6 && plan.defence !== 'zone') plan.defence = 'zone';
  else if (theirs.threesTried >= 6 && theirs.threesMade / theirs.threesTried > 0.42 && plan.defence === 'zone') plan.defence = 'man';
  else if (plan.defence === 'press' && theirs.pressBroken >= 3) plan.defence = 'man';

  // Offence: stop forcing what isn't working.
  if (plan.offence === 'three' && ours.threesTried >= 8 && ours.threesMade / ours.threesTried < 0.28) plan.offence = 'balanced';
  else if (s.teams[opp].plan.defence === 'zone' && profile(team.team).three > 72) plan.offence = 'three';
  else if (s.teams[opp].plan.defence === 'press' && plan.offence !== 'fastBreak') plan.offence = 'pickAndRoll';

  // Clock management late in the game.
  const margin = team.score - s.teams[opp].score;
  if (s.quarter >= 4 && margin <= -8) {
    plan.tempo = 'fast';
    plan.defence = 'press';
  } else if (s.quarter >= 4 && margin >= 10) {
    plan.tempo = 'slow';
  }

  const five = freshestFive(s, side);
  plan.starters = five;
  plan.bench = [...team.plan.starters, ...team.plan.bench].filter((id) => !five.includes(id));
  return plan;
}

/** A scouting report's view of the opponent's likely plan: tendencies blurred by scout quality. */
export function scoutedTendencies(team: Team, opponent: Team, accuracy: number): Tendencies {
  const t = planTendencies(team, opponent);
  const blur = <K extends string>(dist: Record<K, number>, options: readonly K[]): Record<K, number> => {
    const w = (1 - accuracy) * 0.6;
    return Object.fromEntries(options.map((k) => [k, dist[k] * (1 - w) + w / options.length])) as Record<K, number>;
  };
  return { offence: blur(t.offence, OFFENSIVE_FOCI), defence: blur(t.defence, DEFENCE_SCHEMES), tempo: blur(t.tempo, TEMPOS) };
}

export interface Suggestion {
  offence: OffensiveFocus;
  defence: DefenceScheme;
  tempo: Tempo;
  reasons: string[];
}

function best<K extends string>(dist: Record<K, number>): K {
  return (Object.keys(dist) as K[]).reduce((a, b) => (dist[b] > dist[a] ? b : a));
}

/** The assistant's recommended tactics against this opponent, with plain-language reasons. */
export function suggestPlan(team: Team, opponent: Team): Suggestion {
  const t = planTendencies(team, opponent);
  const me = profile(team);
  const them = profile(opponent);
  const offence = best(t.offence);
  const defence = best(t.defence);
  const tempo = best(t.tempo);
  const reasons: string[] = [];
  const r = Math.round;

  switch (offence) {
    case 'three':
      reasons.push(`Your best shooters rate ${r(me.three)} from three: let them fire.`);
      break;
    case 'inside':
      reasons.push(`Your big men are strong inside (${r(me.inside)}): pound it in.`);
      break;
    case 'pickAndRoll':
      reasons.push(`Your playmaker (${r(me.bestHandler)}) and rolling big (${r(me.bestRoller)}) are made for the pick-and-roll.`);
      break;
    case 'fastBreak':
      reasons.push(`You're quicker than them (speed ${r(me.speed)} vs ${r(them.speed)}): run!`);
      break;
    case 'balanced':
      reasons.push('No single weapon stands out, so keep them guessing.');
  }
  switch (defence) {
    case 'zone':
      reasons.push('They score more inside than from outside: pack the paint with a zone.');
      break;
    case 'press':
      reasons.push('Their ball handling looks shaky: a press could steal easy points.');
      break;
    case 'man':
      reasons.push(them.three > 72 ? 'They can shoot: man-to-man closes out on shooters.' : 'Man-to-man is the safe choice here.');
  }
  switch (tempo) {
    case 'fast':
      reasons.push('Your team is fitter and quicker: speed the game up.');
      break;
    case 'slow':
      reasons.push('Your team is bigger and slower: save legs and play half-court.');
      break;
    case 'normal':
      reasons.push('Neither team has a pace advantage.');
  }
  return { offence, defence, tempo, reasons };
}
