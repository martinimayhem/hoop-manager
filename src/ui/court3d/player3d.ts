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
import { JointLimits, type JointExcess } from './joints';

/** Court metres (x along, y across, z up) to the 3D scene (x along, y up, z across). */
/** A small, stable hash of a string (each player's own jumping style, from his key). */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

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
  /** The holder's own shot, if he keeps the ball until it (it may be a beat or two after the next). */
  shot?: { action: BallAction; in: number };
}

/**
 * The jump shot's way along (see arms3d): the ball reaches the chin at the end of the dip (this share
 * of the way), and the set point at this share of the time from take-off to the release.
 */
const SHOT_CHIN_AT = 0.4;
const SHOT_SET_AT = 0.9;
/** After a jump shot he holds the follow-through this long on the floor, then lowers his arms (s). */
const SHOT_HOLD_LANDED_S = 0.25;
/** The shooting wrist in the follow-through: snapped over this far (radians), the fingers curled in this much a joint. */
const SHOT_WRIST_SNAP = (85 * Math.PI) / 180;
const SHOT_FINGER_CURL = 0.7;
/** After a set shot (a free throw) he holds the follow-through this long from the release (s). */
const SHOT_HOLD_SET_S = 0.9;
/** The gather before a jump shot: this long before it, he picks the ball up and dips. */
const GATHER_S = 0.28;
/** ...and this long before a pass, he picks the ball up to his chest. */
const PASS_GATHER_S = 0.4;

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
/** A ball handed to him from far off comes to him at this speed (m/s): a pass's. */
const BALL_CATCH_UP_M_S = 9;
/** A held ball that would move further than this in a frame (m, plus 12 m/s) is carried across by the hands instead. */
const BALL_HANDOFF_M = 0.12;
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
/** A shoe's sole under the foot (m): a player's listed height is barefoot. */
const SHOE_SOLE_M = 0.03;
/** Standing still, this much of the way from the library's idle (knees bent) to a relaxed stand. */
const STAND_TALL = 0.85;
/** A relaxed stand's knee: all but straight. */
const STAND_KNEE = (172 * Math.PI) / 180;
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
/**
 * Where a ball touches the hand, from the wrist towards the knuckles (share of the way): the top of the
 * palm by the base of the fingers. A ball is handled with the fingers and finger pads, not the heel of
 * the hand (dribbling, passing and shooting alike), so it sits under the fingers, not the wrist.
 */
const PALM_AT = 0.95;
/** A two-hand pass: the ball, in his hands, goes from this far out in front of his chest to this far (m), where his arms are straight and it leaves his fingers. */
const PASS_FROM_M = 0.3;
const PASS_OUT_M = 0.62;
/** The push of a two-hand pass takes this long (s), up to the moment the ball leaves his hands. */
const PASS_PUSH_S = 0.2;
/** A chest pass goes out from this far below the chest joint (m): from the chest, under the chin, not the shoulders. */
const PASS_BELOW_CHEST_M = 0.18;
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
/** Up off the floor, the hand comes over the ball from this share of its rise (fully over it by three quarters). */
const DRIBBLE_OVER_FROM = 0.1;
/** An opponent this close (m) makes the handler dribble with the hand away from him. */
const DRIBBLE_GUARDED_M = 2.5;
/**
 * On the move, where the dribbling hand works (dribbleArmOut): at least this far out from his middle
 * (m: the ball clear of his striding legs), this much lower than the clip has it (m: the clip is for a
 * crouched stance, he runs upright), and this far further ahead at a run (m: the ball goes out in
 * front and he runs onto it).
 */
const DRIBBLE_HAND_OUT_M = 0.42;
const DRIBBLE_HAND_DROP_M = 0.18;
const DRIBBLE_HAND_FWD_M = 0.3;
/**
 * The pocket dribble: on each push the hand carries the ball back to his hip first, this far behind
 * the middle of his body, this far out to the side, this far above his hip (m), as much as POCKET_SHARE.
 */
const POCKET_BACK_M = -0.06;
const POCKET_OUT_M = 0.4;
const POCKET_ABOVE_HIP_M = 0.05;
const POCKET_SHARE = 0.85;
/** ...and the hand stays on the ball at least this long on each push at a walk (s; less on the move). */
const POCKET_HOLD_S = 0.3;
/**
 * The bounces at the free-throw line before the shot (a routine, dead ball): he stands nearly upright,
 * feet set, knees a little soft (this much of the crouch), and bounces it straight down in front of
 * him, this far ahead of his middle and this far to the side of the hand (m). No pocket, no guarding arm.
 */
const ROUTINE_LOW = 0.07;
const ROUTINE_FWD_M = 0.32;
const ROUTINE_SIDE_M = 0.1;
/**
 * His feet at the free-throw line: the balls of the feet this far either side of his middle, this far
 * ahead of his hips, the shooting (right) foot this much further forward (m). He steps into it (a
 * small lift, about FT_FEET_STEP_S) from wherever his walk left them.
 */
const FT_FEET_SIDE_M = 0.16;
const FT_FEET_FWD_M = 0.12;
const FT_FEET_LEAD_M = 0.06;
const FT_FEET_STEP_S = 0.12;
/** Within this long of the dribble ending, he catches the ball at the top instead of pushing it again (s). */
const DRIBBLE_CATCH_S = 0.75;
/** A dunker is this far in front of the rim's centre at the top of his jump: his hands are over it. */
const DUNK_FROM_RIM_M = 0.55;
/** After a dunk he hangs on the rim this long, then lets go. */
const DUNK_HANG_S = 0.45;
/** The frame's dunk rises for about this long (s; its release share of the shortest shot beat), until it can be measured. */
const DUNK_RISE_S = 0.63;
/** He gathers the ball for a dunk (stops dribbling, both hands on it) this long before the shot (s): his last two steps. */
const DUNK_GATHER_S = 0.45;
/**
 * A free throw's motion (the reference's phases), by the time to the release (s): the lifting phase
 * from FT_LIFT_FROM to FT_SET_AT (ball from the waist to the set point, knees bending), the projection
 * phase from there to the release (legs and arm extending, up onto his toes), then the deceleration
 * (follow-through held, on his toes FT_TOES_HOLD_S, then the heels down). The release comes
 * FT_RELEASE_S into the shot (its release share of the shortest shot beat, 0.3 of 0.9 s).
 */
const FT_LIFT_FROM = 0.7;
const FT_SET_AT = 0.3;
const FT_RELEASE_S = 0.27;
const FT_DIP = 0.42;
const FT_TOES_M = 0.06;
const FT_TOES_HOLD_S = 0.35;
/** E1: the ball at his waist, in front of him (m from the chest joint). */
const FT_WAIST_FWD_M = 0.3;
const FT_WAIST_DOWN_M = 0.42;
/** The projection phase: from the set point the ball goes on up and a little forward as the arm extends, by `k`. */
function ftProjection(toRim: THREE.Vector3, k: number): THREE.Vector3 {
  return toRim.clone().multiplyScalar(0.07 * k).add(new THREE.Vector3(0, 0.17 * k, 0));
}
/** The ball handler's body turns at most this fast holding the ball (rad/s), a pivot... */
const HELD_TURN_RATE = 4;
/** ...and squaring up to shoot or selling a pump fake, this fast: quick, but never a snap. */
const HELD_SQUARE_RATE = 7;
/** The pivot foot, from the middle of his body: out to the side and forward (m). */
const PIVOT_FOOT_SIDE_M = 0.14;
const PIVOT_FOOT_FWD_M = 0.04;
/** At most this far (m) does the body move to keep the pivot foot planted. */
const PIVOT_MAX_OFF_M = 0.3;
/** A ball he is going for further round than this from his chest, he turns his body to (radians). */
const TURN_FREE = (40 * Math.PI) / 180;
/** ...as fast as this (radians a second). */
const TURN_RATE = 7;
/** Joint limits (joints.ts): the body's before the arm code, the rest after it and the head's turn. */
const LAST_JOINTS = ['neck_01', 'Head', 'hand_l', 'hand_r'] as const;
const ARM_JOINTS = ['upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r'] as const;
const BODY_JOINTS = ['spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r'] as const;
/** A crossover's lean: the trunk dips this far to the side he sells, then the side he goes (radians). */
const CROSS_LEAN = (11 * Math.PI) / 180;
/** Whether `key` dunks within DUNK_GATHER_S, keeping the ball until then. */
function dunkAhead(next: Upcoming | null | undefined, key: string): boolean {
  const s = next?.shot;
  return !!s && s.in < DUNK_GATHER_S && s.action.kind === 'fromPlayer' && s.action.from === key && s.action.style === 'dunk';
}
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
  /** The way the hinge (elbow, knee) folds, in the upper bone's own space. */
  fold?: THREE.Vector3 | null;
  /** The joint limits the chain is held to. */
  limits?: JointLimits;
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
  // A hinge only folds one way: the upper bone turns about its own length (which leaves the elbow
  // where it is) until its fold faces the way the lower bone has to go.
  if (arm.fold) {
    const sh = arm.upper.getWorldPosition(new THREE.Vector3());
    const el = arm.lower.getWorldPosition(new THREE.Vector3());
    const along = el.clone().sub(sh).normalize();
    const want = t.clone().sub(el);
    want.addScaledVector(along, -want.dot(along));
    const has = arm.fold.clone().applyQuaternion(arm.upper.getWorldQuaternion(new THREE.Quaternion()));
    has.addScaledVector(along, -has.dot(along));
    if (want.lengthSq() > 1e-6 && has.lengthSq() > 1e-6) {
      want.normalize();
      has.normalize();
      const angle = Math.atan2(new THREE.Vector3().crossVectors(has, want).dot(along), has.dot(want));
      turnWorld(arm.upper, along, angle);
    }
  }
  aim(arm.lower, arm.hand.getWorldPosition(new THREE.Vector3()), t);
  if (weight < 0.999) {
    arm.upper.quaternion.copy(fkU.slerp(arm.upper.quaternion.clone(), weight));
    arm.lower.quaternion.copy(fkL.slerp(arm.lower.quaternion.clone(), weight));
    arm.upper.updateMatrixWorld(true);
  }
  // As far as the joints go, and no further.
  arm.limits?.apply([arm.upper.name, arm.lower.name]);
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
type Posture = 'onBall' | 'ready' | 'rebound' | 'lane' | 'none';

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
    // A free throw: the players on the lane wait in a ready crouch, hands low in front, eyes on the
    // ball; they box out only once it hits the rim (a rebound, then: frame.reach).
    if (action.style === 'set') return d(me, action.to) < 5 ? 'lane' : 'none';
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
  /** How far each joint can bend (joints.ts). */
  private limits!: JointLimits;
  private legs: { l: Arm; r: Arm };
  /** Where each planted foot is held (world), and how firmly. */
  private locks: Record<'l' | 'r', { at: THREE.Vector3 | null; w: number; yaw: number }> = { l: { at: null, w: 0, yaw: 0 }, r: { at: null, w: 0, yaw: 0 } };
  /** The model's own forward, as a yaw: added so he faces where the frame says. */
  private yawOffset = 0;
  private scale = 1;
  /** The ankle's and the ball of the foot's height standing (m): the floor under him. */
  private ankleRest = 0.11;
  private toeRest = 0.025;
  private tipRest = 0.02;
  /** The leg bones' own offsets (their lengths), from the bind pose. */
  private legBind: Record<string, THREE.Vector3> = {};

  private last: THREE.Vector3 | null = null;
  private speed = 0;
  private moveDir = 0;
  private phase = 0;
  /** The crouched shuffle's own cycle: a shorter stride than any run. */
  private crouchPhase = 0;
  private facing = 0;
  private yaw = 0;
  /** How far along the jump shot's way he is (0 the gather, 1 the set point; never back). */
  private shotAlong = 0;
  /** How long he has been back on the floor after a shot (s). */
  private landedFor = 0;
  /**
   * Fakes (see fakes.ts): after a pump or pass fake he has picked up his dribble (he must shoot or
   * pass now); after a crossover, the hand he crossed to (kept until he finishes).
   */
  private pickedUp = false;
  /** A free throw: time to the release (game s; below 0 after it), or null. */
  private ftR: number | null = null;
  /** How far he has turned his body towards a ball he is going for, past where the frame faces him (radians). */
  private turnTo = 0;
  private crossedTo: 'l' | 'r' | null = null;
  /** How far through pushing a pass out (0 to 1) he got before it left his hands. */
  private passOut = 0;
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
  /** How much he is moving, for the dribble (0 standing, 1 on the move), eased; and how far the dribbling hand is lowered. */
  private dribMoveS = 0;
  /** How far the dribbling hand is placed out at his side (see dribbleArmOut). */
  private dribOut = 1;
  /** The pocket dribble: how far the hand has carried the ball back to his hip on this push (0 to 1). */
  private dribPocket = 0;
  /** Bouncing the ball at the free-throw line before the shot (see ROUTINE_LOW). */
  private routine = false;
  /** At the free-throw line with the ball, from the catch to the end of the shot: feet set, square. */
  private atLine = false;
  /** His speed for placing the dribbling hand, smoothed over half a second. */
  private dribPace = 0;
  /** His heading and place for the dribble's frame (eased: see toBody). */
  private dribHeading = 0;
  private dribRoot = new THREE.Vector3();
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
    /**
     * In flight, its way across in his own frame (x: ahead of his hips, z: to his right), so it goes
     * where he goes: a straight line from where it left the hand (`from`) to where the palm takes it
     * at the top (`spot`).
     * Up and down it is physics alone: let go at `y0` at `down` m/s, the floor after `tDown` s, the peak
     * `tUp` s after that.
     */
    from: THREE.Vector3;
    spot: THREE.Vector3;
    y0: number;
    down: number;
    tDown: number;
    tUp: number;
    since: number;
    bounced: boolean;
    /** The clip time of the top the hand comes back to. */
    backAt: number;
    /** How the last catch went: how far the ball was from the palm (m) and how fast it was still going up (m/s). */
    gap: number;
    rising: number;
    /** What is left of a catch off the palm (m), which the push takes back to nothing by the lowest point; the clip times of that catch and lowest point. */
    reach: THREE.Vector3;
    caughtAt: number;
    lowAt: number;
  } | null = null;
  private dribPoses: Record<string, ClipPose> = {};
  /** The head's forward, in the head bone's own space. */
  private headFwd = new THREE.Vector3(0, 0, 1);
  /** A dunker carried to the rim: the offset from where the frame has him, and how much of it. */
  private dunkOff = new THREE.Vector3();
  /** The ball handler's facing as shown, turned at a manageable speed (see update). */
  private heldFacing: number | null = null;
  /** Turning on the spot with the ball: the pivot foot's place on the floor, and the body's offset that keeps it there. */
  private pivot: { at: THREE.Vector3; side: 1 | -1 } | null = null;
  private pivotOff = new THREE.Vector3();
  /**
   * A dunk's jump as he does it (null when not dunking): how long into the shot, how far the frame's
   * jump has risen (to tell its timing), where he left the floor, and how far along his flight he is.
   */
  private dunk: { t: number; rawTop: number; rise: number; from: THREE.Vector3 | null; flown: number; peaked: boolean } | null = null;
  /** The way a dunker came in to the rim (level, unit). */
  private dunkDir = new THREE.Vector3(1, 0, 0);
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
  private blendTime = 0.15;
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
    // As tall as the player is in his shoes: his listed (barefoot) height plus the soles, measured on
    // the body itself (the pack's own hair, hidden, and the eyes left out).
    const bodyBounds = body ? new THREE.Box3().setFromObject(body) : bounds;
    this.scale = (look.heightM + SHOE_SOLE_M) / (bodyBounds.max.y - bodyBounds.min.y);
    // Heavier players a little wider, never taller (half the build's difference: a full one made
    // heavy players' arms and shoulders look swollen).
    const girth = 1 + (Math.max(0.9, Math.min(1.2, look.girth)) - 1) * 0.5;
    model.scale.set(this.scale * girth, this.scale, this.scale * girth);
    model.position.y = -bodyBounds.min.y * this.scale;
    this.root.add(model);
    // Which way the model faces: from the heel to the toes.
    const heel = this.bones.foot_l.getWorldPosition(new THREE.Vector3());
    const toe = this.bones.ball_l.getWorldPosition(new THREE.Vector3());
    this.yawOffset = -Math.atan2(toe.x - heel.x, toe.z - heel.z);
    for (const sd of ['l', 'r']) for (const b of ['calf', 'foot', 'ball']) this.legBind[`${b}_${sd}`] = this.bones[`${b}_${sd}`].position.clone();
    // Standing, the ankle and the ball of the foot are this high: no pose may put them lower.
    this.ankleRest = heel.y - this.root.position.y;
    this.toeRest = toe.y - this.root.position.y;
    this.tipRest = this.bones.ball_leaf_l.getWorldPosition(new THREE.Vector3()).y - this.root.position.y;

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
    this.palmLen = this.bones.hand_r.getWorldPosition(new THREE.Vector3()).distanceTo(this.bones.middle_01_r.getWorldPosition(new THREE.Vector3())) * PALM_AT * HAND_SCALE;
    const arm = (s: 'l' | 'r', side: 1 | -1): Arm => ({ upper: this.bones[`upperarm_${s}`], lower: this.bones[`lowerarm_${s}`], hand: this.bones[`hand_${s}`], side });
    this.arms = { l: arm('l', -1), r: arm('r', 1) };
    const leg = (s: 'l' | 'r', side: 1 | -1): Arm => ({ upper: this.bones[`thigh_${s}`], lower: this.bones[`calf_${s}`], hand: this.bones[`foot_${s}`], side });
    this.legs = { l: leg('l', -1), r: leg('r', 1) };
    // Joint limits, from the bind pose he is still in: his forward from heel to toe, his right across.
    {
      const fwdBind = this.bones.ball_l.getWorldPosition(new THREE.Vector3()).sub(this.bones.foot_l.getWorldPosition(new THREE.Vector3())).setY(0).normalize();
      const rightBind = new THREE.Vector3().crossVectors(fwdBind, UP).normalize();
      this.limits = new JointLimits(this.bones, fwdBind, rightBind, { l: this.palm.l.palm, r: this.palm.r.palm });
      for (const s of ['l', 'r'] as const) {
        this.arms[s].fold = this.limits.hingeFold(`lowerarm_${s}`);
        this.arms[s].limits = this.limits;
        this.legs[s].fold = this.limits.hingeFold(`calf_${s}`);
        this.legs[s].limits = this.limits;
      }
    }
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
    // A free throw (a set shot): its own clock, counted down to the release, from the hold before it
    // to the follow-through after (see freeThrow).
    const ts = frame.timeScale ?? 1;
    if (!shot && holder === key && next?.action.kind === 'fromPlayer' && next.action.from === key && next.action.style === 'set') this.ftR = next.in * ts + FT_RELEASE_S;
    else if (shot?.style === 'set' && this.ftR !== null) this.ftR -= dt;
    else this.ftR = null;
    this.atLine =
      (holder === key && ((action?.kind === 'held' && !!action.routine) || (next?.action.kind === 'fromPlayer' && next.action.from === key && next.action.style === 'set'))) ||
      shot?.style === 'set';
    const coming =
      !shot && holder === key && next && next.action.kind === 'fromPlayer' && next.action.from === key && ((next.in < GATHER_S && (next.action.style === 'jumper' || next.action.style === 'hook')) || (next.action.style === 'set' && this.ftR !== null && this.ftR < FT_LIFT_FROM)) ? next.action : null;
    const aim = shot ?? coming;
    if (aim) this.facing = Math.atan2(aim.to.y - p.y, aim.to.x - p.x);
    // A fake of his own under way (drawing only: fakes.ts).
    const fake = frame.fake && frame.fake.key === key ? frame.fake : null;
    if (holder !== key) {
      this.pickedUp = false;
      this.crossedTo = null;
    } else if (fake && fake.k >= 0 && (fake.kind === 'pump' || fake.kind === 'pass') && this.drib?.phase !== 'flight') this.pickedUp = true;
    // A pump fake: square to the rim he is selling the shot at.
    const shotNext = next?.shot?.action.kind === 'fromPlayer' ? next.shot.action : null;
    if (fake?.kind === 'pump' && fake.k >= 0 && shotNext) this.facing = Math.atan2(shotNext.to.y - p.y, shotNext.to.x - p.x);
    // With the ball in his hands he never spins: squaring up to shoot, selling a pump fake or pivoting,
    // his body comes round at a turning speed a man can manage (quicker when he squares up to shoot).
    if (holder === key || shot) {
      const want = this.facing;
      this.heldFacing ??= want;
      const most = (aim || fake ? HELD_SQUARE_RATE : HELD_TURN_RATE) * dt * ts;
      this.heldFacing += Math.max(-most, Math.min(most, angleDiff(this.heldFacing, want)));
      this.facing = this.heldFacing;
    } else this.heldFacing = null;
    // A dunk's jump is his own (see dunkJump): a plant, then a real jump on an arc.
    const lift = shot && shot.style === 'dunk' ? this.dunkJump(frame.lift?.[key] ?? 0, dt) : frame.lift?.[key] ?? 0;
    if (!(shot && shot.style === 'dunk')) this.dunk = null;
    // How he stands depends on what the ball is doing (frame.stance only says how low he may go):
    // guarding the man with the ball, the full stance (low, arms out); with the ball in the air near
    // him, ready for it (a pass to catch or cut off) or for the rebound (a shot); otherwise at most a
    // light crouch.
    this.posture = postureFor(key, frame, action, holder);
    // Turning to the ball: going for a ball in the air (a pass to him, ready for one, a rebound) more
    // than a little off to his side, he turns his body to it first, as a player does, rather than
    // reaching round himself with his arms and twisting his neck to watch it.
    {
      const b = frame.ball;
      const attend = holder !== key && (this.posture === 'ready' || this.posture === 'rebound' || ((action?.kind === 'pass' || action?.kind === 'toPlayer') && action.to === key));
      const dist = Math.hypot(b.x - p.x, b.y - p.y);
      let want = 0;
      if (attend && dist > 0.3 && dist < 7) {
        const off = angleDiff(this.facing, Math.atan2(b.y - p.y, b.x - p.x));
        const over = Math.abs(off) - TURN_FREE;
        if (over > 0) want = Math.sign(off) * over;
      }
      const stepMax = TURN_RATE * dt;
      this.turnTo += Math.max(-stepMax, Math.min(stepMax, want - this.turnTo));
      this.facing += this.turnTo;
    }
    const stance = this.posture === 'onBall' ? frame.stance?.[key] ?? 0 : this.posture === 'ready' || this.posture === 'rebound' ? 0.3 : this.posture === 'lane' ? 0.25 : Math.min(0.35, frame.stance?.[key] ?? 0);
    // A dunk: the frame has him take off short of the rim, so he is carried in to it as he rises,
    // until his hands are over it at the top; after the dunk the offset eases away as he lands.
    if (shot && shot.style === 'dunk') {
      const rim = toScene(shot.to.x, shot.to.y);
      const toward = rim.clone().sub(at).setY(0);
      // The way he came in (kept once he is close: right under the rim the way to it means nothing).
      if (toward.length() > 0.3 && !this.dunk?.from) this.dunkDir.copy(toward.normalize());
      // Where his jump takes him: in front of the rim, on the way he came in.
      const over = rim.clone().addScaledVector(this.dunkDir, -DUNK_FROM_RIM_M).setY(0);
      const j = this.dunk!;
      if (j.from) {
        // In the air he goes in a straight line at one speed (nothing pushes him once he has left the
        // floor), from where he took off to in front of the rim, getting there at the top.
        this.dunkOff.copy(j.from).lerp(over, j.flown).sub(at).setY(0);
        this.dunkW = 1;
      } else {
        // On the floor: running in, then the plant, where the frame has him.
        this.dunkOff.set(0, 0, 0);
        this.dunkW = 0;
      }
    } else if (this.dunkRim && this.hangT < DUNK_HANG_S) {
      // Hanging on the rim: still in front of it (the frame carries him on under it), his arms up and
      // forward to the front of the rim, nearly straight, his body below them.
      this.dunkOff.copy(this.dunkRim.rim).addScaledVector(this.dunkRim.toRim, -DUNK_FROM_RIM_M).sub(at).setY(0);
    } else this.dunkW = Math.max(0, this.dunkW - dt / 0.6);
    // Through the rim he hangs on it (the frame has him already coming down when the ball gets there):
    // held up with his hands on the rim, arms nearly straight, then he lets go and drops.
    if (this.dunkRim && this.hangT > 0 && this.hangT < DUNK_HANG_S) this.hangW = 1;
    else this.hangW = Math.max(0, this.hangW - dt / 0.3);
    const hangLift = RIM_HEIGHT + 0.02 - this.armReach * 0.85 - this.shoulderUp;
    const shown = lift + Math.max(0, hangLift - lift) * this.hangW * this.hangW * (3 - 2 * this.hangW);
    // Pivoting: holding the ball (no dribble), standing, turning: one foot stays where it is on the floor
    // and he turns round it (the body moves a little with the turn), so it reads as a pivot, not both
    // feet sliding round. Eased away as soon as he moves off or dribbles.
    {
      const bouncing = action?.kind === 'held' && action.dribble && !this.pickedUp;
      const holding = holder === key && !bouncing && !shot && lift < 0.02 && this.speed < 0.4 && !this.atLine;
      const footAt = (side: 1 | -1) => {
        const f = new THREE.Vector3(Math.cos(this.facing), 0, Math.sin(this.facing));
        const r = new THREE.Vector3().crossVectors(f, UP).normalize();
        return at.clone().addScaledVector(r, side * PIVOT_FOOT_SIDE_M).addScaledVector(f, PIVOT_FOOT_FWD_M).setY(0);
      };
      if (holding) {
        // The pivot foot: chosen when he stops with the ball (the left, unless he faces left of where he goes).
        this.pivot ??= { at: footAt(-1), side: -1 };
        const off = this.pivot.at.clone().sub(footAt(this.pivot.side));
        if (off.length() > PIVOT_MAX_OFF_M) off.setLength(PIVOT_MAX_OFF_M);
        this.pivotOff.lerp(off, 1 - Math.exp(-dt / 0.05));
      } else {
        this.pivot = null;
        this.pivotOff.multiplyScalar(Math.exp(-dt / 0.15));
      }
    }
    this.root.position.set(at.x + this.dunkOff.x * this.dunkW + this.pivotOff.x, shown, at.z + this.dunkOff.z * this.dunkW + this.pivotOff.z);
    // Leaving the floor on a dunk: where from (see dunkJump).
    if (this.dunk && !this.dunk.from && lift > 0) this.dunk.from = this.root.position.clone().setY(0);

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
    const jumper = (shooter && action?.kind === 'fromPlayer' && (action.style === 'jumper' || action.style === 'hook')) || (!!coming && coming.style !== 'set');
    // ...and the plant before a dunk: the last step, knees bending to spring.
    const planting = !!this.dunk && !this.dunk.from;
    this.dip = (jumper && lift < 0.05 && this.released === 0) || planting ? Math.min(1, this.dip + dt / 0.12) : Math.max(0, this.dip - dt / 0.1);
    // A free throw: the knees bend as the ball comes up (the lifting phase) and straighten as he shoots.
    const ft = this.freeThrow();
    if (ft) this.dip = Math.max(this.dip, FT_DIP * ft.lift * (1 - ft.project));
    // The last steps before a dunk: he has gathered the ball (stopped dribbling) and runs them with it
    // in both hands.
    const dunkSoon = holder === key && dunkAhead(next, key);
    const dribbles = holder === key && action?.kind === 'held' && action.dribble && !(dunkSoon && this.drib?.phase !== 'flight') && !this.pickedUp;
    this.dribbling = Math.max(0, Math.min(1, this.dribbling + (dribbles ? 1 : -1) * dt * 5));
    if (dribbles) this.routine = action?.kind === 'held' && !!action.routine;
    const drive = Math.max(0, Math.min(1, (this.speed - DRIVE_FROM) / (DRIVE_FULL - DRIVE_FROM)));
    // A hesitation: he comes up out of his crouch as if to stop or shoot, then gets low again to go.
    const hesi = fake?.kind === 'hesi' ? Math.sin(Math.PI * Math.min(1, fake.k / 0.75)) : 0;
    const low = Math.max(crouch, this.dip * 0.4, this.dribbling * (this.routine ? ROUTINE_LOW : (DRIBBLE_CROUCH[0] + (DRIBBLE_CROUCH[1] - DRIBBLE_CROUCH[0]) * drive) * (1 - 0.8 * hesi)));
    for (const k of Object.keys(weights)) weights[k] *= (1 - low) * (1 - air);
    // How much of him is the plain standing clip (not a crouch, a dip, a dribble or a jump).
    const idleShare = weights[CLIP.idle] ?? 0;
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
    // The library's clips set the leg bones' lengths too, from their own smaller rig (thigh and shin
    // together about 9 cm short of this body's): each leg gets its own bones back, and the hips go up
    // by the same share, so he is as tall as he is and his feet stay on the floor.
    this.ownLegs();
    // Standing tall: the library's idle stands him with his knees bent about 20°, which takes about
    // 5 cm off his height. A player standing on court is close to straight: his hips go up and his
    // legs straighten under them (each foot stays where it is), most of the way to a relaxed 172°.
    const tall = STAND_TALL * idleShare;
    if (tall > 0.01) this.standTall(tall);
    // Going up for a ball (a rebound, a tip): each man his own way, one off one foot, knee up, another
    // off both, knees tucked a little; never all the same.
    if (reaching && air > 0) this.jumpLegs(key, air);
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
      // Eased (about 0.3 s): the standing and the moving pose hold the hand in different places, and a
      // switch with every change of pace would move the palm out from under a ball in the air.
      this.dribMoveS += ((this.routine ? 1 : Math.max(0, Math.min(1, (this.speed - 0.3) / 0.9))) - this.dribMoveS) * (1 - Math.exp(-dt / (this.routine ? 0.1 : 0.3)));
      this.dribPace += (this.speed - this.dribPace) * (1 - Math.exp(-dt / 0.5));
      moveK = this.dribMoveS;
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

    // The dribble's frame turns with him, eased (see toBody).
    {
      const hipsNow = Math.PI / 2 - this.yaw;
      const turn = Math.atan2(Math.sin(hipsNow - this.dribHeading), Math.cos(hipsNow - this.dribHeading));
      this.dribHeading = this.drib ? this.dribHeading + turn * (1 - Math.exp(-dt / 0.2)) : hipsNow;
      // His place, smoothed over a few hundredths of a second: the 2D layer's spacing nudges him by
      // millimetres from frame to frame, which the ball would show as a wobble.
      if (!this.drib || this.dribRoot.distanceTo(this.root.position) > 0.5) this.dribRoot.copy(this.root.position);
      else this.dribRoot.lerp(this.root.position, 1 - Math.exp(-dt / 0.06));
      this.dribRoot.y = 0;
    }
    // On the move, the dribbling arm swung out to his side.
    this.dribDown = moveK * (1 - drive);
    // The hand out at his side whether he stands or runs (only how far ahead, and how low, go with his
    // pace): a change of pace while the ball is in the air must not move it from under the ball.
    this.dribOut = 1;
    for (const sd of ['l', 'r'] as const) this.dribbleArmOut(sd, this.dribArm[sd] * this.dribOut, this.dribArm[sd] * this.dribDown);
    // A crossover: he sells the side the ball is on (shoulder and hips dip that way), then the ball
    // goes across low and he goes the other way, leaning into it.
    if (fake?.kind === 'cross') {
      const was = this.crossedTo === 'l' ? 1 : -1;
      const lean = fake.k < 0.45 ? Math.sin((Math.PI * fake.k) / 0.45) * was : -Math.sin((Math.PI * (fake.k - 0.45)) / 0.55) * was;
      const ahead = new THREE.Vector3(Math.cos(this.facing), 0, Math.sin(this.facing));
      turnWorld(this.bones.spine_01, ahead, CROSS_LEAN * lean);
      turnWorld(this.bones.spine_03, ahead, CROSS_LEAN * 0.5 * lean);
      this.root.updateMatrixWorld(true);
    }
    this.plantFeet(air > 0, dt);
    if (air === 0) this.groundFeet();
    // Up onto his toes as he shoots a free throw, held there through the release, then the heels down.
    if (ft && ft.toes > 0.001) this.upOnToes(ft.toes);
    // Going up for the ball, or up for a jump shot, his legs hang straight under him, feet together (a
    // hand's width apart), not in the standing clip's stance.
    if (this.dunk?.from && air > 0) {
      // Up for a dunk: off one foot, the other knee driven up in front of him, the take-off leg
      // trailing straight below.
      const hl = this.legs.l.upper.getWorldPosition(new THREE.Vector3());
      const hr = this.legs.r.upper.getWorldPosition(new THREE.Vector3());
      const across = hr.clone().sub(hl).setY(0).normalize();
      const front = new THREE.Vector3().crossVectors(UP, across).normalize();
      for (const leg of [this.legs.l, this.legs.r]) {
        const hip = leg.upper.getWorldPosition(new THREE.Vector3());
        const knee = leg.lower.getWorldPosition(new THREE.Vector3());
        const len = hip.distanceTo(knee) + knee.distanceTo(leg.hand.getWorldPosition(new THREE.Vector3()));
        const drive = leg === this.legs.l;
        // The knee comes up hard off the floor and lets down a little towards the top.
        const kneeUp = 1 - 0.45 * Math.min(1, this.dunk.flown);
        const foot = drive
          ? hip.clone().addScaledVector(front, len * 0.22 * kneeUp).add(new THREE.Vector3(0, -len * (0.95 - 0.33 * kneeUp), 0))
          : hip.clone().addScaledVector(front, -len * 0.18).add(new THREE.Vector3(0, -len * 0.95, 0));
        reach(leg, foot, knee.clone().addScaledVector(front, 0.6), air);
      }
    } else if ((reaching || jumper) && air > 0) {
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
    // The body and the clips' arms within human range before the arms are placed (the arm code then
    // keeps them there itself).
    this.limits.apply(BODY_JOINTS);
    this.arms3d(key, frame, action, holder, lift, dt, coming, passSoon, next);
    // The arms as placed (reaching, defending, holding the ball) are held to what a shoulder and an
    // elbow can do too, not only the clips.
    this.limits.apply(ARM_JOINTS);
    this.openHands();
    // The head: level and to the ball (as the frame has it turned); a shooter or dunker looks at the
    // rim, from the gather to the landing.
    {
      const headAt = this.bones.Head.getWorldPosition(new THREE.Vector3());
      let toward: THREE.Vector3;
      if (aim) toward = toScene(aim.to.x, aim.to.y, aim.to.z ?? RIM_HEIGHT).sub(headAt);
      // Selling a fake with his eyes: the rim at a pump fake or a hesitation, the way he shows the ball
      // at a pass fake.
      else if (fake && fake.k >= 0 && (fake.kind === 'pump' || fake.kind === 'hesi') && shotNext) toward = toScene(shotNext.to.x, shotNext.to.y, RIM_HEIGHT).sub(headAt);
      else if (fake?.kind === 'pass' && fake.toward) toward = toScene(fake.toward.x, fake.toward.y, 1.6).sub(headAt);
      else if ((reaching && air > 0) || this.posture === 'ready' || this.posture === 'rebound' || this.posture === 'lane') toward = toScene(frame.ball.x, frame.ball.y, frame.ball.z).sub(headAt);
      else {
        const l = frame.look?.[key] ?? this.facing;
        toward = new THREE.Vector3(Math.cos(l), 0, Math.sin(l));
      }
      this.lookTowards(toward);
    }
    // The neck and head after he has turned them, and the hands after everything placed them.
    this.limits.apply(LAST_JOINTS);
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
      // At the free-throw line: he steps into his stance, feet square (see FT_FEET_*), and they stay.
      let stepUp = 0;
      if (this.atLine && !airborne) {
        const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
        const s = side === 'r' ? 1 : -1;
        const want = this.root.position.clone().setY(toe.y).addScaledVector(right, s * FT_FEET_SIDE_M).addScaledVector(fwd, FT_FEET_FWD_M + (side === 'r' ? FT_FEET_LEAD_M : 0));
        if (!lock.at) {
          lock.at = toe.clone();
          lock.yaw = this.root.rotation.y;
        }
        const left = Math.hypot(want.x - lock.at.x, want.z - lock.at.z);
        // One foot at a time: the right waits until the left is down.
        const other = this.locks.l;
        const go = side === 'l' || !other.at || Math.hypot(other.at.x - (this.root.position.x - right.x * FT_FEET_SIDE_M + fwd.x * FT_FEET_FWD_M), other.at.z - (this.root.position.z - right.z * FT_FEET_SIDE_M + fwd.z * FT_FEET_FWD_M)) < 0.03;
        if (go && left > 0.01) {
          lock.at.lerp(want.setY(lock.at.y), 1 - Math.exp(-dt / FT_FEET_STEP_S));
          stepUp = Math.min(0.07, left * 0.6);
        }
        lock.yaw += (this.root.rotation.y - lock.yaw) * (1 - Math.exp(-dt / FT_FEET_STEP_S));
        lock.w = 1;
      }
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
      const hold = (this.atLine && !airborne) || (down && strain < LOCK_GIVE_M);
      lock.w = Math.max(0, Math.min(1, lock.w + (hold ? 1 : -1) * LOCK_RATE * dt));
      if (!down && lock.w === 0) lock.at = null;
      target.y += stepUp;
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

  /** See update: the legs' own bone lengths, and the clips' hip height scaled up to them. */
  private ownLegs(): void {
    const clipLeg = this.bones.calf_l.position.length() + this.bones.foot_l.position.length();
    const ownLeg = this.legBind.calf_l.length() + this.legBind.foot_l.length();
    for (const [name, p] of Object.entries(this.legBind)) this.bones[name].position.copy(p);
    if (clipLeg < 1e-6) return;
    const pelvis = this.bones.pelvis;
    this.root.updateMatrixWorld(true);
    const at = pelvis.getWorldPosition(new THREE.Vector3());
    at.y = this.root.position.y + (at.y - this.root.position.y) * (ownLeg / clipLeg);
    pelvis.position.copy(pelvis.parent!.worldToLocal(at));
    pelvis.updateMatrixWorld(true);
  }

  /**
   * The dunk's height (m). The frame lifts him from the first moment of the shot on a smooth curve to
   * the top at the release; a real dunk is a plant (the last step, knees bent, the ball brought down
   * to the hip) and then a jump: off the floor at a speed, on an arc under gravity, to the same height
   * at the same moment. The frame's curve tells how far through its rise it is (it is a quarter sine),
   * and so how long the rise lasts; the jump takes `sqrt(2h/g)` of the end of it, the plant the start.
   * After the top the frame's own descent (and the hang on the rim) go on as before.
   */
  private dunkJump(raw: number, dt: number): number {
    const jump = SHOTS.dunk.jump;
    const j = (this.dunk ??= { t: 0, rawTop: 0, rise: DUNK_RISE_S, from: null, flown: 0, peaked: false });
    j.t += dt;
    if (raw < j.rawTop - 1e-4 || j.peaked) {
      j.peaked = true;
      j.flown = 1;
      return raw;
    }
    j.rawTop = raw;
    const p = (2 / Math.PI) * Math.asin(Math.min(1, raw / jump));
    // How long the frame's rise lasts: from how far through it is, once that can be read well.
    if (p > 0.15 && p < 0.95) j.rise = j.t / p;
    const up = Math.min(j.rise, Math.sqrt((2 * jump) / GRAVITY));
    const offAt = j.rise - up;
    if (j.t < offAt) {
      j.flown = 0;
      return 0;
    }
    const tau = Math.min(1, (j.t - offAt) / up);
    j.flown = tau;
    return Math.max(0.001, jump * tau * (2 - tau));
  }

  /**
   * Where he is in a free throw (null when not shooting one), from the time to the release:
   * `lift` 0 to 1 over the lifting phase (ball from the waist to the set point, knees bending),
   * `project` 0 to 1 over the projection phase (legs and arm extending, up onto his toes, the release
   * at its end), `toes` how far up on his toes (held after the release, then down).
   */
  private freeThrow(): { r: number; lift: number; project: number; toes: number } | null {
    const r = this.ftR;
    if (r === null) return null;
    const ease = (x: number) => {
      const c = Math.max(0, Math.min(1, x));
      return c * c * (3 - 2 * c);
    };
    const lift = ease((FT_LIFT_FROM - r) / (FT_LIFT_FROM - FT_SET_AT));
    const project = ease((FT_SET_AT - r) / FT_SET_AT);
    const toes = r > 0 ? project : 1 - ease((-r - FT_TOES_HOLD_S) / 0.25);
    return { r, lift, project, toes };
  }

  /** Up on the balls of his feet by `k` of FT_TOES_M: heels off the floor, toes where they are. */
  private upOnToes(k: number): void {
    const h = FT_TOES_M * k;
    this.root.position.y += h;
    this.root.updateMatrixWorld(true);
    const side = new THREE.Vector3().crossVectors(new THREE.Vector3(Math.cos(this.facing), 0, Math.sin(this.facing)), UP).normalize();
    for (const s of ['l', 'r'] as const) {
      const ankle = this.bones[`foot_${s}`].getWorldPosition(new THREE.Vector3());
      const ball = this.bones[`ball_${s}`].getWorldPosition(new THREE.Vector3());
      const len = ankle.distanceTo(ball);
      if (len < 1e-3) continue;
      // The foot turns about the ankle until the ball of the foot is back down where it was.
      const a0 = Math.asin(Math.max(-1, Math.min(1, (ankle.y - ball.y) / len)));
      const a1 = Math.asin(Math.max(-1, Math.min(1, (ankle.y - ball.y + h) / len)));
      turnWorld(this.bones[`foot_${s}`], side, -(a1 - a0));
    }
  }

  /**
   * Legs in the air going up for the ball, `k` 0 to 1 (how far into the jump). Each player has his
   * own style, from his key: off one foot (the lead knee up in front, the other leg trailing down and a
   * little back) or off both (both knees tucked a little, one more than the other).
   */
  private jumpLegs(key: string, k: number): void {
    const h = hashString(key);
    const oneFoot = h % 100 < 55;
    const lead: 'l' | 'r' = (h >> 3) % 2 ? 'l' : 'r';
    const fwd = new THREE.Vector3(Math.cos(this.facing), 0, Math.sin(this.facing));
    for (const side of ['l', 'r'] as const) {
      const leg = this.legs[side];
      const hip = leg.upper.getWorldPosition(new THREE.Vector3());
      const ankle = leg.hand.getWorldPosition(new THREE.Vector3());
      const lift = oneFoot ? (side === lead ? 0.42 : 0.04) : side === lead ? 0.2 : 0.12;
      const forward = oneFoot ? (side === lead ? 0.3 : -0.14) : side === lead ? 0.06 : -0.04;
      const target = hip.clone().add(new THREE.Vector3(0, -(hip.y - ankle.y) + lift, 0)).addScaledVector(fwd, forward);
      const pole = hip.clone().addScaledVector(fwd, 1).add(new THREE.Vector3(0, -0.3, 0));
      reach(leg, ankle.clone().lerp(target, Math.min(1, k)), pole, 1);
    }
  }

  /** Hips up and legs straighter by `k` (0 to 1) of the way to a relaxed stand, the feet kept where they are. */
  private standTall(k: number): void {
    const fwd = new THREE.Vector3(Math.cos(this.facing), 0, Math.sin(this.facing));
    const legs = (['l', 'r'] as const).map((side) => {
      const leg = this.legs[side];
      const hip = leg.upper.getWorldPosition(new THREE.Vector3());
      const knee = leg.lower.getWorldPosition(new THREE.Vector3());
      const ankle = leg.hand.getWorldPosition(new THREE.Vector3());
      const a = hip.distanceTo(knee);
      const b = knee.distanceTo(ankle);
      // Hip to ankle with the knee at the relaxed angle; how much higher the hip can then be.
      const reachM = Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(STAND_KNEE));
      const flat = Math.hypot(hip.x - ankle.x, hip.z - ankle.z);
      const up = reachM > flat ? Math.sqrt(reachM * reachM - flat * flat) - (hip.y - ankle.y) : 0;
      return { leg, ankle, footQ: leg.hand.getWorldQuaternion(new THREE.Quaternion()), up };
    });
    const raise = Math.max(0, Math.min(...legs.map((l) => l.up))) * k;
    if (raise < 0.002) return;
    const pelvis = this.bones.pelvis;
    const at = pelvis.getWorldPosition(new THREE.Vector3());
    at.y += raise;
    pelvis.position.copy(pelvis.parent!.worldToLocal(at));
    pelvis.updateMatrixWorld(true);
    for (const { leg, ankle, footQ } of legs) {
      const pole = leg.lower.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 0.6);
      reach(leg, ankle, pole, 1);
      const parent = leg.hand.parent!.getWorldQuaternion(new THREE.Quaternion());
      leg.hand.quaternion.copy(parent.invert().multiply(footQ));
      leg.hand.updateMatrixWorld(true);
    }
  }

  /**
   * Feet on the floor, never in it: a crouch or the stance clip lowers his hips, and a leg posed for
   * a taller stance would push the foot through the floor. A foot that has gone below where it is
   * standing is lifted back up, its angle kept, and the knee bends to take it: he sits lower, he
   * does not shrink.
   */
  private groundFeet(): void {
    const floor = this.root.position.y;
    const fwd = new THREE.Vector3(Math.cos(this.facing), 0, Math.sin(this.facing));
    for (const side of ['l', 'r'] as const) {
      const leg = this.legs[side];
      const ankle = leg.hand.getWorldPosition(new THREE.Vector3());
      const toe = this.bones[`ball_${side}`].getWorldPosition(new THREE.Vector3());
      const tip = this.bones[`ball_leaf_${side}`].getWorldPosition(new THREE.Vector3());
      const sink = Math.max(floor + this.ankleRest - 0.01 - ankle.y, floor + this.toeRest - 0.005 - toe.y, floor + this.tipRest - 0.005 - tip.y);
      if (sink <= 0) continue;
      const footQ = leg.hand.getWorldQuaternion(new THREE.Quaternion());
      const knee = leg.lower.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 0.6);
      reach(leg, ankle.clone().add(new THREE.Vector3(0, sink, 0)), knee, 1);
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
  get dribbleInfo(): { phase: string; ball: THREE.Vector3; gap: number; rising: number; side: 'l' | 'r'; clipT: number; rate: number; speed: number; vel: THREE.Vector3 } | null {
    return this.drib
      ? { phase: this.drib.phase, ball: this.drib.pos.clone(), gap: this.drib.gap, rising: this.drib.rising, side: this.dribSide, clipT: this.dribT, rate: this.dribRate, speed: this.speed, vel: this.vel.clone() }
      : null;
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

  /**
   * On the move, the dribbling hand placed where a running dribble has it: out from his side clear of
   * his legs (at least DRIBBLE_HAND_OUT_M from his middle), ahead of his hip by his pace (the ball is
   * pushed out in front and he runs onto it), and lower (the clip's hand is for a crouched stance; he
   * runs upright). `out`: how much he is moving (0 standing: the clip's hand as it is), `down`: how
   * much lower. The clip still gives the hand its rhythm up and down and its turn on the ball; the
   * arm reaches there, elbow out and back, the hand keeping its own angle.
   */
  private dribbleArmOut(side: 'l' | 'r', out: number, down: number): void {
    if (out <= 0 && down <= 0) return;
    const arm = this.arms[side];
    const hand = arm.hand;
    const keep = hand.getWorldQuaternion(new THREE.Quaternion());
    const now = this.toBody(hand.getWorldPosition(new THREE.Vector3()));
    const s = side === 'r' ? 1 : -1;
    // His pace, slowly smoothed: the hand's place must hardly move while the ball is in the air.
    const pace = Math.max(0, Math.min(1, (this.dribPace - 0.3) / 1.7));
    const wide = Math.max(s * now.z, s * now.z + (DRIBBLE_HAND_OUT_M - s * now.z) * out);
    const plain = new THREE.Vector3(now.x + DRIBBLE_HAND_FWD_M * pace * out, now.y - DRIBBLE_HAND_DROP_M * down, s * wide);
    // The pocket: the hand on the side of the ball carries it back to his hip, beside and a little
    // behind it, before pushing it down: the ball on his body's far side from the defence.
    const pocket = new THREE.Vector3(POCKET_BACK_M, Math.max(plain.y, this.hipHeight() + POCKET_ABOVE_HIP_M), s * POCKET_OUT_M);
    // At the free-throw line: straight down in front of him (the clip still gives the hand its rhythm).
    if (this.routine) plain.set(ROUTINE_FWD_M, now.y, s * ROUTINE_SIDE_M);
    const target = this.fromBody(plain.lerp(pocket, this.dribPocket));
    const hips = this.dribHeading;
    const ahead = new THREE.Vector3(Math.cos(hips), 0, Math.sin(hips));
    const across = new THREE.Vector3().crossVectors(ahead, UP).normalize();
    const shoulder = arm.upper.getWorldPosition(new THREE.Vector3());
    const elbow = shoulder.addScaledVector(across, s * 0.5).addScaledVector(ahead, -0.4).add(new THREE.Vector3(0, -0.3, 0));
    reach(arm, target, elbow, 1);
    // The hand keeps the angle the clip gave it (palm on the ball), whatever the arm did.
    hand.quaternion.copy(hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(keep));
    hand.updateMatrixWorld(true);
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
    this.dribbleArmOut(side, this.dribOut, this.dribDown);
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

  /**
   * A point in his own frame (x ahead, z to his right, y up from the floor) and back. Ahead: his hips'
   * heading eased over a moment (the hips snap round as he goes from running to sliding to backing up;
   * the ball must not swing with that, only with his real turning).
   */
  /** How high his hips are now (m): the pelvis bone. */
  private hipHeight(): number {
    return this.bones.pelvis.getWorldPosition(new THREE.Vector3()).y;
  }
  private toBody(p: THREE.Vector3): THREE.Vector3 {
    const hips = this.dribHeading;
    const f = new THREE.Vector3(Math.cos(hips), 0, Math.sin(hips));
    const r = new THREE.Vector3().crossVectors(f, UP).normalize();
    const v = p.clone().sub(this.dribRoot);
    return new THREE.Vector3(v.dot(f), p.y, v.dot(r));
  }
  private fromBody(l: THREE.Vector3): THREE.Vector3 {
    const hips = this.dribHeading;
    const f = new THREE.Vector3(Math.cos(hips), 0, Math.sin(hips));
    const r = new THREE.Vector3().crossVectors(f, UP).normalize();
    return this.dribRoot.clone().setY(l.y).addScaledVector(f, l.x).addScaledVector(r, l.z);
  }

  /**
   * The dribbled ball, in time with the dribble clip (CLAUDE.md: the hand meets it at the top of the
   * bounce; it never sticks to the hand).
   *
   * In contact (from a top to the lowest push point) it is under the palm and the clip pushes it down.
   * At the lowest point it is let go, down at the speed that, with gravity and one bounce off the floor
   * (restitution 0.8), brings it up to a peak at the palm's height at the clip's next top. The clip's
   * rise is played so the hand gets to that top as the ball peaks, and the push quick enough that the
   * whole bounce takes the cycle for his speed (0.75 s standing, 0.6 s running).
   *
   * Up and down that is physics, exactly. Across, its way is laid out in his own frame: to the bounce
   * spot beside his foot (ahead of him on the move, back by his foot when guarded), then up to his palm.
   * So it goes where he goes: the 2D layer turns him, stops him and starts him without warning, and a
   * ball aimed once in the world would end up away from him. (When he changes pace or turns while it is
   * in the air, it changes course across with him, as much as his body does.)
   *
   * `want`: the hand away from the defender (a crossover changes hands at a release); `ending`: catch
   * it at the next top and hold it.
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
      // The pocket dribble keeps the hand on the ball longer at a walk (carrying it back to the hip
      // before the push); at a run the push is as short as the cycle allows.
      const minPush = Math.max(DRIBBLE_PUSH_MIN_S, this.routine ? 0 : POCKET_HOLD_S * (1 - run));
      this.dribRate = (low - this.dribT) / Math.max(minPush, cycle - b.down - b.up);
    };
    if (!this.drib) {
      // The first bounce starts from where the ball is (held in both hands, say): the hand goes onto
      // it there and pushes it down from there, not from where the clip's hand happens to be.
      const palm = this.ballInPalm(this.dribSide);
      const pos = this.ballShown && this.ballShown.distanceTo(palm) < 0.9 ? this.ballShown.clone() : palm;
      this.drib = { phase: ending ? 'held' : 'contact', pos, from: new THREE.Vector3(), spot: new THREE.Vector3(), y0: 0, down: 0, tDown: 0, tUp: 0, since: 0, bounced: false, backAt: 0, gap: 0, rising: 0, reach: pos.clone().sub(palm), caughtAt: this.dribT, lowAt: after(ev.lows, this.dribT) };
      startPush();
    }
    const d = this.drib;
    if (d.phase === 'flight') {
      d.since += dt;
      this.dribPocket = 0;
      const t = d.since;
      if (!d.bounced && t >= d.tDown) {
        // The floor: the clip's rise timed to the ball's (what is left of it after this frame).
        d.bounced = true;
        this.dribRate = Math.max(0.05, (d.backAt - this.dribT) / Math.max(0.02, d.tUp - (t - d.tDown)));
      }
      // Up and down: gravity, and the bounce at restitution 0.8.
      const upSpeed = RESTITUTION * (d.down + GRAVITY * d.tDown);
      const y = t < d.tDown ? d.y0 - d.down * t - 0.5 * GRAVITY * t * t : BALL_R + upSpeed * (t - d.tDown) - 0.5 * GRAVITY * (t - d.tDown) ** 2;
      // Across, in his frame: one straight line at one speed, from where it left the palm to where the
      // palm takes it at the top. A ball without spin keeps its speed across through the bounce: it
      // comes off the floor at the angle it went in. (Where it bounces follows: on that line, where
      // gravity brings it down.)
      const across = d.from.clone().lerp(d.spot, Math.min(1, t / (d.tDown + d.tUp)));
      d.pos = this.fromBody(across.setY(Math.max(BALL_R, y)));
      if (ev.tops.some(passed) || (d.bounced && upSpeed - GRAVITY * (t - d.tDown) <= 0)) {
        // The top (the clip's, or the ball's own peak, whichever comes first): the hand meets it.
        const there = this.ballInPalm(this.dribSide);
        d.gap = d.pos.distanceTo(there);
        d.rising = upSpeed - GRAVITY * (t - d.tDown);
        d.reach = d.pos.clone().sub(there);
        d.phase = ending ? 'held' : 'contact';
        d.caughtAt = this.dribT;
        d.lowAt = after(ev.lows, this.dribT);
        startPush();
      }
      return d;
    }
    // In the hand: under the palm (what is left of a catch off it, the push takes back).
    const back = d.lowAt > d.caughtAt ? Math.max(0, Math.min(1, (this.dribT - d.caughtAt) / (d.lowAt - d.caughtAt))) : 1;
    const k = 1 - back * back * (3 - 2 * back);
    if (d.phase === 'held') {
      if (!ending) {
        d.phase = 'contact';
        d.reach = d.pos.clone().sub(this.ballInPalm(this.dribSide));
        d.caughtAt = this.dribT;
        d.lowAt = after(ev.lows, this.dribT);
        startPush();
        return d;
      }
      // Holding it, the dribble about to end: in to his hip on that side, the hand carrying it there.
      const pocket = this.fromBody(new THREE.Vector3(0.12, this.ballInPalm(this.dribSide).y - 0.08, (this.dribSide === 'r' ? 1 : -1) * 0.3));
      d.pos = d.pos.clone().lerp(pocket, 1 - Math.exp(-dt / 0.12));
      return d;
    }
    d.pos = this.ballInPalm(this.dribSide).addScaledVector(d.reach, k);
    // On the push the hand pockets the ball first: back to his hip and out again on the way down
    // (most at a walk, less at a run, where the ball goes out ahead of him).
    this.dribPocket = this.routine ? 0 : Math.sin(Math.PI * back) * (1 - run) * POCKET_SHARE;
    if (ev.lows.some(passed)) {
      this.dribPocket = 0;
      // The lowest push point: let go. A crossover: the other hand takes it at the next top.
      this.dribSide = want;
      const back = after(ev.tops, this.dribT);
      const b = Player3D.bounce(d.pos.y, this.ballInPalmAt(this.dribSide, back).y);
      d.phase = 'flight';
      d.from = this.toBody(d.pos);
      // Where the palm will take it at the top, in his frame.
      d.spot = this.toBody(this.ballInPalmAt(this.dribSide, back));
      d.y0 = d.pos.y;
      d.down = b.speed;
      d.tDown = b.down;
      d.tUp = b.up;
      d.since = 0;
      d.bounced = false;
      d.backAt = back;
      this.dribRate = (back - this.dribT) / (b.down + b.up);
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
  ball(frameBall: THREE.Vector3, dt: number, drawn?: THREE.Vector3): THREE.Vector3 {
    if (this.ballAt) {
      // Taken up from where it is on screen (not snapped into the hands): blended in over a moment.
      if (!this.heldBefore) {
        this.blendFrom = (drawn ?? frameBall).clone();
        this.blendIn = 0;
        // From far off (the frame hands it to him before a pass has got there): it comes to him at a
        // pass's speed, not in an instant.
        this.blendTime = Math.max(0.15, Math.min(0.6, this.blendFrom.distanceTo(this.ballAt) / BALL_CATCH_UP_M_S));
      } else if (this.ballShown && this.blendIn >= 1 && this.ballShown.distanceTo(this.ballAt) > BALL_HANDOFF_M + 12 * dt) {
        // From one way of holding it to another (a dribble caught, then picked up for a pass): the
        // hands carry it across, it does not jump.
        this.blendFrom = this.ballShown.clone();
        this.blendIn = 0;
        this.blendTime = 0.12;
      }
      this.heldBefore = true;
      this.blendIn = Math.min(1, this.blendIn + dt / this.blendTime);
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

  /** How far past their human limits his joints are right now (radians; the checker). */
  jointExcess(): JointExcess[] {
    return this.limits.measure();
  }
  /** Joint limits on or off (off: the checker sees what the poses would do without them). */
  setJointLimits(on: boolean): void {
    this.limits.enabled = on;
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
    this.limits.apply([`hand_${side}`]);
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
    // His shot: from the gather until his own ball is at the rim (the frame drops the shooter flag on the way,
    // but he still holds his follow-through until then).
    const shooting = !!coming || (action?.kind === 'fromPlayer' && action.from === key && (frame.shooter === key || this.released > 0));
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
     * A direction on the floor an arm can reach towards: anything in front, or out to its own side
     * up to 30 degrees behind it. Something further round behind him he reaches for out to that side
     * (a shoulder does not swing an arm straight back).
     */
    const reachable = (arm: Arm, d: THREE.Vector3): THREE.Vector3 => {
      const f = d.dot(fwd);
      if (f >= -0.5) return d.clone();
      return right.clone().multiplyScalar(arm.side * Math.cos(Math.PI / 6)).addScaledVector(fwd, -0.5).normalize();
    };
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
        if (this.hangT < DUNK_HANG_S) {
          // His hands go to the rim the whole time he hangs (as he is lifted into the hang they reach it).
          if (shoulder.distanceTo(grip) < armLen * 0.98) onRim++;
          palmOn(arm, grip.clone().add(new THREE.Vector3(0, -BALL_R, 0)), up.clone(), toRim.clone());
        }
        // Let go: his arms come down by his sides as the clip has them (not aimed back at the rim).
      }
      if (this.hangT > DUNK_HANG_S + 0.6) this.dunkRim = null;
      return onRim ? `dunk: hands on the rim (${onRim})` : this.hangT < DUNK_HANG_S ? 'dunk: hands to the rim' : 'dunk: let go, coming down';
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
          // On the floor (the plant) the ball at his waist in both hands; up in the air it goes up with
          // him, over his head and out to the rim by the top of his jump.
          const upK = Math.min(1, lift / (SHOTS.dunk.jump * 0.85));
          const rise = upK * upK * (3 - 2 * upK);
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
          // One smooth path, as in a real one: in the dip, still on the floor, the ball comes up from the
          // waist to the chin (ball elevation); on the way up it goes on to the set point, which it
          // reaches just before the top, and he lets it go at the top. `s`: how far along (0 to 1).
          const dipping = !!coming && lift < 0.02;
          // (By time, not height: he rises as a sine of the time to the release, fast at first, so the
          // share of the time is the arcsine of the share of the height.)
          const risen = (2 / Math.PI) * Math.asin(Math.max(0, Math.min(1, p)));
          const sAlong = dipping && next ? SHOT_CHIN_AT * Math.max(0, Math.min(1, 1 - next.in / GATHER_S)) : SHOT_CHIN_AT + (1 - SHOT_CHIN_AT) * Math.min(1, risen / SHOT_SET_AT);
          this.shotAlong = Math.max(this.shotAlong, sAlong);
          const sNow = this.shotAlong;
          // Through the three points with an eased Bezier: no stop at the chin, no corner.
          const ctrl = gather.clone().lerp(chin, 0.5).add(chin.clone().sub(gather).multiplyScalar(0.25)).lerp(chin.clone().lerp(set, 0.5), 0.5);
          const e = sNow * sNow * (3 - 2 * sNow);
          let at = gather.clone().multiplyScalar((1 - e) * (1 - e)).addScaledVector(ctrl, 2 * e * (1 - e)).addScaledVector(set, e * e);
          /** How far into the set: 0 at the gather (hands on the sides), 1 at the set point (under and behind, cocked). */
          let cock = e;
          arms = dipping ? 'jump shot 1/6: dip, ball up to the chin' : sNow < 0.999 ? 'jump shot 2/6: rising, ball to the set point' : 'jump shot 3/6: set point';
          const ft = style === 'set' ? this.freeThrow() : null;
          if (ft) {
            // A free throw: from the waist (E1) up past the chin to the set point (E2) as the knees bend,
            // then on up and forward as the arm extends (E3, the release at the end of it).
            const waist = chest.clone().addScaledVector(toRim, FT_WAIST_FWD_M).add(new THREE.Vector3(0, -FT_WAIST_DOWN_M, 0));
            const c2 = waist.clone().lerp(chin, 0.5).add(chin.clone().sub(waist).multiplyScalar(0.25)).lerp(chin.clone().lerp(set, 0.5), 0.5);
            const f = ft.lift;
            at = waist.multiplyScalar((1 - f) * (1 - f)).addScaledVector(c2, 2 * f * (1 - f)).addScaledVector(set, f * f).add(ftProjection(toRim, ft.project));
            cock = f;
            arms = ft.lift <= 0.001 ? 'free throw E1: ball at the waist' : ft.project <= 0.001 ? (ft.lift < 0.999 ? 'free throw P1: lifting, knees bending' : 'free throw E2: set, knees bent') : 'free throw P2: projection, legs and arm extending';
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
          // A free throw is let go from further up, the arm already extending (the projection phase).
          if (style === 'set') set.add(ftProjection(toRim, 1));
          const setWrist = set.addScaledVector(toRim, -0.12).add(new THREE.Vector3(0, -0.14, 0));
          // Up and forward towards the rim, about 60 degrees up (not straight up), as in the reference.
          // The arm all but straight (its own length from the shoulder), elbow locked.
          const upperR = this.arms.r.upper.getWorldPosition(new THREE.Vector3());
          const elbowR = this.arms.r.lower.getWorldPosition(new THREE.Vector3());
          const forearm = upperR.distanceTo(elbowR) + elbowR.distanceTo(this.arms.r.hand.getWorldPosition(new THREE.Vector3()));
          const full = shoulderR.clone().addScaledVector(toRim.clone().multiplyScalar(0.5).add(new THREE.Vector3(0, 0.87, 0)).normalize(), forearm * 0.96);
          const r = Math.min(1, this.released * 1.6);
          const reachUp = setWrist.lerp(full, r * r * (3 - 2 * r));
          reachTo(this.arms.r, reachUp, 1, shoulderR.clone().addScaledVector(toRim, 0.7).add(new THREE.Vector3(0, -0.2, 0)));
          // The follow-through: the wrist snapped right over (a "gooseneck", about 80°): with the
          // forearm up at the rim, the fingers end pointing down and forward at it, curled in towards
          // the palm, and held like that.
          const snap = Math.min(1, this.released * 1.4);
          this.orient('r', toRim.clone().negate().add(new THREE.Vector3(0, -0.55, 0)), toRim.clone().multiplyScalar(0.55).add(new THREE.Vector3(0, -1, 0)), snap, SHOT_WRIST_SNAP);
          this.curl.r = CUP + (SHOT_FINGER_CURL - CUP) * snap;
          // The guide hand comes off the ball and stays up beside his head, palm in, as the shooting arm
          // goes through; down on the floor both come down, gently.
          const guideTo = shoulderL.clone().addScaledVector(toRim, 0.22).addScaledVector(across, -0.22).add(new THREE.Vector3(0, 0.38, 0));
          this.landedFor = lift > 0.05 ? 0 : this.landedFor + dt;
          // A set shot (a free throw) never leaves the floor: he holds the follow-through until the ball is at the rim.
          const hold = style === 'set' ? SHOT_HOLD_SET_S : SHOT_HOLD_LANDED_S;
          const down = Math.max(0, Math.min(1, (this.landedFor - hold) / 0.4));
          const keep = 1 - down * down * (3 - 2 * down);
          reachTo(this.arms.l, guideTo, 0.9 * keep, shoulderL.clone().addScaledVector(across, -0.6).add(new THREE.Vector3(0, -0.3, 0)));
          this.orient('l', across.clone(), up.clone().addScaledVector(toRim, 0.3), 0.9 * keep);
          if (keep < 1) {
            // The shooting arm too, after its follow-through has been held a moment on the floor.
            const restR = shoulderR.clone().addScaledVector(toRim, 0.15).addScaledVector(across, 0.12).add(new THREE.Vector3(0, -0.55, 0));
            reachTo(this.arms.r, restR, 1 - keep, shoulderR.clone().addScaledVector(toRim, -0.4).add(new THREE.Vector3(0, -0.4, 0)));
          }
        }
      }
      this.state.arms = arms;
      return;
    }
    this.released = 0;
    this.shotAlong = 0;
    this.landedFor = 0;
    this.shotBall = null;
    if (this.dunkRim && holder !== key) {
      this.state.arms = hangOnRim();
      return;
    }
    this.dunkRim = null;
    if (!passSoon && !(action?.kind === 'pass' && action.from === key)) this.passOut = 0;
    const fake = frame.fake && frame.fake.key === key && holder === key && frame.fake.k >= 0 ? frame.fake : null;
    if (fake && (fake.kind === 'pump' || fake.kind === 'pass') && this.drib?.phase !== 'flight') {
      openBoth();
      const bell = Math.sin(Math.PI * fake.k);
      const held = chest.clone().addScaledVector(fwd, 0.34).add(new THREE.Vector3(0, -0.22, 0));
      if (fake.kind === 'pump') {
        // Up as if to shoot: the ball to the set point above his forehead, eyes on the rim, then back
        // down to his chest, quick (a real pump fake is a sharp half shot, not a slow lift).
        arms = 'pump fake: up as if to shoot, and down';
        const head = this.bones.Head.getWorldPosition(new THREE.Vector3());
        const set = head.clone().addScaledVector(fwd, 0.28).add(new THREE.Vector3(0, 0.22, 0));
        const up = Math.min(1, bell * 1.25);
        this.ballAt = twoHands(held.clone().lerp(set, up * up * (3 - 2 * up)));
      } else {
        // Shown one way: the ball out to that side and his eyes there, then back to pass the other.
        arms = 'pass fake: shows it one way';
        const to = fake.toward ? toScene(fake.toward.x, fake.toward.y).setY(held.y).sub(held).setY(0).normalize() : fwd.clone();
        this.ballAt = twoHands(held.clone().addScaledVector(to, 0.3 * bell).add(new THREE.Vector3(0, 0.04 * bell, 0)), 1, dir(fwd.clone().lerp(to, 0.6 * bell)));
      }
      this.passOut = 0;
      this.drib = null;
      this.state.arms = arms;
      return;
    }
    const dunkSoon = holder === key && dunkAhead(next, key);
    if (dunkSoon && this.drib?.phase !== 'flight') {
      // Gathered for a dunk: the last steps with the ball in both hands, from his hip (where the last
      // dribble came up) in to his waist in front, ready to take it up.
      arms = 'dunk: gathered, last steps';
      openBoth();
      const k = Math.max(0, Math.min(1, 1 - (next?.shot?.in ?? 0) / DUNK_GATHER_S));
      const hip = chest.clone().addScaledVector(fwd, 0.22).addScaledVector(right, 0.2 * (1 - k)).add(new THREE.Vector3(0, -0.42, 0));
      const waist = chest.clone().addScaledVector(fwd, 0.36).add(new THREE.Vector3(0, -0.24, 0));
      this.ballAt = twoHands(hip.lerp(waist, k * k * (3 - 2 * k)));
      this.passOut = 0;
      this.drib = null;
      this.state.arms = arms;
      return;
    }
    // (A dribbled ball still in the air is caught first, at its top: the dribble below.)
    if (passSoon && next && next.action.kind === 'pass' && this.drib?.phase !== 'flight') {
      // Picking the ball up for a pass, both hands at the chest; then, in the last moment before it
      // goes, pushing it out along the line to the receiver until the arms are straight (see the pass).
      openBoth();
      const pt = frame.players[next.action.to];
      const line = (pt ? toScene(pt.x, pt.y) : chest.clone().add(fwd)).sub(chest).setY(0).normalize();
      if (next.action.style === 'bounce') line.y = -0.45;
      else if (next.action.style === 'lob') line.y = 0.55;
      line.normalize();
      const p = Math.max(0, Math.min(1, 1 - next.in / PASS_PUSH_S));
      if (p <= 0) {
        arms = 'pass: picking it up';
        this.passOut = 0;
        this.ballAt = twoHands(chest.clone().addScaledVector(fwd, 0.34).add(new THREE.Vector3(0, -0.22, 0)));
      } else {
        arms = 'pass: pushing it out to him';
        this.passOut = p;
        const ease = p * p * (3 - 2 * p);
        const across = new THREE.Vector3().crossVectors(line.clone().setY(0).normalize(), UP).normalize();
        const at = chest.clone().add(new THREE.Vector3(0, -PASS_BELOW_CHEST_M, 0)).addScaledVector(line, PASS_FROM_M + (PASS_OUT_M - PASS_FROM_M) * ease);
        for (const arm of [this.arms.l, this.arms.r]) palmOn(arm, at, across.clone().multiplyScalar(arm.side * (0.75 - 0.35 * ease)).addScaledVector(line, -0.65 - 0.3 * ease), up.clone().addScaledVector(line, 0.5));
        this.ballAt = betweenPalms();
      }
    } else if (has && action?.kind === 'held' && action.dribble && MIXAMO.Dribble?.dribble) {
      // Dribbling: the arm is the dribble clip's (see update); the ball goes by physics, in time with
      // it (dribbleBall). It goes on the side the frame's ball is (a crossover switches hands, at a
      // release); just before the dribble ends (a pass, a shot, a pick-up) he catches it at the top.
      dribbling = true;
      const hips = Math.PI / 2 - this.yaw;
      const bR = new THREE.Vector3().crossVectors(new THREE.Vector3(Math.cos(hips), 0, Math.sin(hips)), UP).normalize();
      // The hand away from the nearest opponent close to him (he keeps his body between the ball and
      // the defender); with nobody near, the side the frame has the ball on.
      let want: 'l' | 'r' = (Math.sign(ball.clone().sub(chest).dot(bR)) || 1) > 0 ? 'r' : 'l';
      const team = key.slice(0, key.indexOf(':') + 1);
      const me = frame.players[key];
      let nearest: { d: number; side: number } | null = null;
      for (const [k, p] of Object.entries(frame.players)) {
        if (k.startsWith(team) || k.startsWith('ref')) continue;
        const d = Math.hypot(p.x - me.x, p.y - me.y);
        if (d < DRIBBLE_GUARDED_M && (!nearest || d < nearest.d)) nearest = { d, side: toScene(p.x, p.y).sub(toScene(me.x, me.y)).dot(bR) };
      }
      if (nearest) want = nearest.side > 0 ? 'l' : 'r';
      // A crossover (fakes.ts): across to the other hand, low, at its next push, and kept there.
      const fk = frame.fake && frame.fake.key === key && frame.fake.kind === 'cross' ? frame.fake : null;
      if (fk && !this.crossedTo) this.crossedTo = this.dribSide === 'r' ? 'l' : 'r';
      if (this.crossedTo && (fk ? fk.k > 0.35 : true)) want = this.crossedTo;
      // A pump or pass fake coming: he catches this bounce at its top and keeps it.
      const fakeSoon = !!frame.fake && frame.fake.key === key && frame.fake.k < 0;
      const ending = fakeSoon || (!!next && !(next.action.kind === 'held' && next.action.dribble) && next.in < DRIBBLE_CATCH_S) || dunkAhead(next ? { ...next, shot: next.shot && { ...next.shot, in: next.shot.in - DRIBBLE_CATCH_S } } : null, key);
      if (!this.drib) this.dribSide = want;
      const d = this.dribbleBall(want, ending, dt);
      const h = this.dribSide;
      this.open = { l: 1, r: 1 };
      this.curl[h] = CUP;
      // The hand to the ball where it is off the clip's path: going to meet it in the last moment of its
      // flight (or waiting at the top for it), and in the hand until the push has taken it back. The
      // palm on its top, fingers forward over it.
      const arm = this.arms[h];
      const fingersFwd = new THREE.Vector3(Math.cos(this.facing), 0, Math.sin(this.facing));
      if (d.phase === 'flight' && d.bounced) {
        // Coming up off the floor: the hand waits over it, palm down, where it will peak, so it rises
        // straight into the palm and the fingers (never past the wrist). It comes over the ball as the
        // ball comes up.
        const upSpeed = RESTITUTION * (d.down + GRAVITY * d.tDown);
        const peakY = BALL_R + (upSpeed * upSpeed) / (2 * GRAVITY);
        const u = Math.min(1, (d.since - d.tDown) / Math.max(0.01, d.tUp));
        const k = Math.max(0, Math.min(1, (u - DRIBBLE_OVER_FROM) / (1 - DRIBBLE_OVER_FROM - 0.25)));
        if (k > 0) palmOn(arm, new THREE.Vector3(d.pos.x, Math.max(d.pos.y, peakY), d.pos.z), UP, fingersFwd, k * k * (3 - 2 * k));
      } else if (d.phase !== 'flight' && d.pos.distanceTo(this.ballInPalm(h)) > 0.01) {
        palmOn(arm, d.pos, UP, fingersFwd, 1);
        d.pos = this.ballInPalm(h);
      }
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
      // The ball goes out along the line in his hands, from the chest to where his arms are straight,
      // and leaves his fingers there: it is pushed to the receiver, not dropped out of the hands.
      // Pushed out before it left (see passSoon), it is gone the moment the pass is; otherwise (no
      // time to push) out along the line in his hands as the ball goes.
      const push = this.passOut > 0.9 ? 1 : Math.min(1, Math.max(0, gone - PASS_FROM_M) / (PASS_OUT_M - PASS_FROM_M));
      const settle = Math.max(0, Math.min(1, (gone - 2) / 3));
      const w = 1 - settle;
      arms = settle < 1 ? 'pass: follow-through, arms straight to him' : 'pass: done';
      const across = new THREE.Vector3().crossVectors(line.clone().setY(0).normalize(), UP).normalize();
      const start = chest.clone().add(new THREE.Vector3(0, -PASS_BELOW_CHEST_M, 0));
      if (push < 1) {
        // Still in his hands: the palms behind and on the sides of it, the fingers on it, pushing it
        // out at the receiver; the wrists snap through at the end.
        arms = 'pass: pushing it out to him';
        const ease = push * push * (3 - 2 * push);
        const at = start.clone().addScaledVector(line, PASS_FROM_M + (PASS_OUT_M - PASS_FROM_M) * ease);
        for (const arm of [this.arms.l, this.arms.r]) palmOn(arm, at, across.clone().multiplyScalar(arm.side * (0.75 - 0.35 * ease)).addScaledVector(line, -0.65 - 0.3 * ease), up.clone().addScaledVector(line, 0.5));
        this.ballAt = betweenPalms();
      } else {
        // Let go at full stretch: arms straight out after it (along the line it went, at the height it
        // went), palms out, thumbs down, then back.
        const along = dir(ball.clone().sub(start).setY(0)).multiplyScalar(0.62);
        const outTo = start.clone().add(along).setY(start.y + Math.max(-0.35, Math.min(0.2, ball.y - start.y)));
        for (const arm of [this.arms.l, this.arms.r]) {
          const t = outTo.clone().addScaledVector(across, arm.side * 0.1);
          reachTo(arm, t, w);
          this.orient(sideOf(arm), line.clone().addScaledVector(across, -arm.side * 0.3), up.clone().addScaledVector(line, 0.4).addScaledVector(across, arm.side * 0.3), w);
        }
      }
    } else if (has && near) {
      // Holding it: at the chest, out in front, between his two palms.
      arms = 'holding it';
      openBoth();
      // At the line for a free throw: at his waist (where the shot starts from); otherwise at the chest.
      const atLine = next?.action.kind === 'fromPlayer' && next.action.from === key && next.action.style === 'set';
      const at = atLine ? chest.clone().addScaledVector(fwd, FT_WAIST_FWD_M).add(new THREE.Vector3(0, -FT_WAIST_DOWN_M, 0)) : chest.clone().addScaledVector(fwd, 0.34).add(new THREE.Vector3(0, -0.22, 0));
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
      if (handsUp <= 0.02 && this.posture === 'lane') {
        // On the lane at a free throw: knees bent, hands low in front of the thighs, palms in, ready
        // to go for the ball once it hits the rim. Not reaching for anything yet.
        arms = 'on the lane: ready, hands low';
        for (const arm of [this.arms.l, this.arms.r]) {
          const S = arm.upper.getWorldPosition(new THREE.Vector3());
          const t = S.clone().addScaledVector(fwd, 0.22).addScaledVector(right, arm.side * 0.1).add(new THREE.Vector3(0, -0.62, 0));
          reachTo(arm, t, 0.9, S.clone().addScaledVector(right, arm.side * 0.4).addScaledVector(fwd, -0.3).add(new THREE.Vector3(0, -0.3, 0)));
          this.orient(sideOf(arm), right.clone().multiplyScalar(-arm.side).add(new THREE.Vector3(0, -0.4, 0)), fwd.clone().add(new THREE.Vector3(0, -0.8, 0)), 0.8);
        }
      } else if (handsUp <= 0.02 && (this.posture === 'ready' || this.posture === 'rebound')) {
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
            // Towards the ball: at it, up to 60 degrees off straight up (a ball off to his side is
            // reached for out to that side, not with both arms straight up at nothing).
            const d = ball.clone().sub(S).normalize();
            // Never up and back over his head: the reach goes up and to the side the arm can get to.
            const level = d.clone().setY(0);
            if (level.lengthSq() > 1e-6) {
              const ok = reachable(arm, level.clone().normalize());
              d.copy(ok.multiplyScalar(level.length())).setY(d.y).normalize();
            }
            const off = Math.acos(Math.max(-1, Math.min(1, d.y)));
            const most = 1.05;
            if (off > most) {
              const flat = d.clone().setY(0).normalize();
              d.copy(UP).multiplyScalar(Math.cos(most)).addScaledVector(flat, Math.sin(most));
            }
            // The other arm never reaches across over his head for a ball on his far side: it goes up and
            // a little out and forward on its own side (balance), the elbow in front, not behind.
            if (arm !== nearer && d.dot(right) * arm.side < 0.05) {
              const own = right.clone().multiplyScalar(arm.side * 0.45).addScaledVector(fwd, 0.55).normalize();
              d.copy(UP).multiplyScalar(Math.cos(0.4)).addScaledVector(own, Math.sin(0.4)).normalize();
            }
            const t = S.clone().addScaledVector(d, len * (arm === nearer ? 0.99 : 0.9)).addScaledVector(right, arm === nearer ? 0 : arm.side * 0.06);
            reachTo(arm, t, w, S.clone().addScaledVector(right, arm.side * 0.5).addScaledVector(fwd, 0.25));
            this.orient(sideOf(arm), ball.clone().sub(t).setY(0).normalize().add(new THREE.Vector3(0, 0.3, 0)), d.clone(), w);
          }
        } else {
          // On the floor: the pose says why the hands are up (motion.ts ReachAim).
          const aim = frame.reachAim?.[key];
          const to = aim ? toScene(aim.x, aim.y).setY(chest.y).sub(chest).setY(0) : fwd.clone();
          const flat = to.lengthSq() > 1e-4 ? to.clone().normalize() : fwd.clone();
          // The arm on the side the aim is on leads.
          const lead = flat.dot(right) >= 0 ? this.arms.r : this.arms.l;
          // What he reacts to behind him (running away from it, his back to it): no hand goes up at it.
          const hu = handsUp * Math.max(0, Math.min(1, (flat.dot(fwd) + 0.5) / 0.4));
          if (aim?.kind === 'deny') {
            // Denying the pass: the lead arm straight out into the passing lane at shoulder height,
            // palm to the ball; the other low and back, feeling for his man. Never both up.
            arms = `deny: a hand in the lane ${hu.toFixed(2)}`;
            for (const arm of [this.arms.l, this.arms.r]) {
              const S = arm.upper.getWorldPosition(new THREE.Vector3());
              const fl = reachable(arm, flat);
              const t =
                arm === lead
                  ? S.clone().addScaledVector(fl, 0.62).addScaledVector(right, arm.side * 0.12).add(new THREE.Vector3(0, -0.05, 0))
                  : S.clone().addScaledVector(right, arm.side * 0.32).addScaledVector(fwd, -0.12).add(new THREE.Vector3(0, -0.5, 0));
              reachTo(arm, t, hu);
              this.orient(sideOf(arm), arm === lead ? fl.clone() : right.clone().multiplyScalar(-arm.side), arm === lead ? UP.clone() : fwd.clone(), hu);
            }
          } else if (aim?.kind === 'closeout') {
            // Closing out on the catch: one hand high at the catcher (against the shot), the other low
            // and out to the side (against the drive).
            arms = `closeout: one hand high ${hu.toFixed(2)}`;
            for (const arm of [this.arms.l, this.arms.r]) {
              const S = arm.upper.getWorldPosition(new THREE.Vector3());
              const fl = reachable(arm, flat);
              const t =
                arm === lead
                  ? S.clone().addScaledVector(fl, 0.3).addScaledVector(right, arm.side * 0.05).add(new THREE.Vector3(0, 0.55, 0))
                  : S.clone().addScaledVector(right, arm.side * 0.45).addScaledVector(fl, 0.2).add(new THREE.Vector3(0, -0.35, 0));
              reachTo(arm, t, hu);
              this.orient(sideOf(arm), fl.clone(), arm === lead ? UP.clone() : right.clone().multiplyScalar(arm.side), hu);
            }
          } else if (aim?.kind === 'help') {
            // A wall in front of the driver: both hands up and out in front, a little apart.
            arms = `help: a wall ${hu.toFixed(2)}`;
            for (const arm of [this.arms.l, this.arms.r]) {
              const S = arm.upper.getWorldPosition(new THREE.Vector3());
              const fl = reachable(arm, flat);
              const t = S.clone().addScaledVector(fl, 0.32).addScaledVector(right, arm.side * 0.12).add(new THREE.Vector3(0, 0.42, 0));
              reachTo(arm, t, hu);
              this.orient(sideOf(arm), fl.clone(), UP.clone(), hu);
            }
          } else {
            // A contest or a rebound: hands up, towards the shooter or the ball, the nearer one highest.
            arms = `${aim?.kind ?? 'hands up'} ${hu.toFixed(2)}`;
            for (const arm of [this.arms.l, this.arms.r]) {
              const S = arm.upper.getWorldPosition(new THREE.Vector3());
              const fl = reachable(arm, flat);
              const t = S.clone()
                .addScaledVector(fl, arm === lead ? 0.3 : 0.18)
                .addScaledVector(right, arm.side * 0.1)
                .add(new THREE.Vector3(0, arm === lead ? 0.62 : 0.5, 0));
              reachTo(arm, t, hu);
              this.orient(sideOf(arm), fl.clone(), up.clone(), hu);
            }
          }
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
