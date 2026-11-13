// Dev only (open the app with ?3d, &seed=N, &player=0:ham-3): the 3D view on its own. A live AI-vs-AI
// match runs through the normal controller and every player is drawn as a rigged 3D figure from the
// frame data. Pick a player to follow in the readout (and __3d.close() for a close-up), slow it down,
// and watch the feet and hands.

import { useEffect, useRef, useState } from 'react';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../../data/teams';
import { Scene3D, loadAssets, type Assets } from '../court3d/scene3d';
import { probe } from './court3dProbe';
import { installContact } from './court3dContact';
import { lookFor3d } from '../court3d/roster3d';
import { LiveMatch } from '../match/controller';

const SPEEDS = [0.25, 0.5, 1, 2];

export function Court3DPreview() {
  const params = new URLSearchParams(window.location.search);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [m] = useState(() => {
    const live = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], Number(params.get('seed')) || 1, ['ai', 'ai'], 'normal');
    live.highlights = false;
    return live;
  });
  const [key, setKey] = useState(params.get('player') ?? `0:${m.view[0].lineup[0]}`);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [readout, setReadout] = useState('loading…');
  const [assets, setAssets] = useState<Assets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef({ speed, paused });
  live.current = { speed, paused };
  const sceneRef = useRef<Scene3D | null>(null);
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    loadAssets().then(setAssets, (e: unknown) => setError(String(e)));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !assets) return;
    const scene = (sceneRef.current ??= new Scene3D(canvas, assets, (k) => lookFor3d(m, k)));
    scene.focus = keyRef.current;
    // For poking at it from the console.
    Object.assign(window, { __3d: probe(m, scene) });
    installContact(m, scene);
    const fit = () => scene.resize(canvas.clientWidth, canvas.clientHeight);
    fit();
    window.addEventListener('resize', fit);
    let raf = 0;
    let last = performance.now();
    let shown = 0;
    const loop = (now: number) => {
      const real = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { speed: k, paused: stop } = live.current;
      let game = 0;
      if (!stop && m.phase !== 'final') {
        m.tick(real * k);
        if (m.phase === 'timeout' || m.phase === 'break') m.resume();
        if (m.phase === 'argue') m.letItGo();
        // Match seconds that went by: the rig plays at match time, so slow motion slows his legs too.
        game = real * k * (m.frame()?.timeScale ?? 1);
      }
      scene.render(m.frame(), m.currentAction(), m.holderKey(), game, m.upcomingAction());
      const rig = scene.rigOf(scene.focus);
      if (now - shown > 120 && rig) {
        shown = now;
        const s = rig.state;
        const w = Object.entries(s.weights)
          .map(([n, x]) => `${n.replace('_Loop', '')} ${x.toFixed(2)}`)
          .join(' · ');
        setReadout(`Q${m.quarter} ${Math.floor(m.clock / 60)}:${String(Math.floor(m.clock % 60)).padStart(2, '0')} · ${s.speed.toFixed(1)} m/s · ${w} ${s.mode ? `· ${s.mode}` : ''}${s.arms ? ` · arms: ${s.arms}` : ''}`);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', fit);
    };
  }, [assets, m]);

  // The player the readout and the close-up follow.
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.focus = key;
  }, [key]);

  const players = ([0, 1] as const).flatMap((side) => m.s.teams[side].team.players.map((p) => ({ key: `${side}:${p.id}`, label: `${side === 0 ? 'HAM' : 'SKY'} #${p.number} ${p.name} ${p.position}` })));
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0d1218', color: '#d6deec', font: '13px system-ui' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', flexWrap: 'wrap' }}>
        <b>3D view (dev)</b>
        <select value={key} onChange={(e) => setKey(e.target.value)}>
          {players.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
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
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#9fb0c8' }}>{error ?? readout}</span>
      </div>
      <canvas ref={canvasRef} style={{ flex: 1, width: '100%', minHeight: 0, display: 'block' }} />
    </div>
  );
}
