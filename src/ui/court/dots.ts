// What the 2D court renderer needs to know about everyone on the floor: number, side, height, who
// has the ball, and their look. Shared by the match screen and the dev capture tools, so both draw
// exactly the same court.

import { featuresUrl, lookOf } from '../looks';
import type { LiveMatch } from '../match/controller';
import { REFS, playerKey } from './animation';
import type { DotInfo } from './render';

export function courtDots(m: LiveMatch): Record<string, DotInfo> {
  const holder = m.holderKey();
  const dots: Record<string, DotInfo> = {};
  for (const side of [0, 1] as const) {
    for (const p of m.s.teams[side].team.players) {
      const k = playerKey(side, p.id);
      dots[k] = { label: String(p.number), side, heightM: p.heightCm / 100, hasBall: holder === k, look: lookOf(p).sprite, features: featuresUrl(p) };
    }
  }
  for (const k of REFS) dots[k] = { label: '', side: 0, heightM: 1.84, hasBall: holder === k, ref: true };
  return dots;
}
