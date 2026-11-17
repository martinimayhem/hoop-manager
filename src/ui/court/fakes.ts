// Fakes: drawing only. The engine decides every outcome (a shot, a pass, a drive that beats its
// man); this picks, from the possession's script, the moments where a real player would sell
// something first, and when, so the drawing can show it. Nothing here changes what happens.
//
// - Pump fake: a jump shooter who has the ball long enough before his shot brings it up as if to
//   shoot and back down; his defender bites (hands up, a hop) and is a step late on the real one.
// - Pass fake: a passer with time looks and shows the ball one way, then passes the other; his
//   defender reaches towards the fake.
// - Crossover or hesitation: a driver who has the ball long enough before his finish sells one way
//   and goes the other (the drive beating its man is the engine's; this is how it looks).
//
// Which possessions get one is fixed by the script (a hash of who, where and when), not by chance at
// run time, so a replay of a match shows the same fakes.

import type { BallAction, Beat, Pos } from './animation';

export type FakeKind = 'pump' | 'pass' | 'cross' | 'hesi';

export interface PlannedFake {
  kind: FakeKind;
  /** The faker. */
  key: string;
  /** Script time (real seconds) it starts and ends. */
  start: number;
  end: number;
  /** A pass fake: the receiver of the real pass (the fake goes the other way). */
  to?: string;
}

/** The fake under way, as the frame carries it. */
export interface FakeCue {
  kind: FakeKind;
  key: string;
  /** How far through it (0 to 1); below 0, a pump or pass fake still to come (the dribble ends first). */
  k: number;
  /** A pass fake: where the ball is shown to (court metres). */
  toward?: Pos;
}

/** How long each takes at Normal speed (s), and how much of the hold before the move it needs free. */
export const FAKE_S: Record<FakeKind, number> = { pump: 0.5, pass: 0.42, cross: 0.6, hesi: 0.7 };
/**
 * Left clear between the fake and the move itself (s, Normal speed): the 3D view's own gathers (a
 * jump shot's dip, a pass's pick-up and push, a dunk's last steps) come first.
 */
const CLEAR_S: Record<FakeKind, number> = { pump: 0.32, pass: 0.45, cross: 0.5, hesi: 0.5 };
/** And at least this long with the ball before it (s): a catch is a catch first. */
const SETTLE_S = 0.2;
/** Out of 100, how often each is used where there is time for it. */
const SHARE: Record<FakeKind, number> = { pump: 40, pass: 30, cross: 35, hesi: 30 };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** How long `key` has had the ball, without a break, when beat `i` starts (s), and since when. */
function holding(beats: Beat[], ends: number[], i: number, key: string): { since: number; long: number } {
  let j = i - 1;
  while (j >= 0) {
    const b = beats[j].ball;
    if (!(b.kind === 'held' && b.holder === key) || beats[j].dead) break;
    j--;
  }
  const since = j >= 0 ? ends[j] : 0;
  const at = i > 0 ? ends[i - 1] : 0;
  return { since, long: at - since };
}

/**
 * The fakes in a possession's script. `ends`: each beat's end, in script time; `pace`: how much
 * faster than Normal it plays (the fakes are quicker played fast); `salt`: tells possessions apart.
 */
export function planFakes(beats: Beat[], ends: number[], pace: number, salt: string): PlannedFake[] {
  const out: PlannedFake[] = [];
  const add = (kind: FakeKind, key: string, i: number, to?: string) => {
    const at = i > 0 ? ends[i - 1] : 0;
    const len = FAKE_S[kind] / pace;
    const end = at - CLEAR_S[kind] / pace;
    const start = end - len;
    const { since } = holding(beats, ends, i, key);
    if (start < since + SETTLE_S / pace) return false;
    // A crossover or a hesitation is a dribble move: he must be dribbling all through it.
    if (kind === 'cross' || kind === 'hesi') {
      for (let j = 0; j < i; j++) {
        const from = j > 0 ? ends[j - 1] : 0;
        const b = beats[j].ball;
        if (ends[j] > start && from < end && !(b.kind === 'held' && b.dribble)) return false;
      }
    }
    // One at a time, and never over another's.
    if (out.some((f) => f.end > start - 0.1 && f.start < end + 0.1)) return false;
    out.push({ kind, key, start, end, to });
    return true;
  };
  const roll = (kind: FakeKind, key: string, i: number) => hash(`${salt}|${kind}|${key}|${i}`) % 100 < SHARE[kind];
  beats.forEach((beat, i) => {
    if (beat.dead || beat.phase === 'bringUp') return;
    const a: BallAction = beat.ball;
    if (a.kind === 'fromPlayer' && a.style === 'jumper' && roll('pump', a.from, i)) add('pump', a.from, i);
    else if (a.kind === 'fromPlayer' && (a.style === 'layup' || a.style === 'dunk')) {
      // A drive: a crossover or a hesitation before it, if there is time.
      const kind: FakeKind = hash(`${salt}|move|${a.from}|${i}`) % 2 ? 'cross' : 'hesi';
      if (roll(kind, a.from, i)) add(kind, a.from, i);
    } else if (a.kind === 'pass' && beat.phase === 'play' && roll('pass', a.from, i)) add('pass', a.from, i, a.to);
  });
  return out;
}

/** The fake under way at script time `t`, if any. */
export function fakeAt(plan: PlannedFake[], t: number): PlannedFake | null {
  return plan.find((f) => t >= f.start && t < f.end) ?? null;
}
