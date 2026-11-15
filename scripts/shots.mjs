// npm run shots -- <page> [--out <dir>]: opens a dev page that draws its own pictures (?clips3d,
// ?dribble3d) in headless Chrome and saves them (window.__shots) to frames/<page>/ (or --out).
// Uses your installed Chrome (CHROME_PATH for another Chromium).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const argv = process.argv.slice(2);
const page = argv[0];
if (!page) {
  console.error('usage: npm run shots -- <clips3d|dribble3d> [--out <dir>]');
  process.exit(1);
}
const dir = resolve(argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : join('frames', page));
mkdirSync(dir, { recursive: true });

const server = await createServer({ logLevel: 'error', server: { port: 5197, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5197/';
let browser;
try {
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : { channel: 'chrome', headless: true });
  const tab = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
  tab.on('pageerror', (e) => console.error('page error:', e.message));
  tab.on('console', (msg) => {
    if (msg.type() === 'error') console.error('console:', msg.text());
    else if (msg.type() === 'log') console.log('  ' + msg.text());
  });
  await tab.goto(`${base}?${page}`);
  for (;;) {
    const s = await tab.evaluate(() => window.__shots && { done: window.__shots.done, error: window.__shots.error });
    if (s?.done) {
      if (s.error) throw new Error(s.error);
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  const n = await tab.evaluate(() => window.__shots.images.length);
  for (let i = 0; i < n; i++) {
    const img = await tab.evaluate((k) => window.__shots.images[k], i);
    mkdirSync(dirname(join(dir, img.name)), { recursive: true });
    writeFileSync(join(dir, img.name), Buffer.from(img.png.split(',')[1], 'base64'));
  }
  console.log(`Saved ${n} images to ${dir}`);
} catch (e) {
  console.error(`shots: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
