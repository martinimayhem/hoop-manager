// Dev only: the 3D heads, close up (open with ?heads3d, or ?heads3d=match&seed=1). `npm run heads`
// saves both sheets to frames/heads/.
//
// ?heads3d: every hairstyle on each skin tone (one from each palette), each at four angles (front,
// three-quarter, side, back), with the facial hair cycling so every kind turns up.
// ?heads3d=match: the ten players of a match, each beside his 2D portrait and a swatch of his skin
// from the appearance record, at the same four angles.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../../data/teams';
import { isRef, type Frame } from '../court/animation';
import { Player3D, type PlayerLook } from '../court3d/player3d';
import { lookFor3d } from '../court3d/roster3d';
import { loadAssets } from '../court3d/scene3d';
import { TEAM_COLOURS } from '../labels';
import { FACIAL_HAIRS, HAIRSTYLES, PALETTE, appearanceOf, portraitUrl, type Race } from '../looks';
import { LiveMatch } from '../match/controller';

const TILE_W = 150;
const TILE_H = 170;
const LABEL_W = 170;
/** Front, three-quarter, side, back: how far round from his front the camera is. */
const ANGLES = [0, Math.PI / 4, Math.PI / 2, Math.PI];
const ANGLE_NAMES = ['front', '3/4', 'side', 'back'];

declare global {
  interface Window {
    __heads?: { done: boolean; png?: string; error?: string };
  }
}

interface Row {
  label: string[];
  look: PlayerLook;
  portrait?: string;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = fail;
    img.src = src;
  });
}

function styleRows(): Row[][] {
  const races: Race[] = ['black', 'white', 'brown', 'asian'];
  const kit = TEAM_COLOURS[0];
  return HAIRSTYLES.map((hairstyle, h) =>
    races.map((race, k) => {
      const pal = PALETTE[race];
      const facialHair = FACIAL_HAIRS[(h + k) % FACIAL_HAIRS.length];
      const skin = pal.skin[(h + k) % pal.skin.length];
      const hair = pal.hair[(h * 3 + k) % pal.hair.length];
      const headband = (h + k) % 7 === 3;
      return {
        label: [hairstyle, `${race} ${skin}`, `${facialHair}${headband ? ' +band' : ''}`],
        look: { heightM: 2.0, girth: 1, skin, hair, hairstyle, facialHair, headband, jersey: kit.fill, jerseyText: kit.text, shorts: kit.text, number: '7' },
      };
    }),
  );
}

function matchRows(seed: number): Row[][] {
  const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], seed, ['ai', 'ai'], 'normal');
  for (let i = 0; i < 600 && !m.frame(); i++) m.tick(1 / 60);
  const keys = Object.keys(m.frame()?.players ?? {}).filter((k) => !isRef(k));
  return keys.map((key) => {
    const side = Number(key.slice(0, key.indexOf(':'))) as 0 | 1;
    const id = key.slice(key.indexOf(':') + 1);
    const p = m.s.teams[side].team.players.find((x) => x.id === id)!;
    const a = appearanceOf(p.id);
    return [
      {
        label: [`#${p.number} ${p.name}`, `${a.hairstyle}, ${a.facialHair}${a.headband ? ', band' : ''}`, `skin ${a.skin} hair ${a.hairColour}`],
        look: lookFor3d(m, key)!,
        portrait: portraitUrl(p, TEAM_COLOURS[side], { crop: 'head' }),
      },
    ];
  });
}

export function Heads3D() {
  const out = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('loading');
  useEffect(() => {
    window.__heads = { done: false };
    (async () => {
      const q = new URLSearchParams(window.location.search);
      const match = q.get('heads3d') === 'match';
      const rows = match ? matchRows(Number(q.get('seed')) || 1) : styleRows();
      const assets = await loadAssets();
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(TILE_W, TILE_H);
      renderer.shadowMap.enabled = true;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x2a2f38);
      // Lit as the arena is: dim fill, the key light from high up.
      scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x2a2018, 0.9));
      const key = new THREE.DirectionalLight(0xffffff, 1.6);
      key.position.set(3, 10, 4);
      scene.add(key);
      const camera = new THREE.PerspectiveCamera(24, TILE_W / TILE_H, 0.05, 20);

      const perRow = rows[0].length;
      const cols = perRow * ANGLES.length;
      const portraitW = match ? 130 : 0;
      const canvas = out.current!;
      canvas.width = LABEL_W + portraitW + cols * TILE_W;
      canvas.height = 24 + rows.length * TILE_H;
      const g = canvas.getContext('2d')!;
      g.fillStyle = '#14171c';
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.font = '12px system-ui, sans-serif';
      g.fillStyle = '#cfd6e0';
      for (let c = 0; c < cols; c++) g.fillText(ANGLE_NAMES[c % ANGLES.length], LABEL_W + portraitW + c * TILE_W + 6, 16);

      for (let r = 0; r < rows.length; r++) {
        setStatus(`row ${r + 1} of ${rows.length}`);
        const y0 = 24 + r * TILE_H;
        for (let k = 0; k < rows[r].length; k++) {
          const row = rows[r][k];
          const rig = new Player3D(assets.character, assets.clips, assets.info, row.look);
          scene.add(rig.root);
          // Standing, facing +x (court angle 0), the ball well away.
          const frame: Frame = { players: { '0:x': { x: 10, y: 7 } }, ball: { x: 20, y: 7, z: 0.2 }, facing: { '0:x': 0 }, look: { '0:x': 0 } };
          for (let i = 0; i < 30; i++) rig.update('0:x', frame, null, null, 1 / 30);
          rig.root.updateMatrixWorld(true);
          const head = rig.root.getObjectByName('Head')!.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.1, 0));
          for (let a = 0; a < ANGLES.length; a++) {
            const ang = ANGLES[a];
            // His front is +x; round towards +z for the three-quarter and side views.
            camera.position.copy(head).add(new THREE.Vector3(Math.cos(ang) * 1.2, 0.08, Math.sin(ang) * 1.2));
            camera.lookAt(head);
            renderer.render(scene, camera);
            g.drawImage(renderer.domElement, LABEL_W + portraitW + (k * ANGLES.length + a) * TILE_W, y0);
          }
          scene.remove(rig.root);
          if (!match || k === 0) {
            g.fillStyle = '#e8edf3';
            g.font = 'bold 13px system-ui, sans-serif';
            row.label.forEach((t, i) => {
              if (match || k === 0 || i > 0) g.fillText(t, match ? 8 : LABEL_W + (k * ANGLES.length) * TILE_W + 6, y0 + 18 + i * 16 + (match ? 0 : 100));
              g.font = '12px system-ui, sans-serif';
            });
          }
          if (!match) {
            g.fillStyle = '#e8edf3';
            g.font = 'bold 15px system-ui, sans-serif';
            g.fillText(row.label[0], 8, y0 + 24);
          }
          if (row.portrait) {
            const img = await loadImage(row.portrait);
            g.drawImage(img, LABEL_W + 4, y0 + 4, 122, (122 * img.height) / img.width > TILE_H - 8 ? TILE_H - 8 : (122 * img.height) / img.width);
            // The appearance record's skin and hair, as swatches.
            g.fillStyle = row.look.skin;
            g.fillRect(8, y0 + 70, 40, 40);
            g.fillStyle = row.look.hair;
            g.fillRect(54, y0 + 70, 40, 40);
            g.fillStyle = '#9aa3ad';
            g.font = '11px system-ui, sans-serif';
            g.fillText('skin', 8, y0 + 124);
            g.fillText('hair', 54, y0 + 124);
          }
        }
      }
      renderer.dispose();
      setStatus('done');
      window.__heads = { done: true, png: canvas.toDataURL('image/png') };
    })().catch((e) => {
      setStatus(String(e));
      window.__heads = { done: true, error: String(e?.stack ?? e) };
    });
  }, []);
  return (
    <div style={{ background: '#14171c', color: '#cfd6e0', minHeight: '100vh', padding: 8 }}>
      <div>{status}</div>
      <canvas ref={out} />
    </div>
  );
}
