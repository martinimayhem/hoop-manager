// Dev only (open the app with ?film, &seed=N): every step of four moves in the 3D view, frame by
// frame, side on, from a real match: a dribble, a pass, a jump shot and a dunk. Only the players
// involved are drawn. Each frame is labelled with its time and what the rig's arms are doing.
//
// Searching is done without drawing (fast); the match is deterministic, so each move is then
// replayed from the start, drawn only for the last moments before it (to let the rigs settle) and
// while it is filmed.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../../data/teams';
import { toScene } from '../court3d/player3d';
import { lookFor3d } from '../court3d/roster3d';
import { Scene3D, loadAssets } from '../court3d/scene3d';
import { LiveMatch } from '../match/controller';

const DT = 1 / 60;
const SIZE = 520;
/** Drawn this many steps before filming starts, so speeds, feet and hands have settled. */
const WARM_STEPS = 40;

interface Shot {
  t: number;
  label: string;
  url: string;
}
interface Strip {
  title: string;
  note: string;
  shots: Shot[];
}

export function Court3DFilm() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strips, setStrips] = useState<Strip[]>([]);
  const [status, setStatus] = useState('Loading the 3D models…');

  useEffect(() => {
    let cancelled = false;
    const pause = () => new Promise((r) => setTimeout(r, 30));
    (async () => {
      const assets = await loadAssets();
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const seed = Number(new URLSearchParams(window.location.search).get('seed')) || 1;
      const fresh = () => {
        const live = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], seed, ['ai', 'ai'], 'normal');
        live.highlights = false;
        return live;
      };
      let m = fresh();
      const scene = new Scene3D(canvas, assets, (k) => lookFor3d(m, k));
      scene.resize(SIZE, SIZE);
      const step = (draw: boolean) => {
        m.tick(DT);
        if (m.phase === 'timeout' || m.phase === 'break') m.resume();
        if (m.phase === 'argue') m.letItGo();
        if (draw) scene.render(m.frame(), m.currentAction(), m.holderKey(), DT * (m.frame()?.timeScale ?? 1), m.upcomingAction());
      };
      /** The step at which `test` first holds, in a fresh match (nothing drawn). */
      const find = (test: () => boolean, maxSeconds = 2880) => {
        m = fresh();
        for (let i = 0; i < maxSeconds / DT && m.phase !== 'final'; i++) {
          step(false);
          if (test()) return i;
        }
        return -1;
      };
      /** A fresh match played to step `at`, drawn for the last few steps. */
      const replay = (at: number) => {
        m = fresh();
        scene.resetPlayers();
        for (let i = 0; i <= at; i++) step(i > at - WARM_STEPS);
      };
      const sideCam = (at: THREE.Vector3, dir: number, dist: number, height = 1.1) => {
        scene.devCamera = {
          from: new THREE.Vector3(at.x + Math.sin(dir) * dist, height + 0.6, at.z - Math.cos(dir) * dist),
          to: new THREE.Vector3(at.x, height, at.z),
        };
      };
      const snap = (label: string, t: number): Shot => {
        scene.render(m.frame(), m.currentAction(), m.holderKey(), 0, m.upcomingAction());
        const z = m.frame()?.ball.z ?? 0;
        return { t, label: `${label} · ball ${z.toFixed(2)} m (drawn ${scene.ballDrawn.y.toFixed(2)})`, url: canvas.toDataURL('image/jpeg', 0.88) };
      };
      const film = (seconds: number, every: number, aim: () => void, label: () => string) => {
        const shots: Shot[] = [];
        let t = 0;
        let next = 0;
        while (t <= seconds + 1e-6) {
          if (t + 1e-6 >= next) {
            aim();
            shots.push(snap(label(), t));
            next += every;
          }
          step(true);
          t += DT;
        }
        return shots;
      };
      /** From the side the ball is on (the dribbling hand's side), a little in front of him, so the hand on the ball is in view. */
      const ballSideCam = (k: string) => {
        const p = posOf(k);
        const b = scene.ballDrawn;
        const f = scene.rigOf(k)?.facingAngle ?? 0;
        const side = Math.sign((b.x - p.x) * -Math.sin(f) + (b.z - p.z) * Math.cos(f)) || 1;
        const look = new THREE.Vector3(p.x, 0, p.z);
        const from = look.clone().add(new THREE.Vector3(-Math.sin(f) * side * 2.8 + Math.cos(f) * 1.4, 0, Math.cos(f) * side * 2.8 + Math.sin(f) * 1.4));
        scene.devCamera = { from: from.setY(1.3), to: look.setY(0.85) };
      };
      const posOf = (k: string) => {
        const p = m.frame()?.players[k];
        return p ? toScene(p.x, p.y) : new THREE.Vector3();
      };
      const arms = (k: string) => scene.rigOf(k)?.state.arms || '–';
      const out: Strip[] = [];
      const say = async (s: string) => {
        if (!cancelled) setStatus(s);
        await pause();
      };

      // 1. A dribble on the move, side on to where he runs.
      await say('1/4 Finding a dribble on the move…');
      let dribbler = '';
      const was: Record<string, THREE.Vector3> = {};
      const at1 = find(() => {
        const a = m.currentAction();
        const h = m.holderKey();
        const f = m.frame();
        let fast = false;
        if (h && f?.players[h]) {
          const p = toScene(f.players[h].x, f.players[h].y);
          fast = !!was[h] && p.distanceTo(was[h]) / (DT * (f.timeScale ?? 1)) > 3;
          was[h] = p;
        }
        if (a?.kind === 'held' && a.dribble && h && fast && (f?.ball.z ?? 0) > 0.85) {
          dribbler = h;
          return true;
        }
        return false;
      });
      if (at1 >= 0) {
        replay(at1);
        scene.only = new Set([dribbler]);
        const shots = film(0.9, 0.075, () => ballSideCam(dribbler), () => arms(dribbler));
        out.push({ title: `Dribble on the move: ${dribbler}`, note: 'A frame every 0.075 s. Side on to where he runs.', shots });
        if (!cancelled) setStrips([...out]);
      }

      // 1b. A dribble standing or walking (not a drive): he should stand taller.
      await say('1/4 Finding a dribble standing…');
      let still = '';
      const was2: Record<string, THREE.Vector3> = {};
      const at1b = find(() => {
        const a = m.currentAction();
        const h = m.holderKey();
        const f = m.frame();
        let slow = false;
        if (h && f?.players[h]) {
          const p = toScene(f.players[h].x, f.players[h].y);
          slow = !!was2[h] && p.distanceTo(was2[h]) / (DT * (f.timeScale ?? 1)) < 1.2;
          was2[h] = p;
        }
        if (a?.kind === 'held' && a.dribble && h && slow && (f?.ball.z ?? 0) > 0.85 && m.clock < 700) {
          still = h;
          return true;
        }
        return false;
      });
      if (at1b >= 0) {
        replay(at1b);
        scene.only = new Set([still]);
        const shots = film(0.9, 0.075, () => ballSideCam(still), () => arms(still));
        out.push({ title: `Dribble standing: ${still}`, note: 'A frame every 0.075 s. Not a drive: he stands taller.', shots });
        if (!cancelled) setStrips([...out]);
      }

      // 2. A pass of 4-9 m, from the throw to the catch, side on to the line between them.
      await say('2/4 Finding a pass…');
      let from = '';
      let to = '';
      let style = '';
      const at2 = find(() => {
        const a = m.currentAction();
        const f = m.frame();
        if (a?.kind !== 'pass' || !f) return false;
        const p = f.players[a.from];
        const q = f.players[a.to];
        if (!p || !q || !a.from.includes(':') || !a.to.includes(':')) return false;
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < 4 || d > 9) return false;
        from = a.from;
        to = a.to;
        style = a.style ?? 'chest';
        return true;
      });
      if (at2 >= 0) {
        // From a moment before the throw: the push is part of it.
        replay(at2 - 18);
        scene.only = new Set([from, to]);
        const a0 = posOf(from);
        const b0 = posOf(to);
        const dir = Math.atan2(b0.z - a0.z, b0.x - a0.x);
        // Close on the ball as it goes from one to the other: the hands on it are what matters.
        const aim = () => {
          const b = scene.ballDrawn;
          sideCam(new THREE.Vector3(b.x, 0, b.z), dir, 3.6, 1.1);
        };
        const shots = film(1.5, 0.1, aim, () => `passer: ${arms(from)} · receiver: ${arms(to)}`);
        out.push({ title: `Pass (${style}): ${from} to ${to}`, note: 'A frame every 0.1 s from 0.3 s before the throw. The camera follows the ball, side on to the pass.', shots });
        if (!cancelled) setStrips([...out]);
      }

      // 3. A jump shot, from the gather to the landing, side on to the rim.
      await say('3/4 Finding a jump shot…');
      let shooter = '';
      let rim = new THREE.Vector3();
      const at3 = find(() => {
        const n = m.upcomingAction();
        if (n && n.action.kind === 'fromPlayer' && n.action.style === 'jumper' && n.in < 0.27 && m.holderKey() === n.action.from) {
          shooter = n.action.from;
          rim = toScene(n.action.to.x, n.action.to.y);
          return true;
        }
        return false;
      });
      if (at3 >= 0) {
        replay(at3);
        scene.only = new Set([shooter]);
        const at = posOf(shooter);
        const dir = Math.atan2(rim.z - at.z, rim.x - at.x);
        const shots = film(1.6, 0.1, () => sideCam(posOf(shooter), dir, 3.6, 1.4 + (scene.rigOf(shooter)?.root.position.y ?? 0)), () => arms(shooter));
        out.push({ title: `Jump shot: ${shooter}`, note: 'A frame every 0.1 s from the gather. Side on to the rim.', shots });
        if (!cancelled) setStrips([...out]);
      }

      // 4. A dunk, from the take-off to the landing, side on to the rim.
      await say('4/4 Finding a dunk…');
      let dunker = '';
      let dunkRim = new THREE.Vector3();
      const at4 = find(() => {
        const a = m.currentAction();
        if (a?.kind === 'fromPlayer' && a.style === 'dunk' && m.frame()?.shooter === a.from) {
          dunker = a.from;
          dunkRim = toScene(a.to.x, a.to.y);
          return true;
        }
        return false;
      });
      if (at4 >= 0) {
        // From a moment before the take-off.
        replay(at4 - 18);
        scene.only = new Set([dunker]);
        const at = posOf(dunker);
        const dir = Math.atan2(dunkRim.z - at.z, dunkRim.x - at.x);
        // Far enough back to have him and the rim in the picture, following him.
        const shots = film(1.7, 0.1, () => sideCam(posOf(dunker).lerp(dunkRim, 0.35), dir, 5.6, 2.1), () => arms(dunker));
        out.push({ title: `Dunk: ${dunker}`, note: 'A frame every 0.1 s from 0.3 s before the take-off. Side on to the rim.', shots });
      }

      scene.only = null;
      scene.devCamera = null;
      if (!cancelled) {
        setStrips(out);
        setStatus(`Seed ${seed}: ${out.length} moves filmed.`);
      }
    })().catch((e: unknown) => setStatus(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#0d1218', color: '#d6deec', font: '13px system-ui', padding: 16 }}>
      <h2 style={{ margin: '0 0 6px' }}>3D view: every step</h2>
      <div style={{ color: '#9fb0c8', marginBottom: 12 }}>{status}</div>
      <canvas ref={canvasRef} width={SIZE} height={SIZE} style={{ position: 'absolute', left: -9999, top: 0 }} />
      {strips.map((s) => (
        <div key={s.title} style={{ marginBottom: 22 }}>
          <h3 style={{ margin: '0 0 2px' }}>{s.title}</h3>
          <div style={{ color: '#8d9ab5', marginBottom: 6 }}>{s.note}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {s.shots.map((f, i) => (
              <figure key={i} style={{ margin: 0, width: 260 }}>
                <img src={f.url} width={260} height={260} style={{ display: 'block', borderRadius: 4 }} />
                <figcaption style={{ fontSize: 11, lineHeight: 1.3, marginTop: 2 }}>
                  <b>{f.t.toFixed(2)} s</b> {f.label}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
