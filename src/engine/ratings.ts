// Converts raw attributes into the composite ratings the engine actually uses.

import type { Attributes, Player, Position } from './types';
import { POSITIONS } from './types';

/** 170 cm → 10, 200 cm → 67, 215 cm → 96. */
export function heightRating(cm: number): number {
  return clamp((cm - 170) * 1.9 + 10, 1, 99);
}

/** 75 kg → 25, 100 kg → 65, 120 kg → 97. */
export function weightRating(kg: number): number {
  return clamp((kg - 75) * 1.6 + 25, 1, 99);
}

export interface Composite {
  speed: number;
  height: number;
  insideScoring: number;
  driving: number;
  rollFinish: number;
  midRange: number;
  three: number;
  freeThrow: number;
  ballSecurity: number;
  playmaking: number;
  perimeterD: number;
  rimProtection: number;
  rebounding: number;
  /** Rough single-number rating, for display and default rotations. */
  overall: number;
}

const cache = new WeakMap<Player, Composite>();

export function composite(p: Player): Composite {
  const hit = cache.get(p);
  if (hit) return hit;
  const a = p.attrs;
  const h = heightRating(p.heightCm);
  const w = weightRating(p.weightKg);
  const c: Composite = {
    speed: a.speed,
    height: h,
    insideScoring: 0.35 * a.layup + 0.2 * a.dunk + 0.25 * h + 0.2 * w,
    driving: 0.35 * a.speed + 0.3 * a.dribbling + 0.25 * a.layup + 0.1 * a.dunk,
    rollFinish: 0.35 * a.layup + 0.3 * a.dunk + 0.2 * h + 0.15 * a.speed,
    midRange: a.shooting,
    three: a.three,
    freeThrow: a.freeThrow,
    ballSecurity: 0.5 * a.dribbling + 0.3 * a.passing + 0.2 * a.tactics,
    playmaking: 0.6 * a.passing + 0.2 * a.dribbling + 0.2 * a.tactics,
    perimeterD: 0.4 * a.speed + 0.35 * a.tactics + 0.15 * h + 0.1 * a.stamina,
    rimProtection: 0.45 * h + 0.2 * w + 0.25 * a.tactics + 0.1 * a.rebounding,
    rebounding: 0.6 * a.rebounding + 0.3 * h + 0.1 * w,
    overall: 0,
  };
  c.overall = overallFor(p.position, c, a);
  cache.set(p, c);
  return c;
}

/** What the market sees: a position-weighted summary. Deliberately imperfect, so bargains exist. */
function overallFor(pos: Position, c: Composite, a: Attributes): number {
  // Scoring judged on skill, not size: the market watches highlight reels, not wingspans.
  const scoring = Math.max(0.6 * a.layup + 0.4 * a.dunk, c.driving, (a.shooting + a.three) / 2 + 4);
  switch (pos) {
    case 'PG':
      return 0.25 * c.playmaking + 0.35 * scoring + 0.2 * c.perimeterD + 0.2 * c.ballSecurity;
    case 'SG':
    case 'SF':
      return 0.45 * scoring + 0.1 * c.playmaking + 0.25 * c.perimeterD + 0.1 * c.rebounding + 0.1 * c.speed;
    case 'PF':
    case 'C':
      return 0.45 * scoring + 0.15 * c.rimProtection + 0.2 * c.rebounding + 0.2 * ((a.speed + a.tactics + a.passing) / 3);
  }
}

export function positionIndex(pos: Position): number {
  return POSITIONS.indexOf(pos);
}

export type PositionGroup = 'guard' | 'wing' | 'big';

export function positionGroup(pos: Position): PositionGroup {
  if (pos === 'PG' || pos === 'SG') return 'guard';
  if (pos === 'SF') return 'wing';
  return 'big';
}

/** Multiplier for playing a player in a slot away from their natural position. */
export function slotFactor(pos: Position, slot: number): number {
  const diff = Math.abs(positionIndex(pos) - slot);
  return [1, 0.97, 0.9, 0.84, 0.8][diff];
}

/** Performance multiplier from energy: 100 → 1.0, 55 → ~0.92, 30 → ~0.84. */
export function fatigueFactor(energy: number): number {
  const tired = (100 - clamp(energy, 0, 100)) / 100;
  return 1 - 0.28 * Math.pow(tired, 1.5);
}

export function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x;
}
