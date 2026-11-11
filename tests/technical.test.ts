// Technical fouls, the coach arguing a call, ejections and the assistant taking over; and the free
// throws highlights mode shows on top of the best plays.

import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../src/data/teams';
import { createMatch, simulateMatch, stepPossession } from '../src/engine/match';
import { other, playerOf } from '../src/engine/state';
import { TECHNICAL } from '../src/engine/tactics';
import type { MatchState, TimedEvent } from '../src/engine/types';
import { buildScript, isRef, type Frame } from '../src/ui/court/animation';
import { ARGUE_SECONDS, LiveMatch } from '../src/ui/match/controller';

const play = (seed: number) => simulateMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, DEFAULT_PLANS.ham, DEFAULT_PLANS.sky, seed);
const defaults = { ...TECHNICAL };
afterEach(() => Object.assign(TECHNICAL, defaults));

/** Plays possessions until one has an event that `want` picks, with the state just before it. */
function findPossession(want: (e: TimedEvent) => boolean, seeds = 200): { before: MatchState; events: TimedEvent[] } | null {
  for (let seed = 1; seed <= seeds; seed++) {
    const s = createMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, DEFAULT_PLANS.ham, DEFAULT_PLANS.sky, seed);
    while (!s.finished) {
      const before = structuredClone(s);
      const start = s.events.length;
      stepPossession(s);
      const events = s.events.slice(start);
      if (events.some(want)) return { before, events };
    }
  }
  return null;
}

describe('technical fouls', () => {
  it('are rare: a few in ten matches, more for hotheads, and one free throw each for the other side', () => {
    let techs = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const ev = play(seed).state.events;
      ev.forEach((e, i) => {
        if (e.type !== 'technical') return;
        techs++;
        // Straight after a reach-in or a hold on that side, and one free throw for the other.
        const ft = ev.slice(i + 1).find((x) => x.type === 'freeThrow');
        expect(ft?.type === 'freeThrow' && ft.technical && ft.side === other(e.side) && ft.of === 1).toBe(true);
      });
    }
    expect(techs / 100).toBeGreaterThan(0.15);
    expect(techs / 100).toBeLessThan(0.8);
  });

  it('a second one ejects the player, who is replaced at the next dead ball', () => {
    // Every reach-in earns one, whatever his temper.
    Object.assign(TECHNICAL, { player: 100 });
    const r = play(3);
    const ejected = r.state.events.find((e) => e.type === 'technical' && e.ejected && e.playerId);
    expect(ejected).toBeDefined();
    if (ejected?.type !== 'technical') return;
    const ps = r.state.teams[ejected.side].players[ejected.playerId!];
    expect(ps.ejected && ps.fouledOut).toBe(true);
    expect(ps.stats.tf).toBe(2);
    expect(r.state.events.some((e) => e.type === 'sub' && e.reason === 'ejected' && e.outId === ejected.playerId)).toBe(true);
  });

  it('a coach who argues fires his team up, or gets a technical; two and he is ejected', () => {
    const found = findPossession((e) => e.type === 'foul' && !e.shooting);
    expect(found).not.toBeNull();
    const { before } = found!;
    const def = other(before.possession);
    // Heard: no technical, the team lifted.
    Object.assign(TECHNICAL, { argue: 0 });
    const heard = structuredClone(before);
    heard.calls = { argue: def };
    stepPossession(heard);
    const a = heard.events.find((e) => e.type === 'argue');
    expect(a?.type === 'argue' && !a.technical).toBe(true);
    expect(heard.teams[def].morale).toBeGreaterThan(before.teams[def].morale - 0.05);
    // Not heard: a technical on the coach, and at the second he is gone.
    Object.assign(TECHNICAL, { argue: 1 });
    const t1 = structuredClone(before);
    t1.teams[def].coachTechnicals = 1;
    t1.calls = { argue: def };
    stepPossession(t1);
    const t = t1.events.find((e) => e.type === 'technical');
    expect(t?.type === 'technical' && !t.playerId && t.ejected).toBe(true);
    expect(t1.teams[def].coachEjected).toBe(true);
  });

  it('the technical free throw is animated with an empty lane, and every event fires once', () => {
    Object.assign(TECHNICAL, { player: 100 });
    const found = findPossession((e) => e.type === 'freeThrow' && !!e.technical, 20);
    expect(found).not.toBeNull();
    const { before, events } = found!;
    const offence = before.possession;
    const script = buildScript(
      {
        offence,
        quarter: before.quarter,
        lineups: [[...before.teams[0].lineup], [...before.teams[1].lineup]],
        focus: before.teams[offence].plan.offence,
        defence: before.teams[other(offence)].plan.defence,
        clockStart: before.clock,
        clockEnd: events[events.length - 1].clock,
        start: before.transition,
        name: (side, id) => playerOf(before, side, id).name,
      },
      events,
      null as Frame | null,
    );
    expect(script.beats.flatMap((b) => b.fire).sort((x, y) => x - y)).toEqual(events.map((_, i) => i));
    const at = events.findIndex((e) => e.type === 'freeThrow' && !!e.technical);
    const shot = script.beats.find((b) => b.fire.includes(at))!;
    // Nobody but the shooter within four metres of the basket he shoots at.
    const shooter = shot.ball.kind === 'fromPlayer' ? shot.ball.from : '';
    const rim = script.dir === 1 ? { x: 27.05, y: 7.62 } : { x: 28.65 - 27.05, y: 7.62 };
    for (const [k, p] of Object.entries(shot.players)) if (k !== shooter && !isRef(k)) expect(Math.hypot(p.x - rim.x, p.y - rim.y)).toBeGreaterThan(4);
  });
});

describe('arguing the call in a live match', () => {
  const human = (seed: number) => {
    const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], seed, ['human', 'ai'], 'fast');
    m.highlights = false;
    return m;
  };
  const step = (m: LiveMatch) => {
    m.tick(1 / 30);
    if (m.phase === 'timeout' || m.phase === 'break') m.resume();
    if (m.phase === 'clutch') while (m.clutch) m.submitClutch(m.clutch.pending[0], null);
  };

  it('is offered now and then, at most twice a quarter, and goes away after a few seconds', () => {
    const m = human(2);
    const perQuarter: Record<number, number> = {};
    let waited = 0;
    for (let i = 0; i < 3_000_000 && m.phase !== 'final'; i++) {
      step(m);
      if (m.phase !== 'argue') continue;
      expect(m.argue?.side).toBe(0);
      perQuarter[m.s.quarter] = (perQuarter[m.s.quarter] ?? 0) + 1;
      // Nobody presses anything: play goes on by itself.
      let t = 0;
      while (m.phase === 'argue') {
        m.tick(1 / 30);
        t += 1 / 30;
      }
      waited = Math.max(waited, t);
    }
    expect(m.phase).toBe('final');
    const offers = Object.values(perQuarter).reduce((a, b) => a + b, 0);
    expect(offers).toBeGreaterThan(0);
    expect(offers).toBeLessThanOrEqual(6);
    for (const n of Object.values(perQuarter)) expect(n).toBeLessThanOrEqual(2);
    expect(waited).toBeLessThan(ARGUE_SECONDS + 0.1);
  }, 600000);

  it('arguing plays the possession again: the same up to the whistle, then the argument', () => {
    const m = human(2);
    const inner = m as unknown as { scriptEvents: TimedEvent[]; argueChance: { foulAt: number } | null };
    while (m.phase !== 'argue' && m.phase !== 'final') step(m);
    expect(m.phase).toBe('argue');
    const foulAt = inner.argueChance!.foulAt;
    const upToWhistle = JSON.stringify(inner.scriptEvents.slice(0, foulAt + 1));
    m.argueCall();
    expect(m.phase).toBe('playing');
    expect(JSON.stringify(inner.scriptEvents.slice(0, foulAt + 1))).toBe(upToWhistle);
    expect(inner.scriptEvents[foulAt + 1]?.type).toBe('argue');
    while (m.phase !== 'final') step(m);
  }, 600000);

  it('with the coach ejected the assistant takes over: no timeouts from him, orders at the quarter break', () => {
    Object.assign(TECHNICAL, { argue: 1 });
    const m = human(2);
    while (!m.s.teams[0].coachEjected && m.phase !== 'final') {
      step(m);
      if (m.phase === 'argue') m.argueCall();
    }
    expect(m.s.teams[0].coachEjected).toBe(true);
    expect(m.view[0].coachEjected || m.s.teams[0].coachEjected).toBe(true);
    // He cannot call a timeout any more.
    m.requestTimeout(0);
    expect(m.pending[0]).toBe(false);
    // And is never asked to argue again.
    let offered = false;
    while (m.phase !== 'final') {
      step(m);
      if (m.phase === 'argue') offered = true;
    }
    expect(offered).toBe(false);
  }, 600000);
});

describe('free throws in highlights mode', () => {
  it('shows the trips to the line that matter, on top of the best plays', () => {
    // A match with trips to the line late in quarters.
    const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], 2, ['ai', 'ai'], 'normal');
    const inner = m as unknown as { script: unknown; scriptEvents: TimedEvent[] };
    let seen: unknown = null;
    let late = 0;
    let lateShown = 0;
    while (m.phase !== 'final') {
      m.tick(1 / 30);
      if (m.phase === 'timeout' || m.phase === 'break') m.resume();
      if (inner.script && inner.script !== seen) {
        seen = inner.script;
        const ft = inner.scriptEvents.find((e) => e.type === 'freeThrow' && !e.technical);
        if (ft && ft.clock <= 100) lateShown++;
      }
    }
    // Every trip to the line in the last two minutes of a quarter is shown (before, hardly any were).
    for (const e of m.s.events) if (e.type === 'freeThrow' && !e.technical && e.attempt === 1 && e.clock <= 100) late++;
    expect(late).toBeGreaterThan(0);
    expect(lateShown).toBeGreaterThanOrEqual(late * 0.9);
  }, 600000);
});
