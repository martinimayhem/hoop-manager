// Turns one possession's events into an animation script: a list of "beats". Each beat gives
// every player a spot to run to and says what the ball is doing (held and dribbled, passed,
// shot, loose) and how fast each player gets there. The motion layer (motion.ts) turns that into
// running, and works out where the ball is from whoever holds it. Pure: no DOM, no timing. Everything is court space: metres on
// a 28 × 15 court, plus height for the ball; internally everything is laid out as if the offence attacks to the right.

import { other } from '../../engine/state';
import type { DefenceScheme, KeyMatchup, OffensiveFocus, ShotType, Side, TimedEvent, Transition } from '../../engine/types';
import { BODY_M, COURT, FORMATIONS, HOOP, HOOP_X, MID_Y, ZONE, guardSpot, insideCourt, spread } from './formations';

export { COURT, HOOP_X, MID_Y };

export interface Pos {
  x: number;
  y: number;
}

export interface Ball extends Pos {
  /** Height above the floor in metres. */
  z: number;
}

export interface Frame {
  players: Record<string, Pos>;
  ball: Ball;
  /** How high off the floor a jumping player is (metres). */
  lift?: Record<string, number>;
  /** The player shooting right now (arms up). */
  shooter?: string | null;
  /** Which way each player faces: an angle in court space, radians from +x towards +y. */
  facing?: Record<string, number>;
  /** Where each player's head is turned: towards the ball, as far as the neck allows. */
  look?: Record<string, number>;
  /** How far each defender is down in a stance, 0..1. */
  stance?: Record<string, number>;
  /** How far each player's hands are up, 0..1; anyone missing has them down. */
  reach?: Record<string, number>;
}

/** Chest: flat and fast. Bounce: off the floor past a defender. Lob: up and over, for long or crowded passes. */
export type PassStyle = 'chest' | 'bounce' | 'lob';

/** How fast each pass crosses the floor, in metres a second. */
export const PASS_SPEED: Record<PassStyle, number> = { chest: 10, bounce: 8, lob: 7 };

/** How a shot is taken, which decides the jump and the ball's path. */
export type ShotStyle = 'jumper' | 'layup' | 'dunk' | 'hook' | 'set' | 'throw';

/** What the ball does during a beat. Player references are player keys. */
export type BallAction =
  | { kind: 'held'; holder: string; dribble: boolean }
  | { kind: 'pass'; from: string; to: string; arc: number; style?: PassStyle }
  | { kind: 'toPlayer'; from: Ball; to: string; arc: number; high?: boolean }
  | { kind: 'fromPlayer'; from: string; to: Ball; arc: number; style: ShotStyle }
  | { kind: 'fixed'; from: Ball; to: Ball; arc: number };

/** How hard a player is moving. Real players mostly walk and jog, and sprint only in bursts. */
export type Pace = 'walk' | 'jog' | 'run' | 'sprint';

/** Metres per second at Normal speed for an average player. */
export const PACE_M_S: Record<Pace, number> = { walk: 1.8, jog: 4.6, run: 6.1, sprint: 7.9 };

/** Bring up and set up are what fast-forward plays through quickly on a routine possession. */
export type Phase = 'bringUp' | 'setUp' | 'play';

export interface Beat {
  /** Where each player is heading during this beat (absolute court metres). */
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
  /** A player with the ball in the post, back to the basket. */
  posting?: string;
  /** Defender to attacker, for each defender guarding a man this beat (rather than placed by the play). */
  marking?: Record<string, string>;
  /** The defence is pressing full court. */
  pressing?: boolean;
  /** Players with their hands up for a rebound while the ball is in the air. */
  reach?: string[];
  /** The defender challenging this beat's shot, and whether the engine says they block it. */
  contest?: string;
  block?: boolean;
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
  /** Who each man-to-man defender is guarding (defender key to attacker key); empty in a zone. */
  guards: Record<string, string>;
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

export const RIM_HEIGHT = 3.05;
const RIM: Ball = { x: HOOP_X, y: MID_Y, z: RIM_HEIGHT + 0.03 };
const NET: Ball = { x: HOOP_X, y: MID_Y + 0.06, z: 0.15 };
const RIM_CONTACT_M = 0.4;
/** Where the ball leaves the shooter's hands, roughly. */
const RELEASE_Z = 2.9;
/** A defender this close to the line between passer and receiver is in the passing lane. */
const LANE_M = 0.9;
/** Longest pass thrown flat; anything further goes over the top. */
const FLAT_PASS_M = 9;
/** Swinging the ball round, a team only looks this far. */
const SWING_M = 8.5;
const BRING_UP_X = 13.7;
const DENY_INBOUND_X = 2.4;
const POST_BACKDOWN_M_S = 2;
/** A possession shorter than this has no time to set up. */
const EARLY_OFFENCE_SECONDS = 8;

export const playerKey = (side: Side, id: string) => `${side}:${id}`;

/** Home attacks right in the first half (and overtime), left in the second. */
export function attackDir(side: Side, quarter: number): 1 | -1 {
  const firstHalf = quarter <= 2 || quarter >= 5;
  return (side === 0) === firstHalf ? 1 : -1;
}

type Spot = [number, number];
const BACKCOURT: Spot[] = [[8.9, 7.5], [11.9, 3], [11.9, 12], [10.1, 5.1], [9.5, 9.9]];
/** Corners, wings and top of the key, all just behind the 6.75 m line. */
const THREE: Spot[] = [[25.6, 0.6], [21.6, 2.5], [19.4, 7.5], [21.6, 12.5], [25.6, 14.4]];
const MID: Spot[] = [[22.3, 4.8], [21.8, 7.5], [22.3, 10.2]];
const POST: Spot[] = [[24.7, 5.7], [24.7, 9.3]];
const LANE: Spot[] = [[23.8, 4.75], [25.2, 4.75], [23.8, 10.25], [25.2, 10.25], [20.9, 3.6], [20.9, 11.4], [19.1, 7.5], [19.7, 2.4], [19.7, 12.6]];
const FT_SPOT: Pos = { x: 22, y: MID_Y };
/** Beside the backboard, not behind it. */
const INBOUND_SPOT: Pos = { x: -0.45, y: 5.1 };

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
      return { x: 25.4, y: MID_Y + ((salt % 3) - 1) * 0.6 };
    default:
      // Layups and dunks: the take-off spot a stride or two from the rim.
      return { x: 24, y: MID_Y + ((salt % 3) - 1) * 1.05 };
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
  const guarding: Record<string, string> = {};
  if (ctx.defence !== 'zone') guards.forEach((k, i) => (guarding[k] = offKeys[i]));

  const beats: Beat[] = [];
  let pendingFire: number[] = [];
  let holder: string = kOff(offIds[0]); // key of whoever has the ball
  let doubled: string | null = null;
  /** Where the ball is (normalised), for loose-ball actions. */
  let ballSpot: Ball = { x: 6, y: MID_Y, z: 0.9 };
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
  let posting: string | undefined;
  let reachers: string[] = [];
  let challenger: string | undefined;
  let blocking = false;
  let outOfBounds: string | undefined;
  /** Set after a shot hits the rim, until the rebound plays it off. */
  let rimHit: { contact: Ball; from: Pos } | null = null;

  const place = (k: string, p: Pos) => {
    at[k] = p;
    placed.add(k);
  };

  /** Who is guarding whom in the coming beat; the motion layer keeps them on their man frame by frame. */
  let marking: Record<string, string> = {};
  const settleDefence = () => {
    marking = {};
    const ball = at[holder] ?? ballSpot;
    defIds.forEach((_, i) => {
      const k = guards[i];
      if (placed.has(k)) return;
      if (ctx.defence === 'zone') {
        // Fixed spots; the zone only shades a step to the ball's side.
        const [x, y] = ZONE[defIds.indexOf(idOf(k))];
        at[k] = { x, y: y + (ball.y - MID_Y) * 0.08 };
        return;
      }
      const man = offKeys[i];
      // Nobody crowds the inbounder: their defender stands off the baseline and denies the pass.
      if (man === outOfBounds) at[k] = { x: DENY_INBOUND_X, y: at[man].y - 1.2 };
      else if (at[man]) {
        at[k] = guardSpot(at[man], ball, man === holder, pressing);
        marking[k] = man;
      }
    });
    if (doubled) {
      const t = at[kOff(doubled)];
      const i = offIds.indexOf(doubled);
      delete marking[guards[i]];
      delete marking[guards[(i + 1) % guards.length]];
      if (t) {
        at[guards[i]] = { x: t.x + 0.6, y: t.y - 0.6 };
        at[guards[(i + 1) % guards.length]] = { x: t.x + 0.6, y: t.y + 0.6 };
      }
    }
  };

  const push = (weight: number, ball: BallAction, fire: number[] = [], caption?: string, spotlight?: string, minSeconds?: number) => {
    if (spacing) spread(at, offKeys, (k) => (k === holder || k === outOfBounds || contact.includes(k) ? 0 : k === soft ? 0.15 : 1));
    if (autoDefence) settleDefence();
    else marking = {};
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
      // Backing down in the post is slow going: feet moving backwards, against a defender.
      const speed = k === posting ? POST_BACKDOWN_M_S : PACE_M_S[pace[k]] * factor(k);
      // Plus a moment to react and get up to speed.
      if (d > 0.9) travel = Math.max(travel, d / speed + 0.45);
    }
    const needed = Math.max(minSeconds ?? 0, Math.min(travel, 6));
    beats.push({
      players,
      pace,
      phase,
      spaced: spacing || undefined,
      contact: contact.length > 0 ? contact : undefined,
      jump: jumpers.length > 0 ? jumpers : undefined,
      posting,
      marking: Object.keys(marking).length > 0 ? { ...marking } : undefined,
      pressing: pressing || undefined,
      reach: reachers.length > 0 ? reachers : undefined,
      contest: challenger,
      block: blocking || undefined,
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
    posting = undefined;
    reachers = [];
    challenger = undefined;
    blocking = false;
    lastAt = {};
    for (const [k, p] of Object.entries(at)) lastAt[k] = { ...p };
    if (ball.kind === 'held' || ball.kind === 'pass' || ball.kind === 'toPlayer') {
      const k = ball.kind === 'held' ? ball.holder : ball.to;
      ballSpot = { ...at[k], z: 0.9 };
    } else {
      ballSpot = { ...toNorm(ball.to), z: ball.to.z };
    }
  };

  const dribble = (): BallAction => ({ kind: 'held', holder, dribble: true });
  const hold = (): BallAction => ({ kind: 'held', holder, dribble: false });
  /** Passes the ball to `to` if someone else has it: quick and flat, long enough to see it go. */
  /** Defenders standing in the lane between two spots, not counting the ones at either end. */
  const inLane = (a: Pos, b: Pos): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    return defIds.filter((id) => {
      const d = at[kDef(id)];
      const t = ((d.x - a.x) * dx + (d.y - a.y) * dy) / len2;
      return t > 0.12 && t < 0.88 && Math.hypot(a.x + dx * t - d.x, a.y + dy * t - d.y) < LANE_M;
    }).length;
  };
  /** The perimeter spot furthest from every teammate: where a player goes to keep the floor spread. */
  const openSpot = (k: string): Pos => {
    const spots = [...THREE.map(pos), { x: 19.4, y: MID_Y }];
    const room = (p: Pos) => Math.min(...offKeys.filter((o) => o !== k).map((o) => dist(at[o], p)));
    return spots.reduce((best, p) => (room(p) > room(best) ? p : best), spots[0]);
  };
  /**
   * Passes the ball to `to` if someone else has it, picking the pass a player would throw. With
   * `move`, the passer then relocates to the open spot; anyone passing out of the paint steps out.
   */
  const passTo = (to: string, weight = 0.28, caption?: string, move = false) => {
    if (to === holder || !at[to]) return;
    const from = holder;
    // Thrown from where the passer stands now (they may be about to move off), to where it is caught.
    const release = lastAt[from] ?? at[from];
    const d = dist(release, at[to]);
    const blocked = inLane(release, at[to]) > 0;
    if (from !== soft && from !== outOfBounds && !mustArrive.includes(from) && (move || dist(at[from], HOOP) < 4.5)) {
      at[from] = openSpot(from);
      paceFor[from] = 'jog';
    }
    const style: PassStyle = d > FLAT_PASS_M || (blocked && d > 6) ? 'lob' : blocked ? 'bounce' : 'chest';
    const flight = Math.max(0.3, d / PASS_SPEED[style]);
    holder = to;
    push(weight, { kind: 'pass', from, to, arc: style === 'lob' ? 0.8 + d * 0.06 : 0.05, style }, [], caption, to, flight);
  };
  const toFormation = () => offIds.forEach((id, i) => (at[kOff(id)] = pos(formation[i])));

  /** The ball's arc to the rim: its peak is 1 to 1.5 m above the iron, higher from further out. */
  const shotArc = (from: Pos, style: ShotStyle): number => {
    if (style === 'dunk') return 0;
    if (style === 'layup') return 0.45;
    const apex = RIM_HEIGHT + 1 + Math.min(0.5, dist(from, HOOP) * 0.04);
    return apex - (RELEASE_Z + RIM_HEIGHT) / 2;
  };
  /** Where a miss hits the iron: front, back or side, as seen from the shooter. */
  const rimContact = (from: Pos, salt: number): Ball => {
    const d = dist(from, HOOP) || 1;
    const turn = [0, 1.2, -1.2, Math.PI][salt % 4];
    const ux = (HOOP.x - from.x) / d;
    const uy = (HOOP.y - from.y) / d;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    return { x: HOOP.x - (ux * c - uy * s) * RIM_CONTACT_M, y: HOOP.y - (ux * s + uy * c) * RIM_CONTACT_M, z: RIM_HEIGHT + 0.06 };
  };

  // ---- Starting positions: carry over where everyone was.
  offIds.forEach((id, i) => (at[kOff(id)] = pos(BACKCOURT[i])));
  defIds.forEach((id, i) => (at[kDef(id)] = { x: BACKCOURT[i][0] + 9, y: BACKCOURT[i][1] }));
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
    at[pg] = { x: 2.7, y: 8.4 };
    offIds.forEach((id, i) => {
      if (i > 0 && i < offIds.length - 1) at[kOff(id)] = pos(BACKCOURT[i]);
    });
    // The team that just scored turns and heads back while the ball comes in; only a press stays up.
    const retreat = !pressing && ctx.defence !== 'zone';
    if (retreat) guards.forEach((k, i) => place(k, { x: Math.max(at[k].x, 12.5 + i * 1.2), y: at[k].y + (ZONE[i][1] - at[k].y) * 0.5 }));
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
      at[pg] = { x: BRING_UP_X, y: MID_Y + (at[pg].y - MID_Y) * 0.4 };
      offIds.forEach((id, i) => {
        if (i > 0) at[kOff(id)] = { x: formation[i][0] - (pressing ? 7.2 : 0), y: formation[i][1] };
      });
      if (trailer) paceFor[trailer] = 'run';
      if (pressing) paceFor[pg] = 'run';
      else for (const k of guards) if (at[k].x < BRING_UP_X + 2.4) paceFor[k] = 'run';
      push(0.8, dribble(), [], `${n(off, offIds[0])} brings it up${pressed}…`, pg);
    }
    pressing = false;
    if (!pressBreak) {
      // Set up: into the formation, the defence matched up; the point guard reads it for a moment.
      // Nothing starts until the slowest player is in place, so the action begins from a real shape.
      // The margin covers reading the play and turning to run, which real players need too.
      phase = 'setUp';
      toFormation();
      spread(at, offKeys, (k) => (k === holder ? 0 : 1));
      // With time on the clock, the guard holds out near half court while the defence gets back,
      // then walks into his spot: he never stands at the top of the key with nobody between him and
      // the rim. (Had the defence not been back, the engine would have called a fast break.)
      const pgSpot = { ...at[pg] };
      const waitOut = seconds >= EARLY_OFFENCE_SECONDS;
      if (waitOut) at[pg] = { x: Math.min(pgSpot.x, HOOP.x - 11), y: pgSpot.y };
      settleDefence();
      // The defence sprints back.
      for (const k of guards) paceFor[k] = 'sprint';
      if (trailer) paceFor[trailer] = 'run';
      const slowest = Math.max(...Object.keys(at).map((k) => dist(origin[k], at[k]) / (PACE_M_S[paceFor[k] ?? offPace] * factor(k))));
      const spent = beats.reduce((sum, b) => sum + (b.minSeconds ?? 0), 0);
      const share = seconds >= EARLY_OFFENCE_SECONDS ? 1 : 0.6;
      push(0.45, dribble(), [], startX < BRING_UP_X ? undefined : `${n(off, offIds[0])} brings it up…`, pg, Math.min(7, Math.max(0.3, (slowest * 1.2 + 1.5) * share - spent)));
      if (waitOut) {
        // The walk in starts from standing: time to get going and to pull up at the spot.
        const walkIn = dist(at[pg], pgSpot) / (PACE_M_S[offPace] * factor(pg) * 0.75) + 0.5;
        at[pg] = pgSpot;
        push(0.3, dribble(), [], undefined, pg, Math.max(0.8, walkIn));
      }
    }
    phase = 'play';
    defPace = 'run'; // from here on they are reacting to the offence
  } else {
    phase = 'play';
    autoDefence = false;
  }

  let setupDone = false;

  /**
   * What the offence runs before the ball moves on: a ball screen, a drive that draws help, a post
   * entry, or the guard probing across the top. Nobody just stands with the ball. Returns the passes it used.
   */
  const setPlay = (avoid: string, assister: string | null, screen: boolean, passBudget: number, shotType?: ShotType): number => {
    if (seconds < EARLY_OFFENCE_SECONDS || !holder.startsWith(`${off}:`)) return 0;
    const handler = holder;
    const h = { ...at[handler] };
    const handlerName = n(off, idOf(handler));
    const bigs = offKeys.slice(3).filter((k) => k !== handler && k !== assister);
    const postBig = bigs.filter((k) => k !== avoid).sort((a, b) => dist(at[a], h) - dist(at[b], h))[0];
    // How likely each play is for this attack; the shot's own screen or post-up is not repeated.
    const weights: Record<string, number> = screen
      ? { drive: 1, probe: 1 }
      : {
          pickAndRoll: { screen: 7, drive: 2, probe: 1, post: 0 },
          inside: { screen: 2, drive: 2, probe: 1, post: 5 },
          three: { screen: 3, drive: 5, probe: 2, post: 0 },
          balanced: { screen: 3, drive: 3, probe: 1.5, post: 2.5 },
          fastBreak: { screen: 3, drive: 4, probe: 3, post: 0 },
        }[ctx.focus];
    if (bigs.length === 0) weights.screen = 0;
    // A post-up shot posts up on its own: a second big on the same block would only crowd it.
    if (!postBig || passBudget < 1 || shotType === 'post') weights.post = 0;
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let roll = (((seed >>> 11) % 1000) / 1000) * total;
    const play = Object.keys(weights).find((k) => (roll -= weights[k]) < 0) ?? 'probe';
    // Which way the handler goes: back towards the middle from a wing, either way from the top.
    const dir = Math.abs(h.y - MID_Y) > 2 ? Math.sign(MID_Y - h.y) : (seed >>> 5) & 1 ? 1 : -1;

    if (play === 'screen') {
      const screener = bigs.sort((a, b) => dist(at[a], h) - dist(at[b], h))[0];
      const screenerName = n(off, idOf(screener));
      // The big sets the screen on the defender's hip; the handler runs them into it.
      at[screener] = { x: h.x + 0.9, y: h.y - dir * 0.7 };
      paceFor[screener] = 'run';
      contact = [handler, screener];
      push(0.3, dribble(), [], `${screenerName} comes up to set a screen for ${handlerName}…`, handler, 0.8);
      // Off the screen: the handler turns the corner, the big rolls to the rim or pops out.
      at[handler] = insideCourt({ x: h.x + 2, y: h.y + dir * 2.6 });
      at[screener] = (seed >>> 7) & 1 ? { x: HOOP.x - 2.3, y: MID_Y - dir * 0.8 } : insideCourt({ x: h.x - 0.4, y: h.y - dir * 2.6 });
      paceFor[handler] = 'run';
      paceFor[screener] = 'run';
      push(0.35, dribble(), [], `…${handlerName} comes off it`, handler, 0.7);
      return 0;
    }
    if (play === 'drive') {
      // Attacks a gap; the nearest help defender steps across, and the ball goes back out after.
      const spot = { x: Math.min(HOOP.x - 3, h.x + 3.2), y: h.y + (MID_Y - h.y) * 0.6 };
      at[handler] = spot;
      paceFor[handler] = 'sprint';
      const help = defIds
        .map(kDef)
        .filter((k) => guarding[k] !== handler)
        .sort((a, b) => dist(at[a], spot) - dist(at[b], spot))[0];
      if (help) {
        place(help, { x: spot.x + 1, y: spot.y + (spot.y < MID_Y ? 0.6 : -0.6) });
        paceFor[help] = 'run';
      }
      push(0.35, dribble(), [], `${handlerName} attacks the gap…`, handler, 0.7);
      return 0;
    }
    if (play === 'post') {
      const bigName = n(off, idOf(postBig));
      const spot = pos(POST[h.y < MID_Y ? 0 : 1]);
      // The big seals his man on the block, then gets the entry pass and backs down.
      at[postBig] = spot;
      paceFor[postBig] = 'run';
      mustArrive = [postBig];
      push(0.3, dribble(), [], `${bigName} posts up…`, postBig, 0.6);
      passTo(postBig, 0.28, `${handlerName} feeds ${bigName} in the post…`);
      at[postBig] = { x: spot.x + 0.5, y: spot.y + (MID_Y - spot.y) * 0.15 };
      posting = postBig;
      push(0.35, dribble(), [], `${bigName} backs down…`, postBig, 0.9);
      return 1;
    }
    // Probing: across the top to the other side, staying outside the arc.
    const target = { x: h.x - 0.3, y: h.y + dir * 3 };
    const fromRim = dist(target, HOOP);
    at[handler] = fromRim < 7.1 ? { x: HOOP.x + ((target.x - HOOP.x) / fromRim) * 7.1, y: HOOP.y + ((target.y - HOOP.y) / fromRim) * 7.1 } : target;
    paceFor[handler] = 'jog';
    push(0.35, dribble(), [], undefined, handler, 0.8);
    return 0;
  };

  /** Moves the ball around before the real action: 1 to 3 passes in all, fewer if the clock is short. */
  const ballMovement = (avoid: string, assister: string | null, screen: boolean, shotType?: ShotType) => {
    if (setupDone) return;
    setupDone = true;
    const wanted = seconds < EARLY_OFFENCE_SECONDS ? 1 : seconds < 14 ? 2 : 3;
    const later = assister ? 2 : 1; // a swing has to come back: to the passer, then the finisher
    const nothingLater = !screen && !assister && avoid === holder;
    const used = setPlay(avoid, assister, screen, wanted - later - (nothingLater ? 1 : 0), shotType);
    const swings = Math.max(nothingLater ? 1 : 0, wanted - later - used);
    const candidates = offKeys.filter((k) => k !== avoid && k !== assister);
    // The ball moves round the floor to whoever needs it next, one open neighbour at a time:
    // never across the court through the defence.
    const goal = assister ?? avoid;
    let swung = 0;
    for (let s = 0; s < swings; s++) {
      const pool = candidates.filter((k) => k !== holder);
      if (pool.length === 0) break;
      const open = pool.filter((k) => dist(at[holder], at[k]) <= SWING_M && inLane(at[holder], at[k]) === 0);
      const choices = open.length > 0 ? open : [...pool].sort((a, b) => dist(at[holder], at[a]) - dist(at[holder], at[b])).slice(0, 1);
      const score = (k: string, j: number) =>
        (at[goal] ? dist(at[k], at[goal]) + (inLane(at[k], at[goal]) > 0 ? 4 : 0) : 0) + ((seed >>> (s * 3 + j)) % 3) * 1.2;
      const to = choices.reduce((best, k, j) => (score(k, j) < score(best, choices.indexOf(best)) ? k : best), choices[0]);
      // A player on the ball's side clears out to the weak side, keeping the floor balanced.
      const ballSide = at[to].y < COURT.h / 2;
      const cutters = offKeys.filter((k) => k !== holder && k !== to && k !== avoid && at[k].y < COURT.h / 2 === ballSide && Math.abs(at[k].y - COURT.h / 2) > 1.5);
      const cutter = cutters[(seed >>> (s + 4)) % Math.max(1, cutters.length)];
      if (cutter) {
        at[cutter] = { x: at[cutter].x, y: COURT.h - at[cutter].y };
        paceFor[cutter] = 'run';
      }
      passTo(to, 0.3, undefined, true);
      push(0.3, hold(), [], undefined, undefined, 0.35);
      swung++;
    }
    // If the pass still to come would have to cross the defence, a real team makes one more pass to
    // get there, as long as there is room for it.
    if (goal !== holder && at[goal] && inLane(at[holder], at[goal]) >= 2 && used + swung + later < 3) {
      const relay = offKeys
        .filter((k) => k !== holder && k !== goal && k !== avoid && k !== assister)
        .filter((k) => inLane(at[holder], at[k]) === 0 && inLane(at[k], at[goal]) === 0)
        .sort((a, b) => dist(at[holder], at[a]) + dist(at[a], at[goal]) - (dist(at[holder], at[b]) + dist(at[b], at[goal])))[0];
      if (relay) {
        passTo(relay, 0.3, undefined, true);
        push(0.3, hold(), [], undefined, undefined, 0.35);
      }
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
        const lanes: Pos[] = [{ x: 23.2, y: 2.1 }, { x: 23.2, y: 12.9 }, { x: 18.5, y: MID_Y }, { x: 13.7, y: MID_Y }];
        runners.forEach((k, j) => (at[k] = lanes[j] ?? lanes[3]));
        at[leader] = { x: 21.4, y: MID_Y };
        back.forEach((k, j) => (at[k] = j === 0 ? { x: 24.4, y: MID_Y } : { x: 22.6, y: MID_Y + (j % 2 === 0 ? 2.1 : -2.1) * Math.ceil(j / 2) }));
        // Anyone beaten chases flat out; they only catch up if they are quicker.
        beaten.forEach((k, j) => (at[k] = { x: 23.8, y: 3.9 + j * 2.4 }));
        const attackers = Math.min(3, offIds.length);
        const caption = back.length < attackers ? `${n(off, ev.leaderId)} pushes it: ${attackers} on ${back.length}!` : `${n(off, ev.leaderId)} pushes it in transition!`;
        push(0.75, dribble(), [i], caption, leader);
        break;
      }
      case 'pressBroken': {
        const h = kOff(ev.handlerId);
        passTo(h, 0.22);
        at[h] = { x: Math.max(17.3, at[h].x), y: MID_Y };
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
        if (!fastBreak && ev.shotType !== 'putback' && ev.shotType !== 'pressBreak' && !doubled) ballMovement(shooterKey, assistKey, screened, ev.shotType);

        if (ev.shotType === 'pnrRoll' && assistKey) {
          // Screen, roll, pocket pass.
          passTo(assistKey);
          const h = at[assistKey];
          at[shooterKey] = { x: h.x + 0.75, y: h.y + (h.y < MID_Y ? 0.6 : -0.6) };
          contact = [assistKey, shooterKey];
          push(0.4, dribble(), [], `${passerName} calls for the screen from ${shooterName}…`, shooterKey, 0.7);
          at[assistKey] = { x: h.x + 2.1, y: h.y + (h.y < MID_Y ? 1.5 : -1.5) };
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
          at[screener] = { x: h.x + 0.75, y: h.y + 0.6 };
          contact = [shooterKey, screener];
          push(0.35, dribble(), [], `${shooterName} uses the screen…`, shooterKey, 0.7);
          at[shooterKey] = { ...spot };
          paceFor[shooterKey] = 'run';
          push(0.4, dribble(), [], `${shooterName} pulls up…`, shooterKey);
        } else if (ev.shotType === 'post') {
          // The big gets to the block before anyone feeds him.
          at[shooterKey] = { x: spot.x - 0.45, y: spot.y };
          mustArrive = [shooterKey];
          push(0.35, dribble());
          if (assistKey && assistKey !== holder) passTo(assistKey);
          passTo(shooterKey, 0.28, `${n(off, idOf(holder))} feeds ${shooterName} in the post…`);
          at[shooterKey] = { ...spot };
          posting = shooterKey;
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
            at[assistKey] = { x: Math.min(23.8, at[assistKey].x + 1.8), y: at[assistKey].y + (MID_Y - at[assistKey].y) * 0.4 };
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
        // Help has to get there before a block can happen: the shooter gathers while it comes.
        const toRim = dist(from, HOOP) || 1;
        const basketSide = { x: from.x + ((HOOP.x - from.x) / toRim) * 0.85, y: from.y + ((HOOP.y - from.y) / toRim) * 0.85 };
        if (ev.blockerId && dist(at[kDef(ev.blockerId)], from) > 1.5) {
          place(kDef(ev.blockerId), basketSide);
          paceFor[kDef(ev.blockerId)] = 'sprint';
          mustArrive = [kDef(ev.blockerId)];
          push(0.15, { kind: 'held', holder: shooterKey, dribble: true }, [], undefined, shooterKey);
        }
        if (style === 'layup' || style === 'dunk') at[shooterKey] = { x: 25.45, y: MID_Y + (from.y - MID_Y) * 0.3 };
        const shotDist = dist(from, HOOP);
        const minSeconds = style === 'jumper' ? 1.1 + shotDist * 0.05 : 0.85;
        const arc = shotArc(from, style);
        // Someone always comes out at the shooter, on the basket side: the blocker if there is one,
        // otherwise whoever is nearest. Whether they get there in time is down to their legs.
        const nearest = defIds.map(kDef).sort((a, b) => dist(at[a], from) - dist(at[b], from))[0];
        challenger = ev.blockerId ? kDef(ev.blockerId) : nearest;
        blocking = !!ev.blockerId;
        place(challenger, { x: at[shooterKey].x + ((HOOP.x - from.x) / toRim) * 0.85, y: at[shooterKey].y + ((HOOP.y - from.y) / toRim) * 0.85 });
        paceFor[challenger] = 'sprint';
        if (ev.blockerId) {
          push(0.8, { kind: 'fromPlayer', from: shooterKey, to: ballAbs({ x: from.x - 2.1, y: from.y + 1.5, z: 0.3 }), arc: 0.9, style }, [i], undefined, undefined, minSeconds);
        } else if (ev.made) {
          push(0.8 + shotDist * 0.033, { kind: 'fromPlayer', from: shooterKey, to: ballAbs(RIM), arc, style }, [i], undefined, undefined, minSeconds);
          spacing = false;
          autoDefence = false;
          push(0.2, { kind: 'fixed', from: ballAbs(RIM), to: ballAbs(NET), arc: 0 }, [], undefined, undefined, style === 'dunk' ? 0.2 : 0.3);
        } else {
          const contactAt = rimContact(from, seed + i);
          push(0.8 + shotDist * 0.033, { kind: 'fromPlayer', from: shooterKey, to: ballAbs(contactAt), arc, style }, [i], undefined, undefined, minSeconds);
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
          const reach = 1.05 + dist(from, HOOP) * 0.25 + ((seed + i) % 3) * 0.3;
          const carom = insideCourt({ x: Math.min(25.6, HOOP.x + Math.cos(away) * reach), y: HOOP.y + Math.sin(away) * reach });
          const rivals = [...offKeys, ...defIds.map(kDef)]
            .filter((o) => o !== k)
            .sort((a, b) => dist(at[a], carom) - dist(at[b], carom))
            .slice(0, 3);
          at[k] = { ...carom };
          paceFor[k] = 'sprint';
          rivals.forEach((o, j) => {
            const turn = away + 2 + j * 1.15;
            at[o] = { x: carom.x + Math.cos(turn) * BODY_M * 1.2, y: carom.y + Math.sin(turn) * BODY_M * 1.2 };
            paceFor[o] = 'sprint';
          });
          const top: Ball = { ...carom, z: 3.35 };
          reachers = [k, ...rivals];
          push(0.3, { kind: 'fixed', from: ballAbs(hit), to: ballAbs(top), arc: 0.35 }, [], undefined, undefined, 0.55);
          jumpers = [k, ...rivals];
          reachers = [k, ...rivals];
          push(0.25, { kind: 'toPlayer', from: ballAbs(top), to: k, arc: 0, high: true }, [i], undefined, k, 0.45);
        } else {
          at[k] = { x: HOOP.x - 1.2 - (i % 3) * 0.3, y: HOOP.y + ((i % 5) - 2) * 0.6 };
          paceFor[k] = 'sprint';
          push(0.35, { kind: 'toPlayer', from: ballAbs({ ...ballSpot, z: Math.max(ballSpot.z, 2.4) }), to: k, arc: 0.75 }, [i], undefined, k, 0.6);
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
            place(st, { x: h.x + 0.6, y: h.y + 0.55 });
            paceFor[st] = 'sprint';
            mustArrive = [st];
            push(0.3, dribble());
            place(st, { x: h.x - 0.45, y: h.y + 0.65 });
            slowBeat = true;
            push(0.4, { kind: 'pass', from: handler, to: st, arc: 0.06 }, [i], `${stName} reaches in…`, st, 1.1);
          } else if (way === 1) {
            // Intercepted: the handler looks for a teammate and the defender jumps the lane.
            const target = offKeys.filter((k) => k !== handler).sort((a, b) => dist(at[a], h) - dist(at[b], h))[0];
            place(st, { x: h.x + (at[target].x - h.x) * 0.55, y: h.y + (at[target].y - h.y) * 0.55 });
            paceFor[st] = 'sprint';
            mustArrive = [st];
            // If the man jumping the lane was the handler's own defender, a teammate picks the handler
            // up: nobody is left with an open run to the rim while he looks for his pass.
            const cover = guarding[st] === handler ? defIds.map(kDef).filter((k) => k !== st).sort((a, b) => dist(at[a], h) - dist(at[b], h))[0] : undefined;
            if (cover) {
              place(cover, guardSpot(h, h, true, false));
              paceFor[cover] = 'sprint';
            }
            push(0.3, hold(), [], `${n(off, idOf(handler))} looks for ${n(off, idOf(target))}…`, handler, 0.5);
            slowBeat = true;
            placed.add(st);
            if (cover) placed.add(cover);
            push(0.4, { kind: 'pass', from: handler, to: st, arc: 0.09 }, [i], `${stName} jumps the passing lane!`, st, 1.0);
          } else {
            // Deflected: the ball pops loose and both of them scramble for it.
            const loose: Ball = { ...insideCourt({ x: h.x - 1.8, y: h.y + (h.y < MID_Y ? 1.5 : -1.5) }, 0.9), z: 0.18 };
            place(st, { x: h.x - 0.45, y: h.y + 0.65 });
            paceFor[st] = 'sprint';
            mustArrive = [st];
            push(0.3, dribble());
            slowBeat = true;
            placed.add(st);
            push(0.25, { kind: 'fromPlayer', from: handler, to: ballAbs(loose), arc: 0.18, style: 'throw' }, [], `${stName} gets a hand on it!`, st, 0.7);
            place(st, { x: loose.x, y: loose.y });
            at[handler] = { x: loose.x + 0.55, y: loose.y - 0.6 };
            paceFor[st] = 'sprint';
            paceFor[handler] = 'sprint';
            push(0.25, { kind: 'fixed', from: ballAbs(loose), to: ballAbs({ ...loose, z: 0.09 }), arc: 0.4 }, [], 'Loose ball!', st, 0.7);
            placed.add(st);
            push(0.15, { kind: 'toPlayer', from: ballAbs({ ...loose, z: 0.09 }), to: st, arc: 0.09 }, [i], undefined, st, 0.3);
          }
          holder = st;
          spacing = false;
          autoDefence = false;
        } else if (ev.cause === 'travel' || ev.cause === 'shotClock') {
          // A whistle, not a loose ball: the handler stops and gives it up.
          push(0.3, ev.cause === 'travel' ? dribble() : hold());
          push(0.3, hold(), [i], undefined, handler, 0.8);
        } else if (ev.cause === 'offensiveFoul') {
          // A charge: the nearest defender plants himself in the handler's path to the rim, and the
          // handler drives into him.
          const man = defIds.map(kDef).sort((a, b) => dist(at[a], h) - dist(at[b], h))[0];
          const toRim = dist(h, HOOP) || 1;
          const step = Math.min(2.5, toRim - 1);
          const planted = { x: h.x + ((HOOP.x - h.x) / toRim) * step, y: h.y + ((HOOP.y - h.y) / toRim) * step };
          place(man, planted);
          paceFor[man] = 'sprint';
          // Contact, chest to chest, not running straight through him.
          at[handler] = { x: planted.x - ((HOOP.x - h.x) / toRim) * 1, y: planted.y - ((HOOP.y - h.y) / toRim) * 1 };
          paceFor[handler] = 'jog';
          push(0.3, dribble());
          placed.add(man);
          push(0.3, hold(), [i], undefined, handler, 0.8);
        } else {
          push(0.35, { kind: 'fromPlayer', from: handler, to: ballAbs({ x: h.x - 1.5, y: h.y < MID_Y ? -0.45 : COURT.h + 0.45, z: 0.3 }), arc: 0.45, style: 'throw' }, [i], undefined, undefined, 0.6);
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
  return { offence: off, dir, guards: guarding, beats, clockStart: ctx.clockStart, clockEnd: ctx.clockEnd, quarter: ctx.quarter };
}

// ---------------------------------------------------------------------------
// Playback helpers

/**
 * A beat where the ball is in flight on its own (a shot, a rebound, a loose ball) lasts exactly as
 * long as that flight, so it never drifts in slow motion. Passes are timed by the ball itself.
 */
function flightOnly(b: Beat): boolean {
  return b.minSeconds !== undefined && (b.ball.kind === 'fromPlayer' || b.ball.kind === 'toPlayer' || b.ball.kind === 'fixed');
}

/** Real seconds per beat: flights take their own time, the rest share what is left (scaled by speed). */
export function beatDurations(script: Script, totalSeconds: number, minScale = 1): number[] {
  const fixed = script.beats.reduce((s, b) => s + (flightOnly(b) ? (b.minSeconds ?? 0) * minScale : 0), 0);
  const weights = script.beats.reduce((s, b) => s + (flightOnly(b) ? 0 : b.weight), 0) || 1;
  // Everything else always keeps some of the time, even when the flights alone fill it.
  const left = Math.max(totalSeconds - fixed, totalSeconds * 0.3);
  return script.beats.map((b) => (flightOnly(b) ? (b.minSeconds ?? 0) * minScale : Math.max((b.weight / weights) * left, (b.minSeconds ?? 0) * minScale)));
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
