// Turns the beat targets into natural movement: players accelerate towards their spot, run at a
// capped speed and slow down as they arrive (a critically damped spring), shuffle a little when
// off the ball, and the ball follows whoever has it: bounced when dribbled, thrown when passed.

import type { Ball, BallAction, Pos, ShotStyle } from './animation';

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

/** Real seconds → court feet. Tuned for Normal speed; scaled for Fast. */
const MAX_SPEED = 46;
const STIFFNESS = 7.5; // spring frequency (rad/s): higher = snappier
const HAND_HEIGHT = 3.3;
const DRIBBLE_HZ = 2.3;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export class Motion {
  pos: Record<string, Pos> = {};
  vel: Record<string, Pos> = {};
  private time = 0;
  /** Where the ball left the shooter's hands, per shot action. */
  private releases = new WeakMap<BallAction, Ball>();

  reset(): void {
    this.pos = {};
    this.vel = {};
  }

  /** Moves every player towards its target. Players not in `targets` disappear (subbed off). */
  update(targets: Record<string, Pos>, dt: number, speedScale: number, ballHolder: string | null): void {
    this.time += dt;
    const next: Record<string, Pos> = {};
    const nextVel: Record<string, Pos> = {};
    const w = STIFFNESS * Math.sqrt(speedScale);
    const max = MAX_SPEED * speedScale;
    for (const [key, target] of Object.entries(targets)) {
      const p = this.pos[key];
      if (!p) {
        next[key] = { ...target };
        nextVel[key] = { x: 0, y: 0 };
        continue;
      }
      // Off the ball, players never stand perfectly still.
      let tx = target.x;
      let ty = target.y;
      if (key !== ballHolder) {
        const h = hash(key);
        tx += Math.sin(this.time * (0.7 + (h % 7) * 0.08) + h) * 1.1;
        ty += Math.cos(this.time * (0.6 + (h % 5) * 0.09) + h * 0.7) * 0.8;
      }
      const v = this.vel[key];
      let ax = w * w * (tx - p.x) - 2 * w * v.x;
      let ay = w * w * (ty - p.y) - 2 * w * v.y;
      const maxAcc = max * 4;
      const a = Math.hypot(ax, ay);
      if (a > maxAcc) {
        ax *= maxAcc / a;
        ay *= maxAcc / a;
      }
      let vx = v.x + ax * dt;
      let vy = v.y + ay * dt;
      const sp = Math.hypot(vx, vy);
      if (sp > max) {
        vx *= max / sp;
        vy *= max / sp;
      }
      next[key] = { x: p.x + vx * dt, y: p.y + vy * dt };
      nextVel[key] = { x: vx, y: vy };
    }
    this.pos = next;
    this.vel = nextVel;
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
      const v = this.vel[key] ?? { x: 0, y: 0 };
      const sp = Math.hypot(v.x, v.y);
      // Ball on the side of the body facing the way they go (or the basket), a little towards the camera.
      const fx = sp > 3 ? v.x / sp : dir;
      const fy = sp > 3 ? v.y / sp : 0;
      return { x: p.x + fx * 0.9, y: p.y + fy * 0.9 + 0.6, z: height };
    };
    const fly = (a: Ball, b: Ball, arc: number, t: number): Ball => ({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t + arc * Math.sin(Math.PI * t),
    });
    switch (action.kind) {
      case 'held': {
        const h = hand(action.holder);
        if (!action.dribble) return h;
        const v = this.vel[action.holder] ?? { x: 0, y: 0 };
        const hz = DRIBBLE_HZ * (1 + Math.min(1, Math.hypot(v.x, v.y) / 30) * 0.6);
        const bounce = Math.abs(Math.cos(this.time * Math.PI * hz));
        return { ...h, z: 0.25 + (HAND_HEIGHT - 0.25) * bounce };
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
