// Market prices. Driven by the market's *perception* (overall rating + hype + a little
// noise), not by how useful a player is in a given system. That gap is where bargains live.

import { composite } from '../engine/ratings';
import type { Player } from '../engine/types';

export const BUDGET = 100;
export const MIN_PRICE = 1;
export const MAX_PRICE = 40;

/** Stable pseudo-random number in [-1, 1] from a string. */
export function hashUnit(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** How good the market thinks a player is. Famous players are judged accurately; unknowns less so. */
export function marketOverall(p: Player, hype: number): number {
  const misjudgement = hashUnit(`market:${p.id}`) * (6 - hype / 20);
  return composite(p).overall + misjudgement;
}

export function priceOf(p: Player, hype: number): number {
  const mo = marketOverall(p, hype);
  const quality = Math.pow(Math.max(0, (mo - 55) / 30), 2.2);
  const price = 1 + 24 * quality * (0.5 + hype * 0.009);
  return Math.max(MIN_PRICE, Math.min(MAX_PRICE, Math.round(price)));
}
