// Fuzzy information. Ratings of players you don't own are shown as ranges; famous players are
// well documented (narrow ranges), unknowns are a guess. The true value always lies inside the range.

import type { Attributes, Player } from '../engine/types';
import { hashUnit } from './pricing';

export interface Range {
  lo: number;
  hi: number;
}

/** 0 = clueless, 1 = perfect. Phase 4 derives this from the Assistant/Scout coach. */
export const DEFAULT_SCOUT_ACCURACY = 0.55;

export type AttrKey = Exclude<keyof Attributes, 'injuryProneness' | 'potential'>;

export interface AttributeGroup {
  key: string;
  label: string;
  attrs: { key: AttrKey; label: string }[];
}

/** The five groups the UI shows (spec §3.1). Height/weight are shown as real values. */
export const ATTRIBUTE_GROUPS: AttributeGroup[] = [
  { key: 'physical', label: 'Physical', attrs: [{ key: 'speed', label: 'Speed' }, { key: 'stamina', label: 'Stamina' }] },
  {
    key: 'scoring',
    label: 'Scoring',
    attrs: [
      { key: 'shooting', label: 'Mid-range' },
      { key: 'three', label: '3-Point' },
      { key: 'freeThrow', label: 'Free throw' },
      { key: 'layup', label: 'Layup' },
      { key: 'dunk', label: 'Dunking' },
    ],
  },
  { key: 'playmaking', label: 'Playmaking', attrs: [{ key: 'passing', label: 'Passing' }, { key: 'dribbling', label: 'Dribbling' }] },
  { key: 'defence', label: 'Defence & Boards', attrs: [{ key: 'rebounding', label: 'Rebounding' }, { key: 'tactics', label: 'Tactics (IQ)' }] },
];

/** Half-width of a range in rating points. */
function spread(hype: number, accuracy: number): number {
  const fame = 1.25 - hype / 100; // 0.26 for a superstar, 1.2 for an unknown
  return Math.max(0, Math.round((1 - accuracy) * 22 * fame));
}

export function scoutAttr(player: Player, key: AttrKey, hype: number, accuracy: number): Range {
  const value = player.attrs[key];
  const half = spread(hype, accuracy);
  if (half === 0) return { lo: value, hi: value };
  // Where the true value sits inside the window is stable per player+attribute.
  const offset = Math.round(hashUnit(`scout:${player.id}:${key}`) * half);
  const lo = Math.max(1, value - half + offset);
  const hi = Math.min(99, value + half + offset);
  return { lo: Math.min(lo, value), hi: Math.max(hi, value) };
}

export function scoutGroup(player: Player, group: AttributeGroup, hype: number, accuracy: number): Range {
  const ranges = group.attrs.map((a) => scoutAttr(player, a.key, hype, accuracy));
  const avg = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) / xs.length);
  return { lo: avg(ranges.map((r) => r.lo)), hi: avg(ranges.map((r) => r.hi)) };
}

/** Development potential as a 1–5 star estimate. Always an estimate, even for your own players. */
export function potentialStars(player: Player, accuracy: number): number {
  const noise = hashUnit(`potential:${player.id}`) * (1 - accuracy) * 30;
  const est = player.attrs.potential + noise;
  return Math.max(1, Math.min(5, Math.round(est / 20)));
}

export function formatRange(r: Range): string {
  return r.lo === r.hi ? String(r.lo) : `${r.lo}–${r.hi}`;
}
