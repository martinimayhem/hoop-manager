// How exciting a possession was, from its events and the game around it. Highlights mode shows
// only the best few of each quarter; this is what "best" means. Pure: no timing, no animation.

import type { MatchState, TimedEvent } from '../../engine/types';

/** Points for what happened in the possession, plus what it did to the game. Higher is better. */
export function excitement(events: TimedEvent[], scoreBefore: [number, number], after: MatchState): number {
  let points = 0;
  let shootingFoul = false;
  for (const ev of events) {
    switch (ev.type) {
      case 'shot':
        if (ev.blockerId) points += 3;
        else if (!ev.made) points += 0.2;
        else if (ev.dunk) points += 3.5;
        else if (ev.shotType === 'three') points += 3;
        else if (ev.shotType === 'putback') points += 2.2;
        else points += 1.5;
        // An and-one: fouled and it still goes in.
        if (ev.made && shootingFoul) points += 1.5;
        // Beating the buzzer or the shot clock.
        if (ev.made && ev.buzzer) points += 2;
        else if (ev.made && ev.lateClock) points += 1;
        break;
      case 'foul':
        if (ev.shooting) shootingFoul = true;
        break;
      case 'freeThrow':
        if (ev.made) points += 0.15;
        break;
      case 'turnover':
        if (ev.stealerId) points += 2.5;
        break;
      case 'fastBreak':
        points += 1.5;
        break;
      case 'rebound':
        if (ev.offensive) points += 0.8;
        break;
      case 'doubleTeam':
        points += 0.5;
        break;
      case 'technical':
        points += ev.ejected ? 3 : 1.5;
        break;
      case 'argue':
        points += 0.5;
        break;
    }
  }

  // What it did to the game: a lead changing hands or a tie lifts any play.
  const [home, away] = [after.teams[0].score, after.teams[1].score];
  const before = scoreBefore[0] - scoreBefore[1];
  const now = home - away;
  if (before !== 0 && now !== 0 && Math.sign(before) !== Math.sign(now)) points += 2;
  else if (now === 0 && before !== 0) points += 1.5;
  const scored = now !== before;
  // A basket as the quarter runs out.
  if (scored && after.clock <= 0) points += 2.5;
  else if (scored && after.clock <= 24) points += 1;
  // The end of a close game.
  if (after.quarter >= 4 && after.clock <= 120 && Math.abs(now) <= 8) points += 2;
  return points;
}
