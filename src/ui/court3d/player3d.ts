// One player in 3D: a rigged low-poly body (Quaternius, CC0) driven by the match's Frame data. The
// legs come from animation clips, blended and played at the speed he actually moves, so his feet
// keep up with the ground; the arms are bent onto the ball where he has it (dribble, catch, shot,
// dunk) or up for a contest. Nothing here decides anything: it only shows what the frame says.

import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RIM_HEIGHT, type BallAction, type Frame } from '../court/animation';
import { SHOTS } from '../court/motion';
import type { FacialHair, Hairstyle } from '../looks';
import { buildHair } from './hair3d';

/** Court metres (x along, y across, z up) to the 3D scene (x along, y up, z across). */
export function toScene(x: number, y: number, z = 0): THREE.Vector3 {
  return new THREE.Vector3(x, z, y);
}

/** Each loop's ground speed and cycle, measured from the library's root-motion version (clips.json). */
export interface ClipInfo {
  duration: number;
  distance: number;
  speed: number;
}

/** What the ball does next and how soon (seconds): a shooter gathers for the shot before it starts. */
export interface Upcoming {
  action: BallAction;
  in: number;
}

/** The gather before a jump shot: this long before it, he picks the ball up and dips. */
const GATHER_S = 0.28;
/** ...and this long before a pass, he picks the ball up to his chest. */
const PASS_GATHER_S = 0.22;

export interface PlayerLook {
  heightM: number;
  /** Build: about 0.9 (wiry) to 1.2 (heavy), from looks.ts. */
  girth: number;
  skin: string;
  /** The hair colour (for the hair, the beard and a shaved head's shadow). */
  hair: string;
  /** From the player's appearance record (looks.ts), the same one his portrait is drawn from. */
  hairstyle: Hairstyle;
  facialHair: FacialHair;
  /** A headband, in the team colour, as on the 2D court. */
  headband?: boolean;
  jersey: string;
  /** The number's colour. */
  jerseyText: string;
  shorts: string;
  /** Shirt number, front and back; empty for an official. */
  number: string;
  /** An official: grey striped shirt, black trousers. */
  official?: boolean;
}

/** The shirt number, drawn once into a small texture the body shader reads. */
function numberTexture(n: string, fill: string, outline: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.font = '900 96px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = outline;
  g.strokeText(n, 64, 70);
  g.fillStyle = fill;
  g.fillText(n, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The Mixamo clips, retargeted onto our skeleton (public/3d/mixamo.json, built by
 * scripts/retarget-mixamo.mjs). The dribble ones carry their two moments in each bounce: the tops
 * (the hand meets the ball) and the lows (the lowest push point, where it lets go), clip times.
 */
interface MixamoClip {
  clip: THREE.AnimationClip;
  dribble?: { tops: number[]; lows: number[] };
  /** A loop's ground travel over one cycle (m; taken out of the clip, which runs on the spot). */
  travel?: number[];
}
const MIXAMO: Record<string, MixamoClip> = {};
export function setMixamoClips(data: { clips: Record<string, { duration: number; tracks: THREE.KeyframeTrackJSON[]; dribble?: { tops: number[]; lows: number[] }; travel?: number[] }> }): void {
  for (const [name, c] of Object.entries(data.clips)) MIXAMO[name] = { clip: THREE.AnimationClip.parse({ name, duration: c.duration, tracks: c.tracks, uuid: name, blendMode: THREE.NormalAnimationBlendMode }), dribble: c.dribble, travel: c.travel };
}

/** Dev: leaves a clip out (to draw the "before" of a change, e.g. ?dribble3d&noclip=DefendDribble). */
export function dropMixamoClip(name: string): void {
  delete MIXAMO[name];
}

/** A clip sampled directly (no mixer): it poses bones at a time, all or some of them, fully or partly. */
class ClipPose {
  private q: { bone: string; interp: THREE.Interpolant }[] = [];
  private p: { bone: string; interp: THREE.Interpolant }[] = [];
  constructor(readonly clip: THREE.AnimationClip) {
    for (const t of clip.tracks) {
      const [bone, prop] = t.name.split('.');
      (prop === 'quaternion' ? this.q : this.p).push({ bone, interp: t.createInterpolant() });
    }
  }
  /** Puts the clip's pose at `t` (looping) on `bones` that `only` allows, by `w` (1: all of it); `moveHips`: the pelvis' position too. */
  apply(bones: Record<string, THREE.Bone>, t: number, w: number, only?: (bone: string) => boolean, moveHips = false): void {
    if (w <= 0) return;
    const d = this.clip.duration;
    const tt = ((t % d) + d) % d;
    const q = new THREE.Quaternion();
    for (const { bone, interp } of this.q) {
      const b = bones[bone];
      if (!b || (only && !only(bone))) continue;
      q.fromArray(interp.evaluate(tt) as unknown as number[]);
      if (w >= 1) b.quaternion.copy(q);
      else b.quaternion.slerp(q, w);
    }
    if (!moveHips) return;
    const v = new THREE.Vector3();
    for (const { bone, interp } of this.p) {
      const b = bones[bone];
      if (!b || (only && !only(bone))) continue;
      v.fromArray(interp.evaluate(tt) as unknown as number[]);
      b.position.lerp(v, Math.min(1, w));
    }
  }
}

/** The bones of an arm, collarbone to fingertips: what the dribble clip moves on the move. */
const ARM_BONES = {
  l: (b: string) => b.endsWith('_l') && /^(clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/.test(b),
  r: (b: string) => b.endsWith('_r') && /^(clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/.test(b),
};
/** The chain that places the hand (for working out where the palm will be). */
const ARM_CHAIN = (s: 'l' | 'r') => [`clavicle_${s}`, `upperarm_${s}`, `lowerarm_${s}`, `hand_${s}`];

/** Below this he is standing (m/s, as he moves on screen). */
const STILL_M_S = 0.25;
/** How long a moving-speed reading is smoothed over (seconds): no jitter from one frame to the next. */
const SPEED_SMOOTH_S = 0.12;
/** Ball radius (m). */
export const BALL_R = 0.12;
/** Within this far of the ball, a player holding it has his hands on it. */
const HOLD_M = 0.75;
/** He turns his hips to where he is running and keeps his chest to where he faces, up to this much. */
const MAX_TWIST = (45 * Math.PI) / 180;
/** The library's crouch is a deep sneak; a defensive stance is at most this much of it over standing. */
const STANCE_CROUCH = 0.5;
/** Moving more than this far round from where he faces, he backpedals: the run played backwards. */
const BACKPEDAL = (115 * Math.PI) / 180;
/** A foot whose toes are this low is planted: it stays where it landed until the clip lifts it. */
const PLANT_Z = 0.045;
/** A planted foot lets go once the leg would have to stretch this far to keep it there. */
const LOCK_GIVE_M = 0.22;
/** How fast a lock comes on and off (per second): no snapping. */
const LOCK_RATE = 30;
/** A hand not doing anything: half open, never a clenched fist. */
const RELAXED_HAND = 0.55;
const FINGER = /^(index|middle|ring|pinky|thumb)_0[1-3]_([lr])$/;
/**
 * How much of each loop's leg swing to use. The library's jog covers 2.5 m a step and its sprint
 * 2.75 m, far longer than a basketball player's stride: the swing is cut back (blended with standing)
 * and the cycle run faster to match, so his steps are short and quick and his feet still keep pace
 * with the ground.
 */
const AMPLITUDE: Record<'walk' | 'jog' | 'sprint', number> = { walk: 1, jog: 0.6, sprint: 0.72 };
/** A wrist bends at most this far from the line of the forearm (radians): no stop-sign hands. */
const WRIST_MAX = (30 * Math.PI) / 180;
/** With the hand on the ball the wrist bends further, as a real one does (dribbling it is bent back about 45°). */
const WRIST_ON_BALL = (70 * Math.PI) / 180;
/** The palm's back from its face (m): the wrist sits this far behind the ball's surface. */
const PALM_THICK = 0.022;
/** Fingers cupped round the ball, each joint bent this much (radians); a relaxed hand a little more, but never a fist. */
const CUP = 0.26;
const RELAXED_CURL = 0.35;
/**
 * Proportions, measured on the model and set to NBA players' (wingspan about 1.03 of height; the
 * players the user gave range 0.95 to 1.08). The model as it comes measures 1.07, with long hands
 * (wrist to fingertip 0.128 of height; real about 0.11) and broad shoulders. So: the arms at their own
 * length, the hands a little smaller, the shoulder joints a little closer in and the upper arm a
 * little slimmer (thickness only). Result: wingspan 1.03 of his height.
 */
const UPPER_ARM_LENGTH = 1.0;
const FOREARM_LENGTH = 1.0;
const HAND_SCALE = 0.92;
/** The shoulder joint's offset from the collarbone, and the upper arm's thickness. */
const SHOULDER_IN = 0.9;
const UPPER_ARM_THICK = 0.9;
/** Physics of the ball (CLAUDE.md, Reference values). */
const GRAVITY = 9.81;
const RESTITUTION = 0.8;
/**
 * Dribble cycle, top of the bounce to top of the bounce (s): standing, and at a run (CLAUDE.md). The
 * dribble clip is played faster or slower to match (its own cycle is 0.7 s).
 */
const DRIBBLE_T = [0.75, 0.6];
/** The shortest push (s): the hand is on the ball at least this long, from the top to the lowest point. */
const DRIBBLE_PUSH_MIN_S = 0.1;
/**
 * Where the dribble hits the floor: out beside his dribbling-side foot (m from his middle), and ahead
 * of him, further the faster he goes (m, plus s of his speed): on the move the ball is pushed out in
 * front and he runs onto it, never into his own feet.
 */
const DRIBBLE_BOUNCE_OUT_M = 0.34;
const DRIBBLE_BOUNCE_AHEAD = [0.22, 0.07];
/**
 * On the move the dribbling arm is swung out at the shoulder by this much (radians): the clip's hand
 * works in front of his middle (a standing stance); moving, the ball goes outside the striding legs.
 */
const DRIBBLE_ARM_OUT = (32 * Math.PI) / 180;
/**
 * ...and lowered at the shoulder by this much (radians): the clip's arm is for a crouched stance, so
 * walking upright it would bounce the ball to his chest. Driving, his lean brings it down instead.
 */
const DRIBBLE_ARM_DOWN = (30 * Math.PI) / 180;
/** Within this long of the dribble ending, he catches the ball at the top instead of pushing it again (s). */
const DRIBBLE_CATCH_S = 0.75;
/** A dunker is this far in front of the rim's centre at the top of his jump: his hands are over it. */
const DUNK_FROM_RIM_M = 0.55;
/** After a dunk he hangs on the rim this long, then lets go. */
const DUNK_HANG_S = 0.45;
/**
 * Dribbling he stands nearly upright, knees soft; only driving (fast, at the basket) does he get
 * low and lean in. Crouch weight and forward lean (radians), dribbling and driving.
 */
const DRIBBLE_CROUCH = [0.08, 0.3];
const DRIBBLE_LEAN = [0.04, 0.2];
/** Dribbling faster than this (m/s) is a drive. */
const DRIVE_FROM = 3.2;
const DRIVE_FULL = 5.5;
/** Toes pointed down in the air (radians). */
const TOES_DOWN = 0.55;

type Loco = 'idle' | 'walk' | 'jog' | 'sprint';

/** What the rig is doing this frame, for the on-screen readout. */
export interface RigState {
  speed: number;
  mode: string;
  weights: Record<string, number>;
  arms: string;
}

const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** Turns `bone` (in world space) so the direction from it to `from` points at `to` instead. */
function aim(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3): void {
  const at = bone.getWorldPosition(new THREE.Vector3());
  const cur = from.clone().sub(at).normalize();
  const want = to.clone().sub(at).normalize();
  if (cur.lengthSq() < 1e-8 || want.lengthSq() < 1e-8) return;
  const turn = new THREE.Quaternion().setFromUnitVectors(cur, want);
  const world = bone.getWorldQuaternion(new THREE.Quaternion());
  const parent = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
  bone.quaternion.copy(parent.invert().multiply(turn.multiply(world)));
  bone.updateMatrixWorld(true);
}

/** Turns `bone` about a world axis. */
function turnWorld(bone: THREE.Bone, axis: THREE.Vector3, angle: number): void {
  const world = bone.getWorldQuaternion(q1);
  const parent = bone.parent ? bone.parent.getWorldQuaternion(q2) : q2.identity();
  const turned = new THREE.Quaternion().setFromAxisAngle(axis, angle).multiply(world);
  bone.quaternion.copy(parent.clone().invert().multiply(turned));
  bone.updateMatrixWorld(true);
}

interface Arm {
  upper: THREE.Bone;
  lower: THREE.Bone;
  hand: THREE.Bone;
  side: 1 | -1;
}

/**
 * Two-bone IK: bends the arm so the wrist reaches `target` (world), the elbow towards `pole`, and
 * blends that over the clip's pose by `weight`.
 */
function reach(arm: Arm, target: THREE.Vector3, pole: THREE.Vector3, weight: number): void {
  if (weight <= 0.001) return;
  const fkU = arm.upper.quaternion.clone();
  const fkL = arm.lower.quaternion.clone();
  const a = arm.upper.getWorldPosition(new THREE.Vector3());
  const b = arm.lower.getWorldPosition(new THREE.Vector3());
  const c = arm.hand.getWorldPosition(new THREE.Vector3());
  const l1 = a.distanceTo(b);
  const l2 = b.distanceTo(c);
  const toT = target.clone().sub(a);
  const d = Math.max(Math.abs(l1 - l2) + 0.01, Math.min(l1 + l2 - 0.005, toT.length()));
  const dir = toT.normalize();
  const t = a.clone().addScaledVector(dir, d);
  const cosA = Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  const bend = pole.clone().sub(a);
  bend.addScaledVector(dir, -bend.dot(dir));
  if (bend.lengthSq() < 1e-6) bend.set(0, -1, 0);
  bend.normalize();
  const elbow = a.clone().addScaledVector(dir, l1 * cosA).addScaledVector(bend, l1 * Math.sqrt(1 - cosA * cosA));
  aim(arm.upper, b, elbow);
  aim(arm.lower, arm.hand.getWorldPosition(new THREE.Vector3()), t);
  if (weight < 0.999) {
    arm.upper.quaternion.copy(fkU.slerp(arm.upper.quaternion.clone(), weight));
    arm.lower.quaternion.copy(fkL.slerp(arm.lower.quaternion.clone(), weight));
    arm.upper.updateMatrixWorld(true);
  }
}

/**
 * Flat-shaded colours by body region, picked from where each vertex sits in the bind pose: skin, a
 * basketball kit and shoes. The kit: a loose sleeveless jersey, its wide straps over the top of the
 * shoulders, trimmed at the neck and armholes, the number on the chest and back; loose shorts to just
 * above the knee, with a waistband and a hem. "Loose": the kit's surface stands off the body (pushed
 * out along the normal in the vertex shader, the shorts flaring to the hem), so it moves with him.
 * An official gets a grey shirt with black stripes and black trousers.
 */
/**
 * The jersey, by where a point sits in the bind pose (hy: height share, side: distance from the
 * middle, share of height; front: on his chest side). As in the reference: a loose tank top, hem at
 * the waist, just over the shorts' waistband (the shorts come up to the waist: the seat is in them), armholes cut to the chest, straps over the top of the
 * shoulders by the neck, a high scoop neck in front (just under the collarbones) and a high round
 * one at the back. 0 not the jersey, 1 the jersey, 2 its trim.
 */
const JERSEY_GLSL = `
// An official's shirt, as in the reference: short raglan sleeves to above the elbow, a crew neck,
// hem at the waist. (The bind pose is a T: the arms lie along x at shoulder height.)
bool refShirtBody(float hy, float side) { return hy > 0.585 && hy < 0.87 && side < 0.105 && !(side < 0.04 && hy > 0.838); }
bool refSleeve(float hy, float side) { return hy > 0.765 && hy < 0.865 && side >= 0.09 && side < 0.2; }
bool refTrousers(float hy, float side) { return hy > 0.06 && hy <= 0.6 && side < 0.12; }
// Shoes reach this high (share of height): high-tops, over the ankle.
const float SHOE_TOP = 0.088;
int jerseyAt(float hy, float side, bool front) {
  if (hy < 0.585 || hy > 0.865 || side > 0.105) return 0;
  // The neck: a high scoop in front, just under the collarbones; round at the back, at its base.
  bool scoop = front && side < 0.04 && hy > 0.83 + side * 0.3;
  bool neckHole = !front && side < 0.04 && hy > 0.845;
  if (scoop || neckHole) return 0;
  bool scoopTrim = front && side < 0.046 && hy > 0.823 + side * 0.3;
  bool backTrim = !front && side < 0.046 && hy > 0.838;
  // Body below the armholes; above them only the straps, by the neck.
  if (side > 0.08 && hy > 0.71) return 0;
  bool armTrim = (side > 0.072 && hy > 0.71) || (side > 0.08 && hy > 0.70);
  if (scoopTrim || backTrim || armTrim) return 2;
  return 1;
}`;

/** From this height (model metres, bind pose) up, the head and neck: smooth-shaded. */
const HEAD_FROM_Y = '1.565';

function bodyMaterial(look: PlayerLook, bounds: THREE.Box3, front: number): THREE.Material {
  // Faceted, except the head and neck: smooth, so the face reads as a face (see normal below).
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const h = bounds.max.y - bounds.min.y;
  const official = !!look.official;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSkin = { value: new THREE.Color(look.skin) };
    shader.uniforms.uJersey = { value: new THREE.Color(official ? '#d8d8d2' : look.jersey) };
    shader.uniforms.uShorts = { value: new THREE.Color(official ? '#1d1d1f' : look.shorts) };
    shader.uniforms.uTrim = { value: new THREE.Color(look.jerseyText || '#ffffff') };
    shader.uniforms.uFloor = { value: bounds.min.y };
    shader.uniforms.uHeight = { value: h };
    shader.uniforms.uFront = { value: front };
    shader.uniforms.uOfficial = { value: official ? 1 : 0 };
    shader.uniforms.uNumber = { value: look.number ? numberTexture(look.number, look.jerseyText, look.jersey) : null };
    shader.uniforms.uHasNumber = { value: look.number ? 1 : 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vBind;\nuniform float uFloor, uHeight, uOfficial, uFront;\n${JERSEY_GLSL}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vBind = position;
        {
          float hy = (position.y - uFloor) / uHeight;
          float side = abs(position.x) / uHeight;
          float puff = 0.0;
          vec3 outward = normalize(objectNormal);
          if (uOfficial > 0.5) {
            // Loose: the shirt off the body, the sleeves off the arm, the trousers straight-legged.
            if (refShirtBody(hy, side)) puff = 0.008;
            else if (refSleeve(hy, side)) puff = 0.007;
            else if (refTrousers(hy, side)) puff = 0.011 + 0.008 * clamp((0.32 - hy) / 0.2, 0.0, 1.0);
          } else if (jerseyAt(hy, side, position.z * uFront > 0.0) > 0) {
            // A loose tank top: off the chest, and more below it, so it hangs straight down to the hem
            // (sideways only, not up or down).
            vec3 level = vec3(objectNormal.x, 0.0, objectNormal.z);
            if (length(level) > 0.2) outward = normalize(level);
            puff = 0.008 + 0.004 * clamp((0.66 - hy) / 0.08, 0.0, 1.0);
          }
          // The shorts stand off the thighs, flaring towards the hem.
          if (uOfficial < 0.5 && hy > 0.32 && hy <= 0.6 && side < 0.12) puff = max(puff, 0.006 + 0.011 * clamp((0.46 - hy) / 0.14, 0.0, 1.0));
          // The bare foot goes in under the shoe (a mesh of its own on the foot bone).
          if (hy < SHOE_TOP) {
            outward = normalize(objectNormal);
            puff = -0.008;
          }
          transformed += outward * puff * uHeight;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vBind;\nuniform vec3 uSkin, uJersey, uShorts, uTrim;\nuniform float uFloor, uHeight, uFront, uOfficial, uHasNumber;\nuniform sampler2D uNumber;\n${JERSEY_GLSL}`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        // Flat-shaded below the neck (the low-poly look); the head and neck smooth.
        if (!(vBind.y > ${HEAD_FROM_Y} && abs(vBind.x) < 0.11)) normal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));`,
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `float hy = (vBind.y - uFloor) / uHeight;
        float side = abs(vBind.x) / uHeight;
        vec3 c = uSkin;
        bool neck = hy > 0.79 && side < 0.04;
        int jersey = uOfficial > 0.5 ? 0 : jerseyAt(hy, side, vBind.z * uFront > 0.0);
        bool official = uOfficial > 0.5 && (refShirtBody(hy, side) || refSleeve(hy, side));
        bool front = vBind.z * uFront > 0.0;
        float xs = vBind.x / uHeight;
        if (official) {
          // As in the reference: black raglan sleeves and side panels; front and back a grey panel
          // with thin white stripes; a red and blue crew collar; a whistle on a dark lanyard.
          // (Colours in linear light, as the shader works: sRGB #111 black, #9a9a9a grey.)
          c = vec3(0.006);
          if (refShirtBody(hy, side) && side < 0.072 && hy < 0.83) {
            c = vec3(0.32);
            float ax = abs(xs);
            if (abs(ax - 0.016) < 0.0018 || abs(ax - 0.047) < 0.0018) c = vec3(0.9);
          }
          if (refShirtBody(hy, side) && side < 0.05 && hy > 0.826) c = hy > 0.833 ? vec3(0.57, 0.013, 0.027) : vec3(0.022, 0.04, 0.32);
          if (front) {
            // The lanyard from the sides of the neck down to the whistle, a little left of the middle.
            float t = clamp((0.83 - hy) / 0.085, 0.0, 1.0);
            float lx = 0.008 + (0.032 - 0.008) * (1.0 - t);
            if (hy > 0.745 && hy < 0.83 && (abs(xs - lx) < 0.0016 || abs(xs + lx - 0.016) < 0.0016)) c = vec3(0.004);
            if (hy > 0.722 && hy < 0.746 && abs(xs - 0.008) < 0.006) c = vec3(0.5, 0.52, 0.55);
          }
        }
        if (jersey > 0 || official) {
          if (jersey > 0) c = uJersey;
          if (jersey == 2) c = uTrim;
          // The number: on the chest, bigger on the back.
          if (uHasNumber > 0.5 && (!official || !front)) {
            bool back = vBind.z * uFront < 0.0;
            float size = official ? 0.11 : back ? 0.15 : 0.1;
            float mid = official ? 0.735 : back ? 0.64 : 0.66;
            vec2 uv = vec2(0.5 + (back ? -1.0 : 1.0) * uFront * vBind.x / (uHeight * size), 0.5 + (hy - mid) / size);
            if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
              vec4 t = texture2D(uNumber, uv);
              c = mix(c, t.rgb, t.a);
            }
          }
        }
        else if (uOfficial > 0.5 && refTrousers(hy, side)) c = vec3(0.005);
        else if (uOfficial < 0.5 && hy > 0.32 && hy <= 0.6 && side < 0.12) {
          c = uShorts;
          // As in the reference: a stripe in the jersey's colour round the waistband (just under the
          // jersey's hem) and one above the hem of each leg.
          if (uOfficial < 0.5 && ((hy > 0.562 && hy < 0.574) || (hy > 0.334 && hy < 0.346))) c = uJersey;
        }
        else if (uOfficial < 0.5 && hy < SHOE_TOP) {
          // A white high-top, as in the reference: a dark rubber outsole and a grey midsole; the team
          // colour only on the heel counter, a stripe along the side and a thin collar; grey laces.
          float along = vBind.z * uFront / uHeight;      // heel negative, toes positive
          float off = abs(side - 0.063);                 // from the middle of the foot, across
          c = vec3(0.95);
          if (hy < 0.006) c = vec3(0.18);
          else if (hy < 0.017) c = vec3(0.82);
          else if (hy > SHOE_TOP - 0.006) c = uJersey;
          else if (along < -0.052 && hy < 0.06) c = uJersey;
          else if (hy > 0.032 && hy < 0.037 && along > -0.05 && along < 0.02) c = uJersey;
          else if (off < 0.009 && along > -0.035 && hy > 0.035 && hy < SHOE_TOP - 0.008) c = vec3(0.72);
        }
        else if (uOfficial < 0.5 && hy < 0.155) {
          // White crew socks, two stripes in the team colour.
          c = vec3(0.96);
          if ((hy > 0.124 && hy < 0.131) || (hy > 0.137 && hy < 0.144)) c = uJersey;
        }
        else if (hy < 0.06) c = vec3(0.08);
        // An official's black watch, on his left wrist.
        if (uOfficial > 0.5 && xs > 0.366 && xs < 0.384 && hy > 0.775 && hy < 0.835) c = vec3(0.003);
        vec4 diffuseColor = vec4( c, opacity );`,
      );
  };
  return m;
}

/**
 * What a player's body is set for: 'onBall' guarding the man with the ball (the full defensive
 * stance), 'ready' for a pass or loose ball in the air near him, 'rebound' near the rim with a shot
 * up, or 'none'.
 */
type Posture = 'onBall' | 'ready' | 'rebound' | 'none';

function postureFor(key: string, frame: Frame, action: BallAction | null, holder: string | null): Posture {
  const me = frame.players[key];
  if (!me || key.startsWith('ref')) return 'none';
  const side = key.slice(0, key.indexOf(':'));
  const ball = frame.ball;
  const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  if (holder && frame.players[holder] && action?.kind === 'held') {
    if (holder.startsWith(`${side}:`)) return 'none';
    // On the ball: the nearest of his side to the handler, and close to him.
    const h = frame.players[holder];
    const mine = d(me, h);
    if (mine > 3) return 'none';
    for (const [k, p] of Object.entries(frame.players)) if (k !== key && k.startsWith(`${side}:`) && d(p, h) < mine) return 'none';
    return 'onBall';
  }
  if (!action || holder) return 'none';
  // A jump shot or hook in the air: the bigs close to the rim box out (low, forearms up, hands at the
  // chest), ready for the rebound. Not for a layup or a dunk (there is no rebound to wait for), and
  // nobody reaches up yet: hands go up only for those the ball comes down near (frame.reach).
  if (action.kind === 'fromPlayer') {
    if (action.from === key || (action.style !== 'jumper' && action.style !== 'hook' && action.style !== 'set')) return 'none';
    return d(me, action.to) < 4 ? 'rebound' : 'none';
  }
  // A pass in the air: an opponent close to it, at a height he could catch or cut it off, gets
  // ready for it. Nothing for a ball dropping out of the net, rolling to the inbounder or loose on
  // the floor (a 'fixed' or 'toPlayer' ball): that is a dead ball, or one he just picks up.
  if (action.kind === 'pass' && action.from !== key && action.to !== key && !action.from.startsWith(`${side}:`)) {
    if (ball.z > 0.8 && ball.z < 2.6 && d(me, ball) < 3) return 'ready';
  }
  return 'none';
}

export class Player3D {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private bones: Record<string, THREE.Bone> = {};
  private arms: { l: Arm; r: Arm };
  private legs: { l: Arm; r: Arm };
  /** Where each planted foot is held (world), and how firmly. */
  private locks: Record<'l' | 'r', { at: THREE.Vector3 | null; w: number; yaw: number }> = { l: { at: null, w: 0, yaw: 0 }, r: { at: null, w: 0, yaw: 0 } };
  /** The model's own forward, as a yaw: added so he faces where the frame says. */
  private yawOffset = 0;
  private scale = 1;
  private last: THREE.Vector3 | null = null;
  private speed = 0;
  private moveDir = 0;
  private phase = 0;
  /** The crouched shuffle's own cycle: a shorter stride than any run. */
  private crouchPhase = 0;
  private facing = 0;
  private yaw = 0;
  /** How far through the release follow-through, once the ball has left his hands on a shot. */
  private released = 0;
  /** Where the ball is in his hands, when the pose places it (holding it, shooting it); null: where the frame has it. */
  private ballAt: THREE.Vector3 | null = null;
  /** Where the ball was last drawn, and how far it has blended back to the frame since he let it go. */
  private ballShown: THREE.Vector3 | null = null;
  private ballBack = 1;
  private stance = 0;
  /** What his body is set for this frame (see postureFor). */
  private posture: Posture = 'none';
  /** Each finger bone's bind (T-pose) rotation: straight fingers, an open hand. */
  private fingers: Record<'l' | 'r', { bone: THREE.Bone; open: THREE.Quaternion; axis: THREE.Vector3; thumb: boolean }[]> = { l: [], r: [] };
  /** How far each hand's fingers curl round (radians a joint): cupped on the ball, relaxed off it. */
  private curl = { l: RELAXED_CURL, r: RELAXED_CURL };
  /** How open each hand is this frame: 1 flat and open (on the ball, hands up), lower relaxed. */
  private open = { l: RELAXED_HAND, r: RELAXED_HAND };
  /** Each hand's palm and finger directions in its own bone space (from the T-pose: palms down, fingers out). */
  private palm: Record<'l' | 'r', { palm: THREE.Vector3; fingers: THREE.Vector3 }> = { l: { palm: new THREE.Vector3(), fingers: new THREE.Vector3() }, r: { palm: new THREE.Vector3(), fingers: new THREE.Vector3() } };
  /** From the wrist to the middle of the palm (m), measured on the model at its height. */
  private palmLen = 0.07;
  /** Knees bent ready to jump: the dip before a jump shot. */
  private dip = 0;
  /** The frame's ball last frame during a shot, to see the moment it leaves his hands. */
  private shotBall: THREE.Vector3 | null = null;
  /** Dribbling: how far into the lower, leaning posture (eases in and out). */
  private dribbling = 0;
  /**
   * Dribbling with the clip: the clip's clock (it only goes forward; the last frame's too, to see the
   * moments it passes), its speed, which hand, how much of each arm and of the whole body it moves,
   * and the ball. In the hand the ball is under the palm; let go at the lowest push point, it flies by
   * physics (gravity, one floor bounce at restitution 0.8) back up under the palm at the next top.
   */
  private dribT = 0;
  private dribPrevT = 0;
  private dribRate = 1;
  private dribSide: 'l' | 'r' = 'r';
  private dribArm = { l: 0, r: 0 };
  /** Standing: how much of him the clip moves, and how much of that is the right-handed clip. */
  private dribStand = 0;
  private dribRight = 1;
  /** How much he is moving, for the dribble (0 standing, 1 on the move): how far the arm is swung out; and how far it is lowered. */
  private dribMove = 0;
  private dribDown = 0;
  /**
   * Guarding the man with the ball: the defensive stance clip (Mixamo "defend dribbling"), its clock
   * and how much of it is on (eases in and out).
   */
  private defT = 0;
  private defW = 0;
  private defPose: ClipPose | null = null;
  private drib: {
    phase: 'contact' | 'flight' | 'held';
    pos: THREE.Vector3;
    /** In flight: where this stretch of it began (the release, then the bounce), its velocity then, and the time since. */
    from: THREE.Vector3;
    vel: THREE.Vector3;
    since: number;
    /** Down to the floor, then up to the top of the bounce: how long each takes (s). */
    down: number;
    up: number;
    bounced: boolean;
    /** The clip time of the top the hand comes back to. */
    backAt: number;
    /** How the last catch went: how far the ball was from the palm (m) and how fast it was still going up (m/s). */
    gap: number;
    rising: number;
  } | null = null;
  private dribPoses: Record<string, ClipPose> = {};
  /** The head's forward, in the head bone's own space. */
  private headFwd = new THREE.Vector3(0, 0, 1);
  /** A dunker carried to the rim: the offset from where the frame has him, and how much of it. */
  private dunkOff = new THREE.Vector3();
  private dunkW = 0;
  /** His ground velocity and acceleration (scene x/z), for aiming the dribble. */
  private vel = new THREE.Vector3();
  private acc = new THREE.Vector3();
  /** Hanging on the rim after a dunk: how much (1 while his hands are on it, easing to 0 as he drops). */
  private hangW = 0;
  /** The rim he is dunking on (and his line to it), kept after the shot ends so he can hang on it; and for how long he has. */
  private dunkRim: { rim: THREE.Vector3; toRim: THREE.Vector3; across: THREE.Vector3 } | null = null;
  private hangT = 0;
  /** His shoulder's height above his feet and his arm's reach (shoulder to palm), measured as he is drawn. */
  private shoulderUp = 1.5;
  private armReach = 0.8;
  /** A held ball being taken up from wherever it was: blended in over a moment. */
  private heldBefore = false;
  private blendIn = 1;
  private blendFrom: THREE.Vector3 | null = null;
  state: RigState = { speed: 0, mode: '', weights: {}, arms: '' };

  constructor(character: GLTF, clips: THREE.AnimationClip[], private info: Record<string, ClipInfo>, look: PlayerLook) {
    const model = SkeletonUtils.clone(character.scene) as THREE.Object3D;
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones[o.name] = o as THREE.Bone;
    });
    // Which way is his front in the mesh's own space: from the heel to the toes.
    const body = (() => {
      let found: THREE.SkinnedMesh | null = null;
      model.traverse((o) => {
        const sm = o as THREE.SkinnedMesh;
        // The body itself: the skinned mesh with the most vertices (the others are the eyes and brows).
        if (sm.isSkinnedMesh && (!found || sm.geometry.getAttribute('position').count > (found as THREE.SkinnedMesh).geometry.getAttribute('position').count)) found = sm;
      });
      return found as THREE.SkinnedMesh | null;
    })();
    const toeLocal = body ? body.worldToLocal(this.bones.ball_l.getWorldPosition(new THREE.Vector3())) : new THREE.Vector3(0, 0, 1);
    const heelLocal = body ? body.worldToLocal(this.bones.foot_l.getWorldPosition(new THREE.Vector3())) : new THREE.Vector3();
    const front = Math.sign(toeLocal.z - heelLocal.z) || 1;
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones[o.name] = o as THREE.Bone;
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      const name = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name;
      // The model's own brows are left out: the head is skin, hair and two small dark eyes.
      if (name === 'MI_Hair_1') mesh.visible = false;
      else mesh.material = name === 'MI_Eyes' ? new THREE.MeshBasicMaterial({ color: 0x141010 }) : bodyMaterial(look, bounds, front);
    });
    // As tall as the player is.
    this.scale = look.heightM / (bounds.max.y - bounds.min.y);
    // Heavier players a little wider, never taller (half the build's difference: a full one made
    // heavy players' arms and shoulders look swollen).
    const girth = 1 + (Math.max(0.9, Math.min(1.2, look.girth)) - 1) * 0.5;
    model.scale.set(this.scale * girth, this.scale, this.scale * girth);
    model.position.y = -bounds.min.y * this.scale;
    this.root.add(model);
    // Which way the model faces: from the heel to the toes.
    const heel = this.bones.foot_l.getWorldPosition(new THREE.Vector3());
    const toe = this.bones.ball_l.getWorldPosition(new THREE.Vector3());
    this.yawOffset = -Math.atan2(toe.x - heel.x, toe.z - heel.z);

    for (const side of ['l', 'r'] as const) {
      const hand = this.bones[`hand_${side}`];
      const inv = hand.getWorldQuaternion(new THREE.Quaternion()).invert();
      const fingers = this.bones[`middle_01_${side}`].getWorldPosition(new THREE.Vector3()).sub(hand.getWorldPosition(new THREE.Vector3())).normalize();
      this.palm[side] = { palm: new THREE.Vector3(0, -1, 0).applyQuaternion(inv), fingers: fingers.applyQuaternion(inv) };
    }
    for (const [name, bone] of Object.entries(this.bones)) {
      const f = FINGER.exec(name);
      if (!f) continue;
      const side = f[2] as 'l' | 'r';
      // Bending a finger turns it about the line across the hand (fingers x palm normal), towards the palm.
      const hand = this.bones[`hand_${side}`];
      const along = this.bones[`middle_01_${side}`].getWorldPosition(new THREE.Vector3()).sub(hand.getWorldPosition(new THREE.Vector3())).normalize();
      const axis = new THREE.Vector3().crossVectors(along, new THREE.Vector3(0, -1, 0)).normalize();
      axis.applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()).invert());
      this.fingers[side].push({ bone, open: bone.quaternion.clone(), axis, thumb: f[1] === 'thumb' });
    }
    // Longer arms, along their length only: the skin of the upper arm and forearm is stretched
    // along the bone (not scaled up), and the elbow and wrist joints are moved out to match (each
    // frame, after the clips have posed them).
    /** k along the bone, `thick` across it. */
    const stretchAlong = (axis: THREE.Vector3, k: number, thick = 1) => {
      const a = axis.clone().normalize();
      const m = new THREE.Matrix4();
      const e = (i: number, j: number) => (i === j ? thick : 0) + (k - thick) * [a.x, a.y, a.z][i] * [a.x, a.y, a.z][j];
      m.set(e(0, 0), e(0, 1), e(0, 2), 0, e(1, 0), e(1, 1), e(1, 2), 0, e(2, 0), e(2, 1), e(2, 2), 0, 0, 0, 0, 1);
      return m;
    };
    const stretch = new Map<THREE.Bone, THREE.Matrix4>();
    for (const sd of ['l', 'r'] as const) {
      stretch.set(this.bones[`upperarm_${sd}`], stretchAlong(this.bones[`lowerarm_${sd}`].position, UPPER_ARM_LENGTH, UPPER_ARM_THICK));
      stretch.set(this.bones[`lowerarm_${sd}`], stretchAlong(this.bones[`hand_${sd}`].position, FOREARM_LENGTH));
    }
    model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      const sk = mesh.skeleton;
      const inverses = sk.bones.map((bone, i) => (stretch.has(bone) ? stretch.get(bone)!.clone().multiply(sk.boneInverses[i]) : sk.boneInverses[i]));
      const offset = new THREE.Matrix4();
      sk.update = function () {
        for (let i = 0; i < this.bones.length; i++) {
          offset.multiplyMatrices(this.bones[i].matrixWorld, inverses[i]);
          offset.toArray(this.boneMatrices, i * 16);
        }
        if (this.boneTexture) this.boneTexture.needsUpdate = true;
      };
    });
    // Which way the head faces, in its own bone space: the body's front at the bind pose.
    {
      const front3 = new THREE.Vector3(toe.x - heel.x, 0, toe.z - heel.z).normalize();
      this.headFwd = front3.applyQuaternion(this.bones.Head.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
    }
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of clips) {
      const a = this.mixer.clipAction(clip);
      a.play();
      a.setEffectiveWeight(0);
      this.actions[clip.name] = a;
    }
    // The middle of the palm: a little past half way from the wrist to the knuckles.
    this.palmLen = this.bones.hand_r.getWorldPosition(new THREE.Vector3()).distanceTo(this.bones.middle_01_r.getWorldPosition(new THREE.Vector3())) * 0.6 * HAND_SCALE;
    const arm = (s: 'l' | 'r', side: 1 | -1): Arm => ({ upper: this.bones[`upperarm_${s}`], lower: this.bones[`lowerarm_${s}`], hand: this.bones[`hand_${s}`], side });
    this.arms = { l: arm('l', -1), r: arm('r', 1) };
    const leg = (s: 'l' | 'r', side: 1 | -1): Arm => ({ upper: this.bones[`thigh_${s}`], lower: this.bones[`calf_${s}`], hand: this.bones[`foot_${s}`], side });
    this.legs = { l: leg('l', -1), r: leg('r', 1) };
    this.buildShoes(look);
    // Hair, beard and headband: real meshes, rigid on the head bone, built over the head's own shape
    // in the bind pose (the body's positions) and carried into the bone's space.
    if (body) {
      const hair = buildHair(body.geometry, front, {
        hairstyle: look.hairstyle,
        facialHair: look.facialHair,
        hair: look.hair,
        skin: look.skin,
        headband: look.headband && !look.official ? look.jersey : null,
      });
      const i = body.skeleton.bones.findIndex((b) => b.name === 'Head');
      if (hair && i >= 0) {
        hair.applyMatrix4(body.skeleton.boneInverses[i].clone().multiply(body.bindMatrix));
        const mesh = new THREE.Mesh(hair, new THREE.MeshLambertMaterial({ vertexColors: true }));
        mesh.castShadow = true;
        body.skeleton.bones[i].add(mesh);
      }
    }
  }

  /**
   * Basketball shoes, as in the reference: a white high-top on a rubber sole, a solid rounded toe, the
   * collar over the ankle, the heel counter and a stripe along each side in the team colour, grey
   * laces. Rigid, on the foot bone, sized from his own foot (made in the bind pose); the bare foot is
   * pulled in under it (bodyMaterial). An official's are black.
   */
  private buildShoes(look: PlayerLook): void {
    this.root.updateMatrixWorld(true);
    const white = look.official ? 0x1a1a1a : 0xf2f2f2;
    const accent = look.official ? 0x333333 : new THREE.Color(look.jersey).getHex();
    const mat = (c: number) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    for (const sd of ['l', 'r'] as const) {
      const foot = this.bones[`foot_${sd}`];
      const ankle = foot.getWorldPosition(new THREE.Vector3());
      const ball = this.bones[`ball_${sd}`].getWorldPosition(new THREE.Vector3());
      // His size: the model's ankle to the ball of his foot, and his height.
      const k = ankle.y / 0.11;
      const along = ball.clone().sub(ankle).setY(0).normalize();
      const heelZ = -0.075 * k;
      const toeZ = ball.clone().sub(ankle).setY(0).length() + 0.09 * k;
      const len = toeZ - heelZ;
      const wide = 0.118 * k;
      const shoe = new THREE.Group();
      // Built along +z from the ankle (x across, y up), then turned to his foot.
      const part = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number) => {
        const m = new THREE.Mesh(geo, mat(color));
        m.position.set(x, y, z);
        m.castShadow = true;
        shoe.add(m);
        return m;
      };
      const mid = (heelZ + toeZ) / 2;
      /** A capsule lying along the foot (z), `h` high, `w` wide, `l` long, its bottom at `y0`. */
      const pod = (w: number, h: number, l: number, y0: number, color: number, z = mid) => {
        const m = part(new THREE.CapsuleGeometry(w / 2, Math.max(0.001, l - w), 4, 16), color, 0, y0 + h / 2, z);
        m.rotation.x = Math.PI / 2;
        m.scale.set(1, 1, h / w);
        return m;
      };
      // The sole: the shoe's own outline, a dark rubber outsole under a grey midsole.
      pod(wide + 0.012 * k, 0.014 * k, len + 0.012 * k, 0, 0x2a2a2a);
      pod(wide + 0.01 * k, 0.022 * k, len + 0.008 * k, 0.012 * k, look.official ? 0x222222 : 0xd4d4d4);
      // The upper: a solid rounded toe box and instep...
      pod(wide, 0.085 * k, len, 0.026 * k, white);
      // ...rising into the high-top round the ankle, padded at the collar.
      const ankleZ = heelZ + 0.07 * k;
      part(new THREE.CylinderGeometry(0.058 * k, 0.066 * k, 0.15 * k, 16), white, 0, 0.105 * k, ankleZ);
      const collar = part(new THREE.TorusGeometry(0.056 * k, 0.011 * k, 8, 18), accent, 0, 0.18 * k, ankleZ);
      collar.rotation.x = Math.PI / 2;
      // The heel counter wraps round the back, in the team colour.
      const counter = part(new THREE.CylinderGeometry(0.068 * k, 0.07 * k, 0.085 * k, 16, 1, true, Math.PI * 0.6, Math.PI * 0.8), accent, 0, 0.07 * k, ankleZ);
      (counter.material as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
      // The tongue and instep, sloping from the top of the ankle down to the toe box, laced.
      const top = new THREE.Vector3(0, 0.155 * k, ankleZ + 0.03 * k);
      const low = new THREE.Vector3(0, 0.085 * k, mid + len * 0.22);
      const slope = low.clone().sub(top);
      const instep = part(new THREE.CapsuleGeometry(0.04 * k, slope.length(), 4, 12), white, 0, (top.y + low.y) / 2, (top.z + low.z) / 2);
      instep.rotation.x = Math.atan2(slope.z, slope.y);
      instep.scale.set(wide / (0.08 * k) * 0.85, 1, 0.75);
      const laces = part(new THREE.BoxGeometry(0.026 * k, slope.length() * 0.9, 0.008 * k), look.official ? 0x444444 : 0xb8b8b8, 0, (top.y + low.y) / 2 + 0.024 * k, (top.z + low.z) / 2 + 0.012 * k);
      laces.rotation.x = Math.atan2(slope.z, slope.y);
      // A stripe along each side.
      for (const side of [-1, 1]) part(new THREE.BoxGeometry(0.006 * k, 0.014 * k, len * 0.5), accent, side * (wide / 2 + 0.001 * k), 0.06 * k, mid + 0.03 * k);
      // One mesh per shoe (one draw call, not a dozen): the parts merged, each in its own colour.
      const merged = mergeGeometries(
        shoe.children.map((child) => {
          const m = child as THREE.Mesh;
          m.updateMatrix();
          const g = m.geometry.clone().applyMatrix4(m.matrix);
          g.deleteAttribute('uv');
          const col = (m.material as THREE.MeshLambertMaterial).color;
          const n = g.getAttribute('position').count;
          const c = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) col.toArray(c, i * 3);
          g.setAttribute('color', new THREE.BufferAttribute(c, 3));
          return g.index ? g.toNonIndexed() : g;
        }),
      )!;
      shoe.clear();
      const one = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
      one.castShadow = true;
      shoe.add(one);
      // Placed under his ankle on the floor, pointing along his foot.
      shoe.position.set(ankle.x, 0, ankle.z);
      shoe.rotation.y = Math.atan2(along.x, along.z);
      this.root.add(shoe);
      shoe.updateMatrixWorld(true);
      foot.attach(shoe);
    }
  }

  /**
   * Shows him as the frame has him. `dt`: match seconds since the last call (the rig plays at match
   * time, so slow motion slows his legs too).
   */
  update(key: string, frame: Frame, action: BallAction | null, holder: string | null, dt: number, next: Upcoming | null = null): void {
    const p = frame.players[key];
    if (!p || dt <= 0) return;
    const at = toScene(p.x, p.y);
    // How fast he is going, and which way: from where the frame has put him.
    if (this.last) {
      const dx = at.x - this.last.x;
      const dz = at.z - this.last.z;
      const now = Math.hypot(dx, dz) / dt;
      const k = 1 - Math.exp(-dt / SPEED_SMOOTH_S);
      this.speed += (now - this.speed) * k;
      if (now > STILL_M_S) this.moveDir = Math.atan2(dz, dx);
      // His velocity as it is now (barely smoothed), and how fast it is changing: the dribble aims the
      // ball at where he will really be, speeding up or slowing down.
      const kv = 1 - Math.exp(-dt / 0.08);
      const vx = this.vel.x + (dx / dt - this.vel.x) * kv;
      const vz = this.vel.z + (dz / dt - this.vel.z) * kv;
      const ka = 1 - Math.exp(-dt / 0.2);
      this.acc.x += ((vx - this.vel.x) / dt - this.acc.x) * ka;
      this.acc.z += ((vz - this.vel.z) / dt - this.acc.z) * ka;
      this.vel.set(vx, 0, vz);
    }
    this.last = at.clone();
    this.facing = frame.facing?.[key] ?? this.facing;
    // Shooting, he is square to the basket from the gather until he lands, whatever the frame's facing.
    const shot = frame.shooter === key && action?.kind === 'fromPlayer' && action.from === key && action.style !== 'throw' ? action : null;
    // 1 Gather: just before a jump shot he picks the ball up and dips, already square to the basket.
    const coming =
      !shot && holder === key && next && next.in < GATHER_S && next.action.kind === 'fromPlayer' && next.action.from === key && (next.action.style === 'jumper' || next.action.style === 'hook') ? next.action : null;
    const aim = shot ?? coming;
    if (aim) this.facing = Math.atan2(aim.to.y - p.y, aim.to.x - p.x);
    const lift = frame.lift?.[key] ?? 0;
    // How he stands depends on what the ball is doing (frame.stance only says how low he may go):
    // guarding the man with the ball, the full stance (low, arms out); with the ball in the air near
    // him, ready for it (a pass to catch or cut off) or for the rebound (a shot); otherwise at most a
    // light crouch.
    this.posture = postureFor(key, frame, action, holder);
    const stance = this.posture === 'onBall' ? frame.stance?.[key] ?? 0 : this.posture === 'ready' || this.posture === 'rebound' ? 0.3 : Math.min(0.35, frame.stance?.[key] ?? 0);
    // A dunk: the frame has him take off short of the rim, so he is carried in to it as he rises,
    // until his hands are over it at the top; after the dunk the offset eases away as he lands.
    if (shot && shot.style === 'dunk') {
      const rim = toScene(shot.to.x, shot.to.y);
      const toward = rim.clone().sub(at).setY(0);
      const dist = toward.length();
      if (dist > DUNK_FROM_RIM_M) {
        toward.normalize();
        this.dunkOff.copy(rim).addScaledVector(toward, -DUNK_FROM_RIM_M).sub(at).setY(0);
      } else this.dunkOff.set(0, 0, 0);
      const rising = Math.min(1, lift / (SHOTS.dunk.jump * 0.8));
      this.dunkW = Math.max(this.dunkW, this.released > 0 ? 1 : rising * rising * (3 - 2 * rising));
    } else if (!(this.dunkRim && this.hangT < DUNK_HANG_S)) this.dunkW = Math.max(0, this.dunkW - dt / 0.6);
    // Through the rim he hangs on it (the frame has him already coming down when the ball gets there):
    // held up with his hands on the rim, arms nearly straight, then he lets go and drops.
    if (this.dunkRim && this.hangT > 0 && this.hangT < DUNK_HANG_S) this.hangW = 1;
    else this.hangW = Math.max(0, this.hangW - dt / 0.3);
    const hangLift = RIM_HEIGHT + 0.02 - this.armReach * 0.85 - this.shoulderUp;
    const shown = lift + Math.max(0, hangLift - lift) * this.hangW * this.hangW * (3 - 2 * this.hangW);
    this.root.position.set(at.x + this.dunkOff.x * this.dunkW, shown, at.z + this.dunkOff.z * this.dunkW);

    // Hips to where he runs, chest to where he faces; running away from his facing: a backpedal.
    const moving = this.speed > STILL_M_S && lift < 0.04 && !aim;
    let off = moving ? angleDiff(this.facing, this.moveDir) : 0;
    let backwards = false;
    if (Math.abs(off) > BACKPEDAL) {
      backwards = true;
      off = 0;
    }
    const twist = Math.max(-MAX_TWIST, Math.min(MAX_TWIST, off));
    // Court angle (from +x towards +y) to a yaw about the scene's up axis.
    const hips = moving && !backwards ? this.facing + twist : this.facing;
    this.yaw = -hips + Math.PI / 2;
    this.root.rotation.y = this.yaw + this.yawOffset;

    // Legs: idle, walk, jog and sprint blended by speed; the cycle advances by the ground covered.
    const w = locoWeights(this.speed, this.info);
    // Hands up (a contest, a closeout, a rebound) he stands tall: the crouch goes as they go up.
    const handsUp = frame.reach?.[key] ?? 0;
    const crouch = Math.min(1, stance * 1.15) * STANCE_CROUCH * (1 - Math.min(1, handsUp * 1.4));
    this.stance = stance;
    const air = lift > 0.04 ? Math.min(1, lift / 0.25) : 0;
    const stride = (['walk', 'jog', 'sprint'] as const).reduce((s, l) => s + w[l] * AMPLITUDE[l] * this.info[CLIP[l]].distance, 0);
    if (stride > 0) this.phase = (this.phase + ((backwards ? -1 : 1) * this.speed * dt) / stride + 1) % 1;
    this.crouchPhase = (this.crouchPhase + ((backwards ? -1 : 1) * this.speed * dt) / this.info.Crouch_Fwd_Loop.distance + 1) % 1;
    const weights: Record<string, number> = {};
    // Shorter steps: part of each loop's swing, the rest standing.
    let standing = w.idle;
    for (const l of ['walk', 'jog', 'sprint'] as const) {
      weights[CLIP[l]] = w[l] * AMPLITUDE[l];
      standing += w[l] * (1 - AMPLITUDE[l]);
    }
    weights[CLIP.idle] = standing;
    // The dip before a jump shot: knees bent, on the floor.
    const shooter = frame.shooter === key && action?.kind === 'fromPlayer' && action.from === key && action.style !== 'throw' && action.style !== 'set';
    const jumper = (shooter && action?.kind === 'fromPlayer' && (action.style === 'jumper' || action.style === 'hook')) || !!coming;
    this.dip = jumper && lift < 0.05 && this.released === 0 ? Math.min(1, this.dip + dt / 0.12) : Math.max(0, this.dip - dt / 0.1);
    const dribbles = holder === key && action?.kind === 'held' && action.dribble;
    this.dribbling = Math.max(0, Math.min(1, this.dribbling + (dribbles ? 1 : -1) * dt * 5));
    const drive = Math.max(0, Math.min(1, (this.speed - DRIVE_FROM) / (DRIVE_FULL - DRIVE_FROM)));
    const low = Math.max(crouch, this.dip * 0.4, this.dribbling * (DRIBBLE_CROUCH[0] + (DRIBBLE_CROUCH[1] - DRIBBLE_CROUCH[0]) * drive));
    for (const k of Object.keys(weights)) weights[k] *= (1 - low) * (1 - air);
    const crouchClip = this.speed > 0.6 && this.dip === 0 && this.dribbling === 0 ? 'Crouch_Fwd_Loop' : 'Crouch_Idle_Loop';
    weights.Crouch_Fwd_Loop = crouchClip === 'Crouch_Fwd_Loop' ? low * (1 - air) : 0;
    weights.Crouch_Idle_Loop = crouchClip === 'Crouch_Idle_Loop' ? low * (1 - air) : 0;
    // In the air: a jump shooter, or a man going up for the ball with his hands up (a tip-off, a
    // rebound), rises straight, his legs long and together; anyone else tucks a little.
    const reaching = !jumper && !shooter && handsUp > 0.3;
    const straight = jumper || reaching;
    weights.Jump_Loop = air * (straight ? 0 : 0.6);
    weights[CLIP.idle] = (weights[CLIP.idle] ?? 0) + air * (straight ? 1 : 0.4);
    for (const [name, a] of Object.entries(this.actions)) {
      a.setEffectiveWeight(weights[name] ?? 0);
      a.timeScale = 0;
      const info = this.info[name];
      // The locomotion loops share one phase, so their footfalls line up as they blend.
      if (name in LOOP_PHASE) a.time = this.phase * info.duration;
      else if (name === 'Crouch_Fwd_Loop') a.time = this.crouchPhase * info.duration;
      else a.time = (a.time + dt) % (info?.duration || a.getClip().duration);
    }
    this.mixer.update(0);
    // Dribbling: the dribble clip. Standing it moves all of him (crouch, sway, the other arm guarding);
    // on the move only the dribbling arm, over the legs' loops. Its clock runs at the speed the ball sets
    // (dribbleBall): the push quick, the hand rising to the top just as the ball does.
    const dribbleClip = MIXAMO.Dribble?.dribble ? MIXAMO.Dribble : null;
    let moveK = 1;
    if (dribbleClip) {
      if (dribbles && !this.drib) {
        // A new dribble starts at a top, the ball in his hand.
        this.dribT = this.dribPrevT = dribbleClip.dribble!.tops[0];
      }
      this.dribPrevT = this.dribT;
      if (dribbles && this.drib?.phase !== 'held') this.dribT += dt * this.dribRate;
      for (const sd of ['l', 'r'] as const) this.dribArm[sd] = Math.max(0, Math.min(1, this.dribArm[sd] + ((dribbles && this.dribSide === sd ? 1 : -1) * dt) / 0.12));
      moveK = Math.max(0, Math.min(1, (this.speed - 0.3) / 0.9));
      this.dribStand = this.dribbling * (1 - moveK) * (1 - air);
      this.dribRight = Math.max(0, Math.min(1, this.dribRight + ((this.dribSide === 'r' ? 1 : -1) * dt) / 0.25));
      if (this.dribStand > 0) {
        this.dribPose('l').apply(this.bones, this.dribT, this.dribStand, undefined, true);
        this.dribPose('r').apply(this.bones, this.dribT, this.dribStand * this.dribRight, undefined, true);
      }
      for (const sd of ['l', 'r'] as const) if (this.dribArm[sd] > 0) this.dribPose(sd).apply(this.bones, this.dribT, this.dribArm[sd], ARM_BONES[sd]);
    }
    // Guarding the ball handler: the defensive stance clip, low, feet wide, hands working at the ball.
    // Standing it moves all of him; sliding with the dribbler only his arms and upper body, over the
    // legs' loops (so his feet stay planted). Hands up (a contest, a closeout) it gives way.
    if (MIXAMO.DefendDribble) {
      const onBall = this.posture === 'onBall' && handsUp <= 0.02 && air === 0;
      this.defW = Math.max(0, Math.min(1, this.defW + ((onBall ? 1 : -1) * dt) / 0.2));
      const w = this.defW * Math.min(1, stance * 1.3);
      if (w > 0) {
        this.defT += dt;
        const pose = (this.defPose ??= new ClipPose(MIXAMO.DefendDribble.clip));
        const sliding = Math.max(0, Math.min(1, (this.speed - 0.3) / 0.9));
        pose.apply(this.bones, this.defT, w * (1 - sliding), undefined, true);
        pose.apply(this.bones, this.defT, w * sliding, (b) => ARM_BONES.l(b) || ARM_BONES.r(b) || /^(spine_0[123]|neck_01)$/.test(b));
      }
    }
    // Longer arms: the clips set the joints' positions every frame, so the elbow and wrist are moved
    // out again each time (the skin stretches to them, see the skeleton above).
    for (const sd of ['l', 'r'] as const) {
      this.bones[`lowerarm_${sd}`].position.multiplyScalar(UPPER_ARM_LENGTH);
      this.bones[`hand_${sd}`].position.multiplyScalar(FOREARM_LENGTH);
      this.bones[`upperarm_${sd}`].position.multiplyScalar(SHOULDER_IN);
      this.bones[`hand_${sd}`].scale.multiplyScalar(HAND_SCALE);
    }
    this.root.updateMatrixWorld(true);

    // Square him up. The clips stand him at an angle of their own (the idle turns the chest away),
    // so the hips are turned to where he runs and the chest to where he faces, measured from the
    // pose itself: across the hips (thigh to thigh) and across the shoulders.
    this.square(['pelvis'], 'thigh_l', 'thigh_r', hips);
    this.square(['spine_01', 'spine_02', 'spine_03'], 'upperarm_l', 'upperarm_r', this.facing);
    // Dribbling he leans in over the ball, more on the move; the head stays up.
    if (this.dribbling > 0) {
      const driving = Math.max(0, Math.min(1, (this.speed - DRIVE_FROM) / (DRIVE_FULL - DRIVE_FROM)));
      // (Standing, the clip has its own lean.)
      const lean = this.dribbling * moveK * (DRIBBLE_LEAN[0] + (DRIBBLE_LEAN[1] - DRIBBLE_LEAN[0]) * driving);
      const across = new THREE.Vector3().crossVectors(new THREE.Vector3(Math.cos(this.facing), 0, Math.sin(this.facing)), UP).normalize();
      turnWorld(this.bones.spine_01, across, -lean * 0.5);
      turnWorld(this.bones.spine_02, across, -lean * 0.5);
      turnWorld(this.bones.neck_01, across, lean * 0.7);
    }

    // On the move, the dribbling arm swung out to his side.
    this.dribMove = moveK;
    this.dribDown = moveK * (1 - drive);
    for (const sd of ['l', 'r'] as const) this.dribbleArmOut(sd, this.dribArm[sd] * moveK, this.dribArm[sd] * this.dribDown);
    this.plantFeet(air > 0, dt);
    // Going up for the ball, his legs hang straight under him, feet together (a hand's width apart),
    // not in the standing clip's stance.
    if (reaching && air > 0) {
      const hl = this.legs.l.upper.getWorldPosition(new THREE.Vector3());
      const hr = this.legs.r.upper.getWorldPosition(new THREE.Vector3());
      const mid = hl.clone().add(hr).multiplyScalar(0.5);
      const across = hr.clone().sub(hl).setY(0).normalize();
      const front = new THREE.Vector3().crossVectors(UP, across).normalize();
      for (const leg of [this.legs.l, this.legs.r]) {
        const hip = leg.upper.getWorldPosition(new THREE.Vector3());
        const knee = leg.lower.getWorldPosition(new THREE.Vector3());
        const len = hip.distanceTo(knee) + knee.distanceTo(leg.hand.getWorldPosition(new THREE.Vector3()));
        const foot = mid.clone().addScaledVector(across, leg.side * 0.07).addScaledVector(front, 0.04).add(new THREE.Vector3(0, -len * 0.97, 0));
        reach(leg, foot, knee.clone().addScaledVector(front, 0.5), air);
      }
    }
    // Toes pointed down in the air.
    if (air > 0) {
      const side = new THREE.Vector3().crossVectors(new THREE.Vector3(Math.cos(this.facing), 0, Math.sin(this.facing)), UP).normalize();
      for (const f of ['foot_l', 'foot_r']) turnWorld(this.bones[f], side, -TOES_DOWN * air);
    }
    this.open = { l: RELAXED_HAND, r: RELAXED_HAND };
    this.curl = { l: RELAXED_CURL, r: RELAXED_CURL };
    // Just before a pass he picks the ball up into both hands at the chest, to pass it from there.
    const passSoon = holder === key && !!next && next.in < PASS_GATHER_S && next.action.kind === 'pass' && next.action.from === key;
    this.arms3d(key, frame, action, holder, lift, dt, coming, passSoon, next);
    this.openHands();
    // The head: level and to the ball (as the frame has it turned); a shooter or dunker looks at the
    // rim, from the gather to the landing.
    {
      const headAt = this.bones.Head.getWorldPosition(new THREE.Vector3());
      let toward: THREE.Vector3;
      if (aim) toward = toScene(aim.to.x, aim.to.y, aim.to.z ?? RIM_HEIGHT).sub(headAt);
      else if ((reaching && air > 0) || this.posture === 'ready' || this.posture === 'rebound') toward = toScene(frame.ball.x, frame.ball.y, frame.ball.z).sub(headAt);
      else {
        const l = frame.look?.[key] ?? this.facing;
        toward = new THREE.Vector3(Math.cos(l), 0, Math.sin(l));
      }
      this.lookTowards(toward);
    }
    this.state = {
      speed: this.speed,
      mode: `${backwards ? 'backpedal ' : ''}${air > 0 ? `air ${lift.toFixed(2)} m ` : ''}${crouch > 0.05 ? `stance ${stance.toFixed(2)} ` : ''}${Math.abs(twist) > 0.2 ? `twist ${Math.round((twist * 180) / Math.PI)}°` : ''}`,
      weights: Object.fromEntries(Object.entries(weights).filter(([, x]) => x > 0.01)),
      arms: this.state.arms,
    };
  }

  /**
   * Foot locking: a foot that comes down stays where it landed, the leg bending to keep it there,
   * until the clip lifts it (or the leg would have to stretch too far). The clips are played at his
   * speed, but he turns and speeds up and slows down faster than a cycle can follow: without this
   * the planted foot skates.
   */
  private plantFeet(airborne: boolean, dt: number): void {
    const fwd = new THREE.Vector3(Math.cos(this.facing), 0, Math.sin(this.facing));
    const toes = { l: this.bones.ball_l.getWorldPosition(new THREE.Vector3()).y, r: this.bones.ball_r.getWorldPosition(new THREE.Vector3()).y };
    for (const side of ['l', 'r'] as const) {
      const leg = this.legs[side];
      const lock = this.locks[side];
      const ankle = leg.hand.getWorldPosition(new THREE.Vector3());
      const toe = this.bones[`ball_${side}`].getWorldPosition(new THREE.Vector3());
      // Running, one foot at a time is on the floor: the lower one. (A swinging foot passes low too.)
      const other = toes[side === 'l' ? 'r' : 'l'];
      const down = !airborne && toe.y < PLANT_Z && (this.speed < 1.2 || toe.y <= other + 0.004);
      // Held at the ball of the foot, where it touches: the heel can still come up off the floor.
      if (down && !lock.at) {
        lock.at = toe.clone();
        lock.yaw = this.root.rotation.y;
      }
      // The foot keeps the direction it landed in: the body turning above it does not twist it.
      const turn = new THREE.Quaternion().setFromAxisAngle(UP, (lock.yaw - this.root.rotation.y) * lock.w);
      const heel = toe.clone().sub(ankle).applyQuaternion(turn);
      const target = lock.at ? new THREE.Vector3(lock.at.x - heel.x, ankle.y, lock.at.z - heel.z) : ankle;
      const strain = Math.hypot(target.x - ankle.x, target.z - ankle.z);
      const hold = down && strain < LOCK_GIVE_M;
      lock.w = Math.max(0, Math.min(1, lock.w + (hold ? 1 : -1) * LOCK_RATE * dt));
      if (!down && lock.w === 0) lock.at = null;
      if (!lock.at || lock.w <= 0) continue;
      const knee = leg.lower.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 0.6);
      const footQ = turn.clone().multiply(leg.hand.getWorldQuaternion(new THREE.Quaternion()));
      reach(leg, target, knee, lock.w);
      // ...and its angle to the floor, whatever the shin does.
      const parent = leg.hand.parent!.getWorldQuaternion(new THREE.Quaternion());
      leg.hand.quaternion.copy(parent.invert().multiply(footQ));
      leg.hand.updateMatrixWorld(true);
    }
  }

  /**
   * Turns `bones` (shared equally) about the vertical so the line from `leftJoint` to `rightJoint`
   * is square to `angle` (court angle: he faces that way). At most 70° in all.
   */
  private square(bones: string[], leftJoint: string, rightJoint: string, angle: number): void {
    const l = this.bones[leftJoint].getWorldPosition(new THREE.Vector3());
    const r = this.bones[rightJoint].getWorldPosition(new THREE.Vector3());
    // Facing is a quarter turn from left-to-right: left to right runs along -90° from his front.
    const now = Math.atan2(r.z - l.z, r.x - l.x) - Math.PI / 2;
    const off = Math.max(-1.22, Math.min(1.22, angleDiff(now, angle)));
    if (Math.abs(off) < 0.01) return;
    // A turn about +y lowers the court angle: turn by minus what is missing.
    for (const b of bones) turnWorld(this.bones[b], UP, -off / bones.length);
  }

  /**
   * Dev (the clip turntable, ?clips3d): stands him in a Mixamo clip's pose at time `t` and nothing else
   * (no loops, no feet planted, no arms placed), at `at` on the floor.
   */
  showClip(name: string, t: number, at: THREE.Vector3): void {
    for (const a of Object.values(this.actions)) a.setEffectiveWeight(0);
    this.mixer.update(0);
    new ClipPose(MIXAMO[name].clip).apply(this.bones, t, 1, undefined, true);
    for (const sd of ['l', 'r'] as const) {
      this.bones[`lowerarm_${sd}`].position.multiplyScalar(UPPER_ARM_LENGTH);
      this.bones[`hand_${sd}`].position.multiplyScalar(FOREARM_LENGTH);
      this.bones[`upperarm_${sd}`].position.multiplyScalar(SHOULDER_IN);
      this.bones[`hand_${sd}`].scale.setScalar(HAND_SCALE);
    }
    this.root.position.copy(at);
    this.root.rotation.y = 0;
    this.root.updateMatrixWorld(true);
  }

  /** Dev: the dribble as it stands: phase, the ball, and how the last catch went. */
  get dribbleInfo(): { phase: string; ball: THREE.Vector3; gap: number; rising: number; side: 'l' | 'r' } | null {
    return this.drib ? { phase: this.drib.phase, ball: this.drib.pos.clone(), gap: this.drib.gap, rising: this.drib.rising, side: this.dribSide } : null;
  }

  /** Dev: a bone's place in the world. */
  boneAt(name: string): THREE.Vector3 {
    return this.bones[name].getWorldPosition(new THREE.Vector3());
  }

  /** Dev: a Mixamo clip's length and what it carries (ground travel for a loop, dribble moments). */
  static clipInfo(name: string): { duration: number; dribble?: { tops: number[]; lows: number[] }; travel?: number[] } | null {
    const c = MIXAMO[name];
    return c ? { duration: c.clip.duration, dribble: c.dribble, travel: c.travel } : null;
  }

  /** The dribble clip for a hand (the left one is the clip mirrored). */
  private dribPose(side: 'l' | 'r'): ClipPose {
    const name = side === 'r' ? 'Dribble' : 'Dribble_L';
    return (this.dribPoses[name] ??= new ClipPose(MIXAMO[name].clip));
  }

  /** The dribbling arm swung out to his side at the shoulder (`out` of DRIBBLE_ARM_OUT) and lowered (`down` of DRIBBLE_ARM_DOWN). */
  private dribbleArmOut(side: 'l' | 'r', out: number, down: number): void {
    const upper = this.bones[`upperarm_${side}`];
    if (out > 0) turnWorld(upper, UP, (side === 'r' ? -1 : 1) * DRIBBLE_ARM_OUT * out);
    if (down > 0) {
      // Square to where the arm points (seen from above): the hand comes straight down.
      const toHand = this.bones[`hand_${side}`].getWorldPosition(new THREE.Vector3()).sub(upper.getWorldPosition(new THREE.Vector3())).setY(0);
      if (toHand.lengthSq() > 1e-4) turnWorld(upper, new THREE.Vector3().crossVectors(toHand.normalize(), UP).normalize(), -DRIBBLE_ARM_DOWN * down);
    }
  }

  /** Where the ball is when it is under a hand's palm (its centre). */
  private ballInPalm(side: 'l' | 'r'): THREE.Vector3 {
    const p = this.palmInfo(side);
    return p.centre.addScaledVector(p.normal, BALL_R);
  }

  /** Where the ball will be under the palm at clip time `t` (the arm posed then, the body as it is now). */
  private ballInPalmAt(side: 'l' | 'r', t: number): THREE.Vector3 {
    const chain = ARM_CHAIN(side);
    const saved = chain.map((b) => this.bones[b].quaternion.clone());
    this.dribPose(side).apply(this.bones, t, 1, (b) => chain.includes(b));
    this.bones[chain[0]].updateMatrixWorld(true);
    this.dribbleArmOut(side, this.dribMove, this.dribDown);
    const at = this.ballInPalm(side);
    chain.forEach((b, i) => this.bones[b].quaternion.copy(saved[i]));
    this.bones[chain[0]].updateMatrixWorld(true);
    return at;
  }

  /**
   * A bounce that peaks at `top` (ball centre, m): the speed down at `from` (m) that does it, and how
   * long it takes to the floor and back up to the top (s). Restitution 0.8: the ball comes up at 0.8
   * of the speed it hits the floor with.
   */
  private static bounce(from: number, top: number): { speed: number; down: number; up: number } {
    const hit = Math.sqrt(2 * GRAVITY * Math.max(0.01, top - BALL_R)) / RESTITUTION;
    const speed = Math.sqrt(Math.max(0, hit * hit - 2 * GRAVITY * Math.max(0, from - BALL_R)));
    return { speed, down: (hit - speed) / GRAVITY, up: (RESTITUTION * hit) / GRAVITY };
  }

  /** Where the ball is to meet the palm at clip time `t`, `later` seconds from now (he moves on meanwhile). */
  private meetAt(t: number, later: number): THREE.Vector3 {
    const accel = this.acc.clone().clampLength(0, 8);
    const tt = Math.min(later, 0.6);
    return this.ballInPalmAt(this.dribSide, t).addScaledVector(this.vel, later).addScaledVector(accel, 0.5 * tt * tt);
  }

  /**
   * The dribbled ball, by physics, in time with the dribble clip (CLAUDE.md: the hand meets it at the
   * top of the bounce; it never sticks to the hand nor turns in the air).
   *
   * In contact (from a top to the lowest push point) it is under the palm and the clip pushes it down.
   * At the lowest point it is let go, down at the speed that, with gravity and one bounce off the floor
   * (restitution 0.8), brings it up to a peak just under where the palm is at the clip's next top. The
   * clip's rise is played so the hand gets to that top as the ball peaks, and the push quick enough
   * that the whole bounce takes the cycle for his speed (0.75 s standing, 0.6 s running). Across, it
   * goes straight at where the palm will be; at the bounce (where it changes direction anyway) it is
   * aimed again at where the palm will then really be. `want`: the hand the frame has the ball on (a
   * crossover changes hands at a release); `ending`: catch it at the next top and hold it.
   */
  private dribbleBall(want: 'l' | 'r', ending: boolean, dt: number): NonNullable<Player3D['drib']> {
    const clip = MIXAMO.Dribble;
    const ev = clip.dribble!;
    const D = clip.clip.duration;
    /** Whether the clock passed `e` (looping) since its last reading. */
    const passed = (e: number) => {
      const k = Math.floor((this.dribPrevT - e) / D) + 1;
      return e + k * D <= this.dribT + 1e-9;
    };
    /** The first of `times` (looping) after clip time `t`, as a time on the clock. */
    const after = (times: number[], t: number) => Math.min(...times.map((e) => e + (Math.floor((t - e) / D) + 1) * D));
    const run = Math.max(0, Math.min(1, (this.speed - 1) / 3.5));
    const cycle = DRIBBLE_T[0] + (DRIBBLE_T[1] - DRIBBLE_T[0]) * run;
    /** From a top: the push takes what the cycle leaves after the flight, at least DRIBBLE_PUSH_MIN_S. */
    const startPush = () => {
      const low = after(ev.lows, this.dribT);
      const top = after(ev.tops, low);
      const b = Player3D.bounce(this.ballInPalmAt(this.dribSide, low).y, this.ballInPalmAt(this.dribSide, top).y);
      this.dribRate = (low - this.dribT) / Math.max(DRIBBLE_PUSH_MIN_S, cycle - b.down - b.up);
    };
    if (!this.drib) {
      const pos = this.ballInPalm(this.dribSide);
      this.drib = { phase: ending ? 'held' : 'contact', pos, from: pos.clone(), vel: new THREE.Vector3(), since: 0, down: 0, up: 0, bounced: false, backAt: 0, gap: 0, rising: 0 };
      startPush();
    }
    const d = this.drib;
    if (d.phase === 'flight') {
      d.since += dt;
      if (!d.bounced && d.since >= d.down) {
        // The floor: up at 0.8 of the speed it came down with, and aimed again at where the palm will be
        // at the top, which is now only the rise away. The clip's rise is timed to it.
        const hitAt = d.from.clone().addScaledVector(d.vel, d.down);
        hitAt.y = BALL_R;
        const hitSpeed = -(d.vel.y - GRAVITY * d.down);
        const upSpeed = RESTITUTION * hitSpeed;
        const up = upSpeed / GRAVITY;
        const to = this.meetAt(d.backAt, up);
        d.since -= d.down;
        d.from = hitAt;
        d.vel.set((to.x - hitAt.x) / up, upSpeed, (to.z - hitAt.z) / up);
        d.up = up;
        d.bounced = true;
        this.dribRate = Math.max(0.05, (d.backAt - this.dribT) / Math.max(0.02, up - d.since));
      }
      const t = d.since;
      d.pos = d.from.clone().addScaledVector(d.vel, t);
      d.pos.y = Math.max(BALL_R, d.from.y + d.vel.y * t - 0.5 * GRAVITY * t * t);
      if (ev.tops.some(passed)) {
        // The top: the hand meets it.
        const there = this.ballInPalm(this.dribSide);
        d.gap = d.pos.distanceTo(there);
        d.rising = d.vel.y - GRAVITY * t;
        d.phase = ending ? 'held' : 'contact';
        d.pos = there;
        startPush();
      }
      return d;
    }
    d.pos = this.ballInPalm(this.dribSide);
    if (d.phase === 'held') {
      if (!ending) {
        d.phase = 'contact';
        startPush();
      }
      return d;
    }
    if (ev.lows.some(passed)) {
      // The lowest push point: let go. A crossover: the other hand takes it at the next top.
      this.dribSide = want;
      const back = after(ev.tops, this.dribT);
      const from = d.pos.clone();
      // Down so that it peaks at the palm's height at the top (worked out from where the palm will be).
      let b = Player3D.bounce(from.y, this.ballInPalmAt(this.dribSide, back).y);
      const to = this.meetAt(back, b.down + b.up);
      b = Player3D.bounce(from.y, to.y);
      const T = b.down + b.up;
      // Across: to the floor out beside his foot and ahead of him (where he will be when it lands), then
      // from there to the palm (aimed at the bounce).
      const hips = Math.PI / 2 - this.yaw;
      const bF = new THREE.Vector3(Math.cos(hips), 0, Math.sin(hips));
      const bR = new THREE.Vector3().crossVectors(bF, UP).normalize();
      const accel = this.acc.clone().clampLength(0, 8);
      const spot = this.root.position
        .clone()
        .addScaledVector(this.vel, b.down)
        .addScaledVector(accel, 0.5 * b.down * b.down)
        .addScaledVector(bF, DRIBBLE_BOUNCE_AHEAD[0] + DRIBBLE_BOUNCE_AHEAD[1] * this.speed)
        .addScaledVector(bR, (this.dribSide === 'r' ? 1 : -1) * DRIBBLE_BOUNCE_OUT_M);
      d.phase = 'flight';
      d.from = from;
      d.vel.set((spot.x - from.x) / b.down, -b.speed, (spot.z - from.z) / b.down);
      d.since = 0;
      d.down = b.down;
      d.up = b.up;
      d.bounced = false;
      d.backAt = back;
      this.dribRate = (back - this.dribT) / T;
    }
    return d;
  }

  /** Turns the head (and a little the neck) to look along `dir`, at most 75° from where it was. */
  private lookTowards(dir: THREE.Vector3): void {
    const head = this.bones.Head;
    const cur = this.headFwd.clone().applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const want = dir.clone().normalize();
    const angle = Math.min(cur.angleTo(want), (75 * Math.PI) / 180);
    if (angle < 0.01) return;
    const axis = new THREE.Vector3().crossVectors(cur, want);
    if (axis.lengthSq() < 1e-8) return;
    axis.normalize();
    turnWorld(this.bones.neck_01, axis, angle * 0.4);
    turnWorld(head, axis, angle * 0.6);
  }

  /** Which way he faces (court angle), for a dev camera. */
  get facingAngle(): number {
    return this.facing;
  }

  /** Which way his hips (his body) point: court angle. Running, that is the way he runs. */
  get heading(): number {
    return Math.PI / 2 - this.yaw;
  }

  /** Fingers out of the clip's fist towards straight: an open hand on the ball, a relaxed one otherwise. */
  private openHands(): void {
    for (const side of ['l', 'r'] as const) {
      const k = this.open[side];
      const curl = this.curl[side];
      for (const f of this.fingers[side]) {
        const cupped = f.open.clone().multiply(new THREE.Quaternion().setFromAxisAngle(f.axis, curl * (f.thumb ? 0.4 : 1)));
        f.bone.quaternion.slerp(cupped, k);
      }
    }
    this.root.updateMatrixWorld(true);
  }

  /**
   * Where to draw the ball: in his hands while the pose holds it, then easing back onto the frame's
   * path over about 0.15 s once it has left them.
   */
  ball(frameBall: THREE.Vector3, dt: number): THREE.Vector3 {
    if (this.ballAt) {
      // Taken up from wherever it was (not snapped into the hands): blended in over a moment.
      if (!this.heldBefore) {
        this.blendFrom = (this.ballShown ?? frameBall).clone();
        this.blendIn = this.drib ? 1 : 0;
      }
      this.heldBefore = true;
      this.blendIn = Math.min(1, this.blendIn + dt / 0.15);
      const k = this.blendIn * this.blendIn * (3 - 2 * this.blendIn);
      this.ballShown = this.blendFrom && k < 1 ? this.blendFrom.clone().lerp(this.ballAt, k) : this.ballAt.clone();
      this.ballBack = 0;
      return this.ballShown;
    }
    this.heldBefore = false;
    // Dunked: slammed down through the rim the moment his hands go to it (the frame's ball lags,
    // still over the rim), falling with gravity until the frame's own ball is lower.
    if (this.dunkRim && this.hangT > 0) {
      const r = this.dunkRim.rim;
      const t = this.hangT;
      const y = r.y + 0.05 - 2 * t - 0.5 * GRAVITY * t * t;
      if (Math.hypot(frameBall.x - r.x, frameBall.z - r.z) < 0.8 && y < frameBall.y && y > BALL_R) {
        this.ballShown = new THREE.Vector3(r.x, y, r.z);
        this.ballBack = 0;
        return this.ballShown;
      }
    }
    if (this.ballShown && this.ballBack < 1) {
      this.ballBack = Math.min(1, this.ballBack + dt / 0.15);
      const k = this.ballBack * this.ballBack * (3 - 2 * this.ballBack);
      return this.ballShown.clone().lerp(frameBall, k);
    }
    return frameBall;
  }

  /**
   * Where a hand's palm actually is, from its bones as posed: the middle of the palm's face, the way
   * the palm faces, and the way the fingers point.
   */
  palmInfo(side: 'l' | 'r'): { centre: THREE.Vector3; normal: THREE.Vector3; fingers: THREE.Vector3 } {
    const hand = this.bones[`hand_${side}`];
    const q = hand.getWorldQuaternion(new THREE.Quaternion());
    const normal = this.palm[side].palm.clone().applyQuaternion(q).normalize();
    const fingers = this.palm[side].fingers.clone().applyQuaternion(q).normalize();
    const centre = hand.getWorldPosition(new THREE.Vector3()).addScaledVector(fingers, this.palmLen).addScaledVector(normal, PALM_THICK);
    return { centre, normal, fingers };
  }

  /**
   * Turns a hand so its palm faces `palm` and its fingers point along `fingers` (world directions),
   * blended over what it had by `w`.
   */
  private orient(side: 'l' | 'r', palm: THREE.Vector3, fingers: THREE.Vector3, w = 1, maxBend = WRIST_MAX): void {
    const hand = this.bones[`hand_${side}`];
    let F = fingers.clone().normalize();
    // A wrist only bends so far: the fingers stay within WRIST_MAX of the forearm's line.
    const forearm = hand.getWorldPosition(new THREE.Vector3()).sub(hand.parent!.getWorldPosition(new THREE.Vector3())).normalize();
    const bend = F.angleTo(forearm);
    if (bend > maxBend) {
      const axis = new THREE.Vector3().crossVectors(forearm, F);
      if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0).cross(forearm);
      F = forearm.clone().applyAxisAngle(axis.normalize(), maxBend);
    }
    const N = palm.clone().addScaledVector(F, -palm.dot(F)).normalize();
    if (N.lengthSq() < 0.5) return;
    const B = new THREE.Vector3().crossVectors(F, N);
    const f = this.palm[side].fingers.clone();
    const n = this.palm[side].palm.clone().addScaledVector(f, -this.palm[side].palm.dot(f)).normalize();
    const b = new THREE.Vector3().crossVectors(f, n);
    const world = new THREE.Matrix4().makeBasis(F, N, B).multiply(new THREE.Matrix4().makeBasis(f, n, b).transpose());
    const q = new THREE.Quaternion().setFromRotationMatrix(world);
    const parent = hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    hand.quaternion.slerp(parent.multiply(q), w);
    hand.updateMatrixWorld(true);
  }

  /** The arms: on the ball when he has it, up for a contest, follow-through after a shot. */
  private arms3d(key: string, frame: Frame, frameAction: BallAction | null, holder: string | null, lift: number, dt: number, coming: Extract<BallAction, { kind: 'fromPlayer' }> | null = null, passSoon = false, next: Upcoming | null = null): void {
    let dribbling = false;
    // Gathering for a shot that is about to start counts as the shot's first stage.
    const action: BallAction | null = coming ?? frameAction;
    const ball = toScene(frame.ball.x, frame.ball.y, frame.ball.z);
    const shoulderL = this.arms.l.upper.getWorldPosition(new THREE.Vector3());
    const shoulderR = this.arms.r.upper.getWorldPosition(new THREE.Vector3());
    const chest = shoulderL.clone().add(shoulderR).multiplyScalar(0.5);
    this.shoulderUp = chest.y - this.root.position.y;
    const fwd = new THREE.Vector3(Math.cos(this.facing), 0, Math.sin(this.facing));
    const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const shooting = !!coming || (frame.shooter === key && action?.kind === 'fromPlayer' && action.from === key);
    const style = shooting && action?.kind === 'fromPlayer' ? action.style : null;
    const has = holder === key;
    const near = ball.distanceTo(chest) < HOLD_M + 0.6;
    const dir = (v: THREE.Vector3) => v.clone().normalize();
    // Elbows: down, out and back for a low reach; forward and out for one over the head.
    const pole = (arm: Arm, target?: THREE.Vector3) => {
      const sh = arm.upper.getWorldPosition(new THREE.Vector3());
      const high = target ? Math.max(0, Math.min(1, (target.y - sh.y + 0.1) / 0.4)) : 0;
      return sh
        .addScaledVector(UP, -1 + high * 0.8)
        .addScaledVector(right, arm.side * 0.6)
        .addScaledVector(fwd, -0.4 + high * 1.1);
    };
    const reachTo = (arm: Arm, target: THREE.Vector3, w: number, elbow?: THREE.Vector3) => reach(arm, target, elbow ?? pole(arm, target), w);
    const sideOf = (arm: Arm): 'l' | 'r' => (arm === this.arms.l ? 'l' : 'r');
    /**
     * The palm, not the wrist, on the ball: the middle of the palm at the point of the ball's surface
     * in direction `onSide` from its centre, facing in, fingers along `fingers`. (The palm's middle is
     * a hand's breadth on from the wrist; placing the wrist there leaves the ball between the wrists.)
     */
    const palmOn = (arm: Arm, centre: THREE.Vector3, onSide: THREE.Vector3, fingers: THREE.Vector3, w = 1, elbow?: THREE.Vector3) => {
      const out = dir(onSide);
      const contact = centre.clone().addScaledVector(out, BALL_R);
      const palm = out.clone().negate();
      const F = fingers.clone().addScaledVector(palm, -fingers.dot(palm)).normalize();
      const wrist = contact.clone().addScaledVector(F, -this.palmLen).addScaledVector(palm, -PALM_THICK);
      const side = sideOf(arm);
      // Place it, see where the palm really ended up (the wrist limit and the arm's reach can move
      // it), and move the wrist by the difference: three times is within a few millimetres.
      for (let i = 0; i < 3; i++) {
        reachTo(arm, wrist, w, elbow);
        this.orient(side, palm, F, w, WRIST_ON_BALL);
        if (w < 1) break;
        const miss = contact.clone().sub(this.palmInfo(side).centre);
        if (miss.lengthSq() < 0.005 * 0.005) break;
        wrist.add(miss);
      }
    };
    /** Where the ball sits against a hand's palm, as the hand really is. */
    const onPalm = (side: 'l' | 'r') => {
      const p = this.palmInfo(side);
      return p.centre.addScaledVector(p.normal, BALL_R);
    };
    /** Between two palms: the ball held in both hands. */
    const betweenPalms = () => onPalm('l').add(onPalm('r')).multiplyScalar(0.5);
    /** Both palms on the ball's sides and a little behind it, fingers forward and up: how a ball is held. */
    const twoHands = (at: THREE.Vector3, w = 1, facing = fwd) => {
      const across = new THREE.Vector3().crossVectors(facing, UP).normalize();
      for (const arm of [this.arms.l, this.arms.r]) {
        palmOn(arm, at, across.clone().multiplyScalar(arm.side * 0.92).addScaledVector(facing, -0.38), facing.clone().multiplyScalar(0.7).add(new THREE.Vector3(0, 0.7, 0)), w);
      }
      return betweenPalms();
    };
    let arms = '';
    this.ballAt = null;
    // On the ball: fully out of the clip's fist and cupped round the ball.
    const openBoth = () => {
      this.open = { l: 1, r: 1 };
      this.curl = { l: CUP, r: CUP };
    };
    /** Through the rim: both hands on the front of the rim, palms on its top, as long as his arms reach
     *  it; then they let go and come down with him. Runs on after the shot itself has ended. */
    const hangOnRim = (): string => {
      const { rim, toRim, across } = this.dunkRim!;
      this.hangT += dt;
      this.open = { l: 1, r: 1 };
      this.curl = { l: CUP, r: CUP };
      let onRim = 0;
      for (const arm of [this.arms.l, this.arms.r]) {
        const grip = rim.clone().addScaledVector(toRim, -0.2).addScaledVector(across, arm.side * 0.13).add(new THREE.Vector3(0, 0.02, 0));
        const shoulder = arm.upper.getWorldPosition(new THREE.Vector3());
        const elbow = arm.lower.getWorldPosition(new THREE.Vector3());
        const armLen = shoulder.distanceTo(elbow) + elbow.distanceTo(arm.hand.getWorldPosition(new THREE.Vector3())) + this.palmLen;
        this.armReach = armLen;
        this.shoulderUp = shoulder.y - this.root.position.y;
        if (this.hangT < DUNK_HANG_S && shoulder.distanceTo(grip) < armLen * 0.98) {
          onRim++;
          palmOn(arm, grip.clone().add(new THREE.Vector3(0, -BALL_R, 0)), up.clone(), toRim.clone());
        }
        // Let go: his arms come down by his sides as the clip has them (not aimed back at the rim).
      }
      if (this.hangT > DUNK_HANG_S + 0.6) this.dunkRim = null;
      return onRim ? `dunk: hands on the rim (${onRim})` : 'dunk: let go, coming down';
    };
    if (shooting && style !== 'throw' && action?.kind === 'fromPlayer') {
      // The ball in his hands, placed by the pose (the frame keeps it on his centre line, which in
      // 3D is inside his head). Once the frame's ball has left him, it follows the frame.
      const head = this.bones.Head.getWorldPosition(new THREE.Vector3());
      const rim = toScene(action.to.x, action.to.y, action.to.z);
      const toRim = rim.clone().sub(head).setY(0);
      if (toRim.lengthSq() < 1e-4) toRim.copy(fwd);
      toRim.normalize();
      const across = new THREE.Vector3().crossVectors(toRim, UP).normalize();
      const away = Math.hypot(ball.x - this.root.position.x, ball.z - this.root.position.z);
      // Gone the moment it leaves his hands: moving away from him fast (or already well clear).
      const prev = this.shotBall ?? ball;
      const awayPrev = Math.hypot(prev.x - this.root.position.x, prev.z - this.root.position.z);
      const leaving = dt > 0 && (away - awayPrev) / dt > 2.5;
      this.shotBall = ball.clone();
      // A dunk is carried to the rim: it is let go only there. Anything else: the moment it leaves the hands.
      const atRim = Math.hypot(ball.x - rim.x, ball.z - rim.z) < 0.5 && ball.y > rim.y - 0.4;
      const gone = !coming && (this.released > 0 || (style === 'dunk' ? atRim : leaving || away > 0.8 || ball.y > head.y + 1));
      openBoth();
      const gather = chest.clone().addScaledVector(toRim, 0.38).add(new THREE.Vector3(0, -0.22, 0));
      if (!gone) {
        // Rising, the ball goes from the chest to where he lets it go.
        const rise = Math.min(1, lift / 0.25);
        if (style === 'dunk') {
          // Both hands on the ball all the way up: on its sides, over the top towards the rim.
          arms = rise < 1 ? 'dunk: taking it up in both hands' : 'dunk: both hands on the ball at the rim';
          // As high as both hands can hold it: arms stretched, the ball still between the palms.
          const at = gather.clone().lerp(head.clone().addScaledVector(toRim, 0.34).add(new THREE.Vector3(0, 0.5, 0)), rise);
          this.ballAt = at;
          for (const arm of [this.arms.l, this.arms.r]) {
            palmOn(arm, at, across.clone().multiplyScalar(arm.side).addScaledVector(toRim, -0.35).add(new THREE.Vector3(0, 0.15, 0)), toRim.clone().multiplyScalar(0.5).add(up));
          }
          this.ballAt = betweenPalms();
          this.dunkRim = { rim: toScene(action.to.x, action.to.y, RIM_HEIGHT), toRim: toRim.clone(), across: across.clone() };
          this.hangT = 0;
        } else if (style === 'layup') {
          // Up on the shooting hand, palm under the ball; the other arm up to protect it.
          arms = 'layup: on the shooting hand';
          const at = gather.clone().lerp(head.clone().addScaledVector(toRim, 0.3).addScaledVector(across, 0.12).add(new THREE.Vector3(0, 0.6, 0)), rise);
          this.ballAt = at;
          palmOn(this.arms.r, at, up.clone().negate().addScaledVector(toRim, -0.3), toRim.clone().add(new THREE.Vector3(0, 0.3, 0)));
          this.ballAt = onPalm('r');
          if (rise < 0.6) palmOn(this.arms.l, at, across.clone().negate(), up.clone().add(toRim), 1 - rise);
          else {
            reachTo(this.arms.l, head.clone().addScaledVector(toRim, 0.25).addScaledVector(across, -0.32).add(new THREE.Vector3(0, 0.1, 0)), 0.8);
            this.orient('l', toRim.clone(), up.clone(), 0.8);
          }
        } else {
          // A jump shot, in the six stages of a real one (timed by his jump: he lets it go at the top).
          // 1 Gather: on the floor, knees dipped, the ball in both hands in front of the waist.
          // 2 Rising: off the floor, the ball up to the chin, the shooting hand going under it.
          // 3 Set point: near the top, the ball just above the forehead, the shooting hand under and
          //   behind it with the wrist cocked, elbow bent about 90 degrees under the ball pointing at
          //   the rim, the guide hand on its side.
          // (4 release, 5 follow-through and 6 the landing come once the ball has left him.)
          const peak = SHOTS[style ?? 'jumper'].jump || 0.6;
          const p = Math.min(1, lift / peak);
          // In front of the face at the chin, then above and in front of the forehead: his face stays
          // under the ball, clear of his arms, eyes on the rim.
          const chin = head.clone().addScaledVector(toRim, 0.38).addScaledVector(across, 0.05).add(new THREE.Vector3(0, 0.02, 0));
          const set = head.clone().addScaledVector(toRim, 0.27).addScaledVector(across, 0.08).add(new THREE.Vector3(0, 0.32, 0));
          const ease = (x: number) => x * x * (3 - 2 * x);
          let at: THREE.Vector3;
          /** How far into the set: 0 at the gather (hands on the sides), 1 at the set point (under and behind, cocked). */
          let cock: number;
          if (lift < 0.02) {
            arms = 'jump shot 1/6: gather';
            at = gather.clone();
            cock = 0;
          } else if (p < 0.45) {
            arms = 'jump shot 2/6: rising, ball to the chin';
            const k = ease(p / 0.45);
            at = gather.clone().lerp(chin, k);
            cock = 0.5 * k;
          } else {
            const k = ease(Math.min(1, (p - 0.45) / 0.4));
            arms = k < 1 ? 'jump shot 3/6: up to the set point' : 'jump shot 3/6: set point';
            at = chin.clone().lerp(set, k);
            cock = 0.5 + 0.5 * k;
          }
          this.ballAt = at;
          // The shooting hand moves from the ball's side (gather) to under and behind it (set point).
          const shootSide = across.clone().multiplyScalar(0.9).add(new THREE.Vector3(0, -0.4, 0)).lerp(up.clone().multiplyScalar(-0.75).addScaledVector(toRim, -0.65), cock);
          const shootFingers = toRim.clone().add(new THREE.Vector3(0, 0.6, 0)).lerp(up.clone().multiplyScalar(0.8).addScaledVector(toRim, -0.35), cock);
          const elbowLow = shoulderR.clone().add(new THREE.Vector3(0, -0.7, 0)).addScaledVector(across, 0.3).addScaledVector(toRim, 0.2);
          const elbowSet = shoulderR.clone().addScaledVector(toRim, 0.9).add(new THREE.Vector3(0, -0.5, 0)).addScaledVector(across, 0.32);
          palmOn(this.arms.r, at, shootSide, shootFingers, 1, elbowLow.lerp(elbowSet, cock));
          // The guide hand on the other side all the way, fingers up.
          const elbowL = shoulderL.clone().addScaledVector(across, -0.6).addScaledVector(toRim, 0.3).add(new THREE.Vector3(0, -0.4, 0));
          palmOn(this.arms.l, at, across.clone().negate().addScaledVector(toRim, -0.2), up.clone().addScaledVector(toRim, 0.6 * (1 - cock)), 1, elbowL);
          this.ballAt = betweenPalms();
        }
      } else {
        this.released = Math.min(1, this.released + dt / (style === 'dunk' ? 0.45 : 0.25));
        if (style === 'dunk') {
          arms = this.dunkRim ? hangOnRim() : 'dunk: let go, coming down';
        } else {
          // 4 Release: the arm extends from the set point and the ball rolls off the fingertips;
          // 5 follow-through: arm up and a little forward, wrist snapped; 6 held like that down to the floor.
          arms = this.released < 0.6 ? `${style} 4/6: release` : lift > 0.05 ? `${style} 5/6: follow-through` : `${style} 6/6: landing, holding the follow-through`;
          const set = head.clone().addScaledVector(toRim, 0.27).addScaledVector(across, 0.08).add(new THREE.Vector3(0, 0.32, 0));
          const setWrist = set.addScaledVector(toRim, -0.12).add(new THREE.Vector3(0, -0.14, 0));
          // Up and forward towards the rim, about 60 degrees up (not straight up), as in the reference.
          // The arm all but straight (its own length from the shoulder), elbow locked.
          const upperR = this.arms.r.upper.getWorldPosition(new THREE.Vector3());
          const elbowR = this.arms.r.lower.getWorldPosition(new THREE.Vector3());
          const forearm = upperR.distanceTo(elbowR) + elbowR.distanceTo(this.arms.r.hand.getWorldPosition(new THREE.Vector3()));
          const full = shoulderR.clone().addScaledVector(toRim.clone().multiplyScalar(0.5).add(new THREE.Vector3(0, 0.87, 0)).normalize(), forearm * 0.96);
          const reachUp = setWrist.lerp(full, Math.min(1, this.released * 1.6));
          reachTo(this.arms.r, reachUp, 1, shoulderR.clone().addScaledVector(toRim, 0.7).add(new THREE.Vector3(0, -0.2, 0)));
          // A wrist flexes about 80°: with the forearm up, the fingers end pointing at the rim, just below level.
          this.orient('r', toRim.clone().multiplyScalar(0.3).add(new THREE.Vector3(0, -1, 0)), toRim.clone().add(new THREE.Vector3(0, -0.2, 0)), this.released);
          // The guide hand comes off the ball and drops out to the side at about head height.
          const guideTo = shoulderL.clone().addScaledVector(toRim, 0.3).addScaledVector(across, -0.38).add(new THREE.Vector3(0, 0.1, 0));
          reachTo(this.arms.l, guideTo, 0.9, shoulderL.clone().addScaledVector(across, -0.6).add(new THREE.Vector3(0, -0.3, 0)));
          this.orient('l', across.clone(), up.clone().addScaledVector(toRim, 0.3), 0.9);
        }
      }
      this.state.arms = arms;
      return;
    }
    this.released = 0;
    this.shotBall = null;
    if (this.dunkRim && holder !== key) {
      this.state.arms = hangOnRim();
      return;
    }
    this.dunkRim = null;
    if (passSoon) {
      // Picking the ball up for a pass: both hands, at the chest.
      arms = 'pass: picking it up';
      openBoth();
      this.ballAt = twoHands(chest.clone().addScaledVector(fwd, 0.34).add(new THREE.Vector3(0, -0.22, 0)));
    } else if (has && action?.kind === 'held' && action.dribble && MIXAMO.Dribble?.dribble) {
      // Dribbling: the arm is the dribble clip's (see update); the ball goes by physics, in time with
      // it (dribbleBall). It goes on the side the frame's ball is (a crossover switches hands, at a
      // release); just before the dribble ends (a pass, a shot, a pick-up) he catches it at the top.
      dribbling = true;
      const hips = Math.PI / 2 - this.yaw;
      const bR = new THREE.Vector3().crossVectors(new THREE.Vector3(Math.cos(hips), 0, Math.sin(hips)), UP).normalize();
      const want = (Math.sign(ball.clone().sub(chest).dot(bR)) || 1) > 0 ? 'r' : 'l';
      const ending = !!next && !(next.action.kind === 'held' && next.action.dribble) && next.in < DRIBBLE_CATCH_S;
      const d = this.dribbleBall(want, ending, dt);
      const h = this.dribSide;
      this.open = { l: 1, r: 1 };
      this.curl[h] = CUP;
      this.ballAt = d.pos.clone();
      const which = h === 'r' ? 'right' : 'left';
      arms = d.phase === 'flight' ? `dribble (${which} hand): ball in the air` : d.phase === 'held' ? `dribble (${which} hand): holding it` : `dribble (${which} hand): pushing it down (met it ${(d.gap * 100).toFixed(1)} cm off)`;
    } else if (action?.kind === 'pass' && action.from === key) {
      // Passing: both hands push the ball out towards the receiver (down for a bounce pass, up for a
      // lob) and follow through, palms out, thumbs down, arms out straight; then they come back.
      openBoth();
      const target = frame.players[action.to];
      const to = target ? toScene(target.x, target.y) : chest.clone().add(fwd);
      const line = to.clone().sub(chest).setY(0).normalize();
      if (action.style === 'bounce') line.y = -0.45;
      else if (action.style === 'lob') line.y = 0.55;
      line.normalize();
      const gone = ball.distanceTo(chest);
      const push = Math.min(1, gone / 0.9);
      const settle = Math.max(0, Math.min(1, (gone - 2) / 3));
      const w = 1 - settle;
      arms = push < 1 ? 'pass: let go, arms after it' : settle < 1 ? 'pass: follow-through' : 'pass: done';
      const across = new THREE.Vector3().crossVectors(line.clone().setY(0).normalize(), UP).normalize();
      if (push < 0.35) {
        // Still in his hands: both palms on the back and sides of the ball, pushing it out.
        arms = 'pass: pushing it out';
        const at = chest.clone().add(new THREE.Vector3(0, -0.15, 0)).addScaledVector(line, 0.32 + 0.4 * push);
        for (const arm of [this.arms.l, this.arms.r]) palmOn(arm, at, across.clone().multiplyScalar(arm.side * 0.7).addScaledVector(line, -0.7), up.clone().addScaledVector(line, 0.5));
        this.ballAt = betweenPalms();
      } else {
        // Let go: arms out after it, palms out, thumbs down, then back.
        for (const arm of [this.arms.l, this.arms.r]) {
          const t = chest.clone().add(new THREE.Vector3(0, -0.12, 0)).addScaledVector(line, 0.52).addScaledVector(across, arm.side * 0.11);
          reachTo(arm, t, w);
          this.orient(sideOf(arm), line.clone().addScaledVector(across, -arm.side * 0.3), up.clone().addScaledVector(line, 0.4).addScaledVector(across, arm.side * 0.3), w);
        }
      }
    } else if (has && near) {
      // Holding it: at the chest, out in front, between his two palms.
      arms = 'holding it';
      openBoth();
      const at = chest.clone().addScaledVector(fwd, 0.34).add(new THREE.Vector3(0, -0.22, 0));
      this.ballAt = twoHands(at);
    } else if (action?.kind === 'pass' && action.to === key && ball.distanceTo(chest) < 1.6) {
      // A pass coming in: hands out, palms to the ball.
      arms = 'catching';
      openBoth();
      const k = 1 - Math.max(0, ball.distanceTo(chest) - 0.6) / 1;
      const meet = ball.distanceTo(chest) > 0.75 ? chest.clone().addScaledVector(ball.clone().sub(chest).normalize(), 0.6) : ball;
      twoHands(meet, k, dir(ball.clone().sub(chest).setY(0)));
    } else {
      const handsUp = frame.reach?.[key] ?? 0;
      const toBall = ball.clone().sub(chest);
      if (handsUp <= 0.02 && (this.posture === 'ready' || this.posture === 'rebound')) {
        // Ready for the ball in the air. A pass: hands up in front at the chest, palms to the ball,
        // to catch or cut it off. A shot: hands up by the shoulders, elbows out, for the rebound.
        const reb = this.posture === 'rebound';
        const facingBall: number[] = [];
        openBoth();
        const look = toBall.clone().setY(0);
        if (look.lengthSq() < 1e-4) look.copy(fwd);
        look.normalize();
        const across = new THREE.Vector3().crossVectors(look, UP).normalize();
        for (const arm of [this.arms.l, this.arms.r]) {
          const S = arm.upper.getWorldPosition(new THREE.Vector3());
          // Boxing out for a rebound: forearms up, hands at the chest just wider than the shoulders,
          // elbows out. A pass: hands out in front of the chest.
          const t = reb
            ? S.clone().addScaledVector(across, arm.side * 0.22).addScaledVector(look, 0.28).add(new THREE.Vector3(0, -0.12, 0))
            : chest.clone().addScaledVector(look, 0.42).addScaledVector(across, arm.side * 0.17).add(new THREE.Vector3(0, -0.02, 0));
          const elbow = S.clone().addScaledVector(across, arm.side * 0.7).addScaledVector(look, reb ? 0 : 0.2).add(new THREE.Vector3(0, reb ? -0.4 : -0.5, 0));
          reachTo(arm, t, 0.9, elbow);
          // Each palm faces the ball itself (up at it when it is high), ready to grab it; the fingers
          // point up across the palm, a little out to his side.
          const palm = ball.clone().sub(this.palmInfo(sideOf(arm)).centre).normalize();
          const fingers = UP.clone().addScaledVector(across, arm.side * 0.2);
          fingers.addScaledVector(palm, -fingers.dot(palm));
          if (fingers.lengthSq() < 1e-3) fingers.copy(look).addScaledVector(palm, -look.dot(palm));
          this.orient(sideOf(arm), palm, fingers.normalize(), 0.95, WRIST_ON_BALL);
          // How squarely the palm faces the ball (1 = straight at it), for the readout.
          facingBall.push(this.palmInfo(sideOf(arm)).normal.dot(ball.clone().sub(this.palmInfo(sideOf(arm)).centre).normalize()));
        }
        arms = `${reb ? 'boxing out' : 'ready for the ball'} (palms to ball ${facingBall.map((v) => v.toFixed(2)).join(' ')})`;
      } else if (handsUp <= 0.02 && this.posture === 'onBall' && this.defW > 0) {
        // Defensive stance on the ball: the stance clip's arms (see update).
        arms = `defensive stance (clip ${this.defW.toFixed(2)})`;
        openBoth();
      } else if (handsUp <= 0.02 && this.posture === 'onBall' && this.stance > 0.25) {
        // Defensive stance on the ball: hands out wide at the waist, palms forward, ready to deflect.
        arms = 'stance: hands out';
        openBoth();
        for (const arm of [this.arms.l, this.arms.r]) {
          const t = arm.upper.getWorldPosition(new THREE.Vector3()).addScaledVector(right, arm.side * 0.5).addScaledVector(fwd, 0.25).add(new THREE.Vector3(0, -0.42, 0));
          const w = Math.min(1, this.stance * 1.3);
          reachTo(arm, t, w);
          this.orient(sideOf(arm), fwd.clone().add(new THREE.Vector3(0, -0.3, 0)), right.clone().multiplyScalar(arm.side).add(new THREE.Vector3(0, 0.25, 0)), w);
        }
      }
      if (handsUp > 0.02) {
        // Hands up: a contest, a closeout, a rebound. Standing tall, palms forward, fingers up.
        arms = `hands up ${handsUp.toFixed(2)}`;
        openBoth();
        const toBall = ball.clone().sub(chest);
        if (lift > 0.05 && toBall.y > -0.3 && toBall.length() < 3.5) {
          // Up in the air for the ball (a tip-off, a rebound): his whole body stretched, both arms
          // straight towards it, the nearer hand highest, palms to the ball.
          // Off the floor he goes all the way: half-raised arms in the air point at nobody.
          const w = Math.max(handsUp, Math.min(1, lift / 0.15));
          arms = `reaching for the ball ${w.toFixed(2)}`;
          const nearer = toBall.dot(right) >= 0 ? this.arms.r : this.arms.l;
          for (const arm of [this.arms.l, this.arms.r]) {
            const S = arm.upper.getWorldPosition(new THREE.Vector3());
            const E = arm.lower.getWorldPosition(new THREE.Vector3());
            const len = S.distanceTo(E) + E.distanceTo(arm.hand.getWorldPosition(new THREE.Vector3()));
            // Towards the ball, but up: at most 35 degrees off straight up.
            const d = ball.clone().sub(S).normalize();
            const off = Math.acos(Math.max(-1, Math.min(1, d.y)));
            if (off > 0.61) {
              const flat = d.clone().setY(0).normalize();
              d.copy(UP).multiplyScalar(Math.cos(0.61)).addScaledVector(flat, Math.sin(0.61));
            }
            const t = S.clone().addScaledVector(d, len * (arm === nearer ? 0.99 : 0.93)).addScaledVector(right, arm === nearer ? 0 : arm.side * 0.06);
            reachTo(arm, t, w, S.clone().addScaledVector(right, arm.side * 0.5).addScaledVector(fwd, -0.2));
            this.orient(sideOf(arm), ball.clone().sub(t).setY(0).normalize().add(new THREE.Vector3(0, 0.3, 0)), d.clone(), w);
          }
        } else
        for (const arm of [this.arms.l, this.arms.r]) {
          const t = arm.upper.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 0.18).addScaledVector(right, arm.side * 0.12).add(new THREE.Vector3(0, 0.62, 0));
          reachTo(arm, t, handsUp);
          this.orient(sideOf(arm), fwd.clone(), up.clone(), handsUp);
        }
      }
    }
    void lift;
    if (!dribbling) this.drib = null;
    this.state.arms = arms;
  }
}

const CLIP: Record<Loco, string> = { idle: 'Idle_Loop', walk: 'Walk_Loop', jog: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop' };
const LOOP_PHASE: Record<string, true> = { Walk_Loop: true, Jog_Fwd_Loop: true, Sprint_Loop: true };

/**
 * Which loops, how much, at a speed (m/s). The library's jog is quick (5.4 m/s), so a slow jog is a
 * fast walk blending into it; above the jog it blends into the sprint.
 */
function locoWeights(v: number, info: Record<string, ClipInfo>): Record<Loco, number> {
  const walk = info.Walk_Loop.speed;
  const jog = info.Jog_Fwd_Loop.speed;
  const sprint = info.Sprint_Loop.speed;
  const ramp = (x: number, a: number, b: number) => Math.max(0, Math.min(1, (x - a) / (b - a)));
  if (v < STILL_M_S) return { idle: 1, walk: 0, jog: 0, sprint: 0 };
  if (v < walk) {
    const k = ramp(v, STILL_M_S, walk * 0.7);
    return { idle: 1 - k, walk: k, jog: 0, sprint: 0 };
  }
  const walkTop = 1.8;
  if (v < walkTop) return { idle: 0, walk: 1, jog: 0, sprint: 0 };
  const jogFrom = 2.9;
  if (v < jogFrom) {
    const k = ramp(v, walkTop, jogFrom);
    return { idle: 0, walk: 1 - k, jog: k, sprint: 0 };
  }
  const k = ramp(v, jog, sprint);
  return { idle: 0, walk: 0, jog: 1 - k, sprint: k };
}

function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}
