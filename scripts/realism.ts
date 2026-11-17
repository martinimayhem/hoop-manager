// Realism scorecard: how close our players move to real NBA players.
//
//   npm run realism                    measure, and compare with the saved baseline
//   npm run realism -- --save          ...and make this run the new baseline
//   npm run realism -- --possessions 400 --seed 3
//
// Measures the same things, with the same code (scripts/realism/measure.ts), on real games (the
// 2015-16 SportVU tracking data, downloaded by npm run sportvu on first use) and on simulated
// possessions from our animation (the Frame data the court renderer draws). Each line gets a gap:
// how far ours is from the real value, in percent of it (for shares of time, of at least 5 points).
// The total is the average gap. Lower is better.
//
// The working rule (CLAUDE.md): run it before and after every animation change; a change that
// makes the total worse, or any line clearly worse, is not done. Clearly worse: its gap up by more
// than WORSE_POINTS and by more than two standard errors of the difference (each line's standard
// error comes from batch means, see measure.ts), so a line's noise is not read as a change.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from './args';
import { DEFAULT_GAMES, ensureGames } from './sportvu';
import { gap, gapSe, lines, measure, type Line } from './realism/measure';
import { simTracks } from './realism/sim';
import type { Track } from './realism/track';

/** A line whose gap grows by more than this many points has clearly got worse. */
export const WORSE_POINTS = 5;
const BASELINE = join('scripts', 'realism', 'baseline.json');

interface Result {
  date: string;
  games: string[];
  possessions: number;
  seed: number;
  real: Line[];
  sim: Line[];
  gaps: number[];
  /** Each gap's standard error (points). */
  gapSes: number[];
  total: number;
}

const args = parseArgs(process.argv.slice(2));
const possessions = Number(args.get('possessions') ?? 200);
const seed = Number(args.get('seed') ?? 1);
const games = args.get('games')?.split(',').filter(Boolean) ?? DEFAULT_GAMES;

const files = await ensureGames(games);
const t0 = Date.now();
const realTracks = files.map((f) => JSON.parse(readFileSync(f, 'utf8')) as Track);
const realS = measure(realTracks);
const real = lines(realS);
console.log(`Real: ${games.length} games, ${(realS.liveSeconds / 60).toFixed(0)} min of live ball, ${realS.possessions} possessions, ${realS.shots} shots, measured (${((Date.now() - t0) / 1000).toFixed(0)} s).`);
const t1 = Date.now();
const simS = measure(simTracks(possessions, seed));
const sim = lines(simS);
console.log(`Ours: ${possessions} possessions simulated and measured (${((Date.now() - t1) / 1000).toFixed(0)} s).`);

const gaps = sim.map((l, i) => gap(l, real[i].value));
const gapSes = sim.map((l, i) => gapSe(l, real[i].value));
const valid = gaps.filter(Number.isFinite);
const total = valid.reduce((a, b) => a + b, 0) / Math.max(1, valid.length);
const result: Result = { date: new Date().toISOString().slice(0, 10), games, possessions, seed, real, sim, gaps, gapSes, total };

const base: Result | null = existsSync(BASELINE) ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as Result) : null;
const sameSetup = base && base.possessions === possessions && base.seed === seed && base.games.join() === games.join();
// The baseline's line with the same name (lines can be added or reordered between runs).
const baseIndex = sim.map((l) => (base ? base.sim.findIndex((b) => b.name === l.name) : -1));
// The total over the lines the baseline has too, so that adding a line never reads as a change.
const common = gaps.filter((g, i) => baseIndex[i] >= 0 && Number.isFinite(g));
const commonTotal = common.reduce((a, b) => a + b, 0) / Math.max(1, common.length);

// The table.
const fmt = (v: number) => (Number.isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)) : '–');
const pad = (s: string, w: number) => (s.length >= w ? s : s + ' '.repeat(w - s.length));
const lpad = (s: string, w: number) => (s.length >= w ? s : ' '.repeat(w - s.length) + s);
const W = 58;
console.log('');
console.log(`${pad('', W)} ${lpad('real', 7)} ${lpad(base ? 'base' : '', 7)} ${lpad('ours', 7)} ${lpad(base ? 'gap was' : '', 8)} ${lpad('gap', 6)} ${lpad('±', 5)}`);
let group = '';
const worse: string[] = [];
sim.forEach((l, i) => {
  if (l.group !== group) {
    group = l.group;
    console.log(`\n${group}`);
  }
  const bi = baseIndex[i];
  const was = sameSetup && bi >= 0 ? base!.gaps[bi] : NaN;
  let mark = '';
  if (Number.isFinite(was) && Number.isFinite(gaps[i])) {
    const noise = 2 * Math.hypot(gapSes[i], base!.gapSes?.[bi] ?? 0);
    if (gaps[i] > was + Math.max(WORSE_POINTS, noise)) {
      mark = '  WORSE';
      worse.push(l.name);
    } else if (gaps[i] < was - Math.max(WORSE_POINTS, noise)) mark = '  better';
  }
  const label = `  ${l.name} (${l.unit})`;
  console.log(
    `${pad(label, W)} ${lpad(fmt(real[i].value), 7)} ${lpad(sameSetup && bi >= 0 ? fmt(base!.sim[bi].value) : sameSetup ? 'new' : '', 7)} ${lpad(fmt(l.value), 7)} ${lpad(sameSetup && bi >= 0 ? `${fmt(was)}%` : '', 8)} ${lpad(`${fmt(gaps[i])}%`, 6)} ${lpad(Number.isFinite(gapSes[i]) ? gapSes[i].toFixed(1) : '', 5)}${mark}`,
  );
});
console.log('');
console.log(`${pad('TOTAL (average gap, lower is better)', W)} ${lpad('', 7)} ${lpad('', 7)} ${lpad('', 7)} ${lpad('', 8)} ${lpad(`${fmt(total)}%`, 6)}`);
if (sameSetup) console.log(`${pad("  over the baseline's lines", W)} ${lpad('', 7)} ${lpad('', 7)} ${lpad('', 7)} ${lpad(`${fmt(base!.total)}%`, 8)} ${lpad(`${fmt(commonTotal)}%`, 6)}`);
console.log(`\nOurs: ${(simS.liveSeconds / 60).toFixed(1)} min of live ball, ${simS.possessions} possessions, ${simS.shots} shots.`);
console.log(`Samples per line (real/ours): ${real.map((l, i) => `${l.n}/${sim[i].n}`).join('  ')}`);
if (base && !sameSetup) console.log(`(Baseline is for a different setup: ${base.possessions} possessions, seed ${base.seed}; not compared.)`);
if (sameSetup) {
  const totalWorse = commonTotal > base!.total + 0.01;
  if (totalWorse || worse.length) {
    console.log(`\nNOT DONE: ${totalWorse ? `total worse (${fmt(base!.total)}% → ${fmt(commonTotal)}%)` : ''}${worse.length ? `${totalWorse ? '; ' : ''}clearly worse: ${worse.join('; ')}` : ''}.`);
    process.exitCode = 1;
  } else console.log(`\nOK: total ${fmt(base!.total)}% → ${fmt(commonTotal)}% over the baseline's lines, no line clearly worse.`);
}
if (args.has('save')) {
  writeFileSync(BASELINE, JSON.stringify(result, null, 2) + '\n');
  console.log(`Saved as the baseline (${BASELINE}).`);
}
