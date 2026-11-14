// The TV director's camera, measured: plays two quarters through it and prints how far it sits
// (m), how fast it moves and turns, how hard it accelerates and how often it reverses its pan.
//   npx tsx scripts/director-check.ts

import * as THREE from 'three';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../src/data/teams';
import { Director } from '../src/ui/court3d/director';
import { LiveMatch } from '../src/ui/match/controller';
const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], 1, ['ai', 'ai'], 'normal');
m.highlights = false;
const cam = new THREE.PerspectiveCamera(30, 1.9, 1, 200);
const dir = new Director();
const DT = 1 / 60;
let prev: THREE.Vector3 | null = null, prevV: THREE.Vector3 | null = null, prevLook: THREE.Vector3 | null = null;
let maxV = 0, maxA = 0, maxTurn = 0, frames = 0, flips = 0;
const dists: number[] = [], speeds: number[] = [];
let lastDx = 0;
const spikes: string[] = [];
while (m.phase !== 'final' && m.quarter <= 2) {
  m.tick(DT);
  if (m.phase === 'timeout' || m.phase === 'break') m.resume();
  if (m.phase === 'argue') m.letItGo();
  if (m.phase === 'clutch') while (m.clutch) m.submitClutch(m.clutch.pending[0], null);
  const f = m.frame();
  const ts = f?.timeScale ?? 1;
  dir.update(cam, f, DT * Math.min(2, Math.sqrt(Math.max(1, ts))));
  const p = cam.position.clone();
  const look = dir.target.clone().sub(p).normalize();
  dists.push(dir.target.distanceTo(p));
  if (prev) {
    const v = p.clone().sub(prev).divideScalar(DT);
    speeds.push(v.length());
    maxV = Math.max(maxV, v.length());
    if (prevV) { const a = v.clone().sub(prevV).length() / DT; maxA = Math.max(maxA, a); if (a > 15 && spikes.length < 12) spikes.push(`Q${m.quarter} ${m.clock.toFixed(1)} a=${a.toFixed(0)} v=${v.length().toFixed(1)} ts=${ts}`); }
    prevV = v;
    // A flip: the sideways pan changing direction (what jitter looks like).
    const dx = v.x;
    if (Math.abs(dx) > 0.15 && Math.abs(lastDx) > 0.15 && Math.sign(dx) !== Math.sign(lastDx)) flips++;
    if (Math.abs(dx) > 0.15) lastDx = dx;
  }
  if (prevLook) maxTurn = Math.max(maxTurn, (Math.acos(Math.min(1, look.dot(prevLook))) * 180) / Math.PI / DT);
  prev = p; prevLook = look; frames++;
}
const q = (a: number[], k: number) => [...a].sort((x, y) => x - y)[Math.floor(k * (a.length - 1))];
const minutes = (frames * DT) / 60;
if (process.argv.includes('--spikes')) console.log(spikes.join(' | '));
console.log(JSON.stringify({ minutesShown: +minutes.toFixed(1), distMin: +Math.min(...dists).toFixed(1), distMedian: +q(dists, 0.5).toFixed(1), distMax: +Math.max(...dists).toFixed(1), speedMedian: +q(speeds, 0.5).toFixed(2), speedP99: +q(speeds, 0.99).toFixed(2), speedMax: +maxV.toFixed(2), accelMax: +maxA.toFixed(1), turnMaxDegPerS: +maxTurn.toFixed(1), panReversalsPerMin: +(flips / minutes).toFixed(1) }));
