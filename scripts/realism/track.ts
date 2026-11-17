// Tracking data in one shape for both sources, the real games (SportVU) and our animation: every
// player's position and the ball's, sampled at 25 frames a second, in metres on our court
// (x along the court 0..28.65, y across it 0..15.24, z up). The realism scorecard measures both
// with the same code, so any gap is in the movement, not in how it was measured.

export const HZ = 25;
export const STEP = 1 / HZ;

export interface TrackFrame {
  /** Seconds since the start of the recording (continuous; gaps where nothing was recorded). */
  t: number;
  period: number;
  /** Game clock, seconds left in the period. It runs down only while the ball is live. */
  clock: number;
  ball: { x: number; y: number; z: number };
  /** The ten players on the floor: team (0 or 1), an id, position. */
  p: { team: 0 | 1; id: string; x: number; y: number }[];
}

export interface Track {
  name: string;
  source: 'real' | 'sim';
  frames: TrackFrame[];
}

/**
 * Cuts a recording into runs of evenly spaced frames (exactly STEP apart, by linear interpolation),
 * breaking wherever there is a gap of more than a quarter second, the period changes or the ten
 * players on the floor change (a substitution).
 */
export function resample(frames: TrackFrame[]): TrackFrame[][] {
  const runs: TrackFrame[][] = [];
  let run: TrackFrame[] = [];
  const key = (f: TrackFrame) => f.p.map((q) => q.id).sort().join(',');
  let start = 0;
  const flush = (end: number) => {
    // [start, end) is a stretch without breaks: sample it evenly.
    const src = frames.slice(start, end);
    if (src.length >= 2) {
      const out: TrackFrame[] = [];
      let j = 0;
      for (let t = src[0].t; t <= src[src.length - 1].t + 1e-9; t += STEP) {
        while (j < src.length - 2 && src[j + 1].t < t) j++;
        const a = src[j];
        const b = src[j + 1];
        const k = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
        const lerp = (u: number, v: number) => u + (v - u) * k;
        const byId = new Map(b.p.map((q) => [q.id, q]));
        out.push({
          t,
          period: a.period,
          clock: lerp(a.clock, b.clock),
          ball: { x: lerp(a.ball.x, b.ball.x), y: lerp(a.ball.y, b.ball.y), z: lerp(a.ball.z, b.ball.z) },
          p: [...a.p].sort((u, v) => (u.id < v.id ? -1 : u.id > v.id ? 1 : 0)).map((q) => {
            const r = byId.get(q.id) ?? q;
            return { team: q.team, id: q.id, x: lerp(q.x, r.x), y: lerp(q.y, r.y) };
          }),
        });
      }
      runs.push(out);
    }
    run = [];
  };
  for (let i = 1; i <= frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (!b || b.t - a.t > 0.25 || b.t <= a.t || b.period !== a.period || key(a) !== key(b)) {
      flush(i);
      start = i;
    }
  }
  void run;
  return runs.filter((r) => r.length >= HZ);
}
