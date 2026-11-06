// Plays one match and prints the play-by-play and box score.
//
//   npm run match -- --seed 42
//   npm run match -- --seed 7 --home-def zone --away-off inside --away-tempo slow
//   npm run match -- --quiet            (box score only)
//   npm run match -- --hide-subs        (play-by-play without substitutions)
//
// Tactic flags: --{home,away}-off  inside|balanced|three|pickAndRoll|fastBreak
//               --{home,away}-def  man|zone|press
//               --{home,away}-tempo slow|normal|fast
//               --{home,away}-double  (double-team the opponent's best player)

import { formatBoxScore, playByPlayLine } from '../src/cli/format';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../src/data/teams';
import { composite, describe, namesFor, simulateMatch } from '../src/engine';
import { DEFENCE_SCHEMES, OFFENSIVE_FOCI, TEMPOS, type GamePlan, type Team } from '../src/engine/types';
import { oneOf, parseArgs } from './args';

const args = parseArgs(process.argv.slice(2));
const seed = Number(args.get('seed') ?? Math.floor(Math.random() * 1e9));
const swap = args.get('swap') === 'true';
const [home, away] = swap ? [SKYLINE_SPARKS, HARBOR_HAMMERS] : [HARBOR_HAMMERS, SKYLINE_SPARKS];

function planFor(side: 'home' | 'away', team: Team, opponent: Team): GamePlan {
  const plan: GamePlan = { ...DEFAULT_PLANS[team.id] };
  plan.offence = oneOf(args.get(`${side}-off`), OFFENSIVE_FOCI, `${side}-off`) ?? plan.offence;
  plan.defence = oneOf(args.get(`${side}-def`), DEFENCE_SCHEMES, `${side}-def`) ?? plan.defence;
  plan.tempo = oneOf(args.get(`${side}-tempo`), TEMPOS, `${side}-tempo`) ?? plan.tempo;
  if (args.get(`${side}-double`) === 'true') {
    const star = [...opponent.players].sort((a, b) => composite(b).overall - composite(a).overall)[0];
    plan.keyMatchup = { kind: 'double', targetId: star.id };
  }
  return plan;
}

const homePlan = planFor('home', home, away);
const awayPlan = planFor('away', away, home);
const result = simulateMatch(home, away, homePlan, awayPlan, seed);
const names = namesFor(result.state);
const abbrs: [string, string] = [home.abbr, away.abbr];

const describePlan = (t: Team, p: GamePlan) =>
  `${t.name.padEnd(16)} offence ${p.offence.padEnd(11)} defence ${p.defence.padEnd(5)} tempo ${p.tempo.padEnd(6)}` +
  (p.keyMatchup.kind === 'double' ? `  doubling ${names.player(t === home ? 1 : 0, p.keyMatchup.targetId)}` : '');

console.log(`Seed ${seed}`);
console.log(describePlan(home, homePlan));
console.log(describePlan(away, awayPlan));
console.log();

if (args.get('quiet') !== 'true') {
  const hideSubs = args.get('hide-subs') === 'true';
  for (const ev of result.state.events) {
    if (hideSubs && ev.type === 'sub') continue;
    const text = describe(ev, names);
    if (text) console.log(playByPlayLine(ev, text, abbrs));
  }
  console.log();
}

console.log(formatBoxScore(result.box));
