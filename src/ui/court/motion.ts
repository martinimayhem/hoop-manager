// Turns the beat targets into natural movement: players react, accelerate towards their spot at
// the pace the beat asks for (limited by their speed rating) and brake as they arrive, shuffle a
// little when off the ball, and the ball follows whoever has it: bounced in time with the
// handler's strides and shielded from the nearest defender, thrown when passed.

import { fatigueFactor } from '../../engine/ratings';
import type { Side } from '../../engine/types';
import { PACE_M_S, PASS_SPEED, PROBE_FROM_RIM_M, isRef, type Ball, type BallAction, type Beat, type Pace, type Pos, type Script, type ShotStyle } from './animation';
import { BODY_M, COURT, HOOP, MID_Y, guardSpot, insideCourt } from './formations';

/**
 * Shot mechanics per style: when in the beat the ball leaves the hands (0..1), how high the
 * shooter jumps (metres), and how high the hands hold the ball before release (metres, standing).
 */
const SHOTS: Record<ShotStyle, { release: number; jump: number; hands: [number, number] }> = {
  jumper: { release: 0.32, jump: 0.6, hands: [1.68, 2.32] },
  hook: { release: 0.36, jump: 0.43, hands: [1.68, 2.56] },
  layup: { release: 0.55, jump: 0.8, hands: [1.37, 2.32] },
  dunk: { release: 0.74, jump: 1.04, hands: [1.37, 2.41] },
  set: { release: 0.3, jump: 0, hands: [1.37, 1.95] },
  throw: { release: 0.05, jump: 0, hands: [1.22, 1.22] },
};

const ACCEL = 9; // m/s²: a real first step, not an instant top speed
const BRAKE = 7.3; // planned below ACCEL so a player always has the grip to stop on the spot
const HAND_HEIGHT = 1;
/** With the ball in his hands and not dribbling, a player has two steps: this far from where he gathered it. */
export const GATHER_STEPS_M = 1.2;
/** How far within those steps he may aim, leaving room to come to a stop. */
const STEP_TARGET_M = 0.8;
/** Dribbling slower than this, he can pick the ball up and stop inside his two steps. */
const PICK_UP_M_S = 1.5;
/** A rebounder chins the ball this long (game seconds) before he does anything with it. */
const CHIN_S = 0.4;
const CHIN_HEIGHT = 1.5;
/** A jump stop: how hard a player with the ball in his hands can stop (m/s²). */
const JUMP_STOP = 18;
/** Bounces a second when standing; a moving handler bounces once every two steps. */
const STANDING_BOUNCE_HZ = 2.2;
/** Never more than this many bounces a second, however fast he goes. */
const MAX_BOUNCE_HZ = 3;
const GUARDED_M = 1.8;
/** Someone caught outside the bounds walks back in rather than snapping there. */
const BOUNDS_M_S = 12;
/** Players stay this far inside the lines even when shuffling. */
const BOUNDS_MARGIN = 0.3;
const REBOUND_JUMP_M = 0.8;
/** How high a rebound is taken: above the rim, at the top of the jump. */
const CATCH_Z = 3.55;
/** Hands go up for a rebound while the ball is above this height and this close. */
const REACH_BALL_Z = 1.6;
const REACH_BALL_M = 3.5;
/** A challenger further than this from the shooter has no shot to contest. */
const CONTEST_M = 2.5;
/** Hands go up or down in about an eighth of a second. */
const ARM_RATE = 8;
/** Bodies turn at a steady 180 degrees a second; only someone with the ball, or reacting to it, turns twice as fast. */
const TURN_RATE = Math.PI;
const QUICK_TURN_RATE = Math.PI * 2;
/** Turns smaller than this are left alone, so nobody fidgets on the spot. */
const TURN_DEAD_ZONE = (5 * Math.PI) / 180;
/** Between these speeds a player turns from what they are watching to where they are running. */
const LOOK_RUN_FROM = 1.5;
const LOOK_RUN_TO = 3.5;
/** Between these distances from their spot, a player turns to run there rather than backing in. */
const RUN_TO_SPOT_FROM = 2;
const RUN_TO_SPOT_TO = 4;
/** The head follows the ball this far either side of the body. */
const HEAD_TURN = (70 * Math.PI) / 180;
/** Slower than this (m/s of game time), a player is standing. */
const STANDING_M_S = 0.4;
/** Off the ball, bodies follow the ball's flight this lazily (seconds); heads follow it exactly. */
const BALL_READ_S = 0.5;
/** Nobody runs faster than this. Feet are slower sideways, and slower still backwards. */
const TOP_SPEED = 8;
const SLIDE_M_S = 3.5;
const BACKPEDAL_M_S = 3.2;
/** With the ball nobody backpedals faster than a shuffle: he would lose it. He turns side-on instead. */
const HOLDER_BACK_M_S = 1.2;
/** Standing this long with a live dribble and nothing to do, the handler starts to probe (game seconds). */
const PROBE_AFTER_S = 0.6;
const PROBE_LEG_S = 1.3;
/** A probe, leg by leg (metres across, towards the basket): a couple of dribbles across, a hesitation at the rim, back across, home. */
const PROBE_LEGS: [number, number][] = [[1.4, 0], [0.7, 0.8], [-1.1, 0.1], [0, 0]];
/** A defender this far from where he should be has been beaten: he turns and runs to recover. */
const CHASE_M = 1.8;
/** How long a defender takes to read his man's move (seconds): quicker on the ball, which he is watching. */
const READ_S = 0.25;
const READ_ON_BALL_S = 0.12;
/** How long before a pass or shot the players involved start turning for it (seconds). */
const TURN_AHEAD_S = 0.5;
/** A defender this close to the ball handler stays square to them and slides, whatever the speed. */
const ON_BALL_M = 3;
/** A guarding defender this close to his man is down in his stance. */
const STANCE_M = 2.5;
/** The direction a player is running, as their body reads it: smoothed over this long (seconds). */
const HEADING_S = 0.3;
/** Nobody turns further than this one way within SPIN_WINDOW_S: a full spin cannot happen. */
const SPIN_LIMIT = (200 * Math.PI) / 180;
const SPIN_WINDOW_S = 1.5;
/** Within this of where he wants to face, a player finishes the turn whatever he has turned lately. */
const FINISH_TURN = (60 * Math.PI) / 180;
/** A ball this close is in his hands, or nearly: he stops turning to follow it. */
const BALL_IN_HANDS_M = 1.2;
/** A ball handler turning to face where he runs may come this far round, still short of a spin. */
const RUN_TURN_LIMIT = (280 * Math.PI) / 180;
/** Below this speed a player's running direction is just noise: he faces where he is heading instead. */
const HEADING_FROM_M_S = 1;

/** 0 below `a`, 1 above `b`, smooth in between. */
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Speed attribute to a multiplier on every pace: a slow centre visibly loses the race to a quick guard. */
export function speedFactor(rating: number): number {
  return Math.max(0.72, Math.min(1.14, 0.76 + (rating - 40) * 0.0075));
}

/** What the players are reacting to this frame. */
export interface FacingScene {
  action: BallAction;
  /** The next beat's ball action, once it is close enough to turn for. */
  next?: BallAction;
  ball: Pos;
  offence: Side;
  dir: 1 | -1;
  guards: Record<string, string>;
  /** A player with the ball in the post, back to the basket. */
  posting?: string;
  /** The ball is dead: whoever holds it squares up in his own time, with nobody to spin away from. */
  dead?: boolean;
}

/** `timeScale` is how fast the players' clock runs against real seconds at this playback speed. */
export function facingScene(script: Script, durations: number[], index: number, u: number, ball: Pos, timeScale: number): FacingScene {
  const left = durations[index] * (1 - u) * timeScale;
  return {
    action: script.beats[index].ball,
    next: left < TURN_AHEAD_S ? script.beats[index + 1]?.ball : undefined,
    ball,
    offence: script.offence,
    dir: script.dir,
    guards: script.guards,
    posting: script.beats[index].posting,
    dead: script.beats[index].dead,
  };
}

/** What the defence and the ball are doing, so players can react to them frame by frame. */
export interface LiveContext {
  offence: Side;
  dir: 1 | -1;
  /** Defender to attacker, for everyone guarding a man this beat. */
  marking?: Record<string, string>;
  pressing?: boolean;
  /** Where the ball was last frame. */
  ball?: Pos;
  /** Whoever is backing down in the post: going backwards with the ball is the point. */
  posting?: string;
  /** The ball is dead: once in their places, everyone stands still. */
  dead?: boolean;
  /** What the ball is doing this beat, so the handler's feet can follow the rules. */
  action?: BallAction;
  /** Players passing through their spot on the way further: no pulling up at it. */
  through?: string[];
  /** A break with nobody back: no defender cuts across in front of the ball handler. */
  openBreak?: boolean;
  /** Bringing the ball up or an open break: the open floor, where runners swerve round opponents. */
  openFloor?: boolean;
}

/**
 * The ball handler's footwork. Gathered: he has just caught it or picked it up. Dribbling: he may go
 * where he likes. Picked up: his dribble is over, so he must pass or shoot. Holding the ball (gathered
 * or picked up) he has two steps from where he gathered it, or a pivot.
 */
export type Footwork = 'gathered' | 'dribbling' | 'pickedUp';

export interface Handle {
  key: string;
  mode: Footwork;
  /** Where he gathered the ball (or picked up his dribble). */
  at: Pos;
  /** A rebounder holds the ball at his chin until this time (game seconds). */
  chinUntil: number;
  /** How he came by it: a catch, a rebound, a steal, an inbound, the end of a drive. */
  how: string;
  /** Kept waiting with a live dribble: the spot he was sent to, since when he has stood there, and when he began to probe (-1: not yet). */
  probe?: { spot: Pos; still: number; start: number };
}

/** The shortest turn from one angle to another, in -PI..PI. */
export function angleDiff(from: number, to: number): number {
  const d = (to - from) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d;
}

/** How a player is carrying the ball; smoothed so it never snaps from one side to the other. */
interface Carry {
  /** Sideways offset of the ball: -1..1 from one hand to the other. */
  lat: number;
  hand: 1 | -1;
  lead: number;
  height: number;
  bounce: number;
}

/** Bodies do not pass through each other: anyone closer than a body's width is eased apart. */
function keepApart(pos: Record<string, Pos>): void {
  const keys = Object.keys(pos);
  // A few passes: easing one pair apart can push a third player in a crowd.
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = pos[keys[i]];
        const b = pos[keys[j]];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= BODY_M) continue;
        const ux = d > 0.01 ? dx / d : 1;
        const uy = d > 0.01 ? dy / d : 0;
        // An official always gives way to a player; two players share it, unless one has a line
        // at his back: then the other gives all the way, rather than both being squeezed together.
        const refA = isRef(keys[i]);
        const refB = isRef(keys[j]);
        const gap = BODY_M - d;
        const pinned = (p: Pos, sx: number, sy: number) => {
          const moved = { x: p.x + sx * gap, y: p.y + sy * gap };
          return Math.hypot(insideCourt(moved, BOUNDS_MARGIN).x - moved.x, insideCourt(moved, BOUNDS_MARGIN).y - moved.y) > 0.01;
        };
        let shareA = refA === refB ? 0.5 : refA ? 1 : 0;
        if (refA === refB && !refA) {
          const aPinned = pinned(a, -ux, -uy);
          const bPinned = pinned(b, ux, uy);
          if (aPinned !== bPinned) shareA = aPinned ? 0 : 1;
        }
        pos[keys[i]] = { x: a.x - ux * gap * shareA, y: a.y - uy * gap * shareA };
        pos[keys[j]] = { x: b.x + ux * gap * (1 - shareA), y: b.y + uy * gap * (1 - shareA) };
      }
    }
  }
}

/** How far to the side of a defender's body the ball handler aims, past his shoulder. */
const STEER_CLEAR_M = BODY_M + 0.45;
/** Below this speed (m/s of game time), outside an open break, nobody swerves round anyone. */
const STEER_FROM_M_S = 3.5;
/** How far ahead he looks for someone in his way. */
const STEER_LOOK_M = 3;

/**
 * Where a player running from `p` to `target` should head so as not to run into an opponent: the
 * nearest opponent in his way (other than those in `ignore`) (ahead of him, closer than the target, and less than a shoulder's
 * width off his line) is gone round on the side he is already a little to, or the side with the
 * target on it. With nobody in the way, the target itself.
 */
export function steerAround(p: Pos, target: Pos, pos: Record<string, Pos>, key: string, offence: Side, ignore: ReadonlySet<string> = new Set()): Pos {
  const dx = target.x - p.x;
  const dy = target.y - p.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.5) return target;
  const ux = dx / d;
  const uy = dy / d;
  const mine = key.startsWith(`${offence}:`);
  let block: { along: number; lat: number } | null = null;
  for (const [k, o] of Object.entries(pos)) {
    if (k === key || isRef(k) || ignore.has(k) || k.startsWith(`${offence}:`) === mine) continue;
    const along = (o.x - p.x) * ux + (o.y - p.y) * uy;
    if (along <= 0 || along > Math.min(STEER_LOOK_M, d)) continue;
    const lat = -(o.x - p.x) * uy + (o.y - p.y) * ux;
    if (Math.abs(lat) >= STEER_CLEAR_M) continue;
    if (!block || along < block.along) block = { along, lat };
  }
  if (!block) return target;
  // Round the side away from him (he is to the left of the line, so go right, and the other way),
  // unless that side is off the floor: then round the other.
  const b = block;
  const pass = (side: number): Pos => {
    const offset = b.lat + side * STEER_CLEAR_M;
    return { x: p.x + ux * b.along - uy * offset, y: p.y + uy * b.along + ux * offset };
  };
  const away = b.lat > 0.02 ? -1 : b.lat < -0.02 ? 1 : hash(key) % 2 ? 1 : -1;
  const offFloor = (q: Pos) => {
    const inside = insideCourt(q);
    return Math.hypot(inside.x - q.x, inside.y - q.y) > 0.05;
  };
  const first = pass(away);
  if (!offFloor(first)) return first;
  const second = pass(-away);
  return offFloor(second) ? target : second;
}

/** A ball handler slower than this (m/s of game time) is not on the run. */
const RUNNING_M_S = 2;
/** How far to his side a defender keeps from a running handler's line, at least. */
const SIDE_CLEAR_M = 1.6;

/**
 * Where a defender at `p` heading for `target` should go so as never to cut across in front of a
 * ball handler at `h` running with velocity `v`: if he is in front of him (or level) and his target
 * is on the other side of the handler's line, the target is moved back to his own side, at least
 * SIDE_CLEAR_M off the line. Behind the handler, or with the handler not running, the target itself.
 */
export function keepToSide(p: Pos, target: Pos, h: Pos | undefined, v: Pos | undefined, speedScale: number): Pos {
  if (!h || !v) return target;
  const speed = Math.hypot(v.x, v.y) / speedScale;
  if (speed < RUNNING_M_S) return target;
  const ux = v.x / (speed * speedScale);
  const uy = v.y / (speed * speedScale);
  const along = (q: Pos) => (q.x - h.x) * ux + (q.y - h.y) * uy;
  const across = (q: Pos) => -(q.x - h.x) * uy + (q.y - h.y) * ux;
  if (along(p) < -BODY_M) return target;
  const mine = across(p);
  const theirs = across(target);
  const side = Math.abs(mine) > 0.05 ? Math.sign(mine) : Math.sign(theirs) || 1;
  if (Math.sign(theirs) === side && Math.abs(theirs) >= SIDE_CLEAR_M) return target;
  const lat = side * Math.max(SIDE_CLEAR_M, Math.abs(theirs) * (Math.sign(theirs) === side ? 1 : 0));
  const s = along(target);
  return insideCourt({ x: h.x + ux * s - uy * lat, y: h.y + uy * s + ux * lat });
}

/**
 * How long a ball thrown at `speed` takes to meet a receiver at `at` running at `v`: the pass is
 * aimed where he will be, not where he was. Coming towards the passer, that is sooner.
 */
function intercept(from: Pos, at: Pos, v: Pos, speed: number): number {
  const dx = at.x - from.x;
  const dy = at.y - from.y;
  const plain = Math.hypot(dx, dy) / speed;
  // |d + vT| = speed T, solved for the first T after the throw.
  const a = v.x * v.x + v.y * v.y - speed * speed;
  const b = 2 * (dx * v.x + dy * v.y);
  const c = dx * dx + dy * dy;
  let t = plain;
  if (Math.abs(a) < 1e-6) t = b < 0 ? -c / b : plain;
  else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const roots = [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)].filter((r) => r > 0);
      if (roots.length > 0) t = Math.min(...roots);
    }
  }
  // He may not keep running that way: never lead him by more than half as long again.
  return Math.min(t, plain * 1.5);
}

function keepInside(pos: Record<string, Pos>, key: string, maxStep: number): void {
  const p = pos[key];
  const inside = insideCourt(p, BOUNDS_MARGIN);
  const dx = inside.x - p.x;
  const dy = inside.y - p.y;
  const d = Math.hypot(dx, dy);
  if (d === 0) return;
  const step = Math.min(1, maxStep / d);
  pos[key] = { x: p.x + dx * step, y: p.y + dy * step };
}

export class Motion {
  pos: Record<string, Pos> = {};
  vel: Record<string, Pos> = {};
  /** Which way each player faces: radians in court space, from +x towards +y. */
  facing: Record<string, number> = {};
  /** Where each head is turned, as far as the neck allows. */
  look: Record<string, number> = {};
  /** How far each defender is down in a stance, 0..1. */
  stance: Record<string, number> = {};
  /** Each guarding defender's read of where his man is: a moment behind the man himself. */
  private read: Record<string, Pos> = {};
  /** Where each player is heading this frame. */
  private target: Record<string, Pos> = {};
  /** The ball as the off-ball players' bodies follow it. */
  private seen: Pos | null = null;
  /** Small weight shifts off the ball: an offset and when it next changes. */
  private shift: Record<string, { x: number; y: number; until: number }> = {};
  /** Each player's direction of running, smoothed, so a nudge from a teammate does not swing the body. */
  private heading: Record<string, Pos> = {};
  /** Each player's turns over the last SPIN_WINDOW_S: when, and how far (radians, signed). */
  private spin: Record<string, { at: number; turn: number }[]> = {};
  /** Which way each player was last turning, for a turn of about half a circle. */
  private turning: Record<string, number> = {};
  /** How far each player's hands are up: 0 at their sides, 1 reaching. Missing means 0. */
  reach: Record<string, number> = {};
  /** Who was close enough to leave the floor in a beat, decided once at take-off. */
  private takeOffs = new WeakMap<Beat, Record<string, boolean>>();
  private time = 0;
  /** Game seconds: real time scaled by playback speed, so the ball keeps pace with the players. */
  private clock = 0;
  private scale = 1;
  /** Each pass in the air: when and where it left the hands, and where it is aimed. */
  private flights = new WeakMap<BallAction, { start: number; from: Ball; aim: Pos; time: number }>();
  /** The last pass thrown: if its beat ends before it arrives, it keeps flying into the receiver's hands. */
  private lastPass: BallAction | null = null;
  /** The ball handler's footwork right now; null when nobody has the ball in play. */
  handle: Handle | null = null;
  /** Last frame's ball action and thrower, to tell how the ball came to the handler. */
  private lastAction: BallAction | null = null;
  private lastOutOfBounds: string | undefined;
  private speeds: Record<string, number> = {};
  private fatigue: Record<string, number> = {};
  private carry: Record<string, Carry> = {};
  private latest: Record<string, Pos> = {};
  private aim: Record<string, Pos> = {};
  private waiting: Record<string, number> = {};
  /** Where the ball left the shooter's hands, per shot action. */
  private releases = new WeakMap<BallAction, Ball>();

  /** Everyone stood on these spots, at rest: a cut, as on television, not a run to get there. */
  place(players: Record<string, Pos>): void {
    this.reset();
    for (const [k, p] of Object.entries(players)) {
      this.pos[k] = { ...p };
      this.vel[k] = { x: 0, y: 0 };
    }
    // Spots come from the script, which does not keep bodies apart: nobody starts inside someone.
    keepApart(this.pos);
  }

  reset(): void {
    this.pos = {};
    this.lastPass = null;
    this.handle = null;
    this.lastAction = null;
    this.vel = {};
    this.facing = {};
    this.look = {};
    this.stance = {};
    this.read = {};
    this.target = {};
    this.seen = null;
    this.shift = {};
    this.heading = {};
    this.spin = {};
    this.turning = {};
    this.reach = {};
    this.carry = {};
    this.latest = {};
    this.aim = {};
    this.waiting = {};
  }

  /** Speed rating per player key. Anyone missing runs at the plain pace. */
  setSpeedRatings(ratings: Record<string, number>): void {
    this.speeds = {};
    for (const [key, rating] of Object.entries(ratings)) this.speeds[key] = speedFactor(rating);
  }

  /** Energy (0-100) per player key: tired legs slow everyone down. */
  setEnergy(energy: Record<string, number>): void {
    this.fatigue = {};
    for (const [key, value] of Object.entries(energy)) this.fatigue[key] = fatigueFactor(value);
  }

  /** How fast this player moves right now, relative to the plain pace. */
  moveFactor(key: string): number {
    return (this.speeds[key] ?? 1) * (this.fatigue[key] ?? 1);
  }

  /**
   * Moves every player towards its target. Players not in `targets` disappear (subbed off). With
   * `live`, guarding defenders stay on their man as he moves rather than heading for the beat's spot.
   */
  update(targets: Record<string, Pos>, dt: number, speedScale: number, ballHolder: string | null, paces: Record<string, Pace> = {}, outOfBounds?: string, live?: LiveContext): void {
    this.time += dt;
    this.clock += dt * speedScale;
    this.scale = speedScale;
    const next: Record<string, Pos> = {};
    const nextVel: Record<string, Pos> = {};
    const accel = ACCEL * speedScale * speedScale;
    const brake = BRAKE * speedScale * speedScale;
    const gameDt = dt * speedScale;
    const handlerTarget = this.footwork(ballHolder, ballHolder ? targets[ballHolder] : undefined, outOfBounds, live);
    for (const [key, beatTarget] of Object.entries(targets)) {
      let target = key === ballHolder && handlerTarget ? handlerTarget : beatTarget;
      const man = live?.marking?.[key];
      if (live && man && this.pos[man]) {
        // On his man where the man is now, read a moment late: not where the beat will leave him.
        const r = (this.read[key] ??= { ...this.pos[man] });
        const follow = 1 - Math.exp(-gameDt / (man === ballHolder ? READ_ON_BALL_S : READ_S));
        r.x += (this.pos[man].x - r.x) * follow;
        r.y += (this.pos[man].y - r.y) * follow;
        const norm = (q: Pos): Pos => (live.dir === 1 ? q : { x: COURT.w - q.x, y: q.y });
        target = norm(guardSpot(norm(r), norm(live.ball ?? r), man === ballHolder, !!live.pressing));
        if (man === ballHolder) {
          // A handler coming at him: he gives ground first, a cushion that grows with the speed.
          const rim = norm(HOOP);
          const mv = this.vel[man] ?? { x: 0, y: 0 };
          const dx = rim.x - this.pos[man].x;
          const dy = rim.y - this.pos[man].y;
          const d = Math.hypot(dx, dy) || 1;
          const coming = Math.max(0, (mv.x * dx + mv.y * dy) / d / speedScale);
          const cushion = Math.min(1.2, coming * 0.25, Math.max(0, Math.hypot(target.x - rim.x, target.y - rim.y) - 1));
          target = { x: target.x + (dx / d) * cushion, y: target.y + (dy / d) * cushion };
        }
        target = insideCourt(target);
        // While his man stands, a defender in his stance is never still: little shuffle steps, side
        // to side across the line from the basket to his man.
        const mv = this.vel[man];
        if (mv && Math.hypot(mv.x, mv.y) < 0.8 * speedScale) {
          const rim = norm(HOOP);
          const across = Math.atan2(this.pos[man].y - rim.y, this.pos[man].x - rim.x) + Math.PI / 2;
          const shuffle = Math.sin(this.time * Math.PI * 2 * 0.6 + (hash(key) % 13)) * (man === ballHolder ? 0.12 : 0.2);
          target = { x: target.x + Math.cos(across) * shuffle, y: target.y + Math.sin(across) * shuffle };
        }
      } else delete this.read[key];
      this.target[key] = target;
      const p = this.pos[key];
      if (!p) {
        next[key] = { ...target };
        nextVel[key] = { x: 0, y: 0 };
        this.latest[key] = this.aim[key] = { ...target };
        continue;
      }
      const h = hash(key);
      // The ball handler goes first; teammates react a beat later, the defence later still. Each
      // player keeps his own reaction time, so they set off one by one, never as a group.
      const r = (hash(`${key}:react`) % 100) / 100;
      const delay = key === ballHolder ? 0 : live && !key.startsWith(`${live.offence}:`) ? 0.2 + r * 0.4 : 0.05 + r * 0.55;
      const aim = man ? target : this.reactedAim(key, target, delay, gameDt);
      let tx = aim.x;
      let ty = aim.y;
      if (key !== ballHolder && !man && !live?.dead && !isRef(key)) {
        // Off the ball nobody stands frozen: a small shift of weight every couple of seconds.
        let s = this.shift[key];
        if (!s || this.time > s.until) {
          const roll = (salt: string) => (hash(`${key}:${Math.floor(this.time * 2)}:${salt}`) % 1000) / 1000;
          const angle = roll('a') * Math.PI * 2;
          const len = 0.15 + roll('l') * 0.45;
          s = this.shift[key] = { x: Math.cos(angle) * len, y: Math.sin(angle) * len, until: this.time + 1.6 + roll('t') * 1.8 };
        }
        tx += s.x + Math.sin(this.time * (0.7 + (h % 7) * 0.08) + h) * 0.08;
        ty += s.y + Math.cos(this.time * (0.6 + (h % 5) * 0.09) + h * 0.7) * 0.06;
      }
      if (live?.openBreak && !live.dead && !man && ballHolder && key !== ballHolder && !isRef(key) && !key.startsWith(`${live.offence}:`)) {
        // On a break with nobody back, a defender in front of the ball handler stays on his own side
        // of the handler's line: wherever the beat sends him, he never cuts across in front of him.
        const side = keepToSide(p, { x: tx, y: ty }, this.pos[ballHolder], this.vel[ballHolder], speedScale);
        tx = side.x;
        ty = side.y;
      }
      const running = this.vel[key] ? Math.hypot(this.vel[key].x, this.vel[key].y) / speedScale > STEER_FROM_M_S : false;
      if (live && !live.dead && !man && key.startsWith(`${live.offence}:`) && (live.openBreak || (live.openFloor && running)) && key !== live.posting && !isRef(key)) {
        // In the open floor anyone on the move goes round an opponent in his way, not through him:
        // the ball handler round a defender, a runner round whoever is in his lane. He aims past the
        // shoulder. (A defender on his man is already moving with him. In the half court, at a walk
        // or a jog, the bodies easing apart is enough: a swerve there only loses his defender.)
        // Not round the man guarding him: giving ground in front of him is that defender's job.
        const guards = new Set(Object.entries(live.marking ?? {}).filter(([, m]) => m === key).map(([d]) => d));
        const around = steerAround(p, { x: tx, y: ty }, this.pos, key, live.offence, guards);
        // Only the direction changes: he heads past the shoulder at the same speed, without pulling
        // up there as if it were where he was going.
        const far = Math.hypot(tx - p.x, ty - p.y);
        const ax = around.x - p.x;
        const ay = around.y - p.y;
        const a = Math.hypot(ax, ay);
        if (a > 0.01) {
          tx = p.x + (ax / a) * far;
          ty = p.y + (ay / a) * far;
        }
      }
      let max = Math.min(TOP_SPEED, PACE_M_S[paces[key] ?? 'sprint'] * this.moveFactor(key)) * speedScale;
      const dx = tx - p.x;
      const dy = ty - p.y;
      const d = Math.hypot(dx, dy);
      const face = this.facing[key];
      if (face !== undefined && d > 0.001) {
        // Feet only go so fast sideways or backwards: past that, a player has to turn and run.
        const off = Math.abs(angleDiff(face, Math.atan2(dy, dx)));
        if (off > (2 * Math.PI) / 3) max = Math.min(max, (key === ballHolder && key !== live?.posting ? HOLDER_BACK_M_S : BACKPEDAL_M_S) * speedScale);
        else if (off > Math.PI / 3) max = Math.min(max, SLIDE_M_S * speedScale);
      }
      // Pulling up as he arrives, unless his spot is only on the way.
      const want = live?.through?.includes(key) ? Math.min(max, d * 6 * speedScale) : Math.min(max, Math.sqrt(2 * brake * d), d * 6 * speedScale);
      const v = this.vel[key];
      let ax = (d > 0.001 ? (dx / d) * want - v.x : -v.x) / dt;
      let ay = (d > 0.001 ? (dy / d) * want - v.y : -v.y) / dt;
      const a = Math.hypot(ax, ay);
      // With the ball in his hands he stops dead, in a jump stop, inside his two steps.
      const grip = key === ballHolder && this.handle?.key === key && this.handle.mode !== 'dribbling' ? JUMP_STOP * speedScale * speedScale : accel;
      if (a > grip) {
        ax *= grip / a;
        ay *= grip / a;
      }
      const vx = v.x + ax * dt;
      const vy = v.y + ay * dt;
      next[key] = { x: p.x + vx * dt, y: p.y + vy * dt };
      nextVel[key] = { x: vx, y: vy };
    }
    // More than once: a line can push someone back into a neighbour, who then has to give way along it.
    for (let round = 0; round < 3; round++) {
      keepApart(next);
      for (const key of Object.keys(next)) if (key !== outOfBounds && !isRef(key)) keepInside(next, key, BOUNDS_M_S * dt * speedScale);
    }
    // Bodies last: a player eased back onto the floor may have been put into someone. Whoever has
    // a line at his back stays put; the other gives way.
    keepApart(next);
    this.pos = next;
    this.vel = nextVel;
    for (const key of Object.keys(next)) this.updateCarry(key, dt * speedScale, speedScale, key === ballHolder);
    // A defender close on his man sinks into his stance; he comes up out of it as he runs.
    const stance: Record<string, number> = {};
    for (const key of Object.keys(next)) {
      const man = live?.marking?.[key];
      const m = man ? next[man] : undefined;
      const want = m && Math.hypot(m.x - next[key].x, m.y - next[key].y) < STANCE_M ? 1 : 0;
      const now = this.stance[key] ?? 0;
      const step = 4 * gameDt;
      const value = now + Math.max(-step, Math.min(step, want - now));
      if (value > 0) stance[key] = value;
    }
    this.stance = stance;
  }

  /**
   * The ball handler's feet, by the rules. With the ball in his hands he has two steps from where he
   * gathered it, or a pivot; to go further the ball goes to the floor first, and once he has picked
   * up his dribble he must pass or shoot. A rebounder chins the ball first. Returns where he may go.
   */
  private footwork(key: string | null, target: Pos | undefined, outOfBounds: string | undefined, live: LiveContext | undefined): Pos | undefined {
    const action = live?.action ?? null;
    const before = this.lastAction;
    const wasOut = this.lastOutOfBounds;
    this.lastAction = action;
    this.lastOutOfBounds = outOfBounds;
    // A dead ball, a throw-in, an official handing it over: the ball is not in play.
    if (!key || !target || !this.pos[key] || live?.dead || key === outOfBounds || isRef(key)) {
      this.handle = null;
      return target;
    }
    const p = this.pos[key];
    const v = this.vel[key] ?? { x: 0, y: 0 };
    const speed = Math.hypot(v.x, v.y) / this.scale;
    let h = this.handle;
    if (!h || h.key !== key) {
      const picked = before?.kind === 'toPlayer' && before.to === key;
      const pass = action?.kind === 'pass' && action.to === key ? action : before?.kind === 'pass' && before.to === key ? before : null;
      const team = (k: string) => k.slice(0, k.indexOf(':'));
      const how = picked
        ? before.high ? 'rebound' : 'loose ball'
        : pass
          ? pass.from === outOfBounds || pass.from === wasOut ? 'inbound' : team(pass.from) !== team(key) ? 'steal' : 'catch'
          : 'other';
      // A rebounder who came down on the spot chins it; one who took it in stride goes on with it.
      h = this.handle = { key, mode: 'gathered', at: { ...p }, chinUntil: picked && before.high && speed < PICK_UP_M_S ? this.clock + CHIN_S : 0, how };
    }
    // Off the boards he chins it first.
    if (this.clock < h.chinUntil) return { ...h.at };
    const scripted = action?.kind === 'held' && action.holder === key && action.dribble;
    if (scripted) h.mode = 'dribbling';
    else if (h.mode === 'dribbling') {
      // Told to stop: he dribbles into it, and picks the ball up once nearly stopped at his spot.
      if (speed < PICK_UP_M_S && Math.hypot(target.x - p.x, target.y - p.y) < STEP_TARGET_M) {
        h.mode = 'pickedUp';
        h.at = { ...p };
        h.how = 'end of drive';
      }
    } else if (h.mode === 'gathered') {
      // Somewhere to go, or still on the move from the catch: the ball goes to the floor first.
      const away = Math.hypot(target.x - h.at.x, target.y - h.at.y) > STEP_TARGET_M;
      const moving = speed > PICK_UP_M_S && Math.hypot(p.x - h.at.x, p.y - h.at.y) > 0.5;
      if (away || moving) h.mode = 'dribbling';
    }
    if (h.mode === 'dribbling') return scripted && live && key.startsWith(`${live.offence}:`) && key !== live.posting ? this.probe(h, speed, target, live) : target;
    // Two steps or a pivot from where he gathered it, never further.
    const d = Math.hypot(target.x - h.at.x, target.y - h.at.y);
    return d <= STEP_TARGET_M ? target : { x: h.at.x + ((target.x - h.at.x) / d) * STEP_TARGET_M, y: h.at.y + ((target.y - h.at.y) / d) * STEP_TARGET_M };
  }

  /**
   * Kept waiting with a live dribble (a teammate still coming, a screen not there yet), the handler
   * never just bounces it on the spot: after a moment he probes, across towards the middle, a
   * hesitation at the basket, back across and home, until the play moves him on.
   */
  private probe(h: Handle, speed: number, target: Pos, live: LiveContext): Pos {
    let pr = h.probe;
    if (!pr || Math.hypot(target.x - pr.spot.x, target.y - pr.spot.y) > 0.5) pr = h.probe = { spot: { ...target }, still: this.clock, start: -1 };
    if (pr.start < 0) {
      // Standing, at his spot or held off it by a body in the way.
      if (speed > 0.6) pr.still = this.clock;
      if (this.clock - pr.still < PROBE_AFTER_S) return target;
      pr.start = this.clock;
    }
    const rim = live.dir === 1 ? HOOP : { x: COURT.w - HOOP.x, y: HOOP.y };
    const d = Math.hypot(rim.x - pr.spot.x, rim.y - pr.spot.y) || 1;
    if (d <= PROBE_FROM_RIM_M) return target;
    const ux = (rim.x - pr.spot.x) / d;
    const uy = (rim.y - pr.spot.y) / d;
    // Across means (-uy, ux); the first leg goes towards the middle, or either way from the top.
    const middle = Math.abs(pr.spot.y - MID_Y) > 1.5 ? Math.sign(MID_Y - pr.spot.y) : hash(h.key) % 2 ? 1 : -1;
    const side = ux * middle >= 0 ? 1 : -1;
    const [across, towards] = PROBE_LEGS[Math.floor((this.clock - pr.start) / PROBE_LEG_S) % PROBE_LEGS.length];
    return insideCourt({ x: pr.spot.x - uy * across * side + ux * towards, y: pr.spot.y + ux * across * side + uy * towards });
  }

  /** Whether `key` has the ball bouncing: dribbling, by the script or because he has to move. */
  private dribbling(key: string): boolean {
    return this.handle?.key === key && this.handle.mode === 'dribbling';
  }

  /** Raises and lowers hands: a challenger at the shooter, rebounders under a ball in the air. */
  updateArms(beat: Beat, ball: Ball, u: number, dt: number, speedScale: number): void {
    const reach: Record<string, number> = {};
    const step = ARM_RATE * dt * speedScale;
    for (const key of Object.keys(this.pos)) {
      const want = this.wantsHandsUp(key, beat, ball, u) ? 1 : 0;
      const now = this.reach[key] ?? 0;
      const next = now + Math.max(-step, Math.min(step, want - now));
      if (next > 0) reach[key] = next;
    }
    this.reach = reach;
  }

  private wantsHandsUp(key: string, beat: Beat, ball: Ball, u: number): boolean {
    const me = this.pos[key];
    const a = beat.ball;
    if (beat.contest === key && a.kind === 'fromPlayer' && a.style !== 'throw') {
      const shooter = this.pos[a.from];
      return !!shooter && u < SHOTS[a.style].release + 0.35 && Math.hypot(shooter.x - me.x, shooter.y - me.y) < CONTEST_M;
    }
    return !!beat.reach?.includes(key) && ball.z > REACH_BALL_Z && Math.hypot(ball.x - me.x, ball.y - me.y) < REACH_BALL_M;
  }

  /** Decided once per beat: someone caught too far away runs instead of jumping at nothing. */
  private takesOff(beat: Beat, key: string, near: Pos, range: number): boolean {
    const decided = this.takeOffs.get(beat) ?? {};
    this.takeOffs.set(beat, decided);
    const me = this.pos[key];
    decided[key] ??= !!me && Math.hypot(near.x - me.x, near.y - me.y) < range;
    return decided[key];
  }

  /** How high everyone is off the floor right now: the shooter, a challenger, rebounders. */
  jumps(beat: Beat, u: number): Record<string, number> {
    const out: Record<string, number> = {};
    const a = beat.ball;
    const shot = this.lift(a, u);
    if (shot) out[shot.key] = shot.height;
    if (beat.contest && a.kind === 'fromPlayer' && a.style !== 'throw') {
      // A block peaks as the ball leaves the hands; anything else goes up just after the shooter.
      const release = SHOTS[a.style].release;
      const start = Math.max(0, release - (beat.block ? 0.22 : 0.12));
      const end = Math.min(1, release + (beat.block ? 0.22 : 0.3));
      const shooter = this.pos[a.from];
      if (u >= start && u <= end && shooter && (beat.block || this.takesOff(beat, beat.contest, shooter, CONTEST_M))) {
        const height = beat.block ? 0.9 : a.style === 'layup' || a.style === 'dunk' ? 0.7 : 0.55;
        out[beat.contest] = height * Math.sin((Math.PI * (u - start)) / (end - start));
      }
    }
    for (const k of beat.jump ?? []) {
      const spot = beat.players[k];
      if (spot && this.takesOff(beat, k, spot, 2)) out[k] = REBOUND_JUMP_M * Math.sin(Math.PI * u);
    }
    return out;
  }

  /**
   * Turns everyone towards what they should be facing: steadily, quickly only when the ball is
   * theirs to deal with, and not at all for a turn too small to matter. Heads follow the ball.
   */
  updateFacing(scene: FacingScene, dt: number, speedScale: number): void {
    const read = 1 - Math.exp(-(dt * speedScale) / BALL_READ_S);
    this.seen = this.seen ? { x: this.seen.x + (scene.ball.x - this.seen.x) * read, y: this.seen.y + (scene.ball.y - this.seen.y) * read } : { ...scene.ball };
    const facing: Record<string, number> = {};
    const look: Record<string, number> = {};
    const gameDt = dt * speedScale;
    const settle = 1 - Math.exp(-gameDt / HEADING_S);
    for (const key of Object.keys(this.pos)) {
      const v = this.vel[key];
      const hd = (this.heading[key] ??= { ...v });
      hd.x += (v.x - hd.x) * settle;
      hd.y += (v.y - hd.y) * settle;
      const { angle: want, quick } = this.wantedFacing(key, scene, speedScale);
      const now = this.facing[key];
      if (now === undefined) facing[key] = want;
      else {
        let turn = angleDiff(now, want);
        // Facing nearly the opposite way, the shorter way round flips from frame to frame: he keeps
        // turning the way he started, or he would jitter on the spot.
        const going = this.turning[key];
        if (going && Math.abs(turn) > (150 * Math.PI) / 180 && Math.sign(turn) !== going) turn += going * Math.PI * 2;
        const most = (quick ? QUICK_TURN_RATE : TURN_RATE) * gameDt;
        turn = !quick && Math.abs(turn) < TURN_DEAD_ZONE ? 0 : Math.max(-most, Math.min(most, turn));
        // Never round and round: whoever has turned most of the way round one way lately stops
        // turning that way. Counted each way separately, so swinging back does not reset it.
        const log = (this.spin[key] ??= []);
        while (log.length && this.clock - log[0].at > SPIN_WINDOW_S) log.shift();
        const turned = (sign: number) => log.reduce((sum, e) => (Math.sign(e.turn) === sign ? sum + Math.abs(e.turn) : sum), 0);
        // The ball handler turning to face where he is running may come further round, though never all the way.
        const holding = scene.action.kind === 'held' && scene.action.holder === key;
        const running = holding && Math.hypot(v.x, v.y) / speedScale > 1 && Math.abs(angleDiff(want, Math.atan2(hd.y, hd.x))) < Math.PI / 6;
        // The last bit of a turn is always allowed: squaring up is not spinning, and the other way
        // round would be the long way.
        const left = Math.abs(angleDiff(now, want));
        if (turn !== 0 && (!scene.dead || left > FINISH_TURN) && turned(Math.sign(turn)) + Math.abs(turn) > (running ? RUN_TURN_LIMIT : SPIN_LIMIT)) turn = 0;
        if (turn !== 0) log.push({ at: this.clock, turn });
        // Kept within one turn either way, so the angle never winds up.
        facing[key] = angleDiff(0, now + turn);
        if (Math.abs(angleDiff(facing[key], want)) < 0.3) delete this.turning[key];
        else if (turn !== 0) this.turning[key] = Math.sign(turn);
      }
      // The head turns to the ball, as far as the neck allows.
      const me = this.pos[key];
      const toBall = Math.atan2(scene.ball.y - me.y, scene.ball.x - me.x);
      look[key] = facing[key] + Math.max(-HEAD_TURN, Math.min(HEAD_TURN, angleDiff(facing[key], toBall)));
    }
    this.facing = facing;
    this.look = look;
  }

  private wantedFacing(key: string, scene: FacingScene, speedScale: number): { angle: number; quick: boolean } {
    const quick = (angle: number) => ({ angle, quick: true });
    const me = this.pos[key];
    const toward = (p: Pos): number => {
      const dx = p.x - me.x;
      const dy = p.y - me.y;
      return Math.hypot(dx, dy) < 0.05 ? (this.facing[key] ?? 0) : Math.atan2(dy, dx);
    };
    const toPlayer = (k: string) => toward(this.pos[k] ?? scene.ball);
    const attacksHoopAhead = key.startsWith(`${scene.offence}:`) === (scene.dir === 1);
    const hoop = toward(attacksHoopAhead ? HOOP : { x: COURT.w - HOOP.x, y: HOOP.y });

    // Backing down in the post: back to the basket the whole time; the turn comes with the shot.
    if (key === scene.posting && scene.action.kind === 'held' && scene.action.holder === key) return quick(hoop + Math.PI);
    // A hook goes up side-on, shoulder to the rim: a quarter turn from the post, whichever way is nearer.
    const now = this.facing[key] ?? hoop;
    const sideOn = Math.abs(angleDiff(now, hoop + Math.PI / 2)) < Math.abs(angleDiff(now, hoop - Math.PI / 2)) ? hoop + Math.PI / 2 : hoop - Math.PI / 2;

    // Whoever the ball's next move is about turns for it first, a moment before it happens.
    for (const a of [scene.action, scene.next]) {
      if (!a) continue;
      if (a.kind === 'fromPlayer' && a.from === key) return quick(a.style === 'throw' ? toward(a.to) : a.style === 'hook' ? sideOn : hoop);
      if (a.kind === 'pass' && a.from === key) return quick(toPlayer(a.to));
      if ((a.kind === 'pass' || a.kind === 'toPlayer') && a.to === key) {
        // He turns to the ball coming to him; in the last stride it is at his hands, and following
        // it round his body would spin him.
        const near = !!scene.dead && Math.hypot(scene.ball.x - me.x, scene.ball.y - me.y) < BALL_IN_HANDS_M;
        return quick(near ? (this.facing[key] ?? hoop) : toward(scene.ball));
      }
    }

    // Standing at a dead ball (in the lane at a free throw, say): the head follows the ball; the
    // body only turns when the ball goes past where the neck reaches, and then just far enough.
    const still = Math.hypot(this.vel[key]?.x ?? 0, this.vel[key]?.y ?? 0) / speedScale < STANDING_M_S;
    const facingNow = this.facing[key];
    if (scene.dead && still && facingNow !== undefined && !isRef(key) && !(scene.action.kind === 'held' && scene.action.holder === key)) {
      const d = angleDiff(facingNow, toward(this.seen ?? scene.ball));
      const reach = HEAD_TURN - (10 * Math.PI) / 180;
      if (Math.abs(d) <= reach) return { angle: facingNow, quick: false };
      return { angle: facingNow + d - Math.sign(d) * reach, quick: false };
    }

    // A shot, a rebound or a loose ball: everyone turns to it.
    const a = scene.action;
    if (a.kind !== 'held' && a.kind !== 'pass') return { angle: toward(scene.ball), quick: false };

    const holder = a.kind === 'held' ? a.holder : null;
    const withBall = a.kind === 'held' ? a.holder : a.from;
    const ballTeam = withBall.slice(0, withBall.indexOf(':') + 1);
    const v = this.vel[key];
    const speed = Math.hypot(v.x, v.y) / speedScale;
    const hd = this.heading[key] ?? v;
    const goal = this.target[key];
    const away = goal ? Math.hypot(goal.x - me.x, goal.y - me.y) : 0;
    // Where he is running; barely moving yet, where he is about to run.
    const travel = Math.hypot(hd.x, hd.y) / speedScale > HEADING_FROM_M_S || !goal || away < 0.3 ? Math.atan2(hd.y, hd.x) : toward(goal);
    // From watching the play to looking where they run, gradually: when moving fast, or when the
    // spot is still a long way off (turn and sprint there, then face up). Never a sudden flip.
    const run = Math.max(smoothstep(LOOK_RUN_FROM, LOOK_RUN_TO, speed), smoothstep(RUN_TO_SPOT_FROM, RUN_TO_SPOT_TO, away));
    const current = this.facing[key];
    const blend = (watch: number) => {
      let d = angleDiff(watch, travel);
      // Watching one way and running nearly the other: turn round on the side the body is already
      // on, so the way round never flips back and forth into a spin.
      if (current !== undefined && Math.abs(d) > (150 * Math.PI) / 180) {
        const side = angleDiff(watch, current);
        if (Math.abs(side) > 0.1 && Math.sign(side) !== Math.sign(d)) d -= Math.sign(d) * Math.PI * 2;
      }
      return watch + d * run;
    };
    const seen = this.seen ?? scene.ball;
    // An official watches the ball, wherever he is going.
    if (isRef(key)) return { angle: blend(toward(seen)), quick: false };
    if (key === holder) {
      // Backing away with the ball he is never square to his man, backpedalling into a steal: he
      // turns side-on, body between ball and defence, and further round the faster he goes.
      const back = angleDiff(hoop, travel);
      if (speed > 0.5 && Math.abs(back) > (100 * Math.PI) / 180) return quick(hoop + Math.sign(back) * Math.min(Math.abs(back), (110 * Math.PI) / 180 + run * Math.PI));
      return quick(blend(hoop));
    }
    // Off the ball, bodies turn at an even pace: into the last steps, never spun round on arrival.
    if (key.startsWith(ballTeam)) return { angle: blend(toward(seen)), quick: false };
    // Defence. On the ball: square to the handler, sliding; beaten by more than a step, he turns and runs.
    if (holder && this.pos[holder] && Math.hypot(this.pos[holder].x - me.x, this.pos[holder].y - me.y) < ON_BALL_M) {
      // Only the man guarding the handler can be beaten; a zone holds its ground.
      const t = this.target[key];
      const guarding = scene.guards[key] === holder;
      const beaten = guarding && !!t && Math.hypot(t.x - me.x, t.y - me.y) > CHASE_M;
      // Square to his man along the line from the basket: steady as they jostle, never circling him.
      const rim = scene.dir === 1 ? HOOP : { x: COURT.w - HOOP.x, y: HOOP.y };
      const h = this.pos[holder];
      const square = guarding ? Math.atan2(h.y - rim.y, h.x - rim.x) : toPlayer(holder);
      return quick(beaten ? blend(square) : square);
    }
    // Off the ball: see man and ball. A zone just watches the ball.
    const man = this.pos[scene.guards[key]];
    return { angle: blend(toward(man ? { x: (man.x + seen.x) / 2, y: (man.y + seen.y) / 2 } : seen)), quick: false };
  }

  /** A new spot takes a moment to read: `delay` seconds before setting off for it. */
  private reactedAim(key: string, target: Pos, delay: number, dt: number): Pos {
    const known = this.latest[key];
    if (!known || Math.hypot(known.x - target.x, known.y - target.y) > 0.6) this.waiting[key] = delay;
    this.latest[key] = target;
    this.waiting[key] = (this.waiting[key] ?? 0) - dt;
    if (this.waiting[key] <= 0 || !this.aim[key]) this.aim[key] = target;
    return this.aim[key];
  }

  private updateCarry(key: string, dt: number, speedScale: number, isHolder: boolean): void {
    const c = (this.carry[key] ??= { lat: 1, hand: 1, lead: 0.27, height: 0.9, bounce: 0 });
    if (!isHolder) return;
    const v = this.vel[key];
    const sp = Math.hypot(v.x, v.y);
    const smooth = 1 - Math.exp(-10 * dt);

    const running = sp / speedScale;
    const stepsPerSecond = 2 + running / 4;
    const before = Math.floor(c.bounce + 0.5);
    c.bounce += Math.max(STANDING_BOUNCE_HZ, Math.min(MAX_BOUNCE_HZ, stepsPerSecond * 0.8)) * dt;
    const bounced = Math.floor(c.bounce + 0.5) !== before; // the ball just hit the floor

    const defender = this.nearestOpponent(key);
    const guarded = defender !== null && defender.d < GUARDED_M;
    if (bounced) {
      if (guarded && defender) {
        // Keep the body between the ball and the defender; the switch happens low, on the bounce.
        const angle = this.facing[key] ?? 0;
        const side = (defender.x - this.pos[key].x) * -Math.sin(angle) + (defender.y - this.pos[key].y) * Math.cos(angle);
        c.hand = side > 0 ? -1 : 1;
      } else if (sp > 1.2 * speedScale) {
        // The hand on the side they are going: a crossover only comes with a change of direction.
        const angle = this.facing[key] ?? 0;
        const lateral = v.x * -Math.sin(angle) + v.y * Math.cos(angle);
        if (Math.abs(lateral) > 0.8 * speedScale) c.hand = lateral > 0 ? 1 : -1;
      }
    }
    c.lat += (c.hand - c.lat) * smooth;
    c.lead += ((guarded ? 0.12 : running > 4.9 ? 0.35 : 0.18) - c.lead) * smooth;
    c.height += ((guarded ? 0.7 : 0.88 + Math.min(0.18, (running / 7.9) * 0.18)) - c.height) * smooth;
  }

  private nearestOpponent(key: string): { x: number; y: number; d: number } | null {
    const colon = key.indexOf(':');
    if (colon < 0 || isRef(key)) return null;
    const side = key.slice(0, colon + 1);
    const me = this.pos[key];
    let best: { x: number; y: number; d: number } | null = null;
    for (const [other, p] of Object.entries(this.pos)) {
      if (other.startsWith(side) || isRef(other)) continue;
      const d = Math.hypot(p.x - me.x, p.y - me.y);
      if (!best || d < best.d) best = { x: p.x, y: p.y, d };
    }
    return best;
  }

  /** Whether a pass has reached the receiver's hands yet. */
  passArrived(action: BallAction): boolean {
    const f = this.flights.get(action);
    return !!f && this.clock - f.start >= f.time;
  }

  /** The shooter's jump height during a shot beat (null when nobody is shooting). */
  lift(action: BallAction, u: number): { key: string; height: number } | null {
    if (action.kind !== 'fromPlayer') return null;
    const { release, jump } = SHOTS[action.style];
    const land = action.style === 'dunk' ? 1 : Math.min(1, release * 2.1);
    let h = 0;
    if (u <= release) h = jump * Math.sin((Math.PI / 2) * (u / release));
    else if (u < land) h = jump * Math.cos((Math.PI / 2) * ((u - release) / (land - release)));
    return { key: action.from, height: h };
  }

  /** Where the ball is, given what it is doing and how far through the beat we are. */
  ball(action: BallAction, u: number, dir: 1 | -1): Ball {
    /** `wide`: how far to the side; the dribble is at the hip, a held ball is in front. */
    const hand = (key: string, height = HAND_HEIGHT, wide = 0.15): Ball => {
      const p = this.pos[key] ?? { x: COURT.w / 2, y: MID_Y };
      const c = this.carry[key];
      // Ball out in front of the body, the way they face, on the side of the hand in use.
      const angle = this.facing[key];
      const fx = angle === undefined ? dir : Math.cos(angle);
      const fy = angle === undefined ? 0 : Math.sin(angle);
      const lead = c?.lead ?? 0.27;
      const lat = (c?.lat ?? 1) * wide;
      return { x: p.x + fx * lead - fy * lat, y: p.y + fy * lead + fx * lat, z: height };
    };
    /** The dribble: at the hip, bouncing in time with his feet. */
    const bounced = (key: string): Ball => {
      const h = hand(key, HAND_HEIGHT, 0.38);
      const c = this.carry[key];
      const bounce = Math.abs(Math.cos((c?.bounce ?? 0) * Math.PI));
      return { ...h, z: 0.08 + ((c?.height ?? HAND_HEIGHT) - 0.08) * bounce };
    };
    const fly = (a: Ball, b: Ball, arc: number, t: number): Ball => ({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t + arc * 4 * t * (1 - t), // a real parabola, dropping onto its target
    });
    switch (action.kind) {
      case 'held': {
        const thrown = this.lastPass;
        if (thrown?.kind === 'pass' && thrown.to === action.holder && !this.passArrived(thrown)) return this.ball(thrown, u, dir);
        if (action.dribble || this.dribbling(action.holder)) return bounced(action.holder);
        // Off the boards the ball is chinned, up under the chin and away from reaching hands.
        const chinned = this.handle?.key === action.holder && this.clock < this.handle.chinUntil;
        return hand(action.holder, chinned ? CHIN_HEIGHT : HAND_HEIGHT, 0.15);
      }
      case 'pass': {
        // Thrown once, in a straight line on the floor at the speed of the pass, aimed where the
        // receiver will be; only the last stretch eases into their hands.
        const style = action.style ?? 'chest';
        let f = this.flights.get(action);
        if (!f) {
          const from = hand(action.from, 1.2);
          const receiver = this.pos[action.to] ?? from;
          const v = this.vel[action.to] ?? { x: 0, y: 0 };
          const lead = intercept(from, receiver, { x: v.x / this.scale, y: v.y / this.scale }, PASS_SPEED[style]);
          const aim = { x: receiver.x + (v.x / this.scale) * lead, y: receiver.y + (v.y / this.scale) * lead };
          f = { start: this.clock, from, aim, time: Math.max(0.2, Math.hypot(aim.x - from.x, aim.y - from.y) / PASS_SPEED[style]) };
          this.flights.set(action, f);
          this.lastPass = action;
        }
        const t = Math.min(1, (this.clock - f.start) / f.time);
        const caught = hand(action.to, 1.1);
        if (t >= 1) return this.dribbling(action.to) ? bounced(action.to) : caught;
        const ease = t < 0.75 ? 0 : (t - 0.75) / 0.25;
        const w = ease * ease * (3 - 2 * ease);
        const x = f.from.x + (f.aim.x - f.from.x) * t;
        const y = f.from.y + (f.aim.y - f.from.y) * t;
        let z: number;
        if (style === 'bounce') {
          // Down to the floor two thirds of the way, then up into the hands.
          const hit = 2 / 3;
          z = t < hit ? 0.11 + (f.from.z - 0.11) * (1 - (t / hit) ** 2) : 0.11 + (1.1 - 0.11) * Math.sin(((t - hit) / (1 - hit)) * (Math.PI / 2));
        } else {
          z = f.from.z + (1.1 - f.from.z) * t + action.arc * 4 * t * (1 - t);
        }
        return { x: x + (caught.x - x) * w, y: y + (caught.y - y) * w, z: z + (caught.z - z) * w };
      }
      case 'toPlayer': {
        if (!action.high) return fly(action.from, hand(action.to, 1.37), action.arc, u);
        // Taken overhead at the top of the jump, then brought down to the chest.
        const catchAt = hand(action.to, CATCH_Z);
        return u < 0.5 ? fly(action.from, catchAt, action.arc, u * 2) : fly(catchAt, hand(action.to, 1.37), 0, u * 2 - 1);
      }
      case 'fromPlayer': {
        // Gather and rise with the ball, let it go at the top of the jump, then it flies.
        const shot = SHOTS[action.style];
        const lift = this.lift(action, u)?.height ?? 0;
        if (u < shot.release) {
          const t = u / shot.release;
          return hand(action.from, shot.hands[0] + (shot.hands[1] - shot.hands[0]) * t + lift);
        }
        let from = this.releases.get(action);
        if (!from) {
          from = hand(action.from, shot.hands[1] + (this.lift(action, shot.release)?.height ?? 0));
          this.releases.set(action, from);
        }
        const t = (u - shot.release) / (1 - shot.release);
        // A dunk is slammed straight down through the rim.
        return fly(from, action.to, action.arc, action.style === 'dunk' ? Math.sqrt(t) : t);
      }
      case 'fixed':
        return fly(action.from, action.to, action.arc, u);
    }
  }
}
