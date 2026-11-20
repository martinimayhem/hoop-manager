// The career world's data (WORLD_SPEC §14, slice brief W1): clubs, competitions, players, colleges.
// Plain data, saved as it is. The engine's Player (ratings, height, position) is inside each
// WorldPlayer, so a club's squad goes into a match unchanged.

import type { Player } from '../../engine/types';
import type { SeasonArchive, SeasonPlay } from '../season/types';

/** America and Europe: movement between clubs' leagues stays inside a region (WORLD_SPEC §1.2). */
export type Region = 'america' | 'europe';
export const REGIONS: Region[] = ['america', 'europe'];
export const REGION_NAME: Record<Region, string> = { america: 'America', europe: 'Europe' };

/**
 * Cap: the America Big League clubs (salary cap, "NBA-lite"). Budget: everyone else (one club
 * budget, buyouts). GAME_FLOW §4.
 */
export type MoneySystem = 'cap' | 'budget';

/** A Big League Europe place: one of the 10 licences, one of this season's 2 wildcards, or neither. */
export type Licence = 'licence' | 'wildcard' | null;

export type CompetitionKind = 'bigLeague' | 'usDivision' | 'nationalLeague' | 'cup';

export interface Competition {
  id: string;
  /** "Big League · Europe", "US Division 3", "Spanish League 2". */
  name: string;
  kind: CompetitionKind;
  region: Region;
  /** ISO code, for national leagues (and, from W2, national cups). */
  country?: string;
  /** 1 = the top of its pyramid (Big League; a country's first tier), up to 4 (US Division 4). */
  tier: number;
  /** Club ids. */
  clubs: string[];
}

export interface Contract {
  /** Per season, in dollars. */
  wage: number;
  /** Seasons left, this one included. */
  years: number;
  /** A rookie-scale contract (cap clubs). */
  rookie?: boolean;
  /** Budget-system contracts: what another club pays to release him (GAME_FLOW §4.2). */
  buyout?: number;
}

/** 1–20 each (WORLD_SPEC §2). */
export interface Personality {
  /** Speeds growth, slows decline. */
  professionalism: number;
  /** Pushes for minutes, wants a bigger club. */
  ambition: number;
  /** Stays at his club. */
  loyalty: number;
  /** Keeps his head (low: technical fouls, arguments). */
  temperament: number;
}

export type Morale = 'very low' | 'low' | 'okay' | 'good' | 'superb';
export const MORALES: Morale[] = ['very low', 'low', 'okay', 'good', 'superb'];

/** A promise made to a player (WORLD_SPEC §2.1). None are made in W1. */
export interface PlayerPromise {
  kind: 'playingTime' | 'role';
  /** "starter", "rotation", "first option on offence". */
  what: string;
  /** The season it was made in. */
  season: number;
}

export type Origin =
  | { kind: 'college'; college: string }
  | { kind: 'academy'; club: string }
  | { kind: 'international' }
  /** One of the hand-made stars the world starts with. */
  | { kind: 'star' };

/** club: first team; dev: development squad; academy: a European club's academy. */
export type PlayerStatus = 'club' | 'dev' | 'free' | 'college' | 'academy';

export interface WorldPlayer {
  /** The engine's player: ratings, position, height. `p.attrs.potential` is his ceiling (best overall he can reach). */
  p: Player;
  /** Year of birth. */
  born: number;
  /** ISO country code. */
  nationality: string;
  hometown: string;
  origin: Origin;
  personality: Personality;
  /** 1–99: how well known he is (wage demands, interest, how easy he is to scout). */
  reputation: number;
  morale: Morale;
  promises: PlayerPromise[];
  status: PlayerStatus;
  /** His club (status 'club', 'dev' or 'academy'). */
  club?: string;
  /** His college and year there, 1–4 (status 'college'). */
  college?: string;
  collegeYear?: number;
  contract?: Contract;
  /** Seasons gone by (slice W2b): the season, his club, games played then STAT_KEYS (all competitions). */
  career?: { season: number; club: string; t: number[] }[];
}

export interface WorldClub {
  id: string;
  city: string;
  country: string;
  state?: string;
  nickname: string;
  /** "Kaunas Ambers". */
  name: string;
  abbr: string;
  region: Region;
  /** Primary and secondary colour. */
  colours: [string, string];
  arena: { name: string; capacity: number };
  /** 1–99. */
  reputation: number;
  /** Supporters, in thousands. */
  fans: number;
  moneySystem: MoneySystem;
  /** Budget clubs: the club budget for this season (wages, staff, buyouts), in dollars. Cap clubs: 0. */
  budget: number;
  /** Cap clubs: what is left of this season's mid-level exception, in dollars. Budget clubs: 0. */
  midLevelLeft: number;
  /** European clubs only: a Big League Europe licence or wildcard. */
  licence: Licence;
  /** Bottom-2 finishes in the Big League Europe over the last 5 seasons (a licence is lost at the third). */
  bottomTwoFinishes: number;
  /** The seasons of those finishes (slice W2b). */
  bottomTwoSeasons?: number[];
  /** After dropping a tier (or out of the Big League): the budget it lost, and how many seasons of help are left (WORLD_SPEC §1.2: 50%, then 25%). */
  parachute?: { gap: number; seasons: number };
  /** 1–20: training centre, youth (academy in Europe, college scouting in America), medical centre. */
  facilities: { training: number; youth: number; medical: number };
  /** Player ids: the first team (13). */
  roster: string[];
  /** Player ids: the development squad (0–5). */
  dev: string[];
  /** Player ids: the academy (European clubs only). */
  academy: string[];
}

export interface College {
  id: string;
  name: string;
  city: string;
  state: string;
  /** 1 (best) to 5. */
  level: number;
  players: string[];
}

export interface World {
  kind: 'world';
  seed: number;
  /** The season under way: the year it starts in (2026 = 2026–27). */
  season: number;
  clubs: WorldClub[];
  competitions: Competition[];
  players: Record<string, WorldPlayer>;
  colleges: College[];
  /** Player ids without a club. */
  freeAgents: string[];
  /** Your club and your name as manager (null until you pick one). */
  human: { club: string; manager?: string } | null;
  /** The season being played (slice W2a): its schedule, results, totals and your plan. */
  play?: SeasonPlay;
  /** Seasons gone by (slice W2b). */
  history?: SeasonArchive[];
}
