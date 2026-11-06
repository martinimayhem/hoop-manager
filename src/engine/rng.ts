// Seeded PRNG (mulberry32). The state lives in a plain object so a MatchState
// can be cloned or serialised and replayed exactly.

import type { RngState } from './types';

export function createRng(seed: number): RngState {
  return { state: seed >>> 0 };
}

/** Uniform float in [0, 1). */
export function next(rng: RngState): number {
  let t = (rng.state = (rng.state + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function chance(rng: RngState, p: number): boolean {
  return next(rng) < p;
}

/** Uniform float in [min, max). */
export function range(rng: RngState, min: number, max: number): number {
  return min + next(rng) * (max - min);
}

export function int(rng: RngState, min: number, maxInclusive: number): number {
  return min + Math.floor(next(rng) * (maxInclusive - min + 1));
}

export function pick<T>(rng: RngState, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick() on empty array');
  return items[Math.floor(next(rng) * items.length)];
}

/** Picks an item with probability proportional to its weight. */
export function weighted<T>(rng: RngState, items: readonly T[], weight: (item: T) => number): T {
  if (items.length === 0) throw new Error('weighted() on empty array');
  let total = 0;
  const weights = items.map((item) => {
    const w = Math.max(0, weight(item));
    total += w;
    return w;
  });
  if (total <= 0) return pick(rng, items);
  let roll = next(rng) * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll < 0) return items[i];
  }
  return items[items.length - 1];
}
