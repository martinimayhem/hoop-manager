// Money in the career world (WORLD_SPEC §10.1): dollars for US clubs, euros for European clubs, at
// one fixed rate that never changes during a career.

import type { Currency } from './types';

/** $1.10 to the euro. */
export const USD_PER_EUR = 1.1;

export function toCurrency(usd: number, currency: Currency): number {
  return currency === 'USD' ? usd : usd / USD_PER_EUR;
}

export function toUsd(amount: number, currency: Currency): number {
  return currency === 'USD' ? amount : amount * USD_PER_EUR;
}

const SYMBOL: Record<Currency, string> = { USD: '$', EUR: '€' };

/** "$4.5M", "€820k", "$95k": short, for tables. */
export function money(amount: number, currency: Currency): string {
  const s = SYMBOL[currency];
  const a = Math.abs(amount);
  const sign = amount < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}${s}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sign}${s}${Math.round(a / 1e3)}k`;
  return `${sign}${s}${Math.round(a)}`;
}

/** Rounds a wage or budget to a tidy figure: to $10k above a million, to $1k below. */
export function tidy(amount: number): number {
  const step = amount >= 1e6 ? 10_000 : 1_000;
  return Math.max(step, Math.round(amount / step) * step);
}
