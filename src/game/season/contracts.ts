// Contracts running out (WORLD_SPEC §7.0) and what a player asks (§7.1), slice W2b.
//
// A player first rates a club he could join or stay at (interest: won't consider / reluctant /
// interested / keen, with the factor that helped or hurt most as the reason), then asks a wage:
// market wage × league pay level × age and potential × reputation × interest, within the limits.
// At the rollover contracts count down; one with no years left expires. Before the new season you
// offer new deals or let players go (contract screen), AI clubs re-sign their 10 best if they can,
// everyone else joins the free agents; you sign first (free-agent screen), then every AI club below
// 13 fills up, worst-placed club first, in two rounds and a minimum-wage fallback.

import { composite } from "../../engine/ratings";
import {
  BUYOUT_SCALE,
  buyoutYears,
  COUNTRY,
  fitMarket,
  payKey,
  type Level,
} from "../world/generate";
import {
  CAP,
  HARD_CEILING,
  MAX_CONTRACT,
  MIN_CONTRACT,
  tidy,
} from "../world/money";
import { clubById } from "../world/query";
import type {
  Contract,
  Morale,
  World,
  WorldClub,
  WorldPlayer,
} from "../world/types";
import { BL_AMERICA, BL_EUROPE } from "./post";
import type { SeasonArchive } from "./types";

// ---------------------------------------------------------------------------
// The numbers, in one place so they can be tuned (WORLD_SPEC §7.1, all "tune").

export const TUNING = {
  /** Interest: each factor's weight before the shifts. */
  weights: {
    prestige: 30,
    reputation: 20,
    success: 15,
    role: 15,
    facilities: 10,
    home: 5,
  },
  /** League prestige, 0–100. A European tier: this share of the country's fame. */
  prestige: {
    blA: 100,
    blE: 90,
    us2: 45,
    us3: 25,
    us4: 10,
    n1: 0.7,
    n2: 0.35,
  } as Record<Level, number>,
  /** Role at a club he'd join, by his rank there: starter (top 5), rotation (6–8), bench. */
  role: { starter: 100, rotation: 60, bench: 20 },
  /** Role at his own club, by last season's minutes a game: [at least, value]. */
  minutes: [
    [28, 100],
    [20, 70],
    [12, 40],
    [0, 10],
  ] as [number, number][],
  /** Facilities (training and medical, 1–20) to 0–100. */
  facilitiesScale: 5,
  /** His own club: morale, and loyalty × this. */
  morale: { "very low": -10, low: -5, okay: 0, good: 5, superb: 10 } as Record<
    Morale,
    number
  >,
  loyalty: 0.5,
  /** Weight shifts: under this age the role counts double; from this age success does. */
  youngUnder: 24,
  roleYoung: 2,
  oldFrom: 30,
  successOld: 2,
  /** Ambition at or above / at or below: league prestige × these. */
  ambitionHigh: 15,
  prestigeAmbitious: 1.5,
  ambitionLow: 6,
  prestigeContent: 0.5,
  /** What he requires: R = base + standing × this − per year over 30 + (ambition − 10) × this. */
  requireBase: 15,
  requireStanding: 0.65,
  requirePerYearOver30: 3,
  requireAmbition: 0.5,
  /** The league floor: standing − this − per year over 30. */
  floorBase: 55,
  floorPerYearOver30: 3,
  /** Interest bands around R. */
  wontBelow: -20,
  keenFrom: 10,
  /** Free agents nobody signed in the AI's first round lower R by this. */
  unsignedRelief: 10,
  /** Demand × by interest. */
  demand: { keen: 0.9, interested: 1, reluctant: 1.25 },
  /** Age and potential: under 25, × (1 + this × (potential − overall)), at most ageYoungMax. */
  youngUnder25: 0.02,
  ageYoungMax: 1.2,
  /** Over 30: × (1 − this × (age − 30)), at least ageOldMin. */
  oldPerYear: 0.05,
  ageOldMin: 0.6,
  /** Reputation: × (repBase + repSpan × reputation ÷ 99). */
  repBase: 0.85,
  repSpan: 0.3,
  /** Answering: from this share of his demand he asks for it; below it he says no. */
  askFrom: 0.85,
  /** AI clubs re-sign an expiring player only if he is among their best this many. */
  aiKeepBest: 10,
  /** Seasons in a new deal: cap system 1–5, budget system 1–3. */
  years: { cap: [1, 5], budget: [1, 3] } as Record<
    "cap" | "budget",
    [number, number]
  >,
};

/** A first team's size: every club starts a season with 13 (WORLD_SPEC §7.0). */
export const SQUAD = 13;

export type Interest = "wont" | "reluctant" | "interested" | "keen";
export const INTEREST_LABEL: Record<Interest, string> = {
  wont: "Won't consider",
  reluctant: "Reluctant",
  interested: "Interested",
  keen: "Keen",
};

type Factor = keyof typeof TUNING.weights | "own";

export interface InterestView {
  band: Interest;
  /** His rating of the club, 0–100 (and his own club's bonus). */
  score: number;
  /** What he requires (R). */
  require: number;
  /** The factor that helped or hurt most, in a line: "wants to win". */
  reason: string;
}

// ---------------------------------------------------------------------------
// What a player and a club are

const ovrCache = new WeakMap<object, number>();
/** Today's overall (cached on the engine player, which never changes within a season in W2b). */
export function ovr(wp: WorldPlayer): number {
  let v = ovrCache.get(wp.p);
  if (v === undefined) ovrCache.set(wp.p, (v = composite(wp.p).overall));
  return v;
}

const pctCache = new Map<string, number[]>();
/** Every player's overall in the world, sorted (for standing's percentile). */
function overalls(w: World): number[] {
  const key = `${w.seed}|${w.season}`;
  let list = pctCache.get(key);
  if (!list) {
    list = Object.values(w.players)
      .map(ovr)
      .sort((a, b) => a - b);
    if (pctCache.size > 4) pctCache.clear();
    pctCache.set(key, list);
  }
  return list;
}

/** Standing, 0–100: half his overall's percentile among all players in the world, half his reputation. */
export function standing(w: World, wp: WorldPlayer): number {
  const list = overalls(w);
  const o = ovr(wp);
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < o) lo = mid + 1;
    else hi = mid;
  }
  const pct = (100 * lo) / Math.max(1, list.length - 1);
  return 0.5 * Math.min(100, pct) + 0.5 * wp.reputation;
}

export const ageAt = (w: World, wp: WorldPlayer) => w.season - wp.born;

/** What he requires of a club (R). */
export function requirement(w: World, wp: WorldPlayer, relief = 0): number {
  const t = TUNING;
  return (
    t.requireBase +
    t.requireStanding * standing(w, wp) -
    t.requirePerYearOver30 * Math.max(0, ageAt(w, wp) - 30) +
    t.requireAmbition * (wp.personality.ambition - 10) -
    relief
  );
}

/** A club's level: Big League America or Europe, a US division, a national first or second tier. */
export function clubLevel(w: World, clubId: string): Level {
  const comps = w.competitions.filter((c) => c.clubs.includes(clubId));
  if (comps.some((c) => c.id === BL_AMERICA)) return "blA";
  if (comps.some((c) => c.id === BL_EUROPE)) return "blE";
  const league = comps.find(
    (c) => c.kind === "usDivision" || c.kind === "nationalLeague",
  );
  if (!league) return "n2";
  if (league.kind === "usDivision")
    return `us${Math.min(4, Math.max(2, league.tier))}` as Level;
  return league.tier === 1 ? "n1" : "n2";
}

const LEVEL_NAME: Record<Level, string> = {
  blA: "a Big League club",
  blE: "a Big League club",
  us2: "a Division 2 club",
  us3: "a Division 3 club",
  us4: "a Division 4 club",
  n1: "a national-league club",
  n2: "a second-tier club",
};

function prestigeOf(club: WorldClub, level: Level): number {
  const v = TUNING.prestige[level];
  return level === "n1" || level === "n2"
    ? v * (COUNTRY[club.country]?.fame ?? 60)
    : v;
}

/** The club's place in a finished table, 0 (last) to 100 (first); a title counts as first. */
function finishIn(
  arch: SeasonArchive,
  clubId: string,
  leagueIds: string[],
): number | null {
  for (const id of leagueIds) {
    const rows = arch.tables[id];
    const i = rows?.findIndex((r) => r[0] === clubId) ?? -1;
    if (!rows || i < 0) continue;
    if (arch.champions[id] === clubId) return 100;
    return rows.length > 1
      ? (100 * (rows.length - 1 - i)) / (rows.length - 1)
      : 100;
  }
  return null;
}

/** The leagues a club's success is read from: the Big League conferences first, then the divisions and national leagues. */
function leagueIds(w: World): string[] {
  const big = w.competitions
    .filter((c) => c.kind === "bigLeague")
    .map((c) => c.id);
  const rest = w.competitions
    .filter((c) => c.kind === "usDivision" || c.kind === "nationalLeague")
    .map((c) => c.id);
  return [...big, ...rest];
}

/** Per club, what doesn't depend on the player: computed once per step. */
interface ClubFacts {
  level: Level;
  prestige: number;
  success: number;
  facilities: number;
  /** First-team overalls, best first, by player id. */
  squad: { id: string; o: number }[];
  /** Last season's finish, 0 (last) to 100 (first), for the fill order. */
  finish: number;
}

/** A context for one offseason step: the club facts, cached. */
export class Market {
  private facts = new Map<string, ClubFacts>();
  private ids: string[];
  /** Each factor at an average club (what a reason is measured against). */
  readonly typical: Record<keyof typeof TUNING.weights, number>;
  constructor(public w: World) {
    this.ids = leagueIds(w);
    const n = Math.max(1, w.clubs.length);
    const avg = (f: (c: WorldClub) => number) => w.clubs.reduce((s, c) => s + f(c), 0) / n;
    this.typical = {
      prestige: avg((c) => prestigeOf(c, clubLevel(w, c.id))),
      reputation: avg((c) => c.reputation),
      success: 50,
      role: 50,
      facilities: avg((c) => ((c.facilities.training + c.facilities.medical) / 2) * TUNING.facilitiesScale),
      home: 0,
    };
  }
  /** After a signing: the club's squad changed. */
  touch(w: World, clubId: string) {
    this.w = w;
    this.facts.delete(clubId);
  }
  club(clubId: string): ClubFacts {
    let f = this.facts.get(clubId);
    if (f) return f;
    const w = this.w;
    const club = clubById(w, clubId)!;
    const level = clubLevel(w, clubId);
    const last = w.history?.[w.history.length - 1];
    const before = last ? finishIn(last, clubId, this.ids) : null;
    const p = w.play;
    // During a season: half last season, half the current table (only once games have been played).
    let now: number | null = null;
    if (p && p.phase !== "before") now = currentFinish(w, clubId, this.ids);
    const success =
      before === null
        ? (now ?? 50)
        : now === null
          ? before
          : (before + now) / 2;
    const squad = club.roster
      .map((id) => ({ id, o: ovr(w.players[id]) }))
      .sort((a, b) => b.o - a.o || (a.id < b.id ? -1 : 1));
    f = {
      level,
      prestige: prestigeOf(club, level),
      success,
      facilities:
        ((club.facilities.training + club.facilities.medical) / 2) *
        TUNING.facilitiesScale,
      squad,
      finish: before ?? 50,
    };
    this.facts.set(clubId, f);
    return f;
  }
}

/** This season's table so far (wins and losses in the regular season), 0–100. */
function currentFinish(w: World, clubId: string, ids: string[]): number | null {
  const p = w.play!;
  for (const comp of ids) {
    const c = w.competitions.find((x) => x.id === comp)!;
    if (!c.clubs.includes(clubId)) continue;
    const key = c.kind === "bigLeague" ? "big-league" : c.id;
    const rec = new Map<string, number>(c.clubs.map((id) => [id, 0]));
    let any = false;
    for (const g of p.games) {
      if (
        g.comp !== key ||
        g.stage ||
        !g.score ||
        !rec.has(g.home) ||
        !rec.has(g.away)
      )
        continue;
      any = true;
      const winner = g.score[0] > g.score[1] ? g.home : g.away;
      const loser = winner === g.home ? g.away : g.home;
      rec.set(winner, rec.get(winner)! + 1);
      rec.set(loser, rec.get(loser)! - 1);
    }
    if (!any) return null;
    const order = [...rec.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map((e) => e[0]);
    const i = order.indexOf(clubId);
    return order.length > 1
      ? (100 * (order.length - 1 - i)) / (order.length - 1)
      : 100;
  }
  return null;
}

/** His minutes a game last season (all competitions). */
export function lastMinutes(w: World, wp: WorldPlayer): number {
  const p = w.play;
  if (p && p.phase !== "before") {
    let games = 0;
    let seconds = 0;
    for (const t of Object.values(p.stats)) {
      const s = t[wp.p.id];
      if (s) {
        games += s[0];
        seconds += s[1];
      }
    }
    return games ? seconds / 60 / games : 0;
  }
  const c = wp.career?.find((e) => e.season === w.season - 1);
  return c && c.t[0] ? c.t[1] / 60 / c.t[0] : 0;
}

// ---------------------------------------------------------------------------
// Step 1: interest

/** The league floor (WORLD_SPEC §7.1): the lowest league prestige he will play at, standing − 55 − 3 × years over 30. */
export function leagueFloor(w: World, wp: WorldPlayer): number {
  return standing(w, wp) - TUNING.floorBase - TUNING.floorPerYearOver30 * Math.max(0, ageAt(w, wp) - 30);
}

/** Whether a league's prestige is under his floor. */
export function belowFloor(w: World, wp: WorldPlayer, prestige: number): boolean {
  return prestige < leagueFloor(w, wp);
}

const FLOOR_REASON: Record<Level, string> = {
  blA: "won't play at this level",
  blE: "won't play at this level",
  us2: "won't play in Division 2",
  us3: "won't play in Division 3",
  us4: "won't play in Division 4",
  n1: "won't play outside the Big League",
  n2: "won't play below a first-tier league",
};

export function interest(
  m: Market,
  wp: WorldPlayer,
  clubId: string,
  relief = 0,
): InterestView {
  const w = m.w;
  const t = TUNING;
  const f = m.club(clubId);
  const club = clubById(w, clubId)!;
  const own = wp.club === clubId && wp.status === "club";
  const age = ageAt(w, wp);
  const o = ovr(wp);
  // First the league floor: below it he won't consider the club, whatever else it offers.
  if (belowFloor(w, wp, f.prestige))
    return {
      band: "wont",
      score: 0,
      require: requirement(w, wp, relief),
      reason: FLOOR_REASON[f.level],
    };
  let role: number;
  if (own) {
    const mpg = lastMinutes(w, wp);
    role = t.minutes.find(([min]) => mpg >= min)![1];
  } else {
    const rank = 1 + f.squad.filter((s) => s.o > o && s.id !== wp.p.id).length;
    role =
      rank <= 5 ? t.role.starter : rank <= 8 ? t.role.rotation : t.role.bench;
  }
  const values: Record<keyof typeof t.weights, number> = {
    prestige: f.prestige,
    reputation: club.reputation,
    success: f.success,
    role,
    facilities: f.facilities,
    home: club.country === wp.nationality ? 100 : 0,
  };
  const weights = { ...t.weights };
  if (age < t.youngUnder) weights.role *= t.roleYoung;
  if (age >= t.oldFrom) weights.success *= t.successOld;
  if (wp.personality.ambition >= t.ambitionHigh)
    weights.prestige *= t.prestigeAmbitious;
  else if (wp.personality.ambition <= t.ambitionLow)
    weights.prestige *= t.prestigeContent;
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const keys = Object.keys(weights) as (keyof typeof t.weights)[];
  let score = keys.reduce((s, k) => s + (weights[k] * values[k]) / total, 0);
  // How far each factor pushed him from an average club: the reason is the one that pushed most.
  const push: [Factor, number][] = keys.map((k) => [
    k,
    (weights[k] * (values[k] - m.typical[k])) / total,
  ]);
  if (own) {
    const bonus = t.morale[wp.morale] + t.loyalty * wp.personality.loyalty;
    score += bonus;
    push.push(["own", bonus]);
  }
  const require = requirement(w, wp, relief);
  const band: Interest =
    score < require + t.wontBelow
      ? "wont"
      : score < require
        ? "reluctant"
        : score < require + t.keenFrom
          ? "interested"
          : "keen";
  const good = band === "keen" || band === "interested";
  const pick = push.reduce((best, x) =>
    good ? (x[1] > best[1] ? x : best) : x[1] < best[1] ? x : best,
  );
  return {
    band,
    score,
    require,
    reason: reasonFor(pick[0], good, band, f.level, own, wp),
  };
}

function reasonFor(
  k: Factor,
  good: boolean,
  band: Interest,
  level: Level,
  own: boolean,
  wp: WorldPlayer,
): string {
  switch (k) {
    case "prestige":
      if (good)
        return level === "blA" || level === "blE"
          ? "wants to play in the Big League"
          : "likes the league";
      return band === "wont"
        ? `won't consider ${LEVEL_NAME[level]}`
        : level === "blA" || level === "blE"
          ? "not sure about the club"
          : "wants to play at a higher level";
    case "reputation":
      return good ? "likes the club" : "doesn't rate the club";
    case "success":
      return good ? "wants to join a contender" : "wants to win";
    case "role":
      if (own) return good ? "happy with his minutes" : "wants more minutes";
      return good ? "would start here" : "wants a bigger role";
    case "facilities":
      return good ? "likes the facilities" : "doesn't like the facilities";
    case "home":
      return good ? "would love to come home" : "would rather play at home";
    case "own":
      return good
        ? wp.personality.loyalty >= 12
          ? "loyal to the club"
          : "happy at the club"
        : "unhappy at the club";
  }
}

// ---------------------------------------------------------------------------
// Step 2: demand

/** The market and pay levels: stored in the world; an older save gets them on first load. */
export function marketOf(w: World): NonNullable<World["market"]> {
  return w.market ?? fitMarket(w);
}

/** A club's minimum deal: the minimum contract (cap), or 1% of its budget. */
export function minimumDeal(club: WorldClub): number {
  return club.moneySystem === "cap" ? MIN_CONTRACT : tidy(club.budget * 0.01);
}

/** His yearly wage demand at this club (before rounding to the limits: see demand). */
export function demand(
  m: Market,
  wp: WorldPlayer,
  clubId: string,
  band: Interest,
): number {
  const w = m.w;
  const t = TUNING;
  const mk = marketOf(w);
  const club = clubById(w, clubId)!;
  const o = ovr(wp);
  const age = ageAt(w, wp);
  let x =
    Math.exp(mk.a + mk.b * o) * (mk.pay[payKey(w.competitions, clubId)] ?? 1);
  if (age < 25)
    x *= Math.min(
      t.ageYoungMax,
      1 + t.youngUnder25 * Math.max(0, wp.p.attrs.potential - o),
    );
  else if (age > 30) x *= Math.max(t.ageOldMin, 1 - t.oldPerYear * (age - 30));
  x *= t.repBase + (t.repSpan * wp.reputation) / 99;
  x *= band === "wont" ? t.demand.reluctant : t.demand[band];
  const lo = minimumDeal(club);
  return tidy(Math.max(lo, Math.min(MAX_CONTRACT, x)));
}

export type Answer = "yes" | "ask" | "no";

/** How he answers an offer: yes at or above his demand, asks for it from 85%, no below. */
export function answerTo(offer: number, ask: number): Answer {
  if (offer >= ask) return "yes";
  if (offer >= TUNING.askFrom * ask) return "ask";
  return "no";
}

// ---------------------------------------------------------------------------
// Money (WORLD_SPEC §7.0)

/** Wages promised for the coming season: the first team still under contract (and, budget clubs, the dev squad). */
export function committed(w: World, club: WorldClub, without?: string): number {
  let s = 0;
  for (const id of club.roster) {
    const c = w.players[id].contract;
    if (id !== without && c && c.years > 0) s += c.wage;
  }
  if (club.moneySystem === "budget")
    for (const id of club.dev) s += w.players[id].contract?.wage ?? 0;
  return s;
}

/**
 * Whether the club may pay this wage: cap clubs re-sign their own players up to the hard ceiling,
 * anyone else within the cap (or a minimum contract); budget clubs within the budget, or (already
 * over it) a minimum deal only. Never above the hard ceiling.
 */
export function canPay(
  w: World,
  club: WorldClub,
  wp: WorldPlayer,
  wage: number,
): boolean {
  const now = committed(w, club, wp.p.id);
  if (club.moneySystem === "cap") {
    if (now + wage > HARD_CEILING) return false;
    const own = wp.club === club.id && wp.status === "club";
    return own || now + wage <= CAP || wage <= MIN_CONTRACT;
  }
  return now + wage <= club.budget || wage <= minimumDeal(club);
}

/** What the club has left for wages (cap room, or budget room; negative when over). */
export function roomLeft(w: World, club: WorldClub): number {
  return (club.moneySystem === "cap" ? CAP : club.budget) - committed(w, club);
}

/** The seasons a new deal runs: by age, within the money system's limits. */
export function dealYears(w: World, club: WorldClub, wp: WorldPlayer): number {
  const age = ageAt(w, wp);
  const [lo, hi] = TUNING.years[club.moneySystem];
  const want = age <= 26 ? 4 : age <= 30 ? 3 : age <= 32 ? 2 : 1;
  return Math.max(lo, Math.min(hi, want));
}

/** A new contract: budget clubs add the buyout fee (GAME_FLOW §4.2). */
export function newContract(
  w: World,
  club: WorldClub,
  wp: WorldPlayer,
  wage: number,
  years: number,
): Contract {
  if (club.moneySystem === "cap") return { wage, years };
  const level = clubLevel(w, club.id) as Exclude<Level, "blA">;
  const squad = club.roster.map((id) => ovr(w.players[id]));
  const mean = squad.reduce((a, b) => a + b, 0) / Math.max(1, squad.length);
  const ageF = Math.max(0.4, Math.min(1.7, 1.7 - (ageAt(w, wp) - 20) * 0.09));
  const qualF = Math.max(0.6, Math.min(1.4, 1 + (ovr(wp) - mean) / 15));
  return {
    wage,
    years,
    buyout: tidy(
      wage * buyoutYears(years) * ageF * qualF * (BUYOUT_SCALE[level] ?? 1),
    ),
  };
}

// ---------------------------------------------------------------------------
// The offseason (WORLD_SPEC §7.0)

/** A talk with one of your expiring players, or with a free agent: your last offer and his answer. */
export interface Talk {
  wage: number;
  years: number;
  answer: Answer;
  reason: string;
}

export interface Offseason {
  /** contracts: your expiring players (contract screen); free: the free-agent screen. */
  step: "contracts" | "free";
  /** Your expiring players you let go. */
  letGo: string[];
  /** Your last offer to each player, and his answer. */
  talks: Record<string, Talk>;
}

/** What happened in the AI's steps (for the headless checks). */
export interface OffseasonReport {
  resigned: number;
  left: number;
  signings: {
    player: string;
    club: string;
    standing: number;
    level: Level;
    wage: number;
    round: 1 | 2 | 3;
  }[];
  /** Signings that had to ignore interest to reach 13 (should stay 0). */
  forced: number;
  /** Of the 100 best free agents when free agency opened, how many signed. */
  top100Signed: number;
}

/** Your players whose contract has no years left (first team). */
export function expiring(w: World, clubId: string): WorldPlayer[] {
  const club = clubById(w, clubId)!;
  return club.roster
    .map((id) => w.players[id])
    .filter((wp) => (wp.contract?.years ?? 0) <= 0);
}

/** Your players in the last year of their contract (the inbox at the end of the regular season). */
export function inLastYear(w: World, clubId: string): WorldPlayer[] {
  const club = clubById(w, clubId)!;
  return club.roster
    .map((id) => w.players[id])
    .filter((wp) => (wp.contract?.years ?? 0) === 1);
}

/** At the rollover: every first-team contract counts down (dev squads roll on unchanged). */
export function countDown(w: World): World {
  const players = { ...w.players };
  for (const club of w.clubs)
    for (const id of club.roster) {
      const wp = players[id];
      if (wp.contract)
        players[id] = {
          ...wp,
          contract: { ...wp.contract, years: wp.contract.years - 1 },
        };
    }
  return { ...w, players };
}

function setOff(w: World, o: Offseason | undefined): World {
  const p = w.play!;
  const play = { ...p };
  if (o) play.offseason = o;
  else delete play.offseason;
  return { ...w, play };
}

export const offseasonOf = (w: World): Offseason | undefined =>
  w.play?.offseason;

/** Sign a player to a club (a re-signing or a free agent): squads, statuses, free agents. */
function sign(
  w: World,
  wp: WorldPlayer,
  clubId: string,
  contract: Contract,
): World {
  const id = wp.p.id;
  const players = {
    ...w.players,
    [id]: { ...wp, status: "club" as const, club: clubId, contract },
  };
  const clubs = w.clubs.map((c) =>
    c.id === clubId && !c.roster.includes(id)
      ? { ...c, roster: [...c.roster, id] }
      : c,
  );
  return {
    ...w,
    players,
    clubs,
    freeAgents: w.freeAgents.filter((x) => x !== id),
  };
}

/** A player leaves his club for the free agents. */
function release(w: World, ids: string[]): World {
  if (!ids.length) return w;
  const out = new Set(ids);
  const players = { ...w.players };
  for (const id of ids) {
    const wp = players[id];
    const rest = { ...wp, status: "free" as const };
    delete rest.club;
    delete rest.contract;
    players[id] = rest;
  }
  const clubs = w.clubs.map((c) =>
    c.roster.some((id) => out.has(id))
      ? { ...c, roster: c.roster.filter((id) => !out.has(id)) }
      : c,
  );
  return {
    ...w,
    players,
    clubs,
    freeAgents: [
      ...w.freeAgents,
      ...ids.filter((id) => !w.freeAgents.includes(id)),
    ],
  };
}

/** The offseason opens (at the rollover): your contract screen first. */
export function openOffseason(w: World): World {
  return setOff(w, { step: "contracts", letGo: [], talks: {} });
}

/** What a player would answer, and why, before you send it (the screen shows it as you change the offer). */
export interface Prospect {
  interest: InterestView;
  demand: number;
  /** Whether your club may pay what he asks (and the offer). */
  affordable: boolean;
}

export function prospect(m: Market, wp: WorldPlayer, clubId: string): Prospect {
  const i = interest(m, wp, clubId);
  const d = demand(m, wp, clubId, i.band);
  return {
    interest: i,
    demand: d,
    affordable: canPay(m.w, clubById(m.w, clubId)!, wp, d),
  };
}

/** His answer to an offer, with its reason. */
export function judge(
  m: Market,
  wp: WorldPlayer,
  clubId: string,
  wage: number,
): { answer: Answer; reason: string; demand: number } {
  const p = prospect(m, wp, clubId);
  const club = clubById(m.w, clubId)!;
  if (p.interest.band === "wont")
    return { answer: "no", reason: p.interest.reason, demand: p.demand };
  if (!canPay(m.w, club, wp, wage))
    return {
      answer: "no",
      reason: "the club can't afford him",
      demand: p.demand,
    };
  const a = answerTo(wage, p.demand);
  if (a === "yes")
    return {
      answer: a,
      reason:
        p.interest.band === "reluctant"
          ? "happy with the money"
          : p.interest.reason,
      demand: p.demand,
    };
  if (a === "ask")
    return { answer: a, reason: "wants more money", demand: p.demand };
  return {
    answer: a,
    reason:
      p.interest.band === "reluctant" ? p.interest.reason : "wants more money",
    demand: p.demand,
  };
}

/** Your offer to a player (one of your expiring players, or a free agent): signed if he says yes. */
export function offer(
  w: World,
  playerId: string,
  wage: number,
  years: number,
): { w: World; talk: Talk } {
  const o = offseasonOf(w);
  const me = w.human!.club;
  const club = clubById(w, me)!;
  const wp = w.players[playerId];
  if (!o) throw new Error("Not the offseason");
  const [lo, hi] = TUNING.years[club.moneySystem];
  const y = Math.max(lo, Math.min(hi, Math.round(years)));
  const isFree = wp.status === "free";
  if (isFree && club.roster.length >= SQUAD)
    return {
      w,
      talk: { wage, years: y, answer: "no", reason: "your squad is full (13)" },
    };
  const m = new Market(w);
  const j = judge(m, wp, me, wage);
  const talk: Talk = { wage, years: y, answer: j.answer, reason: j.reason };
  let next = w;
  if (j.answer === "yes")
    next = sign(w, wp, me, newContract(w, club, wp, wage, y));
  next = setOff(next, {
    ...o,
    talks: { ...o.talks, [playerId]: talk },
    letGo: o.letGo.filter((id) => id !== playerId),
  });
  return { w: next, talk };
}

/** Let one of your expiring players go (or take that back). */
export function letGo(w: World, playerId: string, go = true): World {
  const o = offseasonOf(w)!;
  return setOff(w, {
    ...o,
    letGo: go
      ? [...new Set([...o.letGo, playerId])]
      : o.letGo.filter((id) => id !== playerId),
  });
}

/**
 * The contract screen is done: your undecided players leave too; AI clubs re-sign an expiring player
 * if he is among their 10 best, would consider staying and his demand fits their money; everyone
 * else joins the free agents. On to the free-agent screen.
 */
export function closeContracts(w: World, report?: OffseasonReport): World {
  const me = w.human?.club;
  const leave: string[] = me ? expiring(w, me).map((wp) => wp.p.id) : [];
  let cur = w;
  const m = new Market(cur);
  for (const club of w.clubs) {
    if (club.id === me) continue;
    const ex = club.roster
      .map((id) => w.players[id])
      .filter((wp) => (wp.contract?.years ?? 0) <= 0);
    if (!ex.length) continue;
    const best = new Set(
      m
        .club(club.id)
        .squad.slice(0, TUNING.aiKeepBest)
        .map((s) => s.id),
    );
    // The best first, so the money goes to them.
    for (const wp of [...ex].sort(
      (a, b) => ovr(b) - ovr(a) || (a.p.id < b.p.id ? -1 : 1),
    )) {
      const c = clubById(cur, club.id)!;
      const p = prospect(m, cur.players[wp.p.id], club.id);
      if (
        best.has(wp.p.id) &&
        p.interest.band !== "wont" &&
        canPay(cur, c, cur.players[wp.p.id], p.demand)
      ) {
        cur = sign(
          cur,
          cur.players[wp.p.id],
          club.id,
          newContract(cur, c, wp, p.demand, dealYears(cur, c, wp)),
        );
        if (report) report.resigned++;
      } else leave.push(wp.p.id);
    }
  }
  if (report) report.left += leave.length;
  cur = release(cur, leave);
  const o = offseasonOf(cur) ?? {
    step: "contracts" as const,
    letGo: [],
    talks: {},
  };
  return setOff(cur, { ...o, step: "free", talks: {} });
}

/** How many players your club still has to sign before the season can start. */
export function shortOf(w: World, clubId: string): number {
  return Math.max(0, SQUAD - clubById(w, clubId)!.roster.length);
}

/** Free agents, best first. */
export function freeAgentsBest(w: World): WorldPlayer[] {
  return w.freeAgents
    .map((id) => w.players[id])
    .sort((a, b) => ovr(b) - ovr(a) || (a.p.id < b.p.id ? -1 : 1));
}

/** One club signs the best free agent it can (at his demand), or, as a fallback, the best who'd consider it at the minimum deal. */
function signOne(
  m: Market,
  clubId: string,
  relief: number,
  round: 1 | 2 | 3,
  report?: OffseasonReport,
  pool?: WorldPlayer[],
): boolean {
  const w = m.w;
  const club = clubById(w, clubId)!;
  const list = pool ?? freeAgentsBest(w);
  // The fallback (owner, 21 Nov 2026): at the minimum deal, the free agent who asks least of those who
  // would consider the club (the better one when two ask the same), never the best one.
  const pick = round === 3 ? cheapest(m, club, list, relief) : null;
  for (const wp of pick ? [pick] : round === 3 ? [] : list) {
    if (wp.status !== "free") continue;
    const i = interest(m, wp, clubId, relief);
    if (i.band === "wont") continue;
    const d = round === 3 ? minimumDeal(club) : demand(m, wp, clubId, i.band);
    if (!canPay(w, club, wp, d)) continue;
    const next = sign(
      w,
      wp,
      clubId,
      newContract(w, club, wp, d, dealYears(w, club, wp)),
    );
    if (report)
      report.signings.push({
        player: wp.p.id,
        club: clubId,
        standing: standing(w, wp),
        level: m.club(clubId).level,
        wage: d,
        round,
      });
    m.touch(next, clubId);
    return true;
  }
  return false;
}

/** The free agent who asks this club least (of those who would consider it), the better one on a tie. */
function cheapest(m: Market, club: WorldClub, list: WorldPlayer[], relief: number): WorldPlayer | null {
  let best: WorldPlayer | null = null;
  let low = Infinity;
  for (const wp of list) {
    if (wp.status !== "free") continue;
    const i = interest(m, wp, club.id, relief);
    if (i.band === "wont") continue;
    const d = demand(m, wp, club.id, i.band);
    // The list is best first: a later player with the same demand is not better.
    if (d < low && canPay(m.w, club, wp, minimumDeal(club))) {
      low = d;
      best = wp;
    }
  }
  return best;
}

/** The fill order: last place in its league first, then second-last…; a lower level before a higher at the same place. */
function fillOrder(m: Market, ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const fa = m.club(a);
    const fb = m.club(b);
    return (
      fa.finish - fb.finish || fa.prestige - fb.prestige || (a < b ? -1 : 1)
    );
  });
}

/** Clubs fill up to 13: round 1 at demand, round 2 with free agents' requirement lowered, then minimum deals. */
function fill(w: World, clubIds: string[], report?: OffseasonReport): World {
  const m = new Market(w);
  const order = fillOrder(m, clubIds);
  for (const round of [1, 2, 3] as const) {
    const relief = round === 1 ? 0 : TUNING.unsignedRelief;
    for (;;) {
      let any = false;
      for (const id of order) {
        if (clubById(m.w, id)!.roster.length >= SQUAD) continue;
        if (signOne(m, id, relief, round, report)) any = true;
      }
      if (!any) break;
    }
  }
  // Last resort (never expected): ignore interest so every club has 13.
  let cur = m.w;
  for (const id of order) {
    while (clubById(cur, id)!.roster.length < SQUAD) {
      const wp = freeAgentsBest(cur).at(-1);
      if (!wp) break;
      const club = clubById(cur, id)!;
      cur = sign(cur, wp, id, newContract(cur, club, wp, minimumDeal(club), 1));
      if (report) report.forced++;
    }
  }
  return cur;
}

/** Auto-fill (your free-agent screen): the best free agents your club can afford, until 13. */
export function autoFill(w: World): World {
  const me = w.human!.club;
  return fill(w, [me]);
}

/**
 * The free-agent screen is done (you have 13): every AI club below 13 fills up, worst-placed first,
 * and the offseason is over.
 */
export function closeFreeAgency(w: World, report?: OffseasonReport): World {
  const me = w.human?.club;
  if (me && shortOf(w, me) > 0)
    throw new Error(`Sign ${shortOf(w, me)} more players`);
  const top = new Set(
    freeAgentsBest(w)
      .slice(0, 100)
      .map((wp) => wp.p.id),
  );
  const ids = w.clubs
    .filter((c) => c.id !== me && c.roster.length < SQUAD)
    .map((c) => c.id);
  const cur = fill(w, ids, report);
  if (report)
    report.top100Signed = [...top].filter(
      (id) => cur.players[id].status === "club",
    ).length;
  return setOff(cur, undefined);
}

/** The whole offseason without you (headless runs, tests): your expiring players leave and Auto-fill signs for you. */
export function autoOffseason(w: World): { w: World; report: OffseasonReport } {
  const report: OffseasonReport = {
    resigned: 0,
    left: 0,
    signings: [],
    forced: 0,
    top100Signed: 0,
  };
  // Your club decides as an AI club would.
  let cur: World = { ...(offseasonOf(w) ? w : openOffseason(w)), human: null };
  if (offseasonOf(cur)!.step === "contracts") cur = closeContracts(cur, report);
  cur = closeFreeAgency(cur, report);
  return { w: { ...cur, human: w.human }, report };
}
