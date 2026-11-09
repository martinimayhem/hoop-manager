// The NBA court and its shot zones: the geometry, the engine's shots, and where the match view
// draws them. The engine decides where a shot is taken; the box score, the commentary and the court
// must agree on it, two points or three.

import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../src/data/teams';
import {
  COURT,
  CORNER_THREE_FROM_SIDELINE,
  HOOP_X,
  MID_Y,
  THREE_ARC_M,
  ZONES,
  distToHoop,
  isThree,
  spotInZone,
  zoneOf,
  zonePoints,
  zoneSides,
} from '../src/engine/court';
import { createMatch, stepPossession } from '../src/engine/match';
import { other, playerOf } from '../src/engine/state';
import type { TimedEvent } from '../src/engine/types';
import { buildScript, playerKey, type Frame } from '../src/ui/court/animation';

describe('the court', () => {
  it('is NBA size, with the three-point line 23 ft 9 in out and 22 ft in the corners', () => {
    expect(COURT).toEqual({ w: 28.65, h: 15.24 });
    expect(COURT.w - HOOP_X).toBeCloseTo(1.6, 5);
    expect(isThree({ x: HOOP_X - THREE_ARC_M - 0.05, y: MID_Y })).toBe(true);
    expect(isThree({ x: HOOP_X - THREE_ARC_M + 0.05, y: MID_Y })).toBe(false);
    // In the corner, 3 ft in from the sideline: about 22 ft from the rim.
    const corner = { x: HOOP_X, y: CORNER_THREE_FROM_SIDELINE - 0.05 };
    expect(isThree(corner)).toBe(true);
    expect(distToHoop({ x: HOOP_X, y: CORNER_THREE_FROM_SIDELINE })).toBeCloseTo(6.71, 2);
    expect(isThree({ x: HOOP_X, y: CORNER_THREE_FROM_SIDELINE + 0.05 })).toBe(false);
  });

  it('every spot drawn for a zone lies in that zone, on the court', () => {
    for (const zone of ZONES) {
      for (const side of zoneSides(zone)) {
        for (let u = 0; u <= 1; u += 0.1) {
          for (let v = 0; v <= 1; v += 0.1) {
            const p = spotInZone(zone, side, u, v);
            expect(zoneOf(p), `${zone} ${side} u=${u.toFixed(1)} v=${v.toFixed(1)}`).toBe(zone);
            expect(p.x).toBeGreaterThan(0.45);
            expect(p.x).toBeLessThan(COURT.w - 0.45);
            expect(p.y).toBeGreaterThan(0.2);
            expect(p.y).toBeLessThan(COURT.h - 0.2);
          }
        }
      }
    }
  });
});

describe('shots on the court', () => {
  it('the zone decides the points, and the court draws the shot going up inside its zone', () => {
    let shots = 0;
    let outOfZone = 0;
    let wrongSideOfLine = 0;
    const seen = new Set<string>();
    for (const seed of [1, 2, 3]) {
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
          { offence, quarter: s.quarter, lineups, focus: s.teams[offence].plan.offence, defence: s.teams[other(offence)].plan.defence, keyMatchup: s.teams[other(offence)].plan.keyMatchup, clockStart, clockEnd: s.clock, start: how, name: (sd, id) => playerOf(s, sd, id).name },
          events,
          prev,
        );
        events.forEach((ev: TimedEvent, i) => {
          if (ev.type !== 'shot') return;
          shots++;
          seen.add(ev.zone);
          expect(ev.points).toBe(zonePoints(ev.zone));
          const beat = script.beats.find((b) => b.fire.includes(i));
          if (!beat || beat.ball.kind !== 'fromPlayer') return;
          const abs = beat.players[playerKey(ev.side, ev.shooterId)];
          const p = script.dir === 1 ? abs : { x: COURT.w - abs.x, y: abs.y };
          if (zoneOf(p) !== ev.zone) outOfZone++;
          if (isThree(p) !== (ev.points === 3)) wrongSideOfLine++;
        });
        const last = script.beats[script.beats.length - 1];
        prev = { players: last.players, ball: { x: COURT.w / 2, y: MID_Y, z: 0.9 } };
      }
    }
    expect(shots).toBeGreaterThan(400);
    expect([...seen].sort()).toEqual([...ZONES].sort());
    // Two or three is never in doubt; a shooter nudged a little by a teammate may stray across a zone line inside the arc.
    expect(wrongSideOfLine).toBe(0);
    expect(outOfZone / shots).toBeLessThan(0.03);
  }, 60000);
});
