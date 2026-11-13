// Plays a whole match frame by frame through the live controller and checks that players and the
// ball move the way basketball players do: no spinning, defenders on their man, no running
// backwards at full speed, no robotic group starts, nobody frozen; at dead balls everyone stands still,
// the clock stops and the ball is carried, never teleported. Thresholds are set from what real
// players do, with headroom; the numbers before these fixes are in the comments.

import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../src/data/teams';
import { makePlan } from '../src/engine/match';
import type { TimedEvent } from '../src/engine/types';
import { COURT, HOOP_X, MID_Y } from '../src/engine/court';
import { beatAt, isRef, type Script } from '../src/ui/court/animation';
import { BODY_M } from '../src/ui/court/formations';
import { SHOTS, angleDiff, type Motion } from '../src/ui/court/motion';
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
      // His defender as of this beat: it changes on a switch.
      const d = Object.keys(beat.marking ?? {}).find((k) => beat.marking![k] === holder);
      if (d && mo.pos[d]) {
        const hp = mo.pos[holder];
        const dp = mo.pos[d];
        const hoop = holder.startsWith(`${sc.offence}:`) === (sc.dir === 1) ? { x: HOOP_X, y: MID_Y } : { x: COURT.w - HOOP_X, y: MID_Y };
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
      const hoop = live.startsWith(`${sc.offence}:`) === (sc.dir === 1) ? { x: HOOP_X, y: MID_Y } : { x: COURT.w - HOOP_X, y: MID_Y };
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
    // Help and recover and switches add some honest changes of direction: up to 3.2.
    expect(r.bigTurns / playerMinutes).toBeLessThan(3.2);
    // The on-ball defender: within 2.5 m (was off 16% of the time) and goal-side (was wrong 12%).
    expect(r.onBall).toBeGreaterThan(1000);
    // Since help and recover: a skip pass to a man whose defender sank to help is open for the step
    // it takes to close out, and a switch hands the ball to a defender a step away. So 9%, not 6%.
    expect(r.onBallFar / r.onBall).toBeLessThan(0.09);
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

// ---------------------------------------------------------------------------
// Bodies: attackers and defenders never overlap, and on a break with nobody back no defender runs
// back through the ball handler. (Before the fix, a fast break shown after skipped play started
// with the whole defence standing in the lane, and in about one open-lane break in six a defender
// ran back to a trailing spot straight through the handler, shoulder to shoulder at 0.78 m.)

interface BodyWatch {
  frames: number;
  /** Closest an attacker and a defender ever came (m). */
  closest: number;
  /** Open-lane breaks watched, and the defenders who went from in front of the handler to behind him through his line. */
  openBreaks: number;
  crossings: string[];
}

function watchBodies(seed: number, highlights: boolean): BodyWatch {
  const plans = [makePlan(HARBOR_HAMMERS, { offence: 'fastBreak', defence: 'man', tempo: 'fast' }), makePlan(SKYLINE_SPARKS, { offence: 'balanced', defence: 'zone', tempo: 'fast' })] as const;
  const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [plans[0], plans[1]], seed, ['ai', 'ai'], 'normal');
  m.highlights = highlights;
  const inner = m as unknown as { script: Script | null; scriptEvents: TimedEvent[]; durations: number[]; t: number; motion: Motion };
  const w: BodyWatch = { frames: 0, closest: Infinity, openBreaks: 0, crossings: [] };
  let seen: Script | null = null;
  // The open-lane break being watched: its handler, the rim, and for each defender how far ahead
  // of the handler (along his line to the rim) he is now and has been at most.
  let brk: { handler: string; rim: P; ahead: Record<string, { now: number; most: number }> } | null = null;
  for (let i = 0; i < 2_000_000 && m.phase !== 'final'; i++) {
    m.tick(DT);
    if (m.phase === 'timeout' || m.phase === 'break') m.resume();
    const sc = inner.script;
    if (!sc) continue;
    if (sc !== seen) {
      seen = sc;
      brk = null;
      const evs = inner.scriptEvents;
      const tr = evs.find((e) => e.type === 'transition');
      const fb = evs.find((e) => e.type === 'fastBreak');
      if (tr?.type === 'transition' && tr.attack && tr.situation === 'lane' && fb?.type === 'fastBreak' && !evs.some((e) => e.type === 'transitionRead')) {
        w.openBreaks++;
        brk = { handler: `${sc.offence}:${fb.leaderId}`, rim: sc.dir === 1 ? { x: HOOP_X, y: MID_Y } : { x: COURT.w - HOOP_X, y: MID_Y }, ahead: {} };
      }
    }
    const pos = inner.motion.pos;
    const players = Object.keys(pos).filter((k) => !isRef(k));
    const attackers = players.filter((k) => k.startsWith(`${sc.offence}:`));
    const defenders = players.filter((k) => !k.startsWith(`${sc.offence}:`));
    w.frames++;
    for (const a of attackers) for (const d of defenders) w.closest = Math.min(w.closest, dist(pos[a], pos[d]));
    // Once the shot is up the break is over: what follows is a rebound, not a run at the rim.
    if (brk && sc.beats[beatAt(sc, inner.durations, inner.t).index].ball.kind === 'fromPlayer') brk = null;
    const h = brk && pos[brk.handler];
    if (!brk || !h) continue;
    const len = dist(h, brk.rim);
    if (len < 1.5) continue;
    const ux = (brk.rim.x - h.x) / len;
    const uy = (brk.rim.y - h.y) / len;
    for (const d of defenders) {
      const s = (pos[d].x - h.x) * ux + (pos[d].y - h.y) * uy;
      const lat = Math.abs(-(pos[d].x - h.x) * uy + (pos[d].y - h.y) * ux);
      const a = (brk.ahead[d] ??= { now: s, most: s });
      // Clearly between him and the rim at some point, and now level or behind him, having come
      // back across his line rather than round it.
      if (a.most > BODY_M && a.now > 0 && s <= 0 && lat < BODY_M + 0.05) {
        const bi = beatAt(sc, inner.durations, inner.t).index;
        w.crossings.push(`seed ${seed} ${brk.handler} passed through by ${d}, ${lat.toFixed(2)} m off his line (q${sc.quarter} ${m.clock.toFixed(1)}s, beat ${bi} ${sc.beats[bi].ball.kind}${sc.beats[bi].chase?.[d] ? ', chasing' : ''})`);
      }
      a.now = s;
      a.most = Math.max(a.most, s);
    }
  }
  expect(m.phase).toBe('final');
  return w;
}

describe('bodies', () => {
  for (const highlights of [false, true]) {
    it(`attackers and defenders never overlap, and nobody runs back through an open break (highlights ${highlights ? 'on' : 'off'})`, () => {
      const seeds = highlights ? [1, 2, 3, 4, 5, 6] : [1, 2];
      const all = seeds.map((seed) => watchBodies(seed, highlights));
      const frames = all.reduce((n, w) => n + w.frames, 0);
      const breaks = all.reduce((n, w) => n + w.openBreaks, 0);
      expect(frames).toBeGreaterThan(highlights ? 5000 : 50000);
      expect(breaks).toBeGreaterThan(highlights ? 8 : 15);
      // One body width: shoulders touch, never more. (A hair less for rounding at the sidelines.)
      for (const w of all) expect(w.closest).toBeGreaterThanOrEqual(BODY_M - 0.02);
      expect(all.flatMap((w) => w.crossings)).toEqual([]);
    }, 600000);
  }
});

describe('getting back', () => {
  it('on a break with nobody back, every defender still runs back: none stays at the other end', () => {
    let breaks = 0;
    const stayed: string[] = [];
    for (const [seed, highlights] of [[1, true], [2, true], [1, false]] as const) {
      const plans = [makePlan(HARBOR_HAMMERS, { offence: 'fastBreak', tempo: 'fast' }), makePlan(SKYLINE_SPARKS, { offence: 'balanced', defence: 'zone', tempo: 'fast' })] as const;
      const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [plans[0], plans[1]], seed, ['ai', 'ai'], 'normal');
      m.highlights = highlights;
      const inner = m as unknown as { script: Script | null; scriptEvents: TimedEvent[]; durations: number[]; t: number; motion: Motion };
      let seen: Script | null = null;
      let watch: { rim: P; start: Record<string, P>; end: Record<string, P> | null } | null = null;
      const done = () => {
        if (!watch?.end) return;
        breaks++;
        for (const [k, p] of Object.entries(watch.start)) {
          const q = watch.end[k];
          if (q && dist(p, watch.rim) > 12 && dist(p, watch.rim) - dist(q, watch.rim) < 4) stayed.push(`seed ${seed}: ${k}`);
        }
      };
      for (let i = 0; i < 2_000_000 && m.phase !== 'final'; i++) {
        m.tick(DT);
        if (m.phase === 'timeout' || m.phase === 'break') m.resume();
        const sc = inner.script;
        if (sc !== seen) {
          done();
          watch = null;
          seen = sc;
          const tr = sc && inner.scriptEvents.find((e) => e.type === 'transition');
          if (sc && tr?.type === 'transition' && tr.attack && tr.situation === 'lane' && inner.scriptEvents.some((e) => e.type === 'fastBreak')) {
            const def = sc.offence === 0 ? '1:' : '0:';
            const start = Object.fromEntries(Object.entries(inner.motion.pos).filter(([k]) => k.startsWith(def)).map(([k, p]) => [k, { ...p }]));
            watch = { rim: sc.dir === 1 ? { x: HOOP_X, y: MID_Y } : { x: COURT.w - HOOP_X, y: MID_Y }, start, end: null };
          }
        }
        // Where they are as the shot goes up.
        if (watch && sc && !watch.end && sc.beats[beatAt(sc, inner.durations, inner.t).index].ball.kind === 'fromPlayer') {
          watch.end = Object.fromEntries(Object.entries(inner.motion.pos).map(([k, p]) => [k, { ...p }]));
        }
      }
      done();
    }
    expect(breaks).toBeGreaterThan(10);
    // Before: about two defenders a break took a few steps and stopped, 20 m from the play.
    expect(stayed).toEqual([]);
  }, 600000);
});

// ---------------------------------------------------------------------------
// Defenders always try. The engine decides what happens; the animation shows the defence trying and
// failing, never not trying: no defender drifting while the ball is live, a chaser on every open-lane
// break who is there, a step late, as the ball goes up, and a hand up at every shot.

interface Effort {
  /** Live-ball game seconds a defender spent far from his man and his spot, slower than his jog, past the first second. */
  idle: string[];
  /** Defender-seconds of live ball watched. */
  defenderSeconds: number;
  /** Every shot from the floor: how far the nearest defender was at the release, and whether his hand was up. */
  shots: { open: boolean; d: number; up: boolean; who: string; at: string }[];
}

function watchEffort(seed: number, highlights: boolean): Effort {
  const plans = [makePlan(HARBOR_HAMMERS, { offence: 'fastBreak', defence: 'man', tempo: 'fast' }), makePlan(SKYLINE_SPARKS, { offence: 'balanced', defence: 'zone', tempo: 'fast' })] as const;
  const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [plans[0], plans[1]], seed, ['ai', 'ai'], 'normal');
  m.highlights = highlights;
  const inner = m as unknown as { script: Script | null; durations: number[]; t: number; motion: Motion };
  const e: Effort = { idle: [], defenderSeconds: 0, shots: [] };
  const slow: Record<string, number> = {};
  const slowFrom: Record<string, string> = {};
  let ballSide: string | null = null;
  let seen: Script | null = null;
  let shotBeat: object | null = null;
  for (let i = 0; i < 2_000_000 && m.phase !== 'final'; i++) {
    m.tick(DT);
    if (m.phase === 'timeout' || m.phase === 'break') {
      m.resume();
      for (const k of Object.keys(slow)) delete slow[k];
      continue;
    }
    const sc = inner.script;
    const f = m.frame();
    if (!sc || !f) continue;
    if (sc !== seen) {
      seen = sc;
      ballSide = `${sc.offence}:`;
    }
    const { index, u } = beatAt(sc, inner.durations, inner.t);
    const beat = sc.beats[index];
    const mo = inner.motion;
    const a = beat.ball;
    // Whose ball it is: whoever last had it in his hands.
    const hand = a.kind === 'held' ? a.holder : a.kind === 'pass' ? a.from : a.kind === 'fromPlayer' ? a.from : a.kind === 'toPlayer' ? a.to : null;
    if (hand && !isRef(hand)) ballSide = hand.slice(0, 2);
    // A basket dropping through the net: the side that scored defends next, so it is the one getting back.
    if (a.kind === 'fixed' && a.from.z > 2.9 && a.to.z < 0.3 && Math.hypot(a.from.x - a.to.x, a.from.y - a.to.y) < 0.3 && ballSide) ballSide = ballSide === '0:' ? '1:' : '0:';
    if (beat.dead || !ballSide) {
      for (const k of Object.keys(slow)) delete slow[k];
      continue;
    }
    const gameDt = DT * (f.timeScale ?? 1);
    const holder = m.holderKey();
    for (const k of Object.keys(mo.pos)) {
      if (isRef(k) || k.startsWith(ballSide)) {
        // On the ball side now: a stretch on defence ends here.
        delete slow[k];
        continue;
      }
      e.defenderSeconds += gameDt;
      const v = mo.vel[k];
      const speed = Math.hypot(v.x, v.y) / mo.scale;
      // Slower than a jog: an ordinary jog, or a slow (or tired) player's own, with a fifth off for
      // getting up to speed. A quick guard's jog is faster than most men's run: not the bar.
      const jog = 4.6 * Math.min(1, mo.moveFactor(k)) * 0.8;
      // His man: whom the beat has him guarding, or his man-to-man assignment. In a zone, or with the
      // ball coming at him, the man with the ball is his man while he is on him.
      const man = beat.marking?.[k] ?? sc.guards[k];
      const spot = mo.target[k];
      const onBall = holder && !isRef(holder) && mo.pos[holder] && dist(mo.pos[k], mo.pos[holder]) < 2;
      // Bodies touching an attacker (boxing out, fighting through a screen or a crowd): he is in it,
      // and the rule that nobody goes through an opponent holds him there.
      const tiedUp = Object.keys(mo.pos).some((o) => o.startsWith(ballSide!) && dist(mo.pos[o], mo.pos[k]) < 1);
      const near = (spot && dist(mo.pos[k], spot) < 2) || (man && mo.pos[man] && dist(mo.pos[k], mo.pos[man]) < 2) || onBall || tiedUp;
      if (speed < jog && !near) {
        if (!slow[k]) slowFrom[k] = `from ${m.clock.toFixed(1)}s beat ${index}`;
        slow[k] = (slow[k] ?? 0) + gameDt;
        if (slow[k] > 1 && slow[k] - gameDt <= 1) e.idle.push(`seed ${seed} q${sc.quarter} ${Math.round(m.clock)}s ${k} ${speed.toFixed(1)} m/s, ${spot ? dist(mo.pos[k], spot).toFixed(1) : '?'} m from his spot, facing ${spot ? Math.round(Math.abs(deg(angleDiff(mo.facing[k] ?? 0, Math.atan2(spot.y - mo.pos[k].y, spot.x - mo.pos[k].x))))) : '?'}° off it, ${a.kind} beat ${index} ${beat.phase}${beat.caption ? ` "${beat.caption}"` : ''}, ${slowFrom[k]}`);
      } else slow[k] = 0;
    }
    // The moment the ball leaves the shooter's hands.
    if (a.kind === 'fromPlayer' && a.style !== 'throw' && a.style !== 'set' && beat !== shotBeat && u >= SHOTS[a.style].release) {
      shotBeat = beat;
      const side = a.from.slice(0, 2);
      const s = mo.pos[a.from];
      const near = Object.keys(mo.pos)
        .filter((k) => !isRef(k) && !k.startsWith(side))
        .sort((x, y) => dist(mo.pos[x], s) - dist(mo.pos[y], s))[0];
      e.shots.push({ open: !!beat.openBreak, d: dist(mo.pos[near], s), up: (f.reach?.[near] ?? 0) > 0.5, who: near, at: `seed ${seed} q${sc.quarter} ${Math.round(m.clock)}s ${a.style} by ${a.from}` });
    }
  }
  expect(m.phase).toBe('final');
  return e;
}

describe('defenders always try', () => {
  const runs: Effort[] = [];
  const all = () => {
    if (runs.length === 0) for (const [seed, highlights] of [[1, false], [2, true], [3, true]] as const) runs.push(watchEffort(seed, highlights));
    return runs;
  };

  it('while the ball is live no defender drifts: slower than a jog for over a second only when he is on his man or his spot', () => {
    const r = all();
    const seconds = r.reduce((s, e) => s + e.defenderSeconds, 0);
    const idle = r.flatMap((e) => e.idle);
    console.log(`defender-minutes ${(seconds / 60).toFixed(0)}, idle stretches ${idle.length}`, idle.slice(0, 12));
    expect(seconds).toBeGreaterThan(600);
    expect(idle).toEqual([]);
  }, 600000);

  it('on every open-lane break the nearest defender is within 2.5 m of the shooter as the ball goes up, hand up', () => {
    const open = all().flatMap((e) => e.shots.filter((s) => s.open));
    const bad = open.filter((s) => s.d > 2.5 || !s.up).map((s) => `${s.at}: ${s.who} ${s.d.toFixed(1)} m, hand ${s.up ? 'up' : 'down'}`);
    console.log(`open-lane finishes ${open.length}`, bad.slice(0, 12));
    expect(open.length).toBeGreaterThan(5);
    expect(bad).toEqual([]);
  }, 600000);

  it('on every shot the nearest defender has a hand up, unless he is more than 4 m away', () => {
    const shots = all().flatMap((e) => e.shots);
    const bad = shots.filter((s) => s.d <= 4 && !s.up).map((s) => `${s.at}: ${s.who} ${s.d.toFixed(1)} m`);
    console.log(`shots ${shots.length}, hand down within 4 m ${bad.length}`, bad.slice(0, 12));
    expect(shots.length).toBeGreaterThan(100);
    expect(bad).toEqual([]);
  }, 600000);
});
