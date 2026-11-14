// The court's markings and the basket, by the NBA's Rule No. 1 (Court Dimensions, Equipment):
// https://official.nba.com/rule-no-1-court-dimensions-equipment/ . The 2D and 3D courts both draw
// from here; the playing geometry (court, lane, arcs, hoop position) is in engine/court.ts and is
// already by the same rule. Metres; depths are measured in from the baseline, across from the
// lane line or sideline.
//
// Not given in the rule's text (it points to its diagram) and taken as usual: the backboard's lower
// edge 2.90 m above the floor; the rectangle's base line level with the ring; the centre circle 6 ft
// with a 2 ft circle inside; the lane space marks at 7 ft (the neutral-zone block, 1 ft) and 11, 14
// and 17 ft; the substitution marks 2 ft long, off the court.

const FT = 0.3048;
const IN = 0.0254;

/** Every line is 2 inches wide. */
export const LINE_W = 2 * IN;

/** Lane space marks: 2" wide, 6" out from the lane line; the first is the 1 ft neutral-zone block. */
export const LANE_MARK_OUT = 6 * IN;
export const LANE_MARK_W = 2 * IN;
export const LANE_BLOCK = { from: 7 * FT, len: 1 * FT };
export const LANE_MARKS_AT = [11 * FT, 14 * FT, 17 * FT];

/** Hash marks along the sidelines: 28 ft from each baseline, 3 ft onto the court. */
export const SIDELINE_HASH = { from: 28 * FT, len: 3 * FT };
/** Hash marks on the baseline: 3 ft outside each lane line, 6" onto the court. */
export const BASELINE_HASH = { out: 3 * FT, len: 6 * IN };
/** Hash marks by the free-throw circle: 13 ft from the baseline, 3 ft outside each lane line, 6" long. */
export const FT_CIRCLE_HASH = { from: 13 * FT, out: 3 * FT, len: 6 * IN };
/** Substitution box: a mark 4 ft each side of the midcourt line, in front of the scorer's table (the y = 0 side). */
export const SUB_BOX = { off: 4 * FT, len: 2 * FT };
/** The small circle inside the centre circle. */
export const INNER_CIRCLE_R = 2 * FT;

/** The ring: 18" inside diameter (a 5/8" rod), its nearest inside edge 6" from the backboard's face. */
export const RIM_INNER_R = 9 * IN;
export const RIM_ROD_R = (5 / 16) * IN;
/** From the ring's centre to the middle of the rod. */
export const RIM_R = RIM_INNER_R + RIM_ROD_R;
export const RIM_GAP = 6 * IN;
/** The net: 18" long. */
export const NET_LEN = 18 * IN;

/** The backboard: 6 ft by 3½ ft, its lower edge 2.90 m up. */
export const BOARD_W = 6 * FT;
export const BOARD_H = 3.5 * FT;
export const BOARD_BOTTOM = 2.9;
/** The rectangle on it: 24" by 18" outside, a 2" line, centred behind the ring, base line level with it. */
export const BOARD_RECT_W = 24 * IN;
export const BOARD_RECT_H = 18 * IN;
