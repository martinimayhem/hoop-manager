// Clutch moments: in tight finishes the coach calls the play. Each option shows an honest
// estimate, made by simulating the next possession many times on a copy of the match.

import { playPossession } from '../engine/possession';
import { composite } from '../engine/ratings';
import { createRng } from '../engine/rng';
import { bestOnCourt, eff, other, playerOf, starOnCourt } from '../engine/state';
import type { DefenceCall, MatchState, OffenceCall, PossessionCalls, Side } from '../engine/types';

export const CLUTCH_WINDOW = 120; // last two minutes
export const CLUTCH_MARGIN = 6;

/** A close game in the last two minutes of Q4/OT, or the final shot of a close first half. */
export function isClutch(s: MatchState): boolean {
  const margin = Math.abs(s.teams[0].score - s.teams[1].score);
  if (s.quarter >= 4 && s.clock <= CLUTCH_WINDOW && margin <= CLUTCH_MARGIN) return true;
  return s.quarter === 2 && s.clock <= 10 && margin <= 8;
}

/**
 * How many calls a coach makes himself in a close finish (the end of Q4, and each overtime): up to
 * three plays on his own possessions, and one defensive call for the last stop, when the other side
 * has the ball in the last shot clock with a score that would tie or win it. The other clutch
 * possessions play out with the team's game plan, so a finish brings three or four moments, not
 * one every possession.
 */
export const CLUTCH_CALLS = { offence: 3, defence: 1 } as const;
export const LAST_STOP_SECONDS = 24;
export const LAST_STOP_MARGIN = 3;

/** Whether a human coach in `role` is asked for a call on this clutch possession. `used` counts this period's calls so far. */
export function asksForCall(s: MatchState, role: 'offence' | 'defence', used: number): boolean {
  // The last shot of the first half: just the play.
  if (s.quarter === 2) return role === 'offence' && used === 0;
  if (used >= CLUTCH_CALLS[role]) return false;
  if (role === 'offence') return true;
  const margin = Math.abs(s.teams[0].score - s.teams[1].score);
  return s.clock <= LAST_STOP_SECONDS && margin <= LAST_STOP_MARGIN;
}

export interface CallOption<C extends string> {
  call: C | null;
  icon: string;
  label: string;
  detail: string;
}

const name = (s: MatchState, side: Side, id: string) => playerOf(s, side, id).name;

export function offenceOptions(s: MatchState, side: Side): CallOption<OffenceCall>[] {
  const star = starOnCourt(s, side);
  const handler = bestOnCourt(s, side, 'playmaking');
  const roller = s.teams[side].lineup.filter((id) => id !== handler).reduce((a, b) => (eff(s, side, b, 'rollFinish') > eff(s, side, a, 'rollFinish') ? b : a));
  const shooter = bestOnCourt(s, side, 'three');
  const big = bestOnCourt(s, side, 'insideScoring');
  const lead = s.teams[side].score - s.teams[other(side)].score;
  const options: CallOption<OffenceCall>[] = [
    { call: 'isoStar', icon: '🌟', label: `Iso ${name(s, side, star)}`, detail: 'Clear out and let your best player go one-on-one.' },
    { call: 'pickAndRoll', icon: '🔁', label: 'Pick & roll', detail: `${name(s, side, handler)} and ${name(s, side, roller)} run the two-man game.` },
    { call: 'kickOut', icon: '🎯', label: 'Kick-out three', detail: `Drive, draw the defence, kick to ${name(s, side, shooter)} for an open three.` },
    { call: 'postUp', icon: '💪', label: `Post up ${name(s, side, big)}`, detail: 'Feed the big man on the block.' },
  ];
  if (lead > 0 && s.clock > 20) {
    options.push({ call: 'runClock', icon: '⏱️', label: 'Run the clock', detail: 'Burn the shot clock before shooting. Fewer possessions for them.' });
  }
  options.push({ call: null, icon: '▶️', label: 'Play it normally', detail: 'Stick with your game plan.' });
  return options;
}

export function defenceOptions(s: MatchState, side: Side): CallOption<DefenceCall>[] {
  const opp = other(side);
  const star = starOnCourt(s, opp);
  const worstFt = [...s.teams[opp].lineup].sort((a, b) => playerOf(s, opp, a).attrs.freeThrow - playerOf(s, opp, b).attrs.freeThrow)[0];
  const behind = s.teams[side].score < s.teams[opp].score;
  const options: CallOption<DefenceCall>[] = [
    { call: 'doubleStar', icon: '👥', label: `Double ${name(s, opp, star)}`, detail: 'Make someone else beat you.' },
    { call: 'packPaint', icon: '🧱', label: 'Pack the paint', detail: 'No layups: dare them to shoot threes.' },
    { call: 'denyThree', icon: '🚫', label: 'Run them off the line', detail: 'No threes: they can drive instead.' },
  ];
  if (behind && s.quarter >= 4) {
    const ft = playerOf(s, opp, worstFt).attrs.freeThrow;
    options.push({ call: 'foul', icon: '✋', label: 'Foul on purpose', detail: `Stop the clock: send ${name(s, opp, worstFt)} (free throws ${ft}) to the line.` });
  }
  options.push({ call: null, icon: '▶️', label: 'Play it normally', detail: 'Stick with your game plan.' });
  return options;
}

/** A light copy of the match for what-if simulation (no event history). */
function cloneForSim(s: MatchState, seed: number): MatchState {
  return {
    ...s,
    rng: createRng(seed),
    events: [],
    teams: s.teams.map((t) => ({
      ...t,
      plan: t.plan,
      lineup: [...t.lineup],
      quarterPoints: [...t.quarterPoints],
      extras: { ...t.extras },
      players: Object.fromEntries(Object.entries(t.players).map(([id, p]) => [id, { ...p, stats: { ...p.stats } }])),
    })) as MatchState['teams'],
  };
}

export interface Estimate {
  /** Average points the offence scores this possession. */
  points: number;
  /** Chance the offence scores at least once. */
  scoreChance: number;
}

export function estimate(s: MatchState, calls: PossessionCalls, samples = 150): Estimate {
  const off = s.possession;
  let pts = 0;
  let scored = 0;
  for (let i = 0; i < samples; i++) {
    const sim = cloneForSim(s, (Math.imul(i + 1, 2654435761) ^ Math.round(s.clock * 100)) >>> 0);
    sim.calls = calls;
    const before = sim.teams[off].score;
    playPossession(sim);
    const got = sim.teams[off].score - before;
    pts += got;
    if (got > 0) scored++;
  }
  return { points: pts / samples, scoreChance: scored / samples };
}

/** The AI's call: the option with the best estimate, plus a few rules of thumb. */
export function aiCall(s: MatchState, side: Side, role: 'offence' | 'defence'): OffenceCall | DefenceCall | null {
  const margin = s.teams[side].score - s.teams[other(side)].score;
  if (role === 'offence') {
    if (margin > 0 && s.clock > 24 && s.quarter >= 4) return 'runClock';
    let best: OffenceCall | null = null;
    let bestPts = estimate(s, {}, 80).points;
    for (const o of offenceOptions(s, side)) {
      if (!o.call || o.call === 'runClock') continue;
      const e = estimate(s, { offence: o.call }, 80).points;
      if (e > bestPts) {
        bestPts = e;
        best = o.call;
      }
    }
    return best;
  }
  if (margin < 0 && margin >= -6 && s.clock <= 45 && s.quarter >= 4) return 'foul';
  let best: DefenceCall | null = null;
  let bestPts = estimate(s, {}, 80).points;
  for (const o of defenceOptions(s, side)) {
    if (!o.call || o.call === 'foul') continue;
    const e = estimate(s, { defence: o.call }, 80).points;
    if (e < bestPts) {
      bestPts = e;
      best = o.call;
    }
  }
  return best;
}

/** Best overall on court, used in UI text ("their star"). */
export function starName(s: MatchState, side: Side): string {
  const id = starOnCourt(s, side);
  return `${name(s, side, id)} (${Math.round(composite(playerOf(s, side, id)).overall)})`;
}
