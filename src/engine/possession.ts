// Resolves one possession: transition or half-court, press, turnovers, fouls,
// shot selection, the shot itself, rebounds and free throws.

import { zonePoints, type CourtSide, type ShotZone } from './court';
import { usageDrain, tickFatigue } from './fatigue';
import { chance, next, pick, range, weighted } from './rng';
import { clamp, composite, fatigueFactor } from './ratings';
import { addPoints } from './stats';
import { bestOnCourt, eff, emit, other, playerOf, pstate, starOnCourt, teamAvg, teamTop, type RatingKey } from './state';
import {
  CORNER_SHARE,
  DOUBLE_TEAM,
  PNR_SPEED_EDGE,
  PNR_ZONE_DAMPING,
  RIM_SHARE,
  SHOOTING_FOUL_RATE,
  SHOT_TYPE_MOD,
  SPACING_INSIDE_MOD,
  SPACING_PIVOT,
  SPACING_RIM_SHARE,
  TURNOVER_BASE,
  ZONE_BASE,
  ZONE_PASSING_BONUS,
  defenceProfile,
  fastBreakChance,
  focusShotMod,
  halfCourtSeconds,
  laneClosesChance,
  nonShootingFoulRate,
  offRebPlanMod,
  playWeights,
  pressBreakChance,
  pressTurnoverChance,
  spacingScore,
  tempoShotMod,
  transitionAttackChance,
  turnoverPlanMod,
  type HalfCourtPlay,
} from './tactics';
import { DEFENDERS_BACK, type MatchState, type OffenceCall, type PossessionCalls, type ShotType, type Side, type TransitionPlan, type TransitionSituation, type TurnoverCause } from './types';

const FOUL_LIMIT = 6;
const BONUS_FOULS = 5;
/** NBA: in the last two minutes of a period, the second team foul there puts the other side in the bonus. */
const LATE_BONUS_FOULS = 2;
const LATE_PERIOD_SECONDS = 120;
const MAX_SEGMENTS = 6;
/** The shot clock, and what it resets to after an offensive rebound. */
export const SHOT_CLOCK = 24;
const RESET_SHOT_CLOCK = 14;
/** Under this on the shot clock, a shot is a late-clock shot: rushed, and harder. */
const LATE_CLOCK_S = 4;
const LATE_CLOCK_PENALTY = 0.05;
/** The share of a half-court possession spent getting into the set, before any shot comes. */
const SET_UP_SHARE = 0.7;
/** How hard the clock presses as it runs out: the extra chance per second of a shot, at zero. */
const URGENCY = 2.2;
/** In the last minutes of a game this close, the leader burns clock and the trailer hurries. */
const ENDGAME_SECONDS = 150;

/** Extra turnover risk of each set play (more passes = more risk; running clock = careful). */
const CALL_TURNOVER: Record<OffenceCall, number> = { isoStar: 0.005, pickAndRoll: 0.01, kickOut: 0.015, postUp: 0.005, runClock: -0.01 };

const INSIDE_SHOTS: ReadonlySet<ShotType> = new Set(['post', 'drive', 'pnrRoll', 'putback', 'fastBreak', 'pressBreak']);
const ASSIST_RATE: Record<ShotType, number> = {
  three: 0.82, mid: 0.45, pnrPull: 0, pnrRoll: 0.92, post: 0.45, drive: 0.3, fastBreak: 0.55, pressBreak: 0.7, putback: 0,
};

/** Per-possession context while it is being resolved. */
interface Ctx {
  s: MatchState;
  off: Side;
  def: Side;
  /** True once an offensive rebound happened, for second-chance points. */
  secondChance: boolean;
  fastBreak: boolean;
  /** Possession over (score, turnover, defensive rebound, end of clock). */
  done: boolean;
  /** Set plays called for this possession (clutch moments). Only the first half-court set uses the offence call. */
  calls: PossessionCalls;
  setUsed: boolean;
  /** Seconds left on the shot clock. */
  shotClock: number;
  /** The coming shot is a late-clock shot, or one at the end of the quarter. */
  lateClock: boolean;
  buzzer: boolean;
  /** Behind late in the game: quick shots, threes first. */
  hurry: boolean;
}

/** Plays one possession for `s.possession`, mutating the state. Leaves `s.possession` set to whoever has the ball next. */
export function playPossession(s: MatchState): void {
  const off = s.possession;
  const c: Ctx = {
    s, off, def: other(off), secondChance: false, fastBreak: false, done: false, calls: s.calls ?? {}, setUsed: false,
    shotClock: SHOT_CLOCK, lateClock: false, buzzer: false, hurry: false,
  };
  s.calls = null;
  s.teams[off].extras.possessions++;
  s.momentum *= 0.95;
  for (const t of s.teams) t.morale *= 0.97;

  const trigger = s.transition;
  s.transition = 'none';
  // The possession ends with the other team in possession unless an offensive rebound continues it.
  s.possession = c.def;

  if (c.calls.defence === 'foul') {
    intentionalFoul(c);
    return;
  }

  let opened = false;
  // A called set play is run in the half court: no fast break, the ball is walked up.
  const planned = s.nextTransition;
  s.nextTransition = null;
  if (trigger !== 'none' && !c.calls.offence) opened = runTransition(c, trigger, planned);
  if (!opened && s.teams[c.def].plan.defence === 'press') opened = runPress(c);

  // Half-court sets. Later segments are resets after an offensive rebound or a side-out foul.
  for (let segment = 0; segment < MAX_SEGMENTS && !c.done; segment++) {
    const base = segment === 0 && !opened ? halfCourtSeconds(s.teams[c.off].plan, s.teams[c.def].plan) : 7;
    if (!spend(c, halfCourtTime(c, base))) break;
    if (c.shotClock <= 0) {
      // Nobody got a shot away in time.
      turnover(c, weighted(s.rng, s.teams[c.off].lineup, (id) => eff(s, c.off, id, 'playmaking')), undefined, 'shotClock');
      break;
    }
    runHalfCourt(c);
    c.lateClock = false;
  }
}

/**
 * How long the offence works before the action comes, from the shot clock. First they get into
 * the set; from then on a shot can come any moment, more likely the less there is on the clock,
 * until it nearly runs out and somebody has to throw one up. The game shapes it too: at the end of
 * a quarter they hold for the last shot; late in a close game the leader burns clock and the side
 * behind hurries.
 */
function halfCourtTime(c: Ctx, base: number): number {
  const s = c.s;
  const clock = c.shotClock;
  const lead = s.teams[c.off].score - s.teams[c.def].score;
  const endgame = s.quarter >= 4 && s.clock <= ENDGAME_SECONDS;
  c.hurry = endgame && lead <= -4;
  // The last possession of the quarter: hold it and go at the buzzer.
  if (s.clock <= clock && s.clock > 2) {
    c.buzzer = true;
    c.lateClock = true;
    return Math.max(0.5, s.clock - range(s.rng, 0, 1.2));
  }
  let target = base;
  if (c.calls.offence === 'runClock' || (endgame && lead > 0)) target = clock - 3;
  else if (c.hurry) target = base * 0.6;
  target = Math.min(target, clock - 1);
  // Into the set first; then a shot can come any half second.
  let t = target * SET_UP_SHARE;
  // Half a second on top for the slices: the wait comes out right on average.
  const rate = 1 / Math.max(1, target * (1 - SET_UP_SHARE) + 0.5);
  for (;;) {
    const left = clock - t;
    if (left <= 0) return clock;
    const urgency = left < 6 ? URGENCY * ((6 - left) / 6) ** 2 : 0;
    if (chance(s.rng, 1 - Math.exp(-(rate + urgency) * 0.5))) break;
    t += 0.5;
  }
  c.lateClock = clock - t < LATE_CLOCK_S;
  return t;
}

/** Spends clock time. Returns false if the period had already ended. */
function spend(c: Ctx, seconds: number): boolean {
  const s = c.s;
  if (s.clock <= 0) {
    c.done = true;
    return false;
  }
  const secs = Math.min(Math.max(seconds, c.buzzer ? 0.5 : 2), s.clock);
  s.clock -= secs;
  c.shotClock -= secs;
  tickFatigue(s, secs);
  return true;
}

/** Late-game foul to stop the clock: send their worst free-throw shooter on court to the line. */
function intentionalFoul(c: Ctx): void {
  const s = c.s;
  spend(c, range(s.rng, 2, 4));
  const target = [...s.teams[c.off].lineup].sort((a, b) => eff(s, c.off, a, 'freeThrow') - eff(s, c.off, b, 'freeThrow'))[0];
  const fouler = [...s.teams[c.def].lineup].sort((a, b) => pstate(s, c.def, a).fouls - pstate(s, c.def, b).fouls)[0];
  commitFoul(c, fouler, target, false);
  freeThrows(c, target, 2);
}

/** The star a called play goes to, honouring a defensive double team on them. */
function calledPlay(c: Ctx, doubled: string | null): { shotType: ShotType; shooter: string; assist?: string; extra: number } | null {
  const s = c.s;
  const call = c.calls.offence;
  if (!call || call === 'runClock' || c.setUsed) return null;
  c.setUsed = true;
  const lineup = s.teams[c.off].lineup;
  const best = (key: RatingKey, exclude?: string) =>
    lineup.filter((id) => id !== exclude).reduce((a, b) => (eff(s, c.off, b, key) > eff(s, c.off, a, key) ? b : a));
  switch (call) {
    case 'isoStar': {
      const star = starOnCourt(s, c.off);
      const options: [ShotType, number][] = [
        ['three', eff(s, c.off, star, 'three') - 2],
        ['drive', eff(s, c.off, star, 'driving')],
        ['mid', eff(s, c.off, star, 'midRange')],
        ['post', eff(s, c.off, star, 'insideScoring') + postBias(playerOf(s, c.off, star).position) - 8],
      ];
      const shotType = options.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
      return { shotType, shooter: star, extra: 0.01 };
    }
    case 'pickAndRoll': {
      const handler = best('playmaking');
      const roller = best('rollFinish', handler);
      const edge = pnrEdge(c, handler);
      return next(s.rng) < 0.55
        ? { shotType: 'pnrRoll', shooter: roller, assist: handler, extra: edge + 0.02 }
        : { shotType: 'pnrPull', shooter: handler, extra: edge + 0.01 };
    }
    case 'kickOut': {
      const shooter = best('three', doubled ?? undefined);
      const passer = best('playmaking', shooter);
      return { shotType: 'three', shooter, assist: passer, extra: 0.03 };
    }
    case 'postUp': {
      const big = best('insideScoring');
      return { shotType: 'post', shooter: big, extra: 0.015 };
    }
  }
}

/** A shot thrown up as the shot clock (or the quarter) runs out is a harder one. */
function clockShotMod(c: Ctx): number {
  return c.lateClock ? -LATE_CLOCK_PENALTY : 0;
}

/** How many credible shooters the offence has on the floor (0-5). */
function spacing(c: Ctx): number {
  return spacingScore(c.s.teams[c.off].lineup.map((id) => eff(c.s, c.off, id, 'three')));
}

/** What the defence gives up and takes away this possession: its scheme, any call, and how stretched it is. */
function defence(c: Ctx) {
  return defenceProfile(c.s.teams[c.def].plan.defence, c.calls.defence, spacing(c));
}

/**
 * Where the shot is taken. The shot type says how: a three from the corner or above the break, a
 * finish at the rim or a floater in the paint, a jumper from mid-range. Spacing and the defence
 * decide how often the offence gets the better spots.
 */
function chooseZone(c: Ctx, type: ShotType): { zone: ShotZone; courtSide: CourtSide } {
  const s = c.s;
  const profile = defence(c);
  const room = spacing(c) - SPACING_PIVOT;
  let zone: ShotZone;
  if (type === 'three') zone = chance(s.rng, clamp(CORNER_SHARE + profile.cornerShare + room * 0.02, 0.05, 0.6)) ? 'corner3' : 'aboveBreak3';
  else if (type === 'mid' || type === 'pnrPull') zone = 'mid';
  else zone = chance(s.rng, clamp((RIM_SHARE[type] ?? 0.6) + profile.rimShare + room * SPACING_RIM_SHARE, 0.1, 0.95)) ? 'restricted' : 'paint';
  const courtSide: CourtSide =
    zone === 'corner3' ? (chance(s.rng, 0.5) ? 'left' : 'right') : zone === 'restricted' || zone === 'paint' ? 'centre' : pick(s.rng, ['left', 'left', 'centre', 'right', 'right'] as const);
  return { zone, courtSide };
}

// ---------------------------------------------------------------------------
// Transition

/**
 * Out of a rebound or a steal: did they get ahead of the defence, and does the ball handler take
 * it? An open lane is taken most of the time, more often the more the coach wants to run; a numbers
 * advantage is attacked, and the last defender has to choose. Returns true if the possession was
 * finished in transition; otherwise they set up in the half court.
 */
/**
 * The moment `side` wins the ball (a defensive rebound, a steal): did they get ahead of the defence,
 * and how many of the other side got back? Decided now, so the floor can show it as it happens: the
 * defenders who got back are already on their way. Who pushes it, and whether he goes, too.
 */
export function planTransition(s: MatchState, side: Side, trigger: 'rebound' | 'steal'): TransitionPlan {
  const def = other(side);
  const offPlan = s.teams[side].plan;
  const speedEdge = teamAvg(s, side, 'speed') - teamAvg(s, def, 'speed');
  if (!chance(s.rng, fastBreakChance(trigger, offPlan, s.teams[def].plan, speedEdge))) return { situation: 'none' };
  const lineup = s.teams[side].lineup;
  // The quickest of them has the ball; a guard more often than a big.
  const handlerId = weighted(s.rng, lineup, (id) => Math.exp((eff(s, side, id, 'speed') - 60) / 10) * (lineup.indexOf(id) < 2 ? 1.6 : 1));
  // A steal leaves the floor open more often than a rebound and outlet.
  const situation: TransitionSituation = chance(s.rng, trigger === 'steal' ? 0.6 : 0.4) ? 'lane' : chance(s.rng, 0.5) ? 'twoOnOne' : 'threeOnTwo';
  const attack = chance(s.rng, transitionAttackChance(situation, offPlan, eff(s, side, handlerId, 'driving'), eff(s, side, handlerId, 'playmaking')));
  return { handlerId, situation, attack };
}

function runTransition(c: Ctx, trigger: 'rebound' | 'steal', planned: TransitionPlan | null): boolean {
  const s = c.s;
  const speedEdge = teamAvg(s, c.off, 'speed') - teamAvg(s, c.def, 'speed');
  const plan = planned ?? planTransition(s, c.off, trigger);
  if (plan.situation === 'none') return false;
  const { handlerId: handler, situation, attack } = plan;
  const lineup = s.teams[c.off].lineup;
  if (!lineup.includes(handler)) return false;
  emit(s, { type: 'transition', side: c.off, handlerId: handler, situation, attack });
  if (!attack) {
    // He pulls it out: a few seconds of pushing it up, then the half court.
    spend(c, range(s.rng, 2, 4));
    return false;
  }
  usageDrain(s, c.off, handler, 0.5);
  const others = lineup.filter((id) => id !== handler);
  if (situation === 'lane') {
    if (chance(s.rng, laneClosesChance(speedEdge))) {
      // A defender recovers into the lane: go up through him, kick it out, or pull it back.
      const then = pick(s.rng, ['finish', 'finish', 'kick', 'pullBack'] as const);
      emit(s, { type: 'transitionRead', side: c.off, handlerId: handler, read: 'laneClosed', then });
      if (then === 'pullBack') {
        spend(c, range(s.rng, 2, 4));
        return false;
      }
      c.fastBreak = true;
      spend(c, range(s.rng, 3.5, 6.5));
      emit(s, { type: 'fastBreak', side: c.off, leaderId: handler });
      if (then === 'kick') {
        const shooter = weighted(s.rng, others, (id) => Math.exp((eff(s, c.off, id, 'three') - 60) / 8));
        shoot(c, 'three', shooter, handler, 0.03);
      } else shoot(c, 'fastBreak', handler, undefined, -0.1);
      return true;
    }
    c.fastBreak = true;
    spend(c, range(s.rng, 3, 6));
    emit(s, { type: 'fastBreak', side: c.off, leaderId: handler });
    shoot(c, 'fastBreak', handler, undefined, 0.05);
    return true;
  }
  // The numbers: the last defender has to pick one of them.
  c.fastBreak = true;
  spend(c, range(s.rng, 3.5, 7));
  if (chance(s.rng, 0.55)) {
    const mate = weighted(s.rng, others, (id) => Math.exp((eff(s, c.off, id, 'rollFinish') - 60) / 10));
    emit(s, { type: 'transitionRead', side: c.off, handlerId: handler, read: 'defenderCommits', then: 'dish' });
    emit(s, { type: 'fastBreak', side: c.off, leaderId: handler });
    shoot(c, 'fastBreak', mate, handler, 0.06);
  } else if (situation === 'threeOnTwo' && chance(s.rng, 0.35)) {
    // The trailer spots up for an open transition three.
    emit(s, { type: 'fastBreak', side: c.off, leaderId: handler });
    const shooter = weighted(s.rng, others, (id) => Math.exp((eff(s, c.off, id, 'three') - 60) / 8));
    shoot(c, 'three', shooter, handler, 0.04);
  } else {
    emit(s, { type: 'fastBreak', side: c.off, leaderId: handler });
    shoot(c, 'fastBreak', handler, undefined, -0.03);
  }
  return true;
}

/** Returns true if the press decided the possession (turnover or a broken press leading to a shot). */
function runPress(c: Ctx): boolean {
  const s = c.s;
  const handling = teamAvg(s, c.off, 'ballSecurity');
  const handler = weighted(s.rng, s.teams[c.off].lineup, (id) => Math.exp((eff(s, c.off, id, 'ballSecurity') - 60) / 8));
  const execution = s.teams[c.def].team.execution;
  if (chance(s.rng, pressTurnoverChance(handling, execution))) {
    spend(c, range(s.rng, 3, 7));
    const trapper = weighted(s.rng, s.teams[c.def].lineup, (id) => eff(s, c.def, id, 'perimeterD'));
    turnover(c, handler, chance(s.rng, 0.6) ? trapper : undefined, 'pressTrap');
    return true;
  }
  const speedEdge = teamAvg(s, c.off, 'speed') - teamAvg(s, c.def, 'speed');
  if (chance(s.rng, pressBreakChance(handling, speedEdge))) {
    spend(c, range(s.rng, 4, 8));
    emit(s, { type: 'pressBroken', side: c.off, handlerId: handler });
    const finisher = weighted(
      s.rng,
      s.teams[c.off].lineup.filter((id) => id !== handler),
      (id) => Math.exp((eff(s, c.off, id, 'rollFinish') - 60) / 10),
    );
    shoot(c, 'pressBreak', finisher, handler, 0);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Half court

function runHalfCourt(c: Ctx): void {
  const s = c.s;
  const offPlan = s.teams[c.off].plan;
  const defPlan = s.teams[c.def].plan;
  const lineup = s.teams[c.off].lineup;

  // Non-shooting foul (reach-in, hold). Side-out unless in the bonus.
  if (chance(s.rng, nonShootingFoulRate(defPlan))) {
    const onId = weighted(s.rng, lineup, (id) => eff(s, c.off, id, 'ballSecurity'));
    const fouler = weighted(s.rng, s.teams[c.def].lineup, (id) => 110 - eff(s, c.def, id, 'perimeterD'));
    const bonus = commitFoul(c, fouler, onId, false);
    if (bonus) {
      freeThrows(c, onId, 2);
    }
    // A side-out: the shot clock goes back to 14 if it was lower.
    c.shotClock = Math.max(c.shotClock, RESET_SHOT_CLOCK);
    return;
  }

  // Turnover.
  const handler = weighted(s.rng, lineup, (id) => Math.exp((eff(s, c.off, id, 'ballSecurity') - 60) / 10));
  const pressure = teamAvg(s, c.def, 'perimeterD');
  const toChance = clamp(
    TURNOVER_BASE -
      0.14 * ((eff(s, c.off, handler, 'ballSecurity') - 70) / 100) +
      0.08 * ((pressure - 70) / 100) +
      0.06 * ((teamAvg(s, c.off, 'ballSecurity') - 65) / -100) +
      turnoverPlanMod(offPlan, defPlan) +
      (c.calls.offence && !c.setUsed ? CALL_TURNOVER[c.calls.offence] : 0),
    0.05,
    0.3,
  );
  if (chance(s.rng, toChance)) {
    const stealer =
      chance(s.rng, 0.55) ? weighted(s.rng, s.teams[c.def].lineup, (id) => Math.exp((eff(s, c.def, id, 'perimeterD') - 60) / 10)) : undefined;
    const causes: TurnoverCause[] = offPlan.tempo === 'slow' ? ['badPass', 'travel', 'offensiveFoul', 'shotClock'] : ['badPass', 'travel', 'offensiveFoul'];
    turnover(c, handler, stealer, stealer ? 'steal' : pick(s.rng, causes));
    return;
  }

  // Choose a play and a shooter. With the clock running out, or the game slipping away, it is
  // the shot they can get off: pull-ups and threes.
  const weights = playWeights(offPlan);
  if (c.lateClock || c.hurry) {
    weights.three *= c.hurry ? 2 : 1.5;
    weights.mid *= 1.3;
    weights.post *= 0.6;
    weights.pnr *= 0.8;
  }
  const plays = Object.keys(weights) as HalfCourtPlay[];
  const play = weighted(s.rng, plays, (p) => weights[p]);
  const doubled =
    c.calls.defence === 'doubleStar'
      ? starOnCourt(s, c.off)
      : defPlan.keyMatchup.kind === 'double' && lineup.includes(defPlan.keyMatchup.targetId)
        ? defPlan.keyMatchup.targetId
        : null;

  let shotType: ShotType;
  let shooter: string;
  let assist: string | undefined;
  let extra = 0;

  const called = calledPlay(c, doubled);
  if (called) {
    ({ shotType, shooter, assist } = called);
    extra += called.extra;
  } else if (play === 'pnr') {
    const ballHandler = pickShooter(c, (id) => eff(s, c.off, id, 'playmaking') + (['PG', 'SG'].includes(playerOf(s, c.off, id).position) ? 8 : -10), doubled);
    const roller = pickShooter(
      c,
      (id) => eff(s, c.off, id, 'rollFinish') + (['PF', 'C'].includes(playerOf(s, c.off, id).position) ? 8 : -12),
      doubled,
      ballHandler,
    );
    extra += pnrEdge(c, ballHandler);
    const roll = next(s.rng);
    if (roll < 0.42) {
      shotType = 'pnrRoll';
      shooter = roller;
      assist = ballHandler;
    } else if (roll < 0.75) {
      shotType = 'pnrPull';
      shooter = ballHandler;
    } else {
      // Kick-out to an open shooter when the defence collapses.
      shotType = 'three';
      shooter = pickShooter(c, (id) => eff(s, c.off, id, 'three'), doubled, ballHandler);
      assist = ballHandler;
      extra += 0.02;
    }
  } else {
    shotType = play;
    const key = play === 'post' ? 'insideScoring' : play === 'drive' ? 'driving' : play === 'mid' ? 'midRange' : 'three';
    shooter = pickShooter(c, (id) => eff(s, c.off, id, key) + (play === 'post' ? postBias(playerOf(s, c.off, id).position) : 0), doubled);
  }

  if (doubled && shooter === doubled) {
    if (chance(s.rng, DOUBLE_TEAM.passOutChance)) {
      const outlet = pickShooter(c, (id) => Math.max(eff(s, c.off, id, 'three'), eff(s, c.off, id, 'midRange')), null, doubled);
      emit(s, { type: 'doubleTeam', side: c.off, targetId: doubled, passedToId: outlet });
      shotType = eff(s, c.off, outlet, 'three') >= eff(s, c.off, outlet, 'midRange') - 8 ? 'three' : 'mid';
      shooter = outlet;
      assist = doubled;
      extra += DOUBLE_TEAM.openShotMod;
    } else {
      emit(s, { type: 'doubleTeam', side: c.off, targetId: doubled });
      extra += DOUBLE_TEAM.targetShotMod;
    }
  }

  shoot(c, shotType, shooter, assist, extra);
}

function postBias(pos: string): number {
  return pos === 'C' || pos === 'PF' ? 8 : pos === 'SF' ? 0 : -12;
}

/** Weighted pick of a shooter by rating; tired players and a doubled star get the ball less. */
function pickShooter(c: Ctx, rating: (id: string) => number, doubled: string | null, exclude?: string): string {
  const s = c.s;
  const pool = s.teams[c.off].lineup.filter((id) => id !== exclude);
  return weighted(s.rng, pool, (id) => {
    let w = Math.exp((rating(id) - 60) / 12) * fatigueFactor(pstate(s, c.off, id).energy);
    if (id === doubled) w *= DOUBLE_TEAM.targetUsage;
    return w;
  });
}

/** Pick-and-roll: quick handler vs a slow big punishes man defence. */
function pnrEdge(c: Ctx, handler: string): number {
  const s = c.s;
  const bigs = s.teams[c.def].lineup.slice(3);
  const bigSpeed = bigs.reduce((sum, id) => sum + eff(s, c.def, id, 'speed'), 0) / bigs.length;
  const gap = eff(s, c.off, handler, 'speed') - bigSpeed;
  const edge = clamp(gap * PNR_SPEED_EDGE.perPoint, PNR_SPEED_EDGE.min, PNR_SPEED_EDGE.max);
  return s.teams[c.def].plan.defence === 'zone' ? edge * PNR_ZONE_DAMPING : edge;
}

// ---------------------------------------------------------------------------
// Defence assignments

/** Who guards `shooterId` in man defence: same slot, unless the key matchup says otherwise. */
function matchedDefender(s: MatchState, off: Side, shooterId: string): string {
  const def = other(off);
  const offLineup = s.teams[off].lineup;
  const defLineup = s.teams[def].lineup;
  const km = s.teams[def].plan.keyMatchup;
  if (km.kind === 'assign' && defLineup.includes(km.defenderId) && offLineup.includes(km.targetId)) {
    if (shooterId === km.targetId) return km.defenderId;
    // The player the assigned defender would normally guard takes over the target's usual defender.
    const normallyGuardedBy = defLineup[offLineup.indexOf(shooterId)];
    if (normallyGuardedBy === km.defenderId) return defLineup[offLineup.indexOf(km.targetId)];
  }
  return defLineup[offLineup.indexOf(shooterId)];
}

/** The defensive rating a shot is contested with, and who gets credit for blocks/fouls. */
function contest(c: Ctx, shooter: string, type: ShotType): { rating: number; defenderId: string } {
  const s = c.s;
  const scheme = s.teams[c.def].plan.defence;
  const inside = INSIDE_SHOTS.has(type);
  if (scheme === 'zone') {
    // Zone: no individual mismatches. The paint is guarded by the two best rim protectors.
    if (inside) {
      const sorted = [...s.teams[c.def].lineup].sort((a, b) => eff(s, c.def, b, 'rimProtection') - eff(s, c.def, a, 'rimProtection'));
      const rating = (eff(s, c.def, sorted[0], 'rimProtection') + eff(s, c.def, sorted[1], 'rimProtection')) / 2;
      return { rating, defenderId: sorted[0] };
    }
    return { rating: teamAvg(s, c.def, 'perimeterD'), defenderId: matchedDefender(s, c.off, shooter) };
  }
  const defender = matchedDefender(s, c.off, shooter);
  if (type === 'post' || type === 'pnrRoll' || type === 'putback') return { rating: eff(s, c.def, defender, 'rimProtection'), defenderId: defender };
  if (type === 'drive') {
    const help = bestOnCourt(s, c.def, 'rimProtection');
    return { rating: 0.7 * eff(s, c.def, defender, 'perimeterD') + 0.3 * eff(s, c.def, help, 'rimProtection'), defenderId: defender };
  }
  if (type === 'fastBreak' || type === 'pressBreak') return { rating: teamAvg(s, c.def, 'speed') * 0.9, defenderId: defender };
  return { rating: eff(s, c.def, defender, 'perimeterD'), defenderId: defender };
}

// ---------------------------------------------------------------------------
// Shooting

function makeChance(c: Ctx, type: ShotType, zone: ShotZone, shooter: string, defRating: number, extra: number): number {
  const s = c.s;
  const o = (key: RatingKey) => (eff(s, c.off, shooter, key) - 70) / 100;
  const d = (defRating - 70) / 100;
  // An average NBA shooter from that spot, then how the shot was taken, then this shooter and his defender.
  let p = ZONE_BASE[zone] + SHOT_TYPE_MOD[type];
  switch (type) {
    case 'post': p += 0.45 * o('insideScoring') - 0.35 * d; break;
    case 'drive': p += 0.4 * o('driving') - 0.3 * d; break;
    case 'pnrRoll': p += 0.4 * o('rollFinish') - 0.25 * d; break;
    case 'pnrPull': p += 0.4 * o('midRange') - 0.25 * d; break;
    case 'mid': p += 0.45 * o('midRange') - 0.25 * d; break;
    case 'three': p += 0.45 * o('three') - 0.2 * d; break;
    case 'fastBreak': p += 0.3 * o('driving') - 0.2 * d; break;
    case 'pressBreak': p += 0.3 * o('rollFinish') - 0.2 * d; break;
    case 'putback': p += 0.4 * o('insideScoring') - 0.3 * d; break;
  }

  const offTeam = s.teams[c.off];
  const defTeam = s.teams[c.def];
  // How contested the zone is against this defence. Tactical modifiers are scaled by how well the
  // *benefiting* side executes.
  const scheme = defence(c).contest[zone] ?? 0;
  p += scheme > 0 ? scheme * offTeam.team.execution : scheme * defTeam.team.execution;
  // Shooters on the floor keep the help away from the basket.
  if (zone === 'restricted' || zone === 'paint') p += (spacing(c) - SPACING_PIVOT) * SPACING_INSIDE_MOD;

  const jumper = type === 'three' || type === 'mid';
  if (jumper) {
    // Ball movement creates open looks; a great shooter with no passers suffers.
    const passing = teamTop(s, c.off, 'playmaking');
    p += (passing - 65) * 0.0015;
    if (defTeam.plan.defence === 'zone') p += (passing - 65) * ZONE_PASSING_BONUS;
  }

  if (!c.fastBreak && type !== 'pressBreak') {
    const athleticism = (teamAvg(s, c.off, 'speed') + avgStamina(s, c.off)) / 2;
    const iq = avgAttr(s, c.off, 'tactics');
    p += (tempoShotMod(offTeam.plan.tempo, athleticism, iq) + focusShotMod(offTeam.plan.offence)) * offTeam.team.execution;
  }

  const momentumForOffence = c.off === 0 ? s.momentum : -s.momentum;
  p += 0.02 * momentumForOffence;
  p += 0.02 * offTeam.morale;
  p += clockShotMod(c);
  p += extra;
  return clamp(p, 0.12, 0.85);
}

function avgStamina(s: MatchState, side: Side): number {
  return avgAttr(s, side, 'stamina');
}

function avgAttr(s: MatchState, side: Side, key: 'stamina' | 'tactics'): number {
  const lineup = s.teams[side].lineup;
  return lineup.reduce((sum, id) => sum + playerOf(s, side, id).attrs[key], 0) / lineup.length;
}

function shoot(c: Ctx, type: ShotType, shooter: string, assist: string | undefined, extra: number): void {
  const s = c.s;
  const { zone, courtSide } = chooseZone(c, type);
  const points = zonePoints(zone);
  const { rating, defenderId } = contest(c, shooter, type);
  const p = makeChance(c, type, zone, shooter, rating, extra);
  usageDrain(s, c.off, shooter);

  // Shooting foul?
  const shooterP = playerOf(s, c.off, shooter);
  const defP = playerOf(s, c.def, defenderId);
  const foulChance = clamp(
    SHOOTING_FOUL_RATE[type] +
      (1 - fatigueFactor(pstate(s, c.def, defenderId).energy)) * 0.3 -
      (defP.attrs.tactics - 70) * 0.001 +
      (INSIDE_SHOTS.has(type) ? (composite(shooterP).insideScoring - 70) * 0.001 : 0),
    0.005,
    0.3,
  );
  const fouled = chance(s.rng, foulChance);
  const made = chance(s.rng, fouled ? p * 0.45 : p);

  if (fouled) commitFoul(c, defenderId, shooter, true);

  const stats = pstate(s, c.off, shooter).stats;
  if (made || !fouled) {
    stats.fga++;
    if (points === 3) stats.tpa++;
  }

  if (made) {
    stats.fgm++;
    if (points === 3) stats.tpm++;
    // A designed pass (pick-and-roll, kick-out) is credited most of the time; otherwise it depends on the shot type.
    let assistId: string | undefined;
    if (assist) assistId = chance(s.rng, 0.85) ? assist : undefined;
    else if (chance(s.rng, ASSIST_RATE[type])) assistId = pickPasser(c, shooter);
    if (assistId) pstate(s, c.off, assistId).stats.ast++;
    score(c, shooter, points, zone, type);
    const dunkable = type === 'drive' || type === 'pnrRoll' || type === 'fastBreak' || type === 'pressBreak' || type === 'putback' ? 1 : type === 'post' ? 0.35 : 0;
    const dunk = dunkable > 0 && zone === 'restricted' && chance(s.rng, dunkable * clamp((shooterP.attrs.dunk - 50) / 55, 0, 0.85)) ? true : undefined;
    emit(s, { type: 'shot', side: c.off, shooterId: shooter, shotType: type, zone, courtSide, points, made: true, assistId, andOne: fouled || undefined, dunk, ...clockFlags(c) });
    if (fouled) freeThrows(c, shooter, 1);
    else c.done = true;
    return;
  }

  if (fouled) {
    freeThrows(c, shooter, points);
    return;
  }

  // Missed: maybe blocked, then a rebound.
  let blockerId: string | undefined;
  const blockChance = INSIDE_SHOTS.has(type) ? 0.15 + 0.4 * ((teamTop(s, c.def, 'rimProtection') - 70) / 100) : 0.02;
  if (chance(s.rng, clamp(blockChance, 0.01, 0.3))) {
    blockerId = weighted(s.rng, s.teams[c.def].lineup, (id) => Math.exp((eff(s, c.def, id, 'rimProtection') - 60) / 8));
    pstate(s, c.def, blockerId).stats.blk++;
    s.momentum = clamp(s.momentum + (c.def === 0 ? 0.03 : -0.03), -1, 1);
  }
  emit(s, { type: 'shot', side: c.off, shooterId: shooter, shotType: type, zone, courtSide, points, made: false, blockerId, ...clockFlags(c) });
  rebound(c, false);
}

function clockFlags(c: Ctx): { lateClock?: true; buzzer?: true } {
  return { lateClock: c.lateClock && !c.buzzer ? true : undefined, buzzer: c.buzzer ? true : undefined };
}

function pickPasser(c: Ctx, shooter: string): string {
  const s = c.s;
  const pool = s.teams[c.off].lineup.filter((id) => id !== shooter);
  return weighted(s.rng, pool, (id) => Math.exp((eff(s, c.off, id, 'playmaking') - 60) / 10));
}

function score(c: Ctx, shooter: string, pts: number, zone: ShotZone | 'ft', type?: ShotType): void {
  const s = c.s;
  addPoints(s, c.off, shooter, pts);
  const ex = s.teams[c.off].extras;
  if (zone === 'restricted' || zone === 'paint') ex.paintPts += pts;
  if (c.fastBreak || type === 'pressBreak') ex.fastBreakPts += pts;
  if (c.secondChance) ex.secondChancePts += pts;
}

// ---------------------------------------------------------------------------
// Fouls, free throws, rebounds, turnovers

/** Records a foul. Returns true if it puts the offence in the bonus (non-shooting fouls only). */
function commitFoul(c: Ctx, fouler: string, onId: string, shooting: boolean): boolean {
  const s = c.s;
  const team = s.teams[c.def];
  const ps = team.players[fouler];
  ps.fouls++;
  ps.stats.pf++;
  team.quarterFouls++;
  if (s.clock <= LATE_PERIOD_SECONDS) team.lateFouls++;
  const bonus = !shooting && (team.quarterFouls >= BONUS_FOULS || team.lateFouls >= LATE_BONUS_FOULS);
  emit(s, { type: 'foul', side: c.def, playerId: fouler, onId, shooting, bonus });
  if (ps.fouls >= FOUL_LIMIT && !ps.fouledOut) {
    ps.fouledOut = true;
    emit(s, { type: 'foulOut', side: c.def, playerId: fouler });
  }
  return bonus;
}

function freeThrows(c: Ctx, shooter: string, count: number): void {
  const s = c.s;
  const ft = eff(s, c.off, shooter, 'freeThrow');
  const p = clamp(0.35 + 0.55 * (ft / 100), 0.4, 0.95);
  const stats = pstate(s, c.off, shooter).stats;
  let lastMade = false;
  for (let i = 1; i <= count; i++) {
    lastMade = chance(s.rng, p);
    stats.fta++;
    if (lastMade) {
      stats.ftm++;
      score(c, shooter, 1, 'ft');
    }
    emit(s, { type: 'freeThrow', side: c.off, shooterId: shooter, made: lastMade, attempt: i, of: count });
  }
  if (lastMade) c.done = true;
  else rebound(c, true);
}

function rebound(c: Ctx, afterFreeThrow: boolean): void {
  const s = c.s;
  const offPlan = s.teams[c.off].plan;
  const defPlan = s.teams[c.def].plan;
  const edge = (teamTop(s, c.off, 'rebounding') - teamTop(s, c.def, 'rebounding')) / 100;
  let p = (afterFreeThrow ? 0.14 : 0.26) + 0.6 * edge + offRebPlanMod(offPlan, defPlan);
  if (defPlan.keyMatchup.kind === 'double') p += DOUBLE_TEAM.offRebMod;
  const offensive = chance(s.rng, clamp(p, 0.06, 0.5));
  const side = offensive ? c.off : c.def;
  const rebounder = weighted(s.rng, s.teams[side].lineup, (id) => Math.pow(eff(s, side, id, 'rebounding') / 50, 2.2));
  const st = pstate(s, side, rebounder).stats;
  if (offensive) st.oreb++;
  else st.dreb++;
  if (!offensive) {
    s.nextTransition = planTransition(s, c.def, 'rebound');
    emit(s, { type: 'rebound', side, playerId: rebounder, offensive, back: DEFENDERS_BACK[s.nextTransition.situation] });
    s.possession = c.def;
    s.transition = 'rebound';
    c.done = true;
    return;
  }
  emit(s, { type: 'rebound', side, playerId: rebounder, offensive });

  c.secondChance = true;
  c.fastBreak = false;
  c.shotClock = Math.max(c.shotClock, RESET_SHOT_CLOCK);
  c.lateClock = false;
  // A big who grabs it under the rim goes straight back up.
  const putback = 0.25 + (eff(s, c.off, rebounder, 'insideScoring') - 60) * 0.008;
  if (chance(s.rng, clamp(putback, 0.1, 0.55)) && spend(c, range(s.rng, 1, 3))) {
    shoot(c, 'putback', rebounder, undefined, 0);
  }
  // Otherwise the half-court loop resets the offence.
}

function turnover(c: Ctx, playerId: string, stealerId: string | undefined, cause: TurnoverCause): void {
  const s = c.s;
  pstate(s, c.off, playerId).stats.tov++;
  if (stealerId) {
    pstate(s, c.def, stealerId).stats.stl++;
    s.momentum = clamp(s.momentum + (c.def === 0 ? 0.04 : -0.04), -1, 1);
  }
  if (cause === 'offensiveFoul') {
    const ps = pstate(s, c.off, playerId);
    ps.fouls++;
    ps.stats.pf++;
    if (ps.fouls >= FOUL_LIMIT && !ps.fouledOut) {
      ps.fouledOut = true;
      emit(s, { type: 'foulOut', side: c.off, playerId });
    }
  }
  s.nextTransition = stealerId ? planTransition(s, c.def, 'steal') : null;
  emit(s, { type: 'turnover', side: c.off, playerId, cause, stealerId, back: s.nextTransition ? DEFENDERS_BACK[s.nextTransition.situation] : undefined });
  s.possession = c.def;
  s.transition = stealerId ? 'steal' : 'none';
  c.done = true;
}
