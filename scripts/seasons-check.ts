// Seasons in a row, every game simulated (slice brief W2b §9; WORLD_SPEC §13 "Until W3"): competition
// sizes, champions, time per season, the compressed save size after each rollover, and contracts:
// squads at 13 every season and no US Division 4 or second-tier club signing a player of standing 80+
// (both fail the run); the average wage and the price per league (tables, season 1 to n, with the
// season 1–3 change) and how many of the top-100 free agents sign: reported only (owner, 21 Nov 2026:
// the wage check is judged from W3, when youth and retirements keep the population steady).
//   npx tsx scripts/seasons-check.ts [seed] [seasons]
import { createWorld } from '../src/game/world/generate';
import { takeOver } from '../src/game/world/query';
import { encode, WORLD_FORMAT } from '../src/game/world/saves';
import type { World } from '../src/game/world/types';
import { advance, beginSeason, playOf, simulateInputs, startSeason } from '../src/game/season/play';
import { cupsOf } from '../src/game/season/post';
import { startNextSeason } from '../src/game/season/rollover';
import { autoOffseason, ovr, SQUAD } from '../src/game/season/contracts';

const seed = Number(process.argv[2] ?? 7);
const n = Number(process.argv[3] ?? 3);
let w = createWorld(seed);
w = startSeason(takeOver(w, w.competitions.find((c) => c.id === 'big-league-europe')!.clubs[0]));
const SIZE: Record<string, number> = { bigLeague: 0, usDivision: 16, nationalLeague: 12 };
const want = (c: World['competitions'][number]) => (c.id === 'big-league-america' ? 18 : c.id === 'big-league-europe' ? 12 : SIZE[c.kind]);
const errors: string[] = [];
const fail = (s: string) => {
  errors.push(s);
  console.log(`  FAIL ${s}`);
};
const saveBytes = async (x: World) => (await encode({ format: WORLD_FORMAT, kind: 'world', savedAt: '', summary: {}, data: x })).length;

/** Average first-team wage per league (a Big League club: its conference), and every club's squad size. */
function wages(x: World): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of x.competitions) {
    if (c.kind === 'cup') continue;
    // Big League Europe clubs count in the Big League, not in their national league.
    const ids = c.kind === 'nationalLeague' ? c.clubs.filter((id) => !x.competitions.some((b) => b.kind === 'bigLeague' && b.clubs.includes(id))) : c.clubs;
    const ws = ids.flatMap((id) => x.clubs.find((k) => k.id === id)!.roster.map((p) => x.players[p].contract?.wage ?? 0));
    if (ws.length) out[c.id] = ws.reduce((a, b) => a + b, 0) / ws.length;
  }
  return out;
}
/** Per league, the average of wage ÷ market wage (what a player of his overall costs there): the price, without who plays where. */
function prices(x: World): Record<string, number> {
  const k = x.market!;
  const out: Record<string, number> = {};
  for (const c of x.competitions) {
    if (c.kind === 'cup') continue;
    const ids = c.kind === 'nationalLeague' ? c.clubs.filter((id) => !x.competitions.some((b) => b.kind === 'bigLeague' && b.clubs.includes(id))) : c.clubs;
    const rs = ids.flatMap((id) => x.clubs.find((q) => q.id === id)!.roster.map((p) => (x.players[p].contract?.wage ?? 0) / Math.exp(k.a + k.b * ovr(x.players[p]))));
    if (rs.length) out[c.id] = rs.reduce((a, b) => a + b, 0) / rs.length;
  }
  return out;
}
function squads(x: World, when: string) {
  const bad = x.clubs.filter((c) => c.roster.length !== SQUAD);
  if (bad.length) fail(`${when}: ${bad.length} clubs without ${SQUAD} players (${bad.slice(0, 3).map((c) => `${c.name} ${c.roster.length}`).join(', ')})`);
}

const table: Record<string, number>[] = [wages(w)];
const priceTable: Record<string, number>[] = [prices(w)];
const seasonsMs: number[] = [];
squads(w, `season ${w.season}`);
for (let s = 0; s < n; s++) {
  try {
    const t = performance.now();
    const r = await advance(w, simulateInputs, { mode: 'toEnd' });
    w = r.w;
    const ms = performance.now() - t;
    seasonsMs.push(ms);
    const p = playOf(w);
    const sizes = w.competitions.filter((c) => c.clubs.length !== want(c)).map((c) => `${c.id}:${c.clubs.length}`);
    if (sizes.length) fail(`season ${w.season}: wrong sizes ${sizes.join(' ')}`);
    if (p.phase !== 'review') fail(`season ${w.season}: ended in phase ${p.phase}`);
    console.log(`Season ${w.season}: ${(ms / 1000).toFixed(1)} s, ${p.games.filter((g) => !g.off).length} games, phase ${p.phase}; wrong sizes: ${sizes.length ? sizes.join(' ') : 'none'}; cups ${cupsOf(w).length}`);
    const t2 = performance.now();
    w = startNextSeason(w);
    const a = w.history![w.history!.length - 1];
    if (Object.keys(a.champions).length < 10) fail(`season ${a.season}: only ${Object.keys(a.champions).length} champions recorded`);
    const off = autoOffseason(w);
    w = off.w;
    const rollMs = performance.now() - t2;
    const rep = off.report;
    const small80 = rep.signings.filter((x) => x.standing >= 80 && (x.level === 'us4' || x.level === 'n2'));
    if (small80.length)
      fail(
        `season ${w.season}: ${small80.length} players of standing 80+ signed by a US Division 4 or second-tier club: ${small80
          .map((x) => {
            const wp = w.players[x.player];
            const c = w.clubs.find((k) => k.id === x.club)!;
            return `${wp.p.name} (standing ${x.standing.toFixed(1)}, age ${w.season - wp.born}, overall ${ovr(wp).toFixed(0)}, reputation ${wp.reputation}, nationality ${wp.nationality}) to ${c.name} (${x.level}, ${c.country}) in round ${x.round} for ${(x.wage / 1e6).toFixed(2)}M`;
          })
          .join('; ')}`,
      );
    if (rep.forced) fail(`season ${w.season}: ${rep.forced} signings had to ignore interest to reach ${SQUAD}`);
    squads(w, `season ${w.season}`);
    if (playOf(beginSeason(w)).phase !== 'regular') fail(`season ${w.season}: can't begin`);
    const sizes2 = w.competitions.filter((c) => c.clubs.length !== want(c));
    if (sizes2.length) fail(`after rollover: wrong sizes ${sizes2.map((c) => `${c.id}:${c.clubs.length}`).join(' ')}`);
    const bytes = await saveBytes(w);
    table.push(wages(w));
    priceTable.push(prices(w));
    console.log(
      `  rollover to ${w.season}: ${(rollMs / 1000).toFixed(1)} s; archived ${a.season} (champions ${Object.keys(a.champions).length}, BL ${a.champions['big-league-final']}); ` +
        `contracts: ${rep.resigned} re-signed, ${rep.left} left, ${rep.signings.length} free agents signed (rounds ${[1, 2, 3].map((k) => rep.signings.filter((x) => x.round === k).length).join('/')}), ` +
        `top-100 free agents signed ${rep.top100Signed}; squads ${SQUAD}: ${w.clubs.every((c) => c.roster.length === SQUAD) ? 'all' : 'NO'}; compressed save ${(bytes / 1024 / 1024).toFixed(2)} MB`,
    );
  } catch (e) {
    fail(`season ${w.season}: ${e instanceof Error ? e.stack : String(e)}`);
    break;
  }
}

// The average wage per league, season by season (reported; WORLD_SPEC §13 judges it from W3).
const leagues = Object.keys(table[0]);
const short = (id: string) => id.replace('big-league-', 'BL-').replace('us-division-', 'US').replace('-league-', '');
console.log(`\nAverage first-team wage per league ($M), season 1 to ${table.length}:`);
console.log(['season', ...leagues.map(short)].join('\t'));
table.forEach((row, i) => console.log([String(i + 1), ...leagues.map((l) => ((row[l] ?? 0) / 1e6).toFixed(2))].join('\t')));
if (table.length >= 3) {
  const off3 = leagues.filter((l) => Math.abs(table[2][l] / table[0][l] - 1) > 0.1);
  console.log(`\nWage stability, season 3 against season 1 (±10% per league; reported, judged from W3): ${off3.length ? `OUT in ${off3.map((l) => `${short(l)} ${((table[2][l] / table[0][l] - 1) * 100).toFixed(1)}%`).join(', ')}` : 'all within'}`);
  const worst = leagues.map((l) => [l, table[2][l] / table[0][l] - 1] as const).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  console.log(`  largest change by season 3: ${short(worst[0])} ${(worst[1] * 100).toFixed(1)}%`);
}
console.log(`\nPrice per league (average wage ÷ market wage for the player's overall), season 1 to ${priceTable.length}:`);
console.log(['season', ...leagues.map(short)].join('\t'));
priceTable.forEach((row, i) => console.log([String(i + 1), ...leagues.map((l) => (row[l] ?? 0).toFixed(2))].join('\t')));
if (priceTable.length >= 3) {
  const p3 = leagues.filter((l) => Math.abs(priceTable[2][l] / priceTable[0][l] - 1) > 0.1);
  console.log(`Price stability, season 3 against season 1 (±10%, reported): ${p3.length ? `OUT in ${p3.map((l) => `${short(l)} ${((priceTable[2][l] / priceTable[0][l] - 1) * 100).toFixed(1)}%`).join(', ')}` : 'all within'}`);
}
const avg = seasonsMs.reduce((a, b) => a + b, 0) / Math.max(1, seasonsMs.length);
console.log(`\nAfter ${seasonsMs.length} seasons: ${(avg / 1000).toFixed(1)} s a season on average (Node); save ${((await saveBytes(w)) / 1024 / 1024).toFixed(2)} MB compressed`);
console.log(errors.length ? `${errors.length} FAILURES` : 'No errors.');
if (errors.length) process.exitCode = 1;
