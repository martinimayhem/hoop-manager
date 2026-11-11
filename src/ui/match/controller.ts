// Drives a live match: steps the engine one possession at a time, plays the animation,
// releases commentary when the animation reaches it, and pauses for timeouts and breaks.
// Framework-free; the React screen polls `version` to know when to re-render.

import { describe as commentate, namesFor, type Names } from '../../engine/commentary';
import { callTimeout, canCallTimeout, createMatch, setGamePlan, stepPossession } from '../../engine/match';
import { composite } from '../../engine/ratings';
import { emit, other } from '../../engine/state';
import type { DefenceCall, DefenceScheme, GamePlan, MatchState, OffenceCall, PlayerGameState, PossessionCalls, Side, Team, TimedEvent, Transition } from '../../engine/types';
import { playerRating } from '../../engine/stats';
import { aiCall, asksForCall, isClutch } from '../../game/clutch';
import { aiTalk, giveTalk, type Talk } from '../../game/teamTalk';
import { aiAdjustPlan, aiShouldTimeout } from '../../game/ai';
import { assistantTips, createTipMemory, type Tip, type TipMemory } from '../../game/assistant';
import type { Controller } from '../../game/draft';
import { COURT, beatAt, beatDurations, buildScript, playerKey, type Beat, type Frame, type Pos, type Restart, type Script } from '../court/animation';
import { GATHER_STEPS_M, Motion, facingScene } from '../court/motion';
import { clockString } from '../labels';
import { excitement } from './highlights';

export type Speed = 'normal' | 'fast';
export type Phase = 'playing' | 'timeout' | 'break' | 'clutch' | 'argue' | 'final';

/**
 * Game seconds per real second, and per-possession clamps. Normal plays at running speeds a real
 * player could reach (≈ 7.5 min per quarter); Fast trades that for pace (≈ 4 min per quarter).
 */
const SPEEDS: Record<Speed, { div: number; min: number; max: number }> = {
  normal: { div: 1.9, min: 4.5, max: 12 },
  fast: { div: 4.5, min: 2, max: 5 },
};

/** How much faster bring-up and set-up play on a routine possession. */
/** How long the "Argue the call" button stays up (real seconds) before play goes on. */
export const ARGUE_SECONDS = 5;
/** At most this many chances to argue a call per side per quarter, this many possessions apart. */
const ARGUE_PER_QUARTER = 2;
const ARGUE_GAP_POSSESSIONS = 10;
/** Of the fouls against a team that could be argued, the share that are close enough to argue. */
const ARGUE_SHARE = 0.45;

/** A number in 0..1 from a string: the same every time, and no draw from the game's dice. */
function unit(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/** Two players at full speed straight at each other (m/s of game time). */
const CLOSING_M_S = 16;
/** The most two players may close on each other in one movement step: half a body width. */
const MAX_CLOSING_STEP_M = 0.4;

/** A possession as it stood before it was played: what its animation script is built from. */
interface PossessionStart {
  offence: Side;
  lineups: [string[], string[]];
  defence: DefenceScheme;
  clockStart: number;
  how: Transition;
  /** Index of its first event. */
  start: number;
}

/**
 * A trip to the line worth showing in highlights mode on top of the best plays: an and-one, or free
 * throws in the last two minutes of a quarter, or in the last five minutes of a close fourth quarter
 * or overtime.
 */
function freeThrowsThatMatter(s: MatchState, events: TimedEvent[]): boolean {
  const fts = events.filter((e) => e.type === 'freeThrow' && !e.technical);
  if (fts.length === 0) return false;
  const andOne = events.some((e) => e.type === 'shot' && e.made);
  const margin = Math.abs(s.teams[0].score - s.teams[1].score);
  return andOne || s.clock <= 120 || (s.quarter >= 4 && s.clock <= 300 && margin <= 6);
}

/** Where the ball is at the end of a beat. */
function endBall(beat: Beat): Pos {
  const b = beat.ball;
  const of = (k: string): Pos => beat.players[k] ?? { x: COURT.w / 2, y: COURT.h / 2 };
  switch (b.kind) {
    case 'held':
      return of(b.holder);
    case 'pass':
    case 'toPlayer':
      return of(b.to);
    case 'fromPlayer':
    case 'fixed':
      return { x: b.to.x, y: b.to.y };
  }
}

const FAST_FORWARD: Record<Speed, number> = { normal: 2.5, fast: 2 };
/** In highlights mode, how many plays of each quarter are shown; the rest are played out instantly. */
export const HIGHLIGHTS_PER_QUARTER = 5;
/** Game seconds per second of play while the ball is brought up, at Normal speed: about real time. */
const BRING_UP_CLOCK_RATE = 1;
/** How long a result line stays up before a set-up line may replace it (real seconds). */
const CAPTION_READ_S = 1.1;
/** The last two minutes of a game this close is never routine. */
const LATE_SECONDS = 120;
const LATE_MARGIN = 8;

/** A player who took more than his two steps with the ball in his hands, as the debug check saw it. */
export interface TravelReport {
  player: string;
  number: number;
  /** How far from where he gathered the ball (metres). */
  distance: number;
  quarter: number;
  clock: number;
  /** How he came by the ball: a catch, a rebound, a steal, an inbound, the end of a drive. */
  how: string;
  /** What the commentary was saying at the time. */
  event: string;
}

export interface FeedItem {
  id: number;
  text: string;
  quarter: number;
  clock: number;
  side: Side | null;
  kind: 'play' | 'score' | 'info' | 'coach';
}

/** Per-player numbers as of the last completed possession (so panels don't spoil the animation). */
export type PlayerView = Pick<PlayerGameState, 'energy' | 'fouls' | 'fouledOut' | 'ejected' | 'technicals'> & { pts: number; reb: number; ast: number; seconds: number; rating: number | null };

/** Visual/audio cue for the court renderer and sound engine. */
export type FxKind = 'swish' | 'three' | 'clank' | 'dunk' | 'block' | 'steal' | 'foul' | 'violation' | 'timeout' | 'quarterEnd' | 'gameEnd';
export interface Fx {
  kind: FxKind;
  /**
   * The team the event belongs to, so the home crowd knows whether to cheer or groan: the shooter's
   * team for shots and blocks, the team that lost the ball, the team called for a foul, the winner.
   */
  side?: Side;
  /** A free throw: a smaller moment than a basket from the field. */
  small?: boolean;
}

/** A clutch possession waiting for the humans' calls. The defence chooses first. */
export interface ClutchState {
  offence: Side;
  pending: ('offence' | 'defence')[];
  calls: PossessionCalls;
}

export type TacticsPatch = Partial<Pick<GamePlan, 'offence' | 'defence' | 'tempo'>>;

export interface QueuedSub {
  outId: string;
  inId: string;
}

/** What the on-court caption is showing, and which player it is about. */
export interface Caption {
  text: string;
  side: Side | null;
  key: string | null;
  kind: 'setup' | 'result';
}

export interface TeamView {
  lineup: string[];
  players: Record<string, PlayerView>;
  timeoutsLeft: number;
  quarterFouls: number;
  /** Team fouls in the last two minutes of the period. */
  lateFouls: number;
  /** The coach was ejected: his assistant runs the bench. */
  coachEjected: boolean;
  coachTechnicals: number;
}

export class LiveMatch {
  readonly s: MatchState;
  readonly names: Names;
  readonly controllers: [Controller, Controller];
  phase: Phase = 'playing';
  paused = false;
  speed: Speed;
  /**
   * Highlights only: the best plays of each quarter are shown (bring-up and set-up quickly), the
   * rest are played out instantly. Clutch moments are always shown.
   */
  highlights = true;
  /** Possessions being played out instantly, between two highlights. */
  skipping = false;
  /** The next highlight follows skipped play, so it cuts straight to the set-up. */
  private cut = false;
  private shown = { quarter: 0, count: 0 };
  /** Timeouts requested, applied at the next dead ball. */
  pending: [boolean, boolean] = [false, false];
  timeoutSide: Side | null = null;
  breakQuarter = 0;
  feed: FeedItem[] = [];
  tips: Tip[] = [];
  score: [number, number] = [0, 0];
  clock: number;
  quarter = 1;
  view: [TeamView, TeamView];
  version = 0;
  /** Subs and tactic changes ordered from the bench; they happen at the next dead ball. */
  queuedSubs: [QueuedSub[], QueuedSub[]] = [[], []];
  queuedTactics: [TacticsPatch | null, TacticsPatch | null] = [null, null];
  caption: Caption | null = null;
  clutch: ClutchState | null = null;
  /** Halftime team-talk reactions per side, once given. */
  talks: [{ talk: Talk; reaction: string } | null, { talk: Talk; reaction: string } | null] = [null, null];
  private fx: Fx[] = [];
  private clutchCalls: PossessionCalls | null = null;
  /**
   * Momentum as the picture has it: -1 (away) to 1 (home). It moves as each event appears on screen,
   * not when the engine has already played the possession (that would give away what is coming).
   */
  momentum = 0;
  /** The "Argue the call" button: whose, and until when (real seconds). Null when not up. */
  argue: { side: Side; until: number } | null = null;
  /**
   * A possession whose foul a human coach may argue: the match as it was before it was played, so
   * that it can be played again with the coach arguing (the engine is deterministic: up to the foul
   * it comes out the same), and which event the foul is.
   */
  private argueChance: { snapshot: MatchState; before: PossessionStart; prev: Frame | null; foulAt: number; side: Side } | null = null;
  /** Arguments offered per side and quarter (`side:quarter`), and the possession count at the last one. */
  private argueOffers: Record<string, number> = {};
  private lastArgueOffer: [number, number] = [-99, -99];
  private possessionCount = 0;
  /** Just back from a quarter break: an ejected coach's assistant passes on his orders now. */
  private atBreak = false;
  /** The assistant (not the ejected coach) is asking for this timeout. */
  private assistantAsks = false;
  /** Calls each human has been asked for, per period and role (`side:quarter:role`). */
  private clutchAsked: Record<string, number> = {};
  private slowMo = false;
  private routine = false;
  private captionBorn = 0;
  /** A set-up line that came while a result was still being read. */
  private heldCaption: Caption | null = null;
  private startedBeat = -1;

  private script: Script | null = null;
  private scriptEvents: TimedEvent[] = [];
  private durations: number[] = [];
  private beatEnds: number[] = [];
  /** Debugging: log every time a player holding the ball strays further than his two steps. */
  debugTravels = false;
  /** Everything the travelling check has logged, for tests. */
  readonly travels: TravelReport[] = [];
  /** The gather point last reported, so each one is logged once. */
  private travelled: object | null = null;
  /** The possession the clock was last run down for. */
  private clockOf: Script | null = null;
  private t = 0;
  private firedBeats = 0;
  private lastFrame: Frame | null = null;
  /**
   * Where everyone stood when the last skipped possession ended (highlights mode): the next clip
   * starts from there, so a fast break begins with the defence where it really was.
   */
  private carry: Frame | null = null;
  private motion = new Motion();
  private holder: string | null = null;
  private time = 0;
  private nextFeedId = 1;
  private tipMemory: TipMemory = createTipMemory();
  private sinceTimeout: [number, number] = [99, 99];
  /** Engine events up to this index have been (or will be, via the animation) published. */
  private publishedThrough = 0;

  constructor(home: Team, away: Team, plans: [GamePlan, GamePlan], seed: number, controllers: [Controller, Controller], speed: Speed) {
    this.s = createMatch(home, away, plans[0], plans[1], seed);
    this.s.humanCoach = [controllers[0] === 'human', controllers[1] === 'human'];
    this.names = namesFor(this.s);
    this.controllers = controllers;
    this.speed = speed;
    this.clock = this.s.clock;
    const ratings: Record<string, number> = {};
    for (const side of [0, 1] as const) for (const p of this.s.teams[side].team.players) ratings[playerKey(side, p.id)] = composite(p).speed;
    this.motion.setSpeedRatings(ratings);
    this.view = [this.snapshotTeam(0), this.snapshotTeam(1)];
    this.flushEngineEvents();
  }

  // ---- Public controls ------------------------------------------------------

  requestTimeout(side: Side): void {
    if (this.phase === 'final' || !canCallTimeout(this.s, side) || this.pending[side]) return;
    if (this.controllers[side] === 'human' && this.s.teams[side].coachEjected && !this.assistantAsks) {
      this.info('The coach has been ejected: the assistant decides on timeouts.', side);
      return;
    }
    this.pending[side] = true;
    this.info(`${this.s.teams[side].team.name} want a timeout: it comes at the next dead ball.`, side);
  }

  /** Orders a substitution from the bench. Returns an error message, or null if queued. */
  queueSub(side: Side, outId: string, inId: string): string | null {
    const t = this.s.teams[side];
    const lineup = this.lineupAfterQueue(side);
    if (!lineup.includes(outId)) return 'That player is not on court.';
    if (lineup.includes(inId)) return 'That player is already on court.';
    if (t.players[inId].fouledOut) return 'That player has fouled out.';
    this.queuedSubs[side] = [...this.queuedSubs[side], { outId, inId }];
    const name = (id: string) => this.names.player(side, id);
    this.info(`Sub requested: ${name(inId)} for ${name(outId)} (at the next dead ball).`, side);
    return null;
  }

  cancelSubs(side: Side): void {
    this.queuedSubs[side] = [];
    this.bump();
  }

  /** The five who will be on court once the queued subs go through. */
  lineupAfterQueue(side: Side): string[] {
    const lineup = [...this.s.teams[side].lineup];
    for (const { outId, inId } of this.queuedSubs[side]) {
      const i = lineup.indexOf(outId);
      if (i >= 0 && !lineup.includes(inId)) lineup[i] = inId;
    }
    return lineup;
  }

  /** Shouts a tactics change from the sideline; it applies at the next dead ball. */
  queueTactics(side: Side, patch: TacticsPatch): void {
    this.queuedTactics[side] = { ...(this.queuedTactics[side] ?? {}), ...patch };
    this.bump();
  }

  /** The tactics as they will be once queued shouts apply (for showing selections). */
  plannedTactics(side: Side): Required<TacticsPatch> {
    const p = this.s.teams[side].plan;
    return { offence: p.offence, defence: p.defence, tempo: p.tempo, ...(this.queuedTactics[side] ?? {}) };
  }

  /** A human's call in a clutch moment. Once everyone has chosen, play resumes in slow motion. */
  submitClutch(role: 'offence' | 'defence', call: OffenceCall | DefenceCall | null): void {
    const c = this.clutch;
    if (!c || c.pending[0] !== role) return;
    if (call) {
      if (role === 'offence') c.calls.offence = call as OffenceCall;
      else c.calls.defence = call as DefenceCall;
    }
    c.pending.shift();
    if (c.pending.length === 0) {
      this.clutchCalls = c.calls;
      this.clutch = null;
      this.phase = 'playing';
    }
    this.bump();
  }

  /** Halftime team talk for one side (once). */
  teamTalk(side: Side, talk: Talk): void {
    if (this.talks[side]) return;
    const out = giveTalk(this.s, side, talk);
    this.talks[side] = { talk, reaction: out.reaction };
    this.feedPush({ text: `${this.s.teams[side].team.name} team talk: ${out.reaction}`, side, kind: 'coach' });
  }

  /**
   * How loud the crowd is between plays, 0..1: a steady buzz during play, louder late in a close
   * game, a murmur in timeouts and breaks, and quieter when the game is paused or over.
   */
  crowdLevel(): number {
    if (this.phase === 'final') return 0.2;
    if (this.phase === 'timeout' || this.phase === 'break') return 0.35;
    if (this.paused) return 0.25;
    const s = this.s;
    const margin = Math.abs(s.teams[0].score - s.teams[1].score);
    const late = s.quarter >= 4 && s.clock <= LATE_SECONDS && margin <= LATE_MARGIN;
    return this.phase === 'clutch' || late || isClutch(s) ? 0.9 : 0.55;
  }

  /** Visual/audio cues produced since the last call. */
  drainFx(): Fx[] {
    const out = this.fx;
    this.fx = [];
    return out;
  }

  togglePause(): void {
    if (this.phase !== 'playing') return;
    this.paused = !this.paused;
    this.bump();
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
    if (this.script) this.retime();
    this.bump();
  }

  toggleHighlights(): void {
    this.highlights = !this.highlights;
    if (this.script) this.retime();
    this.bump();
  }

  /** Whether the beat on screen right now is being fast-forwarded. */
  isFastForwarding(): boolean {
    if (this.skipping && this.phase === 'playing') return true;
    const sc = this.script;
    if (!sc || this.phase !== 'playing') return false;
    return this.skips(sc.beats[beatAt(sc, this.durations, this.t).index]);
  }

  /** Applies a changed game plan for one side (during a timeout or break). */
  applyPlan(side: Side, plan: GamePlan): void {
    const before = this.s.teams[side].plan;
    setGamePlan(this.s, side, plan);
    const changes = describePlanChange(before, plan);
    // Whatever already happened at this dead ball (a substitution, say) goes in the feed first.
    this.flushEngineEvents();
    if (changes) this.feedPush({ text: `${this.s.teams[side].team.name}: ${changes}.`, side, kind: 'coach' });
    this.view[side] = this.snapshotTeam(side);
    this.bump();
  }

  /**
   * The coach argues the call: the possession is played again from the start with him arguing. Up to
   * the foul everything comes out exactly as it did (the engine is deterministic); from there on it
   * may not, and the picture carries on from the whistle.
   */
  argueCall(): void {
    const chance = this.argueChance;
    if (this.phase !== 'argue' || !chance) return;
    this.argueChance = null;
    this.argue = null;
    const s = this.s;
    Object.assign(s, chance.snapshot);
    s.calls = { ...(s.calls ?? {}), argue: chance.side };
    stepPossession(s);
    this.scriptEvents = s.events.slice(chance.before.start);
    this.script = this.buildFrom(chance.before, this.scriptEvents, chance.prev);
    this.retime();
    const at = this.script.beats.findIndex((b) => b.fire.includes(chance.foulAt));
    this.t = at >= 0 ? this.beatEnds[at] : 0;
    this.firedBeats = at + 1;
    this.startedBeat = at;
    this.publishedThrough = s.events.length;
    this.phase = 'playing';
    this.bump();
  }

  /** No argument (or the moment passed): play goes on as it was. */
  letItGo(): void {
    if (this.phase !== 'argue') return;
    this.argueChance = null;
    this.argue = null;
    this.phase = 'playing';
    this.bump();
  }

  /** Ends a timeout or a quarter break. */
  resume(): void {
    if (this.phase !== 'timeout' && this.phase !== 'break') return;
    if (this.phase === 'break') this.atBreak = true;
    this.phase = 'playing';
    this.timeoutSide = null;
    this.bump();
  }

  // ---- Animation loop -------------------------------------------------------

  /** Advances by `dt` real seconds. */
  tick(dt: number): void {
    this.time += dt;
    // Nobody went after the official in time: play on.
    if (this.phase === 'argue' && this.argue && this.time >= this.argue.until) this.letItGo();
    if (this.phase !== 'playing' || this.paused) return;
    if (!this.script) {
      this.nextPossession();
      return;
    }
    this.t += dt;
    const sc = this.script;
    // The clock only ever runs down, whatever the speed is changed to on the way.
    const clock = sc.clockStart - (sc.clockStart - sc.clockEnd) * this.running();
    const shown = Math.ceil(this.clock);
    this.clock = sc === this.clockOf ? Math.min(this.clock, clock) : clock;
    this.clockOf = sc;
    // The scoreboard redraws on a change: let it see every second go.
    if (Math.ceil(this.clock) !== shown) this.bump();
    // A set-up line held back while a result was being read comes up as soon as it has been.
    if (this.heldCaption && this.time - this.captionBorn >= CAPTION_READ_S) {
      const c = this.heldCaption;
      this.heldCaption = null;
      this.setCaption(c.text, c.side, c.key, c.kind);
    }
    while (this.firedBeats < sc.beats.length && this.t >= this.beatEnds[this.firedBeats]) {
      const beat = sc.beats[this.firedBeats];
      for (const i of beat.fire) this.publish(this.scriptEvents[i]);
      this.firedBeats++;
      const chance = this.argueChance;
      if (chance && beat.fire.includes(chance.foulAt)) {
        // The whistle has gone against him: the coach has a moment to go after the official.
        const key = `${chance.side}:${this.s.quarter}`;
        this.argueOffers[key] = (this.argueOffers[key] ?? 0) + 1;
        this.lastArgueOffer[chance.side] = this.possessionCount;
        this.argue = { side: chance.side, until: this.time + ARGUE_SECONDS };
        this.phase = 'argue';
        this.bump();
        return;
      }
    }
    if (this.firedBeats < sc.beats.length && this.startedBeat !== this.firedBeats) {
      this.startedBeat = this.firedBeats;
      const beat = sc.beats[this.firedBeats];
      if (beat.caption) this.setCaption(beat.caption, sc.offence, beat.spotlight ?? null, 'setup');
    }
    const { index, u } = beatAt(sc, this.durations, this.t);
    const beat = sc.beats[index];
    // Whoever has the ball in their hands: the holder, or a receiver once the pass has arrived.
    const b = beat.ball;
    this.holder = b.kind === 'held' ? b.holder : b.kind === 'pass' && this.motion.passArrived(b) ? b.to : null;
    const speedScale = (this.speed === 'fast' ? 2.1 : 1) / (this.slowMo ? 1.8 : 1);
    const rate = this.skips(beat) ? FAST_FORWARD[this.speed] : beat.slow ? 0.45 : 1;
    // In small enough steps that two players running at each other can never close more than half a
    // body width between two looks at them: otherwise, played fast, they could step through each other.
    const steps = Math.max(1, Math.ceil((dt * rate * speedScale * CLOSING_M_S) / MAX_CLOSING_STEP_M));
    for (let k = 0; k < steps; k++) {
      this.motion.update(beat.players, (dt * rate) / steps, speedScale, this.holder, beat.pace, beat.outOfBounds, {
        offence: sc.offence,
        dir: sc.dir,
        marking: beat.marking,
        pressing: beat.pressing,
        ball: this.lastFrame?.ball,
        dead: beat.dead,
        posting: beat.posting,
        through: beat.through,
        action: beat.ball,
        openBreak: beat.openBreak,
        openFloor: beat.phase === 'bringUp' || !!beat.openBreak,
      });
    }
    if (this.debugTravels) this.checkFootwork();
    const ball = this.motion.ball(beat.ball, u, sc.dir);
    this.motion.updateFacing(facingScene(sc, this.durations, index, u, ball, rate * speedScale), dt * rate, speedScale);
    this.motion.updateArms(beat, ball, u, dt * rate, speedScale);
    this.lastFrame = {
      players: { ...this.motion.pos },
      ball,
      facing: { ...this.motion.facing },
      look: { ...this.motion.look },
      stance: { ...this.motion.stance },
      reach: { ...this.motion.reach },
      lift: this.motion.jumps(beat, u),
      timeScale: rate * speedScale,
      shooter: beat.ball.kind === 'fromPlayer' && beat.ball.style !== 'throw' && u < 0.85 ? beat.ball.from : null,
    };
    if (this.firedBeats >= sc.beats.length) this.endPossession();
  }

  frame(): Frame | null {
    return this.lastFrame;
  }

  /** Player key of whoever has the ball right now (null while it's in the air). */
  holderKey(): string | null {
    return this.holder;
  }

  // ---- Internals ------------------------------------------------------------

  private nextPossession(): void {
    const s = this.s;
    if (s.finished) {
      this.phase = 'final';
      this.bump();
      return;
    }

    this.applyQueued();
    this.atBreak = false;

    for (const side of [0, 1] as const) {
      if (!this.pending[side]) continue;
      this.pending[side] = false;
      if (callTimeout(s, side)) {
        this.sinceTimeout[side] = 0;
        this.flushEngineEvents();
        this.phase = 'timeout';
        this.timeoutSide = side;
        // The other side may adjust too; an AI does so automatically.
        for (const sd of [0, 1] as const) if (this.controllers[sd] === 'ai') this.aiAdjust(sd);
        this.view = [this.snapshotTeam(0), this.snapshotTeam(1)];
        this.bump();
        return;
      }
    }

    if (s.clock > 0 && !this.clutchCalls && isClutch(s)) {
      const off = s.possession;
      const def = other(off);
      const pending: ClutchState['pending'] = [];
      const calls: PossessionCalls = {};
      // Each coach, human or AI, calls only the plays that count most (see asksForCall); the rest
      // of the finish is played with the game plan.
      const call = (side: Side, role: 'offence' | 'defence') => {
        const key = `${side}:${s.quarter}:${role}`;
        if (!asksForCall(s, role, this.clutchAsked[key] ?? 0)) return;
        this.clutchAsked[key] = (this.clutchAsked[key] ?? 0) + 1;
        if (!this.runsItself(side)) pending.push(role);
        else if (role === 'offence') calls.offence = (aiCall(s, side, 'offence') as OffenceCall | null) ?? undefined;
        else calls.defence = (aiCall(s, side, 'defence') as DefenceCall | null) ?? undefined;
      };
      call(def, 'defence');
      call(off, 'offence');
      if (pending.length > 0) {
        this.clutch = { offence: off, pending, calls };
        this.phase = 'clutch';
        this.bump();
        return;
      }
      if (calls.offence || calls.defence) this.clutchCalls = calls;
    }

    if (s.clock <= 0) {
      stepPossession(s); // ends the period
      this.flushEngineEvents();
      this.score = [s.teams[0].score, s.teams[1].score];
      this.view = [this.snapshotTeam(0), this.snapshotTeam(1)];
      if (s.finished) {
        this.phase = 'final';
      } else {
        this.phase = 'break';
        this.breakQuarter = s.quarter - 1;
        this.clock = s.clock;
        this.quarter = s.quarter;
        this.lastFrame = null;
        this.carry = null;
        this.motion.reset();
        for (const sd of [0, 1] as const) {
          if (this.controllers[sd] !== 'ai') continue;
          this.aiAdjust(sd);
          if (this.breakQuarter === 2) this.teamTalk(sd, aiTalk(s, sd));
        }
      }
      this.bump();
      return;
    }

    if (this.highlights && !this.clutchCalls) {
      if (this.shown.quarter !== s.quarter) this.shown = { quarter: s.quarter, count: 0 };
      const shown = this.isHighlight(s);
      if (!shown) {
        this.skipPossession();
        return;
      }
      // A trip to the line that matters is shown on top of the quarter's best plays.
      if (shown === 'play') this.shown.count++;
    }
    this.skipping = false;

    const before = this.possessionStart();
    const offence = before.offence;
    const start = before.start;
    this.slowMo = false;
    // Decided from the game situation alone: if the result decided it, slowing down would spoil it.
    const margin = Math.abs(s.teams[0].score - s.teams[1].score);
    this.routine = !isClutch(s) && !(s.quarter >= 4 && s.clock <= LATE_SECONDS && margin <= LATE_MARGIN);
    if (this.clutchCalls) {
      const calls = this.clutchCalls;
      this.clutchCalls = null;
      this.slowMo = true;
      s.calls = calls;
      if (calls.defence) emit(s, { type: 'playCall', side: other(offence), role: 'defence', call: calls.defence });
      if (calls.offence) emit(s, { type: 'playCall', side: offence, role: 'offence', call: calls.offence });
    }
    this.possessionCount++;
    const def = other(offence);
    const prev = this.lastFrame ?? this.carry;
    // A human coach gets the chance to argue when he sees the call, so the match is kept as it was,
    // to play it again if he does. (An AI coach argues now and then by himself, in the engine.)
    const team = s.teams[def];
    const mayArgue =
      this.controllers[def] === 'human' &&
      !team.coachEjected &&
      !s.calls &&
      (this.argueOffers[`${def}:${s.quarter}`] ?? 0) < ARGUE_PER_QUARTER &&
      this.possessionCount - this.lastArgueOffer[def] >= ARGUE_GAP_POSSESSIONS &&
      unit(`${s.seed}:${start}:offer`) < ARGUE_SHARE;
    const snapshot = mayArgue ? structuredClone(s) : null;
    stepPossession(s);
    this.scriptEvents = s.events.slice(start);
    this.quarter = s.quarter;
    const energy: Record<string, number> = {};
    for (const side of [0, 1] as const) for (const id of before.lineups[side]) energy[playerKey(side, id)] = s.teams[side].players[id].energy;
    this.motion.setEnergy(energy);
    this.script = this.buildFrom(before, this.scriptEvents, prev);
    this.argueChance = null;
    if (snapshot) {
      // A reach-in or a hold called on his team, with nothing in the air: that can be argued.
      const foulAt = this.scriptEvents.findIndex((e) => e.type === 'foul' && !e.shooting && e.side === def);
      if (foulAt >= 0) this.argueChance = { snapshot, before, prev, foulAt, side: def };
    }
    this.retime();
    this.t = 0;
    this.firedBeats = 0;
    this.startedBeat = -1;
    this.publishedThrough = s.events.length;
    if (this.cut) {
      // Like a highlight on television, it starts at the set-up: the bring-up is not news. Anything
      // that happened on the way (a substitution, say) still fires as the clock passes it. The
      // picture cuts straight to where everyone is at that moment; nobody runs there from the last
      // clip shown.
      this.cut = false;
      const setUp = this.script.beats.findIndex((b) => b.phase === 'setUp');
      if (setUp > 0) this.t = this.beatEnds[setUp - 1];
      const at = setUp > 0 ? this.script.beats[setUp - 1].players : prev?.players;
      if (at) this.motion.place(at);
    }
    this.carry = null;
  }

  private retime(): void {
    if (!this.script) return;
    const cfg = SPEEDS[this.speed];
    const real = Math.min(cfg.max, Math.max(cfg.min, (this.script.clockStart - this.script.clockEnd) / cfg.div)) * (this.slowMo ? 1.8 : 1);
    const beats = this.script.beats;
    // Picks up exactly where it was, in the same beat and as far through it: never back in time.
    const at = this.durations.length === beats.length ? beatAt(this.script, this.durations, this.t) : { index: 0, u: 0 };
    this.durations = beatDurations(this.script, real, (this.slowMo ? 1.8 : 1) / (this.speed === 'fast' ? 2.1 : 1)).map((d, i) => (this.skips(beats[i]) ? d / FAST_FORWARD[this.speed] : d));
    let acc = 0;
    this.beatEnds = this.durations.map((d) => (acc += d));
    this.t = (at.index > 0 ? this.beatEnds[at.index - 1] : 0) + at.u * this.durations[at.index];
  }

  /**
   * Whether the coming possession is one of the quarter's best still to come. The rest of the quarter
   * is played on a copy of the match (the engine is deterministic, so the copy plays out exactly what
   * the real game will) and every possession scored; this one is shown if it ranks among the ones
   * left to show. Decided afresh each time, so a timeout or a substitution is taken into account.
   */
  private isHighlight(s: MatchState): 'play' | 'extra' | false {
    if (isClutch(s)) return 'play';
    const left = HIGHLIGHTS_PER_QUARTER - this.shown.count;
    const copy = structuredClone(s);
    const quarter = copy.quarter;
    const scores: number[] = [];
    let first: TimedEvent[] | null = null;
    while (!copy.finished && copy.quarter === quarter && copy.clock > 0) {
      const before: [number, number] = [copy.teams[0].score, copy.teams[1].score];
      const start = copy.events.length;
      stepPossession(copy);
      const events = copy.events.slice(start);
      first ??= events;
      scores.push(excitement(events, before, copy));
      // With the five already shown only this possession matters: no need to look further.
      if (left <= 0) break;
    }
    // Ties go to the earlier play.
    if (left > 0 && (scores.length <= left || scores.slice(1).filter((x) => x > scores[0]).length < left)) return 'play';
    // Not among the best: still shown if it is a trip to the line that matters.
    return first && freeThrowsThatMatter(s, first) ? 'extra' : false;
  }

  /** Plays a possession out instantly: the score, the feed and the stats move on; nothing is shown or heard. */
  private skipPossession(): void {
    const s = this.s;
    if (!this.skipping) this.setCaption('» To the next highlight…', null, null, 'setup');
    this.skipping = true;
    this.cut = true;
    const before = this.possessionStart();
    const prev = this.lastFrame ?? this.carry;
    stepPossession(s);
    // Not shown, but worked out all the same, for where everyone is when it ends.
    const script = this.buildFrom(before, s.events.slice(before.start), prev);
    const end = script.beats[script.beats.length - 1];
    this.carry = { players: end.players, ball: { ...endBall(end), z: 1 } };
    for (let i = this.publishedThrough; i < s.events.length; i++) this.publish(s.events[i], true);
    this.publishedThrough = s.events.length;
    this.quarter = s.quarter;
    this.lastFrame = null;
    this.motion.reset();
    this.endPossession();
  }

  /** What the animation needs to know about a possession, read before it is played. */
  private possessionStart(): PossessionStart {
    const s = this.s;
    const offence = s.possession;
    return {
      offence,
      lineups: [[...s.teams[0].lineup], [...s.teams[1].lineup]],
      defence: s.teams[other(offence)].plan.defence,
      clockStart: s.clock,
      how: s.transition,
      start: s.events.length,
    };
  }

  /** The animation script of a possession just played, from where everyone was. */
  private buildFrom(b: PossessionStart, events: TimedEvent[], prev: Frame | null): Script {
    const s = this.s;
    const name = (sd: Side, id: string) => this.names.player(sd, id);
    return buildScript(
      {
        offence: b.offence,
        quarter: s.quarter,
        lineups: b.lineups,
        focus: s.teams[b.offence].plan.offence,
        defence: b.defence,
        keyMatchup: s.teams[other(b.offence)].plan.keyMatchup,
        moveFactor: (key) => this.motion.moveFactor(key),
        clockStart: b.clockStart,
        clockEnd: s.clock,
        start: b.how,
        restart: b.how === 'none' ? this.restartAfter(b.start) : undefined,
        tempo: s.teams[b.offence].plan.tempo,
        name,
      },
      events,
      prev,
    );
  }

  /**
   * The travelling check: whoever has the ball in his hands, not dribbling, must stay within his
   * two steps of where he gathered it. Every time one strays further is logged once.
   */
  private checkFootwork(): void {
    const h = this.motion.handle;
    if (!h || h.mode === 'dribbling' || this.travelled === h.at) return;
    const p = this.motion.pos[h.key];
    const distance = p ? Math.hypot(p.x - h.at.x, p.y - h.at.y) : 0;
    if (distance <= GATHER_STEPS_M) return;
    this.travelled = h.at;
    const side = Number(h.key.slice(0, h.key.indexOf(':'))) as Side;
    const id = h.key.slice(h.key.indexOf(':') + 1);
    const report: TravelReport = {
      player: this.names.player(side, id),
      number: this.s.teams[side].team.players.find((pl) => pl.id === id)?.number ?? 0,
      distance,
      quarter: this.quarter,
      clock: this.clock,
      how: h.how,
      event: this.caption?.text ?? this.feed[0]?.text ?? '',
    };
    this.travels.push(report);
    console.warn(`Travel: ${report.player} #${report.number} is ${distance.toFixed(2)} m from where he gathered the ball (${report.how}), Q${report.quarter} ${clockString(report.clock)}, during "${report.event}"`);
  }

  /**
   * How much of the possession's running time has gone: the clock stands still while the ball is
   * dead. Bringing the ball up and setting up it runs as fast as the players move, so the eight seconds on
   * the scoreboard are eight seconds on the floor; whatever else the possession took goes by in the
   * half court.
   */
  private running(): number {
    const sc = this.script;
    if (!sc) return 1;
    let bringUp = 0;
    let rest = 0;
    let end = 0;
    sc.beats.forEach((b, i) => {
      const d = this.durations[i] ?? 0;
      if (!b.dead && b.phase !== 'play') bringUp += d;
      else if (!b.dead) rest += d;
      end += d;
    });
    const total = bringUp + rest;
    const game = sc.clockStart - sc.clockEnd;
    if (total <= 0 || game <= 0) return this.t >= end ? 1 : 0;
    const scale = (this.speed === 'fast' ? 2.1 : 1) / (this.slowMo ? 1.8 : 1);
    const rate = game / total;
    const bringUpRate = rest > 0 ? Math.min(rate, BRING_UP_CLOCK_RATE * scale) : rate;
    const restRate = rest > 0 ? (game - bringUp * bringUpRate) / rest : rate;
    let run = 0;
    let start = 0;
    sc.beats.forEach((b, i) => {
      const d = this.durations[i] ?? 0;
      if (!b.dead) run += Math.max(0, Math.min(d, this.t - start)) * (b.phase !== 'play' ? bringUpRate : restRate);
      start += d;
    });
    return Math.min(1, run / game);
  }

  /** How the ball comes back into play, from whatever ended the play before the possession starting at event `from`. */
  private restartAfter(from: number): Restart {
    const events = this.s.events;
    for (let i = from - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'quarterStart') return e.quarter === 1 || e.quarter >= 5 ? { kind: 'tip' } : { kind: 'centre' };
      if (e.type === 'shot' || e.type === 'freeThrow') return { kind: 'made' };
      if (e.type === 'turnover' || e.type === 'foul') return { kind: 'sideline', at: this.lastFrame?.ball ?? { x: COURT.w / 2, y: 0 } };
    }
    return { kind: 'tip' };
  }

  private skips(beat: Beat): boolean {
    return this.highlights && this.routine && beat.phase !== 'play';
  }

  private endPossession(): void {
    const s = this.s;
    this.script = null;
    this.clock = s.clock;
    this.score = [s.teams[0].score, s.teams[1].score];
    this.view = [this.snapshotTeam(0), this.snapshotTeam(1)];
    for (const tip of assistantTips(s, this.tipMemory)) this.tips = [tip, ...this.tips].slice(0, 30);
    for (const side of [0, 1] as const) {
      this.sinceTimeout[side]++;
      if (this.runsItself(side) && !this.pending[side] && aiShouldTimeout(s, side, this.sinceTimeout[side])) {
        this.assistantAsks = true;
        this.requestTimeout(side);
        this.assistantAsks = false;
      }
    }
    this.bump();
  }

  /** Dead ball: put through the subs and tactic shouts ordered from the bench. */
  /** An AI coach, or a human coach's assistant after he was ejected: the side decides for itself. */
  runsItself(side: Side): boolean {
    return this.controllers[side] === 'ai' || this.s.teams[side].coachEjected;
  }

  private applyQueued(): void {
    for (const side of [0, 1] as const) {
      // With the coach ejected, his orders reach the floor through the assistant at the quarter break.
      if (this.s.teams[side].coachEjected && this.controllers[side] === 'human' && !this.atBreak) continue;
      const subs = this.queuedSubs[side];
      const tactics = this.queuedTactics[side];
      if (subs.length === 0 && !tactics) continue;
      const t = this.s.teams[side];
      const lineup = this.lineupAfterQueue(side).filter((id) => !t.players[id].fouledOut);
      this.queuedSubs[side] = [];
      this.queuedTactics[side] = null;
      if (lineup.length !== 5) continue;
      const rest = [...t.plan.starters, ...t.plan.bench, ...t.team.players.map((p) => p.id)].filter(
        (id, i, all) => !lineup.includes(id) && all.indexOf(id) === i,
      );
      this.applyPlan(side, { ...t.plan, ...(tactics ?? {}), starters: lineup, bench: rest });
    }
  }

  private setCaption(text: string, side: Side | null, key: string | null, kind: Caption['kind']): void {
    // Let a result ("BANG!") stay readable before the next setup line replaces it; the line waits.
    if (kind === 'setup' && this.caption?.kind === 'result' && this.time - this.captionBorn < CAPTION_READ_S) {
      this.heldCaption = { text, side, key, kind };
      return;
    }
    this.heldCaption = null;
    this.caption = { text, side, key, kind };
    this.captionBorn = this.time;
    this.bump();
  }

  private aiAdjust(side: Side): void {
    this.applyPlan(side, aiAdjustPlan(this.s, side));
  }

  /** Publishes engine events not shown via an animation (timeouts, period ends, plan-change subs). */
  private flushEngineEvents(): void {
    for (let i = this.publishedThrough; i < this.s.events.length; i++) this.publish(this.s.events[i]);
    this.publishedThrough = this.s.events.length;
  }

  /** `quiet`: into the feed and the score only, without sound or caption (a skipped possession). */
  private publish(ev: TimedEvent, quiet = false): void {
    this.score = ev.score;
    if (ev.momentum !== undefined) this.momentum = ev.momentum;
    this.quarter = ev.quarter;
    const text = commentate(ev, this.names);
    if (!text) return;
    const side = 'side' in ev ? ev.side : ev.type === 'gameEnd' ? ev.winner : null;
    const scoring = (ev.type === 'shot' && ev.made) || (ev.type === 'freeThrow' && ev.made);
    const kind: FeedItem['kind'] = scoring ? 'score' : ev.type === 'sub' || ev.type.startsWith('quarter') || ev.type === 'timeout' ? 'info' : 'play';
    this.feed = [{ id: this.nextFeedId++, text, quarter: ev.quarter, clock: ev.clock, side, kind }, ...this.feed].slice(0, 200);
    if (!quiet) this.cue(ev);
    if (!quiet && ev.type !== 'sub') {
      const actor = eventActor(ev);
      this.setCaption(text, side, actor ? playerKey(actor.side, actor.id) : null, 'result');
    }
    this.bump();
  }

  /** Sound cues for an event as it appears on screen. */
  private cue(ev: TimedEvent): void {
    const fx = this.fx;
    switch (ev.type) {
      case 'shot':
        fx.push({ kind: ev.made ? (ev.dunk ? 'dunk' : ev.shotType === 'three' ? 'three' : 'swish') : ev.blockerId ? 'block' : 'clank', side: ev.side });
        break;
      case 'freeThrow':
        fx.push({ kind: ev.made ? 'swish' : 'clank', side: ev.side, small: true });
        break;
      case 'foul':
      case 'technical':
        fx.push({ kind: 'foul', side: ev.side });
        break;
      case 'timeout':
        fx.push({ kind: 'timeout', side: ev.side });
        break;
      case 'turnover':
        // A steal is the crowd's moment; anything else stops play with the whistle.
        fx.push({ kind: ev.stealerId ? 'steal' : ev.cause === 'offensiveFoul' ? 'foul' : 'violation', side: ev.side });
        break;
      case 'quarterEnd':
        fx.push({ kind: 'quarterEnd' });
        break;
      case 'gameEnd':
        fx.push({ kind: 'gameEnd', side: ev.winner });
        break;
    }
  }

  private info(text: string, side: Side | null): void {
    this.feedPush({ text, side, kind: 'info' });
  }

  private feedPush(item: Omit<FeedItem, 'id' | 'quarter' | 'clock'>): void {
    this.feed = [{ ...item, id: this.nextFeedId++, quarter: this.s.quarter, clock: this.clock }, ...this.feed].slice(0, 200);
    this.bump();
  }

  private snapshotTeam(side: Side): TeamView {
    const t = this.s.teams[side];
    const players: Record<string, PlayerView> = {};
    for (const [id, p] of Object.entries(t.players)) {
      players[id] = {
        energy: p.energy,
        fouls: p.fouls,
        fouledOut: p.fouledOut,
        ejected: p.ejected,
        technicals: p.technicals,
        pts: p.stats.pts,
        reb: p.stats.oreb + p.stats.dreb,
        ast: p.stats.ast,
        seconds: p.stats.seconds,
        rating: playerRating(p.stats),
      };
    }
    return { lineup: [...t.lineup], players, timeoutsLeft: t.timeoutsLeft, quarterFouls: t.quarterFouls, lateFouls: t.lateFouls, coachEjected: t.coachEjected, coachTechnicals: t.coachTechnicals };
  }

  private bump(): void {
    this.version++;
  }
}

/** The player an event is mainly about (for the spotlight ring). */
function eventActor(ev: TimedEvent): { side: Side; id: string } | null {
  switch (ev.type) {
    case 'shot':
      return ev.blockerId ? { side: other(ev.side), id: ev.blockerId } : { side: ev.side, id: ev.shooterId };
    case 'rebound':
      return { side: ev.side, id: ev.playerId };
    case 'turnover':
      return ev.stealerId ? { side: other(ev.side), id: ev.stealerId } : { side: ev.side, id: ev.playerId };
    case 'foul':
      return { side: ev.side, id: ev.playerId };
    case 'freeThrow':
      return { side: ev.side, id: ev.shooterId };
    case 'fastBreak':
      return { side: ev.side, id: ev.leaderId };
    case 'pressBroken':
      return { side: ev.side, id: ev.handlerId };
    case 'doubleTeam':
      return { side: ev.side, id: ev.targetId };
    default:
      return null;
  }
}

const LABELS: Record<string, string> = {
  inside: 'inside focus',
  balanced: 'balanced offence',
  three: '3-point barrage',
  pickAndRoll: 'pick-and-roll',
  fastBreak: 'fast-break offence',
  man: 'man-to-man',
  zone: '2-3 zone',
  press: 'full-court press',
  slow: 'slow tempo',
  normal: 'normal tempo',
  fast: 'fast tempo',
};

export function describePlanChange(a: GamePlan, b: GamePlan): string {
  const parts: string[] = [];
  if (a.offence !== b.offence) parts.push(`switches to ${LABELS[b.offence]}`);
  if (a.defence !== b.defence) parts.push(`goes ${LABELS[b.defence]}`);
  if (a.tempo !== b.tempo) parts.push(`${LABELS[b.tempo]}`);
  if (a.keyMatchup.kind !== b.keyMatchup.kind) parts.push(b.keyMatchup.kind === 'double' ? 'starts double-teaming' : 'stops doubling');
  return parts.join(', ');
}
