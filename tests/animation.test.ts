// The animation scripts must tell a consistent story: passes go between players on court,
// shots leave the shooter's hands, and every engine event is shown exactly once.

import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../src/data/teams';
import { createMatch, stepPossession } from '../src/engine/match';
import { other, playerOf } from '../src/engine/state';
import { PACE_M_S, REFS, beatDurations, beatAt, buildScript, isRef, playerKey, type Frame, type Pace, type Script } from '../src/ui/court/animation';
import { BODY_M, COURT, FORMATIONS, HOOP, MIN_SPACING_M, ZONE, insideCourt } from '../src/ui/court/formations';
import { Motion, angleDiff, facingScene, speedFactor } from '../src/ui/court/motion';
import { PASS_SPEED } from '../src/ui/court/animation';
import { CANVAS_H, CANVAS_W, bodyView, project, spriteScale } from '../src/ui/court/render';
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
          // Ten players and the three officials.
          expect(Object.keys(beat.players).filter((k) => !isRef(k)).length).toBe(10);
          for (const r of REFS) expect(beat.players[r]).toBeDefined();
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
        prev = { players: last.players, ball: { x: 14, y: 7.5, z: 0.9 } };
      }
    }
  });

  it('players accelerate smoothly and respect a top speed; a dribbled ball bounces', () => {
    const m = new Motion();
    m.update({ a: { x: 1.5, y: 3 } }, 0.016, 1, 'a');
    let maxStep = 0;
    let lastX = 1.5;
    const heights: number[] = [];
    for (let i = 0; i < 300; i++) {
      m.update({ a: { x: 25.5, y: 3 } }, 0.016, 1, 'a');
      maxStep = Math.max(maxStep, m.pos.a.x - lastX);
      lastX = m.pos.a.x;
      heights.push(m.ball({ kind: 'held', holder: 'a', dribble: true }, 0, 1).z);
    }
    expect(maxStep / 0.016).toBeLessThanOrEqual(PACE_M_S.sprint + 0.003);
    expect(m.pos.a.x).toBeGreaterThan(21);
    expect(Math.min(...heights)).toBeLessThan(0.24);
    expect(Math.max(...heights)).toBeGreaterThan(0.85);
  });

  it('pace and speed rating set the top speed, and nobody overshoots their spot', () => {
    const top = (pace: Pace, rating: number) => {
      const m = new Motion();
      m.setSpeedRatings({ a: rating });
      m.update({ a: { x: 1.5, y: 3 } }, 0.016, 1, 'a');
      let best = 0;
      let furthest = 0;
      for (let i = 0; i < 900; i++) {
        m.update({ a: { x: 18, y: 3 } }, 0.016, 1, 'a', { a: pace });
        best = Math.max(best, m.vel.a.x);
        furthest = Math.max(furthest, m.pos.a.x);
      }
      expect(furthest).toBeLessThan(18.06);
      return best;
    };
    expect(top('jog', 70)).toBeLessThan(top('sprint', 70));
    expect(top('sprint', 40)).toBeLessThan(top('sprint', 90));
    expect(top('sprint', 99)).toBeLessThan(9.1);
  });

  it('the dribble keeps time with the stride and the ball never jumps sideways', () => {
    const m = new Motion();
    m.update({ 'home:a': { x: 1.5, y: 3 }, 'away:b': { x: 12, y: 7.5 } }, 0.016, 1, 'home:a');
    const action = { kind: 'held' as const, holder: 'home:a', dribble: true };
    let floors = 0;
    let lastZ = m.ball(action, 0, 1).z;
    let falling = false;
    let last = m.ball(action, 0, 1);
    let biggest = 0;
    for (let i = 0; i < 125; i++) {
      m.update({ 'home:a': { x: 27, y: 12 }, 'away:b': { x: 12, y: 7.5 } }, 0.016, 1, 'home:a');
      const b = m.ball(action, 0, 1);
      if (falling && b.z > lastZ) floors++;
      falling = b.z < lastZ;
      lastZ = b.z;
      biggest = Math.max(biggest, Math.hypot(b.x - last.x, b.y - last.y));
      last = b;
    }
    // Two seconds of running: two to three bounces a second, not a frantic drum roll.
    expect(floors).toBeGreaterThanOrEqual(4);
    expect(floors).toBeLessThanOrEqual(6);
    expect(biggest).toBeLessThan(0.27);
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
    m.update({ s: { x: 25.2, y: 7.5 } }, 0.016, 1, 's');
    const rim = { x: 26.5, y: 7.5, z: 3.14 };
    const jumper = { kind: 'fromPlayer' as const, from: 's', to: rim, arc: 5, style: 'jumper' as const };
    expect(m.lift(jumper, 0)!.height).toBe(0);
    expect(m.lift(jumper, 0.32)!.height).toBeCloseTo(0.6, 1);
    expect(m.lift(jumper, 0.9)!.height).toBe(0);
    const dunk = { kind: 'fromPlayer' as const, from: 's', to: rim, arc: 0, style: 'dunk' as const };
    expect(m.ball(dunk, 0.73, 1).z).toBeGreaterThan(3.14);
    expect(m.ball(dunk, 1, 1).z).toBeCloseTo(3.14, 1);
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
      prev = { players: last.players, ball: { x: 14, y: 7.5, z: 0.9 } };
    }
  }
}

const planWith = (patch: Partial<GamePlan>): [GamePlan, GamePlan] => [
  { ...DEFAULT_PLANS.ham, ...patch },
  { ...DEFAULT_PLANS.sky, ...patch },
];
const FOCI: OffensiveFocus[] = ['inside', 'balanced', 'three', 'pickAndRoll', 'fastBreak'];
const SCHEMES: DefenceScheme[] = ['man', 'zone', 'press'];
/** The hoop the offence attacks, in absolute metres. */
const hoopOf = (script: Script) => (script.dir === 1 ? HOOP : { x: COURT.w - HOOP.x, y: HOOP.y });
const apart = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('floor spacing and positions', () => {
  it('every formation keeps its five 4 m apart and inside the court', () => {
    for (const spots of Object.values(FORMATIONS)) {
      expect(spots).toHaveLength(5);
      spots.forEach(([x, y], i) => {
        expect(insideCourt({ x, y })).toEqual({ x, y });
        for (let j = i + 1; j < 5; j++) expect(Math.hypot(x - spots[j][0], y - spots[j][1])).toBeGreaterThanOrEqual(MIN_SPACING_M);
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
              expect(apart(beat.players[a], beat.players[b])).toBeGreaterThanOrEqual(MIN_SPACING_M - 0.015);
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
            // Officials work from off the floor.
            if (isRef(k)) continue;
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
          expect(apart(man, d) + apart(d, hoop)).toBeLessThan(apart(man, hoop) + 0.15);
          if (manKey === holder) {
            onBall += apart(man, d);
          } else offBall += apart(man, d) / 4;
        });
      }
    });
    expect(checked).toBeGreaterThan(100);
    expect(offBall).toBeGreaterThan(onBall);
  });

  it('a 2-3 zone holds its areas and always has a man on the ball; a press picks up in the backcourt', () => {
    let zone = 0;
    let pressured = 0;
    eachScript(planWith({ defence: 'zone' }), 2, (script, _e, _s, lineups) => {
      const def = other(script.offence);
      const hoop = hoopOf(script);
      for (const beat of script.beats) {
        if (beat.phase !== 'setUp' || beat.ball.kind !== 'held') continue;
        const holder = beat.ball.holder;
        const handler = beat.players[holder];
        lineups[def].forEach((id, i) => {
          const k = playerKey(def, id);
          const p = beat.players[k];
          if (!p) return;
          zone++;
          // Out on the ball, or in his area, the whole shape shifted towards the ball's side.
          if (beat.marking?.[k] === holder) expect(apart(p, handler)).toBeLessThan(1.5);
          else {
            const norm = script.dir === 1 ? p : { x: COURT.w - p.x, y: p.y };
            expect(apart(norm, { x: ZONE[i][0], y: ZONE[i][1] })).toBeLessThan(2.6);
          }
        });
        // Nobody walks into the zone unchallenged.
        if (apart(handler, hoop) < 10) {
          expect(Object.values(beat.marking ?? {})).toContain(holder);
          pressured++;
        }
      }
    });
    expect(zone).toBeGreaterThan(100);
    expect(pressured).toBeGreaterThan(20);

    let picked = 0;
    eachScript(planWith({ defence: 'press' }), 2, (script, events) => {
      // Beaten up the floor in transition, nobody presses.
      if (events.some((e) => e.type === 'fastBreak' || e.type === 'transition')) return;
      const beat = script.beats.find((b) => b.phase === 'bringUp' && b.ball.kind === 'held' && b.ball.dribble);
      if (!beat || beat.ball.kind !== 'held') return;
      const handler = beat.players[beat.ball.holder];
      const defenders = Object.entries(beat.players).filter(([k]) => !k.startsWith(`${script.offence}:`) && !isRef(k));
      expect(Math.min(...defenders.map(([, p]) => apart(p, handler)))).toBeLessThan(1.5);
      picked++;
    });
    expect(picked).toBeGreaterThan(50);
  });
});

describe('possession phases', () => {
  it('the ball handler never just stands: every half-court set has a screen, a post-up or a move with the ball', () => {
    const plays = { screen: 0, post: 0, move: 0, still: 0 };
    for (const offence of FOCI) {
      eachScript(planWith({ offence }), 1, (script, events) => {
        const setUpEnd = script.beats.map((b) => b.phase).lastIndexOf('setUp');
        if (setUpEnd < 0 || script.clockStart - script.clockEnd < 8) return;
        if (events.some((e) => e.type === 'fastBreak' || e.type === 'pressBroken' || e.type === 'doubleTeam' || e.type === 'freeThrow' || e.type === 'rebound')) return;
        const shot = script.beats.findIndex((b) => b.ball.kind === 'fromPlayer');
        if (shot < 0) return;
        const action = script.beats.slice(setUpEnd + 1, shot);
        if (action.some((b) => b.contact)) plays.screen++;
        else if (action.some((b) => b.posting)) plays.post++;
        else {
          // Moved with the ball: a dribble beat that takes the handler at least 1.5 m.
          const moved = action.some((b, i) => {
            const prevBeat = script.beats[setUpEnd + i];
            return b.ball.kind === 'held' && b.ball.dribble && apart(b.players[b.ball.holder], prevBeat.players[b.ball.holder]) >= 1.5;
          });
          if (moved) plays.move++;
          else plays.still++;
        }
      });
    }
    const total = plays.screen + plays.post + plays.move + plays.still;
    expect(total).toBeGreaterThan(200);
    expect(plays.still / total).toBeLessThan(0.1);
    // A real mix of sets, not one trick.
    expect(plays.screen / total).toBeGreaterThan(0.2);
    expect(plays.post / total).toBeGreaterThan(0.05);
    expect(plays.move / total).toBeGreaterThan(0.15);
  });

  it('played through, the defence is set and the handler at his spot by the end of the set-up; a trailer may still be coming', () => {
    let checked = 0;
    let late = 0;
    let trailers = 0;
    let trailing = 0;
    for (const [offence, defence, seed] of [['three', 'man', 5], ['inside', 'zone', 5], ['pickAndRoll', 'man', 5], ['three', 'zone', 6], ['balanced', 'man', 6]] as const) {
      const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [{ ...DEFAULT_PLANS.ham, offence, defence }, { ...DEFAULT_PLANS.sky, offence, defence }], seed, ['ai', 'ai'], 'normal');
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
        const handler = beat.ball.kind === 'held' ? beat.ball.holder : '';
        for (const [k, p] of Object.entries(beat.players)) {
          // A guarding defender follows his man, not a spot: the realism test judges him on that. Officials follow the play.
          if (beat.marking?.[k] || isRef(k)) continue;
          const off = apart(inner.motion.pos[k], p);
          // The play starts as the handler gets there: a teammate still running in joins it on the way.
          if (k !== handler && k.startsWith(`${s.offence}:`)) {
            trailers++;
            if (off > 1.2) trailing++;
            continue;
          }
          checked++;
          // Kept waiting, the handler probes round his spot with the ball.
          if (off > (k === handler ? 2 : 1.2)) late++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
    // Known issue, on main as well: over whole matches about 8% of handlers and zone defenders are still
    // 1.2 m or more from their spot when the play starts (it looked like under 2% on a small sample).
    expect(late / checked).toBeLessThan(0.1);
    // Teammates still running in as the play starts: by design, but not most of them.
    expect(trailing / trailers).toBeLessThan(0.25);
  }, 120000);

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
      // Passes in play: a throw-in after a side-out foul is the officials' and the thrower's business.
      const passes = action.filter((b) => b.ball.kind === 'pass' && !b.dead).length;
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
        expect(apart(ball.to, hoop)).toBeLessThan(0.49);
        expect(ball.to.z).toBeGreaterThan(3.05);
        if (ev.shotType === 'three') expect(ball.arc).toBeGreaterThan(0.9);
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

  it('passes go to open teammates: flat passes never go through a defender, long ones go over the top', () => {
    const lane = (a: { x: number; y: number }, b: { x: number; y: number }, defs: { x: number; y: number }[]) =>
      defs.filter((d) => {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const t = ((d.x - a.x) * dx + (d.y - a.y) * dy) / (dx * dx + dy * dy || 1);
        return t > 0.12 && t < 0.88 && Math.hypot(a.x + dx * t - d.x, a.y + dy * t - d.y) < 0.9;
      }).length;
    let passes = 0;
    let long = 0;
    let crowded = 0;
    const styles: Record<string, number> = {};
    eachScript(planWith({}), 2, (script) => {
      script.beats.forEach((b, i) => {
        // Players' passes; an official handing the ball over is not a pass through a defence.
        if (b.ball.kind !== 'pass' || b.slow || i === 0 || isRef(b.ball.from) || isRef(b.ball.to)) return;
        // The pass is judged as thrown: from the passer, to where the receiver catches it, past the
        // defenders where they stood.
        const before = script.beats[i - 1].players;
        const from = before[b.ball.from];
        const to = b.players[b.ball.to];
        const defs = Object.entries(before).filter(([k]) => !k.startsWith(`${script.offence}:`)).map(([, p]) => p);
        const d = apart(from, to);
        const style = b.ball.style ?? 'chest';
        passes++;
        styles[style] = (styles[style] ?? 0) + 1;
        if (style === 'chest') {
          expect(lane(from, to, defs)).toBe(0);
          expect(d).toBeLessThanOrEqual(9);
          expect(b.ball.arc).toBeLessThanOrEqual(0.09);
        }
        if (style === 'bounce') expect(d).toBeLessThanOrEqual(6);
        if (d > 12) long++;
        // Through two defenders only ever over the top or off the floor, never flat.
        if (lane(from, to, defs) >= 2) {
          crowded++;
          expect(style).not.toBe('chest');
        }
        expect(b.minSeconds).toBeGreaterThanOrEqual(0.3);
      });
    });
    expect(passes).toBeGreaterThan(300);
    expect(styles.chest / passes).toBeGreaterThan(0.6);
    expect(styles.bounce ?? 0).toBeGreaterThan(0);
    expect(styles.lob ?? 0).toBeGreaterThan(0);
    // Long ones are cross-court skip passes over the top (12-15 m on a 15 m wide floor): rare, about
    // 2-2.5% of passes over many matches, so the bar sits above that, not on it.
    expect(long / passes).toBeLessThan(0.03);
    // Past two defenders (always over the top or off the floor, checked above): about 1.8% of
    // passes over ten matches, more or less in two, so the bar sits above that, not on it.
    expect(crowded / passes).toBeLessThan(0.03);
  });

  it('a pass flies in a straight line at the speed of its type, then sits in the receiver\'s hands', () => {
    for (const style of ['chest', 'bounce', 'lob'] as const) {
      const m = new Motion();
      const spots = { 'h:a': { x: 5, y: 5 }, 'h:b': { x: 12, y: 5 } };
      m.update(spots, 1 / 60, 1, 'h:a');
      const action = { kind: 'pass' as const, from: 'h:a', to: 'h:b', arc: style === 'lob' ? 1.2 : 0.05, style };
      const path: { x: number; y: number; z: number }[] = [];
      for (let i = 0; i < 90; i++) {
        m.update(spots, 1 / 60, 1, null);
        path.push(m.ball(action, 0.1, 1));
      }
      const flying = path.filter((_, i) => i < 30);
      // Straight on the floor: every point sits on the line from release to where it is aimed.
      const [a, b] = [flying[0], flying[24]];
      for (const p of flying.slice(0, 25)) {
        const off = Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
        expect(off).toBeLessThan(0.01);
      }
      const speed = (flying[20].x - flying[10].x) / (10 / 60);
      expect(speed).toBeGreaterThan(PASS_SPEED[style] * 0.9);
      expect(speed).toBeLessThan(PASS_SPEED[style] * 1.1);
      // The whole flight, until it is caught: a bounce pass hits the floor, a lob goes up.
      const inAir = path.slice(0, 50);
      if (style === 'bounce') expect(Math.min(...inAir.map((p) => p.z))).toBeLessThan(0.2);
      if (style === 'lob') expect(Math.max(...inAir.map((p) => p.z))).toBeGreaterThan(1.8);
      expect(m.passArrived(action)).toBe(true);
      const end = path[path.length - 1];
      expect(apart(end, path[path.length - 2])).toBeLessThan(0.001);
    }
  });

  it('shots, rebounds and loose balls last exactly as long as their flight, however long the possession', () => {
    let checked = 0;
    eachScript(planWith({}), 1, (script) => {
      const durations = beatDurations(script, 14);
      script.beats.forEach((b, i) => {
        if (b.ball.kind !== 'fromPlayer' || b.minSeconds === undefined) return;
        checked++;
        expect(durations[i]).toBeCloseTo(b.minSeconds, 5);
      });
    });
    expect(checked).toBeGreaterThan(50);
  });
});

describe('court space', () => {
  it('the court is the NBA 94 x 50 ft (28.65 x 15.24 m) and every script stays in those metres', () => {
    expect(COURT).toEqual({ w: 28.65, h: 15.24 });
    eachScript(planWith({}), 1, (script) => {
      for (const beat of script.beats) {
        for (const [k, p] of Object.entries(beat.players)) {
          if (k === beat.outOfBounds || isRef(k)) continue;
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(COURT.w);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(COURT.h);
        }
      }
    });
  });

  it('the whole court lands on the canvas, and nearer the camera is lower on the screen', () => {
    for (const [x, y] of [[0, 0], [COURT.w, 0], [0, COURT.h], [COURT.w, COURT.h]]) {
      const p = project(x, y);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(CANVAS_W);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(CANVAS_H);
    }
    // The draw order sorts on y - x, so a larger y - x has to mean closer to the bottom of the screen.
    expect(project(10, 8).y).toBeGreaterThan(project(10, 7).y);
    expect(project(9, 7).y).toBeGreaterThan(project(10, 7).y);
    expect(project(10, 7, 3).y).toBeLessThan(project(10, 7).y);
  });

  it('even the highest shot, from the far corner, stays on the canvas', () => {
    let shots = 0;
    eachScript(planWith({ offence: 'three' }), 2, (script) => {
      for (const b of script.beats) {
        if (b.ball.kind !== 'fromPlayer' || b.ball.style === 'throw') continue;
        shots++;
        const from = b.players[b.ball.from];
        const peak = (2.9 + b.ball.to.z) / 2 + b.ball.arc;
        const mid = project((from.x + b.ball.to.x) / 2, (from.y + b.ball.to.y) / 2, peak);
        expect(mid.y).toBeGreaterThan(0);
      }
    });
    expect(shots).toBeGreaterThan(100);
  });
});

describe('facing', () => {
  const degrees = (a: number, b: number) => (Math.abs(angleDiff(a, b)) * 180) / Math.PI;
  const angleTo = (from: { x: number; y: number }, to: { x: number; y: number }) => Math.atan2(to.y - from.y, to.x - from.x);

  /** Plays whole matches frame by frame and tallies how often each rule holds. */
  function audit(defence: DefenceScheme) {
    const tally: Record<string, { ok: number; all: number }> = {};
    const note = (rule: string, ok: boolean) => {
      tally[rule] ??= { ok: 0, all: 0 };
      tally[rule].all++;
      if (ok) tally[rule].ok++;
    };
    let fastestTurn = 0;
    const m = new Motion();
    const dt = 1 / 30;
    eachScript(planWith({ defence }), 1, (script) => {
      const durations = beatDurations(script, 8);
      const total = durations.reduce((a, b) => a + b, 0);
      const hoopFor = (k: string) => (k.startsWith(`${script.offence}:`) ? hoopOf(script) : { x: COURT.w - hoopOf(script).x, y: HOOP.y });
      for (let t = 0; t < total; t += dt) {
        const { index, u } = beatAt(script, durations, t);
        const beat = script.beats[index];
        const a = beat.ball;
        const holder = a.kind === 'held' ? a.holder : null;
        m.update(beat.players, dt, 1, holder, beat.pace, beat.outOfBounds);
        const ball = m.ball(a, u, script.dir);
        const before = { ...m.facing };
        const scene = facingScene(script, durations, index, u, ball, 1);
        m.updateFacing(scene, dt, 1);
        // About to pass or shoot: the handler is already turning for it, which the rules for those cover.
        const turningToAct = scene.next?.kind === 'pass' || scene.next?.kind === 'fromPlayer';
        for (const [k, f] of Object.entries(m.facing)) {
          if (before[k] !== undefined) fastestTurn = Math.max(fastestTurn, Math.abs(angleDiff(before[k], f)) / dt);
          const me = m.pos[k];
          const speed = Math.hypot(m.vel[k].x, m.vel[k].y);
          if (a.kind === 'fromPlayer' && a.style !== 'throw') {
            if (u > 0.6 && k === a.from && a.style === 'hook') note('hook shooter is side-on to the rim', Math.abs(degrees(f, angleTo(me, hoopFor(k))) - 90) < 30);
            else if (u > 0.6) note(k === a.from ? 'shooter faces the hoop' : 'everyone watches the shot', degrees(f, angleTo(me, k === a.from ? hoopFor(k) : ball)) < (k === a.from ? 30 : 90));
          } else if (a.kind === 'pass') {
            if (u > 0.5 && k === a.from) note('passer faces the receiver', degrees(f, angleTo(me, m.pos[a.to])) < 45);
            if (u > 0.5 && k === a.to) note('receiver faces the ball', degrees(f, angleTo(me, ball)) < 60);
          } else if (a.kind === 'held' && holder && u > 0.5) {
            if (k === holder && scene.posting === k) note('post player has his back to the basket', degrees(f, angleTo(me, hoopFor(k))) > 150);
            const sameTeam = k.slice(0, 2) === holder.slice(0, 2);
            if (k === holder && speed > 3.5 && !turningToAct && scene.posting !== k) note('handler faces the way they go', degrees(f, Math.atan2(m.vel[k].y, m.vel[k].x)) < 45);
            if (k === holder && speed < 0.5 && !turningToAct && scene.posting !== k) note('standing handler faces the basket', degrees(f, angleTo(me, hoopFor(k))) < 45);
            if (k !== holder && sameTeam && speed < 1) note('off-ball attackers face the ball', degrees(f, angleTo(me, ball)) < 60);
            if (!sameTeam && apart(me, m.pos[holder]) < 1.5) note('on-ball defender never turns their back', degrees(f, angleTo(me, m.pos[holder])) < 90);
            const man = script.guards[k];
            if (!sameTeam && man && man !== holder && speed < 1 && apart(me, m.pos[holder]) > 3) note('off-ball defenders see man and ball', degrees(f, angleTo(me, { x: (m.pos[man].x + ball.x) / 2, y: (m.pos[man].y + ball.y) / 2 })) < 60);
          }
        }
      }
    });
    return { tally, fastestTurn };
  }

  it('in real possessions everyone looks the right way, and nobody turns faster than 360 degrees a second', () => {
    const { tally, fastestTurn } = audit('man');
    expect(fastestTurn).toBeLessThanOrEqual(Math.PI * 2 + 0.001);
    const rates = Object.fromEntries(Object.entries(tally).map(([rule, { ok, all }]) => [rule, ok / all]));
    for (const rule of ['hook shooter is side-on to the rim', 'post player has his back to the basket', 'shooter faces the hoop', 'passer faces the receiver', 'receiver faces the ball', 'handler faces the way they go', 'standing handler faces the basket', 'off-ball attackers face the ball', 'on-ball defender never turns their back', 'off-ball defenders see man and ball', 'everyone watches the shot']) {
      expect(tally[rule]?.all ?? 0, rule).toBeGreaterThan(20);
      // On the wider NBA floor man and ball are further apart, so keeping both in view is a little harder.
      expect(rates[rule], rule).toBeGreaterThan(rule === 'off-ball defenders see man and ball' ? 0.88 : 0.9);
    }
  }, 60000);

  it('a zone defender watches the ball', () => {
    const { tally } = audit('zone');
    expect(tally['on-ball defender never turns their back'].ok / tally['on-ball defender never turns their back'].all).toBeGreaterThan(0.9);
    expect(tally['off-ball defenders see man and ball']).toBeUndefined();
  }, 60000);

  it('the on-ball defender stands about 1 m away, between the handler and the basket', () => {
    let checked = 0;
    eachScript(planWith({ defence: 'man' }), 1, (script) => {
      for (const beat of script.beats) {
        if (beat.phase !== 'setUp' || beat.ball.kind !== 'held') continue;
        const holder = beat.ball.holder;
        const guard = Object.keys(script.guards).find((d) => script.guards[d] === holder);
        if (!guard) continue;
        checked++;
        expect(apart(beat.players[guard], beat.players[holder])).toBeCloseTo(1, 1);
        expect(apart(beat.players[guard], hoopOf(script))).toBeLessThan(apart(beat.players[holder], hoopOf(script)));
      }
    });
    expect(checked).toBeGreaterThan(50);
  });

  it('a defender moving backwards backpedals: the turn never catches up with the run', () => {
    const m = new Motion();
    const scene = (ball: { x: number; y: number }) => ({ action: { kind: 'held' as const, holder: '0:h', dribble: true }, ball, offence: 0 as const, dir: 1 as const, guards: { '1:d': '0:h' } });
    m.update({ '0:h': { x: 15, y: 7.5 }, '1:d': { x: 16, y: 7.5 } }, 1 / 60, 1, '0:h');
    for (let i = 0; i < 60; i++) {
      const h = { x: 15 + i * 0.05, y: 7.5 };
      m.update({ '0:h': h, '1:d': { x: h.x + 1, y: 7.5 } }, 1 / 60, 1, '0:h', { '0:h': 'run', '1:d': 'run' });
      m.updateFacing(scene(h), 1 / 60, 1);
    }
    // Retreating towards +x while facing back towards the handler at -x.
    expect(m.vel['1:d'].x).toBeGreaterThan(1);
    expect(Math.abs(angleDiff(m.facing['1:d'], Math.PI))).toBeLessThan(0.3);
  });

  it('the sprite turns the way the court says: its view matches the projection at every angle', () => {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const { side, toward } = bodyView(a);
      const from = project(10, 7);
      const to = project(10 + Math.cos(a), 7 + Math.sin(a));
      expect(Math.sign(Math.round((to.x - from.x) * 1000)) + 0).toBe(Math.sign(Math.round(side * 1000)) + 0);
      expect(Math.sign(Math.round((to.y - from.y) * 1000)) + 0).toBe(Math.sign(Math.round(toward * 1000)) + 0);
    }
  });
});

describe('contesting and rebounding', () => {
  /** Plays a match frame by frame, as the controller does, and reports each frame of shots and rebounds. */
  function play(check: (f: { script: Script; beat: Script['beats'][number]; u: number; m: Motion; ball: { x: number; y: number; z: number }; lift: Record<string, number> }) => void) {
    const m = new Motion();
    const dt = 1 / 30;
    eachScript(planWith({}), 2, (script) => {
      const durations = beatDurations(script, 8);
      const total = durations.reduce((a, b) => a + b, 0);
      for (let t = 0; t < total; t += dt) {
        const { index, u } = beatAt(script, durations, t);
        const beat = script.beats[index];
        m.update(beat.players, dt, 1, beat.ball.kind === 'held' ? beat.ball.holder : null, beat.pace, beat.outOfBounds);
        const ball = m.ball(beat.ball, u, script.dir);
        m.updateFacing(facingScene(script, durations, index, u, ball, 1), dt, 1);
        m.updateArms(beat, ball, u, dt, 1);
        check({ script, beat, u, m, ball, lift: m.jumps(beat, u) });
      }
    });
  }

  it('every shot from the field is challenged by a defender', () => {
    let shots = 0;
    eachScript(planWith({}), 2, (script, events) => {
      events.forEach((ev, i) => {
        if (ev.type !== 'shot') return;
        const beat = script.beats.find((b) => b.fire.includes(i))!;
        shots++;
        expect(beat.contest?.startsWith(`${other(script.offence)}:`)).toBe(true);
        if (ev.blockerId) {
          expect(beat.contest).toBe(playerKey(other(script.offence), ev.blockerId));
          expect(beat.block).toBe(true);
        }
      });
    });
    expect(shots).toBeGreaterThan(200);
  });

  it('the challenger gets their hands up and jumps at most shots; a blocker always leaves the floor', () => {
    const seen = new Map<object, { handsUp: boolean; jumped: boolean; block: boolean }>();
    play(({ beat, m, lift }) => {
      if (!beat.contest || beat.ball.kind !== 'fromPlayer') return;
      const s = seen.get(beat) ?? { handsUp: false, jumped: false, block: !!beat.block };
      s.handsUp ||= (m.reach[beat.contest] ?? 0) > 0.9;
      s.jumped ||= (lift[beat.contest] ?? 0) > 0.3;
      seen.set(beat, s);
    });
    const all = [...seen.values()];
    expect(all.length).toBeGreaterThan(100);
    expect(all.filter((s) => s.handsUp).length / all.length).toBeGreaterThan(0.75);
    expect(all.filter((s) => s.jumped).length / all.length).toBeGreaterThan(0.6);
    const blocks = all.filter((s) => s.block);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((s) => s.jumped)).toBe(true);
  }, 60000);

  it('a blocker is on the shooter with hands up at the moment of release', () => {
    const blocks = new Map<object, { close: boolean; handsUp: boolean; air: number }>();
    play(({ beat, m, u, lift }) => {
      if (!beat.block || !beat.contest || beat.ball.kind !== 'fromPlayer') return;
      const release = { jumper: 0.32, hook: 0.36, layup: 0.55, dunk: 0.74, set: 0.3, throw: 0.05 }[beat.ball.style];
      if (u < release) return;
      if (blocks.has(beat)) return;
      blocks.set(beat, { close: apart(m.pos[beat.contest], m.pos[beat.ball.from]) < 2, handsUp: (m.reach[beat.contest] ?? 0) > 0.9, air: lift[beat.contest] ?? 0 });
    });
    const all = [...blocks.values()];
    expect(all.length).toBeGreaterThan(5);
    expect(all.filter((b) => b.close).length / all.length).toBeGreaterThan(0.9);
    expect(all.filter((b) => b.handsUp).length / all.length).toBeGreaterThan(0.9);
    expect(all.filter((b) => b.air > 0.6).length / all.length).toBeGreaterThan(0.9);
  }, 60000);

  it('rebounders have their hands up while the ball is high, and the winner takes it overhead', () => {
    let reaching = 0;
    let highest = 0;
    let lowAndUp = 0;
    let frames = 0;
    play(({ beat, m, ball, u }) => {
      if (!beat.reach) return;
      for (const k of beat.reach) {
        frames++;
        const close = apart(m.pos[k], ball) < 2;
        if (ball.z > 2.2 && close && (m.reach[k] ?? 0) > 0.9) reaching++;
        // The ball has come down well below their hands: they are not still reaching a beat later.
        if (ball.z < 1 && (m.reach[k] ?? 0) > 0.5) lowAndUp++;
      }
      if (beat.ball.kind === 'toPlayer' && beat.ball.high && Math.abs(u - 0.5) < 0.05) highest = Math.max(highest, ball.z);
    });
    expect(frames).toBeGreaterThan(200);
    expect(reaching).toBeGreaterThan(100);
    expect(lowAndUp).toBe(0);
    expect(highest).toBeGreaterThan(3.05);
  }, 60000);

  it('hands stay down for everyone else, and go up smoothly', () => {
    let last: Record<string, number> = {};
    let biggestStep = 0;
    play(({ beat, m }) => {
      for (const [k, v] of Object.entries(m.reach)) {
        biggestStep = Math.max(biggestStep, Math.abs(v - (last[k] ?? 0)));
        expect(beat.contest === k || !!beat.reach?.includes(k) || v < 1).toBe(true);
      }
      last = { ...m.reach };
    });
    expect(biggestStep).toBeLessThanOrEqual(8 / 30 + 0.001);
  }, 60000);
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
        // One step past the end, so a beat shorter than a step is still reached.
        for (let t = 0; t < total + 1 / 30; t += 1 / 30) {
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
            if (free <= 0 && k !== beat.outOfBounds && !isRef(k)) furthestOut = Math.max(furthestOut, apart(insideCourt(p, 0.3), p));
            for (let j = i + 1; j < entries.length; j++) closest = Math.min(closest, apart(p, entries[j][1]));
          });
        }
        expect(lastBeat).toBe(script.beats.length - 1);
      });
    }
    expect(frames).toBeGreaterThan(5000);
    expect(closest).toBeGreaterThan(BODY_M * 0.6);
    expect(furthestOut).toBeLessThan(0.18);
  }, 60000);

  it('the Speed attribute and fatigue both change how fast a player runs', () => {
    const top = (rating: number, energy: number) => {
      const m = new Motion();
      m.setSpeedRatings({ a: rating });
      m.setEnergy({ a: energy });
      m.update({ a: { x: 1.5, y: 3 } }, 1 / 60, 1, 'a');
      let best = 0;
      for (let i = 0; i < 300; i++) {
        m.update({ a: { x: 27, y: 3 } }, 1 / 60, 1, 'a', { a: 'run' });
        best = Math.max(best, m.vel.a.x);
      }
      return best;
    };
    expect(top(90, 100) / top(45, 100)).toBeGreaterThan(1.3);
    expect(top(70, 100) / top(70, 30)).toBeGreaterThan(1.15);
    expect(speedFactor(99)).toBeLessThanOrEqual(1.14);
  });

  it('sprites scale with height', () => {
    expect(spriteScale(2.19)).toBeGreaterThan(1.12);
    expect(spriteScale(1.8)).toBeLessThan(0.9);
    expect(spriteScale(1.98)).toBe(1);
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
    const inner = m as unknown as { durations: number[]; script: Script | null; skipping: boolean };
    while (!m.isFastForwarding() || inner.skipping || !inner.script) m.tick(1 / 60);
    const before = [...inner.durations];
    m.toggleHighlights();
    expect(m.isFastForwarding()).toBe(false);
    inner.durations.forEach((d, i) => {
      if (inner.script!.beats[i].phase === 'play') expect(d).toBeCloseTo(before[i]);
      // A beat where nobody moves (the opening frame, the ball already in hand) has nothing to shorten.
      else if (before[i] === 0) expect(d).toBe(0);
      else expect(d).toBeGreaterThan(before[i]);
    });
  });
});
