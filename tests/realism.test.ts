// Plays a whole match frame by frame through the live controller and checks that players and the
// ball move the way basketball players do: no spinning, defenders on their man, no running
// backwards at full speed, no robotic group starts, nobody frozen; at dead balls everyone stands still,
// the clock stops and the ball is carried, never teleported. Thresholds are set from what real
// players do, with headroom; the numbers before these fixes are in the comments.

import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../src/data/teams';
import { beatAt, isRef, type Script } from '../src/ui/court/animation';
import { angleDiff, type Motion } from '../src/ui/court/motion';
import { project } from '../src/ui/court/render';
import { LiveMatch } from '../src/ui/match/controller';

type P = { x: number; y: number };
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const deg = (r: number) => (r * 180) / Math.PI;
const DT = 1 / 30;

function measure(seed: number) {
  const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], seed, ['ai', 'ai'], 'normal');
  m.highlights = false;
  const inner = m as unknown as { script: Script | null; durations: number[]; t: number; motion: Motion };
  const r = {
    playerSeconds: 0,
    bigTurns: 0,
    onBall: 0,
    onBallFar: 0,
    onBallWrongSide: 0,
    sideFlips: 0,
    walkingFlips: 0,
    possessions: 0,
    dribble: 0,
    ballHidden: 0,
    fastBackwards: 0,
    fastSideways: 0,
    maxSpeed: 0,
    beats: 0,
    groupStarts: 0,
    still: 0,
    playerFrames: 0,
    liveFrames: 0,
    spins: 0,
    laneWaits: 0,
    teleports: 0,
    ftFrames: 0,
    ftMoving: 0,
    deadClockTicks: 0,
  };
  let prevBall: { x: number; y: number } | null = null;
  let prevClock = 0;
  let prevBeat: object | null = null;
  const spun: Record<string, { t: number; turn: number }[]> = {};
  const prevFace: Record<string, number> = {};
  const lastSpin: Record<string, number> = {};
  let openSince = -1;
  const turns: Record<string, { f: number; t: number }[]> = {};
  const lastBig: Record<string, number> = {};
  const goalSide: Record<string, boolean> = {};
  const started: Record<string, number> = {};
  /** Whether each player has stood still this beat: only a start from standing counts as setting off. */
  const rested: Record<string, boolean> = {};
  let time = 0;
  let lastScript: Script | null = null;
  let lastBeat = -1;
  for (let i = 0; i < 400000 && m.phase !== 'final'; i++) {
    m.tick(DT);
    time += DT;
    m.drainFx();
    if (m.phase === 'timeout' || m.phase === 'break') {
      m.resume();
      prevBall = null;
      continue;
    }
    const sc = inner.script;
    if (!sc) continue;
    if (sc !== lastScript) {
      lastScript = sc;
      lastBeat = -1;
      r.possessions++;
      for (const k of Object.keys(goalSide)) delete goalSide[k];
    }
    const { index } = beatAt(sc, inner.durations, inner.t);
    const beat: Script["beats"][number] = sc.beats[index];
    const mo = inner.motion;
    const f = m.frame();
    if (!f) continue;
    // The ball never jumps: the fastest pass covers 0.33 m a frame, so 1.5 m is a teleport.
    if (prevBall && dist(f.ball, prevBall) > 1.5) r.teleports++;
    prevBall = { ...f.ball };
    // A dead ball stops the clock.
    if (beat.dead && beat === prevBeat && m.clock !== prevClock) r.deadClockTicks++;
    prevBeat = beat;
    prevClock = m.clock;
    // The free-throw routine, from the official's bounce pass until the ball is up: only the shooter moves.
    const ftAt = sc.beats.findIndex((b) => b.caption?.includes('to the line'));
    const a = beat.ball;
    const shooter = !beat.dead || ftAt < 0 || index <= ftAt ? null : a.kind === 'pass' && isRef(a.from) ? a.to : a.kind === 'held' && !isRef(a.holder) ? a.holder : a.kind === 'fromPlayer' && a.style === 'set' ? a.from : null;
    if (shooter) {
      for (const k of Object.keys(mo.pos)) {
        if (k === shooter || isRef(k)) continue;
        r.ftFrames++;
        if (Math.hypot(mo.vel[k].x, mo.vel[k].y) > 0.3) r.ftMoving++;
      }
    }
    if (index !== lastBeat) {
      // Did six or more players set off within 0.1 s of each other in the beat just finished?
      if (lastBeat >= 0) {
        const starts = Object.values(started)
          .filter((t) => t >= 0)
          .sort((a, b) => a - b);
        for (let s = 0; s + 5 < starts.length; s++) {
          if (starts[s + 5] - starts[s] <= 0.1) {
            r.groupStarts++;
            break;
          }
        }
      }
      r.beats++;
      lastBeat = index;
      for (const k of Object.keys(mo.pos)) {
        started[k] = -1;
        rested[k] = false;
      }
    }
    const holder: string | null = beat.ball.kind === 'held' ? beat.ball.holder : null;
    // At the free-throw line everyone stands still by rule: those possessions are not counted for that.
    const freeThrows = sc.beats.some((b) => b.caption?.includes('to the line'));
    for (const [k] of Object.entries(mo.pos)) {
      if (isRef(k)) continue;
      const v = mo.vel[k];
      const speed = Math.hypot(v.x, v.y);
      const live = !freeThrows && !beat.dead;
      r.playerFrames++;
      if (live) r.liveFrames++;
      r.playerSeconds += DT;
      r.maxSpeed = Math.max(r.maxSpeed, speed);
      if (speed < 0.5 && live) r.still++;
      if (speed < 0.5) rested[k] = true;
      if (speed > 1 && rested[k] && started[k] === -1) started[k] = time;
      const face = mo.facing[k];
      if (face === undefined) continue;
      // Spinning round: more than 300 degrees one way within 1.5 s.
      const sp = (spun[k] ??= []);
      sp.push({ t: time, turn: prevFace[k] === undefined ? 0 : angleDiff(prevFace[k], face) });
      prevFace[k] = face;
      while (sp.length && time - sp[0].t > 1.5) sp.shift();
      if (Math.abs(sp.reduce((s, e) => s + e.turn, 0)) > (300 * Math.PI) / 180 && time - (lastSpin[k] ?? -9) > 2) {
        r.spins++;
        lastSpin[k] = time;
      }
      const h = (turns[k] ??= []);
      h.push({ f: face, t: time });
      while (h.length && time - h[0].t > 0.6) h.shift();
      if (Math.abs(deg(angleDiff(h[0].f, face))) > 120 && time - (lastBig[k] ?? -9) > 1) {
        r.bigTurns++;
        lastBig[k] = time;
      }
      if (speed > 3.6) {
        const off = Math.abs(deg(angleDiff(face, Math.atan2(v.y, v.x))));
        if (off > 120) r.fastBackwards++;
        else if (off > 60 && speed > 4.5) r.fastSideways++;
      }
    }
    // The on-ball defender, man-to-man, during the half-court action.
    if (beat.phase === 'play' && beat.ball.kind === 'held' && holder && mo.pos[holder]) {
      const d = Object.keys(sc.guards).find((k) => sc.guards[k] === holder);
      if (d && mo.pos[d] && beat.marking?.[d]) {
        const hp = mo.pos[holder];
        const dp = mo.pos[d];
        const hoop = holder.startsWith(`${sc.offence}:`) === (sc.dir === 1) ? { x: 26.425, y: 7.5 } : { x: 1.575, y: 7.5 };
        const ang = Math.abs(deg(angleDiff(Math.atan2(hoop.y - hp.y, hoop.x - hp.x), Math.atan2(dp.y - hp.y, dp.x - hp.x))));
        const gs = dist(dp, hoop) < dist(hp, hoop) && ang < 70;
        r.onBall++;
        if (dist(dp, hp) > 2.5) r.onBallFar++;
        if (!gs && dist(hp, hoop) < 9) r.onBallWrongSide++;
        const moving = Math.hypot(mo.vel[d].x, mo.vel[d].y) > 1 && Math.hypot(mo.vel[holder].x, mo.vel[holder].y) > 1;
        if (goalSide[d] !== undefined && goalSide[d] !== gs && moving && dist(dp, hp) < 2.5) {
          r.sideFlips++;
          // At walking pace: nobody is being beaten, they are just strolling past each other.
          if (Math.hypot(mo.vel[holder].x, mo.vel[holder].y) < 2.5) r.walkingFlips++;
        }
        goalSide[d] = gs;
      }
    }
    // An open lane: the handler within 9 m of the rim with nobody in a 1.2 m corridor to it or within
    // arm's reach, and not going for it, for more than 0.6 s. Free throws are left out: the lane is cleared by the rules.
    const live = m.holderKey();
    if (live && mo.pos[live] && beat.ball.kind === 'held' && !sc.beats.some((b) => b.caption?.includes('to the line'))) {
      const p = mo.pos[live];
      const hoop = live.startsWith(`${sc.offence}:`) === (sc.dir === 1) ? { x: 26.425, y: 7.5 } : { x: 1.575, y: 7.5 };
      const d = dist(p, hoop);
      const dx = hoop.x - p.x;
      const dy = hoop.y - p.y;
      const blocked = Object.keys(mo.pos).some((o) => {
        if (o.slice(0, 2) === live.slice(0, 2)) return false;
        const q = mo.pos[o];
        const t = ((q.x - p.x) * dx + (q.y - p.y) * dy) / (dx * dx + dy * dy || 1);
        // In the way, or close enough to reach him: either way the lane is not his to take.
        return (t > 0 && t < 1.05 && Math.hypot(p.x + dx * t - q.x, p.y + dy * t - q.y) < 1.2) || dist(p, q) < 1.5;
      });
      const v = mo.vel[live];
      const going = d > 0 ? (v.x * dx + v.y * dy) / d : 0;
      // Backing down in the post is going at the rim, just slowly.
      const open = d < 9 && !blocked && going < 1.5 && beat.posting !== live;
      if (open && openSince < 0) openSince = time;
      if (!open) openSince = -1;
      if (open && openSince >= 0 && time - openSince > 0.6) {
        r.laneWaits++;
        openSince = -1;
      }
    } else openSince = -1;
    // The dribble, as the camera sees it: the ball hidden behind the handler's body.
    if (holder && mo.pos[holder] && beat.ball.kind === 'held' && beat.ball.dribble) {
      const hp = mo.pos[holder];
      r.dribble++;
      const behind = f.ball.y - f.ball.x < hp.y - hp.x - 0.05;
      const sideways = Math.abs(project(f.ball.x, f.ball.y).x - project(hp.x, hp.y).x);
      if (behind && sideways < 6) r.ballHidden++;
    }
  }
  return r;
}

describe('movement realism', () => {
  it('a whole match moves like basketball', () => {
    const r = measure(3);
    const playerMinutes = r.playerSeconds / 60;
    console.log(JSON.stringify({
      sharpTurnsPerPlayerMinute: +(r.bigTurns / playerMinutes).toFixed(2),
      onBallFar: +(r.onBallFar / r.onBall).toFixed(3),
      onBallWrongSide: +(r.onBallWrongSide / r.onBall).toFixed(3),
      sideFlipsPerPossession: +(r.sideFlips / r.possessions).toFixed(2),
      walkingFlipsPerPossession: +(r.walkingFlips / r.possessions).toFixed(2),
      ballHidden: +(r.ballHidden / r.dribble).toFixed(3),
      fastBackwards: +(r.fastBackwards / r.playerFrames).toFixed(4),
      fastSideways: +(r.fastSideways / r.playerFrames).toFixed(4),
      maxSpeed: +r.maxSpeed.toFixed(2),
      groupStarts: +(r.groupStarts / r.beats).toFixed(3),
      still: +(r.still / r.liveFrames).toFixed(3),
      spinsPerPossession: +(r.spins / r.possessions).toFixed(3),
      laneWaitsPerPossession: +(r.laneWaits / r.possessions).toFixed(3),
      teleportsPerPossession: +(r.teleports / r.possessions).toFixed(3),
      freeThrowMoving: +(r.ftMoving / r.ftFrames).toFixed(3),
      deadClockTicks: r.deadClockTicks,
    }));
    // Sharp turns (over 120 degrees in 0.6 s): was 10.5 a minute per player.
    expect(r.bigTurns / playerMinutes).toBeLessThan(3);
    // The on-ball defender: within 2.5 m (was off 16% of the time) and goal-side (was wrong 12%).
    expect(r.onBall).toBeGreaterThan(1000);
    expect(r.onBallFar / r.onBall).toBeLessThan(0.06);
    expect(r.onBallWrongSide / r.onBall).toBeLessThan(0.06);
    // Defender and attacker trading sides as they walk past each other: was part of 1.2 a possession.
    // Getting beaten on a drive and recovering is basketball; that is the rest of the allowance.
    expect(r.walkingFlips / r.possessions).toBeLessThan(0.1);
    expect(r.sideFlips / r.possessions).toBeLessThan(0.5);
    // The dribbled ball hidden behind the body. Some of this is real: in profile, a dribble in the
    // far hand is out of sight. Before, it was hidden half the time, with the arm drawn over the back.
    expect(r.ballHidden / r.dribble).toBeLessThan(0.25);
    // Nobody runs backwards or sideways at speed, or faster than a sprinter.
    expect(r.fastBackwards / r.playerFrames).toBeLessThan(0.003);
    expect(r.fastSideways / r.playerFrames).toBeLessThan(0.003);
    expect(r.maxSpeed).toBeLessThan(8.1);
    // Six or more players setting off from standing within 0.1 s of each other.
    expect(r.groupStarts / r.beats).toBeLessThan(0.12);
    // Spinning round and round: was 0.8 a possession.
    expect(r.spins / r.possessions).toBeLessThan(0.05);
    // A ball handler standing still with an open lane to the rim, free throws aside: was about 0.1 a
    // possession (counted then without the arm's-reach rule, so if anything a little higher).
    expect(r.laneWaits / r.possessions).toBeLessThan(0.03);
    // Standing dead still, outside free throws: was half of all player time.
    expect(r.still / r.liveFrames).toBeLessThan(0.4);
    // The ball jumping across the floor: was 0.65 a possession, mostly from the net into the inbounder's hands.
    expect(r.teleports / r.possessions).toBeLessThan(0.1);
    // Anyone but the shooter moving during the free-throw routine: was 77% of the time.
    expect(r.ftFrames).toBeGreaterThan(5000);
    expect(r.ftMoving / r.ftFrames).toBeLessThan(0.06);
    expect(r.deadClockTicks).toBe(0);
  }, 180000);
});
