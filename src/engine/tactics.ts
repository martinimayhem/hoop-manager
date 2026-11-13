// The counter system. Every tactical modifier lives in this file so balance
// tuning happens in one place. Values are additive probabilities unless noted.

import type { ShotZone } from './court';
import type { DefenceScheme, GamePlan, OffensiveFocus, Position, ShotType, Tempo } from './types';

export type HalfCourtPlay = 'post' | 'drive' | 'pnr' | 'mid' | 'three';

/** How often each focus calls each half-court play. */
const PLAY_WEIGHTS: Record<OffensiveFocus, Record<HalfCourtPlay, number>> = {
  inside: { post: 0.32, drive: 0.22, pnr: 0.12, mid: 0.08, three: 0.26 },
  balanced: { post: 0.14, drive: 0.22, pnr: 0.18, mid: 0.1, three: 0.36 },
  three: { post: 0.05, drive: 0.15, pnr: 0.13, mid: 0.05, three: 0.62 },
  pickAndRoll: { post: 0.07, drive: 0.14, pnr: 0.43, mid: 0.08, three: 0.28 },
  fastBreak: { post: 0.1, drive: 0.27, pnr: 0.14, mid: 0.09, three: 0.4 },
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

// ---------------------------------------------------------------------------
// Where shots come from. The zone says where, the shot type says how.

/**
 * An average NBA shooter's field-goal percentage from each zone, as the NBA's own shooting
 * statistics divide the floor. The shooter's rating is centred on 70, so this is the base.
 */
export const ZONE_BASE: Record<ShotZone, number> = {
  restricted: 0.655,
  paint: 0.43,
  mid: 0.42,
  corner3: 0.39,
  aboveBreak3: 0.355,
};

/** How the shot is taken, on top of where: a contested drive is harder than a lob from a roll. */
export const SHOT_TYPE_MOD: Record<ShotType, number> = {
  drive: -0.035,
  pnrRoll: -0.015,
  fastBreak: 0.04,
  pressBreak: -0.01,
  putback: -0.09,
  post: -0.01,
  mid: -0.01,
  pnrPull: 0.01,
  three: 0,
};

/**
 * The shooter against his defender, per shot type: which rating the shooter uses, and how much a
 * rating point above the centre is worth to each of them (per 100 points).
 *
 * The defence weighs as much as the offence, measured in what a better team actually brings: going
 * from the default rosters to the best players in the pool lifts the shooters' ratings by about as
 * much as the defenders', so the two weights are set to cancel over that step. Stars against stars
 * then play about like ordinary players against ordinary players, and only the gap between the two
 * sides counts. (With the defence weighed lightly, two strong teams shot like a record offence
 * against each other.)
 */
export const SHOT_SKILL: Record<ShotType, { rating: 'insideScoring' | 'driving' | 'rollFinish' | 'midRange' | 'three'; off: number; def: number }> = {
  post: { rating: 'insideScoring', off: 0.45, def: 0.5 },
  drive: { rating: 'driving', off: 0.4, def: 0.5 },
  pnrRoll: { rating: 'rollFinish', off: 0.4, def: 0.5 },
  pnrPull: { rating: 'midRange', off: 0.4, def: 0.55 },
  mid: { rating: 'midRange', off: 0.45, def: 0.6 },
  three: { rating: 'three', off: 0.45, def: 0.3 },
  fastBreak: { rating: 'driving', off: 0.3, def: 0.42 },
  pressBreak: { rating: 'rollFinish', off: 0.3, def: 0.38 },
  putback: { rating: 'insideScoring', off: 0.4, def: 0.45 },
};
/** A shooter rated 70 is an average NBA shooter from that spot. */
export const SHOOTER_CENTRE = 70;
/**
 * The defender who takes nothing away. Below 70, so that the default rosters, whose defenders are
 * rated mid-sixties, shoot about as they always did now that defence weighs more.
 */
export const DEFENDER_CENTRE = 67;

/**
 * Ball movement against the rotation behind it: good passers find open jumpers, a quick, smart
 * defence closes them out. Per point of the offence's best playmaker above the defence's average
 * perimeter defender (centred on the default rosters, where it is about +9).
 */
export const BALL_MOVEMENT = { pivot: 9, perPoint: 0.0015 };

/** How often a finish at the basket gets all the way to the rim, rather than a floater in the paint. */
export const RIM_SHARE: Partial<Record<ShotType, number>> = {
  drive: 0.7,
  pnrRoll: 0.75,
  fastBreak: 0.85,
  pressBreak: 0.8,
  putback: 0.8,
  post: 0.25,
};

/** Of the threes, the share from the corners. */
export const CORNER_SHARE = 0.26;

/**
 * Floor spacing: how many credible shooters are on the court, 0 to 5. A player rated 50 from three
 * adds nothing, one rated 75 or better counts in full.
 */
export function spacingScore(threeRatings: number[]): number {
  return threeRatings.reduce((sum, r) => sum + Math.max(0, Math.min(1, (r - 50) / 25)), 0);
}

/** Spacing is measured against a lineup with two and a half shooters. */
export const SPACING_PIVOT = 2.5;
/** Per shooter above that: more drives reach the rim, and finishes there are easier. */
export const SPACING_RIM_SHARE = 0.05;
export const SPACING_INSIDE_MOD = 0.008;

/**
 * What a defence gives up and what it takes away: how often the offence gets to the rim and to the
 * corners, and how contested each zone is. Applies to the scheme and to a defensive call on top.
 */
export interface DefenceProfile {
  rimShare: number;
  cornerShare: number;
  contest: Partial<Record<ShotZone, number>>;
}

const SCHEME_PROFILE: Record<DefenceScheme, DefenceProfile> = {
  // Man to man: someone is on every shooter, closing out on the catch; with nobody sagging off,
  // a driver who beats his man finds less help at the rim.
  man: { rimShare: 0.03, cornerShare: -0.04, contest: { aboveBreak3: -0.04, corner3: -0.035, restricted: 0.01, paint: 0.01 } },
  // A 2-3 zone packs the paint and gives up the corners and the gaps.
  zone: { rimShare: -0.12, cornerShare: 0.12, contest: { restricted: -0.045, paint: -0.05, mid: 0.015, corner3: 0.02, aboveBreak3: 0.02 } },
  // A press does its work full court; once it is broken the half court is a little scrambled.
  press: { rimShare: 0, cornerShare: 0.02, contest: {} },
};

/** The clutch defensive calls change the profile for one possession. */
const CALL_PROFILE: Record<'packPaint' | 'denyThree', DefenceProfile> = {
  packPaint: { rimShare: -0.15, cornerShare: 0.1, contest: { restricted: -0.07, paint: -0.07, mid: 0.01, corner3: 0.04, aboveBreak3: 0.035 } },
  denyThree: { rimShare: 0.08, cornerShare: -0.12, contest: { corner3: -0.08, aboveBreak3: -0.07, restricted: 0.035, paint: 0.035, mid: 0.02 } },
};

/**
 * The defence the offence faces: its scheme, plus a called adjustment. A zone is weaker against a
 * lineup that can shoot: good spacing stretches it, so it gives up more from three.
 */
export function defenceProfile(scheme: DefenceScheme, call: string | undefined, spacing: number): DefenceProfile {
  const base = SCHEME_PROFILE[scheme];
  const extra = call === 'packPaint' || call === 'denyThree' ? CALL_PROFILE[call] : null;
  const contest: Partial<Record<ShotZone, number>> = { ...base.contest };
  if (extra) for (const [z, v] of Object.entries(extra.contest) as [ShotZone, number][]) contest[z] = (contest[z] ?? 0) + v;
  if (scheme === 'zone') {
    const stretch = (spacing - SPACING_PIVOT) * ZONE_STRETCH;
    contest.corner3 = (contest.corner3 ?? 0) + stretch;
    contest.aboveBreak3 = (contest.aboveBreak3 ?? 0) + stretch;
  }
  return { rimShare: base.rimShare + (extra?.rimShare ?? 0), cornerShare: base.cornerShare + (extra?.cornerShare ?? 0), contest };
}

/** Against a zone, per shooter above the pivot: the open threes get more open. */
export const ZONE_STRETCH = 0.006;

/** A balanced attack is harder to key on: a small half-court bonus for not being predictable. */
export function focusShotMod(focus: OffensiveFocus): number {
  return focus === 'balanced' ? 0.004 : 0;
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
  // With nobody or one man back, he goes; three on two takes a little more nerve.
  let p = situation !== 'threeOnTwo' ? (runs ? 0.95 : walks ? 0.7 : 0.85) : runs ? 0.9 : walks ? 0.55 : 0.75;
  p += Math.max(-0.1, Math.min(0.1, (driving - 65) * 0.002 + (playmaking - 65) * 0.002));
  return Math.max(0.05, Math.min(0.98, p));
}

/** How often an open lane closes on the way in: a quicker defence recovers more often. */
export function laneClosesChance(speedEdge: number): number {
  return Math.max(0.05, Math.min(0.3, 0.15 - speedEdge * 0.004));
}

/**
 * A fast-break finish with nobody between him and the rim (an open lane, or the open man after the
 * last defender commits). About nine in ten go in: a little more for a good finisher or a dunker.
 * Per rating point. The quickest defender may still run him down from behind: a chase-down block,
 * more likely the quicker he is than the shooter and the better he blocks shots.
 */
export const OPEN_FINISH = {
  base: 0.89,
  perFinishing: 0.0015,
  perDunk: 0.0006,
  min: 0.8,
  max: 0.96,
  /** A chaser hacking him from behind. */
  foul: 0.03,
  chaseDown: 0.02,
  chaseDownPerSpeed: 0.0015,
  chaseDownPerBlock: 0.0004,
  chaseDownMin: 0.005,
  chaseDownMax: 0.06,
};

/**
 * Technical fouls. A player called for a foul may say a word too many: rare, more so for a hothead,
 * in a close finish, during a run against his team, or in foul trouble (each adds to the base). About
 * one every two or three matches all told. A coach who argues a call fires his team up, or gets one.
 * Two technicals and he is gone, player or coach.
 */
export const TECHNICAL = {
  player: 0.055,
  closeGame: 0.5,
  runAgainst: 0.5,
  foulTrouble: 0.5,
  argue: 0.3,
  /** A coach left to himself goes after the official on this share of reach-ins against his team. */
  aiArgue: 0.08,
  argueMorale: 0.12,
  argueMomentum: 0.05,
  /** What a technical costs the side called for it. */
  momentum: 0.05,
  morale: 0.05,
  ejectAt: 2,
};

/**
 * How short a player's fuse is, from 0.3 (never says a word) to 2.5 (a hothead): a trait of his own,
 * fixed for his career, that the scouts do not show. Most players are calm; a few are not.
 */
export function temperOf(p: { id: string; attrs: { tactics: number } }): number {
  let h = 2166136261;
  for (let i = 0; i < p.id.length; i++) h = Math.imul(h ^ p.id.charCodeAt(i), 16777619);
  const t = ((h >>> 0) % 1000) / 1000;
  // A smart player knows when to keep quiet.
  const calm = Math.max(0.6, Math.min(1.2, 1.4 - p.attrs.tactics / 100));
  return (0.3 + 2.2 * t * t) * calm;
}

/**
 * Rebounds: where a miss comes down decides who can get it. Long misses (3 m and more from the rim)
 * come off threes and go to whoever is out on the perimeter; short ones stay with the bigs inside.
 */
export const REBOUND = {
  /** Base chance the offence gets a missed field goal (before ratings and plans): NBA about 24-25%. */
  offBase: 0.225,
  /** And a missed last free throw: the defence has the inside spots on the lane. */
  offBaseFreeThrow: 0.14,
  /** By where the miss came from: misses at the rim fall to the crashers, long ones to the defence. */
  offByZone: { restricted: 0.04, paint: 0.02, mid: -0.01, corner3: -0.02, aboveBreak3: -0.02, ft: 0 } as Record<ShotZone | 'ft', number>,
  /** Share of misses that come off long, by where the shot was taken; a blocked shot flies anywhere. */
  longShare: { restricted: 0.06, paint: 0.12, mid: 0.3, corner3: 0.6, aboveBreak3: 0.6, ft: 0.03 } as Record<ShotZone | 'ft', number>,
  longShareBlocked: 0.35,
  /** How far out it comes down (metres from the rim): short, long, and long off a three. */
  shortM: [1, 2.4] as [number, number],
  longM: [3, 4.6] as [number, number],
  longThreeM: [3.4, 5.4] as [number, number],
  /** Who is there for it, by position: [short, long]. Bigs live near the rim, guards out on the floor. */
  position: { C: [1, 0.45], PF: [0.85, 0.55], SF: [0.45, 0.75], SG: [0.25, 0.85], PG: [0.2, 0.8] } as Record<Position, [number, number]>,
  /** Off a missed free throw only the players on the lane are in it: the bigs, nearly always. */
  freeThrowPosition: { C: 1, PF: 1, SF: 0.4, SG: 0.06, PG: 0.04 } as Record<Position, number>,
  /** The shooter after his own miss: a long one is gone before he can follow it; a short one he can. */
  shooterLong: 0.2,
  shooterShort: 0.9,
  /** An Inside attack sends the bigs to crash; Fast Break and Three send the guards back. */
  insideCrash: 1.25,
  leakOut: 0.6,
};

/** Offensive rebound modifiers. */
export function offRebPlanMod(off: GamePlan, def: GamePlan): number {
  let m = 0;
  if (def.defence === 'zone') m += 0.03; // harder to box out from a zone
  if (def.defence === 'press') m += 0.01;
  if (off.offence === 'inside') m += 0.03;
  if (off.offence === 'fastBreak') m -= 0.03; // wings leak out instead of crashing
  // (Three: its long rebounds come from where its shots are taken: REBOUND.longShare.)
  if (off.tempo === 'fast') m -= 0.01;
  return m;
}

/**
 * Seconds a half-court possession takes (before jitter). Tempo moves it a little, as in the NBA:
 * the fastest teams there play about 5% more possessions than average and the slowest about 5%
 * fewer, so two running teams get some 108 possessions each, two slow ones some 90.
 */
export function halfCourtSeconds(off: GamePlan, def: GamePlan): number {
  let secs = off.tempo === 'slow' ? 16 : off.tempo === 'fast' ? 14.1 : 15;
  if (def.tempo === 'slow') secs += 0.45;
  if (def.tempo === 'fast') secs -= 0.45;
  // Beating a press that neither forced a turnover nor broke open eats a few seconds of the clock.
  if (def.defence === 'press') secs += 2;
  return secs;
}

/**
 * Double team. When the play goes to the doubled player the trap may take the ball off him (a poor
 * ball handler against a quick, smart defence); otherwise he passes out of it (more often the better
 * a passer he is) or forces a shot through two. The pass goes to whoever was left open, for his own
 * best shot, open: better after a sharp pass, worse against a defence that rotates well. Everywhere
 * else the defence is shading towards him, so his teammates get slightly better looks, and a man
 * short on the glass. Doubling a star who cannot pass works; doubling a playmaker among shooters,
 * or someone who is no threat, does not.
 */
export const DOUBLE_TEAM = {
  /** How much less the ball goes to him: the offence plays away from the trap. */
  targetUsage: 0.7,
  /** Trap turnovers: base, per point of ball security below 70, and per point of the trapping pair's (perimeter D + IQ)/2 above 70. */
  trapBase: 0.06,
  trapPerHandling: 0.005,
  trapPerDefence: 0.002,
  trapMin: 0.01,
  trapMax: 0.2,
  /** Passing out of it: base chance, per point of playmaking above 60. */
  passOutBase: 0.3,
  passOutPerPassing: 0.012,
  /** A man who is no scorer gives it up at once: per point his best scoring rating is below 80. */
  passOutPerNoThreat: 0.015,
  passOutMin: 0.12,
  passOutMax: 0.85,
  /** His shot through two defenders. */
  forcedShotMod: -0.1,
  /** The open man's shot: base, per point of the passer's playmaking above 70, per point of the rotation (defence IQ and perimeter D) above 70. */
  openShotMod: 0.07,
  openPerPassing: 0.002,
  openPerRotation: -0.0015,
  /**
   * Everyone else, while the defence leans towards the doubled man: a base, more for each shooter on
   * the floor above two and a half (the floor is wider), and more for each point the best scorer
   * left alone is more dangerous than the man doubled (they are guarding the wrong man).
   */
  stretched: 0.006,
  stretchedPerSpacing: 0.008,
  stretchedPerThreatGap: 0.0035,
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
