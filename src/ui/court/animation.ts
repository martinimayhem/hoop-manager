// Turns one possession's events into an animation script: a list of "beats". Each beat gives
// every player a spot to run to and says what the ball is doing (held and dribbled, passed,
// shot, loose) and how fast each player gets there. The motion layer (motion.ts) turns that into
// running, and works out where the ball is from whoever holds it. Pure: no DOM, no timing. Coordinates are feet on
// a 94 × 50 court; internally everything is laid out as if the offence attacks to the right.

import { other } from '../../engine/state';
import type { DefenceScheme, KeyMatchup, OffensiveFocus, ShotType, Side, TimedEvent, Transition } from '../../engine/types';
import { BODY_FT, COURT, FORMATIONS, HOOP, HOOP_X, ZONE, guardSpot, insideCourt, spread } from './formations';

export { COURT, HOOP_X };

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

/** How hard a player is moving. Real players mostly walk and jog, and sprint only in bursts. */
export type Pace = 'walk' | 'jog' | 'run' | 'sprint';

/** Feet per second at Normal speed for an average player (a full sprint is about 18 mph). */
export const PACE_FT_S: Record<Pace, number> = { walk: 6, jog: 15, run: 20, sprint: 26 };

/** Bring up and set up are what fast-forward plays through quickly on a routine possession. */
export type Phase = 'bringUp' | 'setUp' | 'play';

export interface Beat {
  /** Where each player is heading during this beat (absolute court feet). */
  players: Record<string, Pos>;
  /** How fast each player goes there. */
  pace: Record<string, Pace>;
  phase: Phase;
  /** The offence is keeping its spacing in this beat. */
  spaced?: boolean;
  /** Teammates who are meant to be close in this beat (a screen). */
  contact?: string[];
  /** Players going up for the ball in this beat. */
  jump?: string[];
  /** The one player allowed off the court: whoever is inbounding the ball. */
  outOfBounds?: string;
  /** A key moment: the players move in slow motion while the ball plays out. */
  slow?: boolean;
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
  focus: OffensiveFocus;
  defence: DefenceScheme;
  /** The defending team's key matchup, so the right player guards the right man. */
  keyMatchup?: KeyMatchup;
  /** How fast a player moves relative to the plain pace (speed rating and fatigue). */
  moveFactor?: (key: string) => number;
  clockStart: number;
  clockEnd: number;
  /** How the possession started: after a defensive rebound, a steal, or a dead ball (inbound). */
  start: Transition;
  name: (side: Side, id: string) => string;
}

export const RIM_HEIGHT = 10;
/** The isometric projection, shared with the renderer: how much room a ball has above the floor. */
export const ISO = { floorY: 258, tileY: 3, liftY: 7 };
const RIM: Ball = { x: HOOP_X, y: 25, z: RIM_HEIGHT + 0.1 };
const NET: Ball = { x: HOOP_X, y: 25.2, z: 0.5 };
const RIM_CONTACT_FT = 1.3;
/** Where the ball leaves the shooter's hands, roughly. */
const RELEASE_Z = 9.5;
const PASS_FT_S = 45;
const BRING_UP_X = 46;
const DENY_INBOUND_X = 8;
/** A possession shorter than this has no time to set up. */
const EARLY_OFFENCE_SECONDS = 8;

export const playerKey = (side: Side, id: string) => `${side}:${id}`;

/** Home attacks right in the first half (and overtime), left in the second. */
export function attackDir(side: Side, quarter: number): 1 | -1 {
  const firstHalf = quarter <= 2 || quarter >= 5;
  return (side === 0) === firstHalf ? 1 : -1;
}

type Spot = [number, number];
const BACKCOURT: Spot[] = [[30, 25], [40, 10], [40, 40], [34, 17], [32, 33]];
const THREE: Spot[] = [[86, 3.5], [76, 6.5], [64.5, 25], [76, 43.5], [86, 46.5]];
const MID: Spot[] = [[75, 16], [73, 25], [75, 34]];
const POST: Spot[] = [[83, 19], [83, 31]];
const LANE: Spot[] = [[80, 18], [84.5, 18], [80, 32], [84.5, 32], [70, 12], [70, 38], [64, 25], [66, 8], [66, 42]];
const FT_SPOT: Pos = { x: 73.8, y: 25 };
/** Beside the backboard, not behind it. */
const INBOUND_SPOT: Pos = { x: -1.5, y: 17 };

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
  const seconds = ctx.clockStart - ctx.clockEnd;
  const formation = FORMATIONS[ctx.focus];
  const factor = (k: string) => ctx.moveFactor?.(k) ?? 1;

  // Working positions in the normalised (attacking-right) frame.
  const at: Record<string, Pos> = {};
  const toAbs = (p: Pos): Pos => (dir === 1 ? { ...p } : { x: COURT.w - p.x, y: p.y });
  const toNorm = toAbs; // the mirror is its own inverse
  const ballAbs = (b: Ball): Ball => ({ ...toAbs(b), z: b.z });
  const kOff = (id: string) => playerKey(off, id);
  const kDef = (id: string) => playerKey(def, id);
  const sideOf = (side: Side) => (side === off ? kOff : kDef);
  const idOf = (key: string) => key.slice(key.indexOf(':') + 1);
  const offKeys = offIds.map(kOff);
  const dist = (a: Pos, b: Pos) => Math.hypot(a.x - b.x, a.y - b.y);

  // Who guards whom: same slot, unless the key matchup swaps two assignments (as in the engine).
  const guards = defIds.map(kDef);
  const km = ctx.keyMatchup;
  if (km?.kind === 'assign' && defIds.includes(km.defenderId) && offIds.includes(km.targetId)) {
    const target = offIds.indexOf(km.targetId);
    const usual = defIds.indexOf(km.defenderId);
    [guards[target], guards[usual]] = [guards[usual], guards[target]];
  }

  const beats: Beat[] = [];
  let pendingFire: number[] = [];
  let holder: string = kOff(offIds[0]); // key of whoever has the ball
  let doubled: string | null = null;
  /** Where the ball is (normalised), for loose-ball actions. */
  let ballSpot: Ball = { x: 20, y: 25, z: 3 };
  /** Default pace per side for the beats to come; `paceFor` overrides one player for one beat. */
  let offPace: Pace = 'jog';
  let defPace: Pace = 'jog';
  let paceFor: Record<string, Pace> = {};
  /** Players who must reach their spot within the next beat (a shooter relocating, say). */
  let mustArrive: string[] = [];
  let slowBeat = false;
  /** Where everyone was heading in the previous beat, to tell how far this beat asks them to go. */
  let lastAt: Record<string, Pos> = {};
  let phase: Phase = 'play';
  /** The offence keeps its spacing; the defence follows its scheme. Both stop once a shot is up. */
  let spacing = true;
  let autoDefence = true;
  let pressing = false;
  /** Defenders scripted for the next beat, who the scheme leaves alone. */
  let placed = new Set<string>();
  /** Teammates meant to be close in the next beat (a screen). */
  let contact: string[] = [];
  /** The player the action is about: gives way only to the ball handler. */
  let soft: string | null = null;
  let jumpers: string[] = [];
  let outOfBounds: string | undefined;
  /** Set after a shot hits the rim, until the rebound plays it off. */
  let rimHit: { contact: Ball; from: Pos } | null = null;

  const place = (k: string, p: Pos) => {
    at[k] = p;
    placed.add(k);
  };

  const settleDefence = () => {
    const ball = at[holder] ?? ballSpot;
    defIds.forEach((_, i) => {
      const k = guards[i];
      if (placed.has(k)) return;
      if (ctx.defence === 'zone') {
        // Fixed spots; the zone only shades a step to the ball's side.
        const [x, y] = ZONE[defIds.indexOf(idOf(k))];
        at[k] = { x, y: y + (ball.y - 25) * 0.08 };
        return;
      }
      const man = offKeys[i];
      // Nobody crowds the inbounder: their defender stands off the baseline and denies the pass.
      if (man === outOfBounds) at[k] = { x: DENY_INBOUND_X, y: at[man].y - 4 };
      else if (at[man]) at[k] = guardSpot(at[man], ball, man === holder, pressing);
    });
    if (doubled) {
      const t = at[kOff(doubled)];
      const i = offIds.indexOf(doubled);
      if (t) {
        at[guards[i]] = { x: t.x + 2, y: t.y - 2 };
        at[guards[(i + 1) % guards.length]] = { x: t.x + 2, y: t.y + 2 };
      }
    }
  };

  const push = (weight: number, ball: BallAction, fire: number[] = [], caption?: string, spotlight?: string, minSeconds?: number) => {
    if (spacing) spread(at, offKeys, (k) => (k === holder || k === outOfBounds || contact.includes(k) ? 0 : k === soft ? 0.15 : 1));
    if (autoDefence) settleDefence();
    for (const k of Object.keys(at)) if (k !== outOfBounds) at[k] = insideCourt(at[k]);
    const players: Record<string, Pos> = {};
    const pace: Record<string, Pace> = {};
    for (const [k, p] of Object.entries(at)) {
      players[k] = toAbs(p);
      pace[k] = paceFor[k] ?? (k.startsWith(`${off}:`) ? offPace : defPace);
    }
    // The beat lasts as long as the player it is about needs to get there at that pace.
    const actor = ball.kind === 'held' ? ball.holder : ball.kind === 'pass' || ball.kind === 'toPlayer' ? ball.to : ball.kind === 'fromPlayer' ? ball.from : null;
    let travel = 0;
    for (const k of actor ? [actor, ...mustArrive] : mustArrive) {
      const from = lastAt[k];
      if (!from || !at[k]) continue;
      const d = dist(at[k], from);
      if (d > 3) travel = Math.max(travel, d / (PACE_FT_S[pace[k]] * factor(k)) + 0.3);
    }
    const needed = Math.max(minSeconds ?? 0, Math.min(travel, 6));
    beats.push({
      players,
      pace,
      phase,
      spaced: spacing || undefined,
      contact: contact.length > 0 ? contact : undefined,
      jump: jumpers.length > 0 ? jumpers : undefined,
      outOfBounds,
      slow: slowBeat || undefined,
      ball,
      weight,
      fire: [...pendingFire, ...fire],
      caption,
      spotlight,
      minSeconds: needed > 0 ? needed : undefined,
    });
    pendingFire = [];
    paceFor = {};
    mustArrive = [];
    slowBeat = false;
    placed = new Set();
    contact = [];
    jumpers = [];
    lastAt = {};
    for (const [k, p] of Object.entries(at)) lastAt[k] = { ...p };
    if (ball.kind === 'held' || ball.kind === 'pass' || ball.kind === 'toPlayer') {
      const k = ball.kind === 'held' ? ball.holder : ball.to;
      ballSpot = { ...at[k], z: 3 };
    } else {
      ballSpot = { ...toNorm(ball.to), z: ball.to.z };
    }
  };

  const dribble = (): BallAction => ({ kind: 'held', holder, dribble: true });
  const hold = (): BallAction => ({ kind: 'held', holder, dribble: false });
  /** Passes the ball to `to` if someone else has it: quick and flat, long enough to see it go. */
  const passTo = (to: string, weight = 0.28, caption?: string) => {
    if (to === holder || !at[to]) return;
    const from = holder;
    const flight = Math.max(0.3, dist(at[from], at[to]) / PASS_FT_S);
    holder = to;
    push(weight, { kind: 'pass', from, to, arc: 0.3 }, [], caption, to, flight);
  };
  const toFormation = () => offIds.forEach((id, i) => (at[kOff(id)] = pos(formation[i])));

  /** The ball's arc to the rim: high enough to drop in, without leaving the top of the canvas. */
  const shotArc = (from: Pos, style: ShotStyle): number => {
    if (style === 'dunk') return 0;
    if (style === 'layup') return 1.5;
    const mid = toAbs({ x: (from.x + HOOP.x) / 2, y: (from.y + HOOP.y) / 2 });
    const room = (ISO.floorY + (mid.y - COURT.h / 2) * ISO.tileY - (mid.x - COURT.w / 2) * ISO.tileY - 4) / ISO.liftY;
    const apex = RIM_HEIGHT + (style === 'hook' ? 4.5 : 3 + dist(from, HOOP) * 0.3);
    return Math.max(1.5, Math.min(apex, room) - (RELEASE_Z + RIM_HEIGHT) / 2);
  };
  /** Where a miss hits the iron: front, back or side, as seen from the shooter. */
  const rimContact = (from: Pos, salt: number): Ball => {
    const d = dist(from, HOOP) || 1;
    const turn = [0, 1.2, -1.2, Math.PI][salt % 4];
    const ux = (HOOP.x - from.x) / d;
    const uy = (HOOP.y - from.y) / d;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    return { x: HOOP.x - (ux * c - uy * s) * RIM_CONTACT_FT, y: HOOP.y - (ux * s + uy * c) * RIM_CONTACT_FT, z: RIM_HEIGHT + 0.2 };
  };

  // ---- Starting positions: carry over where everyone was.
  offIds.forEach((id, i) => (at[kOff(id)] = pos(BACKCOURT[i])));
  defIds.forEach((id, i) => (at[kDef(id)] = { x: BACKCOURT[i][0] + 30, y: BACKCOURT[i][1] }));
  if (prev) {
    for (const k of Object.keys(at)) if (prev.players[k]) at[k] = toNorm(prev.players[k]);
    ballSpot = { ...toNorm(prev.ball), z: prev.ball.z };
  }
  for (const [k, p] of Object.entries(at)) lastAt[k] = { ...p };

  const fastBreak = events.find((e) => e.type === 'fastBreak');
  const pressBreak = events.some((e) => e.type === 'pressBroken');
  const nearestToBall = () => offKeys.reduce((a, b) => (dist(at[b], ballSpot) < dist(at[a], ballSpot) ? b : a));
  const pg = kOff(offIds[0]);
  pressing = ctx.defence === 'press' && !fastBreak;

  const origin: Record<string, Pos> = { ...at };
  /** Whoever inbounded the ball has the whole floor to cover, so they run it. */
  let trailer: string | null = null;

  // ---- Getting the ball in: inbound after a dead ball, outlet after a rebound, steal = already ours.
  if (ctx.start === 'none') {
    const inbounder = kOff(offIds[offIds.length - 1]);
    at[inbounder] = origin[inbounder] = { ...INBOUND_SPOT };
    trailer = inbounder;
    outOfBounds = inbounder;
    at[pg] = { x: 9, y: 28 };
    offIds.forEach((id, i) => {
      if (i > 0 && i < offIds.length - 1) at[kOff(id)] = pos(BACKCOURT[i]);
    });
    // The team that just scored turns and heads back while the ball comes in; only a press stays up.
    const retreat = !pressing && ctx.defence !== 'zone';
    if (retreat) guards.forEach((k, i) => place(k, { x: Math.max(at[k].x, 42 + i * 4), y: at[k].y + (ZONE[i][1] - at[k].y) * 0.5 }));
    holder = inbounder;
    phase = 'bringUp';
    push(0.35, hold());
    if (retreat) guards.forEach((k) => placed.add(k));
    passTo(pg, 0.25);
    outOfBounds = undefined;
  } else {
    holder = nearestToBall();
    if (fastBreak) autoDefence = false;
    push(0.15, hold());
  }

  if (!fastBreak) {
    if (holder !== pg) passTo(pg, 0.28, `Outlet to ${n(off, offIds[0])}…`);
    // Bring up: the point guard takes it over half court while everyone jogs into shape. A defender
    // the ball has got ahead of has to run; the others jog back and match up. A press picks up the
    // whole way, so the others come back to give the handler an outlet.
    phase = 'bringUp';
    const pressed = pressing ? ' against the full-court press' : '';
    const startX = at[pg].x;
    if (startX < BRING_UP_X) {
      at[pg] = { x: BRING_UP_X, y: 25 + (at[pg].y - 25) * 0.4 };
      offIds.forEach((id, i) => {
        if (i > 0) at[kOff(id)] = { x: formation[i][0] - (pressing ? 24 : 0), y: formation[i][1] };
      });
      if (trailer) paceFor[trailer] = 'run';
      if (pressing) paceFor[pg] = 'run';
      else for (const k of guards) if (at[k].x < BRING_UP_X + 8) paceFor[k] = 'run';
      push(0.8, dribble(), [], `${n(off, offIds[0])} brings it up${pressed}…`, pg);
    }
    pressing = false;
    if (!pressBreak) {
      // Set up: into the formation, the defence matched up; the point guard reads it for a moment.
      // Nothing starts until the slowest player is in place, so the action begins from a real shape.
      phase = 'setUp';
      toFormation();
      spread(at, offKeys, (k) => (k === holder ? 0 : 1));
      settleDefence();
      for (const k of guards) paceFor[k] = 'run';
      if (trailer) paceFor[trailer] = 'run';
      const slowest = Math.max(...Object.keys(at).map((k) => dist(origin[k], at[k]) / (PACE_FT_S[paceFor[k] ?? offPace] * factor(k))));
      const spent = beats.reduce((sum, b) => sum + (b.minSeconds ?? 0), 0);
      const share = seconds >= EARLY_OFFENCE_SECONDS ? 1 : 0.6;
      push(0.45, dribble(), [], startX < BRING_UP_X ? undefined : `${n(off, offIds[0])} brings it up…`, pg, Math.min(7, Math.max(0.3, (slowest * 1.2 + 0.8) * share - spent)));
      if (seconds >= EARLY_OFFENCE_SECONDS) push(0.3, dribble(), [], undefined, pg, 0.8);
    }
    phase = 'play';
    defPace = 'run'; // from here on they are reacting to the offence
  } else {
    phase = 'play';
    autoDefence = false;
  }

  let setupDone = false;

  /** Moves the ball around before the real action: 1 to 3 passes in all, fewer if the clock is short. */
  const ballMovement = (avoid: string, assister: string | null, screen: boolean) => {
    if (setupDone) return;
    setupDone = true;
    const wanted = seconds < EARLY_OFFENCE_SECONDS ? 1 : seconds < 14 ? 2 : 3;
    const later = assister ? 2 : 1; // a swing has to come back: to the passer, then the finisher
    const nothingLater = !screen && !assister && avoid === holder;
    const swings = Math.max(nothingLater ? 1 : 0, wanted - later);
    const candidates = offKeys.filter((k) => k !== avoid && k !== assister);
    for (let s = 0; s < swings; s++) {
      const pool = candidates.filter((k) => k !== holder);
      if (pool.length === 0) break;
      const to = pool[(seed >>> (s * 3)) % pool.length];
      // A player on the ball's side clears out to the weak side, keeping the floor balanced.
      const ballSide = at[to].y < COURT.h / 2;
      const cutters = offKeys.filter((k) => k !== holder && k !== to && k !== avoid && at[k].y < COURT.h / 2 === ballSide && Math.abs(at[k].y - COURT.h / 2) > 5);
      const cutter = cutters[(seed >>> (s + 4)) % Math.max(1, cutters.length)];
      if (cutter) {
        at[cutter] = { x: at[cutter].x, y: COURT.h - at[cutter].y };
        paceFor[cutter] = 'run';
      }
      passTo(to, 0.3);
      push(0.3, hold(), [], undefined, undefined, 0.35);
    }
  };

  events.forEach((ev, i) => {
    switch (ev.type) {
      case 'fastBreak': {
        const leader = kOff(ev.leaderId);
        offPace = 'sprint';
        defPace = 'sprint';
        if (holder !== leader) passTo(leader, 0.22, `Quick outlet to ${n(off, ev.leaderId)}…`);
        // Numbers are real: whoever was caught up the floor cannot get back in time.
        const ballX = at[leader].x;
        const back = defIds.map(kDef).filter((k) => at[k].x > ballX).sort((a, b) => at[b].x - at[a].x);
        const beaten = defIds.map(kDef).filter((k) => at[k].x <= ballX);
        // Runners fill the lanes, wings first, a trailer behind, the last man stays home.
        const runners = offKeys.filter((k) => k !== leader).sort((a, b) => at[b].x - at[a].x);
        const lanes: Pos[] = [{ x: 78, y: 7 }, { x: 78, y: 43 }, { x: 62, y: 25 }, { x: 46, y: 25 }];
        runners.forEach((k, j) => (at[k] = lanes[j] ?? lanes[3]));
        at[leader] = { x: 72, y: 25 };
        back.forEach((k, j) => (at[k] = j === 0 ? { x: 82, y: 25 } : { x: 76, y: 25 + (j % 2 === 0 ? 7 : -7) * Math.ceil(j / 2) }));
        // Anyone beaten chases flat out; they only catch up if they are quicker.
        beaten.forEach((k, j) => (at[k] = { x: 80, y: 13 + j * 8 }));
        const attackers = Math.min(3, offIds.length);
        const caption = back.length < attackers ? `${n(off, ev.leaderId)} pushes it: ${attackers} on ${back.length}!` : `${n(off, ev.leaderId)} pushes it in transition!`;
        push(0.75, dribble(), [i], caption, leader);
        break;
      }
      case 'pressBroken': {
        const h = kOff(ev.handlerId);
        passTo(h, 0.22);
        at[h] = { x: Math.max(58, at[h].x), y: 25 };
        offIds.forEach((id, j) => {
          if (kOff(id) !== h) at[kOff(id)] = pos(formation[j]);
        });
        paceFor[h] = 'sprint';
        push(0.5, dribble(), [i], undefined, h);
        break;
      }
      case 'doubleTeam': {
        const t = kOff(ev.targetId);
        passTo(t, 0.25);
        doubled = ev.targetId;
        push(0.4, dribble(), [i], `They send two at ${n(off, ev.targetId)}!`, t);
        break;
      }
      case 'shot': {
        const shooterKey = sideOf(ev.side)(ev.shooterId);
        const assistKey = ev.assistId ? kOff(ev.assistId) : null;
        const spot = shotSpot(ev.shotType, i + Math.floor(ev.clock));
        const shooterName = n(ev.side, ev.shooterId);
        const passerName = ev.assistId ? n(ev.side, ev.assistId) : '';
        soft = shooterKey;

        const screened = ev.shotType === 'pnrRoll' || ev.shotType === 'pnrPull';
        if (!fastBreak && ev.shotType !== 'putback' && ev.shotType !== 'pressBreak' && !doubled) ballMovement(shooterKey, assistKey, screened);

        if (ev.shotType === 'pnrRoll' && assistKey) {
          // Screen, roll, pocket pass.
          passTo(assistKey);
          const h = at[assistKey];
          at[shooterKey] = { x: h.x + 2.5, y: h.y + (h.y < 25 ? 2 : -2) };
          contact = [assistKey, shooterKey];
          push(0.4, dribble(), [], `${passerName} calls for the screen from ${shooterName}…`, shooterKey, 0.7);
          at[assistKey] = { x: h.x + 7, y: h.y + (h.y < 25 ? 5 : -5) };
          at[shooterKey] = { ...spot };
          paceFor[shooterKey] = 'run';
          mustArrive = [shooterKey];
          push(0.45, dribble(), [], `…comes off it, ${shooterName} rolls to the rim…`, shooterKey);
          passTo(shooterKey, 0.25);
        } else if (ev.shotType === 'pnrPull') {
          passTo(shooterKey);
          const h = at[shooterKey];
          const others = offKeys.filter((k) => k !== shooterKey);
          const screener = others[others.length - 1];
          at[screener] = { x: h.x + 2.5, y: h.y + 2 };
          contact = [shooterKey, screener];
          push(0.35, dribble(), [], `${shooterName} uses the screen…`, shooterKey, 0.7);
          at[shooterKey] = { ...spot };
          paceFor[shooterKey] = 'run';
          push(0.4, dribble(), [], `${shooterName} pulls up…`, shooterKey);
        } else if (ev.shotType === 'post') {
          at[shooterKey] = { x: spot.x - 1.5, y: spot.y };
          push(0.35, dribble());
          if (assistKey && assistKey !== holder) passTo(assistKey);
          passTo(shooterKey, 0.28, `${n(off, idOf(holder))} feeds ${shooterName} in the post…`);
          at[shooterKey] = { ...spot };
          push(0.4, dribble(), [], `${shooterName} backs down…`, shooterKey);
        } else if (ev.shotType === 'drive') {
          if (assistKey && assistKey !== holder) passTo(assistKey);
          passTo(shooterKey, 0.28);
          at[shooterKey] = { ...spot };
          paceFor[shooterKey] = 'sprint';
          push(0.45, dribble(), [], `${shooterName} attacks the basket…`, shooterKey);
        } else if (ev.shotType === 'three' || ev.shotType === 'mid') {
          // Shooter relocates while the passer drives and kicks.
          at[shooterKey] = { ...spot };
          if (assistKey && assistKey !== shooterKey) {
            if (assistKey !== holder) passTo(assistKey);
            at[assistKey] = { x: Math.min(80, at[assistKey].x + 6), y: at[assistKey].y + (25 - at[assistKey].y) * 0.4 };
            paceFor[assistKey] = 'run';
            paceFor[shooterKey] = 'run';
            mustArrive = [shooterKey];
            push(0.35, dribble(), [], `${passerName} drives and draws the defence…`, assistKey);
            passTo(shooterKey, 0.25, ev.shotType === 'three' ? `…kicks it out to ${shooterName} for three…` : `…finds ${shooterName}…`);
          } else {
            passTo(shooterKey);
            mustArrive = [shooterKey];
            push(0.4, dribble(), [], ev.shotType === 'three' ? `${shooterName} lines it up from deep…` : `${shooterName} pulls up…`, shooterKey);
          }
        } else if (ev.shotType === 'fastBreak' || ev.shotType === 'pressBreak') {
          if (assistKey && assistKey !== holder) passTo(assistKey, 0.2);
          passTo(shooterKey, 0.22);
          at[shooterKey] = { ...spot };
          push(0.3, dribble(), [], `${shooterName} races to the rim…`, shooterKey);
        } else if (ev.shotType === 'putback') {
          // Putback: the rebounder goes straight back up.
          holder = shooterKey;
          at[shooterKey] = { ...spot };
          push(0.15, hold(), [], `${shooterName} goes right back up…`, shooterKey);
        } else {
          // A finish with no set-up of its own: get it to the shooter and go.
          if (assistKey && assistKey !== holder) passTo(assistKey);
          passTo(shooterKey, 0.28);
          at[shooterKey] = { ...spot };
          push(0.35, dribble(), [], undefined, shooterKey);
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
        const shotDist = dist(from, HOOP);
        const minSeconds = style === 'jumper' ? 1.1 + shotDist * 0.015 : 0.85;
        const arc = shotArc(from, style);
        if (ev.blockerId) {
          const blocker = kDef(ev.blockerId);
          place(blocker, { x: at[shooterKey].x + 1.5, y: at[shooterKey].y + 2 });
          paceFor[blocker] = 'sprint';
          push(0.8, { kind: 'fromPlayer', from: shooterKey, to: ballAbs({ x: from.x - 7, y: from.y + 5, z: 1 }), arc: 3, style }, [i], undefined, undefined, minSeconds);
        } else if (ev.made) {
          push(0.8 + shotDist * 0.01, { kind: 'fromPlayer', from: shooterKey, to: ballAbs(RIM), arc, style }, [i], undefined, undefined, minSeconds);
          spacing = false;
          autoDefence = false;
          push(0.2, { kind: 'fixed', from: ballAbs(RIM), to: ballAbs(NET), arc: 0 }, [], undefined, undefined, style === 'dunk' ? 0.2 : 0.3);
        } else {
          const contactAt = rimContact(from, seed + i);
          push(0.8 + shotDist * 0.01, { kind: 'fromPlayer', from: shooterKey, to: ballAbs(contactAt), arc, style }, [i], undefined, undefined, minSeconds);
          rimHit = { contact: contactAt, from };
        }
        spacing = false;
        autoDefence = false;
        soft = null;
        holder = '';
        doubled = null;
        break;
      }
      case 'rebound': {
        const k = sideOf(ev.side)(ev.playerId);
        spacing = false;
        autoDefence = false;
        if (rimHit) {
          // Off the iron: the ball pops up, everyone nearby crashes, and they fight for it in the air.
          const { contact: hit, from } = rimHit;
          rimHit = null;
          const away = Math.atan2(from.y - HOOP.y, from.x - HOOP.x) + (((seed + i) % 3) - 1) * 0.7;
          const reach = 3.5 + dist(from, HOOP) * 0.25 + (seed + i) % 3;
          const carom = insideCourt({ x: Math.min(86, HOOP.x + Math.cos(away) * reach), y: HOOP.y + Math.sin(away) * reach });
          const rivals = [...offKeys, ...defIds.map(kDef)]
            .filter((o) => o !== k)
            .sort((a, b) => dist(at[a], carom) - dist(at[b], carom))
            .slice(0, 3);
          at[k] = { ...carom };
          paceFor[k] = 'sprint';
          rivals.forEach((o, j) => {
            const turn = away + 2 + j * 1.15;
            at[o] = { x: carom.x + Math.cos(turn) * BODY_FT * 1.2, y: carom.y + Math.sin(turn) * BODY_FT * 1.2 };
            paceFor[o] = 'sprint';
          });
          const top: Ball = { ...carom, z: 8.5 };
          push(0.3, { kind: 'fixed', from: ballAbs(hit), to: ballAbs(top), arc: 1.6 }, [], undefined, undefined, 0.55);
          jumpers = [k, ...rivals];
          push(0.25, { kind: 'toPlayer', from: ballAbs(top), to: k, arc: 0 }, [i], undefined, k, 0.45);
        } else {
          at[k] = { x: HOOP.x - 4 - (i % 3), y: HOOP.y + ((i % 5) - 2) * 2 };
          paceFor[k] = 'sprint';
          push(0.35, { kind: 'toPlayer', from: ballAbs({ ...ballSpot, z: Math.max(ballSpot.z, 8) }), to: k, arc: 2.5 }, [i], undefined, k);
        }
        holder = k;
        if (ev.offensive) {
          // Second chance: everyone else fans back out and the defence recovers.
          offIds.forEach((id, j) => {
            if (kOff(id) !== k) at[kOff(id)] = pos(formation[j]);
          });
          spacing = true;
          autoDefence = true;
        }
        break;
      }
      case 'turnover': {
        const handler = kOff(ev.playerId);
        if (!fastBreak && !doubled && holder.startsWith(`${off}:`) && seconds >= EARLY_OFFENCE_SECONDS) ballMovement(handler, null, true);
        if (holder !== handler && holder.startsWith(`${off}:`)) passTo(handler, 0.2);
        holder = handler;
        const h = { ...at[handler] };
        if (ev.stealerId) {
          const st = kDef(ev.stealerId);
          const stName = n(def, ev.stealerId);
          const way = (seed + i) % 3;
          if (way === 0) {
            // Picked clean: the defender closes in and reaches for the dribble.
            place(st, { x: h.x + 2, y: h.y + 1.8 });
            paceFor[st] = 'sprint';
            mustArrive = [st];
            push(0.3, dribble());
            place(st, { x: h.x - 1.5, y: h.y + 2.2 });
            slowBeat = true;
            push(0.4, { kind: 'pass', from: handler, to: st, arc: 0.2 }, [i], `${stName} reaches in…`, st, 1.1);
          } else if (way === 1) {
            // Intercepted: the handler looks for a teammate and the defender jumps the lane.
            const target = offKeys.filter((k) => k !== handler).sort((a, b) => dist(at[a], h) - dist(at[b], h))[0];
            place(st, { x: h.x + (at[target].x - h.x) * 0.55, y: h.y + (at[target].y - h.y) * 0.55 });
            paceFor[st] = 'sprint';
            mustArrive = [st];
            push(0.3, hold(), [], `${n(off, idOf(handler))} looks for ${n(off, idOf(target))}…`, handler, 0.5);
            slowBeat = true;
            placed.add(st);
            push(0.4, { kind: 'pass', from: handler, to: st, arc: 0.3 }, [i], `${stName} jumps the passing lane!`, st, 1.0);
          } else {
            // Deflected: the ball pops loose and both of them scramble for it.
            const loose: Ball = { ...insideCourt({ x: h.x - 6, y: h.y + (h.y < 25 ? 5 : -5) }, 3), z: 0.6 };
            place(st, { x: h.x - 1.5, y: h.y + 2.2 });
            paceFor[st] = 'sprint';
            mustArrive = [st];
            push(0.3, dribble());
            slowBeat = true;
            placed.add(st);
            push(0.25, { kind: 'fromPlayer', from: handler, to: ballAbs(loose), arc: 0.6, style: 'throw' }, [], `${stName} gets a hand on it!`, st, 0.7);
            place(st, { x: loose.x, y: loose.y });
            at[handler] = { x: loose.x + 1.8, y: loose.y - 2 };
            paceFor[st] = 'sprint';
            paceFor[handler] = 'sprint';
            push(0.25, { kind: 'fixed', from: ballAbs(loose), to: ballAbs({ ...loose, z: 0.3 }), arc: 1.3 }, [], 'Loose ball!', st, 0.7);
            placed.add(st);
            push(0.15, { kind: 'toPlayer', from: ballAbs({ ...loose, z: 0.3 }), to: st, arc: 0.3 }, [i], undefined, st, 0.3);
          }
          holder = st;
          spacing = false;
          autoDefence = false;
        } else if (ev.cause === 'travel' || ev.cause === 'shotClock') {
          // A whistle, not a loose ball: the handler stops and gives it up.
          push(0.3, ev.cause === 'travel' ? dribble() : hold());
          push(0.3, hold(), [i], undefined, handler, 0.8);
        } else if (ev.cause === 'offensiveFoul') {
          // Lowers a shoulder into the nearest defender.
          const man = defIds.map(kDef).sort((a, b) => dist(at[a], h) - dist(at[b], h))[0];
          place(man, { ...at[man] });
          at[handler] = { x: at[man].x - 2.8, y: at[man].y };
          paceFor[handler] = 'run';
          push(0.3, dribble());
          placed.add(man);
          push(0.3, hold(), [i], undefined, handler, 0.8);
        } else {
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
        spacing = false;
        autoDefence = false;
        rimHit = null;
        if (ev.attempt === 1) {
          at[k] = { ...FT_SPOT };
          let lane = 0;
          for (const key of [...offKeys, ...defIds.map(kDef)]) if (key !== k) at[key] = pos(LANE[lane++ % LANE.length]);
          holder = k;
          push(0.35, hold(), [], `${n(ev.side, ev.shooterId)} steps to the line for ${ev.of}.`, k);
        } else {
          holder = k;
          push(0.15, hold());
        }
        push(0.2, dribble());
        const arc = shotArc(FT_SPOT, 'set');
        if (ev.made) {
          push(0.4, { kind: 'fromPlayer', from: k, to: ballAbs(RIM), arc, style: 'set' }, [i], undefined, undefined, 0.9);
          push(0.15, { kind: 'fixed', from: ballAbs(RIM), to: ballAbs(NET), arc: 0 }, [], undefined, undefined, 0.25);
        } else {
          const contactAt = rimContact(FT_SPOT, seed + i);
          push(0.4, { kind: 'fromPlayer', from: k, to: ballAbs(contactAt), arc, style: 'set' }, [i], undefined, undefined, 0.9);
          rimHit = { contact: contactAt, from: FT_SPOT };
        }
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
