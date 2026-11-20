// Key moments (GAME_FLOW §3.4, slice brief W2b §4): each quarter is played by the engine and shown as a
// quarter card; at every break you may change tactics and rotation as in a watched game; the last 5
// minutes of the 4th quarter and any overtime are played live. A lead of 20 or more with 5 minutes
// left goes straight to the result.
//
// The quarters are played exactly as Simulate plays a game (the engine, step by step, from the same
// match), so with no changes at the breaks the match reaches the live part exactly as Simulate would
// have it at that moment (owner, 19 Nov 2026; tests/postseason.test.ts).

import { stepPossession } from '../../engine/match';
import type { MatchState, Side } from '../../engine/types';

/** The live part starts with this much of the 4th quarter left (seconds). */
export const LIVE_FROM = 5 * 60;
/** A lead this big at that moment: no live part, straight to the result. */
export const BLOWOUT = 20;

export type KeyStop = { kind: 'break'; after: number } | { kind: 'live' } | { kind: 'final' };

/**
 * Plays on from where the match is to the next stop: the end of a quarter (a break), 5:00 left in the
 * 4th (the live part), or the end of the game (a blowout is played to the end at once).
 */
export function playToNextStop(s: MatchState): KeyStop {
  let guard = 0;
  while (!s.finished) {
    if (s.quarter >= 4 && s.clock <= LIVE_FROM) {
      if (Math.abs(s.teams[0].score - s.teams[1].score) >= BLOWOUT && s.quarter === 4) {
        while (!s.finished) stepPossession(s);
        return { kind: 'final' };
      }
      return { kind: 'live' };
    }
    const q = s.quarter;
    stepPossession(s);
    if (++guard > 5000) throw new Error('Match did not finish');
    if (s.finished) return { kind: 'final' };
    if (s.quarter > q) return { kind: 'break', after: q };
  }
  return { kind: 'final' };
}

export interface QuarterCard {
  quarter: number;
  /** Points each side scored in the quarter, and the score after it. */
  points: [number, number];
  score: [number, number];
  /** Each side's best run in the quarter (points unanswered). */
  runs: [number, number];
  /** The quarter's top scorers: side, player id, points. */
  top: { side: Side; id: string; pts: number }[];
}

/** What a quarter card shows: the quarter's points, its runs and its top scorers (from the engine's events). */
export function quarterCard(s: MatchState, quarter: number): QuarterCard {
  const events = s.events.filter((e) => e.quarter === quarter);
  let prev: [number, number] | null = null;
  const before = s.events.filter((e) => e.quarter < quarter);
  prev = before.length ? before[before.length - 1].score : [0, 0];
  const pts = new Map<string, { side: Side; id: string; pts: number }>();
  const runs: [number, number] = [0, 0];
  let run: { side: Side; n: number } | null = null;
  for (const e of events) {
    const d0 = e.score[0] - prev[0];
    const d1 = e.score[1] - prev[1];
    prev = e.score;
    if (!d0 && !d1) continue;
    const side: Side = d0 ? 0 : 1;
    const n = d0 || d1;
    run = run && run.side === side ? { side, n: run.n + n } : { side, n };
    runs[side] = Math.max(runs[side], run.n);
    const shooter = 'shooterId' in e ? e.shooterId : null;
    if (shooter) {
      const k = `${side}|${shooter}`;
      pts.set(k, { side, id: shooter, pts: (pts.get(k)?.pts ?? 0) + n });
    }
  }
  const qp = (side: Side) => s.teams[side].quarterPoints[quarter - 1] ?? 0;
  const last = events[events.length - 1]?.score ?? prev;
  return {
    quarter,
    points: [qp(0), qp(1)],
    score: [last[0], last[1]],
    runs,
    top: [...pts.values()].sort((a, b) => b.pts - a.pts).slice(0, 3),
  };
}
