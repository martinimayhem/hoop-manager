// The arena's sound: the net's swish, the rim, dunks, blocks, the referee's whistle, the buzzer,
// and a home crowd that murmurs through the game and reacts to every play: cheering its own team,
// groaning at the other's baskets, booing fouls. Uses Web Audio, started after the tip-off click,
// and plays through a short arena reverb so everything sits in the same room.
//
// Recordings in src/ui/sounds/ are used where RECIPES below say so, cut and levelled as the game
// loads them (the README there says why each cut was chosen). Anything without a recording, or
// whose file is missing, is synthesised instead.

import type { Side } from '../engine/types';
import type { Fx } from './match/controller';

const MUTE_KEY = 'hoop-manager:muted';
const VOLUME = 0.8;
/** The crowd belongs to the home team. */
const HOME: Side = 0;

/** Sounds that a recording can replace. */
export type SampleName =
  | 'swish'
  | 'soft-swish'
  | 'rim'
  | 'dunk'
  | 'block'
  | 'whistle'
  | 'buzzer'
  | 'cheer'
  | 'big-cheer'
  | 'ovation'
  | 'applause'
  | 'boo'
  | 'groan'
  | 'crowd';

/** One cut of a recording: from `start` to `end` seconds, with fades, levelled for its role. */
interface Cut {
  file: string;
  start?: number;
  end?: number;
  fadeIn?: number;
  fadeOut?: number;
  /** Bass boost in dB, below about 150 Hz: more weight under a hit. */
  bass?: number;
  /** Another stretch of the same recording mixed in from the start of the cut, at `gain`. */
  under?: { start: number; end: number; gain: number };
}

/** Where the bass boost starts to roll off (Hz). */
const BASS_SHELF_HZ = 150;

/**
 * Which recording plays as which sound. Several cuts for one sound are variations, picked at
 * random so that two baskets in a row never sound copied.
 */
const RECIPES: Partial<Record<SampleName, Cut[]>> = {
  // Leading silence cut, so the swish lands as the ball drops through the net.
  swish: [{ file: 'basketball-swish_OMsr9CN.mp3', start: 0.2, end: 1.1, fadeOut: 0.2 }],
  // Softer, for the hush of a free throw; the 2.5 s of silence after it dropped.
  'soft-swish': [{ file: 'ElevenLabs_Swoosh_of_a_basketball_net,_satisfying_and_crisp.mp3', end: 0.65, fadeOut: 0.15 }],
  rim: [{ file: 'basketball_rim_hit.wav', fadeOut: 0.1 }],
  // The recording has a deep sub-bass whoomp at 0.25 s and the slam itself (the crash on the rim and
  // its rattle) at 0.85 s, with silence around both. Cut to the slam, with the whoomp laid under its
  // first instant and the low end lifted, so the hit lands with a boom; the rattle fades by 1.75 s.
  dunk: [{ file: 'dunk.mp3', start: 0.85, end: 2.6, fadeIn: 0.004, fadeOut: 0.5, bass: 4, under: { start: 0.25, end: 0.45, gain: 0.7 } }],
  // Short bursts for a home basket.
  cheer: [
    { file: 'loud-crowd-cheering.mp3', fadeOut: 0.5 },
    { file: 'ElevenLabs_Crowd_cheering_in_a_packed_stadium,_electric_atmosphere.mp3', start: 0.08, fadeIn: 0.04, fadeOut: 0.5 },
  ],
  // Starts once the roar is already building, so the crowd reacts the instant a three drops.
  'big-cheer': [{ file: 'cheer-from-crowd.mp3', start: 0.45, fadeOut: 1 }],
  // A long, steady ovation for the end of a quarter or a win.
  ovation: [{ file: 'crowd-cheer.mp3', fadeIn: 0.1, fadeOut: 1 }],
  // The one long stretch at an even level, looped under the whole game.
  crowd: [{ file: 'crowd-cheering-sound-effect-download.mp3', start: 4.5, end: 11 }],
};

/** Loud transients are levelled by their peak, crowds by their average loudness. */
const PEAK_LEVELLED: SampleName[] = ['swish', 'soft-swish', 'rim', 'dunk', 'block', 'whistle', 'buzzer'];
const PEAK = 0.7;
const AVERAGE = 0.08;
/** A looped recording blends its end into its start over this long, so the seam cannot be heard. */
const LOOP_CROSSFADE = 1;

/** Every audio file in ./sounds, by file name (bundled by Vite). */
const FILES: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob('./sounds/*.{ogg,mp3,wav}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>).map(([path, url]) => [
    path.slice(path.lastIndexOf('/') + 1),
    url,
  ]),
);

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Dry signal and the reverb send: every sound feeds both. */
  private bus: GainNode | null = null;
  private send: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private claps: AudioBuffer | null = null;
  private samples: Partial<Record<SampleName, AudioBuffer[]>> = {};
  private lastVariant: Partial<Record<SampleName, AudioBuffer>> = {};
  /** The crowd under everything: its volume follows the game. */
  private bed: GainNode | null = null;
  /** The background's layers, each drifting in level on its own so the room never sits still. */
  private bedLayers: GainNode[] = [];
  /** The timer that brings the next little moment out of the murmur. */
  private ambience: number | null = null;
  private crowdLevel = 0;
  muted: boolean;

  constructor() {
    let muted = false;
    try {
      muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      // Storage unavailable: default to sound on.
    }
    this.muted = muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // Ignore: the setting just won't persist.
    }
    if (this.master) this.master.gain.value = muted ? 0 : VOLUME;
  }

  /** How loud the background crowd is, 0..1. Called every frame; changes glide rather than jump. */
  setCrowd(level: number): void {
    if (Math.abs(level - this.crowdLevel) < 0.001 && this.bed) return;
    this.crowdLevel = level;
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.bed) return;
    this.wake(ctx);
    this.bed.gain.setTargetAtTime(0.24 * level, ctx.currentTime, 0.8);
  }

  /** Silences everything while the player is away from the game. */
  suspend(): void {
    this.ctx?.suspend().catch(() => {});
  }

  /** Brings the sound back when they return. */
  resume(): void {
    if (this.ctx && !this.muted) this.wake(this.ctx);
  }

  private wake(ctx: AudioContext): void {
    // Closing the match while the audio is still waking up must not raise an error.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    this.ctx = ctx;

    // Master -> limiter -> speakers, so a dunk with a roaring crowd never clips.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 8;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : VOLUME;
    this.master.connect(limiter);

    this.bus = ctx.createGain();
    this.bus.connect(this.master);
    const reverb = ctx.createConvolver();
    reverb.buffer = this.arena(ctx);
    reverb.connect(this.master);
    this.send = ctx.createGain();
    this.send.gain.value = 0.28;
    this.send.connect(reverb);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.claps = this.clapBuffer(ctx);

    this.bed = ctx.createGain();
    this.bed.gain.value = 0;
    this.bed.connect(this.bus);
    this.bed.connect(this.send);
    this.startBed();
    this.scheduleAmbience();
    void this.loadSamples(ctx);
    return ctx;
  }

  /** A big room's echo: decaying noise, a little different in each ear. */
  private arena(ctx: AudioContext): AudioBuffer {
    const seconds = 1.6;
    const buffer = ctx.createBuffer(2, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3.2;
    }
    return buffer;
  }

  /** Four seconds of thousands of hands: short bright clicks at random. */
  private clapBuffer(ctx: AudioContext): AudioBuffer {
    const rate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, rate * 4, rate);
    const data = buffer.getChannelData(0);
    const clapLength = Math.floor(rate * 0.012);
    for (let n = 0; n < 4 * 140; n++) {
      const at = Math.floor(Math.random() * (data.length - clapLength));
      const level = 0.3 + Math.random() * 0.7;
      for (let i = 0; i < clapLength; i++) data[at + i] += (Math.random() * 2 - 1) * level * Math.exp(-i / (clapLength * 0.25));
    }
    return buffer;
  }

  private async loadSamples(ctx: AudioContext): Promise<void> {
    const decoded = new Map<string, Promise<AudioBuffer>>();
    const decode = (file: string) => {
      if (!decoded.has(file)) decoded.set(file, fetch(FILES[file]).then((r) => r.arrayBuffer()).then((data) => ctx.decodeAudioData(data)));
      return decoded.get(file)!;
    };
    for (const [name, cuts] of Object.entries(RECIPES) as [SampleName, Cut[]][]) {
      for (const cut of cuts) {
        if (!FILES[cut.file]) continue;
        try {
          const buffer = this.cut(ctx, await decode(cut.file), cut, name);
          (this.samples[name] ??= []).push(buffer);
          if (name === 'crowd' && this.ctx === ctx) this.startBed();
        } catch {
          // A file that will not decode just leaves the synthesised sound in place.
        }
      }
    }
  }

  /** Cuts, fades and levels one recording; a loop gets its end blended into its start. */
  private cut(ctx: AudioContext, source: AudioBuffer, cut: Cut, name: SampleName): AudioBuffer {
    const rate = source.sampleRate;
    const from = Math.floor((cut.start ?? 0) * rate);
    const to = Math.min(source.length, Math.floor((cut.end ?? source.duration) * rate));
    const loop = name === 'crowd';
    const blend = loop ? Math.min(Math.floor(LOOP_CROSSFADE * rate), Math.floor((to - from) / 3)) : 0;
    const length = to - from - blend;
    const out = ctx.createBuffer(source.numberOfChannels, length, rate);
    let peak = 0;
    let energy = 0;
    const underFrom = cut.under ? Math.floor(cut.under.start * rate) : 0;
    const underLength = cut.under ? Math.floor((cut.under.end - cut.under.start) * rate) : 0;
    // One-pole low-pass for the bass boost: whatever passes it is added back on top.
    const shelf = Math.exp((-2 * Math.PI * BASS_SHELF_HZ) / rate);
    const boost = cut.bass ? 10 ** (cut.bass / 20) - 1 : 0;
    for (let ch = 0; ch < source.numberOfChannels; ch++) {
      const src = source.getChannelData(ch);
      const dst = out.getChannelData(ch);
      let low = 0;
      for (let i = 0; i < length; i++) {
        let v = src[from + i];
        if (cut.under && i < underLength) v += src[underFrom + i] * cut.under.gain;
        if (boost) {
          low = (1 - shelf) * v + shelf * low;
          v += low * boost;
        }
        // Equal-power blend: the start fades in while the recording's own end fades out over it.
        if (i < blend) v = v * Math.sqrt(i / blend) + src[from + length + i] * Math.sqrt(1 - i / blend);
        const t = i / rate;
        const end = (length - i) / rate;
        if (cut.fadeIn && t < cut.fadeIn) v *= t / cut.fadeIn;
        if (cut.fadeOut && end < cut.fadeOut) v *= end / cut.fadeOut;
        dst[i] = v;
        peak = Math.max(peak, Math.abs(v));
        energy += v * v;
      }
    }
    const average = Math.sqrt(energy / (length * source.numberOfChannels)) || 1;
    const gain = PEAK_LEVELLED.includes(name) ? PEAK / (peak || 1) : AVERAGE / average;
    // Never louder than full scale, whatever the levelling asks for.
    const safe = Math.min(gain, 0.98 / (peak || 1));
    for (let ch = 0; ch < out.numberOfChannels; ch++) {
      const dst = out.getChannelData(ch);
      for (let i = 0; i < length; i++) dst[i] *= safe;
    }
    return out;
  }

  stop(): void {
    if (this.ambience !== null) window.clearTimeout(this.ambience);
    this.ambience = null;
    void this.ctx?.close();
    this.ctx = null;
    this.bed = null;
    this.crowdLevel = 0;
  }

  play(fx: Fx[]): void {
    if (fx.length === 0 || this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    this.wake(ctx);
    const t = ctx.currentTime + 0.01;
    for (const f of fx) {
      const home = f.side === HOME;
      switch (f.kind) {
        case 'swish':
          this.swish(t, f.small ? 0.8 : 1, f.small);
          if (f.small) home ? this.applause(t + 0.1, 0.45, 1.6) : this.groan(t + 0.15, 0.15);
          else if (home) this.cheer(t + 0.08, 0.65, 2.2);
          else {
            this.applause(t + 0.1, 0.18, 1.2);
            this.groan(t + 0.15, 0.25);
          }
          break;
        case 'three':
          this.swish(t, 1.1);
          if (home) this.cheer(t + 0.06, 1, 3.4, true);
          else this.groan(t + 0.1, 0.65);
          break;
        case 'clank':
          this.rim(t, 1);
          // Their own team missing hurts; the visitors missing is a relief.
          if (home) this.groan(t + 0.12, f.small ? 0.2 : 0.35);
          else this.cheer(t + 0.12, 0.22, 1.2);
          break;
        case 'dunk':
          this.slam(t);
          if (home) this.cheer(t + 0.04, 1, 3.6, true);
          else this.groan(t + 0.1, 0.5);
          break;
        case 'block':
          // \`side\` is the shooter's team: the crowd is with whoever is defending its basket.
          this.slap(t);
          if (home) this.ooh(t + 0.05, 0.6);
          else {
            this.ooh(t + 0.05, 0.8);
            this.cheer(t + 0.2, 0.75, 2.2);
          }
          break;
        case 'steal':
          // \`side\` is the team that lost the ball.
          if (home) this.groan(t, 0.35);
          else this.cheer(t, 0.7, 1.8);
          break;
        case 'foul':
          // `side` is the team called for it. The whistle first, a hard blast that cuts through the
          // noise; the crowd reacts once it has heard it: against the home team the place erupts.
          this.whistle(t, [0.55], 1);
          this.boo(t + 0.6, home ? 1 : 0.4, home ? 3 : 1.8, home);
          break;
        case 'violation':
          this.whistle(t, [0.14, 0.32]);
          if (home) this.groan(t + 0.3, 0.3);
          else this.cheer(t + 0.3, 0.45, 1.5);
          break;
        case 'timeout':
          this.whistle(t, [0.2, 0.2]);
          break;
        case 'quarterEnd':
          this.buzzer(t);
          if (!this.sample('ovation', t + 0.4, 0.75, 3.5)) this.cheer(t + 0.4, 0.7, 3.5);
          break;
        case 'gameEnd':
          this.buzzer(t);
          if (home) {
            // The biggest moment of the night: an ovation with a roar on top.
            if (this.sample('ovation', t + 0.3, 1, 7)) this.sample('big-cheer', t + 0.3, 0.8, 5);
            else this.cheer(t + 0.3, 1, 6, true);
          } else {
            this.boo(t + 0.4, 0.7, 3, false);
            this.applause(t + 2, 0.25, 3);
          }
          break;
      }
    }
  }

  // ---- Building blocks ----------------------------------------------------

  /** A gain stage feeding the room: dry plus reverb send. */
  private out(level: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = level;
    g.connect(this.bus!);
    g.connect(this.send!);
    return g;
  }

  /** Attack, then an exponential fall to silence: the shape of anything struck. */
  private struck(param: AudioParam, t: number, peak: number, attack: number, decay: number): void {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /** Swell in, hold, then die away steadily to the end: the shape of a crowd reacting. */
  private swell(param: AudioParam, t: number, peak: number, rise: number, duration: number): void {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + rise);
    param.setValueAtTime(peak, t + Math.max(rise, duration * 0.45));
    param.linearRampToValueAtTime(0.0001, t + duration);
  }

  private noiseSource(t: number, duration: number): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    // Start somewhere different each time, so repeated sounds are not identical.
    src.start(t, Math.random() * 1.5, duration + 0.1);
    return src;
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private osc(type: OscillatorType, freq: number, t: number, duration: number): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.start(t);
    o.stop(t + duration + 0.05);
    return o;
  }

  /**
   * Plays the file for \`name\` if there is one, shortened with a fade (or looped) to \`duration\`.
   * Returns false when there is no file, so the caller synthesises the sound instead.
   */
  private sample(name: SampleName, t: number, level: number, duration?: number): boolean {
    const variants = this.samples[name];
    if (!variants || variants.length === 0) return false;
    // A different take from last time, when there is one.
    const fresh = variants.filter((v) => v !== this.lastVariant[name]);
    const buffer = (fresh.length > 0 ? fresh : variants)[Math.floor(Math.random() * (fresh.length || variants.length))];
    this.lastVariant[name] = buffer;
    const src = this.ctx!.createBufferSource();
    src.buffer = buffer;
    // A crowd is never the same twice: nudge its pitch and pace a little.
    if (!PEAK_LEVELLED.includes(name)) src.playbackRate.value = 0.96 + Math.random() * 0.08;
    const length = duration ?? buffer.duration;
    src.loop = length > buffer.duration;
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.setValueAtTime(level, t + Math.max(0, length - 0.3));
    g.gain.linearRampToValueAtTime(0.0001, t + length);
    src.connect(g).connect(this.out(1));
    src.start(t);
    src.stop(t + length + 0.05);
    return true;
  }

  // ---- The crowd ------------------------------------------------------------

  /** The murmur under the whole game: a recording if there is one, otherwise bands of voices breathing. */
  private bedSources: AudioScheduledSourceNode[] = [];
  private startBed(): void {
    const ctx = this.ctx!;
    for (const s of this.bedSources) s.stop();
    this.bedSources = [];
    this.bedLayers = [];
    const recording = this.samples.crowd?.[0];
    if (recording) {
      // Two copies of the loop at different speeds drift against each other, so the texture never
      // repeats exactly. Dulled a little, so the room sounds busy rather than excited.
      const dull = this.filter('lowpass', 1900, 0.5);
      dull.connect(this.bed!);
      for (const [rate, offset] of [
        [1, 0],
        [0.9, recording.duration * 0.5],
      ]) {
        const src = ctx.createBufferSource();
        src.buffer = recording;
        src.loop = true;
        src.playbackRate.value = rate;
        const g = ctx.createGain();
        g.gain.value = 0.55;
        src.connect(g).connect(dull);
        src.start(0, offset);
        this.bedSources.push(src);
        this.bedLayers.push(g);
      }
      return;
    }
    for (const [freq, q, rate, level] of [
      [260, 1, 0.13, 1],
      [520, 1.2, 0.21, 0.8],
      [950, 1.5, 0.17, 0.55],
      [1700, 2, 0.29, 0.3],
    ] as const) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = level;
      const drift = ctx.createOscillator();
      drift.frequency.value = rate;
      const depth = ctx.createGain();
      depth.gain.value = level * 0.35;
      drift.connect(depth).connect(g.gain);
      src.connect(this.filter('bandpass', freq, q)).connect(g).connect(this.bed!);
      src.start(0, Math.random() * 2);
      drift.start();
      this.bedSources.push(src, drift);
    }
  }

  /** Every few seconds: the room's energy drifts, and now and then something stands out from it. */
  private scheduleAmbience(): void {
    if (this.ambience !== null) window.clearTimeout(this.ambience);
    this.ambience = window.setTimeout(() => {
      this.ambientMoment();
      this.scheduleAmbience();
    }, 1500 + Math.random() * 3000);
  }

  private ambientMoment(): void {
    const ctx = this.ctx;
    // Nothing piles up while the sound is paused: these would all play at once on return.
    if (!ctx || ctx.state !== 'running' || this.muted || this.crowdLevel <= 0) return;
    const t = ctx.currentTime + 0.05;
    const level = this.crowdLevel;
    for (const g of this.bedLayers) g.gain.setTargetAtTime(0.3 + Math.random() * 0.5, t, 1.2 + Math.random() * 1.5);
    if (Math.random() > 0.45) return;
    const pick = Math.random();
    if (pick < 0.3) this.applause(t, 0.25 * level, 0.6 + Math.random());
    else if (pick < 0.5) this.fanWhistle(t, level);
    else if (pick < 0.75) this.shout(t, level);
    else if (pick < 0.9) this.crowd(t, 0.25 * level, 2 + Math.random() * 1.5);
    else this.chantClaps(t, level);
  }

  /** Someone whistling through their fingers, somewhere up in the stands. */
  private fanWhistle(t: number, level: number): void {
    const length = 0.35 + Math.random() * 0.3;
    const base = 1900 + Math.random() * 500;
    const tone = this.osc('sine', base, t, length);
    tone.frequency.linearRampToValueAtTime(base * 1.25, t + length * 0.35);
    tone.frequency.linearRampToValueAtTime(base * 0.95, t + length);
    const g = this.ctx!.createGain();
    this.swell(g.gain, t, 0.08 * level, 0.04, length);
    tone.connect(g).connect(this.out(0.6));
  }

  /** A single voice calling out: "let's go!", "come on!". Not words, just the shape of one. */
  private shout(t: number, level: number): void {
    const syllables = 1 + Math.floor(Math.random() * 3);
    const pitch = 170 + Math.random() * 120;
    let at = t;
    for (let i = 0; i < syllables; i++) {
      const length = 0.14 + Math.random() * 0.16;
      const voice = this.osc('sawtooth', pitch * (1.1 + Math.random() * 0.2), at, length);
      voice.frequency.exponentialRampToValueAtTime(pitch * 0.85, at + length);
      const vowel = this.filter('bandpass', 700 + Math.random() * 700, 3);
      const g = this.ctx!.createGain();
      this.struck(g.gain, at, 0.8 * level, 0.02, length);
      voice.connect(vowel).connect(g).connect(this.out(0.5));
      at += length + 0.05;
    }
  }

  /** A section clapping a rhythm together: clap clap, clap clap clap. */
  private chantClaps(t: number, level: number): void {
    for (const beat of [0, 0.32, 0.8, 1.02, 1.24]) {
      // Many hands at once: one sharp, bright burst per beat.
      const g = this.ctx!.createGain();
      this.struck(g.gain, t + beat, 0.6 * level, 0.003, 0.08);
      this.noiseSource(t + beat, 0.12).connect(this.filter('bandpass', 1300, 0.7)).connect(g).connect(this.out(0.7));
    }
  }

  /** A wash of excited voices that swells, holds and dies away. Level 0..1. */
  private crowd(t: number, level: number, duration: number): void {
    for (const [freq, q, rate] of [
      [420, 1.4, 2.3],
      [780, 1.6, 3.1],
      [1350, 1.8, 3.9],
      [2300, 2.2, 4.6],
    ] as const) {
      const g = this.ctx!.createGain();
      this.swell(g.gain, t, 0.32 * level, Math.min(0.4, duration * 0.2), duration);
      const breathe = this.osc('sine', rate, t, duration);
      const depth = this.ctx!.createGain();
      depth.gain.value = 0.06 * level;
      breathe.connect(depth).connect(g.gain);
      this.noiseSource(t, duration).connect(this.filter('bandpass', freq, q)).connect(g).connect(this.out(0.9));
    }
  }

  private applause(t: number, level: number, duration: number): void {
    if (this.sample('applause', t, level, duration)) return;
    const src = this.ctx!.createBufferSource();
    src.buffer = this.claps;
    src.loop = true;
    const g = this.ctx!.createGain();
    this.swell(g.gain, t, 0.5 * level, 0.25, duration);
    src.connect(this.filter('bandpass', 2200, 0.5)).connect(g).connect(this.out(1));
    src.start(t, Math.random() * 3);
    src.stop(t + duration + 0.1);
  }

  /** Cheering: a roar, applause, and voices whooping over the top. \`big\` for threes and dunks. */
  private cheer(t: number, level: number, duration: number, big = false): void {
    if (this.sample(big ? 'big-cheer' : 'cheer', t, level, duration) || (big && this.sample('cheer', t, level * 1.2, duration))) return;
    this.crowd(t, level * (big ? 1.25 : 1), duration);
    this.applause(t + 0.15, level * 0.8, duration * 0.9);
    const whoops = Math.round((big ? 9 : 4) * level);
    for (let i = 0; i < whoops; i++) {
      const start = t + Math.random() * duration * 0.4;
      const length = 0.35 + Math.random() * 0.5;
      const base = 520 + Math.random() * 520;
      const voice = this.osc('triangle', base, start, length);
      voice.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.4), start + length * 0.6);
      const g = this.ctx!.createGain();
      this.swell(g.gain, start, 0.035 * level, 0.08, length);
      voice.connect(g).connect(this.out(0.8));
    }
  }

  /** A choir of voices on one vowel, sliding in pitch: the base of groans, "ooh"s and boos. */
  private voices(t: number, level: number, duration: number, pitches: number[], vowel: [number, number], slide: number, wobble = 0): void {
    const formant = this.filter('bandpass', vowel[0], 2.5);
    formant.frequency.setValueAtTime(vowel[0], t);
    formant.frequency.exponentialRampToValueAtTime(vowel[1], t + duration);
    const g = this.ctx!.createGain();
    this.swell(g.gain, t, level, Math.min(0.35, duration * 0.25), duration);
    formant.connect(g).connect(this.out(0.8));
    for (const pitch of pitches) {
      const start = t + Math.random() * 0.25;
      const voice = this.osc('sawtooth', pitch * (0.97 + Math.random() * 0.06), start, duration);
      voice.frequency.exponentialRampToValueAtTime(pitch * slide, start + duration);
      if (wobble > 0) {
        const vibrato = this.osc('sine', 4 + Math.random() * 2, start, duration);
        const depth = this.ctx!.createGain();
        depth.gain.value = pitch * wobble;
        vibrato.connect(depth).connect(voice.frequency);
      }
      const vg = this.ctx!.createGain();
      vg.gain.value = 0.16;
      voice.connect(vg).connect(formant);
    }
  }

  /** Disappointment: "awww", falling. */
  private groan(t: number, level: number): void {
    if (this.sample('groan', t, level)) return;
    this.voices(t, level, 1.6, [180, 205, 230, 260, 290, 320], [760, 520], 0.72);
    this.crowd(t, level * 0.4, 1.3);
  }

  /** The crowd's "ooh" at a block. */
  private ooh(t: number, level: number): void {
    this.voices(t, 0.9 * level, 1.2, [165, 196, 220, 247, 262], [560, 420], 0.85);
    this.crowd(t, 0.4 * level, 1.3);
  }

  /** Booing, and at full anger, people shouting at the referee over the top. */
  private boo(t: number, level: number, duration: number, angry: boolean): void {
    if (!this.sample('boo', t, level, duration)) {
      this.voices(t, 1.5 * level, duration, [98, 110, 123, 131, 147, 165, 175, 196], [380, 330], 0.93, 0.02);
      this.crowd(t, level * 0.45, duration);
    }
    if (!angry) return;
    for (let i = 0; i < 6; i++) {
      // Short, harsh shouts: a voice that jumps up and falls, through an open "ey" vowel.
      const start = t + 0.2 + Math.random() * duration * 0.6;
      const length = 0.18 + Math.random() * 0.25;
      const pitch = 210 + Math.random() * 110;
      const voice = this.osc('sawtooth', pitch * 1.25, start, length);
      voice.frequency.exponentialRampToValueAtTime(pitch * 0.8, start + length);
      const vowel = this.filter('bandpass', 1100 + Math.random() * 500, 3);
      const g = this.ctx!.createGain();
      this.struck(g.gain, start, 0.25 * level, 0.02, length);
      voice.connect(vowel).connect(g).connect(this.out(0.8));
    }
  }

  // ---- The game -------------------------------------------------------------

  /** The ball through the net: an airy swoosh that falls in pitch, and the strings rustling after. */
  private swish(t: number, size: number, soft = false): void {
    if ((soft && this.sample('soft-swish', t, size)) || this.sample('swish', t, size)) return;
    const air = this.filter('bandpass', 7500, 1.1);
    air.frequency.setValueAtTime(7500, t);
    air.frequency.exponentialRampToValueAtTime(2200, t + 0.32);
    const airGain = this.ctx!.createGain();
    this.struck(airGain.gain, t, 0.55 * size, 0.02, 0.36);
    this.noiseSource(t, 0.4).connect(air).connect(airGain).connect(this.out(1));

    // The net: fine, fluttering high noise for a moment after the ball has gone through.
    const net = this.filter('highpass', 4200, 0.5);
    const netGain = this.ctx!.createGain();
    this.struck(netGain.gain, t + 0.06, 0.22 * size, 0.03, 0.3);
    const flutter = this.osc('sine', 34, t, 0.45);
    const depth = this.ctx!.createGain();
    depth.gain.value = 0.12 * size;
    flutter.connect(depth).connect(netGain.gain);
    this.noiseSource(t + 0.06, 0.4).connect(net).connect(netGain).connect(this.out(1));
  }

  /** Iron: a short metallic ring of inharmonic partials over a dull thud. */
  private rim(t: number, force: number): void {
    if (this.sample('rim', t, force)) return;
    const detune = 0.97 + Math.random() * 0.06;
    const partials: [number, number, number][] = [
      [560, 0.32, 0.55],
      [1290, 0.2, 0.35],
      [2140, 0.14, 0.24],
      [3310, 0.08, 0.16],
      [4780, 0.05, 0.1],
    ];
    for (const [freq, level, decay] of partials) {
      const g = this.ctx!.createGain();
      this.struck(g.gain, t, level * force, 0.003, decay);
      this.osc('sine', freq * detune, t, decay + 0.05).connect(g).connect(this.out(1.2));
    }
    const thud = this.ctx!.createGain();
    this.struck(thud.gain, t, 0.4 * force, 0.004, 0.08);
    this.noiseSource(t, 0.12).connect(this.filter('lowpass', 900)).connect(thud).connect(this.out(1));
  }

  /** A dunk: a heavy hit, the rim rattling on its spring, and the backboard shaking. */
  private slam(t: number): void {
    if (this.sample('dunk', t, 1)) return;
    const boom = this.osc('sine', 130, t, 0.45);
    boom.frequency.exponentialRampToValueAtTime(42, t + 0.4);
    const boomGain = this.ctx!.createGain();
    this.struck(boomGain.gain, t, 0.9, 0.005, 0.42);
    boom.connect(boomGain).connect(this.out(1));
    const crack = this.ctx!.createGain();
    this.struck(crack.gain, t, 0.5, 0.002, 0.1);
    this.noiseSource(t, 0.15).connect(this.filter('bandpass', 1500, 0.6)).connect(crack).connect(this.out(1));
    // The rim keeps ringing, wobbling as the spring settles.
    this.rim(t + 0.01, 0.8);
    const rattle = this.ctx!.createGain();
    this.struck(rattle.gain, t + 0.04, 0.12, 0.01, 0.6);
    const wobble = this.osc('square', 21, t, 0.7);
    const wobbleDepth = this.ctx!.createGain();
    wobbleDepth.gain.value = 0.1;
    wobble.connect(wobbleDepth).connect(rattle.gain);
    this.osc('triangle', 780, t + 0.04, 0.65).connect(rattle).connect(this.out(0.7));
  }

  /** A hand on the ball: a sharp slap with a little weight behind it. */
  private slap(t: number): void {
    if (this.sample('block', t, 1)) return;
    const g = this.ctx!.createGain();
    this.struck(g.gain, t, 1, 0.002, 0.07);
    this.noiseSource(t, 0.1).connect(this.filter('bandpass', 1900, 0.9)).connect(g).connect(this.out(1));
    const thump = this.osc('sine', 170, t, 0.15);
    thump.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    const tg = this.ctx!.createGain();
    this.struck(tg.gain, t, 0.5, 0.003, 0.13);
    thump.connect(tg).connect(this.out(1));
  }

  /**
   * The referee's pea whistle: a shrill tone with the pea's rapid warble in both pitch and
   * volume, plus breath. One blast per entry in \`blasts\` (seconds each).
   */
  private whistle(t: number, blasts: number[], loud = 0.6): void {
    let at = t;
    for (const length of blasts) {
      if (this.sample('whistle', at, 0.9 * (0.5 + loud / 2), length)) {
        at += length + 0.09;
        continue;
      }
      const tone = this.osc('sine', 2750, at, length);
      tone.frequency.linearRampToValueAtTime(3050, at + 0.04);
      const overtone = this.osc('sine', 6100, at, length);
      const trill = this.osc('sine', 31 + Math.random() * 4, at, length);
      const pitchWobble = this.ctx!.createGain();
      pitchWobble.gain.value = 70;
      trill.connect(pitchWobble).connect(tone.frequency);

      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0.0001, at);
      // Loud enough for a foul to stand out over the crowd; a violation or a timeout a little softer.
      const peak = 0.42 * loud;
      g.gain.exponentialRampToValueAtTime(peak, at + 0.012);
      g.gain.setValueAtTime(peak, at + length - 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, at + length);
      const volumeWobble = this.ctx!.createGain();
      volumeWobble.gain.value = 0.06;
      trill.connect(volumeWobble).connect(g.gain);
      const og = this.ctx!.createGain();
      og.gain.value = 0.18;
      tone.connect(g);
      overtone.connect(og).connect(g);
      g.connect(this.out(0.9));

      const breath = this.ctx!.createGain();
      breath.gain.setValueAtTime(0.0001, at);
      breath.gain.exponentialRampToValueAtTime(0.13 * loud, at + 0.01);
      breath.gain.exponentialRampToValueAtTime(0.0001, at + length);
      this.noiseSource(at, length).connect(this.filter('bandpass', 3000, 3)).connect(breath).connect(this.out(1));
      at += length + 0.09;
    }
  }

  /** The end-of-period horn: loud, buzzy and flat. */
  private buzzer(t: number): void {
    const length = 1.1;
    if (this.sample('buzzer', t, 1, length)) return;
    const tone = this.filter('lowpass', 2400, 0.8);
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    g.gain.setValueAtTime(0.22, t + length - 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    tone.connect(g).connect(this.out(1));
    for (const [type, freq, level] of [
      ['sawtooth', 220, 0.5],
      ['sawtooth', 223.5, 0.45],
      ['square', 110, 0.3],
    ] as const) {
      const v = this.ctx!.createGain();
      v.gain.value = level;
      this.osc(type, freq, t, length).connect(v).connect(tone);
    }
  }
}
