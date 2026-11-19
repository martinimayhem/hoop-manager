// The no-scroll sweep (GAME_FLOW §6.1a rule 1, CLAUDE.md "Screens: never scroll"): opens every
// screen at the four sizes and fails if the page, or any element in it, can scroll. Plays the real
// app headlessly in your installed Chrome (CHROME_PATH for another Chromium).
//
//   node scripts/noscroll.mjs [--shots frames/noscroll] [--only <name-part>] [--size 1366x650]
//
// Sizes: laptop 1366 x 768 is about 1366 x 650 of page once the browser's own bars are counted
// (GAME_FLOW §6.1a), so the laptop check uses 1366 x 650; desktop 1920 x 1080, tablet 1024 x 768 and
// 768 x 1024 as they are. Exit code 1 if any screen scrolls.

import { mkdirSync, writeFileSync } from 'node:fs';
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
  // Rule 2's minimum sizes (GAME_FLOW §6.1a): no visible text under 12 px, and 14 px for anything read
  // as content, table cells included. 12–13 px only for column headers, labels and captions: a table
  // header (th), a <label>, <small>, <dt>, a caption, a tag or count badge, or one of the game's label
  // and caption classes below (section kickers, tile labels, legends, hints). A button's own text is
  // content (14 px); only a caption inside it (its <small>) may be smaller.
  const LABEL = [
    'th, thead, caption, figcaption, legend, label, small, dt, .small, .lbl, .tag, .count, .group-row, .form-dot',
    // Kickers, field labels and tile labels.
    '.mm-kicker, .mm-label, .mm-level, .cr-label, .cr-key, .cr-chip, .cr-tag, .cr-count, .cr-ab, .cr-po, .cr-face-legend, .cr-legend',
    '.cr-bar-labels, .cr-top-comps, .cr-sub, .cr-note, .cr-attr-what, .cr-saved, .tile-l, .gc-tile-l, .brk-cmp-label, .brk-why-label',
    '.brk-choice-label, .brk-key-label, .hub-next-label, .hub-side-where, .res-final, .res-sub, .lt-sub, .lt-head, .lt-rank, .lt-empty',
    '.card-star-head, .card-star-team, .ov-star-head, .ov-star-team, .ov-coach-head, .tp-head, .team-panel h3, .pbp-time, .pbp-more',
    '.feed .t, .shirt-no, .pl-pos, .cp-standing, .cp-tag, .ql-slot-no, .pcard-meta, .pcard-section, .pcard-status, .pcard-tile span',
    '.pcard-note, .pending, .sort-mark, .cr-badge, .shot-zones .muted',
    // Captions and hints: a line explaining what is around it.
    '.blurb, .swap-hint, .brk-talk-sub, .brk-talk-hint, .ghost',
  ].join(', ');
  const isLabel = (el) => {
    const lab = el.closest(LABEL);
    if (!lab) return false;
    const btn = el.closest('button');
    return !btn || (lab !== btn && btn.contains(lab));
  };
  const small = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!t.textContent.trim()) continue;
    const el = t.parentElement;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.closest('canvas, svg, kbd')) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 11.9) small.set(`${name(el)} ${size}px`, t.textContent.trim().slice(0, 24));
    else if (size < 13.9 && !isLabel(el)) small.set(`content ${name(el)} ${size}px`, t.textContent.trim().slice(0, 24));
  }
  for (const [k, v] of small) out.push(`text ${k} "${v}"`);
  // Nothing drawn over text (GAME_FLOW §6.1a "nothing is cut off"): content that spills out of its
  // box without a scroll bar lands on top of other text. Each piece of visible text must be the top
  // thing at its middle, unless a pop-up is open over it.
  const covered = new Map();
  const popup = (el) => el && el.closest('.overlay, [role="dialog"], [role="alertdialog"], .sort-pop-back, .brk, .argue-bar, .mm-flash');
  const walker2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker2.nextNode(); t; t = walker2.nextNode()) {
    if (!t.textContent.trim()) continue;
    const el = t.parentElement;
    if (el.closest('canvas, svg, option, select, .court-box, [aria-hidden="true"]')) continue;
    const range = document.createRange();
    range.selectNodeContents(t);
    for (const full of range.getClientRects()) {
      // Only the part that shows: boxes that hide their overflow (text cut short with "…") clip it.
      let r = { left: full.left, top: full.top, right: full.right, bottom: full.bottom };
      for (let a = el; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const b = a.getBoundingClientRect();
        r = { left: Math.max(r.left, b.left), top: Math.max(r.top, b.top), right: Math.min(r.right, b.right), bottom: Math.min(r.bottom, b.bottom) };
      }
      if (r.right - r.left < 4 || r.bottom - r.top < 4) continue;
      const x = (r.left + r.right) / 2;
      const y = (r.top + r.bottom) / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
      // A pop-up over the screen covers it on purpose.
      if (popup(hit) && !popup(el)) continue;
      // Clipped by its own box (one-line text cut short with "…"): the parent box is what is hit.
      if (hit.contains(el.parentElement)) continue;
      covered.set(`${name(el)} under ${name(hit)}`, t.textContent.trim().slice(0, 24));
      break;
    }
  }
  for (const [k, v] of covered) out.push(`covered ${k} "${v}"`);
  // A native dropdown only when all its options fit without scrolling: 12 or fewer (GAME_FLOW §6.1a).
  for (const s of document.querySelectorAll('select')) if (s.options.length > 12) out.push(`dropdown with ${s.options.length} options: "${s.options[0]?.text.slice(0, 24)}"`);
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
      await page.locator('.cr-side').waitFor();
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
      if (tab.source === 'Key matchup') {
        // With a stopper picked, all three dropdowns show (theirs and ours: each a whole squad).
        await page.locator('.key-matchup select').first().selectOption('assign');
        await check('friendly: game plan · Key matchup (stopper)');
      }
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
  // The match's pop-ups (GAME_FLOW §6.1a): the clutch call (offence and defence) and arguing a call.
  // Opened on the live match through its dev handle, at the moment the match would open them.
  async matchCalls(page, check) {
    await page.goto(base);
    await button(page, /Friendly match/).click();
    await page.waitForTimeout(300);
    await page.locator('button.primary').last().click();
    await page.waitForFunction(() => window.__liveMatch, null, { timeout: 15000 });
    await page.waitForTimeout(1500);
    for (const role of ['offence', 'defence']) {
      await page.evaluate((role) => {
        const m = window.__liveMatch;
        m.clutch = { offence: 0, pending: [role], calls: {} };
        m.phase = 'clutch';
        m.version++;
      }, role);
      await page.locator('.clutch').waitFor({ timeout: 5000 });
      await check(`match: clutch call (${role})`);
    }
    await page.evaluate(() => {
      const m = window.__liveMatch;
      m.clutch = null;
      m.argue = { side: 0, until: m.time + 9999 };
      m.phase = 'argue';
      m.version++;
    });
    await page.locator('.argue-bar').waitFor({ timeout: 5000 });
    await check('match: argue the call');
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
    await page.locator('.cr-side').waitFor();
    for (const tab of [/First team/, /Dev squad/, /Academy/]) {
      await page.getByRole('tab', { name: tab }).click();
      for (const v of ['Overview', 'Attributes', 'Profile']) {
        await page.getByRole('radio', { name: v }).click();
        await check(`career: squad ${tab.source.replace(/\\/g, '')} · ${v}`);
      }
    }
    await page.getByRole('tab', { name: /First team/ }).click();
    // Touch screens: the Sort pop-up, on the view with the most columns. Escape closes only it.
    await page.getByRole('radio', { name: 'Attributes' }).click();
    if (await page.locator('.sort-touch').first().isVisible()) {
      await page.locator('.sort-touch').first().click();
      await page.locator('.sort-pop').waitFor();
      await check('pop-up: sort (squad attributes, touch)');
      await page.keyboard.press('Escape');
      await page.locator('.sort-pop').waitFor({ state: 'detached' });
      if (!(await page.locator('.cr-table').count())) throw new Error('Escape on the Sort pop-up left the squad');
    }
    await page.getByRole('radio', { name: 'Overview' }).click();
    await page.locator('.cr-table .cr-name').first().click();
    await check('career: player page (yours)');
    await page.locator('.cr-nav', { hasText: 'Competitions' }).click();
    await check('career: competitions');
    await page.locator('.cr-comp', { hasText: 'US Division 2' }).click();
    await check('career: table (16 clubs)');
    await page.goBack();
    await page.locator('.cr-comp', { hasText: 'Big League · America' }).click();
    await check('career: table (18 clubs)');
    await page.locator('.cr-table tr:not(.me) .cr-name').first().click();
    await check('career: club page (other)');
    await page.locator('.cr-table .cr-name').first().click();
    await check('career: player page (other club)');
    await page.locator('.cr-nav', { hasText: 'Club' }).click();
    await check('career: club (yours)');
    await page.locator('.tb-menu').click();
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

if (arg('json', null)) writeFileSync(arg('json'), JSON.stringify(results, null, 1));
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
