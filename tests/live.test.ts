// Headless run of the live-match controller and animation scripts (no canvas involved).

import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../src/data/teams';
import { callTimeout, createMatch, stepPossession } from '../src/engine/match';
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
      expect(Object.keys(f.players).length).toBe(10);
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
