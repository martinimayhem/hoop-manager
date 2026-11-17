// Dev only (?dribblecheck&seed=1&q=1&minutes=6; `npm run shots -- dribblecheck`): plays real match
// play through the 3D view and measures the dribbled ball every frame, to find the moments it is
// somewhere it cannot be:
//   - too far from the dribbler (more than an arm and a bounce: FAR_M, across the floor),
//   - nearer an opponent than the dribbler,
//   - jumping (moving further in one frame than a ball can: JUMP_M_S),
//   - not under the palm when the hand meets it (the catch gap, CATCH_GAP_M).
// The worst moments are listed with their match clock, to film them with npm run frames.

import { useEffect, useState } from 'react';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../../data/teams';
import { isRef } from '../court/animation';
import { toScene } from '../court3d/player3d';
import { lookFor3d } from '../court3d/roster3d';
import { Scene3D, loadAssets } from '../court3d/scene3d';
import { clockString } from '../labels';
import { LiveMatch } from '../match/controller';

const DT = 1 / 60;
const FAR_M = 0.95;
const JUMP_M_S = 14;
const CATCH_GAP_M = 0.1;

interface Problem {
  kind: string;
  clock: string;
  quarter: number;
  value: number;
  who: string;
  phase: string;
}

export function DribbleCheck() {
  const [status, setStatus] = useState('loading');
  useEffect(() => {
    window.__shots = { done: false, images: [] };
    (async () => {
      const q = new URLSearchParams(window.location.search);
      const seed = Number(q.get('seed')) || 1;
      const quarter = Number(q.get('q')) || 1;
      const minutes = Number(q.get('minutes')) || 6;
      const assets = await loadAssets();
      const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], seed, ['ai', 'ai'], 'normal');
      m.highlights = false;
      const canvas = document.createElement('canvas');
      const scene = new Scene3D(canvas, assets, (k) => lookFor3d(m, k));
      scene.resize(64, 48);
      const problems: Problem[] = [];
      const counts: Record<string, number> = { frames: 0, dribbling: 0, far: 0, nearerOpponent: 0, jump: 0, catchGap: 0, catches: 0, 'reach<5cm': 0, 'reach<15cm': 0, 'reach<30cm': 0, 'reach<70cm': 0, 'reach>70cm': 0, 'side<2': 0, 'side<5': 0, 'side<9': 0, 'side>9': 0 };
      /** The ball's sideways acceleration in the air (m/s², from three drawn positions in a row): a free ball has none. */
      const flightTrail: { x: number; z: number; bx: number; bz: number }[] = [];
      /** The same, of his body under it (to tell the ball's bending from his own). */
      const body: Record<string, number> = { 'side<2': 0, 'side<5': 0, 'side<9': 0, 'side>9': 0 };
      /** The ball's bending less his body's: how much it moves differently from him. */
      const rel: Record<string, number> = { 'side<2': 0, 'side<5': 0, 'side<9': 0, 'side>9': 0 };
      let last: { x: number; y: number; z: number } | null = null;
      let lastPhase = '';
      let lastHolder: string | null = null;
      const end = 720 - minutes * 60;
      while (m.phase !== 'final' && (m.quarter < quarter || (m.quarter === quarter && m.clock > end))) {
        m.tick(DT);
        if (m.phase === 'timeout' || m.phase === 'break') m.resume();
        if (m.phase === 'argue') m.letItGo();
        if (m.phase === 'clutch') while (m.clutch) m.submitClutch(m.clutch.pending[0], null);
        m.drainFx();
        if (m.quarter < quarter) continue;
        const frame = m.frame();
        const action = m.currentAction();
        const holder = m.holderKey();
        scene.render(frame, action, holder, DT * (frame?.timeScale ?? 1), m.upcomingAction());
        counts.frames++;
        if (counts.frames % 2000 === 0) {
          setStatus(`Q${m.quarter} ${clockString(m.clock)}`);
          await new Promise((r) => setTimeout(r, 0));
        }
        const rig = holder ? scene.rigOf(holder) : null;
        const info = rig?.dribbleInfo;
        const dribbling = !!(frame && holder && !isRef(holder) && action?.kind === 'held' && action.dribble && info);
        const b = scene.ballDrawn;
        // ?trace=<key>&from=<s>&to=<s>: every frame of one player's dribble, in numbers.
        const trace = q.get('trace');
        if (trace && rig && holder === trace && m.clock <= Number(q.get('from')) && m.clock >= Number(q.get('to')) && info) {
          const r = rig.root.position;
          console.log(
            `${m.clock.toFixed(3)} ts ${(frame?.timeScale ?? 1).toFixed(2)} ${info.phase.padEnd(7)} clip ${info.clipT.toFixed(3)} rate ${info.rate.toFixed(2)} side ${info.side} ` +
              `root ${r.x.toFixed(2)},${r.z.toFixed(2)} v ${info.vel.x.toFixed(1)},${info.vel.z.toFixed(1)} ball ${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)} off ${Math.hypot(b.x - r.x, b.z - r.z).toFixed(2)}`,
          );
        }
        if (dribbling && rig && info && frame) {
          counts.dribbling++;
          const at = { clock: clockString(m.clock), quarter: m.quarter, who: holder!, phase: info.phase };
          const r = rig.root.position;
          const far = Math.hypot(b.x - r.x, b.z - r.z);
          if (far > FAR_M) {
            counts.far++;
            problems.push({ kind: 'far from him', value: far, ...at });
          }
          const team = holder!.slice(0, holder!.indexOf(':') + 1);
          for (const [k, p] of Object.entries(frame.players)) {
            if (k.startsWith(team) || isRef(k)) continue;
            const o = toScene(p.x, p.y);
            const d = Math.hypot(b.x - o.x, b.z - o.z);
            if (d < far) {
              counts.nearerOpponent++;
              problems.push({ kind: `nearer ${k} than him`, value: far - d, ...at });
              break;
            }
          }
          if (last && lastHolder === holder) {
            const moved = Math.hypot(b.x - last.x, b.y - last.y, b.z - last.z) / (DT * (frame.timeScale ?? 1));
            if (moved > JUMP_M_S) {
              counts.jump++;
              problems.push({ kind: 'jumped', value: moved, ...at });
            }
          }
          if (lastPhase === 'flight' && info.phase !== 'flight') {
            counts.catches++;
            const g = info.gap;
            counts[g < 0.05 ? 'reach<5cm' : g < 0.15 ? 'reach<15cm' : g < 0.3 ? 'reach<30cm' : g < 0.7 ? 'reach<70cm' : 'reach>70cm']++;
            if (info.gap > CATCH_GAP_M) {
              counts.catchGap++;
              problems.push({ kind: 'met the palm off', value: info.gap, ...at });
            }
          }
          if (info.phase === 'flight' && lastPhase === 'flight') {
            flightTrail.push({ x: b.x, z: b.z, bx: rig.root.position.x, bz: rig.root.position.z });
            if (flightTrail.length > 3) flightTrail.shift();
            if (flightTrail.length === 3) {
              const h = DT * (frame.timeScale ?? 1);
              const [p0, p1, p2] = flightTrail;
              // Not across the bounce (where it may change direction): two frames either side of it look like one.
              const a = Math.hypot(p2.x - 2 * p1.x + p0.x, p2.z - 2 * p1.z + p0.z) / (h * h);
              const bucket = (v: number) => (v < 2 ? 'side<2' : v < 5 ? 'side<5' : v < 9 ? 'side<9' : 'side>9');
              const ab = Math.hypot(p2.bx - 2 * p1.bx + p0.bx, p2.bz - 2 * p1.bz + p0.bz) / (h * h);
              const ar = Math.hypot(p2.x - p2.bx - 2 * (p1.x - p1.bx) + (p0.x - p0.bx), p2.z - p2.bz - 2 * (p1.z - p1.bz) + (p0.z - p0.bz)) / (h * h);
              if (info.ball.y > 0.2) {
                counts[bucket(a)]++;
                body[bucket(ab)]++;
                rel[bucket(ar)]++;
              }
            }
          } else flightTrail.length = 0;
          lastPhase = info.phase;
        } else lastPhase = '';
        last = { x: b.x, y: b.y, z: b.z };
        lastHolder = holder;
      }
      // The worst of each kind, a few each, and when.
      const byKind: Record<string, Problem[]> = {};
      for (const p of problems) (byKind[p.kind.startsWith('nearer') ? 'nearer an opponent' : p.kind] ??= []).push(p);
      console.log(`checked ${counts.frames} frames, ${counts.dribbling} of them dribbling, ${counts.catches} catches`);
      console.log(`far from him ${counts.far}, nearer an opponent ${counts.nearerOpponent}, jumped ${counts.jump}, met the palm off ${counts.catchGap}`);
      console.log(`the ball's sideways acceleration in the air, frames: under 2 m/s² ${counts['side<2']}, 2-5 ${counts['side<5']}, 5-9 ${counts['side<9']}, over 9 ${counts['side>9']}`);
      console.log(`  his body's, the same frames: under 2 ${body['side<2']}, 2-5 ${body['side<5']}, 5-9 ${body['side<9']}, over 9 ${body['side>9']}`);
      console.log(`  the ball relative to him: under 2 ${rel['side<2']}, 2-5 ${rel['side<5']}, 5-9 ${rel['side<9']}, over 9 ${rel['side>9']}`);
      console.log(`how far the hand reached for the ball at the catch: <5 cm ${counts['reach<5cm']}, 5-15 cm ${counts['reach<15cm']}, 15-30 cm ${counts['reach<30cm']}, 30-70 cm ${counts['reach<70cm']}, over 70 cm ${counts['reach>70cm']}`);
      for (const [kind, list] of Object.entries(byKind)) {
        list.sort((a, b) => b.value - a.value);
        const seen = new Set<string>();
        const worst = list.filter((p) => !seen.has(p.clock) && seen.add(p.clock)).slice(0, 6);
        console.log(`${kind}: ` + worst.map((p) => `Q${p.quarter} ${p.clock} ${p.who} ${p.phase} ${p.value.toFixed(2)}`).join(' | '));
      }
      setStatus('done');
      window.__shots = { done: true, images: [] };
    })().catch((e) => {
      setStatus(String(e));
      window.__shots = { done: true, images: [], error: String(e?.stack ?? e) };
    });
  }, []);
  return <div style={{ background: '#14171c', color: '#cfd6e0', minHeight: '100vh', padding: 8 }}>{status}</div>;
}
