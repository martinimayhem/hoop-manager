// The player market: hand-made parody players from players.json plus generated journeymen
// who give the market cheap depth (and a few hidden gems).

import raw from '../data/players.json';
import { createRng, int, next, pick, range } from '../engine/rng';
import type { Attributes, Player, Position } from '../engine/types';
import { priceOf } from './pricing';

export interface PoolPlayer {
  player: Player;
  /** Reputation 1–99. Famous players cost more and are easier to scout. */
  hype: number;
  price: number;
}

interface RawPlayer {
  name: string;
  pos: Position;
  arch: string;
  no: number;
  cm: number;
  kg: number;
  hype: number;
  a: number[];
}

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function attrsFrom(a: number[]): Attributes {
  const [speed, stamina, shooting, three, freeThrow, layup, dunk, passing, dribbling, rebounding, tactics, injuryProneness, potential] =
    a.map((v) => Math.max(1, Math.min(99, Math.round(v))));
  return { speed, stamina, shooting, three, freeThrow, layup, dunk, passing, dribbling, rebounding, tactics, injuryProneness, potential };
}

function fromRaw(r: RawPlayer): PoolPlayer {
  const player: Player = {
    id: slug(r.name),
    name: r.name,
    number: r.no,
    position: r.pos,
    archetype: r.arch,
    heightCm: r.cm,
    weightKg: r.kg,
    attrs: attrsFrom(r.a),
  };
  return { player, hype: r.hype, price: priceOf(player, r.hype) };
}

// ---------------------------------------------------------------------------
// Journeymen

const FIRST = ['Buck', 'Dewey', 'Mack', 'Otto', 'Rex', 'Sid', 'Gil', 'Wendell', 'Clyde', 'Dale', 'Ike', 'Lonnie', 'Merle', 'Ned', 'Ozzie', 'Percy', 'Quinn', 'Rollo', 'Stu', 'Toby', 'Vern', 'Wally', 'Zeke', 'Abe', 'Bo', 'Cal', 'Dino', 'Earl', 'Floyd', 'Gus'];
const LAST = ['Backboard', 'Bounceman', 'Chalkley', 'Dribbleton', 'Fastbreak', 'Glassworth', 'Hoopes', 'Jumpley', 'Kickout', 'Layman', 'Netterly', 'Outlet', 'Picknroll', 'Rimsby', 'Screener', 'Swishkin', 'Tipton', 'Upcourt', 'Velvet', 'Wingate', 'Baseline', 'Crossover', 'Dunkley', 'Elbows', 'Floater', 'Gymwood', 'Halfcourt', 'Inbound', 'Lockett', 'Paintwell'];

type Template = [number, number, number, number, number, number, number, number, number, number, number];
//                       spd  sta  mid  3pt  ft   lay  dnk  pas  dri  reb  iq
const TEMPLATES: Record<Position, { t: Template; cm: [number, number]; arch: string[] }> = {
  PG: { t: [12, 10, 2, 4, 10, 4, -25, 10, 10, -22, 2], cm: [180, 191], arch: ['Backup Guard', 'Game Manager', 'Pest Defender', 'Speedster'] },
  SG: { t: [8, 8, 4, 6, 10, 4, -12, 0, 4, -15, 0], cm: [190, 199], arch: ['Shooter', '3-and-D Guard', 'Microwave Scorer', 'Glue Guy'] },
  SF: { t: [6, 8, 2, 2, 6, 6, 2, -4, 0, -4, 0], cm: [196, 205], arch: ['Two-Way Wing', 'Slasher', 'Utility Wing', 'Athlete'] },
  PF: { t: [-4, 6, 0, -12, 2, 8, 8, -8, -12, 12, 2], cm: [201, 210], arch: ['Bruiser', 'Stretch Four', 'Glass Cleaner', 'Enforcer'] },
  C: { t: [-12, 4, -10, -35, -6, 10, 12, -14, -22, 18, 2], cm: [206, 218], arch: ['Rim Protector', 'Paint Beast', 'Project Big', 'Rim Runner'] },
};

function journeymen(count: number, seed: number, usedNames: Set<string>): PoolPlayer[] {
  const rng = createRng(seed);
  const positions: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
  const out: PoolPlayer[] = [];
  for (let i = 0; i < count; i++) {
    const pos = positions[i % positions.length];
    const tpl = TEMPLATES[pos];
    let name = '';
    do name = `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
    while (usedNames.has(name));
    usedNames.add(name);
    // Mostly role players; one in eight is an underrated gem the market hasn't noticed.
    const gem = next(rng) < 0.125;
    const q = range(rng, 50, 66) + (gem ? 9 : 0);
    const a = tpl.t.map((offset) => q + offset + range(rng, -6, 6));
    const injury = int(rng, 20, 60);
    const potential = int(rng, 20, 85);
    const cm = int(rng, tpl.cm[0], tpl.cm[1]);
    const kg = Math.round((cm - 100) * range(rng, 0.88, 1.05));
    const player: Player = {
      id: slug(name),
      name,
      number: int(rng, 0, 55),
      position: pos,
      archetype: pick(rng, tpl.arch),
      heightCm: cm,
      weightKg: kg,
      attrs: attrsFrom([...a, injury, potential]),
    };
    const hype = int(rng, 4, gem ? 18 : 30);
    out.push({ player, hype, price: priceOf(player, hype) });
  }
  return out;
}

let cached: PoolPlayer[] | null = null;

/** The full market, deterministic: same pool every time. */
export function playerPool(): PoolPlayer[] {
  if (cached) return cached;
  const curated = (raw.players as RawPlayer[]).map(fromRaw);
  const used = new Set(curated.map((p) => p.player.name));
  cached = [...curated, ...journeymen(60, 20261101, used)];
  return cached;
}

export function poolById(): Map<string, PoolPlayer> {
  return new Map(playerPool().map((p) => [p.player.id, p]));
}
