// The TV director: an automatic broadcast camera for the 3D match view.
//
// Like a real broadcast's main camera it sits high on the near sideline, pans to follow the play
// and zooms to fit it: wide while the ball goes up the floor, tighter once a half-court set is on,
// never closer than MIN_DIST nor further than MAX_DIST. What it follows is the ball and the ten
// players together (the ball on the floor, its height ignored, so a dribble or a shot's arc does not
// bob the picture). Every move is smoothed (critically damped, with a top speed), and small changes
// inside a dead zone are ignored, so the viewer can follow the game without the picture jittering.

import * as THREE from 'three';
import { COURT, HALF_X, MID_Y } from '../../engine/court';
import type { Frame } from '../court/animation';
import { isRef } from '../court/animation';
import { toScene } from './player3d';

/** How close and how far the camera may be from what it looks at (m). */
const MIN_DIST = 18;
const MAX_DIST = 34;
/** How steeply it looks down: more when it is far out, as a high broadcast camera does. */
const PITCH_NEAR = 0.42;
const PITCH_FAR = 0.58;
/** How far round from straight-on it swings towards the end the play is at (radians, at the baseline). */
const MAX_YAW = 0.32;
/** How quickly the aim, the zoom and the swing follow (seconds to settle), and their top speeds. */
const AIM_S = 1.0;
const ZOOM_S = 1.4;
const YAW_S = 1.6;
const AIM_MAX = 9;
const ZOOM_MAX = 6;
/** Changes smaller than this are ignored: the picture holds still for a jab step or a pass back. */
const DEAD_ZONE_M = 1.5;
/** Room round the players: across the screen and in depth (m). */
const MARGIN_W = 10;
const MARGIN_D = 4;
/** Leading the play: how far ahead (seconds of the ball's run) and at most how far (m). */
const LEAD_S = 0.9;
const LEAD_MAX_M = 6;
/** The ball's speed up the floor (m/s) from which the camera leads it. */
const LEAD_FROM_M_S = 2.5;

/** A value that follows its goal smoothly (a critically damped spring with a top speed). */
class Smooth {
  value: number;
  private vel = 0;
  constructor(v: number, private time: number, private max: number) {
    this.value = v;
  }
  /** One step towards `goal` over `dt` seconds. */
  to(goal: number, dt: number): number {
    if (dt <= 0) return this.value;
    const omega = 2 / this.time;
    const x = omega * dt;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    let change = this.value - goal;
    const most = this.max * this.time;
    change = Math.max(-most, Math.min(most, change));
    const temp = (this.vel + omega * change) * dt;
    this.vel = (this.vel - omega * temp) * exp;
    // Critically damped: it eases into the goal and stops there without a jolt.
    this.value = this.value - change + (change + temp) * exp;
    return this.value;
  }
  jump(v: number): void {
    this.value = v;
    this.vel = 0;
  }
}

export class Director {
  private x = new Smooth(HALF_X, AIM_S, AIM_MAX);
  private y = new Smooth(MID_Y, AIM_S, AIM_MAX);
  private dist = new Smooth(26, ZOOM_S, ZOOM_MAX);
  private yaw = new Smooth(0, YAW_S, 0.5);
  /** The goal it is holding (inside the dead zone it is not moved). */
  private goal = { x: HALF_X, y: MID_Y, spreadW: 20, spreadD: 8 };
  private started = false;
  /** The ball's speed up the floor (m/s, smoothed), to lead the play; and the step it was measured over. */
  private ballVx = 0;
  private lastBall: { x: number } | null = null;
  private frameDt = 1 / 60;
  /** Where the camera looks (scene), for orbit controls to take over from. */
  readonly target = new THREE.Vector3();

  /** Puts the camera where the director wants it for this frame. `dt`: real seconds. */
  update(camera: THREE.PerspectiveCamera, frame: Frame | null, dt: number): void {
    if (dt > 0) this.frameDt = dt;
    if (frame && dt > 0) this.decide(frame);
    if (!this.started) {
      this.x.jump(this.goal.x);
      this.y.jump(this.goal.y);
      this.dist.jump(this.fitDistance(camera));
      this.started = true;
    }
    const x = this.x.to(this.goal.x, dt);
    const y = this.y.to(this.goal.y, dt);
    const d = this.dist.to(this.fitDistance(camera), dt);
    // Swing a little towards the end the play is at, as the camera pans to it.
    const yaw = this.yaw.to(MAX_YAW * Math.max(-1, Math.min(1, (x - HALF_X) / (COURT.w / 2 - 4))), dt);
    const k = (d - MIN_DIST) / (MAX_DIST - MIN_DIST);
    const pitch = PITCH_NEAR + (PITCH_FAR - PITCH_NEAR) * k;
    const look = toScene(x, y, 1.0);
    // From the near sideline (court +y), swung by `yaw` towards the far end of the play.
    const back = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(Math.cos(pitch) * d);
    camera.position.copy(look).add(back).add(new THREE.Vector3(0, Math.sin(pitch) * d, 0));
    camera.lookAt(look);
    this.target.copy(look);
  }

  /** What to follow: the ball and the ten players, weighted to the ball. */
  private decide(frame: Frame): void {
    const pts = Object.entries(frame.players)
      .filter(([k]) => !isRef(k))
      .map(([, p]) => p);
    if (!pts.length) return;
    const ball = frame.ball;
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    // The ball counts most, but the picture stays on the play round it.
    let gx = ball.x * 0.45 + cx * 0.55;
    let gy = ball.y * 0.45 + cy * 0.55;
    // Lead the play as a camera operator does: aim ahead the way the ball is going up the floor.
    if (this.lastBall) {
      const vx = (ball.x - this.lastBall.x) / Math.max(1e-3, this.frameDt);
      if (Number.isFinite(vx) && Math.abs(vx) < 25) this.ballVx += (vx - this.ballVx) * 0.05;
    }
    this.lastBall = { x: ball.x };
    // Only when it is really travelling (a break, a push up the floor), not for passes round the arc.
    const run = Math.sign(this.ballVx) * Math.max(0, Math.abs(this.ballVx) - LEAD_FROM_M_S);
    gx += Math.max(-LEAD_MAX_M, Math.min(LEAD_MAX_M, run * LEAD_S * 1.4));
    // Near a basket keep the rim in the picture: lean towards it.
    for (const hoop of [1.6, COURT.w - 1.6]) {
      const off = Math.abs(ball.x - hoop);
      if (off < 9) gx += (hoop + Math.sign(HALF_X - hoop) * 5 - gx) * 0.45 * (1 - off / 9);
    }
    gx = Math.max(4, Math.min(COURT.w - 4, gx));
    gy = Math.max(3, Math.min(COURT.h - 3, gy));
    // The spread to fit: the players nearest the play (the 8 nearest the ball; a man left back
    // on a fast break does not widen the shot to the whole court), and the ball.
    const near = [...pts].sort((a, b) => Math.hypot(a.x - ball.x, a.y - ball.y) - Math.hypot(b.x - ball.x, b.y - ball.y)).slice(0, 8);
    const xs = [...near.map((p) => p.x), ball.x];
    const ys = [...near.map((p) => p.y), ball.y];
    const spreadW = Math.max(...xs) - Math.min(...xs);
    const spreadD = Math.max(...ys) - Math.min(...ys);
    const g = this.goal;
    if (Math.hypot(gx - g.x, gy - g.y) > DEAD_ZONE_M) {
      // Move the goal only past the dead zone, by the amount it is outside it.
      const d = Math.hypot(gx - g.x, gy - g.y);
      const k = (d - DEAD_ZONE_M) / d;
      g.x += (gx - g.x) * k;
      g.y += (gy - g.y) * k;
    }
    if (Math.abs(spreadW - g.spreadW) > 1.5) g.spreadW = spreadW;
    if (Math.abs(spreadD - g.spreadD) > 1.5) g.spreadD = spreadD;
  }

  /** The distance that fits the play's spread on screen, within MIN_DIST..MAX_DIST. */
  private fitDistance(camera: THREE.PerspectiveCamera): number {
    const vfov = (camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const wide = (this.goal.spreadW + MARGIN_W) / 2 / Math.tan(hfov / 2);
    const deep = ((this.goal.spreadD + MARGIN_D) * Math.sin(PITCH_FAR)) / 2 / Math.tan(vfov / 2);
    return Math.max(MIN_DIST, Math.min(MAX_DIST, Math.max(wide, deep)));
  }
}
