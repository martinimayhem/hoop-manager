import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../src/data/teams';
import { createMatch, stepPossession } from '../src/engine/match';
import { playPossession } from '../src/engine/possession';
import type { MatchState } from '../src/engine/types';
import { CLUTCH_CALLS, aiCall, asksForCall, defenceOptions, estimate, isClutch, offenceOptions } from '../src/game/clutch';
import { aiTalk, giveTalk } from '../src/game/teamTalk';
import { LiveMatch } from '../src/ui/match/controller';

/** Plays until the last two minutes of a close fourth quarter (or gives up). */
function clutchState(): MatchState {
  for (let seed = 1; seed < 200; seed++) {
    const s = createMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, DEFAULT_PLANS.ham, DEFAULT_PLANS.sky, seed);
    while (!s.finished && !(s.quarter === 4 && s.clock <= 120)) stepPossession(s);
    if (!s.finished && isClutch(s)) return s;
  }
  throw new Error('no close game found');
}

describe('clutch moments', () => {
  it('detects close finishes and offers calls with names', () => {
    const s = clutchState();
    const off = offenceOptions(s, s.possession);
    expect(off.some((o) => o.call === 'isoStar')).toBe(true);
    expect(off[off.length - 1].call).toBeNull();
    expect(defenceOptions(s, s.possession === 0 ? 1 : 0).length).toBeGreaterThanOrEqual(4);
  });

  it('estimates are sensible and do not touch the real match', () => {
    const s = clutchState();
    const before = JSON.stringify({ score: [s.teams[0].score, s.teams[1].score], clock: s.clock, rng: s.rng, events: s.events.length });
    const e = estimate(s, { offence: 'isoStar' });
    expect(e.points).toBeGreaterThan(0.4);
    expect(e.points).toBeLessThan(2.2);
    expect(e.scoreChance).toBeGreaterThan(0.2);
    expect(JSON.stringify({ score: [s.teams[0].score, s.teams[1].score], clock: s.clock, rng: s.rng, events: s.events.length })).toBe(before);
  });

  it('defensive calls change what the offence gets', () => {
    const s = clutchState();
    const kickVsDeny = estimate(s, { offence: 'kickOut', defence: 'denyThree' }, 400).points;
    const kickVsPaint = estimate(s, { offence: 'kickOut', defence: 'packPaint' }, 400).points;
    expect(kickVsPaint).toBeGreaterThan(kickVsDeny);
  });

  it('an intentional foul sends the worst free-throw shooter to the line', () => {
    const s = clutchState();
    const off = s.possession;
    s.calls = { defence: 'foul' };
    const start = s.events.length;
    playPossession(s);
    const fts = s.events.slice(start).filter((e) => e.type === 'freeThrow');
    expect(fts.length).toBe(2);
    const worst = [...s.teams[off].lineup].sort((a, b) => s.teams[off].team.players.find((p) => p.id === a)!.attrs.freeThrow - s.teams[off].team.players.find((p) => p.id === b)!.attrs.freeThrow)[0];
    expect(fts.every((e) => e.type === 'freeThrow' && e.shooterId === worst)).toBe(true);
  });

  it('the AI makes a legal call', () => {
    const s = clutchState();
    const call = aiCall(s, s.possession, 'offence');
    expect([null, 'isoStar', 'pickAndRoll', 'kickOut', 'postUp', 'runClock']).toContain(call);
  });

  it('the live match pauses for a human call, then resumes', () => {
    // The first seed whose finish is close enough.
    let m!: LiveMatch;
    for (let seed = 21; seed < 60; seed++) {
      m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], seed, ['human', 'ai'], 'fast');
      let guard = 0;
      while (m.phase !== 'clutch' && m.phase !== 'final' && guard++ < 400000) {
        m.tick(0.25);
        if (m.phase === 'break' || m.phase === 'timeout') m.resume();
      }
      if (m.phase === 'clutch') break;
    }
    expect(m.phase).toBe('clutch');
    const role = m.clutch!.pending[0];
    m.submitClutch(role, role === 'offence' ? 'isoStar' : 'packPaint');
    expect(m.phase).toBe('playing');
    for (let i = 0; i < 20; i++) m.tick(0.05);
    expect(m.s.events.some((e) => e.type === 'playCall')).toBe(true);
  }, 120000);

  it('asks for three plays and one last stop per finish, not a call every possession', () => {
    const s = clutchState();
    expect(asksForCall(s, 'offence', 0)).toBe(true);
    expect(asksForCall(s, 'offence', CLUTCH_CALLS.offence)).toBe(false);
    // Defence only for the last stop: the last shot clock, one score from tying or winning.
    s.clock = 60;
    expect(asksForCall(s, 'defence', 0)).toBe(false);
    s.clock = 20;
    s.teams[0].score = s.teams[1].score + 2;
    expect(asksForCall(s, 'defence', 0)).toBe(true);
    expect(asksForCall(s, 'defence', 1)).toBe(false);
    s.teams[0].score = s.teams[1].score + 5;
    expect(asksForCall(s, 'defence', 0)).toBe(false);
  });

  it('a close finish brings a human coach at most four clutch moments', () => {
    let finishes = 0;
    for (const seed of [21, 22, 23, 24, 25, 26]) {
      const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], seed, ['human', 'ai'], 'fast');
      const moments: Record<number, number> = {};
      let guard = 0;
      while (m.phase !== 'final' && guard++ < 600000) {
        m.tick(0.25);
        if (m.phase === 'break' || m.phase === 'timeout') m.resume();
        if (m.phase === 'clutch') {
          moments[m.s.quarter] = (moments[m.s.quarter] ?? 0) + 1;
          while (m.clutch) m.submitClutch(m.clutch.pending[0], null);
        }
      }
      for (const [q, n] of Object.entries(moments)) {
        if (Number(q) >= 4) finishes++;
        expect(n).toBeLessThanOrEqual(Number(q) === 2 ? 1 : 4);
      }
    }
    expect(finishes).toBeGreaterThan(0);
  }, 60000);
});

describe('halftime team talk', () => {
  it('the right words depend on the score', () => {
    const s = createMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, DEFAULT_PLANS.ham, DEFAULT_PLANS.sky, 1);
    s.teams[0].score = 60;
    s.teams[1].score = 45;
    expect(giveTalk(s, 0, 'praise').morale).toBeGreaterThan(0);
    expect(giveTalk(s, 1, 'praise').morale).toBeLessThan(0);
    expect(aiTalk(s, 1)).toBe('demand');
    expect(s.teams[1].morale).toBeLessThan(0);
  });
});
