// The Quick League's three leagues (SEASON_SPEC Part 2, R2.1): each its own player pool, budget and
// quality. A pool is 140 players: the hand-made players in the league's quality band, then
// journeymen at the league's level until every position has at least 26.

import { composite } from '../../engine/ratings';
import type { Position } from '../../engine/types';
import { curatedPlayers, journeymen, playerPool, slug, type PoolPlayer } from '../pool';

export type LeagueId = 'street' | 'pro' | 'legends';
/** America and Europe are separate worlds: a league's clubs are all from one of them (WORLD_SPEC §1.1). */
export type Region = 'america' | 'europe';
export const REGIONS: Region[] = ['america', 'europe'];
export const REGION_NAME: Record<Region, string> = { america: 'America', europe: 'Europe' };

export interface LeagueDef {
  id: LeagueId;
  name: string;
  blurb: string;
  budget: number;
  /** Which hand-made players: ranks in the overall order (0 = the best), from and to (exclusive). */
  curated: [number, number];
  /** Journeymen's base rating band. */
  quality: [number, number];
  /** And the cheaper bench players' band, for this share of the journeymen (every league has role players on small money). */
  bench: [number, number];
  benchShare: number;
  /**
   * The clubs, per region: real cities with invented nicknames (no real club's name: SEASON_SPEC
   * R3.2, checked by a test). American and European clubs never share a league; the bigger cities
   * play in the higher leagues.
   */
  teams: Record<Region, { name: string; abbr: string }[]>;
}

export const POOL_SIZE = 140;
export const MIN_PER_POSITION = 26;
const POSITIONS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

export const LEAGUES: Record<LeagueId, LeagueDef> = {
  street: {
    id: 'street',
    name: 'Street League',
    blurb: 'Scrappy and cheap: mostly journeymen, a few famous names past their best. Every bargain counts.',
    budget: 70,
    curated: [85, 102],
    quality: [38, 56],
    bench: [34, 46],
    benchShare: 0.3,
    teams: {
      america: [
        { name: 'Memphis Paddlers', abbr: 'MEM' },
        { name: 'Sacramento Prospectors', abbr: 'SAC' },
        { name: 'Indianapolis Speedsters', abbr: 'IND' },
        { name: 'Portland Bridges', abbr: 'POR' },
        { name: 'Charlotte Racers', abbr: 'CHA' },
        { name: 'Salt Lake Gulls', abbr: 'SLC' },
        { name: 'Oklahoma City Twisters', abbr: 'OKC' },
        { name: 'Milwaukee Anchors', abbr: 'MKE' },
      ],
      europe: [
        { name: 'London Cabbies', abbr: 'LON' },
        { name: 'Amsterdam Tulips', abbr: 'AMS' },
        { name: 'Lisbon Navigators', abbr: 'LIS' },
        { name: 'Manchester Bees', abbr: 'MAN' },
        { name: 'Rome Centurions', abbr: 'ROM' },
        { name: 'Hamburg Tugboats', abbr: 'HBG' },
        { name: 'Antwerp Diamonds', abbr: 'ANT' },
        { name: 'Ljubljana Larches', abbr: 'LJU' },
      ],
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro League',
    blurb: 'The standard game: solid pros, a few stars, real choices.',
    budget: 100,
    curated: [45, 85],
    quality: [50, 66],
    bench: [42, 54],
    benchShare: 0.35,
    teams: {
      america: [
        { name: 'Denver Peaks', abbr: 'DEN' },
        { name: 'Seattle Squalls', abbr: 'SEA' },
        { name: 'Phoenix Mirages', abbr: 'PHX' },
        { name: 'Atlanta Peaches', abbr: 'ATL' },
        { name: 'San Francisco Trolleys', abbr: 'SFO' },
        { name: 'Washington Monuments', abbr: 'WAS' },
        { name: 'Detroit Gears', abbr: 'DET' },
        { name: 'Minneapolis Voyagers', abbr: 'MIN' },
      ],
      europe: [
        { name: 'Valencia Oranges', abbr: 'VAL' },
        { name: 'Bologna Porticos', abbr: 'BOL' },
        { name: 'Vitoria Foxes', abbr: 'VIT' },
        { name: 'Lyon Larks', abbr: 'LYO' },
        { name: 'Munich Alpines', abbr: 'MUN' },
        { name: 'Berlin Sparrows', abbr: 'BER' },
        { name: 'Vilnius Storks', abbr: 'VIL' },
        { name: 'Zagreb Kites', abbr: 'ZAG' },
      ],
    },
  },
  legends: {
    id: 'legends',
    name: 'Legends League',
    blurb: 'Star-studded: the famous names, and the budget to sign them.',
    budget: 130,
    curated: [0, 45],
    quality: [60, 74],
    bench: [46, 58],
    benchShare: 0.45,
    teams: {
      america: [
        { name: 'Los Angeles Palms', abbr: 'LAP' },
        { name: 'New York Skyliners', abbr: 'NYS' },
        { name: 'Chicago Gales', abbr: 'CHI' },
        { name: 'Boston Lanterns', abbr: 'BOS' },
        { name: 'Houston Orbits', abbr: 'HOU' },
        { name: 'Philadelphia Bells', abbr: 'PHI' },
        { name: 'Miami Flamingos', abbr: 'MIA' },
        { name: 'Dallas Lassos', abbr: 'DAL' },
      ],
      europe: [
        { name: 'Madrid Meteors', abbr: 'MAD' },
        { name: 'Barcelona Breakers', abbr: 'BCN' },
        { name: 'Istanbul Crescents', abbr: 'IST' },
        { name: 'Athens Owls', abbr: 'ATH' },
        { name: 'Belgrade Kestrels', abbr: 'BEL' },
        { name: 'Milan Herons', abbr: 'MIL' },
        { name: 'Kaunas Ambers', abbr: 'KAU' },
        { name: 'Paris Swifts', abbr: 'PAR' },
      ],
    },
  },
};

/** The hand-made players (no generated ones), best first. */
function curatedByOverall(): PoolPlayer[] {
  return [...curatedPlayers()].sort((a, b) => composite(b.player).overall - composite(a.player).overall || (a.player.id < b.player.id ? -1 : 1));
}

/** A league's name as shown: "Pro League · Europe" (older saves have no region: the name alone). */
export function leagueName(id: LeagueId, region?: Region): string {
  const name = LEAGUES[id]?.name ?? 'Quick League';
  return region ? `${name} · ${REGION_NAME[region]}` : name;
}

const cache = new Map<string, PoolPlayer[]>();

/** A league's player pool, the same every time for the same league (it is rebuilt from data, never saved). */
export function leaguePool(id: LeagueId): PoolPlayer[] {
  const hit = cache.get(id);
  if (hit) return hit;
  const def = LEAGUES[id];
  const curated = curatedByOverall().slice(def.curated[0], def.curated[1]);
  const usedNames = new Set(playerPool().map((p) => p.player.name));
  const usedIds = new Set(playerPool().map((p) => p.player.id));
  // Journeymen: first the positions short of the minimum, then round and round, to POOL_SIZE.
  const count: Record<Position, number> = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
  for (const p of curated) count[p.player.position]++;
  const positions: Position[] = [];
  for (const pos of POSITIONS) for (let k = count[pos]; k < MIN_PER_POSITION; k++) positions.push(pos);
  for (let i = 0; positions.length < POOL_SIZE - curated.length; i++) positions.push(POSITIONS[i % POSITIONS.length]);
  const seed = 0x1ea9 + POSITIONS.length * 977 + id.length * 31 + id.charCodeAt(0);
  // The bench share first (every other position in turn), then the rest at the league's level.
  const benchCount = Math.round(positions.length * def.benchShare);
  const benchPositions = positions.filter((_, i) => i % 2 === 0).slice(0, benchCount);
  const left = [...positions];
  for (const pos of benchPositions) left.splice(left.indexOf(pos), 1);
  const made = [
    ...journeymen(benchPositions.length, seed + 1, usedNames, { positions: benchPositions, quality: def.bench, usedIds }),
    ...journeymen(left.length, seed, usedNames, { positions: left, quality: def.quality, usedIds }),
  ];
  const pool = [...curated, ...made];
  if (new Set(pool.map((p) => slug(p.player.name))).size !== pool.length) throw new Error('leaguePool: duplicate ids');
  cache.set(id, pool);
  return pool;
}
