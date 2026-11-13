// Man-to-man: when a defender leaves his man, and when he must not. Plays a whole match with both
// teams in man-to-man through the live controller and watches the half-court defence:
// - help and recover: two passes away he sinks into the paint; a drive past its man draws a helper
//   in front of it, and someone rotates to the man the helper left;
// - switching at screens: of a size, or late in the clock;
// - double teams leave a man open, and the next defender rotates to him;
// - elite shooters (80+ from three) are stayed with, never helped off;
// - one pass away, the defender denies: in the passing lane, a hand in it.
// The engine's results are not touched by any of this: it is how the defence looks.

import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../src/data/teams';
import { COURT, HALF_X, HOOP_X, MID_Y } from '../src/engine/court';
import { beatAt, isRef, type Script } from '../src/ui/court/animation';
import { DENY_M, ELITE_THREE } from '../src/ui/court/formations';
import type { Motion } from '../src/ui/court/motion';
import { LiveMatch } from '../src/ui/match/controller';

type P = { x: number; y: number };
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const DT = 1 / 30;

interface Watch {
  helps: number;
  rotations: number;
  helpOffShooter: number;
  switches: number;
  switchedMarking: number;
  doubles: number;
  doubleRotations: number;
  /** Off the ball in the half court: distance from defender to man, elite shooters and the rest. */
  eliteGap: number[];
  otherGap: number[];
  /** The same, with his man two passes away (where the others sink to help). */
  eliteFar: number[];
  otherFar: number[];
  /** One pass away: frames, frames with the defender nearer the ball than his man, and with a hand up. */
  denyFrames: number;
  denyInLane: number;
  denyHand: number;
  /** Two passes away: frames, and how much nearer the middle of the lane the defender is than his man. */
  helpSideFrames: number;
  helpSideSink: number;
}

function watch(seed: number, doubleOn?: string): Watch {
  const ham = { ...DEFAULT_PLANS.ham, defence: 'man' as const, ...(doubleOn ? { keyMatchup: { kind: 'double' as const, targetId: doubleOn } } : {}) };
  const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [ham, { ...DEFAULT_PLANS.sky, defence: 'man' }], seed, ['ai', 'ai'], 'normal');
  m.highlights = false;
  const inner = m as unknown as { script: Script | null; durations: number[]; t: number; motion: Motion };
  const elite = new Set([...HARBOR_HAMMERS.players.map((p) => ({ k: `0:${p.id}`, p })), ...SKYLINE_SPARKS.players.map((p) => ({ k: `1:${p.id}`, p }))].filter(({ p }) => p.attrs.three >= ELITE_THREE).map(({ k }) => k));
  const w: Watch = { helps: 0, rotations: 0, helpOffShooter: 0, switches: 0, switchedMarking: 0, doubles: 0, doubleRotations: 0, eliteGap: [], otherGap: [], eliteFar: [], otherFar: [], denyFrames: 0, denyInLane: 0, denyHand: 0, helpSideFrames: 0, helpSideSink: 0 };
  let lastHelp: object | null = null;
  let seen: Script | null = null;
  let lastBeat = -1;
  for (let i = 0; i < 400000 && m.phase !== 'final'; i++) {
    m.tick(DT);
    if (m.phase === 'timeout' || m.phase === 'break') m.resume();
    const sc = inner.script;
    const f = m.frame();
    if (!sc || !f) continue;
    const mo = inner.motion;
    const { index } = beatAt(sc, inner.durations, inner.t);
    const beat = sc.beats[index];
    if (sc !== seen) {
      seen = sc;
      lastBeat = -1;
    }
    if (index !== lastBeat) {
      lastBeat = index;
      if (beat.caption?.includes('switch')) {
        w.switches++;
        // The handler's defender and the screener's have traded men from here on.
        const before = sc.beats.slice(0, index).reverse().find((b) => b.marking)?.marking ?? {};
        const now = beat.marking ?? {};
        if (Object.keys(now).some((d) => before[d] && now[d] && before[d] !== now[d])) w.switchedMarking++;
      }
      if (beat.caption?.startsWith('They send two')) {
        w.doubles++;
        const target = beat.spotlight;
        const marked = new Set(Object.values(beat.marking ?? {}));
        // Everyone but the doubled man and those the two left are covered: someone took the open man.
        const others = Object.keys(beat.players).filter((k) => k.startsWith(`${sc.offence}:`) && k !== target);
        if (others.filter((k) => !marked.has(k)).length <= 1) w.doubleRotations++;
      }
    }
    if (mo.help && mo.help !== lastHelp) {
      lastHelp = mo.help;
      w.helps++;
      if (mo.help.rotator) w.rotations++;
      if (elite.has(mo.help.man)) w.helpOffShooter++;
    }
    // The half-court defence, as it stands, while someone holds the ball.
    const holder = m.holderKey();
    if (!holder || isRef(holder) || !holder.startsWith(`${sc.offence}:`) || beat.phase !== 'play' || beat.dead || !beat.marking) continue;
    const up = (q: P): P => (sc.dir === 1 ? q : { x: COURT.w - q.x, y: q.y });
    const ball = up(mo.pos[holder]);
    if (ball.x < HALF_X + 3) continue;
    for (const [d, man] of Object.entries(beat.marking)) {
      if (man === holder || !mo.pos[d] || !mo.pos[man] || mo.help?.helper === d || mo.help?.rotator === d) continue;
      const dp = up(mo.pos[d]);
      const mp = up(mo.pos[man]);
      const fromBall = dist(mp, ball);
      if (mp.x < HALF_X + 2) continue;
      (elite.has(man) ? w.eliteGap : w.otherGap).push(dist(dp, mp));
      if (fromBall > 9) (elite.has(man) ? w.eliteFar : w.otherFar).push(dist(dp, mp));
      if (fromBall < DENY_M && fromBall > 1.5 && !elite.has(man)) {
        w.denyFrames++;
        if (dist(dp, ball) < fromBall) w.denyInLane++;
        if ((f.reach?.[d] ?? 0) > 0.5) w.denyHand++;
      }
      if (fromBall > 12 && !elite.has(man) && mp.x < HOOP_X - 1) {
        w.helpSideFrames++;
        w.helpSideSink += Math.abs(mp.y - MID_Y) - Math.abs(dp.y - MID_Y) + (dp.x - mp.x) * 0.5;
      }
    }
  }
  expect(m.phase).toBe('final');
  return w;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

describe('man-to-man: when to leave your man, and when to stay', () => {
  let w: Watch;
  const get = () => (w ??= watch(5));

  it('help and recover: a drive past its man draws a helper in front, and someone rotates to the man he left', () => {
    const r = get();
    console.log(JSON.stringify({ helps: r.helps, rotations: r.rotations, helpSideFrames: r.helpSideFrames, helpSideSink: +(r.helpSideSink / Math.max(1, r.helpSideFrames)).toFixed(2) }));
    expect(r.helps).toBeGreaterThan(5);
    expect(r.rotations / r.helps).toBeGreaterThan(0.8);
    // Two passes away the defender is well into the paint side of his man: the pack line.
    expect(r.helpSideFrames).toBeGreaterThan(300);
    expect(r.helpSideSink / r.helpSideFrames).toBeGreaterThan(1.2);
  }, 300000);

  it('elite shooters are stayed with: tight off the ball, and never the man left to help', () => {
    const r = get();
    console.log(JSON.stringify({ eliteGap: +avg(r.eliteGap).toFixed(2), otherGap: +avg(r.otherGap).toFixed(2), eliteFar: +avg(r.eliteFar).toFixed(2), otherFar: +avg(r.otherFar).toFixed(2), helpOffShooter: r.helpOffShooter }));
    expect(r.eliteGap.length).toBeGreaterThan(300);
    expect(avg(r.eliteGap)).toBeLessThan(1.8);
    // Two passes away the others sink to help; the man on an elite shooter stays with him.
    expect(r.eliteFar.length).toBeGreaterThan(100);
    expect(avg(r.eliteFar)).toBeLessThan(2);
    expect(avg(r.otherFar) - avg(r.eliteFar)).toBeGreaterThan(1.5);
    expect(r.helpOffShooter).toBe(0);
  }, 300000);

  it('one pass away the defender denies: in the passing lane, a hand in it', () => {
    const r = get();
    console.log(JSON.stringify({ denyFrames: r.denyFrames, inLane: +(r.denyInLane / r.denyFrames).toFixed(2), hand: +(r.denyHand / r.denyFrames).toFixed(2) }));
    expect(r.denyFrames).toBeGreaterThan(300);
    expect(r.denyInLane / r.denyFrames).toBeGreaterThan(0.6);
    expect(r.denyHand / r.denyFrames).toBeGreaterThan(0.5);
  }, 300000);

  it('switches at screens trade the two men', () => {
    const r = get();
    console.log(JSON.stringify({ switches: r.switches, switchedMarking: r.switchedMarking }));
    expect(r.switches).toBeGreaterThan(2);
    expect(r.switchedMarking).toBe(r.switches);
  }, 300000);

  it('a double team leaves a man open, and the next defender rotates to him', () => {
    // The Hammers send two at the Sparks' best shooter whenever he has it.
    const r = watch(5, 'sky-11');
    console.log(JSON.stringify({ doubles: r.doubles, doubleRotations: r.doubleRotations }));
    expect(r.doubles).toBeGreaterThan(3);
    expect(r.doubleRotations).toBe(r.doubles);
  }, 300000);
});
