// A whole regular season in Node (slice brief W2a): the schedule's shape, then every game simulated
// to the end, with timings and the save size.
//
//   npx tsx scripts/season-check.ts [seed] [club id]

import { createWorld } from '../src/game/world/generate';
import { takeOver } from '../src/game/world/query';
import { encode } from '../src/game/world/saves';
import { advance, gamesOn, playOf, simulateInputs, startSeason } from '../src/game/season/play';
import { BIG_LEAGUE } from '../src/game/season/types';
import { shortDate } from '../src/game/season/calendar';

const seed = Number(process.argv[2] ?? 7);
let w = createWorld(seed);
const club = process.argv[3] ?? w.competitions.find((c) => c.kind === 'bigLeague' && c.region === 'europe')!.clubs[0];
w = startSeason(takeOver(w, club));
const p = playOf(w);
const byComp = new Map<string, number>();
for (const g of p.games) byComp.set(g.comp, (byComp.get(g.comp) ?? 0) + 1);
console.log(`World ${seed}: ${p.games.length} games; Big League ${byComp.get(BIG_LEAGUE)}; days ${p.games[0].day}–${p.games[p.games.length - 1].day} (${shortDate(w.season, 0)} to ${shortDate(w.season, p.games[p.games.length - 1].day)})`);
const perDay = new Map<number, number>();
for (const g of p.games) perDay.set(g.day, (perDay.get(g.day) ?? 0) + 1);
console.log(`Matchdays: ${perDay.size}; most games on a day: ${Math.max(...perDay.values())}`);

const t0 = performance.now();
let slowest = 0;
let days = 0;
let last = performance.now();
const r = await advance(w, simulateInputs, {
  toEnd: true,
  onDay: () => {
    const now = performance.now();
    slowest = Math.max(slowest, now - last);
    last = now;
    days++;
  },
});
const ms = performance.now() - t0;
w = r.w;
console.log(`Season simulated in ${(ms / 1000).toFixed(1)} s (${days} matchdays, slowest ${Math.round(slowest)} ms, ${Math.round(p.games.length / (ms / 1000))} games/s); stop: ${r.stop}; inbox ${playOf(w).inbox.length}`);
const bytes = await encode({ data: w });
console.log(`Save: ${(bytes.length / 1024 / 1024).toFixed(2)} MB compressed`);
console.log(`Today: ${shortDate(w.season, playOf(w).day)}, games that day: ${gamesOn(w, playOf(w).day).length}`);
