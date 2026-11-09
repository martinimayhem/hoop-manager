// Bringing the ball up, as the camera sees it: plays a whole match at each tempo through the live
// controller and watches the ball handler. After a defensive rebound the ball is over half court in
// one go, sooner at a faster tempo and never near the eight seconds; nobody parks in the backcourt or
// on the half-court line; and in live play nobody stands with the ball for long.

import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../src/data/teams';
import { COURT, HALF_X } from '../src/engine/court';
import type { Tempo } from '../src/engine/types';
import { beatAt, isRef, type Script } from '../src/ui/court/animation';
import { LiveMatch } from '../src/ui/match/controller';
import type { Motion } from '../src/ui/court/motion';

const DT = 1 / 30;
/** Slower than this (m/s) is standing. */
const STILL_M_S = 0.3;

interface Watch {
  /** Seconds on the game clock from a defensive rebound to the ball crossing half court. */
  crossings: number[];
  /** The longest anyone stood still with the ball bringing it up or setting up (real seconds). */
  longestBringUp: number;
  /** The same in the half-court play. */
  longestPlay: number;
  /** Stands of 0.5 s or more in the backcourt or on the half-court line, besides a rebounder chinning it. */
  backcourtStops: number;
}

function play(tempo: Tempo, seed: number): Watch {
  const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [{ ...DEFAULT_PLANS.ham, tempo }, { ...DEFAULT_PLANS.sky, tempo }], seed, ['ai', 'ai'], 'normal');
  m.highlights = false;
  const inner = m as unknown as { script: Script | null; durations: number[]; t: number; motion: Motion; s: { transition: string }; lastFrame: { ball: { x: number } } | null };
  const watch: Watch = { crossings: [], longestBringUp: 0, longestPlay: 0, backcourtStops: 0 };
  let seen: Script | null = null;
  let next = 'none';
  let start = 'none';
  let crossed = false;
  let time = 0;
  let still = { key: '', since: -1, counted: false, chin: false };
  for (let i = 0; i < 400000 && m.phase !== 'final'; i++) {
    if (!inner.script) next = inner.s.transition;
    m.tick(DT);
    m.drainFx();
    time += DT;
    if (m.phase === 'timeout' || m.phase === 'break') m.resume();
    const sc = inner.script;
    if (!sc) continue;
    if (sc !== seen) {
      seen = sc;
      start = next;
      crossed = false;
      still.key = '';
    }
    const { index } = beatAt(sc, inner.durations, inner.t);
    const beat = sc.beats[index];
    const upFloor = (x: number) => (sc.dir === 1 ? x : COURT.w - x);
    const ball = inner.lastFrame?.ball;
    if (start === 'rebound' && !crossed && ball && upFloor(ball.x) > HALF_X) {
      crossed = true;
      watch.crossings.push(sc.clockStart - m.clock);
    }
    const h = m.holderKey();
    const mo = inner.motion;
    // Live ball with an attacker: not a throw-in, a free throw, or a big backing down against his man.
    if (!h || isRef(h) || !h.startsWith(`${sc.offence}:`) || beat.dead || beat.outOfBounds === h || beat.posting === h || !mo.pos[h]) {
      still.key = '';
      continue;
    }
    const v = mo.vel[h];
    if (Math.hypot(v.x, v.y) >= STILL_M_S || still.key !== h) {
      // A rebounder chins it first, before he turns to outlet it.
      still = { key: Math.hypot(v.x, v.y) < STILL_M_S ? h : '', since: time, counted: false, chin: index === 0 && beat.ball.kind === 'held' && !beat.ball.dribble };
      continue;
    }
    // At the end of a quarter, holding for the last shot is the point.
    if (sc.clockStart > 24 && beat.phase === 'play') watch.longestPlay = Math.max(watch.longestPlay, time - still.since);
    else if (sc.clockStart > 24 && !still.chin) watch.longestBringUp = Math.max(watch.longestBringUp, time - still.since);
    if (!still.counted && !still.chin && time - still.since >= 0.5 && upFloor(mo.pos[h].x) < HALF_X + 2 && !(m.caption?.text ?? '').includes('trapped')) {
      still.counted = true;
      watch.backcourtStops++;
    }
  }
  expect(m.phase).toBe('final');
  return watch;
}

const average = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('bringing the ball up', () => {
  it('over half court in one go, quicker at a faster tempo; nobody parks or stands with the ball', () => {
    const slow = play('slow', 21);
    const normal = play('normal', 21);
    const fast = play('fast', 21);
    console.log(JSON.stringify(Object.fromEntries(Object.entries({ slow, normal, fast }).map(([k, w]) => [k, { over: average(w.crossings).toFixed(1), max: Math.max(...w.crossings).toFixed(1), longestBringUp: w.longestBringUp.toFixed(1), longestPlay: w.longestPlay.toFixed(1), backcourtStops: w.backcourtStops }]))));
    // On the clock it was 2.3-3.5 s whatever the tempo, then a stop of up to 6 s just past half court.
    expect(average(slow.crossings)).toBeGreaterThan(4.2);
    expect(average(slow.crossings)).toBeLessThan(6.5);
    expect(average(normal.crossings)).toBeGreaterThan(2.6);
    expect(average(normal.crossings)).toBeLessThan(4.5);
    expect(average(fast.crossings)).toBeLessThan(average(normal.crossings));
    for (const w of [slow, normal, fast]) {
      expect(Math.max(...w.crossings)).toBeLessThan(8);
      // Bringing it up and setting up he keeps moving: it was over 6 s.
      expect(w.longestBringUp).toBeLessThan(1.2);
      // In the half court, a driver stopped near the basket can still wait on a teammate a little.
      expect(w.longestPlay).toBeLessThan(3.5);
      // It was about 150 a match.
      expect(w.backcourtStops).toBeLessThanOrEqual(1);
    }
  }, 300000);
});
