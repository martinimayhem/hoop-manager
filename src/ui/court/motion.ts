// Turns the beat targets into natural movement: players react, accelerate towards their spot at
// the pace the beat asks for (limited by their speed rating) and brake as they arrive, shuffle a
// little when off the ball, and the ball follows whoever has it: bounced in time with the
// handler's strides and shielded from the nearest defender, thrown when passed.

import { fatigueFactor } from '../../engine/ratings';
import type { Side } from '../../engine/types';
import { PACE_M_S, type Ball, type BallAction, type Beat, type Pace, type Pos, type Script, type ShotStyle } from './animation';
import { BODY_M, COURT, HOOP, MID_Y, insideCourt } from './formations';

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
/** Bounces a second when standing; a moving handler bounces once every two steps. */
const STANDING_BOUNCE_HZ = 1.7;
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
/** Nobody turns faster than this (radians a second): 360 degrees. */
const TURN_RATE = Math.PI * 2;
/** How long before a pass or shot the players involved start turning for it (seconds). */
const TURN_AHEAD_S = 0.5;
/** A defender this close to the ball handler stays square to them and slides, whatever the speed. */
const ON_BALL_M = 3;
/** Above this speed a player looks where they are going; they stop once below the lower one. */
const RUN_START_M_S = 3;
const RUN_STOP_M_S = 2;

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
  };
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
  for (let pass = 0; pass < 4; pass++) {
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
        const push = (BODY_M - d) / 2;
        pos[keys[i]] = { x: a.x - ux * push, y: a.y - uy * push };
        pos[keys[j]] = { x: b.x + ux * push, y: b.y + uy * push };
      }
    }
  }
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
  private running: Record<string, boolean> = {};
  /** How far each player's hands are up: 0 at their sides, 1 reaching. Missing means 0. */
  reach: Record<string, number> = {};
  /** Who was close enough to leave the floor in a beat, decided once at take-off. */
  private takeOffs = new WeakMap<Beat, Record<string, boolean>>();
  private time = 0;
  private speeds: Record<string, number> = {};
  private fatigue: Record<string, number> = {};
  private carry: Record<string, Carry> = {};
  private latest: Record<string, Pos> = {};
  private aim: Record<string, Pos> = {};
  private waiting: Record<string, number> = {};
  /** Where the ball left the shooter's hands, per shot action. */
  private releases = new WeakMap<BallAction, Ball>();

  reset(): void {
    this.pos = {};
    this.vel = {};
    this.facing = {};
    this.running = {};
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

  /** Moves every player towards its target. Players not in `targets` disappear (subbed off). */
  update(targets: Record<string, Pos>, dt: number, speedScale: number, ballHolder: string | null, paces: Record<string, Pace> = {}, outOfBounds?: string): void {
    this.time += dt;
    const next: Record<string, Pos> = {};
    const nextVel: Record<string, Pos> = {};
    const accel = ACCEL * speedScale * speedScale;
    const brake = BRAKE * speedScale * speedScale;
    for (const [key, target] of Object.entries(targets)) {
      const p = this.pos[key];
      if (!p) {
        next[key] = { ...target };
        nextVel[key] = { x: 0, y: 0 };
        this.latest[key] = this.aim[key] = { ...target };
        continue;
      }
      const h = hash(key);
      const aim = this.reactedAim(key, target, h, key === ballHolder, dt * speedScale);
      // Off the ball, players never stand perfectly still.
      let tx = aim.x;
      let ty = aim.y;
      if (key !== ballHolder) {
        tx += Math.sin(this.time * (0.7 + (h % 7) * 0.08) + h) * 0.18;
        ty += Math.cos(this.time * (0.6 + (h % 5) * 0.09) + h * 0.7) * 0.15;
      }
      const max = PACE_M_S[paces[key] ?? 'sprint'] * this.moveFactor(key) * speedScale;
      const dx = tx - p.x;
      const dy = ty - p.y;
      const d = Math.hypot(dx, dy);
      const want = Math.min(max, Math.sqrt(2 * brake * d), d * 6 * speedScale);
      const v = this.vel[key];
      let ax = (d > 0.001 ? (dx / d) * want - v.x : -v.x) / dt;
      let ay = (d > 0.001 ? (dy / d) * want - v.y : -v.y) / dt;
      const a = Math.hypot(ax, ay);
      if (a > accel) {
        ax *= accel / a;
        ay *= accel / a;
      }
      const vx = v.x + ax * dt;
      const vy = v.y + ay * dt;
      next[key] = { x: p.x + vx * dt, y: p.y + vy * dt };
      nextVel[key] = { x: vx, y: vy };
    }
    // Twice: a line can push someone back into a neighbour, who then has to give way along it.
    for (let round = 0; round < 2; round++) {
      keepApart(next);
      for (const key of Object.keys(next)) if (key !== outOfBounds) keepInside(next, key, BOUNDS_M_S * dt * speedScale);
    }
    this.pos = next;
    this.vel = nextVel;
    for (const key of Object.keys(next)) this.updateCarry(key, dt * speedScale, speedScale, key === ballHolder);
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

  /** Turns everyone towards what they should be looking at, never faster than TURN_RATE. */
  updateFacing(scene: FacingScene, dt: number, speedScale: number): void {
    const facing: Record<string, number> = {};
    for (const key of Object.keys(this.pos)) {
      const v = this.vel[key];
      const speed = Math.hypot(v.x, v.y) / speedScale;
      this.running[key] = speed > (this.running[key] ? RUN_STOP_M_S : RUN_START_M_S);
      const want = this.wantedFacing(key, scene);
      const now = this.facing[key];
      if (now === undefined) {
        facing[key] = want;
        continue;
      }
      const turn = angleDiff(now, want);
      const most = TURN_RATE * dt * speedScale;
      facing[key] = now + Math.max(-most, Math.min(most, turn));
    }
    this.facing = facing;
  }

  private wantedFacing(key: string, scene: FacingScene): number {
    const me = this.pos[key];
    const toward = (p: Pos): number => {
      const dx = p.x - me.x;
      const dy = p.y - me.y;
      return Math.hypot(dx, dy) < 0.05 ? (this.facing[key] ?? 0) : Math.atan2(dy, dx);
    };
    const toPlayer = (k: string) => toward(this.pos[k] ?? scene.ball);
    const attacksHoopAhead = key.startsWith(`${scene.offence}:`) === (scene.dir === 1);
    const hoop = toward(attacksHoopAhead ? HOOP : { x: COURT.w - HOOP.x, y: HOOP.y });

    // Whoever the ball's next move is about turns for it first, a moment before it happens.
    for (const a of [scene.action, scene.next]) {
      if (!a) continue;
      if (a.kind === 'fromPlayer' && a.from === key) return a.style === 'throw' ? toward(a.to) : hoop;
      if (a.kind === 'pass' && a.from === key) return toPlayer(a.to);
      if ((a.kind === 'pass' || a.kind === 'toPlayer') && a.to === key) return toward(scene.ball);
    }

    // A shot, a rebound or a loose ball: every head follows it.
    const a = scene.action;
    if (a.kind !== 'held' && a.kind !== 'pass') return toward(scene.ball);

    const holder = a.kind === 'held' ? a.holder : null;
    const withBall = a.kind === 'held' ? a.holder : a.from;
    const ballTeam = withBall.slice(0, withBall.indexOf(':') + 1);
    const v = this.vel[key];
    const travel = Math.atan2(v.y, v.x);
    const running = this.running[key];
    if (key === holder) return running ? travel : hoop;
    if (key.startsWith(ballTeam)) return running ? travel : toward(scene.ball);
    // Defence. On the ball: square to the handler, sliding and backpedalling rather than turning away.
    if (holder && this.pos[holder] && Math.hypot(this.pos[holder].x - me.x, this.pos[holder].y - me.y) < ON_BALL_M) return toPlayer(holder);
    if (running) return travel;
    // Off the ball: see man and ball. A zone just watches the ball.
    const man = this.pos[scene.guards[key]];
    return toward(man ? { x: (man.x + scene.ball.x) / 2, y: (man.y + scene.ball.y) / 2 } : scene.ball);
  }

  /** A new spot takes a moment to read: nobody but the ball handler sets off instantly. */
  private reactedAim(key: string, target: Pos, h: number, isHolder: boolean, dt: number): Pos {
    const known = this.latest[key];
    if (!known || Math.hypot(known.x - target.x, known.y - target.y) > 1.2) this.waiting[key] = isHolder ? 0 : 0.08 + (h % 5) * 0.06;
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
    c.bounce += Math.max(STANDING_BOUNCE_HZ, stepsPerSecond / 2) * dt;
    const bounced = Math.floor(c.bounce + 0.5) !== before; // the ball just hit the floor

    const defender = this.nearestOpponent(key);
    const guarded = defender !== null && defender.d < GUARDED_M;
    if (bounced) {
      if (guarded && defender) {
        // Keep the body between the ball and the defender; the switch happens low, on the bounce.
        const angle = this.facing[key] ?? 0;
        const side = (defender.x - this.pos[key].x) * -Math.sin(angle) + (defender.y - this.pos[key].y) * Math.cos(angle);
        c.hand = side > 0 ? -1 : 1;
      } else if ((hash(key) + before) % 7 === 0) c.hand = c.hand === 1 ? -1 : 1;
    }
    c.lat += (c.hand - c.lat) * smooth;
    c.lead += ((guarded ? 0.15 : running > 4.9 ? 0.49 : 0.24) - c.lead) * smooth;
    c.height += ((guarded ? 0.7 : 0.88 + Math.min(0.18, (running / 7.9) * 0.18)) - c.height) * smooth;
  }

  private nearestOpponent(key: string): { x: number; y: number; d: number } | null {
    const colon = key.indexOf(':');
    if (colon < 0) return null;
    const side = key.slice(0, colon + 1);
    const me = this.pos[key];
    let best: { x: number; y: number; d: number } | null = null;
    for (const [other, p] of Object.entries(this.pos)) {
      if (other.startsWith(side)) continue;
      const d = Math.hypot(p.x - me.x, p.y - me.y);
      if (!best || d < best.d) best = { x: p.x, y: p.y, d };
    }
    return best;
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
    const hand = (key: string, height = HAND_HEIGHT): Ball => {
      const p = this.pos[key] ?? { x: COURT.w / 2, y: MID_Y };
      const c = this.carry[key];
      // Ball out in front of the body, the way they face, on the side of the hand in use.
      const angle = this.facing[key];
      const fx = angle === undefined ? dir : Math.cos(angle);
      const fy = angle === undefined ? 0 : Math.sin(angle);
      const lead = c?.lead ?? 0.27;
      const lat = (c?.lat ?? 1) * 0.27;
      return { x: p.x + fx * lead - fy * lat, y: p.y + fy * lead + fx * lat, z: height };
    };
    const fly = (a: Ball, b: Ball, arc: number, t: number): Ball => ({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t + arc * 4 * t * (1 - t), // a real parabola, dropping onto its target
    });
    switch (action.kind) {
      case 'held': {
        const h = hand(action.holder);
        if (!action.dribble) return h;
        const c = this.carry[action.holder];
        const bounce = Math.abs(Math.cos((c?.bounce ?? 0) * Math.PI));
        return { ...h, z: 0.08 + ((c?.height ?? HAND_HEIGHT) - 0.08) * bounce };
      }
      case 'pass':
        return fly(hand(action.from, 1.22), hand(action.to, 1.22), action.arc, u);
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
