// Retargets the Mixamo clips in assets/animations/ onto our player's skeleton (Quaternius, CC0) and
// bakes them into public/3d/mixamo.json, in our bone names:
//
//   node scripts/retarget-mixamo.mjs
//
// The raw Mixamo files are not in git (Adobe's terms forbid redistributing them; see .gitignore):
// only this baked, retargeted version, built into the game, is.
//
// Both skeletons stand in a T-pose, Y up, facing +Z, left on +X (Mixamo in cm, ours in m). Each frame,
// every Mixamo bone's turn away from its T-pose (in world space) is put on our matching bone from our
// T-pose, so the motion is the same whatever the bones' own axes. The hips' movement is scaled by hip
// height. A clip can also be mirrored (left for right), for a left-handed dribble.

import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

globalThis.window = globalThis;
globalThis.self = globalThis;

const SRC = 'assets/animations';
const OUT = 'public/3d/mixamo.json';
const FPS = 60;

/**
 * Our clip name, the Mixamo file, and whether to make a mirrored (left-handed) copy too. Only the
 * clips the game uses are baked (the file grows by about 300 KB a clip). Also in assets/animations/,
 * for later: 'defend dribbling  Sidestep.fbx', 'Catch ball.fbx', 'catch.fbx',
 * 'take ball into play pass.fbx', 'fall.fbx', 'Standing Up.fbx'.
 */
const CLIPS = [
  { name: 'Dribble', file: 'Dribble.fbx', mirror: true, inPlace: true, dribble: true },
  { name: 'Run', file: 'Standard Run.fbx', inPlace: true },
  { name: 'DefendDribble', file: 'defend dribbling.fbx', inPlace: true },
];
/** The others, baked only with --all (to look at them on the turntable, npm run shots -- clips3d=all). */
const MORE = [
  { name: 'DefendSidestep', file: 'defend dribbling  Sidestep.fbx', inPlace: true },
  { name: 'CatchBall', file: 'Catch ball.fbx', inPlace: true },
  { name: 'Catch', file: 'catch.fbx', inPlace: true },
  { name: 'InboundPass', file: 'take ball into play pass.fbx', inPlace: true },
  { name: 'Fall', file: 'fall.fbx' },
  { name: 'StandUp', file: 'Standing Up.fbx' },
];
if (process.argv.includes('--all')) CLIPS.push(...MORE);

/** Mixamo bone (without the mixamorig prefix) to ours. */
const MAP = { Hips: 'pelvis', Spine: 'spine_01', Spine1: 'spine_02', Spine2: 'spine_03', Neck: 'neck_01', Head: 'Head' };
for (const [S, s] of [['Left', 'l'], ['Right', 'r']]) {
  Object.assign(MAP, {
    [`${S}Shoulder`]: `clavicle_${s}`,
    [`${S}Arm`]: `upperarm_${s}`,
    [`${S}ForeArm`]: `lowerarm_${s}`,
    [`${S}Hand`]: `hand_${s}`,
    [`${S}UpLeg`]: `thigh_${s}`,
    [`${S}Leg`]: `calf_${s}`,
    [`${S}Foot`]: `foot_${s}`,
    [`${S}ToeBase`]: `ball_${s}`,
  });
  for (const [F, f] of [['Thumb', 'thumb'], ['Index', 'index'], ['Middle', 'middle'], ['Ring', 'ring'], ['Pinky', 'pinky']])
    for (let k = 1; k <= 3; k++) MAP[`${S}Hand${F}${k}`] = `${f}_0${k}_${s}`;
}
const other = (n) => n.replace(/Left|Right/, (m) => (m === 'Left' ? 'Right' : 'Left'));

const ab = (p) => {
  const b = fs.readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const worldQ = (o) => o.getWorldQuaternion(new THREE.Quaternion());
const worldP = (o) => o.getWorldPosition(new THREE.Vector3());
/** Mirrored across the body's middle (x to -x). */
const mirrorQ = (q) => new THREE.Quaternion(q.x, -q.y, -q.z, q.w);
const mirrorP = (p) => new THREE.Vector3(-p.x, p.y, p.z);

const gltf = await new Promise((ok, no) => new GLTFLoader().parse(ab('public/3d/player.glb'), '', ok, no));
const ours = gltf.scene;
ours.updateMatrixWorld(true);
const bones = {};
ours.traverse((o) => {
  if (o.isBone) bones[o.name] = o;
});
const restLocalQ = Object.fromEntries(Object.entries(bones).map(([n, b]) => [n, b.quaternion.clone()]));
const restWorldQ = Object.fromEntries(Object.entries(bones).map(([n, b]) => [n, worldQ(b)]));
const pelvisRestLocal = bones.pelvis.position.clone();
// The pelvis' parent (our root bone) is turned (the model was built Z-up): a movement in the world is
// turned into its frame before it is added to the pelvis' own position.
const toPelvisParent = worldQ(bones.pelvis.parent).invert();
const pelvisRestWorld = worldP(bones.pelvis);
// Our bones in parent-first order, so each parent's pose is known before its children's.
const order = [];
ours.traverse((o) => {
  if (o.isBone) order.push(o.name);
});
const target = Object.fromEntries(Object.entries(MAP).map(([m, o]) => [o, m]));

/**
 * The dribble's two moments in each bounce, from the dribbling hand's height on our own rig: the top
 * (the hand meets the ball) and the lowest push point (it lets go). Times in the clip, in order.
 */
function dribbleEvents(times, y) {
  const n = y.length;
  const mid = (Math.max(...y) + Math.min(...y)) / 2;
  const at = (i) => y[(i + n) % n];
  const tops = [];
  const lows = [];
  // The clip loops (its last frame is its first): look at each frame against its neighbours, round the end.
  for (let i = 0; i < n - 1; i++) {
    const w = 4;
    let max = true;
    let min = true;
    for (let k = 1; k <= w; k++) {
      const a = at(i - k === -1 ? n - 2 : i - k);
      const b = at(i + k >= n - 1 ? i + k - (n - 1) : i + k);
      if (!(y[i] >= a && y[i] >= b)) max = false;
      if (!(y[i] <= a && y[i] <= b)) min = false;
    }
    if (max && y[i] > mid && !tops.some((t) => Math.abs(t - times[i]) < 0.15)) tops.push(+times[i].toFixed(4));
    if (min && y[i] < mid && !lows.some((t) => Math.abs(t - times[i]) < 0.15)) lows.push(+times[i].toFixed(4));
  }
  return { tops, lows };
}

function retarget(file, mirror, inPlace, dribble = false) {
  const src = new FBXLoader().parse(ab(path.join(SRC, file)), '');
  src.updateMatrixWorld(true);
  const sb = (n) => src.getObjectByName(`mixamorig${n}`);
  // The T-pose before any clip: each bone's world rotation and the hips' position.
  const srcRest = Object.fromEntries(Object.keys(MAP).map((m) => [m, worldQ(sb(m))]));
  const hipsRest = worldP(sb('Hips'));
  const k = pelvisRestWorld.y / hipsRest.y;
  const clip = src.animations[0];
  const mixer = new THREE.AnimationMixer(src);
  mixer.clipAction(clip).play();
  const frames = Math.round(clip.duration * FPS);
  const times = [];
  const q = Object.fromEntries(Object.values(MAP).map((n) => [n, []]));
  const pelvis = [];
  /** The dribbling hand's knuckles, how high, each frame (on our rig, posed). */
  const handY = [];
  let start = null;
  let end = null;
  for (let f = 0; f <= frames; f++) {
    const t = Math.min(clip.duration, f / FPS);
    times.push(t);
    mixer.setTime(t);
    src.updateMatrixWorld(true);
    // Our pose, parent first: world = (source turn from its rest) x our rest; local from the parent's world.
    const world = {};
    for (const n of order) {
      const parentWorld = bones[n].parent?.isBone ? world[bones[n].parent.name] : worldQ(bones[n].parent);
      const m = target[n];
      if (!m) {
        world[n] = parentWorld.clone().multiply(restLocalQ[n]);
        continue;
      }
      const from = mirror ? other(m) : m;
      let cur = worldQ(sb(from));
      let rest = srcRest[from];
      if (mirror) {
        cur = mirrorQ(cur);
        rest = mirrorQ(rest);
      }
      const turn = cur.clone().multiply(rest.clone().invert());
      world[n] = turn.multiply(restWorldQ[n]);
      const local = parentWorld.clone().invert().multiply(world[n]);
      q[n].push(...local.toArray());
    }
    let hp = worldP(sb('Hips'));
    if (mirror) hp = mirrorP(hp);
    if (f === 0) start = hp.clone();
    end = hp.clone();
    // The hips' movement from the T-pose, scaled to our height; in place: no travel over the ground.
    const d = hp.clone().sub(hipsRest).multiplyScalar(k);
    pelvis.push(d);
    if (dribble) {
      // Our rig in this frame's pose, to see where the hand is.
      for (const n of Object.values(MAP)) bones[n].quaternion.fromArray(q[n].slice(-4));
      bones.pelvis.position.copy(pelvisRestLocal).add(d.clone().applyQuaternion(toPelvisParent));
      ours.updateMatrixWorld(true);
      handY.push(worldP(bones[mirror ? 'middle_01_l' : 'middle_01_r']).y);
    }
  }
  for (const [n, b] of Object.entries(bones)) b.quaternion.copy(restLocalQ[n]);
  bones.pelvis.position.copy(pelvisRestLocal);
  ours.updateMatrixWorld(true);
  const travel = end.clone().sub(start).multiplyScalar(k);
  const tracks = [];
  for (const [n, vals] of Object.entries(q)) tracks.push({ name: `${n}.quaternion`, type: 'quaternion', times, values: vals });
  const pv = [];
  pelvis.forEach((d, i) => {
    // In place: the ground travel taken out, evenly over the clip (the bob and sway stay).
    const off = inPlace ? travel.clone().multiplyScalar(i / (pelvis.length - 1)) : new THREE.Vector3();
    const p = pelvisRestLocal.clone().add(new THREE.Vector3(d.x - off.x, d.y, d.z - off.z).applyQuaternion(toPelvisParent));
    pv.push(...p.toArray());
  });
  tracks.push({ name: 'pelvis.position', type: 'vector', times, values: pv });
  const res = { duration: clip.duration, tracks, travel: travel.toArray().map((v) => +v.toFixed(4)) };
  if (dribble) res.dribble = dribbleEvents(times, handY);
  return res;
}

const out = { source: 'Mixamo (Adobe), retargeted onto the Quaternius base skeleton by scripts/retarget-mixamo.mjs', clips: {} };
for (const c of CLIPS) {
  const file = path.join(SRC, c.file);
  if (!fs.existsSync(file)) {
    console.warn(`missing ${file}`);
    continue;
  }
  out.clips[c.name] = retarget(c.file, false, c.inPlace, c.dribble);
  if (c.mirror) out.clips[`${c.name}_L`] = retarget(c.file, true, c.inPlace, c.dribble);
  console.log(c.name, out.clips[c.name].duration.toFixed(3), 's, hips travel', out.clips[c.name].travel, c.dribble ? JSON.stringify(out.clips[c.name].dribble) + ' L ' + JSON.stringify(out.clips[`${c.name}_L`].dribble) : '');
}
const round = (v) => Math.round(v * 1e5) / 1e5;
for (const c of Object.values(out.clips)) for (const t of c.tracks) t.values = t.values.map(round);
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(OUT, (fs.statSync(OUT).size / 1024).toFixed(0), 'KB');
