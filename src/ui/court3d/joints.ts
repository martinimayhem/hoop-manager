// Joint limits: how far a human joint can bend, for the 3D rig. The clips are real motion, but the
// rig's own corrections on top of them (a head turned to the ball, a hand put on it, an arm held out)
// know nothing of anatomy, so without this any pose can come out (a chin on the collarbone, an arm
// reaching from behind the back).
//
// Swing-twist limits. Each joint's rotation, relative to its rest (bind) pose and so to the bone it
// hangs from, is split into a swing (where the bone points) and a twist (its spin about its own
// length). The swing is kept inside a cone, oval and off-centre where the joint needs it (the shoulder
// goes much further forward than back); the twist inside a range. No Euler angles, so no gimbal lock
// with an arm overhead. The cones are set in body terms (forward, up, out to his side) from this
// model's own T-pose, measured when the rig is built, so no axis can come out inverted.
//
// Ranges: the usual clinical ranges of motion (e.g. AAOS): neck turns about 70-80°, bends 45-50°
// forward and back; shoulder flexes 180° (with the collarbone), extends 50-60°; elbow 0-150°; wrist
// flexes 80°, extends 70°; hip flexes 120-125°, extends 20-30°, abducts 45°; knee 0-140°; ankle 20°
// up, 50° down. Split over neck and head, and over the three spine bones.

import * as THREE from 'three';

const DEG = Math.PI / 180;

/** A direction in body terms at rest: forward, up, out (away from his middle, to the bone's own side), right. */
type BodyDir = 'fwd' | 'back' | 'up' | 'down' | 'out' | 'in' | 'right' | 'palm';

interface Spec {
  bone: string;
  /** The direction the cone is centred on (the bone's rest direction if not given), as a mix of body directions. */
  centre?: Partial<Record<BodyDir, number>>;
  /** The cone's two axes, and how far (degrees) the bone may swing each way along them. */
  u: BodyDir;
  uPlus: number;
  uMinus: number;
  v: BodyDir;
  vPlus: number;
  vMinus: number;
  /** Twist about its own length (degrees). */
  twist: [number, number];
  /** Twist past its range is handed to the bone above it (the wrist's roll is the forearm's). */
  twistToParent?: boolean;
}

const SIDES = ['l', 'r'] as const;
const both = (f: (s: 'l' | 'r') => Spec): Spec[] => SIDES.map(f);

/**
 * The limits. T-pose rest: arms straight out to the sides, palms down; legs straight down. Elbow and
 * knee are hinges (a few degrees of give across), and the shoulder's cone is centred out, forward and
 * down, where its range is: it reaches overhead, across the chest and down by the side, but not
 * behind the back.
 */
const SPECS: Spec[] = [
  // Ranges set from both: the clinical ranges, and what the clips (real motion) do with this rig,
  // measured by the joint check (?jointcheck&limits=off&probe=...). This model's bind pose is not
  // neutral: at rest in motion its upper spine is about 26° forward of it and its neck about 34° back,
  // so those ranges sit off-centre to match.
  { bone: 'spine_01', u: 'fwd', uPlus: 35, uMinus: 15, v: 'right', vPlus: 15, vMinus: 15, twist: [-25, 25] },
  { bone: 'spine_02', u: 'fwd', uPlus: 30, uMinus: 15, v: 'right', vPlus: 15, vMinus: 15, twist: [-22, 22] },
  { bone: 'spine_03', u: 'fwd', uPlus: 42, uMinus: 15, v: 'right', vPlus: 16, vMinus: 16, twist: [-28, 28] },
  { bone: 'neck_01', u: 'fwd', uPlus: 20, uMinus: 64, v: 'right', vPlus: 25, vMinus: 25, twist: [-45, 45] },
  { bone: 'Head', u: 'fwd', uPlus: 28, uMinus: 32, v: 'right', vPlus: 18, vMinus: 18, twist: [-45, 45] },
  ...both((s) => ({ bone: `clavicle_${s}`, u: 'up', uPlus: 25, uMinus: 15, v: 'fwd', vPlus: 32, vMinus: 15, twist: [-20, 25] })),
  ...both((s) => ({ bone: `upperarm_${s}`, centre: { out: 0.62, fwd: 0.68, down: 0.4 }, u: 'up', uPlus: 118, uMinus: 118, v: 'fwd', vPlus: 118, vMinus: 118, twist: [-160, 160] })),
  ...both((s) => ({ bone: `lowerarm_${s}`, u: 'fwd', uPlus: 150, uMinus: 3, v: 'up', vPlus: 32, vMinus: 16, twist: [-90, 90] })),
  ...both((s) => ({ bone: `hand_${s}`, u: 'palm', uPlus: 88, uMinus: 75, v: 'fwd', vPlus: 40, vMinus: 35, twist: [-25, 25], twistToParent: true })),
  ...both((s) => ({ bone: `thigh_${s}`, u: 'fwd', uPlus: 125, uMinus: 32, v: 'out', vPlus: 47, vMinus: 30, twist: [-45, 45] })),
  ...both((s) => ({ bone: `calf_${s}`, u: 'back', uPlus: 145, uMinus: 3, v: 'out', vPlus: 12, vMinus: 12, twist: [-15, 45] })),
  ...both((s) => ({ bone: `foot_${s}`, u: 'up', uPlus: 30, uMinus: 55, v: 'out', vPlus: 35, vMinus: 40, twist: [-30, 45] })),
];

interface Joint {
  spec: Spec;
  bone: THREE.Bone;
  parentJoint: Joint | null;
  rest: THREE.Quaternion;
  restInv: THREE.Quaternion;
  /** In the bone's rest frame: its length, the cone's centre, and the cone's two axes. */
  axis: THREE.Vector3;
  centre: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  limits: { uPlus: number; uMinus: number; vPlus: number; vMinus: number; twist: [number, number] };
}

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const va = new THREE.Vector3();

/** How far past its limits a joint is (radians), for the checker. */
export interface JointExcess {
  bone: string;
  swing: number;
  twist: number;
}

export class JointLimits {
  private joints: Joint[] = [];
  private byName = new Map<string, Joint>();
  /** Off, they measure but do not clamp (to see what the poses want). */
  enabled = true;

  /**
   * Built in the bind pose, with the model standing as it does at rest: `fwd` his forward, `right`
   * his right, `palms`: each hand's palm direction in its own space.
   */
  constructor(bones: Record<string, THREE.Bone>, fwd: THREE.Vector3, right: THREE.Vector3, palms: { l: THREE.Vector3; r: THREE.Vector3 }) {
    const up = new THREE.Vector3(0, 1, 0);
    for (const spec of SPECS) {
      const bone = bones[spec.bone];
      if (!bone) continue;
      const side = spec.bone.endsWith('_l') ? -1 : spec.bone.endsWith('_r') ? 1 : 1;
      const worldQ = bone.getWorldQuaternion(new THREE.Quaternion());
      const toLocal = worldQ.clone().invert();
      const palmWorld = spec.bone.startsWith('hand_') ? palms[spec.bone.endsWith('_l') ? 'l' : 'r'].clone().applyQuaternion(worldQ) : up;
      const dirOf = (d: BodyDir): THREE.Vector3 => {
        switch (d) {
          case 'fwd':
            return fwd.clone();
          case 'back':
            return fwd.clone().negate();
          case 'up':
            return up.clone();
          case 'down':
            return up.clone().negate();
          case 'out':
            return right.clone().multiplyScalar(side);
          case 'in':
            return right.clone().multiplyScalar(-side);
          case 'right':
            return right.clone();
          case 'palm':
            return palmWorld.clone();
        }
      };
      const child = bone.children.find((c) => (c as THREE.Bone).isBone);
      const axis = child && child.position.lengthSq() > 1e-10 ? child.position.clone().normalize() : up.clone().applyQuaternion(toLocal).normalize();
      let centre = axis.clone();
      if (spec.centre) {
        const c = new THREE.Vector3();
        for (const [d, k] of Object.entries(spec.centre)) c.addScaledVector(dirOf(d as BodyDir), k!);
        centre = c.normalize().applyQuaternion(toLocal);
      }
      const u = dirOf(spec.u).applyQuaternion(toLocal);
      u.addScaledVector(centre, -u.dot(centre)).normalize();
      const v = dirOf(spec.v).applyQuaternion(toLocal);
      v.addScaledVector(centre, -v.dot(centre)).addScaledVector(u, -v.dot(u)).normalize();
      const joint: Joint = {
        spec,
        bone,
        parentJoint: null,
        rest: bone.quaternion.clone(),
        restInv: bone.quaternion.clone().invert(),
        axis,
        centre,
        u,
        v,
        limits: { uPlus: spec.uPlus * DEG, uMinus: spec.uMinus * DEG, vPlus: spec.vPlus * DEG, vMinus: spec.vMinus * DEG, twist: [spec.twist[0] * DEG, spec.twist[1] * DEG] },
      };
      this.joints.push(joint);
      this.byName.set(spec.bone, joint);
    }
    for (const j of this.joints) j.parentJoint = (j.bone.parent && this.byName.get(j.bone.parent.name)) || null;
  }

  /** The excess of one joint as it is posed now (radians), and the limited rotation (local). */
  private solve(j: Joint): { swing: number; twist: number; q: THREE.Quaternion; twistOver: number } {
    // The rotation from rest, in the rest frame.
    const rel = qa.copy(j.restInv).multiply(j.bone.quaternion);
    // q and -q are the same turn: the short way round, or the twist reads near 180°.
    if (rel.w < 0) rel.set(-rel.x, -rel.y, -rel.z, -rel.w);
    // Twist about its own length, and the swing that is left.
    const t = va.set(rel.x, rel.y, rel.z).dot(j.axis);
    let twistAngle = 2 * Math.atan2(t, rel.w);
    if (twistAngle > Math.PI) twistAngle -= 2 * Math.PI;
    if (twistAngle < -Math.PI) twistAngle += 2 * Math.PI;
    const dir = j.axis.clone().applyQuaternion(rel);
    // How far round from the cone's centre it points, and which way.
    const theta = Math.acos(Math.max(-1, Math.min(1, dir.dot(j.centre))));
    const du = dir.dot(j.u);
    const dv = dir.dot(j.v);
    const phi = Math.atan2(dv, du);
    const a = du >= 0 ? j.limits.uPlus : j.limits.uMinus;
    const b = dv >= 0 ? j.limits.vPlus : j.limits.vMinus;
    const limit = 1 / Math.sqrt((Math.cos(phi) / a) ** 2 + (Math.sin(phi) / b) ** 2);
    const swingOver = Math.max(0, theta - limit);
    const [tMin, tMax] = j.limits.twist;
    const tClamped = Math.max(tMin, Math.min(tMax, twistAngle));
    const twistOver = twistAngle - tClamped;
    if (swingOver <= 1e-4 && Math.abs(twistOver) <= 1e-4) return { swing: 0, twist: 0, q: j.bone.quaternion.clone(), twistOver: 0 };
    // Back to the edge of the cone, the same way round; the twist to its range.
    let newDir = dir;
    if (swingOver > 1e-4) {
      const side = j.u.clone().multiplyScalar(du).addScaledVector(j.v, dv);
      if (side.lengthSq() < 1e-10) side.copy(j.u);
      side.normalize();
      newDir = j.centre.clone().multiplyScalar(Math.cos(limit)).addScaledVector(side, Math.sin(limit)).normalize();
    }
    const swingQ = new THREE.Quaternion().setFromUnitVectors(j.axis, newDir);
    const twistQ = qb.setFromAxisAngle(j.axis, tClamped);
    const q = j.rest.clone().multiply(swingQ.multiply(twistQ));
    return { swing: swingOver, twist: Math.abs(twistOver), q, twistOver };
  }

  /** Brings the named joints (all, if none given) back inside their limits. */
  apply(names?: readonly string[]): void {
    if (!this.enabled) return;
    const list = names ? names.map((n) => this.byName.get(n)).filter((j): j is Joint => !!j) : this.joints;
    for (const j of list) {
      const r = this.solve(j);
      if (r.swing === 0 && r.twist === 0) continue;
      const before = j.bone.getWorldQuaternion(new THREE.Quaternion());
      j.bone.quaternion.copy(r.q);
      // A wrist's roll past its range is the forearm's: the forearm turns by it, and the hand keeps
      // the way it was facing (as far as the forearm can turn).
      if (j.spec.twistToParent && r.twistOver !== 0 && j.parentJoint) {
        const p = j.parentJoint;
        const axisWorld = p.axis.clone().applyQuaternion(p.bone.getWorldQuaternion(new THREE.Quaternion()));
        const pw = p.bone.getWorldQuaternion(new THREE.Quaternion());
        const turned = new THREE.Quaternion().setFromAxisAngle(axisWorld, r.twistOver).multiply(pw);
        const pp = p.bone.parent ? p.bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert() : new THREE.Quaternion();
        p.bone.quaternion.copy(pp.multiply(turned));
        p.bone.updateMatrixWorld(true);
        const r2 = this.solve(p);
        if (r2.swing || r2.twist) p.bone.quaternion.copy(r2.q);
        p.bone.updateMatrixWorld(true);
        // The hand as it was in the world, then held to its own range again.
        const parentW = j.bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
        j.bone.quaternion.copy(parentW.multiply(before));
        const r3 = this.solve(j);
        if (r3.swing || r3.twist) j.bone.quaternion.copy(r3.q);
      }
      j.bone.updateMatrixWorld(true);
    }
  }

  /** How far past their limits the joints are as posed now (nothing changed). */
  measure(): JointExcess[] {
    return this.joints.map((j) => {
      const r = this.solve(j);
      return { bone: j.spec.bone, swing: r.swing, twist: r.twist };
    });
  }

  /** Where a joint is now, in its cone's terms (degrees): how far round, which way (along u, along v), its twist. */
  probe(bone: string): { theta: number; du: number; dv: number; twist: number } | null {
    const j = this.byName.get(bone);
    if (!j) return null;
    const rel = j.restInv.clone().multiply(j.bone.quaternion);
    if (rel.w < 0) rel.set(-rel.x, -rel.y, -rel.z, -rel.w);
    const dir = j.axis.clone().applyQuaternion(rel);
    const t = new THREE.Vector3(rel.x, rel.y, rel.z).dot(j.axis);
    const deg = 180 / Math.PI;
    const theta = Math.acos(Math.max(-1, Math.min(1, dir.dot(j.centre)))) * deg;
    const s = Math.hypot(dir.dot(j.u), dir.dot(j.v)) || 1;
    return { theta, du: (theta * dir.dot(j.u)) / s, dv: (theta * dir.dot(j.v)) / s, twist: 2 * Math.atan2(t, rel.w) * deg };
  }

  /** In the bone above's own space: the way a hinge (elbow, knee) folds, for the arm and leg solver. */
  hingeFold(bone: string): THREE.Vector3 | null {
    const j = this.byName.get(bone);
    if (!j) return null;
    // The fold direction is in the hinge bone's rest frame; at rest the hinge bone and its parent line
    // up (straight arm or leg), so it is the same direction in the parent's rest frame, and so the
    // parent's own space relative to its rest.
    const parent = j.bone.parent as THREE.Bone;
    const pj = this.byName.get(parent.name);
    if (!pj) return null;
    // u in the hinge's rest frame -> parent's local frame (rest): rest.applied; -> the parent's rest frame.
    const inParent = j.u.clone().applyQuaternion(j.rest);
    return inParent;
  }
}

export const JOINT_NAMES = SPECS.map((s) => s.bone);
