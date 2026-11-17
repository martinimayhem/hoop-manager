// Dev only: console helpers for the 3D prototype (window.__3d on the ?3d page). They step the match in
// fixed 1/60 s steps (so a throttled browser tab still measures properly) and measure the rig.
//
//   __3d.step(seconds)            play on
//   __3d.close()                  a close-up camera on the rigged player (__3d.wide() to go back)
//   __3d.measure(seconds)         how far a planted foot slides, by situation
//   __3d.until(test, maxSeconds)  play on until test(frame, action, holder, rig) is true

import * as THREE from 'three';
import type { BallAction, Frame } from '../court/animation';
import type { Player3D } from '../court3d/player3d';
import type { Scene3D } from '../court3d/scene3d';
import type { LiveMatch } from '../match/controller';

const DT = 1 / 60;

export function probe(m: LiveMatch, scene: Scene3D) {
  const tick = () => {
    m.tick(DT);
    if (m.phase === 'timeout' || m.phase === 'break') m.resume();
    if (m.phase === 'argue') m.letItGo();
    const f = m.frame();
    const g = DT * (f?.timeScale ?? 1);
    scene.render(f, m.currentAction(), m.holderKey(), g, m.upcomingAction());
    return g;
  };
  const bones = (rig: Player3D) => {
    const out: Record<string, THREE.Bone> = {};
    rig.root.traverse((o) => {
      if ((o as THREE.Bone).isBone) out[o.name] = o as THREE.Bone;
    });
    return out;
  };
  const stat = (a: number[]) => {
    if (!a.length) return '-';
    const s = [...a].sort((x, y) => x - y);
    return `n ${a.length}, median ${s[Math.floor(s.length / 2)].toFixed(2)} m/s, 90% under ${s[Math.floor(s.length * 0.9)].toFixed(2)}`;
  };
  return {
    m,
    scene,
    step(seconds: number) {
      for (let i = 0; i < seconds / DT; i++) tick();
      return scene.rigOf(scene.focus)?.state;
    },
    until(test: (f: Frame, a: BallAction | null, holder: string | null, rig: Player3D) => boolean, maxSeconds = 600) {
      for (let i = 0; i < maxSeconds / DT; i++) {
        tick();
        const f = m.frame();
        const rig = scene.rigOf(scene.focus);
        if (f && rig && test(f, m.currentAction(), m.holderKey(), rig)) return `Q${m.quarter} ${m.clock.toFixed(1)}`;
      }
      return 'not found';
    },
    /** Side on, for shots. */
    side() {
      scene.closeUp = 'side';
      scene.render(m.frame(), m.currentAction(), m.holderKey(), 0, m.upcomingAction());
    },
    close() {
      scene.closeUp = true;
      scene.render(m.frame(), m.currentAction(), m.holderKey(), 0, m.upcomingAction());
    },
    wide() {
      scene.closeUp = false;
      scene.render(m.frame(), m.currentAction(), m.holderKey(), 0, m.upcomingAction());
    },
    /** Slide speed of the planted (lower) foot, split by what he is doing. */
    measure(seconds: number) {
      const rig = scene.rigOf(scene.focus)!;
      const b = bones(rig);
      let prev: THREE.Vector3 | null = null;
      let prevSide = '';
      let prevYaw = 0;
      let prevSpeed = 0;
      const out: Record<string, number[]> = { steady: [], turning: [], speedChange: [], stance: [] };
      for (let i = 0; i < seconds / DT; i++) {
        const g = tick();
        const s = rig.state;
        const L = b.ball_l.getWorldPosition(new THREE.Vector3());
        const R = b.ball_r.getWorldPosition(new THREE.Vector3());
        const side = L.y < R.y ? 'l' : 'r';
        const foot = side === 'l' ? L : R;
        const yaw = rig.root.rotation.y;
        if (prev && side === prevSide && foot.y < 0.04 && s.speed > 0.25 && !s.mode.includes('air') && g > 0) {
          const v = Math.hypot(foot.x - prev.x, foot.z - prev.z) / g;
          const turn = Math.abs(Math.atan2(Math.sin(yaw - prevYaw), Math.cos(yaw - prevYaw))) / g;
          const acc = Math.abs(s.speed - prevSpeed) / g;
          out[s.mode.includes('stance') ? 'stance' : turn > 1 ? 'turning' : acc > 3 ? 'speedChange' : 'steady'].push(v);
        }
        prev = foot.clone();
        prevSide = side;
        prevYaw = yaw;
        prevSpeed = s.speed;
      }
      return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, stat(v)]));
    },
  };
}
