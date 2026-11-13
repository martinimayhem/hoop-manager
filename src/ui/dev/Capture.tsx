// Dev only: the page `npm run frames` drives (open with ?capture&seed=1&q=2&from=10:30&to=10:20&every=0.1&view=both).
// Plays a match headlessly up to a moment and draws frames of the court with the game's own
// renderers (2D, and the 3D view), with the clock and the commentary line burnt into each image.
// The frames are left on window.__capture for the script to collect.

import { useEffect, useRef, useState } from 'react';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../../data/teams';
import { courtDots } from '../court/dots';
import { CANVAS_H, CANVAS_W, CourtRenderer, project } from '../court/render';
import * as THREE from 'three';
import { toScene } from '../court3d/player3d';
import { lookFor3d } from '../court3d/roster3d';
import { Scene3D, loadAssets } from '../court3d/scene3d';
import { TEAM_COLOURS, clockString, periodLabel } from '../labels';
import { LiveMatch } from '../match/controller';

const DT = 1 / 60;
const W = 1600;
const H = 800;
const BANNER = 56;
/** The 3D rigs are drawn for this many match seconds before the first frame, so they have settled. */
const WARM_S = 3;
const MAX_FRAMES = 400;

export interface CaptureState {
  done: boolean;
  status: string;
  error?: string;
  frames: { name: string; png: string }[];
}

declare global {
  interface Window {
    __capture?: CaptureState;
  }
}

/** "10:30" or "630" to seconds. */
function parseClock(s: string | null, fallback: number): number {
  if (!s) return fallback;
  const parts = s.split(':').map(Number);
  return parts.length === 2 ? parts[0] * 60 + parts[1] : Number(s);
}

export function Capture() {
  const c2 = useRef<HTMLCanvasElement>(null);
  const c3 = useRef<HTMLCanvasElement>(null);
  const out = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('starting');

  useEffect(() => {
    const state: CaptureState = { done: false, status: 'starting', frames: [] };
    window.__capture = state;
    const say = (s: string) => {
      state.status = s;
      setStatus(s);
    };
    const yieldNow = () => new Promise((r) => setTimeout(r, 0));
    (async () => {
      const q = new URLSearchParams(window.location.search);
      const seed = Number(q.get('seed')) || 1;
      const quarter = Number(q.get('q')) || 1;
      const from = parseClock(q.get('from'), 720);
      const to = parseClock(q.get('to'), from - 10);
      const every = Number(q.get('every')) || 0.1;
      const view = q.get('view') ?? 'both';
      // Zoomed in on the ball: a closer 3D camera and an enlarged crop of the 2D court.
      const zoom = q.has('zoom') && q.get('zoom') !== 'false';
      const want2d = view === '2d' || view === 'both';
      const want3d = view === '3d' || view === 'both';

      const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], seed, ['ai', 'ai'], 'normal');
      m.highlights = false;
      const renderer2d = new CourtRenderer([TEAM_COLOURS[0], TEAM_COLOURS[1]]);
      let scene: Scene3D | null = null;
      if (want3d) {
        say('loading 3D models');
        const assets = await loadAssets();
        scene = new Scene3D(c3.current!, assets, (k) => lookFor3d(m, k));
        scene.resize(W, H);
      }
      let sim = 0;
      const step = (draw3d: boolean) => {
        m.tick(DT);
        if (m.phase === 'timeout' || m.phase === 'break') m.resume();
        if (m.phase === 'argue') m.letItGo();
        if (m.phase === 'clutch') while (m.clutch) m.submitClutch(m.clutch.pending[0], null);
        const g = DT * (m.frame()?.timeScale ?? 1);
        sim += g;
        renderer2d.react(m.drainFx(), sim);
        if (draw3d && scene) scene.render(m.frame(), m.currentAction(), m.holderKey(), g, m.upcomingAction());
      };
      const before = (clock: number) => m.quarter < quarter || (m.quarter === quarter && m.clock > clock);

      // Play (nothing drawn) to just before the moment, then draw the 3D rigs for a few seconds so
      // their speeds, feet and hands have settled.
      say(`playing to ${periodLabel(quarter)} ${clockString(from)}`);
      for (let i = 0; m.phase !== 'final' && before(from + WARM_S); i++) {
        step(false);
        if (i % 3000 === 0) await yieldNow();
      }
      while (m.phase !== 'final' && before(from)) step(true);
      if (m.phase === 'final' || m.quarter !== quarter) throw new Error(`the match never reached ${periodLabel(quarter)} ${clockString(from)} (seed ${seed})`);

      const banner = (ctx: CanvasRenderingContext2D, label: string, t: number) => {
        ctx.fillStyle = '#0b1218';
        ctx.fillRect(0, 0, W, BANNER);
        ctx.fillStyle = '#ffe58a';
        ctx.font = '700 26px ui-monospace, Consolas, monospace';
        ctx.textBaseline = 'middle';
        const clock = `${periodLabel(m.quarter)} ${clockString(m.clock)}  (${m.clock.toFixed(1)} s)  +${t.toFixed(2)} s`;
        ctx.fillText(clock, 14, BANNER / 2);
        const w = ctx.measureText(clock).width;
        ctx.fillStyle = '#d6deec';
        ctx.font = '500 22px system-ui, sans-serif';
        const text = m.caption?.text ?? m.feed[0]?.text ?? '';
        ctx.fillText(`${label} · seed ${seed} · ${text}`.slice(0, 110), 34 + w, BANNER / 2);
      };
      const shoot = (t: number) => {
        const tag = `${periodLabel(m.quarter)}-${clockString(m.clock).replace(':', 'm')}s-t${t.toFixed(2)}`;
        const o = out.current!;
        const ctx = o.getContext('2d')!;
        const ball = m.frame()?.ball;
        if (want2d) {
          const g = c2.current!.getContext('2d')!;
          renderer2d.draw(g, m.frame(), courtDots(m), sim);
          ctx.clearRect(0, 0, W, H + BANNER);
          if (zoom && ball) {
            // A quarter of the court round the ball, scaled up to the full image.
            const k = c2.current!.width / CANVAS_W;
            const pt = project(ball.x, ball.y, 0);
            const cw = (CANVAS_W / 3.2) * k;
            const ch = cw / 2;
            const sx = Math.max(0, Math.min(c2.current!.width - cw, pt.x * k - cw / 2));
            const sy = Math.max(0, Math.min(c2.current!.height - ch, pt.y * k - ch * 0.62));
            ctx.drawImage(c2.current!, sx, sy, cw, ch, 0, BANNER, W, H);
          } else ctx.drawImage(c2.current!, 0, BANNER, W, H);
          banner(ctx, '2D', t);
          state.frames.push({ name: `${tag}-2d.png`, png: o.toDataURL('image/png') });
        }
        if (want3d && scene) {
          if (zoom && ball) {
            const b = toScene(ball.x, ball.y, 0);
            scene.devCamera = { from: new THREE.Vector3(b.x - 5.2, 4.2, b.z + 6.8), to: new THREE.Vector3(b.x, 1.2, b.z) };
          }
          scene.render(m.frame(), m.currentAction(), m.holderKey(), 0, m.upcomingAction());
          ctx.clearRect(0, 0, W, H + BANNER);
          ctx.drawImage(c3.current!, 0, BANNER, W, H);
          banner(ctx, '3D', t);
          state.frames.push({ name: `${tag}-3d.png`, png: o.toDataURL('image/png') });
        }
      };

      say('capturing');
      let t = 0;
      let next = 0;
      let shots = 0;
      while ((m.phase as string) !== 'final' && m.quarter === quarter && m.clock >= to && shots < MAX_FRAMES) {
        if (t + 1e-9 >= next) {
          shoot(t);
          shots++;
          next += every;
          await yieldNow();
        }
        const s0 = sim;
        step(true);
        t += sim - s0;
      }
      say(`done: ${shots} moments, ${state.frames.length} images`);
      state.done = true;
    })().catch((e: unknown) => {
      state.error = e instanceof Error ? e.message : String(e);
      say(`error: ${state.error}`);
      state.done = true;
    });
  }, []);

  return (
    <div style={{ padding: 16, font: '14px system-ui', color: '#d6deec', background: '#0d1218', minHeight: '100vh' }}>
      <div id="capture-status">{status}</div>
      <canvas ref={c2} width={W} height={(W * CANVAS_H) / CANVAS_W} style={{ display: 'none' }} />
      <canvas ref={c3} width={W} height={H} style={{ position: 'absolute', left: -10000, top: 0, width: W, height: H }} />
      <canvas ref={out} width={W} height={H + BANNER} style={{ display: 'none' }} />
    </div>
  );
}
