// Turns one possession's events into an animation script: a list of "beats". Each beat gives
// every player a spot to run to and says what the ball is doing (held and dribbled, passed,
// shot, loose) and how fast each player gets there. The motion layer (motion.ts) turns that into
// running, and works out where the ball is from whoever holds it. Pure: no DOM, no timing. Everything is court space: metres on
// the NBA court (engine/court.ts), plus height for the ball; internally everything is laid out as if the offence attacks to the right.

import { FREE_THROW_LINE_X, HALF_X, KEY_HALF_WIDTH, fromHoop, shotPoint } from '../../engine/court';
import { other } from '../../engine/state';
import type { DefenceScheme, KeyMatchup, OffensiveFocus, ShotType, Side, Tempo, TimedEvent, Transition } from '../../engine/types';
import { BODY_M, COURT, FORMATIONS, HOOP, HOOP_X, MID_Y, MIN_SPACING_M, ZONE, guardSpot, insideCourt, spread } from './formations';

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
  /** The ball is dead (a whistle, free throws, a throw-in being set up): the clock stands still and so do the players, once they are in place. */
  dead?: boolean;
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
  /** Players only passing through their spot, on their way further: they keep their pace into it. */
  through?: string[];
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
  /** After a dead ball, how the ball comes back into play. */
  restart?: Restart;
  /** The offence's tempo: how fast the ball is brought up. */
  tempo?: Tempo;
  name: (side: Side, id: string) => string;
}

/** How the ball is put back in play when a possession starts from a dead ball. */
export type Restart =
  /** After a score: picked up under the basket and thrown in from the end line. */
  | { kind: 'made' }
  /** After a violation or a turnover: from the sideline nearest to `at` (absolute court metres). */
  | { kind: 'sideline'; at: Pos }
  /** The opening jump ball, and overtime. */
  | { kind: 'tip' }
  /** A quarter that starts with a throw-in at the centre line. */
  | { kind: 'centre' };

/** The three officials. They are on the floor with the players, but never on a team. */
export const REFS = ['ref:0', 'ref:1', 'ref:2'];
export const isRef = (key: string) => key.startsWith('ref:');

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
/** Just short of half court. */
const BRING_UP_X = HALF_X - 0.6;
/** How the ball comes up the floor at each tempo, when nobody is pushing it or pressing. */
const BRING_UP_PACE: Record<Tempo, Pace> = { slow: 'walk', normal: 'jog', fast: 'run' };
/** Over half court by then at the latest, well inside the eight seconds. */
const OVER_HALF_BY_S = 6;
/** When a slow team has to hurry a little to make that, it aims to be over by then. */
const SLOW_OVER_HALF_S = 5.5;
/** Where a slow team's guard takes the outlet: the wing, level with the free-throw line. */
const OUTLET_X = 5.8;
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
/** Where the five wait in their own half: metres back from half court, and across from the middle. */
const BACKCOURT: Spot[] = [[-5.1, 0], [-2.1, -4.57], [-2.1, 4.57], [-3.9, -2.44], [-4.5, 2.44]].map(([dx, across]) => [HALF_X + dx, MID_Y + across]);
/** Corners, wings and top of the key, all just behind the three-point line. */
const THREE: Spot[] = [[0.82, -7.02], [5.17, -5.36], [7.53, 0], [5.17, 5.36], [0.82, 7.02]].map(([b, a]) => hoopSpot(b, a));
const MID: Spot[] = [[4.27, -2.8], [4.75, 0], [4.27, 2.8]].map(([b, a]) => hoopSpot(b, a));
const POST: Spot[] = [[1.73, -1.8], [1.73, 1.8]].map(([b, a]) => hoopSpot(b, a));
/** The shooter's feet just behind the free-throw line. */
const FT_SPOT: Pos = { x: FREE_THROW_LINE_X - 0.15, y: MID_Y };
/** Free-throw lane places, from the basket out (x), either side of the lane (y). */
const LANE_X = [1.03, 1.93, 2.83].map((b) => HOOP_X - b);
const LANE_Y = [MID_Y - KEY_HALF_WIDTH - 0.46, MID_Y + KEY_HALF_WIDTH + 0.46];
/** On the last free throw the lane steps in as the ball is released. */
const STEP_IN_M = 0.9;
/** Just off the floor: where throw-ins are taken and officials stand. */
const OUT_M = 0.45;
/** The trail official works the table side, the centre the far side, the lead the end line. */
const TRAIL_Y = -0.4;
const CENTRE_Y = COURT.h + OUT_M;
/** The lead works the end line a step back from it, out of the way of an inbounder stepping back on. */
const END_LINE_X = COURT.w + 0.8;
/** The lead stands here to give the shooter the ball at a free throw: on the end line, beside the lane. */
const FT_LEAD: Pos = { x: END_LINE_X, y: MID_Y + 3.2 };

const pos = ([x, y]: Spot): Pos => ({ x, y });
/** A spot `back` metres out from the hoop and `across` from the middle, as a [x, y] pair. */
function hoopSpot(back: number, across: number): Spot {
  const p = fromHoop(back, across);
  return [p.x, p.y];
}

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
      return { x: HOOP_X - 1.03, y: MID_Y + ((salt % 3) - 1) * 0.6 };
    default:
      // Layups and dunks: the take-off spot a stride or two from the rim.
      return { x: HOOP_X - 2.43, y: MID_Y + ((salt % 3) - 1) * 1.05 };
  }
}

/** The point `r` metres from the hoop on the line out through `p`: where a finish at `p` takes off from. */
function outFrom(p: Pos, r: number): Pos {
  const d = Math.hypot(p.x - HOOP_X, p.y - MID_Y);
  const ux = d > 0.2 ? (p.x - HOOP_X) / d : -1;
  const uy = d > 0.2 ? (p.y - MID_Y) / d : 0;
  return { x: HOOP_X + ux * r, y: MID_Y + uy * r };
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
  /** Players going on past their spot in the next beat, who must not pull up at it. */
  let through: string[] = [];
  let slowBeat = false;
  /** Where everyone was heading in the previous beat, to tell how far this beat asks them to go. */
  let lastAt: Record<string, Pos> = {};
  /** Who ran or sprinted a fair way in the previous beat, so is already up to speed. */
  let running = new Set<string>();
  let phase: Phase = 'play';
  /** The offence keeps its spacing; the defence follows its scheme. Both stop once a shot is up. */
  let spacing = true;
  let autoDefence = true;
  let pressing = false;
  /** Defenders scripted for the next beat, who the scheme leaves alone. */
  let placed = new Set<string>();
  /** Defenders getting back while the ball is brought in, who the scheme leaves alone until it is. */
  let holdBack = new Set<string>();
  /** Teammates meant to be close in the next beat (a screen). */
  let contact: string[] = [];
  /** The player the action is about (the shooter): gives way only to the ball handler. */
  let soft: string | null = null;
  /** Where the shooter goes up from: once there, he holds it and teammates give way round him. */
  let shotAt: Pos | null = null;
  let jumpers: string[] = [];
  let posting: string | undefined;
  let reachers: string[] = [];
  let challenger: string | undefined;
  let blocking = false;
  let outOfBounds: string | undefined;
  /** Where a sideline throw-in is taken from (null for one from the end line). */
  let throwFrom: Pos | null = null;
  /** The next beat is a dead ball. */
  let deadBeat = false;
  /** How fast each player goes to his place at a dead ball: walking, or jogging a long way. */
  let restPace: Record<string, Pace> = {};
  /** Officials told where to stand while they handle the ball; the rest follow the play. */
  let refSpot: Record<string, Pos> = {};
  /** Two officials swap between lead and trail as the ball changes ends; the centre stays on the far side. */
  let lead = REFS[0];
  let trail = REFS[1];
  const centre = REFS[2];
  /** A shooting foul on a basket that counts: its whistle comes with the shot. */
  let andOne: TimedEvent | null = null;
  let andOneAt = -1;
  /** Set after a shot hits the rim, until the rebound plays it off. */
  let rimHit: { contact: Ball; from: Pos } | null = null;

  /** The shooter, once at the spot he goes up from: he holds it, and teammates give way round him. */
  const holding = (k: string) => k === soft && !!shotAt && dist(at[k], shotAt) < 0.05;
  /**
   * A shooter set at his spot is not crowded: the man with the ball (or about to get it), who is on
   * the move anyway, keeps clear of him, at the nearest place far enough away that is on the floor.
   */
  const clearOfShooter = (k: string) => {
    if (!soft || k === soft || !holding(soft) || !at[k] || dist(at[k], at[soft]) >= MIN_SPACING_M) return;
    const s0 = at[soft];
    const p0 = at[k];
    let best: Pos | null = null;
    for (let turn = 0; turn < 24; turn++) {
      const a = (turn / 24) * Math.PI * 2;
      const c = { x: s0.x + Math.cos(a) * (MIN_SPACING_M + 0.05), y: s0.y + Math.sin(a) * (MIN_SPACING_M + 0.05) };
      const inside = insideCourt(c);
      if (inside.x !== c.x || inside.y !== c.y) continue;
      if (!best || dist(c, p0) < dist(best, p0)) best = c;
    }
    if (best) at[k] = best;
  };

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
      if (placed.has(k) || holdBack.has(k)) return;
      if (ctx.defence === 'zone') {
        // A 2-3: each holds his area, the whole shape shifting towards the ball's side.
        const [x, y] = ZONE[defIds.indexOf(idOf(k))];
        at[k] = { x: x + (Math.min(ball.x, x) - x) * 0.12, y: y + (ball.y - MID_Y) * 0.3 };
        return;
      }
      const man = offKeys[i];
      // Nobody crowds the inbounder: their defender stands off the baseline and denies the pass.
      if (man === outOfBounds) at[k] = throwFrom ? { x: throwFrom.x, y: throwFrom.y < MID_Y ? 1.1 : COURT.h - 1.1 } : { x: DENY_INBOUND_X, y: at[man].y - 1.2 };
      else if (at[man]) {
        at[k] = guardSpot(at[man], ball, man === holder, pressing);
        marking[k] = man;
      }
    });
    // Nobody walks into a zone unchallenged: whoever's area the ball comes into steps out to it.
    if (ctx.defence === 'zone' && holder.startsWith(`${off}:`) && at[holder] && dist(at[holder], HOOP) < 10) {
      const on = guards.filter((k) => !placed.has(k) && !holdBack.has(k)).sort((a, b) => dist(at[a], ball) - dist(at[b], ball))[0];
      if (on) {
        at[on] = guardSpot(ball, ball, true, false);
        marking[on] = holder;
      }
    }
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

  /**
   * Where an official goes with the play: the trail behind the ball on the table side, the centre
   * level with it on the far side, the lead ahead of it, down the sideline and onto the end line.
   */
  const officiate = (r: string): Pos => {
    const b = at[holder] ?? ballSpot;
    if (r === lead) {
      // Down the table sideline ahead of the ball, round the corner once it is into the half court.
      if (b.x < COURT.w / 2) return { x: Math.min(COURT.w - 1, Math.max(at[lead].x, b.x + 10)), y: TRAIL_Y };
      if (b.x < HALF_X + 3.7) return { x: COURT.w - 0.2, y: TRAIL_Y };
      return { x: END_LINE_X, y: Math.max(MID_Y - 4.3, Math.min(MID_Y + 4.3, MID_Y + (b.y - MID_Y) * 0.6)) };
    }
    if (r === trail) return { x: Math.max(1, Math.min(COURT.w - 7.5, b.x - 3)), y: TRAIL_Y };
    return { x: Math.max(3, Math.min(COURT.w - 5, b.x + 1)), y: CENTRE_Y };
  };

  const push = (weight: number, ball: BallAction, fire: number[] = [], caption?: string, spotlight?: string, minSeconds?: number) => {
    if (spacing && holder) clearOfShooter(holder);
    if (spacing) spread(at, offKeys, (k) => (k === holder || k === outOfBounds || contact.includes(k) || holding(k) ? 0 : k === soft ? 0.15 : 1));
    if (autoDefence) settleDefence();
    else marking = {};
    for (const k of Object.keys(at)) if (k !== outOfBounds && !isRef(k)) at[k] = insideCourt(at[k]);
    for (const r of REFS) at[r] = refSpot[r] ?? officiate(r);
    const players: Record<string, Pos> = {};
    const pace: Record<string, Pace> = {};
    for (const [k, p] of Object.entries(at)) {
      players[k] = toAbs(p);
      pace[k] = paceFor[k] ?? (holdBack.has(k) ? 'run' : deadBeat ? (restPace[k] ?? 'walk') : isRef(k) ? 'run' : k.startsWith(`${off}:`) ? offPace : defPace);
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
      // Plus a moment to react and get up to speed: the defence reacts later than the offence. Someone
      // already running from the beat before is up to speed.
      const react = running.has(k) ? 0 : k.startsWith(`${off}:`) ? 0.45 : 0.8;
      if (d > 0.9) travel = Math.max(travel, d / speed + react);
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
      dead: deadBeat || undefined,
      ball,
      weight,
      fire: [...pendingFire, ...fire],
      caption,
      spotlight,
      minSeconds: needed > 0 ? needed : undefined,
      through: through.length > 0 ? through : undefined,
    });
    pendingFire = [];
    paceFor = {};
    mustArrive = [];
    through = [];
    slowBeat = false;
    deadBeat = false;
    placed = new Set();
    contact = [];
    jumpers = [];
    posting = undefined;
    reachers = [];
    challenger = undefined;
    blocking = false;
    running = new Set(Object.keys(at).filter((k) => lastAt[k] && dist(lastAt[k], at[k]) > 2 && (pace[k] === 'run' || pace[k] === 'sprint')));
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
    const spots = [...THREE.map(pos), fromHoop(7.53, 0)];
    const room = (p: Pos) => Math.min(...offKeys.filter((o) => o !== k).map((o) => dist(at[o], p)));
    return spots.reduce((best, p) => (room(p) > room(best) ? p : best), spots[0]);
  };
  /**
   * Passes the ball to `to` if someone else has it, picking the pass a player would throw. With
   * `move`, the passer then relocates to the open spot; anyone passing out of the paint steps out.
   */
  const passTo = (to: string, weight = 0.28, caption?: string, move = false) => {
    if (to === holder || !at[to]) return;
    if (spacing) clearOfShooter(to);
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
  const toFormation = () => offIds.forEach((id, i) => (at[kOff(id)] = pos(formation[slot(i)])));

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
  // The officials start a game on the sidelines and the end line.
  at[REFS[0]] = { x: END_LINE_X, y: 4 };
  at[REFS[1]] = { x: 9, y: TRAIL_Y };
  at[REFS[2]] = { x: HALF_X + 1.7, y: CENTRE_Y };
  if (prev) {
    for (const k of Object.keys(at)) if (prev.players[k]) at[k] = toNorm(prev.players[k]);
    ballSpot = { ...toNorm(prev.ball), z: prev.ball.z };
  }
  // Whichever of the two is nearer the basket being attacked leads.
  if (at[REFS[1]].x > at[REFS[0]].x) [lead, trail] = [REFS[1], REFS[0]];
  for (const [k, p] of Object.entries(at)) lastAt[k] = { ...p };

  const fastBreak = events.find((e) => e.type === 'fastBreak');
  const pressBreak = events.some((e) => e.type === 'pressBroken');
  const nearestToBall = () => offKeys.reduce((a, b) => (dist(at[b], ballSpot) < dist(at[a], ballSpot) ? b : a));
  pressing = ctx.defence === 'press' && !fastBreak;
  // Who runs the offence this time: usually the point guard, but the shooting guard or a wing take
  // their turn, more often against a press, when whoever gets open takes it.
  const roll = ((seed >>> 3) % 100) / 100;
  let handlerSlot = offIds.length < 3 ? 0 : roll < (pressing ? 0.45 : 0.62) ? 0 : roll < (pressing ? 0.8 : 0.86) ? 1 : 2;
  /** The formation spot for each lineup place: the handler takes the point, the point guard his spot. */
  function slot(i: number): number {
    return i === 0 ? handlerSlot : i === handlerSlot ? 0 : i;
  }
  /** The ball handler of this possession (the point guard, most of the time). */
  let pg = kOff(offIds[handlerSlot]);
  const pgName = () => n(off, idOf(pg));
  // In transition the engine says who has the ball and what he has: an open lane, or the numbers.
  const transAt = events.findIndex((e) => e.type === 'transition');
  const transEv = transAt >= 0 ? (events[transAt] as Extract<TimedEvent, { type: 'transition' }>) : undefined;
  const readAt = events.findIndex((e) => e.type === 'transitionRead');
  const readEv = readAt >= 0 ? (events[readAt] as Extract<TimedEvent, { type: 'transitionRead' }>) : undefined;
  if (transEv && offIds.includes(transEv.handlerId)) {
    handlerSlot = offIds.indexOf(transEv.handlerId);
    pg = kOff(transEv.handlerId);
  }
  // Beaten up the floor, the defence has no press to set.
  if (transEv) pressing = false;
  /** Transition events already played out on the way up, so they do not fire twice. */
  const early = new Set<number>();
  /**
   * The defence as the engine has it in transition: only so many got back, and with an open lane
   * the one who did is out of the line to the rim. The rest trail the ball, chasing.
   */
  const transitionDefence = (situation: 'lane' | 'twoOnOne' | 'threeOnTwo', ball: Pos) => {
    const need = situation === 'lane' ? 0 : situation === 'twoOnOne' ? 1 : 2;
    defIds
      .map(kDef)
      .sort((a, b) => at[b].x - at[a].x)
      .forEach((k, j) => {
        if (j < need) place(k, j === 0 ? fromHoop(2.03, 0) : fromHoop(4.29, ball.y < MID_Y ? 2.22 : -2.22));
        else if (situation === 'lane' && j === 0) place(k, fromHoop(3.0, ball.y < MID_Y ? 5.41 : -5.41));
        else place(k, { x: Math.max(1, ball.x - 1.5 - (j - need) * 1.3), y: MID_Y + (j % 2 ? -1 : 1) * (1.5 + j * 0.8) });
        paceFor[k] = 'sprint';
      });
  };
  /**
   * The attackers who get back as the ball is lost: the ones furthest from the basket, sprinting
   * for their own end, so the other side has the defenders the engine says it has in front of it.
   * Returns who they are.
   */
  const getBackFor = (count: number, exclude: string[]): string[] => {
    const back = offKeys.filter((o) => !exclude.includes(o)).sort((a, b) => dist(at[b], HOOP) - dist(at[a], HOOP)).slice(0, count);
    back.forEach((o, j) => {
      place(o, { x: HALF_X - 2 - j * 3, y: MID_Y + (j === 1 ? 2.5 : j === 2 ? 0 : -2.5) });
      paceFor[o] = 'sprint';
    });
    return back;
  };
  /** Where the last defender back stands, to commit to the ball or to recover into the lane. */
  const lastBack = () => defIds.map(kDef).sort((a, b) => at[b].x - at[a].x)[0];

  const origin: Record<string, Pos> = { ...at };
  /** Whoever inbounded the ball has the whole floor to cover, so they run it. */
  let trailer: string | null = null;

  // ---- Dead balls: getting everyone to their places, and the ball to whoever restarts play.

  /** Everyone heads for his place at a dead ball: walking, or jogging if it is a long way. Returns how long the slowest needs. */
  const walkTo = (): number => {
    let slowest = 0;
    for (const k of Object.keys(at)) {
      const from = lastAt[k];
      if (!from) continue;
      const d = dist(from, refSpot[k] ?? (isRef(k) ? officiate(k) : at[k]));
      restPace[k] = d > 6 ? 'jog' : 'walk';
      slowest = Math.max(slowest, d / (PACE_M_S[restPace[k]] * factor(k)) + 0.6);
    }
    return Math.min(6, slowest);
  };
  /** Seconds the beats since `mark` will take at least. */
  const since = (mark: number) => beats.slice(mark).reduce((sum, b) => sum + (b.minSeconds ?? 0), 0);
  const stillBall = (): BallAction => ({ kind: 'fixed', from: ballAbs(ballSpot), to: ballAbs(ballSpot), arc: 0 });

  /** A whistle: play stops where it is. */
  const whistle = (i: number) => {
    spacing = false;
    autoDefence = false;
    deadBeat = true;
    push(0, holder ? hold() : stillBall(), [i], undefined, undefined, 0.7);
  };

  /** The ball goes to an official: handed over by whoever has it, or picked up off the floor. */
  const getBall = (official: string) => {
    if (holder === official) return;
    if (holder && at[holder]) {
      const from = holder;
      const d = dist(at[from], refSpot[official] ?? at[official]);
      holder = official;
      deadBeat = true;
      push(0, { kind: 'pass', from, to: official, arc: d > 7 ? 0.25 : 0.05, style: d > 7 ? 'chest' : 'bounce' }, [], undefined, undefined, Math.max(0.6, d / PASS_SPEED.bounce + 0.25));
      return;
    }
    // Loose: off the iron it drops and rolls out towards the end line; anywhere else it settles
    // where it is. The official walks over and picks it up.
    const rest: Ball = dist(ballSpot, HOOP) < 1.2 ? { x: HOOP.x + 0.85, y: MID_Y + (ballSpot.y >= MID_Y ? 0.8 : -0.8), z: 0.11 } : { ...ballSpot, z: 0.11 };
    if (ballSpot.z > 0.2) {
      deadBeat = true;
      push(0, { kind: 'fixed', from: ballAbs(ballSpot), to: ballAbs(rest), arc: 0.3 }, [], undefined, undefined, ballSpot.z > 2 ? 0.65 : 0.4);
    }
    const near = { x: rest.x + (rest.x < at[official].x ? 0.4 : -0.4), y: rest.y };
    const walk = dist(at[official], near) / PACE_M_S.jog + 0.3;
    refSpot[official] = near;
    paceFor[official] = 'jog';
    deadBeat = true;
    push(0, { kind: 'fixed', from: ballAbs(rest), to: ballAbs(rest), arc: 0 }, [], undefined, undefined, Math.max(0.2, walk));
    holder = official;
    deadBeat = true;
    push(0, { kind: 'toPlayer', from: ballAbs(rest), to: official, arc: 0.05 }, [], undefined, undefined, 0.35);
  };

  /**
   * A throw-in from out of bounds at `spot`: the nearest official gets the ball and bounces it to
   * the thrower, who has stepped out; `places` puts the rest of the offence where it wants to be.
   */
  const throwIn = (spot: Pos, thrower: string, receiver: string, places: () => void) => {
    spacing = false;
    autoDefence = true;
    const official = [lead, trail, centre].sort((a, b) => dist(at[a], spot) - dist(at[b], spot))[0];
    places();
    at[thrower] = { ...spot };
    outOfBounds = thrower;
    throwFrom = spot;
    const walk = walkTo();
    const mark = beats.length;
    getBall(official);
    const beside = { x: spot.x + (spot.x > COURT.w / 2 ? 1.1 : -1.1), y: spot.y };
    const over = dist(at[official], beside) / PACE_M_S.walk + 0.5;
    refSpot[official] = beside;
    deadBeat = true;
    push(0, hold(), [], undefined, undefined, Math.max(0.6, walk - since(mark), over));
    // Handed over with a bounce; a look, and in it goes. The clock starts when it is touched.
    holder = thrower;
    deadBeat = true;
    push(0, { kind: 'pass', from: official, to: thrower, arc: 0, style: 'bounce' }, [], undefined, undefined, 0.6);
    deadBeat = true;
    push(0, hold(), [], undefined, undefined, 0.5);
    deadBeat = true;
    passTo(receiver, 0);
    outOfBounds = undefined;
    throwFrom = null;
    // In the half court the thrower steps back in to an open spot; in the backcourt he runs up with the rest.
    if (spot.x > COURT.w / 2) at[thrower] = openSpot(thrower);
    holdBack = new Set();
    delete refSpot[official];
  };

  /** Where the offence goes for a throw-in: the point guard comes to the ball, the others to the backcourt or, past half way, into their sets. */
  const setForThrowIn = (spot: Pos) => {
    if (spot.x > COURT.w / 2) toFormation();
    else offIds.forEach((id, i) => (at[kOff(id)] = pos(BACKCOURT[slot(i)])));
    at[pg] = { x: Math.max(2.5, Math.min(COURT.w - 3, spot.x - 1.5)), y: spot.y < MID_Y ? 3.4 : COURT.h - 3.4 };
  };

  /** The defence gets back while the ball comes in; only a press stays up to pick up full court. */
  const getBack = () => {
    if (pressing || ctx.defence === 'zone') return;
    guards.forEach((k, i) => (at[k] = { x: Math.max(at[k].x, HALF_X + 1.2 + i * 1.2), y: at[k].y + (ZONE[i][1] - at[k].y) * 0.5 }));
    holdBack = new Set(guards);
  };

  /**
   * After a score: the ball drops through the net and bounces away; the nearest man picks it up,
   * steps out behind the end line and throws it in to the point guard coming back for it.
   */
  const madeInbound = () => {
    const under: Pos = { x: COURT.w - HOOP.x, y: MID_Y };
    const thrower = offKeys.filter((k) => k !== pg).sort((a, b) => dist(at[a], under) - dist(at[b], under))[0];
    const side = at[thrower].y < MID_Y ? -1 : 1;
    const drop: Ball = dist(ballSpot, under) < 1.5 && ballSpot.z < 1 ? { ...ballSpot } : { ...under, z: 0.15 };
    const bounce: Ball = { x: under.x - 0.35, y: MID_Y + side * 0.45, z: 0.11 };
    const roll: Ball = { x: under.x - 0.85, y: MID_Y + side * 0.85, z: 0.11 };
    const rest: Ball = { x: under.x - 1.1, y: MID_Y + side * 1.05, z: 0.11 };
    trailer = thrower;
    at[pg] = { x: 3.4, y: MID_Y + side * 3.6 };
    offIds.forEach((id, i) => {
      const k = kOff(id);
      if (k !== pg && k !== thrower) at[k] = pos(BACKCOURT[slot(i)]);
    });
    at[thrower] = { x: rest.x + 0.3, y: rest.y };
    getBack();
    const reach = dist(lastAt[thrower], at[thrower]) / (PACE_M_S.jog * factor(thrower)) + 0.45;
    // In the last two minutes the clock stops after a basket; otherwise it runs.
    const stopped = ctx.quarter >= 4 && ctx.clockStart <= 120;
    holder = '';
    for (const [from, to, arc, seconds] of [
      [drop, bounce, 0.45, 0.45],
      [bounce, roll, 0.15, 0.3],
      [roll, rest, 0, Math.max(0.25, reach - 0.75)],
    ] as const) {
      paceFor[thrower] = 'jog';
      deadBeat = stopped;
      push(0, { kind: 'fixed', from: ballAbs(from), to: ballAbs(to), arc }, [], undefined, undefined, seconds);
    }
    holder = thrower;
    deadBeat = stopped;
    push(0, { kind: 'toPlayer', from: ballAbs(rest), to: thrower, arc: 0.05 }, [], undefined, undefined, 0.35);
    // Out behind the end line, beside the board, and in.
    at[thrower] = { x: -OUT_M - 0.1, y: MID_Y + side * 2.3 };
    outOfBounds = thrower;
    deadBeat = stopped;
    push(0, hold(), [], undefined, undefined, 0.9);
    deadBeat = stopped;
    passTo(pg, 0);
    outOfBounds = undefined;
    holdBack = new Set();
  };

  /** The opening jump: the centres in the circle, the rest round it, and an official tosses it up. */
  const tipOff = () => {
    const mid: Pos = { x: COURT.w / 2, y: MID_Y };
    const ring = (deg: number, r = 2.5): Pos => ({ x: mid.x + Math.cos((deg * Math.PI) / 180) * r, y: mid.y + Math.sin((deg * Math.PI) / 180) * r });
    const defKeys = defIds.map(kDef);
    const centres = [offKeys[offKeys.length - 1], defKeys[defKeys.length - 1]];
    at[centres[0]] = { x: mid.x - 0.45, y: MID_Y };
    at[centres[1]] = { x: mid.x + 0.45, y: MID_Y };
    offKeys.slice(0, -1).forEach((k, j) => (at[k] = ring([135, 225, 60, 300][j])));
    const defRing = [ring(90), ring(270), ring(180, 2.05), { x: mid.x + 5.5, y: MID_Y }];
    defKeys.slice(0, -1).forEach((k, j) => (at[k] = defRing[j]));
    refSpot = { [trail]: { x: mid.x, y: MID_Y - 1.2 }, [lead]: { x: mid.x + 4, y: TRAIL_Y }, [centre]: { x: mid.x - 2.5, y: CENTRE_Y } };
    holder = trail;
    deadBeat = true;
    push(0, hold(), [], 'Tip-off!', undefined, 1.8);
    const toss: Ball = { x: mid.x, y: MID_Y - 0.85, z: 1.55 };
    const top: Ball = { ...mid, z: 4.05 };
    holder = '';
    deadBeat = true;
    push(0, { kind: 'fixed', from: ballAbs(toss), to: ballAbs(top), arc: 0.55 }, [], undefined, undefined, 0.6);
    // Both go up; the attacking centre gets a hand to it first and taps it back to the point guard.
    const to = at[pg];
    const away = dist(to, mid) || 1;
    const tapped: Ball = { x: mid.x + ((to.x - mid.x) / away) * 1.9, y: MID_Y + ((to.y - MID_Y) / away) * 1.9, z: 2.6 };
    jumpers = [...centres];
    reachers = [...centres];
    deadBeat = true;
    push(0, { kind: 'fixed', from: ballAbs(top), to: ballAbs(tapped), arc: 0.35 }, [], undefined, undefined, 0.55);
    holder = pg;
    push(0, { kind: 'toPlayer', from: ballAbs(tapped), to: pg, arc: 0.15 }, [], undefined, pg, 0.45);
  };

  // ---- Getting the ball in: inbound after a dead ball, outlet after a rebound, steal = already ours.
  if (ctx.start === 'none') {
    phase = 'bringUp';
    const restart = ctx.restart ?? { kind: 'made' };
    if (restart.kind === 'tip') tipOff();
    else if (restart.kind === 'centre') {
      // A quarter starts with a throw-in from the centre line, on the side away from the table.
      const spot: Pos = { x: COURT.w / 2, y: CENTRE_Y };
      const thrower = offKeys[2] ?? offKeys[1];
      holder = centre;
      throwIn(spot, thrower, pg, () => {
        const spots: Spot[] = [hoopSpot(10.09, -4.09), hoopSpot(9.4, 2.84), [HALF_X - 3, MID_Y - 2.34]];
        offKeys.filter((k) => k !== pg && k !== thrower).forEach((k, j) => (at[k] = pos(spots[j % spots.length])));
        at[pg] = { x: COURT.w / 2 - 3, y: COURT.h - 3.6 };
      });
      trailer = thrower;
    } else if (restart.kind === 'sideline') {
      // After a violation: from the sideline level with where it happened. Whoever had the ball
      // when the whistle went still has it, unless it went out.
      const p = toNorm(restart.at);
      const spot: Pos = { x: Math.max(1.2, Math.min(COURT.w - 1.2, p.x)), y: p.y < MID_Y ? -OUT_M : COURT.h + OUT_M };
      const keeper = [...offKeys, ...defIds.map(kDef)].filter((k) => ballSpot.z > 0.5 && dist(at[k], ballSpot) < 0.8).sort((a, b) => dist(at[a], ballSpot) - dist(at[b], ballSpot))[0];
      holder = keeper ?? '';
      const thrower = offKeys.filter((k) => k !== pg).sort((a, b) => dist(at[a], spot) - dist(at[b], spot))[0];
      if (spot.x < COURT.w / 2) getBack();
      throwIn(spot, thrower, pg, () => setForThrowIn(spot));
      trailer = thrower;
    } else {
      spacing = false;
      madeInbound();
    }
    refSpot = {};
    spacing = true;
    autoDefence = true;
  } else {
    holder = nearestToBall();
    if (fastBreak) autoDefence = false;
    // Unless they break, getting the ball out is the start of the bring-up.
    else phase = 'bringUp';
    // Off a rebound he chins it before he turns to outlet it; a steal he takes away on the dribble.
    if (ctx.start === 'rebound') push(0.15, hold(), [], undefined, undefined, 0.45);
    else push(0, dribble());
  }

  /**
   * Off a rebound or a steal with an advantage (the engine's transition) the ball is pushed up the
   * floor; with the defence back, or after a dead ball, it is brought up and the defence is there.
   */
  const transition = ctx.start !== 'none' && !!transEv;
  if (!fastBreak) {
    if (holder !== pg && ctx.start === 'rebound' && !transition && !pressing && ctx.tempo === 'slow' && at[pg].x > OUTLET_X) {
      // A team in no hurry: the guard comes back to the wing for the outlet, then walks it up.
      at[pg] = { x: OUTLET_X, y: at[pg].y < MID_Y ? 2.4 : COURT.h - 2.4 };
    }
    if (holder !== pg) passTo(pg, 0.28, `Outlet to ${pgName()}…`);
    // Bring up: the handler takes it over half court while everyone gets into shape. In transition
    // he pushes it and the wings run their lanes; a defender the ball has got ahead of has to run.
    // A press picks up the whole way, so the others come back to give the handler an outlet.
    phase = 'bringUp';
    const pressed = pressing ? ' against the full-court press' : '';
    let startX = at[pg].x;
    if (pressing && startX < BRING_UP_X - 4 && (seed >>> 9) % 2 === 0) {
      // Trapped: a second defender comes at the handler, who gets it out to a teammate flashing to
      // the middle; he brings it up instead.
      const own = guards.find((k) => guarding[k] === pg);
      const trapper = guards.filter((k) => k !== own).sort((a, b) => dist(at[a], at[pg]) - dist(at[b], at[pg]))[0];
      const h = insideCourt({ x: startX + 2.5, y: at[pg].y + (at[pg].y < MID_Y ? -1.2 : 1.2) });
      at[pg] = h;
      place(trapper, { x: h.x + 0.9, y: h.y + (h.y < MID_Y ? 0.8 : -0.8) });
      paceFor[trapper] = 'sprint';
      paceFor[pg] = 'run';
      push(0.35, dribble(), [], `${pgName()} is trapped…`, pg, 0.9);
      const outlet = offKeys.slice(0, 3).filter((k) => k !== pg).sort((a, b) => dist(at[a], h) - dist(at[b], h))[0];
      if (outlet) {
        at[outlet] = { x: Math.min(BRING_UP_X - 1, h.x + 4.5), y: MID_Y + (MID_Y - h.y) * 0.3 };
        paceFor[outlet] = 'run';
        mustArrive = [outlet];
        passTo(outlet, 0.25, `…and gets it out to ${n(off, idOf(outlet))}.`);
        handlerSlot = offIds.indexOf(idOf(outlet));
        pg = outlet;
        startX = at[pg].x;
      }
    }
    if (startX < BRING_UP_X) {
      // Up the floor in one go, over half court without stopping, straight to where he starts the
      // play: the top of the key, on the side he came up.
      const top = pos(formation[0]);
      const from = { ...at[pg] };
      const entry = { x: top.x - 0.5, y: MID_Y + Math.max(-2.2, Math.min(2.2, (from.y - MID_Y) * 0.4)) };
      let pace: Pace = transition ? 'run' : BRING_UP_PACE[ctx.tempo ?? 'normal'];
      const walk = PACE_M_S.walk * factor(pg);
      const run = BRING_UP_X - startX;
      if (pace === 'run' && !pressing) {
        // With no advantage from the engine, somebody is back before he gets there: if nobody could
        // be, he was never really running at them, so he comes up at a jog.
        const firstBack = Math.min(...guards.map((k) => dist(origin[k], { x: HOOP.x - 4.5, y: MID_Y }) / (PACE_M_S.sprint * factor(k)) + 0.8));
        if (firstBack > (BRING_UP_X - startX) / (PACE_M_S.run * factor(pg)) + 0.45 + since(0)) pace = 'jog';
      }
      if (pace === 'walk' && run / walk + 0.45 + since(0) > OVER_HALF_BY_S) {
        // A slow team walks it up, but never so slowly that the eight seconds come into it: from deep,
        // he jogs the first part and walks it over half court; with no time to walk, he jogs it all.
        const jog = PACE_M_S.jog * factor(pg);
        const jogged = Math.max(0, (run / walk - (SLOW_OVER_HALF_S - 0.45 - since(0))) / (1 / walk - 1 / jog));
        if (jogged > run - 2) pace = 'jog';
        else {
          at[pg] = { x: from.x + jogged, y: from.y + ((entry.y - from.y) * jogged) / (entry.x - from.x) };
          paceFor[pg] = 'jog';
          through = [pg];
          push(0, dribble(), [], `${pgName()} brings it up…`, pg);
        }
      }
      // Against a press he is picked up all the way: over half court without a stop, and then he
      // walks it into the set while the press drops back into the half court.
      at[pg] = pressing ? { x: BRING_UP_X + 2, y: MID_Y + (entry.y - MID_Y) * 1.5 } : entry;
      paceFor[pg] = pace;
      offIds.forEach((id, i) => {
        const k = kOff(id);
        if (k === pg) return;
        const [fx, fy] = formation[slot(i)];
        at[k] = { x: fx - (pressing ? 7.2 : 0), y: fy };
        if (transition) paceFor[k] = 'run';
      });
      if (trailer) paceFor[trailer] = 'run';
      if (pressing) {
        paceFor[pg] = 'run';
        through = [pg];
        // A press keeps a safety: whoever has the deepest man drops to protect the basket.
        const deep = offKeys.filter((k) => k !== pg).sort((a, b) => at[b].x - at[a].x)[0];
        const safety = guards.find((k) => guarding[k] === deep);
        if (safety) {
          place(safety, { x: HOOP.x - 4.6, y: MID_Y + (entry.y - MID_Y) * 0.4 });
          paceFor[safety] = 'sprint';
        }
      }
      if (!pressing) for (const k of guards) if (at[k].x < BRING_UP_X + 2.4 || ctx.start !== 'none') paceFor[k] = ctx.start !== 'none' ? 'sprint' : 'run';
      // Ahead of the defence, as the engine has it: he sees it, and takes it or pulls it out.
      if (transEv) {
        transitionDefence(transEv.situation, at[pg]);
        early.add(transAt);
      }
      // As long as it takes him: given more, he would only stand and wait at the end of it.
      push(0, dribble(), transEv ? [transAt] : [], transition && !pressing ? `${pgName()} pushes it up…` : `${pgName()} brings it up${pressed}…`, pg);
      if (transEv?.attack && readEv?.then === 'pullBack') {
        // He goes at the rim, a defender recovers into the lane, and he pulls it back out.
        at[pg] = { x: HOOP_X - 4.98, y: MID_Y + (at[pg].y - MID_Y) * 0.5 };
        paceFor[pg] = 'sprint';
        const back = lastBack();
        if (back) {
          place(back, { x: HOOP_X - 2.82, y: MID_Y + (at[pg].y - MID_Y) * 0.3 });
          paceFor[back] = 'sprint';
          mustArrive = [back];
        }
        early.add(readAt);
        push(0.35, dribble(), [readAt], undefined, pg, 0.8);
      }
    }
    pressing = false;
    if (!pressBreak) {
      // Set up: into the formation, the defence matched up. The play starts as the handler gets to
      // his spot. Only a defence still getting back holds it up (with no advantage from the engine,
      // none may show), or a teammate a long way behind, who runs to catch up; meanwhile the
      // handler keeps the ball moving. He never parks at half court to wait.
      phase = 'setUp';
      toFormation();
      spread(at, offKeys, (k) => (k === holder ? 0 : 1));
      settleDefence();
      // The defence sprints back.
      for (const k of guards) paceFor[k] = 'sprint';
      for (const k of offKeys) if (k !== pg && dist(lastAt[k], at[k]) > 8) paceFor[k] = 'run';
      if (trailer) paceFor[trailer] = 'run';
      // From where everyone was when the possession started, with the time to react and turn.
      const needs = (k: string) => dist(origin[k], at[k]) / (PACE_M_S[paceFor[k] ?? offPace] * factor(k));
      const defenceBack = Math.max(...guards.map((k) => needs(k) * 1.15 + 0.8));
      const offenceIn = Math.max(...offKeys.filter((k) => k !== pg).map((k) => needs(k) + 0.45));
      const share = seconds < EARLY_OFFENCE_SECONDS ? 0.6 : transition ? 0.85 : 1;
      // Pushed up the floor at a run, he comes into the set under control; over the press, he walks it in.
      if (transition) paceFor[pg] = 'jog';
      if (pressed) paceFor[pg] = 'walk';
      push(0, dribble(), [], startX < BRING_UP_X ? undefined : `${pgName()} brings it up…`, pg, Math.min(5, Math.max(0.3, Math.max(defenceBack, offenceIn) * share - since(0))));
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

  /**
   * Free-throw places: three defenders and two attackers on the lane, the defence nearest the
   * basket; everyone else behind the arc, one defender on the shooter and the rest back.
   */
  const ftPlaces = (shooter: string): Record<string, Pos> => {
    const out: Record<string, Pos> = { [shooter]: { ...FT_SPOT } };
    const byY = (a: string, b: string) => at[a].y - at[b].y;
    const defs = defIds.map(kDef);
    const offs = offKeys.filter((k) => k !== shooter);
    // The bigs take the lane, each to the side he is on.
    const [d0, d1, d2] = defs.slice(-3).sort(byY);
    const [o0, o1] = offs.slice(-2).sort(byY);
    if (d0) out[d0] = { x: LANE_X[0], y: LANE_Y[0] };
    if (d2) out[d2] = { x: LANE_X[0], y: LANE_Y[1] };
    if (d1) out[d1] = { x: LANE_X[2], y: at[d1].y < MID_Y ? LANE_Y[0] : LANE_Y[1] };
    if (o0) out[o0] = { x: LANE_X[1], y: LANE_Y[0] };
    if (o1) out[o1] = { x: LANE_X[1], y: LANE_Y[1] };
    const behind: [string | undefined, Pos][] = [
      [defs[0], fromHoop(7.71, 1.81)],
      [defs[1], fromHoop(11.32, -1.99)],
      [offs[0], fromHoop(7.57, -4.04)],
      [offs[1], fromHoop(11.71, 2.4)],
    ];
    for (const [k, p] of behind) if (k) out[k] = p;
    return out;
  };

  /** As the last free throw leaves the shooter's hands, the lane steps in to box out. */
  const stepIn = () => {
    for (const k of [...offKeys, ...defIds.map(kDef)]) {
      const p = at[k];
      if (p.x < LANE_X[2] - 0.1 || Math.abs(p.y - MID_Y) < 2) continue;
      at[k] = { x: p.x + 0.2, y: p.y + Math.sign(MID_Y - p.y) * STEP_IN_M };
      paceFor[k] = 'run';
    }
  };

  /** Fouled going up, and it does not go in: the attempt, the contact, the whistle as it comes off the iron. */
  const fouledShot = (ev: Extract<TimedEvent, { type: 'foul' }>, i: number, shots: number) => {
    const shooter = kOff(ev.onId);
    const fouler = kDef(ev.playerId);
    const three = shots === 3;
    if (!fastBreak && !doubled && holder.startsWith(`${off}:`)) ballMovement(shooter, null, false, three ? 'three' : 'drive');
    if (holder !== shooter && holder.startsWith(`${off}:`)) passTo(shooter, 0.28);
    holder = shooter;
    soft = shooter;
    const name = n(off, ev.onId);
    const spot = shotSpot(three ? 'three' : 'drive', i + Math.floor(ev.clock));
    at[shooter] = spot;
    paceFor[shooter] = three ? 'run' : 'sprint';
    // The man who fouls him is with him all the way.
    place(fouler, { x: spot.x + 0.9, y: spot.y + (spot.y < MID_Y ? 0.4 : -0.4) });
    paceFor[fouler] = 'sprint';
    mustArrive = [shooter, fouler];
    push(0.4, dribble(), [], three ? `${name} rises from deep…` : `${name} attacks the basket…`, shooter);
    const toRim = dist(spot, HOOP) || 1;
    const style: ShotStyle = three ? 'jumper' : 'layup';
    if (!three) at[shooter] = { x: HOOP_X - 0.98, y: MID_Y + (spot.y - MID_Y) * 0.3 };
    challenger = fouler;
    place(fouler, { x: at[shooter].x + ((HOOP.x - spot.x) / toRim) * 0.85, y: at[shooter].y + ((HOOP.y - spot.y) / toRim) * 0.85 });
    paceFor[fouler] = 'sprint';
    const contactAt = rimContact(spot, seed + i);
    push(0.8, { kind: 'fromPlayer', from: shooter, to: ballAbs(contactAt), arc: shotArc(spot, style), style }, [i], undefined, undefined, three ? 1.1 + toRim * 0.05 : 0.85);
    soft = null;
    holder = '';
    spacing = false;
    autoDefence = false;
  };

  events.forEach((ev, i) => {
    switch (ev.type) {
      case 'fastBreak': {
        const leader = kOff(ev.leaderId);
        offPace = 'sprint';
        defPace = 'sprint';
        if (holder !== leader) passTo(leader, 0.22, `Quick outlet to ${n(off, ev.leaderId)}…`);
        // Runners fill the lanes, wings first, a trailer behind, the last man stays home.
        const runners = offKeys.filter((k) => k !== leader).sort((a, b) => at[b].x - at[a].x);
        const lanes: Pos[] = [fromHoop(3.45, -5.78), fromHoop(3.45, 5.78), fromHoop(8.43, 0), { x: BRING_UP_X, y: MID_Y }];
        runners.forEach((k, j) => (at[k] = lanes[j] ?? lanes[3]));
        at[leader] = fromHoop(5.22, 0);
        const name = n(off, ev.leaderId);
        let caption = `${name} pushes it in transition!`;
        if (transEv) {
          // The numbers the engine gave: nobody in the lane, or one or two back to stop it.
          transitionDefence(transEv.situation, at[leader]);
          caption = transEv.situation === 'lane' ? `${name} sees daylight…` : `${transEv.situation === 'twoOnOne' ? '2 on 1' : '3 on 2'}! ${name} pushes it…`;
        }
        push(0.75, dribble(), [i], caption, leader);
        if (readEv?.read === 'laneClosed' && !early.has(readAt)) {
          // A chaser gets back into the lane in front of him.
          const chaser = defIds.map(kDef).sort((a, b) => dist(at[a], HOOP) - dist(at[b], HOOP))[0];
          at[leader] = fromHoop(4.29, 0.3);
          if (chaser) {
            place(chaser, fromHoop(1.99, 0.5));
            paceFor[chaser] = 'sprint';
            mustArrive = [chaser];
          }
          early.add(readAt);
          push(0.3, dribble(), [readAt], undefined, leader, 0.6);
        }
        break;
      }
      case 'transition':
        // Played out with the push up the floor or the break; otherwise it fires with the next beat.
        if (!early.has(i)) {
          early.add(i);
          pendingFire.push(i);
        }
        break;
      case 'transitionRead':
        // A break plays the read out itself (the lane closing, the dish) further on.
        if (!early.has(i) && !fastBreak) {
          early.add(i);
          pendingFire.push(i);
        }
        break;
      case 'pressBroken': {
        const h = kOff(ev.handlerId);
        passTo(h, 0.22);
        at[h] = { x: Math.max(HOOP_X - 9.63, at[h].x), y: MID_Y };
        offIds.forEach((id, j) => {
          if (kOff(id) !== h) at[kOff(id)] = pos(formation[slot(j)]);
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
        // Where the engine says it was taken from. A finish at the rim takes off a stride further out
        // and glides in; a jumper, a floater or a hook goes up from the spot itself.
        const release = shotPoint(ev);
        const finish = ev.zone === 'restricted' && ev.shotType !== 'post' && ev.shotType !== 'putback';
        const spot = finish ? outFrom(release, 2.4) : release;
        shotAt = spot;
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
            at[assistKey] = { x: Math.min(HOOP_X - 2.63, at[assistKey].x + 1.8), y: at[assistKey].y + (MID_Y - at[assistKey].y) * 0.4 };
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
          if (readEv?.then === 'dish' && !early.has(readAt) && holder !== shooterKey) {
            // The last defender commits to the ball, and it goes to the man he left.
            const back = lastBack();
            const h = at[holder];
            if (back && h) {
              place(back, { x: h.x + 0.9, y: h.y + (MID_Y - h.y) * 0.2 });
              paceFor[back] = 'sprint';
              mustArrive = [back];
              push(0.25, dribble(), [], undefined, holder, 0.5);
            }
            early.add(readAt);
            pendingFire.push(readAt);
          }
          // A lead pass: he takes it in stride, halfway along his run, and goes on to the rim.
          if (holder !== shooterKey) at[shooterKey] = { x: (at[shooterKey].x + spot.x) / 2, y: (at[shooterKey].y + spot.y) / 2 };
          passTo(shooterKey, 0.22);
          at[shooterKey] = { ...spot };
          push(0.3, dribble(), [], `${shooterName} races to the rim…`, shooterKey);
        } else if (ev.shotType === 'putback') {
          // Putback: the rebounder chins it and goes straight back up from where he came down with
          // it, no walking to a better spot with the ball in his hands.
          holder = shooterKey;
          at[shooterKey] = { ...spot };
          push(0.15, hold(), [], `${shooterName} goes right back up…`, shooterKey, 0.45);
        } else {
          // A finish with no set-up of its own: get it to the shooter and go.
          if (assistKey && assistKey !== holder) passTo(assistKey);
          passTo(shooterKey, 0.28);
          at[shooterKey] = { ...spot };
          push(0.35, dribble(), [], undefined, shooterKey);
        }

        // The shot itself: jumpers and hooks go up on the spot; layups and dunks take off and glide to the rim.
        const style: ShotStyle = ev.dunk ? 'dunk' : ev.shotType === 'post' ? 'hook' : finish || (ev.shotType === 'putback' && ev.zone === 'restricted') ? 'layup' : 'jumper';
        const from = { ...at[shooterKey] };
        // Help has to get there before a block can happen: the shooter gathers while it comes.
        const toRim = dist(from, HOOP) || 1;
        const basketSide = { x: from.x + ((HOOP.x - from.x) / toRim) * 0.85, y: from.y + ((HOOP.y - from.y) / toRim) * 0.85 };
        // A shot that is blocked, or fouled on the way in, has its defender right there.
        const onShooter = ev.blockerId ? kDef(ev.blockerId) : andOne?.type === 'foul' ? kDef(andOne.playerId) : null;
        if (onShooter && dist(at[onShooter], from) > 1.5) {
          place(onShooter, basketSide);
          paceFor[onShooter] = 'sprint';
          mustArrive = [onShooter];
          push(0.15, { kind: 'held', holder: shooterKey, dribble: true }, [], undefined, shooterKey);
        }
        if (style === 'layup' || style === 'dunk') {
          // Two steps to the rim, gliding in to where the engine has the shot go up.
          const glide = dist(from, release);
          at[shooterKey] = glide > 1.8 ? { x: from.x + ((release.x - from.x) / glide) * 1.8, y: from.y + ((release.y - from.y) / glide) * 1.8 } : { ...release };
        }
        const shotDist = dist(from, HOOP);
        const minSeconds = style === 'jumper' ? 1.1 + shotDist * 0.05 : 0.85;
        const arc = shotArc(from, style);
        // Someone always comes out at the shooter, on the basket side: the blocker if there is one,
        // otherwise whoever is nearest. Whether they get there in time is down to their legs.
        const nearest = defIds.map(kDef).sort((a, b) => dist(at[a], from) - dist(at[b], from))[0];
        challenger = onShooter ?? nearest;
        blocking = !!ev.blockerId;
        // And one: the whistle goes as it drops.
        const fired = andOne ? [andOneAt, i] : [i];
        andOne = null;
        place(challenger, { x: at[shooterKey].x + ((HOOP.x - from.x) / toRim) * 0.85, y: at[shooterKey].y + ((HOOP.y - from.y) / toRim) * 0.85 });
        paceFor[challenger] = 'sprint';
        if (ev.blockerId) {
          push(0.8, { kind: 'fromPlayer', from: shooterKey, to: ballAbs({ x: from.x - 2.1, y: from.y + 1.5, z: 0.3 }), arc: 0.9, style }, [i], undefined, undefined, minSeconds);
        } else if (ev.made) {
          push(0.8 + shotDist * 0.033, { kind: 'fromPlayer', from: shooterKey, to: ballAbs(RIM), arc, style }, fired, undefined, undefined, minSeconds);
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
        refSpot = {};
        // Off a defensive rebound, whoever the engine has getting back is already on his way.
        const retreat = ev.offensive ? [] : getBackFor(ev.back ?? 0, [k]);
        if (rimHit) {
          // Off the iron: the ball pops up, everyone nearby crashes, and they fight for it in the air.
          const { contact: hit, from } = rimHit;
          rimHit = null;
          const away = Math.atan2(from.y - HOOP.y, from.x - HOOP.x) + (((seed + i) % 3) - 1) * 0.7;
          const reach = 1.05 + dist(from, HOOP) * 0.25 + ((seed + i) % 3) * 0.3;
          const carom = insideCourt({ x: Math.min(HOOP_X - 0.82, HOOP.x + Math.cos(away) * reach), y: HOOP.y + Math.sin(away) * reach });
          const rivals = [...offKeys, ...defIds.map(kDef)]
            .filter((o) => o !== k && !retreat.includes(o))
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
            if (kOff(id) !== k) at[kOff(id)] = pos(formation[slot(j)]);
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
          // As the ball goes, whoever the engine has getting back turns and runs.
          getBackFor(ev.back ?? 0, [handler, st]);
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
            push(0.3, dribble(), [], `${n(off, idOf(handler))} looks for ${n(off, idOf(target))}…`, handler, 0.5);
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
          spacing = false;
          autoDefence = false;
          deadBeat = true;
          push(0, hold(), [i], undefined, handler, 0.8);
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
          spacing = false;
          autoDefence = false;
          deadBeat = true;
          push(0, hold(), [i], undefined, handler, 0.8);
        } else {
          push(0.35, { kind: 'fromPlayer', from: handler, to: ballAbs({ x: h.x - 1.5, y: h.y < MID_Y ? -0.45 : COURT.h + 0.45, z: 0.3 }), arc: 0.45, style: 'throw' }, [i], undefined, undefined, 0.6);
        }
        break;
      }
      case 'foul': {
        const next = events.slice(i + 1).find((e) => e.type === 'shot' || e.type === 'freeThrow');
        if (ev.shooting && next?.type === 'shot') {
          // The basket counts: the whistle comes with it.
          andOne = ev;
          andOneAt = i;
          break;
        }
        if (ev.shooting) {
          fouledShot(ev, i, next?.type === 'freeThrow' ? next.of : 2);
          break;
        }
        whistle(i);
        if (next?.type !== 'freeThrow') {
          // Side out: thrown in from the sideline level with the foul, and the offence sets up again.
          const where = at[holder] ?? ballSpot;
          const spot: Pos = { x: Math.max(COURT.w / 2 + 1, Math.min(COURT.w - 2.5, where.x)), y: where.y < MID_Y ? -OUT_M : COURT.h + OUT_M };
          const thrower = offKeys.filter((k) => k !== holder && k !== pg).sort((a, b) => dist(at[a], spot) - dist(at[b], spot))[0];
          throwIn(spot, thrower, pg, () => setForThrowIn(spot));
          refSpot = {};
          spacing = true;
          autoDefence = true;
        }
        break;
      }
      case 'freeThrow': {
        const k = sideOf(ev.side)(ev.shooterId);
        spacing = false;
        autoDefence = false;
        rimHit = null;
        const last = ev.attempt === ev.of;
        if (ev.attempt === 1) {
          // Everyone walks to his place while the lead official gets the ball under the basket.
          Object.assign(at, ftPlaces(k));
          refSpot = { [trail]: { x: FT_SPOT.x - 2, y: TRAIL_Y }, [centre]: { x: FT_SPOT.x - 2, y: CENTRE_Y } };
          const walk = walkTo();
          const mark = beats.length;
          getBall(lead);
          const over = dist(at[lead], FT_LEAD) / PACE_M_S.walk + 0.5;
          refSpot[lead] = { ...FT_LEAD };
          deadBeat = true;
          push(0, hold(), [], `${n(ev.side, ev.shooterId)} steps to the line for ${ev.of}.`, k, Math.max(0.8, walk - since(mark), over));
        }
        // The lead bounces it to the shooter: his dribbles, a breath, and up it goes.
        holder = k;
        deadBeat = true;
        push(0, { kind: 'pass', from: lead, to: k, arc: 0, style: 'bounce' }, [], undefined, undefined, dist(FT_LEAD, FT_SPOT) / PASS_SPEED.bounce + 0.3);
        deadBeat = true;
        push(0, dribble(), [], undefined, undefined, 1.3);
        deadBeat = true;
        push(0, hold(), [], undefined, undefined, 0.6);
        // On the last one the lane comes in as the ball leaves his hands; before that nobody moves.
        if (last) stepIn();
        const arc = shotArc(FT_SPOT, 'set');
        const to = ev.made ? RIM : rimContact(FT_SPOT, seed + i);
        deadBeat = !last;
        push(0, { kind: 'fromPlayer', from: k, to: ballAbs(to), arc, style: 'set' }, [i], undefined, undefined, 0.9);
        if (ev.made) {
          deadBeat = !last;
          push(0, { kind: 'fixed', from: ballAbs(RIM), to: ballAbs(NET), arc: 0 }, [], undefined, undefined, 0.25);
        }
        holder = '';
        if (!last) {
          // Back to the lead for the next one.
          const bounce: Ball = { x: HOOP.x + 0.9, y: MID_Y + 1.3, z: 0.11 };
          deadBeat = true;
          push(0, { kind: 'fixed', from: ballAbs(ev.made ? NET : to), to: ballAbs(bounce), arc: ev.made ? 0.3 : 0.45 }, [], undefined, undefined, ev.made ? 0.4 : 0.6);
          holder = lead;
          deadBeat = true;
          push(0, { kind: 'toPlayer', from: ballAbs(bounce), to: lead, arc: 0.35 }, [], undefined, undefined, 0.45);
        } else if (!ev.made) rimHit = { contact: to, from: FT_SPOT };
        break;
      }
      default:
        // Subs, timeouts, foul-outs, period markers: no movement; they fire with the next beat.
        pendingFire.push(i);
    }
  });

  // A read the break never got round to showing still fires.
  if (readAt >= 0 && !early.has(readAt)) pendingFire.push(readAt);
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

/** Nearer the basket than this, a handler with the ball is going at it, not waiting. */
export const PROBE_FROM_RIM_M = 6;

/**
 * A beat that can take spare time: the handler has a live dribble out on the floor in the half
 * court, so he keeps the ball moving. Never the bring-up (that has eight seconds, and takes as long
 * as it takes), nor a drive that has got into the paint.
 */
function roomy(b: Beat, dir: 1 | -1): boolean {
  if (b.ball.kind !== 'held' || !b.ball.dribble || b.dead || b.phase !== 'play') return false;
  const p = b.players[b.ball.holder];
  const rim = dir === 1 ? HOOP : { x: COURT.w - HOOP.x, y: HOOP.y };
  return !!p && Math.hypot(p.x - rim.x, p.y - rim.y) > PROBE_FROM_RIM_M;
}

/**
 * Real seconds per beat: flights take their own time, the rest share what is left (scaled by speed).
 * A dead ball takes as long as it takes, on top: the clock is stopped. Spare time goes to the
 * dribbling: a catch, a pass or a hold stretched out is only a player standing with the ball.
 */
export function beatDurations(script: Script, totalSeconds: number, minScale = 1): number[] {
  const beats = script.beats;
  const fixed = beats.reduce((s, b) => s + (flightOnly(b) && !b.dead ? (b.minSeconds ?? 0) * minScale : 0), 0);
  const weights = beats.reduce((s, b) => s + (flightOnly(b) ? 0 : b.weight), 0) || 1;
  // Everything else always keeps some of the time, even when the flights alone fill it.
  const left = Math.max(totalSeconds - fixed, totalSeconds * 0.3);
  const shared = beats.map((b) => (flightOnly(b) ? (b.minSeconds ?? 0) * minScale : Math.max((b.weight / weights) * left, (b.minSeconds ?? 0) * minScale)));
  // With no dribble to give it to, the spare time is left out: the possession plays a little quicker.

  const roomWeight = beats.reduce((s, b) => s + (roomy(b, script.dir) ? b.weight : 0), 0);
  let spare = 0;
  const capped = shared.map((d, i) => {
    const b = beats[i];
    if (flightOnly(b) || roomy(b, script.dir) || b.dead) return d;
    // A catch or a hold gets a look; a big in the post the moment to get his back into his man.
    const cap = Math.max((b.minSeconds ?? 0) * minScale + (b.posting ? 0.5 : 0.15), 0.4);
    spare += Math.max(0, d - cap);
    return Math.min(d, cap);
  });
  return capped.map((d, i) => (roomy(beats[i], script.dir) && roomWeight > 0 ? d + (spare * beats[i].weight) / roomWeight : d));
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
