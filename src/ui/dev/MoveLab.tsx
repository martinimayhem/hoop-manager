// Dev only (?movelab, &seed=N): loops one move in slow motion, with the match's own renderers.
// Pick a move; the lab finds the first time it happens in a match (played without drawing; the match
// is deterministic), records the frame data for a short window round it, and loops that window at the
// chosen speed. Between recorded steps the positions are blended, so slow motion is smooth.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../../data/teams';
import { beatAt, isRef, type BallAction, type Beat, type Frame, type Script } from '../court/animation';
import { courtDots } from '../court/dots';
import { CANVAS_H, CANVAS_W, CourtRenderer, type DotInfo } from '../court/render';
import { toScene, type Upcoming } from '../court3d/player3d';
import { lookFor3d } from '../court3d/roster3d';
import { Scene3D, loadAssets } from '../court3d/scene3d';
import { TEAM_COLOURS, clockString, periodLabel } from '../labels';
import { LiveMatch } from '../match/controller';

const DT = 1 / 60;
/** Recorded (drawn) before the window starts, so the rigs have settled when it is shown. */
const WARM_S = 1;

type MoveId = 'dribbleStand' | 'dribbleRun' | 'jumpShot' | 'layup' | 'dunk' | 'rebound' | 'closeout' | 'chase';

interface Found {
  subject: string;
  /** Who else matters (drawn highlighted in the readout). */
  other?: string;
  /** For the camera: a point he is facing or moving towards (court metres). */
  towards?: { x: number; y: number };
}

interface Internals {
  script: Script | null;
  durations: number[];
  t: number;
}

interface Ctx {
  m: LiveMatch;
  beat: Beat | null;
  speed: (k: string) => number;
}

const MOVES: { id: MoveId; label: string; pre: number; post: number; find: (c: Ctx) => Found | null }[] = [
  {
    id: 'dribbleStand',
    label: 'Dribble standing',
    pre: 0.4,
    post: 2.2,
    find: ({ m, speed }) => {
      const a = m.currentAction();
      const h = m.holderKey();
      return a?.kind === 'held' && a.dribble && h && speed(h) < 0.8 && (m.frame()?.ball.z ?? 0) > 0.8 ? { subject: h } : null;
    },
  },
  {
    id: 'dribbleRun',
    label: 'Dribble while running',
    pre: 0.4,
    post: 1.8,
    find: ({ m, speed }) => {
      const a = m.currentAction();
      const h = m.holderKey();
      return a?.kind === 'held' && a.dribble && h && speed(h) > 4.5 ? { subject: h } : null;
    },
  },
  {
    id: 'jumpShot',
    label: 'Jump shot',
    pre: 0.5,
    post: 1.9,
    find: ({ m }) => {
      const n = m.upcomingAction();
      return n && n.action.kind === 'fromPlayer' && n.action.style === 'jumper' && n.in < 0.3 && m.holderKey() === n.action.from ? { subject: n.action.from, towards: n.action.to } : null;
    },
  },
  {
    id: 'layup',
    label: 'Layup',
    pre: 1.0,
    post: 1.6,
    find: ({ m }) => {
      const a = m.currentAction();
      return a?.kind === 'fromPlayer' && a.style === 'layup' && m.frame()?.shooter === a.from ? { subject: a.from, towards: a.to } : null;
    },
  },
  {
    id: 'dunk',
    label: 'Dunk',
    pre: 1.2,
    post: 1.8,
    find: ({ m }) => {
      const a = m.currentAction();
      return a?.kind === 'fromPlayer' && a.style === 'dunk' && m.frame()?.shooter === a.from ? { subject: a.from, towards: a.to } : null;
    },
  },
  {
    id: 'rebound',
    label: 'Rebound',
    pre: 2.0,
    post: 1.0,
    find: ({ m }) => {
      const a = m.currentAction();
      return a?.kind === 'toPlayer' && a.high ? { subject: a.to } : null;
    },
  },
  {
    id: 'closeout',
    label: 'Defensive closeout',
    pre: 0.5,
    post: 1.6,
    find: ({ m, speed }) => {
      // A catch out on the perimeter, and the defender running at the catcher with his hands up.
      const a = m.currentAction();
      const f = m.frame();
      if (a?.kind !== 'pass' || !f || !a.to.includes(':')) return null;
      const to = f.players[a.to];
      if (!to) return null;
      const side = a.to.slice(0, 2);
      let best: string | null = null;
      let bestD = Infinity;
      for (const [k, p] of Object.entries(f.players)) {
        if (isRef(k) || k.startsWith(side)) continue;
        const d = Math.hypot(p.x - to.x, p.y - to.y);
        if (d < bestD) [best, bestD] = [k, d];
      }
      return best && bestD > 2 && bestD < 4.5 && speed(best) > 2.5 ? { subject: best, other: a.to, towards: to } : null;
    },
  },
  {
    id: 'chase',
    label: 'Fast-break chase',
    pre: 0.3,
    post: 2.8,
    find: ({ beat }) => {
      const chase = beat?.chase;
      if (!chase) return null;
      const [chaser, target] = Object.entries(chase)[0] ?? [];
      return chaser ? { subject: chaser, other: target } : null;
    },
  },
];

interface Step {
  frame: Frame;
  action: BallAction | null;
  holder: string | null;
  next: Upcoming | null;
  dt: number;
  caption: string;
  clock: number;
  quarter: number;
}

/** Blend two frames: positions, the ball, jumps, facing (the short way round), hands, stance. */
function blend(a: Frame, b: Frame, k: number): Frame {
  const mix = (x: number, y: number) => x + (y - x) * k;
  const players: Frame['players'] = {};
  for (const [key, p] of Object.entries(a.players)) {
    const q = b.players[key] ?? p;
    players[key] = { x: mix(p.x, q.x), y: mix(p.y, q.y) };
  }
  const rec = (ra?: Record<string, number>, rb?: Record<string, number>, angle = false) => {
    if (!ra) return rb;
    const out: Record<string, number> = {};
    for (const key of new Set([...Object.keys(ra), ...Object.keys(rb ?? {})])) {
      const x = ra[key] ?? 0;
      const y = rb?.[key] ?? x;
      out[key] = angle ? x + Math.atan2(Math.sin(y - x), Math.cos(y - x)) * k : mix(x, y);
    }
    return out;
  };
  return {
    ...a,
    players,
    ball: { x: mix(a.ball.x, b.ball.x), y: mix(a.ball.y, b.ball.y), z: mix(a.ball.z, b.ball.z) },
    lift: rec(a.lift, b.lift),
    facing: rec(a.facing, b.facing, true),
    look: rec(a.look, b.look, true),
    stance: rec(a.stance, b.stance),
    reach: rec(a.reach, b.reach),
  };
}

const SPEEDS = [0.1, 0.25, 0.5, 1];

export function MoveLab() {
  const params = new URLSearchParams(window.location.search);
  const seed = Number(params.get('seed')) || 1;
  const [move, setMove] = useState<MoveId>((params.get('move') as MoveId) || 'dribbleStand');
  const [speed, setSpeed] = useState(0.25);
  const [view, setView] = useState<'3d' | '2d' | 'both'>('3d');
  const [camera, setCamera] = useState<'side' | 'behind' | 'game'>('side');
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState('loading…');
  const [readout, setReadout] = useState('');
  const c3 = useRef<HTMLCanvasElement>(null);
  const c2 = useRef<HTMLCanvasElement>(null);
  const live = useRef({ speed, view, camera, paused });
  live.current = { speed, view, camera, paused };
  const sceneRef = useRef<Scene3D | null>(null);
  const matchRef = useRef<LiveMatch | null>(null);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    (async () => {
      setStatus(`Finding a ${MOVES.find((x) => x.id === move)!.label.toLowerCase()}…`);
      await new Promise((r) => setTimeout(r, 20));
      const assets = await loadAssets();
      if (cancelled) return;
      const def = MOVES.find((x) => x.id === move)!;
      const fresh = () => {
        const live = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], seed, ['ai', 'ai'], 'normal');
        live.highlights = false;
        return live;
      };
      let m = fresh();
      matchRef.current = m;
      const scene = (sceneRef.current ??= new Scene3D(c3.current!, assets, (k) => lookFor3d(matchRef.current!, k)));
      scene.resize(c3.current!.clientWidth || 960, c3.current!.clientHeight || 540);
      const step = () => {
        m.tick(DT);
        if (m.phase === 'timeout' || m.phase === 'break') m.resume();
        if (m.phase === 'argue') m.letItGo();
      };
      // Find the move, nothing drawn.
      const last: Record<string, { x: number; y: number }> = {};
      const speedNow: Record<string, number> = {};
      let found: Found | null = null;
      let at = -1;
      for (let i = 0; i < 2880 / DT && m.phase !== 'final'; i++) {
        step();
        const f = m.frame();
        if (!f) continue;
        const g = DT * (f.timeScale ?? 1);
        for (const [k, p] of Object.entries(f.players)) {
          const q = last[k];
          if (q) speedNow[k] = (speedNow[k] ?? 0) * 0.8 + (Math.hypot(p.x - q.x, p.y - q.y) / g) * 0.2;
          last[k] = { x: p.x, y: p.y };
        }
        const inner = m as unknown as Internals;
        const beat = inner.script ? inner.script.beats[beatAt(inner.script, inner.durations, inner.t).index] : null;
        // Not the tip-off, and not a dead ball.
        if ((m.quarter === 1 && m.clock > 710) || !beat || beat.dead) continue;
        found = def.find({ m, beat, speed: (k) => speedNow[k] ?? 0 });
        if (found) {
          at = i;
          break;
        }
      }
      if (!found || at < 0) {
        setStatus(`No ${def.label.toLowerCase()} in this match (seed ${seed}). Try another seed.`);
        return;
      }
      // Replay to the window and record it.
      m = fresh();
      matchRef.current = m;
      const start = Math.max(0, at - Math.round((def.pre + WARM_S) / DT));
      const end = at + Math.round(def.post / DT);
      const steps: Step[] = [];
      for (let i = 0; i <= end; i++) {
        step();
        if (i < start) continue;
        const f = m.frame();
        if (!f) continue;
        steps.push({ frame: f, action: m.currentAction(), holder: m.holderKey(), next: m.upcomingAction(), dt: DT * (f.timeScale ?? 1), caption: m.caption?.text ?? m.feed[0]?.text ?? '', clock: m.clock, quarter: m.quarter });
      }
      const warm = Math.round(WARM_S / DT);
      const subject = found.subject;
      const towards = found.towards ? toScene(found.towards.x, found.towards.y) : null;
      const renderer2d = new CourtRenderer([TEAM_COLOURS[0], TEAM_COLOURS[1]]);
      const dotsBase = courtDots(m);
      // The move's own moment (not the window's start), and the frames command to capture it.
      const moment = steps[at - start] ?? steps[warm];
      const mClock = moment?.clock ?? 0;
      const mm = `${Math.floor(mClock / 60)}:${(mClock % 60).toFixed(1).padStart(4, '0')}`;
      setStatus(
        `${def.label}: ${subject}${found.other ? ` (with ${found.other})` : ''} · at ${periodLabel(moment?.quarter ?? 1)} ${mm} (${mClock.toFixed(1)} s) · seed ${seed} · ${steps.length - warm} steps, looped · npm run frames -- --seed ${seed} --quarter ${moment?.quarter ?? 1} --from ${mm} --every 0.05 --follow ${subject}`,
      );

      // Play: each loop starts fresh (rigs reset, then the warm-up steps drawn at once), then the window at the chosen speed.
      let pos = 0;
      let lastNow = performance.now();
      const restart = () => {
        scene.resetPlayers();
        for (let i = 0; i < warm; i++) scene.render(steps[i].frame, steps[i].action, steps[i].holder, steps[i].dt, steps[i].next);
        pos = warm;
      };
      restart();
      const aim = (f: Frame) => {
        const cam = live.current.camera;
        if (cam === 'game') {
          scene.devCamera = null;
          scene.closeUp = false;
          return;
        }
        const p = f.players[subject];
        if (!p) return;
        const at3 = toScene(p.x, p.y);
        const rig = scene.rigOf(subject);
        let dir = rig?.facingAngle ?? 0;
        if (towards) dir = Math.atan2(towards.z - at3.z, towards.x - at3.x);
        const lift = f.lift?.[subject] ?? 0;
        if (cam === 'side') {
          scene.devCamera = { from: new THREE.Vector3(at3.x + Math.sin(dir) * 4.2, 1.7 + lift, at3.z - Math.cos(dir) * 4.2), to: new THREE.Vector3(at3.x, 1.1 + lift * 0.8, at3.z) };
        } else {
          scene.devCamera = { from: new THREE.Vector3(at3.x - Math.cos(dir) * 4, 2.2 + lift, at3.z - Math.sin(dir) * 4), to: new THREE.Vector3(at3.x, 1.1 + lift * 0.8, at3.z) };
        }
      };
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        const realDt = Math.min(0.1, (now - lastNow) / 1000);
        lastNow = now;
        const { speed: k, view: v, paused: hold } = live.current;
        const prev = pos;
        if (!hold) pos += (realDt * k) / DT;
        if (pos >= steps.length - 1) {
          restart();
          return;
        }
        const i = Math.floor(pos);
        const frac = pos - i;
        const s = steps[i];
        const f = blend(s.frame, steps[i + 1].frame, frac);
        const dt = hold ? 0 : ((pos - prev) * s.dt) / 1;
        aim(f);
        if (v !== '2d') scene.render(f, s.action, s.holder, dt, s.next);
        if (v !== '3d') {
          const ctx = c2.current?.getContext('2d');
          if (ctx) {
            const dots: Record<string, DotInfo> = {};
            for (const [key, d] of Object.entries(dotsBase)) dots[key] = { ...d, hasBall: key === s.holder };
            renderer2d.draw(ctx, f, dots, i * DT);
          }
        }
        const rig = scene.rigOf(subject);
        setReadout(`${periodLabel(s.quarter)} ${clockString(s.clock)} · step ${i - warm} · ${subject}: ${rig?.state.arms || '–'} · ${s.caption}`);
      };
      raf = requestAnimationFrame(loop);
    })().catch((e: unknown) => setStatus(String(e)));
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [move, seed]);

  useEffect(() => {
    const fit = () => {
      const c = c3.current;
      if (c && sceneRef.current) sceneRef.current.resize(c.clientWidth, c.clientHeight);
    };
    window.addEventListener('resize', fit);
    fit();
    return () => window.removeEventListener('resize', fit);
  }, [view]);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0d1218', color: '#d6deec', font: '13px system-ui' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', flexWrap: 'wrap' }}>
        <b>Move lab</b>
        <select value={move} onChange={(e) => setMove(e.target.value as MoveId)}>
          {MOVES.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
        {SPEEDS.map((s) => (
          <button key={s} className={`small ${speed === s ? 'active' : ''}`} onClick={() => setSpeed(s)}>
            {s}×
          </button>
        ))}
        <button className="small" onClick={() => setPaused(!paused)}>
          {paused ? '▶ Play' : '⏸ Pause'}
        </button>
        <select value={camera} onChange={(e) => setCamera(e.target.value as typeof camera)}>
          <option value="side">Camera: side on</option>
          <option value="behind">Camera: behind</option>
          <option value="game">Camera: game view</option>
        </select>
        <select value={view} onChange={(e) => setView(e.target.value as typeof view)}>
          <option value="3d">3D</option>
          <option value="2d">2D</option>
          <option value="both">3D and 2D</option>
        </select>
        <span style={{ color: '#9fb0c8' }}>{status}</span>
      </div>
      <div style={{ padding: '0 12px 6px', fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#9fb0c8' }}>{readout}</div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 8, padding: '0 12px 12px' }}>
        <canvas ref={c3} style={{ flex: 1, minWidth: 0, height: '100%', display: view === '2d' ? 'none' : 'block' }} />
        <canvas ref={c2} width={CANVAS_W * 2} height={CANVAS_H * 2} style={{ flex: 1, minWidth: 0, width: view === 'both' ? '50%' : '100%', aspectRatio: '2 / 1', alignSelf: 'center', display: view === '3d' ? 'none' : 'block' }} />
      </div>
    </div>
  );
}
