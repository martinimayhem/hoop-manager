// Turns one possession's events into an animation script: a list of "beats". Each beat gives
// every player a spot to run to and says what the ball is doing (held and dribbled, passed,
// shot, loose). The motion layer (motion.ts) turns the spots into smooth running, and works
// out where the ball is from whoever holds it. Pure: no DOM, no timing. Coordinates are feet on
// a 94 × 50 court; internally everything is laid out as if the offence attacks to the right.

import { other } from '../../engine/state';
import type { DefenceScheme, ShotType, Side, TimedEvent, Transition } from '../../engine/types';

export interface Pos {
  x: number;
  y: number;
}

export interface Ball extends Pos {
  /** Height above the floor in feet. */
  z: number;
}

export interface Frame {
  players: Record<string, Pos>;
  ball: Ball;
  /** How high off the floor a jumping player is (feet). */
  lift?: Record<string, number>;
  /** The player shooting right now (arms up). */
  shooter?: string | null;
}

/** How a shot is taken, which decides the jump and the ball's path. */
export type ShotStyle = 'jumper' | 'layup' | 'dunk' | 'hook' | 'set' | 'throw';

/** What the ball does during a beat. Player references are player keys. */
export type BallAction =
  | { kind: 'held'; holder: string; dribble: boolean }
  | { kind: 'pass'; from: string; to: string; arc: number }
  | { kind: 'toPlayer'; from: Ball; to: string; arc: number }
  | { kind: 'fromPlayer'; from: string; to: Ball; arc: number; style: ShotStyle }
  | { kind: 'fixed'; from: Ball; to: Ball; arc: number };

export interface Beat {
  /** Where each player is heading during this beat (absolute court feet). */
  players: Record<string, Pos>;
  ball: BallAction;
  /** Relative share of the possession's duration. */
  weight: number;
  /** Indexes (into the possession's events) that happen when this beat completes. */
  fire: number[];
  /** Shown while this beat plays ("Old swings it to Thompson..."). */
  caption?: string;
  /** Player key the caption is about. */
  spotlight?: string;
  /** Shortest this beat may play at Normal speed, so shots never flash by. */
  minSeconds?: number;
}

export interface Script {
  offence: Side;
  /** +1 if the offence attacks to the right. */
  dir: 1 | -1;
  beats: Beat[];
  clockStart: number;
  clockEnd: number;
  quarter: number;
}

export interface ScriptContext {
  offence: Side;
  quarter: number;
  lineups: [string[], string[]];
  defence: DefenceScheme;
  clockStart: number;
  clockEnd: number;
  /** How the possession started: after a defensive rebound, a steal, or a dead ball (inbound). */
  start: Transition;
  name: (side: Side, id: string) => string;
}

export const COURT = { w: 94, h: 50 };
export const HOOP_X = 88.75;
export const RIM_HEIGHT = 10;
const HOOP: Pos = { x: HOOP_X, y: 25 };

export const playerKey = (side: Side, id: string) => `${side}:${id}`;

/** Home attacks right in the first half (and overtime), left in the second. */
export function attackDir(side: Side, quarter: number): 1 | -1 {
  const firstHalf = quarter <= 2 || quarter >= 5;
  return (side === 0) === firstHalf ? 1 : -1;
}

type Spot = [number, number];
const FORMATION: Spot[] = [[63, 25], [72, 7], [72, 43], [79, 14], [82, 35]];
const BACKCOURT: Spot[] = [[30, 25], [40, 10], [40, 40], [34, 17], [32, 33]];
const ZONE: Spot[] = [[71, 18], [71, 32], [81, 10], [81, 40], [85, 25]];
const THREE: Spot[] = [[86, 3.5], [76, 6.5], [64.5, 25], [76, 43.5], [86, 46.5]];
const MID: Spot[] = [[75, 16], [73, 25], [75, 34]];
const POST: Spot[] = [[83, 19], [83, 31]];
const LANE: Spot[] = [[80, 18], [84.5, 18], [80, 32], [84.5, 32], [70, 12], [70, 38], [64, 25], [66, 8], [66, 42]];
const FT_SPOT: Pos = { x: 73.8, y: 25 };
const INBOUND_SPOT: Pos = { x: -1.5, y: 20 };

const pos = ([x, y]: Spot): Pos => ({ x, y });

function shotSpot(type: ShotType, salt: number): Pos {
  switch (type) {
    case 'three':
      return pos(THREE[salt % THREE.length]);
    case 'mid':
    case 'pnrPull':
      return pos(MID[salt % MID.length]);
    case 'post':
      return pos(POST[salt % POST.length]);
    case 'putback':
      return { x: 85.2, y: 25 + ((salt % 3) - 1) * 2 };
    default:
      // Layups and dunks: the take-off spot a stride or two from the rim.
      return { x: 80.5, y: 25 + ((salt % 3) - 1) * 3.5 };
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function buildScript(ctx: ScriptContext, events: TimedEvent[], prev: Frame | null): Script {
  const off = ctx.offence;
  const def = other(off);
  const dir = attackDir(off, ctx.quarter);
  const offIds = ctx.lineups[off];
  const defIds = ctx.lineups[def];
  const n = ctx.name;
  const seed = hash(`${ctx.quarter}:${Math.round(ctx.clockStart * 10)}:${offIds.join()}`);

  // Working positions in the normalised (attacking-right) frame.
  const at: Record<string, Pos> = {};
  const toAbs = (p: Pos): Pos => (dir === 1 ? { ...p } : { x: COURT.w - p.x, y: p.y });
  const toNorm = toAbs; // the mirror is its own inverse
  const ballAbs = (b: Ball): Ball => ({ ...toAbs(b), z: b.z });
  const kOff = (id: string) => playerKey(off, id);
  const kDef = (id: string) => playerKey(def, id);
  const sideOf = (side: Side) => (side === off ? kOff : kDef);
  const idOf = (key: string) => key.slice(key.indexOf(':') + 1);

  const beats: Beat[] = [];
  let pendingFire: number[] = [];
  let holder: string = kOff(offIds[0]); // key of whoever has the ball
  let doubled: string | null = null;
  /** Where the ball is (normalised), for loose-ball actions. */
  let ballSpot: Ball = { x: 20, y: 25, z: 3 };

  const settleDefence = () => {
    defIds.forEach((id, i) => {
      if (ctx.defence === 'zone') {
        at[kDef(id)] = pos(ZONE[i]);
        return;
      }
      const man = at[kOff(offIds[i])];
      if (!man) return;
      // Stay between your man and the basket; tighter on the ball.
      const gap = kOff(offIds[i]) === holder ? 0.12 : 0.28;
      at[kDef(id)] = { x: man.x + (HOOP.x - man.x) * gap, y: man.y + (HOOP.y - man.y) * gap * 0.8 };
    });
    if (doubled) {
      const t = at[kOff(doubled)];
      const i = offIds.indexOf(doubled);
      if (t) {
        at[kDef(defIds[i])] = { x: t.x + 2, y: t.y - 1.6 };
        at[kDef(defIds[(i + 1) % defIds.length])] = { x: t.x + 2, y: t.y + 1.6 };
      }
    }
  };

  const push = (weight: number, ball: BallAction, fire: number[] = [], caption?: string, spotlight?: string, minSeconds?: number) => {
    const players: Record<string, Pos> = {};
    for (const [k, p] of Object.entries(at)) players[k] = toAbs(p);
    beats.push({ players, ball, weight, fire: [...pendingFire, ...fire], caption, spotlight, minSeconds });
    pendingFire = [];
    if (ball.kind === 'held' || ball.kind === 'pass' || ball.kind === 'toPlayer') {
      const k = ball.kind === 'held' ? ball.holder : ball.to;
      ballSpot = { ...at[k], z: 3 };
    } else {
      ballSpot = { ...toNorm(ball.to), z: ball.to.z };
    }
  };

  const dribble = (): BallAction => ({ kind: 'held', holder, dribble: true });
  const hold = (): BallAction => ({ kind: 'held', holder, dribble: false });
  /** Passes the ball to `to` if someone else has it. */
  const passTo = (to: string, weight = 0.28, caption?: string) => {
    if (to === holder || !at[to]) return;
    const from = holder;
    holder = to;
    settleDefence();
    push(weight, { kind: 'pass', from, to, arc: 1.2 }, [], caption, to);
  };

  // ---- Starting positions: carry over where everyone was.
  offIds.forEach((id, i) => (at[kOff(id)] = pos(BACKCOURT[i])));
  defIds.forEach((id, i) => (at[kDef(id)] = { x: BACKCOURT[i][0] + 30, y: BACKCOURT[i][1] }));
  if (prev) {
    for (const k of Object.keys(at)) if (prev.players[k]) at[k] = toNorm(prev.players[k]);
    ballSpot = { ...toNorm(prev.ball), z: prev.ball.z };
  }

  const fastBreak = events.find((e) => e.type === 'fastBreak');
  const nearestToBall = () =>
    offIds.map(kOff).reduce((a, b) => (Math.hypot(at[b].x - ballSpot.x, at[b].y - ballSpot.y) < Math.hypot(at[a].x - ballSpot.x, at[a].y - ballSpot.y) ? b : a));
  const pg = kOff(offIds[0]);

  // ---- Getting the ball in: inbound after a dead ball, outlet after a rebound, steal = already ours.
  if (ctx.start === 'none') {
    const inbounder = kOff(offIds[offIds.length - 1]);
    at[inbounder] = { ...INBOUND_SPOT };
    at[pg] = { x: 9, y: 28 };
    offIds.forEach((id, i) => {
      if (i > 0 && i < offIds.length - 1) at[kOff(id)] = pos(BACKCOURT[i]);
    });
    defIds.forEach((id, i) => (at[kDef(id)] = ctx.defence === 'press' ? { x: 14 + i * 5, y: 12 + i * 6 } : pos(ZONE[i])));
    holder = inbounder;
    push(0.35, hold());
    passTo(pg, 0.25);
  } else {
    holder = nearestToBall();
    push(0.15, hold());
  }

  if (!fastBreak) {
    if (holder !== pg) passTo(pg, 0.28, `Outlet to ${n(off, offIds[0])}…`);
    // Bring it up: the point guard dribbles up, everyone sets up.
    offIds.forEach((id, i) => (at[kOff(id)] = pos(FORMATION[i])));
    settleDefence();
    const pressed = ctx.defence === 'press' ? ' against the full-court press' : '';
    push(1.1, dribble(), [], `${n(off, offIds[0])} brings it up${pressed}…`, pg);
  }

  let setupDone = false;

  /** A couple of swing passes around the perimeter before the real action, so the ball moves like basketball. */
  const ballMovement = (shooter: string, assister: string | null) => {
    if (setupDone) return;
    setupDone = true;
    const swings = seed % 3;
    const candidates = offIds.map(kOff).filter((k) => k !== shooter && k !== assister);
    for (let s = 0; s < swings && candidates.length > 0; s++) {
      const to = candidates[(seed >> (s * 3)) % candidates.length];
      if (to === holder) continue;
      // Off-ball players drift to new spots while the ball moves.
      offIds.forEach((id, i) => {
        const k = kOff(id);
        if (k !== holder && k !== to) at[k] = { x: FORMATION[i][0] + ((seed >> (i + s)) % 5) - 2, y: FORMATION[i][1] + ((seed >> (i * 2 + s)) % 7) - 3 };
      });
      passTo(to, 0.3);
      push(0.3, dribble());
    }
  };

  events.forEach((ev, i) => {
    switch (ev.type) {
      case 'fastBreak': {
        const leader = kOff(ev.leaderId);
        if (holder !== leader) passTo(leader, 0.22, `Quick outlet to ${n(off, ev.leaderId)}…`);
        offIds.forEach((id, j) => (at[kOff(id)] = { x: 64 + j * 3, y: 8 + j * 8.5 }));
        at[leader] = { x: 79, y: 25 };
        defIds.forEach((id, j) => (at[kDef(id)] = { x: 55 + j * 3, y: 12 + j * 6.5 }));
        push(0.75, dribble(), [i], `${n(off, ev.leaderId)} pushes it in transition!`, leader);
        break;
      }
      case 'pressBroken': {
        const h = kOff(ev.handlerId);
        passTo(h, 0.22);
        at[h] = { x: 58, y: 25 };
        settleDefence();
        push(0.5, dribble(), [i], undefined, h);
        break;
      }
      case 'doubleTeam': {
        const t = kOff(ev.targetId);
        passTo(t, 0.25);
        doubled = ev.targetId;
        settleDefence();
        push(0.4, dribble(), [i], `They send two at ${n(off, ev.targetId)}!`, t);
        break;
      }
      case 'shot': {
        const shooterKey = sideOf(ev.side)(ev.shooterId);
        const assistKey = ev.assistId ? kOff(ev.assistId) : null;
        const spot = shotSpot(ev.shotType, i + Math.floor(ev.clock));
        const shooterName = n(ev.side, ev.shooterId);
        const passerName = ev.assistId ? n(ev.side, ev.assistId) : '';

        if (ev.shotType !== 'putback' && ev.shotType !== 'fastBreak' && ev.shotType !== 'pressBreak' && !doubled) ballMovement(shooterKey, assistKey);

        if (ev.shotType === 'pnrRoll' && assistKey) {
          // Screen, roll, pocket pass.
          passTo(assistKey);
          const h = at[assistKey];
          at[shooterKey] = { x: h.x + 2, y: h.y + (h.y < 25 ? 2 : -2) };
          settleDefence();
          push(0.4, dribble(), [], `${passerName} calls for the screen from ${shooterName}…`, shooterKey);
          at[assistKey] = { x: h.x + 7, y: h.y + (h.y < 25 ? 5 : -5) };
          at[shooterKey] = { ...spot };
          settleDefence();
          push(0.45, dribble(), [], `…comes off it, ${shooterName} rolls to the rim…`, shooterKey);
          passTo(shooterKey, 0.25);
        } else if (ev.shotType === 'pnrPull') {
          passTo(shooterKey);
          const h = at[shooterKey];
          const screener = offIds.map(kOff).find((k) => k !== shooterKey && k !== holder) ?? shooterKey;
          at[screener] = { x: h.x + 2, y: h.y + 2 };
          settleDefence();
          push(0.35, dribble(), [], `${shooterName} uses the screen…`, shooterKey);
          at[shooterKey] = { ...spot };
          settleDefence();
          push(0.4, dribble(), [], `${shooterName} pulls up…`, shooterKey);
        } else if (ev.shotType === 'post') {
          at[shooterKey] = { x: spot.x - 1.5, y: spot.y };
          settleDefence();
          push(0.35, dribble());
          if (assistKey && assistKey !== holder) passTo(assistKey);
          passTo(shooterKey, 0.28, `${n(off, idOf(holder))} feeds ${shooterName} in the post…`);
          at[shooterKey] = { ...spot };
          settleDefence();
          push(0.4, dribble(), [], `${shooterName} backs down…`, shooterKey);
        } else if (ev.shotType === 'drive') {
          if (assistKey && assistKey !== holder) passTo(assistKey);
          passTo(shooterKey, 0.28);
          at[shooterKey] = { ...spot };
          settleDefence();
          push(0.45, dribble(), [], `${shooterName} attacks the basket…`, shooterKey);
        } else if (ev.shotType === 'three' || ev.shotType === 'mid') {
          // Shooter relocates while the passer drives and kicks.
          at[shooterKey] = { ...spot };
          if (assistKey && assistKey !== shooterKey) {
            if (assistKey !== holder) passTo(assistKey);
            at[assistKey] = { x: Math.min(80, at[assistKey].x + 6), y: at[assistKey].y + (25 - at[assistKey].y) * 0.4 };
            settleDefence();
            push(0.35, dribble(), [], `${passerName} drives and draws the defence…`, assistKey);
            passTo(shooterKey, 0.25, ev.shotType === 'three' ? `…kicks it out to ${shooterName} for three…` : `…finds ${shooterName}…`);
          } else {
            passTo(shooterKey);
            settleDefence();
            push(0.4, dribble(), [], ev.shotType === 'three' ? `${shooterName} lines it up from deep…` : `${shooterName} pulls up…`, shooterKey);
          }
        } else if (ev.shotType === 'fastBreak' || ev.shotType === 'pressBreak') {
          if (assistKey && assistKey !== holder) passTo(assistKey, 0.2);
          passTo(shooterKey, 0.22);
          at[shooterKey] = { ...spot };
          push(0.3, dribble(), [], `${shooterName} races to the rim…`, shooterKey);
        } else {
          // Putback: the rebounder goes straight back up.
          holder = shooterKey;
          at[shooterKey] = { ...spot };
          push(0.15, hold(), [], `${shooterName} goes right back up…`, shooterKey);
        }

        // The shot itself: jumpers and hooks go up on the spot; layups and dunks take off and glide to the rim.
        const style: ShotStyle = ev.dunk
          ? 'dunk'
          : ev.shotType === 'three' || ev.shotType === 'mid' || ev.shotType === 'pnrPull'
            ? 'jumper'
            : ev.shotType === 'post'
              ? 'hook'
              : 'layup';
        const from = { ...at[shooterKey] };
        if (style === 'layup' || style === 'dunk') at[shooterKey] = { x: 85.4, y: 25 + (from.y - 25) * 0.3 };
        const dist = Math.hypot(HOOP.x - from.x, HOOP.y - from.y);
        const minSeconds = style === 'jumper' ? 0.9 + dist * 0.012 : 0.85;
        if (ev.blockerId) {
          const blocker = kDef(ev.blockerId);
          at[blocker] = { x: at[shooterKey].x + 1.5, y: at[shooterKey].y + 0.5 };
          push(0.8, { kind: 'fromPlayer', from: shooterKey, to: ballAbs({ x: from.x - 7, y: from.y + 5, z: 1 }), arc: 3, style }, [i], undefined, undefined, minSeconds);
        } else {
          const rim: Ball = { x: HOOP.x - 0.4, y: HOOP.y, z: RIM_HEIGHT + 0.3 };
          const arc = style === 'jumper' ? 2 + dist * 0.2 : style === 'hook' ? 3 : style === 'layup' ? 1.2 : 0;
          push(0.8 + dist * 0.01, { kind: 'fromPlayer', from: shooterKey, to: ballAbs(rim), arc, style }, [i], undefined, undefined, minSeconds);
          if (ev.made) {
            const net = ballAbs({ x: HOOP.x - 0.4, y: HOOP.y + 0.3, z: 0.5 });
            push(0.2, { kind: 'fixed', from: ballAbs(rim), to: net, arc: 0 }, [], undefined, undefined, style === 'dunk' ? 0.2 : 0.3);
          } else ballSpot = { ...rim };
        }
        holder = '';
        doubled = null;
        break;
      }
      case 'rebound': {
        const k = sideOf(ev.side)(ev.playerId);
        at[k] = { x: HOOP.x - 4 - (i % 3), y: HOOP.y + ((i % 5) - 2) * 2 };
        push(0.35, { kind: 'toPlayer', from: ballAbs({ ...ballSpot, z: Math.max(ballSpot.z, 8) }), to: k, arc: 2.5 }, [i], undefined, k);
        holder = k;
        if (ev.offensive) settleDefence();
        break;
      }
      case 'turnover': {
        const handler = kOff(ev.playerId);
        if (holder !== handler && holder.startsWith(`${off}:`)) passTo(handler, 0.2);
        holder = handler;
        if (ev.stealerId) {
          const st = kDef(ev.stealerId);
          at[st] = { x: at[handler].x - 1.5, y: at[handler].y + 1 };
          push(0.35, { kind: 'pass', from: handler, to: st, arc: 0.3 }, [i], undefined, st);
          holder = st;
        } else {
          const h = at[handler];
          push(0.35, { kind: 'fromPlayer', from: handler, to: ballAbs({ x: h.x - 5, y: h.y < 25 ? -1.5 : 51.5, z: 1 }), arc: 1.5, style: 'throw' }, [i]);
        }
        break;
      }
      case 'foul': {
        push(0.25, holder ? hold() : { kind: 'fixed', from: ballAbs(ballSpot), to: ballAbs(ballSpot), arc: 0 }, [i]);
        break;
      }
      case 'freeThrow': {
        const k = sideOf(ev.side)(ev.shooterId);
        if (ev.attempt === 1) {
          at[k] = { ...FT_SPOT };
          let lane = 0;
          for (const id of [...offIds, ...defIds]) {
            const key = offIds.includes(id) ? kOff(id) : kDef(id);
            if (key !== k) at[key] = pos(LANE[lane++ % LANE.length]);
          }
          holder = k;
          push(0.35, hold(), [], `${n(ev.side, ev.shooterId)} steps to the line for ${ev.of}.`, k);
        } else {
          holder = k;
          push(0.15, hold());
        }
        push(0.2, dribble());
        const rim: Ball = { x: HOOP.x - 0.4, y: HOOP.y, z: RIM_HEIGHT + 0.3 };
        push(0.4, { kind: 'fromPlayer', from: k, to: ballAbs(rim), arc: 4, style: 'set' }, [i], undefined, undefined, 0.8);
        if (ev.made) push(0.15, { kind: 'fixed', from: ballAbs(rim), to: ballAbs({ x: HOOP.x - 0.4, y: HOOP.y + 0.3, z: 0.5 }), arc: 0 }, [], undefined, undefined, 0.25);
        else ballSpot = { ...rim };
        holder = '';
        break;
      }
      default:
        // Subs, timeouts, foul-outs, period markers: no movement; they fire with the next beat.
        pendingFire.push(i);
    }
  });

  if (pendingFire.length > 0 || beats.length === 0) {
    push(0.05, holder ? hold() : { kind: 'fixed', from: ballAbs(ballSpot), to: ballAbs(ballSpot), arc: 0 });
  }
  return { offence: off, dir, beats, clockStart: ctx.clockStart, clockEnd: ctx.clockEnd, quarter: ctx.quarter };
}

// ---------------------------------------------------------------------------
// Playback helpers

/** Real seconds per beat: shares of the possession's time, but never shorter than a beat's minimum (scaled by speed). */
export function beatDurations(script: Script, totalSeconds: number, minScale = 1): number[] {
  const total = script.beats.reduce((s, b) => s + b.weight, 0) || 1;
  return script.beats.map((b) => Math.max((b.weight / total) * totalSeconds, (b.minSeconds ?? 0) * minScale));
}

/** Which beat is playing at `t` seconds, and how far through it (0..1). */
export function beatAt(script: Script, durations: number[], t: number): { index: number; u: number } {
  let start = 0;
  for (let i = 0; i < script.beats.length; i++) {
    const end = start + durations[i];
    if (t < end || i === script.beats.length - 1) {
      return { index: i, u: durations[i] > 0 ? Math.max(0, Math.min(1, (t - start) / durations[i])) : 1 };
    }
    start = end;
  }
  return { index: 0, u: 0 };
}
