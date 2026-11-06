// Isometric illustrated presentation for the live match. Simulation coordinates remain in feet;
// this module only projects and paints the court, players, hoops and ball. Everything is vector,
// drawn in CANVAS_W x CANVAS_H logical units and scaled to the canvas's real pixel size.

import { COURT, HOOP_X, ISO, RIM_HEIGHT, type Frame } from './animation';

export const CANVAS_W = 1000;
export const CANVAS_H = 500;

const TILE_X = 6.3;
const TILE_Y = ISO.tileY;
const FLOOR_Y = ISO.floorY;
const LIFT_Y = ISO.liftY;
/** A circle of radius 1ft on the floor projects to an axis-aligned ellipse with these radii. */
const FLOOR_RX = TILE_X * Math.SQRT2;
const FLOOR_RY = TILE_Y * Math.SQRT2;

const RIM_RADIUS = 1.6;
const BOARD_INSET = 3.4;
const POST_INSET = -2;

export interface DotInfo {
  label: string;
  side: 0 | 1;
  heightFt: number;
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

/** Court feet (x along the court, y across it, z up) to isometric screen pixels. */
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

/** Sprite size from a player's height, slightly exaggerated so a guard and a centre read at a glance. */
export function spriteScale(heightFt: number): number {
  return 1 + (heightFt / 6.5 - 1) * 1.5;
}

export class CourtRenderer {
  private last: Record<string, { x: number; y: number }> = {};
  private stride: Record<string, number> = {};
  private lastNow = 0;
  private frameSeconds = 1 / 60;
  private faceX: Record<string, 1 | -1> = {};
  private faceFront: Record<string, boolean> = {};
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
      const at = (inset: number) => 25 - (end === 0 ? inset : COURT.w - inset);
      const hoopX = end === 0 ? COURT.w - HOOP_X : HOOP_X;
      items.push({ depth: at(POST_INSET), draw: () => this.drawPost(ctx, end) });
      items.push({ depth: at(BOARD_INSET), draw: () => this.drawBoard(ctx, end) });
      items.push({ depth: 25 - hoopX - 0.6, draw: () => this.drawRim(ctx, hoopX, Math.PI, Math.PI * 2) });
      items.push({ depth: 25 - hoopX + 0.6, draw: () => this.drawRim(ctx, hoopX, 0, Math.PI) });
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
          draw: () => this.drawPlayer(ctx, key, p.x, p.y, info, ball, lift, frame.shooter === key),
        });
      }
      this.drawBallShadow(ctx, ball.x, ball.y, ball.z);
      items.push({ depth: ball.y - ball.x + 0.1, draw: () => this.drawBall(ctx, ball.x, ball.y, ball.z) });
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
    for (let n = -120; n <= 220; n += 10) {
      this.line(ctx, [[n, -120], [n, 170]], 'rgba(150, 230, 225, 0.05)', 1);
      this.line(ctx, [[-120, n], [220, n]], 'rgba(150, 230, 225, 0.05)', 1);
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
    const m = 3;
    this.box(ctx, -m, COURT.w + m, -m, COURT.h + m, -2.4, 0, '#0a6f73', '#0a8585', '#16aaa4');
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
      this.poly(ctx, [[fx(0), 17], [fx(19), 17], [fx(19), 33], [fx(0), 33]], '#cf9f4c');
    }
    this.poly(ctx, this.arcPts(COURT.w / 2, COURT.h / 2, 6, 0, Math.PI * 2), '#cf9f4c');

    // Boards run along the court with staggered joints; the tint is seeded so it never shimmers.
    const plank = 2;
    for (let row = 0; row * plank < COURT.h; row++) {
      const y = row * plank;
      for (let x = -((row * 5) % 14); x < COURT.w; x += 14) {
        const a = Math.max(0, x);
        const b = Math.min(COURT.w, x + 14);
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
      this.poly(ctx, [[fx(0), 17], [fx(19), 17], [fx(19), 33], [fx(0), 33]], undefined, LINE, 2);
      // Free-throw circle: solid towards half court, dashed inside the lane.
      this.line(ctx, this.arcPts(fx(19), 25, 6, courtward - Math.PI / 2, courtward + Math.PI / 2), LINE, 2);
      ctx.setLineDash([5, 5]);
      this.line(ctx, this.arcPts(fx(19), 25, 6, courtward + Math.PI / 2, courtward + (3 * Math.PI) / 2), LINE, 1.6);
      ctx.setLineDash([]);
      this.line(ctx, this.arcPts(hoopX, 25, 4, courtward - Math.PI / 2, courtward + Math.PI / 2), LINE, 1.6);
      // Lane markers.
      for (const f of [7, 10, 13, 16]) {
        this.line(ctx, [[fx(f), 17], [fx(f), 16.2]], LINE, 2);
        this.line(ctx, [[fx(f), 33], [fx(f), 33.8]], LINE, 2);
      }
      this.line(ctx, [[fx(0), 3], [fx(14), 3]], LINE, 2);
      this.line(ctx, [[fx(0), 47], [fx(14), 47]], LINE, 2);
      const a = Math.acos((25 - 3) / 23.75);
      this.line(ctx, this.arcPts(hoopX, 25, 23.75, courtward - Math.PI / 2 + a, courtward + Math.PI / 2 - a), LINE, 2);
    }
    this.line(ctx, [[COURT.w / 2, 0], [COURT.w / 2, COURT.h]], LINE, 2);
    this.line(ctx, this.arcPts(COURT.w / 2, COURT.h / 2, 6, 0, Math.PI * 2), LINE, 2);
    this.poly(ctx, [[0, 0], [COURT.w, 0], [COURT.w, COURT.h], [0, COURT.h]], undefined, LINE, 3);
  }

  private drawPost(ctx: CanvasRenderingContext2D, end: 0 | 1): void {
    const postX = end === 0 ? POST_INSET : COURT.w - POST_INSET;
    const boardX = end === 0 ? BOARD_INSET : COURT.w - BOARD_INSET;
    const foot = project(postX, 25);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.ellipse(foot.x + 2, foot.y + 1, 2.4 * FLOOR_RX, 2.4 * FLOOR_RY, 0, 0, Math.PI * 2);
    ctx.fill();
    this.box(ctx, postX - 1, postX + 1, 23.6, 26.4, 0, 1.4, '#274455', '#30566b', '#3d6c85');

    const base = project(postX, 25, 1.4);
    const top = project(postX, 25, 12.6);
    const arm = project(boardX, 25, 11.2);
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
    this.poly3(ctx, [[x, 21, 13.4], [x, 29, 13.4], [x, 29, 9.2], [x, 21, 9.2]], glass, OUTLINE, 3.4);
    this.poly3(ctx, [[x, 21, 13.4], [x, 29, 13.4], [x, 29, 9.2], [x, 21, 9.2]], undefined, '#ffffff', 2);
    this.poly3(ctx, [[x, 23.8, 11.8], [x, 26.2, 11.8], [x, 26.2, RIM_HEIGHT], [x, 23.8, RIM_HEIGHT]], undefined, '#e4472f', 1.6);
    const a = project(x, 25, RIM_HEIGHT);
    const b = project(edge, 25, RIM_HEIGHT);
    limb(ctx, [[a.x, a.y], [b.x, b.y]], 2.5, '#e4472f');
  }

  /** One half of the rim and net: drawn in two passes so the ball can drop between them. */
  private drawRim(ctx: CanvasRenderingContext2D, hoopX: number, from: number, to: number): void {
    const c = project(hoopX, 25, RIM_HEIGHT);
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
    const shrink = 1 - Math.min(0.5, lift * 0.12);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    ctx.beginPath();
    ctx.ellipse(f.x + 2, f.y + 1, 1.25 * FLOOR_RX * shrink, 1.25 * FLOOR_RY * shrink, 0, 0, Math.PI * 2);
    ctx.fill();
    if (hasBall) {
      ctx.strokeStyle = '#ffe57a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, 1.7 * FLOOR_RX, 1.7 * FLOOR_RY, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, info: DotInfo, ball: Frame['ball'], lift: number, shooting: boolean): void {
    const foot = project(x, y, lift);
    const prev = this.last[key];
    const speed = prev ? Math.hypot(x - prev.x, y - prev.y) : 0;
    this.last[key] = { x, y };

    // Face the way they are moving, or the ball when standing. On screen, x + y is rightwards
    // and y - x is towards the camera.
    const ftPerSecond = speed / this.frameSeconds;
    const moving = !!prev && ftPerSecond > 2.5;
    const dx = moving ? x - prev.x : ball.x - x;
    const dy = moving ? y - prev.y : ball.y - y;
    if (Math.abs(dx + dy) > 0.01) this.faceX[key] = dx + dy > 0 ? 1 : -1;
    if (Math.abs(dy - dx) > 0.01) this.faceFront[key] = dy - dx > 0;
    const dir = this.faceX[key] ?? 1;
    const front = this.faceFront[key] ?? true;

    // Two steps per leg cycle, and a stride lengthens with speed: from 6ft a cycle walking to 12 sprinting.
    const cycleFt = 6 + Math.min(6, (ftPerSecond / 26) * 6);
    this.stride[key] = (this.stride[key] ?? 0) + (speed / cycleFt) * Math.PI * 2;
    const swing = lift > 0.05 ? 0.35 : Math.sin(this.stride[key]) * Math.min(1, ftPerSecond / 14);

    const team = this.colours[info.side];
    const skin = SKIN[hash(key) % SKIN.length];
    const k = spriteScale(info.heightFt);

    ctx.save();
    ctx.translate(foot.x, foot.y);
    ctx.scale(k, k);

    // Legs: skin to the shin, then sock and shoe. The airborne pose tucks one knee.
    for (const side of [-1, 1] as const) {
      const s = swing * side;
      const tuck = lift > 0.05 && side === dir ? 5 : 0;
      const fx = side * 3.6 + dir * s * 5;
      const fy = -Math.max(0, s) * 3 - tuck;
      const kneeX = side * 3.8 + dir * (s * 2.5 + 1);
      limb(ctx, [[side * 3.4, -23], [kneeX, -12 - tuck * 0.5], [fx, fy - 3]], 4.4, skin);
      limb(ctx, [[(kneeX + fx) / 2, (-12 - tuck * 0.5 + fy) / 2], [fx, fy - 3]], 4.2, '#f4f4ee');
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.ellipse(fx + dir * 1.2, fy - 1.3, 3.9, 2.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = team.fill;
      ctx.fillRect(fx + dir * 1.2 - 2.4, fy - 1.9, 4.8, 0.9);
    }

    // Shorts.
    ctx.fillStyle = darken(team.fill, 0.72);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 0.9;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-7, -27);
    ctx.lineTo(7, -27);
    ctx.lineTo(8.6, -15.5);
    ctx.lineTo(1.2, -15.5);
    ctx.lineTo(0, -19);
    ctx.lineTo(-1.2, -15.5);
    ctx.lineTo(-8.6, -15.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Which hand goes where: the ball handler's arm reaches for the actual ball.
    const shoulder = -36.5;
    const b = project(ball.x, ball.y, ball.z);
    const rx = (b.x - foot.x) / k;
    const ry = (b.y - foot.y) / k;
    const ballSide: 1 | -1 = rx === 0 ? dir : rx > 0 ? 1 : -1;
    const armTo = (side: 1 | -1): { hand: Floor; elbow: Floor } => {
      const sx = side * 8.2;
      if (shooting) {
        return { hand: [side * 3.5 + dir * 2.5, -62], elbow: [side * 8.5 + dir, -50] };
      }
      if (info.hasBall && side === ballSide) {
        const vx = rx - sx;
        const vy = ry - shoulder;
        const reach = Math.min(20, Math.hypot(vx, vy)) / (Math.hypot(vx, vy) || 1);
        const hand: Floor = [sx + vx * reach, shoulder + vy * reach];
        return { hand, elbow: [(sx + hand[0]) / 2 + side * 2, (shoulder + hand[1]) / 2] };
      }
      const s = -swing * side * dir;
      return { hand: [side * 10.5 + s * 5, -20 - Math.abs(s) * 2], elbow: [side * 10.8 + s * 2, -28] };
    };

    // Jersey, shaded from the light side.
    const shirt = ctx.createLinearGradient(-9, 0, 9, 0);
    shirt.addColorStop(0, team.fill);
    shirt.addColorStop(1, darken(team.fill, 0.78));
    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.moveTo(-8.4, -38);
    ctx.quadraticCurveTo(-4, -39.5, -3.2, -39);
    ctx.quadraticCurveTo(0, front ? -35.5 : -38, 3.2, -39);
    ctx.quadraticCurveTo(4, -39.5, 8.4, -38);
    ctx.lineTo(7.2, -25.5);
    ctx.lineTo(-7.2, -25.5);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.fillStyle = team.text;
    ctx.font = `800 ${front ? 7 : 9.5}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(info.label, 0, front ? -30.5 : -31.5, 13);

    for (const side of [-1, 1] as const) {
      const { hand, elbow } = armTo(side);
      limb(ctx, [[side * 8.2, shoulder], elbow, hand], 3.8, skin);
    }

    this.drawHead(ctx, key, skin, team.fill, dir, front);
    ctx.restore();
  }

  private drawHead(ctx: CanvasRenderingContext2D, key: string, skin: string, band: string, dir: 1 | -1, front: boolean): void {
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
      ctx.arc(0, cy - 2.5, r + 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.fillStyle = skin;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(0, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Hair: a cap over the top from the front, the whole head from behind.
    ctx.fillStyle = hair;
    ctx.beginPath();
    if (front) {
      ctx.arc(0, cy, r + 0.4, Math.PI * 0.98, Math.PI * 2.02);
      ctx.quadraticCurveTo(dir * 2, cy - 4.4, -r - 0.4, cy);
    } else {
      ctx.arc(0, cy, r + 0.4, Math.PI * 0.82, Math.PI * 2.18);
      ctx.quadraticCurveTo(0, cy + 6.6, -r, cy + 2.4);
    }
    ctx.closePath();
    ctx.fill();
    if (style === 2) ctx.fillRect(-6.4, cy - 10, 12.8, 5);
    if (style === 3) {
      ctx.strokeStyle = band;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-r + 0.3, cy - 2.2);
      ctx.quadraticCurveTo(0, cy - 4, r - 0.3, cy - 2.2);
      ctx.stroke();
    }

    if (!front) return;
    const lookX = dir * 1.4;
    for (const side of [-1, 1]) {
      const ex = lookX + side * 2.7;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(ex, cy + 0.2, 1.35, 1.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1b1b18';
      ctx.beginPath();
      ctx.arc(ex + dir * 0.35, cy + 0.3, 0.85, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = darken(skin, 0.55);
    ctx.lineWidth = 0.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(lookX - 1.5, cy + 3.9);
    ctx.quadraticCurveTo(lookX, cy + 4.7, lookX + 1.5, cy + 3.9);
    ctx.stroke();
  }

  private drawBallShadow(ctx: CanvasRenderingContext2D, x: number, y: number, z: number): void {
    const f = project(x, y);
    const fade = 1 - Math.min(0.7, z * 0.05);
    ctx.fillStyle = `rgba(0, 0, 0, ${0.34 * fade})`;
    ctx.beginPath();
    ctx.ellipse(f.x, f.y, 0.75 * FLOOR_RX * fade, 0.75 * FLOOR_RY * fade, 0, 0, Math.PI * 2);
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
