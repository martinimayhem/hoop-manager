// The career world, made from a seed (WORLD_SPEC §1, slice brief W1): 318 clubs (the Big League's
// America conference, US Divisions 2–4, and the national leagues of 11 European countries, 12 of
// whose clubs also play in the Big League's Europe conference), their first teams, development
// squads and academies, the hand-made stars, free agents and 40 US colleges, with contracts in the
// cap system (America Big League) or the budget system (everyone else). The same seed always makes
// the same world.

import { composite } from '../../engine/ratings';
import { createRng, int, next, pick, range } from '../../engine/rng';
import type { Player, Position } from '../../engine/types';
import { nameSource } from '../names';
import { attrsFrom, curatedPlayers, TEMPLATES } from '../pool';
import {
  ANCHORS,
  CAP,
  DEV_WAGE_BUDGET_SHARE,
  MAX_CONTRACT,
  MID_LEVEL,
  MIN_CONTRACT,
  THRESHOLD,
  THRESHOLD_MIN_AGE,
  tidy,
} from './money';
import { NAME_FAMILIES, familyOf, idOf, isFamousRealName, plainName } from './names';
import { AMERICA, COLLEGES, EUROPE, EUROPE_COUNTRIES, LEAGUE_ADJECTIVE, LICENCES, type Place } from './places';
import type { College, Competition, Origin, Personality, PlayerStatus, Region, World, WorldClub, WorldPlayer } from './types';

export const START_SEASON = 2026;
export const ROSTER = 13;
export const FREE_AGENTS = 400;
export const COLLEGE_SQUAD = 15;
export const ACADEMY_SQUAD = 6;
export const DEV_SQUAD_MAX = 5;
export const BIG_LEAGUE_AMERICA = 18;
export const US_DIVISION = 16;
export const NATIONAL_TIER = 12;
export const WILDCARDS = 2;

/**
 * Where a club starts, for its size and money: the Big League (America or Europe), US Division 2–4,
 * a national first tier (outside the Big League) or second tier.
 */
type Level = 'blA' | 'blE' | 'us2' | 'us3' | 'us4' | 'n1' | 'n2';

/** How good a level's players are: the base rating band before position offsets (see pool.ts TEMPLATES). */
const QUALITY: Record<Level, [number, number]> = { blA: [57, 69], blE: [57, 69], us2: [52, 63], us3: [45, 55], us4: [38, 48], n1: [50, 61], n2: [43, 53] };
const CAPACITY: Record<Level, [number, number]> = { blA: [14_000, 21_000], blE: [8_000, 16_000], us2: [6_000, 12_000], us3: [2_500, 6_000], us4: [800, 3_000], n1: [3_000, 9_000], n2: [1_000, 3_500] };
const REPUTATION: Record<Level, [number, number]> = { blA: [72, 96], blE: [70, 94], us2: [48, 70], us3: [28, 48], us4: [10, 28], n1: [40, 66], n2: [16, 38] };
const FACILITIES: Record<Level, [number, number]> = { blA: [12, 18], blE: [11, 17], us2: [9, 14], us3: [6, 11], us4: [3, 8], n1: [7, 13], n2: [4, 9] };
const FANS: Record<Level, [number, number]> = { blA: [180, 900], blE: [120, 600], us2: [60, 220], us3: [20, 70], us4: [5, 25], n1: [25, 120], n2: [6, 30] };
/** Budget clubs: the club budget per season, biggest club to smallest (WORLD_SPEC §10.1, tune). */
const BUDGET: Record<Exclude<Level, 'blA'>, [number, number]> = {
  blE: [60e6, 95e6],
  us2: [12e6, 30e6],
  us3: [3e6, 10e6],
  us4: [0.8e6, 3e6],
  n1: [6e6, 25e6],
  n2: [1e6, 5e6],
};
/** How much a level's buyout fees weigh: smaller clubs ask less (GAME_FLOW §4.2). */
const BUYOUT_SCALE: Record<Exclude<Level, 'blA'>, number> = { blE: 1.1, us2: 1, us3: 0.85, us4: 0.7, n1: 1, n2: 0.8 };

/** How strong and rich each country's leagues are, and how famous its basketball is (tune). */
const COUNTRY: Record<string, { quality: number; money: number; fame: number }> = {
  ES: { quality: 2, money: 1, fame: 90 },
  TR: { quality: 2, money: 1, fame: 87 },
  GR: { quality: 1, money: 0.9, fame: 87 },
  IT: { quality: 1, money: 0.9, fame: 82 },
  FR: { quality: 1, money: 0.85, fame: 80 },
  DE: { quality: 1, money: 0.85, fame: 80 },
  IL: { quality: 0, money: 0.8, fame: 80 },
  LT: { quality: 1, money: 0.7, fame: 85 },
  RS: { quality: 1, money: 0.7, fame: 86 },
  NL: { quality: -2, money: 0.6, fame: 60 },
  PT: { quality: -2, money: 0.6, fame: 62 },
};

/** Thirty-two colour pairs; a league's clubs never share one. */
const PALETTE: [string, string][] = [
  ['#c8102e', '#f2c75c'], ['#1d428a', '#ffc72c'], ['#007a33', '#ffffff'], ['#552583', '#fdb927'], ['#ce1141', '#000000'],
  ['#0e2240', '#fec524'], ['#00788c', '#e56020'], ['#5a2d81', '#63727a'], ['#006bb6', '#f58426'], ['#98002e', '#f9a01b'],
  ['#002d62', '#e03a3e'], ['#0c2340', '#236192'], ['#e03a3e', '#c4ced4'], ['#00471b', '#eee1c6'], ['#860038', '#041e42'],
  ['#1d1160', '#a1a1a4'], ['#ffb81c', '#002b5c'], ['#c4ced4', '#000000'], ['#0077c0', '#c4ced4'], ['#e56020', '#1d1160'],
  ['#2c5234', '#c69214'], ['#7a003c', '#ffcd00'], ['#003da5', '#ef3340'], ['#ff671f', '#002f6c'], ['#4b9cd3', '#13294b'],
  ['#9e1b32', '#828a8f'], ['#00843d', '#ffb81c'], ['#6f263d', '#a2aaad'], ['#041e42', '#c8102e'], ['#b9975b', '#000000'],
  ['#00a3e0', '#ffcd00'], ['#a6192e', '#ffffff'],
];

/** Hand-made stars who are not American (the rest are). */
const STAR_NATIONALITY: Record<string, string> = {
  'Luka Donkic': 'SI', 'Tony Parkour': 'FR', 'Steve Nashville': 'CA', 'Shai Gilded-Alexander': 'CA', 'Manu Ginobouncy': 'AR',
  'Giannis Antetokoun-Go': 'GR', 'Dirk Nowitzwhizz': 'DE', 'Pau Gasolina': 'ES', 'Nikola Jokester': 'RS', 'Joel Embiddle': 'CM',
  'Hakeem Olajuwonder': 'NG', 'Victor Wembanyammy': 'FR', 'Rudy Goblert': 'FR', 'Dikembe Mutombnope': 'CD',
  'Domantas Sabonice': 'LT', 'Clint Capelure': 'CH', 'Steven Adamsapple': 'NZ', 'Alperen Spinmove': 'TR', 'Yao Mingle': 'CN',
};

/** Hometowns for countries without a club of their own. */
const OTHER_TOWNS: Record<string, string[]> = {
  CA: ['Toronto', 'Montreal', 'Vancouver'], AU: ['Melbourne', 'Sydney', 'Perth'], NG: ['Lagos', 'Abuja'], SN: ['Dakar'],
  CM: ['Yaoundé', 'Douala'], BR: ['São Paulo', 'Rio de Janeiro'], AR: ['Buenos Aires', 'Córdoba'], DO: ['Santo Domingo'],
  PR: ['San Juan'], CD: ['Kinshasa'], CH: ['Geneva'], NZ: ['Auckland'], CN: ['Shanghai'], HR: ['Zagreb', 'Split', 'Zadar'],
  SI: ['Ljubljana', 'Maribor'], LV: ['Riga', 'Ventspils'], ME: ['Podgorica', 'Nikšić'], BA: ['Sarajevo', 'Mostar'],
  PL: ['Warsaw', 'Wrocław', 'Gdańsk'], CZ: ['Prague', 'Brno', 'Nymburk'], GB: ['London', 'Manchester', 'Glasgow'],
  BE: ['Antwerp', 'Brussels', 'Ostend'],
};

/** Where American clubs and colleges find players from abroad. */
const ABROAD_FOR_AMERICA = ['CA', 'AU', 'NG', 'SN', 'CM', 'FR', 'ES', 'RS', 'GR', 'TR', 'LT', 'DE', 'BR', 'AR', 'DO', 'PR', 'HR', 'SI', 'IT'];
/** Where European clubs find players from elsewhere in Europe (their own league's countries, and a few more). */
const ELSEWHERE_IN_EUROPE = [...EUROPE_COUNTRIES, 'HR', 'SI', 'LV', 'ME', 'BA', 'PL', 'CZ', 'GB', 'BE'];

// ---------------------------------------------------------------------------

/** A seed made from several numbers. */
function mix(...xs: number[]): number {
  let h = 2166136261;
  for (const x of xs) h = Math.imul(h ^ (x >>> 0), 16777619) ^ (h >>> 13);
  return h >>> 0;
}

type RngState = ReturnType<typeof createRng>;

/** A triangular draw: between lo and hi, most often near mode. */
function tri(rng: RngState, lo: number, mode: number, hi: number): number {
  const u = next(rng);
  const f = (mode - lo) / (hi - lo);
  return u < f ? lo + Math.sqrt(u * (hi - lo) * (mode - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
/** From hi (rank 0, the biggest) down to lo (rank 1, the smallest). */
const byRank = ([lo, hi]: [number, number], rank: number) => hi - rank * (hi - lo);

/** How far a player of this age can still grow, in overall points (his ceiling above today). */
function growth(rng: RngState, age: number): number {
  if (age <= 18) return range(rng, 14, 30);
  if (age <= 20) return range(rng, 10, 24);
  if (age <= 22) return range(rng, 6, 16);
  if (age <= 24) return range(rng, 3, 10);
  if (age <= 26) return range(rng, 1, 6);
  return range(rng, 0, 2);
}

/** Every first team: 3 PG, 2 SG, 3 SF, 2 PF, 3 C (at least two guards, wings and bigs). */
const SQUAD_SHAPE: Record<Position, number> = { PG: 3, SG: 2, SF: 3, PF: 2, C: 3 };
const POS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

/** Today's overall of a player. */
export function overall(wp: WorldPlayer): number {
  return composite(wp.p).overall;
}

class Maker {
  readonly rng: RngState;
  private readonly takenNames = new Set<string>();
  private readonly takenIds = new Set<string>();
  private readonly sources = new Map<string, () => string>();
  readonly players: Record<string, WorldPlayer> = {};
  private readonly towns: Record<string, string[]> = {};

  constructor(readonly seed: number) {
    this.rng = createRng(mix(seed, 1));
    const add = (country: string, city: string) => {
      const list = (this.towns[country] ??= []);
      if (!list.includes(city)) list.push(city);
    };
    for (const pl of AMERICA) add('US', pl.city);
    for (const col of COLLEGES) add('US', col.city);
    for (const cc of EUROPE_COUNTRIES) for (const pl of EUROPE[cc]) add(cc, pl.city);
    for (const [k, v] of Object.entries(OTHER_TOWNS)) for (const city of v) add(k, city);
  }

  /** Reserves a name that already exists (a hand-made star's). */
  reserve(name: string, id: string): void {
    this.takenNames.add(name);
    this.takenIds.add(id);
  }

  /** A new, unused name for a player of this country (never a well-known real player's). */
  name(country: string): string {
    const fam = familyOf(country);
    let src = this.sources.get(fam);
    if (!src) {
      const f = NAME_FAMILIES[fam];
      const famIndex = Object.keys(NAME_FAMILIES).indexOf(fam);
      src = nameSource(f.first, f.last.map((l) => l.replace(/-/g, ' ')), mix(this.seed, 7, famIndex), this.takenNames, this.takenIds, idOf);
      this.sources.set(fam, src);
    }
    for (;;) {
      const n = src();
      if (!isFamousRealName(n)) return n;
    }
  }

  hometown(country: string): string {
    return pick(this.rng, this.towns[country] ?? this.towns.US);
  }

  personality(): Personality {
    const one = () => Math.round(clamp(tri(this.rng, 1, 11, 20), 1, 20));
    return { professionalism: one(), ambition: one(), loyalty: one(), temperament: one() };
  }

  private add(p: Player, o: { age: number; country: string; origin: Origin; status: PlayerStatus; reputation: number }): WorldPlayer {
    const wp: WorldPlayer = {
      p,
      born: START_SEASON - o.age,
      nationality: o.country,
      hometown: this.hometown(o.country),
      origin: o.origin,
      personality: this.personality(),
      reputation: Math.round(clamp(o.reputation, 1, 99)),
      morale: 'okay',
      promises: [],
      status: o.status,
    };
    this.players[p.id] = wp;
    return wp;
  }

  /** A generated player: ratings around base `q` for his position, a ceiling by age. */
  make(o: { pos: Position; q: number; age: number; country: string; origin: Origin; status: PlayerStatus; reputation: number }): WorldPlayer {
    const rng = this.rng;
    const tpl = TEMPLATES[o.pos];
    const a = tpl.t.map((offset) => o.q + offset + range(rng, -6, 6));
    // Past 30 the legs go first.
    if (o.age > 30) {
      a[0] -= (o.age - 30) * 2.2;
      a[1] -= (o.age - 30) * 1.5;
    }
    const injury = int(rng, 15, 65);
    const cm = int(rng, tpl.cm[0], tpl.cm[1]);
    const kg = Math.round((cm - 100) * range(rng, 0.88, 1.05));
    const name = this.name(o.country);
    const p: Player = {
      id: idOf(name),
      name,
      number: int(rng, 0, 55),
      position: o.pos,
      archetype: pick(rng, tpl.arch),
      heightCm: cm,
      weightKg: kg,
      attrs: attrsFrom([...a, injury, 50]),
    };
    const ovr = composite(p).overall;
    p.attrs.potential = Math.round(clamp(ovr + growth(rng, o.age), ovr, 99));
    return this.add(p, o);
  }

  /** A star from players.json, as he is, with an age, a country and a ceiling. */
  star(name: string): WorldPlayer {
    const src = curatedPlayers().find((c) => c.player.name === name)!;
    // A copy: the Quick League's pool keeps its own.
    const p: Player = { ...src.player, attrs: { ...src.player.attrs } };
    const age = Math.round(tri(this.rng, 23, 28, 35));
    const ovr = composite(p).overall;
    p.attrs.potential = Math.round(clamp(ovr + growth(this.rng, age), ovr, 99));
    const country = STAR_NATIONALITY[name] ?? 'US';
    return this.add(p, { age, country, origin: { kind: 'star' }, status: 'club', reputation: src.hype });
  }

  /** A nationality for a player at a club in this region and country. */
  clubNationality(region: Region, country: string): string {
    const u = next(this.rng);
    if (region === 'america') return u < 0.88 ? 'US' : pick(this.rng, ABROAD_FOR_AMERICA);
    if (u < 0.55) return country;
    if (u < 0.8) return pick(this.rng, ELSEWHERE_IN_EUROPE);
    return 'US';
  }
}

/** A three-letter abbreviation not used yet: from the city, then city and nickname, then anything. */
function abbrFor(city: string, nickname: string, used: Set<string>): string {
  const letters = (s: string) => plainName(s).toUpperCase().replace(/[^A-Z ]/g, '');
  const words = letters(city).split(/\s+/).filter(Boolean);
  const flat = words.join('');
  const nick = letters(nickname).replace(/ /g, '');
  const out: string[] = [];
  if (words.length >= 2) out.push(words.map((w) => w[0]).join('').padEnd(3, nick[0]).slice(0, 3));
  out.push(flat.slice(0, 3), flat.slice(0, 2) + nick[0], flat[0] + nick.slice(0, 2), flat[0] + flat[2] + nick[0], flat[0] + nick[0] + nick[nick.length - 1]);
  const pool = flat + nick;
  for (let i = 1; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) out.push(flat[0] + pool[i] + pool[j]);
  const hit = out.find((a) => a.length === 3 && !used.has(a));
  const abbr = hit ?? `${flat.slice(0, 2)}${[...Array(10).keys()].find((d) => !used.has(`${flat.slice(0, 2)}${d}`))}`;
  used.add(abbr);
  return abbr;
}

/**
 * Splits `total` over the weights, each share between lo and hi (water-filling: shares that hit a
 * limit are fixed there and the rest is spread again over the others).
 */
function share(total: number, weights: number[], lo: number, hi: number): number[] {
  const out = weights.map(() => 0);
  const fixed = weights.map(() => false);
  for (let round = 0; round < 30; round++) {
    const left = total - out.reduce((s, x, i) => s + (fixed[i] ? x : 0), 0);
    const free = weights.map((_, i) => i).filter((i) => !fixed[i]);
    const sumW = free.reduce((s, i) => s + weights[i], 0);
    let changed = false;
    for (const i of free) {
      const x = (left * weights[i]) / sumW;
      if (x > hi) {
        out[i] = hi;
        fixed[i] = true;
        changed = true;
      } else if (x < lo) {
        out[i] = lo;
        fixed[i] = true;
        changed = true;
      } else out[i] = x;
    }
    if (!changed) break;
  }
  return out;
}

interface Draft {
  place: Place;
  region: Region;
  level: Level;
  /** 0 for the biggest club of its level (in its country, in Europe), 1 for the smallest. */
  rank: number;
  reputation: number;
  licence: WorldClub['licence'];
}

/**
 * A club's budget at a level (WORLD_SPEC §10.1), as the world is made: `rank` 0 for the league's biggest
 * club to 1 for its smallest (slice W2b: a club that changes tier gets the new tier's money).
 */
export function levelBudget(level: 'blE' | 'us2' | 'us3' | 'us4' | 'n1' | 'n2', country: string, rank: number): number {
  const [lo, hi] = BUDGET[level];
  const top = level === 'n1' || level === 'n2' ? Math.max(lo * 1.5, hi * (COUNTRY[country]?.money ?? 1)) : hi;
  return tidy(clamp(byRank([lo, top], rank), lo, hi));
}

export function createWorld(seed: number): World {
  const m = new Maker(seed);
  const rng = m.rng;

  // 1. Where every club starts.
  const drafts: Draft[] = [];
  AMERICA.forEach((place, i) => {
    const level: Level = i < BIG_LEAGUE_AMERICA ? 'blA' : (['us2', 'us3', 'us4'] as const)[Math.floor((i - BIG_LEAGUE_AMERICA) / US_DIVISION)];
    const rank = i < BIG_LEAGUE_AMERICA ? i / (BIG_LEAGUE_AMERICA - 1) : ((i - BIG_LEAGUE_AMERICA) % US_DIVISION) / (US_DIVISION - 1);
    drafts.push({ place, region: 'america', level, rank, reputation: Math.round(byRank(REPUTATION[level], rank) + range(rng, -2, 2)), licence: null });
  });
  for (const cc of EUROPE_COUNTRIES) {
    const fame = COUNTRY[cc].fame;
    EUROPE[cc].forEach((place, i) => {
      const tier1 = i < NATIONAL_TIER;
      const rank = (i % NATIONAL_TIER) / (NATIONAL_TIER - 1);
      const licence = tier1 && i < (LICENCES[cc] ?? 0) ? 'licence' : null;
      const level: Level = licence ? 'blE' : tier1 ? 'n1' : 'n2';
      // Within a level, a famous basketball country's clubs are better known.
      const reputation = Math.round(byRank(REPUTATION[tier1 ? 'n1' : 'n2'], rank) + (fame - 80) / 2 + range(rng, -4, 4));
      drafts.push({ place, region: 'europe', level, rank, reputation, licence });
    });
  }
  // The two wildcards: the best-known first-tier clubs without a licence, from two different countries.
  const candidates = drafts.filter((d) => d.level === 'n1').sort((a, b) => b.reputation - a.reputation);
  const first = candidates[0];
  const second = candidates.find((d) => d.place.country !== first.place.country)!;
  for (const d of [first, second]) {
    d.licence = 'wildcard';
    d.level = 'blE';
  }
  // Big League Europe's order: licence clubs by their country's fame and their place in it, then the wildcards.
  const blE = drafts.filter((d) => d.level === 'blE');
  const blEKey = (d: Draft) => (d.licence === 'wildcard' ? -1000 + d.reputation : COUNTRY[d.place.country].fame - EUROPE[d.place.country].indexOf(d.place) * 6);
  blE.sort((a, b) => blEKey(b) - blEKey(a));
  blE.forEach((d, i) => {
    d.rank = i / (blE.length - 1);
    d.reputation = Math.round(byRank(REPUTATION.blE, d.rank) + range(rng, -2, 2));
  });
  // A country's first-tier clubs outside the Big League ranked among themselves.
  for (const cc of EUROPE_COUNTRIES) {
    const n1 = drafts.filter((d) => d.level === 'n1' && d.place.country === cc);
    n1.forEach((d, i) => (d.rank = n1.length > 1 ? i / (n1.length - 1) : 0));
  }

  // 2. The clubs.
  const usedAbbr = new Set<string>();
  const clubs: WorldClub[] = [];
  const levelOf = new Map<string, Draft>();
  for (const d of drafts) {
    const pl = d.place;
    const name = `${pl.city} ${pl.nickname}`;
    const level = d.level;
    const fac = () => Math.round(clamp(byRank(FACILITIES[level], d.rank) + range(rng, -2, 2), 1, 20));
    const [nLo] = FANS[level];
    const arenaWord = d.region === 'america' ? pick(rng, ['Arena', 'Center', 'Fieldhouse', 'Coliseum']) : pick(rng, ['Arena', 'Sports Hall', 'Palace', 'Dome']);
    let budget = 0;
    if (level !== 'blA') {
      const [lo, hi] = BUDGET[level];
      // A poorer country's biggest clubs have less; its smallest are at the tier's floor all the same.
      const top = level === 'n1' || level === 'n2' ? Math.max(lo * 1.5, hi * COUNTRY[pl.country].money) : hi;
      budget = tidy(clamp(byRank([lo, top], d.rank) * range(rng, 0.95, 1.05), lo, hi));
    }
    const club: WorldClub = {
      id: idOf(name),
      city: pl.city,
      country: pl.country,
      ...(pl.state ? { state: pl.state } : {}),
      nickname: pl.nickname,
      name,
      abbr: abbrFor(pl.city, pl.nickname, usedAbbr),
      region: d.region,
      colours: PALETTE[0],
      arena: { name: `${pl.city} ${arenaWord}`, capacity: Math.round((byRank(CAPACITY[level], d.rank) + range(rng, -500, 500)) / 100) * 100 },
      reputation: Math.round(clamp(d.reputation, 1, 99)),
      fans: Math.max(1, Math.round(byRank(FANS[level], d.rank) + range(rng, -nLo / 2, nLo / 2))),
      moneySystem: level === 'blA' ? 'cap' : 'budget',
      budget,
      midLevelLeft: level === 'blA' ? MID_LEVEL : 0,
      licence: d.licence,
      bottomTwoFinishes: 0,
      facilities: { training: fac(), youth: fac(), medical: fac() },
      roster: [],
      dev: [],
      academy: [],
    };
    clubs.push(club);
    levelOf.set(club.id, d);
  }
  const byId = new Map(clubs.map((c) => [c.id, c]));

  // 3. The competitions. Every club is in exactly one league; Big League Europe clubs also in theirs.
  const competitions: Competition[] = [];
  const ids = (ds: Draft[]) => ds.map((d) => idOf(`${d.place.city} ${d.place.nickname}`));
  const america = drafts.filter((d) => d.region === 'america');
  competitions.push({ id: 'big-league-america', name: 'Big League · America', kind: 'bigLeague', region: 'america', tier: 1, clubs: ids(america.slice(0, BIG_LEAGUE_AMERICA)) });
  competitions.push({ id: 'big-league-europe', name: 'Big League · Europe', kind: 'bigLeague', region: 'europe', tier: 1, clubs: ids(blE) });
  for (const t of [2, 3, 4]) {
    const from = BIG_LEAGUE_AMERICA + (t - 2) * US_DIVISION;
    competitions.push({ id: `us-division-${t}`, name: `US Division ${t}`, kind: 'usDivision', region: 'america', tier: t, clubs: ids(america.slice(from, from + US_DIVISION)) });
  }
  for (const cc of EUROPE_COUNTRIES) {
    const own = drafts.filter((d) => d.region === 'europe' && d.place.country === cc);
    const tiers = Math.ceil(own.length / NATIONAL_TIER);
    for (let t = 1; t <= tiers; t++) {
      const name = tiers === 1 ? `${LEAGUE_ADJECTIVE[cc]} League` : t === 1 ? `${LEAGUE_ADJECTIVE[cc]} League` : `${LEAGUE_ADJECTIVE[cc]} League ${t}`;
      competitions.push({ id: `${cc.toLowerCase()}-league-${t}`, name, kind: 'nationalLeague', region: 'europe', country: cc, tier: t, clubs: ids(own.slice((t - 1) * NATIONAL_TIER, t * NATIONAL_TIER)) });
    }
  }
  // Colours by league: no two clubs of a league share a pair.
  competitions
    .filter((c) => !(c.kind === 'bigLeague' && c.region === 'europe'))
    .forEach((comp, li) => comp.clubs.forEach((id, k) => (byId.get(id)!.colours = PALETTE[(k * 7 + li * 3) % PALETTE.length])));

  // 4. The stars: dealt to the 30 Big League clubs, best first, the two conferences interleaved by size
  // and snaking, so the conferences start about as strong as each other.
  const stars = [...curatedPlayers()].sort((a, b) => composite(b.player).overall - composite(a.player).overall);
  for (const s of stars) m.reserve(s.player.name, s.player.id);
  const bigA = competitions[0].clubs.map((id) => byId.get(id)!);
  const bigE = competitions[1].clubs.map((id) => byId.get(id)!);
  const order = [...bigA.map((c, i) => ({ c, k: i / bigA.length })), ...bigE.map((c, i) => ({ c, k: i / bigE.length + 1e-6 }))].sort((a, b) => a.k - b.k).map((x) => x.c);
  stars.forEach((s, i) => {
    const round = Math.floor(i / order.length);
    const at = i % order.length;
    const club = order[round % 2 === 0 ? at : order.length - 1 - at];
    const wp = m.star(s.player.name);
    wp.club = club.id;
    club.roster.push(wp.p.id);
  });

  // Where a club player came through: a US college, a club academy in his country, or abroad.
  const clubsIn = new Map<string, WorldClub[]>();
  for (const c of clubs) if (c.region === 'europe') clubsIn.set(c.country, [...(clubsIn.get(c.country) ?? []), c]);
  const originFor = (country: string): Origin =>
    country === 'US' ? { kind: 'college', college: idOf(pick(rng, COLLEGES).name) } : clubsIn.has(country) ? { kind: 'academy', club: pick(rng, clubsIn.get(country)!).id } : { kind: 'international' };

  // 5. Every first team filled to 13 in the club's shape, and a development squad of 2–3.
  for (const club of clubs) {
    const d = levelOf.get(club.id)!;
    const [qLo, qHi] = QUALITY[d.level];
    // A country's strength shows in its national leagues; the Big League's two conferences are level.
    const nation = club.region === 'europe' && d.level !== 'blE' ? COUNTRY[club.country].quality : 0;
    const need: Record<Position, number> = { ...SQUAD_SHAPE };
    for (const id of club.roster) {
      const pos = m.players[id].p.position;
      if (need[pos] > 0) need[pos]--;
      else {
        const most = POS.slice().sort((a, b) => need[b] - need[a])[0];
        need[most]--;
      }
    }
    const positions = POS.flatMap((pos) => Array.from({ length: Math.max(0, need[pos]) }, () => pos));
    for (const pos of positions) {
      if (club.roster.length >= ROSTER) break;
      const age = Math.round(tri(rng, 19, 25, 36));
      const gem = next(rng) < 0.1 ? 6 : 0;
      const q = range(rng, qLo, qHi) + (0.5 - d.rank) * 4 + nation + gem - Math.max(0, 22 - age) * 2;
      const country = m.clubNationality(club.region, club.country);
      const origin = originFor(country);
      const rep = REPUTATION[d.level][0] * 0.45 + range(rng, -8, 8) + (q - qLo) * 1.5;
      const wp = m.make({ pos, q, age, country, origin, status: 'club', reputation: rep });
      wp.club = club.id;
      club.roster.push(wp.p.id);
    }
    const devCount = 2 + (next(rng) < 0.5 ? 1 : 0);
    for (let k = 0; k < devCount; k++) {
      const age = int(rng, 18, 22);
      const q = qLo - 5 + (age - 18) * 1.5 + nation + range(rng, -4, 4);
      const country = m.clubNationality(club.region, club.country);
      const origin = originFor(country);
      const wp = m.make({ pos: pick(rng, POS), q, age, country, origin, status: 'dev', reputation: REPUTATION[d.level][0] * 0.25 + range(rng, 0, 8) });
      wp.club = club.id;
      club.dev.push(wp.p.id);
    }
    // Shirt numbers: none twice in a club.
    const used = new Set<number>();
    for (const id of [...club.roster, ...club.dev]) {
      const p = m.players[id].p;
      while (used.has(p.number)) p.number = int(rng, 0, 55);
      used.add(p.number);
    }
  }

  // 6. Contracts. Cap clubs: a payroll between the floor and the tax line. Budget clubs: wages at
  // 75–90% of the club budget, every contract with a buyout fee.
  for (const club of clubs) {
    const d = levelOf.get(club.id)!;
    const first = club.roster.map((id) => m.players[id]);
    const mean = first.reduce((s, wp) => s + overall(wp), 0) / first.length;
    const weights = first.map((wp) => Math.exp((overall(wp) - mean) / 8) * (0.85 + wp.reputation / 200));
    const age = (wp: WorldPlayer) => START_SEASON - wp.born;
    if (club.moneySystem === 'cap') {
      const wages = share(range(rng, 0.92, 1.18) * CAP, weights, MIN_CONTRACT, MAX_CONTRACT);
      first.forEach((wp, i) => {
        const rookie = age(wp) <= 22 && wp.origin.kind !== 'star';
        const years = rookie ? int(rng, 1, 3) : age(wp) >= 32 ? int(rng, 1, 2) : int(rng, 1, 5);
        wp.contract = { wage: tidy(wages[i]), years, ...(rookie ? { rookie: true } : {}) };
      });
      // Dev squad: minimum contracts, outside the cap.
      for (const id of club.dev) m.players[id].contract = { wage: MIN_CONTRACT, years: int(rng, 1, 2) };
      continue;
    }
    const level = d.level as Exclude<Level, 'blA'>;
    const devWage = tidy(club.budget * DEV_WAGE_BUDGET_SHARE);
    const target = club.budget * range(rng, 0.75, 0.9) - club.dev.length * devWage;
    const wages = share(target, weights, devWage, MAX_CONTRACT).map(tidy);
    // Big League Europe: nobody starts above the payroll threshold.
    if (club.licence) {
      const counted = thresholdCounted(first.map((wp, i) => ({ wage: wages[i], age: age(wp) })));
      const room = THRESHOLD * 0.97;
      if (counted.sum > room) for (const i of counted.indices) wages[i] = tidy(wages[i] * (room / counted.sum));
    }
    const buyout = (wp: WorldPlayer, wage: number, years: number) => {
      const ageF = clamp(1.7 - (age(wp) - 20) * 0.09, 0.4, 1.7);
      const qualF = clamp(1 + (overall(wp) - mean) / 15, 0.6, 1.4);
      return tidy(wage * buyoutYears(years) * ageF * qualF * BUYOUT_SCALE[level]);
    };
    first.forEach((wp, i) => {
      const years = age(wp) >= 32 ? int(rng, 1, 2) : int(rng, 1, 3);
      wp.contract = { wage: wages[i], years, buyout: buyout(wp, wages[i], years) };
    });
    for (const id of club.dev) {
      const wp = m.players[id];
      const years = int(rng, 1, 2);
      wp.contract = { wage: devWage, years, buyout: buyout(wp, devWage, years) };
    }
  }

  // 7. Free agents: mostly older players between clubs, of every level below the Big League's best.
  const freeAgents: string[] = [];
  const faLevels: Level[] = ['us2', 'n1', 'us3', 'n2', 'us4'];
  for (let i = 0; i < FREE_AGENTS; i++) {
    const level = pick(rng, faLevels);
    const [qLo, qHi] = QUALITY[level];
    const age = Math.round(tri(rng, 21, 31, 37));
    const country = i % 2 === 0 ? 'US' : next(rng) < 0.8 ? pick(rng, ELSEWHERE_IN_EUROPE) : pick(rng, ABROAD_FOR_AMERICA);
    const origin: Origin = country === 'US' ? { kind: 'college', college: idOf(pick(rng, COLLEGES).name) } : { kind: 'international' };
    const wp = m.make({ pos: POS[i % 5], q: range(rng, qLo, qHi), age, country, origin, status: 'free', reputation: REPUTATION[level][0] * 0.4 + range(rng, -6, 6) });
    freeAgents.push(wp.p.id);
  }

  // 8. Colleges: 15 players each, freshmen to seniors.
  const colleges: College[] = COLLEGES.map((col) => {
    const id = idOf(col.name);
    const players: string[] = [];
    for (let k = 0; k < COLLEGE_SQUAD; k++) {
      const year = 1 + (k % 4);
      const age = 17 + year + (next(rng) < 0.3 ? 1 : 0);
      const gem = next(rng) < 0.1 ? 8 : 0;
      const q = 40 - (col.level - 1) * 2 + (year - 1) * 2.5 + range(rng, -5, 5) + gem;
      const country = next(rng) < 0.88 ? 'US' : pick(rng, ABROAD_FOR_AMERICA);
      const wp = m.make({ pos: POS[k % 5], q, age, country, origin: { kind: 'college', college: id }, status: 'college', reputation: 3 + (5 - col.level) * 2 + year * 2 + gem + range(rng, 0, 6) });
      wp.college = id;
      wp.collegeYear = year;
      players.push(wp.p.id);
    }
    return { id, name: col.name, city: col.city, state: col.state, level: col.level, players };
  });

  // 9. European academies: 6 players aged 15–18, better with a better youth set-up.
  for (const club of clubs.filter((c) => c.region === 'europe')) {
    for (let k = 0; k < ACADEMY_SQUAD; k++) {
      const age = int(rng, 15, 18);
      const q = 22 + (age - 15) * 3 + club.facilities.youth * 0.6 + range(rng, -5, 5);
      const country = next(rng) < 0.8 ? club.country : pick(rng, ELSEWHERE_IN_EUROPE);
      const wp = m.make({ pos: POS[k % 5], q, age, country, origin: { kind: 'academy', club: club.id }, status: 'academy', reputation: 1 + range(rng, 0, 6) });
      wp.club = club.id;
      club.academy.push(wp.p.id);
    }
  }

  return { kind: 'world', seed, season: START_SEASON, clubs, competitions, players: m.players, colleges, freeAgents, human: null };
}

/** A buyout fee's base, in wages, by the seasons left on the contract (about a wage for 3 years; tune). */
export const buyoutYears = (years: number) => 0.25 + 0.2 * years;

/**
 * The wages that count towards the Big League Europe payroll threshold: all but the 3 highest-paid
 * (the anchor players) and the players under 23 (GAME_FLOW §4.2). Returns their sum and indices.
 */
export function thresholdCounted(squad: { wage: number; age: number }[]): { sum: number; indices: number[] } {
  const anchors = new Set(
    squad
      .map((s, i) => ({ w: s.wage, i }))
      .sort((a, b) => b.w - a.w || a.i - b.i)
      .slice(0, ANCHORS)
      .map((x) => x.i),
  );
  const indices = squad.map((_, i) => i).filter((i) => !anchors.has(i) && squad[i].age >= THRESHOLD_MIN_AGE);
  return { sum: indices.reduce((s, i) => s + squad[i].wage, 0), indices };
}
