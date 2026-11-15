// The 3D match view (beta): a fixed camera over the whole court, like the 2D view; a bright wooden
// floor with team-coloured keys and our own centre logo; low-poly stands with a crowd; both hoops; the
// ball; and every player and official as a rigged figure driven by the match's frame data. It shows
// what the frame says and decides nothing.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  BOARD_X,
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
import { RIM_HEIGHT, isRef, type BallAction, type Frame } from '../court/animation';
import type { Fx } from '../match/controller';
import { Arena } from './arena';
import { setHairParts } from './hair3d';
import { Director } from './director';
import {
  BASELINE_HASH,
  BOARD_BOTTOM,
  BOARD_H,
  BOARD_RECT_H,
  BOARD_RECT_W,
  BOARD_W,
  FT_CIRCLE_HASH,
  INNER_CIRCLE_R,
  LANE_BLOCK,
  LANE_MARKS_AT,
  LANE_MARK_OUT,
  LANE_MARK_W,
  LINE_W,
  NET_LEN,
  RIM_GAP,
  RIM_INNER_R,
  RIM_R,
  RIM_ROD_R,
  SIDELINE_HASH,
  SUB_BOX,
} from '../court/markings';
import { TEAM_COLOURS } from '../labels';
import { BALL_R, Player3D, setMixamoClips, toScene, type ClipInfo, type PlayerLook, type Upcoming } from './player3d';

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
    const [character, clipFile, info, hair, mixamo] = await Promise.all([
      loader.loadAsync('/3d/player.glb'),
      loader.loadAsync('/3d/clips.glb'),
      fetch('/3d/clips.json').then((r) => r.json() as Promise<Record<string, ClipInfo>>),
      loader.loadAsync('/3d/hair.glb'),
      fetch('/3d/mixamo.json').then((r) => r.json()),
    ]);
    // The Mixamo clips (dribble, run), retargeted onto our skeleton.
    setMixamoClips(mixamo);
    // The pack's hairstyles and beard (CC0), by name, for the players' heads.
    const parts: Record<string, THREE.BufferGeometry> = {};
    hair.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) parts[mesh.name] = mesh.geometry;
    });
    setHairParts(parts);
    return { character, clips: clipFile.animations, info };
  })();
  return loading;
}

/** The floor texture covers the court and this much apron round it (m). */
const APRON = 2.2;
/** Texture pixels per metre. */
const PX = 96;

/** Behind a board, away from the court: +x at the right-hand end (end 1), -x at the other. */
const backOf = (end: 1 | -1): 1 | -1 => (end === 1 ? 1 : -1);


export class Scene3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private players: Record<string, Player3D> = {};
  /** Whose pose drew the ball last frame (null: the frame's own ball). */
  private ballOwner: string | null = null;
  /** The arena round the court: the bowl, courtside, the ribbon board and the crowd. */
  readonly arena: Arena;
  /** Frame time, smoothed (ms), for the performance readout. */
  frameMs = 0;
  /** The yellow ring on the floor under whoever has the ball (as on the 2D court). */
  private holderRing!: THREE.Mesh;
  /** The two nets, and when the ball last went through or hit the rim at each. */
  private nets: { mesh: THREE.Mesh; hoopX: number; kick: { at: number; strength: number; dx: number; dz: number } | null }[] = [];
  private lastBall: THREE.Vector3 | null = null;
  private time = 0;
  /** Dev: a close-up camera that follows one player, to judge hands and feet: from behind, or side on. */
  closeUp: boolean | 'side' = false;
  /** Dev: the player the close-up and the readout follow. */
  focus = '';
  /** Dev: a fixed step (seconds) for the director per drawn frame instead of the real clock (for captures). */
  directorDt: number | null = null;
  /** Dev: a fixed camera (overrides the others), and only these players drawn (null: everyone). */
  devCamera: { from: THREE.Vector3; to: THREE.Vector3 } | null = null;
  only: Set<string> | null = null;
  private wideAt = new THREE.Vector3();
  private wideLook = new THREE.Vector3();
  /** The TV director: on until the viewer takes the camera (drag, zoom, arrows); double-click gives it back. */
  readonly director = new Director();
  directing = true;
  private lastReal = 0;
  /** Arrow keys held (walking the camera over the court), and when the view last drew. */
  private keys = new Set<string>();
  private lastDrawn = 0;
  private lastWalk = 0;
  private onKey = (e: KeyboardEvent) => {
    if (!e.key.startsWith('Arrow') && e.key !== 'Shift') return;
    if (e.type === 'keyup') {
      this.keys.delete(e.key);
      return;
    }
    // Only while the 3D view is on screen, and never taking the arrows from a field or a dropdown.
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (performance.now() - this.lastDrawn > 500 || this.devCamera || this.closeUp) return;
    this.keys.add(e.key);
    if (this.directing && e.key.startsWith('Arrow')) {
      this.directing = false;
      this.controls.target.copy(this.director.target);
    }
    if (e.key.startsWith('Arrow')) e.preventDefault();
  };
  private clearKeys = () => this.keys.clear();

  /** Walks the camera (and the point it turns round) over the court: forward, back, left, right. */
  private walk(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - (this.lastWalk || now)) / 1000);
    this.lastWalk = now;
    this.lastDrawn = now;
    const f = (this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('ArrowDown') ? 1 : 0);
    const r = (this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0);
    if (!f && !r) return;
    // Along the floor in the direction the camera looks, and across it.
    const fwd = this.controls.target.clone().sub(this.camera.position).setY(0);
    if (fwd.lengthSq() < 1e-6) return;
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    const speed = (this.keys.has('Shift') ? 22 : 9) * dt;
    const move = fwd.multiplyScalar(f * speed).addScaledVector(right, r * speed);
    // The point it turns round stays over the court (and its surrounds); the camera keeps its offset.
    const t = this.controls.target;
    const lo = toScene(-6, -6);
    const hi = toScene(COURT.w + 6, COURT.h + 6);
    const next = t.clone().add(move);
    next.set(Math.max(lo.x, Math.min(hi.x, next.x)), next.y, Math.max(lo.z, Math.min(hi.z, next.z)));
    const actual = next.sub(t);
    t.add(actual);
    this.camera.position.add(actual);
  }

  /** The clock displays on the hoops: drawn again only when what they show changes. */
  private clockFaces: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; shown: string }[] = [];
  /** The match view's camera can be turned round the court, zoomed and panned (drag, wheel or pinch, right-drag); double-click puts it back. */
  private controls: OrbitControls;

  constructor(
    canvas: HTMLCanvasElement,
    private assets: Assets,
    private lookFor: (key: string) => PlayerLook | null,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // A dark arena: the court is the bright thing in it.
    this.scene.background = new THREE.Color(0x07090d);
    this.scene.fog = new THREE.Fog(0x07090d, 55, 110);

    // Fixed, over the near corner, looking at the middle of the court: like the 2D view.
    this.camera = new THREE.PerspectiveCamera(30, 2, 1, 200);
    const centre = toScene(COURT.w / 2, COURT.h / 2);
    this.wideAt.copy(centre).add(new THREE.Vector3(-18.5, 27, 26));
    this.wideLook.copy(centre).add(new THREE.Vector3(-1.2, 0, 2.6));
    this.camera.position.copy(this.wideAt);
    this.camera.lookAt(this.wideLook);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(this.wideLook);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 60;
    // Never under the floor, nor straight down from overhead.
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.06;
    this.controls.screenSpacePanning = false;
    this.controls.update();
    this.controls.saveState();
    canvas.addEventListener('dblclick', () => this.resetView());
    // The viewer takes over the moment they drag or zoom: orbit from where the director had it.
    this.controls.addEventListener('start', () => {
      if (!this.directing) return;
      this.directing = false;
      this.controls.target.copy(this.director.target);
    });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', this.clearKeys);

    // Dim fill for the whole arena; the court gets the key light from above (soft shadows under the
    // players) and a spotlight pool on top, which the stands are outside of.
    this.scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x2a2018, 0.75));
    const pool = new THREE.SpotLight(0xfff4e0, 2.2, 0, 0.62, 0.55, 0);
    pool.position.copy(centre).add(new THREE.Vector3(0, 26, 0));
    pool.target.position.copy(centre);
    this.scene.add(pool, pool.target);
    const sun = new THREE.DirectionalLight(0xffffff, 1.35);
    sun.position.set(centre.x - 6, 30, centre.z + 10);
    sun.target.position.copy(centre);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -19, right: 19, top: 13, bottom: -13, near: 1, far: 70 });
    this.scene.add(sun, sun.target);

    this.buildFloor();
    this.buildHoops();
    this.holderRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.56, 40), new THREE.MeshBasicMaterial({ color: 0xffe57a, transparent: true, opacity: 0.9, depthWrite: false }));
    this.holderRing.rotation.x = -Math.PI / 2;
    this.holderRing.visible = false;
    this.scene.add(this.holderRing);
    this.arena = new Arena();
    // Dev: the scene on the window, to read draw calls and frame time from a test browser.
    if (import.meta.env.DEV) (window as unknown as { __scene3d?: Scene3D }).__scene3d = this;
    this.scene.add(this.arena.group);
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
    const started = performance.now();
    this.time += dt;
    if (frame) {
      // Everyone on the floor (and the officials) as a rig; anyone who has left it is hidden.
      const here = new Set(Object.keys(frame.players));
      for (const [k, rig] of Object.entries(this.players)) rig.root.visible = here.has(k);
      const at = toScene(frame.ball.x, frame.ball.y, frame.ball.z);
      let shown = at;
      // Who draws the ball: the man who has it, always; otherwise whoever drew it last frame (a shooter
      // letting it go, a hand easing off it); anyone else only if nobody does. Never someone who has
      // just lost it over the man who now has it.
      let owner: string | null = null;
      const drawn = this.ball.position.clone();
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
        const b = rig.ball(at, dt, drawn);
        if (b !== at && (k === holder || owner === null || (owner !== holder && k === this.ballOwner))) {
          shown = b;
          owner = k;
        }
      }
      this.ballOwner = owner;
      // Never into the floor: at its lowest the ball rests on it.
      shown = shown.clone().setY(Math.max(BALL_R, shown.y));
      this.ball.position.copy(shown);
      this.ballShadow.position.set(shown.x, 0.012, shown.z);
      if (this.only) for (const [k, rig] of Object.entries(this.players)) if (!this.only.has(k)) rig.root.visible = false;
    }
    this.arena.update(dt, this.camera);
    // Under the man with the ball, on the floor (it stays there when he jumps).
    const holderRig = holder && !isRef(holder) && frame?.players[holder] ? this.players[holder] : null;
    this.holderRing.visible = !!holderRig && holderRig.root.visible;
    if (holderRig) this.holderRing.position.set(holderRig.root.position.x, 0.015, holderRig.root.position.z);
    if (frame) this.updateNets(toScene(frame.ball.x, frame.ball.y, frame.ball.z));
    const rig = this.players[this.focus];
    if (this.devCamera) {
      this.camera.position.copy(this.devCamera.from);
      this.camera.lookAt(this.devCamera.to);
    } else if (this.closeUp === 'side' && rig) {
      // Side on to his shot (towards the rim he shoots at), or to the way his body goes.
      const p = rig.root.position;
      let f = rig.heading;
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
    } else if (this.directing) {
      // The TV director's camera. It moves at real (screen) time: a slow-motion replay or fast
      // forward does not make it crawl or rush, though it keeps up a little faster when the game does.
      const nowReal = performance.now();
      const real = this.lastReal ? Math.min(0.1, (nowReal - this.lastReal) / 1000) : 0;
      this.lastReal = nowReal;
      const ts = frame?.timeScale ?? 1;
      const step = dt <= 0 ? 0 : (this.directorDt ?? real) * Math.min(2, Math.sqrt(Math.max(1, ts)));
      this.director.update(this.camera, frame, step);
      this.lastDrawn = nowReal;
    } else {
      // The match view: where the viewer has turned, zoomed and walked it. The point it turns round
      // stays over the court and its surrounds.
      this.walk();
      const t = this.controls.target;
      const lo = toScene(-6, -6);
      const hi = toScene(COURT.w + 6, COURT.h + 6);
      t.set(Math.max(lo.x, Math.min(hi.x, t.x)), Math.max(0, Math.min(4, t.y)), Math.max(lo.z, Math.min(hi.z, t.z)));
      this.controls.update();
    }
    this.controls.enabled = !this.devCamera && !this.closeUp;
    this.renderer.render(this.scene, this.camera);
    this.frameMs += (performance.now() - started - this.frameMs) * 0.05;
  }

  /** Dev: forget every rig (a fresh start, as for a new match). */
  resetPlayers(): void {
    for (const rig of Object.values(this.players)) this.scene.remove(rig.root);
    this.players = {};
  }

  /** Back to the standard view over the near corner. */
  resetView(): void {
    // Back to the TV director.
    this.directing = true;
    this.controls.reset();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('blur', this.clearKeys);
    this.controls.dispose();
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

    const line = (w = LINE_W) => {
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
    g.beginPath();
    g.arc(X(HALF_X), Y(MID_Y), INNER_CIRCLE_R * PX, 0, Math.PI * 2);
    g.stroke();
    // The substitution box: a mark 4 ft each side of the midcourt line, off the court in front of the scorer's table.
    g.fillStyle = '#ffffff';
    for (const side of [-1, 1]) g.fillRect(X(HALF_X + side * SUB_BOX.off - LINE_W / 2), Y(-SUB_BOX.len), LINE_W * PX, SUB_BOX.len * PX);
    for (const end of [1, -1] as const) {
      const ex = (x: number) => (end === 1 ? x : COURT.w - x);
      const base = ex(COURT.w);
      const ft = ex(FREE_THROW_LINE_X);
      const hoop = ex(HOOP_X);
      // The lane lines are part of the lane: its 16 ft are to their outside edges.
      const laneIn = KEY_HALF_WIDTH - LINE_W / 2;
      g.strokeRect(X(Math.min(base, ft)), Y(MID_Y - laneIn), Math.abs(base - ft) * PX, laneIn * 2 * PX);
      // Lane space marks (the first a 1 ft block), outside both lane lines; hash marks on the baseline
      // 3 ft outside the lane and by the free-throw circle at 13 ft; Rule No. 1 (court/markings.ts).
      g.fillStyle = '#ffffff';
      const mark = (depth: number, len: number, y0: number, y1: number) => {
        const x0 = ex(COURT.w - depth);
        const x1 = ex(COURT.w - depth - len);
        g.fillRect(X(Math.min(x0, x1)), Y(Math.min(y0, y1)), Math.abs(x1 - x0) * PX, Math.abs(y1 - y0) * PX);
      };
      for (const side of [-1, 1]) {
        const lane = MID_Y + side * KEY_HALF_WIDTH;
        const out = lane + side * LANE_MARK_OUT;
        mark(LANE_BLOCK.from, LANE_BLOCK.len, lane, out);
        for (const at of LANE_MARKS_AT) mark(at, LANE_MARK_W, lane, out);
        const hashY = lane + side * BASELINE_HASH.out;
        mark(0, BASELINE_HASH.len, hashY - LINE_W / 2, hashY + LINE_W / 2);
        const circleY = lane + side * FT_CIRCLE_HASH.out;
        mark(FT_CIRCLE_HASH.from - LINE_W / 2, LINE_W, circleY, circleY + side * FT_CIRCLE_HASH.len);
        // 28 ft from the baseline, 3 ft onto the court from both sidelines.
        const sideline = side < 0 ? 0 : COURT.h;
        mark(SIDELINE_HASH.from - LINE_W / 2, LINE_W, sideline, sideline - side * SIDELINE_HASH.len);
      }
      // Free-throw circle: solid towards half court, dashed inside the key.
      g.beginPath();
      g.arc(X(ft), Y(MID_Y), CIRCLE_RADIUS * PX, end === 1 ? Math.PI / 2 : -Math.PI / 2, end === 1 ? (Math.PI * 3) / 2 : Math.PI / 2);
      g.stroke();
      g.setLineDash([0.3 * PX, 0.25 * PX]);
      g.beginPath();
      g.arc(X(ft), Y(MID_Y), CIRCLE_RADIUS * PX, end === 1 ? -Math.PI / 2 : Math.PI / 2, end === 1 ? Math.PI / 2 : (Math.PI * 3) / 2);
      g.stroke();
      g.setLineDash([]);
      // Restricted area: a half circle 4 ft from the ring's centre, then parallel to the lane lines to the face of the backboard.
      const boardFace = ex(BOARD_X);
      g.beginPath();
      g.moveTo(X(boardFace), Y(MID_Y - RESTRICTED_M));
      g.lineTo(X(hoop), Y(MID_Y - RESTRICTED_M));
      g.arc(X(hoop), Y(MID_Y), RESTRICTED_M * PX, end === 1 ? -Math.PI / 2 : -Math.PI / 2, end === 1 ? Math.PI / 2 : Math.PI / 2, end === 1);
      g.lineTo(X(boardFace), Y(MID_Y + RESTRICTED_M));
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
  /** Shows the game clock and shot clock on the hoops' displays (null shot clock: off, blank). */
  setClocks(game: number, shot: number | null): void {
    const g0 = Math.max(0, game);
    const gameText = g0 >= 60 ? `${Math.floor(Math.ceil(g0) / 60)}:${String(Math.ceil(g0) % 60).padStart(2, '0')}` : g0.toFixed(1);
    const shotText = shot === null ? '' : shot >= 5 ? String(Math.ceil(shot)) : shot.toFixed(1);
    const key = `${gameText}|${shotText}`;
    for (const f of this.clockFaces) {
      if (f.shown === key) continue;
      f.shown = key;
      const g = f.canvas.getContext('2d')!;
      g.fillStyle = '#0a0a0c';
      g.fillRect(0, 0, 256, 300);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#f3e3b5';
      g.font = '700 66px ui-monospace, Consolas, monospace';
      g.fillText(gameText, 128, 62);
      g.fillStyle = '#ff2a1a';
      g.font = '800 168px ui-monospace, Consolas, monospace';
      g.fillText(shotText, 128, 200);
      f.tex.needsUpdate = true;
    }
  }

  private buildHoops(): void {
    const mat = (color: number, opts: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
    for (const end of [1, -1] as const) {
      const ex = (x: number) => (end === 1 ? x : COURT.w - x);
      const hoop = ex(HOOP_X);
      // The stand, as in the reference: a padded base on the floor behind the baseline, a tall padded
      // column narrowing as it rises, a white boom curving over and forward to the board, padding along
      // the board's bottom edge and lower sides, and a black frame behind the board carrying the game
      // clock and shot clock above it. The padding in the colour of the team whose end it is.
      const padColour = end === 1 ? 0x2f6fd8 : 0xe86a12;
      const away = backOf(end);
      const out = (d: number) => ex(COURT.w + d);
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.75, 1.25), mat(padColour));
      base.position.copy(toScene(out(2.3), MID_Y, 0.375));
      const baseTop = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 1.05), mat(padColour));
      baseTop.position.copy(toScene(out(2.3), MID_Y, 0.81));
      // The column: a padded box, wider at the foot.
      const colGeo = new THREE.CylinderGeometry(0.3, 0.42, 2.25, 4, 1);
      colGeo.rotateY(Math.PI / 4);
      const column = new THREE.Mesh(colGeo, mat(padColour));
      column.scale.set(1, 1, 0.8);
      column.position.copy(toScene(out(2.0), MID_Y, 0.75 + 1.12));
      // The boom: up out of the column, over and forward to the back of the board, in white.
      const boardBack = ex(BOARD_X) + away * 0.04;
      const curve = new THREE.CubicBezierCurve3(
        toScene(out(1.98), MID_Y, 2.9),
        toScene(out(1.95), MID_Y, 3.5),
        toScene(out(1.1), MID_Y, 3.3),
        toScene(boardBack + away * 0.3, MID_Y, 3.12),
      );
      const boom = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.12, 8, false), mat(0xf2f2f2));
      const collar = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.32), mat(0xf2f2f2));
      collar.position.copy(toScene(out(1.98), MID_Y, 2.95));
      // The frame behind the board, up to the clocks: a post and braces, black.
      const black = mat(0x1c1c1f);
      const frame = new THREE.Group();
      const strut = (a: THREE.Vector3, b: THREE.Vector3, r = 0.035) => {
        const d = b.clone().sub(a);
        const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 6), black);
        m.position.copy(a.clone().add(b).multiplyScalar(0.5));
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
        frame.add(m);
      };
      const behind = boardBack + away * 0.12;
      const clockY = BOARD_BOTTOM + BOARD_H + 0.95;
      strut(toScene(behind, MID_Y, 3.1), toScene(behind, MID_Y, clockY - 0.3), 0.05);
      for (const side of [-1, 1]) {
        strut(toScene(behind, MID_Y + side * 0.75, BOARD_BOTTOM + BOARD_H - 0.05), toScene(behind, MID_Y + side * 0.12, clockY - 0.35));
        strut(toScene(behind, MID_Y + side * 0.85, BOARD_BOTTOM + 0.1), toScene(behind, MID_Y, 3.1));
      }
      // Padding along the board's bottom edge and up its lower sides.
      const padBottom = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, BOARD_W + 0.1), mat(padColour));
      padBottom.position.copy(toScene(ex(BOARD_X) + away * 0.02, MID_Y, BOARD_BOTTOM - 0.045));
      const padSides = [-1, 1].map((side) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.07), mat(padColour));
        m.position.copy(toScene(ex(BOARD_X) + away * 0.02, MID_Y + side * (BOARD_W / 2 + 0.03), BOARD_BOTTOM + 0.2));
        return m;
      });
      // The clocks: a black box above the board with a display on both faces (to the court and away).
      const clockBox = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.74, 0.64), black);
      clockBox.position.copy(toScene(behind, MID_Y, clockY));
      for (const dir of [-away, away]) {
        const c = document.createElement('canvas');
        c.width = 256;
        c.height = 300;
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        const face = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.66), new THREE.MeshBasicMaterial({ map: tex }));
        face.position.copy(toScene(behind + dir * 0.105, MID_Y, clockY));
        // A plane faces +z; turn it to face along the court (+x or -x in the scene).
        face.rotation.y = dir === 1 ? Math.PI / 2 : -Math.PI / 2;
        this.scene.add(face);
        this.clockFaces.push({ canvas: c, tex, shown: '' });
      }
      for (const m of [base, baseTop, column, boom, collar, padBottom, ...padSides, clockBox]) {
        m.castShadow = true;
        this.scene.add(m);
      }
      this.scene.add(frame);
      // Rule No. 1 (court/markings.ts): a 6 x 3.5 ft board; a 24 x 18" rectangle in a 2" line centred
      // behind the ring, its base line level with it; an 18" ring 10 ft up, 6" from the board's face,
      // on a bracket; an 18" net.
      const faceX = ex(BOARD_X);
      /** Away from the court, behind the board. */
      const back = away;
      // Clear glass in a white frame.
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.03, BOARD_H, BOARD_W), mat(0xdfe8ee, { transparent: true, opacity: 0.35 }));
      const rail = (h: number, w: number, across: number, up: number) => {
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, w), mat(0xf4f4f4));
        f.position.copy(toScene(faceX + back * 0.025, MID_Y + across, up));
        f.castShadow = true;
        this.scene.add(f);
      };
      rail(0.06, BOARD_W, 0, BOARD_BOTTOM + BOARD_H - 0.03);
      rail(0.06, BOARD_W, 0, BOARD_BOTTOM + 0.03);
      for (const side of [-1, 1]) rail(BOARD_H, 0.06, side * (BOARD_W / 2 - 0.03), BOARD_BOTTOM + BOARD_H / 2);
      board.position.copy(toScene(faceX + back * 0.025, MID_Y, BOARD_BOTTOM + BOARD_H / 2));
      const square = new THREE.Group();
      const rectBottom = RIM_HEIGHT - LINE_W;
      const bars: [number, number, number, number][] = [
        // [across, up, width across, height]
        [0, rectBottom + LINE_W / 2, BOARD_RECT_W, LINE_W],
        [0, rectBottom + BOARD_RECT_H - LINE_W / 2, BOARD_RECT_W, LINE_W],
        [-(BOARD_RECT_W - LINE_W) / 2, rectBottom + BOARD_RECT_H / 2, LINE_W, BOARD_RECT_H],
        [(BOARD_RECT_W - LINE_W) / 2, rectBottom + BOARD_RECT_H / 2, LINE_W, BOARD_RECT_H],
      ];
      for (const [across, upAt, w, h] of bars) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.012, h, w), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        bar.position.copy(toScene(faceX - back * 0.007, MID_Y + across, upAt));
        square.add(bar);
      }
      const rim = new THREE.Mesh(new THREE.TorusGeometry(RIM_R, RIM_ROD_R * 1.6, 6, 28), mat(0xff5a1f));
      rim.rotation.x = Math.PI / 2;
      rim.position.copy(toScene(hoop, MID_Y, RIM_HEIGHT - RIM_ROD_R));
      // The bracket from the board's face to the ring.
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(RIM_GAP + 0.02, 0.03, 0.12), mat(0xff5a1f));
      bracket.position.copy(toScene(faceX - back * (RIM_GAP / 2), MID_Y, RIM_HEIGHT - 0.03));
      const net = new THREE.Mesh(new THREE.CylinderGeometry(RIM_INNER_R, RIM_INNER_R * 0.62, NET_LEN, 12, 3, true), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.8 }));
      net.position.copy(toScene(hoop, MID_Y, RIM_HEIGHT - NET_LEN / 2));
      this.nets.push({ mesh: net, hoopX: hoop, kick: null });
      this.scene.add(bracket);
      for (const m of [board, square, rim, net]) {
        m.castShadow = m !== net;
        this.scene.add(m);
      }
    }
  }

  /**
   * The crowd hears what happened: a dunk, a made three, a buzzer-beater or a big run brings the
   * scoring team's fans to their feet (rippling round from that end); a basket gets the keen ones
   * up. The ribbon board shouts it too.
   */
  react(fx: Fx[]): void {
    for (const f of fx) {
      if (f.side === undefined) continue;
      // Where it happened: the basket nearest the ball.
      const atX = this.lastBall && this.lastBall.x < COURT.w / 2 ? 0 : COURT.w;
      const team = f.side;
      // The away end is fewer and quieter.
      const k = team === 0 ? 1 : 0.8;
      if (f.buzzer && (f.kind === 'swish' || f.kind === 'three' || f.kind === 'dunk')) {
        this.arena.cheer(team, 1 * k, atX);
        this.arena.flash('AT THE BUZZER!', TEAM_COLOURS[team].fill);
      } else if (f.kind === 'dunk') {
        this.arena.cheer(team, 1 * k, atX);
        this.arena.flash('SLAM DUNK!', TEAM_COLOURS[team].fill);
      } else if (f.kind === 'three') {
        this.arena.cheer(team, 0.95 * k, atX);
        this.arena.flash('THREE!', TEAM_COLOURS[team].fill);
      } else if ((f.run ?? 0) >= 8) {
        this.arena.cheer(team, 0.9 * k, atX);
        this.arena.flash(`${f.run}-0 RUN!`, TEAM_COLOURS[team].fill);
      } else if (f.kind === 'swish' && !f.small) this.arena.cheer(team, 0.45 * k, atX);
      else if (f.kind === 'block' || f.kind === 'steal') this.arena.cheer(team === 0 ? 1 : 0, 0.55, atX);
      else if (f.kind === 'gameEnd') this.arena.cheer(team, 1, COURT.w / 2);
    }
  }

  /** The ribbon board: team names, score, and DEFENCE! when the home side defends. */
  setBoard(names: [string, string], score: [number, number], offence: 0 | 1 | null): void {
    this.arena.setBoard(names, score, offence === null ? null : offence === 0 ? 1 : 0);
  }

  /** A net kicks when the ball drops through its ring, and shivers when the ball hits the iron (as in 2D). */
  private updateNets(ball: THREE.Vector3): void {
    const prev = this.lastBall;
    this.lastBall = ball.clone();
    const now = this.time;
    for (const n of this.nets) {
      const off = Math.hypot(ball.x - n.hoopX, ball.z - MID_Y);
      if (prev && !(n.kick && now - n.kick.at < 0.6)) {
        let strength = 0;
        if (ball.y < prev.y && off < RIM_R * 0.9 && ball.y < RIM_HEIGHT && ball.y > RIM_HEIGHT - 0.5) strength = 1;
        else if (Math.abs(off - RIM_R) < 0.12 && Math.abs(ball.y - RIM_HEIGHT) < 0.2) strength = 0.35;
        if (strength > 0) {
          const d = new THREE.Vector2(ball.x - prev.x, ball.z - prev.z);
          if (d.lengthSq() > 1e-8) d.normalize();
          n.kick = { at: now, strength, dx: d.x, dz: d.y };
        }
      }
      // Stretched down and swung the way the ball went, settling over a second.
      const k = n.kick;
      const t = k ? now - k.at : 99;
      const e = k ? k.strength * Math.exp(-t * 4) : 0;
      n.mesh.scale.set(1 - 0.15 * e, 1 + 0.45 * e, 1 - 0.15 * e);
      const swing = e * Math.sin(t * 14) * 0.35;
      n.mesh.rotation.set(k ? k.dz * swing : 0, 0, k ? -k.dx * swing : 0);
      n.mesh.position.y = RIM_HEIGHT - (NET_LEN * n.mesh.scale.y) / 2;
    }
  }
}
