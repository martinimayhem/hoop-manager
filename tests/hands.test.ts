// Hands up only when it makes sense. At a shot: the challenger and the defender nearest the shooter
// (a late contest, from up to 4.6 m), and anyone else within 2.5 m. At a rebound: only those the
// ball is within about 2 m of. Nobody across the floor reaches at nothing. Played through the live
// controller, as the camera sees it.

import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, HARBOR_HAMMERS, SKYLINE_SPARKS } from '../src/data/teams';
import { beatAt, isRef, type Script } from '../src/ui/court/animation';
import type { Motion } from '../src/ui/court/motion';
import { LiveMatch } from '../src/ui/match/controller';

describe('hands up', () => {
  it('only near the shooter or near a rebound, never for nothing', () => {
    const m = new LiveMatch(HARBOR_HAMMERS, SKYLINE_SPARKS, [DEFAULT_PLANS.ham, DEFAULT_PLANS.sky], 1, ['ai', 'ai'], 'normal');
    m.highlights = false;
    const inner = m as unknown as { script: Script | null; durations: number[]; t: number; motion: Motion & { reach: Record<string, number> } };
    const team = (k: string) => k.slice(0, k.indexOf(':'));
    let shotHands = 0;
    let reboundHands = 0;
    const farAtShot: string[] = [];
    const farAtRebound: string[] = [];
    for (let i = 0; i < 600000 && m.phase !== 'final'; i++) {
      m.tick(1 / 30);
      m.drainFx();
      if (m.phase === 'timeout' || m.phase === 'break') m.resume();
      const sc = inner.script;
      const f = m.frame();
      if (!sc || !f) continue;
      const beat = sc.beats[beatAt(sc, inner.durations, inner.t).index];
      const a = beat.ball;
      const mo = inner.motion;
      const at = `Q${sc.quarter} ${Math.round(m.clock)}s`;
      for (const k of Object.keys(mo.pos)) {
        // Fully up, not on the way down from something before.
        if (isRef(k) || (mo.reach[k] ?? 0) < 0.99) continue;
        if (a.kind === 'fromPlayer' && a.style !== 'throw' && a.style !== 'set') {
          if (team(k) === team(a.from)) continue;
          const s = mo.pos[a.from];
          const off = (o: string) => Math.hypot(mo.pos[o].x - s.x, mo.pos[o].y - s.y);
          const nearest = Object.keys(mo.pos).every((o) => o === k || isRef(o) || team(o) === team(a.from) || off(o) >= off(k));
          shotHands++;
          // A hand still coming down from a closeout a moment ago is allowed half a metre.
          if (off(k) > 3 && !nearest && beat.contest !== k) farAtShot.push(`${at} ${k} ${off(k).toFixed(1)} m from the shooter`);
        } else if (beat.reach?.includes(k) && f.ball.z > 1.6) {
          reboundHands++;
          const d = Math.hypot(mo.pos[k].x - f.ball.x, mo.pos[k].y - f.ball.y);
          if (d > 2.5) farAtRebound.push(`${at} ${k} ${d.toFixed(1)} m from the ball`);
        }
      }
    }
    expect(m.phase).toBe('final');
    console.log(`hands up at shots ${shotHands} (far ${farAtShot.length}), at rebounds ${reboundHands} (far ${farAtRebound.length})`, farAtShot.slice(0, 5), farAtRebound.slice(0, 5));
    expect(shotHands).toBeGreaterThan(500);
    expect(reboundHands).toBeGreaterThan(500);
    expect(farAtShot).toEqual([]);
    expect(farAtRebound).toEqual([]);
  }, 300000);
});
