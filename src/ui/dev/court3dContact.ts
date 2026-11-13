// Dev only: does a hand that is meant to be on the ball touch it? Plays a match without drawing,
// and for every rig whose arms say they are on the ball, measures with the bones as posed:
//   gap    how far the palm's face is from the ball's surface (0 = touching; the ball is 24 cm across)
//   facing the angle between the way the palm faces and the way to the ball's centre (0 = flat on it)
//   down   for a dribble, how much the palm faces the floor (1 = straight down, as in the reference)
// Usage in the console on the ?3d page: __contact(60)

import * as THREE from 'three';
import { BALL_R, type Player3D } from '../court3d/player3d';
import type { Scene3D } from '../court3d/scene3d';
import type { LiveMatch } from '../match/controller';

const DT = 1 / 60;

interface Sample {
  gap: number;
  facing: number;
  down: number;
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN;
};

export function measureContact(m: LiveMatch, scene: Scene3D, seconds: number) {
  const by: Record<string, Sample[]> = {};
  /** Dribble frames, and those where the ball goes through a leg (centre within 17 cm of a thigh or shin). */
  let dribbleFrames = 0;
  let throughLeg = 0;
  const segDist = (p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) => {
    const ab = b.clone().sub(a);
    const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
    return p.distanceTo(a.clone().addScaledVector(ab, t));
  };
  for (let i = 0; i < seconds / DT && m.phase !== 'final'; i++) {
    m.tick(DT);
    if (m.phase === 'timeout' || m.phase === 'break') m.resume();
    if (m.phase === 'argue') m.letItGo();
    scene.render(m.frame(), m.currentAction(), m.holderKey(), DT * (m.frame()?.timeScale ?? 1), m.upcomingAction());
    const ball = scene.ballDrawn;
    for (const k of Object.keys(m.frame()?.players ?? {})) {
      const rig = scene.rigOf(k) as Player3D | null;
      if (!rig || !rig.root.visible) continue;
      const arms = rig.state.arms;
      // Which hands are meant to be on the ball, by what the rig says it is doing.
      if (/^dribble/.test(arms)) {
        dribbleFrames++;
        const bone = (n: string) => (rig as unknown as { bones: Record<string, THREE.Bone> }).bones[n].getWorldPosition(new THREE.Vector3());
        const near = ['l', 'r'].some((s) => segDist(ball, bone(`thigh_${s}`), bone(`calf_${s}`)) < 0.17 || segDist(ball, bone(`calf_${s}`), bone(`foot_${s}`)) < 0.17);
        if (near) throughLeg++;
      }
      let hands: ('l' | 'r')[] = [];
      let kind = '';
      if (/dribble \(right hand\): on the ball/.test(arms)) [hands, kind] = [['r'], 'dribble'];
      else if (/dribble \(left hand\): on the ball/.test(arms)) [hands, kind] = [['l'], 'dribble'];
      else if (arms === 'holding it') [hands, kind] = [['l', 'r'], 'holding'];
      else if (arms === 'pass: picking it up') [hands, kind] = [['l', 'r'], 'pass (picking it up)'];
      else if (/jump shot [123]\/6/.test(arms)) [hands, kind] = [['l', 'r'], 'jump shot (gather to set point)'];
      else if (/^dunk: (taking it up|both hands on the ball)/.test(arms)) [hands, kind] = [['l', 'r'], 'dunk (up to the rim)'];
      else if (/^layup: on the shooting hand/.test(arms)) [hands, kind] = [['r'], 'layup'];
      else if (/^pass: pushing it out/.test(arms) && ball.distanceTo(rig.root.position.clone().setY(1.2)) < 0.8) [hands, kind] = [['l', 'r'], 'pass (push)'];
      for (const s of hands) {
        const p = rig.palmInfo(s);
        const toCentre = ball.clone().sub(p.centre);
        const gap = toCentre.length() - BALL_R;
        const facing = (p.normal.angleTo(toCentre.normalize()) * 180) / Math.PI;
        (by[kind] ??= []).push({ gap, facing, down: -p.normal.y });
      }
    }
  }
  const out: Record<string, string> = {};
  for (const [k, xs] of Object.entries(by)) {
    const gaps = xs.map((x) => Math.abs(x.gap) * 100);
    const facing = xs.map((x) => x.facing);
    const touching = xs.filter((x) => Math.abs(x.gap) < 0.02 && x.facing < 35).length;
    out[k] =
      `${xs.length} hand-frames: touching (within 2 cm, palm facing it) ${Math.round((100 * touching) / xs.length)}% | ` +
      `gap median ${pct(gaps, 0.5).toFixed(1)} cm, 90% ${pct(gaps, 0.9).toFixed(1)} cm | palm vs ball median ${pct(facing, 0.5).toFixed(0)}°, 90% ${pct(facing, 0.9).toFixed(0)}°` +
      (k === 'dribble' ? ` | palm facing down median ${pct(xs.map((x) => x.down), 0.5).toFixed(2)} (1 = straight down)` : '');
  }
  out['ball through a leg while dribbling'] = `${throughLeg} of ${dribbleFrames} dribble frames (${((100 * throughLeg) / Math.max(1, dribbleFrames)).toFixed(1)}%)`;
  return out;
}

export function installContact(m: LiveMatch, scene: Scene3D) {
  Object.assign(window, { __contact: (seconds = 60) => measureContact(m, scene, seconds) });
}

