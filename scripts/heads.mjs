// npm run heads [-- --seed <n>]: the 3D heads close up, saved to frames/heads/: styles.png (every
// hairstyle on each skin tone at four angles) and match.png (the ten players of a match beside their
// 2D portraits). Uses your installed Chrome, headless (CHROME_PATH for another Chromium).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const argv = process.argv.slice(2);
const seed = argv.includes('--seed') ? argv[argv.indexOf('--seed') + 1] : '1';
const dir = resolve('frames', 'heads');
mkdirSync(dir, { recursive: true });

const server = await createServer({ logLevel: 'error', server: { port: 5198, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5198/';
let browser;
try {
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : { channel: 'chrome', headless: true });
  for (const [name, query] of [
    ['styles', 'heads3d'],
    ['match', `heads3d=match&seed=${seed}`],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('pageerror', (e) => console.error('page error:', e.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error('console:', msg.text());
    });
    await page.goto(`${base}?${query}`);
    for (;;) {
      const s = await page.evaluate(() => window.__heads && { done: window.__heads.done, error: window.__heads.error });
      if (s?.done) {
        if (s.error) throw new Error(s.error);
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    const png = await page.evaluate(() => window.__heads.png);
    const file = join(dir, `${name}.png`);
    writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
    console.log(`Saved ${file}`);
    await page.close();
  }
} catch (e) {
  console.error(`heads: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
