// The animation scripts must tell a consistent story: passes go between players on court,
// shots leave the shooter's hands, and every engine event is shown exactly once.

import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../src/data/teams';
import { createMatch, stepPossession } from '../src/engine/match';
import { other, playerOf } from '../src/engine/state';
import { buildScript, playerKey, type Frame } from '../src/ui/court/animation';
import { Motion } from '../src/ui/court/motion';

describe('animation scripts', () => {
  it('passes, holds and shots refer to players on court; every event fires once', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const s = createMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, DEFAULT_PLANS.ham, DEFAULT_PLANS.sky, seed);
      let prev: Frame | null = null;
      while (!s.finished) {
        if (s.clock <= 0) {
          stepPossession(s);
          prev = null;
          continue;
        }
        const offence = s.possession;
        const lineups: [string[], string[]] = [[...s.teams[0].lineup], [...s.teams[1].lineup]];
        const start = s.events.length;
        const how = s.transition;
        const clockStart = s.clock;
        stepPossession(s);
        const events = s.events.slice(start);
        const script = buildScript(
          {
            offence,
            quarter: s.quarter,
            lineups,
            defence: s.teams[other(offence)].plan.defence,
            clockStart,
            clockEnd: s.clock,
            start: how,
            name: (side, id) => playerOf(s, side, id).name,
          },
          events,
          prev,
        );
        const fired = script.beats.flatMap((b) => b.fire).sort((a, b) => a - b);
        expect(fired).toEqual(events.map((_, i) => i));
        for (const beat of script.beats) {
          expect(Object.keys(beat.players).length).toBe(10);
          const keys = new Set(Object.keys(beat.players));
          const a = beat.ball;
          if (a.kind === 'held') expect(keys.has(a.holder)).toBe(true);
          if (a.kind === 'pass') expect(keys.has(a.from) && keys.has(a.to)).toBe(true);
          if (a.kind === 'toPlayer') expect(keys.has(a.to)).toBe(true);
          if (a.kind === 'fromPlayer') expect(keys.has(a.from)).toBe(true);
        }
        events.forEach((ev, i) => {
          if (ev.type !== 'shot') return;
          const beat = script.beats.find((b) => b.fire.includes(i))!;
          expect(beat.ball.kind).toBe('fromPlayer');
          if (beat.ball.kind === 'fromPlayer') expect(beat.ball.from).toBe(playerKey(ev.side, ev.shooterId));
        });
        const last = script.beats[script.beats.length - 1];
        prev = { players: last.players, ball: { x: 47, y: 25, z: 3 } };
      }
    }
  });

  it('players accelerate smoothly and respect a top speed; a dribbled ball bounces', () => {
    const m = new Motion();
    m.update({ a: { x: 0, y: 25 } }, 0.016, 1, 'a');
    let maxStep = 0;
    let lastX = 0;
    const heights: number[] = [];
    for (let i = 0; i < 120; i++) {
      m.update({ a: { x: 80, y: 25 } }, 0.016, 1, 'a');
      maxStep = Math.max(maxStep, m.pos.a.x - lastX);
      lastX = m.pos.a.x;
      heights.push(m.ball({ kind: 'held', holder: 'a', dribble: true }, 0, 1).z);
    }
    expect(maxStep / 0.016).toBeLessThanOrEqual(46.01);
    expect(m.pos.a.x).toBeGreaterThan(70);
    expect(Math.min(...heights)).toBeLessThan(0.8);
    expect(Math.max(...heights)).toBeGreaterThan(2.8);
  });

  it('shooters jump: in the air at release, back on the floor after; dunks go above the rim', () => {
    const m = new Motion();
    m.update({ s: { x: 84, y: 25 } }, 0.016, 1, 's');
    const rim = { x: 88.35, y: 25, z: 10.3 };
    const jumper = { kind: 'fromPlayer' as const, from: 's', to: rim, arc: 5, style: 'jumper' as const };
    expect(m.lift(jumper, 0)!.height).toBe(0);
    expect(m.lift(jumper, 0.32)!.height).toBeCloseTo(2, 1);
    expect(m.lift(jumper, 0.9)!.height).toBe(0);
    const dunk = { kind: 'fromPlayer' as const, from: 's', to: rim, arc: 0, style: 'dunk' as const };
    expect(m.ball(dunk, 0.73, 1).z).toBeGreaterThan(10.3);
    expect(m.ball(dunk, 1, 1).z).toBeCloseTo(10.3, 1);
  });
});
