// Tactics lab: does the manager matter, and is nothing broken? Plays many seeded games (in pairs with
// the sides swapped, which cancels home and tip-off luck) and reports:
//
//   1. rock-paper-scissors: every offence × defence plan against every other;
//   2. tempo and defensive intensity head to head;
//   3. extreme lineups: five centres, five guards, against a balanced team of the same rating;
//   4. fatigue: no bench, stamina;
//   5. fouling: defensive intensity against good and poor free-throw shooting and ball handling;
//   6. the manager's impact: a scouted plan against a random one, the best counter against the worst.
//
//   npm run tactics                       about 30,000 games (a minute or two)
//   npm run tactics -- --games 40 --seed 3
//
// A win rate is the first team's, over the pairs. 50% is no edge; the target for tactics is that no
// plan wins more than about 60% against the field, and that each has something that beats it.

import { HARBOR_HAMMERS, SKYLINE_SPARKS, mirrorTeam } from '../src/data/teams';
import { composite, makePlan, simulateMatch } from '../src/engine';
import { createRng, pick } from '../src/engine/rng';
import { AGGRESSIONS, DEFENCE_SCHEMES, OFFENSIVE_FOCI, TEMPOS, type GamePlan, type Player, type Position, type Team } from '../src/engine/types';
import { aiGamePlan } from '../src/game/ai';
import { curatedPlayers } from '../src/game/pool';
import { parseArgs } from './args';

const args = parseArgs(process.argv.slice(2));
const GAMES = Math.max(4, Number(args.get('games') ?? 60));
const SEED = Number(args.get('seed') ?? 1);
/** --sections 2,5: only those parts (default all). */
const SECTIONS = new Set((args.get('sections') ?? '1,2,3,4,5,6').split(',').map(Number));

interface Result {
  win: number;
  games: number;
  /** Per team per game, the first team's and the second's. */
  pts: [number, number];
  fouls: [number, number];
  fta: [number, number];
  tov: [number, number];
  oreb: [number, number];
  foulOuts: [number, number];
  /** Points per possession in the fourth quarter (fatigue shows late). */
  q4: [number, number];
}

/** `games` games (pairs, sides swapped) of team A with plan pa against team B with plan pb. */
function play(a: Team, pa: GamePlan, b: Team, pb: GamePlan, games = GAMES, seed = SEED): Result {
  const r: Result = { win: 0, games: 0, pts: [0, 0], fouls: [0, 0], fta: [0, 0], tov: [0, 0], oreb: [0, 0], foulOuts: [0, 0], q4: [0, 0] };
  for (let g = 0; g < games; g++) {
    const swap = g % 2 === 1;
    const s = seed * 100_003 + Math.floor(g / 2);
    const m = swap ? simulateMatch(b, a, pb, pa, s) : simulateMatch(a, b, pa, pb, s);
    const side = (k: 0 | 1) => (swap ? (1 - k) as 0 | 1 : k);
    const st = m.state;
    r.games++;
    if (m.winner === side(0)) r.win++;
    for (const k of [0, 1] as const) {
      const t = st.teams[side(k)];
      const box = m.box.teams[side(k)].totals;
      r.pts[k] += t.score;
      r.fouls[k] += box.pf;
      r.fta[k] += box.fta;
      r.tov[k] += box.tov;
      r.oreb[k] += box.oreb;
      r.foulOuts[k] += Object.values(t.players).filter((p) => p.fouledOut && !p.ejected).length;
      r.q4[k] += t.quarterPoints[3] ?? 0;
    }
  }
  for (const k of ['pts', 'fouls', 'fta', 'tov', 'oreb', 'foulOuts', 'q4'] as const) r[k] = [r[k][0] / r.games, r[k][1] / r.games];
  return r;
}

const pct = (r: Result) => `${((100 * r.win) / r.games).toFixed(1)}%`;
const n1 = (x: number) => x.toFixed(1);
const line = (label: string, r: Result) =>
  `  ${label.padEnd(44)} ${pct(r).padStart(6)}   pts ${n1(r.pts[0])}–${n1(r.pts[1])}   fouls ${n1(r.fouls[0])}–${n1(r.fouls[1])}   FTA ${n1(r.fta[0])}–${n1(r.fta[1])}   TOV ${n1(r.tov[0])}–${n1(r.tov[1])}   OREB ${n1(r.oreb[0])}–${n1(r.oreb[1])}   fouled out ${r.foulOuts[0].toFixed(2)}–${r.foulOuts[1].toFixed(2)}`;

const ham = HARBOR_HAMMERS;
const hamM = mirrorTeam(HARBOR_HAMMERS, 'HAM2');
const sky = SKYLINE_SPARKS;
const skyM = mirrorTeam(SKYLINE_SPARKS, 'SKY2');
const mirrors: [Team, Team][] = [
  [ham, hamM],
  [sky, skyM],
];
const t0 = Date.now();
const out: string[] = [];
const say = (s = '') => {
  out.push(s);
  console.log(s);
};

// ---------------------------------------------------------------------------
if (SECTIONS.has(1)) {
say(`Tactics lab: ${GAMES} games a match-up (pairs, sides swapped), seed ${SEED}. Win rates are the first team's.`);
say();
say('1. Rock-paper-scissors: every offence × defence plan (tempo normal) against every other, mirror rosters');
const plans = OFFENSIVE_FOCI.flatMap((offence) => DEFENCE_SCHEMES.map((defence) => ({ offence, defence })));
const label = (p: { offence: string; defence: string }) => `${p.offence}+${p.defence}`;
const wins = plans.map(() => plans.map(() => 0));
for (let i = 0; i < plans.length; i++) {
  for (let j = i + 1; j < plans.length; j++) {
    let w = 0;
    let g = 0;
    for (const [a, b] of mirrors) {
      const r = play(a, makePlan(a, plans[i]), b, makePlan(b, plans[j]), Math.round(GAMES / 2), SEED + i * 31 + j);
      w += r.win;
      g += r.games;
    }
    wins[i][j] = w / g;
    wins[j][i] = 1 - w / g;
  }
}
const rows = plans.map((p, i) => {
  const others = wins[i].filter((_, j) => j !== i);
  const mean = others.reduce((s, x) => s + x, 0) / others.length;
  const worst = others.indexOf(Math.min(...others));
  const best = others.indexOf(Math.max(...others));
  const idx = (k: number) => (k >= i ? k + 1 : k);
  return { p, mean, worst: idx(worst), worstWin: Math.min(...others), best: idx(best), bestWin: Math.max(...others) };
});
say('  Plan                     vs the field   beaten most by (its win %)            beats most (its win %)');
for (const r of [...rows].sort((a, b) => b.mean - a.mean)) {
  say(`  ${label(r.p).padEnd(24)} ${(100 * r.mean).toFixed(1).padStart(6)}%      ${label(plans[r.worst]).padEnd(22)} ${(100 * r.worstWin).toFixed(1).padStart(5)}%      ${label(plans[r.best]).padEnd(22)} ${(100 * r.bestWin).toFixed(1).padStart(5)}%`);
}
// Offence focus against defence scheme: the offence plan's average win rate against plans using that defence.
say();
say('  Offence focus (rows) against the opponent\'s defence (columns): win % of the offence\'s plans');
say(`  ${''.padEnd(14)}${DEFENCE_SCHEMES.map((d) => d.padStart(9)).join('')}`);
for (const o of OFFENSIVE_FOCI) {
  const cells = DEFENCE_SCHEMES.map((d) => {
    let s = 0;
    let n = 0;
    plans.forEach((pi, i) =>
      plans.forEach((pj, j) => {
        if (i !== j && pi.offence === o && pj.defence === d) {
          s += wins[i][j];
          n++;
        }
      }),
    );
    return `${((100 * s) / n).toFixed(1)}%`.padStart(9);
  });
  say(`  ${o.padEnd(14)}${cells.join('')}`);
}

}
// ---------------------------------------------------------------------------
if (SECTIONS.has(2)) {
say();
say('2. Tempo and defensive intensity head to head (all else equal, mirror rosters)');
for (const [dim, opts] of [
  ['tempo', TEMPOS],
  ['aggression', AGGRESSIONS],
] as const) {
  for (let i = 0; i < opts.length; i++) {
    for (let j = i + 1; j < opts.length; j++) {
      let agg: Result | null = null;
      for (const [a, b] of mirrors) {
        const r = play(a, makePlan(a, { [dim]: opts[i] }), b, makePlan(b, { [dim]: opts[j] }), Math.round(GAMES), SEED + i * 7 + j);
        agg = agg ? merge(agg, r) : r;
      }
      say(line(`${dim}: ${opts[i]} vs ${opts[j]}`, agg!));
    }
  }
}

}

function merge(a: Result, b: Result): Result {
  const avg = (x: [number, number], y: [number, number]): [number, number] => [(x[0] * a.games + y[0] * b.games) / (a.games + b.games), (x[1] * a.games + y[1] * b.games) / (a.games + b.games)];
  return { win: a.win + b.win, games: a.games + b.games, pts: avg(a.pts, b.pts), fouls: avg(a.fouls, b.fouls), fta: avg(a.fta, b.fta), tov: avg(a.tov, b.tov), oreb: avg(a.oreb, b.oreb), foulOuts: avg(a.foulOuts, b.foulOuts), q4: avg(a.q4, b.q4) };
}

// ---------------------------------------------------------------------------
if (SECTIONS.has(3)) {
say();
say('3. Extreme lineups against a balanced team of about the same rating (hand-made players)');
const pool = curatedPlayers().map((p) => p.player);
const ovr = (p: Player) => composite(p).overall;
/** 12 players: these positions for the first five, then the bench, all close to `target` overall. */
function build(id: string, name: string, five: Position[], benchPositions: Position[], target: number, exclude: Set<string>): Team {
  const take = (pos: Position) => {
    const cands = pool.filter((p) => p.position === pos && !exclude.has(p.id)).sort((a, b) => Math.abs(ovr(a) - target) - Math.abs(ovr(b) - target));
    const p = cands[0];
    exclude.add(p.id);
    return p;
  };
  const players = [...five, ...benchPositions].map(take).map((p, i) => ({ ...p, number: i + 1 }));
  return { id, name, abbr: id.slice(0, 3).toUpperCase(), players, execution: 1 };
}
const avgOvr = (t: Team) => (t.players.slice(0, 5).reduce((s, p) => s + ovr(p), 0) / 5).toFixed(1);
for (const target of [68, 76]) {
  const used = new Set<string>();
  const centres = build('centres', 'Five Centres', ['C', 'C', 'C', 'C', 'C'], ['C', 'C', 'PF', 'PF', 'C', 'PF', 'C'], target, used);
  const guards = build('guards', 'Five Guards', ['PG', 'PG', 'SG', 'SG', 'SG'], ['PG', 'SG', 'PG', 'SG', 'SF', 'SF', 'PG'], target, used);
  const balanced = build('balanced', 'Balanced', ['PG', 'SG', 'SF', 'PF', 'C'], ['PG', 'SG', 'SF', 'PF', 'C', 'SF', 'PF'], target, used);
  const startersOf = (t: Team) => t.players.slice(0, 5).map((p) => p.id);
  const planOf = (t: Team, tactics: Partial<GamePlan> = {}) => makePlan(t, { starters: startersOf(t), ...tactics });
  say(`  Starting-five overall: five centres ${avgOvr(centres)}, five guards ${avgOvr(guards)}, balanced ${avgOvr(balanced)} (target ${target})`);
  say(line('five centres vs balanced, default plans', play(centres, planOf(centres), balanced, planOf(balanced))));
  say(line('five centres vs balanced (fast, press)', play(centres, planOf(centres), balanced, planOf(balanced, { tempo: 'fast', defence: 'press' }))));
  say(line('five centres (inside, slow) vs balanced', play(centres, planOf(centres, { offence: 'inside', tempo: 'slow' }), balanced, planOf(balanced))));
  const rng = createRng(SEED);
  say(line('five centres vs balanced, both AI plans', play(centres, aiGamePlan(centres, balanced, rng), balanced, aiGamePlan(balanced, centres, rng))));
  say(line('five guards vs balanced, default plans', play(guards, planOf(guards), balanced, planOf(balanced))));
  say(line('five guards (fast, three) vs balanced', play(guards, planOf(guards, { tempo: 'fast', offence: 'three' }), balanced, planOf(balanced))));
  say(line('five guards vs balanced (inside, slow)', play(guards, planOf(guards), balanced, planOf(balanced, { offence: 'inside', tempo: 'slow' }))));
  say(line('five centres vs five guards, default plans', play(centres, planOf(centres), guards, planOf(guards))));
}

}
// ---------------------------------------------------------------------------
if (SECTIONS.has(4)) {
say();
say('4. Fatigue (mirror rosters)');
for (const [a, b] of mirrors) {
  const noBench = { ...makePlan(a), bench: [] as string[] };
  say(line(`${a.name}: starters only (no bench) vs normal rotation`, play(a, noBench, b, makePlan(b))));
  say(line(`${a.name}: starters only, fast tempo vs normal`, play(a, { ...noBench, tempo: 'fast' }, b, makePlan(b))));
}
const stamina = (t: Team, d: number): Team => ({ ...t, players: t.players.map((p) => ({ ...p, attrs: { ...p.attrs, stamina: Math.max(1, Math.min(99, p.attrs.stamina + d)) } })) });
for (const [a, b] of mirrors) {
  say(line(`${a.name}: stamina +15 vs stamina -15`, play(stamina(a, 15), makePlan(a), stamina(b, -15), makePlan(b))));
  say(line(`${a.name}: stamina +15 (fast) vs stamina -15 (fast)`, play(stamina(a, 15), makePlan(a, { tempo: 'fast' }), stamina(b, -15), makePlan(b, { tempo: 'fast' }))));
}

}
// ---------------------------------------------------------------------------
if (SECTIONS.has(5)) {
say();
say('5. Fouling: defensive intensity against free-throw shooting and ball handling (mirror rosters)');
const tweak = (t: Team, ft: number, handle: number): Team => ({
  ...t,
  players: t.players.map((p) => ({ ...p, attrs: { ...p.attrs, freeThrow: Math.max(1, Math.min(99, p.attrs.freeThrow + ft)), dribbling: Math.max(1, Math.min(99, p.attrs.dribbling + handle)), passing: Math.max(1, Math.min(99, p.attrs.passing + handle)) } })),
});
for (const [a, b] of mirrors) {
  for (const [what, opp] of [
    ['average opponent', b],
    ['poor FT + poor handlers (-15)', tweak(b, -15, -15)],
    ['good FT + good handlers (+12)', tweak(b, 12, 12)],
  ] as const) {
    const res = AGGRESSIONS.map((agg) => play(a, makePlan(a, { aggression: agg }), opp, makePlan(opp)));
    say(`  ${a.name} vs ${what.padEnd(30)} careful ${pct(res[0]).padStart(6)}   normal ${pct(res[1]).padStart(6)}   aggressive ${pct(res[2]).padStart(6)}   (aggressive: fouls ${n1(res[2].fouls[0])} vs ${n1(res[1].fouls[0])}, forces TOV ${n1(res[2].tov[1])} vs ${n1(res[1].tov[1])})`);
  }
}

}
// ---------------------------------------------------------------------------
if (SECTIONS.has(6)) {
say();
say("6. The manager's impact (Hammers v Sparks: two different squads)");
const rng = createRng(SEED + 99);
const randomPlan = (t: Team): GamePlan => makePlan(t, { offence: pick(rng, OFFENSIVE_FOCI), defence: pick(rng, DEFENCE_SCHEMES), tempo: pick(rng, TEMPOS), aggression: pick(rng, AGGRESSIONS) });
for (const [a, b] of [
  [ham, sky],
  [sky, ham],
] as const) {
  // The plan's worth: the same opponents (random plans), with a scouted plan or a random one.
  let ai: Result | null = null;
  let rnd: Result | null = null;
  for (let k = 0; k < 12; k++) {
    const opp = randomPlan(b);
    const r1 = play(a, aiGamePlan(a, b, createRng(SEED + k)), b, opp, Math.round(GAMES / 2), SEED + 500 + k);
    const r2 = play(a, randomPlan(a), b, opp, Math.round(GAMES / 2), SEED + 500 + k);
    ai = ai ? merge(ai, r1) : r1;
    rnd = rnd ? merge(rnd, r2) : r2;
  }
  say(line(`${a.name}: random plan vs random plans`, rnd!));
  say(line(`${a.name}: scouted AI plan vs the same random plans`, ai!));
  // The best and worst reply to a fixed opponent plan, among all 45 offence × defence × tempo plans.
  const fixed = makePlan(b);
  const replies = OFFENSIVE_FOCI.flatMap((offence) => DEFENCE_SCHEMES.flatMap((defence) => TEMPOS.map((tempo) => ({ offence, defence, tempo }))));
  const scored = replies.map((t) => ({ t, r: play(a, makePlan(a, t), b, fixed, Math.round(GAMES / 2), SEED + 900) }));
  scored.sort((x, y) => y.r.win / y.r.games - x.r.win / x.r.games);
  const best = scored[0];
  const worst = scored[scored.length - 1];
  say(`  ${a.name} against ${b.name}'s default plan: best reply ${best.t.offence}+${best.t.defence}+${best.t.tempo} ${pct(best.r)}, worst reply ${worst.t.offence}+${worst.t.defence}+${worst.t.tempo} ${pct(worst.r)}`);
}

}
say();
say(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
