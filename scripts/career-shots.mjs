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
const wide = [];
let checked = 0;
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
  // Whether any squad table is wider than its card (GAME_FLOW §6.4: every view fits 768 px).
  const overflow = async (label) => {
    const r = await page.evaluate(() => [...document.querySelectorAll('.cr-table-wrap')].map((e) => [e.scrollWidth, e.clientWidth]));
    checked++;
    for (const [s, c] of r) if (s > c + 1) wide.push(`${width}px ${label}: table ${s}px in a ${c}px card`);
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
  await page.locator('.cr-side').waitFor();
  // A career opens on Home (slice W2a); the squad is a sidebar section.
  await page.locator('.cr-nav', { hasText: 'Squad' }).click();
  await shot('3-squad');
  for (const v of ['Attributes', 'Profile', 'Season stats']) {
    await page.getByRole('radio', { name: v }).click();
    await overflow(`Kaunas · ${v}`);
    await shot(`3-squad-${v.toLowerCase()}`);
  }
  await page.getByRole('radio', { name: 'Overview' }).click();
  await page.getByRole('tab', { name: /Academy/ }).click();
  await shot('3b-squad-academy');
  await page.getByRole('tab', { name: /First team/ }).click();
  await page.locator('.cr-table .cr-name').first().click();
  await shot('4-player');
  await page.screenshot({ path: join(out, `${width}-4b-player-viewport.png`) });
  await page.locator('.cr-nav', { hasText: 'Competitions' }).click();
  await shot('5-competitions');
  await page.locator('.cr-comp', { hasText: 'Big League · Europe' }).first().click();
  await shot('5b-big-league-europe');
  await page.locator('.cr-table .cr-name').nth(1).click();
  await shot('5c-other-club');
  await page.getByRole('radio', { name: 'Attributes' }).click();
  await shot('5c-other-club-attributes');
  await page.getByRole('radio', { name: 'Profile' }).click();
  await shot('5c-other-club-profile');
  await page.getByRole('radio', { name: 'Overview' }).click();
  await page.locator('.cr-table .cr-name').first().click();
  await shot('5d-other-player');
  await page.screenshot({ path: join(out, `${width}-5e-other-player-viewport.png`) });
  await page.locator('.cr-nav', { hasText: 'Club' }).click();
  await shot('6-club-budget');

  // An America Big League club: the cap system.
  await newCareer();
  await page.locator('.cr-club', { hasText: 'New York Skyliners' }).click();
  await page.locator('.cr-new-side .cr-start').click();
  await page.locator('.cr-side').waitFor();
  await shot('8-squad-cap');
  await page.locator('.cr-nav', { hasText: 'Club' }).click();
  await shot('9-club-cap');
  await page.locator('.cr-nav', { hasText: 'Squad' }).click();
  for (const v of ['Overview', 'Attributes', 'Profile']) {
    await page.getByRole('radio', { name: v }).click();
    await overflow(`New York · ${v}`);
    await shot(`8-squad-cap-${v.toLowerCase()}`);
  }
  await page.getByRole('radio', { name: 'Overview' }).click();

  // Every club in the world, every view and list: no squad table wider than its card.
  if (process.argv.includes('--sweep') && width < 1024) {
    await page.locator('.cr-nav', { hasText: 'Competitions' }).click();
    const comps = await page.locator('.cr-comp').count();
    for (let c = 0; c < comps; c++) {
      await page.locator('.cr-comp').nth(c).click();
      // Your own club opens the Club screen (no squad table, no Back): skip its row.
      const clubs = await page.locator('.cr-table tr:not(.me) .cr-name').count();
      const compName = await page.locator('h1').first().textContent();
      for (let k = 0; k < clubs; k++) {
        await page.locator('.cr-table tr:not(.me) .cr-name').nth(k).click();
        const tabs = await page.getByRole('tab').count();
        for (let t = 0; t < tabs; t++) {
          await page.getByRole('tab').nth(t).click();
          for (const v of ['Overview', 'Attributes', 'Profile']) {
            await page.getByRole('radio', { name: v }).click();
            await overflow(`${compName} club ${k + 1} tab ${t + 1} ${v}`);
          }
        }
        await page.getByRole('radio', { name: 'Overview' }).click();
        await page.goBack();
      }
      await page.goBack();
    }
  }
  await page.locator('.tb-menu').click();
  await shot('10-menu');
  await ctx.close();
}

try {
  for (const w of [1440, 768]) await run(w);
  console.log(times.join('\n'));
  console.log(`Squad tables measured: ${checked}; wider than their card: ${wide.length}`);
  for (const x of wide.slice(0, 40)) console.log(`  ${x}`);
} finally {
  await browser.close();
  await server.close();
}
