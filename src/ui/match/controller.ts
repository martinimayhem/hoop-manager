// Drives a live match: steps the engine one possession at a time, plays the animation,
// releases commentary when the animation reaches it, and pauses for timeouts and breaks.
// Framework-free; the React screen polls `version` to know when to re-render.

import { describe as commentate, namesFor, type Names } from '../../engine/commentary';
import { callTimeout, canCallTimeout, createMatch, setGamePlan, stepPossession } from '../../engine/match';
import { composite } from '../../engine/ratings';
import { emit, other } from '../../engine/state';
import type { DefenceCall, GamePlan, MatchState, OffenceCall, PlayerGameState, PossessionCalls, Side, Team, TimedEvent } from '../../engine/types';
import { playerRating } from '../../engine/stats';
import { aiCall, isClutch } from '../../game/clutch';
import { aiTalk, giveTalk, type Talk } from '../../game/teamTalk';
import { aiAdjustPlan, aiShouldTimeout } from '../../game/ai';
import { assistantTips, createTipMemory, type Tip, type TipMemory } from '../../game/assistant';
import type { Controller } from '../../game/draft';
import { beatAt, beatDurations, buildScript, playerKey, type Beat, type Frame, type Script } from '../court/animation';
import { Motion } from '../court/motion';

export type Speed = 'normal' | 'fast';
export type Phase = 'playing' | 'timeout' | 'break' | 'clutch' | 'final';

/**
 * Game seconds per real second, and per-possession clamps. Normal plays at running speeds a real
 * player could reach (≈ 7.5 min per quarter); Fast trades that for pace (≈ 4 min per quarter).
 */
const SPEEDS: Record<Speed, { div: number; min: number; max: number }> = {
  normal: { div: 1.9, min: 4.5, max: 12 },
  fast: { div: 4.5, min: 2, max: 5 },
};

/** How much faster bring-up and set-up play on a routine possession. */
const FAST_FORWARD: Record<Speed, number> = { normal: 2.5, fast: 2 };
/** The last two minutes of a game this close is never routine. */
const LATE_SECONDS = 120;
const LATE_MARGIN = 8;
const REBOUND_JUMP_FT = 2.6;

export interface FeedItem {
  id: number;
  text: string;
  quarter: number;
  clock: number;
  side: Side | null;
  kind: 'play' | 'score' | 'info' | 'coach';
}

/** Per-player numbers as of the last completed possession (so panels don't spoil the animation). */
export type PlayerView = Pick<PlayerGameState, 'energy' | 'fouls' | 'fouledOut'> & { pts: number; reb: number; ast: number; seconds: number; rating: number | null };

/** Visual/audio cue for the court renderer and sound engine. */
export type FxKind = 'swish' | 'clank' | 'dunk' | 'block' | 'whistle' | 'buzzer';
export interface Fx {
  kind: FxKind;
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
}

export class LiveMatch {
  readonly s: MatchState;
  readonly names: Names;
  readonly controllers: [Controller, Controller];
  phase: Phase = 'playing';
  paused = false;
  speed: Speed;
  /** Plays through bring-up and set-up quickly on routine possessions. */
  fastForward = true;
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
  private slowMo = false;
  private routine = false;
  private captionBorn = 0;
  private startedBeat = -1;

  private script: Script | null = null;
  private scriptEvents: TimedEvent[] = [];
  private durations: number[] = [];
  private beatEnds: number[] = [];
  private t = 0;
  private firedBeats = 0;
  private lastFrame: Frame | null = null;
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

  toggleFastForward(): void {
    this.fastForward = !this.fastForward;
    if (this.script) this.retime();
    this.bump();
  }

  /** Whether the beat on screen right now is being fast-forwarded. */
  isFastForwarding(): boolean {
    const sc = this.script;
    if (!sc || this.phase !== 'playing') return false;
    return this.skips(sc.beats[beatAt(sc, this.durations, this.t).index]);
  }

  /** Applies a changed game plan for one side (during a timeout or break). */
  applyPlan(side: Side, plan: GamePlan): void {
    const before = this.s.teams[side].plan;
    setGamePlan(this.s, side, plan);
    const changes = describePlanChange(before, plan);
    if (changes) this.feedPush({ text: `${this.s.teams[side].team.name}: ${changes}.`, side, kind: 'coach' });
    this.flushEngineEvents();
    this.view[side] = this.snapshotTeam(side);
    this.bump();
  }

  /** Ends a timeout or a quarter break. */
  resume(): void {
    if (this.phase !== 'timeout' && this.phase !== 'break') return;
    this.phase = 'playing';
    this.timeoutSide = null;
    this.bump();
  }

  // ---- Animation loop -------------------------------------------------------

  /** Advances by `dt` real seconds. */
  tick(dt: number): void {
    this.time += dt;
    if (this.phase !== 'playing' || this.paused) return;
    if (!this.script) {
      this.nextPossession();
      return;
    }
    this.t += dt;
    const sc = this.script;
    const total = this.beatEnds[this.beatEnds.length - 1] ?? 0;
    this.clock = sc.clockStart - (sc.clockStart - sc.clockEnd) * Math.min(1, this.t / Math.max(0.001, total));
    while (this.firedBeats < sc.beats.length && this.t >= this.beatEnds[this.firedBeats]) {
      const beat = sc.beats[this.firedBeats];
      for (const i of beat.fire) this.publish(this.scriptEvents[i]);
      this.firedBeats++;
    }
    if (this.firedBeats < sc.beats.length && this.startedBeat !== this.firedBeats) {
      this.startedBeat = this.firedBeats;
      const beat = sc.beats[this.firedBeats];
      if (beat.caption) this.setCaption(beat.caption, sc.offence, beat.spotlight ?? null, 'setup');
    }
    const { index, u } = beatAt(sc, this.durations, this.t);
    const beat = sc.beats[index];
    this.holder = beat.ball.kind === 'held' ? beat.ball.holder : null;
    const speedScale = (this.speed === 'fast' ? 2.1 : 1) / (this.slowMo ? 1.8 : 1);
    const rate = this.skips(beat) ? FAST_FORWARD[this.speed] : beat.slow ? 0.45 : 1;
    this.motion.update(beat.players, dt * rate, speedScale, this.holder, beat.pace, beat.outOfBounds);
    const lift = this.motion.lift(beat.ball, u);
    const jumps: Record<string, number> = lift ? { [lift.key]: lift.height } : {};
    for (const k of beat.jump ?? []) jumps[k] = REBOUND_JUMP_FT * Math.sin(Math.PI * u);
    this.lastFrame = {
      players: { ...this.motion.pos },
      ball: this.motion.ball(beat.ball, u, sc.dir),
      lift: jumps,
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
      if (this.controllers[def] === 'human') pending.push('defence');
      if (this.controllers[off] === 'human') pending.push('offence');
      if (pending.length > 0) {
        const calls: PossessionCalls = {};
        if (this.controllers[off] === 'ai') calls.offence = (aiCall(s, off, 'offence') as OffenceCall | null) ?? undefined;
        if (this.controllers[def] === 'ai') calls.defence = (aiCall(s, def, 'defence') as DefenceCall | null) ?? undefined;
        this.clutch = { offence: off, pending, calls };
        this.phase = 'clutch';
        this.bump();
        return;
      }
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

    const offence = s.possession;
    const lineups: [string[], string[]] = [[...s.teams[0].lineup], [...s.teams[1].lineup]];
    const defence = s.teams[other(offence)].plan.defence;
    const clockStart = s.clock;
    const how = s.transition;
    const start = s.events.length;
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
    stepPossession(s);
    this.scriptEvents = s.events.slice(start);
    this.quarter = s.quarter;
    const name = (sd: Side, id: string) => this.names.player(sd, id);
    const energy: Record<string, number> = {};
    for (const side of [0, 1] as const) for (const id of lineups[side]) energy[playerKey(side, id)] = s.teams[side].players[id].energy;
    this.motion.setEnergy(energy);
    this.script = buildScript(
      {
        offence,
        quarter: s.quarter,
        lineups,
        focus: s.teams[offence].plan.offence,
        defence,
        keyMatchup: s.teams[other(offence)].plan.keyMatchup,
        moveFactor: (key) => this.motion.moveFactor(key),
        clockStart,
        clockEnd: s.clock,
        start: how,
        name,
      },
      this.scriptEvents,
      this.lastFrame,
    );
    this.retime();
    this.t = 0;
    this.firedBeats = 0;
    this.startedBeat = -1;
    this.publishedThrough = s.events.length;
  }

  private retime(): void {
    if (!this.script) return;
    const cfg = SPEEDS[this.speed];
    const real = Math.min(cfg.max, Math.max(cfg.min, (this.script.clockStart - this.script.clockEnd) / cfg.div)) * (this.slowMo ? 1.8 : 1);
    const fraction = this.beatEnds.length ? this.t / (this.beatEnds[this.beatEnds.length - 1] || 1) : 0;
    const beats = this.script.beats;
    this.durations = beatDurations(this.script, real, (this.slowMo ? 1.8 : 1) / (this.speed === 'fast' ? 2.1 : 1)).map((d, i) => (this.skips(beats[i]) ? d / FAST_FORWARD[this.speed] : d));
    let acc = 0;
    this.beatEnds = this.durations.map((d) => (acc += d));
    this.t = fraction * acc;
  }

  private skips(beat: Beat): boolean {
    return this.fastForward && this.routine && beat.phase !== 'play';
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
      if (this.controllers[side] === 'ai' && !this.pending[side] && aiShouldTimeout(s, side, this.sinceTimeout[side])) {
        this.requestTimeout(side);
      }
    }
    this.bump();
  }

  /** Dead ball: put through the subs and tactic shouts ordered from the bench. */
  private applyQueued(): void {
    for (const side of [0, 1] as const) {
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
    // Let a result ("BANG!") stay readable before the next setup line replaces it.
    if (kind === 'setup' && this.caption?.kind === 'result' && this.time - this.captionBorn < 1.1) return;
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

  private publish(ev: TimedEvent): void {
    this.score = ev.score;
    this.quarter = ev.quarter;
    const text = commentate(ev, this.names);
    if (!text) return;
    const side = 'side' in ev ? ev.side : ev.type === 'gameEnd' ? ev.winner : null;
    const scoring = (ev.type === 'shot' && ev.made) || (ev.type === 'freeThrow' && ev.made);
    const kind: FeedItem['kind'] = scoring ? 'score' : ev.type === 'sub' || ev.type.startsWith('quarter') || ev.type === 'timeout' ? 'info' : 'play';
    this.feed = [{ id: this.nextFeedId++, text, quarter: ev.quarter, clock: ev.clock, side, kind }, ...this.feed].slice(0, 200);
    this.cue(ev);
    if (ev.type !== 'sub') {
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
        fx.push({ kind: ev.made ? (ev.dunk ? 'dunk' : 'swish') : ev.blockerId ? 'block' : 'clank' });
        break;
      case 'freeThrow':
        fx.push({ kind: ev.made ? 'swish' : 'clank' });
        break;
      case 'foul':
      case 'timeout':
        fx.push({ kind: 'whistle' });
        break;
      case 'quarterEnd':
      case 'gameEnd':
        fx.push({ kind: 'buzzer' });
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
        pts: p.stats.pts,
        reb: p.stats.oreb + p.stats.dreb,
        ast: p.stats.ast,
        seconds: p.stats.seconds,
        rating: playerRating(p.stats),
      };
    }
    return { lineup: [...t.lineup], players, timeoutsLeft: t.timeoutsLeft, quarterFouls: t.quarterFouls };
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
