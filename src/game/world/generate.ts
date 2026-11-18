// The career world, made from a seed (WORLD_SPEC §1, slice W1): 128 clubs in two separate regions
// (America and Europe, each a Big League conference and Divisions 2–4 of 16 clubs), their squads, the
// hand-made stars, free agents, 40 US colleges and the European clubs' academies. The same seed always
// makes the same world.

import { composite } from '../../engine/ratings';
import { createRng, int, next, pick, range } from '../../engine/rng';

type RngState = ReturnType<typeof createRng>;
import type { Player, Position } from '../../engine/types';
import { LEAGUES, REGIONS, type Region } from '../league/leagues';
import { nameSource } from '../names';
import { attrsFrom, curatedPlayers, TEMPLATES } from '../pool';
import { tidy, toCurrency } from './money';
import { NAME_FAMILIES, familyOf, idOf, isFamousRealName } from './names';
import { COLLEGES, PLACES } from './places';
import type { College, Currency, Origin, Personality, PlayerStatus, Tier, World, WorldClub, WorldPlayer } from './types';

export const START_SEASON = 2026;
export const CLUBS_PER_LEAGUE = 16;
export const ROSTER = 13;
export const FREE_AGENTS = 200;
export const COLLEGE_SQUAD = 15;
export const ACADEMY_SQUAD = 6;

/** How good a tier's players are: the base rating band before position offsets (see pool.ts TEMPLATES). */
const QUALITY: Record<Tier, [number, number]> = { 1: [57, 69], 2: [52, 63], 3: [45, 55], 4: [38, 48] };
/** A tier's typical wage in dollars, for a player of that tier's average overall. */
const BASE_WAGE_USD: Record<Tier, number> = { 1: 4_200_000, 2: 900_000, 3: 220_000, 4: 60_000 };
const MAX_WAGE_USD = 48_000_000;
/** The transfer budget, as a share of the wage budget. */
const TRANSFER_SHARE: Record<Tier, number> = { 1: 0.25, 2: 0.2, 3: 0.15, 4: 0.1 };
const CAPACITY: Record<Tier, [number, number]> = { 1: [14_000, 21_000], 2: [6_000, 12_000], 3: [2_500, 6_000], 4: [800, 3_000] };
const REPUTATION: Record<Tier, [number, number]> = { 1: [72, 96], 2: [48, 70], 3: [28, 48], 4: [10, 28] };
const FACILITIES: Record<Tier, [number, number]> = { 1: [12, 18], 2: [9, 14], 3: [6, 11], 4: [3, 8] };
const FANS: Record<Tier, [number, number]> = { 1: [180, 900], 2: [60, 220], 3: [20, 70], 4: [5, 25] };

/** Thirty-two colour pairs; a league's sixteen clubs never share one. */
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
  PR: ['San Juan'], CD: ['Kinshasa'], CH: ['Geneva'], NZ: ['Auckland'], CN: ['Shanghai'],
};

/** Where American clubs and colleges find players from abroad. */
const ABROAD_FOR_AMERICA = ['CA', 'AU', 'NG', 'SN', 'CM', 'FR', 'ES', 'RS', 'GR', 'TR', 'LT', 'DE', 'BR', 'AR', 'DO', 'PR', 'HR', 'SI', 'IT'];

// ---------------------------------------------------------------------------

/** A seed made from several numbers. */
function mix(...xs: number[]): number {
  let h = 2166136261;
  for (const x of xs) h = Math.imul(h ^ (x >>> 0), 16777619) ^ (h >>> 13);
  return h >>> 0;
}

/** A triangular draw: between lo and hi, most often near mode. */
function tri(rng: RngState, lo: number, mode: number, hi: number): number {
  const u = next(rng);
  const f = (mode - lo) / (hi - lo);
  return u < f ? lo + Math.sqrt(u * (hi - lo) * (mode - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** How far a player of this age can still grow, in overall points (his ceiling above today). */
function growth(rng: RngState, age: number): number {
  if (age <= 18) return range(rng, 14, 30);
  if (age <= 20) return range(rng, 10, 24);
  if (age <= 22) return range(rng, 6, 16);
  if (age <= 24) return range(rng, 3, 10);
  if (age <= 26) return range(rng, 1, 6);
  return range(rng, 0, 2);
}

/** Every first-team squad: 3 PG, 2 SG, 3 SF, 2 PF, 3 C (at least two guards, wings and bigs). */
const SQUAD_SHAPE: Record<Position, number> = { PG: 3, SG: 2, SF: 3, PF: 2, C: 3 };

class Maker {
  readonly rng: RngState;
  private readonly takenNames = new Set<string>();
  private readonly takenIds = new Set<string>();
  private readonly sources = new Map<string, () => string>();
  readonly players: Record<string, WorldPlayer> = {};
  private readonly towns: Record<string, string[]> = {};

  constructor(readonly seed: number) {
    this.rng = createRng(mix(seed, 1));
    for (const region of REGIONS) for (const pl of PLACES[region]) (this.towns[pl.country] ??= []).push(pl.city);
    for (const col of COLLEGES) if (!this.towns.US.includes(col.city)) this.towns.US.push(col.city);
    for (const [k, v] of Object.entries(OTHER_TOWNS)) this.towns[k] = [...(this.towns[k] ?? []), ...v];
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
    const wp: WorldPlayer = {
      p,
      born: START_SEASON - o.age,
      nationality: o.country,
      hometown: this.hometown(o.country),
      origin: o.origin,
      personality: this.personality(),
      reputation: Math.round(clamp(o.reputation, 1, 99)),
      status: o.status,
    };
    this.players[p.id] = wp;
    return wp;
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
    const wp: WorldPlayer = {
      p,
      born: START_SEASON - age,
      nationality: country,
      hometown: this.hometown(country),
      origin: { kind: 'star' },
      personality: this.personality(),
      reputation: src.hype,
      status: 'club',
    };
    this.players[p.id] = wp;
    return wp;
  }

  /** A nationality for a player at a club in this region and country. */
  clubNationality(region: Region, country: string): string {
    const u = next(this.rng);
    if (region === 'america') return u < 0.88 ? 'US' : pick(this.rng, ABROAD_FOR_AMERICA);
    if (u < 0.55) return country;
    if (u < 0.8) return pick(this.rng, EUROPE_COUNTRIES);
    return 'US';
  }
}

const EUROPE_COUNTRIES = [...new Set(PLACES.europe.map((pl) => pl.country))];

/** An abbreviation from a city: initials of a two-word city ("Salt Lake City" SLC), else its first three letters. */
function abbrCandidates(city: string, nickname: string): string[] {
  const letters = city.replace(/[^A-Za-z ]/g, '').toUpperCase();
  const words = letters.split(/\s+/).filter(Boolean);
  const n = nickname[0].toUpperCase();
  const out: string[] = [];
  if (words.length >= 2) out.push(words.map((w) => w[0]).join('').padEnd(3, n).slice(0, 3));
  const flat = words.join('');
  out.push(flat.slice(0, 3), flat.slice(0, 2) + n, flat[0] + flat.slice(2, 4), flat[0] + flat[1] + flat[3], flat[0] + n + flat[1]);
  return out.filter((a) => a.length === 3);
}

/** Today's overall of a player. */
export function overall(wp: WorldPlayer): number {
  return composite(wp.p).overall;
}

export function createWorld(seed: number): World {
  const m = new Maker(seed);
  const rng = m.rng;
  const quickAbbr = new Map(Object.values(LEAGUES).flatMap((l) => REGIONS.flatMap((r) => l.teams[r].map((t) => [t.name, t.abbr] as const))));
  const usedAbbr = new Set<string>();

  // The clubs: per region, from the biggest city down; 16 to a tier.
  const clubs: WorldClub[] = [];
  for (const region of REGIONS) {
    PLACES[region].forEach((pl, i) => {
      const tier = (1 + Math.floor(i / CLUBS_PER_LEAGUE)) as Tier;
      const inTier = i % CLUBS_PER_LEAGUE;
      // 0 for the biggest city of its tier, 1 for the smallest.
      const rank = inTier / (CLUBS_PER_LEAGUE - 1);
      const name = `${pl.city} ${pl.nickname}`;
      const abbr = [quickAbbr.get(name), ...abbrCandidates(pl.city, pl.nickname)].find((a): a is string => !!a && !usedAbbr.has(a))!;
      usedAbbr.add(abbr);
      const currency: Currency = region === 'america' ? 'USD' : 'EUR';
      const [cLo, cHi] = CAPACITY[tier];
      const [rLo, rHi] = REPUTATION[tier];
      const [fLo, fHi] = FACILITIES[tier];
      const [nLo, nHi] = FANS[tier];
      const fac = () => Math.round(clamp(fHi - rank * (fHi - fLo) + range(rng, -2, 2), 1, 20));
      const arenaWord = region === 'america' ? pick(rng, ['Arena', 'Center', 'Fieldhouse', 'Coliseum']) : pick(rng, ['Arena', 'Sports Hall', 'Palace', 'Dome']);
      clubs.push({
        id: idOf(name),
        city: pl.city,
        country: pl.country,
        ...(pl.state ? { state: pl.state } : {}),
        nickname: pl.nickname,
        name,
        abbr,
        region,
        tier,
        colours: PALETTE[(i * 7 + (region === 'europe' ? 3 : 0)) % PALETTE.length],
        arena: { name: `${pl.city} ${arenaWord}`, capacity: Math.round((cHi - rank * (cHi - cLo) + range(rng, -500, 500)) / 100) * 100 },
        reputation: Math.round(rHi - rank * (rHi - rLo) + range(rng, -2, 2)),
        fans: Math.round(nHi - rank * (nHi - nLo) + range(rng, -nLo / 2, nLo / 2)),
        currency,
        budget: { wages: 0, transfers: 0 },
        facilities: { training: fac(), youth: fac(), medical: fac() },
        roster: [],
        academy: [],
      });
    });
  }

  // The stars: dealt to the 32 Big League clubs, best first, snaking America–Europe–America… so the
  // two conferences start about as strong as each other.
  const stars = [...curatedPlayers()].sort((a, b) => composite(b.player).overall - composite(a.player).overall);
  for (const s of stars) m.reserve(s.player.name, s.player.id);
  const top = REGIONS.map((r) => clubs.filter((c) => c.region === r && c.tier === 1));
  const order: WorldClub[] = [];
  for (let i = 0; i < CLUBS_PER_LEAGUE; i++) order.push(top[0][i], top[1][i]);
  stars.forEach((s, i) => {
    const round = Math.floor(i / order.length);
    const at = i % order.length;
    const club = order[round % 2 === 0 ? at : order.length - 1 - at];
    const wp = m.star(s.player.name);
    wp.club = club.id;
    club.roster.push(wp.p.id);
  });

  // Every squad filled to 13 in the club's shape.
  for (const club of clubs) {
    const need: Record<Position, number> = { ...SQUAD_SHAPE };
    for (const id of club.roster) {
      const pos = m.players[id].p.position;
      if (need[pos] > 0) need[pos]--;
      else {
        const most = (Object.keys(need) as Position[]).sort((a, b) => need[b] - need[a])[0];
        need[most]--;
      }
    }
    const positions = (Object.keys(need) as Position[]).flatMap((pos) => Array.from({ length: Math.max(0, need[pos]) }, () => pos));
    const [qLo, qHi] = QUALITY[club.tier];
    for (const pos of positions) {
      if (club.roster.length >= ROSTER) break;
      const age = Math.round(tri(rng, 19, 25, 36));
      const gem = next(rng) < 0.1 ? 6 : 0;
      const q = range(rng, qLo, qHi) + gem - Math.max(0, 22 - age) * 2;
      const country = m.clubNationality(club.region, club.country);
      const origin: Origin =
        country === 'US' ? { kind: 'college', college: idOf(pick(rng, COLLEGES).name) } : clubs.some((c) => c.country === country) ? { kind: 'academy', club: pick(rng, clubs.filter((c) => c.country === country)).id } : { kind: 'international' };
      const rep = REPUTATION[club.tier][0] * 0.45 + range(rng, -8, 8) + (q - qLo) * 1.5;
      const wp = m.make({ pos, q, age, country, origin, status: 'club', reputation: rep });
      wp.club = club.id;
      club.roster.push(wp.p.id);
    }
    // Shirt numbers: none twice in a squad.
    const used = new Set<number>();
    for (const id of club.roster) {
      const p = m.players[id].p;
      while (used.has(p.number)) p.number = int(rng, 0, 55);
      used.add(p.number);
    }
  }

  // Wages (by how good a player is for his tier) and budgets that fit them.
  const tierMean: Record<number, number> = {};
  for (const t of [1, 2, 3, 4] as Tier[]) {
    const ovrs = clubs.filter((c) => c.tier === t).flatMap((c) => c.roster.map((id) => overall(m.players[id])));
    tierMean[t] = ovrs.reduce((a, b) => a + b, 0) / ovrs.length;
  }
  for (const club of clubs) {
    let total = 0;
    for (const id of club.roster) {
      const wp = m.players[id];
      const base = BASE_WAGE_USD[club.tier];
      const usd = clamp(base * Math.exp((overall(wp) - tierMean[club.tier]) / 9) * (0.85 + wp.reputation / 200), base * 0.2, Math.min(base * 12, MAX_WAGE_USD));
      const wage = tidy(toCurrency(usd, club.currency));
      wp.contract = { wage, years: int(rng, 1, 4) };
      total += wage;
    }
    const wages = tidy(total * range(rng, 1.04, 1.18));
    club.budget = { wages, transfers: tidy(wages * TRANSFER_SHARE[club.tier]) };
  }

  // Free agents: mostly older players between clubs, of every level below the Big League's best.
  const freeAgents: string[] = [];
  const POS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
  for (let i = 0; i < FREE_AGENTS; i++) {
    const tier = (next(rng) < 0.3 ? 2 : next(rng) < 0.5 ? 3 : 4) as Tier;
    const [qLo, qHi] = QUALITY[tier];
    const age = Math.round(tri(rng, 21, 31, 37));
    const country = i % 2 === 0 ? 'US' : next(rng) < 0.8 ? pick(rng, EUROPE_COUNTRIES) : pick(rng, ABROAD_FOR_AMERICA);
    const origin: Origin = country === 'US' ? { kind: 'college', college: idOf(pick(rng, COLLEGES).name) } : { kind: 'international' };
    const wp = m.make({ pos: POS[i % 5], q: range(rng, qLo, qHi), age, country, origin, status: 'free', reputation: REPUTATION[tier][0] * 0.4 + range(rng, -6, 6) });
    freeAgents.push(wp.p.id);
  }

  // Colleges: 15 players each, freshmen to seniors.
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

  // European academies: 6 players aged 15–18, better with a better youth set-up.
  for (const club of clubs.filter((c) => c.region === 'europe')) {
    for (let k = 0; k < ACADEMY_SQUAD; k++) {
      const age = int(rng, 15, 18);
      const q = 22 + (age - 15) * 3 + club.facilities.youth * 0.6 + range(rng, -5, 5);
      const country = next(rng) < 0.8 ? club.country : pick(rng, EUROPE_COUNTRIES);
      const wp = m.make({ pos: POS[k % 5], q, age, country, origin: { kind: 'academy', club: club.id }, status: 'academy', reputation: 1 + range(rng, 0, 6) });
      wp.club = club.id;
      club.academy.push(wp.p.id);
    }
  }

  return { kind: 'world', seed, season: START_SEASON, clubs, players: m.players, colleges, freeAgents, human: null };
}
