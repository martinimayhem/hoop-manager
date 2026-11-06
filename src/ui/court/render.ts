// Draws the match as a broadcast-style 2D perspective view: the camera sits above the near
// sideline looking across the court. Players are standing figures, scaled by depth, and the
// ball's height is visible as it arcs towards a raised rim.

import { COURT, HOOP_X, type Frame } from './animation';

export const CANVAS_W = 1000;
export const CANVAS_H = 470;

// Pinhole camera: floor point (x, y) is `CAM_DIST + (COURT.h - y)` feet from the camera.
const CAM_DIST = 126;
const CAM_HEIGHT = 102;
const FOCAL = 1311;
const FAR_SIDELINE_Y = 105; // screen y of the far sideline

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
  /** Pixels per foot at this depth. */
  s: number;
}

const HORIZON = FAR_SIDELINE_Y - (CAM_HEIGHT * FOCAL) / (CAM_DIST + COURT.h);

/** Court feet (x along the court, y across it, z up) to screen pixels. */
export function project(x: number, y: number, z = 0): Pt {
  const s = FOCAL / (CAM_DIST + (COURT.h - y));
  return { x: CANVAS_W / 2 + (x - COURT.w / 2) * s, y: HORIZON + (CAM_HEIGHT - z) * s, s };
}

const FLOOR = '#d8a065';
const FLOOR_EDGE = '#a9743f';
const PAINT = 'rgba(150, 60, 30, 0.28)';
const LINE = 'rgba(255,255,255,0.92)';
const SKIN = ['#f1c7a5', '#d9a07a', '#b07850', '#8a5a3a', '#6b4429', '#e8b894'];
const HAIR = ['#1d140e', '#3b2416', '#0f0f0f', '#5a3b1d', '#24170f'];

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

export class CourtRenderer {
  private last: Record<string, { x: number; y: number }> = {};
  private stride: Record<string, number> = {};
  private facing: Record<string, 1 | -1> = {};

  constructor(private colours: [TeamColours, TeamColours]) {}

  draw(ctx: CanvasRenderingContext2D, frame: Frame | null, dots: Record<string, DotInfo>, spotlight: string | null, now: number): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawBackdrop(ctx);
    this.drawFloor(ctx);
    if (!frame) {
      this.drawHoop(ctx, 0);
      this.drawHoop(ctx, 1);
      return;
    }

    // Shadows first so every figure stands on top of them.
    for (const [key, p] of Object.entries(frame.players)) {
      if (!dots[key]) continue;
      const f = project(p.x, p.y);
      const shrink = 1 - Math.min(0.5, (frame.lift?.[key] ?? 0) * 0.12);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, 1.3 * f.s * shrink, 0.45 * f.s * shrink, 0, 0, Math.PI * 2);
      ctx.fill();
      if (key === spotlight) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(f.x, f.y, (1.9 + Math.sin(now * 6) * 0.15) * f.s, 0.7 * f.s, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    const b = frame.ball;
    const bs = project(b.x, b.y);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(bs.x, bs.y, 0.5 * bs.s, 0.18 * bs.s, 0, 0, Math.PI * 2);
    ctx.fill();

    // Depth order: far things first. The hoops sit at mid-depth (y = 25).
    type Item = { depth: number; draw: () => void };
    const items: Item[] = [
      { depth: 25, draw: () => this.drawHoop(ctx, 0) },
      { depth: 25, draw: () => this.drawHoop(ctx, 1) },
      { depth: b.y + 0.01, draw: () => this.drawBall(ctx, b.x, b.y, b.z) },
    ];
    for (const [key, p] of Object.entries(frame.players)) {
      const info = dots[key];
      if (info) {
        const lift = frame.lift?.[key] ?? 0;
        const shooting = frame.shooter === key;
        items.push({ depth: p.y, draw: () => this.drawPlayer(ctx, key, p.x, p.y, info, frame.ball.x, lift, shooting) });
      }
    }
    items.sort((a, c) => a.depth - c.depth).forEach((i) => i.draw());
  }

  // ---- Static scene ------------------------------------------------------------

  private drawBackdrop(ctx: CanvasRenderingContext2D) {
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, '#0d1220');
    g.addColorStop(0.35, '#1b2438');
    g.addColorStop(1, '#0d1220');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  private poly(ctx: CanvasRenderingContext2D, pts: [number, number][], z = 0) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const p = project(x, y, z);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
  }

  private arcPts(cx: number, cy: number, r: number, from: number, to: number, steps = 40): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const a = from + ((to - from) * i) / steps;
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return out;
  }

  private drawFloor(ctx: CanvasRenderingContext2D) {
    // Apron and playing surface.
    this.poly(ctx, [[-6, -5], [COURT.w + 6, -5], [COURT.w + 6, COURT.h + 5], [-6, COURT.h + 5]]);
    ctx.fillStyle = FLOOR_EDGE;
    ctx.fill();
    this.poly(ctx, [[0, 0], [COURT.w, 0], [COURT.w, COURT.h], [0, COURT.h]]);
    ctx.fillStyle = FLOOR;
    ctx.fill();
    // Planks run along the court.
    ctx.strokeStyle = 'rgba(120, 70, 30, 0.12)';
    ctx.lineWidth = 1;
    for (let y = 2; y < COURT.h; y += 2) {
      this.poly(ctx, [[0, y], [COURT.w, y]]);
      ctx.stroke();
    }

    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2;
    this.poly(ctx, [[0, 0], [COURT.w, 0], [COURT.w, COURT.h], [0, COURT.h], [0, 0]]);
    ctx.stroke();
    this.poly(ctx, [[COURT.w / 2, 0], [COURT.w / 2, COURT.h]]);
    ctx.stroke();
    this.poly(ctx, this.arcPts(COURT.w / 2, 25, 6, 0, Math.PI * 2));
    ctx.stroke();

    for (const end of [0, 1] as const) {
      const fx = (x: number) => (end === 0 ? x : COURT.w - x);
      const hoopX = end === 0 ? COURT.w - HOOP_X : HOOP_X;
      // Paint.
      this.poly(ctx, [[fx(0), 17], [fx(19), 17], [fx(19), 33], [fx(0), 33]]);
      ctx.fillStyle = PAINT;
      ctx.fill();
      ctx.closePath();
      ctx.stroke();
      // Free-throw circle.
      this.poly(ctx, this.arcPts(fx(19), 25, 6, 0, Math.PI * 2));
      ctx.stroke();
      // Three-point line: corners plus the arc.
      this.poly(ctx, [[fx(0), 3], [fx(14), 3]]);
      ctx.stroke();
      this.poly(ctx, [[fx(0), 47], [fx(14), 47]]);
      ctx.stroke();
      const a = Math.acos((25 - 3) / 23.75);
      const arc = end === 0 ? this.arcPts(hoopX, 25, 23.75, -Math.PI / 2 + a, Math.PI / 2 - a) : this.arcPts(hoopX, 25, 23.75, Math.PI / 2 + a, (3 * Math.PI) / 2 - a);
      this.poly(ctx, arc);
      ctx.stroke();
    }
  }

  private drawHoop(ctx: CanvasRenderingContext2D, end: 0 | 1) {
    const dir = end === 0 ? 1 : -1;
    const baseX = end === 0 ? -3 : COURT.w + 3;
    const boardX = end === 0 ? 4 : COURT.w - 4;
    const hoopX = end === 0 ? COURT.w - HOOP_X : HOOP_X;

    // Stanchion and arm.
    const foot = project(baseX, 25);
    const top = project(baseX, 25, 12.5);
    const arm = project(boardX - dir * 0.3, 25, 11.5);
    ctx.strokeStyle = '#3a4258';
    ctx.lineWidth = Math.max(3, 0.6 * foot.s);
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y);
    ctx.lineTo(top.x, top.y);
    ctx.lineTo(arm.x, arm.y);
    ctx.stroke();
    ctx.fillStyle = '#2a3145';
    ctx.fillRect(foot.x - 1.2 * foot.s, foot.y - 0.8 * foot.s, 2.4 * foot.s, 0.8 * foot.s);

    // Backboard (seen nearly edge-on from the sideline) with its shooter's square.
    const corners = [project(boardX, 22, 9.5), project(boardX, 28, 9.5), project(boardX, 28, 13), project(boardX, 22, 13)];
    ctx.beginPath();
    corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(235, 240, 250, 0.55)';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Net, then the rim on top of it.
    const rim = this.arcPts(hoopX, 25, 0.75, 0, Math.PI * 2, 24);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1;
    for (let i = 0; i < rim.length - 1; i += 3) {
      const [x, y] = rim[i];
      const t = project(x, y, 10);
      const bottom = project(hoopX + (x - hoopX) * 0.55, 25 + (y - 25) * 0.55, 8.4);
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(bottom.x, bottom.y);
      ctx.stroke();
    }
    this.poly(ctx, rim, 10);
    ctx.strokeStyle = '#ff5a1f';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // ---- Players & ball ------------------------------------------------------------

  private drawPlayer(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, info: DotInfo, ballX: number, lift: number, shooting: boolean) {
    // Feet leave the floor when jumping; the shadow (drawn earlier) stays on the floor.
    const f = project(x, y, lift);
    const s = f.s;
    const h = info.heightFt;
    const c = this.colours[info.side];

    // Running animation: stride grows with speed; face the way they move (or the ball when still).
    const prev = this.last[key];
    const speed = prev ? Math.hypot(x - prev.x, y - prev.y) : 0;
    this.last[key] = { x, y };
    if (prev && Math.abs(x - prev.x) > 0.02) this.facing[key] = x > prev.x ? 1 : -1;
    else if (speed < 0.01) this.facing[key] = ballX >= x ? 1 : -1;
    const dir = this.facing[key] ?? 1;
    this.stride[key] = (this.stride[key] ?? 0) + Math.min(speed, 1.2) * 1.6;
    const swing = lift > 0.05 ? 0.25 : Math.sin(this.stride[key]) * Math.min(1, speed * 6);

    const z = (frac: number) => f.y - frac * h * s;
    const hipY = z(0.47);
    const shoulderY = z(0.8);
    const skin = SKIN[hash(key) % SKIN.length];

    // Legs.
    ctx.strokeStyle = skin;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, 0.34 * s);
    for (const side of [-1, 1]) {
      const footX = f.x + side * 0.28 * s + side * swing * 0.45 * s;
      ctx.beginPath();
      ctx.moveTo(f.x + side * 0.25 * s, hipY);
      ctx.lineTo(footX, f.y - 0.15 * s);
      ctx.stroke();
      ctx.fillStyle = '#f4f4f4';
      ctx.beginPath();
      ctx.ellipse(footX + dir * 0.15 * s, f.y - 0.1 * s, 0.32 * s, 0.14 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Shorts and jersey.
    const shoulderW = 0.78 * s;
    ctx.fillStyle = darken(c.fill, 0.75);
    ctx.fillRect(f.x - 0.55 * s, z(0.56), 1.1 * s, z(0.43) - z(0.56));
    ctx.fillStyle = c.fill;
    ctx.beginPath();
    ctx.moveTo(f.x - 0.5 * s, z(0.55));
    ctx.lineTo(f.x + 0.5 * s, z(0.55));
    ctx.lineTo(f.x + shoulderW, shoulderY);
    ctx.lineTo(f.x - shoulderW, shoulderY);
    ctx.closePath();
    ctx.fill();
    if (info.hasBall) {
      ctx.strokeStyle = '#ffe14d';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Arms: swinging when running; the ball handler's arm reaches for the ball.
    ctx.strokeStyle = skin;
    ctx.lineWidth = Math.max(1.5, 0.24 * s);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(f.x + side * shoulderW * 0.95, shoulderY + 0.1 * s);
      if (shooting) {
        // Both arms up to the ball.
        ctx.lineTo(f.x + side * 0.3 * s + dir * 0.4 * s, z(1.12));
      } else {
        const reach = info.hasBall && side === dir ? 0.7 : -swing * side * 0.35;
        ctx.lineTo(f.x + side * (shoulderW + 0.15 * s) + dir * reach * s, z(0.5));
      }
      ctx.stroke();
    }

    // Head and hair.
    const headR = 0.38 * s;
    const headY = z(0.9);
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(f.x + dir * 0.05 * s, headY, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = HAIR[hash(key + 'h') % HAIR.length];
    ctx.beginPath();
    ctx.arc(f.x + dir * 0.05 * s, headY - headR * 0.15, headR, Math.PI, 0);
    ctx.fill();

    // Number on the jersey.
    ctx.fillStyle = c.text;
    ctx.font = `900 ${Math.max(9, 0.62 * s)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(info.label, f.x, z(0.68));
  }

  private drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, z: number) {
    const p = project(x, y, z);
    const r = Math.max(3, 0.48 * p.s);
    ctx.fillStyle = '#e8701a';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3a1a00';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x - r, p.y);
    ctx.lineTo(p.x + r, p.y);
    ctx.moveTo(p.x, p.y - r);
    ctx.lineTo(p.x, p.y + r);
    ctx.stroke();
  }
}
