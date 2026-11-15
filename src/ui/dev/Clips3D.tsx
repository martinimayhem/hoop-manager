// Dev only (?clips3d; `npm run shots -- clips3d`): the base body playing each Mixamo clip, at four
// angles, through the clip, on a floor grid, to check that nothing twists or slides. A loop that
// travels (the run) is moved over the floor at its own ground speed: a planted foot should then stand
// still on the grid. The slip of the planted foot is measured and printed under each row.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Player3D, type PlayerLook } from '../court3d/player3d';
import { loadAssets } from '../court3d/scene3d';
import { TEAM_COLOURS } from '../labels';

/** ?clips3d: the clips the game uses; ?clips3d=all also the rest (after npm run retarget -- --all). */
const CLIPS =
  new URLSearchParams(window.location.search).get('clips3d') === 'all'
    ? ['DefendDribble', 'DefendSidestep', 'CatchBall', 'Catch', 'InboundPass', 'Fall', 'StandUp']
    : ['Dribble', 'Dribble_L', 'Run'];
const COLS = 10;
const TILE_W = 150;
const TILE_H = 210;
const LABEL_W = 150;
const ANGLES = [0, Math.PI / 4, Math.PI / 2, Math.PI];
const ANGLE_NAMES = ['front', '3/4', 'side', 'back'];

declare global {
  interface Window {
    __shots?: { done: boolean; images: { name: string; png: string; label?: string }[]; error?: string };
  }
}

const KIT = TEAM_COLOURS[0];
const LOOK: PlayerLook = { heightM: 2.0, girth: 1, skin: '#8d5a43', hair: '#1a1412', hairstyle: 'short', facialHair: 'none', jersey: KIT.fill, jerseyText: KIT.text, shorts: KIT.text, number: '7' };

export function Clips3D() {
  const out = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('loading');
  useEffect(() => {
    window.__shots = { done: false, images: [] };
    (async () => {
      const assets = await loadAssets();
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(TILE_W, TILE_H);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x2a2f38);
      scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x2a2018, 1.0));
      const key = new THREE.DirectionalLight(0xffffff, 1.5);
      key.position.set(3, 10, 4);
      scene.add(key);
      // A floor grid (25 cm squares): a planted foot stays on one spot of it.
      const grid = new THREE.GridHelper(40, 160, 0x8892a0, 0x4a5260);
      scene.add(grid);
      const camera = new THREE.PerspectiveCamera(30, TILE_W / TILE_H, 0.05, 50);
      const rig = new Player3D(assets.character, assets.clips, assets.info, LOOK);
      scene.add(rig.root);

      const canvas = out.current!;
      canvas.width = LABEL_W + COLS * TILE_W;
      canvas.height = CLIPS.length * (ANGLES.length * TILE_H + 30);
      const g = canvas.getContext('2d')!;
      g.fillStyle = '#14171c';
      g.fillRect(0, 0, canvas.width, canvas.height);
      let y0 = 0;
      for (const name of CLIPS) {
        const info = Player3D.clipInfo(name);
        if (!info) continue;
        setStatus(name);
        // Ground speed: a travelling loop's travel per cycle, scaled to this player (the clip is for a 1.82 m model).
        const travel = info.travel ? Math.hypot(info.travel[0], info.travel[2]) : 0;
        const speed = (travel / info.duration) * (LOOK.heightM / 1.82);
        // The planted foot's slip: how far the lower toe moves over the floor while it is down.
        // (A foot is down when its toe is within 2 cm of the lowest the toes get in the clip.)
        const steps = 120;
        const toes: { l: THREE.Vector3; r: THREE.Vector3 }[] = [];
        for (let i = 0; i <= steps; i++) {
          const t = (i / steps) * info.duration;
          rig.showClip(name, t, new THREE.Vector3(0, 0, speed * t));
          toes.push({ l: rig.boneAt('ball_l'), r: rig.boneAt('ball_r') });
        }
        const floor = Math.min(...toes.flatMap((p) => [p.l.y, p.r.y]));
        // Each step: how far the toe moves over the floor from when it comes down to when it lifts.
        let slip = 0;
        for (const sd of ['l', 'r'] as const) {
          let from: THREE.Vector3 | null = null;
          for (const p of toes) {
            const down = p[sd].y < floor + 0.02;
            if (down && !from) from = p[sd];
            if (down && from) slip = Math.max(slip, Math.hypot(p[sd].x - from.x, p[sd].z - from.z));
            if (!down) from = null;
          }
        }
        for (let a = 0; a < ANGLES.length; a++) {
          for (let c = 0; c < COLS; c++) {
            const t = (c / COLS) * info.duration;
            const at = new THREE.Vector3(0, 0, speed * t);
            rig.showClip(name, t, at);
            const look = at.clone().add(new THREE.Vector3(0, 0.95, 0));
            const ang = ANGLES[a];
            // His front is +z; round towards +x for the three-quarter and side views.
            camera.position.copy(look).add(new THREE.Vector3(Math.sin(ang) * 6.2, 0.6, Math.cos(ang) * 6.2));
            camera.lookAt(look);
            renderer.render(scene, camera);
            g.drawImage(renderer.domElement, LABEL_W + c * TILE_W, y0 + a * TILE_H);
            if (a === 0) {
              g.fillStyle = '#cfd6e0';
              g.font = '12px system-ui, sans-serif';
              g.fillText(`${t.toFixed(2)} s`, LABEL_W + c * TILE_W + 6, y0 + 14);
            }
          }
          g.fillStyle = '#cfd6e0';
          g.font = '12px system-ui, sans-serif';
          g.fillText(ANGLE_NAMES[a], 8, y0 + a * TILE_H + 60);
        }
        g.fillStyle = '#e8edf3';
        g.font = 'bold 15px system-ui, sans-serif';
        g.fillText(name, 8, y0 + 24);
        g.font = '12px system-ui, sans-serif';
        const note = `${info.duration.toFixed(2)} s; ${speed > 0 ? `moved at its ground speed ${speed.toFixed(2)} m/s; ` : 'in place; '}a planted foot drifts at most ${(slip * 100).toFixed(1)} cm while it is down`;
        g.fillText(note, 8, y0 + ANGLES.length * TILE_H + 18);
        console.log(`${name}: ${note}`);
        y0 += ANGLES.length * TILE_H + 30;
      }
      renderer.dispose();
      setStatus('done');
      window.__shots = { done: true, images: [{ name: 'clips.png', png: canvas.toDataURL('image/png') }] };
    })().catch((e) => {
      setStatus(String(e));
      window.__shots = { done: true, images: [], error: String(e?.stack ?? e) };
    });
  }, []);
  return (
    <div style={{ background: '#14171c', color: '#cfd6e0', minHeight: '100vh', padding: 8 }}>
      <div>{status}</div>
      <canvas ref={out} />
    </div>
  );
}
