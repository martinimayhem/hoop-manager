// The animation scripts must tell a consistent story: passes go between players on court,
// shots leave the shooter's hands, and every engine event is shown exactly once.

import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../src/data/teams';
import { createMatch, stepPossession } from '../src/engine/match';
import { other, playerOf } from '../src/engine/state';
import { PACE_FT_S, beatDurations, beatAt, buildScript, playerKey, type Frame, type Pace, type Script } from '../src/ui/court/animation';
import { BODY_FT, FORMATIONS, HOOP, MIN_SPACING_FT, ZONE, insideCourt } from '../src/ui/court/formations';
import { Motion, speedFactor } from '../src/ui/court/motion';
import { spriteScale } from '../src/ui/court/render';
import { LiveMatch } from '../src/ui/match/controller';
import type { DefenceScheme, GamePlan, MatchState, OffensiveFocus, TimedEvent } from '../src/engine/types';

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
            focus: s.teams[offence].plan.offence,
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
    m.update({ a: { x: 5, y: 10 } }, 0.016, 1, 'a');
    let maxStep = 0;
    let lastX = 5;
    const heights: number[] = [];
    for (let i = 0; i < 300; i++) {
      m.update({ a: { x: 85, y: 10 } }, 0.016, 1, 'a');
      maxStep = Math.max(maxStep, m.pos.a.x - lastX);
      lastX = m.pos.a.x;
      heights.push(m.ball({ kind: 'held', holder: 'a', dribble: true }, 0, 1).z);
    }
    expect(maxStep / 0.016).toBeLessThanOrEqual(PACE_FT_S.sprint + 0.01);
    expect(m.pos.a.x).toBeGreaterThan(70);
    expect(Math.min(...heights)).toBeLessThan(0.8);
    expect(Math.max(...heights)).toBeGreaterThan(2.8);
  });

  it('pace and speed rating set the top speed, and nobody overshoots their spot', () => {
    const top = (pace: Pace, rating: number) => {
      const m = new Motion();
      m.setSpeedRatings({ a: rating });
      m.update({ a: { x: 5, y: 10 } }, 0.016, 1, 'a');
      let best = 0;
      let furthest = 0;
      for (let i = 0; i < 900; i++) {
        m.update({ a: { x: 60, y: 10 } }, 0.016, 1, 'a', { a: pace });
        best = Math.max(best, m.vel.a.x);
        furthest = Math.max(furthest, m.pos.a.x);
      }
      expect(furthest).toBeLessThan(60.2);
      return best;
    };
    expect(top('jog', 70)).toBeLessThan(top('sprint', 70));
    expect(top('sprint', 40)).toBeLessThan(top('sprint', 90));
    expect(top('sprint', 99)).toBeLessThan(30);
  });

  it('the dribble keeps time with the stride and the ball never jumps sideways', () => {
    const m = new Motion();
    m.update({ 'home:a': { x: 5, y: 10 }, 'away:b': { x: 40, y: 25 } }, 0.016, 1, 'home:a');
    const action = { kind: 'held' as const, holder: 'home:a', dribble: true };
    let floors = 0;
    let lastZ = m.ball(action, 0, 1).z;
    let falling = false;
    let last = m.ball(action, 0, 1);
    let biggest = 0;
    for (let i = 0; i < 125; i++) {
      m.update({ 'home:a': { x: 90, y: 40 }, 'away:b': { x: 40, y: 25 } }, 0.016, 1, 'home:a');
      const b = m.ball(action, 0, 1);
      if (falling && b.z > lastZ) floors++;
      falling = b.z < lastZ;
      lastZ = b.z;
      biggest = Math.max(biggest, Math.hypot(b.x - last.x, b.y - last.y));
      last = b;
    }
    // Two seconds of running: one bounce every two steps, not a frantic drum roll.
    expect(floors).toBeGreaterThanOrEqual(2);
    expect(floors).toBeLessThanOrEqual(5);
    expect(biggest).toBeLessThan(0.9);
  });

  it('steals are shown as a move with a key moment, not a blink', () => {
    let seen = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const s = createMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, DEFAULT_PLANS.ham, DEFAULT_PLANS.sky, seed);
      while (!s.finished) {
        if (s.clock <= 0) {
          stepPossession(s);
          continue;
        }
        const offence = s.possession;
        const lineups: [string[], string[]] = [[...s.teams[0].lineup], [...s.teams[1].lineup]];
        const start = s.events.length;
        const how = s.transition;
        const clockStart = s.clock;
        stepPossession(s);
        const events = s.events.slice(start);
        const i = events.findIndex((e) => e.type === 'turnover' && !!e.stealerId);
        if (i < 0) continue;
        seen++;
        const script = buildScript(
          { offence, quarter: s.quarter, lineups, focus: s.teams[offence].plan.offence, defence: s.teams[other(offence)].plan.defence, clockStart, clockEnd: s.clock, start: how, name: (sd, id) => playerOf(s, sd, id).name },
          events,
          null,
        );
        expect(script.beats.some((b) => b.slow)).toBe(true);
        const shown = script.beats.filter((b) => b.slow || b.fire.includes(i)).reduce((sum, b) => sum + (b.minSeconds ?? 0), 0);
        expect(shown).toBeGreaterThanOrEqual(0.7);
      }
    }
    expect(seen).toBeGreaterThan(5);
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

/** Plays seeded matches and hands every possession's script to `check`. */
function eachScript(
  plans: [GamePlan, GamePlan],
  seeds: number,
  check: (script: Script, events: TimedEvent[], s: MatchState, lineups: [string[], string[]]) => void,
): void {
  for (let seed = 1; seed <= seeds; seed++) {
    const s = createMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, plans[0], plans[1], seed);
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
      const focus = s.teams[offence].plan.offence;
      const scheme = s.teams[other(offence)].plan.defence;
      stepPossession(s);
      const events = s.events.slice(start);
      const script = buildScript(
        { offence, quarter: s.quarter, lineups, focus, defence: scheme, keyMatchup: s.teams[other(offence)].plan.keyMatchup, clockStart, clockEnd: s.clock, start: how, name: (sd, id) => playerOf(s, sd, id).name },
        events,
        prev,
      );
      check(script, events, s, lineups);
      const last = script.beats[script.beats.length - 1];
      prev = { players: last.players, ball: { x: 47, y: 25, z: 3 } };
    }
  }
}

const planWith = (patch: Partial<GamePlan>): [GamePlan, GamePlan] => [
  { ...DEFAULT_PLANS.ham, ...patch },
  { ...DEFAULT_PLANS.sky, ...patch },
];
const FOCI: OffensiveFocus[] = ['inside', 'balanced', 'three', 'pickAndRoll', 'fastBreak'];
const SCHEMES: DefenceScheme[] = ['man', 'zone', 'press'];
/** The hoop the offence attacks, in absolute feet. */
const hoopOf = (script: Script) => (script.dir === 1 ? HOOP : { x: 94 - HOOP.x, y: HOOP.y });
const apart = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('floor spacing and positions', () => {
  it('every formation keeps its five 13 ft apart and inside the court', () => {
    for (const spots of Object.values(FORMATIONS)) {
      expect(spots).toHaveLength(5);
      spots.forEach(([x, y], i) => {
        expect(insideCourt({ x, y })).toEqual({ x, y });
        for (let j = i + 1; j < 5; j++) expect(Math.hypot(x - spots[j][0], y - spots[j][1])).toBeGreaterThanOrEqual(MIN_SPACING_FT);
      });
    }
  });

  it('teammates keep their spacing unless they are setting a screen, for every focus', () => {
    for (const offence of FOCI) {
      let spaced = 0;
      eachScript(planWith({ offence }), 2, (script) => {
        const prefix = `${script.offence}:`;
        for (const beat of script.beats) {
          if (!beat.spaced) continue;
          spaced++;
          const keys = Object.keys(beat.players).filter((k) => k.startsWith(prefix) && k !== beat.outOfBounds);
          keys.forEach((a, i) => {
            for (const b of keys.slice(i + 1)) {
              if (beat.contact?.includes(a) && beat.contact.includes(b)) continue;
              expect(apart(beat.players[a], beat.players[b])).toBeGreaterThanOrEqual(MIN_SPACING_FT - 0.05);
            }
          });
        }
      });
      expect(spaced).toBeGreaterThan(100);
    }
  });

  it('nobody is sent out of bounds or behind a backboard, except the inbounder', () => {
    let inbounds = 0;
    for (const defence of SCHEMES) {
      eachScript(planWith({ defence }), 2, (script) => {
        for (const beat of script.beats) {
          for (const [k, p] of Object.entries(beat.players)) {
            if (k === beat.outOfBounds) {
              inbounds++;
              continue;
            }
            const inside = insideCourt(p);
            expect(apart(inside, p)).toBeLessThan(0.001);
          }
        }
      });
    }
    expect(inbounds).toBeGreaterThan(50);
  });

  it('man-to-man: each defender is between their man and the basket, sagging off the ball', () => {
    let checked = 0;
    let onBall = 0;
    let offBall = 0;
    eachScript(planWith({ defence: 'man' }), 2, (script, _e, _s, lineups) => {
      const hoop = hoopOf(script);
      const off = script.offence;
      for (const beat of script.beats) {
        if (beat.phase !== 'setUp') continue;
        const holder = beat.ball.kind === 'held' ? beat.ball.holder : null;
        const guards = lineups[other(off)];
        lineups[off].forEach((id, i) => {
          const manKey = playerKey(off, id);
          const defKey = playerKey(other(off), guards[i]);
          const man = beat.players[manKey];
          const d = beat.players[defKey];
          if (!man || !d) return;
          checked++;
          expect(apart(d, hoop)).toBeLessThan(apart(man, hoop));
          // On the line: going via the defender is barely longer than going straight.
          expect(apart(man, d) + apart(d, hoop)).toBeLessThan(apart(man, hoop) + 0.5);
          if (manKey === holder) {
            onBall += apart(man, d);
          } else offBall += apart(man, d) / 4;
        });
      }
    });
    expect(checked).toBeGreaterThan(100);
    expect(offBall).toBeGreaterThan(onBall);
  });

  it('a 2-3 zone holds its spots; a press picks up in the backcourt', () => {
    let zone = 0;
    eachScript(planWith({ defence: 'zone' }), 2, (script, _e, _s, lineups) => {
      const def = other(script.offence);
      for (const beat of script.beats) {
        if (beat.phase !== 'setUp') continue;
        lineups[def].forEach((id, i) => {
          const p = beat.players[playerKey(def, id)];
          if (!p) return;
          const norm = script.dir === 1 ? p : { x: 94 - p.x, y: p.y };
          expect(apart(norm, { x: ZONE[i][0], y: ZONE[i][1] })).toBeLessThan(3);
          zone++;
        });
      }
    });
    expect(zone).toBeGreaterThan(100);

    let picked = 0;
    eachScript(planWith({ defence: 'press' }), 2, (script, events) => {
      if (events.some((e) => e.type === 'fastBreak')) return;
      const beat = script.beats.find((b) => b.phase === 'bringUp' && b.ball.kind === 'held' && b.ball.dribble);
      if (!beat || beat.ball.kind !== 'held') return;
      const handler = beat.players[beat.ball.holder];
      const defenders = Object.entries(beat.players).filter(([k]) => !k.startsWith(`${script.offence}:`));
      expect(Math.min(...defenders.map(([, p]) => apart(p, handler)))).toBeLessThan(5);
      picked++;
    });
    expect(picked).toBeGreaterThan(50);
  });
});

describe('possession phases', () => {
  it('played through, everyone has reached their spot by the end of the set-up', () => {
    let checked = 0;
    let late = 0;
    for (const [offence, defence] of [['three', 'man'], ['inside', 'zone'], ['pickAndRoll', 'man']] as const) {
      const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [{ ...DEFAULT_PLANS.ham, offence, defence }, { ...DEFAULT_PLANS.sky, offence, defence }], 5, ['ai', 'ai'], 'normal');
      const inner = m as unknown as { script: Script | null; durations: number[]; t: number; motion: Motion };
      let seen: Script | null = null;
      for (let i = 0; i < 60000; i++) {
        m.tick(1 / 60);
        if (m.phase === 'timeout' || m.phase === 'break') m.resume();
        const s = inner.script;
        if (!s || s === seen || s.clockStart - s.clockEnd < 8) continue;
        const { index, u } = beatAt(s, inner.durations, inner.t);
        const beat = s.beats[index];
        if (beat.phase !== 'setUp' || s.beats[index + 1]?.phase !== 'play' || u < 0.9) continue;
        seen = s;
        for (const [k, p] of Object.entries(beat.players)) {
          checked++;
          if (apart(inner.motion.pos[k], p) > 4) late++;
        }
      }
    }
    expect(checked).toBeGreaterThan(300);
    expect(late / checked).toBeLessThan(0.02);
  }, 30000);

  it('half-court possessions go bring up, set up, then 1-3 passes or a screen before the shot', () => {
    let seen = 0;
    eachScript(planWith({}), 3, (script, events) => {
      if (events.some((e) => e.type === 'fastBreak' || e.type === 'pressBroken' || e.type === 'doubleTeam')) return;
      const firstShot = events.findIndex((e) => e.type === 'shot');
      if (firstShot < 0 || events[firstShot].type !== 'shot' || events[firstShot].shotType === 'putback') return;
      if (events.slice(0, firstShot).some((e) => e.type === 'rebound' || e.type === 'freeThrow')) return;
      const phases = script.beats.map((b) => b.phase);
      expect(phases.indexOf('setUp')).toBeGreaterThanOrEqual(0);
      expect(phases.lastIndexOf('bringUp')).toBeLessThan(phases.indexOf('setUp'));
      const shotBeat = script.beats.findIndex((b) => b.fire.includes(firstShot));
      const action = script.beats.slice(phases.lastIndexOf('setUp') + 1, shotBeat);
      const passes = action.filter((b) => b.ball.kind === 'pass').length;
      const screens = action.some((b) => b.contact);
      expect(passes).toBeLessThanOrEqual(3);
      expect(passes > 0 || screens).toBe(true);
      seen++;
    });
    expect(seen).toBeGreaterThan(200);
  });
});

describe('the ball', () => {
  it('shots drop onto the rim from above; misses bounce into a contested rebound', () => {
    let misses = 0;
    eachScript(planWith({}), 2, (script, events) => {
      const hoop = hoopOf(script);
      events.forEach((ev, i) => {
        if (ev.type !== 'shot' || ev.blockerId) return;
        const at = script.beats.findIndex((b) => b.fire.includes(i));
        const ball = script.beats[at].ball;
        if (ball.kind !== 'fromPlayer') throw new Error('a shot must leave a player');
        expect(apart(ball.to, hoop)).toBeLessThan(1.6);
        expect(ball.to.z).toBeGreaterThan(10);
        if (ev.shotType === 'three') expect(ball.arc).toBeGreaterThan(3);
        const rebound = events[i + 1];
        if (ev.made || rebound?.type !== 'rebound') return;
        misses++;
        const bounce = script.beats[at + 1];
        const grab = script.beats[at + 2];
        expect(bounce.ball.kind).toBe('fixed');
        expect(grab.ball.kind).toBe('toPlayer');
        expect(grab.jump?.length).toBeGreaterThanOrEqual(2);
        expect(grab.fire).toContain(i + 1);
      });
    });
    expect(misses).toBeGreaterThan(50);
  });

  it('passes are quick and nearly flat, and last long enough to see', () => {
    let passes = 0;
    eachScript(planWith({}), 2, (script) => {
      for (const b of script.beats) {
        if (b.ball.kind !== 'pass' || b.slow) continue;
        passes++;
        expect(b.ball.arc).toBeLessThanOrEqual(0.3);
        expect(b.minSeconds).toBeGreaterThanOrEqual(0.3);
      }
    });
    expect(passes).toBeGreaterThan(300);
  });
});

describe('bodies', () => {
  it('played frame by frame, bodies stay apart and inside the court', () => {
    let frames = 0;
    let closest = Infinity;
    let furthestOut = 0;
    for (const defence of SCHEMES) {
      const m = new Motion();
      eachScript(planWith({ defence }), 1, (script) => {
        const durations = beatDurations(script, 8);
        const total = durations.reduce((a, b) => a + b, 0);
        let lastBeat = -1;
        let free = 0;
        for (let t = 0; t < total; t += 1 / 30) {
          const { index } = beatAt(script, durations, t);
          const beat = script.beats[index];
          // Whoever just inbounded the ball gets a moment to step back on court.
          if (beat.outOfBounds) free = 40;
          else free--;
          lastBeat = index;
          m.update(beat.players, 1 / 30, 1, beat.ball.kind === 'held' ? beat.ball.holder : null, beat.pace, beat.outOfBounds);
          frames++;
          const entries = Object.entries(m.pos);
          entries.forEach(([k, p], i) => {
            if (free <= 0 && k !== beat.outOfBounds) furthestOut = Math.max(furthestOut, apart(insideCourt(p, 1), p));
            for (let j = i + 1; j < entries.length; j++) closest = Math.min(closest, apart(p, entries[j][1]));
          });
        }
        expect(lastBeat).toBe(script.beats.length - 1);
      });
    }
    expect(frames).toBeGreaterThan(5000);
    expect(closest).toBeGreaterThan(BODY_FT * 0.6);
    expect(furthestOut).toBeLessThan(0.6);
  }, 30000);

  it('the Speed attribute and fatigue both change how fast a player runs', () => {
    const top = (rating: number, energy: number) => {
      const m = new Motion();
      m.setSpeedRatings({ a: rating });
      m.setEnergy({ a: energy });
      m.update({ a: { x: 5, y: 10 } }, 1 / 60, 1, 'a');
      let best = 0;
      for (let i = 0; i < 300; i++) {
        m.update({ a: { x: 90, y: 10 } }, 1 / 60, 1, 'a', { a: 'run' });
        best = Math.max(best, m.vel.a.x);
      }
      return best;
    };
    expect(top(90, 100) / top(45, 100)).toBeGreaterThan(1.3);
    expect(top(70, 100) / top(70, 30)).toBeGreaterThan(1.15);
    expect(speedFactor(99)).toBeLessThanOrEqual(1.14);
  });

  it('sprites scale with height', () => {
    expect(spriteScale(7.2)).toBeGreaterThan(1.12);
    expect(spriteScale(5.9)).toBeLessThan(0.9);
    expect(spriteScale(6.5)).toBe(1);
  });
});

describe('playback', () => {
  const live = () => new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], 7, ['ai', 'ai'], 'normal');

  it('the animation never changes the engine: same seed, same events', () => {
    const plain = createMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, DEFAULT_PLANS.ham, DEFAULT_PLANS.sky, 11);
    while (!plain.finished) stepPossession(plain);
    let scripted: MatchState | null = null;
    eachScript([DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], 11, (_script, _events, s) => {
      if (s.seed === plain.seed) scripted = s;
    });
    expect(scripted).not.toBeNull();
    expect(scripted!.events).toEqual(plain.events);
  });

  it('fast-forward shortens bring-up and set-up but never the action, and only when routine', () => {
    const m = live();
    while (!m.isFastForwarding()) m.tick(1 / 60);
    const inner = m as unknown as { durations: number[]; script: Script };
    const before = [...inner.durations];
    m.toggleFastForward();
    expect(m.isFastForwarding()).toBe(false);
    inner.durations.forEach((d, i) => {
      if (inner.script.beats[i].phase === 'play') expect(d).toBeCloseTo(before[i]);
      else expect(d).toBeGreaterThan(before[i]);
    });
  });
});
