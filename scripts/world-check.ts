// A quick look at a new career world (slice W1): how long it takes to create, its shape, the money and
// the save size. `npm run world -- [seed]`.

import { createWorld } from '../src/game/world/generate';
import { money } from '../src/game/world/money';
import { moneySummary, strength } from '../src/game/world/query';
import { encode, WORLD_FORMAT } from '../src/game/world/saves';

const seed = Number(process.argv[2] ?? 7);
createWorld(seed + 1); // warm up (JIT), so the timing below is a fair one
const runs: number[] = [];
let w = createWorld(seed);
for (let i = 0; i < 5; i++) {
  const t = performance.now();
  w = createWorld(seed);
  runs.push(performance.now() - t);
}
runs.sort((a, b) => a - b);
console.log(`Created in ${runs[0].toFixed(0)}–${runs[runs.length - 1].toFixed(0)} ms (median ${runs[2].toFixed(0)} ms) in Node`);

const people = Object.values(w.players);
const count = (s: string) => people.filter((p) => p.status === s).length;
console.log(`${w.clubs.length} clubs, ${w.competitions.length} competitions, ${people.length} people: ${count('club')} first team, ${count('dev')} dev squad, ${count('academy')} academy, ${count('free')} free agents, ${count('college')} college`);

for (const comp of w.competitions) {
  const clubs = comp.clubs.map((id) => w.clubs.find((c) => c.id === id)!);
  const s = clubs.map((c) => strength(w, c));
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  const m = clubs.map((c) => moneySummary(w, c));
  const money1 = m.map((x) => (x.system === 'cap' ? x.payroll : x.budget));
  const marks = clubs.filter((c) => c.licence && comp.kind === 'bigLeague').map((c) => `${c.name} (${c.licence})`);
  console.log(`${comp.name.padEnd(22)} ${String(clubs.length).padStart(2)} clubs  strength ${avg.toFixed(1)} (${Math.min(...s).toFixed(1)}–${Math.max(...s).toFixed(1)})  ${m[0].system === 'cap' ? 'payroll' : 'budget'} ${money(Math.min(...money1))}–${money(Math.max(...money1))}`);
  if (marks.length) console.log(`   ${marks.join(', ')}`);
}

const bytes = await encode({ format: WORLD_FORMAT, kind: 'world', savedAt: '', summary: {}, data: w });
console.log(`Save: ${(bytes.length / 1024).toFixed(0)} KB compressed (${(JSON.stringify(w).length / 1024 / 1024).toFixed(1)} MB as JSON)`);
