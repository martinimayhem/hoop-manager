// From one season into the next (slice brief W2b §6–§7, WORLD_SPEC §1.2, §10.1; GAME_FLOW §4.3).
//
// At the end of a season: who won what; promotion and relegation in America and in each country
// (bottom 2 down, the champion and the playoff winner up; licence clubs exempt nationally; Portugal one
// tier); Big League Europe licences (lost at a third bottom-2 finish within the last 5 seasons, to that
// season's best wildcard club) and the 2 wildcards; money that follows the tier, with the parachute;
// the season archived; each player's season added to his career. Then a new season with new
// schedules. Players don't develop yet (W3); contracts count down and the offseason opens: the
// contract screen, then the free-agent screen (WORLD_SPEC §7.0, contracts.ts).

import { MID_LEVEL } from '../world/money';
import { levelBudget } from '../world/generate';
import { clubById } from '../world/query';
import type { Competition, World, WorldClub } from '../world/types';
import { BL_AMERICA, BL_EUROPE, BL_FINAL, cupsOf } from './post';
import { playOf, startSeason, table, type Row } from './play';
import { BIG_LEAGUE, STAT_KEYS, type SeasonArchive } from './types';
import { countDown, openOffseason } from './contracts';

/** How many seasons count for a licence's bottom-2 finishes, and how many lose it. */
export const LICENCE_WINDOW = 5;
export const LICENCE_STRIKES = 3;
/** The cap system's money, as a "budget" for the parachute of a club leaving the Big League America. */
const CAP_AS_BUDGET = 100e6;

export interface Movements {
  /** Competition (league, cup, 'big-league-final') → its champion. */
  champions: Record<string, string>;
  /** Club → the league it moves to. */
  moves: { club: string; from: string; to: string; up: boolean }[];
  licenceLost: string[];
  licenceWon: string[];
  /** Next season's two wildcards. */
  wildcards: string[];
  /** Licence clubs that finished in the Europe conference's bottom 2 this season. */
  bottomTwo: string[];
}

const winnerOf = (w: World, comp: string, round: string) => playOf(w).ties?.find((t) => t.comp === comp && t.round === round)?.winner;

/** Who won what this season, and who goes up and down. Pure: read from a finished season. */
export function movements(w: World): Movements {
  const champions: Record<string, string> = {};
  const moves: Movements['moves'] = [];
  const am = winnerOf(w, BL_AMERICA, 'cf');
  const eu = winnerOf(w, BL_EUROPE, 'ff-final');
  const final = winnerOf(w, BL_FINAL, 'bl-final');
  if (am) champions[BL_AMERICA] = am;
  if (eu) champions[BL_EUROPE] = eu;
  if (final) champions[BL_FINAL] = final;
  for (const cup of cupsOf(w)) {
    const c = winnerOf(w, cup.id, 'ff-final');
    if (c) champions[cup.id] = c;
  }
  const order = (id: string) => table(w, id).map((r) => r.club);
  // America: the Big League's bottom 2 and Division 2's champion and playoff winner; and so on down.
  const ladder = [BL_AMERICA, 'us-division-2', 'us-division-3', 'us-division-4'].filter((id) => w.competitions.some((c) => c.id === id));
  for (const id of ladder.slice(1)) champions[id] = order(id)[0];
  for (let i = 0; i + 1 < ladder.length; i++) {
    const upper = ladder[i];
    const lower = ladder[i + 1];
    for (const club of order(upper).slice(-2)) moves.push({ club, from: upper, to: lower, up: false });
    const ups = [order(lower)[0], winnerOf(w, lower, 'promo-final')].filter((c): c is string => !!c);
    for (const club of ups) moves.push({ club, from: lower, to: upper, up: true });
  }
  // Each country: tier 1's bottom 2 (licence clubs exempt: the next club drops instead) and tier 2's champion and playoff winner.
  const countries = [...new Set(w.competitions.filter((c) => c.kind === 'nationalLeague').map((c) => c.country!))];
  for (const cc of countries) {
    const t1 = w.competitions.find((c) => c.kind === 'nationalLeague' && c.country === cc && c.tier === 1);
    const t2 = w.competitions.find((c) => c.kind === 'nationalLeague' && c.country === cc && c.tier === 2);
    if (t1) {
      const title = winnerOf(w, t1.id, 'final');
      if (title) champions[t1.id] = title;
    }
    if (!t1 || !t2) continue;
    champions[t2.id] = order(t2.id)[0];
    const down = order(t1.id)
      .filter((c) => clubById(w, c)!.licence !== 'licence')
      .slice(-2);
    for (const club of down) moves.push({ club, from: t1.id, to: t2.id, up: false });
    for (const club of [order(t2.id)[0], winnerOf(w, t2.id, 'promo-final')].filter((c): c is string => !!c)) moves.push({ club, from: t2.id, to: t1.id, up: true });
  }
  // Big League Europe: the bottom 2's licence strikes; licences lost at the third within 5 seasons.
  const euRows = table(w, BL_EUROPE).map((r) => r.club);
  const bottomTwo = euRows.slice(-2).filter((c) => clubById(w, c)!.licence === 'licence');
  const licenceLost = bottomTwo.filter((c) => strikes(w, c, true) >= LICENCE_STRIKES);
  // Wildcard candidates: first-tier clubs (Portugal's too) without a licence: national champions first, then national-league record.
  const tier1 = w.competitions.filter((c) => c.kind === 'nationalLeague' && c.tier === 1);
  const record = new Map<string, Row>();
  for (const c of tier1) for (const r of table(w, c.id)) record.set(r.club, r);
  const titles = new Set(tier1.map((c) => champions[c.id]).filter(Boolean));
  const relegated = new Set(moves.filter((m) => !m.up).map((m) => m.club));
  const candidates = [...record.keys()]
    .filter((c) => clubById(w, c)!.licence !== 'licence' && !relegated.has(c))
    .sort((a, b) => Number(titles.has(b)) - Number(titles.has(a)) || record.get(b)!.pct - record.get(a)!.pct || record.get(b)!.diff - record.get(a)!.diff || (a < b ? -1 : 1));
  const licenceWon = candidates.slice(0, licenceLost.length);
  const wildcards = candidates.slice(licenceLost.length, licenceLost.length + 2);
  return { champions, moves, licenceLost, licenceWon, wildcards, bottomTwo };
}

/** A licence club's bottom-2 finishes within the last 5 seasons (this one included when `withThis`). */
export function strikes(w: World, clubId: string, withThis = false): number {
  const club = clubById(w, clubId)!;
  const seasons = (club.bottomTwoSeasons ?? []).filter((s) => s > w.season - LICENCE_WINDOW);
  return seasons.length + (withThis ? 1 : 0);
}

// ---------------------------------------------------------------------------

type Level = 'blA' | 'blE' | 'us2' | 'us3' | 'us4' | 'n1' | 'n2';
const HEIGHT: Record<Level, number> = { blA: 5, blE: 5, us2: 3, us3: 2, us4: 1, n1: 3, n2: 1 };

function levelOf(comps: Competition[], club: WorldClub): Level {
  if (comps.find((c) => c.id === BL_AMERICA)?.clubs.includes(club.id)) return 'blA';
  if (comps.find((c) => c.id === BL_EUROPE)?.clubs.includes(club.id)) return 'blE';
  const league = comps.find((c) => (c.kind === 'usDivision' || c.kind === 'nationalLeague') && c.clubs.includes(club.id));
  if (!league) return 'n2';
  if (league.kind === 'usDivision') return `us${league.tier}` as Level;
  return league.tier === 1 ? 'n1' : 'n2';
}

/** The season archived (slice W2b §7): tables, champions, movements, every result, and the boxes of your games and every Final. */
function archive(w: World, m: Movements): SeasonArchive {
  const p = playOf(w);
  const tables: SeasonArchive['tables'] = {};
  for (const c of w.competitions) tables[c.id] = table(w, c.id).map((r) => [r.club, r.won, r.lost, r.pf, r.pa]);
  const finals = new Set(['cf', 'ff-final', 'final', 'bl-final', 'promo-final']);
  const results: SeasonArchive['results'] = [];
  const boxes: SeasonArchive['boxes'] = {};
  const human = w.human?.club;
  for (const g of p.games) {
    if (g.off || !g.score) continue;
    const round = g.tie?.split('|')[1] ?? '';
    const keep = (human && (g.home === human || g.away === human)) || finals.has(round);
    if (keep && p.boxes[g.id]) boxes[results.length] = p.boxes[g.id];
    results.push([g.comp, g.day, g.home, g.away, g.score[0], g.score[1], g.stage ?? '']);
  }
  return {
    season: w.season,
    tables,
    champions: m.champions,
    promoted: m.moves.filter((x) => x.up).map((x) => x.club),
    relegated: m.moves.filter((x) => !x.up).map((x) => x.club),
    licenceLost: m.licenceLost,
    wildcards: m.wildcards,
    results,
    boxes,
    ...(human ? { human } : {}),
  };
}

/** "Start the next season": everything above, then a new season with new schedules. */
export function startNextSeason(w: World): World {
  const p = playOf(w);
  if (p.phase !== 'review') throw new Error('The season is not over');
  const m = movements(w);
  const arch = archive(w, m);

  // Each player's season, all competitions together, into his career.
  const players = { ...w.players };
  const totals = new Map<string, number[]>();
  for (const table of Object.values(p.stats))
    for (const [id, t] of Object.entries(table)) {
      const sum = totals.get(id) ?? new Array(STAT_KEYS.length + 1).fill(0);
      totals.set(
        id,
        sum.map((v, i) => v + t[i]),
      );
    }
  for (const [id, t] of totals) {
    const wp = players[id];
    if (!wp) continue;
    players[id] = { ...wp, career: [...(wp.career ?? []), { season: w.season, club: wp.club ?? '', t }] };
  }

  // The leagues' new members.
  const comps = w.competitions.map((c) => ({ ...c, clubs: [...c.clubs] }));
  const byId = (id: string) => comps.find((c) => c.id === id)!;
  for (const mv of m.moves) {
    const from = byId(mv.from);
    const to = byId(mv.to);
    from.clubs = from.clubs.filter((c) => c !== mv.club);
    to.clubs.push(mv.club);
  }
  // Big League Europe: 10 licences (a lost one passed on) and the 2 new wildcards.
  const clubs = w.clubs.map((c) => ({ ...c }));
  const club = (id: string) => clubs.find((c) => c.id === id)!;
  const season = w.season;
  for (const id of m.bottomTwo) {
    const c = club(id);
    c.bottomTwoSeasons = [...(c.bottomTwoSeasons ?? []), season].filter((s) => s > season - LICENCE_WINDOW);
  }
  for (const c of clubs) {
    c.bottomTwoSeasons = (c.bottomTwoSeasons ?? []).filter((s) => s > season + 1 - LICENCE_WINDOW);
    c.bottomTwoFinishes = c.bottomTwoSeasons.length;
    if (!c.bottomTwoSeasons.length) delete c.bottomTwoSeasons;
  }
  for (const id of m.licenceLost) {
    club(id).licence = null;
    delete club(id).bottomTwoSeasons;
    club(id).bottomTwoFinishes = 0;
  }
  for (const id of m.licenceWon) club(id).licence = 'licence';
  for (const c of clubs) if (c.licence === 'wildcard') c.licence = null;
  for (const id of m.wildcards) club(id).licence = 'wildcard';
  const eu = byId(BL_EUROPE);
  eu.clubs = clubs.filter((c) => c.region === 'europe' && c.licence).map((c) => c.id);

  // Money follows the tier (GAME_FLOW §4.3, WORLD_SPEC §10.1): a club that drops keeps 50% of the gap, then 25%.
  for (const c of clubs) {
    const before = levelOf(w.competitions, w.clubs.find((x) => x.id === c.id)!);
    const after = levelOf(comps, c);
    const league = comps.find((x) => x.clubs.includes(c.id) && x.id !== BL_EUROPE) ?? eu;
    const peers = league.clubs.map((id) => clubs.find((x) => x.id === id)!).sort((a, b) => b.reputation - a.reputation);
    const rank = peers.length > 1 ? peers.findIndex((x) => x.id === c.id) / (peers.length - 1) : 0;
    if (after === 'blA') {
      if (before !== 'blA') Object.assign(c, { moneySystem: 'cap', budget: 0, midLevelLeft: MID_LEVEL });
      delete c.parachute;
      continue;
    }
    const base = levelBudget(after, c.country, Math.max(0, rank));
    if (before !== after) {
      const old = before === 'blA' ? CAP_AS_BUDGET : c.budget;
      const gap = Math.max(0, old - base);
      c.moneySystem = 'budget';
      c.midLevelLeft = 0;
      if (HEIGHT[after] < HEIGHT[before] && gap > 0) {
        c.budget = Math.round(base + gap * 0.5);
        c.parachute = { gap, seasons: 1 };
      } else {
        c.budget = base;
        delete c.parachute;
      }
    } else if (c.parachute) {
      c.budget = Math.round(base + c.parachute.gap * 0.25);
      if (c.parachute.seasons <= 1) delete c.parachute;
      else c.parachute = { ...c.parachute, seasons: c.parachute.seasons - 1 };
    } else if (c.moneySystem === 'cap') {
      c.midLevelLeft = MID_LEVEL;
    }
  }
  for (const c of clubs) if (c.moneySystem === 'cap') c.midLevelLeft = MID_LEVEL;

  const next: World = countDown({
    ...w,
    season: w.season + 1,
    clubs,
    competitions: comps,
    players,
    history: [...(w.history ?? []), arch],
    play: undefined,
  });
  // Your plan and how you like to play carry over (a plan that no longer fits the squad is made again).
  const fresh = startSeason(next);
  return openOffseason({ ...fresh, play: { ...playOf(fresh), plan: p.plan, mode: p.mode } });
}

/** Whether a competition is one of the Big League's (for screens). */
export const isBigLeague = (id: string) => id === BL_AMERICA || id === BL_EUROPE || id === BIG_LEAGUE || id === BL_FINAL;
