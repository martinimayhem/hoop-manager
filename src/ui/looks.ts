// Every player's appearance. One record per player, made from his id alone, is the single source
// for everything that draws him: the facesjs portrait (draft, rosters, box score) and the little
// figure on court, home or away, in every match.
//
// The record names the hairstyle as a shape that reads from every angle (curls are curls from
// behind too, a bald head is skin all round), and the portrait then only uses facesjs drawings
// that look like that shape. So the hair you see in the portrait is the hair you see on court,
// and turning round only hides the face, never changes the hair.
//
// Height and weight shape the build (fuller face, broader body) but never who he is. Every
// player goes through the same generator; nobody is hand-styled.

import { display, faceToSvgString, svgsIndex, type FaceConfig, type Overrides } from 'facesjs';
import { chance, createRng, int, next, pick, range, weighted } from '../engine/rng';
import type { Player, RngState } from '../engine/types';

/** A hairstyle as a shape: how it looks from the front, the side and behind. */
export type Hairstyle = 'bald' | 'shaved' | 'short' | 'curly' | 'spiky' | 'mohawk' | 'flattop' | 'bun' | 'long' | 'cornrows';
export const HAIRSTYLES: readonly Hairstyle[] = ['bald', 'shaved', 'short', 'curly', 'spiky', 'mohawk', 'flattop', 'bun', 'long', 'cornrows'];

export type FacialHair = 'none' | 'stubble' | 'moustache' | 'goatee' | 'full';
export const FACIAL_HAIRS: readonly FacialHair[] = ['none', 'stubble', 'moustache', 'goatee', 'full'];

/** Who a player looks like. Made from his id alone; see `appearanceOf`. */
export interface Appearance {
  skin: string;
  hairColour: string;
  hairstyle: Hairstyle;
  facialHair: FacialHair;
  headband: boolean;
  eyeBlack: boolean;
  /** Which facesjs drawing of that hairstyle the portrait uses (always one that matches it). */
  hairArt: string;
  /** Which facesjs drawing of that facial hair the portrait uses. */
  beardArt: string;
}

/** What the court figure needs: the appearance, plus the build. */
export interface SpriteLook extends Appearance {
  /** Body width relative to an average build: about 0.9 (wiry) to 1.2 (heavy). */
  girth: number;
}

export interface Look {
  appearance: Appearance;
  face: FaceConfig;
  sprite: SpriteLook;
}

/** The facts a look is made from. */
type Body = Pick<Player, 'id' | 'heightCm' | 'weightKg'>;

// ---------------------------------------------------------------------------
// Trait tables

export type Race = 'black' | 'white' | 'brown' | 'asian';
const RACES: readonly { race: Race; weight: number }[] = [
  { race: 'black', weight: 55 },
  { race: 'white', weight: 26 },
  { race: 'brown', weight: 11 },
  { race: 'asian', weight: 8 },
];

/** facesjs's palettes, widened with a few in-between tones. */
export const PALETTE: Record<Race, { skin: readonly string[]; hair: readonly string[] }> = {
  black: { skin: ['#ad6453', '#74453d', '#5c3937', '#8d5a43', '#9c6a52', '#4a2c28'], hair: ['#272421', '#1a1412', '#3b2416'] },
  white: { skin: ['#f2d6cb', '#ddb7a0', '#e8c4a8', '#f5dccf'], hair: ['#272421', '#3D2314', '#5A3825', '#CC9966', '#2C1608', '#B55239', '#e9c67b', '#D7BF91'] },
  brown: { skin: ['#bb876f', '#aa816f', '#a67358', '#c4977a'], hair: ['#272421', '#1c1008', '#3b2416'] },
  asian: { skin: ['#fedac7', '#f0c5a3', '#eab687'], hair: ['#272421', '#0f0902'] },
};

/** How common each hairstyle is. */
const HAIRSTYLE_WEIGHT: Record<Hairstyle, number> = { bald: 6, shaved: 12, short: 24, curly: 16, spiky: 10, mohawk: 5, flattop: 7, bun: 5, long: 5, cornrows: 8 };

/**
 * The facesjs hair drawings that match each hairstyle, sorted by eye against the art (facesjs's
 * own names mislead: its "afro" is a short curly crop, "dreads" a topknot, "short-fade" nearly
 * bald). Every male drawing is in exactly one list; a test checks it.
 */
export const HAIR_ART: Record<Hairstyle, readonly string[]> = {
  bald: ['bald'],
  shaved: ['short-bald', 'short-fade', 'short-fade-2'],
  short: ['short', 'short2', 'short3', 'crop', 'crop-fade', 'crop-fade2', 'hair', 'parted', 'middle-part', 'emo', 'shortBangs'],
  curly: ['afro', 'afro2', 'curly', 'curly2', 'curly3', 'curlyFade1', 'curlyFade2'],
  spiky: ['spike', 'spike2', 'spike3', 'spike4', 'messy', 'messy-short', 'shaggy1', 'shaggy2', 'blowoutFade'],
  mohawk: ['faux-hawk', 'fauxhawk-fade'],
  flattop: ['high', 'juice', 'tall-fade'],
  bun: ['dreads'],
  long: ['longHair'],
  cornrows: ['cornrows'],
};

/** Which kind of facial hair each facesjs drawing is, sorted by eye against the art. */
export function facialHairKind(art: string): FacialHair {
  if (art === 'none' || art.startsWith('sideburns')) return 'none';
  if (art === 'mustache-thin' || art.startsWith('goatee-thin')) return 'stubble';
  if (art.startsWith('mustache')) return 'moustache';
  if (/^(fullgoatee|goatee|soul)/.test(art) || art === 'wilt') return 'goatee';
  return 'full';
}
/** The drawings for each kind of facial hair; "none" is a clean shave (no sideburns either). */
const BEARD_ART: Record<FacialHair, readonly string[]> = {
  none: ['none'],
  stubble: svgsIndex.facialHair.filter((art) => facialHairKind(art) === 'stubble'),
  moustache: svgsIndex.facialHair.filter((art) => facialHairKind(art) === 'moustache'),
  goatee: svgsIndex.facialHair.filter((art) => facialHairKind(art) === 'goatee'),
  full: svgsIndex.facialHair.filter((art) => facialHairKind(art) === 'full'),
};
const FACIAL_HAIR_WEIGHT: Record<FacialHair, number> = { none: 45, stubble: 8, moustache: 7, goatee: 20, full: 20 };

const male = (ids: readonly string[]) => ids.filter((id) => !id.startsWith('female'));
const HEADS = male(svgsIndex.head);
const EYES = male(svgsIndex.eye);
const BROWS = male(svgsIndex.eyebrow);
const MOUTHS = svgsIndex.mouth;
const NOSES = svgsIndex.nose;
const EARS = svgsIndex.ear;
const EYE_LINES = svgsIndex.eyeLine.filter((id) => id !== 'none');
const SMILE_LINES = svgsIndex.smileLine.filter((id) => id !== 'none');
const MISC_LINES = svgsIndex.miscLine.filter((id) => id !== 'none' && id !== 'blush');
const BODIES = svgsIndex.body;

// ---------------------------------------------------------------------------
// Generation

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rngFor(s: string): RngState {
  const rng = createRng(seedOf(s));
  next(rng);
  return rng;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const r2 = (v: number) => Math.round(v * 100) / 100;

/** 0 for a lean build, 1 for a heavy one, from body-mass index (NBA players run about 22–30). */
export function heft(heightCm: number, weightKg: number): number {
  const bmi = weightKg / (heightCm / 100) ** 2;
  return clamp01((bmi - 22.5) / 7.5);
}

/** A player's appearance, from his id alone. */
export function makeAppearance(id: string): Appearance {
  const rng = rngFor(`${id}:appearance`);
  const race = weighted(rng, RACES, (r) => r.weight).race;
  const hairstyle = weighted(rng, HAIRSTYLES, (h) => HAIRSTYLE_WEIGHT[h]);
  const facialHair = weighted(rng, FACIAL_HAIRS, (f) => FACIAL_HAIR_WEIGHT[f]);
  const accessory = weighted(rng, ['none', 'headband', 'eye-black'] as const, (a) => ({ none: 82, headband: 14, 'eye-black': 4 })[a]);
  return {
    skin: pick(rng, PALETTE[race].skin),
    hairColour: pick(rng, PALETTE[race].hair),
    hairstyle,
    facialHair,
    headband: accessory === 'headband',
    eyeBlack: accessory === 'eye-black',
    hairArt: pick(rng, HAIR_ART[hairstyle]),
    beardArt: pick(rng, BEARD_ART[facialHair]),
  };
}

const appearances = new Map<string, Appearance>();

/** The one appearance for a player id, cached: every screen and the court read this. */
export function appearanceOf(id: string): Appearance {
  let a = appearances.get(id);
  if (!a) appearances.set(id, (a = makeAppearance(id)));
  return a;
}

/**
 * A full look: the appearance plus the build and the portrait-only details (eye shape, nose,
 * ears, lines), which are also seeded from the id. Pass an appearance to draw someone else's
 * look on this body (the dev turntable does).
 */
export function makeLook(p: Body, appearance: Appearance = appearanceOf(p.id)): Look {
  const rng = rngFor(`${p.id}:face`);
  const fat = clamp01(heft(p.heightCm, p.weightKg) + range(rng, -0.08, 0.08));
  // Frame: how much there is of him, so a heavy centre is broad as well as round.
  const mass = clamp01((p.weightKg - 75) / 55);
  const a = appearance;

  const face: FaceConfig = {
    fatness: r2(fat),
    teamColors: ['#888888', '#444444', '#ffffff'],
    hairBg: { id: a.hairArt === 'longHair' ? 'longHair' : 'none' },
    body: { id: pick(rng, BODIES), color: a.skin, size: r2(0.93 + mass * 0.14) },
    jersey: { id: 'jersey' },
    ear: { id: pick(rng, EARS), size: r2(range(rng, 0.5, 1.5)) },
    head: { id: pick(rng, HEADS), shave: `rgba(0,0,0,${chance(rng, 0.25) ? r2(range(rng, 0, 0.2)) : 0})` },
    eyeLine: { id: chance(rng, 0.75) ? pick(rng, EYE_LINES) : 'none' },
    smileLine: { id: chance(rng, 0.75) ? pick(rng, SMILE_LINES) : 'none', size: r2(range(rng, 0.25, 2.25)) },
    miscLine: { id: chance(rng, 0.45) ? pick(rng, MISC_LINES) : 'none' },
    facialHair: { id: a.beardArt },
    eye: { id: pick(rng, EYES), angle: int(rng, -10, 15) },
    eyebrow: { id: pick(rng, BROWS), angle: int(rng, -15, 20) },
    hair: { id: a.hairArt, color: a.hairColour, flip: chance(rng, 0.5) },
    mouth: { id: pick(rng, MOUTHS), flip: chance(rng, 0.5) },
    nose: { id: pick(rng, NOSES), flip: chance(rng, 0.5), size: r2(range(rng, 0.5, 1.25)) },
    glasses: { id: 'none' },
    accessories: { id: a.headband ? 'headband' : a.eyeBlack ? 'eye-black' : 'none' },
  };

  return { appearance: a, face, sprite: { ...a, girth: r2(0.9 + mass * 0.16 + fat * 0.14) } };
}

const looks = new Map<string, Look>();

/** A player's look, cached. Weight is part of the key: a player who bulks up fills out. */
export function lookOf(p: Body): Look {
  const key = `${p.id}|${p.heightCm}|${p.weightKg}`;
  let look = looks.get(key);
  if (!look) looks.set(key, (look = makeLook(p)));
  return look;
}

// ---------------------------------------------------------------------------
// Portraits

export interface Kit {
  fill: string;
  text: string;
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

const portraits = new Map<string, string>();

let host: HTMLDivElement | null = null;

/**
 * The face as SVG markup. facesjs's string renderer swaps in a pseudo `document`, which only
 * works outside a browser; in a browser it draws into a hidden element on the page instead
 * (it needs a real layout to measure the parts) and the markup is read back out.
 */
function faceSvg(face: FaceConfig, overrides: Overrides): string {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body) return faceToSvgString(face, overrides);
  if (!host) {
    host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;left:-10000px;top:0;width:400px;height:600px;visibility:hidden;pointer-events:none';
    document.body.appendChild(host);
  }
  display(host, face, overrides);
  let svg = host.innerHTML;
  host.replaceChildren();
  // Serialised from the page, the root may lack its namespace, which an <img> needs.
  if (!/^<svg[^>]*xmlns=/.test(svg)) svg = svg.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  return svg;
}

/**
 * How much of the drawing to show. `bust` is the whole picture, head and shoulders in the shirt;
 * `head` crops to the face and hair, for small portraits; `features` is only the face itself
 * (eyes, brows, nose, mouth, beard, lines, eye black) with no head, hair, ears or body, on the
 * full 400 x 600 canvas, for the court figure to wear on its own head.
 */
export type Crop = 'bust' | 'head' | 'features';

/** Where the features sit in the portrait: the box they fit in, and the point between the eyes. */
export const FEATURE_BOX = { x: 40, y: 200, w: 320, h: 340 };
export const FEATURE_CENTRE = { x: 200, y: 310 };

/** The court figure's face: the portrait's own features, the same home or away. */
export function featuresUrl(p: Body): string {
  return faceUrl(lookOf(p).face, { fill: '#888888', text: '#ffffff' }, { crop: 'features' }, `${p.id}|${p.heightCm}|${p.weightKg}`);
}
/**
 * The head crop, centred on the head itself. Every facesjs head spans x 50–350 and y 100–505
 * (chin at about 505), ears reach x 5–395 and hair rises to about y 30: this keeps the whole
 * chin and both ears with a little neck below, and room above for the tallest styles.
 */
export const HEAD_VIEWBOX = { x: 0, y: 25, w: 400, h: 510 };

/**
 * The portrait as an SVG data URL: the face in the given team's kit, optionally with a shirt
 * number on the chest (bust only; only legible on a large portrait). Cached per player, kit,
 * crop and number.
 */
export function portraitUrl(p: Body, kit: Kit, opts: { number?: number; crop?: Crop } = {}): string {
  return faceUrl(lookOf(p).face, kit, opts, `${p.id}|${p.heightCm}|${p.weightKg}`);
}

/** Any face as a portrait URL; `cacheKey` names the face (the same key must mean the same face). */
export function faceUrl(face: FaceConfig, kit: Kit, opts: { number?: number; crop?: Crop } = {}, cacheKey?: string): string {
  const crop = opts.crop ?? 'bust';
  const number = crop === 'bust' ? opts.number : undefined;
  const key = cacheKey && `${cacheKey}|${number ?? ''}|${crop}|${kit.fill}|${kit.text}`;
  let url = key ? portraits.get(key) : undefined;
  if (!url) {
    const overrides: Overrides = { teamColors: [kit.fill, shade(kit.fill, 0.62), kit.text] };
    if (crop === 'features') {
      // facesjs skips any part whose id it does not know: drop everything but the face itself.
      const none = { id: 'none' };
      // The fine lines (creases, smile lines, freckles) are only smudges a few pixels across.
      Object.assign(overrides, { hairBg: none, body: none, jersey: none, ear: none, head: none, hair: none, glasses: none, eyeLine: none, smileLine: none, miscLine: none });
      if (face.accessories.id !== 'eye-black') overrides.accessories = none;
    }
    let svg = faceSvg(face, overrides);
    if (number !== undefined) {
      // The number sits on the right of the chest, clear of the neckline.
      const text = `<text x="290" y="574" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="900" font-size="40" fill="${kit.text}" stroke="${shade(kit.fill, 0.5)}" stroke-width="2" paint-order="stroke">${number}</text>`;
      svg = svg.replace(/<\/svg>\s*$/, `${text}</svg>`);
    }
    if (crop === 'features') {
      // Drawn a few pixels across on court: bolder lines so the eyes and mouth still read.
      svg = svg.replace(/(<svg[^>]*>)/, '$1<style>path,circle,ellipse,line,polyline{stroke-width:9px!important}</style>');
      // A real size, so the image has the portrait's own 400 x 600 frame wherever it is drawn
      // (facesjs sizes it at 100%, which leaves a lone image at the browser's default size).
      svg = svg.replace(/width="100%"/, 'width="400"').replace(/height="100%"/, 'height="600"');
    }
    if (crop === 'head') {
      const v = HEAD_VIEWBOX;
      svg = svg.replace(/viewBox="[^"]*"/, `viewBox="${v.x} ${v.y} ${v.w} ${v.h}"`);
    }
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    if (key) portraits.set(key, url);
  }
  return url;
}
