// Lists every emoji or text symbol used as an icon in the game's screens (GAME_FLOW §6.1a rule 2:
// icons are Lucide SVG only). Developer tools under src/ui/dev are skipped. Exit code 1 if any.
//
//   node scripts/icon-audit.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Arrows, triangles, stars, ticks and crosses, media symbols, and every emoji/pictograph.
const SYMBOL = /[←-⇿⌀-⏿■-◿☀-➿⬀-⯿]|\p{Extended_Pictographic}/gu;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'dev') yield* files(p);
    } else if (/\.(tsx?|css|html)$/.test(name)) yield p;
  }
}

const hits = [];
for (const f of [...files('src/ui'), 'index.html']) {
  readFileSync(f, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      // Comments explain; only code and markup count.
      const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      for (const m of code.matchAll(SYMBOL)) hits.push({ f, line: i + 1, ch: m[0], text: line.trim().slice(0, 110) });
    });
}
const bySymbol = new Map();
for (const h of hits) bySymbol.set(h.ch, (bySymbol.get(h.ch) ?? 0) + 1);
console.log(`Icon symbols in the screens: ${hits.length} (${[...bySymbol].map(([c, n]) => `${c} ${n}`).join(', ')})`);
if (process.argv.includes('--list')) for (const h of hits) console.log(`${h.f}:${h.line}  ${h.ch}  ${h.text}`);
else {
  const byFile = new Map();
  for (const h of hits) byFile.set(h.f, (byFile.get(h.f) ?? 0) + 1);
  for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(3)}  ${f}`);
}
process.exit(hits.length ? 1 : 0);
