// The navigation sweep (GAME_FLOW §6.1b rule 11): visits every screen and fails if Back is missing or
// not in its place, if the browser's back (or Escape, or a reload) doesn't do what it should, if a
// screen has no way out, or if a button or sidebar item leads nowhere. Plays the real app headlessly in
// your installed Chrome (CHROME_PATH for another Chromium).
//
//   node scripts/navsweep.mjs [--size 1366x650] [--no-buttons]

import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const SIZES = (arg('size', null) ? [arg('size')] : ['1366x650', '1920x1080', '1024x768', '768x1024']).map((s) => s.split('x').map(Number));
const BUTTONS = !process.argv.includes('--no-buttons');

const server = await createServer({ logLevel: 'error', server: { port: 5193, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : { channel: 'chrome', headless: true });

const fails = [];
let checks = 0;
const fail = (size, what) => fails.push(`${size}: ${what}`);
const hash = (page) => page.evaluate(() => location.hash || '#/');
const wait = (page, ms = 250) => page.waitForTimeout(ms);

/** Plays the match on screen to its end (the dev hook the match screen leaves on window). */
async function playToEnd(page) {
  await page.evaluate(() => {
    const m = window.__liveMatch;
    for (let i = 0; i < 3_000_000 && m.phase !== 'final'; i++) {
      m.tick(0.25);
      if (m.phase === 'break' || m.phase === 'timeout') m.resume();
      if (m.phase === 'clutch') while (m.clutch) m.submitClutch(m.clutch.pending[0], null);
      if (m.phase === 'argue') m.letItGo();
    }
  });
  await wait(page, 600);
}

/** Back's place on this screen: the first button of the top bar. */
async function backBox(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('.tb');
    if (!bar) return null;
    const first = bar.querySelector('button');
    const b = first?.getBoundingClientRect();
    return { first: first?.classList.contains('tb-back') ?? false, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), disabled: first.disabled, label: first.getAttribute('aria-label') };
  });
}

async function run(w, h) {
  const size = `${w}x${h}`;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w <= 1024 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail(size, `page error: ${e.message}`));
  let ref = null;
  const screens = [];

  /** Checks the screen now open: top bar and Back in place, no "coming soon", and records it. */
  async function screen(name, { menu = false } = {}) {
    await wait(page);
    checks++;
    const text = await page.evaluate(() => document.body.innerText);
    if (/coming soon/i.test(text)) fail(size, `${name}: says "coming soon"`);
    const b = await backBox(page);
    if (menu) {
      if (b) fail(size, `${name}: the main menu has a top bar`);
    } else if (!b) fail(size, `${name}: no top bar`);
    else {
      if (!b.first) fail(size, `${name}: Back is not the first button of the top bar`);
      ref ??= b;
      if (Math.abs(b.x - ref.x) > 1 || Math.abs(b.y - ref.y) > 1 || Math.abs(b.w - ref.w) > 1 || Math.abs(b.h - ref.h) > 1) fail(size, `${name}: Back at ${b.x},${b.y} ${b.w}x${b.h}, elsewhere ${ref.x},${ref.y} ${ref.w}x${ref.h}`);
      // Every screen has a way out: Back (or Leave) works, or the main menu button is there.
      const out = await page.locator('.tb-menu').count();
      if (b.disabled && !out) fail(size, `${name}: no way out`);
    }
    screens.push({ name, hash: await hash(page) });
  }

  // ---- A career: the screens, browser back, Escape, reload ----
  await page.goto(`${base}/`);
  await screen('main menu', { menu: true });
  await page.getByRole('button', { name: /New career/ }).click();
  await page.locator('.cr-new-side .cr-start').waitFor({ timeout: 20000 });
  await screen('new career');
  await page.getByRole('button', { name: /^Europe$/ }).click();
  await page.getByRole('button', { name: /^Lithuania$/ }).click();
  await page.locator('.cr-club').first().click();
  await page.locator('.cr-new-side .cr-start').click();
  await page.locator('.cr-side').waitFor();
  await screen('career: home');
  const trail = [await hash(page)];
  const step = async (name, f) => {
    await f();
    await screen(name);
    trail.push(await hash(page));
  };
  await step('career: squad', () => page.locator('.cr-nav', { hasText: 'Squad' }).click());
  await step('career: player (yours)', () => page.locator('.cr-table .cr-name').first().click());
  await step('career: competitions', () => page.locator('.cr-nav', { hasText: 'Competitions' }).click());
  await step('career: league table', () => page.locator('.cr-comp').first().click());
  await step('career: another club', () => page.locator('.cr-table tr:not(.me) .cr-name').first().click());
  await step('career: another club\'s player', () => page.locator('.cr-table .cr-name').first().click());
  await step('career: club (yours)', () => page.locator('.cr-nav', { hasText: 'Club' }).click());
  await step('career: tactics', () => page.locator('.cr-nav', { hasText: 'Tactics' }).click());
  await step('career: schedule', () => page.locator('.cr-nav', { hasText: 'Schedule' }).click());
  // A reload comes back to the same screen.
  const here = await hash(page);
  await page.reload();
  await page.locator('.tb').waitFor();
  await wait(page, 600);
  checks++;
  if ((await hash(page)) !== here) fail(size, `reload on ${here} went to ${await hash(page)}`);
  // Browser back, then Escape, walk the trail backwards; the path's first part goes to its screen.
  for (let i = trail.length - 2; i >= 0; i--) {
    if (i % 2 === 0) await page.goBack();
    else await page.keyboard.press('Escape');
    await wait(page, 400);
    checks++;
    const now = await hash(page);
    if (now !== trail[i]) fail(size, `${i % 2 === 0 ? 'browser back' : 'Escape'} from ${trail[i + 1]} went to ${now}, not ${trail[i]}`);
  }
  // Back from the first career screen: the main menu (the new-career screen was replaced).
  await page.locator('.tb-back').click();
  await wait(page, 400);
  checks++;
  if ((await hash(page)) !== '#/') fail(size, `Back from the first career screen went to ${await hash(page)}, not the main menu`);
  // The path: its first part leads to its screen.
  await page.goForward();
  await page.goto(`${base}/#/career/0/competition/big-league-europe`);
  await page.locator('.tb').waitFor();
  await wait(page, 800);
  await page.locator('.tb-crumb button').first().click();
  await wait(page);
  checks++;
  if (!(await hash(page)).includes('/competitions')) fail(size, `the path's first part led to ${await hash(page)}`);
  // ---- The season: your game day, Leave from a match, the result, a box score, the review ----
  const idle = async () => {
    await wait(page, 200);
    await page.locator('.cr-busy').waitFor({ state: 'detached', timeout: 600000 });
  };
  const toGameDay = async () => {
    for (let i = 0; i < 20 && !(await page.locator('.prep-screen').count()); i++) {
      await page.locator('.cr-continue-top').click();
      await idle();
    }
  };
  await page.locator('.cr-nav', { hasText: 'Home' }).click();
  await toGameDay();
  await screen('career: match preparation');
  checks++;
  if ((await backBox(page))?.label !== 'Leave') fail(size, 'match preparation has no Leave in the Back position');
  // Leave from preparation: back to the career, the game still to play.
  await page.locator('.tb-back').click();
  await wait(page, 400);
  checks++;
  if (!(await page.locator('.cr-side').count())) fail(size, `Leave from match preparation went to ${await hash(page)}`);
  // Watch, then leave the match: it asks, and the rest is simulated (the result counts).
  await page.locator('.cr-continue-top').click();
  await page.locator('.prep-screen').waitFor();
  await page.getByRole('button', { name: /^Watch/ }).click();
  await page.locator('.match').waitFor();
  await screen('career: match');
  await page.locator('.tb-back').click();
  await wait(page, 300);
  checks++;
  if (!(await page.locator('[role="alertdialog"]').count())) fail(size, 'Leave during a career match did not ask first');
  else {
    await page.getByRole('button', { name: /Leave the match/ }).click();
    await idle();
    checks++;
    const counted = await page.evaluate(() => /(Won|Lost) \d+–\d+/.test(document.body.innerText));
    if (!(await page.locator('.cr-side').count()) || !counted) fail(size, 'leaving a career match did not go back with the game simulated and counted');
  }
  // Simulate: the result screen, then Leave goes back to the career.
  await toGameDay();
  await page.getByRole('button', { name: /^Simulate$/ }).click();
  await page.locator('.res').waitFor({ timeout: 60000 });
  await idle();
  await screen('career: result');
  await page.locator('.tb-back').click();
  await wait(page, 400);
  checks++;
  if (!(await page.locator('.cr-side').count())) fail(size, `Leave from the result went to ${await hash(page)}`);
  await page.locator('.cr-nav', { hasText: 'Schedule' }).click();
  await page.locator('.cr-table .cr-name').filter({ hasText: /\d+–\d+/ }).first().click();
  await screen('career: box score');
  // Simulate to the end of the regular season: the question, then the review; Continue is then gone.
  await page.locator('.cr-sim-end').click();
  await wait(page, 300);
  checks++;
  if (!(await page.locator('[role="alertdialog"]').count())) fail(size, 'Simulate to the end did not ask first');
  await page.getByRole('alertdialog').getByRole('button', { name: /Simulate to the end/ }).click();
  await page.locator('.cr-review').waitFor({ timeout: 900000 });
  await screen('career: season review');
  await page.locator('.tb-back').click();
  await wait(page, 400);
  checks++;
  if (await page.locator('.cr-continue-top').count()) fail(size, 'Continue is still there after the regular season');
  await screen('career: after the season');

  // The main menu button saves the career and says so.
  await page.locator('.tb-menu').click();
  await wait(page, 600);
  checks++;
  if (!(await page.evaluate(() => /career is saved/i.test(document.body.innerText)))) fail(size, 'leaving a career did not say it was saved');

  // ---- Quick League: hub, game plan, match (Leave asks, pauses), result ----
  await page.getByRole('button', { name: /Pro League/ }).click();
  await screen('quick league: choose club');
  await page.locator('button.primary').last().click();
  await screen('quick league: hub');
  await page.locator('button.primary.big').first().click();
  await screen('quick league: game plan');
  await page.getByRole('button', { name: /Tip-off/ }).click();
  await page.locator('.match').waitFor();
  await screen('quick league: match');
  const leave = await backBox(page);
  checks++;
  if (leave?.label !== 'Leave') fail(size, 'the match has no Leave in the Back position');
  // Browser back during the match asks first, with the match paused; Keep playing stays.
  await page.goBack();
  await wait(page, 400);
  checks++;
  const asked = await page.locator('[role="alertdialog"]').count();
  const paused = await page.evaluate(() => window.__liveMatch?.paused);
  if (!asked) fail(size, 'browser back during a match did not ask first');
  if (!paused) fail(size, 'the match was not paused while asking');
  if (asked) await page.getByRole('button', { name: /Keep playing/ }).click();
  await wait(page, 300);
  checks++;
  if (!(await hash(page)).includes('/match')) fail(size, `"Keep playing" left the match (${await hash(page)})`);
  await playToEnd(page);
  await page.getByRole('button', { name: /See the result/ }).click();
  await screen('quick league: result');
  await page.locator('.tb-back').click();
  await wait(page, 400);
  checks++;
  if (!(await hash(page)).endsWith('/hub')) fail(size, `Leave from the result went to ${await hash(page)}, not the hub`);
  // Saved games, with a save.
  await page.locator('.tb-menu').click();
  await page.getByRole('button', { name: /Saved games/ }).click();
  await screen('saved games');

  // ---- Friendly: game plan, match (Leave asks; leaving goes back to the menu) ----
  await page.goto(`${base}/`);
  await page.getByRole('button', { name: /Friendly match/ }).click();
  await screen('friendly: game plan');
  await page.getByRole('button', { name: /Tip-off/ }).click();
  await page.locator('.match').waitFor();
  await screen('friendly: match');
  await page.locator('.tb-back').click();
  await wait(page, 300);
  checks++;
  if (!(await page.locator('[role="alertdialog"]').count())) fail(size, 'Leave during a friendly did not ask first');
  else {
    await page.getByRole('button', { name: /Leave the match/ }).click();
    await wait(page, 400);
    if ((await hash(page)) !== '#/') fail(size, `leaving the friendly went to ${await hash(page)}`);
  }

  // ---- Every button and sidebar item leads somewhere (one size is enough) ----
  if (BUTTONS && size === '1366x650') {
    const urls = [...new Set(screens.map((s) => s.hash))].filter((x) => !x.includes('/match') && !x.includes('/result'));
    // A fresh page each time (a hash-only change would keep the screen's state).
    const fresh = async (url) => {
      await page.goto('about:blank');
      await page.goto(`${base}/${url}`);
      await wait(page, 900);
    };
    for (const url of urls) {
      await fresh(url);
      const n = await page.locator('button:visible').count().catch(() => 0);
      for (let i = 0; i < n; i++) {
        try {
        await fresh(url);
        const btn = page.locator('button:visible').nth(i);
        if (!(await btn.count())) continue;
        const info = await btn.evaluate((b) => ({
          text: (b.getAttribute('aria-label') || b.innerText || '').trim().slice(0, 40),
          disabled: b.disabled,
          // Already the chosen option or the open tab: choosing it again rightly changes nothing.
          current: b.getAttribute('aria-current') === 'page' || b.classList.contains('here') || b.classList.contains('on') || b.classList.contains('active') || b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-selected') === 'true' || b.getAttribute('aria-checked') === 'true',
        }));
        if (info.disabled || info.current) continue;
        const before = await page.evaluate(() => location.hash + '|' + document.body.innerHTML);
        let clicked = true;
        await btn.click({ timeout: 3000 }).catch(() => (clicked = false));
        await wait(page, 400);
        const after = await page.evaluate(() => location.hash + '|' + document.body.innerHTML);
        checks++;
        if (!clicked) fail(size, `${url}: button "${info.text}" can't be clicked`);
        else if (before === after) fail(size, `${url}: button "${info.text}" does nothing`);
        } catch (e) {
          fail(size, `${url}: button ${i}: ${e.message.split('\n')[0]}`);
        }
      }
    }
  }
  await ctx.close();
}

try {
  for (const [w, h] of SIZES) await run(w, h);
} finally {
  await browser.close();
  await server.close();
}
console.log(`Navigation sweep: ${checks} checks, ${fails.length} failing.`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
