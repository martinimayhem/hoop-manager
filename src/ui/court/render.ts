// Isometric illustrated presentation for the live match. The simulation runs in court metres and
// knows nothing about the screen; this module alone projects and paints the court, players, hoops and ball. Everything is vector,
// drawn in CANVAS_W x CANVAS_H logical units and scaled to the canvas's real pixel size.

import { COURT, HOOP_X, MID_Y, RIM_HEIGHT, type Frame } from './animation';

export const CANVAS_W = 1000;
export const CANVAS_H = 500;

/** Screen pixels per court metre, along each isometric axis and upwards. */
const TILE_X = 21;
const TILE_Y = 10;
const LIFT_Y = 23;
const FLOOR_Y = 264;
/** A circle of radius 1 m on the floor projects to an axis-aligned ellipse with these radii. */
const FLOOR_RX = TILE_X * Math.SQRT2;
const FLOOR_RY = TILE_Y * Math.SQRT2;

const RIM_RADIUS = 0.49;
const BOARD_INSET = 1.05;
const POST_INSET = -0.6;
/** FIBA markings. */
const KEY_DEPTH = 5.8;
const KEY_NEAR = MID_Y - 2.45;
const KEY_FAR = MID_Y + 2.45;
const CIRCLE_RADIUS = 1.8;
const THREE_RADIUS = 6.75;
const THREE_CORNER_Y = 0.9;
const THREE_CORNER_DEPTH = 2.99;
const NO_CHARGE_RADIUS = 1.25;

export interface DotInfo {
  label: string;
  side: 0 | 1;
  heightM: number;
  hasBall: boolean;
}

export interface TeamColours {
  fill: string;
  text: string;
}

interface Pt {
  x: number;
  y: number;
  s: number;
}

type Floor = [number, number];
type Space = [number, number, number];

/** Court metres (x along the court, y across it, z up) to isometric screen pixels. The only way onto the screen. */
export function project(x: number, y: number, z = 0): Pt {
  return {
    x: CANVAS_W / 2 + (x - COURT.w / 2) * TILE_X + (y - COURT.h / 2) * TILE_X,
    y: FLOOR_Y + (y - COURT.h / 2) * TILE_Y - (x - COURT.w / 2) * TILE_Y - z * LIFT_Y,
    s: 1,
  };
}

const SKIN = ['#f1c7a5', '#d9a07a', '#b07850', '#8a5a3a', '#6b4429', '#e8b894'];
const HAIR = ['#1d140e', '#3b2416', '#0f0f0f', '#5a3b1d', '#24170f'];
const OUTLINE = '#14201f';
const LINE = '#f5fff7';
const POST = '#4d7f9c';
const FACING_CAMERA = (Math.PI * 3) / 4;
/** How much a distance across the floor shrinks on screen when it runs towards the camera. */
const DEPTH = TILE_Y / TILE_X;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function darken(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}

/** A body part: a rounded stroke with a dark outline behind it. */
function limb(ctx: CanvasRenderingContext2D, pts: Floor[], width: number, colour: string): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = width + 1.6;
  ctx.stroke();
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.stroke();
}

/**
 * How a facing angle in court space looks from the camera: `side` is +1 when facing screen right,
 * `toward` is +1 when facing the camera. The sprite is posed from these two, so it turns smoothly.
 */
export function bodyView(angle: number): { side: number; toward: number } {
  const fx = Math.cos(angle);
  const fy = Math.sin(angle);
  return { side: (fx + fy) / Math.SQRT2, toward: (fy - fx) / Math.SQRT2 };
}

/** Sprite size from a player's height, slightly exaggerated so a guard and a centre read at a glance. */
export function spriteScale(heightM: number): number {
  return 1 + (heightM / 1.98 - 1) * 1.5;
}

export class CourtRenderer {
  private last: Record<string, { x: number; y: number }> = {};
  private stride: Record<string, number> = {};
  private lastNow = 0;
  private frameSeconds = 1 / 60;
  /** The floor never changes, so it is painted once per canvas size. */
  private floor: HTMLCanvasElement | null = null;

  constructor(private colours: [TeamColours, TeamColours]) {}

  draw(ctx: CanvasRenderingContext2D, frame: Frame | null, dots: Record<string, DotInfo>, now: number): void {
    ctx.setTransform(ctx.canvas.width / CANVAS_W, 0, 0, ctx.canvas.height / CANVAS_H, 0, 0);
    ctx.imageSmoothingEnabled = true;
    if (now > this.lastNow) this.frameSeconds = Math.min(0.1, now - this.lastNow);
    this.lastNow = now;
    ctx.drawImage(this.floorLayer(ctx.canvas.width, ctx.canvas.height), 0, 0, CANVAS_W, CANVAS_H);

    // Depth is distance towards the camera: nearer the bottom of the screen means larger y - x.
    type Item = { depth: number; draw: () => void };
    const items: Item[] = [];
    for (const end of [0, 1] as const) {
      const at = (inset: number) => MID_Y - (end === 0 ? inset : COURT.w - inset);
      const hoopX = end === 0 ? COURT.w - HOOP_X : HOOP_X;
      items.push({ depth: at(POST_INSET), draw: () => this.drawPost(ctx, end) });
      items.push({ depth: at(BOARD_INSET), draw: () => this.drawBoard(ctx, end) });
      items.push({ depth: MID_Y - hoopX - 0.18, draw: () => this.drawRim(ctx, hoopX, Math.PI, Math.PI * 2) });
      items.push({ depth: MID_Y - hoopX + 0.18, draw: () => this.drawRim(ctx, hoopX, 0, Math.PI) });
    }

    if (frame) {
      const ball = frame.ball;
      for (const [key, p] of Object.entries(frame.players)) {
        const info = dots[key];
        if (!info) continue;
        const lift = frame.lift?.[key] ?? 0;
        this.drawMarker(ctx, p.x, p.y, lift, info.hasBall);
        items.push({
          depth: p.y - p.x,
          draw: () => this.drawPlayer(ctx, key, p.x, p.y, info, ball, lift, frame.shooter === key, frame.facing?.[key] ?? FACING_CAMERA, frame.reach?.[key] ?? 0),
        });
      }
      this.drawBallShadow(ctx, ball.x, ball.y, ball.z);
      items.push({ depth: ball.y - ball.x + 0.03, draw: () => this.drawBall(ctx, ball.x, ball.y, ball.z) });
    }
    items.sort((a, b) => a.depth - b.depth).forEach((item) => item.draw());
  }

  private floorLayer(width: number, height: number): HTMLCanvasElement {
    if (this.floor?.width === width && this.floor.height === height) return this.floor;
    const layer = document.createElement('canvas');
    layer.width = width;
    layer.height = height;
    const ctx = layer.getContext('2d')!;
    ctx.setTransform(width / CANVAS_W, 0, 0, height / CANVAS_H, 0, 0);
    this.drawBackdrop(ctx);
    this.drawFloor(ctx);
    this.floor = layer;
    return layer;
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D): void {
    const g = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H / 2, 120, CANVAS_W / 2, CANVAS_H / 2, 640);
    g.addColorStop(0, '#16343a');
    g.addColorStop(1, '#071317');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    // Arena floor tiles, on the same axes as the court.
    for (let n = -36; n <= 66; n += 3) {
      this.line(ctx, [[n, -36], [n, 51]], 'rgba(150, 230, 225, 0.05)', 1);
      this.line(ctx, [[-36, n], [66, n]], 'rgba(150, 230, 225, 0.05)', 1);
    }
  }

  private poly(ctx: CanvasRenderingContext2D, pts: Floor[], fill?: string | CanvasGradient, stroke?: string, width = 2): void {
    this.poly3(ctx, pts.map(([x, y]) => [x, y, 0]), fill, stroke, width);
  }

  private poly3(ctx: CanvasRenderingContext2D, pts: Space[], fill?: string | CanvasGradient, stroke?: string, width = 2): void {
    ctx.beginPath();
    pts.forEach(([x, y, z], i) => {
      const p = project(x, y, z);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.stroke();
    }
  }

  private line(ctx: CanvasRenderingContext2D, pts: Floor[], color: string, width = 2): void {
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const p = project(x, y);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  private arcPts(cx: number, cy: number, r: number, from: number, to: number, steps = 64): Floor[] {
    const out: Floor[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = from + ((to - from) * i) / steps;
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return out;
  }

  /** The two faces of a box that the camera can see (low x and high y), plus its top. */
  private box(ctx: CanvasRenderingContext2D, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, left: string, right: string, top: string): void {
    this.poly3(ctx, [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]], left);
    this.poly3(ctx, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], right);
    this.poly3(ctx, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], top);
  }

  private drawFloor(ctx: CanvasRenderingContext2D): void {
    const m = 0.9;
    this.box(ctx, -m, COURT.w + m, -m, COURT.h + m, -0.7, 0, '#0a6f73', '#0a8585', '#16aaa4');
    this.line(ctx, [[-m, COURT.h + m], [COURT.w + m, COURT.h + m]], '#63ded0', 1.5);
    this.line(ctx, [[-m, -m], [-m, COURT.h + m]], '#63ded0', 1.5);

    const left = project(0, 0);
    const right = project(COURT.w, COURT.h);
    const green = ctx.createLinearGradient(left.x, 0, right.x, 0);
    green.addColorStop(0, '#07844b');
    green.addColorStop(0.5, '#0a9458');
    green.addColorStop(1, '#07844b');
    this.poly(ctx, [[0, 0], [COURT.w, 0], [COURT.w, COURT.h], [0, COURT.h]], green);

    for (const end of [0, 1] as const) {
      const fx = (x: number) => (end === 0 ? x : COURT.w - x);
      this.poly(ctx, [[fx(0), KEY_NEAR], [fx(KEY_DEPTH), KEY_NEAR], [fx(KEY_DEPTH), KEY_FAR], [fx(0), KEY_FAR]], '#cf9f4c');
    }
    this.poly(ctx, this.arcPts(COURT.w / 2, MID_Y, CIRCLE_RADIUS, 0, Math.PI * 2), '#cf9f4c');

    // Boards run along the court with staggered joints; the tint is seeded so it never shimmers.
    const plank = 0.6;
    const length = 4.2;
    for (let row = 0; row * plank < COURT.h; row++) {
      const y = row * plank;
      for (let x = -((row * 1.5) % length); x < COURT.w; x += length) {
        const a = Math.max(0, x);
        const b = Math.min(COURT.w, x + length);
        const tone = hash(`${row}:${x}`) % 100;
        const fill = tone < 50 ? `rgba(255, 255, 255, ${(tone / 50) * 0.045})` : `rgba(0, 0, 0, ${((tone - 50) / 50) * 0.05})`;
        this.poly(ctx, [[a, y], [b, y], [b, y + plank], [a, y + plank]], fill);
        this.line(ctx, [[b, y], [b, y + plank]], 'rgba(0, 30, 20, 0.12)', 0.5);
      }
      this.line(ctx, [[0, y], [COURT.w, y]], 'rgba(0, 30, 20, 0.14)', 0.5);
    }

    for (const end of [0, 1] as const) {
      const fx = (x: number) => (end === 0 ? x : COURT.w - x);
      const hoopX = end === 0 ? COURT.w - HOOP_X : HOOP_X;
      const courtward = end === 0 ? 0 : Math.PI;
      this.poly(ctx, [[fx(0), KEY_NEAR], [fx(KEY_DEPTH), KEY_NEAR], [fx(KEY_DEPTH), KEY_FAR], [fx(0), KEY_FAR]], undefined, LINE, 2);
      // Free-throw circle: solid towards half court, dashed inside the lane.
      this.line(ctx, this.arcPts(fx(KEY_DEPTH), MID_Y, CIRCLE_RADIUS, courtward - Math.PI / 2, courtward + Math.PI / 2), LINE, 2);
      ctx.setLineDash([5, 5]);
      this.line(ctx, this.arcPts(fx(KEY_DEPTH), MID_Y, CIRCLE_RADIUS, courtward + Math.PI / 2, courtward + (3 * Math.PI) / 2), LINE, 1.6);
      ctx.setLineDash([]);
      this.line(ctx, this.arcPts(hoopX, MID_Y, NO_CHARGE_RADIUS, courtward - Math.PI / 2, courtward + Math.PI / 2), LINE, 1.6);
      // Lane markers.
      for (const f of [2.1, 3, 3.9, 4.8]) {
        this.line(ctx, [[fx(f), KEY_NEAR], [fx(f), KEY_NEAR - 0.25]], LINE, 2);
        this.line(ctx, [[fx(f), KEY_FAR], [fx(f), KEY_FAR + 0.25]], LINE, 2);
      }
      this.line(ctx, [[fx(0), THREE_CORNER_Y], [fx(THREE_CORNER_DEPTH), THREE_CORNER_Y]], LINE, 2);
      this.line(ctx, [[fx(0), COURT.h - THREE_CORNER_Y], [fx(THREE_CORNER_DEPTH), COURT.h - THREE_CORNER_Y]], LINE, 2);
      const a = Math.acos((MID_Y - THREE_CORNER_Y) / THREE_RADIUS);
      this.line(ctx, this.arcPts(hoopX, MID_Y, THREE_RADIUS, courtward - Math.PI / 2 + a, courtward + Math.PI / 2 - a), LINE, 2);
    }
    this.line(ctx, [[COURT.w / 2, 0], [COURT.w / 2, COURT.h]], LINE, 2);
    this.line(ctx, this.arcPts(COURT.w / 2, MID_Y, CIRCLE_RADIUS, 0, Math.PI * 2), LINE, 2);
    this.poly(ctx, [[0, 0], [COURT.w, 0], [COURT.w, COURT.h], [0, COURT.h]], undefined, LINE, 3);
  }

  private drawPost(ctx: CanvasRenderingContext2D, end: 0 | 1): void {
    const postX = end === 0 ? POST_INSET : COURT.w - POST_INSET;
    const boardX = end === 0 ? BOARD_INSET : COURT.w - BOARD_INSET;
    const foot = project(postX, MID_Y);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.ellipse(foot.x + 2, foot.y + 1, 0.73 * FLOOR_RX, 0.73 * FLOOR_RY, 0, 0, Math.PI * 2);
    ctx.fill();
    this.box(ctx, postX - 0.3, postX + 0.3, MID_Y - 0.42, MID_Y + 0.42, 0, 0.43, '#274455', '#30566b', '#3d6c85');

    const base = project(postX, MID_Y, 0.43);
    const top = project(postX, MID_Y, 3.85);
    const arm = project(boardX, MID_Y, 3.41);
    limb(ctx, [[top.x, top.y], [arm.x, arm.y]], 4, darken(POST, 0.85));
    limb(ctx, [[base.x, base.y], [top.x, top.y]], 8, POST);
    limb(ctx, [[base.x - 2, base.y], [top.x - 2, top.y]], 1.5, '#9fd3ea');
  }

  private drawBoard(ctx: CanvasRenderingContext2D, end: 0 | 1): void {
    const x = end === 0 ? BOARD_INSET : COURT.w - BOARD_INSET;
    const hoopX = end === 0 ? COURT.w - HOOP_X : HOOP_X;
    const edge = hoopX + (end === 0 ? -RIM_RADIUS : RIM_RADIUS);
    // The near board stands between the camera and its rim, so its glass has to stay see-through.
    const glass = end === 0 ? 'rgba(226, 246, 250, 0.22)' : 'rgba(226, 246, 250, 0.62)';
    const glassPane: Space[] = [[x, MID_Y - 1.2, 4.08], [x, MID_Y + 1.2, 4.08], [x, MID_Y + 1.2, 2.8], [x, MID_Y - 1.2, 2.8]];
    this.poly3(ctx, glassPane, glass, OUTLINE, 3.4);
    this.poly3(ctx, glassPane, undefined, '#ffffff', 2);
    this.poly3(ctx, [[x, MID_Y - 0.36, 3.6], [x, MID_Y + 0.36, 3.6], [x, MID_Y + 0.36, RIM_HEIGHT], [x, MID_Y - 0.36, RIM_HEIGHT]], undefined, '#e4472f', 1.6);
    const a = project(x, MID_Y, RIM_HEIGHT);
    const b = project(edge, MID_Y, RIM_HEIGHT);
    limb(ctx, [[a.x, a.y], [b.x, b.y]], 2.5, '#e4472f');
  }

  /** One half of the rim and net: drawn in two passes so the ball can drop between them. */
  private drawRim(ctx: CanvasRenderingContext2D, hoopX: number, from: number, to: number): void {
    const c = project(hoopX, MID_Y, RIM_HEIGHT);
    const rx = RIM_RADIUS * FLOOR_RX;
    const ry = RIM_RADIUS * FLOOR_RY;
    const netDrop = 13;
    const taper = 0.62;
    const top = (a: number): Floor => [c.x + Math.cos(a) * rx, c.y + Math.sin(a) * ry];
    const bottom = (a: number): Floor => [c.x + Math.cos(a) * rx * taper, c.y + netDrop + Math.sin(a) * ry * taper];
    const strands = 8;
    const step = (to - from) / strands;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 0.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i <= strands; i++) {
      const a = from + i * step;
      const [tx, ty] = top(a);
      if (i < strands) {
        const [bx, by] = bottom(a + step);
        ctx.moveTo(tx, ty);
        ctx.lineTo(bx, by);
      }
      if (i > 0) {
        const [bx, by] = bottom(a - step);
        ctx.moveTo(tx, ty);
        ctx.lineTo(bx, by);
      }
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(c.x, c.y + netDrop, rx * taper, ry * taper, 0, from, to);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(c.x, c.y, rx, ry, 0, from, to);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#8f2a1a';
    ctx.lineWidth = 4.2;
    ctx.stroke();
    ctx.strokeStyle = '#ff5a3c';
    ctx.lineWidth = 2.6;
    ctx.stroke();
  }

  /** Floor marks stay on the floor when a player jumps, which is what makes the jump read. */
  private drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number, lift: number, hasBall: boolean): void {
    const f = project(x, y);
    const shrink = 1 - Math.min(0.5, lift * 0.4);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    ctx.beginPath();
    ctx.ellipse(f.x + 2, f.y + 1, 0.38 * FLOOR_RX * shrink, 0.38 * FLOOR_RY * shrink, 0, 0, Math.PI * 2);
    ctx.fill();
    if (hasBall) {
      ctx.strokeStyle = '#ffe57a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, 0.52 * FLOOR_RX, 0.52 * FLOOR_RY, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, info: DotInfo, ball: Frame['ball'], lift: number, shooting: boolean, facing: number, handsUp: number): void {
    const foot = project(x, y, lift);
    const prev = this.last[key];
    const moveX = prev ? x - prev.x : 0;
    const moveY = prev ? y - prev.y : 0;
    const speed = Math.hypot(moveX, moveY);
    this.last[key] = { x, y };

    // The sprite is a small 3D figure: `forward` along the way they face, `right` towards their
    // right hand, and `up` off the floor, all in sprite pixels.
    const { side, toward } = bodyView(facing);
    const at = (forward: number, right: number, up: number): Floor => [forward * side - right * toward, -up + (forward * toward + right * side) * DEPTH];
    const across = Math.abs(toward);
    /** Half the width of a body part that is wider than it is deep, seen from this angle. */
    const wide = (half: number) => Math.hypot(half * toward, half * 0.72 * side);

    // Two steps per leg cycle, and a stride lengthens with speed: from 1.8 m a cycle walking to 3.6 m sprinting.
    const metresPerSecond = speed / this.frameSeconds;
    const cycleM = 1.8 + Math.min(1.8, (metresPerSecond / 7.9) * 1.8);
    this.stride[key] = (this.stride[key] ?? 0) + (speed / cycleM) * Math.PI * 2;
    const airborne = lift > 0.015;
    const pace = Math.min(1, metresPerSecond / 4.3);
    const swing = airborne ? 0.35 : Math.sin(this.stride[key]) * pace;
    // Which way the legs carry them, relative to the body: forwards, backpedalling or sliding.
    const fx = Math.cos(facing);
    const fy = Math.sin(facing);
    const along = airborne || speed === 0 ? 1 : (moveX * fx + moveY * fy) / speed;
    const sideways = airborne || speed === 0 ? 0 : Math.abs((moveX * -fy + moveY * fx) / speed);

    const team = this.colours[info.side];
    const skin = SKIN[hash(key) % SKIN.length];
    const k = spriteScale(info.heightM);
    /** Whichever side of the body is further from the camera comes first. */
    const farFirst: (1 | -1)[] = side >= 0 ? [-1, 1] : [1, -1];

    ctx.save();
    ctx.translate(foot.x, foot.y);
    ctx.scale(k, k);

    // Legs: skin to the shin, then sock and shoe. The airborne pose tucks one knee; a slide opens
    // and closes the feet instead of crossing them.
    const shoeTurn = Math.atan2(toward * DEPTH, side);
    const shoeLength = 3.9 * Math.max(0.6, Math.hypot(side, toward * DEPTH));
    for (const leg of farFirst) {
      const s = swing * leg;
      const tuck = airborne && leg === 1 ? 5 : 0;
      const stepF = along * s * 6;
      const stepR = leg * (3.6 + Math.abs(Math.sin(this.stride[key])) * pace * sideways * 3);
      const stepU = Math.max(0, s) * 3 * (1 - sideways) + tuck;
      const knee = at(1 + stepF * 0.5, leg * 3.8, 12 + tuck * 0.5);
      const ankle = at(stepF, stepR, stepU + 3);
      limb(ctx, [at(0, leg * 3.4, 23), knee, ankle], 4.4, skin);
      limb(ctx, [[(knee[0] + ankle[0]) / 2, (knee[1] + ankle[1]) / 2], ankle], 4.2, '#f4f4ee');
      const [toeX, toeY] = at(stepF + 1.2, stepR, stepU + 1.3);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.ellipse(toeX, toeY, shoeLength, 2.1, shoeTurn, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = team.fill;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(toeX - Math.cos(shoeTurn) * shoeLength * 0.6, toeY - Math.sin(shoeTurn) * shoeLength * 0.6 - 0.4);
      ctx.lineTo(toeX + Math.cos(shoeTurn) * shoeLength * 0.6, toeY + Math.sin(shoeTurn) * shoeLength * 0.6 - 0.4);
      ctx.stroke();
    }

    // Shorts.
    ctx.fillStyle = darken(team.fill, 0.72);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 0.9;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-wide(7), -27);
    ctx.lineTo(wide(7), -27);
    ctx.lineTo(wide(8.6), -15.5);
    ctx.lineTo(1.2 * across, -15.5);
    ctx.lineTo(0, -15.5 - 3.5 * across);
    ctx.lineTo(-1.2 * across, -15.5);
    ctx.lineTo(-wide(8.6), -15.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Which hand goes where: the ball handler's nearest arm reaches for the actual ball.
    const shoulderUp = 36.5;
    const b = project(ball.x, ball.y, ball.z);
    const rx = (b.x - foot.x) / k;
    const ry = (b.y - foot.y) / k;
    const shoulderOf = (arm: 1 | -1) => at(0, arm * 8.2, shoulderUp);
    const toBall = (arm: 1 | -1) => Math.hypot(rx - shoulderOf(arm)[0], ry - shoulderOf(arm)[1]);
    const ballArm: 1 | -1 = toBall(1) < toBall(-1) ? 1 : -1;
    const drawArm = (arm: 1 | -1) => {
      const start = shoulderOf(arm);
      let hand: Floor;
      let elbow: Floor;
      if (shooting) {
        hand = at(2.5, arm * 3.5, 62);
        elbow = at(1, arm * 7, 50);
      } else if (info.hasBall && arm === ballArm) {
        const vx = rx - start[0];
        const vy = ry - start[1];
        const reach = Math.min(20, Math.hypot(vx, vy)) / (Math.hypot(vx, vy) || 1);
        hand = [start[0] + vx * reach, start[1] + vy * reach];
        elbow = [(start[0] + hand[0]) / 2 + (start[0] >= 0 ? 2 : -2), (start[1] + hand[1]) / 2];
      } else {
        const s = -swing * arm * along;
        hand = at(s * 5, arm * 10.5, 20 + Math.abs(s) * 2);
        elbow = at(s * 2, arm * 10.8, 28);
      }
      if (handsUp > 0 && !shooting) {
        // Both hands go up towards the ball: always above the head, leaning its way but never sideways.
        const vy = Math.min(ry - start[1], -22);
        const vx = Math.max(vy * 0.6, Math.min(-vy * 0.6, rx - start[0]));
        const reach = Math.min(26, Math.hypot(vx, vy)) / Math.hypot(vx, vy);
        const upHand: Floor = [start[0] + vx * reach + at(0, arm * 1.5, 0)[0], start[1] + vy * reach];
        const upElbow: Floor = [(start[0] + upHand[0]) / 2 + (start[0] >= 0 ? 1.5 : -1.5), (start[1] + upHand[1]) / 2];
        hand = [hand[0] + (upHand[0] - hand[0]) * handsUp, hand[1] + (upHand[1] - hand[1]) * handsUp];
        elbow = [elbow[0] + (upElbow[0] - elbow[0]) * handsUp, elbow[1] + (upElbow[1] - elbow[1]) * handsUp];
      }
      limb(ctx, [start, elbow, hand], 3.8, skin);
    };

    // In profile the far arm passes behind the body.
    const hiddenArm: 1 | -1 | null = Math.abs(side) > 0.35 ? farFirst[0] : null;
    if (hiddenArm) drawArm(hiddenArm);

    // Jersey, shaded from the light side.
    const chest = wide(8.4);
    const waist = wide(7.2);
    const collar = 3.2 * Math.max(0.5, across);
    const collarX = side * 2;
    const shirt = ctx.createLinearGradient(-9, 0, 9, 0);
    shirt.addColorStop(0, team.fill);
    shirt.addColorStop(1, darken(team.fill, 0.78));
    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.moveTo(-chest, -38);
    ctx.quadraticCurveTo(collarX - collar - 0.8, -39.5, collarX - collar, -39);
    ctx.quadraticCurveTo(collarX, -38 + 2.5 * Math.max(0, toward), collarX + collar, -39);
    ctx.quadraticCurveTo(collarX + collar + 0.8, -39.5, chest, -38);
    ctx.lineTo(waist, -25.5);
    ctx.lineTo(-waist, -25.5);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    // Arms reaching up pass in front of the face; otherwise the head sits over the shoulders.
    const armsRaised = handsUp > 0.5;
    if (!armsRaised) for (const arm of farFirst) if (arm !== hiddenArm) drawArm(arm);

    // The number narrows as the chest turns away, but stays readable side-on, even over an arm.
    const front = toward >= 0;
    ctx.save();
    ctx.translate((front ? side : -side) * 1.5, front ? -30.5 : -31.5);
    ctx.scale(Math.max(0.62, across), 1);
    ctx.fillStyle = team.text;
    ctx.font = `800 ${front ? 7 : 9.5}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(info.label, 0, 0, 13);
    ctx.restore();

    this.drawHead(ctx, key, skin, team.fill, side, toward);
    if (armsRaised) for (const arm of farFirst) if (arm !== hiddenArm) drawArm(arm);
    ctx.restore();
  }

  private drawHead(ctx: CanvasRenderingContext2D, key: string, skin: string, band: string, side: number, toward: number): void {
    const hair = HAIR[hash(`${key}:hair`) % HAIR.length];
    const style = hash(`${key}:style`) % 4;
    const cy = -46;
    const r = 7;
    limb(ctx, [[0, -40], [0, -37.5]], 4.4, skin);

    if (style === 1) {
      ctx.fillStyle = hair;
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(-side * 1.5, cy - 2.5, r + 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // The head is hair all round, with the face a patch that slides round it and disappears from behind.
    ctx.fillStyle = hair;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(0, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const shown = Math.max(0, Math.min(1, (toward + 0.45) / 0.75));
    if (shown > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, cy, r - 0.3, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.ellipse(side * r * 0.42, cy + 1.8, r * (0.55 + 0.4 * Math.abs(toward)) * shown, r * (0.5 + 0.38 * shown), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (style === 2) {
      ctx.fillStyle = hair;
      ctx.fillRect(-6.4, cy - 10, 12.8, 5);
    }
    if (style === 3) {
      ctx.strokeStyle = band;
      ctx.lineWidth = 2;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(-r + 0.3, cy - 2.2);
      ctx.quadraticCurveTo(0, cy - 3 - 1 * toward, r - 0.3, cy - 2.2);
      ctx.stroke();
    }

    // A nose gives the profile away; eyes and mouth only show on the side the camera can see.
    if (Math.abs(side) > 0.6 && toward > -0.3) {
      ctx.fillStyle = skin;
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.arc(side * (r + 0.3), cy + 1.4, 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    for (const eye of [-0.47, 0.47]) {
      const visible = 0.88 * toward + eye * side;
      if (visible < 0.15) continue;
      const ex = (0.88 * side - eye * toward) * r * 0.82;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(ex, cy + 0.2, 1.35 * Math.min(1, 0.45 + visible * 0.7), 1.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1b1b18';
      ctx.beginPath();
      ctx.arc(ex + side * 0.35, cy + 0.3, 0.85, 0, Math.PI * 2);
      ctx.fill();
    }
    if (toward > 0.2) {
      const mouth = side * r * 0.72;
      const half = 0.6 + 0.9 * toward;
      ctx.strokeStyle = darken(skin, 0.55);
      ctx.lineWidth = 0.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(mouth - half, cy + 3.9);
      ctx.quadraticCurveTo(mouth, cy + 4.7, mouth + half, cy + 3.9);
      ctx.stroke();
    }
  }

  private drawBallShadow(ctx: CanvasRenderingContext2D, x: number, y: number, z: number): void {
    const f = project(x, y);
    const fade = 1 - Math.min(0.7, z * 0.164);
    ctx.fillStyle = `rgba(0, 0, 0, ${0.34 * fade})`;
    ctx.beginPath();
    ctx.ellipse(f.x, f.y, 0.23 * FLOOR_RX * fade, 0.23 * FLOOR_RY * fade, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, z: number): void {
    const p = project(x, y, z);
    const r = 6;
    const g = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
    g.addColorStop(0, '#ffa557');
    g.addColorStop(1, '#d9601a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3f210d';
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(p.x - r, p.y);
    ctx.lineTo(p.x + r, p.y);
    ctx.moveTo(p.x, p.y - r);
    ctx.lineTo(p.x, p.y + r);
    ctx.moveTo(p.x - r * 0.68, p.y - r * 0.72);
    ctx.quadraticCurveTo(p.x - r * 0.2, p.y, p.x - r * 0.68, p.y + r * 0.72);
    ctx.moveTo(p.x + r * 0.68, p.y - r * 0.72);
    ctx.quadraticCurveTo(p.x + r * 0.2, p.y, p.x + r * 0.68, p.y + r * 0.72);
    ctx.stroke();
  }
}
