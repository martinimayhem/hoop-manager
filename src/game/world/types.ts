// The career world's data (WORLD_SPEC §14): clubs, players, colleges. Plain data, saved as it is.
// The engine's Player (ratings, height, position) is inside each WorldPlayer, so a club's squad goes
// into a match unchanged.

import type { Player } from '../../engine/types';
import type { Region } from '../league/leagues';

export type { Region };

/** 1 = the Big League (its America or Europe conference), 2–4 = Divisions 2–4 of that region. */
export type Tier = 1 | 2 | 3 | 4;
export const TIERS: Tier[] = [1, 2, 3, 4];

/** US clubs count in dollars, European clubs in euros (WORLD_SPEC §10.1). */
export type Currency = 'USD' | 'EUR';

export interface Contract {
  /** Per season, in the club's currency (whole units). */
  wage: number;
  /** Seasons left, this one included. */
  years: number;
  rookie?: boolean;
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

export type Origin =
  | { kind: 'college'; college: string }
  | { kind: 'academy'; club: string }
  | { kind: 'international' }
  /** One of the hand-made stars the world starts with. */
  | { kind: 'star' };

export type PlayerStatus = 'club' | 'free' | 'college' | 'academy';

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
  status: PlayerStatus;
  /** His club (status 'club', or 'academy': the club whose academy he is in). */
  club?: string;
  /** His college and year there, 1–4 (status 'college'). */
  college?: string;
  collegeYear?: number;
  contract?: Contract;
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
  tier: Tier;
  /** Primary and secondary colour. */
  colours: [string, string];
  arena: { name: string; capacity: number };
  /** 1–99. */
  reputation: number;
  /** Supporters, in thousands. */
  fans: number;
  currency: Currency;
  /** Per season, in the club's currency. */
  budget: { wages: number; transfers: number };
  /** 1–20: training centre, youth (academy in Europe, college scouting in America), medical centre. */
  facilities: { training: number; youth: number; medical: number };
  /** Player ids: the first team. */
  roster: string[];
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
  players: Record<string, WorldPlayer>;
  colleges: College[];
  /** Player ids without a club. */
  freeAgents: string[];
  /** The player's club and his name as manager (null until he picks one). */
  human: { club: string; manager?: string } | null;
}
