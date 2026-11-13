// One player in 3D: a rigged low-poly body (Quaternius, CC0) driven by the match's Frame data. The
// legs come from animation clips, blended and played at the speed he actually moves, so his feet
// keep up with the ground; the arms are bent onto the ball where he has it (dribble, catch, shot,
// dunk) or up for a contest. Nothing here decides anything: it only shows what the frame says.

import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { RIM_HEIGHT, type BallAction, type Frame } from '../court/animation';
import { SHOTS } from '../court/motion';

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
  /** Null: bald or shaved, no hair. */
  hair: string | null;
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
 * The model's arms are short for a basketball player (shoulder to wrist 0.27 of his height, measured;
 * a real one about 0.33). They are made this much longer, along their length only: the elbow and the
 * wrist move out and the upper arm and forearm stretch to meet them; their thickness and the hands
 * stay as they are.
 */
const ARM_LENGTH = 1.2;
/** Physics of the ball (CLAUDE.md, Reference values). */
const GRAVITY = 9.81;
const RESTITUTION = 0.8;
/** Dribble cycle, top of the bounce to top of the bounce (s): standing, and at a run. */
const DRIBBLE_T = [0.75, 0.6];
/** Where the hand meets the ball (its centre, m): standing, and at a run. */
const DRIBBLE_TOP = [0.95, 0.86];
/** Where the ball comes up beside him: this far out to his side, and this far in front (standing / at a run). */
const DRIBBLE_OUT_M = 0.34;
const DRIBBLE_AHEAD = [0.3, 0.5];
/** Within this long of the dribble ending, he catches the ball at the top instead of pushing it again (s). */
/** How long the hand is on the ball in each dribble push: shortest, longest. */
const DRIBBLE_PUSH_S = [0.05, 0.15] as const;
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
 * sleeveless jersey with the number on the chest and back, shorts, shoes. An official gets a grey
 * shirt with black stripes and black trousers.
 */
function bodyMaterial(look: PlayerLook, bounds: THREE.Box3, front: number): THREE.Material {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const h = bounds.max.y - bounds.min.y;
  const official = !!look.official;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSkin = { value: new THREE.Color(look.skin) };
    shader.uniforms.uJersey = { value: new THREE.Color(official ? '#d8d8d2' : look.jersey) };
    shader.uniforms.uShorts = { value: new THREE.Color(official ? '#1d1d1f' : look.shorts) };
    shader.uniforms.uFloor = { value: bounds.min.y };
    shader.uniforms.uHeight = { value: h };
    shader.uniforms.uFront = { value: front };
    shader.uniforms.uOfficial = { value: official ? 1 : 0 };
    shader.uniforms.uNumber = { value: look.number ? numberTexture(look.number, look.jerseyText, look.jersey) : null };
    shader.uniforms.uHasNumber = { value: look.number ? 1 : 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vBind;\nuniform vec3 uSkin, uJersey, uShorts;\nuniform float uFloor, uHeight, uFront, uOfficial, uHasNumber;\nuniform sampler2D uNumber;',
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `float hy = (vBind.y - uFloor) / uHeight;
        float side = abs(vBind.x) / uHeight;
        vec3 c = uSkin;
        bool neck = hy > 0.79 && side < 0.04;
        bool torso = hy > 0.47 && hy < 0.83 && side < 0.105;
        // Short sleeves over the shoulders, to the middle of the upper arm (the bind pose is a T).
        bool sleeve = hy > 0.74 && hy < 0.86 && side < 0.17;
        if ((torso || sleeve) && !neck) {
          // The shirt: hips to neck, shoulders covered.
          c = uJersey;
          if (uOfficial > 0.5 && fract(vBind.x / (uHeight * 0.04)) < 0.4) c = vec3(0.1);
          // The number: on the chest, bigger on the back.
          if (uHasNumber > 0.5) {
            bool back = vBind.z * uFront < 0.0;
            float size = back ? 0.15 : 0.1;
            float mid = back ? 0.64 : 0.66;
            vec2 uv = vec2(0.5 + (back ? -1.0 : 1.0) * uFront * vBind.x / (uHeight * size), 0.5 + (hy - mid) / size);
            if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
              vec4 t = texture2D(uNumber, uv);
              c = mix(c, t.rgb, t.a);
            }
          }
        }
        else if (uOfficial > 0.5 ? (hy > 0.045 && hy <= 0.5 && side < 0.12) : (hy > 0.34 && hy <= 0.5 && side < 0.12)) c = uShorts;
        else if (hy < 0.045) c = uOfficial > 0.5 ? vec3(0.08) : vec3(0.93);
        vec4 diffuseColor = vec4( c, opacity );`,
      );
  };
  return m;
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
  /** The dribbled ball, flying by physics: where it is, how fast, and what the hand is doing with it. */
  private drib: {
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    phase: 'push' | 'flight' | 'held';
    t: number;
    tc: number;
    vRelease: number;
    top0: number;
    /** Where the hand met it for this push. */
    from: THREE.Vector3;
    side: 1 | -1;
    target: THREE.Vector3;
  } | null = null;
  /** The head's forward, in the head bone's own space. */
  private headFwd = new THREE.Vector3(0, 0, 1);
  /** A dunker carried to the rim: the offset from where the frame has him, and how much of it. */
  private dunkOff = new THREE.Vector3();
  private dunkW = 0;
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
        if (sm.isSkinnedMesh && !found) found = sm;
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
      if (name === 'MI_Hair_1') {
        mesh.visible = !!look.hair;
        mesh.material = new THREE.MeshLambertMaterial({ color: look.hair ?? '#000000', flatShading: true });
      } else mesh.material = name === 'MI_Eyes' ? new THREE.MeshBasicMaterial({ color: 0x111111 }) : bodyMaterial(look, bounds, front);
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
    const stretchAlong = (axis: THREE.Vector3, k: number) => {
      const a = axis.clone().normalize();
      const m = new THREE.Matrix4();
      const e = (i: number, j: number) => (i === j ? 1 : 0) + (k - 1) * [a.x, a.y, a.z][i] * [a.x, a.y, a.z][j];
      m.set(e(0, 0), e(0, 1), e(0, 2), 0, e(1, 0), e(1, 1), e(1, 2), 0, e(2, 0), e(2, 1), e(2, 2), 0, 0, 0, 0, 1);
      return m;
    };
    const stretch = new Map<THREE.Bone, THREE.Matrix4>();
    for (const sd of ['l', 'r'] as const) {
      stretch.set(this.bones[`upperarm_${sd}`], stretchAlong(this.bones[`lowerarm_${sd}`].position, ARM_LENGTH));
      stretch.set(this.bones[`lowerarm_${sd}`], stretchAlong(this.bones[`hand_${sd}`].position, ARM_LENGTH));
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
    this.palmLen = this.bones.hand_r.getWorldPosition(new THREE.Vector3()).distanceTo(this.bones.middle_01_r.getWorldPosition(new THREE.Vector3())) * 0.6;
    const arm = (s: 'l' | 'r', side: 1 | -1): Arm => ({ upper: this.bones[`upperarm_${s}`], lower: this.bones[`lowerarm_${s}`], hand: this.bones[`hand_${s}`], side });
    this.arms = { l: arm('l', -1), r: arm('r', 1) };
    const leg = (s: 'l' | 'r', side: 1 | -1): Arm => ({ upper: this.bones[`thigh_${s}`], lower: this.bones[`calf_${s}`], hand: this.bones[`foot_${s}`], side });
    this.legs = { l: leg('l', -1), r: leg('r', 1) };
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
    const stance = frame.stance?.[key] ?? 0;
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
    // In the air: a jump shooter rises straight, legs long; anyone else tucks a little.
    weights.Jump_Loop = air * (jumper ? 0 : 0.6);
    weights[CLIP.idle] = (weights[CLIP.idle] ?? 0) + air * (jumper ? 1 : 0.4);
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
    // Longer arms: the clips set the joints' positions every frame, so the elbow and wrist are moved
    // out again each time (the skin stretches to them, see the skeleton above).
    for (const sd of ['l', 'r'] as const) {
      this.bones[`lowerarm_${sd}`].position.multiplyScalar(ARM_LENGTH);
      this.bones[`hand_${sd}`].position.multiplyScalar(ARM_LENGTH);
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
      const lean = this.dribbling * (DRIBBLE_LEAN[0] + (DRIBBLE_LEAN[1] - DRIBBLE_LEAN[0]) * driving);
      const across = new THREE.Vector3().crossVectors(new THREE.Vector3(Math.cos(this.facing), 0, Math.sin(this.facing)), UP).normalize();
      turnWorld(this.bones.spine_01, across, -lean * 0.5);
      turnWorld(this.bones.spine_02, across, -lean * 0.5);
      turnWorld(this.bones.neck_01, across, lean * 0.7);
    }

    this.plantFeet(air > 0, dt);
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
   * The dribbled ball, one step of physics. `frameSide`: the side the frame has the ball (a
   * crossover); `ending`: the dribble ends soon, so at the next top he catches it.
   */
  private stepDribble(frameSide: 1 | -1, fwd: THREE.Vector3, right: THREE.Vector3, dt: number, ending: boolean) {
    const run = Math.max(0, Math.min(1, (this.speed - 1) / 3.5));
    const T = DRIBBLE_T[0] + (DRIBBLE_T[1] - DRIBBLE_T[0]) * run;
    const top = DRIBBLE_TOP[0] + (DRIBBLE_TOP[1] - DRIBBLE_TOP[0]) * run;
    const ahead = DRIBBLE_AHEAD[0] + (DRIBBLE_AHEAD[1] - DRIBBLE_AHEAD[0]) * run;
    const vel = this.speed > STILL_M_S ? new THREE.Vector3(Math.cos(this.moveDir), 0, Math.sin(this.moveDir)).multiplyScalar(this.speed) : new THREE.Vector3();
    // Where the ball should be at the top of a bounce `later` seconds from now: beside him, out in front.
    const apex = (later: number, side: number) =>
      this.root.position.clone().setY(top).addScaledVector(vel, later).addScaledVector(fwd, ahead).addScaledVector(right, side * DRIBBLE_OUT_M);
    // The push for a cycle of T: how long the hand is on the ball and how fast it leaves it, so that
    // after the bounce it comes back up to `top`.
    const push = (from: number) => {
      const u = Math.sqrt(2 * GRAVITY * (top - BALL_R)) / RESTITUTION;
      const solve = (tc: number) => {
        let vR = u * 0.6;
        for (let i = 0; i < 6; i++) {
          const hR = from - 0.5 * vR * tc;
          vR = Math.sqrt(Math.max(0.01, u * u - 2 * GRAVITY * (hR - BALL_R)));
        }
        return { vR, flight: (u - vR) / GRAVITY + (RESTITUTION * u) / GRAVITY };
      };
      // A real push is short (the hand is on the ball about a tenth of a second); the cycle is "about"
      // T, so when the bounce is off (a low or high top) the cycle gives, not the push.
      let lo: number = DRIBBLE_PUSH_S[0];
      let hi: number = DRIBBLE_PUSH_S[1];
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (mid + solve(mid).flight > T) hi = mid;
        else lo = mid;
      }
      const tc = (lo + hi) / 2;
      return { tc, ...solve(tc) };
    };
    if (!this.drib) {
      // Starting a dribble: from wherever the ball is, the hand on it pushes it down.
      const start = (this.ballShown ?? apex(0, frameSide)).clone();
      start.y = Math.max(top - 0.15, Math.min(top + 0.3, start.y));
      const p = push(start.y);
      this.drib = { pos: start, vel: new THREE.Vector3(), phase: 'push', t: 0, tc: p.tc, vRelease: p.vR, top0: start.y, from: start.clone(), side: frameSide, target: apex(T, frameSide) };
    }
    const d = this.drib;
    if (d.phase === 'push') {
      // The hand pushes it down from the top, faster and faster, and carries it along beside him.
      d.t += dt;
      const t = Math.min(d.t, d.tc);
      // In the hand, it is carried from where the hand met it to beside him (no jump).
      const here = apex(0, d.side);
      const k = d.tc > 0 ? t / d.tc : 1;
      d.pos.set(d.from.x + (here.x - d.from.x) * k, d.top0 - (0.5 * d.vRelease * t * t) / d.tc, d.from.z + (here.z - d.from.z) * k);
      if (d.t >= d.tc) {
        // Let go: down at the release speed, and across so that it comes up beside him next time.
        const flight = (Math.sqrt(2 * GRAVITY * (top - BALL_R)) / RESTITUTION - d.vRelease) / GRAVITY + Math.sqrt(2 * GRAVITY * (top - BALL_R)) / GRAVITY;
        d.side = frameSide;
        d.target = apex(flight, d.side);
        // No further than he can really be by then: from where it leaves the hand, his run plus a little.
        const reach = d.target.clone().sub(d.pos).setY(0);
        const most = Math.min(this.speed, 7) * flight + 0.35;
        if (reach.length() > most) d.target.copy(d.pos).add(reach.setLength(most)).setY(d.target.y);
        d.vel.set((d.target.x - d.pos.x) / flight, -d.vRelease, (d.target.z - d.pos.z) / flight);
        d.phase = 'flight';
      }
    } else if (d.phase === 'flight') {
      // Free flight: gravity, and a bounce off the floor. Nothing else touches it.
      const rising = d.vel.y > 0;
      d.vel.y -= GRAVITY * dt;
      d.pos.addScaledVector(d.vel, dt);
      if (d.pos.y < BALL_R && d.vel.y < 0) {
        d.pos.y = 2 * BALL_R - d.pos.y;
        d.vel.y = -d.vel.y * RESTITUTION;
        // Off the floor it goes where the dribble sent it, which is where he is now (he may have
        // stopped or turned since the push): the bounce is where its direction changes, never in the air.
        const up = d.vel.y / GRAVITY;
        const meet = apex(up, d.side);
        const across = meet.sub(d.pos).setY(0).divideScalar(Math.max(0.05, up));
        const most = Math.min(this.speed, 7) + 1.5;
        if (across.length() > most) across.setLength(most);
        d.vel.x = across.x;
        d.vel.z = across.z;
      }
      if (rising && d.vel.y <= 0) {
        // The top of the bounce: the hand meets it. It pushes it again, or, the dribble ending, holds it.
        d.vel.set(0, 0, 0);
        if (ending) d.phase = 'held';
        else {
          const p = push(d.pos.y);
          Object.assign(d, { phase: 'push', t: 0, tc: p.tc, vRelease: p.vR, top0: d.pos.y, from: d.pos.clone() });
        }
      }
    } else {
      // Caught: in his hand, beside him, until the dribble is over.
      const here = apex(0, d.side);
      const k = Math.min(1, dt / 0.12);
      d.pos.set(d.pos.x + (here.x - d.pos.x) * k, d.pos.y, d.pos.z + (here.z - d.pos.z) * k);
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
        } else {
          reachTo(arm, shoulder.clone().addScaledVector(toRim, 0.25).add(new THREE.Vector3(0, -0.2, 0)).addScaledVector(across, arm.side * 0.15), 0.6);
        }
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
    } else if (has && action?.kind === 'held' && action.dribble) {
      // Dribbling. The ball follows physics (CLAUDE.md, Reference values): the hand meets it at the
      // top of the bounce and pushes it down; it flies, bounces off the floor (restitution 0.8) and
      // comes back up to the hand; it never sticks to the hand and never turns in the air. It goes on
      // the side the frame's ball is (a crossover switches hands), outside his legs and out in front.
      // Just before the dribble ends (a pass, a shot, a pick-up) he catches it at the top instead.
      dribbling = true;
      const frameSide = (Math.sign(ball.clone().sub(chest).dot(right)) || 1) as 1 | -1;
      const ending = !!next && !(next.action.kind === 'held' && next.action.dribble) && next.in < DRIBBLE_CATCH_S;
      const d = this.stepDribble(frameSide, fwd, right, dt, ending);
      const hand = d.side > 0 ? this.arms.r : this.arms.l;
      const guard = hand === this.arms.r ? this.arms.l : this.arms.r;
      const h = sideOf(hand);
      this.open = { l: 1, r: 1 };
      this.curl[h] = CUP;
      this.curl[sideOf(guard)] = RELAXED_CURL * 0.6;
      this.ballAt = d.pos.clone();
      const toMe = chest.clone().sub(d.pos).setY(0).normalize();
      // Fingers forward over the ball and a little out to his side; palm on its top and back.
      const over = toMe.clone().negate().addScaledVector(right, d.side * 0.3);
      const onTop = up.clone().multiplyScalar(0.85).addScaledVector(toMe, 0.5);
      if (d.phase === 'flight') {
        // Waiting, palm down, over where the ball will come up.
        palmOn(hand, d.target, onTop, over);
      } else palmOn(hand, d.pos, onTop, over);
      const protect = Math.max(0.35, 1 - this.speed / 7);
      const shoulderG = guard.upper.getWorldPosition(new THREE.Vector3());
      const forearmAt = shoulderG.clone().addScaledVector(fwd, 0.32).addScaledVector(right, guard.side * 0.18).add(new THREE.Vector3(0, -0.36, 0));
      reachTo(guard, forearmAt, protect, shoulderG.clone().addScaledVector(right, guard.side * 0.45).add(new THREE.Vector3(0, -0.6, 0)).addScaledVector(fwd, 0.1));
      this.orient(sideOf(guard), up.clone().negate(), fwd.clone().addScaledVector(right, -guard.side * 0.4), protect);
      const which = h === 'r' ? 'right' : 'left';
      arms = (d.phase === 'push' ? `dribble (${which} hand): pushing it down` : d.phase === 'flight' ? `dribble (${which} hand): ball bouncing` : `dribble (${which} hand): caught it`);
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
      if (handsUp <= 0.02 && this.stance > 0.25) {
        // Defensive stance: hands out wide at the waist, palms forward, ready to deflect.
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
