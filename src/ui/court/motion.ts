// Turns the beat targets into natural movement: players react, accelerate towards their spot at
// the pace the beat asks for (limited by their speed rating) and brake as they arrive, shuffle a
// little when off the ball, and the ball follows whoever has it: bounced in time with the
// handler's strides and shielded from the nearest defender, thrown when passed.

import { fatigueFactor } from '../../engine/ratings';
import { PACE_FT_S, type Ball, type BallAction, type Pace, type Pos, type ShotStyle } from './animation';
import { BODY_FT, insideCourt } from './formations';

/**
 * Shot mechanics per style: when in the beat the ball leaves the hands (0..1), how high the
 * shooter jumps (feet), and how high the hands hold the ball before release (feet, standing).
 */
const SHOTS: Record<ShotStyle, { release: number; jump: number; hands: [number, number] }> = {
  jumper: { release: 0.32, jump: 2.0, hands: [5.5, 7.6] },
  hook: { release: 0.36, jump: 1.4, hands: [5.5, 8.4] },
  layup: { release: 0.55, jump: 2.6, hands: [4.5, 7.6] },
  dunk: { release: 0.74, jump: 3.4, hands: [4.5, 7.9] },
  set: { release: 0.3, jump: 0, hands: [4.5, 6.4] },
  throw: { release: 0.05, jump: 0, hands: [4, 4] },
};

const ACCEL = 30; // ft/s²: a real first step, not an instant top speed
const BRAKE = 24; // planned below ACCEL so a player always has the grip to stop on the spot
const HAND_HEIGHT = 3.3;
/** Bounces a second when standing; a moving handler bounces once every two steps. */
const STANDING_BOUNCE_HZ = 1.7;
const GUARDED_FT = 6;
/** Someone caught outside the bounds walks back in rather than snapping there. */
const BOUNDS_FT_S = 40;
/** Players stay this far inside the lines even when shuffling. */
const BOUNDS_MARGIN = 1;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Speed attribute to a multiplier on every pace: a slow centre visibly loses the race to a quick guard. */
export function speedFactor(rating: number): number {
  return Math.max(0.72, Math.min(1.14, 0.76 + (rating - 40) * 0.0075));
}

/** How a player is carrying the ball; smoothed so it never snaps from one side to the other. */
interface Carry {
  fx: number;
  fy: number;
  faced: boolean;
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
        if (d >= BODY_FT) continue;
        const ux = d > 0.01 ? dx / d : 1;
        const uy = d > 0.01 ? dy / d : 0;
        const push = (BODY_FT - d) / 2;
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
        tx += Math.sin(this.time * (0.7 + (h % 7) * 0.08) + h) * 0.6;
        ty += Math.cos(this.time * (0.6 + (h % 5) * 0.09) + h * 0.7) * 0.5;
      }
      const max = PACE_FT_S[paces[key] ?? 'sprint'] * this.moveFactor(key) * speedScale;
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
      for (const key of Object.keys(next)) if (key !== outOfBounds) keepInside(next, key, BOUNDS_FT_S * dt * speedScale);
    }
    this.pos = next;
    this.vel = nextVel;
    for (const key of Object.keys(next)) this.updateCarry(key, dt * speedScale, speedScale, key === ballHolder);
  }

  /** A new spot takes a moment to read: nobody but the ball handler sets off instantly. */
  private reactedAim(key: string, target: Pos, h: number, isHolder: boolean, dt: number): Pos {
    const known = this.latest[key];
    if (!known || Math.hypot(known.x - target.x, known.y - target.y) > 4) this.waiting[key] = isHolder ? 0 : 0.08 + (h % 5) * 0.06;
    this.latest[key] = target;
    this.waiting[key] = (this.waiting[key] ?? 0) - dt;
    if (this.waiting[key] <= 0 || !this.aim[key]) this.aim[key] = target;
    return this.aim[key];
  }

  private updateCarry(key: string, dt: number, speedScale: number, isHolder: boolean): void {
    const c = (this.carry[key] ??= { fx: 1, fy: 0, faced: false, lat: 1, hand: 1, lead: 0.9, height: 3, bounce: 0 });
    const v = this.vel[key];
    const sp = Math.hypot(v.x, v.y);
    const smooth = 1 - Math.exp(-10 * dt);
    if (sp > 3 * speedScale) {
      if (!c.faced) {
        c.fx = v.x / sp;
        c.fy = v.y / sp;
      }
      c.faced = true;
      c.fx += (v.x / sp - c.fx) * smooth;
      c.fy += (v.y / sp - c.fy) * smooth;
    }
    if (!isHolder) return;

    const running = sp / speedScale;
    const stepsPerSecond = 2 + running / 13;
    const before = Math.floor(c.bounce + 0.5);
    c.bounce += Math.max(STANDING_BOUNCE_HZ, stepsPerSecond / 2) * dt;
    const bounced = Math.floor(c.bounce + 0.5) !== before; // the ball just hit the floor

    const defender = this.nearestOpponent(key);
    const guarded = defender !== null && defender.d < GUARDED_FT;
    if (bounced) {
      if (guarded && defender) {
        // Keep the body between the ball and the defender; the switch happens low, on the bounce.
        const side = (defender.x - this.pos[key].x) * -c.fy + (defender.y - this.pos[key].y) * c.fx;
        c.hand = side > 0 ? -1 : 1;
      } else if ((hash(key) + before) % 7 === 0) c.hand = c.hand === 1 ? -1 : 1;
    }
    c.lat += (c.hand - c.lat) * smooth;
    c.lead += ((guarded ? 0.5 : running > 16 ? 1.6 : 0.8) - c.lead) * smooth;
    c.height += ((guarded ? 2.3 : 2.9 + Math.min(0.6, (running / 26) * 0.6)) - c.height) * smooth;
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
      const p = this.pos[key] ?? { x: 47, y: 25 };
      const c = this.carry[key];
      // Ball out in front of the body the way they go (or the basket), on the side of the hand in use.
      const fx = c?.faced ? c.fx : dir;
      const fy = c?.faced ? c.fy : 0;
      const lead = c?.lead ?? 0.9;
      const lat = (c?.lat ?? 1) * 0.9;
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
        return { ...h, z: 0.25 + ((c?.height ?? HAND_HEIGHT) - 0.25) * bounce };
      }
      case 'pass':
        return fly(hand(action.from, 4), hand(action.to, 4), action.arc, u);
      case 'toPlayer':
        return fly(action.from, hand(action.to, 4.5), action.arc, u);
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
