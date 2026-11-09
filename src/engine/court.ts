// The court, by NBA rules, in metres: the one source of geometry for the engine (which picks where
// shots come from) and the match view (which draws the court and moves the players on it).
//
// Positions are in the attacking frame: the offence attacks the hoop at the right-hand end
// (x = HOOP_X), y runs across the court from one sideline (0) to the other (COURT.h). The court is
// mirror-symmetric, so the far hoop is at x = COURT.w - HOOP_X.

export interface Point {
  x: number;
  y: number;
}

/** 94 x 50 ft. */
export const COURT = { w: 28.65, h: 15.24 };
/** The line down the middle of the court, through both hoops. */
export const MID_Y = COURT.h / 2;
/** The half-court line. */
export const HALF_X = COURT.w / 2;
/** The rim's centre is 5 ft 3 in from the baseline. */
export const HOOP_X = COURT.w - 1.6;
export const HOOP: Point = { x: HOOP_X, y: MID_Y };
/** The backboard's face, 4 ft in from the baseline. */
export const BOARD_X = COURT.w - 1.22;
/** The three-point arc: 23 ft 9 in from the rim's centre. */
export const THREE_ARC_M = 7.24;
/** In the corners the line runs straight, 3 ft in from the sideline (22 ft from the rim), out from the baseline until it meets the arc (about 14 ft). */
export const CORNER_THREE_FROM_SIDELINE = 0.91;
export const CORNER_THREE_LENGTH = COURT.w - HOOP_X + Math.sqrt(THREE_ARC_M ** 2 - (MID_Y - CORNER_THREE_FROM_SIDELINE) ** 2);
/** The key: 16 ft wide, the free-throw line 19 ft from the baseline. */
export const KEY_HALF_WIDTH = 2.44;
export const FREE_THROW_LINE_X = COURT.w - 5.79;
/** The free-throw and centre circles: 6 ft radius. */
export const CIRCLE_RADIUS = 1.83;
/** The restricted area (no charge): 4 ft from the rim's centre. */
export const RESTRICTED_M = 1.22;

/** A spot `back` metres out from the hoop towards half court and `across` metres from the middle (negative: the y < MID_Y side). */
export function fromHoop(back: number, across: number): Point {
  return { x: HOOP_X - back, y: MID_Y + across };
}

export function distToHoop(p: Point): number {
  return Math.hypot(HOOP_X - p.x, p.y - MID_Y);
}

/** Inside the straight part of the corner three: level with the first 14 ft from the baseline. */
function inCornerStrip(p: Point): boolean {
  return p.x >= COURT.w - CORNER_THREE_LENGTH;
}

/** Whether a shot from here is worth three. */
export function isThree(p: Point): boolean {
  if (inCornerStrip(p)) return Math.abs(p.y - MID_Y) > MID_Y - CORNER_THREE_FROM_SIDELINE;
  return distToHoop(p) > THREE_ARC_M;
}

// ---------------------------------------------------------------------------
// Shot zones, as the NBA's own shooting statistics divide the floor.

export type ShotZone = 'restricted' | 'paint' | 'mid' | 'corner3' | 'aboveBreak3';
/** Which side of the floor: left is the y < MID_Y side in the attacking frame. */
export type CourtSide = 'left' | 'centre' | 'right';

export const ZONES: readonly ShotZone[] = ['restricted', 'paint', 'mid', 'corner3', 'aboveBreak3'];

export function zonePoints(zone: ShotZone): 2 | 3 {
  return zone === 'corner3' || zone === 'aboveBreak3' ? 3 : 2;
}

export function inKey(p: Point): boolean {
  return p.x >= FREE_THROW_LINE_X && Math.abs(p.y - MID_Y) <= KEY_HALF_WIDTH;
}

export function zoneOf(p: Point): ShotZone {
  if (isThree(p)) return inCornerStrip(p) ? 'corner3' : 'aboveBreak3';
  if (distToHoop(p) <= RESTRICTED_M) return 'restricted';
  if (inKey(p)) return 'paint';
  return 'mid';
}

/** The side of the floor a spot is on; anything in line with the key counts as the middle. */
export function sideOf(p: Point): CourtSide {
  const across = p.y - MID_Y;
  return Math.abs(across) <= KEY_HALF_WIDTH * 0.6 ? 'centre' : across < 0 ? 'left' : 'right';
}

/** The sides a shot from each zone can come from. The corners have no middle; the paint is all middle. */
export function zoneSides(zone: ShotZone): readonly CourtSide[] {
  if (zone === 'corner3') return ['left', 'right'];
  if (zone === 'restricted' || zone === 'paint') return ['centre'];
  return ['left', 'centre', 'right'];
}

const DEG = Math.PI / 180;

/** A point at `r` from the hoop, `angle` round from straight out (positive towards the y < MID_Y side). */
function polar(r: number, angle: number): Point {
  return { x: HOOP_X - r * Math.cos(angle), y: MID_Y - r * Math.sin(angle) };
}

/** Angles round from straight out for each side of the floor, as [from, to]. */
function sideAngles(side: CourtSide, from: number, centre: number, to: number): [number, number] {
  if (side === 'centre') return [-centre, centre];
  return side === 'left' ? [from, to] : [-to, -from];
}

/** The facts about a shot that place it on the floor. */
export interface ShotPlace {
  zone: ShotZone;
  courtSide: CourtSide;
  shooterId: string;
  quarter: number;
  clock: number;
}

/**
 * The exact spot a shot went up from, in the attacking frame: a point inside its zone, on its side
 * of the floor, worked out from the shot itself, so the match view and the shot chart always put it
 * in the same place.
 */
export function shotPoint(shot: ShotPlace): Point {
  const key = `${shot.quarter}:${shot.clock.toFixed(1)}:${shot.shooterId}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h >>>= 0;
  return spotInZone(shot.zone, shot.courtSide, (h % 1000) / 1000, ((h >>> 10) % 1000) / 1000);
}

/**
 * A point inside `zone` on `side`, spread by `u` and `v` (each 0..1) so shots from one zone are not
 * all from one spot. Every point lands inside its zone, on the right side of the three-point line.
 */
export function spotInZone(zone: ShotZone, side: CourtSide, u: number, v: number): Point {
  switch (zone) {
    case 'restricted': {
      // In front of the rim, never behind the board.
      const [a, b] = sideAngles('centre', 0, 70 * DEG, 0);
      return polar(0.35 + 0.75 * u, a + (b - a) * v);
    }
    case 'paint': {
      // Between the restricted area and the free-throw line, inside the lane lines.
      const back = 1.6 + 2.4 * u;
      const across = (v * 2 - 1) * (KEY_HALF_WIDTH - 0.35);
      return fromHoop(back, across);
    }
    case 'mid': {
      // Elbows, baseline and the top of the key: outside the lane, inside the arc.
      const [a, b] = sideAngles(side, 30 * DEG, 18 * DEG, 66 * DEG);
      const angle = a + (b - a) * v;
      const p = polar(4.4 + 2.2 * u, angle);
      return inKey(p) ? polar(Math.max(4.4, (HOOP_X - FREE_THROW_LINE_X) / Math.cos(angle) + 0.3), angle) : p;
    }
    case 'corner3': {
      // Feet behind the corner line, between it and the sideline.
      const across = MID_Y - CORNER_THREE_FROM_SIDELINE + 0.12 + 0.35 * u;
      const strip = HOOP_X - (COURT.w - CORNER_THREE_LENGTH) - 0.3;
      const back = strip - (strip + 0.9) * v;
      return fromHoop(back, side === 'left' ? -across : across);
    }
    case 'aboveBreak3': {
      // Behind the arc, from the wing above the break to the top of the key.
      const [a, b] = sideAngles(side, 24 * DEG, 18 * DEG, 58 * DEG);
      return polar(THREE_ARC_M + 0.25 + 0.9 * u, a + (b - a) * v);
    }
  }
}
