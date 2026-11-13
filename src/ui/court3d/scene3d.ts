// The 3D match view (beta): a fixed camera over the whole court, like the 2D view; a bright wooden
// floor with team-coloured keys and our own centre logo; low-poly stands with a crowd; both hoops; the
// ball; and every player and official as a rigged figure driven by the match's frame data. It shows
// what the frame says and decides nothing.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  CIRCLE_RADIUS,
  CORNER_THREE_FROM_SIDELINE,
  CORNER_THREE_LENGTH,
  COURT,
  FREE_THROW_LINE_X,
  HALF_X,
  HOOP_X,
  KEY_HALF_WIDTH,
  MID_Y,
  RESTRICTED_M,
  THREE_ARC_M,
} from '../../engine/court';
import { RIM_HEIGHT, type BallAction, type Frame } from '../court/animation';
import { TEAM_COLOURS } from '../labels';
import { BALL_R, Player3D, toScene, type ClipInfo, type PlayerLook, type Upcoming } from './player3d';

export interface Assets {
  character: Awaited<ReturnType<GLTFLoader['loadAsync']>>;
  clips: THREE.AnimationClip[];
  info: Record<string, ClipInfo>;
}

let loading: Promise<Assets> | null = null;
/** The model and clips, loaded once however many views ask. */
export function loadAssets(): Promise<Assets> {
  loading ??= (async () => {
    const loader = new GLTFLoader();
    const [character, clipFile, info] = await Promise.all([
      loader.loadAsync('/3d/player.glb'),
      loader.loadAsync('/3d/clips.glb'),
      fetch('/3d/clips.json').then((r) => r.json() as Promise<Record<string, ClipInfo>>),
    ]);
    return { character, clips: clipFile.animations, info };
  })();
  return loading;
}

/** The floor texture covers the court and this much apron round it (m). */
const APRON = 2.2;
/** Texture pixels per metre. */
const PX = 96;
/** Stands: rows, row depth and rise (m), and how far back from the court they start. */
const ROWS = 9;
const ROW_D = 0.85;
const ROW_H = 0.42;
const STANDS_FROM = 3;

export class Scene3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private players: Record<string, Player3D> = {};
  private crowd: { mesh: THREE.InstancedMesh; base: THREE.Matrix4[]; phase: number[] }[] = [];
  private time = 0;
  /** Dev: a close-up camera that follows one player, to judge hands and feet: from behind, or side on. */
  closeUp: boolean | 'side' = false;
  /** Dev: the player the close-up and the readout follow. */
  focus = '';
  /** Dev: a fixed camera (overrides the others), and only these players drawn (null: everyone). */
  devCamera: { from: THREE.Vector3; to: THREE.Vector3 } | null = null;
  only: Set<string> | null = null;
  private wideAt = new THREE.Vector3();
  private wideLook = new THREE.Vector3();

  constructor(
    canvas: HTMLCanvasElement,
    private assets: Assets,
    private lookFor: (key: string) => PlayerLook | null,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(0x101820);
    this.scene.fog = new THREE.Fog(0x101820, 45, 80);

    // Fixed, over the near corner, looking at the middle of the court: like the 2D view.
    this.camera = new THREE.PerspectiveCamera(30, 2, 1, 200);
    const centre = toScene(COURT.w / 2, COURT.h / 2);
    this.wideAt.copy(centre).add(new THREE.Vector3(-18.5, 27, 26));
    this.wideLook.copy(centre).add(new THREE.Vector3(-1.2, 0, 2.6));
    this.camera.position.copy(this.wideAt);
    this.camera.lookAt(this.wideLook);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9a7a5a, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(centre.x - 6, 30, centre.z + 10);
    sun.target.position.copy(centre);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -19, right: 19, top: 13, bottom: -13, near: 1, far: 70 });
    this.scene.add(sun, sun.target);

    this.buildFloor();
    this.buildHoops();
    this.buildStands();
    this.ball = new THREE.Mesh(new THREE.IcosahedronGeometry(BALL_R, 1), new THREE.MeshLambertMaterial({ color: 0xe0661f, flatShading: true }));
    this.ball.castShadow = true;
    this.scene.add(this.ball);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(BALL_R, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.ballShadow);
  }

  /** The rig of one player (dev readout and probes). */
  /** Dev: where the ball was last drawn. */
  get ballDrawn(): THREE.Vector3 {
    return this.ball.position.clone();
  }

  rigOf(key: string): Player3D | null {
    return this.players[key] ?? null;
  }

  resize(w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** `dt`: match seconds since the last frame. */
  render(frame: Frame | null, action: BallAction | null, holder: string | null, dt: number, next: Upcoming | null = null): void {
    this.time += dt;
    if (frame) {
      // Everyone on the floor (and the officials) as a rig; anyone who has left it is hidden.
      const here = new Set(Object.keys(frame.players));
      for (const [k, rig] of Object.entries(this.players)) rig.root.visible = here.has(k);
      const at = toScene(frame.ball.x, frame.ball.y, frame.ball.z);
      let shown = at;
      for (const k of here) {
        let rig = this.players[k];
        if (!rig) {
          const look = this.lookFor(k);
          if (!look) continue;
          rig = this.players[k] = new Player3D(this.assets.character, this.assets.clips, this.assets.info, look);
          this.scene.add(rig.root);
        }
        rig.update(k, frame, action, holder, dt, next);
        // The ball in the hands of whoever the pose has holding it.
        const b = rig.ball(at, dt);
        if (b !== at) shown = b;
      }
      // Never into the floor: at its lowest the ball rests on it.
      shown = shown.clone().setY(Math.max(BALL_R, shown.y));
      this.ball.position.copy(shown);
      this.ballShadow.position.set(shown.x, 0.012, shown.z);
      if (this.only) for (const [k, rig] of Object.entries(this.players)) if (!this.only.has(k)) rig.root.visible = false;
    }
    this.animateCrowd();
    const rig = this.players[this.focus];
    if (this.devCamera) {
      this.camera.position.copy(this.devCamera.from);
      this.camera.lookAt(this.devCamera.to);
    } else if (this.closeUp === 'side' && rig) {
      // Side on to his shot (towards the rim he shoots at), or to where he faces.
      const p = rig.root.position;
      let f = rig.facingAngle;
      if (action?.kind === 'fromPlayer' && action.from === this.focus) {
        const rim = toScene(action.to.x, action.to.y);
        f = Math.atan2(rim.z - p.z, rim.x - p.x);
      }
      this.camera.position.set(p.x + Math.sin(f) * 5, 1.9 + p.y, p.z - Math.cos(f) * 5);
      this.camera.lookAt(p.x, 1.3 + p.y, p.z);
    } else if (this.closeUp && rig) {
      const p = rig.root.position;
      this.camera.position.set(p.x - 2.9, 2.2 + p.y, p.z + 3.8);
      this.camera.lookAt(p.x, 1.1 + p.y, p.z);
    } else {
      this.camera.position.copy(this.wideAt);
      this.camera.lookAt(this.wideLook);
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Dev: forget every rig (a fresh start, as for a new match). */
  resetPlayers(): void {
    for (const rig of Object.values(this.players)) this.scene.remove(rig.root);
    this.players = {};
  }

  dispose(): void {
    this.renderer.dispose();
  }

  /** The floor: wooden planks, team-coloured keys, white lines and our own centre logo, on one texture. */
  private buildFloor(): void {
    const W = COURT.w + APRON * 2;
    const H = COURT.h + APRON * 2;
    const c = document.createElement('canvas');
    c.width = Math.round(W * PX);
    c.height = Math.round(H * PX);
    const g = c.getContext('2d')!;
    // Court metres to texture pixels.
    const X = (x: number) => (x + APRON) * PX;
    const Y = (y: number) => (y + APRON) * PX;

    // The apron round the court.
    g.fillStyle = '#17595a';
    g.fillRect(0, 0, c.width, c.height);
    // Planks along the court, each a slightly different shade.
    const plank = 0.18;
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let y = 0; y < COURT.h; y += plank) {
      for (let x = 0; x < COURT.w; ) {
        const len = 1.8 + rand() * 2.6;
        const l = 66 + rand() * 7;
        g.fillStyle = `hsl(33, 62%, ${l}%)`;
        g.fillRect(X(x), Y(y), Math.min(len, COURT.w - x) * PX + 1, plank * PX + 1);
        g.fillStyle = 'rgba(120, 70, 30, 0.18)';
        g.fillRect(X(x), Y(y), 1.5, plank * PX);
        x += len;
      }
      g.fillStyle = 'rgba(120, 70, 30, 0.12)';
      g.fillRect(X(0), Y(y), COURT.w * PX, 1);
    }

    const line = (w = 0.06) => {
      g.strokeStyle = '#ffffff';
      g.lineWidth = w * PX;
    };
    // The keys, painted in the team colours: the home side's at the left end, the visitors' at the right.
    for (const end of [1, -1] as const) {
      const ex = (x: number) => (end === 1 ? x : COURT.w - x);
      g.fillStyle = end === 1 ? TEAM_COLOURS[1].fill : TEAM_COLOURS[0].fill;
      g.globalAlpha = 0.85;
      const a = ex(COURT.w);
      const b = ex(FREE_THROW_LINE_X);
      g.fillRect(X(Math.min(a, b)), Y(MID_Y - KEY_HALF_WIDTH), Math.abs(a - b) * PX, KEY_HALF_WIDTH * 2 * PX);
      g.globalAlpha = 1;
    }
    // The centre circle in a darker wood, and our logo in it.
    g.fillStyle = '#b8783e';
    g.beginPath();
    g.arc(X(HALF_X), Y(MID_Y), CIRCLE_RADIUS * PX, 0, Math.PI * 2);
    g.fill();
    this.drawLogo(g, X(HALF_X), Y(MID_Y), CIRCLE_RADIUS * PX * 0.82);

    line();
    g.strokeRect(X(0), Y(0), COURT.w * PX, COURT.h * PX);
    g.beginPath();
    g.moveTo(X(HALF_X), Y(0));
    g.lineTo(X(HALF_X), Y(COURT.h));
    g.stroke();
    g.beginPath();
    g.arc(X(HALF_X), Y(MID_Y), CIRCLE_RADIUS * PX, 0, Math.PI * 2);
    g.stroke();
    for (const end of [1, -1] as const) {
      const ex = (x: number) => (end === 1 ? x : COURT.w - x);
      const base = ex(COURT.w);
      const ft = ex(FREE_THROW_LINE_X);
      const hoop = ex(HOOP_X);
      g.strokeRect(X(Math.min(base, ft)), Y(MID_Y - KEY_HALF_WIDTH), Math.abs(base - ft) * PX, KEY_HALF_WIDTH * 2 * PX);
      // Free-throw circle: solid towards half court, dashed inside the key.
      g.beginPath();
      g.arc(X(ft), Y(MID_Y), CIRCLE_RADIUS * PX, end === 1 ? Math.PI / 2 : -Math.PI / 2, end === 1 ? (Math.PI * 3) / 2 : Math.PI / 2);
      g.stroke();
      g.setLineDash([0.3 * PX, 0.25 * PX]);
      g.beginPath();
      g.arc(X(ft), Y(MID_Y), CIRCLE_RADIUS * PX, end === 1 ? -Math.PI / 2 : Math.PI / 2, end === 1 ? Math.PI / 2 : (Math.PI * 3) / 2);
      g.stroke();
      g.setLineDash([]);
      // Restricted area.
      g.beginPath();
      g.arc(X(hoop), Y(MID_Y), RESTRICTED_M * PX, end === 1 ? Math.PI / 2 : -Math.PI / 2, end === 1 ? (Math.PI * 3) / 2 : Math.PI / 2);
      g.stroke();
      // Three-point line: straight in the corners, then the arc.
      const corner = ex(COURT.w - CORNER_THREE_LENGTH);
      g.beginPath();
      g.moveTo(X(base), Y(CORNER_THREE_FROM_SIDELINE));
      g.lineTo(X(corner), Y(CORNER_THREE_FROM_SIDELINE));
      g.moveTo(X(base), Y(COURT.h - CORNER_THREE_FROM_SIDELINE));
      g.lineTo(X(corner), Y(COURT.h - CORNER_THREE_FROM_SIDELINE));
      g.stroke();
      const reachA = Math.asin((MID_Y - CORNER_THREE_FROM_SIDELINE) / THREE_ARC_M);
      const mid = end === 1 ? Math.PI : 0;
      g.beginPath();
      g.arc(X(hoop), Y(MID_Y), THREE_ARC_M * PX, mid - reachA, mid + reachA);
      g.stroke();
    }
    // The name along the far apron.
    g.fillStyle = 'rgba(255, 255, 255, 0.85)';
    g.font = `800 ${Math.round(0.9 * PX)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('HOOP MANAGER', X(HALF_X), Y(-APRON / 2));

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshLambertMaterial({ map: tex }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.copy(toScene(COURT.w / 2, COURT.h / 2, 0));
    floor.receiveShadow = true;
    this.scene.add(floor);
    // A dark surround under the stands.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + 40, H + 40), new THREE.MeshLambertMaterial({ color: 0x0f2a2c }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.copy(toScene(COURT.w / 2, COURT.h / 2, -0.02));
    this.scene.add(ground);
  }

  /** Our own centre logo: a ball in a ring with the initials, in the two team colours. */
  private drawLogo(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    g.save();
    g.lineWidth = r * 0.09;
    g.strokeStyle = TEAM_COLOURS[0].fill;
    g.beginPath();
    g.arc(x, y, r, Math.PI * 0.5, Math.PI * 1.5);
    g.stroke();
    g.strokeStyle = TEAM_COLOURS[1].fill;
    g.beginPath();
    g.arc(x, y, r, -Math.PI * 0.5, Math.PI * 0.5);
    g.stroke();
    // A ball behind the letters.
    g.fillStyle = '#e0661f';
    g.beginPath();
    g.arc(x, y, r * 0.6, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#3a1a08';
    g.lineWidth = r * 0.035;
    g.beginPath();
    g.arc(x, y, r * 0.6, 0, Math.PI * 2);
    g.moveTo(x - r * 0.6, y);
    g.lineTo(x + r * 0.6, y);
    g.moveTo(x, y - r * 0.6);
    g.lineTo(x, y + r * 0.6);
    g.stroke();
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#1b1b1b';
    g.lineWidth = r * 0.07;
    g.font = `900 ${Math.round(r * 0.62)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Turned to read from the camera's side of the court.
    g.translate(x, y);
    g.rotate(-Math.PI / 2);
    g.strokeText('HM', 0, r * 0.04);
    g.fillText('HM', 0, r * 0.04);
    g.restore();
  }

  /** Both hoops: padded post, arm, a white board with its square, an orange rim and a net. */
  private buildHoops(): void {
    const mat = (color: number, opts: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
    for (const end of [1, -1] as const) {
      const ex = (x: number) => (end === 1 ? x : COURT.w - x);
      const hoop = ex(HOOP_X);
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 1.4), mat(0x2a3d52));
      base.position.copy(toScene(ex(COURT.w + 1.3), MID_Y, 0.25));
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, RIM_HEIGHT + 0.7, 0.22), mat(0x2a3d52));
      post.position.copy(toScene(ex(COURT.w + 1.1), MID_Y, (RIM_HEIGHT + 0.7) / 2));
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.34, 2, 0.34), mat(end === 1 ? 0x2f7bff : 0xff7a1a));
      pad.position.copy(toScene(ex(COURT.w + 1.1), MID_Y, 1));
      const arm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.14, 0.14), mat(0x2a3d52));
      arm.position.copy(toScene(ex(COURT.w), MID_Y, RIM_HEIGHT + 0.6));
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.07, 1.83), mat(0xffffff, { transparent: true, opacity: 0.85 }));
      board.position.copy(toScene(ex(COURT.w - 1.22), MID_Y, RIM_HEIGHT + 0.45));
      const square = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.59), mat(0xe34b26, { wireframe: true }));
      square.position.copy(toScene(ex(COURT.w - 1.22), MID_Y, RIM_HEIGHT + 0.3));
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.022, 6, 20), mat(0xff5a1f));
      rim.rotation.x = Math.PI / 2;
      rim.position.copy(toScene(hoop, MID_Y, RIM_HEIGHT));
      const net = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.14, 0.42, 12, 3, true), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.8 }));
      net.position.copy(toScene(hoop, MID_Y, RIM_HEIGHT - 0.21));
      for (const m of [base, post, pad, arm, board, square, rim, net]) {
        m.castShadow = m !== net;
        this.scene.add(m);
      }
    }
  }

  /**
   * Low-poly stands along the far side and behind the far basket (the camera's side stays open, as in 2D), a crowd of blocky figures in them: shirts in the
   * two teams' colours (more home than away) and plain colours, every one a little different.
   */
  private buildStands(): void {
    const step = new THREE.MeshLambertMaterial({ color: 0x24313f, flatShading: true });
    const seat = new THREE.MeshLambertMaterial({ color: 0x1b2632, flatShading: true });
    type Block = { x0: number; x1: number; y0: number; y1: number; dir: [number, number] };
    // In court metres: where each stand starts, its length, and which way the rows go back.
    const blocks: Block[] = [
      { x0: -1, x1: COURT.w + 1, y0: -STANDS_FROM, y1: -STANDS_FROM, dir: [0, -1] },
      { x0: COURT.w + STANDS_FROM + 0.8, x1: COURT.w + STANDS_FROM + 0.8, y0: -1.5, y1: COURT.h + 1.5, dir: [1, 0] },
    ];
    const seats: { x: number; y: number; z: number; facing: number }[] = [];
    for (const b of blocks) {
      const along = b.dir[0] === 0 ? b.x1 - b.x0 : b.y1 - b.y0;
      for (let r = 0; r < ROWS; r++) {
        const back = r * ROW_D;
        const cx = b.dir[0] === 0 ? (b.x0 + b.x1) / 2 : b.x0 + b.dir[0] * (back + ROW_D / 2);
        const cy = b.dir[0] === 0 ? b.y0 + b.dir[1] * (back + ROW_D / 2) : (b.y0 + b.y1) / 2;
        const top = (r + 1) * ROW_H;
        const tier = new THREE.Mesh(b.dir[0] === 0 ? new THREE.BoxGeometry(along, top, ROW_D) : new THREE.BoxGeometry(ROW_D, top, along), r % 2 ? seat : step);
        tier.position.copy(toScene(cx, cy, top / 2));
        tier.receiveShadow = true;
        this.scene.add(tier);
        for (let a = 0.35; a < along - 0.2; a += 0.55) {
          const x = b.dir[0] === 0 ? b.x0 + a : cx;
          const y = b.dir[0] === 0 ? cy : b.y0 + a;
          seats.push({ x, y, z: top, facing: Math.atan2(-b.dir[1], -b.dir[0]) });
        }
      }
    }
    let seed = 11;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const shirts = [TEAM_COLOURS[0].fill, TEAM_COLOURS[0].fill, TEAM_COLOURS[0].fill, TEAM_COLOURS[1].fill, '#f2f2f2', '#2a2a2a', '#9aa4b0'];
    const skins = ['#f1c7a5', '#d9a07a', '#b07850', '#8a5a3a', '#6b4429', '#e8b894'];
    const filled = seats.filter(() => rand() < 0.82);
    const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, 0.5, 0.24), new THREE.MeshLambertMaterial({ flatShading: true }), filled.length);
    const heads = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.12, 0), new THREE.MeshLambertMaterial({ flatShading: true }), filled.length);
    const bodyBase: THREE.Matrix4[] = [];
    const headBase: THREE.Matrix4[] = [];
    const phase: number[] = [];
    filled.forEach((s, i) => {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -s.facing + Math.PI / 2);
      const k = 0.9 + rand() * 0.25;
      const size = new THREE.Vector3(k, k, k);
      const body = new THREE.Matrix4().compose(toScene(s.x, s.y, s.z + 0.25 * k), q, size);
      const head = new THREE.Matrix4().compose(toScene(s.x, s.y, s.z + 0.62 * k), q, size);
      bodies.setMatrixAt(i, body);
      heads.setMatrixAt(i, head);
      bodies.setColorAt(i, new THREE.Color(shirts[Math.floor(rand() * shirts.length)]));
      heads.setColorAt(i, new THREE.Color(skins[Math.floor(rand() * skins.length)]));
      bodyBase.push(body);
      headBase.push(head);
      phase.push(rand() * Math.PI * 2);
    });
    for (const m of [bodies, heads]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(m);
    }
    this.crowd = [
      { mesh: bodies, base: bodyBase, phase },
      { mesh: heads, base: headBase, phase },
    ];
  }

  /** The crowd shifts and bobs a little, each at his own rhythm. */
  private animateCrowd(): void {
    const m = new THREE.Matrix4();
    for (const c of this.crowd) {
      for (let i = 0; i < c.base.length; i++) {
        m.copy(c.base[i]);
        m.elements[13] += Math.max(0, Math.sin(this.time * 2.2 + c.phase[i])) * 0.05;
        c.mesh.setMatrixAt(i, m);
      }
      c.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
