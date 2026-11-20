// The postseason and the cups (slice brief W2b §1–§5, WORLD_SPEC §1.1).
//
// Knockout rounds are made as the season goes: when a competition's regular season is over, its
// play-in or first round; when a round is decided, the next. Every series is laid out whole when it is
// made (best-of-7: seven dates); games a series no longer needs are marked off. Cups are drawn round by
// round on fixed dates.
//
// The calendar (§3): no club plays twice on a day and every club has a day between games. The Big
// League's postseason has fixed dates; the national playoffs are fitted round them for the European
// clubs still in both (the national league waits), and the national finals come after the Europe Final
// Four. Cup rounds are on the weekends the regular season keeps free; the Final Four weekends (Friday
// semi-finals, Sunday final) in week 29, the last third of the regular season.
//
// Everything is decided by the world's seed: the same season gives the same draws, dates and games.

import { createRng, next } from '../../engine/rng';
import { clubById, competitionsOf, strength } from '../world/query';
import type { Competition, World } from '../world/types';
import { SAT, WED, dayOf, shortDate } from './calendar';
import { bigLeagueDays, mix } from './schedule';
import { BIG_LEAGUE, type Moment, type SeasonGame, type SeasonPlay, type Tie } from './types';

export const BL_AMERICA = 'big-league-america';
export const BL_EUROPE = 'big-league-europe';
export const BL_FINAL = 'big-league-final';

// ---------------------------------------------------------------------------
// The competitions' knockout formats

export const ROUND_NAME: Record<string, string> = {
  'playin-a': 'Play-in',
  'playin-b': 'Play-in, last place',
  r1: 'First round',
  r2: 'Conference semi-finals',
  cf: 'Conference final',
  qf: 'Quarter-finals',
  sf: 'Semi-finals',
  final: 'Final',
  ff: 'Final Four',
  'ff-final': 'Final Four: the final',
  prelim: 'Preliminary round',
  r64: 'Round of 64',
  r32: 'Round of 32',
  r16: 'Last 16',
  cr1: 'First round',
  promo: 'Promotion playoff',
  'promo-final': 'Promotion playoff final',
  'bl-final': 'Big League Final',
};

/** Home order in a series: true where the better-placed club is at home (2-2-1-1-1, 2-2-1, 1-1-1). */
export function homeOrder(bestOf: number): boolean[] {
  if (bestOf === 7) return [true, true, false, false, true, false, true];
  if (bestOf === 5) return [true, true, false, false, true];
  if (bestOf === 3) return [true, false, true];
  return [true];
}

// ---------------------------------------------------------------------------
// The fixed Big League dates (days from the season's first day)

/** The first Saturday after the Big League's regular season: the play-in. */
export function postStart(): number {
  const last = Math.max(...bigLeagueDays());
  let d = last + 1;
  while (d % 7 !== SAT) d++;
  return d;
}

/** The Big League's postseason dates, by conference and round: a game every other day. */
export function bigLeagueDates(): Record<string, number[]> {
  const p = postStart();
  const every = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + 2 * i);
  // The Europe Final Four: the first Friday with a free day after the quarter-finals; the final on Sunday.
  const qfEnd = p + 4 + 2 * 4;
  let fri = qfEnd + 2;
  while (fri % 7 !== 6) fri++;
  return {
    [`${BL_AMERICA}|playin-a`]: [p],
    [`${BL_AMERICA}|playin-b`]: [p + 2],
    [`${BL_AMERICA}|r1`]: every(p + 4, 7),
    [`${BL_AMERICA}|r2`]: every(p + 18, 7),
    [`${BL_AMERICA}|cf`]: every(p + 32, 7),
    [`${BL_EUROPE}|playin-a`]: [p],
    [`${BL_EUROPE}|playin-b`]: [p + 2],
    [`${BL_EUROPE}|qf`]: every(p + 4, 5),
    [`${BL_EUROPE}|ff`]: [fri],
    [`${BL_EUROPE}|ff-final`]: [fri + 2],
  };
}

// ---------------------------------------------------------------------------
// Cups: who enters where, and the fixed dates

export interface Cup {
  id: string;
  name: string;
  region: 'america' | 'europe';
  country?: string;
  clubs: string[];
  /** The rounds, in order, with their dates; the first round's entrants and who joins later. */
  rounds: { key: string; day: number; fri?: true }[];
}

/** Cup dates: Saturday of a cup weekend; the Final Four's semi-finals the Friday before week 29, the final its Sunday. */
const CUP_DAY = (week: number) => dayOf(week, SAT);
export const FF_SEMIS = dayOf(29, SAT) - 1;
export const FF_FINAL = dayOf(29, SAT) + 1;

const COUNTRY_CUP: Record<string, string> = {
  ES: 'Spanish Cup',
  TR: 'Turkish Cup',
  GR: 'Greek Cup',
  IT: 'Italian Cup',
  FR: 'French Cup',
  DE: 'German Cup',
  IL: 'Israeli Cup',
  LT: 'Lithuanian Cup',
  RS: 'Serbian Cup',
  NL: 'Dutch Cup',
  PT: 'Portuguese Cup',
};

/** The world's cups: the America Cup (all 66 American clubs) and one per European country. */
export function cupsOf(w: World): Cup[] {
  const america = w.competitions.filter((c) => c.region === 'america' && (c.kind === 'usDivision' || (c.kind === 'bigLeague' && c.region === 'america')));
  const out: Cup[] = [
    {
      id: 'cup-america',
      name: 'America Cup',
      region: 'america',
      clubs: america.flatMap((c) => c.clubs),
      rounds: [
        { key: 'prelim', day: dayOf(3, WED) },
        { key: 'r64', day: CUP_DAY(5) },
        { key: 'r32', day: CUP_DAY(11) },
        { key: 'r16', day: CUP_DAY(17) },
        { key: 'qf', day: CUP_DAY(23) },
        { key: 'ff', day: FF_SEMIS, fri: true },
        { key: 'ff-final', day: FF_FINAL },
      ],
    },
  ];
  const countries = [...new Set(w.competitions.filter((c) => c.kind === 'nationalLeague').map((c) => c.country!))];
  for (const cc of countries) {
    const leagues = w.competitions.filter((c) => c.kind === 'nationalLeague' && c.country === cc);
    const clubs = leagues.flatMap((c) => c.clubs);
    const pt = leagues.length === 1;
    out.push({
      id: `cup-${cc.toLowerCase()}`,
      name: COUNTRY_CUP[cc] ?? `${cc} Cup`,
      region: 'europe',
      country: cc,
      clubs,
      rounds: pt
        ? [
            { key: 'cr1', day: CUP_DAY(17) },
            { key: 'qf', day: CUP_DAY(23) },
            { key: 'ff', day: FF_SEMIS, fri: true },
            { key: 'ff-final', day: FF_FINAL },
          ]
        : [
            { key: 'cr1', day: CUP_DAY(11) },
            { key: 'r16', day: CUP_DAY(17) },
            { key: 'qf', day: CUP_DAY(23) },
            { key: 'ff', day: FF_SEMIS, fri: true },
            { key: 'ff-final', day: FF_FINAL },
          ],
    });
  }
  return out;
}

export const cupById = (w: World, id: string) => cupsOf(w).find((c) => c.id === id);

/** A club's tier for the cups: the Big League and national first tiers 1, US Division n: n, national second tiers 2. */
export function tierOf(w: World, clubId: string): number {
  const league = competitionsOf(w, clubId)[0];
  if (!league) return 9;
  return league.kind === 'bigLeague' ? 1 : league.tier;
}

/**
 * How a club ranks for its cup's entry (best first): a higher tier first, then last season's final
 * position in its league (a club new to the league after those already in it); in the world's first
 * season, squad strength.
 */
function cupRank(w: World, clubs: string[]): string[] {
  const last = w.history?.[w.history.length - 1];
  const key = (c: string): number => {
    const tier = tierOf(w, c);
    const league = competitionsOf(w, c)[0];
    const rows = last && league ? last.tables[league.id] : undefined;
    const pos = rows ? rows.findIndex((r) => r[0] === c) : -1;
    if (pos >= 0) return tier * 1000 + pos;
    return tier * 1000 + 500 - strength(w, clubById(w, c)!);
  };
  return [...clubs].sort((a, b) => key(a) - key(b) || (a < b ? -1 : 1));
}
/** Who enters a cup's first round, and who joins at which later round. */
export function cupEntries(w: World, cup: Cup): { first: string[]; joins: Record<string, string[]> } {
  const ranked = cupRank(w, cup.clubs);
  if (cup.id === 'cup-america') {
    // The 4 lowest-placed Division 4 clubs play the preliminary round; everyone else joins in the round of 64.
    const d4 = w.competitions.find((c) => c.id === 'us-division-4');
    const fourth = ranked.filter((c) => d4?.clubs.includes(c));
    const prelim = fourth.slice(-4);
    return { first: prelim, joins: { r64: ranked.filter((c) => !prelim.includes(c)) } };
  }
  if (cup.rounds[0].key === 'cr1' && cup.rounds[1].key === 'qf') {
    // Portugal (12): the 8 lowest in round 1, the top 4 join in the quarter-finals.
    return { first: ranked.slice(4), joins: { qf: ranked.slice(0, 4) } };
  }
  // A national cup (24): round 1 for the 16 lowest; the 8 best first-tier clubs join in the last 16.
  const tier1 = ranked.filter((c) => tierOf(w, c) === 1).slice(0, 8);
  return { first: ranked.filter((c) => !tier1.includes(c)), joins: { r16: tier1 } };
}

// ---------------------------------------------------------------------------
// Days: who is busy when

type Occupancy = Map<string, Set<number>>;

function occupancy(games: SeasonGame[]): Occupancy {
  const occ: Occupancy = new Map();
  for (const g of games) {
    if (g.off) continue;
    for (const c of [g.home, g.away]) {
      if (!occ.has(c)) occ.set(c, new Set());
      occ.get(c)!.add(g.day);
    }
  }
  return occ;
}

const busy = (occ: Occupancy, club: string, d: number) => {
  const s = occ.get(club);
  return !!s && (s.has(d - 1) || s.has(d) || s.has(d + 1));
};

/** The first day from `from` on which every club is free, with a free day either side. */
function freeDay(occ: Occupancy, clubs: string[], from: number, blocked: (club: string, d: number) => boolean = () => false): number {
  for (let d = from; d < from + 400; d++) if (clubs.every((c) => !busy(occ, c, d) && !blocked(c, d))) return d;
  throw new Error('No free day');
}

// ---------------------------------------------------------------------------
// Making ties and their games

interface Ctx {
  w: World;
  p: SeasonPlay;
  games: SeasonGame[];
  ties: Tie[];
  made: Record<string, true>;
  occ: Occupancy;
  base: number;
  day: number;
  moments: Moment[];
  inbox: { day: number; kind: 'draw' | 'post' | 'news'; text: string }[];
}

const nameOf = (w: World, c: string) => clubById(w, c)?.name ?? c;

function addGame(ctx: Ctx, g: Omit<SeasonGame, 'id' | 'seed'>): number {
  const id = ctx.games.length;
  ctx.games.push({ ...g, id, seed: mix(ctx.base, 0x9a3e, id) });
  for (const c of [g.home, g.away]) {
    if (!ctx.occ.has(c)) ctx.occ.set(c, new Set());
    ctx.occ.get(c)!.add(g.day);
  }
  return id;
}

/**
 * A tie (`a` better placed) and its games on the given dates, or (no dates) on the first free days from
 * `from`, a day apart, avoiding `blocked`.
 */
function makeTie(
  ctx: Ctx,
  t: { comp: string; round: string; a: string; b: string; bestOf: number; stage: SeasonGame['stage']; dates?: number[]; from?: number; blocked?: (club: string, d: number) => boolean; host?: string },
): Tie {
  const id = `${t.comp}|${t.round}|${t.a}|${t.b}`;
  const order = homeOrder(t.bestOf);
  const ids: number[] = [];
  let at = t.from ?? ctx.day + 2;
  for (let i = 0; i < t.bestOf; i++) {
    const day = t.dates ? t.dates[i] : freeDay(ctx.occ, [t.a, t.b], at, t.blocked);
    at = day + 2;
    // A Final Four game is at the host's arena: the host is the home side when it plays.
    const aHome = t.host ? t.host !== t.b : order[i];
    const label = `${ROUND_NAME[t.round] ?? t.round}${t.bestOf > 1 ? `, game ${i + 1}` : ''}`;
    ids.push(addGame(ctx, { comp: t.comp, day, home: aHome ? t.a : t.b, away: aHome ? t.b : t.a, stage: t.stage, tie: id, label }));
  }
  const tie: Tie = { id, comp: t.comp, round: t.round, a: t.a, b: t.b, bestOf: t.bestOf, games: ids };
  ctx.ties.push(tie);
  return tie;
}

/** Wins in a tie so far, for its two clubs. */
export function tieScore(games: SeasonGame[], t: Tie): Record<string, number> {
  const wins: Record<string, number> = { [t.a]: 0, [t.b]: 0 };
  for (const id of t.games) {
    const g = games[id];
    if (!g.score || g.off) continue;
    const winner = g.score[0] > g.score[1] ? g.home : g.away;
    wins[winner] = (wins[winner] ?? 0) + 1;
  }
  return wins;
}

const loserOf = (t: Tie) => (t.winner === t.a ? t.b : t.a);

/** Decides ties whose winner is known; their games no longer needed are marked off. */
function decide(ctx: Ctx) {
  for (const t of ctx.ties) {
    if (t.winner) continue;
    const wins = tieScore(ctx.games, t);
    const need = Math.ceil(t.bestOf / 2);
    const winner = wins[t.a] >= need ? t.a : wins[t.b] >= need ? t.b : null;
    if (!winner) continue;
    t.winner = winner;
    t.decided = ctx.day;
    for (const id of t.games) if (!ctx.games[id].score) ctx.games[id] = { ...ctx.games[id], off: true };
    ctx.occ = occupancy(ctx.games);
    // Your tie: knocked out, or through.
    const human = ctx.w.human?.club;
    if (human && (t.a === human || t.b === human)) {
      const opp = t.a === human ? t.b : t.a;
      const score = `${wins[human] ?? 0}–${wins[opp] ?? 0}`;
      const what = `${compLabel(ctx.w, t.comp)}, ${ROUND_NAME[t.round] ?? t.round}`;
      // The 7 v 8 play-in: its loser gets another game, for seed 8.
      const second = t.round === 'playin-a' && ctx.ties.find((x) => x.comp === t.comp && x.round === 'playin-a') === t;
      if (winner !== human && second) ctx.inbox.push({ day: ctx.day, kind: 'news', text: `Lost the play-in for seed 7 to ${nameOf(ctx.w, opp)}: one more game, for seed 8.` });
      else if (winner === human) ctx.inbox.push({ day: ctx.day, kind: 'news', text: `Through: you beat ${nameOf(ctx.w, opp)}${t.bestOf > 1 ? ` ${score}` : ''} (${what}).` });
      else ctx.moments.push({ kind: 'out', title: `Knocked out of the ${compLabel(ctx.w, t.comp)}`, lines: [`${nameOf(ctx.w, opp)} beat you${t.bestOf > 1 ? ` ${score.split('–').reverse().join('–')}` : ''} in the ${(ROUND_NAME[t.round] ?? t.round).toLowerCase()}.`], day: ctx.day });
    }
  }
}

/** A competition's or cup's name as shown. */
export function compLabel(w: World, comp: string): string {
  if (comp === BL_FINAL) return 'Big League Final';
  if (comp === BIG_LEAGUE) return 'Big League';
  const c = w.competitions.find((x) => x.id === comp);
  if (c) return c.name;
  return cupsOf(w).find((x) => x.id === comp)?.name ?? comp;
}

const tiesOf = (ctx: Ctx, comp: string, round: string) => ctx.ties.filter((t) => t.comp === comp && t.round === round);
const allDecided = (ts: Tie[]) => ts.length > 0 && ts.every((t) => t.winner);
const lastDecided = (ts: Tie[]) => Math.max(...ts.map((t) => t.decided ?? 0));

/** Whether a competition's regular season has been played to the end. */
function regularDone(ctx: Ctx, comp: Competition): boolean {
  const key = comp.kind === 'bigLeague' ? BIG_LEAGUE : comp.id;
  return !ctx.games.some((g) => !g.stage && g.comp === key && !g.score && (comp.kind !== 'bigLeague' || comp.clubs.includes(g.home) || comp.clubs.includes(g.away)));
}

function regularLastDay(ctx: Ctx, comp: Competition): number {
  const key = comp.kind === 'bigLeague' ? BIG_LEAGUE : comp.id;
  return Math.max(...ctx.games.filter((g) => !g.stage && g.comp === key).map((g) => g.day));
}

/** Once: marks a round of a competition as made; false if it was already. */
function once(ctx: Ctx, key: string): boolean {
  if (ctx.made[key]) return false;
  ctx.made[key] = true;
  return true;
}

/** The final standings order of a competition's regular season (club ids). */
type Standing = (w: World, comp: string) => string[];

/** Your first postseason tie in a competition: Continue stops to say who you play and the format. */
function announce(ctx: Ctx, comp: string, ts: Tie[], format: string) {
  const human = ctx.w.human?.club;
  const t = ts.find((x) => x.a === human || x.b === human);
  if (!t || !human) return;
  const opp = t.a === human ? t.b : t.a;
  const first = ctx.games[t.games[0]];
  const round = ROUND_NAME[t.round] ?? t.round;
  const where = t.bestOf > 1 ? `, best of ${t.bestOf}, from ${shortDate(ctx.w.season, first.day)}${t.a === human ? ', with the extra home game' : ''}` : `, one game, ${shortDate(ctx.w.season, first.day)}, ${first.home === human ? 'at home' : 'away'}`;
  ctx.moments.push({
    kind: 'post',
    title: round === compLabel(ctx.w, comp) ? round : `${compLabel(ctx.w, comp)}: ${round}`,
    lines: [`You play ${nameOf(ctx.w, opp)}${where}.`, format],
    day: ctx.day,
  });
}

// ---------------------------------------------------------------------------
// Each competition's postseason

function bigLeague(ctx: Ctx, conf: Competition, standing: Standing) {
  const id = conf.id;
  const dates = bigLeagueDates();
  if (!regularDone(ctx, conf)) return;
  const order = standing(ctx.w, id);
  const at = (k: string) => dates[`${id}|${k}`];
  if (once(ctx, `${id}|playin-a`)) {
    const ts = [makeTie(ctx, { comp: id, round: 'playin-a', a: order[6], b: order[7], bestOf: 1, stage: 'playin', dates: at('playin-a') }), makeTie(ctx, { comp: id, round: 'playin-a', a: order[8], b: order[9], bestOf: 1, stage: 'playin', dates: at('playin-a') })];
    announce(ctx, id, ts, 'Play-in: the winner of 7 v 8 is seed 7; the loser plays the winner of 9 v 10 for seed 8.');
    const human = ctx.w.human?.club;
    if (human && order.slice(0, 6).includes(human)) ctx.inbox.push({ day: ctx.day, kind: 'post', text: `You finished ${order.indexOf(human) + 1}${['th', 'st', 'nd', 'rd'][order.indexOf(human) + 1] ?? 'th'} in the ${conf.name}: straight into the playoffs. The play-in decides your opponent.` });
  }
  const pa = tiesOf(ctx, id, 'playin-a');
  if (allDecided(pa) && once(ctx, `${id}|playin-b`)) {
    const [t78, t910] = pa;
    const loser78 = loserOf(t78);
    const better = order.indexOf(loser78) < order.indexOf(t910.winner!) ? loser78 : t910.winner!;
    const ts = [makeTie(ctx, { comp: id, round: 'playin-b', a: better, b: better === loser78 ? t910.winner! : loser78, bestOf: 1, stage: 'playin', dates: at('playin-b') })];
    announce(ctx, id, ts, 'The winner is seed 8.');
  }
  const pb = tiesOf(ctx, id, 'playin-b');
  if (!allDecided(pb)) return;
  const seeds = [...order.slice(0, 6), pa[0].winner!, pb[0].winner!];
  const firstKey = conf.region === 'america' ? 'r1' : 'qf';
  const bestOf = conf.region === 'america' ? 7 : 5;
  if (once(ctx, `${id}|${firstKey}`)) {
    const ts = [0, 1, 2, 3].map((i) => makeTie(ctx, { comp: id, round: firstKey, a: seeds[i], b: seeds[7 - i], bestOf, stage: 'playoff', dates: at(firstKey) }));
    announce(ctx, id, ts, conf.region === 'america' ? 'Three best-of-7 rounds to the conference title (2-2-1-1-1).' : 'Best-of-5 quarter-finals (2-2-1), then the Final Four weekend.');
  }
  const r1 = tiesOf(ctx, id, firstKey);
  if (!allDecided(r1)) return;
  const seedOf = (c: string) => seeds.indexOf(c);
  // The bracket: 1/8 v 4/5, 2/7 v 3/6; the better seed first.
  const pairUp = (x: Tie, y: Tie): [string, string] => {
    const [p, q] = [x.winner!, y.winner!];
    return seedOf(p) < seedOf(q) ? [p, q] : [q, p];
  };
  if (conf.region === 'america') {
    if (once(ctx, `${id}|r2`)) {
      for (const [x, y] of [
        [r1[0], r1[3]],
        [r1[1], r1[2]],
      ]) {
        const [a, b] = pairUp(x, y);
        makeTie(ctx, { comp: id, round: 'r2', a, b, bestOf: 7, stage: 'playoff', dates: at('r2') });
      }
    }
    const r2 = tiesOf(ctx, id, 'r2');
    if (!allDecided(r2)) return;
    if (once(ctx, `${id}|cf`)) {
      const [a, b] = pairUp(r2[0], r2[1]);
      makeTie(ctx, { comp: id, round: 'cf', a, b, bestOf: 7, stage: 'playoff', dates: at('cf') });
    }
    return;
  }
  // Europe: the Final Four weekend, at the best-placed club of the four.
  if (once(ctx, `${id}|ff`)) {
    const four = r1.map((t) => t.winner!);
    const host = four.reduce((h, c) => (seedOf(c) < seedOf(h) ? c : h));
    for (const [x, y] of [
      [r1[0], r1[3]],
      [r1[1], r1[2]],
    ]) {
      const [a, b] = pairUp(x, y);
      makeTie(ctx, { comp: id, round: 'ff', a, b, bestOf: 1, stage: 'playoff', dates: at('ff'), host });
    }
    ctx.made[`${id}|host`] = true;
    ctx.made[`${id}|host:${host}`] = true;
  }
  const ff = tiesOf(ctx, id, 'ff');
  if (!allDecided(ff)) return;
  if (once(ctx, `${id}|ff-final`)) {
    const [a, b] = pairUp(ff[0], ff[1]);
    const host = Object.keys(ctx.made).find((k) => k.startsWith(`${id}|host:`))!.split(':')[1];
    makeTie(ctx, { comp: id, round: 'ff-final', a, b, bestOf: 1, stage: 'playoff', dates: at('ff-final'), host });
  }
}

/** Conference champions, once known. */
function conferenceChampion(ctx: Ctx, conf: string): Tie | undefined {
  const last = tiesOf(ctx, conf, conf === BL_AMERICA ? 'cf' : 'ff-final')[0];
  return last?.winner ? last : undefined;
}

function bigLeagueFinal(ctx: Ctx) {
  const am = conferenceChampion(ctx, BL_AMERICA);
  const eu = conferenceChampion(ctx, BL_EUROPE);
  if (!am || !eu || !once(ctx, `${BL_FINAL}|final`)) return;
  // Europe hosts in even seasons (FIBA), America in odd ones (NBA): WORLD_SPEC §1.1.
  const europeHosts = ctx.w.season % 2 === 0;
  const host = europeHosts ? eu.winner! : am.winner!;
  const guest = europeHosts ? am.winner! : eu.winner!;
  const from = Math.max(am.decided!, eu.decided!) + 7;
  const ts = [makeTie(ctx, { comp: BL_FINAL, round: 'bl-final', a: host, b: guest, bestOf: 1, stage: 'final', from, host })];
  announce(ctx, BL_FINAL, ts, `One game for the Big League title, in the arena of ${nameOf(ctx.w, host)} (${europeHosts ? 'FIBA' : 'NBA'} rules).`);
}

/** A European club still in the Big League's postseason (or that may yet be): its national games wait. */
function blBlock(ctx: Ctx): (club: string, d: number) => boolean {
  const eu = ctx.w.competitions.find((c) => c.id === BL_EUROPE);
  if (!eu) return () => false;
  const ties = ctx.ties.filter((t) => t.comp === BL_EUROPE);
  const out = new Set<string>();
  if (ties.length) {
    // Out: placed 11th or 12th, or lost a tie.
    const inPost = new Set(ties.flatMap((t) => [t.a, t.b]));
    for (const c of eu.clubs) if (!inPost.has(c) && ctx.made[`${BL_EUROPE}|playin-a`]) out.add(c);
    for (const t of ties) if (t.winner) out.add(loserOf(t));
    // A play-in loser who still plays for seed 8 is not out.
    for (const t of ties) if (!t.winner) [t.a, t.b].forEach((c) => out.delete(c));
  }
  const days = new Set(Object.entries(bigLeagueDates()).filter(([k]) => k.startsWith(BL_EUROPE)).flatMap(([, v]) => v));
  return (club, d) => eu.clubs.includes(club) && !out.has(club) && (days.has(d) || days.has(d - 1) || days.has(d + 1));
}

/** A national first tier (and Portugal): top 8, quarter-finals and semi-finals best-of-3, final best-of-5. */
function nationalPlayoffs(ctx: Ctx, comp: Competition, standing: Standing) {
  if (!regularDone(ctx, comp)) return;
  const order = standing(ctx.w, comp.id);
  const blocked = blBlock(ctx);
  const ffFinal = bigLeagueDates()[`${BL_EUROPE}|ff-final`][0];
  if (once(ctx, `${comp.id}|qf`)) {
    const from = regularLastDay(ctx, comp) + 2;
    const ts = [0, 1, 2, 3].map((i) => makeTie(ctx, { comp: comp.id, round: 'qf', a: order[i], b: order[7 - i], bestOf: 3, stage: 'playoff', from, blocked }));
    announce(ctx, comp.id, ts, 'National playoffs: quarter-finals and semi-finals best-of-3, the final best-of-5.');
  }
  const qf = tiesOf(ctx, comp.id, 'qf');
  if (!allDecided(qf)) return;
  const rank = (c: string) => order.indexOf(c);
  const pairUp = (x: Tie, y: Tie): [string, string] => (rank(x.winner!) < rank(y.winner!) ? [x.winner!, y.winner!] : [y.winner!, x.winner!]);
  if (once(ctx, `${comp.id}|sf`)) {
    const from = lastDecided(qf) + 2;
    for (const [x, y] of [
      [qf[0], qf[3]],
      [qf[1], qf[2]],
    ]) {
      const [a, b] = pairUp(x, y);
      makeTie(ctx, { comp: comp.id, round: 'sf', a, b, bestOf: 3, stage: 'playoff', from, blocked: blBlock(ctx) });
    }
  }
  const sf = tiesOf(ctx, comp.id, 'sf');
  if (!allDecided(sf)) return;
  if (once(ctx, `${comp.id}|final`)) {
    // The national finals come after the Europe Final Four.
    const from = Math.max(lastDecided(sf) + 2, ffFinal + 2);
    const [a, b] = pairUp(sf[0], sf[1]);
    makeTie(ctx, { comp: comp.id, round: 'final', a, b, bestOf: 5, stage: 'playoff', from, blocked: blBlock(ctx) });
  }
}

/** US Divisions and national second tiers: places 2–5, single games (2 v 5, 3 v 4, then the final) for the second promotion spot. */
function promotionPlayoff(ctx: Ctx, comp: Competition, standing: Standing) {
  if (!regularDone(ctx, comp)) return;
  const order = standing(ctx.w, comp.id);
  if (once(ctx, `${comp.id}|promo`)) {
    const from = regularLastDay(ctx, comp) + 2;
    const ts = [makeTie(ctx, { comp: comp.id, round: 'promo', a: order[1], b: order[4], bestOf: 1, stage: 'playoff', from }), makeTie(ctx, { comp: comp.id, round: 'promo', a: order[2], b: order[3], bestOf: 1, stage: 'playoff', from })];
    announce(ctx, comp.id, ts, 'The promotion playoff: single games, the winner of the final goes up with the champion.');
    const human = ctx.w.human?.club;
    if (human && order[0] === human) ctx.inbox.push({ day: ctx.day, kind: 'post', text: `Champions of the ${comp.name}: promoted!` });
  }
  const sf = tiesOf(ctx, comp.id, 'promo');
  if (!allDecided(sf) || !once(ctx, `${comp.id}|promo-final`)) return;
  const [x, y] = [sf[0].winner!, sf[1].winner!];
  const [a, b] = order.indexOf(x) < order.indexOf(y) ? [x, y] : [y, x];
  makeTie(ctx, { comp: comp.id, round: 'promo-final', a, b, bestOf: 1, stage: 'playoff', from: lastDecided(sf) + 2 });
}

// ---------------------------------------------------------------------------
// Cups

/** A cup round: drawn at random, the lower-tier club at home (same tier: the first drawn). */
function drawRound(ctx: Ctx, cup: Cup, ri: number, clubs: string[]) {
  const round = cup.rounds[ri];
  const rng = createRng(mix(ctx.base, 0xc0b, ri, cup.id.length, ...[...cup.id].map((ch) => ch.charCodeAt(0))));
  const pool = [...clubs];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(next(rng) * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const human = ctx.w.human?.club;
  for (let i = 0; i + 1 < pool.length; i += 2) {
    const [x, y] = [pool[i], pool[i + 1]];
    const home = tierOf(ctx.w, y) > tierOf(ctx.w, x) ? y : x;
    const away = home === x ? y : x;
    makeTie(ctx, { comp: cup.id, round: round.key, a: home, b: away, bestOf: 1, stage: 'cup', dates: [round.day] });
    if (human && (x === human || y === human)) {
      const opp = x === human ? y : x;
      ctx.moments.push({
        kind: 'draw',
        title: `${cup.name}: ${ROUND_NAME[round.key] ?? round.key}`,
        lines: [`The draw: you play ${nameOf(ctx.w, opp)} ${home === human ? 'at home' : 'away'}, ${shortDate(ctx.w.season, round.day)}.`],
        day: ctx.day,
      });
    }
  }
  ctx.inbox.push({ day: ctx.day, kind: 'draw', text: `${cup.name} draw, ${(ROUND_NAME[round.key] ?? round.key).toLowerCase()}: ${pool.length / 2} ties on ${shortDate(ctx.w.season, round.day)}.` });
}

function cups(ctx: Ctx) {
  for (const cup of cupsOf(ctx.w)) {
    const entries = cupEntries(ctx.w, cup);
    for (let ri = 0; ri < cup.rounds.length; ri++) {
      const r = cup.rounds[ri];
      if (ctx.made[`${cup.id}|${r.key}`]) continue;
      // Each round is drawn two weeks before it is played (once the round before is decided).
      if (ctx.day < r.day - 14) break;
      let clubs: string[];
      if (ri === 0) clubs = entries.first;
      else {
        const prev = tiesOf(ctx, cup.id, cup.rounds[ri - 1].key);
        if (!allDecided(prev)) break;
        const winners = prev.map((t) => t.winner!);
        clubs = [...winners, ...(entries.joins[r.key] ?? [])];
        if (r.key === 'ff-final') {
          // The final: the two semi-final winners at the host's arena.
          once(ctx, `${cup.id}|${r.key}`);
          const host = Object.keys(ctx.made).find((k) => k.startsWith(`${cup.id}|host:`))?.split(':')[1];
          const [a, b] = winners;
          makeTie(ctx, { comp: cup.id, round: r.key, a, b, bestOf: 1, stage: 'cup', dates: [r.day], host: host && [a, b].includes(host) ? host : undefined });
          continue;
        }
        if (r.key === 'ff') {
          once(ctx, `${cup.id}|${r.key}`);
          // The Final Four weekend at the best-placed of the four (highest tier, then strength).
          const host = [...clubs].sort((p, q) => tierOf(ctx.w, p) - tierOf(ctx.w, q) || strength(ctx.w, clubById(ctx.w, q)!) - strength(ctx.w, clubById(ctx.w, p)!))[0];
          ctx.made[`${cup.id}|host:${host}`] = true;
          drawRound(ctx, cup, ri, clubs);
          // Semi-finals at the host's arena.
          for (const t of tiesOf(ctx, cup.id, 'ff')) {
            if (t.b === host) {
              for (const id of t.games) ctx.games[id] = { ...ctx.games[id], home: host, away: t.a };
            }
          }
          continue;
        }
      }
      // A round is drawn when the one before it is decided (the first at the start of the season).
      once(ctx, `${cup.id}|${r.key}`);
      drawRound(ctx, cup, ri, clubs);
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * After a day: series decided, the next rounds made, cups drawn, and what Continue should stop for.
 * `standing`: a competition's final regular-season order (play.ts's table).
 */
export function advancePost(w: World, standing: Standing): World {
  const p = w.play!;
  const ctx: Ctx = {
    w,
    p,
    games: [...p.games],
    ties: (p.ties ?? []).map((t) => ({ ...t })),
    made: { ...(p.made ?? {}) },
    occ: occupancy(p.games),
    base: mix(w.seed, w.season, 0x5ea5),
    day: Math.max(0, p.day),
    moments: [],
    inbox: [],
  };
  const playingBefore = stillPlaying(w, p.games, p.ties, p.made);
  const gamesBefore = ctx.games.length;
  const tiesBefore = JSON.stringify(ctx.ties.map((t) => t.winner ?? ''));
  decide(ctx);
  const confs = w.competitions.filter((c) => c.kind === 'bigLeague');
  for (const conf of confs) bigLeague(ctx, conf, standing);
  bigLeagueFinal(ctx);
  for (const c of w.competitions) {
    if (c.kind === 'nationalLeague' && c.tier === 1) nationalPlayoffs(ctx, c, standing);
    if (c.kind === 'usDivision' || (c.kind === 'nationalLeague' && c.tier === 2)) promotionPlayoff(ctx, c, standing);
  }
  if (!p.noCups) cups(ctx);
  decide(ctx);
  const changed = ctx.games.length !== gamesBefore || JSON.stringify(ctx.ties.map((t) => t.winner ?? '')) !== tiesBefore || ctx.moments.length || ctx.inbox.length || Object.keys(ctx.made).length !== Object.keys(p.made ?? {}).length;
  if (!changed) return w;
  // Your season over: no more games of yours and no tie of yours to come.
  const human = w.human?.club;
  if (human && playingBefore && !stillPlaying(w, ctx.games, ctx.ties, ctx.made)) ctx.moments.push({ kind: 'over', title: 'Your season is over', lines: ['The rest of the world plays on: simulate to the end of the season, or watch it day by day.'], day: ctx.day });
  const moment = mergeMoments(p.moment ?? null, ctx.moments);
  return {
    ...w,
    play: {
      ...p,
      games: ctx.games,
      ties: ctx.ties,
      made: ctx.made,
      moment,
      inbox: [...p.inbox, ...ctx.inbox],
    },
  };
}

function mergeMoments(prev: Moment | null, ms: Moment[]): Moment | null {
  if (!ms.length) return prev;
  const all = [...(prev ? [prev] : []), ...ms];
  const lead = all.find((m) => m.kind === 'out') ?? all[0];
  return { kind: lead.kind, title: lead.title, lines: all.flatMap((m) => (m === lead ? m.lines : [`${m.title}: ${m.lines.join(' ')}`])), day: all[all.length - 1].day };
}

/** Whether your club still has games to come: one scheduled, a tie not decided, or a round not yet made that it is in line for. */
export function stillPlaying(w: World, games: SeasonGame[], ties: SeasonPlay['ties'] = [], made: Record<string, true> = {}): boolean {
  const human = w.human?.club;
  if (!human) return false;
  if (games.some((g) => !g.off && !g.score && (g.home === human || g.away === human))) return true;
  // A tie won whose next round is still to be made (a series won before the others are over).
  for (const t of ties ?? []) if (t.winner === human && !nextRoundMade(w, t, ties ?? [], made)) return true;
  // The 7 v 8 play-in's loser plays again, for seed 8.
  for (const t of ties ?? []) {
    const is78 = t.round === 'playin-a' && (ties ?? []).find((x) => x.comp === t.comp && x.round === 'playin-a') === t;
    if (is78 && t.winner && t.winner !== human && (t.a === human || t.b === human) && !made[`${t.comp}|playin-b`]) return true;
  }
  // Regular seasons of its leagues not yet over (the postseason not yet made).
  for (const c of competitionsOf(w, human)) {
    const key = c.kind === 'bigLeague' ? BIG_LEAGUE : c.id;
    if (games.some((g) => !g.stage && g.comp === key && !g.score)) return true;
  }
  // A cup still to be drawn that it is in.
  for (const cup of cupsOf(w)) {
    if (w.play?.noCups || !cup.clubs.includes(human)) continue;
    const mine = (ties ?? []).filter((t) => t.comp === cup.id && (t.a === human || t.b === human));
    if (!mine.length && !made[`${cup.id}|ff-final`]) {
      // Not drawn yet: in if it joins later or the first round is still to come.
      const entries = cupEntries(w, cup);
      if (entries.first.includes(human) || Object.values(entries.joins).some((cs) => cs.includes(human))) {
        const joinKey = Object.entries(entries.joins).find(([, cs]) => cs.includes(human))?.[0];
        if (!joinKey || !made[`${cup.id}|${joinKey}`]) return true;
      }
    }
  }
  return false;
}

/** Whether the round after a tie's (for its winner) has been made yet. */
function nextRoundMade(w: World, t: Tie, ties: Tie[], made: Record<string, true>): boolean {
  if (t.comp.startsWith('cup-')) {
    const cup = cupById(w, t.comp);
    const i = cup ? cup.rounds.findIndex((r) => r.key === t.round) : -1;
    const nextKey = cup && i >= 0 ? cup.rounds[i + 1]?.key : undefined;
    return !nextKey || !!made[`${t.comp}|${nextKey}`];
  }
  const first = (comp: string) => (comp === BL_AMERICA ? 'r1' : 'qf');
  const chain: Record<string, string> = {
    'playin-b': first(t.comp),
    r1: 'r2',
    r2: 'cf',
    qf: t.comp === BL_EUROPE ? 'ff' : 'sf',
    sf: 'final',
    ff: 'ff-final',
    promo: 'promo-final',
  };
  if (t.round === 'playin-a') {
    // 7 v 8's winner is seed 7 (on to the first round); 9 v 10's winner plays for seed 8.
    const is78 = ties.find((x) => x.comp === t.comp && x.round === 'playin-a') === t;
    return !!made[`${t.comp}|${is78 ? first(t.comp) : 'playin-b'}`];
  }
  if ((t.comp === BL_AMERICA && t.round === 'cf') || (t.comp === BL_EUROPE && t.round === 'ff-final')) return !!made[`${BL_FINAL}|final`];
  const n = chain[t.round];
  return !n || !!made[`${t.comp}|${n}`];
}
// ---------------------------------------------------------------------------
// Key games (WORLD_SPEC §1.1, slice W2b §4): only your own.

/** The lines in a league's table that a season decider is about: [place above the line, …]. */
function linesOf(comp: Competition): number[] {
  const n = comp.clubs.length;
  if (comp.kind === 'bigLeague') return [6, 10];
  if (comp.kind === 'usDivision') return comp.tier === 4 ? [1, 5] : [1, 5, n - 2];
  if (comp.tier === 2) return [1, 5];
  // A first tier: the playoffs (top 8) and, where there is a second tier, the drop.
  return comp.country === 'PT' ? [8] : [8, n - 2];
}

export function isKeyGame(w: World, g: SeasonGame, table: (w: World, comp: string) => { club: string; won: number }[]): boolean {
  if (g.off) return false;
  if (g.stage === 'playin' || g.stage === 'playoff' || g.stage === 'final') return true;
  if (g.stage === 'cup') {
    const round = g.tie?.split('|')[1];
    return round === 'qf' || round === 'ff' || round === 'ff-final';
  }
  const human = w.human?.club;
  if (!human || (g.home !== human && g.away !== human)) return false;
  // A season decider: one of your last 5 regular-season games in the league, within 2 wins of a line.
  const comp = g.comp === BIG_LEAGUE ? competitionsOf(w, human).find((c) => c.kind === 'bigLeague') : w.competitions.find((c) => c.id === g.comp);
  if (!comp) return false;
  const mine = w.play!.games.filter((x) => !x.stage && x.comp === g.comp && (x.home === human || x.away === human));
  if (mine.indexOf(g) < mine.length - 5) return false;
  const rows = table(w, comp.id);
  const at = rows.findIndex((r) => r.club === human);
  if (at < 0) return false;
  return linesOf(comp).some((line) => {
    const above = at < line;
    const other = rows[above ? line : line - 1];
    return !!other && Math.abs(other.won - rows[at].won) <= 2;
  });
}
