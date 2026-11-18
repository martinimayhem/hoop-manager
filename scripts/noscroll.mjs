// The no-scroll sweep (GAME_FLOW §6.1a rule 1, CLAUDE.md "Screens: never scroll"): opens every
// screen at the four sizes and fails if the page, or any element in it, can scroll. Plays the real
// app headlessly in your installed Chrome (CHROME_PATH for another Chromium).
//
//   node scripts/noscroll.mjs [--shots frames/noscroll] [--only <name-part>] [--size 1366x650]
//
// Sizes: laptop 1366 x 768 is about 1366 x 650 of page once the browser's own bars are counted
// (GAME_FLOW §6.1a), so the laptop check uses 1366 x 650; desktop 1920 x 1080, tablet 1024 x 768 and
// 768 x 1024 as they are. Exit code 1 if any screen scrolls.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const shots = arg('shots', null);
const only = arg('only', null);
const SIZES = (arg('size', null) ? [arg('size')] : ['1366x650', '1920x1080', '1024x768', '768x1024']).map((s) => s.split('x').map(Number));
if (shots) mkdirSync(shots, { recursive: true });

/** Everything that can scroll on the page now: the page itself, and every element with overflow auto/scroll whose content is bigger than its box. */
function scrollers() {
  const out = [];
  const de = document.scrollingElement || document.documentElement;
  if (de.scrollHeight > innerHeight + 1 || de.scrollWidth > innerWidth + 1) out.push(`page ${de.scrollWidth}x${de.scrollHeight} in ${innerWidth}x${innerHeight}`);
  const name = (el) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    return `${el.tagName.toLowerCase()}${cls}`;
  };
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    const y = /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
    const x = /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1;
    if (x || y) out.push(`${name(el.parentElement)} > ${name(el)} ${x ? `x ${el.scrollWidth}/${el.clientWidth}` : ''}${y ? ` y ${el.scrollHeight}/${el.clientHeight}` : ''}`.trim());
    // Content cut off at the bottom of a box that hides its overflow: as bad as a scroll bar (you can't
    // see it at all). One-line text cut short with "…" is fine; a box missing rows is not.
    const clipped = /(hidden|clip)/.test(cs.overflowY) && el.clientHeight > 40 && el.scrollHeight > el.clientHeight + 4 && el.querySelector('*');
    if (clipped && !el.closest('canvas, svg, .court-box')) out.push(`clipped ${name(el.parentElement)} > ${name(el)} y ${el.scrollHeight}/${el.clientHeight}`);
  }
  // Rule 2's minimum sizes: no visible text under 12 px (labels; body text is 14 px).
  const small = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!t.textContent.trim()) continue;
    const el = t.parentElement;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 11.9) small.set(`${name(el)} ${size}px`, t.textContent.trim().slice(0, 24));
  }
  for (const [k, v] of small) out.push(`text ${k} "${v}"`);
  return out;
}

// ---------------------------------------------------------------------------
// The screens. Each journey starts on a fresh page (fresh storage) and calls check(name) on every
// screen it reaches.

const button = (page, re) => page.getByRole('button', { name: re }).first();

const journeys = {
  async menu(page, check) {
    await page.goto(base);
    await check('main menu');
    await button(page, /Saved games/).click();
    await check('saved games');
  },
  // The fullest main menu: a Quick League save (its Continue panel) and three saved careers.
  async menuFull(page, check) {
    await page.goto(base);
    await button(page, /Pro League/).click();
    await page.locator('button.primary').last().click();
    await page.waitForTimeout(400);
    for (let i = 0; i < 3; i++) {
      await page.goto(base);
      await button(page, /New career/).click();
      await page.locator('.cr-new-side .cr-start').waitFor({ timeout: 20000 });
      await page.locator('.cr-club').nth(i).click();
      await page.locator('.cr-new-side .cr-start').click();
      await page.locator('.cr-top-name').waitFor();
    }
    await page.goto(base);
    await page.waitForTimeout(400);
    await check('main menu (Quick League save and 3 careers)');
    // New career with every slot full: the "save over" choice shows.
    await button(page, /New career/).click();
    await page.locator('.cr-new-side .cr-start').waitFor({ timeout: 20000 });
    await check('career: new (all slots full)');
  },
  async quickLeague(page, check) {
    for (const league of [/Legends League/, /Pro League/, /Street League/]) {
      await page.goto(base);
      await button(page, league).click();
      await page.waitForTimeout(200);
      await check(`quick league: choose club (${league.source.split(' ')[0]})`);
    }
    // Start the season with the club offered, then its hub, game plan, match and result.
    await page.locator('button.primary').last().click();
    await page.waitForTimeout(400);
    await check('quick league: hub');
    await page.locator('button.primary.big').first().click();
    await page.waitForTimeout(400);
    await check('quick league: game plan');
  },
  async friendly(page, check) {
    await page.goto(base);
    await button(page, /Friendly match/).click();
    await page.waitForTimeout(300);
    await check('friendly: game plan');
    for (const tab of [/Starting five/, /Key matchup/, /Scouting:/, /likely plan/]) {
      await page.getByRole('tab', { name: tab }).click();
      await check(`friendly: game plan · ${tab.source.replace(/[\\:]/g, '')}`);
    }
    await page.getByRole('tab', { name: /Tactics/ }).click();
    await page.locator('button.primary').last().click();
    await page.waitForTimeout(2500);
    await check('match (2D)');
    // A timeout called during play: the break screen opens at the next dead ball.
    const timeout = page.getByRole('button', { name: /Timeout/ }).first();
    if (await timeout.count()) {
      await timeout.click().catch(() => {});
      await page.locator('.brk').waitFor({ timeout: 30000 }).catch(() => {});
      if (await page.locator('.brk').count()) await check('match: timeout');
    }
  },
  async match3d(page, check) {
    await page.goto(`${base}?view=3d`);
    await button(page, /Friendly match/).click();
    await page.waitForTimeout(300);
    await page.locator('button.primary').last().click();
    await page.waitForTimeout(4000);
    await check('match (3D)');
  },
  async popups(page, check) {
    // The game's "are you sure?" box: Quick League, simulate to the end of the season.
    await page.goto(base);
    await button(page, /Pro League/).click();
    await page.locator('button.primary').last().click();
    await page.waitForTimeout(400);
    await button(page, /Sim to season end/).click();
    await page.waitForTimeout(200);
    await check('pop-up: confirm (sim the season)');
    await page.keyboard.press('Escape');
    await page.goto(base);
    await button(page, /Saved games/).click();
    await check('saved games (with a save)');
  },
  async matchPopups(page, check) {
    // (?gamecast is left out: a dev preview in a fixed 1040 px box; the real match screen shows those stats.)
    for (const q of ['break=1', 'break=2', 'result']) {
      await page.goto(`${base}?${q}`);
      await page.waitForTimeout(q === 'result' ? 4000 : 2500);
      const name = `match: ${q === 'break=1' ? 'quarter break' : q === 'break=2' ? 'halftime break' : 'result'}`;
      await check(name);
      // Every part of the result's box (shot chart, and on narrower screens the summary).
      const parts = await page.locator('.res-parts button').count();
      for (let i = 1; i < parts; i++) {
        const label = (await page.locator('.res-parts button').nth(i).textContent()).trim();
        await page.locator('.res-parts button').nth(i).click();
        await check(`${name} · ${label.toLowerCase()}`);
      }
      // Every tab of a break screen.
      const tabs = await page.locator('.brk-views button').count();
      for (let i = 0; i < tabs; i++) {
        const label = (await page.locator('.brk-views button').nth(i).textContent()).replace(/\(.*\)/, '').trim();
        await page.locator('.brk-views button').nth(i).click();
        await check(`${name} · ${/Team talk|Key players|Tactics/.test(label) ? label : i <= (tabs === 5 ? 1 : 0) ? 'your team' : 'their team'}`);
      }
    }
  },
  async career(page, check) {
    await page.goto(base);
    await button(page, /New career/).click();
    await page.locator('.cr-new-side .cr-start').waitFor({ timeout: 20000 });
    await check('career: new (America)');
    await button(page, /^Europe$/).click();
    await check('career: new (Europe, all countries)');
    await page.locator('.cr-club', { hasText: 'Kaunas Ambers' }).click().catch(() => {});
    await button(page, /^Lithuania$/).click();
    await page.locator('.cr-club').first().click();
    await page.locator('.cr-new-side .cr-start').click();
    await page.locator('.cr-top-name').waitFor();
    for (const tab of [/First team/, /Dev squad/, /Academy/]) {
      await page.getByRole('tab', { name: tab }).click();
      for (const v of ['Overview', 'Attributes', 'Profile']) {
        await page.getByRole('radio', { name: v }).click();
        await check(`career: squad ${tab.source.replace(/\\/g, '')} · ${v}`);
      }
    }
    await page.getByRole('tab', { name: /First team/ }).click();
    await page.getByRole('radio', { name: 'Overview' }).click();
    await page.locator('.cr-table .cr-name').first().click();
    await check('career: player page (yours)');
    await page.locator('.cr-nav', { hasText: 'Competitions' }).click();
    await check('career: competitions');
    await page.locator('.cr-comp', { hasText: 'US Division 2' }).click();
    await check('career: table (16 clubs)');
    await page.locator('.cr-back').first().click();
    await page.locator('.cr-comp', { hasText: 'Big League · America' }).click();
    await check('career: table (18 clubs)');
    await page.locator('.cr-table tr:not(.me) .cr-name').first().click();
    await check('career: club page (other)');
    await page.locator('.cr-table .cr-name').first().click();
    await check('career: player page (other club)');
    await page.locator('.cr-nav', { hasText: 'Club' }).click();
    await check('career: club (yours)');
    await page.locator('.cr-nav', { hasText: 'Home' }).click({ force: true });
    await check('career: coming-soon message');
    await page.locator('.cr-nav', { hasText: 'Main menu' }).click();
    await check('main menu (with a career saved)');
  },
};

// ---------------------------------------------------------------------------

const server = await createServer({ logLevel: 'error', server: { port: 5196, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : { channel: 'chrome', headless: true });

const results = []; // { size, name, problems }
try {
  for (const [w, h] of SIZES) {
    for (const [jname, journey] of Object.entries(journeys)) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w <= 1024 /* the two tablet sizes */ });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.error(`  page error (${w}x${h} ${jname}): ${e.message}`));
      let n = 0;
      const check = async (name) => {
        if (only && !name.includes(only)) return;
        await page.waitForTimeout(120);
        const problems = await page.evaluate(scrollers);
        results.push({ size: `${w}x${h}`, name, problems });
        if (shots) await page.screenshot({ path: join(shots, `${w}x${h}-${jname}-${String(++n).padStart(2, '0')}.png`) });
      };
      try {
        await journey(page, check);
      } catch (e) {
        results.push({ size: `${w}x${h}`, name: `${jname}: could not continue`, problems: [e.message.split('\n')[0]] });
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}

const failing = results.filter((r) => r.problems.length);
const names = [...new Set(results.map((r) => r.name))];
console.log(`No-scroll sweep: ${names.length} screens × ${SIZES.length} sizes = ${results.length} checks, ${failing.length} failing.\n`);
for (const name of names) {
  const rows = results.filter((r) => r.name === name);
  const bad = rows.filter((r) => r.problems.length);
  console.log(`${bad.length ? 'FAIL' : 'ok  '}  ${name}${bad.length ? `  (${bad.map((r) => r.size).join(', ')})` : ''}`);
  for (const r of bad) console.log(`        ${r.size}: ${r.problems.slice(0, 3).join(' | ')}${r.problems.length > 3 ? ` (+${r.problems.length - 3} more)` : ''}`);
}
process.exit(failing.length ? 1 : 0);
