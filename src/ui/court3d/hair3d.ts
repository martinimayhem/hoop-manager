// Hair, beard and headband for a 3D player, as real meshes in his hair colour (no painted face).
//
// Where the CC0 Quaternius pack our body comes from has the style (public/3d/hair.glb, see
// scripts/prepare-3d-assets.py and public/3d/LICENSE.txt), its mesh is used: shaved (its buzz cut),
// short (its parted crop), long and the full beard. The pack's free version has no others, so the
// rest are made here, over the head's own shape (below).
//
// Everything comes from the player's one appearance record (looks.ts), the same one his 2D portrait
// is drawn from: the hairstyle, the facial hair, the hair colour, the skin and the headband. Each
// hairstyle is a shape that reads from every side, as on the 2D court: a short crop is a close cap,
// curls are a bumpy one, a mohawk is a fin over a shaved head, a flat top a block, a bun a knot on
// the crown, long hair a bob to the jaw, cornrows ridged rows front to back.
//
// The shapes follow the model's own scalp: the head mesh is sampled once into a radius map (how far
// the surface is from the middle of the head in each direction), and each style is a shell over it,
// thickest where the style is, melting into the skin at its edges.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FacialHair, Hairstyle } from '../looks';

/** The pack's hair meshes by name (buzzed, parted, long, beard), in the body's bind-pose space. */
let packParts: Record<string, THREE.BufferGeometry> = {};
export function setHairParts(parts: Record<string, THREE.BufferGeometry>): void {
  packParts = parts;
}
/** Which pack mesh each hairstyle and facial hair uses, where the pack has one. */
const PACK_HAIR: Partial<Record<Hairstyle, string>> = { shaved: 'buzzed', short: 'parted', long: 'long' };
const PACK_BEARD: Partial<Record<FacialHair, string>> = { full: 'beard' };
/** How far a pack hairstyle stands off the scalp at the forehead, for a headband to sit over it (m). */
const PACK_HAIR_DEPTH: Partial<Record<Hairstyle, number>> = { shaved: 0.005, short: 0.014, long: 0.024 };

/** A pack mesh in one colour, ready to merge. */
function packPart(name: string, colour: THREE.Color): THREE.BufferGeometry | null {
  const src = packParts[name];
  if (!src) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', src.getAttribute('position').clone());
  g.setAttribute('normal', src.getAttribute('normal').clone());
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colour.toArray(col, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const index = src.getIndex();
  if (index) g.setIndex(Array.from(index.array as ArrayLike<number>));
  return g;
}

export interface HairLook {
  hairstyle: Hairstyle;
  facialHair: FacialHair;
  hair: string;
  skin: string;
  /** A headband in this colour (the team's), or none. */
  headband: string | null;
}

/** The middle of the head in the model's bind pose (model metres; the model is 1.82 m tall). */
const CENTRE = new THREE.Vector3(0, 1.69, -0.005);
/** The radius map's resolution: round the head, and from under the chin to the crown. */
const MAP_A = 128;
const MAP_E = 80;
const E_MIN = -1.35;
const E_MAX = Math.PI / 2;
/** A flat top's level top (model metres: the crown is at 1.81). */
const FLAT_TOP_Y = 1.845;
/** The shells' resolution. */
const GRID_A = 176;
const GRID_E = 128;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How far the head's surface is from CENTRE in each direction (azimuth from the front, elevation). */
type RadiusMap = Float32Array;
const maps = new WeakMap<THREE.BufferGeometry, RadiusMap>();

/** Direction for azimuth `a` (0: his front, +: towards his left... +x) and elevation `e`, in front-facing space. */
function dir(a: number, e: number): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
}

/**
 * The head's radius map, sampled from the body mesh's triangles above the shoulders: every triangle
 * is sampled at points across it, each falling in a direction bin that keeps the furthest point; the
 * few empty bins are filled from their neighbours.
 */
function radiusMap(geometry: THREE.BufferGeometry, front: number): RadiusMap {
  const cached = maps.get(geometry);
  if (cached) return cached;
  const pos = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const map = new Float32Array(MAP_A * MAP_E).fill(-1);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const p = new THREE.Vector3();
  const tris = index ? index.count / 3 : pos.count / 3;
  const vi = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
  const S = 6;
  for (let t = 0; t < tris; t++) {
    a.fromBufferAttribute(pos, vi(t, 0));
    b.fromBufferAttribute(pos, vi(t, 1));
    c.fromBufferAttribute(pos, vi(t, 2));
    // The head and neck only (the arms of the T-pose reach this high, out to the sides).
    if (a.y < 1.52 || b.y < 1.52 || c.y < 1.52 || Math.max(Math.abs(a.x), Math.abs(b.x), Math.abs(c.x)) > 0.13) continue;
    for (let i = 0; i <= S; i++)
      for (let j = 0; j <= S - i; j++) {
        const u = i / S;
        const v = j / S;
        p.copy(a).multiplyScalar(1 - u - v).addScaledVector(b, u).addScaledVector(c, v).sub(CENTRE);
        p.z *= front;
        const r = p.length();
        if (r > 0.2) continue;
        const e = Math.asin(p.y / r);
        if (e < E_MIN || e > E_MAX) continue;
        const az = Math.atan2(p.x, p.z);
        const ia = Math.min(MAP_A - 1, Math.floor(((az + Math.PI) / (2 * Math.PI)) * MAP_A));
        const ie = Math.min(MAP_E - 1, Math.floor(((e - E_MIN) / (E_MAX - E_MIN)) * MAP_E));
        const k = ie * MAP_A + ia;
        if (r > map[k]) map[k] = r;
      }
  }
  // Fill any empty bins from their neighbours (round the head wraps).
  for (let pass = 0; pass < 200; pass++) {
    let empty = 0;
    for (let ie = 0; ie < MAP_E; ie++)
      for (let ia = 0; ia < MAP_A; ia++) {
        const k = ie * MAP_A + ia;
        if (map[k] > 0) continue;
        let sum = 0;
        let n = 0;
        for (const [da, de] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ea = ie + de;
          if (ea < 0 || ea >= MAP_E) continue;
          const v = map[ea * MAP_A + ((ia + da + MAP_A) % MAP_A)];
          if (v > 0) {
            sum += v;
            n++;
          }
        }
        if (n) map[k] = sum / n;
        else empty++;
      }
    if (!empty) break;
  }
  maps.set(geometry, map);
  return map;
}

/** The head's radius in a direction, interpolated. */
function radiusAt(map: RadiusMap, az: number, e: number): number {
  const fa = ((az + Math.PI) / (2 * Math.PI)) * MAP_A - 0.5;
  const fe = Math.max(0, Math.min(MAP_E - 1.001, ((e - E_MIN) / (E_MAX - E_MIN)) * MAP_E - 0.5));
  const a0 = Math.floor(fa);
  const e0 = Math.floor(fe);
  const ta = fa - a0;
  const te = fe - e0;
  const at = (ia: number, ie: number) => map[ie * MAP_A + ((ia % MAP_A) + MAP_A) % MAP_A];
  return (at(a0, e0) * (1 - ta) + at(a0 + 1, e0) * ta) * (1 - te) + (at(a0, e0 + 1) * (1 - ta) + at(a0 + 1, e0 + 1) * ta) * te;
}

/** A layer over the head: where it is (0..1, soft at its edge), how thick, and its colour there. */
interface Layer {
  cover(p: THREE.Vector3, az: number, e: number, r: number): number;
  thick(p: THREE.Vector3, az: number, e: number, r: number): number;
  colour(p: THREE.Vector3): THREE.Color;
  /** Thickness at the edge, so the layer sits just off the skin there instead of inside it. */
  lift?: number;
}

/** Over the ears (|x| out past the side of the head, ear height, just behind the middle): never covered by short hair. */
const onEar = (p: THREE.Vector3) => Math.abs(p.x) > 0.066 && p.y > 1.655 && p.y < 1.724 && p.z > -0.05 && p.z < 0.012;

/** The hairline: high on the forehead, above the ears at the sides, down to the nape at the back. */
function hairline(p: THREE.Vector3, back: number): number {
  if (p.z > 0) return 1.727 + (1.752 - 1.727) * smooth(0.0, 0.06, p.z);
  return 1.727 + (back - 1.727) * smooth(0.03, 0.085, -p.z);
}

function hairLayer(look: HairLook, map: RadiusMap): Layer | null {
  const hair = new THREE.Color(look.hair);
  const skin = new THREE.Color(look.skin);
  const shaved = skin.clone().lerp(hair, 0.55);
  const s = look.hairstyle;
  if (s === 'bald') return null;
  const scalp = (p: THREE.Vector3, back = 1.635) => (onEar(p) ? 0 : smooth(hairline(p, back), hairline(p, back) + 0.01, p.y));
  switch (s) {
    case 'shaved':
      return { cover: (p) => scalp(p), thick: () => 0.0014, colour: () => shaved };
    case 'short':
      return { cover: (p) => scalp(p), thick: () => 0.0065, colour: () => hair };
    case 'curly':
      // Close-cropped curls: a thicker cap, bumpy all over.
      return {
        cover: (p) => scalp(p),
        thick: (_p, az, e) => 0.011 + 0.006 * Math.max(0, Math.sin(az * 15) * Math.sin(e * 15 + 0.7)),
        colour: () => hair,
      };
    case 'spiky':
      // A textured top: short tufts standing up from the crown.
      return {
        cover: (p) => scalp(p),
        thick: (_p, az, e) => 0.007 + 0.022 * Math.pow(Math.max(0, Math.sin(az * 10) * Math.sin(e * 12)), 3) * smooth(0.15, 0.7, e),
        colour: () => hair,
      };
    case 'mohawk': {
      // A fin from the forehead to the nape, over a shaved head.
      const fin = (p: THREE.Vector3) => 1 - smooth(0.013, 0.022, Math.abs(p.x));
      return {
        cover: (p) => scalp(p),
        thick: (p) => 0.0014 + fin(p) * (0.01 + 0.04 * smooth(1.66, 1.8, p.y)),
        colour: (p) => (fin(p) > 0.5 ? hair : shaved),
      };
    }
    case 'flattop':
      // A block: straight up from the sides of the head, its top cut level well above the crown.
      return {
        cover: (p) => scalp(p),
        thick: (_p, az, e, r) => {
          if (e < 0.25) return 0.008;
          // The sides: as far out as the head is at the temples (plus the hair), straight up.
          const side = radiusAt(map, az, 0.45) * Math.cos(0.45) + 0.008;
          const top = (FLAT_TOP_Y - CENTRE.y) / Math.sin(e);
          const out = Math.min(side / Math.cos(e), top);
          return Math.max(0.008, out - r);
        },
        colour: () => hair,
      };
    case 'bun':
      return { cover: (p) => scalp(p), thick: () => 0.0065, colour: () => hair };
    case 'long':
      // A bob: down to the jaw at the sides and the nape at the back, over the ears, fuller at the ends.
      return {
        cover: (p) => {
          // Ends at the jaw all round (as in the portraits), a clean edge, not down the neck.
          const line = p.z > 0.035 || (p.z > 0.0 && Math.abs(p.x) < 0.07) ? hairline(p, 1.64) : 1.64;
          return smooth(line, line + 0.008, p.y);
        },
        thick: (p) => 0.009 + 0.005 * smooth(1.72, 1.66, p.y),
        colour: () => hair,
      };
    case 'cornrows': {
      // Rows front to back, with the scalp showing in the partings between them.
      const row = (p: THREE.Vector3) => 0.5 + 0.5 * Math.cos((p.x * 2 * Math.PI) / 0.024);
      const parting = skin.clone().lerp(hair, 0.3);
      return {
        cover: (p) => scalp(p),
        thick: (p) => 0.0025 + 0.005 * row(p),
        colour: (p) => (row(p) > 0.3 ? hair : parting),
      };
    }
  }
  return null;
}

function beardLayer(look: HairLook): Layer | null {
  const hair = new THREE.Color(look.hair);
  const skin = new THREE.Color(look.skin);
  const f = look.facialHair;
  if (f === 'none') return null;
  // The lips stay clear.
  const mouth = (p: THREE.Vector3) => Math.abs(p.x) < 0.024 && p.y > 1.609 && p.y < 1.628 && p.z > 0.07;
  // Jaw and cheeks: up to the cheekbones, rising to the sideburns in front of the ears.
  const jaw = (p: THREE.Vector3) => {
    if (p.z < 0.0 || mouth(p)) return 0;
    const upper = 1.648 + 0.072 * smooth(0.045, 0.078, Math.abs(p.x));
    // Along the jaw: under the chin at the front, rising to below the ear at the side (not down the neck).
    const lower = 1.562 + (1.645 - 1.562) * smooth(0.07, 0.01, p.z);
    return smooth(lower, lower + 0.008, p.y) * (1 - smooth(upper - 0.008, upper, p.y)) * smooth(0.0, 0.012, p.z);
  };
  switch (f) {
    case 'full':
      return { cover: jaw, thick: () => 0.0075, colour: () => hair };
    case 'stubble':
      return { cover: jaw, thick: () => 0.0014, colour: () => skin.clone().lerp(hair, 0.5) };
    case 'goatee':
      return {
        cover: (p) => (mouth(p) || p.z < 0.035 ? 0 : (1 - smooth(0.026, 0.034, Math.abs(p.x))) * smooth(1.562, 1.57, p.y) * (1 - smooth(1.636, 1.642, p.y))),
        thick: () => 0.006,
        colour: () => hair,
      };
    case 'moustache':
      return {
        cover: (p) => (p.z < 0.06 ? 0 : (1 - smooth(0.024, 0.032, Math.abs(p.x))) * smooth(1.626, 1.629, p.y) * (1 - smooth(1.638, 1.642, p.y))),
        thick: () => 0.0045,
        colour: () => hair,
      };
  }
  return null;
}

/** One layer as a mesh over the radius map: cells wherever it covers, with colours per vertex. */
function shell(map: RadiusMap, layer: Layer, front: number, out: { pos: number[]; col: number[]; idx: number[] }, extra = 0): void {
  const W = GRID_A + 1;
  const n = W * (GRID_E + 1);
  const lift = layer.lift ?? 0.0012;
  const covers = new Float32Array(n);
  const points: { q: THREE.Vector3; c: THREE.Color }[] = new Array(n);
  for (let ie = 0; ie <= GRID_E; ie++)
    for (let ia = 0; ia <= GRID_A; ia++) {
      const az = -Math.PI + (ia / GRID_A) * 2 * Math.PI;
      const e = E_MIN + (ie / GRID_E) * (E_MAX - E_MIN - 0.002);
      const d = dir(az, e);
      const r = radiusAt(map, az, e);
      const p = CENTRE.clone().addScaledVector(d, r);
      const cover = Math.max(0, layer.cover(p, az, e, r));
      covers[ie * W + ia] = cover;
      // Where it does not cover, the shell dips just under the skin: its edge is where it meets the
      // head, between the grid points, so it runs smoothly instead of in steps.
      const t = cover > 0 ? lift + extra + cover * Math.max(0, layer.thick(p, az, e, r) - lift) : -0.003;
      points[ie * W + ia] = { q: CENTRE.clone().addScaledVector(d, r + t), c: layer.colour(p) };
    }
  // Only the cells that it covers somewhere, and only the points they use.
  const ids = new Int32Array(n).fill(-1);
  const id = (k: number) => {
    if (ids[k] < 0) {
      ids[k] = out.pos.length / 3;
      const { q, c } = points[k];
      out.pos.push(q.x, q.y, q.z * front);
      out.col.push(c.r, c.g, c.b);
    }
    return ids[k];
  };
  for (let ie = 0; ie < GRID_E; ie++)
    for (let ia = 0; ia < GRID_A; ia++) {
      const k0 = ie * W + ia;
      const ks = [k0, k0 + 1, k0 + W + 1, k0 + W];
      if (!ks.some((k) => covers[k] > 0)) continue;
      const [a, b, c, d] = ks.map(id);
      // Wound so the outside faces out (flipped when his front is -z, as the mesh is mirrored).
      if (front > 0) out.idx.push(a, b, d, b, c, d);
      else out.idx.push(a, d, b, b, d, c);
    }
}

/** A ball of hair (a bun), as an icosphere with its colour. */
function knot(at: THREE.Vector3, radius: number, colour: THREE.Color, out: { pos: number[]; col: number[]; idx: number[] }): void {
  const g = new THREE.IcosahedronGeometry(radius, 2);
  const base = out.pos.length / 3;
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    out.pos.push(p.getX(i) + at.x, p.getY(i) * 0.9 + at.y, p.getZ(i) + at.z);
    out.col.push(colour.r, colour.g, colour.b);
  }
  // Icosahedron geometry is non-indexed: three vertices per face.
  for (let i = 0; i < p.count; i++) out.idx.push(base + i);
  g.dispose();
}

/**
 * The hair, beard and headband as one mesh in the model's bind-pose space (as the body's own
 * positions), or null for a bald, clean-shaven head with no headband.
 */
export function buildHair(body: THREE.BufferGeometry, front: number, look: HairLook): THREE.BufferGeometry | null {
  const map = radiusMap(body, front);
  const out = { pos: [] as number[], col: [] as number[], idx: [] as number[] };
  const parts: THREE.BufferGeometry[] = [];
  const hairColour = new THREE.Color(look.hair);
  // The pack's own mesh where it has the style; a shaved head is its buzz cut, half skin.
  const packHair = PACK_HAIR[look.hairstyle] ? packPart(PACK_HAIR[look.hairstyle]!, look.hairstyle === 'shaved' ? new THREE.Color(look.skin).lerp(hairColour, 0.55) : hairColour) : null;
  if (packHair) parts.push(packHair);
  const hair = packHair ? null : hairLayer(look, map);
  if (hair) shell(map, hair, front, out);
  const packBeard = PACK_BEARD[look.facialHair] ? packPart(PACK_BEARD[look.facialHair]!, hairColour) : null;
  if (packBeard) parts.push(packBeard);
  const beard = packBeard ? null : beardLayer(look);
  if (beard) shell(map, beard, front, out);
  if (look.hairstyle === 'bun' && !packHair) {
    const az = Math.PI;
    const e = 0.72;
    const r = radiusAt(map, az, e);
    const at = CENTRE.clone().addScaledVector(dir(az, e), r + 0.024);
    at.z *= front;
    knot(at, 0.033, new THREE.Color(look.hair), out);
  }
  if (look.headband) {
    // Round the forehead and over the hair, just above the brows.
    const band = new THREE.Color(look.headband);
    const over = packHair ? (PACK_HAIR_DEPTH[look.hairstyle] ?? 0.01) + 0.003 : hair ? 0.0045 : 0.003;
    shell(
      map,
      {
        cover: (p) => (onEar(p) ? 0 : smooth(1.735, 1.737, p.y) * (1 - smooth(1.758, 1.76, p.y))),
        thick: (p, az, e, r) => (hair ? hair.cover(p, az, e, r) * hair.thick(p, az, e, r) : 0) + over,
        colour: () => band,
        lift: 0.003,
      },
      front,
      out,
    );
  }
  if (out.idx.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(out.col, 3));
    g.setIndex(out.idx);
    g.computeVertexNormals();
    parts.push(g);
  }
  if (!parts.length) return null;
  // One mesh for the lot: one draw call per player.
  return parts.length === 1 ? parts[0] : mergeGeometries(parts);
}
