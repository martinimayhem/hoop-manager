// Dev only (?dribble3d; `npm run shots -- dribble3d`): one player dribbling standing, walking and
// sprinting, drawn by the game's own 3D view, every 0.05 s for 2 seconds (after 2 s to settle), seen
// side on from his dribbling side. Each frame says where the ball is in the dribble; each catch, how far
// the ball was from the palm when the hand met it and how fast it was still rising. Saves each frame
// and a sheet per speed.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { BallAction, Frame } from '../court/animation';
import { dropMixamoClip, toScene, type PlayerLook } from '../court3d/player3d';
import { Scene3D, loadAssets } from '../court3d/scene3d';
import { TEAM_COLOURS } from '../labels';

const W = 640;
const H = 480;
const BANNER = 40;
const DT = 1 / 60;
const WARM_S = 2;
const EVERY_S = 0.05;
const SHOW_S = 2;
/**
 * Each case: how fast he goes and which way (court angle; he always faces +x, angle 0), and where the
 * defender is from him (m along x, across y: +y is his right). The hand should be the one away from the
 * defender, and the ball bounce the way he is going.
 */
const CASES = [
  { name: 'standing', speed: 0, dir: 0, def: { x: 1.4, y: -0.45 } },
  { name: 'walking', speed: 1.6, dir: 0, def: { x: 1.4, y: 0.5 } },
  { name: 'sprinting', speed: 6.5, dir: 0, def: { x: 1.8, y: -0.45 } },
  { name: 'sliding sideways', speed: 2.5, dir: Math.PI / 2, def: { x: 1.4, y: -0.3 } },
];
const KIT = TEAM_COLOURS[0];
const DEF_KIT = TEAM_COLOURS[1];
const DEF_LOOK: PlayerLook = { heightM: 1.98, girth: 1, skin: '#c4977a', hair: '#272421', hairstyle: 'curly', facialHair: 'none', jersey: DEF_KIT.fill, jerseyText: DEF_KIT.text, shorts: DEF_KIT.text, number: '4' };
const LOOK: PlayerLook = { heightM: 2.0, girth: 1, skin: '#8d5a43', hair: '#1a1412', hairstyle: 'short', facialHair: 'none', jersey: KIT.fill, jerseyText: KIT.text, shorts: KIT.text, number: '7' };

export function Dribble3D() {
  const c3 = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('loading');
  useEffect(() => {
    window.__shots = { done: false, images: [] };
    (async () => {
      const assets = await loadAssets();
      // ?noclip=<name>: draw without that clip (the "before" of a change).
      const noclip = new URLSearchParams(window.location.search).get('noclip');
      if (noclip) dropMixamoClip(noclip);
      const scene = new Scene3D(c3.current!, assets, (k) => (k.startsWith('1:') ? DEF_LOOK : LOOK));
      scene.resize(W, H);
      const images: { name: string; png: string }[] = [];
      const out = document.createElement('canvas');
      out.width = 2 * W;
      out.height = H + BANNER;
      const g = out.getContext('2d')!;
      const summary: string[] = [];
      for (const [ci, c] of CASES.entries()) {
        setStatus(c.name);
        const key = `0:${c.name}`;
        const y = c.dir ? 2.5 : 7.6;
        const x0 = c.speed > 3 ? 1 : 10;
        const action: BallAction = { kind: 'held', holder: key, dribble: true };
        const sheet = document.createElement('canvas');
        const cols = 8;
        const tw = W;
        const th = (H + BANNER) / 2;
        const n = Math.round(SHOW_S / EVERY_S);
        sheet.width = cols * tw;
        sheet.height = Math.ceil(n / cols) * th;
        const sg = sheet.getContext('2d')!;
        const catches: { gap: number; rising: number; height: number }[] = [];
        let lastPhase = '';
        let t = 0;
        let shot = 0;
        const steps = Math.round((WARM_S + SHOW_S) / DT);
        for (let i = 0; i <= steps; i++) {
          t = i * DT;
          const x = x0 + c.speed * Math.cos(c.dir) * t;
          const yy = y + c.speed * Math.sin(c.dir) * t;
          // The frame's ball on his right: the right hand dribbles. A defender on him, in front and a
          // little to his left (so the front camera still sees the ball), facing him in his stance.
          const def = `1:${c.name}`;
          const frame: Frame = {
            players: { [key]: { x, y: yy }, [def]: { x: x + c.def.x, y: yy + c.def.y } },
            ball: { x, y: yy + 0.4, z: 0.9 },
            facing: { [key]: 0, [def]: Math.PI },
            look: { [key]: 0, [def]: Math.PI },
            stance: { [def]: 0.85 },
            timeScale: 1,
          };
          const at = toScene(x, yy);
          const capture = t >= WARM_S - 1e-9 && Math.abs((t - WARM_S) / EVERY_S - Math.round((t - WARM_S) / EVERY_S)) < 1e-6 && shot < n;
          // Side on, from his right (court +y), at the height of the bounce.
          scene.devCamera = { from: new THREE.Vector3(at.x, 1.15, at.z + 4.2), to: new THREE.Vector3(at.x, 0.8, at.z) };
          scene.render(frame, action, key, DT);
          if (capture) {
            g.drawImage(c3.current!, 0, BANNER, W, H);
            // And straight on from in front: how far out to his side the ball is, against his legs.
            scene.devCamera = { from: new THREE.Vector3(at.x + 4.5, 1.0, at.z), to: new THREE.Vector3(at.x, 0.7, at.z) };
            scene.render(frame, action, key, 0);
            g.drawImage(c3.current!, W, BANNER, W, H);
          }
          const info = scene.rigOf(key)?.dribbleInfo;
          if (info && t >= WARM_S && lastPhase === 'flight' && info.phase !== 'flight') catches.push({ gap: info.gap, rising: info.rising, height: info.ball.y });
          lastPhase = info?.phase ?? '';
          if (capture) {
            g.fillStyle = '#0b0e13';
            g.fillRect(0, 0, 2 * W, BANNER);
            g.fillStyle = '#ffd36b';
            g.font = 'bold 15px ui-monospace, monospace';
            g.fillText(`${c.name} ${c.speed.toFixed(1)} m/s  t ${(t - WARM_S).toFixed(2)} s`, 10, 17);
            g.fillStyle = '#cfd6e0';
            g.font = '13px system-ui, sans-serif';
            g.fillText(`${scene.rigOf(key)?.state.arms ?? ''}   |   defender: ${scene.rigOf(def)?.state.arms ?? ''}`, 10, 34);
            const png = out.toDataURL('image/png');
            images.push({ name: `${c.name}/${String(shot).padStart(3, '0')}-t${(t - WARM_S).toFixed(2)}.png`, png });
            sg.drawImage(out, (shot % cols) * tw, Math.floor(shot / cols) * th, tw, th);
            shot++;
          }
        }
        images.push({ name: `sheet-${ci}-${c.name}.png`, png: sheet.toDataURL('image/png') });
        const worst = catches.reduce((m, k) => Math.max(m, k.gap), 0);
        const line = `${c.name} (${c.speed} m/s): ${catches.length} catches in 2 s; ball met the palm at most ${(worst * 100).toFixed(1)} cm off; still rising ${catches.map((k) => k.rising.toFixed(2)).join(', ')} m/s as the hand met it; ball centre at the catch ${catches.map((k) => k.height.toFixed(2)).join(', ')} m (he is ${LOOK.heightM} m)`;
        summary.push(line);
        console.log(line);
      }
      setStatus('done');
      window.__shots = { done: true, images, error: undefined };
      void summary;
    })().catch((e) => {
      setStatus(String(e));
      window.__shots = { done: true, images: [], error: String(e?.stack ?? e) };
    });
  }, []);
  return (
    <div style={{ background: '#14171c', color: '#cfd6e0', minHeight: '100vh', padding: 8 }}>
      <div>{status}</div>
      <canvas ref={c3} width={W} height={H} />
    </div>
  );
}
