// The arena round the court, all built in code (no model files): an NBA-style lower bowl of stepped
// tiers on all four sides (a little higher behind the baskets), courtside seats, the two team
// benches and the scorer's table, an LED ribbon board along the front of the tiers, and the crowd.
//
// Cheap to draw: the bowl is one merged mesh, the courtside furniture another, the ribbon one, and
// the whole crowd one InstancedMesh, animated in its vertex shader (no skeletons, nothing per fan on
// the CPU after it is built). Idle, each fan sways and shifts at his own timing; a cheer (stand up,
// arms up, waving) ripples round the bowl from the end where it happened. Far from the camera the
// fans' arms and legs fold away (degenerate triangles), so the distant crowd costs less to draw.
//
// Darker and less saturated than the court, so the players stay readable in the full-court view.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COURT, HALF_X, MID_Y } from '../../engine/court';
import { TEAM_COLOURS } from '../labels';
import { toScene } from './player3d';

/** The bowl: front of the first row from the sidelines and from the baselines (m). */
const SIDE_FROM = 4.4;
const END_FROM = 5.6;
const ROWS = 15;
const ROW_D = 0.85;
/** How much each row rises, along the sides and (steeper, so higher) behind the baskets. */
const RISE_SIDE = 0.4;
const RISE_END = 0.48;
/** The front wall the ribbon board is on, and the first row's height. */
const WALL_H = 1.0;
/** Seats along a row (m apart). */
const SEAT_W = 0.56;

/** A cheer: when it started, how loud, and from where (an angle round the bowl). */
interface Cheer {
  start: number;
  level: number;
  angle: number;
}

/** The crowd's vertex shader additions: idle sway, the cheer (stand, arms up, wave), cheaper far away. */
const CROWD_VERTEX_HEAD = /* glsl */ `
attribute vec3 aStand;   // the same vertex in the cheering pose (standing, arms up)
attribute float aPart;   // 0 body, 1 legs, 2 left arm, 3 right arm
attribute float aSeed;   // 0..1, his own timing
attribute float aTeam;   // whose fan: 0 home, 1 away
attribute float aKeen;   // 0..1: the keen ones get up for anything
attribute float aAngle;  // where he sits round the bowl (radians)
attribute vec3 aSkin;
uniform float uTime;
uniform vec4 uCheer[2];  // per team: start time, level, angle, unused
uniform vec3 uCam;
uniform float uFar;
varying vec3 vSkin;
varying float vPart;
float cheerOf(vec4 ch) {
  float level = ch.y;
  if (level <= 0.0) return 0.0;
  // He gets up if it is loud enough for him: everyone for a big moment, only the keen for less.
  if (level < 0.25 + 0.75 * (1.0 - aKeen)) return 0.0;
  // A ripple: it reaches him later the further round the bowl he sits from where it started.
  float d = abs(mod(aAngle - ch.z + 3.14159265, 6.2831853) - 3.14159265);
  float t = uTime - ch.x - d * 0.35 - aSeed * 0.25;
  float hold = 1.6 + level * 1.6;
  return smoothstep(0.0, 0.35, t) * (1.0 - smoothstep(hold, hold + 0.8, t));
}
`;

const CROWD_VERTEX_BODY = /* glsl */ `
vSkin = aSkin;
vPart = aPart;
float c = aTeam < 0.5 ? cheerOf(uCheer[0]) : cheerOf(uCheer[1]);
vec3 p = mix(position, aStand, c);
// Waving arms while up; a hop.
if (c > 0.0 && aPart > 1.5) p.x += sin(uTime * 9.0 + aSeed * 30.0 + aPart) * 0.06 * c * step(1.0, p.y);
p.y += c * max(0.0, sin(uTime * 7.0 + aSeed * 20.0)) * 0.08;
// Idle: a slow sway and the odd shift in his seat, each at his own pace.
float sway = sin(uTime * (0.6 + aSeed * 0.7) + aSeed * 40.0);
p.x += sway * 0.035 * p.y;
p.y += max(0.0, sin(uTime * (0.25 + aSeed * 0.3) + aSeed * 17.0) - 0.92) * 0.6;
// Far away his arms and legs fold into his body: fewer pixels to fill for a crowd nobody can read.
vec4 world = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
if (aPart > 0.5 && distance(world.xyz, uCam) > uFar) p = vec3(0.0, 0.45, 0.0);
vec3 transformed = p;
`;

/**
 * One seated fan, facing +z, his seat at the origin: a low-poly person built from boxes, with the
 * same vertices in a second pose (standing, arms up) for the vertex shader to blend to.
 */
function fanGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  /** A box from `a` to `b` in each pose; part as in the shader; `col` 0 shirt, 1 skin, 2 trousers. */
  const add = (part: number, col: number, sit: [number, number, number, number, number, number], stand: [number, number, number, number, number, number]) => {
    const box = (b: number[]) => {
      const g = new THREE.BoxGeometry(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
      g.translate((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
      return g;
    };
    const g = box(sit);
    const s = box(stand);
    g.setAttribute('aStand', s.getAttribute('position'));
    const n = g.getAttribute('position').count;
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Array(n).fill(part), 1));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(new Array(n).fill(col), 1));
    parts.push(g);
  };
  // Torso (and when he stands, 0.38 m higher).
  add(0, 0, [-0.19, 0.02, -0.12, 0.19, 0.5, 0.1], [-0.19, 0.42, -0.12, 0.19, 0.9, 0.1]);
  // Head.
  add(0, 1, [-0.1, 0.52, -0.1, 0.1, 0.74, 0.1], [-0.1, 0.92, -0.1, 0.1, 1.14, 0.1]);
  // Thighs forward along the seat, shins down; standing, straight down.
  add(1, 2, [-0.17, 0.0, 0.0, 0.17, 0.14, 0.42], [-0.17, 0.0, -0.08, 0.17, 0.44, 0.08]);
  add(1, 2, [-0.16, -0.42, 0.3, 0.16, 0.0, 0.44], [-0.16, -0.42, -0.07, 0.16, 0.02, 0.07]);
  // Arms: by his sides; up over his head.
  add(2, 1, [-0.29, 0.06, -0.05, -0.2, 0.46, 0.05], [-0.33, 0.86, -0.05, -0.24, 1.36, 0.05]);
  add(3, 1, [0.2, 0.06, -0.05, 0.29, 0.46, 0.05], [0.24, 0.86, -0.05, 0.33, 1.36, 0.05]);
  const g = mergeGeometries(parts)!;
  g.deleteAttribute('uv');
  return g;
}

export class Arena {
  readonly group = new THREE.Group();
  private crowd: THREE.InstancedMesh;
  private crowdMat: THREE.MeshLambertMaterial;
  private uniforms = {
    uTime: { value: 0 },
    uCheer: { value: [new THREE.Vector4(-99, 0, 0, 0), new THREE.Vector4(-99, 0, 0, 0)] },
    uCam: { value: new THREE.Vector3() },
    uFar: { value: 46 },
  };
  private cheers: [Cheer, Cheer] = [
    { start: -99, level: 0, angle: 0 },
    { start: -99, level: 0, angle: 0 },
  ];
  private ribbon: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; text: string; flash: { text: string; colour: string; until: number } | null };
  private time = 0;
  /** How many fans (for the report). */
  readonly fans: number;

  constructor() {
    this.buildBowl();
    this.buildCourtside();
    this.ribbon = this.buildRibbon();
    const { mesh, mat, count } = this.buildCrowd();
    this.crowd = mesh;
    this.crowdMat = mat;
    this.fans = count;
  }

  /** The tiers, a front wall and the concourse behind, as one merged mesh. */
  private buildBowl(): void {
    const steps: THREE.BufferGeometry[] = [];
    const risers: THREE.BufferGeometry[] = [];
    const box = (x0: number, x1: number, y0: number, y1: number, top: number, into: THREE.BufferGeometry[]) => {
      const g = new THREE.BoxGeometry(x1 - x0, top, y1 - y0);
      const c = toScene((x0 + x1) / 2, (y0 + y1) / 2, top / 2);
      g.translate(c.x, c.y, c.z);
      into.push(g);
    };
    for (let r = 0; r < ROWS; r++) {
      const sideIn = SIDE_FROM + r * ROW_D;
      const endIn = END_FROM + r * ROW_D;
      const side = WALL_H + r * RISE_SIDE;
      const end = WALL_H + r * RISE_END;
      const into = r % 2 ? steps : risers;
      // Along both sides (round the corners), and behind both baskets.
      box(-endIn - ROW_D, COURT.w + endIn + ROW_D, -sideIn - ROW_D, -sideIn, side, into);
      box(-endIn - ROW_D, COURT.w + endIn + ROW_D, COURT.h + sideIn, COURT.h + sideIn + ROW_D, side, into);
      box(-endIn - ROW_D, -endIn, -sideIn, COURT.h + sideIn, end, into);
      box(COURT.w + endIn, COURT.w + endIn + ROW_D, -sideIn, COURT.h + sideIn, end, into);
    }
    // The back wall round the top of the bowl.
    const back = ROWS * ROW_D;
    const topH = WALL_H + ROWS * RISE_END + 2.5;
    box(-END_FROM - back - 1, COURT.w + END_FROM + back + 1, -SIDE_FROM - back - 1, -SIDE_FROM - back, topH, risers);
    box(-END_FROM - back - 1, COURT.w + END_FROM + back + 1, COURT.h + SIDE_FROM + back, COURT.h + SIDE_FROM + back + 1, topH, risers);
    box(-END_FROM - back - 1, -END_FROM - back, -SIDE_FROM - back, COURT.h + SIDE_FROM + back, topH, risers);
    box(COURT.w + END_FROM + back, COURT.w + END_FROM + back + 1, -SIDE_FROM - back, COURT.h + SIDE_FROM + back, topH, risers);
    // Two shades of dark, muted blue-grey: alternate rows read as steps.
    const colour = (gs: THREE.BufferGeometry[], c: number) => {
      const col = new THREE.Color(c);
      for (const g of gs) {
        const n = g.getAttribute('position').count;
        const a = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) col.toArray(a, i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(a, 3));
        g.deleteAttribute('uv');
      }
    };
    colour(steps, 0x1b2129);
    colour(risers, 0x232a33);
    const bowl = new THREE.Mesh(mergeGeometries([...steps, ...risers])!, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.group.add(bowl);
    // The arena floor round the court, dark.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(COURT.w + 2 * (END_FROM + back + 1), COURT.h + 2 * (SIDE_FROM + back + 1)), new THREE.MeshLambertMaterial({ color: 0x15191f }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.copy(toScene(COURT.w / 2, COURT.h / 2, -0.01));
    floor.receiveShadow = true;
    this.group.add(floor);
  }

  /**
   * Courtside: a row of seats along both sidelines, the two team benches either side of the scorer's
   * table (on the far sideline, as in 2D), and the table itself. One merged mesh.
   */
  private buildCourtside(): void {
    const parts: THREE.BufferGeometry[] = [];
    const block = (x: number, y: number, z: number, w: number, d: number, h: number, colour: number) => {
      const g = new THREE.BoxGeometry(w, h, d);
      const c = toScene(x, y, z + h / 2);
      g.translate(c.x, c.y, c.z);
      g.deleteAttribute('uv');
      const col = new THREE.Color(colour);
      const n = g.getAttribute('position').count;
      const a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.toArray(a, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      parts.push(g);
    };
    const chair = (x: number, y: number, facingIn: 1 | -1, colour: number) => {
      block(x, y, 0, 0.48, 0.46, 0.45, colour);
      block(x, y + facingIn * -0.24, 0.45, 0.48, 0.06, 0.45, colour);
    };
    // The scorer's table at half court, the benches either side, on the far sideline.
    const tableY = -1.7;
    block(HALF_X, tableY, 0, 5.2, 0.7, 0.78, 0x1a2026);
    block(HALF_X, tableY + 0.36, 0.2, 5.2, 0.02, 0.5, 0x2c6db8);
    for (const side of [0, 1] as const) {
      const colour = new THREE.Color(TEAM_COLOURS[side].fill).multiplyScalar(0.55).getHex();
      const from = side === 0 ? HALF_X - 4.2 : HALF_X + 4.2;
      const dir = side === 0 ? -1 : 1;
      for (let i = 0; i < 9; i++) chair(from + dir * i * 0.6, -2.0, 1, colour);
    }
    // Courtside seats: along the near sideline, and beyond the benches on the far one.
    for (let x = 0.6; x < COURT.w - 0.3; x += 0.6) chair(x, COURT.h + 2.1, -1, 0x3a3f47);
    for (let x = 0.6; x < COURT.w - 0.3; x += 0.6) if (Math.abs(x - HALF_X) > 9.8) chair(x, -2.2, 1, 0x3a3f47);
    const mesh = new THREE.Mesh(mergeGeometries(parts)!, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.group.add(mesh);
  }

  /** The LED ribbon along the front wall of the bowl, all four sides: one mesh, one texture. */
  private buildRibbon(): Arena['ribbon'] {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 64;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    const h = 0.5;
    const y0 = WALL_H - h - 0.08;
    const strips: THREE.BufferGeometry[] = [];
    // Each side a strip on the wall's face, facing the court; the texture repeats every 24 m.
    const strip = (a: THREE.Vector3, b: THREE.Vector3, u0: number) => {
      const len = a.distanceTo(b);
      const g = new THREE.BufferGeometry();
      const pos = [a.x, y0, a.z, b.x, y0, b.z, b.x, y0 + h, b.z, a.x, y0 + h, a.z];
      const u1 = u0 + len / 24;
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, 0, u1, 0, u1, 1, u0, 1], 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      g.computeVertexNormals();
      strips.push(g);
      return u1;
    };
    const off = 0.01;
    const x0 = -END_FROM + off;
    const x1 = COURT.w + END_FROM - off;
    const yA = -SIDE_FROM + off;
    const yB = COURT.h + SIDE_FROM - off;
    let u = 0;
    // Wound so each strip faces the court.
    u = strip(toScene(x0, yA), toScene(x1, yA), u);
    u = strip(toScene(x1, yA), toScene(x1, yB), u);
    u = strip(toScene(x1, yB), toScene(x0, yB), u);
    strip(toScene(x0, yB), toScene(x0, yA), u);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false });
    this.group.add(new THREE.Mesh(mergeGeometries(strips)!, mat));
    const ribbon = { canvas, tex, text: '', flash: null };
    return ribbon;
  }

  /** What the ribbon says: the teams and the score, and DEFENCE! when the home side has to defend. */
  setBoard(names: [string, string], score: [number, number], defending: 0 | 1 | null): void {
    const flash = this.ribbon.flash && this.time < this.ribbon.flash.until ? this.ribbon.flash : null;
    const text = flash ? `F|${flash.text}|${flash.colour}` : `B|${names[0]}|${score[0]}|${names[1]}|${score[1]}|${defending === 0 ? 'D' : ''}`;
    if (text === this.ribbon.text) return;
    this.ribbon.text = text;
    const g = this.ribbon.canvas.getContext('2d')!;
    const W = 2048;
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, W, 64);
    g.textBaseline = 'middle';
    g.font = '800 40px system-ui, sans-serif';
    if (flash) {
      for (let x = 0; x < W; x += 512) {
        g.fillStyle = flash.colour;
        g.fillText(flash.text, x + 30, 34);
      }
    } else {
      // The score, then the home crowd's chant (or the arena's name), each piece measured so they never overlap.
      const pieces: [string, string][] = [
        [`${names[0].toUpperCase()} ${score[0]}`, TEAM_COLOURS[0].fill],
        ['-', '#cfd6df'],
        [`${score[1]} ${names[1].toUpperCase()}`, TEAM_COLOURS[1].fill],
        [defending === 0 ? 'DE-FENCE!   DE-FENCE!' : 'HOOP MANAGER ARENA', defending === 0 ? '#ffd23f' : '#7f8a99'],
      ];
      let x = 40;
      for (const [text, colour] of pieces) {
        g.fillStyle = colour;
        g.fillText(text, x, 34);
        x += g.measureText(text).width + 70;
      }
    }
    this.ribbon.tex.needsUpdate = true;
  }

  /**
   * The crowd: a seat for every fan along every row, about one in eight empty; one InstancedMesh.
   * Home fans fill most of the bowl; the away fans sit together behind one basket (and a few
   * scattered). Shirts: mostly their team's colour, the rest plain; all a little dimmed.
   */
  private buildCrowd(): { mesh: THREE.InstancedMesh; mat: THREE.MeshLambertMaterial; count: number } {
    let seed = 11;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    type Seat = { x: number; y: number; z: number; facing: number };
    const seats: Seat[] = [];
    const along = (x0: number, y0: number, x1: number, y1: number, z: number, facing: number) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      for (let a = SEAT_W / 2; a < len - SEAT_W / 3; a += SEAT_W) seats.push({ x: x0 + ((x1 - x0) * a) / len, y: y0 + ((y1 - y0) * a) / len, z, facing });
    };
    for (let r = 0; r < ROWS; r++) {
      const sideIn = SIDE_FROM + r * ROW_D + ROW_D * 0.55;
      const endIn = END_FROM + r * ROW_D + ROW_D * 0.55;
      const side = WALL_H + r * RISE_SIDE;
      const end = WALL_H + r * RISE_END;
      // Facing the court: +y on the far side, -y on the near side, +x/-x at the ends.
      along(-endIn, -sideIn, COURT.w + endIn, -sideIn, side, Math.PI / 2);
      along(-endIn, COURT.h + sideIn, COURT.w + endIn, COURT.h + sideIn, side, -Math.PI / 2);
      along(-endIn, -sideIn + 0.6, -endIn, COURT.h + sideIn - 0.6, end, 0);
      along(COURT.w + endIn, -sideIn + 0.6, COURT.w + endIn, COURT.h + sideIn - 0.6, end, Math.PI);
    }
    const filled = seats.filter(() => rand() < 0.88);
    const geo = fanGeometry();
    const count = filled.length;
    const team = new Float32Array(count);
    const keen = new Float32Array(count);
    const seedA = new Float32Array(count);
    const angle = new Float32Array(count);
    const skin = new Float32Array(count * 3);
    const skins = ['#e9c2a0', '#d29a74', '#a8724c', '#83563a', '#5e3e28', '#e2b48f'].map((c) => new THREE.Color(c));
    const plain = ['#e8e8e8', '#2b2b2b', '#8c96a3', '#5b6470', '#c9b48a'].map((c) => new THREE.Color(c));
    const home = new THREE.Color(TEAM_COLOURS[0].fill);
    const away = new THREE.Color(TEAM_COLOURS[1].fill);
    const mat = new THREE.MeshLambertMaterial({ flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const centre = toScene(COURT.w / 2, MID_Y);
    filled.forEach((s, i) => {
      // The away end: behind the left-hand basket, the middle of it.
      const awayEnd = s.x < -END_FROM + 0.5 && Math.abs(s.y - MID_Y) < 7;
      const t = awayEnd ? (rand() < 0.85 ? 1 : 0) : rand() < 0.05 ? 1 : 0;
      team[i] = t;
      keen[i] = rand();
      seedA[i] = rand();
      const p = toScene(s.x, s.y, s.z);
      angle[i] = Math.atan2(p.z - centre.z, p.x - centre.x);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -s.facing + Math.PI / 2);
      const k = 0.92 + rand() * 0.18;
      m.compose(p, q, new THREE.Vector3(k, k, k));
      mesh.setMatrixAt(i, m);
      // Shirts: 60% their team's colour, the rest plain; dimmed and greyed so the court stays the brightest thing.
      const shirt = (rand() < 0.6 ? (t === 0 ? home : away) : plain[Math.floor(rand() * plain.length)]).clone();
      const grey = (shirt.r + shirt.g + shirt.b) / 3;
      shirt.lerp(new THREE.Color(grey, grey, grey), 0.3).multiplyScalar(0.62);
      mesh.setColorAt(i, shirt);
      skins[Math.floor(rand() * skins.length)].clone().multiplyScalar(0.7).toArray(skin, i * 3);
    });
    geo.setAttribute('aTeam', new THREE.InstancedBufferAttribute(team, 1));
    geo.setAttribute('aKeen', new THREE.InstancedBufferAttribute(keen, 1));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seedA, 1));
    geo.setAttribute('aAngle', new THREE.InstancedBufferAttribute(angle, 1));
    geo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(skin, 3));
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${CROWD_VERTEX_HEAD}\nattribute float aCol;\nvarying float vCol;`)
        .replace('#include <begin_vertex>', `${CROWD_VERTEX_BODY}\nvCol = aCol;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSkin;\nvarying float vPart;\nvarying float vCol;')
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity );')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          // Shirt from the instance colour; skin and trousers from his own.
          if (vCol > 1.5) diffuseColor.rgb = vec3(0.07, 0.08, 0.1);
          else if (vCol > 0.5) diffuseColor.rgb = vSkin;`,
        );
    };
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return { mesh, mat, count };
  }

  /**
   * A cheer for a team's fans: `level` 1 for a big moment (everyone up), less for smaller ones (only
   * the keen); it ripples round the bowl from `atX` (court x of the basket where it happened).
   */
  cheer(team: 0 | 1, level: number, atX: number): void {
    const cur = this.cheers[team];
    // A cheer still going is not cut short by a smaller one.
    if (this.time - cur.start < 2 && cur.level > level) return;
    const p = toScene(atX, MID_Y);
    const c = toScene(COURT.w / 2, MID_Y);
    this.cheers[team] = { start: this.time, level, angle: Math.atan2(p.z - c.z, p.x - c.x) };
    this.uniforms.uCheer.value[team].set(this.time, level, this.cheers[team].angle, 0);
  }

  /** Flashes a message along the whole ribbon for a few seconds ("DUNK!", "THREE!"). */
  flash(text: string, colour: string, seconds = 3): void {
    this.ribbon.flash = { text, colour, until: this.time + seconds };
    this.ribbon.text = '';
  }

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uCam.value.copy(camera.position);
    // Scroll the ribbon slowly.
    this.ribbon.tex.offset.x = (this.ribbon.tex.offset.x + dt * 0.04) % 1;
    void this.crowd;
    void this.crowdMat;
  }

  get seconds(): number {
    return this.time;
  }
}
