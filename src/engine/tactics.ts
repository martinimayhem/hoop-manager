// The counter system. Every tactical modifier lives in this file so balance
// tuning happens in one place. Values are additive probabilities unless noted.

import type { DefenceScheme, GamePlan, OffensiveFocus, ShotType, Tempo } from './types';

export type HalfCourtPlay = 'post' | 'drive' | 'pnr' | 'mid' | 'three';

/** How often each focus calls each half-court play. */
const PLAY_WEIGHTS: Record<OffensiveFocus, Record<HalfCourtPlay, number>> = {
  inside: { post: 0.4, drive: 0.22, pnr: 0.12, mid: 0.1, three: 0.16 },
  balanced: { post: 0.2, drive: 0.22, pnr: 0.18, mid: 0.15, three: 0.25 },
  three: { post: 0.08, drive: 0.17, pnr: 0.15, mid: 0.08, three: 0.52 },
  pickAndRoll: { post: 0.1, drive: 0.15, pnr: 0.45, mid: 0.1, three: 0.2 },
  fastBreak: { post: 0.15, drive: 0.28, pnr: 0.15, mid: 0.12, three: 0.3 },
};

export function playWeights(plan: GamePlan): Record<HalfCourtPlay, number> {
  const w = { ...PLAY_WEIGHTS[plan.offence] };
  if (plan.tempo === 'slow') {
    w.post *= 1.15;
    w.mid *= 1.1;
  } else if (plan.tempo === 'fast') {
    w.drive *= 1.1;
    w.three *= 1.1;
  }
  return w;
}

/**
 * Shot-quality modifier from the defensive scheme.
 * Zone: packs the paint, concedes open jumpers.
 * Press: half-court defence is a little scrambled after the press is broken.
 */
const SCHEME_SHOT_MOD: Record<DefenceScheme, Partial<Record<ShotType, number>>> = {
  man: {},
  zone: { post: -0.065, drive: -0.05, pnrRoll: -0.03, putback: -0.01, mid: 0.015, pnrPull: 0.01, three: 0.025 },
  press: { drive: 0.01, three: 0.005 },
};

export function schemeShotMod(defence: DefenceScheme, shot: ShotType): number {
  return SCHEME_SHOT_MOD[defence][shot] ?? 0;
}

/** A balanced attack is harder to key on: a small half-court bonus for not being predictable. */
export function focusShotMod(focus: OffensiveFocus): number {
  return focus === 'balanced' ? 0.012 : 0;
}

/** Against a zone, good ball movement finds the open man: extra on jumpers per point of team playmaking above 65. */
export const ZONE_PASSING_BONUS = 0.0015;

/** Pick-and-roll vs man: handler speed against the defending big's speed. Per rating point, capped. */
export const PNR_SPEED_EDGE = { perPoint: 0.0022, min: -0.03, max: 0.06 };
/** A zone switches less, so the speed gap matters less. */
export const PNR_ZONE_DAMPING = 0.4;

/** Fast tempo rushes shots unless the team is quick and fit; slow tempo rewards high-IQ half-court teams. */
export function tempoShotMod(tempo: Tempo, athleticism: number, iq: number): number {
  if (tempo === 'fast') return -0.004 + (athleticism - 65) * 0.0015;
  if (tempo === 'slow') return (iq - 65) * 0.0008;
  return 0;
}

/** Turnover base and plan modifiers (half-court). */
export const TURNOVER_BASE = 0.12;

export function turnoverPlanMod(off: GamePlan, def: GamePlan): number {
  let m = 0;
  if (def.defence === 'zone') m -= 0.01;
  if (off.tempo === 'fast') m += 0.008;
  if (off.tempo === 'slow') m -= 0.004;
  if (off.offence === 'pickAndRoll') m += 0.005;
  if (off.offence === 'fastBreak') m += 0.005;
  if (off.offence === 'inside') m += 0.005;
  if (off.offence === 'three') m -= 0.005;
  return m;
}

/** Extra turnover chance from a full-court press; good ball handlers shrug it off. */
export function pressTurnoverChance(teamBallHandling: number, execution: number): number {
  const resist = Math.min(0.85, Math.max(0, (teamBallHandling - 55) / 45));
  return 0.068 * (1 - resist) * execution + 0.01;
}

/** Chance that a press is beaten for an easy numbers-advantage shot (when no turnover happened). */
export function pressBreakChance(teamBallHandling: number, speedEdge: number): number {
  return Math.max(0.05, Math.min(0.45, 0.17 + (teamBallHandling - 65) * 0.004 + speedEdge * 0.006));
}

/** Chance a live-ball possession becomes a fast break. */
export function fastBreakChance(
  trigger: 'rebound' | 'steal',
  off: GamePlan,
  def: GamePlan,
  speedEdge: number,
): number {
  let p = trigger === 'steal' ? 0.6 : 0.27;
  if (off.offence === 'fastBreak') p += trigger === 'steal' ? 0.07 : 0.05;
  if (off.tempo === 'fast') p += 0.02;
  if (off.tempo === 'slow') p -= 0.05;
  if (def.tempo === 'slow') p -= 0.02; // slow teams get back in shape
  if (def.offence === 'inside') p += 0.02; // bigs crash the glass and get caught
  p += speedEdge * 0.004;
  return Math.max(0, Math.min(0.8, p));
}

/**
 * How often a ball handler takes an open lane (or a numbers advantage) in transition, by the coach's
 * plan: running teams almost always go, half-court teams pull it out more. His driving and
 * playmaking tilt it by at most ten points either way. Never certain, never ruled out.
 */
export function transitionAttackChance(situation: 'lane' | 'twoOnOne' | 'threeOnTwo', plan: GamePlan, driving: number, playmaking: number): number {
  const runs = plan.offence === 'fastBreak' || plan.tempo === 'fast';
  const walks = plan.tempo === 'slow' || plan.offence === 'inside' || plan.offence === 'pickAndRoll';
  let p = situation === 'lane' ? (runs ? 0.95 : walks ? 0.7 : 0.85) : runs ? 0.9 : walks ? 0.55 : 0.75;
  p += Math.max(-0.1, Math.min(0.1, (driving - 65) * 0.002 + (playmaking - 65) * 0.002));
  return Math.max(0.05, Math.min(0.98, p));
}

/** How often an open lane closes on the way in: a quicker defence recovers more often. */
export function laneClosesChance(speedEdge: number): number {
  return Math.max(0.05, Math.min(0.3, 0.15 - speedEdge * 0.004));
}

/** Offensive rebound modifiers. */
export function offRebPlanMod(off: GamePlan, def: GamePlan): number {
  let m = 0;
  if (def.defence === 'zone') m += 0.03; // harder to box out from a zone
  if (def.defence === 'press') m += 0.01;
  if (off.offence === 'inside') m += 0.03;
  if (off.offence === 'fastBreak') m -= 0.03; // wings leak out instead of crashing
  if (off.offence === 'three') m += 0.01; // long rebounds
  if (off.tempo === 'fast') m -= 0.01;
  return m;
}

/** Seconds a half-court possession takes (before jitter). */
export function halfCourtSeconds(off: GamePlan, def: GamePlan): number {
  let secs = off.tempo === 'slow' ? 18.5 : off.tempo === 'fast' ? 12 : 15;
  if (def.tempo === 'slow') secs += 1.5;
  if (def.tempo === 'fast') secs -= 1.5;
  if (def.defence === 'press') secs -= 1;
  return secs;
}

/** Double team: the target's own shot gets harder, but a pass out finds an open shooter. */
export const DOUBLE_TEAM = {
  passOutChance: 0.5,
  targetShotMod: -0.07,
  openShotMod: 0.055,
  targetUsage: 0.7,
  offRebMod: 0.02,
};

/** Shooting-foul base rate per shot type. */
export const SHOOTING_FOUL_RATE: Record<ShotType, number> = {
  post: 0.13,
  drive: 0.14,
  pnrRoll: 0.12,
  putback: 0.12,
  fastBreak: 0.14,
  pressBreak: 0.14,
  pnrPull: 0.04,
  mid: 0.035,
  three: 0.015,
};

export function nonShootingFoulRate(def: GamePlan): number {
  return def.defence === 'press' ? 0.085 : 0.05;
}
