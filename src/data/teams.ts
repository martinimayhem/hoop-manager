// Two hard-coded test squads with opposite identities, used until the player pool arrives in Phase 3.
//   Harbor Hammers: big, slow, physical, own the paint and the boards, can't shoot.
//   Skyline Sparks: small, quick, fit, live on threes and transition, lose the glass.

import { makePlan } from '../engine/match';
import type { Attributes, GamePlan, Player, Position, Team } from '../engine/types';

type AttrTuple = [
  speed: number, stamina: number, shooting: number, three: number, freeThrow: number, layup: number, dunk: number,
  passing: number, dribbling: number, rebounding: number, tactics: number, injuryProneness: number, potential: number,
];

function player(
  teamId: string, number: number, name: string, position: Position, archetype: string,
  heightCm: number, weightKg: number, a: AttrTuple,
): Player {
  const [speed, stamina, shooting, three, freeThrow, layup, dunk, passing, dribbling, rebounding, tactics, injuryProneness, potential] = a;
  const attrs: Attributes = { speed, stamina, shooting, three, freeThrow, layup, dunk, passing, dribbling, rebounding, tactics, injuryProneness, potential };
  return { id: `${teamId}-${number}`, name, number, position, archetype, heightCm, weightKg, attrs };
}

const h = (n: number, name: string, pos: Position, arch: string, cm: number, kg: number, a: AttrTuple) => player('ham', n, name, pos, arch, cm, kg, a);
const s = (n: number, name: string, pos: Position, arch: string, cm: number, kg: number, a: AttrTuple) => player('sky', n, name, pos, arch, cm, kg, a);

//                                                                spd  sta  mid  3pt  ft   lay  dnk  pas  dri  reb  iq   inj  pot
export const HARBOR_HAMMERS: Team = {
  id: 'ham',
  name: 'Harbor Hammers',
  abbr: 'HAM',
  execution: 1,
  players: [
    h(3, 'Moe Gravel', 'PG', 'Floor General', 188, 90,             [66, 76, 66, 58, 76, 66, 40, 82, 72, 48, 80, 30, 50]),
    h(8, 'Rusty Anchor', 'SG', 'Two-Way Wing', 196, 97,            [64, 74, 72, 68, 78, 68, 58, 60, 64, 55, 72, 35, 45]),
    h(21, 'Tony Brick', 'SF', 'Bully Forward', 203, 108,           [58, 74, 64, 46, 66, 76, 74, 58, 58, 72, 70, 40, 50]),
    h(44, 'Hank Mortar', 'PF', 'Bruiser', 208, 115,                [50, 74, 62, 30, 64, 78, 76, 54, 45, 84, 74, 45, 40]),
    h(55, 'Otis Tower', 'C', 'Rim Protector', 216, 125,            [42, 70, 45, 10, 54, 80, 82, 46, 30, 90, 78, 50, 55]),
    h(1, 'Dusty Docks', 'PG', 'Game Manager', 185, 84,             [68, 76, 62, 60, 78, 62, 30, 74, 74, 40, 68, 30, 60]),
    h(12, 'Pete Pylon', 'SG', 'Glue Guy', 194, 95,                 [60, 72, 66, 66, 74, 62, 48, 56, 60, 52, 66, 35, 50]),
    h(33, 'Barney Bollard', 'SF', 'Enforcer', 201, 104,            [54, 72, 56, 44, 64, 68, 64, 50, 52, 64, 62, 35, 55]),
    h(41, 'Gus Granite', 'PF', 'Glass Cleaner', 206, 112,          [46, 68, 52, 25, 58, 72, 70, 45, 40, 80, 64, 40, 50]),
    h(50, 'Moose Malloy', 'C', 'Paint Beast', 213, 122,            [38, 62, 42, 8, 48, 74, 76, 40, 28, 82, 66, 45, 45]),
    h(15, 'Chip Keel', 'SF', 'Utility Forward', 199, 100,          [55, 70, 60, 50, 68, 62, 56, 52, 54, 58, 60, 30, 65]),
    h(0, 'Nils Barge', 'C', 'Project Big', 211, 118,               [40, 60, 40, 10, 50, 70, 68, 38, 30, 76, 58, 40, 70]),
  ],
};

export const SKYLINE_SPARKS: Team = {
  id: 'sky',
  name: 'Skyline Sparks',
  abbr: 'SKY',
  execution: 1,
  players: [
    s(2, 'Zip Zephyr', 'PG', 'Speedster', 183, 80,                 [90, 82, 70, 76, 84, 72, 40, 80, 86, 38, 70, 30, 65]),
    s(11, 'Remy Raindrop', 'SG', 'Sharpshooter', 191, 86,          [78, 78, 74, 84, 88, 64, 45, 62, 72, 40, 64, 30, 55]),
    s(7, 'Flash Kowalski', 'SF', 'Slasher', 198, 93,               [82, 78, 66, 72, 76, 70, 68, 58, 68, 52, 62, 35, 60]),
    s(24, 'Wes Whitlock', 'PF', 'Stretch Four', 203, 98,           [72, 78, 62, 70, 72, 64, 60, 56, 58, 60, 62, 35, 55]),
    s(31, 'Leo Lightfoot', 'C', 'Mobile Big', 206, 104,            [64, 76, 54, 46, 64, 70, 70, 56, 46, 68, 64, 35, 55]),
    s(5, 'Kit Comet', 'PG', 'Pest Defender', 180, 76,              [90, 84, 62, 74, 82, 70, 30, 76, 84, 30, 66, 30, 70]),
    s(13, 'Dash Dupree', 'SG', 'Shooter', 188, 84,                 [82, 80, 70, 82, 84, 64, 42, 56, 70, 36, 60, 30, 60]),
    s(9, 'Sunny Voss', 'SF', 'Two-Way Wing', 196, 90,              [80, 80, 64, 70, 74, 68, 62, 58, 64, 48, 64, 30, 55]),
    s(23, 'Rocket Ruiz', 'SF', 'Athlete', 197, 91,                 [86, 78, 58, 66, 70, 70, 72, 52, 64, 46, 58, 35, 65]),
    s(32, 'Skip Albright', 'PF', 'Stretch Four', 201, 96,          [72, 78, 60, 68, 70, 64, 58, 52, 54, 58, 60, 35, 50]),
    s(45, 'Theo Updraft', 'C', 'Mobile Big', 205, 102,             [64, 76, 50, 40, 62, 68, 70, 48, 40, 66, 62, 35, 55]),
    s(4, 'Benny Breeze', 'PG', 'Backup Guard', 182, 78,            [86, 82, 64, 72, 80, 66, 28, 70, 78, 32, 58, 30, 55]),
  ],
};

/** Each team's natural game plan. */
export const DEFAULT_PLANS: Record<string, GamePlan> = {
  ham: makePlan(HARBOR_HAMMERS, { offence: 'inside', defence: 'man', tempo: 'slow' }),
  sky: makePlan(SKYLINE_SPARKS, { offence: 'three', defence: 'man', tempo: 'fast' }),
};

/** A copy of a team under another name, for mirror matches in the balance lab. */
export function mirrorTeam(team: Team, abbr: string): Team {
  return { ...team, id: `${team.id}-mirror`, name: `${team.name} (mirror)`, abbr, players: team.players };
}
