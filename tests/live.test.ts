// Headless run of the live-match controller and animation scripts (no canvas involved).

import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../src/data/teams';
import { callTimeout, createMatch, stepPossession } from '../src/engine/match';
import { CLUTCH_MARGIN, CLUTCH_WINDOW } from '../src/game/clutch';
import { isRef } from '../src/ui/court/animation';
import { LiveMatch } from '../src/ui/match/controller';

function playOut(controllers: ['human' | 'ai', 'human' | 'ai'], seed: number) {
  const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], seed, controllers, 'fast');
  let ticks = 0;
  let timeouts = 0;
  let breaks = 0;
  while (m.phase !== 'final' && ticks < 200000) {
    m.tick(0.05);
    ticks++;
    const f = m.frame();
    if (f) {
      for (const p of Object.values(f.players)) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        expect(p.x).toBeGreaterThan(-5);
        expect(p.x).toBeLessThan(99);
      }
      expect(Object.keys(f.players).filter((k) => !isRef(k)).length).toBe(10);
    }
    if (m.phase === 'timeout') {
      timeouts++;
      m.resume();
    }
    if (m.phase === 'break') {
      breaks++;
      m.resume();
    }
  }
  return { m, timeouts, breaks };
}

describe('live match controller', () => {
  it('plays a full AI vs AI match through the animation layer', () => {
    const { m, breaks } = playOut(['ai', 'ai'], 11);
    expect(m.phase).toBe('final');
    expect(breaks).toBeGreaterThanOrEqual(3);
    expect(m.score).toEqual([m.s.teams[0].score, m.s.teams[1].score]);
    expect(m.feed.some((f) => f.kind === 'score')).toBe(true);
    expect(m.feed[0].text).toMatch(/FINAL/);
  });

  it('a human timeout request pauses at the next dead ball and is used up', () => {
    const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], 3, ['human', 'human'], 'fast');
    for (let i = 0; i < 200; i++) m.tick(0.05);
    m.requestTimeout(0);
    let guard = 0;
    while (m.phase !== 'timeout' && guard++ < 10000) m.tick(0.05);
    expect(m.phase).toBe('timeout');
    expect(m.timeoutSide).toBe(0);
    expect(m.s.teams[0].timeoutsLeft).toBe(1); // FIBA: 2 in the first half
    m.applyPlan(0, { ...m.s.teams[0].plan, defence: 'zone' });
    expect(m.feed[0].text).toMatch(/2-3 zone/);
    m.resume();
    expect(m.phase).toBe('playing');
  });

  it('the scoreboard never runs ahead of the animation', () => {
    const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], 5, ['ai', 'ai'], 'normal');
    for (let i = 0; i < 3000 && m.phase === 'playing'; i++) {
      m.tick(0.02);
      expect(m.score[0]).toBeLessThanOrEqual(m.s.teams[0].score);
      expect(m.score[1]).toBeLessThanOrEqual(m.s.teams[1].score);
    }
  });

  it('subs and tactics ordered from the bench apply at the next dead ball, without a timeout', () => {
    const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], 8, ['human', 'ai'], 'fast');
    for (let i = 0; i < 100; i++) m.tick(0.05);
    const outId = m.s.teams[0].lineup[0];
    const inId = m.s.teams[0].team.players.find((p) => !m.s.teams[0].lineup.includes(p.id))!.id;
    expect(m.queueSub(0, outId, inId)).toBeNull();
    m.queueTactics(0, { defence: 'zone' });
    let guard = 0;
    while (m.queuedSubs[0].length > 0 && guard++ < 10000) m.tick(0.05);
    expect(m.s.teams[0].plan.defence).toBe('zone');
    expect(m.s.teams[0].timeoutsLeft).toBe(2);
    expect(m.s.events.some((e) => e.type === 'sub' && e.side === 0 && e.inId === inId)).toBe(true);
  });
});

describe('FIBA timeouts', () => {
  it('2 in the first half, 3 in the second, unused ones expire', () => {
    const s = createMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, DEFAULT_PLANS.ham, DEFAULT_PLANS.sky, 4);
    expect(s.teams[0].timeoutsLeft).toBe(2);
    expect(callTimeout(s, 0)).toBe(true);
    expect(callTimeout(s, 0)).toBe(true);
    expect(callTimeout(s, 0)).toBe(false);
    while (s.quarter < 3) stepPossession(s);
    expect(s.teams[0].timeoutsLeft).toBe(3);
    expect(s.teams[1].timeoutsLeft).toBe(3);
  });

  it('at most 2 in the last two minutes of the fourth quarter', () => {
    const s = createMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, DEFAULT_PLANS.ham, DEFAULT_PLANS.sky, 4);
    while (s.quarter < 4 || s.clock > 120) stepPossession(s);
    expect(s.teams[0].timeoutsLeft).toBe(3);
    expect(callTimeout(s, 0)).toBe(true);
    expect(callTimeout(s, 0)).toBe(true);
    expect(callTimeout(s, 0)).toBe(false);
  });
});

describe('crowd and sound cues', () => {
  it('every cue says whose moment it is, and the crowd follows the game', () => {
    const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], 3, ['ai', 'ai'], 'fast');
    // Every possession played, not only the highlights: the cues of the whole game.
    m.highlights = false;
    const kinds = new Map<string, Set<number | undefined>>();
    const levels = { playing: new Set<number>(), breaks: new Set<number>() };
    let ticks = 0;
    while (m.phase !== 'final' && ticks < 200000) {
      m.tick(0.05);
      ticks++;
      for (const fx of m.drainFx()) {
        if (!kinds.has(fx.kind)) kinds.set(fx.kind, new Set());
        kinds.get(fx.kind)!.add(fx.side);
      }
      const level = m.crowdLevel();
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
      if (m.phase === 'playing') levels.playing.add(level);
      if (m.phase === 'timeout' || m.phase === 'break') {
        levels.breaks.add(level);
        m.resume();
      }
    }
    for (const fx of m.drainFx()) {
      if (!kinds.has(fx.kind)) kinds.set(fx.kind, new Set());
      kinds.get(fx.kind)!.add(fx.side);
    }
    // Scoring, misses and fouls happen for both teams, and each cue carries the team it belongs to.
    for (const kind of ['swish', 'clank', 'foul']) {
      expect(kinds.get(kind), kind).toEqual(new Set([0, 1]));
    }
    expect(kinds.get('three')?.has(undefined)).toBe(false);
    expect(kinds.has('quarterEnd')).toBe(true);
    expect([...(kinds.get('gameEnd') ?? [])]).toEqual([m.s.teams[0].score > m.s.teams[1].score ? 0 : 1]);
    // A steady buzz during play, quieter in breaks; louder when the game gets tight.
    expect(Math.min(...levels.playing)).toBeGreaterThan(Math.max(...levels.breaks));
    expect(m.crowdLevel()).toBeLessThan(0.5);
  }, 60000);
});

describe('highlights', () => {
  /** Plays a whole AI match through the controller; returns how many possessions were animated per quarter. */
  function watch(highlights: boolean, seed: number) {
    const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], seed, ['ai', 'ai'], 'fast');
    m.highlights = highlights;
    const inner = m as unknown as { script: { quarter: number; clockStart: number } | null };
    const shown: Record<number, number> = {};
    let clutchShown = 0;
    let last: unknown = null;
    let sounds = 0;
    let ticks = 0;
    while (m.phase !== 'final' && ticks < 400000) {
      m.tick(0.05);
      ticks++;
      sounds += m.drainFx().length;
      if (m.phase === 'timeout' || m.phase === 'break') m.resume();
      const sc = inner.script;
      if (sc && sc !== last) {
        last = sc;
        const q = sc.quarter;
        // Clutch moments (the end of a close half or game) are always shown, on top of the five.
        const margin = Math.abs(m.s.teams[0].score - m.s.teams[1].score);
        if ((q >= 4 && sc.clockStart <= CLUTCH_WINDOW && margin <= CLUTCH_MARGIN + 3) || (q === 2 && sc.clockStart <= 10 && margin <= 11)) clutchShown++;
        else shown[q] = (shown[q] ?? 0) + 1;
      }
    }
    return { shown, clutchShown, sounds, events: m.s.events, score: [m.s.teams[0].score, m.s.teams[1].score] };
  }

  it('shows five plays a quarter (plus clutch moments), and never changes the result', () => {
    const full = watch(false, 4);
    const best = watch(true, 4);
    // The same game either way: highlights only decide what is animated.
    expect(best.score).toEqual(full.score);
    expect(best.events).toEqual(full.events);
    for (const q of [1, 2, 3]) expect(best.shown[q]).toBe(5);
    expect(best.shown[4] ?? 0).toBeLessThanOrEqual(5);
    expect(Object.values(full.shown).reduce((a, b) => a + b, 0)).toBeGreaterThan(100);
    // Skipped possessions make no sound; the shown ones and the buzzers do.
    expect(best.sounds).toBeLessThan(full.sounds / 3);
    expect(best.sounds).toBeGreaterThan(10);
  }, 120000);

  it('the plays shown are the exciting ones', () => {
    const scored: number[] = [];
    const all: number[] = [];
    for (const seed of [2, 6]) {
      const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], seed, ['ai', 'ai'], 'fast');
      const inner = m as unknown as { script: { beats: { ball: { kind: string } }[] } | null; scriptEvents: { type: string; made?: boolean; shotType?: string; dunk?: boolean; stealerId?: string; blockerId?: string }[] };
      let last: unknown = null;
      let ticks = 0;
      while (m.phase !== 'final' && ticks < 400000) {
        m.tick(0.05);
        ticks++;
        m.drainFx();
        if (m.phase === 'timeout' || m.phase === 'break') m.resume();
        if (inner.script && inner.script !== last) {
          last = inner.script;
          const big = inner.scriptEvents.some((e) => (e.type === 'shot' && e.made && (e.shotType === 'three' || e.dunk)) || (e.type === 'shot' && e.blockerId) || (e.type === 'turnover' && e.stealerId));
          scored.push(big ? 1 : 0);
        }
      }
      for (const e of m.s.events) if (e.type === 'shot') all.push((e.made && (e.shotType === 'three' || e.dunk)) || e.blockerId ? 1 : 0);
    }
    const shownRate = scored.reduce((a, b) => a + b, 0) / scored.length;
    const baseRate = all.reduce((a, b) => a + b, 0) / all.length;
    // Threes, dunks, blocks and steals are far more common among the highlights than in the game as a whole.
    expect(shownRate).toBeGreaterThan(baseRate * 1.8);
  }, 120000);
});
