// Playing the regular season (slice brief W2a §2–§3): the squads as the engine plays them, a day's
// games simulated with the full engine, the results and season totals added to the world, the
// tables, and Continue: day by day until your game day, the season's first day, or its end.
//
// Everything that decides a game comes from its seed and the squads, never from the order games are
// played in, so the same world plays the same season whether it is played in one go, a day at a time,
// in a worker, or saved and loaded half way (tests/season.test.ts).

import { createMatch, makePlan, stepPossession } from '../../engine/match';
import { composite } from '../../engine/ratings';
import { createRng } from '../../engine/rng';
import { buildBoxScore, emptyStats } from '../../engine/stats';
import { FIBA_RULES, NBA_RULES, type GamePlan, type MatchRules, type MatchState, type PlayerStats, type Side, type Team } from '../../engine/types';
import { aiGamePlan } from '../ai';
import { clubById, competitionsOf } from '../world/query';
import type { World, WorldClub } from '../world/types';
import { shortDate } from './calendar';
import { buildSchedule, mix } from './schedule';
import { advancePost, compLabel, isKeyGame } from './post';
import { BIG_LEAGUE, STAT_KEYS, type BoxLine, type BoxSide, type InboxItem, type SeasonGame, type SeasonPlay } from './types';

/** Players who dress for a game (GAME_FLOW §5.1). */
export const DRESSED = 12;

// ---------------------------------------------------------------------------
// The season in the world

/** A world with its season: the schedule made (once), the day before the first. */
export function startSeason(w: World): World {
  if (w.play) return w;
  const play: SeasonPlay = { phase: 'before', day: -1, done: true, games: buildSchedule(w), stats: {}, boxes: {}, inbox: [], plan: null, mode: 'watch' };
  return { ...w, play };
}

export function playOf(w: World): SeasonPlay {
  if (!w.play) throw new Error('The season has not been made');
  return w.play;
}

/** The match rules (WORLD_SPEC §14): national leagues FIBA, US divisions NBA, a Big League game the home club's region's (owner, 19 Nov 2026). */
export function rulesFor(w: World, g: SeasonGame): MatchRules {
  const comp = w.competitions.find((c) => c.id === g.comp);
  if (comp?.kind === 'nationalLeague') return FIBA_RULES;
  if (comp?.kind === 'usDivision') return NBA_RULES;
  return clubById(w, g.home)?.region === 'europe' ? FIBA_RULES : NBA_RULES;
}

const byOverall = (w: World, ids: string[]) => [...ids].sort((a, b) => composite(w.players[b].p).overall - composite(w.players[a].p).overall || (a < b ? -1 : 1));

/** A club's whole first team as an engine team (for the plan editor). */
export function squadTeam(w: World, club: WorldClub, ids: string[] = club.roster): Team {
  return { id: club.id, name: club.name, abbr: club.abbr, players: ids.map((id) => w.players[id].p), execution: 1 };
}

/** The plan your club starts with: the best at each position, the bench by overall (the lowest last: he sits out). */
export function defaultPlan(w: World, club: WorldClub): GamePlan {
  return makePlan(squadTeam(w, club, byOverall(w, club.roster)));
}

/** Whether a plan still fits the squad: five starters and the rest on the bench, nobody twice. */
export function planFits(plan: GamePlan | null, roster: string[]): plan is GamePlan {
  if (!plan || plan.starters.length !== 5) return false;
  const ids = [...plan.starters, ...plan.bench];
  return ids.length === roster.length && new Set(ids).size === ids.length && ids.every((id) => roster.includes(id));
}

/** Your plan and rotation (carried over from your last game), or the default one. */
export function humanPlan(w: World): GamePlan {
  const club = clubById(w, w.human!.club)!;
  const plan = w.play?.plan ?? null;
  return planFits(plan, club.roster) ? plan : defaultPlan(w, club);
}

export function setHumanPlan(w: World, plan: GamePlan): World {
  return { ...w, play: { ...playOf(w), plan } };
}

/** Who dresses: your starters and the first seven of your bench order; other clubs leave out their lowest overall. */
export function dressedIds(w: World, clubId: string): string[] {
  const club = clubById(w, clubId)!;
  if (clubId === w.human?.club) {
    const plan = humanPlan(w);
    return [...plan.starters, ...plan.bench].slice(0, DRESSED);
  }
  return byOverall(w, club.roster).slice(0, DRESSED);
}

/** A plan for the twelve who dress: the bench without the one left out, a key matchup only on players who play. */
function matchPlan(plan: GamePlan, ours: string[], theirs: string[]): GamePlan {
  const km = plan.keyMatchup;
  const keep = km.kind === 'none' || (theirs.includes(km.targetId) && (km.kind === 'double' || ours.includes(km.defenderId)));
  return { ...plan, bench: plan.bench.filter((id) => ours.includes(id)), keyMatchup: keep ? km : { kind: 'none' } };
}

// ---------------------------------------------------------------------------
// One game: what the engine needs, and what comes back

export interface SimInput {
  id: number;
  seed: number;
  rules: MatchRules;
  teams: [Team, Team];
  /** Your plan for your side; null: the AI coach's (chosen in the worker, from the game's seed). */
  plans: [GamePlan | null, GamePlan | null];
}

export interface GameOutput {
  id: number;
  score: [number, number];
  ot: boolean;
  sides: [BoxSide, BoxSide];
}

/** What the engine needs to play a game: the two teams that dress and, for your club, your plan. */
export function inputFor(w: World, g: SeasonGame): SimInput {
  const ids: [string[], string[]] = [dressedIds(w, g.home), dressedIds(w, g.away)];
  const teams = [g.home, g.away].map((c, i) => squadTeam(w, clubById(w, c)!, ids[i])) as [Team, Team];
  const human = w.human?.club;
  const plans = ([0, 1] as const).map((side) => ((side === 0 ? g.home : g.away) === human ? matchPlan(humanPlan(w), ids[side], ids[1 - side]) : null)) as [GamePlan | null, GamePlan | null];
  return { id: g.id, seed: g.seed, rules: rulesFor(w, g), teams, plans };
}

/** The plans both sides play with: yours as given, the AI's from the game's seed (each side its own draw). */
export function plansFor(inp: SimInput): [GamePlan, GamePlan] {
  return ([0, 1] as const).map((side) => inp.plans[side] ?? aiGamePlan(inp.teams[side], inp.teams[1 - side], createRng(mix(inp.seed, 5, side)))) as [GamePlan, GamePlan];
}

/** A new match for a game (to watch, or to simulate). */
export function matchFor(inp: SimInput, plans = plansFor(inp)): MatchState {
  return createMatch(inp.teams[0], inp.teams[1], plans[0], plans[1], inp.seed, inp.rules);
}

/** Plays a match on to its end with the engine (a game simulated, or the rest of one you left). */
export function finishMatch(s: MatchState): MatchState {
  let guard = 0;
  while (!s.finished) {
    stepPossession(s);
    if (++guard > 5000) throw new Error('Match did not finish');
  }
  return s;
}

export function playInput(inp: SimInput): MatchState {
  return finishMatch(matchFor(inp));
}

const line = (id: string, s: PlayerStats): BoxLine => [id, ...STAT_KEYS.map((k) => s[k])];

/** A finished match as a game result: the score and both sides' box score lines. */
export function outputFrom(id: number, s: MatchState): GameOutput {
  const sides = ([0, 1] as const).map((side): BoxSide => {
    const t = s.teams[side];
    return {
      starters: [...t.plan.starters],
      quarterPoints: [...t.quarterPoints],
      extras: { ...t.extras },
      lines: t.team.players.map((p) => line(p.id, t.players[p.id].stats)),
    };
  }) as [BoxSide, BoxSide];
  return { id, score: [s.teams[0].score, s.teams[1].score], ot: s.quarter > 4, sides };
}

export function simulateInputs(inputs: SimInput[]): GameOutput[] {
  return inputs.map((inp) => outputFrom(inp.id, playInput(inp)));
}

// ---------------------------------------------------------------------------
// Results into the world

/** The competition key a game's numbers are kept under (the Big League's: BIG_LEAGUE; a league's playoffs apart from its regular season; a cup its own). */
export const statsKey = (g: SeasonGame) => (g.stage && g.stage !== 'cup' ? `${g.comp}|post` : g.comp);

/** Whose box scores are kept (slice W2b §7): your games, every postseason game, cup ties from the quarter-finals on. */
export function keepsBox(w: World, g: SeasonGame): boolean {
  if (isHumanGame(w, g)) return true;
  if (g.stage === 'playin' || g.stage === 'playoff' || g.stage === 'final') return true;
  if (g.stage === 'cup') return ['qf', 'ff', 'ff-final'].includes(g.tie?.split('|')[1] ?? '');
  return false;
}

/** Adds played games to the world: scores, season totals, your box scores and inbox. */
export function applyOutputs(w: World, outs: GameOutput[]): World {
  if (!outs.length) return w;
  const play = playOf(w);
  const games = [...play.games];
  const stats = { ...play.stats };
  const boxes = { ...play.boxes };
  const inbox = [...play.inbox];
  const copied = new Set<string>();
  const human = w.human?.club;
  for (const o of outs) {
    const g = games[o.id];
    if (g.score) continue;
    games[o.id] = { ...g, score: o.score, ...(o.ot ? { ot: true } : {}) };
    const key = statsKey(g);
    if (!copied.has(key)) {
      stats[key] = { ...(stats[key] ?? {}) };
      copied.add(key);
    }
    const table = stats[key];
    for (const side of o.sides)
      for (const [id, ...nums] of side.lines) {
        const prev = table[id] ?? new Array(STAT_KEYS.length + 1).fill(0);
        const nextTotals = prev.map((v, i) => (i === 0 ? v + (nums[0] > 0 ? 1 : 0) : v + nums[i - 1]));
        table[id] = nextTotals;
      }
    if (keepsBox(w, g)) boxes[o.id] = o.sides;
    if (human && (g.home === human || g.away === human)) {
      inbox.push({ day: g.day, kind: 'result', text: resultText(w, g, o.score, o.ot), game: o.id });
    }
  }
  return { ...w, play: { ...play, games, stats, boxes, inbox } };
}

function resultText(w: World, g: SeasonGame, score: [number, number], ot: boolean): string {
  const home = g.home === w.human?.club;
  const [us, them] = home ? score : [score[1], score[0]];
  const opp = clubById(w, home ? g.away : g.home)?.name ?? '?';
  return `${us > them ? 'Won' : 'Lost'} ${us}–${them}${ot ? ' (OT)' : ''} ${home ? 'v' : 'at'} ${opp}, ${compName(w, g.comp)}${g.label ? `, ${g.label.toLowerCase()}` : ''}`;
}

export function compName(w: World, comp: string): string {
  return compLabel(w, comp);
}

// ---------------------------------------------------------------------------
// Days

const dayIndex = new WeakMap<SeasonGame[], Map<number, SeasonGame[]>>();

/** The games of a day. */
export function gamesOn(w: World, day: number): SeasonGame[] {
  const games = playOf(w).games;
  let ix = dayIndex.get(games);
  if (!ix) {
    ix = new Map();
    for (const g of games) if (!g.off) ix.set(g.day, [...(ix.get(g.day) ?? []), g]);
    dayIndex.set(games, ix);
  }
  return ix.get(day) ?? [];
}

export const lastDay = (w: World) => playOf(w).games.reduce((m, g) => (g.off ? m : Math.max(m, g.day)), 0);
export const isHumanGame = (w: World, g: SeasonGame) => !!w.human && (g.home === w.human.club || g.away === w.human.club);

/** Your game today, if it is still to be played. */
export function humanGameToday(w: World): SeasonGame | undefined {
  const p = playOf(w);
  if (p.phase !== 'regular') return undefined;
  return gamesOn(w, p.day).find((g) => !g.score && isHumanGame(w, g));
}

/** Your club's games, in order. */
export function humanGames(w: World): SeasonGame[] {
  return w.human ? playOf(w).games.filter((g) => !g.off && isHumanGame(w, g)).sort((a, b) => a.day - b.day) : [];
}

/** Your next game still to play (today's included). */
export function nextHumanGame(w: World): SeasonGame | undefined {
  return humanGames(w).find((g) => !g.score);
}

function addInbox(w: World, item: InboxItem): World {
  const p = playOf(w);
  return { ...w, play: { ...p, inbox: [...p.inbox, item] } };
}

/** The season's first day. */
export function beginSeason(w: World): World {
  const p = playOf(w);
  if (p.phase !== 'before' || p.offseason) return w;
  const started: World = withPost({ ...w, play: { ...p, phase: 'regular', day: 0, done: false } });
  return addInbox(started, { day: 0, kind: 'start', text: `The ${w.season}–${String(w.season + 1).slice(2)} season starts today, ${shortDate(w.season, 0)}. Your first game: ${firstGameText(started)}.` });
}

function firstGameText(w: World): string {
  const g = nextHumanGame(w);
  if (!g) return 'none';
  const home = g.home === w.human?.club;
  return `${shortDate(w.season, g.day)}, ${home ? 'v' : 'at'} ${clubById(w, home ? g.away : g.home)?.name ?? '?'} (${compName(w, g.comp)})`;
}

/** The postseason and the cups move on: series decided, next rounds made, draws (post.ts). */
export function withPost(w: World): World {
  return advancePost(w, (ww, comp) => table(ww, comp).map((r) => r.club));
}

/** Today's games are all played: the day is over (the next rounds are made), and the season too after its last game. */
export function closeDay(w: World): World {
  let closed = withPost({ ...w, play: { ...playOf(w), done: true } });
  closed = expiringNews(closed);
  const p = playOf(closed);
  if (p.games.some((g) => !g.score && !g.off)) return closed;
  const ended: World = { ...closed, play: { ...p, phase: 'review', moment: null } };
  return addInbox(ended, { day: p.day, kind: 'end', text: `The season is over. Your season review is ready.` });
}

/** When your regular season is over: an inbox message lists your players whose contract is expiring (WORLD_SPEC §7.0). */
function expiringNews(w: World): World {
  const p = playOf(w);
  if (!w.human || p.made?.expiring || !regularOver(w)) return w;
  const club = clubById(w, w.human.club)!;
  const last = club.roster.map((id) => w.players[id]).filter((wp) => (wp.contract?.years ?? 0) === 1);
  const names = last.map((wp) => wp.p.name);
  const text = names.length
    ? `Contracts: ${names.length === 1 ? '1 of your players’ contracts runs' : `${names.length} of your players’ contracts run`} out this summer: ${names.join(', ')}. Before the new season you offer each a new deal or let him go.`
    : 'Contracts: none of your players’ contracts run out this summer.';
  const marked: World = { ...w, play: { ...p, made: { ...(p.made ?? {}), expiring: true } } };
  return addInbox(marked, { day: Math.max(0, p.day), kind: 'news', text });
}

/** Whether your competitions' regular seasons are over (every regular-season game of your leagues played). */
export function regularOver(w: World): boolean {
  const human = w.human?.club;
  const keys = new Set(human ? competitionsOf(w, human).map((c) => (c.kind === 'bigLeague' ? BIG_LEAGUE : c.id)) : []);
  return !playOf(w).games.some((g) => !g.stage && !g.score && (!human || keys.has(g.comp)));
}

/** The next day. */
export function nextDay(w: World): World {
  const p = playOf(w);
  return { ...w, play: { ...p, day: p.day + 1, done: false } };
}

/** Today's games still to play, as engine inputs (yours too, unless `withoutHuman`). */
export function inputsToday(w: World, withoutHuman = false): SimInput[] {
  const p = playOf(w);
  return gamesOn(w, p.day)
    .filter((g) => !g.score && !(withoutHuman && isHumanGame(w, g)))
    .map((g) => inputFor(w, g));
}

/** Why Continue stopped: your game day, the season's first day, something to read (a draw, the postseason, knocked out), a target reached, the end of the season, or the offseason's contract and free-agent screens. */
export type Stop = 'gameDay' | 'firstDay' | 'moment' | 'reached' | 'end' | 'offseason';

/**
 * continue: day by day, stopping for you (GAME_FLOW §3.3). Your games are simulated too in the others:
 * toKey until your next key game, toRegularEnd until the regular season is over, toEnd until the season is.
 */
export type AdvanceMode = 'continue' | 'toKey' | 'toRegularEnd' | 'toEnd';

export interface AdvanceOptions {
  mode?: AdvanceMode;
  /** Old name: the same as mode 'toRegularEnd'. */
  toEnd?: boolean;
  /** After every matchday (autosave, the progress bar). */
  onDay?: (w: World) => void | Promise<void>;
}

/** Your key game today, still to play. */
export function keyGameToday(w: World): SeasonGame | undefined {
  const g = humanGameToday(w);
  return g && isKey(w, g) ? g : undefined;
}

export const isKey = (w: World, g: SeasonGame) => isKeyGame(w, g, table);

/** A moment's lines go to the inbox instead (when simulating ahead, nothing stops for it). */
function momentToInbox(w: World): World {
  const p = playOf(w);
  if (!p.moment) return w;
  return { ...w, play: { ...p, moment: null, inbox: [...p.inbox, { day: Math.max(0, p.day), kind: 'news', text: `${p.moment.title}: ${p.moment.lines.join(' ')}` }] } };
}

/**
 * Continue (GAME_FLOW §3.3): day by day, every game simulated, until your game day (today's other
 * games are then played after yours), the season's first day, or the end of the regular season.
 */
export async function advance(w: World, sim: (inputs: SimInput[]) => Promise<GameOutput[]> | GameOutput[], opts: AdvanceOptions = {}): Promise<{ w: World; stop: Stop }> {
  const mode: AdvanceMode = opts.mode ?? (opts.toEnd ? 'toRegularEnd' : 'continue');
  const stopsFor = (x: World): Stop | null => {
    if (mode === 'continue') return playOf(x).moment ? 'moment' : humanGameToday(x) ? 'gameDay' : null;
    if (mode === 'toKey') return keyGameToday(x) ? 'gameDay' : null;
    return null;
  };
  let cur = w;
  // Before the season: your contracts and free agents first (WORLD_SPEC §7.0).
  if (playOf(cur).offseason) return { w: cur, stop: 'offseason' };
  if (playOf(cur).phase === 'before') {
    cur = beginSeason(cur);
    if (mode === 'continue') return { w: cur, stop: stopsFor(cur) ?? 'firstDay' };
  }
  if (playOf(cur).phase === 'review') return { w: cur, stop: 'end' };
  for (;;) {
    // Simulating ahead nothing stops for news: it goes to the inbox (what the last day brought stays to read).
    if (mode !== 'continue') cur = momentToInbox(cur);
    const p = playOf(cur);
    if (!p.done) {
      const why = stopsFor(cur);
      if (why) return { w: cur, stop: why };
      const inputs = inputsToday(cur);
      if (inputs.length) {
        cur = closeDay(applyOutputs(cur, await sim(inputs)));
        await opts.onDay?.(cur);
      } else cur = closeDay(cur);
      if (playOf(cur).phase === 'review') return { w: cur, stop: 'end' };
      if (mode === 'toRegularEnd' && regularOver(cur)) return { w: cur, stop: 'reached' };
      if (mode === 'continue' && playOf(cur).moment) return { w: cur, stop: 'moment' };
    }
    cur = nextDay(cur);
    const why = stopsFor(cur);
    if (why) return { w: cur, stop: why };
  }
}

/** Your game is played (watched or simulated): it counts, then the rest of the day is played. */
export async function finishGameDay(w: World, mine: GameOutput, sim: (inputs: SimInput[]) => Promise<GameOutput[]> | GameOutput[], mode: SeasonPlay['mode']): Promise<World> {
  let cur = applyOutputs(w, [mine]);
  cur = { ...cur, play: { ...playOf(cur), mode } };
  const rest = inputsToday(cur);
  if (rest.length) cur = applyOutputs(cur, await sim(rest));
  return closeDay(cur);
}

// ---------------------------------------------------------------------------
// Box scores

/** A game's box score, when one is kept (keepsBox): your games, the postseason, the later cup rounds. */
export function boxOf(w: World, g: SeasonGame): [BoxSide, BoxSide] | null {
  if (!g.score) return null;
  return playOf(w).boxes[g.id] ?? null;
}

/** A stored line's numbers as the engine's stats. */
export function statsOf(nums: number[]): PlayerStats {
  const s = emptyStats();
  STAT_KEYS.forEach((k, i) => (s[k] = nums[i]));
  return s;
}

/** The box score as the box score table shows it. */
export function boxScore(w: World, g: SeasonGame, sides: [BoxSide, BoxSide]) {
  return ([0, 1] as const).map((side) => {
    const club = clubById(w, side === 0 ? g.home : g.away)!;
    const b = sides[side];
    const players = b.lines.map(([id, ...nums]) => ({ player: w.players[id].p, starter: b.starters.includes(id), stats: statsOf(nums) }));
    const ordered = [...players.filter((l) => l.starter), ...players.filter((l) => !l.starter)];
    const totals = emptyStats();
    for (const l of ordered) for (const k of STAT_KEYS) totals[k] += l.stats[k];
    return { name: club.name, abbr: club.abbr, score: g.score![side], quarterPoints: b.quarterPoints, players: ordered, totals, extras: b.extras };
  }) as [ReturnType<typeof buildBoxScore>['teams'][0], ReturnType<typeof buildBoxScore>['teams'][1]];
}

// ---------------------------------------------------------------------------
// Tables (slice brief W2a §4): played, won, lost, win %, games behind, points difference, last five.
// Ordered by win %, then head-to-head among the tied clubs (wins, then points difference in those
// games), then points difference, then points scored, then club id (so the same results always give
// the same table).

export interface Row {
  club: string;
  played: number;
  won: number;
  lost: number;
  pct: number;
  behind: number;
  pf: number;
  pa: number;
  diff: number;
  /** Last five, oldest first. */
  last5: ('W' | 'L')[];
}

/** The games that count for a competition's table (a Big League conference: every Big League game of its clubs). */
export function compGames(w: World, compId: string): SeasonGame[] {
  const comp = w.competitions.find((c) => c.id === compId);
  if (!comp || !w.play) return [];
  if (comp.kind === 'bigLeague') {
    const mine = new Set(comp.clubs);
    return w.play.games.filter((g) => g.comp === BIG_LEAGUE && (mine.has(g.home) || mine.has(g.away)));
  }
  return w.play.games.filter((g) => g.comp === compId && !g.stage);
}

const tables = new WeakMap<SeasonGame[], Map<string, Row[]>>();

export function table(w: World, compId: string): Row[] {
  const comp = w.competitions.find((c) => c.id === compId);
  if (!comp) return [];
  const games = w.play?.games;
  if (games) {
    const hit = tables.get(games)?.get(compId);
    if (hit) return hit;
  }
  const rows = standingsOf(comp.clubs, compGames(w, compId).filter((g) => g.score));
  if (games) {
    if (!tables.has(games)) tables.set(games, new Map());
    tables.get(games)!.set(compId, rows);
  }
  return rows;
}

/** A table from played games (only the clubs in `clubs` get a row). */
export function standingsOf(clubs: string[], played: SeasonGame[]): Row[] {
  const rows = new Map<string, Row>(clubs.map((c) => [c, { club: c, played: 0, won: 0, lost: 0, pct: 0, behind: 0, pf: 0, pa: 0, diff: 0, last5: [] }]));
  const ordered = [...played].sort((a, b) => a.day - b.day || a.id - b.id);
  for (const g of ordered) {
    const [hs, as] = g.score!;
    for (const [c, pf, pa] of [
      [g.home, hs, as],
      [g.away, as, hs],
    ] as const) {
      const r = rows.get(c);
      if (!r) continue;
      r.played++;
      r.pf += pf;
      r.pa += pa;
      if (pf > pa) r.won++;
      else r.lost++;
      r.last5 = [...r.last5, pf > pa ? ('W' as const) : ('L' as const)].slice(-5);
    }
  }
  for (const r of rows.values()) {
    r.diff = r.pf - r.pa;
    r.pct = r.played ? r.won / r.played : 0;
  }
  const h2h = (group: Set<string>) => {
    const out = new Map<string, { wins: number; diff: number }>([...group].map((c) => [c, { wins: 0, diff: 0 }]));
    for (const g of played) {
      if (!group.has(g.home) || !group.has(g.away)) continue;
      const [hs, as] = g.score!;
      out.get(g.home)!.wins += hs > as ? 1 : 0;
      out.get(g.away)!.wins += as > hs ? 1 : 0;
      out.get(g.home)!.diff += hs - as;
      out.get(g.away)!.diff += as - hs;
    }
    return out;
  };
  const byPct = new Map<number, Row[]>();
  for (const r of rows.values()) byPct.set(r.pct, [...(byPct.get(r.pct) ?? []), r]);
  const sorted: Row[] = [];
  for (const pct of [...byPct.keys()].sort((a, b) => b - a)) {
    const group = byPct.get(pct)!;
    const hh = h2h(new Set(group.map((r) => r.club)));
    group.sort((a, b) => {
      const ha = hh.get(a.club)!;
      const hb = hh.get(b.club)!;
      return hb.wins - ha.wins || hb.diff - ha.diff || b.diff - a.diff || b.pf - a.pf || (a.club < b.club ? -1 : 1);
    });
    sorted.push(...group);
  }
  const lead = sorted[0];
  for (const r of sorted) r.behind = lead ? (lead.won - r.won + (r.lost - lead.lost)) / 2 : 0;
  return sorted;
}

// ---------------------------------------------------------------------------
// Season totals

export interface SeasonLine extends PlayerStats {
  games: number;
}

/** A player's season numbers: in one competition, or all of them together. */
export function seasonLine(w: World, playerId: string, comp?: string): SeasonLine | null {
  const stats = w.play?.stats;
  if (!stats) return null;
  const keys = comp ? [comp] : Object.keys(stats);
  let found = false;
  const sum = new Array(STAT_KEYS.length + 1).fill(0);
  for (const k of keys) {
    const t = stats[k]?.[playerId];
    if (!t) continue;
    found = true;
    t.forEach((v, i) => (sum[i] += v));
  }
  if (!found) return null;
  return { games: sum[0], ...statsOf(sum.slice(1)) };
}

/** Where a club stands in a competition: "3rd", or "=1st" while nothing has been played. */
export function placeIn(w: World, compId: string, clubId: string): string {
  const rows = table(w, compId);
  const i = rows.findIndex((r) => r.club === clubId);
  if (i < 0) return '—';
  if (!rows.some((r) => r.played)) return '=1st';
  const n = i + 1;
  return `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
}

/** Which side of a game a club is on. */
export const sideOf = (g: SeasonGame, clubId: string): Side => (g.home === clubId ? 0 : 1);
