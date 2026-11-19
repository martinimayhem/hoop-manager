// A career season played through the real screens, headless in your installed Chrome (slice brief W2a
// §6): a new career, Continue to the first day, a game day simulated and one watched (prep → match →
// result → career), every new screen photographed, then (with --full) the rest of the regular season
// simulated to the review. Prints the matchday timings the game logs.
//
//   node scripts/season-shots.mjs [--size 1366x650] [--out frames/season] [--full] [--club "Kaunas"]

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const [W, H] = arg('size', '1366x650').split('x').map(Number);
const out = arg('out', 'frames/season');
const full = process.argv.includes('--full');
mkdirSync(out, { recursive: true });

const server = await createServer({ logLevel: 'error', server: { port: 5197, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : { channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: W <= 1024 });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => m.text().startsWith('[season]') && logs.push(m.text()));
page.on('pageerror', (e) => console.error('page error:', e.message));
let n = 0;
const shot = async (name) => {
  await page.waitForTimeout(250);
  const file = join(out, `${W}x${H}-${String(++n).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  console.log('shot', file);
};
const idle = async () => {
  await page.waitForTimeout(150);
  await page.locator('.cr-busy').waitFor({ state: 'detached', timeout: 600000 });
};
const button = (re) => page.getByRole('button', { name: re }).first();

try {
  await page.goto(base);
  await button(/New career/).click();
  await page.locator('.cr-new-side .cr-start').waitFor({ timeout: 30000 });
  await button(/^Europe$/).click();
  await button(/^Lithuania$/).click();
  await page.locator('.cr-club').first().click();
  await page.locator('.cr-new-side .cr-start').click();
  await page.locator('.cr-side').waitFor();
  await shot('home-before');

  // Continue: the first day, then on to the first game day.
  const t0 = Date.now();
  await page.locator('.cr-continue-top').click();
  await idle();
  await shot('after-first-continue');
  for (let i = 0; i < 20 && !(await page.locator('.prep-screen').count()); i++) {
    await page.locator('.cr-continue-top').click();
    await idle();
  }
  console.log(`To the first game day: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.locator('.prep-screen').waitFor();
  await shot('prep');
  for (const tab of [/Starting five/, /Scouting:/]) {
    await page.getByRole('tab', { name: tab }).first().click();
    await shot(`prep-${tab.source.replace(/[^a-z]/gi, '').toLowerCase()}`);
  }

  // Simulate this one.
  await button(/^Simulate$/).click();
  await page.locator('.res').waitFor({ timeout: 60000 });
  await idle();
  await shot('result-simulated');
  await page.locator('.res').getByRole('button', { name: /Continue|Back to/ }).first().click().catch(async () => page.locator('.tb-back').click());
  await page.locator('.cr-side').waitFor();
  await shot('home-after-game');

  // The new screens.
  for (const [label, name] of [
    ['Tactics', 'tactics'],
    ['Schedule', 'schedule'],
  ]) {
    await page.locator('.cr-nav', { hasText: label }).click();
    await shot(name);
  }
  await page.locator('.cr-table .cr-name').filter({ hasText: /\d+–\d+/ }).first().click();
  await shot('game-box');
  await page.locator('.cr-nav', { hasText: 'Squad' }).click();
  await page.getByRole('radio', { name: 'Season stats' }).click();
  await shot('squad-season-stats');
  await page.locator('.cr-nav', { hasText: 'Competitions' }).click();
  await page.locator('.cr-comp', { hasText: 'Big League · Europe' }).click();
  await shot('table-big-league-europe');
  await page.getByRole('tab', { name: 'Results' }).click();
  await shot('results');

  // The next game day: watched through the real match screen (played on quickly through its dev handle).
  await page.locator('.cr-nav', { hasText: 'Home' }).click();
  for (let i = 0; i < 20 && !(await page.locator('.prep-screen').count()); i++) {
    await page.locator('.cr-continue-top').click();
    await idle();
  }
  await button(/^Watch/).click();
  await page.waitForFunction(() => window.__liveMatch, null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await shot('match');
  await page.evaluate(() => {
    const m = window.__liveMatch;
    for (let i = 0; i < 400000 && m.phase !== 'final'; i++) {
      m.tick(0.25);
      if (m.phase === 'timeout' || m.phase === 'break') m.resume();
      if (m.phase === 'argue') m.letItGo();
      if (m.phase === 'clutch') while (m.clutch) m.submitClutch(m.clutch.pending[0], null);
    }
    m.version++;
  });
  await page.locator('.final-card').waitFor({ timeout: 30000 });
  await shot('match-final');
  await button(/See the result/).click();
  await page.locator('.res').waitFor({ timeout: 120000 });
  await idle();
  await shot('result-watched');
  await page.locator('.res').getByRole('button', { name: /Continue/ }).first().click();
  await page.locator('.cr-side').waitFor();
  await shot('home-after-watch');

  // Simulate to the end of the regular season: the question, the progress, the review.
  await page.locator('.cr-sim-end').click();
  await shot('sim-to-end-question');
  if (full) {
    const t1 = Date.now();
    await page.getByRole('alertdialog').getByRole('button', { name: /Simulate to the end/ }).click();
    await page.waitForTimeout(1500);
    await shot('sim-to-end-progress');
    await page.locator('.cr-review').waitFor({ timeout: 900000 });
    console.log(`Simulated to the end of the regular season: ${((Date.now() - t1) / 1000).toFixed(1)} s`);
    await shot('season-review');
    await page.locator('.tb-back').click();
    await page.locator('.cr-side').waitFor();
    await shot('home-season-over');
  } else {
    await page.keyboard.press('Escape');
  }

  const timings = await page.evaluate(() => window.__matchdays ?? []);
  const days = timings.filter((t) => t.games > 0);
  const max = (k) => Math.max(...days.map((t) => t[k]));
  const avg = (k) => Math.round(days.reduce((s, t) => s + t[k], 0) / Math.max(1, days.length));
  console.log(`Matchdays: ${days.length}; games a day up to ${max('games')}; worker ${avg('sim')} ms on average, ${max('sim')} at most; whole day ${avg('day')} ms on average, ${max('day')} at most; save ${avg('save')} ms on average, ${max('save')} at most`);
} finally {
  await browser.close();
  await server.close();
}
