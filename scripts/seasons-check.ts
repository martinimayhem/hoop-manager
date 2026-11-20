// Three seasons in a row, every game simulated (slice brief W2b §9): competition sizes, champions,
// time per season, save size.
//   npx tsx scripts/seasons-check.ts [seed] [seasons]
import { createWorld } from '../src/game/world/generate';
import { takeOver } from '../src/game/world/query';
import { encode } from '../src/game/world/saves';
import { advance, playOf, simulateInputs, startSeason } from '../src/game/season/play';
import { cupsOf } from '../src/game/season/post';
import { startNextSeason } from '../src/game/season/rollover';

const seed = Number(process.argv[2] ?? 7);
const n = Number(process.argv[3] ?? 3);
let w = createWorld(seed);
w = startSeason(takeOver(w, w.competitions.find((c) => c.id === 'big-league-europe')!.clubs[0]));
const SIZE: Record<string, number> = { bigLeague: 0, usDivision: 16, nationalLeague: 12 };
for (let s = 0; s < n; s++) {
  const t = performance.now();
  const r = await advance(w, simulateInputs, { mode: 'toEnd' });
  w = r.w;
  const ms = performance.now() - t;
  const p = playOf(w);
  const sizes = w.competitions.map((c) => `${c.id}:${c.clubs.length}`).filter((x) => {
    const [id, k] = x.split(':');
    const c = w.competitions.find((y) => y.id === id)!;
    const want = c.id === 'big-league-america' ? 18 : c.id === 'big-league-europe' ? 12 : SIZE[c.kind];
    return Number(k) !== want;
  });
  const bytes = (await encode({ data: w })).length;
  console.log(`Season ${w.season}: ${(ms / 1000).toFixed(1)} s, ${p.games.filter((g) => !g.off).length} games, phase ${p.phase}; wrong sizes: ${sizes.length ? sizes.join(' ') : 'none'}; cups ${cupsOf(w).length}; save ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  w = startNextSeason(w);
  const a = w.history![w.history!.length - 1];
  console.log(`  archived ${a.season}: champions ${Object.keys(a.champions).length}, promoted ${a.promoted.length}, relegated ${a.relegated.length}, licences lost ${a.licenceLost.length}, wildcards ${a.wildcards.join(', ')}, BL champion ${a.champions['big-league-final']}`);
  const sizes2 = w.competitions.filter((c) => c.clubs.length !== (c.id === 'big-league-america' ? 18 : c.id === 'big-league-europe' ? 12 : SIZE[c.kind]));
  if (sizes2.length) console.log('  WRONG SIZES after rollover', sizes2.map((c) => `${c.id}:${c.clubs.length}`).join(' '));
}
console.log(`After ${n} seasons: save ${((await encode({ data: w })).length / 1024 / 1024).toFixed(2)} MB`);
