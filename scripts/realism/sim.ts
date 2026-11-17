// Our side of the scorecard: plays matches through the live controller (the same Frame data the
// court renderer draws) and records them as tracking data, like the real games.

import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../../src/data/teams';
import { isRef, type Script } from '../../src/ui/court/animation';
import { LiveMatch } from '../../src/ui/match/controller';
import type { Track, TrackFrame } from './track';

/** Real seconds per controller tick; frames are recorded every tick in match time. */
const DT = 1 / 50;

/** Plays matches (seed, seed + 1, …) until `possessions` possessions have been animated. */
export function simTracks(possessions: number, seed = 1): Track[] {
  const tracks: Track[] = [];
  let done = 0;
  for (let s = seed; done < possessions && s < seed + 50; s++) {
    const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], s, ['ai', 'ai'], 'normal');
    m.highlights = false;
    const inner = m as unknown as { script: Script | null };
    const frames: TrackFrame[] = [];
    let t = 0;
    let last: Script | null = null;
    for (let i = 0; i < 2_000_000 && m.phase !== 'final' && done < possessions; i++) {
      m.tick(DT);
      m.drainFx();
      if (m.phase === 'timeout' || m.phase === 'break') m.resume();
      if (m.phase === 'argue') m.letItGo();
      if (m.phase === 'clutch') while (m.clutch) m.submitClutch(m.clutch.pending[0], null);
      const f = m.frame();
      if (!f) continue;
      const g = DT * (f.timeScale ?? 1);
      if (g <= 0) continue;
      t += g;
      if (inner.script && inner.script !== last) {
        last = inner.script;
        done++;
      }
      const p = Object.entries(f.players)
        .filter(([k]) => !isRef(k))
        .map(([k, q]) => ({ team: (k.startsWith('0:') ? 0 : 1) as 0 | 1, id: k, x: q.x, y: q.y }));
      if (p.length !== 10) continue;
      frames.push({ t: Math.round(t * 1e6) / 1e6, period: m.quarter, clock: m.clock, ball: { ...f.ball }, p });
    }
    tracks.push({ name: `sim seed ${s}`, source: 'sim', frames });
  }
  return tracks;
}
