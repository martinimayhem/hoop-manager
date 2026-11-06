import { describe, expect, it } from 'vitest';
import { createRng, next, weighted } from '../src/engine/rng';

describe('rng', () => {
  it('reproduces the same sequence for the same seed', () => {
    const a = createRng(123);
    const b = createRng(123);
    const seqA = Array.from({ length: 50 }, () => next(a));
    const seqB = Array.from({ length: 50 }, () => next(b));
    expect(seqA).toEqual(seqB);
  });

  it('gives different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(Array.from({ length: 5 }, () => next(a))).not.toEqual(Array.from({ length: 5 }, () => next(b)));
  });

  it('stays in [0, 1) with a mean near 0.5', () => {
    const rng = createRng(99);
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const x = next(rng);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
    }
    expect(sum / 20000).toBeCloseTo(0.5, 1);
  });

  it('weighted() picks in proportion to the weights', () => {
    const rng = createRng(7);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 10000; i++) counts[weighted(rng, ['a', 'b'] as const, (k) => (k === 'a' ? 3 : 1))]++;
    expect(counts.a / 10000).toBeGreaterThan(0.72);
    expect(counts.a / 10000).toBeLessThan(0.78);
  });
});
