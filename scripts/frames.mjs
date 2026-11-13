// npm run frames -- --seed <n> --quarter <q> --from <clock> --to <clock> --every <seconds> [--view 2d|3d|both] [--zoom] [--out <dir>]
//
// Plays a match headlessly (Chrome via Playwright, with the game's own renderers) up to a moment and
// saves PNG frames of the court, the clock and the commentary line burnt into each one, to
// frames/<seed>-<quarter>-<from>-<to>/. Clocks are game clock, "10:30" or seconds; --from is the
// earlier moment (more time left), --to the later one. --every is match seconds between frames.
// --zoom frames the area round the ball (a closer 3D camera, an enlarged crop of the 2D court).
//
// Example: npm run frames -- --seed 1 --quarter 2 --from 10:30 --to 10:20 --every 0.1

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = 'true';
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const a = args(process.argv.slice(2));
const seed = a.seed ?? '1';
const quarter = a.quarter ?? a.q ?? '1';
const from = a.from ?? '12:00';
const to = a.to ?? '';
const every = a.every ?? '0.1';
const view = a.view ?? 'both';
const safe = (s) => String(s).replace(/[^0-9a-z.]+/gi, '-');
const dir = resolve(a.out ?? join('frames', `seed${seed}-q${quarter}-${safe(from)}-to-${safe(to || 'end')}${a.zoom ? '-zoom' : ''}`));

const server = await createServer({ logLevel: 'error', server: { port: 5199, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5199/';
let browser;
try {
  // Your installed Chrome, headless; set CHROME_PATH to use another Chromium.
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : { channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('console:', msg.text());
  });
  const params = new URLSearchParams({ capture: '', seed, q: quarter, from, every, view });
  if (a.zoom) params.set('zoom', '1');
  if (to) params.set('to', to);
  const url = `${base}?${params.toString()}`;
  console.log(`Playing seed ${seed} to Q${quarter} ${from} and capturing every ${every} s until ${to || '10 s later'} (${view})…`);
  await page.goto(url);
  let last = '';
  for (;;) {
    const s = await page.evaluate(() => window.__capture && { done: window.__capture.done, status: window.__capture.status, error: window.__capture.error, n: window.__capture.frames.length });
    if (s && s.status !== last) {
      console.log(`  ${s.status}`);
      last = s.status;
    }
    if (s?.done) {
      if (s.error) throw new Error(s.error);
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const n = await page.evaluate(() => window.__capture.frames.length);
  for (let i = 0; i < n; i++) {
    const f = await page.evaluate((k) => window.__capture.frames[k], i);
    const file = join(dir, `${String(i).padStart(3, '0')}-${f.name}`);
    writeFileSync(file, Buffer.from(f.png.split(',')[1], 'base64'));
  }
  console.log(`Saved ${n} images to ${dir}`);
} catch (e) {
  console.error(`frames: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
