// Synthesised sound effects (no audio files): swish, rim, dunk, whistle and buzzer.
// Uses Web Audio; starts on the first effect after a user click.

import type { Fx } from './match/controller';

const MUTE_KEY = 'hoop-manager:muted';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
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
    if (this.master) this.master.gain.value = muted ? 0 : 0.8;
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  stop(): void {
    void this.ctx?.close();
    this.ctx = null;
  }

  play(fx: Fx[]): void {
    if (fx.length === 0 || this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    if (ctx.state === 'suspended') void ctx.resume();
    for (const f of fx) {
      switch (f.kind) {
        case 'swish':
          this.noiseBurst(4500, 0.18, 0.25, 'bandpass');
          break;
        case 'clank':
          this.tone(520, 'triangle', 0.12, 0.25);
          this.tone(1340, 'triangle', 0.06, 0.2);
          break;
        case 'dunk':
          this.sweep(140, 45, 'sine', 0.5, 0.3);
          this.tone(480, 'square', 0.05, 0.25);
          break;
        case 'block':
          this.sweep(220, 70, 'sine', 0.4, 0.15);
          break;
        case 'whistle':
          this.whistle();
          break;
        case 'buzzer':
          this.tone(165, 'sawtooth', 0.12, 0.9);
          this.tone(170, 'sawtooth', 0.08, 0.9);
          break;
      }
    }
  }

  private envelope(peak: number, duration: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    g.connect(this.master!);
    return g;
  }

  private tone(freq: number, type: OscillatorType, peak: number, duration: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(this.envelope(peak, duration));
    o.start();
    o.stop(ctx.currentTime + duration + 0.05);
  }

  private sweep(from: number, to: number, type: OscillatorType, peak: number, duration: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + duration);
    o.connect(this.envelope(peak, duration));
    o.start();
    o.stop(ctx.currentTime + duration + 0.05);
  }

  private noiseBurst(freq: number, peak: number, duration: number, type: BiquadFilterType) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    src.connect(f).connect(this.envelope(peak, duration));
    src.start();
    src.stop(ctx.currentTime + duration + 0.05);
  }

  private whistle() {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.value = 2900;
    const trem = ctx.createOscillator();
    trem.frequency.value = 28;
    const tremGain = ctx.createGain();
    tremGain.gain.value = 0.04;
    const env = this.envelope(0.08, 0.45);
    const vca = ctx.createGain();
    vca.gain.value = 0.06;
    trem.connect(tremGain).connect(vca.gain);
    o.connect(vca).connect(env);
    o.start();
    trem.start();
    o.stop(ctx.currentTime + 0.5);
    trem.stop(ctx.currentTime + 0.5);
  }
}
