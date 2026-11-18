// Money in the career world (GAME_FLOW §4, WORLD_SPEC §10.1): dollars everywhere. Every cap-system
// figure is a share of one number, the cap C, so the world lab can tune it in one place.

/** The salary cap C (tune). */
export const CAP = 100_000_000;

/** Cap-system lines and limits, as shares of C (GAME_FLOW §4.1). */
export const FLOOR_SHARE = 0.9;
export const TAX_SHARE = 1.21;
export const CEILING_SHARE = 1.34;
export const MAX_CONTRACT_SHARE = 0.3;
export const MIN_CONTRACT_SHARE = 0.01;
export const MID_LEVEL_SHARE = 0.085;
/** Big League Europe payroll threshold, a share of C (GAME_FLOW §4.2). */
export const THRESHOLD_SHARE = 0.7;
/** How many highest-paid players the threshold leaves out (the anchor players). */
export const ANCHORS = 3;
/** Players younger than this don't count towards the threshold. */
export const THRESHOLD_MIN_AGE = 23;
/** A dev-squad player's wage at a budget club: this share of the club budget (owner's answer, 18 Nov 2026; tune). */
export const DEV_WAGE_BUDGET_SHARE = 0.01;

export const FLOOR = CAP * FLOOR_SHARE;
export const TAX_LINE = CAP * TAX_SHARE;
export const HARD_CEILING = CAP * CEILING_SHARE;
export const MAX_CONTRACT = CAP * MAX_CONTRACT_SHARE;
export const MIN_CONTRACT = CAP * MIN_CONTRACT_SHARE;
export const MID_LEVEL = CAP * MID_LEVEL_SHARE;
export const THRESHOLD = CAP * THRESHOLD_SHARE;

/** "$4.5M", "$820k", "$95k": short, for tables. */
export function money(amount: number): string {
  const a = Math.abs(amount);
  const sign = amount < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}k`;
  return `${sign}$${Math.round(a)}`;
}

/** Rounds a wage or budget down to a tidy figure: to $10k above a million, to $1k below. */
export function tidy(amount: number): number {
  const step = amount >= 1e6 ? 10_000 : 1_000;
  return Math.max(step, Math.floor(amount / step) * step);
}
