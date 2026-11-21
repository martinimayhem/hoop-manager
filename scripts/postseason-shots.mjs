// The postseason through the real screens, headless in your installed Chrome (slice brief W2b §9): a
// new career simulated to the end of the regular season, then Continue into the postseason; one game
// watched, one played as Key moments (breaks, then the last 5 minutes live); the brackets, a cup,
// History, the moments Continue stops for, the season review and the next season. Photographs every
// new screen.
//
//   node scripts/postseason-shots.mjs [--size 1366x650] [--out frames/postseason]

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const [W, H] = arg('size', '1366x650').split('x').map(Number);
const out = arg('out', 'frames/postseason');
mkdirSync(out, { recursive: true });

const server = await createServer({ logLevel: 'error', server: { port: 5198, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : { channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: W <= 1024 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let n = 0;
const shot = async (name) => {
  await page.waitForTimeout(300);
  const file = join(out, `${W}x${H}-${String(++n).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  console.log('shot', file);
};
const idle = async () => {
  await page.waitForTimeout(200);
  await page.locator('.cr-busy').waitFor({ state: 'detached', timeout: 900000 });
};
const button = (re) => page.getByRole('button', { name: re }).first();
const simAhead = async (re) => {
  await page.locator('.cr-sim-end').click();
  await page.locator('.slot-picker-box').waitFor();
  await page.locator('.slot-picker-box .mm-career-slot', { hasText: re }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: /Simulate/ }).click();
  await idle();
};
/** Continue until a game day (reading any moment on the way). Returns false at the season's end. */
const toGameDay = async () => {
  for (let i = 0; i < 80; i++) {
    if (await page.locator('.prep-screen').count()) return true;
    if (await page.locator('.cr-review .cr-tabs').count()) return false;
    if (await page.locator('.cr-moment').count()) {
      await page.locator('.cr-moment .cr-start').click();
      await idle();
      continue;
    }
    await page.locator('.cr-continue-top').click();
    await idle();
  }
  return false;
};
const playLive = async () => {
  await page.waitForFunction(() => window.__liveMatch, null, { timeout: 20000 });
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
  await button(/See the result/).click();
  await page.locator('.res').waitFor({ timeout: 120000 });
  await idle();
};

try {
  await page.goto(base);
  await button(/New career/).click();
  await page.locator('.cr-new-side .cr-start').waitFor({ timeout: 30000 });
  await button(/^Europe$/).click();
  await button(/^Lithuania$/).click();
  await page.locator('.cr-club').first().click();
  await page.locator('.cr-new-side .cr-start').click();
  // All slots full: save over the first.
  if (await page.locator('.slot-picker-box').count()) await page.locator('.slot-picker-box .mm-career-slot').first().click();
  await page.locator('.cr-side').waitFor();
  await page.locator('.cr-continue-top').click();
  await idle();
  await page.locator('.cr-sim-end').click();
  await page.locator('.slot-picker-box').waitFor();
  await shot('simulate-ahead-menu');
  await page.keyboard.press('Escape');
  const t0 = Date.now();
  await simAhead(/end of the regular season/);
  console.log(`Regular season simulated in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (await page.locator('.cr-moment').count()) {
    await shot('moment-postseason');
    await page.locator('.tb-back').click();
    await page.locator('.cr-side').waitFor();
  }
  await shot('home-regular-season-over');
  await page.locator('.cr-nav', { hasText: 'Competitions' }).click();
  await shot('competitions');
  await page.locator('.cr-comp.cup', { hasText: 'Cup' }).first().click();
  await shot('cup');
  await page.locator('.cr-nav', { hasText: 'Competitions' }).click();
  await page.locator('.cr-comp', { hasText: 'Big League · Europe' }).click();
  await page.getByRole('tab', { name: 'Playoffs' }).click();
  await shot('bracket-before');
  await page.locator('.cr-nav', { hasText: 'Home' }).click();

  // Continue into the postseason: the moment, then a game day.
  await page.locator('.cr-continue-top').click();
  await idle();
  if (!(await toGameDay())) throw new Error('No postseason game day');
  await shot('prep-postseason');
  // One game watched.
  await button(/^Watch/).click();
  await page.locator('.match').waitFor();
  await shot('match-postseason');
  await playLive();
  await shot('result-watched');
  await page.locator('.res').getByRole('button', { name: /Continue/ }).first().click();
  await page.locator('.cr-side').waitFor();
  await shot('home-postseason');
  // One game as Key moments.
  if (await toGameDay()) {
    await button(/^Key moments/).click();
    await page.locator('.cr-km').waitFor();
    await shot('keymoments-q1');
    await page.getByRole('tab', { name: 'Tactics' }).click();
    await shot('keymoments-tactics');
    await page.getByRole('tab', { name: /Starting five/ }).click();
    await shot('keymoments-rotation');
    for (let i = 0; i < 6 && (await page.locator('.cr-km').count()); i++) {
      await page.locator('.cr-continue-top').click();
      await page.waitForTimeout(400);
      if (i === 1 && (await page.locator('.cr-km').count())) await shot('keymoments-halftime');
    }
    if (await page.locator('.match').count()) {
      await shot('keymoments-live');
      await playLive();
    } else await page.locator('.res').waitFor({ timeout: 60000 });
    await idle();
    await shot('result-keymoments');
    await page.locator('.res').getByRole('button', { name: /Continue/ }).first().click();
    await page.locator('.cr-side').waitFor();
  }
  await page.locator('.cr-nav', { hasText: 'Competitions' }).click();
  await page.locator('.cr-comp', { hasText: 'Big League · Europe' }).click();
  await page.getByRole('tab', { name: 'Playoffs' }).click();
  await shot('bracket-during');
  await page.locator('.cr-nav', { hasText: 'Schedule' }).click();
  await shot('schedule-postseason');

  // On to the end: simulate ahead whenever possible, reading the moments (knocked out, season over).
  const t1 = Date.now();
  for (let i = 0; i < 200 && !(await page.locator('.cr-review .cr-tabs').count()); i++) {
    if (await page.locator('.cr-moment').count()) {
      const title = await page.locator('.cr-moment h1').textContent();
      if (/Knocked out|over/i.test(title ?? '')) await shot(`moment-${/over/i.test(title) ? 'season-over' : 'knocked-out'}`);
      if (await button(/Simulate to the end of the season/).count()) {
        await button(/Simulate to the end of the season/).click();
        await idle();
        continue;
      }
      await page.locator('.cr-moment .cr-start').click();
      await idle();
      continue;
    }
    if (await page.locator('.prep-screen').count()) {
      await button(/^Simulate$/).click();
      await page.locator('.res').waitFor({ timeout: 60000 });
      await idle();
      await page.locator('.res').getByRole('button', { name: /Continue/ }).first().click();
      await page.locator('.cr-side').waitFor();
      continue;
    }
    await page.locator('.cr-continue-top').click();
    await idle();
  }
  console.log(`Postseason to the review: ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  for (const [tab, name] of [
    ['Your season', 'review-you'],
    ['Champions', 'review-champions'],
    ['Up and down', 'review-moves'],
    ['Players', 'review-players'],
  ]) {
    await page.getByRole('tab', { name: tab }).click();
    await shot(name);
  }
  await button(/Start the next season/).click();
  await idle();
  // Before the new season (WORLD_SPEC §7.0): the contract screen, then the free agents.
  await page.locator('.cr-deals').waitFor();
  await shot('contracts');
  if (await page.locator('.cr-deals-list tbody tr').count()) {
    await page.locator('.cr-deals-list .cr-deal-who').first().click();
    await shot('contracts-first');
    for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Lower the wage' }).click();
    await shot('contracts-asks');
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Lower the wage' }).click();
    await shot('contracts-no');
    await page.locator('.cr-offer .primary').click();
    await page.waitForTimeout(300);
    await shot('contracts-answer-no');
    await page.getByRole('button', { name: 'His demand' }).click();
    await page.locator('.cr-offer .primary').click();
    await page.waitForTimeout(300);
    await shot('contracts-signed');
  }
  await page.locator('.cr-deals .cr-start').click();
  if (await page.locator('[role="alertdialog"]').count()) {
    await shot('contracts-let-go');
    await page.getByRole('alertdialog').getByRole('button', { name: /Let them go/ }).click();
  }
  await page.waitForTimeout(400);
  await shot('freeagents');
  await page.locator('.cr-toggle', { hasText: /won't consider/ }).click();
  const wont = page.locator('.cr-deals-list tr', { hasText: "Won't consider" }).first();
  if (await wont.count()) {
    await wont.locator('.cr-deal-who').click();
    await shot('freeagents-wont');
  }
  await page.locator('.cr-toggle', { hasText: /won't consider/ }).click();
  await page.locator('.cr-deals-list .cr-deal-who').nth(2).click();
  await shot('freeagents-offer');
  if (await page.getByRole('button', { name: /^Auto-fill$/ }).count()) await page.getByRole('button', { name: /^Auto-fill$/ }).click();
  await page.waitForTimeout(400);
  await shot('freeagents-filled');
  await page.locator('.cr-deals .cr-start').click();
  await idle();
  await page.locator('.cr-side').waitFor();
  await shot('home-next-season');
  await page.locator('.cr-nav', { hasText: 'Competitions' }).click();
  await page.locator('.cr-chip', { hasText: 'History' }).click();
  await shot('history');
  if (errors.length) console.log('PAGE ERRORS:', errors.slice(0, 5).join(' | '));
} finally {
  await browser.close();
  await server.close();
}
