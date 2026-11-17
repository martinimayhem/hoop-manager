// The realism measurements, the same code for the real games and for ours. Everything is read off
// positions alone (nothing from play-by-play or our engine's events), so both sides are measured
// the same way:
//
// - who has the ball: the nearest player, if the ball is within 1 m of him and below 2.5 m;
// - a shot: the ball loose and up near a rim (within 1.2 m of it, above 2.6 m); made if it drops
//   through the rim; a rebound is whoever has it next after a miss;
// - a pass: the ball loose between two players of one team (0.12 to 3 s in the air);
// - a possession: the team that last had the ball (the other side has to keep it 3 s for it to change); the end it attacks is the half all ten players
//   are in during it; "settled half court" is two seconds after all ten are first in that half;
// - each defender's man: the matchup that keeps the defence closest over the settled half court;
// - live ball: the game clock is running.

import { HZ, STEP, resample, type Track, type TrackFrame } from './track';

const HOOPS = [
  { x: 1.6, y: 7.62 },
  { x: 28.65 - 1.6, y: 7.62 },
];
const HALF = 28.65 / 2;
const RIM_Z = 3.05;
const HOLD_M = 1.0;
const HOLD_Z = 2.5;
/** The ball has changed hands only if the other team keeps it this long (seconds). */
const CHANGE_S = 3;

export const SPEED_BANDS = { walk: 2, jog: 4, run: 5.5 };

export interface Samples {
  speed: number[];
  accel: number[];
  decel: number[];
  defOnBall: number[];
  defOneAway: number[];
  defHelp: number[];
  closeoutDist: number[];
  closeoutSpeed: number[];
  spacing: number[];
  backTime: number[];
  offAtShot: number[];
  defAtShot: number[];
  rebSpot: number[];
  rebTravel: number[];
  passSpeed: number[];
  passLength: number[];
  /** Each live player-frame: the nearest opponent (m). */
  nearestOpp: number[];
  /** Each drive: the closest any defender got to the driver (m). */
  driveClosest: number[];
  /** Each frame someone has the ball low (below 1.5 m): the rate of bounces then (per second: 25 at a bounce, else 0). */
  dribble: number[];
  /** Each change of possession in live play whose ball crosses half court within 6 s: defenders back by then. */
  backAtCross: number[];
  shots: number;
  possessions: number;
  /** Optional: told about each sample as it is taken (for looking into a line). */
  trace?: (kind: string, info: Record<string, number | string>) => void;
  liveSeconds: number;
}

export const emptySamples = (): Samples => ({
  speed: [],
  accel: [],
  decel: [],
  defOnBall: [],
  defOneAway: [],
  defHelp: [],
  closeoutDist: [],
  closeoutSpeed: [],
  spacing: [],
  backTime: [],
  offAtShot: [],
  defAtShot: [],
  rebSpot: [],
  rebTravel: [],
  passSpeed: [],
  passLength: [],
  nearestOpp: [],
  driveClosest: [],
  dribble: [],
  backAtCross: [],
  shots: 0,
  possessions: 0,
  liveSeconds: 0,
});

const d2 = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

/** The 120 ways to pair five defenders with five attackers. */
const PERMS: number[][] = (() => {
  const out: number[][] = [];
  const go = (rest: number[], acc: number[]) => {
    if (!rest.length) out.push(acc);
    for (let i = 0; i < rest.length; i++) go([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, rest[i]]);
  };
  go([0, 1, 2, 3, 4], []);
  return out;
})();

function measureRun(run: TrackFrame[], s: Samples): void {
  const n = run.length;
  const P = 10;
  const team = run[0].p.map((q) => q.team);
  // Positions smoothed over 0.2 s (SportVU is noisy), then speed over ±2 frames and acceleration over ±3.
  const X: number[][] = [];
  const Y: number[][] = [];
  for (let j = 0; j < P; j++) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      let sx = 0;
      let sy = 0;
      let c = 0;
      for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) {
        sx += run[k].p[j].x;
        sy += run[k].p[j].y;
        c++;
      }
      xs.push(sx / c);
      ys.push(sy / c);
    }
    X.push(xs);
    Y.push(ys);
  }
  const V: number[][] = X.map((xs, j) =>
    xs.map((_, i) => {
      const a = Math.max(0, i - 2);
      const b = Math.min(n - 1, i + 2);
      return b > a ? d2(X[j][a], Y[j][a], X[j][b], Y[j][b]) / ((b - a) * STEP) : 0;
    }),
  );
  const live = run.map((f, i) => {
    const prev = run[Math.max(0, i - 1)];
    const next = run[Math.min(n - 1, i + 1)];
    return next.clock < f.clock - 1e-4 || f.clock < prev.clock - 1e-4;
  });

  // Who has the ball, with short gaps (a dribble's bounce) closed up.
  // Whoever has it keeps it while it is within his reach, even if someone else (his defender) is nearer.
  let had: number | null = null;
  const holder: (number | null)[] = run.map((f) => {
    if (f.ball.z > HOLD_Z) return (had = null);
    if (had !== null && d2(f.p[had].x, f.p[had].y, f.ball.x, f.ball.y) < HOLD_M) return had;
    let best = -1;
    let bd = HOLD_M;
    for (let j = 0; j < P; j++) {
      const d = d2(f.p[j].x, f.p[j].y, f.ball.x, f.ball.y);
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    return (had = best >= 0 ? best : null);
  });
  // A ball that only flies past someone (a pass by a defender) is not his: a hold lasts 0.24 s or more.
  for (let i = 0; i < n; i++) {
    if (holder[i] === null) continue;
    let k = i;
    while (k + 1 < n && holder[k + 1] === holder[i]) k++;
    if (k - i + 1 < 0.24 * HZ) for (let q = i; q <= k; q++) holder[q] = null;
    i = k;
  }
  // Nor does a defender who is nearest the ball for a moment, his own team never really having it
  // (his man's catch in the post, the help collapsing on a drive): the other side must keep it for
  // CHANGE_S, or it was never theirs.
  {
    let lastTeam: 0 | 1 | null = null;
    for (let i = 0; i < n; i++) {
      const h = holder[i];
      if (h === null) continue;
      const tm = team[h];
      if (lastTeam !== null && tm !== lastTeam) {
        let k = i;
        while (k < n && (holder[k] === null || team[holder[k]!] === tm) && k - i < CHANGE_S * HZ) k++;
        if (k < n && k - i < CHANGE_S * HZ && holder[k] !== null && team[holder[k]!] === lastTeam) {
          for (let q = i; q < k; q++) holder[q] = null;
          i = k - 1;
          continue;
        }
      }
      lastTeam = tm;
    }
  }
  for (let i = 1; i < n; i++) {
    if (holder[i] !== null || holder[i - 1] === null) continue;
    let k = i;
    while (k < n && holder[k] === null) k++;
    if (k < n && holder[k] === holder[i - 1] && k - i <= 0.2 * HZ) for (let q = i; q < k; q++) holder[q] = holder[i - 1];
    i = k;
  }

  // Ball flights: from the last frame one player had it to the first frame someone has it again.
  type Flight = { from: number; to: number | null; i0: number; i1: number; hoop: number | null; made: boolean; live: boolean };
  const flights: Flight[] = [];
  for (let i = 1; i < n; i++) {
    if (holder[i] !== null || holder[i - 1] === null) continue;
    let k = i;
    let hoop: number | null = null;
    let made = false;
    let allLive = live[i - 1];
    while (k < n && holder[k] === null) {
      const b = run[k].ball;
      allLive &&= live[k];
      HOOPS.forEach((h, hi) => {
        if (d2(b.x, b.y, h.x, h.y) < 1.2 && b.z > 2.6) hoop = hi;
      });
      if (k > i) {
        const a = run[k - 1].ball;
        for (const h of HOOPS) if (a.z >= RIM_Z && b.z < RIM_Z && d2(a.x, a.y, h.x, h.y) < 0.45 && d2(b.x, b.y, h.x, h.y) < 0.45) made = true;
      }
      k++;
    }
    flights.push({ from: holder[i - 1]!, to: k < n ? holder[k] : null, i0: i - 1, i1: k < n ? k : n - 1, hoop, made, live: allLive });
    i = k;
  }

  // Possessions: the team that last had the ball; each gets its end from where all ten stand.
  const posTeam: (0 | 1 | null)[] = [];
  let cur: 0 | 1 | null = null;
  for (let i = 0; i < n; i++) {
    if (holder[i] !== null) cur = team[holder[i]!];
    posTeam.push(cur);
  }
  type Poss = { team: 0 | 1; a: number; b: number; hoop: number | null; settled: number[]; man: number[] | null };
  const poss: Poss[] = [];
  for (let i = 0; i < n; i++) {
    const tm = posTeam[i];
    if (tm === null) continue;
    let k = i;
    while (k + 1 < n && posTeam[k + 1] === tm) k++;
    poss.push({ team: tm, a: i, b: k, hoop: null, settled: [], man: null });
    i = k;
  }
  const allIn = (f: TrackFrame) => (f.p.every((q) => q.x < HALF) ? 0 : f.p.every((q) => q.x > HALF) ? 1 : null);
  for (const p of poss) {
    let first = -1;
    const votes = [0, 0];
    for (let i = p.a; i <= p.b; i++) {
      const side = allIn(run[i]);
      if (side === null) continue;
      votes[side]++;
    }
    if (votes[0] + votes[1] > 0) p.hoop = votes[0] >= votes[1] ? 0 : 1;
    else {
      const shot = flights.find((f) => f.hoop !== null && f.i0 >= p.a && f.i0 <= p.b && team[f.from] === p.team);
      if (shot) p.hoop = shot.hoop;
    }
    if (p.hoop === null) continue;
    for (let i = p.a; i <= p.b; i++) {
      if (allIn(run[i]) !== p.hoop || !live[i]) continue;
      if (first < 0) first = i;
      if (i - first >= 2 * HZ) p.settled.push(i);
    }
    s.possessions++;
    // Matchups over the settled half court.
    if (p.settled.length >= HZ) {
      const off = [...Array(P).keys()].filter((j) => team[j] === p.team);
      const def = [...Array(P).keys()].filter((j) => team[j] !== p.team);
      const cost = def.map((dj) => off.map((oj) => p.settled.reduce((sum, i) => sum + d2(X[dj][i], Y[dj][i], X[oj][i], Y[oj][i]), 0) / p.settled.length));
      let best = PERMS[0];
      let bc = Infinity;
      for (const perm of PERMS) {
        const c = perm.reduce((sum, o, d) => sum + cost[d][o], 0);
        if (c < bc) {
          bc = c;
          best = perm;
        }
      }
      // man[player] = his matchup (defender → attacker and attacker → defender).
      const man = new Array<number>(P).fill(-1);
      best.forEach((o, d) => {
        man[def[d]] = off[o];
        man[off[o]] = def[d];
      });
      p.man = man;
    }
  }
  const possAt = (i: number) => poss.find((p) => i >= p.a && i <= p.b) ?? null;

  // Movement: every player, all live frames.
  for (let i = 0; i < n; i++) {
    if (!live[i]) continue;
    s.liveSeconds += STEP;
    for (let j = 0; j < P; j++) {
      // Bodies: how close the nearest opponent is (contact under about half a metre).
      let near = Infinity;
      for (let q = 0; q < P; q++) if (team[q] !== team[j]) near = Math.min(near, d2(X[j][i], Y[j][i], X[q][i], Y[q][i]));
      s.nearestOpp.push(near);
      s.speed.push(V[j][i]);
      if (i >= 3 && i < n - 3 && live[i - 3] && live[i + 3]) {
        const a = (V[j][i + 3] - V[j][i - 3]) / (6 * STEP);
        if (a > 0) s.accel.push(a);
        else s.decel.push(-a);
      }
    }
  }

  // Defence and spacing in the settled half court.
  for (const p of poss) {
    if (!p.man) continue;
    const man = p.man;
    for (const i of p.settled) {
      const f = run[i];
      const off = [...Array(P).keys()].filter((j) => team[j] === p.team);
      let sum = 0;
      let c = 0;
      for (let u = 0; u < off.length; u++)
        for (let v = u + 1; v < off.length; v++) {
          sum += d2(X[off[u]][i], Y[off[u]][i], X[off[v]][i], Y[off[v]][i]);
          c++;
        }
      s.spacing.push(sum / c);
      for (const o of off) {
        const dj = man[o];
        const d = d2(X[dj][i], Y[dj][i], X[o][i], Y[o][i]);
        if (holder[i] === o) s.defOnBall.push(d);
        else if (d2(X[o][i], Y[o][i], f.ball.x, f.ball.y) < 6.5) s.defOneAway.push(d);
        else s.defHelp.push(d);
      }
    }
  }

  // Drives: the man with the ball heading for the rim he attacks (closing on it at over 2 m/s, moving
  // over 3 m/s, within 8 m of it). For each drive, the closest any defender gets to him.
  // Dribbling: while someone has the ball low, each bounce (the ball turning up from below 0.45 m).
  {
    let drive: { who: number; min: number } | null = null;
    const endDrive = () => {
      if (drive) s.driveClosest.push(drive.min);
      drive = null;
    };
    for (let i = 3; i < n - 3; i++) {
      const h = holder[i];
      const pp = possAt(i);
      if (live[i] && h !== null && run[i].ball.z < 1.5) {
        const z0 = run[i - 1].ball.z;
        const z1 = run[i].ball.z;
        const z2 = run[i + 1].ball.z;
        s.dribble.push(z1 < 0.45 && z1 <= z0 && z1 < z2 ? HZ : 0);
      }
      if (!live[i] || h === null || !pp || pp.hoop === null || team[h] !== pp.team) {
        endDrive();
        continue;
      }
      const hoop = HOOPS[pp.hoop];
      const dNow = d2(X[h][i], Y[h][i], hoop.x, hoop.y);
      const closing = (d2(X[h][i - 3], Y[h][i - 3], hoop.x, hoop.y) - d2(X[h][i + 3], Y[h][i + 3], hoop.x, hoop.y)) / (6 * STEP);
      if (V[h][i] > 3 && closing > 2 && dNow < 8) {
        if (drive && drive.who !== h) endDrive();
        drive ??= { who: h, min: Infinity };
        for (let q = 0; q < P; q++) if (team[q] !== team[h]) drive.min = Math.min(drive.min, d2(X[h][i], Y[h][i], X[q][i], Y[q][i]));
      } else endDrive();
    }
    endDrive();
  }

  for (const fl of flights) {
    const p = possAt(fl.i0);
    // Shots: where everyone is when it goes up; and after a miss, the rebound.
    if (fl.hoop !== null && fl.live) {
      s.shots++;
      const h = HOOPS[fl.hoop];
      const offT = team[fl.from];
      const off = [...Array(P).keys()].filter((j) => team[j] === offT && j !== fl.from);
      const def = [...Array(P).keys()].filter((j) => team[j] !== offT);
      const mean = (js: number[]) => js.reduce((sum, j) => sum + d2(X[j][fl.i0], Y[j][fl.i0], h.x, h.y), 0) / js.length;
      s.offAtShot.push(mean(off));
      s.defAtShot.push(mean(def));
      if (!fl.made && fl.to !== null && live[fl.i1]) {
        const r = fl.to;
        const sx = X[r][fl.i1];
        const sy = Y[r][fl.i1];
        s.rebSpot.push(d2(sx, sy, h.x, h.y));
        s.rebTravel.push(d2(X[r][fl.i0], Y[r][fl.i0], sx, sy));
      }
      continue;
    }
    if (fl.to === null || !fl.live) continue;
    const air = (fl.i1 - fl.i0) * STEP;
    // Passes: from one teammate to another.
    if (team[fl.from] === team[fl.to] && fl.from !== fl.to && air >= 0.12 && air <= 3) {
      const a = run[fl.i0].ball;
      const b = run[fl.i1].ball;
      const len = d2(a.x, a.y, b.x, b.y);
      if (len >= 2) {
        s.passLength.push(len);
        s.passSpeed.push(len / air);
      }
      // The catch: how far the catcher's man is, and how fast he closes out.
      const q = possAt(fl.i1);
      if (q?.man && q.settled.includes(fl.i1)) {
        const dj = q.man[fl.to];
        const o = fl.to;
        const d0 = d2(X[dj][fl.i1], Y[dj][fl.i1], X[o][fl.i1], Y[o][fl.i1]);
        s.closeoutDist.push(d0);
        if (d0 > 1.8) {
          let peak = 0;
          for (let i = fl.i1; i < Math.min(n, fl.i1 + HZ); i++) peak = Math.max(peak, V[dj][i]);
          s.closeoutSpeed.push(peak);
        }
      }
    }
    // Transition: the ball changes hands in live play (a steal, a defensive rebound): how long each
    // player of the side that lost it, still in the half he attacked, takes to get back past half court.
    if (team[fl.from] !== team[fl.to] && p && p.team === team[fl.from] && p.hoop !== null) {
      const attacked = p.hoop;
      const lost = [...Array(P).keys()].filter((j) => team[j] === team[fl.from]);
      for (const j of lost) {
        const inHalf = (i: number) => (attacked === 0 ? X[j][i] < HALF : X[j][i] > HALF);
        if (!inHalf(fl.i1)) continue;
        let i = fl.i1;
        while (i < n && i - fl.i1 < 10 * HZ && live[i] && inHalf(i)) i++;
        if (i < n && live[i] && !inHalf(i)) {
          s.backTime.push((i - fl.i1) * STEP);
          s.trace?.('back', { seconds: (i - fl.i1) * STEP, period: run[fl.i1].period, clock: run[fl.i1].clock, player: run[fl.i1].p[j].id, from: Math.abs(X[j][fl.i1] - HALF) });
        }
      }
      // When the ball crosses half court the other way (within 6 s), how many of them are back:
      // nearer their own basket than the ball is. A break shows as few back.
      const own = HOOPS[attacked === 0 ? 1 : 0];
      for (let i = fl.i1; i < n && i - fl.i1 < 6 * HZ && live[i]; i++) {
        const b = run[i].ball;
        const crossed = attacked === 0 ? b.x > HALF : b.x < HALF;
        if (!crossed) continue;
        const ballToHoop = d2(b.x, b.y, own.x, own.y);
        s.backAtCross.push(lost.filter((j) => d2(X[j][i], Y[j][i], own.x, own.y) < ballToHoop).length);
        break;
      }
    }
  }
}

export function measure(tracks: Track[], s: Samples = emptySamples()): Samples {
  for (const t of tracks) for (const run of resample(t.frames)) measureRun(run, s);
  return s;
}

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const a = [...xs].sort((u, v) => u - v);
  return a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))];
};
const share = (xs: number[], lo: number, hi: number) => (xs.length ? (100 * xs.filter((x) => x >= lo && x < hi).length) / xs.length : NaN);

/**
 * One line of the scorecard. `pct`: a share in percent (its gap is scaled by at least 5 points).
 * `se`: its standard error, by batch means (the samples, in the order they were taken, cut into ten
 * runs; the spread of the line's value over them), so that noise is not read as a change.
 */
export interface Line {
  group: string;
  name: string;
  unit: string;
  value: number;
  se: number;
  n: number;
  pct?: boolean;
}

const BATCHES = 10;

export function lines(s: Samples): Line[] {
  const B = SPEED_BANDS;
  const L = (group: string, name: string, unit: string, xs: number[], stat: (xs: number[]) => number, pct = false): Line => {
    const size = Math.floor(xs.length / BATCHES);
    let se = NaN;
    if (size >= 2) {
      const vs = [...Array(BATCHES).keys()].map((b) => stat(xs.slice(b * size, (b + 1) * size)));
      const mean = vs.reduce((a, v) => a + v, 0) / BATCHES;
      se = Math.sqrt(vs.reduce((a, v) => a + (v - mean) ** 2, 0) / (BATCHES - 1) / BATCHES);
    }
    return { group, name, unit, value: stat(xs), se, n: xs.length, pct };
  };
  const med = (xs: number[]) => quantile(xs, 0.5);
  const p90 = (xs: number[]) => quantile(xs, 0.9);
  const band = (lo: number, hi: number) => (xs: number[]) => share(xs, lo, hi);
  return [
    L('Movement', 'standing (< 0.5 m/s), share of time', '%', s.speed, band(0, 0.5), true),
    L('Movement', `walking (< ${B.walk} m/s), share of time`, '%', s.speed, band(0, B.walk), true),
    L('Movement', `jogging (${B.walk}-${B.jog} m/s)`, '%', s.speed, band(B.walk, B.jog), true),
    L('Movement', `running (${B.jog}-${B.run} m/s)`, '%', s.speed, band(B.jog, B.run), true),
    L('Movement', `sprinting (> ${B.run} m/s)`, '%', s.speed, band(B.run, Infinity), true),
    L('Movement', 'acceleration, hard (90th pct)', 'm/s²', s.accel, p90),
    L('Movement', 'deceleration, hard (90th pct)', 'm/s²', s.decel, p90),
    L('Defence', 'distance to his man: on the ball (median)', 'm', s.defOnBall, med),
    L('Defence', 'distance to his man: on the ball, loose (90th pct)', 'm', s.defOnBall, p90),
    L('Defence', 'distance to his man: one pass away (< 6.5 m from ball)', 'm', s.defOneAway, med),
    L('Defence', 'distance to his man: help side', 'm', s.defHelp, med),
    L('Defence', 'closeout: distance to the catcher at the catch', 'm', s.closeoutDist, med),
    L('Defence', 'closeout: top speed in the next second (from > 1.8 m)', 'm/s', s.closeoutSpeed, med),
    L('Spacing', 'half court: average distance between teammates', 'm', s.spacing, med),
    L('Contact', 'an opponent within 0.5 m, share of time', '%', s.nearestOpp, band(0, 0.5), true),
    L('Contact', 'drive: closest defender to the driver (median)', 'm', s.driveClosest, med),
    L('Contact', 'drive: with contact (a defender within 0.6 m)', '%', s.driveClosest, band(0, 0.6), true),
    L('Transition', 'time to get back past half court (median)', 's', s.backTime, med),
    L('Transition', 'time to get back past half court (90th pct)', 's', s.backTime, p90),
    L('Transition', 'defenders back as the ball crosses half court (mean)', '', s.backAtCross, (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)),
    L('Rebounds', 'offence: distance to the rim at the shot', 'm', s.offAtShot, med),
    L('Rebounds', 'defence: distance to the rim at the shot', 'm', s.defAtShot, med),
    L('Rebounds', 'where the rebound is taken: distance from the rim', 'm', s.rebSpot, med),
    L('Rebounds', 'rebounder: distance (at the shot) to where he takes it', 'm', s.rebTravel, med),
    L('Passes', 'ball speed (median)', 'm/s', s.passSpeed, med),
    L('Passes', 'ball speed, fast ones (90th pct)', 'm/s', s.passSpeed, p90),
    L('Passes', 'ball speed, slow ones (10th pct)', 'm/s', s.passSpeed, (xs) => quantile(xs, 0.1)),
    L('Passes', 'length (median)', 'm', s.passLength, med),
    L('Ball', 'dribbles a second with the ball low in hand', '/s', s.dribble, (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)),
  ];
}

/** How far a simulated value is from the real one, in percent of the real one (shares: of at least 5 points). */
export function gap(line: Line, real: number): number {
  const scale = line.pct ? Math.max(real, 5) : Math.abs(real);
  return scale > 0 && Number.isFinite(line.value) ? (100 * Math.abs(line.value - real)) / scale : NaN;
}

/** A line's standard error in gap points. */
export function gapSe(line: Line, real: number): number {
  const scale = line.pct ? Math.max(real, 5) : Math.abs(real);
  return scale > 0 && Number.isFinite(line.se) ? (100 * line.se) / scale : 0;
}
