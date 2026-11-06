// Where players stand: half-court formations per offensive focus, zone spots, the guarding rules
// for each defence, and the bounds nobody may leave. Pure geometry in the normalised frame, where
// the offence attacks to the right. The court is mirror-symmetric, so bounds also hold for absolute feet.

import type { OffensiveFocus } from '../../engine/types';
import type { Pos } from './animation';

export const COURT = { w: 94, h: 50 };
export const HOOP_X = 88.75;
export const HOOP: Pos = { x: HOOP_X, y: 25 };
/** Teammates keep about 4 m apart, unless they are setting a screen. */
export const MIN_SPACING_FT = 13;
/** Two sprites standing this close on the floor just touch. */
export const BODY_FT = 2.6;

const MARGIN = 1.5;
/** Without a press, defenders wait for the offence just past half court. */
const HALF_COURT_PICKUP_X = 52;
/** Nobody stands behind a backboard: past this x, in front of the post. */
const BEHIND_BOARD_X = 90.25;
const BEHIND_BOARD_HALF_WIDTH = 5;

type Spot = [number, number];

/** Spots per lineup slot (PG, SG, SF, PF, C). Every formation keeps its five at least 13 ft apart. */
export const FORMATIONS: Record<OffensiveFocus, Spot[]> = {
  // High-low: two bigs on the blocks, shooters wide to give them room.
  inside: [[66, 25], [72, 6], [72, 44], [83, 17], [83, 33]],
  balanced: [[65, 25], [70, 9], [70, 41], [83, 12], [84, 34]],
  // Five out: everybody behind the arc, the paint left empty for cutters.
  three: [[65, 25], [72, 7], [72, 43], [86, 4], [86, 46]],
  // Four out, one in: the big waits at the elbow to come up and screen.
  pickAndRoll: [[63, 25], [72, 7], [86, 46], [72, 42], [77, 25]],
  // Early offence: runners stay wide and deep, the bigs trail.
  fastBreak: [[66, 25], [84, 5], [84, 45], [71, 10], [71, 40]],
};

/** A 2-3 zone: two up top, then both wings and the centre on the baseline side. */
export const ZONE: Spot[] = [[71, 18], [71, 32], [81, 10], [81, 40], [85, 25]];

export function insideCourt(p: Pos, margin = MARGIN): Pos {
  let x = Math.max(margin, Math.min(COURT.w - margin, p.x));
  const y = Math.max(margin, Math.min(COURT.h - margin, p.y));
  if (Math.abs(y - COURT.h / 2) < BEHIND_BOARD_HALF_WIDTH) x = Math.max(COURT.w - BEHIND_BOARD_X, Math.min(BEHIND_BOARD_X, x));
  return { x, y };
}

/** Keeps a pushed player on court; someone pushed into a line slides along it to get clear of `other`. */
function slideClear(pushed: Pos, other: Pos): Pos {
  const p = insideCourt(pushed);
  const dx = p.x - other.x;
  const dy = p.y - other.y;
  if (Math.hypot(dx, dy) >= MIN_SPACING_FT - 0.02) return p;
  if (p.y !== pushed.y) {
    const reach = Math.sqrt(Math.max(0, MIN_SPACING_FT * MIN_SPACING_FT - dy * dy));
    return insideCourt({ x: other.x + (dx > 0 ? reach : -reach), y: p.y });
  }
  if (p.x !== pushed.x) {
    const reach = Math.sqrt(Math.max(0, MIN_SPACING_FT * MIN_SPACING_FT - dx * dx));
    return insideCourt({ x: p.x, y: other.y + (dy > 0 ? reach : -reach) });
  }
  return p;
}

/**
 * Pushes teammates apart until they are `MIN_SPACING_FT` apart. `mobility` says how freely each one
 * gives way: 0 stays put, 1 moves freely. Two players who may not move at all are left as they are.
 */
export function spread(spots: Record<string, Pos>, keys: string[], mobility: (key: string) => number): void {
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = spots[keys[i]];
        const b = spots[keys[j]];
        const ma = mobility(keys[i]);
        const mb = mobility(keys[j]);
        if (ma + mb === 0) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= MIN_SPACING_FT) continue;
        moved = true;
        // Exactly on top of each other: split along the width of the court, towards the middle.
        const ux = d > 0.01 ? dx / d : 0;
        const uy = d > 0.01 ? dy / d : a.y > COURT.h / 2 ? -1 : 1;
        const gap = MIN_SPACING_FT - d + 0.01;
        const na = { x: a.x - (ux * gap * ma) / (ma + mb), y: a.y - (uy * gap * ma) / (ma + mb) };
        const nb = { x: b.x + (ux * gap * mb) / (ma + mb), y: b.y + (uy * gap * mb) / (ma + mb) };
        spots[keys[i]] = ma > 0 ? slideClear(na, nb) : a;
        spots[keys[j]] = mb > 0 ? slideClear(nb, spots[keys[i]]) : b;
      }
    }
    if (!moved) return;
  }
  // Still cramped (bunched in a corner, say): whoever can move walks to the nearest open spot.
  keys.forEach((k, i) => {
    if (mobility(k) === 0) return;
    const clear = (p: Pos) => keys.every((o) => o === k || Math.hypot(spots[o].x - p.x, spots[o].y - p.y) >= MIN_SPACING_FT);
    if (clear(spots[k])) return;
    for (let reach = MIN_SPACING_FT; reach < COURT.w; reach += 3) {
      for (let turn = 0; turn < 16; turn++) {
        const angle = ((turn + i) / 16) * Math.PI * 2;
        const p = insideCourt({ x: spots[k].x + Math.cos(angle) * reach, y: spots[k].y + Math.sin(angle) * reach });
        if (clear(p)) {
          spots[k] = p;
          return;
        }
      }
    }
  });
}

/**
 * Where a man-to-man defender stands: on the line from their man to the basket. Tight on the ball;
 * off the ball they sag further the further their man is from it. A press stays tight everywhere,
 * and anything else waits for the offence near half court.
 */
export function guardSpot(man: Pos, ball: Pos, onBall: boolean, pressing: boolean): Pos {
  const dx = HOOP.x - man.x;
  const dy = HOOP.y - man.y;
  const toHoop = Math.hypot(dx, dy) || 1;
  const fromBall = Math.hypot(man.x - ball.x, man.y - ball.y);
  const wanted = pressing ? (onBall ? 3.5 : 4) : onBall ? 4 : Math.max(6, Math.min(12, 4 + fromBall * 0.28));
  const gap = Math.min(wanted, toHoop * 0.6);
  const spot = { x: man.x + (dx / toHoop) * gap, y: man.y + (dy / toHoop) * gap };
  return pressing ? spot : { x: Math.max(spot.x, HALF_COURT_PICKUP_X), y: spot.y };
}
