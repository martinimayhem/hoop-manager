// Screenshots of the career screens (slice brief W1 §8: New career, Squad, Player page, Competitions
// and Club at 1440 and 768 px wide), and the world-creation time in the browser. Plays the real app
// headlessly in your installed Chrome (CHROME_PATH for another Chromium).
//
//   node scripts/career-shots.mjs [--out frames/career]

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const out = arg('out', 'frames/career');
mkdirSync(out, { recursive: true });

const server = await createServer({ logLevel: 'error', server: { port: 5198, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : { channel: 'chrome', headless: true });

const times = [];
async function run(width) {
  const ctx = await browser.newContext({ viewport: { width, height: width >= 1024 ? 900 : 1024 }, deviceScaleFactor: 1, hasTouch: width < 1024 });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    const t = m.text();
    if (t.startsWith('[world]')) times.push(`${width}px: ${t}`);
  });
  page.on('pageerror', (e) => console.error(`page error (${width}px):`, e.message));
  const shot = async (name) => {
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(out, `${width}-${name}.png`), fullPage: true });
    console.log(`  ${width}-${name}.png`);
  };
  const newCareer = async () => {
    await page.goto(url);
    await page.getByRole('button', { name: /New career/ }).click();
    await page.locator('.cr-new-side .cr-start').waitFor({ timeout: 20000 });
  };

  // A European club with a licence: academy tab, budget and threshold.
  await newCareer();
  await shot('1-new-career-america');
  await page.getByRole('button', { name: 'Europe', exact: true }).click();
  await page.getByRole('button', { name: 'Lithuania', exact: true }).click();
  await page.locator('.cr-club', { hasText: 'Kaunas Ambers' }).click();
  await shot('2-new-career-europe');
  // What a tablet shows without scrolling (the chosen club's bar stays at the bottom).
  await page.screenshot({ path: join(out, `${width}-2b-new-career-viewport.png`) });
  await page.locator('.cr-field input').fill('Sam');
  await page.locator('.cr-new-side .cr-start').click();
  await page.locator('.cr-top-name').waitFor();
  await shot('3-squad');
  await page.getByRole('tab', { name: /Academy/ }).click();
  await shot('3b-squad-academy');
  await page.getByRole('tab', { name: /First team/ }).click();
  await page.locator('.cr-table .cr-name').first().click();
  await shot('4-player');
  await page.locator('.cr-nav', { hasText: 'Competitions' }).click();
  await shot('5-competitions');
  await page.locator('.cr-comp', { hasText: 'Big League · Europe' }).first().click();
  await shot('5b-big-league-europe');
  await page.locator('.cr-table .cr-name').nth(1).click();
  await shot('5c-other-club');
  await page.locator('.cr-table .cr-name').first().click();
  await shot('5d-other-player');
  await page.locator('.cr-nav', { hasText: 'Club' }).click();
  await shot('6-club-budget');
  // Disabled for real (aria-disabled), but a tap still says "coming soon".
  await page.locator('.cr-nav', { hasText: 'Home' }).click({ force: true });
  await shot('7-coming-soon');

  // An America Big League club: the cap system.
  await newCareer();
  await page.locator('.cr-club', { hasText: 'New York Skyliners' }).click();
  await page.locator('.cr-new-side .cr-start').click();
  await page.locator('.cr-top-name').waitFor();
  await shot('8-squad-cap');
  await page.locator('.cr-nav', { hasText: 'Club' }).click();
  await shot('9-club-cap');
  await page.locator('.cr-nav', { hasText: 'Main menu' }).click();
  await shot('10-menu');
  await ctx.close();
}

try {
  for (const w of [1440, 768]) await run(w);
  console.log(times.join('\n'));
} finally {
  await browser.close();
  await server.close();
}
