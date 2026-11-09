// Balance lab: plays many games with random game plans and reports how each tactic performs.
//
//   npm run lab                          1,000 mirror games (identical rosters on both sides)
//   npm run lab -- --games 4000 --seed 7
//   npm run lab -- --teams versus        Hammers vs Sparks instead of mirror matches
//   npm run lab -- --roster sky          mirror matches with only one roster (ham | sky)
//
// Games are played in pairs with the same seed and the sides swapped, which cancels out
// home/away and tip-off luck. A win rate is only counted when the two sides chose different
// options, so 50% means "no edge".

import { HARBOR_HAMMERS, SKYLINE_SPARKS, mirrorTeam } from '../src/data/teams';
import { composite, makePlan, simulateMatch } from '../src/engine';
import { createRng, next, pick } from '../src/engine/rng';
import { ZONES, type ShotZone } from '../src/engine/court';
import { DEFENCE_SCHEMES, OFFENSIVE_FOCI, TEMPOS, type GamePlan, type Team } from '../src/engine/types';
import { parseArgs, oneOf } from './args';

const args = parseArgs(process.argv.slice(2));
const games = Math.max(2, Number(args.get('games') ?? 1000));
const seed = Number(args.get('seed') ?? 1);
const mode = oneOf(args.get('teams'), ['mirror', 'versus'] as const, 'teams') ?? 'mirror';
const roster = oneOf(args.get('roster'), ['both', 'ham', 'sky'] as const, 'roster') ?? 'both';
const FLAG_HIGH = 0.6;
const FLAG_LOW = 0.4;

const rng = createRng(seed);

function randomPlan(team: Team, opponent: Team): GamePlan {
  const star = [...opponent.players].sort((a, b) => composite(b).overall - composite(a).overall)[0];
  return makePlan(team, {
    offence: pick(rng, OFFENSIVE_FOCI),
    defence: pick(rng, DEFENCE_SCHEMES),
    tempo: pick(rng, TEMPOS),
    keyMatchup: next(rng) < 0.25 ? { kind: 'double', targetId: star.id } : { kind: 'none' },
  });
}

const keyLabel = (p: GamePlan) => (p.keyMatchup.kind === 'double' ? 'double star' : 'no double');

// ---------------------------------------------------------------------------
// Tallies

type Tally = { wins: number; games: number };
const tally = () => new Map<string, Tally>();
const record = (map: Map<string, Tally>, key: string, won: boolean) => {
  const t = map.get(key) ?? { wins: 0, games: 0 };
  t.games++;
  if (won) t.wins++;
  map.set(key, t);
};

const byOffence = tally();
const byDefence = tally();
const byTempo = tally();
const byKey = tally();
const byTeam = tally();
const byTeamOffence = tally();
const byTeamDefence = tally();
const byTeamTempo = tally();
const offVsDef = new Map<string, { pts: number; poss: number }>();
const tempoVsTempo = tally();

let totalPoints = 0;
let totalPossessions = 0;
let fga = 0, fgm = 0, tpa = 0, tpm = 0, tov = 0, oreb = 0, overtimes = 0, homeWins = 0, played = 0;
let starterSeconds = 0, starterCount = 0;
let maxMargin = 0, closeGames = 0;
/** Shots per zone, and the late-clock and buzzer shots. */
const zoneShots = new Map<ShotZone, { att: number; made: number }>();
let lateClockShots = 0, buzzerShots = 0, shotClockViolations = 0, allShots = 0;

const pairs = Math.ceil(games / 2);
const start = Date.now();

for (let pair = 0; pair < pairs; pair++) {
  let teamA: Team;
  let teamB: Team;
  if (mode === 'mirror') {
    const useHam = roster === 'both' ? pair % 2 === 0 : roster === 'ham';
    const base = useHam ? HARBOR_HAMMERS : SKYLINE_SPARKS;
    teamA = { ...base, abbr: 'A' };
    teamB = mirrorTeam(base, 'B');
  } else {
    teamA = HARBOR_HAMMERS;
    teamB = SKYLINE_SPARKS;
  }
  const planA = randomPlan(teamA, teamB);
  const planB = randomPlan(teamB, teamA);
  const gameSeed = Math.floor(next(rng) * 2 ** 31);

  for (const swapped of [false, true]) {
    if (played >= games) break;
    const [home, away, homePlan, awayPlan] = swapped ? [teamB, teamA, planB, planA] : [teamA, teamB, planA, planB];
    const { box, winner, state } = simulateMatch(home, away, homePlan, awayPlan, gameSeed);
    played++;
    if (winner === 0) homeWins++;
    if (state.quarter > 4) overtimes++;
    const margin = Math.abs(box.teams[0].score - box.teams[1].score);
    maxMargin = Math.max(maxMargin, margin);
    if (margin <= 5) closeGames++;
    for (const ev of state.events) {
      if (ev.type === 'turnover' && ev.cause === 'shotClock') shotClockViolations++;
      if (ev.type !== 'shot') continue;
      allShots++;
      if (ev.lateClock) lateClockShots++;
      if (ev.buzzer) buzzerShots++;
      const z = zoneShots.get(ev.zone) ?? { att: 0, made: 0 };
      z.att++;
      if (ev.made) z.made++;
      zoneShots.set(ev.zone, z);
    }

    const sides = [
      { plan: homePlan, team: home, box: box.teams[0], oppPlan: awayPlan, won: winner === 0 },
      { plan: awayPlan, team: away, box: box.teams[1], oppPlan: homePlan, won: winner === 1 },
    ];
    for (const side of sides) {
      const { plan, oppPlan, won, box: tb } = side;
      if (plan.offence !== oppPlan.offence) record(byOffence, plan.offence, won);
      if (plan.defence !== oppPlan.defence) record(byDefence, plan.defence, won);
      if (plan.tempo !== oppPlan.tempo) record(byTempo, plan.tempo, won);
      if (keyLabel(plan) !== keyLabel(oppPlan)) record(byKey, keyLabel(plan), won);
      if (plan.tempo !== oppPlan.tempo) record(tempoVsTempo, `${plan.tempo}|${oppPlan.tempo}`, won);
      if (mode === 'versus') {
        const t = side.team.abbr;
        record(byTeam, t, won);
        record(byTeamOffence, `${t} ${plan.offence}`, won);
        record(byTeamDefence, `${t} ${plan.defence}`, won);
        record(byTeamTempo, `${t} ${plan.tempo}`, won);
      }

      const cell = offVsDef.get(`${plan.offence}|${oppPlan.defence}`) ?? { pts: 0, poss: 0 };
      cell.pts += tb.score;
      cell.poss += tb.extras.possessions;
      offVsDef.set(`${plan.offence}|${oppPlan.defence}`, cell);

      totalPoints += tb.score;
      totalPossessions += tb.extras.possessions;
      fga += tb.totals.fga;
      fgm += tb.totals.fgm;
      tpa += tb.totals.tpa;
      tpm += tb.totals.tpm;
      tov += tb.totals.tov;
      oreb += tb.totals.oreb;
      for (const line of tb.players) {
        if (line.starter) {
          starterSeconds += line.stats.seconds;
          starterCount++;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const teamGames = played * 2;
let flags = 0;

function printTally(title: string, map: Map<string, Tally>, order?: readonly string[], flagged = true) {
  console.log(`\n${title}`);
  const keys = order ? order.filter((k) => map.has(k)) : [...map.keys()].sort();
  for (const k of keys) {
    const t = map.get(k)!;
    const rate = t.wins / t.games;
    const flag = !flagged ? '' : rate > FLAG_HIGH ? '  ⚠ too strong' : rate < FLAG_LOW ? '  ⚠ too weak' : '';
    if (flag) flags++;
    const bar = '█'.repeat(Math.round(rate * 40)).padEnd(40, '·');
    console.log(`  ${k.padEnd(16)} ${pct(rate).padStart(6)}  ${bar}  (${t.games} games)${flag}`);
  }
}

console.log(`Balance lab — ${played} games, mode: ${mode}${mode === 'mirror' ? ` (roster: ${roster})` : ''}, seed ${seed}  (${((Date.now() - start) / 1000).toFixed(1)}s)`);
console.log(`\nLeague averages (per team per game)`);
console.log(
  `  Points ${(totalPoints / teamGames).toFixed(1)}   Possessions ${(totalPossessions / teamGames).toFixed(1)}   ` +
    `Pts/poss ${(totalPoints / totalPossessions).toFixed(3)}`,
);
console.log(
  `  FG ${pct(fgm / fga)}   3P ${pct(tpm / tpa)} on ${(tpa / teamGames).toFixed(1)} att   ` +
    `TOV ${(tov / teamGames).toFixed(1)}   OREB ${(oreb / teamGames).toFixed(1)}   ` +
    `Starter MIN ${(starterSeconds / starterCount / 60).toFixed(1)}`,
);
console.log(
  `  Home wins ${pct(homeWins / played)}   Overtime ${pct(overtimes / played)}   ` +
    `Within 5 pts ${pct(closeGames / played)}   Biggest margin ${maxMargin}`,
);

/** NBA league shooting by zone (NBA.com, recent seasons, rounded): share of field-goal attempts and FG%. */
const NBA_ZONES: Record<ShotZone, [number, number]> = {
  restricted: [0.3, 0.655],
  paint: [0.17, 0.43],
  mid: [0.11, 0.42],
  corner3: [0.1, 0.39],
  aboveBreak3: [0.32, 0.355],
};
console.log('\nShots by zone (share of attempts, FG%) next to the NBA');
for (const zone of ZONES) {
  const z = zoneShots.get(zone) ?? { att: 0, made: 0 };
  const [share, fg] = NBA_ZONES[zone];
  console.log(`  ${zone.padEnd(12)} ${pct(z.att / allShots).padStart(6)} ${pct(z.made / Math.max(1, z.att)).padStart(6)}   NBA ${pct(share).padStart(6)} ${pct(fg).padStart(6)}`);
}
console.log(`  Late-clock shots ${pct(lateClockShots / allShots)}   Buzzer shots ${(buzzerShots / played).toFixed(2)} a game   Shot-clock violations ${(shotClockViolations / teamGames).toFixed(2)} a team a game`);

console.log(`\nWin rate when the two sides chose different options (50% = no edge, flag outside ${pct(FLAG_LOW)}–${pct(FLAG_HIGH)})`);
printTally('Offensive focus', byOffence, OFFENSIVE_FOCI);
printTally('Defence', byDefence, DEFENCE_SCHEMES);
printTally('Tempo', byTempo, TEMPOS);
printTally('Key matchup', byKey, ['no double', 'double star']);

console.log('\nTempo head-to-head (row tempo vs column tempo, win rate of row)');
console.log(`  ${''.padEnd(8)}${TEMPOS.map((t) => t.padStart(9)).join('')}`);
for (const a of TEMPOS) {
  const cells = TEMPOS.map((b) => {
    const t = tempoVsTempo.get(`${a}|${b}`);
    return (t ? pct(t.wins / t.games) : '-').padStart(9);
  });
  console.log(`  ${a.padEnd(8)}${cells.join('')}`);
}

console.log('\nPoints per possession: offensive focus (rows) vs opponent defence (columns)');
console.log(`  ${''.padEnd(12)}${DEFENCE_SCHEMES.map((d) => d.padStart(8)).join('')}`);
for (const o of OFFENSIVE_FOCI) {
  const cells = DEFENCE_SCHEMES.map((d) => {
    const c = offVsDef.get(`${o}|${d}`);
    return (c ? (c.pts / c.poss).toFixed(3) : '-').padStart(8);
  });
  console.log(`  ${o.padEnd(12)}${cells.join('')}`);
}

if (mode === 'versus') {
  console.log('\nHammers vs Sparks breakdown (not flagged: the squads are not equal)');
  printTally('Team', byTeam, undefined, false);
  printTally('Team × offence', byTeamOffence, undefined, false);
  printTally('Team × defence', byTeamDefence, undefined, false);
  printTally('Team × tempo', byTeamTempo, undefined, false);
}

console.log(flags === 0 ? '\n✓ No option outside the target band.' : `\n${flags} option(s) outside the target band.`);
